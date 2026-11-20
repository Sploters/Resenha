// Reconexão do gateway (public/gateway.js): o socket antigo, ao terminar de fechar, não pode abrir mais um quando outro
// já assumiu. Cenário: a conexão cai (fechando) e a rede volta ('online') antes de o fechamento terminar: o 'online' abre
// a nova e o onclose da antiga agendava outra. Ficavam 2 abertas e cada evento era tratado 2 vezes.
// Uso: node scripts/ws-dup-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('wsdup', 3409, 41375);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const r = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const p = await browser.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    // guarda os sockets do gateway que a página abre
    const W = window.WebSocket; window.__socks = [];
    window.WebSocket = class extends W { constructor(...a) { super(...a); if (String(a[0]).includes('/gateway')) window.__socks.push(this); } };
  }, r.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 }); await sleep(1000);
  const before = await p.evaluate(() => window.__socks.filter(s => s.readyState === 1).length);
  ok(before === 1, 'abriu com um socket do gateway', before);
  // a conexão cai e a rede volta enquanto o socket antigo ainda está fechando
  await p.evaluate(() => { const s = window.__socks.filter(x => x.readyState === 1).pop(); s.close(); dispatchEvent(new Event('online')); });
  await sleep(14000); // a tentativa que o onclose antigo agendava (até ~2-10 s com sorteio)
  const after = await p.evaluate(() => window.__socks.map(s => s.readyState));
  ok(after.filter(x => x === 1).length === 1, 'depois da queda e da rede voltar: um socket aberto só', after);
} catch (e) { console.log('  FAIL', e.message); fails++; }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
