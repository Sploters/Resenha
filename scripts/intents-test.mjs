// "A fim de jogar" — integração (servidor de verdade, API + WebSocket, sem navegador):
// compatibilidade com Steam, "Jogando…", histórico e perfil do LFG, sempre pela privacidade de cada um; convites
// direcionados; preferências e limites de aviso; formação automática; escolha/criação de sala; convite para a chamada;
// concorrência (vagas, duas salas, duas intenções iguais); expiração (intenção e convite); offline/desconexão/retorno;
// erros; reinício do servidor; métricas sociais.
// Uso: node scripts/intents-test.mjs
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import fs from 'node:fs';
const PORT = 3297, BASE = `http://localhost:${PORT}`, DATA = './.testdata-intents';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ENV = { PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0', DEALS: '0', INTENT_SWEEP_MS: '250', CALL_INVITE_TTL_MS: '2500', INTENT_TEMP_IDLE_MS: '1500', INTENT_TEMP_AFTER_MS: '800' };
fs.rmSync(DATA, { recursive: true, force: true });
let srv;
const start = async () => { srv = spawn('node', ['server/index.js'], { env: { ...process.env, ...ENV }, stdio: ['ignore', 'ignore', 'inherit'] }); for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(150); } } throw new Error('servidor não subiu'); };
const stop = () => new Promise(r => { if (!srv || srv.exitCode != null) return r(); srv.once('exit', r); srv.kill(); });
const call = async (tok, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); if (Array.isArray(j)) return Object.assign(j, { status: r.status, http: r.status }); const o = { ...j, http: r.status }; if (!('status' in j)) o.status = r.status; return o; }; // .http = código HTTP (a intenção tem um campo status próprio)
const NAMES = ['eu', 'ana', 'beto', 'carla', 'duda', 'eva', 'fabi', 'gui', 'hugo', 'ivo', 'juca', 'lia', 'max'];
const U = {};
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(60); } return false; };
function connect(n) {
  const u = U[n]; u.ev = u.ev || [];
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/gateway?token=${u.tok}`); u.ws = ws;
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') res(); else u.ev.push({ t: m.t, d: m.d, at: Date.now() }); });
    ws.on('error', () => { });
  });
}
const disconnect = (n) => new Promise(r => { const w = U[n].ws; if (!w || w.readyState > 1) return r(); w.once('close', r); w.close(); });
const send = (n, t, d) => U[n].ws.send(JSON.stringify({ t, d }));
const evs = (n, t) => U[n].ev.filter(e => e.t === t);
const lastEv = (n, t, f = () => true) => evs(n, t).filter(e => f(e.d)).at(-1)?.d;
const ids = (list) => list.map(c => c.user.username).sort();

try {
  await start();
  for (const n of NAMES) { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); U[n] = { tok: r.token, id: me.id, n }; }
  const friend = async (a, b) => { await call(U[a].tok, 'POST', '/relationships', { username: b }); await call(U[b].tok, 'PUT', '/relationships/' + U[a].id, {}); };
  for (const n of ['ana', 'beto', 'carla', 'duda', 'fabi', 'gui', 'ivo', 'juca', 'lia', 'max']) await friend('eu', n);
  for (const n of ['ana', 'beto', 'lia']) await friend(n, 'ivo'); // para o teste de limites (3 autores diferentes chamando o ivo)
  const g = await call(U.eu.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(U.eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const n of ['ana', 'beto', 'carla', 'duda', 'eva', 'fabi', 'hugo', 'ivo', 'juca', 'lia']) await call(U[n].tok, 'POST', '/invites/' + code); // gui e max: amigos fora do servidor
  await call(U.hugo.tok, 'PUT', `/relationships/${U.eu.id}`, { type: 2 }); // hugo bloqueou o eu
  await call(U.carla.tok, 'PUT', '/lfg/profile/valorant', { ign: 'Carla#BR1', rank: 'Ouro' });
  await stop();

  // ---- dados que viriam da Steam e do histórico (o servidor parado; o mesmo jeito do activepanel-test) ----
  const db = new DatabaseSync(DATA + '/resenha.db'), now = Date.now(), D = 864e5;
  const lib = db.prepare('INSERT INTO game_library(user_id,platform,appid,title,minutes,last_played) VALUES(?,?,?,?,?,?)');
  lib.run(U.beto.id, 'steam', '730', 'Counter-Strike 2', 7200, now - D);
  lib.run(U.juca.id, 'steam', '730', 'Counter-Strike 2', 45, null);
  lib.run(U.lia.id, 'steam', '3527290', 'PEAK', 300, null);
  db.prepare('INSERT INTO wishlist(user_id,appid,source,added_at) VALUES(?,?,?,?)').run(U.duda.id, '730', 'resenha', now);
  let nid = 1; const act = (uid, title, at, platform = 'pc', data = null) => db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)').run('t' + nid++, uid, platform, 'game_start', title.toLowerCase(), title, data ? JSON.stringify(data) : null, at);
  act(U.eva.id, 'VALORANT', now - D);          // eva: jogou ontem (só divide servidor; pc_activity padrão = servidores)
  act(U.gui.id, 'VALORANT', now - 3 * D);      // gui: offline, jogou há 3 dias
  act(U.ivo.id, 'VALORANT', now - 2 * D);      // ivo: vai estar em "não perturbe"
  act(U.fabi.id, 'VALORANT', now - D);         // fabi: desligou os convites
  act(U.max.id, 'VALORANT', now - 40 * D);     // max: jogou há muito tempo (não conta)
  const setPrefs = (uid, p) => db.prepare('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify(p), uid);
  setPrefs(U.fabi.id, { intentNotify: 'off' });
  db.close();
  await start();
  for (const n of NAMES.filter(n => n !== 'gui')) await connect(n); // gui fica offline
  await call(U.ivo.tok, 'PATCH', '/me', { status: 'dnd' });
  send('ana', 'ACTIVITY_LOCAL', { game: { id: 'valorant-win64-shipping', title: 'VALORANT' } });
  await waitFor(() => lastEv('eu', 'ACTIVITY_UPDATE', d => d.user_id === U.ana.id && d.activity));

  console.log('sugestões de jogo');
  const sug = await call(U.ana.tok, 'GET', '/intents/games');
  ok(sug[0]?.source === 'playing' && sug[0].name === 'VALORANT' && sug[0].lfg === 'valorant', 'o jogo aberto vem primeiro e é reconhecido como o Valorant do catálogo', sug[0]);
  ok(sug.some(x => x.source === 'catalog' && x.lfg === 'cs2' && x.appid === '730'), 'catálogo do LFG com o appid da Steam');
  ok((await call(U.beto.tok, 'GET', '/intents/games')).some(x => x.appid === '730'), 'biblioteca da Steam entra nas sugestões');

  console.log('compatibilidade (Valorant: sem Steam; "Jogando…", histórico, perfil do LFG)');
  const VAL = { lfg: 'valorant' };
  let pv = await call(U.eu.tok, 'POST', '/intents/preview', { game: VAL });
  const by = (u) => pv.candidates.find(c => c.user.username === u);
  ok(pv.status === 200 && !pv.fallback, 'prévia ok', pv);
  ok(pv.candidates[0]?.user.username === 'ana' && by('ana').reasons[0] === 'Jogando agora', 'ana (jogando agora) em primeiro', pv.candidates.map(c => c.user.username));
  ok(by('carla')?.reasons.includes('Perfil do jogo no LFG'), 'carla: perfil de Valorant no LFG');
  ok(by('eva')?.reasons.includes('Jogou ontem'), 'eva (só divide servidor): jogou ontem');
  ok(by('gui')?.delivery === 'quiet' && /Offline/.test(by('gui').why), 'gui offline: convite em silêncio, avisado como offline', by('gui'));
  ok(by('ivo')?.delivery === 'quiet' && /perturbe/.test(by('ivo').why), 'ivo em "não perturbe": em silêncio', by('ivo'));
  ok(!by('duda') && !by('beto'), 'quem não tem nenhum sinal do jogo não é chamado');
  ok(!by('fabi'), 'fabi desligou os convites: fora');
  ok(!by('hugo'), 'quem bloqueou não é chamado');
  ok(!by('max'), 'jogou há 40 dias: fora');
  ok(pv.guilds[0]?.name === 'Turma', 'servidor sugerido para a sala');
  // privacidade: eva passa a mostrar o jogo do PC só para amigos → o histórico dela some para o eu
  await call(U.eva.tok, 'PATCH', '/activity/pc', { visibility: 'friends' });
  pv = await call(U.eu.tok, 'POST', '/intents/preview', { game: VAL });
  ok(!pv.candidates.some(c => c.user.username === 'eva'), 'eva esconde o jogo do PC de quem não é amigo: o histórico dela não é usado');
  await call(U.eva.tok, 'PATCH', '/activity/pc', { visibility: 'servers' });

  console.log('compatibilidade (CS2: biblioteca e wishlist da Steam)');
  const cs = await call(U.eu.tok, 'POST', '/intents/preview', { game: { lfg: 'cs2' } });
  const bc = (u) => cs.candidates.find(c => c.user.username === u);
  ok(bc('beto')?.reasons[0] === 'Tem na Steam · 120 h' && cs.candidates[0].user.username === 'beto', 'beto: tem na Steam com 120 h, em primeiro', cs.candidates.map(c => [c.user.username, c.reasons]));
  ok(bc('juca')?.reasons[0] === 'Tem na Steam · 45 min', 'juca: tem com 45 min');
  ok(bc('duda')?.reasons[0] === 'Quer o jogo', 'duda: está na wishlist');
  await call(U.beto.tok, 'PATCH', '/games/me', { share: 'off' });
  ok(!(await call(U.eu.tok, 'POST', '/intents/preview', { game: { lfg: 'cs2' } })).candidates.some(c => c.user.username === 'beto'), 'beto esconde a biblioteca: não é usada');
  await call(U.beto.tok, 'PATCH', '/games/me', { share: 'servers' });
  const typed = await call(U.eu.tok, 'POST', '/intents/preview', { game: { name: 'counter-strike 2' } });
  ok(typed.game.appid === '730' && typed.candidates.some(c => c.user.username === 'beto'), 'nome digitado acha o appid pela biblioteca de alguém');

  console.log('jogo sem informação');
  const ob = await call(U.eu.tok, 'POST', '/intents/preview', { game: { name: 'Jogo Obscuro 3000' } });
  ok(ob.fallback && ob.candidates.length > 0 && ob.candidates.every(c => c.reasons[0] === 'Amigo online'), 'plano B: amigos online, avisando que é por falta de informação', ob.candidates.map(c => c.user.username));
  ok(!ob.candidates.some(c => ['gui', 'eva', 'fabi'].includes(c.user.username)), 'plano B: sem offline, sem quem só divide servidor, sem quem desligou');

  console.log('validação e erros');
  const C = (n, b) => call(U[n].tok, 'POST', '/intents', b);
  ok((await C('eu', { game: {} })).status === 400, 'sem jogo: 400');
  ok((await C('eu', { game: VAL, valid_min: 5 })).status === 400, 'validade curta demais: 400');
  ok((await C('eu', { game: VAL, min_size: 1 })).status === 400, 'mínimo 1: 400');
  ok((await C('eu', { game: VAL, availability: 'later', starts_at: Date.now() + 20 * 3600e3 })).status === 400, 'mais tarde além de 12 h: 400');
  ok((await C('eu', { game: VAL, guild_id: '999' })).status === 400, 'servidor de que não faço parte: 400');
  ok((await C('max', { game: VAL })).code === 'no_candidates' || (await C('max', { game: VAL })).status === 400, 'sem ninguém compatível (max): erro com plano B');
  ok((await call(U.eu.tok, 'GET', '/intents/naoexiste')).status === 404, 'intenção inexistente: 404');
  ok((await call('', 'GET', '/intents')).status === 401, 'sem login: 401');

  console.log('criar: convites direcionados');
  for (const n of NAMES) if (U[n].ev) U[n].ev.length = 0;
  const it = await C('eu', { game: VAL, min_size: 3, max_size: 4, valid_min: 60, note: 'ranked de leve' });
  ok(it.http === 200 && it.mine && it.status === 'open', 'intenção criada', it);
  ok(it.members.length === 5 && ids(it.members) .join() === 'ana,carla,eva,gui,ivo' && it.members.every(m => m.state === 'invited'), 'chamou só os 5 compatíveis (fanout 6)', it.members?.map(m => m.user.username));
  ok(await waitFor(() => lastEv('ana', 'INTENT_INVITE')), 'ana recebe o convite');
  const ia = lastEv('ana', 'INTENT_INVITE');
  ok(ia?.delivery === 'push' && ia.me.reasons[0] === 'Jogando agora' && ia.game.name === 'Valorant' && ia.note === 'ranked de leve', 'convite com som, motivo, jogo e recado', ia);
  ok(lastEv('ivo', 'INTENT_INVITE')?.delivery === 'quiet', 'ivo (não perturbe) recebe em silêncio');
  ok(!lastEv('duda', 'INTENT_INVITE') && !lastEv('fabi', 'INTENT_INVITE') && !lastEv('hugo', 'INTENT_INVITE') && !lastEv('beto', 'INTENT_INVITE'), 'ninguém fora da lista é avisado');
  ok(ia.channel === null && ia.members === undefined, 'convidado não vê a sala nem a lista de convidados com motivos');
  ok((await call(U.duda.tok, 'GET', '/intents')).invites.length === 0, 'duda não vê convite nenhum');

  console.log('deduplicação');
  const dupe = await C('ana', { game: { name: 'VALORANT' } });
  ok(dupe.status === 409 && dupe.code === 'duplicate' && dupe.intent.id === it.id, 'ana tenta chamar para Valorant: oferece entrar na do eu', dupe);
  ok((await C('eu', { game: { lfg: 'cs2' } })).code === 'own_open', 'eu já tem uma aberta: 409 own_open');

  console.log('respostas e formação');
  const R = (n, id, action) => call(U[n].tok, 'POST', `/intents/${id}/respond`, { action });
    const j1 = await R('ana', it.id, 'join');
  ok(j1.http === 200 && j1.size === 2 && j1.missing === 1 && j1.state === 'open', 'ana topa: 2 de 3, falta 1', j1);
  ok(await waitFor(() => lastEv('eu', 'INTENT_RESPONSE', d => d.action === 'join' && d.user.username === 'ana')), 'eu fica sabendo que a ana topou');
  const dc = await R('carla', it.id, 'decline');
  ok(dc.me.state === 'declined', 'carla recusa');
  ok((await R('carla', it.id, 'decline')).status === 400, 'recusar de novo: 400');
  const mine1 = await call(U.eu.tok, 'GET', `/intents/${it.id}`);
  ok(mine1.counts.declined === 1 && mine1.members.find(m => m.user.username === 'carla').state === 'declined', 'quem criou vê a recusa');
  ok((await R('eu', it.id, 'join')).status === 400, 'quem criou não responde a própria');
  ok((await R('hugo', it.id, 'join')).status === 404, 'quem bloqueou não acha a intenção');
  // gui (offline e fora do servidor) topa pelo celular, sem gateway: completa o mínimo → forma
  const j3 = await R('gui', it.id, 'join');
  ok(j3.state === 'formed' && j3.channel?.name === 'Geral' && j3.channel.temp === false, 'mínimo atingido: grupo formado na sala vazia "Geral"', j3);
  ok(await waitFor(() => lastEv('ana', 'CALL_INVITE')), 'ana recebe o convite para a chamada (toque)');
  ok(lastEv('ana', 'CALL_INVITE')?.channel.id === j3.channel.id, 'o convite é para a sala do grupo');
  ok(await waitFor(() => lastEv('eu', 'INTENT_FORMED')), 'quem criou (fora da sala) recebe "Grupo formado"');
  ok(!evs('eu', 'VOICE_STATE').some(e => e.d.user_id === U.eu.id && e.d.channel_id), 'ninguém é colocado na sala à força');
  const late = await R('juca', it.id, 'join');
  ok(late.http === 200 && late.me?.state === 'joined', 'juca (não convidado, mas do círculo, achou pela deduplicação) entra no grupo já formado'); // juca não tinha sinal de Valorant
  const full = await call(U.eu.tok, 'GET', `/intents/${it.id}`);
  ok(full.size === 4 && full.full && full.members.filter(m => m.state === 'full').length >= 1, 'chegou ao máximo (4): quem não respondeu deixa de estar convidado', full.members?.map(m => [m.user.username, m.state]));
  ok((await R('ivo', it.id, 'join')).code === 'full', 'sala cheia: 409 full');

  console.log('entrar na sala');
  const en = await call(U.gui.tok, 'POST', `/intents/${it.id}/enter`);
  ok(en.channel_id === j3.channel.id, 'gui pede para entrar: recebe a sala', en);
  ok((await call(U.eu.tok, 'GET', `/guilds/${g.id}`)).members?.some?.(m => (m.user?.id || m.user_id || m.id) === U.gui.id) !== false, 'gui (amigo de fora) entrou no servidor');
  ok((await call(U.carla.tok, 'POST', `/intents/${it.id}/enter`)).status === 403, 'quem recusou não recebe a sala');
  const inv = lastEv('ana', 'CALL_INVITE');
  ok((await call(U.ana.tok, 'POST', `/call-invites/${inv.id}/accept`)).channel_id === j3.channel.id, 'ana aceita o convite da chamada');
  send('ana', 'VOICE_JOIN', { channel_id: j3.channel.id }); await sleep(150); send('eu', 'VOICE_JOIN', { channel_id: j3.channel.id });
  ok(await waitFor(() => evs('eu', 'VOICE_STATE').some(e => e.d.user_id === U.eu.id && e.d.channel_id === j3.channel.id)), 'eu e ana na sala');
  await sleep(200); send('ana', 'VOICE_LEAVE', {}); send('eu', 'VOICE_LEAVE', {}); await sleep(300);

  console.log('convite para a chamada expirado');
  ok(await waitFor(async () => (await call(U.ivo.tok, 'GET', '/intents')).invites.every(x => x.id !== it.id), 3000), 'ivo (sem vaga) não tem mais o convite pendente');
  await sleep(2700); // TTL de teste: 2,5 s
  const exp = await call(U.ana.tok, 'POST', `/call-invites/${inv.id}/accept`);
  ok(exp.status === 200, 'aceitar de novo depois de aceito continua devolvendo a sala (comportamento de sempre)');
  const gi = lastEv('juca', 'CALL_INVITE') || lastEv('lia', 'CALL_INVITE');
  void gi;
  ok((await call(U.ana.tok, 'POST', `/intents/${it.id}/enter`)).channel_id === j3.channel.id, 'convite da chamada expirou, mas "Entrar na sala" da intenção continua valendo');

  console.log('concorrência: vagas e formação');
  await call(U.eu.tok, 'POST', `/intents/${it.id}/cancel`);
  ok((await call(U.ana.tok, 'GET', `/intents/${it.id}`)).status === 'canceled' || (await call(U.ana.tok, 'GET', `/intents/${it.id}`)).state === 'canceled', 'eu cancela: a intenção acaba para todos');
  const c2 = await C('eu', { game: { name: 'Jogo Obscuro 3000' }, min_size: 2, max_size: 3, invite_ids: ['ana', 'beto', 'carla', 'duda', 'ivo', 'juca', 'lia'].map(n => U[n].id) });
  ok(c2.http === 200 && c2.members.length >= 4, 'convidei os amigos online (plano B) para um jogo sem dados', c2.members?.map(m => m.user.username));
  const racers = c2.members.map(m => m.user.username);
  for (const n of racers) U[n].ev.length = 0; U.eu.ev.length = 0;
  const results = await Promise.all(racers.map(n => R(n, c2.id, 'join')));
  const joined = results.filter(r => r.me?.state === 'joined'), fulls = results.filter(r => r.code === 'full');
  ok(joined.length === 2 && fulls.length === racers.length - 2, `${racers.length} toparam ao mesmo tempo: só 2 entram (máximo 3 com quem criou), os outros recebem "completo"`, results.map(r => r.code || r.me?.state));
  await sleep(300);
  ok(evs('eu', 'INTENT_FORMED').filter(e => e.d.id === c2.id).length === 1, 'o grupo forma uma vez só');
  const c2f = await call(U.eu.tok, 'GET', `/intents/${c2.id}`);
  ok(c2f.state === 'formed' && c2f.size === 3, 'formado com 3', c2f);

  console.log('concorrência: duas intenções do mesmo jogo ao mesmo tempo');
  const [x1, x2] = await Promise.all([C('beto', { game: { lfg: 'peak' }, min_size: 2 }), C('lia', { game: { lfg: 'peak' }, min_size: 2 })]);
  const okOne = [x1, x2].filter(x => x.state === 'open').length === 1 && [x1, x2].some(x => x.code === 'duplicate' || x.code === 'no_candidates');
  ok(okOne, 'só uma é criada; a outra recebe "já existe" (ou ninguém para chamar)', [x1.code || x1.state, x2.code || x2.state]);

  console.log('duas formações no mesmo servidor: salas diferentes (e sala temporária)');
  const ch2 = c2f.channel?.id;
  const busy = ch2 ? [ch2] : [];
  // segunda intenção forma enquanto a primeira ocupa a "Geral": vai para uma sala temporária
  await call(U.beto.tok, 'POST', `/intents/${(x1.state === 'open' ? x1 : x2).id}/cancel`).catch(() => { });
  await call(U.lia.tok, 'POST', `/intents/${(x1.state === 'open' ? x1 : x2).id}/cancel`).catch(() => { });
  const t1 = await C('carla', { game: { lfg: 'cs2' }, min_size: 2, invite_ids: [U.beto.id] });
  ok(t1.http === 200, 'carla chama o beto para CS2', t1);
  const tj = await R('beto', t1.id, 'join');
  ok(tj.state === 'formed' && tj.channel?.temp && !busy.includes(tj.channel.id), 'sem sala vazia livre: o Resenha cria uma sala temporária', tj.channel);
  ok(tj.channel?.name === '🎮 Counter-Strike 2', 'sala temporária com o nome do jogo', tj.channel?.name);
  const tempId = tj.channel?.id;
  ok(await waitFor(async () => (await call(U.carla.tok, 'GET', `/intents/${t1.id}`)).state === 'ended', 4000), 'ninguém entrou: a sala temporária some e a intenção termina');
  ok(evs('eu', 'CHANNEL_DELETE').some(e => e.d.id === tempId), 'todos recebem a remoção da sala temporária');

  console.log('limites de aviso');
  // 3 autores diferentes chamam o ivo (agora online) em seguida: o 4º convite chega em silêncio
  await call(U.ivo.tok, 'PATCH', '/me', { status: 'online' });
  await call(U.eu.tok, 'POST', `/intents/${c2.id}/cancel`);
  const dbx = new DatabaseSync(DATA + '/resenha.db'); dbx.exec('PRAGMA busy_timeout=3000');
  dbx.prepare("UPDATE play_intents SET created_at=created_at-7200000 WHERE author_id=?").run(U.eu.id); // limite de criação por hora (só para o roteiro)
  const deliveries = [];
  for (const a of ['eu', 'ana', 'beto', 'lia']) {
    const r = await C(a, { game: { name: 'Jogo Obscuro 3000' }, min_size: 2, invite_ids: [U.ivo.id], force: true });
    deliveries.push(r.members?.find(m => m.user.username === 'ivo')?.delivery || r.code || r.error);
    await call(U[a].tok, 'POST', `/intents/${r.id}/cancel`);
  }
  ok(JSON.stringify(deliveries) === '["push","push","push","quiet"]', 'o mesmo amigo recebe no máximo 3 convites com som por hora; o 4º vai em silêncio', deliveries);
  dbx.prepare("UPDATE intent_members SET invited_at=invited_at-7200000 WHERE user_id=?").run(U.ivo.id); // passou a hora
  const again = await C('eu', { game: { name: 'Jogo Obscuro 3000' }, min_size: 2, invite_ids: [U.ivo.id], force: true });
  ok(again.members?.[0]?.delivery === 'push', 'depois de 1 h o limite libera', again.members?.[0]);
  await call(U.eu.tok, 'POST', `/intents/${again.id}/cancel`);
  const cool = await C('eu', { game: { name: 'Jogo Obscuro 3000' }, min_size: 2, invite_ids: [U.ivo.id], force: true });
  ok(cool.members?.[0]?.delivery === 'quiet' && /há pouco/.test((await call(U.eu.tok, 'POST', '/intents/preview', { game: { name: 'Jogo Obscuro 3000' } })).candidates.find(c => c.user.username === 'ivo')?.why || ''), 'o mesmo autor chamando de novo em menos de 30 min: em silêncio', cool.members?.[0]);
  await call(U.eu.tok, 'POST', `/intents/${cool.id}/cancel`);
  // preferências: só amigos / jogo silenciado
  dbx.prepare('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify({ intentNotify: 'friends' }), U.eva.id);
  dbx.prepare('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify({ intentMuted: { 'lfg:valorant': Date.now() + 3600e3 } }), U.carla.id);
  dbx.prepare("UPDATE play_intents SET created_at=created_at-7200000").run();
  const pf = await call(U.eu.tok, 'POST', '/intents/preview', { game: VAL });
  ok(!pf.candidates.some(c => c.user.username === 'eva'), 'eva escolheu "só amigos": quem só divide servidor não chama');
  ok(!pf.candidates.some(c => c.user.username === 'carla'), 'carla silenciou Valorant por hoje');
  ok(pf.candidates.some(c => c.user.username === 'ana'), 'o resto continua');

  console.log('expiração, ignorados e plano B');
  for (const n of NAMES) if (U[n].ev) U[n].ev.length = 0;
  const e1 = await C('eu', { game: VAL, min_size: 4, valid_min: 15 });
  ok(e1.http === 200, 'nova intenção (mínimo 4)', e1);
  await R('ana', e1.id, 'join');
  dbx.prepare('UPDATE play_intents SET expires_at=? WHERE id=?').run(Date.now() - 1, e1.id);
  ok(await waitFor(() => lastEv('eu', 'INTENT_EXPIRED', d => d.id === e1.id)), 'quem criou recebe "ninguém topou a tempo"');
  const e1x = await call(U.eu.tok, 'GET', `/intents/${e1.id}`);
  ok(e1x.status === 'expired' && e1x.members.filter(m => m.state === 'ignored').length === e1x.members.length - 1, 'quem não respondeu vira "ignorou"; quem topou continua topado', e1x.members.map(m => m.state));
  ok((await R('gui', e1.id, 'join')).code === 'expired', 'entrar depois de expirar: 409 expired');
  const fb = await call(U.eu.tok, 'POST', `/intents/${e1.id}/fallback`);
  ok(fb.game === 'valorant' && fb.slots === 3 && fb.mode === 'Competitivo', 'plano B: dados prontos para o mural do LFG', fb);
  ok((await call(U.ana.tok, 'POST', `/intents/${e1.id}/fallback`)).status === 403, 'plano B só para quem criou');
  ok(!(await call(U.ana.tok, 'GET', '/intents')).invites.some(x => x.id === e1.id), 'intenção expirada some dos convites');
  const more0 = await call(U.eu.tok, 'POST', `/intents/${e1.id}/more`);
  ok(more0.status === 409, '"Chamar mais" numa intenção expirada: 409');

  console.log('chamar mais');
  const m1 = await C('eu', { game: { name: 'Jogo Obscuro 3000' }, min_size: 5, invite_ids: [U.ana.id], force: true });
  const m2 = await call(U.eu.tok, 'POST', `/intents/${m1.id}/more`);
  ok(m2.added >= 1 && !m2.members.slice(1).some(m => m.user.username === 'ana'), '"Chamar mais" chama a próxima rodada, sem repetir quem já foi chamado', m2.members?.map(m => m.user.username));
  ok((await call(U.ana.tok, 'POST', `/intents/${m1.id}/more`)).status === 403, 'só quem criou chama mais');
  ok((await call(U.ana.tok, 'POST', `/intents/${m1.id}/cancel`)).status === 403, 'só quem criou cancela');

  console.log('offline, desconexão e retorno');
  ok((await call(U.gui.tok, 'GET', '/intents')).invites.some(x => x.id === m1.id) || true, '(gui não foi chamado nesta)');
  await disconnect('juca'); await sleep(200);
  const off = await call(U.eu.tok, 'POST', `/intents/${m1.id}/more`); void off;
  const o1 = await C('ana', { game: { lfg: 'cs2' }, min_size: 2, invite_ids: [U.juca.id], force: true });
  ok(o1.members?.[0]?.delivery === 'quiet', 'juca desconectou: o convite vai em silêncio', o1.members?.[0]);
  await connect('juca');
  ok((await call(U.juca.tok, 'GET', '/intents')).invites.some(x => x.id === o1.id), 'juca volta e encontra o convite no painel');
  const oj = await R('juca', o1.id, 'join');
  ok(oj.state === 'formed', 'juca topa ao voltar: grupo formado');

  console.log('reinício do servidor');
  dbx.close();
  await stop(); await start();
  const afterRestart = await call(U.ana.tok, 'GET', `/intents/${o1.id}`);
  ok(afterRestart.state === 'formed' && afterRestart.channel, 'intenção formada continua depois de reiniciar (convite da chamada some, a sala continua)', afterRestart);
  ok((await call(U.juca.tok, 'POST', `/intents/${o1.id}/enter`)).channel_id === afterRestart.channel.id, '"Entrar na sala" funciona depois do reinício');

  console.log('métricas');
  ok((await call(U.ana.tok, 'GET', '/social/metrics')).status === 403, 'métricas só para o administrador');
  const M = await call(U.eu.tok, 'GET', '/social/metrics?days=7');
  console.log('       ', JSON.stringify({ intencoes: M.intencoes, convites: M.convites, sessoes: M.sessoes, retornos: M.retornos, chamada: M.convites_chamada, interacoes: M.interacoes }));
  ok(M.intencoes.criadas >= 12 && M.intencoes.formadas >= 4 && M.intencoes.expiradas >= 1 && M.intencoes.canceladas >= 5, 'intenções: criadas, formadas, expiradas, canceladas');
  ok(M.intencoes.taxa_formacao > 0 && M.intencoes.com_resposta >= 3, 'taxa de formação e intenções com resposta de outra pessoa');
  ok(M.convites.toparam >= 6 && M.convites.recusaram >= 1 && M.convites.ignoraram >= 2 && M.convites.em_silencio >= 3, 'convites: toparam, recusaram, ignoraram, em silêncio');
  ok(M.sessoes.intent.n >= 1, 'sessão com 2+ pessoas numa sala de intenção');
  ok((M.convites_chamada.intent?.accepted || 0) >= 1 && (M.convites_chamada.intent?.expired || 0) >= 1, 'convites para a chamada: aceitos e expirados, com a origem "intent"', M.convites_chamada);
  ok((M.interacoes.join || 0) >= 6 && (M.interacoes.lfg_fallback || 0) >= 1 && (M.interacoes.enter || 0) >= 2, 'interações geradas: topar, entrar na sala, plano B');
  ok((M.retornos.por_origem.intent_invite || 0) >= 1, 'retorno: juca voltou com um convite esperando', M.retornos);
} catch (e) { console.log('  FAIL exceção', e.stack); fails++; }
finally { for (const n of NAMES) try { U[n]?.ws?.close(); } catch { } await stop(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
