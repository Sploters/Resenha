// Segurança de contas e sessões (server/accounts.js): política de senha, token guardado com hash, migração de tokens
// antigos, bloqueio de tentativas erradas, trocar a senha encerra as outras sessões (e a conexão aberta delas) e
// expiração por falta de uso. Uso: node scripts/account-security-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';

const PORT = 3297, BASE = `http://localhost:${PORT}`, DATA = './.testdata-acct';
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  srv.out = ''; srv.stdout.on('data', d => { srv.out += d; });
  for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(200); } }
};
const stop = async () => { srv.kill(); await new Promise(r => srv.once('exit', r)); };
const call = async (tok, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const db = () => new DatabaseSync(DATA + '/resenha.db');
const wsOpen = (tok) => new Promise((res, rej) => { const w = new WebSocket(`ws://localhost:${PORT}/gateway?token=${tok}`); w.on('open', () => res(w)); w.on('error', rej); w.on('unexpected-response', (_q, r) => rej(new Error('HTTP ' + r.statusCode))); });

try {
  await start();
  // ---- política de senha ----
  for (const [pw, why] of [['abc12', /curta/], ['senha123', /muito usada/], ['12345678', /muito usada|sequência/], ['aaaaaaaaa', /repetido/], ['abcdefghi', /sequência/], ['marcela99', /nome de usuário/]]) {
    const r = await call('', 'POST', '/register', { username: 'marcela', password: pw });
    ok(r.status === 400 && why.test(r.error), `senha "${pw}" recusada`, r.error);
  }
  const a = await call('', 'POST', '/register', { username: 'marcela', password: 'cavalo-azul-pulou' });
  ok(!!a.token, 'senha boa aceita');
  // ---- token guardado com hash ----
  { const d = db(); const rows = d.prepare('SELECT token FROM sessions').all(); d.close();
    ok(rows.length === 1 && rows[0].token === sha(a.token) && rows[0].token !== a.token, 'banco guarda só o hash do token'); }
  ok((await call(a.token, 'GET', '/users/0')).status !== 401, 'token funciona');
  // ---- login: tentativas erradas ----
  const b1 = await call('', 'POST', '/login', { username: 'marcela', password: 'cavalo-azul-pulou' });
  ok(!!b1.token, 'login certo funciona');
  let last;
  for (let i = 0; i < 5; i++) last = await call('', 'POST', '/login', { username: 'marcela', password: 'errada' + i });
  ok(last.status === 401, '5 tentativas erradas: ainda "senha inválida"', last);
  const locked = await call('', 'POST', '/login', { username: 'marcela', password: 'cavalo-azul-pulou' });
  ok(locked.status === 429 && /tentativas erradas nesta conta/.test(locked.error), 'depois de 5 erradas: espera, mesmo com a senha certa', locked.error);
  const other = await call('', 'POST', '/register', { username: 'outra', password: 'pato-verde-nadou' });
  ok(!!other.token && !!(await call('', 'POST', '/login', { username: 'outra', password: 'pato-verde-nadou' })).token, 'outra conta não é afetada');
  ok((await call('', 'POST', '/login', { username: 'naoexiste', password: 'x' })).status === 401, 'conta inexistente: "usuário ou senha inválidos"');
  // ---- trocar a senha encerra as outras sessões ----
  const ws = await wsOpen(b1.token); const closed = new Promise(r => ws.on('close', (code) => r(code)));
  ok((await call(a.token, 'POST', '/me/password', { old: 'cavalo-azul-pulou', new: '12345678' })).status === 400, 'senha nova fraca recusada ao trocar');
  const ch = await call(a.token, 'POST', '/me/password', { old: 'cavalo-azul-pulou', new: 'girafa-roxa-dormiu' });
  ok(ch.status === 200 && ch.ended === 1, 'senha trocada; 1 outra sessão encerrada', ch);
  ok((await call(b1.token, 'GET', '/users/0')).status === 401, 'a outra sessão deixou de valer');
  ok((await call(a.token, 'GET', '/users/0')).status !== 401, 'a sessão de quem trocou continua');
  ok(await Promise.race([closed, sleep(3000).then(() => 'aberta')]) === 4001, 'conexão aberta da outra sessão foi fechada (4001)');
  // ---- expiração por falta de uso ----
  const c1 = (await call('', 'POST', '/login', { username: 'outra', password: 'pato-verde-nadou' })).token;
  { const d = db(); d.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(Date.now() - 31 * 864e5, sha(c1)); d.close(); }
  ok((await call(c1, 'GET', '/users/0')).status === 401, 'sessão sem uso há 31 dias: expirada');
  { const d = db(); const n = d.prepare('SELECT COUNT(*) n FROM sessions WHERE token=?').get(sha(c1)).n; d.close(); ok(n === 0, 'sessão expirada apagada do banco'); }
  const c2 = (await call('', 'POST', '/login', { username: 'outra', password: 'pato-verde-nadou' })).token;
  { const d = db(); d.prepare('UPDATE sessions SET created_at=? WHERE token=?').run(Date.now() - 181 * 864e5, sha(c2)); d.close(); }
  ok((await call(c2, 'GET', '/users/0')).status === 401, 'sessão criada há 181 dias: expirada mesmo em uso');
  const list = await (await fetch(BASE + '/api/sessions', { headers: { authorization: 'Bearer ' + other.token } })).json();
  ok(Array.isArray(list) && list.some(s => s.current) && list.every(s => /^[0-9a-f]{12}$/.test(s.id)), 'lista de sessões continua funcionando', list.length);
  // ---- migração: token antigo guardado como texto continua valendo ----
  await stop();
  const legacy = crypto.randomBytes(32).toString('hex');
  { const d = db(); const uid = d.prepare("SELECT id FROM users WHERE username='outra'").get().id;
    d.prepare('INSERT INTO sessions(token,user_id,created_at,agent) VALUES(?,?,?,?)').run(legacy, uid, Date.now(), 'antigo');
    d.prepare('UPDATE sessions SET token=? WHERE token=?').run(other.token, sha(other.token)); // também a de antes
    d.prepare("DELETE FROM meta WHERE k='sessions-hash-1'").run(); d.close(); }
  await start();
  ok((await call(legacy, 'GET', '/users/0')).status !== 401 && (await call(other.token, 'GET', '/users/0')).status !== 401, 'depois da migração, os aparelhos antigos continuam logados');
  { const d = db(); const raw = d.prepare('SELECT COUNT(*) n FROM sessions WHERE token IN (?,?)').get(legacy, other.token).n; d.close(); ok(raw === 0, 'nenhum token em texto puro sobrou no banco'); }
  ok(/passaram a ser guardados com hash/.test(srv.out), 'servidor avisou a migração');
} catch (e) { console.log('  EXCEÇÃO', e.stack); fails++; }
await stop().catch(() => { });
console.log(fails ? `\n${fails} FALHA(S)` : '\nCONTAS OK');
process.exit(fails ? 1 : 0);
