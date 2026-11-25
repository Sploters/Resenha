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

// TURN da Cloudflare: pede credenciais à API com a chave (que não vai para o app) e entrega os servidores no READY
delete process.env.TURN_URL; delete process.env.TURN_USER; delete process.env.TURN_PASS;
process.env.CF_TURN_KEY_ID = 'chave-id'; process.env.CF_TURN_API_TOKEN = 'token-secreto';
const { refreshCf } = await import('../server/turn.js');
let asked = null;
const fakeFetch = async (url, o) => { asked = { url, auth: o.headers.authorization, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'cf-user', credential: 'cf-pass' }] }) }; };
ok(await refreshCf(fakeFetch), 'pegou as credenciais da Cloudflare');
ok(asked.url === 'https://rtc.live.cloudflare.com/v1/turn/keys/chave-id/credentials/generate-ice-servers' && asked.auth === 'Bearer token-secreto' && asked.body.ttl === 48 * 3600, 'pedido certo à API', asked);
const ice = iceServers('u1'), cfs = ice.find(x => x.username === 'cf-user');
ok(cfs && cfs.credential === 'cf-pass' && cfs.urls.length === 2, 'READY leva o TURN da Cloudflare', ice);
ok(!JSON.stringify(ice).includes('token-secreto'), 'a chave da API não vai para o app');
ok(!(await refreshCf(async () => ({ ok: false, status: 401 }))) && iceServers('u1').some(x => x.username === 'cf-user'), 'falha na renovação: continua com a credencial anterior');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
