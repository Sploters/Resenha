// "Desde a última vez" (server/routes/sessions.js) e a memória das sessões de voz (server/sessions.js) com servidor real,
// contas de verdade e conexões WebSocket entrando na sala de voz (sem navegador).
// ana e beto ficam numa sala; caio (membro) consulta /api/activity/since e vê a sessão; com beto invisível ou com a presença
// escondida, caio vê "+1 pessoa" (hidden); com "Guardar minhas sessões" desligado, beto não entra como participante; dani
// (fora do servidor) não vê nada; /seen zera; cada um tira a própria participação; o dono apaga a sessão.
// Sessões curtas para o teste: VOICE_SESSION_MIN_MS / VOICE_SESSION_GRACE_MS (em produção: 3 min e 60 s).
// Uso: node scripts/memory-since-test.mjs   (PORT, RTC_PORT, DATA_DIR mudam as portas e a pasta)
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3710), RTC_PORT = +(process.env.RTC_PORT || 41710), DATA = process.env.DATA_DIR || './.testdata-memsince', BASE = `http://localhost:${PORT}`;
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const MIN_MS = 2000, GRACE_MS = 1000;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC_PORT), RTC_IPS: '127.0.0.1',
  HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101', VOICE_SESSION_MIN_MS: String(MIN_MS), VOICE_SESSION_GRACE_MS: String(GRACE_MS) }, stdio: 'ignore' });
const kill = () => { try { srv.kill(); } catch { } };
process.on('exit', kill);
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); j._status = r.status; return j; };
const reg = async (name, display) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', { display_name: display }); return { tok: r.token, id: me.id, name }; };
const connect = (u) => new Promise((res) => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + u.tok); ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') { ws.ready = m.d; res(ws); } }); });
const since = (u) => call(u.tok, 'GET', '/activity/since');
const sessionsOf = (r) => (r.items || []).filter(i => i.type === 'session');

