// Vários workers do mediasoup (server/sfu.js, SFU_WORKERS): duas salas de voz ao mesmo tempo vão para workers diferentes,
// e a voz chega a quem está em cada sala (cada worker escuta na própria porta).
// Uso: node scripts/sfu-workers-test.mjs (BROWSER=<caminho do Chrome>)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3298, BASE = `http://localhost:${PORT}`, DATA = './.testdata-sfuworkers';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41100', RTC_EXTRA_PORT: '41111', RTC_IPS: '127.0.0.1', SFU_WORKERS: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'senha123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const join = (p, cid) => p.evaluate(async (cid) => { await window.__lc.voice.join(cid); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, cid);
// bytes de áudio que chegaram por cada transporte (recv) desde a entrada
const audioIn = (p) => p.evaluate(async () => { let n = 0; const t = window.__lc.voice.sfu?.recv; if (t) (await t.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived || 0; }); return n; });
try {
  ok(/SFU: 2 workers \(portas 41100, 41111\)/.test(out), 'servidor abre 2 workers, cada um na sua porta', out.split('\n').filter(l => /SFU/.test(l)));
  const [a, b, c, d] = await Promise.all(['alice', 'bruno', 'carla', 'davi'].map(reg));
  const g = await api(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c, d]) await api(u.tok, 'POST', '/invites/' + inv);
  const v2 = await api(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Sala 2', type: 2 });
  const [A, B, C, D] = await Promise.all([a, b, c, d].map(u => person(u.tok)));
  const v1 = await A.evaluate((gid, v2) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2 && x.id !== v2).id, g.id, v2.id);
  await join(A, v1); await join(B, v1); await join(C, v2.id); await join(D, v2.id);
  await sleep(4000);
  const load = await api(a.tok, 'GET', '/sfu/load');
  const per = load.current?.per_worker || [];
  ok(load.workers === 2 && per.length === 2, 'carga mostra os 2 workers', { workers: load.workers, per });
  ok(per.every(w => w.rooms === 1 && w.peers === 2), 'cada sala ficou num worker diferente (1 sala, 2 pessoas em cada)', per.map(w => [w.port, w.rooms, w.peers]));
  const got = await Promise.all([A, B, C, D].map(audioIn));
  ok(got.every(n => n > 2000), 'a voz chega a todos, nas duas salas', got);
  // sala nova depois que uma esvaziou: vai para o worker livre
  for (const p of [C, D]) await p.evaluate(() => window.__lc.voice.leave({ silent: true }));
  await sleep(800);
  await join(C, v2.id); await sleep(1500);
  const per2 = (await api(a.tok, 'GET', '/sfu/load')).current?.per_worker || [];
  ok(per2.some(w => w.port === 41111 && w.rooms === 1 && w.peers === 1), 'sala reaberta vai para o worker com menos gente', per2.map(w => [w.port, w.rooms, w.peers]));
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); await sleep(300);
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
