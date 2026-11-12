// Servidor reiniciando no meio da call: duas pessoas na sala de voz (microfone falso do Chromium), uma mutada; o servidor
// cai e volta 3 s depois. Confere que as duas voltam sozinhas para a mesma sala, que a voz volta a chegar, que o mudo
// continua e que ninguém fica duplicado ("fantasma") na lista da sala.
// Uso: node scripts/call-restart-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3328, BASE = `http://localhost:${PORT}`, DATA = './.testdata-callrestart';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
let srv;
const up = async () => {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41210', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(50); } }
  throw new Error('servidor não subiu');
};
const down = () => new Promise(r => { srv.once('exit', r); srv.kill('SIGTERM'); });
process.on('exit', () => { try { srv?.kill('SIGKILL'); } catch { } });
await up();
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
// voz que chega nos próximos `ms` (bytes de áudio recebidos das outras pessoas)
const audioIn = (p, ms = 2000) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu; if (!s) return -1;
  const recv = [...s.consumers.values()].filter(e => e.source === 'mic').map(e => e.c.rtpReceiver);
  const snap = async () => { let b = 0; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') b += x.bytesReceived || 0; }); return b; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); return (await snap()) - a;
}, ms);
const state = (p, vc) => p.evaluate((vc) => {
  const { voice, S } = window.__lc;
  return { canal: voice.channelId === vc, sfu: !!voice.sfu?.ready, mudo: voice.muted, na_sala: [...S.voice.values()].filter(v => v.channel_id === vc).map(v => v.user_id).sort() };
}, vc);
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'senha123' }), rb = await api('', 'POST', '/register', { username: 'bruno', password: 'senha123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }); await api(rb.token, 'POST', '/invites/' + (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code);
  const [A, B] = [await person(ra.token), await person(rb.token)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await sleep(2500);
  const before = await audioIn(B);
  ok(before > 2000, 'antes: o bruno ouve a alice (bytes de voz em 2 s)', before);
  await B.evaluate(() => { const v = window.__lc.voice; if (!v.muted) v.toggleMute(); });
  ok((await state(B, vc)).mudo === true, 'bruno mutado antes de reiniciar');
  const idA = await A.evaluate(() => window.__lc.S.me.id), idB = await B.evaluate(() => window.__lc.S.me.id);
  // reinicia
  await down(); await sleep(3000); const t0 = performance.now(); await up();
  const back = await Promise.all([A, B].map(p => p.waitForFunction((vc) => window.__lc.voice.channelId === vc && window.__lc.voice.sfu?.ready && !document.querySelector('#reconnect'), { timeout: 40000, polling: 100 }, vc).then(() => Math.round(performance.now() - t0)).catch(() => null)));
  ok(back.every(x => x != null), 'as duas voltaram para a sala sozinhas (ms depois que o servidor subiu)', back);
  await sleep(2500);
  const sa = await state(A, vc), sb = await state(B, vc);
  ok(sb.mudo === true, 'bruno continua mutado depois de voltar', sb.mudo);
  ok(JSON.stringify(sa.na_sala) === JSON.stringify([idA, idB].sort()) && JSON.stringify(sb.na_sala) === JSON.stringify(sa.na_sala), 'a sala mostra as duas pessoas, uma vez cada', { alice: sa.na_sala.length, bruno: sb.na_sala.length });
  const after = await audioIn(B);
  ok(after > 2000, 'depois: o bruno volta a ouvir a alice (bytes de voz em 2 s)', after);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); try { srv?.kill('SIGKILL'); } catch { } console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
