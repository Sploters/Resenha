// Salas de voz para gamers (server/voicerooms.js, public/voicerooms.js): limite de pessoas, senha, orador prioritário,
// pedir a vez e sussurro. Parte 1 pelo gateway (regras do servidor); parte 2 com 3 navegadores: o sussurro da alice chega
// ao bruno e NÃO chega à carla (kbps recebidos), e com "Falar com prioridade" as outras vozes abaixam no app do bruno.
// Uso: node scripts/voice-rooms-test.mjs
import WebSocket from 'ws';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const BASE = process.env.BASE || await ownServer('voicerooms', 3420, 41700);
let fails = 0;
const ok = (c, msg, extra) => { console.log((c ? '  ok   ' : '  FAIL ') + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
function gateway(tok) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), q = [], waiters = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); const i = waiters.findIndex(w => w.t === m.t && (!w.f || w.f(m.d))); if (i >= 0) waiters.splice(i, 1)[0].res(m.d); else q.push(m); });
  return {
    ws, send: (t, d) => ws.send(JSON.stringify({ t, d })), flush: () => { q.length = 0; },
    // o primeiro de vários tipos (o que não chegou não fica esperando e não "come" uma mensagem depois)
    first: (pairs, ms = 4000) => new Promise((res) => {
      const i = q.findIndex(m => pairs.some(([t, f]) => m.t === t && f(m.d))); if (i >= 0) { const m = q.splice(i, 1)[0]; return res(m); }
      const ws2 = pairs.map(([t, f]) => ({ t, f, res: (d) => done({ t, d }) }));
      const done = (m) => { for (const w of ws2) { const k = waiters.indexOf(w); if (k >= 0) waiters.splice(k, 1); } clearTimeout(tm); res(m); };
      const tm = setTimeout(() => done({ t: 'timeout', d: { code: 'timeout' } }), ms);
      waiters.push(...ws2);
    }),
    wait: (t, f, ms = 4000) => new Promise((res, rej) => { const i = q.findIndex(m => m.t === t && (!f || f(m.d))); if (i >= 0) return res(q.splice(i, 1)[0].d); const w = { t, f, res }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('timeout ' + t)); } }, ms); }),
  };
}
const sfx = Math.random().toString(36).slice(2, 7);
async function person(name) {
  const tok = (await call('', 'POST', '/register', { username: name + sfx, password: 'Teste.senha-123' })).data.token;
  const gw = gateway(tok), ready = await gw.wait('READY');
  return { tok, gw, id: ready.user.id };
}
const P = { PRIORITY: 2048, VOICE_MOD: 512 };

// ---------- parte 1: regras do servidor ----------
const own = await person('dono'), mod = await person('mod'), a = await person('ana'), b = await person('bia'), c = await person('caio');
const g = (await call(own.tok, 'POST', '/guilds', { name: 'Raid' })).data;
const gc = await own.gw.wait('GUILD_CREATE');
const inv = (await call(own.tok, 'POST', `/guilds/${g.id}/invites`)).data;
for (const u of [mod, a, b, c]) { await call(u.tok, 'POST', `/invites/${inv.code}`); await u.gw.wait('GUILD_CREATE'); }
const room = gc.channels.find(x => x.type === 2);
const rMod = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', perms: P.VOICE_MOD })).data.id;
const rLead = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Líder', perms: P.PRIORITY })).data.id;
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mod.id}`, { roles: [rMod] });
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${a.id}`, { roles: [rLead] });

const tryJoin = async (u, cid, extra = {}) => {
  u.gw.flush();
  const p = u.gw.first([['VOICE_STATE', d => d.user_id === u.id && d.channel_id === cid], ['VOICE_DENIED', d => d.channel_id === cid]]);
  u.gw.send('VOICE_JOIN', { channel_id: cid, ...extra });
  const m = await p; return { ok: m.t === 'VOICE_STATE', d: m.d };
};
const leave = async (u) => { u.gw.flush(); const w = u.gw.wait('VOICE_STATE', d => d.user_id === u.id && !d.channel_id); u.gw.send('VOICE_LEAVE', {}); await w.catch(() => null); };

// configurar: só quem gerencia canais; limite fora da faixa é recusado; o hash nunca vai no canal
ok((await call(a.tok, 'PATCH', `/channels/${room.id}`, { user_limit: 2 })).status === 403, 'membro comum não muda o limite');
ok((await call(own.tok, 'PATCH', `/channels/${room.id}`, { user_limit: 500 })).status === 400, 'limite acima de 99 é recusado');
const upd = a.gw.wait('CHANNEL_UPDATE', d => d.id === room.id && d.user_limit === 2);
ok((await call(own.tok, 'PATCH', `/channels/${room.id}`, { user_limit: 2 })).status === 200, 'dono põe limite de 2');
const chu = await upd.catch(() => null);
ok(chu?.user_limit === 2 && chu?.voice_locked === 0, 'membros recebem o canal com user_limit', chu && { user_limit: chu.user_limit, voice_locked: chu.voice_locked });

