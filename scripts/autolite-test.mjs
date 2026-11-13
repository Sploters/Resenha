// Modo leve automático com o jogo aberto (app desktop simulado) e o painel "Consumo agora".
// - jogo abre: liga o modo leve sem mexer na redução de ruído nem na qualidade da transmissão; jogo fecha (2 leituras): desliga
// - desligar à mão com o jogo aberto: não religa até o jogo fechar; ligado à mão: o automático não desliga
// - chave "Ligar sozinho" desliga o automático; painel mostra CPU/memória por grupo e o que pesa agora
// Uso: node scripts/autolite-test.mjs (BROWSER=<caminho do Chrome/Edge>)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3295, BASE = `http://localhost:${PORT}`, DATA = './.testdata-autolite';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'gamer', password: 'Teste.senha-123' }) }).then(x => x.json());
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    localStorage.lc_prefs = JSON.stringify({ noiseMode: 'rnnoise', screen: { res: 1080, fps: 60 } });
    window.__game = null; window.__throttle = [];
    const fns = {
      isDesktop: true, detectGame: async () => window.__game, setThrottle: (on) => window.__throttle.push(on), getSettings: async () => ({ hardwareAcceleration: true }), setSettings: async () => true,
      onHotkey: () => { }, setBadge: () => { },
      appMetrics: async () => [{ type: 'Browser', service: '', cpu: 2, mem: 90e6 }, { type: 'Tab', service: '', cpu: 6, mem: 210e6 }, { type: 'GPU', service: '', cpu: 3, mem: 150e6 }, { type: 'Utility', service: 'network.mojom.NetworkService', cpu: 0.2, mem: 20e6 }],
    };
    window.lcDesktop = new Proxy(fns, { get: (o, k) => (k in o ? o[k] : () => Promise.resolve({})) });
  }, r.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); await sleep(500);
  const prefs = () => p.evaluate(() => ({ ...window.__lc.S.prefs }));
  const gc = (game) => p.evaluate(async (game) => { const m = await window.__lc.import('lite.js'); m.gameChanged(game, window.__lc.voice); }, game);
  const G = { id: 'valorant', title: 'VALORANT' };

  // pela detecção de verdade (o laço do app: primeira leitura 3 s depois de conectar)
  await p.evaluate((g) => { window.__game = g; }, G); await sleep(3500);
  let P = await prefs();
  ok(P.lightMode === true && P.liteAutoGame === 'valorant', 'jogo aberto: modo leve ligou sozinho', { lightMode: P.lightMode, liteAutoGame: P.liteAutoGame });
  ok(P.animations === false && P.animMode === 'never', 'animações e GIFs desligados');
  ok(P.noiseMode === 'rnnoise' && P.screen.res === 1080 && P.screen.fps === 60, 'redução de ruído e qualidade da transmissão intactas', { noiseMode: P.noiseMode, screen: P.screen });
  ok(await p.evaluate(() => /VALORANT aberto/.test(document.getElementById('toast')?.textContent || '')), 'aviso diz o jogo');
  ok(await p.evaluate(() => window.__throttle.at(-1) === true), 'economia em segundo plano ligada (fora de chamada)');

  await gc(null); P = await prefs();
  ok(P.lightMode === true, 'uma leitura sem jogo não desliga (pode ser alt+tab)');
  await gc(null); P = await prefs();
  ok(!P.lightMode && P.animations !== false && P.liteAutoGame === undefined, 'jogo fechado: desligou e voltou tudo', { lightMode: P.lightMode, animations: P.animations });

  // desligar à mão durante o jogo: não religa até fechar
  await gc(G); ok((await prefs()).lightMode === true, 'abriu de novo: ligou');
  await p.evaluate(async () => { const m = await window.__lc.import('lite.js'); m.setLite(false, window.__lc.voice); });
  await gc(G); await gc(G); ok(!(await prefs()).lightMode, 'desligado à mão com o jogo aberto: continua desligado');
  await gc(null); await gc(null); await gc(G); ok((await prefs()).lightMode === true, 'depois de fechar e abrir: liga de novo');
  await gc(null); await gc(null);

  // ligado à mão: o automático não desliga
  await p.evaluate(async () => { const m = await window.__lc.import('lite.js'); m.setLite(true, window.__lc.voice); });
  P = await prefs(); ok(P.lightMode && P.noiseMode === 'standard', 'à mão: modo leve completo (inclui ruído)');
  await gc(G); await gc(null); await gc(null);
  ok((await prefs()).lightMode === true, 'ligado à mão não é desligado pelo jogo fechando');
  await p.evaluate(async () => { const m = await window.__lc.import('lite.js'); m.setLite(false, window.__lc.voice); });
  ok((await prefs()).noiseMode === 'rnnoise', 'desligar volta o ruído por IA');

  // a conta não guarda nada disso
  await sleep(1600);
  const acc = await fetch(BASE + '/api/me/settings', { headers: { authorization: 'Bearer ' + r.token } }).then(x => x.json());
  const st = acc.settings || acc || {};
  ok(!('liteAuto' in st) && !('liteAutoGame' in st), 'automático é só desta máquina (não vai para a conta)', Object.keys(st).filter(k => /lite/i.test(k)));

  // página
  await p.evaluate(() => window.__lc.openSettings('lite')); await sleep(2500);
  const txt = await p.$eval('#settings .pane', el => el.textContent);
  ok(txt.includes('Ligar sozinho quando um jogo abrir') && txt.includes('Consumo agora'), 'página tem a chave e o consumo');
  ok(/448 MB/.test(txt) && txt.includes('Interface (chat, voz, vídeos)') && txt.includes('Rede'), 'consumo: total e grupos', txt.match(/\d+ MB/g));
  ok(txt.includes('Animações da interface') && txt.includes('GIFs animados'), 'lista o que pesa agora');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  await p.evaluate(() => [...document.querySelectorAll('#settings .perm')].find(e => e.textContent.includes('Ligar sozinho')).querySelector('[role=switch]').click()); await sleep(200);
  ok((await prefs()).liteAuto === false, 'chave desliga o automático');
  await gc(G); ok(!(await prefs()).lightMode, 'com a chave desligada, jogo aberto não liga nada');
} finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
