// Gateway: "digitando…" só para quem olha o servidor e limite por conexão (server/index.js wsGate).
// - TYPING de canal de servidor: chega a quem está olhando o servidor (VIEW) e a app antigo; não a quem está nas DMs
// - TYPING de conversa direta: chega ao outro lado sempre
// - VOICE_STATE repetido sem mudança não é espalhado; uma rajada de VOICE_STATE vira poucos envios e o último vale
// - rajada de VIEW: o último servidor vale (mesmo passando do limite)
// - inundação: mensagens além do limite são ignoradas e a conexão cai
// Uso: node scripts/gateway-limits-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3299, BASE = `http://localhost:${PORT}`, D = './.testdata-gwlimits';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(D, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
function gw(tok, view) {
  return new Promise((res) => {
    const c = { got: [], closed: null, ws: new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok) };
    c.ws.on('message', (raw) => { const m = JSON.parse(raw); c.got.push(m); if (m.t === 'READY') { if (view !== undefined) c.send('VIEW', { guild_id: view }); setTimeout(() => res(c), 150); } });
    c.ws.on('close', (code) => { c.closed = code; });
    c.send = (t, d) => c.ws.send(JSON.stringify({ t, d }));
    c.count = (t, f = () => true) => c.got.filter(m => m.t === t && f(m.d)).length;
    c.reset = () => { c.got.length = 0; };
  });
}
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla'), k = await reg('kaio');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c, k]) await call(u.tok, 'POST', '/invites/' + inv);
  const g2 = await call(b.tok, 'POST', '/guilds', { name: 'Outro' });
  const dm = await call(a.tok, 'POST', '/dms', { user_id: c.id });

  const A = await gw(a.tok, g.id), B = await gw(b.tok, g.id), C = await gw(c.tok, null), K = await gw(k.tok, undefined);
  const chans = A.got.find(m => m.t === 'READY').d.guilds.find(x => x.id === g.id).channels;
  const text = chans.find(x => x.type === 0), voiceCh = chans.find(x => x.type === 2);
  await sleep(300); [A, B, C, K].forEach(x => x.reset());
  A.send('TYPING', { channel_id: text.id }); await sleep(300);
  ok(B.count('TYPING') === 1, 'quem olha o servidor recebe "digitando…"');
  ok(C.count('TYPING') === 0, 'quem está nas DMs não recebe "digitando…" de canal de servidor');
  ok(K.count('TYPING') === 1, 'app antigo (sem VIEW) recebe como antes');
  ok(A.count('TYPING') === 0, 'quem digita não recebe o próprio aviso');
  C.send('VIEW', { guild_id: g.id }); await sleep(300); C.reset();
  await sleep(1100); A.send('TYPING', { channel_id: text.id }); await sleep(300);
  ok(C.count('TYPING') === 1, 'abriu o servidor: passa a receber');
  B.send('VIEW', { guild_id: g2.id }); await sleep(300); B.reset();
  await sleep(1100); A.send('TYPING', { channel_id: text.id }); await sleep(300);
  ok(B.count('TYPING') === 0, 'trocou para outro servidor: para de receber');
  if (dm?.id) { C.reset(); await sleep(1100); A.send('TYPING', { channel_id: dm.id }); await sleep(300); ok(C.count('TYPING') === 1, 'conversa direta: o outro lado recebe sempre'); }
  else ok(false, 'abrir conversa direta', dm);
  // rajada de TYPING: limite de 1/s (acumula 4)
  B.send('VIEW', { guild_id: g.id }); await sleep(1500); B.reset();
  for (let i = 0; i < 50; i++) A.send('TYPING', { channel_id: text.id });
  await sleep(400);
  ok(B.count('TYPING') <= 4, '50 "digitando…" seguidos viram no máximo 4', B.count('TYPING'));

  // VOICE_STATE (sem SFU: entra pela malha P2P)
  A.send('VOICE_JOIN', { channel_id: voiceCh.id }); await sleep(500); B.reset();
  const vs = (x) => x.count('VOICE_STATE', d => d.user_id === a.id && d.channel_id === voiceCh.id);
  A.send('VOICE_STATE', { mute: false, deaf: false, video: false, screen: false }); await sleep(300);
  ok(vs(B) === 0, 'VOICE_STATE igual ao atual não é espalhado', vs(B));
  B.reset();
  for (let i = 0; i < 60; i++) A.send('VOICE_STATE', { mute: i % 2 === 0, deaf: false, video: false, screen: false });
  await sleep(300); const burst = vs(B);
  await sleep(2500);
  const lastB = B.got.filter(m => m.t === 'VOICE_STATE' && m.d.user_id === a.id).pop();
  ok(burst <= 16, '60 trocas de mudo seguidas: poucas espalhadas na hora', burst);
  ok(lastB?.d.mute === false, 'o último estado (desmutado) é o que fica para os outros', lastB?.d.mute);

  // rajada de VIEW: o último vale
  C.reset();
  for (let i = 0; i < 40; i++) C.send('VIEW', { guild_id: i % 2 ? null : g.id });
  C.send('VIEW', { guild_id: g.id }); await sleep(2500);
  const syncs = C.count('PRESENCE_SYNC');
  C.reset(); await sleep(1100); A.send('TYPING', { channel_id: text.id }); await sleep(300);
  ok(syncs <= 12, '41 VIEW seguidos: poucas sincronizações de presença', syncs);
  ok(C.count('TYPING') === 1, 'depois da rajada de VIEW o servidor certo vale');

  // inundação: a conexão cai; as outras seguem
  const F = await gw(k.tok, g.id);
  for (let i = 0; i < 6000; i++) F.send('ROOM_DRAW', { board: 'wb', op: 'undo' });
  await sleep(1500);
  ok(F.closed === 4008, 'inundação de mensagens: conexão fechada (4008)', F.closed);
  ok(A.ws.readyState === 1 && B.ws.readyState === 1, 'as outras conexões seguem de pé');
  // app normal: PING a cada segundo e TYPING a cada 3 s não esbarram no limite
  let pong = 0; const P = await gw(b.tok, g.id); P.ws.on('message', (raw) => { if (JSON.parse(raw).t === 'PONG') pong++; });
  for (let i = 0; i < 5; i++) { P.send('PING', { n: i }); await sleep(200); }
  await sleep(300);
  ok(pong === 5, 'PING normal sempre respondido', pong);
} catch (e) { console.log('  ERRO', e); fails++; }
srv.kill(); await sleep(300);
fs.rmSync(D, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
