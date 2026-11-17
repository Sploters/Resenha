// Anúncio com sala combinada: aceitar ou entrar direto já coloca a pessoa no servidor da sala e chama para a chamada;
// "Ir para a sala" só para quem está no grupo. Também: nome e ícone certos do jogo do PC (anticheat, Java, catálogo).
// Uso: node scripts/lfg-room-test.mjs   (só API e gateway; não abre navegador)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3237, BASE = `http://localhost:${PORT}`, DIR = './.testdata-lfgroom';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DIR, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, DISCOVER: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const gw = (tok) => new Promise((res) => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok); ws.ev = []; ws.on('message', (d) => { try { ws.ev.push(JSON.parse(d)); } catch { } }); ws.on('open', () => res(ws)); });

try {
  const a = await reg('autor'), b = await reg('bia'), c = await reg('caio');
  // autor e bia dividem o servidor "Jogatina"; o anúncio usa a sala do servidor "Sala do autor", onde bia e caio não estão
  const g1 = await call(a.tok, 'POST', '/guilds', { name: 'Jogatina' }); const code = (await call(a.tok, 'POST', `/guilds/${g1.id}/invites`)).code;
  for (const u of [b, c]) await call(u.tok, 'POST', '/invites/' + code);
  const g2 = await call(a.tok, 'POST', '/guilds', { name: 'Sala do autor' });
  const vch = await call(a.tok, 'POST', `/guilds/${g2.id}/channels`, { name: 'Partida', type: 2 });
  ok(!!vch, 'servidor novo tem sala de voz', vch?.name);
  const wb = await gw(b.tok);

  // pedido -> aceito: bia entra no servidor da sala e recebe o convite para aquela sala
  const p = await call(a.tok, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Competitivo', slots: 2, mic: false, channel_id: vch.id });
  ok(p.channel?.id === vch.id, 'anúncio com a sala combinada');
  await call(b.tok, 'POST', `/lfg/posts/${p.id}/request`, {});
  const no = await call(b.tok, 'POST', `/lfg/posts/${p.id}/go`);
  ok(no.status === 403, '"Ir para a sala" antes de ser aceito: recusado', no.status);
  const ans = await call(a.tok, 'POST', `/lfg/posts/${p.id}/answer`, { user_id: b.id, accept: true });
  ok(ans.status === 200, 'autor aceita', ans.status);
  await sleep(300);
  const bg = wb.ev.find(e => e.t === 'GUILD_CREATE' && e.d.id === g2.id);
  ok(!!bg, 'aceita: bia já está no servidor da sala', bg.status);
  const answer = wb.ev.find(e => e.t === 'LFG_ANSWER')?.d;
  ok(answer?.accept && answer.invited && answer.room?.channel_id === vch.id, 'aviso de aceite com o convite e a sala', answer && { invited: answer.invited, room: answer.room?.name });
  const inv = wb.ev.find(e => e.t === 'CALL_INVITE')?.d;
  ok(inv?.channel?.id === vch.id, 'convite para a chamada aponta para a sala do anúncio', inv?.channel?.name);
  const go = await call(b.tok, 'POST', `/lfg/posts/${p.id}/go`);
  ok(go.status === 200 && go.channel_id === vch.id && go.guild_id === g2.id, '"Ir para a sala" para quem está no grupo', go);

  // entrada direta: caio entra e já recebe a sala (a página o leva para lá), sem convite tocando
  const wc = await gw(c.tok);
  const q = await call(a.tok, 'POST', '/lfg/posts', { game: 'lol', mode: 'ARAM', slots: 1, mic: false, channel_id: vch.id, join_mode: 'open' });
  const j = await call(c.tok, 'POST', `/lfg/posts/${q.id}/request`, {});
  ok(j.joined?.room?.channel_id === vch.id && !j.joined.invited, 'entrada direta devolve a sala combinada', j.joined);
  await sleep(300);
  ok(wc.ev.some(e => e.t === 'GUILD_CREATE' && e.d.id === g2.id), 'entrada direta: caio já está no servidor da sala');
  ok(!wc.ev.some(e => e.t === 'CALL_INVITE'), 'entrada direta não toca convite');


  // jogo do PC: nome e ícone certos
  const wa = await gw(a.tok);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const send = async (game) => { wa.send(JSON.stringify({ t: 'ACTIVITY_LOCAL', d: { game } })); await sleep(3300); };
  const upd = () => wa.ev.filter(e => e.t === 'ACTIVITY_UPDATE' && e.d.user_id === a.id).pop()?.d?.activity?.game;
  await send({ id: 'start_protected_game', title: 'GPU drivers are out of date', icon: png, steam: '553850' });
  let gm = upd();
  ok(gm && !gm.icon && gm.title === 'HELLDIVERS 2' && gm.id !== 'start_protected_game', 'Easy Anti-Cheat abrindo Helldivers 2: sem o ícone do anticheat e com o nome do jogo', gm);
  await send({ id: 'javaw', title: 'Minecraft 1.21.4', icon: png });
  gm = upd();
  ok(gm && !gm.icon && gm.title === 'Minecraft' && gm.known === 'minecraft', 'Minecraft no Java: sem o ícone do Java', gm);
  await send({ id: 'valorant-win64-shipping', title: 'VALORANT  ', icon: png });
  gm = upd();
  ok(gm?.known === 'valorant' && gm.title === 'VALORANT', 'Valorant reconhecido pelo catálogo (ícone e banner oficiais na página)', gm);
  await send({ id: 'someindie', title: 'Some Indie', icon: png });
  gm = upd();
  ok(gm?.title === 'Some Indie' && !!gm.icon && !gm.known, 'jogo fora do catálogo segue com o ícone do programa', gm);
  for (const w of [wa, wb, wc]) w.close();
} catch (e) { console.error(e); fails++; }
srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