try {
  const ana = await reg('ana', 'Ana'), beto = await reg('beto', 'Beto'), caio = await reg('caio', 'Caio'), dani = await reg('dani', 'Dani');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const o of [beto, caio]) await call(o.tok, 'POST', '/invites/' + code);
  const g2 = await call(dani.tok, 'POST', '/guilds', { name: 'Outro' }); // dani só tem o servidor dela
  const wsA = await connect(ana), wsB = await connect(beto), gg = wsA.ready.guilds.find(x => x.id === g.id);
  const vch = gg.channels.find(c => c.type === 2), tch = gg.channels.find(c => c.type === 0);
  const vjoin = (ws, cid = vch.id) => ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: cid } }));
  const vleave = (ws) => ws.send(JSON.stringify({ t: 'VOICE_LEAVE', d: {} }));
  // uma sessão: os dois entram, ficam `ms`, saem; espera a carência fechar
  const session = async (ms = MIN_MS + 1500) => { vjoin(wsA); await sleep(200); vjoin(wsB); await sleep(ms); vleave(wsB); await sleep(150); vleave(wsA); await sleep(GRACE_MS + 800); };

  // ---- 1) sessão curta (menos que o mínimo) é descartada ----
  vjoin(wsA); await sleep(200); vjoin(wsB); await sleep(500); vleave(wsB); vleave(wsA); await sleep(GRACE_MS + 800);
  ok(sessionsOf(await since(caio)).length === 0, 'sessão mais curta que o mínimo: descartada');

  // ---- 2) ana e beto numa sala: caio vê ----
  await session();
  let r = await since(caio), s = sessionsOf(r)[0];
  console.log('  resposta de /api/activity/since (caio):\n' + JSON.stringify({ ...r, _status: undefined, users: r.users?.map(u => `${u.id} (${u.username}, perfil público)`) }, null, 2).replace(/^/gm, '    '));
  ok(r.since && r.away_ms >= 3 * 864e5 - 60e3 && r.away_ms <= 3 * 864e5 + 60e3, 'sem "visto": since = agora − 3 dias', { away_ms: r.away_ms });
  ok(s && s.guild_id === g.id && s.guild_name === 'Turma' && s.channel_id === vch.id && s.channel_name === vch.name && s.channel_exists === true, 'caio vê a sessão da sala', s);
  ok(s && s.members.length === 2 && s.members.includes(ana.id) && s.members.includes(beto.id) && s.hidden === 0, 'participantes: ana e beto, ninguém escondido', s && { members: s.members, hidden: s.hidden });
  ok(s && s.secs >= 2 && s.ended_at > s.started_at && Array.isArray(s.games) && s.clips === 0, 'duração, jogos e clipes no item', s && { secs: s.secs, games: s.games, clips: s.clips });
  ok(r.users?.some(u => u.id === ana.id) && r.users.some(u => u.id === beto.id), 'users traz o perfil de quem é citado');
  ok(sessionsOf(await since(ana)).length === 0 && sessionsOf(await since(beto)).length === 0, 'quem esteve na sessão não a vê (já sabe)');
  ok(sessionsOf(await since(dani)).length === 0, 'dani (fora do servidor) não vê nada');
  const sid1 = s?.id;

  // ---- 3) beto invisível agora: vira "+1 pessoa" ----
  await call(beto.tok, 'PATCH', '/me', { status: 'invisible' }); await sleep(300);
  s = sessionsOf(await since(caio))[0];
  ok(s && s.members.length === 1 && s.members[0] === ana.id && s.hidden === 1, 'beto invisível: caio vê só a ana e +1 pessoa', s && { members: s.members, hidden: s.hidden });
  await call(beto.tok, 'PATCH', '/me', { status: 'online' });
  // presença escondida de caio (só quem beto escolhe)
  await call(beto.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'chosen', allow: [ana.id] } } });
  s = sessionsOf(await since(caio))[0];
  ok(s && !s.members.includes(beto.id) && s.hidden === 1, 'beto esconde a presença do caio: +1 pessoa', s && { members: s.members, hidden: s.hidden });
  await call(beto.tok, 'PUT', '/me/settings', { privacy: { presence: { mode: 'everyone', allow: [] } } });
  s = sessionsOf(await since(caio))[0];
  ok(s && s.members.includes(beto.id) && s.hidden === 0, 'presença aberta de novo: beto aparece', s && { members: s.members, hidden: s.hidden });

  // ---- 4) "Guardar minhas sessões" desligado: beto não entra como participante ----
  r = await call(beto.tok, 'PUT', '/me/settings', { privacy: { memory: { sessions: false } } });
  ok(r.privacy?.memory?.sessions === false && r.privacy.presence?.mode === 'everyone', 'opção salva junto com a privacidade', r.privacy);
  ok((await call(beto.tok, 'GET', '/me/settings')).privacy?.memory?.sessions === false && (await call(caio.tok, 'GET', '/me/settings')).privacy?.memory?.sessions === true, 'GET /me/settings: padrão ligado, beto desligado');
  await session();
  let list = sessionsOf(await since(caio));
  s = list.find(x => x.id !== sid1);
  ok(list.length === 2 && s && s.members.length === 1 && s.members[0] === ana.id && s.hidden === 0 && s.peak === 2, 'sessão nova: só ana como participante (beto conta só no pico)', s && { members: s.members, hidden: s.hidden, peak: s.peak });
  ok(sessionsOf(await since(beto)).some(x => x.id === s?.id), 'beto (que não ficou guardado) vê essa sessão como de fora');
  ok(list[0].ended_at >= list[1].ended_at, 'sessões mais recentes primeiro');
  await call(beto.tok, 'PUT', '/me/settings', { privacy: { memory: { sessions: true } } });

  // ---- 5) evento marcado aparece; tirar a própria participação; administrador apaga ----
  const ev = await call(ana.tok, 'POST', `/guilds/${g.id}/events`, { title: 'CS sexta', starts_at: Date.now() + 2 * 864e5, duration_min: 120, channel_id: vch.id, announce_id: tch.id, game: 'Counter-Strike 2' });
  r = await since(caio);
  ok(r.items.some(i => i.type === 'event' && i.id === ev.event?.id || i.type === 'event' && i.title === 'CS sexta') && r.items.findIndex(i => i.type === 'event') > r.items.findIndex(i => i.type === 'session'), 'evento marcado aparece, depois das sessões', r.items.map(i => i.type));
  ok(!(await since(ana)).items.some(i => i.type === 'event'), 'quem marcou o evento não recebe o próprio evento');
  ok((await call(ana.tok, 'DELETE', `/voice-sessions/${sid1}/me`))._status === 200, 'ana tira a própria participação');
  s = sessionsOf(await since(caio)).find(x => x.id === sid1);
  ok(s && s.members.length === 1 && s.members[0] === beto.id, 'a sessão continua só com o beto', s && s.members);
  ok(sessionsOf(await since(ana)).some(x => x.id === sid1), 'para a ana, a sessão agora é "de fora"');
  ok((await call(ana.tok, 'DELETE', `/voice-sessions/${sid1}/me`))._status === 404, 'tirar de novo: 404');
  ok((await call(caio.tok, 'DELETE', `/voice-sessions/${sid1}`))._status === 403, 'caio (sem Gerenciar servidor) não apaga a sessão');
  ok((await call(dani.tok, 'DELETE', `/voice-sessions/${sid1}`))._status === 404, 'dani (fora do servidor) nem acha a sessão');
  ok((await call(ana.tok, 'DELETE', `/voice-sessions/${sid1}`))._status === 200 && !sessionsOf(await since(caio)).some(x => x.id === sid1), 'a dona do servidor apaga a sessão');

  // ---- 6) /seen zera ----
  const seen = await call(caio.tok, 'POST', '/activity/seen');
  r = await since(caio);
  ok(seen.seen_at && r.since === seen.seen_at && r.away_ms < 5000, 'seen: since vira agora', { since: r.since, seen: seen.seen_at });
  ok(sessionsOf(r).length === 0 && !r.items.some(i => i.type === 'event'), 'depois do /seen: nada do que já foi visto', r.items);
  await session();
  ok(sessionsOf(await since(caio)).length === 1, 'sessão nova depois do /seen aparece');
  void g2;
  wsA.close(); wsB.close();
} catch (e) { console.log('  ERRO', e.stack || e.message); fails++; }
kill();
console.log(fails ? `\n${fails} FALHA(S)` : '\nMEMÓRIA OK'); process.exit(fails ? 1 : 0);
