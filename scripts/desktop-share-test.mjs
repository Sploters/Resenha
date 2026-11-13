// Electron (alice) transmite a tela REAL escolhida no seletor; Edge (bob) assiste. Muda qualidade ao vivo.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electronPath = require('../desktop/node_modules/electron');
// o app guarda servidor e login em <appData>/Resenha (desktop/main.js) e ignora --user-data-dir: aponta appData para .testdata3
const testAppData = { XDG_CONFIG_HOME: process.cwd() + '/.testdata3/appdata', APPDATA: process.cwd() + '/.testdata3/appdata' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
fs.rmSync('.testdata3', { recursive: true, force: true }); fs.rmSync('.testdata2', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const PORT = 3222, BASE = `http://localhost:${PORT}`;
// malha P2P (RTC=0): o teste confere taxa e fps por conexão (peers[].pc); a transmissão pelo SFU é coberta por fase2/gameshare/screen-release
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata2', RTC: '0' }, stdio: 'ignore' });
await sleep(1500);
const app = spawn(electronPath, ['desktop', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--remote-debugging-port=9333', '--user-data-dir=' + process.cwd() + '/.testdata3'], { stdio: 'ignore', env: { ...process.env, ...testAppData, LC_TEST_SERVER: BASE } });
let edge, eb;
const register = async (page, name) => {
  await page.waitForSelector('#auth .auth-card'); await page.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click()); await sleep(200);
  await page.evaluate((n) => { const i = document.querySelectorAll('#auth input'); i[0].value = n; i[2].value = 'Teste.senha-123'; i[3].value = 'Teste.senha-123'; }, name);
  await page.click('#auth .btn'); await page.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
};
try {
  for (let i = 0; i < 40 && !eb; i++) { await sleep(500); try { eb = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }); } catch { } }
  let E; for (let i = 0; i < 30; i++) { E = (await eb.pages()).find(p => p.url().startsWith(BASE)); if (E) break; await sleep(400); }
  ok(!!E, 'Electron carregou o servidor'); await E.bringToFront(); await register(E, 'alice');
  edge = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const B = await edge.newPage(); await B.setViewport({ width: 1300, height: 800 }); await B.goto(BASE); await register(B, 'bob');
  const tok = await E.evaluate(() => localStorage.lc_token);
  const api = (t, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  const g = await api(tok, 'POST', '/guilds', { name: 'Teste' }); const inv = await api(tok, 'POST', `/guilds/${g.id}/invites`);
  await B.evaluate(async (c) => { await fetch('/api/invites/' + c, { method: 'POST', headers: { authorization: 'Bearer ' + localStorage.lc_token } }); }, inv.code); await sleep(800);
  const vch = (await E.evaluate((id) => window.__lc.S.guilds.get(id).channels, g.id)).find(c => c.type === 2);
  for (const p of [E, B]) await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(600);
  for (const p of [E, B]) { await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click()); await sleep(1500); }
  for (let i = 0; i < 30 && !(await E.evaluate(() => [...window.__lc.voice.peers.values()].some(p => p.pc.connectionState === 'connected'))); i++) await sleep(500);
  ok(await E.evaluate(() => [...window.__lc.voice.peers.values()].some(p => p.pc.connectionState === 'connected')), 'chamada conectada (Electron ↔ Edge)');

  // --- abre o seletor de transmissão ---
  await E.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(b => b.title.includes('Transmitir')).click()); const t0 = Date.now(); for (let i = 0; i < 60 && !(await E.evaluate(() => document.querySelectorAll('.modal .source').length)); i++) await sleep(500); console.log('  info seletor pronto em', Date.now() - t0, 'ms');
  const modal = await E.evaluate(() => ({ sources: document.querySelectorAll('.modal .source').length, presets: [...document.querySelectorAll('.modal .seg button')].filter(b => /^(720p|1080p|1440p|Fonte|\d+ fps)/.test(b.textContent)).length, tabs: [...document.querySelectorAll('.modal .seg button')].map(b => b.textContent).slice(0, 2) }));
  ok(modal.sources > 0, `seletor lista telas/janelas (${modal.sources})`);
  ok(modal.presets >= 7, `escolhas de resolução e fps (${modal.presets})`);
  await E.screenshot({ path: '.testshots/20-electron-share-modal.png' });
  // escolhe "Telas" → primeira tela; 720p e 30 fps
  await E.evaluate(() => [...document.querySelectorAll('.modal .seg button')].find(b => /Telas/.test(b.textContent))?.click()); await sleep(300);
  await E.evaluate(() => document.querySelector('.modal .source')?.click()); await sleep(200);
  await E.evaluate(() => { const pick = (t) => [...document.querySelectorAll('.modal .seg button')].find(b => b.textContent === t).click(); pick('720p'); pick('30 fps'); }); await sleep(200);
  // Linux (tela virtual do teste/GitHub): não há servidor de som, e capturar o áudio do sistema falha ("Could not start audio source")
  if (process.platform === 'linux') await E.evaluate(() => [...document.querySelectorAll('.modal .seg button')].find(b => b.textContent === 'Sem áudio')?.click());
  await E.screenshot({ path: '.testshots/21-electron-share-choose.png' });
  await E.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /^Transmitir$/.test(b.textContent)).click());
  await sleep(5000);
  const st = await E.evaluate(() => { const t = window.__lc.voice.screen?.getVideoTracks()[0]; return t ? { ...t.getSettings(), label: t.label } : null; });
  ok(!!st, 'transmissão iniciada no Electron (captura real) ' + JSON.stringify(st));
  ok(st && st.height <= 800, `resolução respeita 720p (saindo ${st?.width}x${st?.height})`);
  await sleep(3000);
  // a transmissão não abre sozinha: cartão "alice está transmitindo" com o botão Assistir (como no Discord)
  await B.evaluate(() => [...document.querySelectorAll('#stage button, #stage .btn')].find(b => /^Assistir$/.test(b.textContent.trim()))?.click());
  await B.waitForFunction(() => document.querySelector('.tile.screen video')?.videoWidth > 0, { timeout: 10000 }).catch(() => { });
  const rx = await B.evaluate(() => { const v = document.querySelector('.tile.screen video'); return v ? { w: v.videoWidth, h: v.videoHeight } : null; });
  ok(rx && rx.w > 0, `bob está assistindo a tela real (${rx?.w}x${rx?.h})`);
  const fps = await B.evaluate(async () => { const p = window.__lc.voice.peers.values().next().value; for (const r of (await p.pc.getStats()).values()) if (r.type === 'inbound-rtp' && r.kind === 'video') return r.framesPerSecond || 0; return 0; });
  console.log('  info fps recebido pelo bob:', fps);
  await B.screenshot({ path: '.testshots/22-bob-watching.png' });

  // --- muda qualidade durante a transmissão ---
  await E.evaluate(() => { document.querySelector('.sctl button[title="Mais opções"]').click(); [...document.querySelectorAll('.menu .it')].find(i => /Ajustes da transmissão/.test(i.textContent)).click(); }); await sleep(800);
  ok(await E.evaluate(() => !!document.querySelector('.modal h2')?.textContent.includes('Ajustes da transmissão') && ![...document.querySelectorAll('.modal .btn')].some(b => /Parar/.test(b.textContent))), 'painel "Ajustes da transmissão" abriu (sem botão de parar)');
  await E.screenshot({ path: '.testshots/23-electron-live-panel.png' });
  await E.evaluate(() => { const pick = (t) => [...document.querySelectorAll('.modal .seg button')].find(b => b.textContent === t).click(); pick('1080p'); pick('60 fps'); }); await sleep(2500);
  const st2 = await E.evaluate(() => window.__lc.voice.screenOpts);
  ok(st2.res === 1080 && st2.fps === 60, 'qualidade alterada ao vivo para 1080p/60');
  const br = await E.evaluate(() => window.__lc.voice.peers.values().next().value.senders.screenvideo?.getParameters().encodings[0].maxBitrate);
  ok(br >= 7e6, `bitrate subiu para ${br}`);
  await E.evaluate(() => document.querySelector('.modal .btn.green').click()); await sleep(300);
  ok(await E.evaluate(() => !!window.__lc.voice.screen), 'fechar os ajustes não para a transmissão');
  await E.evaluate(() => document.querySelector('#stage .bar .stopshare').click()); await sleep(1500);
  ok(await E.evaluate(() => !window.__lc.voice.screen), 'transmissão encerrada');
  ok(await B.evaluate(() => !document.querySelector('.tile.screen')), 'bob deixou de ver a tela');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
console.log(fails ? `\n${fails} FALHA(S)` : '\nSHARE OK');
try { await eb?.disconnect(); await edge?.close(); } catch { }
app.kill(); srv.kill(); await sleep(500); process.exit(fails ? 1 : 0);
