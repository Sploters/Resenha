// Supressão de ruído em Configurações → Voz e vídeo (public/settings.js): "Analisar meu ambiente" mede o ruído de fundo
// do microfone cru e recomenda um filtro; "Usar …" aplica. Também confere o teste de microfone (sem aviso de "sem entrada"
// com o microfone falso do Chromium, que tem som) e o menu de ruído com os mesmos nomes dos cartões.
// Uso: node scripts/noise-env-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const BASE = await ownServer('noiseenv', 3341, 41500);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ra.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  await p.evaluate(() => { window.__lc.S.prefs.noiseMode = 'gtcrn'; window.__lc.openSettings('voice'); }); await sleep(800);
  const click = (re) => p.evaluate((src) => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(src).test(x.textContent)); b?.click(); return !!b; }, re.source);
  ok(await click(/^Analisar meu ambiente$/), 'botão "Analisar meu ambiente" na supressão de ruído');
  await sleep(1500); ok(await p.evaluate(() => [...document.querySelectorAll('button')].some(b => /Fique em silêncio/.test(b.textContent))), 'contagem "Fique em silêncio…" enquanto mede');
  await sleep(4000);
  const res = await p.evaluate(() => [...document.querySelectorAll('.hintline.keep')].map(n => n.innerText).find(t => /Ruído de fundo/.test(t)) || null);
  ok(res && /-?\d+ dB/.test(res), 'mostra o ruído de fundo medido e a explicação', res);
  const used = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Usar /.test(x.textContent)); const want = b?.textContent; b?.click(); return want; });
  if (used) { await sleep(300); ok(await p.evaluate(() => window.__lc.S.prefs.noiseMode) !== 'gtcrn', `"${used}" troca o filtro`, await p.evaluate(() => window.__lc.S.prefs.noiseMode)); }
  else ok(/já está usando/.test(res || ''), 'recomendação igual ao atual: avisa');
  ok(await p.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Analisar meu ambiente' && !b.disabled)), 'botão volta ao normal e o microfone é fechado');
  // teste de microfone: microfone falso tem som -> sem o aviso de "nenhuma entrada"
  ok(await click(/^Testar microfone$/), 'teste de microfone começa'); await sleep(5500);
  const warn = await p.evaluate(() => [...document.querySelectorAll('.hintline.keep')].some(n => /não está detectando/.test(n.innerText) && n.offsetParent));
  ok(!warn, 'com som chegando: sem o aviso de "não está detectando nenhuma entrada"');
  await click(/^Parar teste$/);
  // "Só a minha voz" (trava na voz) desligado por padrão (cortava a voz de quem fala perto do microfone), e o ganho automático desligado
  const sw = (lbl) => p.evaluate((l) => { const b = [...document.querySelectorAll('button.tog')].find(x => x.querySelector('.ch-lbl')?.textContent.trim() === l); return b ? { on: b.getAttribute('aria-checked') === 'true', vis: !!b.offsetParent } : null; }, lbl);
  const lock = await sw('Só a minha voz');
  ok(lock && !lock.on && lock.vis, '"Só a minha voz" aparece desligado com a redução por IA', lock);
  await p.evaluate(() => [...document.querySelectorAll('button.tog')].find(x => x.querySelector('.ch-lbl')?.textContent.trim() === 'Só a minha voz').click());
  ok(await p.evaluate(() => window.__lc.S.prefs.voiceLock === true), 'ligar grava voiceLock = true');
  const agc = await sw('Ganho automático');
  ok(agc && !agc.on && (await p.evaluate(() => window.__lc.S.prefs.agc)) === false, 'ganho automático desligado por padrão', agc);
  const menuLbl = await p.evaluate(async () => { const m = await window.__lc.import('ui.js'); return Object.values(m.NOISE_INFO).map(x => x[0]); });
  ok(menuLbl.join() === 'Sem filtro,Leve,Forte,Máxima', 'nomes únicos dos filtros (cartões e menus)', menuLbl);
  // quem já usava o app com o ganho automático ligado: desliga uma vez (agcV = 2) e depois respeita a escolha
  const q = await browser.newPage();
  await q.evaluateOnNewDocument((t) => { localStorage.lc_token = t; if (!sessionStorage.once) { sessionStorage.once = 1; localStorage.lc_prefs = JSON.stringify({ agc: true }); localStorage.removeItem('lc_prefs_base'); } }, ra.token);
  await q.goto(BASE); await q.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 }); await sleep(500);
  const mig = await q.evaluate(() => ({ agc: window.__lc.S.prefs.agc, v: window.__lc.S.prefs.agcV }));
  ok(mig.agc === false && mig.v === 2, 'ganho automático ligado antes: desligado uma vez na atualização', mig);
  await q.evaluate(() => { window.__lc.S.prefs.agc = true; window.__lc.savePrefs?.(); localStorage.lc_prefs = JSON.stringify(window.__lc.S.prefs); });
  await q.reload(); await q.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 }); await sleep(500);
  ok(await q.evaluate(() => window.__lc.S.prefs.agc) === true, 'religado depois: continua ligado (a migração não repete)');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
