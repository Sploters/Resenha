// Processador no limite em chamada com a redução de ruído por IA: o app sugere uma mais leve (public/lite.js
// startPressureWatch). Simula a pressão de CPU (o PressureObserver real fica ligado, mas a máquina de teste não chega ao
// limite) e confere: sugere só depois de 15 s seguidos (aqui 600 ms), GTCRN → RNNoise → Padrão, "Trocar" troca o filtro e
// refaz o microfone sem sair da sala (a voz segue saindo), "Agora não" não pergunta de novo pelo mesmo filtro, pressão que
// cai antes do tempo, fora de chamada ou com o filtro leve: nada.
// Uso: node scripts/noise-suggest-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const BASE = await ownServer('noisesug', 3339, 41300);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' });
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ra.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  const vc = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await p.evaluate(async () => { const L = await window.__lc.import('lite.js'); window.L = L; L._pressure.hotMs = 600; });
  const st = await p.evaluate(() => ({ obs: !!window.L._pressure.obs, voice: !!window.L._pressure.getVoice }));
  ok(st.obs && st.voice, 'PressureObserver real ligado na abertura do app', st);
  await p.evaluate(() => window.L._pressure.obs?.disconnect()); // daqui em diante a pressão é simulada (a real oscilaria nominal/fair)
  const sug = () => p.evaluate(() => { const t = document.querySelector('#toast.lite-sug'); return t ? t.innerText : null; });
  const press = async (s, wait = 900) => { await p.evaluate((s) => window.L.pressureChanged(s), s); await sleep(wait); };
  // fora da chamada: nada
  await p.evaluate(() => { window.__lc.S.prefs.noiseMode = 'gtcrn'; });
  await press('critical'); ok(!(await sug()), 'fora de chamada: não sugere'); await press('nominal', 100);
  await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await sleep(1500);
  // pressão que cai antes do tempo
  await press('serious', 300); await press('fair', 700); ok(!(await sug()), 'pressão que cai antes de 15 s: não sugere');
  await press('fair', 0); await press('nominal', 0);
  // GTCRN no limite: sugere RNNoise
  await press('serious');
  if (process.env.DEBUG) console.log(await p.evaluate(() => { const P = window.L._pressure, v = P.getVoice(); return { st: P.state, since: Date.now() - P.since, active: v?.active, mode: window.__lc.S.prefs.noiseMode, offered: [...P.offered], hidden: document.hidden, pending: P.pending, toast: document.getElementById('toast')?.outerHTML?.slice(0, 200) }; }));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  let t = await sug(); ok(t && /Máxima/.test(t) && /Forte/.test(t), 'GTCRN com o processador no limite: sugere a Forte (RNNoise)', t);
  await p.evaluate(() => { window.__g0 = window.__lc.voice.micGraph; });
  await p.evaluate(() => [...document.querySelectorAll('#toast.lite-sug button')].find(b => /Trocar/.test(b.textContent)).click());
  await sleep(2500);
  const after = await p.evaluate(async () => { const v = window.__lc.voice, mp = v.sfu?.producers.mic; let a = 0; const snap = async () => { let b = 0; (await mp.rtpSender.getStats()).forEach(x => { if (x.type === 'outbound-rtp') b += x.bytesSent; }); return b; }; a = await snap(); await new Promise(r => setTimeout(r, 1500)); return { mode: window.__lc.S.prefs.noiseMode, active: v.active, kbps: Math.round(((await snap()) - a) * 8 / 1500), err: v.micGraph?.error || null }; });
  ok(after.mode === 'rnnoise' && after.active && after.kbps > 10 && !after.err, '"Trocar": RNNoise, ainda na sala e a voz saindo (kbps)', after);
  ok(await p.evaluate(() => !!window.__lc.voice.micGraph && window.__lc.voice.micGraph !== window.__g0), 'o microfone foi refeito com o filtro novo');
  await press('nominal', 100);
  // RNNoise no limite: sugere o Padrão; "Agora não"
  await press('critical'); t = await sug(); ok(t && /Forte/.test(t) && /Leve/.test(t), 'RNNoise no limite: sugere a Leve (navegador)', t);
  await p.evaluate(() => [...document.querySelectorAll('#toast.lite-sug button')].find(b => /Agora não/.test(b.textContent)).click()); await sleep(400);
  ok(!(await sug()) && await p.evaluate(() => window.__lc.S.prefs.noiseMode) === 'rnnoise', '"Agora não": fecha e o filtro fica');
  await press('nominal', 100); await press('serious'); ok(!(await sug()), 'mesmo filtro no limite de novo: não pergunta outra vez nesta sessão');
  await press('nominal', 100);
  // filtro leve: nada a sugerir
  await p.evaluate(() => { window.__lc.S.prefs.noiseMode = 'standard'; window.L._pressure.offered.clear(); });
  await press('critical'); ok(!(await sug()), 'filtro Leve (navegador): não sugere');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