// limite
ok((await tryJoin(a, room.id)).ok, 'ana entra (1/2)');
ok((await tryJoin(b, room.id)).ok, 'bia entra (2/2)');
let r = await tryJoin(c, room.id);
ok(!r.ok && r.d.code === 'full', 'caio não entra: sala cheia', r.d);
ok((await tryJoin(mod, room.id)).ok, 'quem modera voz entra mesmo cheia');
await leave(mod); await leave(b);
ok((await tryJoin(c, room.id)).ok, 'com vaga, caio entra');
await leave(a); await leave(c);
await call(own.tok, 'PATCH', `/channels/${room.id}`, { user_limit: 0 });

// senha
const locked = a.gw.wait('CHANNEL_UPDATE', d => d.id === room.id && d.voice_locked === 1);
ok((await call(own.tok, 'PATCH', `/channels/${room.id}`, { password: 'x' })).status === 400, 'senha curta demais é recusada');
await call(own.tok, 'PATCH', `/channels/${room.id}`, { password: 'raid123' });
const lk = await locked.catch(() => null);
ok(!!lk && !JSON.stringify(lk).includes('raid123') && lk.hash === undefined && lk.salt === undefined, 'canal trancado chega sem a senha nem o hash');
r = await tryJoin(a, room.id); ok(!r.ok && r.d.code === 'need_password', 'sem senha: pede a senha', r.d);
r = await tryJoin(a, room.id, { password: 'errada' }); ok(!r.ok && r.d.code === 'wrong_password', 'senha errada é recusada', r.d);
ok((await tryJoin(a, room.id, { password: 'raid123' })).ok, 'senha certa: entra');
await leave(a);
ok((await tryJoin(a, room.id)).ok, 'quem já acertou volta sem digitar de novo');
await leave(a);
ok((await tryJoin(mod, room.id)).ok, 'quem modera voz entra sem senha');
await leave(mod);
await call(own.tok, 'PATCH', `/channels/${room.id}`, { password: 'nova456' });
r = await tryJoin(a, room.id); ok(!r.ok && r.d.code === 'need_password', 'senha trocada: pede de novo', r.d);
await call(own.tok, 'PATCH', `/channels/${room.id}`, { password: '' });
ok((await tryJoin(a, room.id)).ok, 'senha tirada: entra sem nada');

// orador prioritário e pedir a vez (ana na sala; bia e caio entram)
await tryJoin(b, room.id); await tryJoin(c, room.id);
let s = b.gw.wait('VOICE_STATE', d => d.user_id === a.id && d.prio === true);
a.gw.send('VOICE_STATE', { prio: true });
ok(!!(await s.catch(() => null)), 'ana (cargo com Orador prioritário) liga a prioridade e a sala vê');
b.gw.flush(); c.gw.send('VOICE_STATE', { prio: true }); await sleep(400);
s = b.gw.wait('VOICE_STATE', d => d.user_id === c.id && d.prio === true, 800);
ok(!(await s.catch(() => null)), 'caio (sem a permissão) não consegue');
s = b.gw.wait('VOICE_STATE', d => d.user_id === c.id && d.hand > 0);
c.gw.send('VOICE_STATE', { hand: true });
const hc = await s.catch(() => null); ok(hc?.hand > 0, 'caio pede a vez (hand com o momento)');
s = b.gw.wait('VOICE_STATE', d => d.user_id === b.id && d.hand > 0);
b.gw.send('VOICE_STATE', { hand: true }); const hb = await s.catch(() => null);
ok(hb?.hand >= hc?.hand, 'a fila guarda a ordem (bia depois do caio)');
a.gw.flush(); b.gw.send('VOICE_HAND', { user_id: c.id }); await sleep(400);
s = a.gw.wait('VOICE_STATE', d => d.user_id === c.id && !d.hand, 800);
ok(!(await s.catch(() => null)), 'bia (sem Moderar voz) não baixa a mão do caio');
await tryJoin(mod, room.id); a.gw.flush();
const lowered = c.gw.wait('VOICE_HAND_LOWERED');
s = a.gw.wait('VOICE_STATE', d => d.user_id === c.id && !d.hand);
mod.gw.send('VOICE_HAND', { user_id: c.id });
ok(!!(await s.catch(() => null)) && (await lowered.catch(() => null))?.by === mod.id, 'quem modera voz baixa a mão do caio e ele é avisado');

