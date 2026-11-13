// Envio retomável e compressão de vídeo no aparelho.
// API: pedaços na ordem, posição errada (409), pedaço cortado no meio não conta, concluir incompleto (409), arquivo final
// igual ao original, outro usuário não enxerga, acima do limite (413). Página: arquivo de 10 MB sobe em pedaços com a
// internet caindo no meio (espera e continua); vídeo acima do limite é comprimido no aparelho e enviado.
// Uso: node scripts/upload-test.mjs (BROWSER=<caminho do Chrome/Edge>; precisa do ffmpeg)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
const PORT = 3299, BASE = `http://localhost:${PORT}`, DATA = './.testdata-upload';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA + '/in', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', MAX_UPLOAD_MB: '12' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const putChunk = (tok, id, off, buf) => fetch(`${BASE}/api/uploads/${id}?offset=${off}`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/octet-stream' }, body: buf }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = (u) => fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'Teste.senha-123' }) }).then(x => x.json());
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await reg('ana'), b = await reg('bia');
  ok((await fetch(BASE + '/api/server-info').then(r => r.json())).max_upload === 12 * 1048576, 'server-info informa o limite');

  // --- API ---
  const data = crypto.randomBytes(10 * 1048576 + 12345);
  ok((await call(a.token, 'POST', '/uploads', { name: 'x.bin', size: 13 * 1048576 })).status === 413, 'acima do limite: 413');
  const st = await call(a.token, 'POST', '/uploads', { name: 'dados.bin', size: data.length, type: 'application/octet-stream' });
  ok(st.id && st.chunk === 8 * 1048576 && st.received === 0, 'envio criado', { chunk: st.chunk });
  ok((await call(b.token, 'GET', `/uploads/${st.id}`)).status === 404, 'outro usuário não enxerga o envio');
  ok((await putChunk(a.token, st.id, 5, data.subarray(5, 100))).status === 409, 'posição errada: 409');
  // pedaço cortado no meio (conexão cai): não conta
  await new Promise((res) => {
    const rq = http.request(`${BASE}/api/uploads/${st.id}?offset=0`, { method: 'PUT', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'application/octet-stream', 'content-length': 8 * 1048576 } });
    rq.on('error', () => res()); rq.write(data.subarray(0, 3 * 1048576)); setTimeout(() => { rq.destroy(); res(); }, 300);
  });
  await sleep(300);
  ok((await call(a.token, 'GET', `/uploads/${st.id}`)).received === 0, 'pedaço cortado no meio é descartado (continua do começo dele)');
  let r = await putChunk(a.token, st.id, 0, data.subarray(0, 8 * 1048576));
  ok(r.status === 200 && r.received === 8 * 1048576, '1º pedaço', r);
  ok((await call(a.token, 'POST', `/uploads/${st.id}/finish`)).status === 409, 'concluir incompleto: 409');
  r = await putChunk(a.token, st.id, 8 * 1048576, data.subarray(8 * 1048576)); ok(r.received === data.length, '2º pedaço');
  const fin = await call(a.token, 'POST', `/uploads/${st.id}/finish`);
  const got = Buffer.from(await (await fetch(BASE + fin.url)).arrayBuffer());
  ok(fin.url && fin.size === data.length && sha(got) === sha(data), 'arquivo final idêntico ao original', fin.url);
  ok(!fs.readdirSync(`${DATA}/uploads/.parts`).length, 'pedaços temporários limpos');

  // --- página: envio em pedaços com a internet caindo ---
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 860 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  const g = await call(a.token, 'POST', '/guilds', { name: 'Envios' }); await sleep(600);
  const tch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id); await sleep(600);
  fs.writeFileSync(DATA + '/in/grande.bin', data);
  const cdp = await p.createCDPSession();
  // internet lenta para dar tempo de cair no meio
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 50e6, uploadThroughput: 1.2e6 });
  const input = await p.$('#composer input[type=file]') || (await p.$$('input[type=file]'))[0];
  await input.uploadFile(DATA + '/in/grande.bin');
  let label = '';
  for (let i = 0; i < 60; i++) { label = await p.evaluate(() => document.querySelector('#attach-prev .up-st')?.textContent || ''); if (/Enviando… [1-9]\d?%/.test(label) && !/Enviando… [89]\d%/.test(label)) break; await sleep(100); }
  ok(/Enviando… \d+%/.test(label), 'progresso aparece', label);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  let waitSeen = false; for (let i = 0; i < 60 && !waitSeen; i++) { waitSeen = /Sem conexão/.test(await p.evaluate(() => document.querySelector('#attach-prev .up-st')?.textContent || '')); await sleep(100); }
  ok(waitSeen, 'internet caiu: mostra "Sem conexão — continua quando voltar"');
  await sleep(1500);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  let pend = null; for (let i = 0; i < 150; i++) { pend = await p.evaluate(() => window.__lc.S.pending.map(x => ({ state: x.state, url: x.url, size: x.size }))[0]); if (pend?.state === 'ok') break; await sleep(200); }
  ok(pend?.state === 'ok' && pend.url, 'internet voltou: o envio continuou e terminou', pend);
  if (pend?.url) ok(sha(Buffer.from(await (await fetch(BASE + pend.url)).arrayBuffer())) === sha(data), 'arquivo enviado pela página idêntico');
  await p.evaluate(() => document.querySelector('#attach-prev .x')?.click()); await sleep(200);

  // --- página: vídeo acima do limite é comprimido ---
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '12', '-c:v', 'libx264', '-b:v', '12M', '-minrate', '12M', '-maxrate', '12M', '-bufsize', '2M', '-x264-params', 'nal-hrd=cbr', '-c:a', 'aac', DATA + '/in/celular.mp4']);
  const big = fs.statSync(DATA + '/in/celular.mp4').size;
  ok(big > 12 * 1048576, 'vídeo de teste maior que o limite', (big / 1048576).toFixed(1) + ' MB');
  const enc = await p.evaluate(async () => (await import('/vendor/mediabunny/mediabunny.js')).getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width: 1280, height: 720, bitrate: 6e6 }));
  console.log('  (codificador disponível neste navegador:', enc, ')');
  await input.uploadFile(DATA + '/in/celular.mp4');
  let comp = false; for (let i = 0; i < 100 && !comp; i++) { comp = /Comprimindo… \d+%/.test(await p.evaluate(() => document.querySelector('#attach-prev .up-st')?.textContent || '')); await sleep(100); }
  ok(comp, 'mostra "Comprimindo… N%"');
  pend = null; for (let i = 0; i < 600; i++) { pend = await p.evaluate(() => window.__lc.S.pending.map(x => ({ state: x.state, url: x.url, size: x.size, name: x.name }))[0]); if (pend?.state === 'ok' || !pend) break; await sleep(200); }
  ok(pend?.state === 'ok' && pend.size <= 12 * 1048576 && pend.size < big, 'vídeo comprimido e enviado dentro do limite', pend && { ...pend, mb: (pend.size / 1048576).toFixed(1) });
  ok(await p.evaluate(() => /Vídeo comprimido/.test(document.getElementById('toast')?.textContent || '')), 'aviso com o antes → depois');
  if (pend?.url) {
    const f = DATA + '/out.' + pend.name.split('.').pop(); fs.writeFileSync(f, Buffer.from(await (await fetch(BASE + pend.url)).arrayBuffer()));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', f]));
    const v = probe.streams.find(s => s.width), au = probe.streams.find(s => !s.width);
    ok(Math.abs(+probe.format.duration - 12) < 0.6 && v && au, 'resultado toca: duração, imagem e som', { dur: probe.format.duration, v: v && `${v.codec_name} ${v.width}x${v.height}`, a: au?.codec_name });
  }
} finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
