// Log estruturado (server/log.js) e pacote de diagnóstico do administrador (GET /api/health/diag, server/health.js):
// segredos escondidos (senha, token, cookie, Authorization, JWT, ?token=, chave do GitHub, fim dos IPs), anel limitado,
// console capturado, e o diagnóstico só para o administrador, com versões, saúde, SFU, log e sem o token de ninguém.
// Uso: node scripts/log-diag-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { redact, redactText, log, captureConsole, recentLogs } from '../server/log.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- redação ----
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiIxMjM0NSJ9.c2VncmVkb2RhYXNzaW5hdHVyYQ';
const r = redact({ password: 'hunter2', senha: 'x', token: 'abc', cookie: 'sid=1', Authorization: 'Bearer zzz', nested: { apiKey: 'k', list: [{ secret: 's' }] }, sig: 'AAAA',
  ok: true, n: 3, empty: '', msg: `GET /x?token=abcdef&page=2 Authorization: Bearer abcdefghijk ${JWT} ghp_abcdefghijklmnopqrstu de 203.0.113.77`, ip6: '2001:db8:85a3:1:2:3:4:5' }, { ips: true });
ok(['password', 'senha', 'token', 'cookie', 'Authorization', 'sig'].every(k => r[k] === '[oculto]'), 'campos com nome de segredo escondidos', r);
ok(r.nested.apiKey === '[oculto]' && r.nested.list[0].secret === '[oculto]', 'segredos em objetos e listas aninhados');
ok(r.ok === true && r.n === 3 && r.empty === '', 'o resto fica igual (booleano, número, vazio)');
ok(!/abcdef&|abcdefghijk|eyJhbGci|ghp_abc|\.77\b/.test(r.msg) && /page=2/.test(r.msg) && /203\.0\.113\.x/.test(r.msg), 'no texto: ?token=, Bearer, JWT, chave do GitHub e o fim do IP', r.msg);
ok(!/:4:5\b/.test(r.ip6) && r.ip6.startsWith('2001:db8:85a3:1'), 'IPv6: só o começo fica', r.ip6);
ok(/203\.0\.113\.77/.test(redactText('de 203.0.113.77')), 'sem { ips: true } o IP fica (log do terminal)');
ok(redactText('{"password":"abc","x":1}') === '{"password":"[oculto]","x":1}', 'JSON em texto: "password":"…" escondido');
const deep = {}; let p = deep; for (let i = 0; i < 20; i++) p = p.x = {};
ok(JSON.stringify(redact(deep)).includes('[…]'), 'objeto fundo demais é cortado (sem estourar a pilha)');

// ---- logger + anel ----
const out = []; const orig = console.log; console.log = (...a) => out.push(a.join(' '));
const L = log('teste');
L.info('entrou', { user: 'bia', token: 'segredo123' });
console.log = orig;
ok(out.length === 1 && /\[teste\] entrou user=bia token=\[oculto\]/.test(out[0]) && !out[0].includes('segredo123'), 'linha do log: componente, mensagem e campos, sem o token', out[0]);
const e = recentLogs().at(-1);
ok(e.c === 'teste' && e.lvl === 'info' && e.msg === 'entrou' && e.token === '[oculto]' && /^\d{4}-\d\d-\d\dT/.test(e.t), 'entrada no anel (hora, nível, componente)', e);
captureConsole();
const so = process.stdout.write.bind(process.stdout); process.stdout.write = () => true;
for (let i = 0; i < 700; i++) console.log('linha', i, 'Bearer abcdefghijk');
process.stdout.write = so;
const ring = recentLogs();
ok(ring.length === 500 && ring.at(-1).msg === 'linha 699 Bearer [oculto]' && ring.at(-1).c === 'console', 'console capturado, com redação, e anel limitado a 500', ring.at(-1));
process.env.LOG_FORMAT = 'json'; const out2 = []; const ow = console.warn;
console.warn = (...a) => out2.push(a.join(' '));
L.warn('aviso json', { password: 'p' });
console.warn = ow; delete process.env.LOG_FORMAT;
const j = (() => { try { return JSON.parse(out2.at(-1)); } catch { return null; } })();
ok(j && j.lvl === 'warn' && j.c === 'teste' && j.password === '[oculto]', 'LOG_FORMAT=json: uma linha JSON por evento', j);
ok(recentLogs().filter(x => x.msg === 'aviso json').length === 1, 'log do logger não entra duas vezes no anel (pelo console capturado)');

// ---- diagnóstico do administrador ----
const PORT = 3377, BASE = `http://localhost:${PORT}`, DATA = './.testdata-logdiag';
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41262', RTC_IPS: '127.0.0.1', HEALTH_SAMPLE_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let sout = ''; srv.stdout.on('data', d => { sout += d; }); srv.stderr.on('data', d => { sout += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
try {
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
  const api = (tok, m, path, b) => fetch(BASE + '/api' + path, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const adm = (await (await api('', 'POST', '/register', { username: 'admin', password: 'Teste.senha-123' })).json()).token; await sleep(20);
  const usr = (await (await api('', 'POST', '/register', { username: 'bia', password: 'Teste.senha-123' })).json()).token;
  ok((await api('', 'GET', '/health/diag')).status === 401, 'sem login: 401');
  ok((await api(usr, 'GET', '/health/diag')).status === 403, 'quem não é administrador: 403');
  await sleep(2500);
  const res = await api(adm, 'GET', '/health/diag'), txt = await res.text(); let d = null; try { d = JSON.parse(txt); } catch { }
  ok(res.status === 200 && d?.tipo === 'resenha-diagnostico-servidor', 'administrador baixa o diagnóstico', res.status);
  ok(/attachment; filename="diagnostico-resenha-/.test(res.headers.get('content-disposition') || ''), 'vem como arquivo para baixar');
  ok(d?.versoes?.node === process.version && d.versoes.servidor && d.noAr?.processoMin >= 0, 'versões e tempo no ar', d?.versoes);
  ok(d?.agora?.memTotalMB > 0 && Array.isArray(d.sfu?.workers) && Array.isArray(d.historico), 'saúde de agora, histórico e workers do SFU', { workers: d?.sfu?.workers?.length });
  ok(Array.isArray(d?.log) && d.log.length > 0 && Array.isArray(d.erros) && Array.isArray(d.alertas), 'log recente, erros e alertas', { log: d?.log?.length });
  ok(!txt.includes(adm) && !txt.includes(usr) && !txt.includes('Teste.senha-123'), 'nenhum token nem senha no pacote');
  ok(Array.isArray(d?.variaveis) && d.variaveis.includes('HEALTH_SAMPLE_MS') && !txt.includes('41262"') , 'variáveis: só os nomes, nunca os valores', d?.variaveis);
} catch (e) { console.log('  EXCEÇÃO', e.stack); fails++; }
srv.kill('SIGKILL'); fs.rmSync(DATA, { recursive: true, force: true });
if (fails) console.log(sout.split('\n').slice(-20).join('\n'));
console.log(fails ? `\n${fails} FALHA(S)` : '\nLOG E DIAGNÓSTICO OK');
process.exit(fails ? 1 : 0);
