// Clipes automáticos no app: Ana transmite (sem ligar os clipes da própria transmissão à mão) e o buffer liga sozinho;
// o medidor das vozes roda (Ana e Beto); a sala vê o ícone de "gravando clipes"; um disparo salva o clipe neste aparelho
// (nunca posta), no máximo 3 por transmissão; Beto desligando "Permitir que minha voz entre em clipes" sai da medição;
// desligar "Clipes automáticos" para a gravação da própria transmissão.
// Uso: node scripts/autoclip-ui-test.mjs   (BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3271, BASE = `http://localhost:${PORT}`, DIR = './.testdata-autoclip', OUT = '.testshots/autoclip';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41151', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 820 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((tok) => {
    localStorage.lc_token = tok;
    navigator.mediaDevices.getDisplayMedia = async () => { // tela falsa com movimento e som
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const x = cv.getContext('2d'); let n = 0;
      setInterval(() => { x.fillStyle = `hsl(${n % 360},60%,35%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.fillText(String(n), 60, 200); n++; }, 33);
      const s = cv.captureStream(30), ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]);
      return s;
    };
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 });
  return p;
}
const dbg = (P) => P.evaluate(async () => (await window.__lc.import('autoclip.js')).autoClipDebug());
try {
  const A = await reg('ana'), B = await reg('beto');
  const g = await call(A.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(A.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(B.tok, 'POST', '/invites/' + code);
  const pa = await page(A.tok), pb = await page(B.tok);
  const vch = await pa.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const p of [pa, pb]) {
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await p.waitForFunction(() => window.__lc.voice?.active, { timeout: 20000 }); await sleep(800);
  }
  ok(await pa.evaluate(() => window.__lc.S.prefs.clipsOn === undefined && window.__lc.S.prefs.autoClips === undefined), 'preferências no padrão (clipes da própria transmissão não ligados à mão)');
  ok(!(await dbg(pa)), 'sem transmitir: clipes automáticos parados');
  await pa.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: true })); await sleep(2500);
  const keys0 = await pa.evaluate(async () => (await window.__lc.import('clips.js')).clipKeys());
  ok(!(await dbg(pa)) && !keys0.includes('s:' + A.id), 'padrão: clipes automáticos desligados (transmitindo, nada grava a própria transmissão)', keys0);
  await pa.evaluate(() => { window.__lc.S.prefs.autoClips = true; document.dispatchEvent(new Event('voice-rerender')); }); await sleep(1500);
  const keys =await pa.evaluate(async () => (await window.__lc.import('clips.js')).clipKeys());
  ok(keys.includes('s:' + A.id), 'transmitindo: a própria transmissão passa a gravar em segundo plano (por causa dos automáticos)', keys);
  await sleep(2500);
  const d1 = await dbg(pa);
  ok(d1 && d1.voices.includes('me') && d1.voices.includes(B.id), 'medindo a voz da Ana e a do Beto', d1);
  ok(d1?.frames > 50, 'o medidor (AudioWorklet) está mandando quadros', d1?.frames);
  const sideA = await pb.evaluate((uid) => !!document.querySelector(`#side [data-uid="${uid}"] .vu-clip, #side .vu-clip`), A.id);
  ok(await pb.evaluate((uid) => window.__lc.S.voice.get(uid)?.clips === true, A.id) && sideA, 'o Beto vê que a Ana está gravando clipes (ícone na sala)');
  ok(await pa.evaluate(() => /Clipes auto/.test(document.querySelector('#voice-panel')?.textContent || '')), 'painel de voz da Ana mostra "Clipes auto"');
  await pa.screenshot({ path: `${OUT}/01-transmitindo.png` });
  // disparo: depois de ~5 s salva neste aparelho, mesmo com "postar no chat" escolhido
  await pa.evaluate(() => { window.__lc.S.prefs.clipDest = 'post'; });
  await pa.evaluate(async () => (await window.__lc.import('autoclip.js')).autoClipFire('laugh'));
  ok((await dbg(pa)).pending, 'disparou: espera o desfecho do lance antes de cortar');
  await sleep(6500);
  const clips = await pa.evaluate(async () => (await (await window.__lc.import('cliplocal.js')).listLocalClips()).map(c => ({ title: c.title, auto: c.auto, size: c.size || c.blob?.size })));
  ok(clips.length === 1 && clips[0].auto === 'laugh' && /^Automático: /.test(clips[0].title) && clips[0].size > 1000, 'clipe automático guardado no aparelho (não postou)', clips);
  const msgs = await call(A.tok, 'GET', `/channels/${vch.id}/messages?limit=5`);
  ok(Array.isArray(msgs) && msgs.length === 0, 'nada foi postado no chat', msgs.length);
  ok(await pa.evaluate(() => /1\/3/.test(document.querySelector('#voice-panel .vp-auto')?.title || '')), 'contagem 1/3 no painel');
  await pa.screenshot({ path: `${OUT}/02-salvo.png` });
  // intervalo entre clipes: outro disparo logo em seguida é ignorado
  await pa.evaluate(async () => (await window.__lc.import('autoclip.js')).autoClipFire('shout'));
  ok(!(await dbg(pa)).pending && (await dbg(pa)).count === 1, 'outro pico logo depois: ignorado (1 a cada 90 s)');
  // Beto não quer a voz em clipes
  await pb.evaluate(() => { window.__lc.S.prefs.clipVoiceOff = true; window.__lc.voice.sendState(); }); await sleep(1500);
  const d2 = await dbg(pa);
  ok(await pa.evaluate((uid) => window.__lc.S.voice.get(uid)?.noclip === true, B.id) && d2 && !d2.voices.includes(B.id), 'Beto desligou "minha voz em clipes": sai da medição', d2);
  ok(await pa.evaluate((uid) => { const v = window.__lc.voice, p = v.peers.get(uid); const src = p?.audioEl?.srcObject || p?.audioEl?.raw; return !!src && !v.clipAudio().includes(src); }, B.id), 'e sai do áudio dos clipes da Ana');
  // desligar os automáticos: a própria transmissão para de gravar
  await pa.evaluate(() => { window.__lc.S.prefs.autoClips = false; document.dispatchEvent(new Event('voice-rerender')); }); await sleep(1500);
  const keys2 = await pa.evaluate(async () => (await window.__lc.import('clips.js')).clipKeys());
  ok(!(await dbg(pa)) && !keys2.includes('s:' + A.id), 'clipes automáticos desligados: para de gravar a própria transmissão', keys2);
  ok(await pb.evaluate((uid) => !window.__lc.S.voice.get(uid)?.clips, A.id), 'e o indicador some para a sala');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
