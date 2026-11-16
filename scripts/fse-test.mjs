// Aviso de tela cheia exclusiva (M12) e diagnóstico da captura (M13), com o app desktop simulado.
// O "Windows" (fseState: SHQueryUserNotificationState pelo lc-audio) é controlado pelo teste; a captura é um canvas que o
// teste deixa normal, preto ou parado. O aviso só pode sair com as DUAS evidências (Windows + captura falhando) e nunca
// para a transmissão. Uso: node scripts/fse-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3344, BASE = `http://localhost:${PORT}`, DATA = './.testdata-fse';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41360', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function session(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t, desk) => {
    localStorage.lc_token = t;
    // __cap: 'ok' (muda todo quadro), 'black' (preto mudando: quadros chegam, imagem preta), 'frozen' (não desenha mais)
    window.__cap = 'ok';
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0;
      setInterval(() => { if (window.__cap === 'frozen') return; n++; x.fillStyle = window.__cap === 'black' ? `rgb(${n % 2},0,0)` : `hsl(${n * 5 % 360} 60% 40%)`; x.fillRect(0, 0, 1280, 720); }, 33); return c.captureStream(30); };
    if (desk) {
      window.__fseSt = { available: true, state: 'normal', fgIsSource: true, kind: 'window' };
      const fns = { isDesktop: true, sourceState: async () => ({ kind: 'window', exists: true, minimized: false }), fseState: async () => window.__fseSt,
        getSettings: async () => ({}), setSettings: async () => true, onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { }, detectGame: async () => null, nativeCapable: async () => ({ ok: false, code: 'win10', reason: 'No Windows 10 a captura a 120 FPS mostra uma borda amarela em volta da tela.' }) };
      window.lcDesktop = new Proxy(fns, { get: (o, k) => (k in o ? o[k] : () => Promise.resolve({})) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const fse = (A) => A.evaluate(() => ({ fse: window.__lc.voice.fse, screen: !!window.__lc.voice.screen, banner: document.querySelector('.blackwarn')?.textContent || '', toast: document.getElementById('toast')?.textContent || '' }));
const health = (A) => A.evaluate(async () => (await window.__lc.voice.screenHealth())?.items.map(i => i[1]) || []);
const waitState = async (A, st, ms) => { try { await A.waitForFunction((st) => (window.__lc.voice.fse?.state ?? null) === st, { timeout: ms, polling: 300 }, st); return true; } catch { return false; } };
try {
  const ra = await api('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'beto', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Live' }); const inv = await api(ra.token, 'POST', `/guilds/${g.id}/invites`); await api(rb.token, 'POST', `/invites/${inv.code}`);
  const A = await session(ra.token, true), B = await session(rb.token, false);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  for (const p of [A, B]) { await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500); await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click()); }
  await sleep(3000);
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 60, audio: false, hint: 'motion' }));
  await sleep(4000);

  // 1) Windows diz "normal": nada
  let s = await fse(A);
  ok(s.fse?.available && s.fse.state === null && !s.banner, 'Windows sem tela cheia exclusiva: nenhum aviso', s.fse);

  // 2) Windows diz tela cheia exclusiva, mas a captura recebe imagem: só suspeita (falso positivo do Windows), sem aviso
  await A.evaluate(() => { window.__fseSt = { ...window.__fseSt, state: 'd3d_fullscreen' }; });
  ok(await waitState(A, 'suspected', 8000), 'Windows indica tela cheia exclusiva: suspeita');
  await sleep(9000);
  s = await fse(A); let hi = await health(A);
  ok(s.fse.state === 'suspected' && !s.banner && !hi.some(t => /tela cheia exclusiva/.test(t)) && !/tela cheia exclusiva/.test(s.toast), 'captura funcionando: continua só suspeita, sem aviso nem banner (evita o falso positivo)', { fse: s.fse, hi });

  // 3) outro programa em tela cheia exclusiva (não a janela transmitida) + imagem preta: não confirma tela cheia do jogo
  await A.evaluate(() => { window.__fseSt = { ...window.__fseSt, fgIsSource: false }; window.__cap = 'black'; });
  await sleep(10000);
  s = await fse(A); hi = await health(A);
  ok(s.fse.state === null && /preta/.test(s.banner) && hi.some(t => /saindo preta/.test(t)), 'tela cheia exclusiva de OUTRA janela: não confirma; fica o aviso genérico de imagem preta', { fse: s.fse, banner: s.banner });

  // 4) a janela transmitida em tela cheia exclusiva + imagem preta: confirmado, com aviso; a transmissão continua
  await A.evaluate(() => { window.__fseSt = { ...window.__fseSt, fgIsSource: true }; });
  ok(await waitState(A, 'confirmed', 12000), 'Windows indica e a imagem sai preta: confirmado');
  await sleep(600);
  s = await fse(A); hi = await health(A);
  ok(s.screen && /Tela cheia exclusiva/.test(s.banner) && hi.some(t => /tela cheia exclusiva/.test(t)) && !hi.some(t => /saindo preta/.test(t)), 'aviso no quadro e no selo (sem repetir o aviso genérico); a transmissão segue no ar', { banner: s.banner, hi });
  ok(/tela cheia exclusiva/.test(s.toast), 'aviso flutuante (uma vez)', s.toast);
  const live = await B.evaluate(() => [...window.__lc.voice.peers.values()].some(p => p.streams?.screen));
  ok(live, 'quem assiste continua vendo a transmissão (nada foi parado)');

  // 5) Ajustes da transmissão: opções (sem parar nada) e diagnóstico da captura
  if (process.env.SHOTS) await A.screenshot({ path: process.env.SHOTS + '/fse-banner.png' });
  await A.evaluate(() => document.querySelector('.blackwarn').click()); await sleep(1800);
  const md = await A.evaluate(() => { const m = document.querySelector('.modal'); m?.querySelector('details.capdiag')?.setAttribute('open', ''); return { fse: m?.querySelector('.fsebox')?.textContent || '', btns: [...(m?.querySelectorAll('.fsebtns button') || [])].map(b => b.textContent), diag: m?.querySelector('.cd-body')?.textContent || '' }; });
  if (process.env.SHOTS) { await sleep(1200); await A.screenshot({ path: process.env.SHOTS + '/fse-modal.png' }); }
  ok(/Janela sem bordas/.test(md.fse) && /tela inteira/.test(md.fse) && md.btns.includes('Escolher outra fonte') && md.btns.includes('Continuar assim'), 'opções: Janela sem bordas, tela inteira, continuar assim', md);
  ok(/Método em uso.*Modo normal/.test(md.diag) && /Chromium \(capturador do navegador\)[\d.]+ quadros/.test(md.diag) && /Programa nativo \(WGC\)não usado/.test(md.diag), 'diagnóstico: método em uso e quadros por método', md.diag);
  ok(/Por que não o nativo.*Windows 10/.test(md.diag) && /Tela cheia exclusivaconfirmada/.test(md.diag), 'diagnóstico: motivo de não estar no nativo e o estado da tela cheia', md.diag);
  await A.evaluate(() => [...document.querySelectorAll('.fsebtns button')].find(b => b.textContent === 'Continuar assim').click()); await sleep(600);
  ok(await A.evaluate(() => !document.querySelector('.modal') && !!window.__lc.voice.screen), '"Continuar assim" fecha e a transmissão segue');

  // 6) o jogo sai da tela cheia (Janela sem bordas): imagem volta, aviso some sozinho
  await A.evaluate(() => { window.__fseSt = { ...window.__fseSt, state: 'busy' }; window.__cap = 'ok'; });
  ok(await waitState(A, null, 12000), 'jogo em janela sem bordas: o aviso some sozinho');
  await sleep(6500);
  s = await fse(A);
  ok(!s.banner, 'sem banner depois que a imagem volta', s.banner);

  // 7) imagem congelada (sem quadro novo) com o Windows indicando: confirma depois de ~12 s
  await A.evaluate(() => { window.__fseSt = { ...window.__fseSt, state: 'd3d_fullscreen' }; window.__cap = 'frozen'; });
  ok(await waitState(A, 'confirmed', 25000), 'Windows indica e nenhum quadro novo por 12 s: confirmado');
  await A.evaluate(() => { window.__cap = 'ok'; window.__fseSt = { ...window.__fseSt, state: 'normal' }; });
  ok(await waitState(A, null, 10000), 'e volta ao normal quando os quadros voltam');

  // 8) app desktop antigo (lc-audio sem o pedido 'fse'): sem dados, sem aviso
  await A.evaluate(() => { window.__fseSt = { available: false }; });
  await sleep(4000);
  s = await fse(A);
  ok(s.fse?.available === false && !s.banner, 'app desktop antigo: sem dados de tela cheia, nenhum aviso', s.fse);
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(500);
  ok(await A.evaluate(() => window.__lc.voice.fse === null), 'parar a transmissão desliga a vigia');
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