// sussurro (eventos; o áudio é conferido na parte 2)
const wIn = b.gw.wait('VOICE_WHISPER', d => d.from === a.id && d.on === true), wOk = a.gw.wait('VOICE_WHISPER_OK');
a.gw.send('VOICE_WHISPER', { to: [b.id, 'ninguem', a.id] });
ok((await wOk.catch(() => null))?.to?.join() === b.id, 'sussurro só para quem está na sala (ignora quem não está e a própria pessoa)');
ok(!!(await wIn.catch(() => null)), 'bia é avisada de que a ana está sussurrando para ela');
const wOff = b.gw.wait('VOICE_WHISPER', d => d.from === a.id && d.on === false);
await leave(a);
ok(!!(await wOff.catch(() => null)), 'ana sai da sala: o sussurro acaba para a bia');
for (const u of [b, c, mod]) await leave(u);
for (const u of [own, mod, a, b, c]) u.gw.ws.close();

// ---------- parte 2: o áudio de verdade (3 navegadores) ----------
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const WAV = './.testdata-voicerooms.wav';
{ // "fala" contínua: tom com vibrato e volume variando (um tom puro a redução de ruído apaga)
  const rate = 48000, n = rate * 30, pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate; pcm[i] = Math.round(0.4 * 32767 * Math.sin(2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 5 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
// kbps de voz que chegam de uid
const audioFrom = (p, uid, ms = 2000) => p.evaluate(async (uid, ms) => {
  const s = window.__lc.voice.sfu, recv = [...s.consumers.values()].filter(e => e.source === 'mic' && e.uid === uid).map(e => e.c.rtpReceiver);
  const snap = async () => { let n = 0; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') n += x.bytesReceived || 0; }); return n; };
  const x = await snap(); await new Promise(r => setTimeout(r, ms)); return Math.round(((await snap()) - x) * 8 / ms);
}, uid, ms);
try {
  const [ra, rb, rc] = [await person('alice'), await person('bruno'), await person('carla')];
  const g2 = (await call(ra.tok, 'POST', '/guilds', { name: 'Turma' })).data, inv2 = (await call(ra.tok, 'POST', `/guilds/${g2.id}/invites`)).data.code;
  for (const u of [rb, rc]) await call(u.tok, 'POST', '/invites/' + inv2);
  for (const u of [ra, rb, rc]) u.gw.ws.close();
  const [A, B, C] = [await page(ra.tok), await page(rb.tok), await page(rc.tok)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g2.id);
  for (const p of [A, B, C]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await sleep(3000);
  const ready = await Promise.all([A, B, C].map(p => p.evaluate(() => !!window.__lc.voice.sfu?.ready)));
  ok(ready.every(Boolean), 'os três na sala pelo SFU', ready);
  ok((await audioFrom(C, ra.id)) > 10, 'antes do sussurro, a carla ouve a alice (kbps > 10)');
  await A.evaluate((bid) => window.__lc.voice.send('VOICE_WHISPER', { to: [bid] }), rb.id);
  await sleep(1500);
  const kb = await audioFrom(B, ra.id), kc = await audioFrom(C, ra.id);
  ok(kb > 10, 'sussurrando para o bruno: ele continua ouvindo (kbps)', kb);
  ok(kc < 2, 'a carla não recebe nada da alice (kbps)', kc);
  const bar = await B.waitForFunction(() => document.querySelector('#vr-wbar')?.textContent.includes('sussurrando para você'), { timeout: 4000 }).then(() => true, () => false);
  ok(bar, 'o bruno vê "… está sussurrando para você"');
  await A.evaluate(() => window.__lc.voice.send('VOICE_WHISPER', { to: null }));
  await sleep(1500);
  ok((await audioFrom(C, ra.id)) > 10, 'parou de sussurrar: a carla volta a ouvir');
  ok(!(await B.evaluate(() => !!document.querySelector('#vr-wbar'))), 'a faixa do sussurro some no bruno');
  // prioridade: a alice é dona (tem tudo); com ela falando, a voz da carla fica a 25% no app do bruno
  await A.evaluate(() => { window.__lc.voice.prio = true; window.__lc.voice.sendState(); });
  const duck = await B.waitForFunction((cid) => window.__lc.voice.duckOf(cid) < 1, { timeout: 5000 }, rc.id).then(() => B.evaluate((cid) => window.__lc.voice.duckOf(cid), rc.id), () => 1);
  ok(Math.abs(duck - 0.25) < 1e-6, 'alice fala com prioridade: no bruno, a voz da carla cai para 25%', duck);
  ok(await B.evaluate((aid) => window.__lc.voice.duckOf(aid), ra.id) === 1, 'a voz da própria alice não abaixa');
  await A.evaluate(() => { window.__lc.voice.prio = false; window.__lc.voice.sendState(); });
  const back = await B.waitForFunction((cid) => window.__lc.voice.duckOf(cid) === 1, { timeout: 5000 }, rc.id).then(() => true, () => false);
  ok(back, 'prioridade desligada: volume normal de novo');
} catch (e) { ok(false, 'erro: ' + e.message); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
