// Privacidade (server/privacy.js) com servidor real e conexões WebSocket de verdade:
// - presença só para amigos / só para escolhidos / esconder de alguém: quem não pode ver recebe offline (READY, USER_UPDATE,
//   mensagens) e nenhuma atividade; quem pode, recebe o status de verdade
// - ligações: "todo mundo" desligado barra quem não é amigo (DM e convite para a sala), com o aviso "não está aceitando ligações"
// Uso: node scripts/privacy-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3291, BASE = `http://localhost:${PORT}`, DATA = './.testdata-priv';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41091', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, name }; };
// conexão do "app": guarda todos os eventos
function connect(u) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/gateway?token=${u.tok}&tab=t-${u.name}`), ev = [];
    ws.on('message', (raw) => { const m = JSON.parse(raw); ev.push(m); if (m.t === 'READY') res({ ws, ev, ready: m.d }); });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'IDENTIFY', d: {} })));
  });
}
const last = (c, t, f = () => true) => [...c.ev].reverse().find(m => m.t === t && f(m.d))?.d;
const statusIn = (ready, uid) => ready.users.find(u => u.id === uid)?.status ?? ready.relationships.find(r => r.user.id === uid)?.user.status;
try {
  const a = await reg('ana'), b = await reg('bruno'), c = await reg('caio');
  // ana ↔ bruno amigos; caio só divide o servidor com a ana
  await call(a.tok, 'POST', '/relationships', { username: 'bruno' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Servidor' });
  const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(c.tok, 'POST', '/invites/' + code);
  const text = (await call(a.tok, 'GET', `/guilds/${g.id}`)).channels?.find(x => x.type === 0) || null;
  const A = await connect(a); await sleep(300);

  // ---------- presença: só amigos ----------
  let r = await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'friends' } } });
  ok(r.privacy?.presence?.mode === 'friends', 'salvou "só amigos" para status e atividade', r.privacy?.presence);
  const B = await connect(b), C = await connect(c); await sleep(300);
  ok(statusIn(B.ready, a.id) === 'online', 'amigo (bruno) vê a ana online no READY', statusIn(B.ready, a.id));
  ok(statusIn(C.ready, a.id) === 'offline', 'quem não é amigo (caio) vê a ana offline no READY', statusIn(C.ready, a.id));
  await call(a.tok, 'PATCH', '/me', { status: 'idle' }); await sleep(400);
  ok(last(B, 'USER_UPDATE', d => d.id === a.id)?.status === 'idle', 'mudou para ausente: o amigo recebe "ausente"', last(B, 'USER_UPDATE', d => d.id === a.id)?.status);
  ok(last(C, 'USER_UPDATE', d => d.id === a.id)?.status === 'offline', 'o outro continua recebendo offline', last(C, 'USER_UPDATE', d => d.id === a.id)?.status);
  // mensagem no servidor: o autor vai como offline (ninguém descobre o status por ali)
  const ch = text || (await call(a.tok, 'GET', '/guilds/' + g.id)).channels?.find(x => x.type === 0);
  const chId = ch?.id || C.ready.guilds[0].channels.find(x => x.type === 0).id;
  await call(a.tok, 'POST', `/channels/${chId}/messages`, { content: 'oi' }); await sleep(400);
  ok(last(C, 'MESSAGE_CREATE', d => d.author_id === a.id)?.author?.status === 'offline', 'mensagem da ana: o autor vai offline para quem não pode ver');
  // perfil público (GET /users/:id) também
  ok((await call(c.tok, 'GET', `/users/${a.id}`)).status !== 'idle', 'perfil da ana não revela o status para o caio');

  // ---------- presença: só quem eu escolher + esconder de alguém ----------
  await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'chosen', allow: [c.id] } } }); await sleep(400);
  ok(last(C, 'USER_UPDATE', d => d.id === a.id)?.status === 'idle', 'escolheu o caio: ele passa a ver a ana (ausente) na hora');
  ok(last(B, 'USER_UPDATE', d => d.id === a.id)?.status === 'offline', 'o amigo que não foi escolhido passa a ver offline na hora');
  await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'everyone', allow: [], deny: [b.id] } } }); await sleep(400);
  ok(last(B, 'USER_UPDATE', d => d.id === a.id)?.status === 'offline' && last(C, 'USER_UPDATE', d => d.id === a.id)?.status === 'idle', 'todo mundo menos o bruno: bruno offline, caio vê ausente');
  await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { deny: [] } } }); await sleep(400);
  ok(last(B, 'USER_UPDATE', d => d.id === a.id)?.status === 'idle', 'tirou o bruno da lista: ele volta a ver o status');

  // ---------- atividade (jogo aberto no PC): segue a mesma regra ----------
  await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'chosen', allow: [b.id] } } }); await sleep(300);
  A.ws.send(JSON.stringify({ t: 'ACTIVITY_LOCAL', d: { game: { id: 'valorant', title: 'VALORANT' } } })); await sleep(500);
  ok(last(B, 'ACTIVITY_UPDATE', d => d.user_id === a.id)?.activity?.game?.title === 'VALORANT', 'escolhido (bruno) vê "Jogando VALORANT"');
  ok(!last(C, 'ACTIVITY_UPDATE', d => d.user_id === a.id && d.activity), 'quem não foi escolhido (caio) não recebe a atividade');
  await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { allow: [] } } }); await sleep(400);
  ok(last(B, 'ACTIVITY_UPDATE', d => d.user_id === a.id)?.activity === null, 'tirou o bruno: a atividade some para ele na hora');
  await call(a.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'everyone' } } }); await sleep(400);
  ok(last(C, 'ACTIVITY_UPDATE', d => d.user_id === a.id)?.activity?.game?.title === 'VALORANT', 'voltou para todo mundo: o caio passa a ver o jogo');
  A.ws.send(JSON.stringify({ t: 'ACTIVITY_LOCAL', d: { game: null } }));

  // ---------- ligações ----------
  r = await call(a.tok, 'PUT', '/me/settings', { privacy: { calls: { everyone: false, servers: false } } });
  ok(r.privacy?.calls?.everyone === false && r.privacy.calls.servers === false && r.privacy.calls.friends === true, 'ligações: só amigos (e amigos de amigos)', r.privacy?.calls);
  const dmC = await call(c.tok, 'POST', '/dms', { user_id: a.id }), dmB = await call(b.tok, 'POST', '/dms', { user_id: a.id });
  C.ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: dmC.id } })); await sleep(500);
  const denied = last(C, 'VOICE_DENIED');
  ok(denied?.code === 'calls_off' && /não está aceitando ligações/.test(denied.reason || ''), 'caio (não é amigo) liga para a ana: "não está aceitando ligações"', denied);
  ok(!last(A, 'VOICE_STATE', d => d.user_id === c.id && d.channel_id === dmC.id), 'a ana não recebe o toque do caio');
  B.ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: dmB.id } })); await sleep(500);
  ok(!!last(A, 'VOICE_STATE', d => d.user_id === b.id && d.channel_id === dmB.id), 'bruno (amigo) consegue ligar');
  B.ws.send(JSON.stringify({ t: 'VOICE_LEAVE', d: {} }));
  // convite para a sala do servidor: o caio está numa sala e chama a ana
  const vch = C.ready.guilds[0].channels.find(x => x.type === 2);
  C.ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: vch.id } })); await sleep(500);
  const inv = await call(c.tok, 'POST', '/call-invites', { user_id: a.id });
  ok(inv.status === 403 && /não está aceitando chamadas/.test(inv.error || inv.message || JSON.stringify(inv)), 'convite do caio para a sala também é barrado', inv);
  await call(a.tok, 'PUT', '/me/settings', { privacy: { calls: { servers: true, friends: true, fof: false } } });
  ok((await call(a.tok, 'GET', '/me/settings')).privacy.calls.servers === true, 'privacidade volta no GET /me/settings');
  const inv2 = await call(c.tok, 'POST', '/call-invites', { user_id: a.id });
  ok(inv2.status !== 403, '"membros dos seus servidores" ligado: o convite do caio passa', inv2.status);
  for (const x of [A, B, C]) x.ws.close();
} catch (e) { console.log('ERRO', e); fails++; }
srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
