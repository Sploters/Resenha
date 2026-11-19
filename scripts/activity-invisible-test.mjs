// Modo invisível esconde o jogo ("Ativo agora", READY, feed, tempo real) e não deixa histórico; programas da própria
// Resenha (lc-stream-poc: janela de teste "Resenha PoC captura" em tela cheia) nunca viram "Jogando".
// Uso: node scripts/activity-invisible-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const PORT = 3431, BASE = `http://127.0.0.1:${PORT}`, DATA = '.testdata-actinv';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- detector do app desktop ----------
const A = createRequire(import.meta.url)('../desktop/appaudio.js');
ok(!A.isGame({ exe: 'C:\\Users\\x\\Downloads\\pacote-poc-dxgi\\lc-stream-poc.exe', title: 'Resenha PoC captura', fullscreen: true }), 'desktop: lc-stream-poc em tela cheia não é jogo');
ok(!A.isGame({ exe: 'C:\\Games\\lc-stream.exe', title: 'x', fullscreen: true }), 'desktop: lc-stream não é jogo, nem dentro de uma pasta Games');
ok(!A.isGame({ exe: 'C:\\x\\qualquer.exe', title: 'Resenha PoC captura', fullscreen: true }), 'desktop: janela com título "Resenha…" não é jogo');
ok(A.isGame({ exe: 'C:\\Games\\Foo\\foo.exe', title: 'Foo', fullscreen: true }), 'desktop: jogo comum continua sendo detectado');

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41171', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const sfx = Math.random().toString(36).slice(2, 6), U = {};
const connect = (n) => new Promise(res => {
  const u = U[n]; u.ev = []; u.ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + u.tok);
  u.ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'READY') { u.ready = m.d; u.id = m.d.user.id; res(); } else if (m.t === 'ACTIVITY_UPDATE') u.ev.push(m.d); });
});
const send = (n, game) => U[n].ws.send(JSON.stringify({ t: 'ACTIVITY_LOCAL', d: { game } }));
const playing = async (viewer, owner) => (await call(U[viewer].tok, 'GET', '/activity/feed')).friends.find(f => f.user_id === U[owner].id)?.playing || [];
try {
  for (const n of ['ana', 'beto']) { const r = await call('', 'POST', '/register', { username: n + sfx, password: 'Teste.senha-12345' }); U[n] = { tok: r.token }; await connect(n); }
  await call(U.ana.tok, 'POST', '/relationships', { username: 'beto' + sfx }); await call(U.beto.tok, 'PUT', '/relationships/' + U.ana.id, {});
  await sleep(300);

  // ---------- programa da Resenha (app antigo ainda manda): o servidor barra ----------
  send('ana', { id: 'lc-stream-poc', title: 'Resenha PoC captura' }); await sleep(600);
  ok(!U.beto.ev.some(e => e.activity), 'servidor: "Resenha PoC captura" não é publicado', U.beto.ev);
  ok((await playing('beto', 'ana')).length === 0, 'servidor: nada em "Ativo agora"');

  // ---------- invisível ----------
  await call(U.ana.tok, 'PATCH', '/me', { status: 'invisible' }); await sleep(3200); U.beto.ev = [];
  send('ana', { id: 'valorant', title: 'VALORANT' }); await sleep(600);
  ok(!U.beto.ev.some(e => e.activity), 'invisível: o amigo não recebe "Jogando VALORANT"', U.beto.ev);
  ok((await playing('beto', 'ana')).length === 0, 'invisível: nada no "Ativo agora" do amigo');
  ok((await playing('ana', 'ana')).length === 1, 'invisível: a própria pessoa ainda vê o próprio jogo');
  U.beto.ws.close(); await connect('beto');
  ok(!U.beto.ready.activities.some(a => a.user_id === U.ana.id), 'invisível: o READY do amigo não traz o jogo');

  const tOn = Date.now(); await call(U.ana.tok, 'PATCH', '/me', { status: 'online' }); await sleep(400);
  ok(U.beto.ev.some(e => e.user_id === U.ana.id && e.activity?.game.id === 'valorant'), 'voltou a online: o amigo passa a ver o jogo atual');
  await call(U.ana.tok, 'PATCH', '/me', { status: 'invisible' }); const tOff = Date.now(); await sleep(400);
  ok(U.beto.ev.at(-1)?.activity === null, 'ficou invisível de novo: o jogo some na hora para o amigo', U.beto.ev.at(-1));
  await sleep(2700); send('ana', null); await sleep(600);
  await call(U.ana.tok, 'PATCH', '/me', { status: 'online' }); await sleep(300);
  const f = await call(U.beto.tok, 'GET', '/activity/feed');
  const evA = f.events.filter(e => e.user_id === U.ana.id);
  ok(evA.length === 2 && evA.every(e => e.game.id === 'valorant' && e.at >= tOn && e.at <= tOff),
    'no histórico só o trecho em que estava online (o amigo viu ao vivo); nada do PoC nem dos trechos invisíveis', f.events);
} catch (e) { console.error(e); fails++; }
finally { for (const u of Object.values(U)) u.ws?.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); process.exit(fails ? 1 : 0);
