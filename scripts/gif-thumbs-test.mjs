// GIF no tamanho em que aparece (server/thumbs.js gifRoute + public/util.js imgUrl): WebP ANIMADO menor que o original.
// - antes de ficar pronto, /thumbs/<id>.gif?s=… vai para o original com 302 sem cache (ninguém espera a conversão);
// - depois, responde o WebP animado (mais de um quadro, em loop), menor que o GIF, com cache longo;
// - o tamanho pedido cai no degrau certo (s=100 → 128 px);
// - GIF minúsculo: depois de processado deixa o 302 (se o WebP não ficar menor, 301 para o original, sem converter de novo).
// Sem navegador. Uso: node scripts/gif-thumbs-test.mjs   (PORT=3439; precisa do ffmpeg)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
const PORT = +(process.env.PORT || 3439), RTC = process.env.RTC_PORT || '41439', DIR = path.resolve('.testdata-gifthumbs'), BASE = `http://localhost:${PORT}`;
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
// GIF animado de teste (~1 MB): 6 s de quadros coloridos em 480x240
const GIFF = path.join(DIR, 'teste.gif'), TINY = path.join(DIR, 'mini.gif');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=480x240:r=12:d=6', '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', GIFF]);
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=8x8:r=1:d=1', TINY]);
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC_PORT: RTC, RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
if (!await until(() => fetch(BASE + '/api/server-info').then(() => true, () => false), 30000)) { console.log('servidor não subiu'); process.exit(1); }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const upload = async (tok, file) => (await fetch(`${BASE}/api/upload?name=${path.basename(file)}`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/gif' }, body: fs.readFileSync(file) })).json();
try {
  const r = await call('', 'POST', '/register', { username: 'gifeiro', password: 'Teste.senha-123' });
  const up = await upload(r.token, GIFF), id = /\/files\/([a-f0-9]{24}\.gif)\//.exec(up.url || '')?.[1];
  ok(!!id, 'GIF enviado', up.url);
  const u = `${BASE}/thumbs/${id}?s=100`;
  const first = await fetch(u, { redirect: 'manual' });
  ok(first.status === 302 && /\/files\/[a-f0-9]{24}\.gif\//.test(first.headers.get('location') || '') && /no-store/.test(first.headers.get('cache-control') || ''), 'ainda não pronto: 302 sem cache para o original', { status: first.status, loc: first.headers.get('location') });
  const done = await until(async () => { const x = await fetch(u, { redirect: 'manual' }); return x.status === 200 ? x : null; }, 60000);
  ok(!!done, 'depois de convertido: 200');
  if (done) {
    const buf = Buffer.from(await done.arrayBuffer()), src = fs.statSync(GIFF).size;
    ok(done.headers.get('content-type') === 'image/webp' && /immutable/.test(done.headers.get('cache-control') || ''), 'WebP com cache longo', done.headers.get('content-type'));
    ok(buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP' && buf.includes('ANIM') && buf.indexOf('ANMF') !== buf.lastIndexOf('ANMF'), 'WebP animado (vários quadros)');
    ok(buf.length < src / 3, `bem menor que o GIF (${buf.length} de ${src} bytes)`);
    ok(fs.existsSync(path.join(DIR, 'uploads', id + '.a128.webp')), 's=100 vira o degrau de 128 px');
    // outro tamanho ainda não convertido: usa o de 128 já pronto (cache curto) em vez de mandar o GIF original inteiro
    const near = await fetch(`${BASE}/thumbs/${id}?s=60`, { redirect: 'manual' });
    ok(near.status === 200 && near.headers.get('content-type') === 'image/webp' && /max-age=600/.test(near.headers.get('cache-control') || ''), 'tamanho novo enquanto converte: WebP maior já pronto, não o original', { status: near.status, cc: near.headers.get('cache-control') });
    // versão do conversor antigo (.w<lado>.webp) também serve enquanto a nova não fica pronta
    fs.copyFileSync(path.join(DIR, 'uploads', id + '.a128.webp'), path.join(DIR, 'uploads', id + '.w256.webp'));
    const old = await fetch(`${BASE}/thumbs/${id}?s=200`, { redirect: 'manual' });
    ok(old.status === 200 && old.headers.get('content-type') === 'image/webp', 'versão do conversor antigo cobre enquanto converte', old.status);
  }
  const map = await fetch(`${BASE}/vendor/ns/nao-existe.js.map`);
  ok(map.status === 404, 'arquivo de interface que não existe: 404 (não a página)', map.status);
  const page = await fetch(`${BASE}/convite/abc`);
  ok(page.status === 200 && /<html/i.test(await page.text()), 'rota da interface sem extensão: a página', page.status);
  const up2 = await upload(r.token, TINY), id2 = /\/files\/([a-f0-9]{24}\.gif)\//.exec(up2.url || '')?.[1];
  const u2 = `${BASE}/thumbs/${id2}?s=64`;
  await fetch(u2, { redirect: 'manual' });
  const fin = await until(async () => { const x = await fetch(u2, { redirect: 'manual' }); return x.status !== 302 ? x : null; }, 30000);
  ok(!!fin && (fin.status === 200 || (fin.status === 301 && /\/files\//.test(fin.headers.get('location') || ''))), 'GIF minúsculo: depois de processado sai do 302 (WebP, ou 301 para o original se não compensar)', fin?.status);
  const gone = await fetch(`${BASE}/thumbs/${'0'.repeat(24)}.gif?s=64`, { redirect: 'manual' });
  ok(gone.status === 404, 'GIF que não existe: 404', gone.status);
} catch (e) { ok(false, 'erro: ' + e.message); }
srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
