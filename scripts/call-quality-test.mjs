// Qualidade técnica da chamada de ponta a ponta (public/callqual.js): duas pessoas numa sala de voz de verdade (SFU,
// microfone falso do Chromium), passando por um relé UDP que perde pacotes de propósito. Uma chamada com a rede limpa tem
// de sair "good"; uma com 12% de perda chegando tem de sair média ou ruim, com a perda na faixa alta e a causa certa.
// A perda saindo tem de ser a de quem envia: perda na descida de um ouvinte não pode aparecer como perda saindo de quem
// fala (o RTCP do mediasoup traz a pior perda entre quem ouve), e perda na subida de quem fala tem de aparecer.
// Uso: node scripts/call-quality-test.mjs     (SECS=24 por chamada)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
const PORT = 3331, BASE = `http://localhost:${PORT}`, DATA = './.testdata-callq', RTC = 41240, SECS = +(process.env.SECS || 24);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- relé: 127.0.0.1:RTC (o que o navegador vê) <-> 127.0.0.2:RTC (o SFU) ----
const net = { loss: 0, delay: 0, jitter: 0, burst: 0, only: null }; // only: 'down' = só do SFU para os navegadores, 'up' = só dos navegadores para o SFU // burst: chance de começar uma rajada de 5 perdas seguidas
const front = dgram.createSocket('udp4'), back = new Map(); let lost = 0, passed = 0;
const drop = (st) => { if (st.burst > 0) { st.burst--; return true; } if (net.burst && Math.random() < net.burst) { st.burst = 4; return true; } return Math.random() < net.loss; };
// só perde mídia (RTP/RTCP: 1º byte 128–191); STUN e DTLS passam, senão a conexão nem abre
const isRtp = (m) => m[0] >= 128 && m[0] <= 191;
const later = (fn) => { const d = net.delay + (net.jitter ? (Math.random() * 2 - 1) * net.jitter : 0); if (d <= 0) fn(); else setTimeout(fn, d); };
front.on('message', (msg, from) => {
  const k = from.address + ':' + from.port; let b = back.get(k);
  if (!b) {
    b = { s: dgram.createSocket('udp4'), up: { burst: 0 }, down: { burst: 0 } }; back.set(k, b);
    b.s.on('message', (m) => { if (isRtp(m) && net.only !== 'up' && drop(b.down)) { lost++; return; } passed++; later(() => front.send(m, from.port, from.address)); });
  }
  if (isRtp(msg) && net.only !== 'down' && drop(b.up)) { lost++; return; } passed++;
  later(() => b.s.send(msg, RTC, '127.0.0.2'));
});
await new Promise(r => front.bind(RTC, '127.0.0.1', r));

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC), RTC_ANNOUNCED_IP: '127.0.0.1', RTC_LISTEN_IP: '127.0.0.2' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
// uma chamada de SECS segundos com a rede `c`; devolve o resumo de qualidade que voice.js mandou no 'call-ended' e o que
// foi para a fila da telemetria
async function call(c) {
  Object.assign(net, { loss: 0, delay: 0, jitter: 0, burst: 0, only: null }, c);
  for (const p of [A, B]) await p.evaluate(async (vc) => {
    window.__q = undefined; document.addEventListener('call-ended', (e) => { window.__q = e.detail.quality; }, { once: true });
    await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100));
  }, vc);
  await B.evaluate(() => { if (!window.__lc.voice.muted) window.__lc.voice.toggleMute(); });
  await sleep(SECS * 1000);
  await B.evaluate(() => window.__lc.voice.leave()); await A.evaluate(() => window.__lc.voice.leave());
  Object.assign(net, { loss: 0, delay: 0, jitter: 0, burst: 0, only: null });
  const read = (p) => p.evaluate(async () => { const u = performance.getEntriesByType('resource').map(e => e.name).find(x => /\/ux\.js(\?|$)/.test(x)); const m = await import(u); return { q: window.__q, fila: m.uxPending().filter(x => /^call_/.test(x.e)) }; });
  return { ...(await read(B)), fala: (await read(A)).q }; // B ouve (mutado); A fala
}
let A, B, vc;
try {
  const [ra, rb] = await Promise.all(['alice', 'bruno'].map(n => api('', 'POST', '/register', { username: n, password: 'senha123' })));
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code;
  await api(rb.token, 'POST', '/invites/' + inv);
  [A, B] = [await person(ra.token), await person(rb.token)];
  vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  const boa = await call({});
  console.log('  rede limpa:', JSON.stringify(boa.q));
  ok(boa.q?.grade === 'good' && boa.q.net.includes('mode:sfu') && boa.q.net.includes('proto:udp') && boa.q.net.includes('loss_in:0'), 'chamada real com a rede limpa: nota boa, SFU por UDP, perda na faixa de baixo', boa.q);
  ok(boa.fila.some(x => x.e === 'call_quality' && x.d === 'good') && boa.fila.some(x => x.e === 'call_net' && x.d === 'mode:sfu'), 'o resumo vai para a fila da telemetria (call_quality e call_net)', boa.fila);
  const ruim = await call({ loss: 0.12, only: 'down' });
  console.log('  12% de perda chegando:', JSON.stringify(ruim.q));
  ok(ruim.q && ruim.q.grade !== 'good' && /^loss_in:[2-4]$/.test(ruim.q.net.find(d => d.startsWith('loss_in:')) || '') && ['loss_in', 'conceal', 'jitter'].includes(ruim.q.cause), 'chamada real com 12% de perda chegando: nota média ou ruim, perda na faixa alta e a causa certa', ruim.q);
  ok(ruim.fila.some(x => x.e === 'call_qcause'), 'a causa vai para a fila (call_qcause)', ruim.fila);
  const fx = (q, k) => q?.net.find(d => d.startsWith(k + ':'));
  // a perda de um ouvinte não pode virar "perda saindo" de quem fala (o RTCP do mediasoup traz a pior perda entre quem ouve)
  ok(fx(ruim.fala, 'loss_out') === 'loss_out:0' && (fx(ruim.q, 'loss_out') ?? 'loss_out:0') === 'loss_out:0', 'perda só na descida: a "perda saindo" de quem fala e de quem ouve fica na faixa de baixo', { fala: ruim.fala, ouve: ruim.q?.net });
  const sobe = await call({ loss: 0.12, only: 'up' });
  console.log('  12% de perda só na subida — quem fala:', JSON.stringify(sobe.fala), ' quem ouve:', JSON.stringify(sobe.q));
  ok(/^loss_out:[3-4]$/.test(fx(sobe.fala, 'loss_out') || '') && /^loss_in:[2-4]$/.test(fx(sobe.q, 'loss_in') || ''), 'perda só na subida: aparece como "perda saindo" de quem fala (e chegando para quem ouve)', { fala: sobe.fala, ouve: sobe.q });
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); try { srv.kill('SIGKILL'); } catch { } front.close(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
