// Saúde da transmissão: selo para quem transmite (fps, áudio, problemas), janela minimizada/fechada avisada a quem assiste,
// e o áudio do jogo que caiu/voltou (vigia do app desktop) refletido no selo. App desktop simulado na página de quem transmite.
// Uso: node scripts/streamhealth-test.mjs (BROWSER=<caminho do Chrome/Edge>)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3297, BASE = `http://localhost:${PORT}`, DATA = './.testdata-streamhealth';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41090', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function session(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t, desk) => {
    localStorage.lc_token = t;
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; x.fillStyle = `hsl(${n * 5 % 360} 60% 40%)`; x.fillRect(0, 0, 1280, 720); }, 33); return c.captureStream(30); };
    if (desk) {
      window.__src = { kind: 'window', exists: true, minimized: false }; window.__aev = null;
      const fns = { isDesktop: true, sourceState: async () => window.__src, appAudioStart: async () => ({ ok: true }), appAudioStop: () => { }, onAppAudio: () => { }, onAppAudioEvent: (cb) => { window.__aev = cb; },
        getSettings: async () => ({}), setSettings: async () => true, onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { }, detectGame: async () => null, nativeCapable: async () => ({ ok: false }) };
      window.lcDesktop = new Proxy(fns, { get: (o, k) => (k in o ? o[k] : () => Promise.resolve({})) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
try {
  const ra = await api('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'beto', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Live' }); const inv = await api(ra.token, 'POST', `/guilds/${g.id}/invites`); await api(rb.token, 'POST', `/invites/${inv.code}`);
  const A = await session(ra.token, true), B = await session(rb.token, false);
  const aid = await A.evaluate(() => window.__lc.S.me.id);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  for (const p of [A, B]) { await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500); await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click()); }
  await sleep(3000);
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: true, hint: 'motion', appAudio: { mode: 'include', pid: 4242, name: 'PEAK' } }));
  for (let i = 0; i < 60 && !(await B.evaluate((a) => !!window.__lc.voice.peers.get(a)?.streams.screen, aid)); i++) await sleep(150);
  if (await B.evaluate((a) => window.__lc.voice.closedStreams.has(a), aid)) await B.evaluate((a) => window.__lc.voice.openStream(a), aid);
  await A.evaluate(() => { window.__lc.S.selfPreview = true; }); await sleep(4500);

  const pill = () => A.evaluate(() => { const e = document.querySelector('.tile.screen .hpill'); return e && { cls: e.className, text: e.textContent }; });
  let hp = await pill();
  ok(hp && /\bok\b/.test(hp.cls) && /Transmissão OK/.test(hp.text) && /áudio de PEAK/.test(hp.text) && /\d+ fps/.test(hp.text), 'selo verde com fps e "áudio de PEAK"', hp);
  if (process.env.SHOT) await A.screenshot({ path: process.env.SHOT.replace('.png', '-ok.png') });

  // janela minimizada
  await A.evaluate(() => { window.__src = { kind: 'window', exists: true, minimized: true }; }); await sleep(4000);
  ok(await A.evaluate(() => window.__lc.voice.screenNote) === 'min', 'quem transmite: janela minimizada percebida');
  hp = await pill(); ok(hp && /\bbad\b/.test(hp.cls) && /minimizada/.test(hp.text), 'selo vermelho explica', hp?.text);
  ok(await A.evaluate(() => /minimizada/.test(document.getElementById('toast')?.textContent || '')), 'aviso para quem transmite');
  let note = await B.evaluate(() => document.querySelector('.tile.screen .snote')?.textContent || null);
  ok(note && /Janela minimizada/.test(note) && /ana/.test(note), 'quem assiste vê "Janela minimizada" no lugar da imagem parada', note);
  if (process.env.SHOT) await B.screenshot({ path: process.env.SHOT.replace('.png', '-viewer.png') });
  await A.evaluate(() => { window.__src = { kind: 'window', exists: false }; }); await sleep(4000);
  note = await B.evaluate(() => document.querySelector('.tile.screen .snote')?.textContent || null);
  ok(note && /fechada/.test(note), 'janela fechada: aviso muda', note);
  await A.evaluate(() => { window.__src = { kind: 'window', exists: true, minimized: false }; }); await sleep(4000);
  ok(!(await B.evaluate(() => !!document.querySelector('.tile.screen .snote'))), 'janela restaurada: aviso some para quem assiste');

  // áudio do jogo: vigia avisa que o jogo fechou e depois que voltou
  await A.evaluate(() => window.__aev({ t: 'waiting', name: 'PEAK' })); await sleep(2500);
  hp = await pill(); ok(hp && /\bbad\b/.test(hp.cls) && /PEAK fechou/.test(hp.text), 'jogo fechou: selo diz que o áudio volta sozinho', hp?.text);
  if (process.env.SHOT) await A.screenshot({ path: process.env.SHOT.replace('.png', '-bad.png') });
  await A.evaluate(() => window.__aev({ t: 'reattached', name: 'PEAK' })); await sleep(2500);
  hp = await pill(); ok(hp && /\bok\b/.test(hp.cls), 'reconectado: selo volta ao verde', hp?.cls);
  ok(await A.evaluate(() => /reconectado/.test(document.getElementById('toast')?.textContent || '')), 'aviso "áudio reconectado"');

  // parar: tudo limpo, estado no servidor sem nota
  await A.evaluate(() => window.__lc.voice.stopLocal('screen')); await sleep(1500);
  ok(await A.evaluate(() => !document.querySelector('.hpill') && window.__lc.voice.screenNote === null), 'parou: selo some');
  ok(await B.evaluate((a) => (window.__lc.S.voice.get(a)?.screen_note ?? null) === null, aid), 'estado da sala sem aviso');
} finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
