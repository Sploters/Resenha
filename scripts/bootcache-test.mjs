// Abertura sem esperar a conexão (public/bootcache.js + gateway.js bootFromSnapshot + state.js prefetch), com o WebSocket
// atrasado de propósito (3 s para abrir, como um túnel lento):
// - 1ª abertura (nada guardado): os GET da abertura (/me/settings, /bora, /intents, /call-invites) saem ANTES de a conexão
//   abrir, e nenhum é pedido duas vezes;
// - 2ª abertura: a tela (barra de servidores com o servidor, canal aberto) aparece antes de a conexão abrir, com a cópia
//   guardada; entrar na sala de voz antes da conexão espera por ela e entra; o READY de verdade substitui a cópia (o
//   servidor criado com a página fechada aparece);
// - a cópia é desta conta: outra conta no mesmo navegador não vê nada dela; sair da conta apaga a cópia.
// Uso: node scripts/bootcache-test.mjs   (PORT=3441)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };
const PORT = +(process.env.PORT || 3441), RTC = process.env.RTC_PORT || '41441', DIR = path.resolve('.testdata-bootcache'), BASE = `http://localhost:${PORT}`;
fs.rmSync(DIR, { recursive: true, force: true });
let log = '';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC_PORT: RTC, RTC_IPS: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
process.on('exit', () => { try { srv.kill(); } catch { } });
if (!await until(async () => fetch(BASE + '/api/server-info').then(() => true, () => false), 30000)) { console.log('servidor não subiu'); process.exit(1); }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await api('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
// WebSocket que só abre depois de WS_DELAY ms (o túnel lento); window.__wsOpen = hora em que abriu de verdade
const WS_DELAY = 3000;
const slowWs = (tok, delay) => {
  if (!location.protocol.startsWith('http')) return; // about:blank
  localStorage.setItem('lc_token', tok);
  const W = window.WebSocket; window.__wsOpen = 0; window.__api = [];
  const F = window.fetch; window.fetch = function (u, ...x) { const s = String(u?.url || u); if (s.includes('/api/')) window.__api.push({ u: s.replace(location.origin, ''), at: performance.now() }); return F.call(this, u, ...x); };
  window.WebSocket = function (url, p) {
    const fake = new EventTarget(); let real = null;
    Object.assign(fake, { readyState: 0, send: (m) => real?.send(m), close: (c, r) => { if (real) real.close(c, r); else { fake.readyState = 3; setTimeout(() => fake.onclose?.({ code: c || 1000 })); } } });
    setTimeout(() => {
      if (fake.readyState === 3) return;
      real = new W(url, p);
      real.onopen = (e) => { fake.readyState = 1; window.__wsOpen = performance.now(); fake.onopen?.(e); };
      real.onmessage = (e) => fake.onmessage?.(e);
      real.onclose = (e) => { fake.readyState = 3; fake.onclose?.(e); };
      real.onerror = (e) => fake.onerror?.(e);
    }, delay);
    return fake;
  };
  Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
};
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'Servidor da Alice' });
  const vc = g.channels?.find(c => c.type === 2) || await api(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Voz', type: 2 });
  const p = await browser.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument(slowWs, a.tok, WS_DELAY);

  // 1ª abertura: nada guardado. Os GET saem antes da conexão
  await p.goto(BASE + '/#/' + g.id); await p.waitForFunction(() => window.__lc?.S?.me, { timeout: 20000 });
  await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 });
  const r1 = await p.evaluate(() => ({ open: window.__wsOpen, api: window.__api }));
  const early = ['/api/me/settings', '/api/bora', '/api/intents', '/api/call-invites'].map(u => [u, r1.api.filter(x => x.u === u)]);
  ok(early.every(([, l]) => l.length && l[0].at < r1.open), 'sem cópia: os GET da abertura saem antes de a conexão abrir', early.map(([u, l]) => [u, Math.round(l[0]?.at || -1), Math.round(r1.open)]));
  ok(early.every(([, l]) => l.length === 1), 'e nenhum é pedido duas vezes', early.map(([u, l]) => [u, l.length]));
  await sleep(3500); // a cópia é guardada quando o navegador está de folga

  // servidor novo com a página fechada: a cópia não tem, o READY de verdade tem
  const g2 = await api(a.tok, 'POST', '/guilds', { name: 'Servidor Novo' });
  // 2ª abertura: tela antes da conexão
  await p.goto('about:blank'); await p.goto(BASE + '/#/' + g.id);
  const shown = await until(() => p.evaluate((gid) => !!document.querySelector(`#rail [data-gid="${gid}"]`) && !document.getElementById('boot') && !document.querySelector('#app.hidden'), g.id), 2500);
  const r2 = await p.evaluate(() => ({ open: window.__wsOpen, now: performance.now() }));
  ok(shown && !r2.open, 'com a cópia: a tela aparece antes de a conexão abrir', { aberta: Math.round(r2.open), agora: Math.round(r2.now) });
  ok(await p.evaluate((gid) => window.__lc.S.view.gid === gid, g.id), 'e já no servidor aberto');
  // entrar na sala antes da conexão: espera e entra
  await p.evaluate((cid) => window.__lc.joinVoice(cid), vc.id);
  ok(await p.evaluate(() => !window.__lc.voice?.channelId), 'entrar na sala antes da conexão: espera por ela');
  ok(await until(() => p.evaluate((cid) => window.__lc.voice?.channelId === cid, vc.id), 15000), 'e entra quando ela abre');
  ok(await until(() => p.evaluate((gid) => !!document.querySelector(`#rail [data-gid="${gid}"]`), g2.id), 10000), 'o READY de verdade substitui a cópia (servidor criado com a página fechada aparece)');
  await p.evaluate(() => window.__lc.voice.leave());
  ok(!errs.length, 'sem erros na página', errs.slice(0, 3));

  // outra conta no mesmo navegador: não usa a cópia da Alice
  const p2 = await browser.newPage(); await p2.evaluateOnNewDocument(slowWs, b.tok, WS_DELAY);
  await p2.goto(BASE + '/');
  await sleep(1500);
  ok(await p2.evaluate((gid) => !window.__lc?.S?.me && !document.querySelector(`#rail [data-gid="${gid}"]`), g.id), 'outra conta no mesmo navegador não vê a cópia da outra');
  await p2.waitForFunction(() => window.__lc?.S?.me, { timeout: 20000 });
  ok(await p2.evaluate((id) => window.__lc.S.me.id === id, b.id), 'e abre com a própria conta quando a conexão responde');
  await sleep(3500); await p2.close();

  // sair da conta apaga a cópia
  await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => { }), p.evaluate(async () => { const { logout } = await window.__lc.import('gateway.js'); logout(); })]);
  const left = await p.evaluate(() => new Promise((res) => { const q = indexedDB.open('resenha-boot', 1); q.onupgradeneeded = () => q.result.createObjectStore('snap'); q.onsuccess = () => { const t = q.result.transaction('snap').objectStore('snap').get('ready'); t.onsuccess = () => res(t.result || null); t.onerror = () => res('erro'); }; }));
  ok(left === null, 'sair da conta apaga a cópia guardada', left && typeof left);
} catch (e) { ok(false, 'erro: ' + e.message); }
await browser.close(); srv.kill();
if (fails) console.log('\n--- log do servidor ---\n' + log.slice(-2500));
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
