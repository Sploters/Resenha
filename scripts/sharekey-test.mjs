// Atalho da transmissão + "Jogando X? Transmitir" (servidor real + navegador; o app desktop é simulado em window.lcDesktop):
// - entrar na sala com um jogo aberto mostra o cartão "Jogando VALORANT?" (e não mostra de novo para o mesmo jogo)
// - "Transmitir" transmite a janela do jogo direto (sem o seletor), com o áudio só do jogo
// - o atalho global (app desktop) encerra; Ctrl+Shift+S na página liga de novo direto no jogo
// - o atalho nunca abre o seletor: transmite o que está em primeiro plano (janela comum, ou a tela com a área de trabalho
//   na frente), com as últimas configurações, e mostra o aviso rápido de que ligou/desligou
// Uso: BROWSER=/caminho/do/chrome node scripts/sharekey-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3283, BASE = `http://localhost:${PORT}`, DATA = './.testdata-sk';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41083', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const fakeDesktop = () => {
  const T = (window.__t = { selected: null, audioStart: null, flashes: [], game: true, front: null });
  const png = () => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#e44'; x.fillRect(0, 0, 32, 32); return c.toDataURL(); };
  let hotkey = null;
  window.lcDesktop = {
    isDesktop: true,
    getSources: async () => [
      { id: 'screen:0:0', name: 'Tela inteira', type: 'screen', thumbnail: png(), appIcon: null },
      ...(T.game ? [{ id: 'window:4242:0', name: 'VALORANT', type: 'window', thumbnail: null, appIcon: png(), pid: 5150, game: true, minimized: true }] : []),
    ],
    foregroundSource: async () => T.front || (T.game ? { id: 'window:4242:0', name: 'VALORANT', type: 'window', pid: 5150, game: true } : { id: 'screen:0:0', name: 'Tela inteira', type: 'screen' }),
    detectGame: async () => (T.game ? { id: 'valorant', title: 'VALORANT', icon: png() } : null),
    selectSource: async (id, name) => { T.selected = { id, name }; return true; },
    appAudioCapable: async () => ({ ok: true }),
    onAppAudio: () => { }, onAppAudioEvent: () => { },
    appAudioStart: async (o) => { T.audioStart = o; return { ok: true }; },
    appAudioStop: () => { },
    clipFlash: (o) => T.flashes.push(o),
    onHotkey: (cb) => { hotkey = cb; window.__hotkey = (k) => hotkey?.(k); },
    setSettings: async (s) => { T.settings = { ...T.settings, ...s }; return true; }, getSettings: async () => ({}), setBadge: () => { }, setThrottle: () => { },
  };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0;
    setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 640, 360); }, 33);
    return new MediaStream(c.captureStream(30).getVideoTracks());
  };
};
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
try {
  const tok = (await call('', 'POST', '/register', { username: 'gamer', password: 'senha123' })).token;
  const g = await call(tok, 'POST', '/guilds', { name: 'Jogatina' });
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.evaluateOnNewDocument(fakeDesktop);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  ok(await p.evaluate(() => window.__t.settings?.hotkeyShare === 'CommandOrControl+Shift+S'), 'o atalho global da transmissão vai para o app desktop', await p.evaluate(() => window.__t.settings?.hotkeyShare));
  const cid = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  await p.evaluate((gid, cid) => { window.__lc.go(gid, cid); window.__lc.joinVoice(cid); }, g.id, cid);
  await p.waitForSelector('#gameoffer', { timeout: 8000 }).catch(() => null);
  const card = await p.evaluate(() => document.querySelector('#gameoffer')?.innerText);
  ok(/Jogando VALORANT\?/.test(card || '') && /Ctrl \+ Shift \+ S/.test(card || ''), 'entrou na sala com o jogo aberto: cartão "Jogando VALORANT?" com o atalho', card);
  await sleep(500); await p.screenshot({ path: '.testshots/sharekey-offer.png' });
  await p.evaluate(() => [...document.querySelectorAll('#gameoffer button')].find(b => /Transmitir/.test(b.textContent)).click());
  await p.waitForFunction(() => !!window.__lc.voice.screen, { timeout: 8000 }).catch(() => null);
  await sleep(300);
  const t1 = await p.evaluate(() => ({ screen: !!window.__lc.voice.screen, sel: window.__t.selected, aud: window.__t.audioStart, modal: !!document.querySelector('.modal'), card: !!document.querySelector('#gameoffer') }));
  ok(t1.screen && t1.sel?.id === 'window:4242:0' && !t1.modal && !t1.card, '"Transmitir": transmite a janela do jogo direto, sem o seletor', t1);
  ok(t1.aud?.mode === 'include' && t1.aud?.pid === 5150, 'áudio só do jogo', t1.aud);
  await p.evaluate(() => window.__hotkey('share')); await sleep(800);
  ok(await p.evaluate(() => !window.__lc.voice.screen), 'atalho global: encerra a transmissão');
  await p.evaluate(() => window.__lc.S.prefs && 0); // (mesmo jogo não pergunta de novo)
  await p.evaluate(() => window.__t.selected = null);
  await p.mouse.click(700, 300); await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyS'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
  await p.waitForFunction(() => !!window.__lc.voice.screen, { timeout: 8000 }).catch(() => null);
  ok(await p.evaluate(() => !!window.__lc.voice.screen && window.__t.selected?.id === 'window:4242:0'), 'Ctrl+Shift+S na página: liga de novo direto no jogo');
  await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyS'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); await sleep(800);
  ok(await p.evaluate(() => !window.__lc.voice.screen), 'Ctrl+Shift+S de novo: encerra');
  // sem jogo: transmite a janela da frente (um navegador), sem seletor, com o áudio só dela (última escolha: "só este programa")
  await p.evaluate(() => { const T = window.__t; T.game = false; T.front = { id: 'window:777:0', name: 'Navegador', type: 'window', pid: 900 }; T.flashes = []; T.audioStart = null; window.__hotkey('share'); });
  await p.waitForFunction(() => !!window.__lc.voice.screen, { timeout: 8000 }).catch(() => null);
  const t2 = await p.evaluate(() => ({ screen: !!window.__lc.voice.screen, sel: window.__t.selected?.id, aud: window.__t.audioStart, modal: !!document.querySelector('.modal'), flash: window.__t.flashes.at(-1) || document.querySelector('.clipflash')?.innerText }));
  ok(t2.screen && t2.sel === 'window:777:0' && !t2.modal, 'sem jogo: o atalho transmite a janela em primeiro plano, sem abrir o seletor', t2);
  ok(t2.aud?.mode === 'include' && t2.aud?.pid === 900, 'com a última configuração de áudio (só o programa transmitido)', t2.aud);
  ok(!!t2.flash && /Transmitindo/.test(t2.flash.title || t2.flash), 'aviso rápido: "Transmitindo"', t2.flash);
  await p.evaluate(() => { window.__t.flashes = []; window.__hotkey('share'); }); await sleep(800);
  const t3 = await p.evaluate(() => ({ screen: !!window.__lc.voice.screen, flash: window.__t.flashes.at(-1) || document.querySelector('.clipflash')?.innerText }));
  ok(!t3.screen && /encerrada/.test(t3.flash?.title || t3.flash || ''), 'de novo: encerra, com o aviso "Transmissão encerrada"', t3);
  // área de trabalho na frente: a tela inteira, com o áudio "tudo menos a Resenha" se a última escolha foi o PC inteiro
  await p.evaluate(() => { const T = window.__t; T.front = { id: 'screen:0:0', name: 'Tela inteira', type: 'screen' }; T.audioStart = null; window.__lc.S.prefs.screen = { ...window.__lc.S.prefs.screen, audioMode: 'system' }; window.__hotkey('share'); });
  await p.waitForFunction(() => !!window.__lc.voice.screen, { timeout: 8000 }).catch(() => null);
  const t4 = await p.evaluate(() => ({ screen: !!window.__lc.voice.screen, sel: window.__t.selected?.id, aud: window.__t.audioStart, modal: !!document.querySelector('.modal') }));
  ok(t4.screen && t4.sel === 'screen:0:0' && !t4.modal && t4.aud?.mode === 'exclude', 'área de trabalho na frente: transmite a tela, áudio do PC menos a Resenha', t4);
  await p.screenshot({ path: '.testshots/sharekey-front.png' });
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
