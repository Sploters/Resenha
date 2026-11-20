// Preferências com o armazenamento do navegador cheio ou bloqueado (public/state.js savePrefs): a mudança ainda vai para a
// conta (PUT /me/settings) e quem chamou não quebra. Antes o localStorage.setItem lançava a exceção antes de agendar o envio.
// Uso: node scripts/prefs-storage-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('prefsstorage', 3411, 41385);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const r = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const p = await browser.newPage();
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 }); await sleep(1500);
  // armazenamento cheio a partir daqui: gravar as preferências lança QuotaExceededError
  const res = await p.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'lc_prefs') throw new DOMException('cheio', 'QuotaExceededError'); return orig.call(this, k, v); };
    window.__lc.S.prefs.testeCheio = 'sim';
    try { window.__lc.savePrefs(); return 'ok'; } catch (e) { return 'lançou: ' + e.name; }
  });
  ok(res === 'ok', 'savePrefs com o armazenamento cheio não lança', res);
  await sleep(2500); // o envio à conta sai ~1,2 s depois
  const s = await api(r.token, 'GET', '/me/settings');
  ok(s?.settings?.testeCheio === 'sim', 'a mudança chegou à conta mesmo sem gravar no navegador', s?.settings?.testeCheio);
} catch (e) { console.log('  FAIL', e.message); fails++; }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
