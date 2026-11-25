// Credenciais do TURN (server/turn.js): formato do coturn com use-auth-secret (usuário "<expira>:<id>", senha
// base64(HMAC-SHA1(segredo, usuário))), conferido com o openssl; e o que vai no READY com e sem TURN configurado.
// Uso: node scripts/turn-unit-test.mjs
import { execFileSync } from 'node:child_process';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const { turnCredential, iceServers } = await import('../server/turn.js');

const c = turnCredential('segredo-teste', 'u123', 1_700_000_000_000, 48);
ok(c.username === `${1_700_000_000 + 48 * 3600}:u123`, 'usuário = expira (s) + id', c.username);
const ref = execFileSync('sh', ['-c', `printf %s '${c.username}' | openssl dgst -sha1 -hmac 'segredo-teste' -binary | base64`]).toString().trim();
ok(c.credential === ref, 'senha igual à do coturn (HMAC-SHA1 em base64)', { nossa: c.credential, openssl: ref });

delete process.env.TURN_URL; delete process.env.TURN_SECRET;
ok(iceServers('u1').length === 1 && iceServers('u1')[0].urls.startsWith('stun:'), 'sem TURN_URL: só STUN');

process.env.TURN_URL = 'turn:203.0.113.5:3478?transport=udp, turn:203.0.113.5:443?transport=tcp';
process.env.TURN_SECRET = 'abc';
const a = iceServers('u1').find(x => x.username), b = iceServers('u2').find(x => x.username);
ok(a && a.urls.length === 2 && a.urls[1] === 'turn:203.0.113.5:443?transport=tcp', 'TURN_URL com vírgula vira lista', a?.urls);
ok(a.username.endsWith(':u1') && b.username.endsWith(':u2') && a.credential !== b.credential, 'cada pessoa recebe a própria credencial');
const exp = +a.username.split(':')[0] - Date.now() / 1000;
ok(exp > 47 * 3600 && exp <= 48 * 3600 + 1, 'vale 48 h por padrão', Math.round(exp / 3600));

delete process.env.TURN_SECRET; process.env.TURN_USER = 'fixo'; process.env.TURN_PASS = 'senha';
const f = iceServers('u1').find(x => x.username);
ok(f.username === 'fixo' && f.credential === 'senha', 'sem TURN_SECRET: usuário e senha fixos (como antes)');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
