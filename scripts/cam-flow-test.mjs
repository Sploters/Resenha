// Câmera no tamanho do quadro (voice.js camFlow + app.js applyCamFlow): quem assiste recebe a camada do simulcast que cabe
// no quadro, e a câmera pausa no servidor quando o quadro sai de vista (outro canal, janela escondida, vídeo desativado).
// Três pessoas na sala, duas com câmera (falsa do Chromium, 1280x720). Mede o vídeo que chega para a alice.
// Uso: node scripts/cam-flow-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3313, BASE = `http://localhost:${PORT}`, DATA = './.testdata-camflow';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41200', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok, w = 1440, h = 900) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: h });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 90000 });
  return p;
}
const join = (p, cid) => p.evaluate(async (cid) => { await window.__lc.voice.join(cid); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, cid);
// vídeo de câmera que chega à alice nos próximos `ms`: kbps somado e a maior largura de quadro
const camIn = (p, ms = 3000) => p.evaluate(async (ms) => {
  const v = window.__lc.voice, s = v.sfu, camIds = new Set([...s.consumers].filter(([, e]) => e.source === 'cam').map(([, e]) => e.c.rtpReceiver)), snap = async () => {
    let b = 0, w = 0; for (const r of camIds) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') { b += x.bytesReceived || 0; w = Math.max(w, x.frameWidth || 0); } }); return { b, w };
  };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); const z = await snap();
  return { kbps: Math.round((z.b - a.b) * 8 / ms), largura: z.w, cams: camIds.size };
}, ms);
try {
  const [a, b, c] = await Promise.all(['alice', 'bruno', 'carla'].map(reg));
  const g = await api(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c]) await api(u.tok, 'POST', '/invites/' + inv);
  const [A, B, C] = await Promise.all([a, b, c].map(u => person(u.tok)));
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  const text = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0).id, g.id);
  for (const P of [A, B, C]) await join(P, vc);
  for (const P of [B, C]) await P.evaluate(() => window.__lc.voice.toggleCam());
  await A.evaluate((g, c) => window.__lc.go(g, c), g.id, vc);
  await sleep(9000); // simulcast sobe as camadas aos poucos (estimativa de banda)

  const grid = await camIn(A);
  const tiles = await A.evaluate(() => [...document.querySelectorAll('#stage .tile.utile video')].map(v => Math.round(v.closest('.tile').getBoundingClientRect().width)));
  ok(grid.cams === 2 && grid.kbps > 50, 'na sala, as duas câmeras chegam', { ...grid, quadros_px: tiles });
  ok(grid.largura > 0 && grid.largura <= 640, 'grade com quadros de 400 px recebe a camada de 320 (não a de 1280)', grid);

  // uma câmera em destaque: ela sobe, a outra (miniatura) desce para a menor
  await A.evaluate((uid) => { document.querySelector(`#stage .tile.utile[data-uid="${uid}"]`)?.click(); }, b.id); await sleep(7000);
  const lay = await A.evaluate(() => Object.fromEntries([...window.__lc.voice.peers].map(([u, p]) => [u, p.camLayer])));
  const fw = await A.evaluate((b, c) => [b, c].map(u => Math.round(document.querySelector(`#stage .tile.utile[data-uid="${u}"]`)?.getBoundingClientRect().width || 0)), b.id, c.id);
  const focus = await camIn(A);
  ok(lay[b.id] > lay[c.id] && lay[c.id] === 0, 'destaque pede uma camada maior; a miniatura, a menor', { bruno: lay[b.id], carla: lay[c.id], quadros_px: fw, ...focus });
  await A.evaluate((uid) => { document.querySelector(`#stage .tile.utile[data-uid="${uid}"]`)?.click(); }, b.id); await sleep(1500);

  // outro canal: depois de 4 s as câmeras pausam e o vídeo para de chegar
  await A.evaluate((g, c) => window.__lc.go(g, c), g.id, text); await sleep(5500);
  const away = await camIn(A);
  ok(away.kbps < 5, 'vendo outro canal, nada de vídeo das câmeras chega', away);
  await A.evaluate((g, c) => window.__lc.go(g, c), g.id, vc); await sleep(3000);
  const back = await camIn(A);
  ok(back.kbps > 50, 'voltando para a sala, as câmeras voltam na hora', back);

  // janela escondida
  await A.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(5500);
  const hidden = await camIn(A);
  ok(hidden.kbps < 5, 'janela escondida: câmeras pausadas', hidden);
  await A.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(3000);
  ok((await camIn(A)).kbps > 50, 'janela de volta: câmeras de volta');

  // câmera nova chegando com a pessoa fora da sala não baixa
  await A.evaluate((g, c) => window.__lc.go(g, c), g.id, text); await sleep(5500);
  await C.evaluate(() => window.__lc.voice.toggleCam()); await sleep(1500); await C.evaluate(() => window.__lc.voice.toggleCam()); await sleep(6000);
  const fresh = await camIn(A);
  ok(fresh.kbps < 5, 'câmera religada enquanto a alice está em outro canal também fica pausada', fresh);
} finally {
  await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(fails ? fails + ' falha(s)' : 'tudo certo'); process.exit(fails ? 1 : 0);
