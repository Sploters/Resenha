// "Bora?" (server/bora.js) e aviso no celular (server/push.js), pela API, com um ntfy de mentira (NTFY_URL local):
// criar, contador, Tô dentro / Mais tarde / Hoje não, formar a sala, horário marcado, limites, cancelar, quem vê, e os
// avisos no celular só para quem está com o app fechado. Uso: node scripts/bora-test.mjs
import http from 'node:http';
import { ownServer } from './test-server.mjs';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ntfy de mentira: guarda o que chega
const got = [];
const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { try { got.push(JSON.parse(b)); } catch { got.push({ raw: b }); } res.end('{}'); }); });
await new Promise(r => ntfy.listen(0, r));
const BASE = await ownServer('bora', 3397, 41397, { NTFY_URL: `http://127.0.0.1:${ntfy.address().port}`, DISCOVER_OFF: '1' });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ _status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const ana = await reg('ana'), beto = await reg('beto'), caio = await reg('caio'), dani = await reg('dani'), eva = await reg('eva');
const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const u of [beto, caio, dani]) await call(u.tok, 'POST', '/invites/' + code);
// beto e caio configuraram o celular; dani desligou os avisos do Bora
await call(beto.tok, 'PUT', '/me/settings', { patch: { pushTopic: 'resenha-beto-123456' } });
await call(caio.tok, 'PUT', '/me/settings', { patch: { pushTopic: 'resenha-caio-123456', pushBora: false } });
await call(dani.tok, 'PUT', '/me/settings', { patch: { pushTopic: 'resenha-dani-123456', boraNotify: 'off' } });

const t = await call(beto.tok, 'POST', '/me/push-test', { topic: 'resenha-beto-123456' }); await sleep(200);
ok(t.ok && got.some(x => x.topic === 'resenha-beto-123456' && /Pronto/.test(x.message)), 'Testar: a mensagem chega no tópico');
ok((await call(beto.tok, 'POST', '/me/push-test', { topic: 'curto' }))._status === 400, 'Testar: tópico inválido é recusado');
got.length = 0;

const b = await call(ana.tok, 'POST', `/guilds/${g.id}/bora`, { game: 'Counter-Strike 2', appid: '730', min: 3 });
ok(b._status === 200 && b.state === 'open' && b.in.length === 1 && b.min === 3 && b.me === 'author', 'cria: Bora CS2 agora, 1/3 (quem chamou já conta)', { in: b.in?.length });
await sleep(300);
ok(got.some(x => x.topic === 'resenha-beto-123456' && /Bora Counter-Strike 2/.test(x.title)), 'celular: beto (app fechado) recebe "Bora Counter-Strike 2?"', got.map(x => x.title));
ok(!got.some(x => x.topic === 'resenha-caio-123456'), 'celular: caio desligou o Bora no celular: nada');
ok(!got.some(x => x.topic === 'resenha-dani-123456'), 'celular: dani desligou os avisos do Bora: nada');
ok((await call(ana.tok, 'POST', `/guilds/${g.id}/bora`, { game: 'Valorant' }))._status === 409, 'um Bora vivo por pessoa e servidor');
ok((await call(eva.tok, 'GET', '/bora')).length === undefined || !(await call(eva.tok, 'GET', '/bora'))[0], 'quem não é do servidor não vê');
ok((await call(eva.tok, 'POST', `/bora/${b.id}/answer`, { state: 'in' }))._status === 404, 'quem não é do servidor não responde');

let r = await call(beto.tok, 'POST', `/bora/${b.id}/answer`, { state: 'in' });
ok(r.in.length === 2 && r.state === 'open' && r.me === 'in', 'beto: Tô dentro → 2/3');
r = await call(dani.tok, 'POST', `/bora/${b.id}/answer`, { state: 'later' });
ok(r.later.length === 1 && r.me === 'later', 'dani: Mais tarde');
r = await call(dani.tok, 'POST', `/bora/${b.id}/answer`, { state: 'out' });
ok(r.later.length === 0 && r.out === 1 && r.me === 'out', 'dani muda para Hoje não');
await call(dani.tok, 'POST', `/bora/${b.id}/answer`, { state: 'later' });
got.length = 0;
r = await call(caio.tok, 'POST', `/bora/${b.id}/answer`, { state: 'in' });
ok(r.state === 'formed' && r.channel?.name && r.in.length === 3, 'caio topa → 3/3: Formou! com sala', r.channel);
await sleep(300);
ok(got.some(x => x.topic === 'resenha-beto-123456' && /Formou/.test(x.title)) && got.some(x => x.topic === 'resenha-dani-123456' && /Formou/.test(x.title)),
  'celular: "Formou!" para quem topou e para quem disse Mais tarde (dani: o aviso de formou vale mesmo com o Bora novo desligado)', got.map(x => x.topic + ':' + x.title));
const list = await call(beto.tok, 'GET', '/bora');
ok(Array.isArray(Object.values(list).filter(x => x?.id)) && Object.values(list).some(x => x?.id === b.id && x.me === 'in'), 'GET /bora lista o Bora com a minha resposta');
ok((await call(beto.tok, 'POST', `/bora/${b.id}/cancel`))._status === 403, 'só quem chamou cancela');
r = await call(ana.tok, 'POST', `/bora/${b.id}/cancel`);
ok(r.state === 'ended' && r.end_reason === 'canceled', 'quem chamou cancela');
ok((await call(beto.tok, 'POST', `/bora/${b.id}/answer`, { state: 'in' }))._status === 410, 'responder Bora encerrado: 410');

// horário marcado: forma só perto do horário
const at = Date.now() + 3 * 3600e3;
const b2 = await call(beto.tok, 'POST', `/guilds/${g.id}/bora`, { at, min: 2 });
ok(b2.game === null && b2.starts_at === at, 'Bora "só resenhar" às tantas');
r = await call(ana.tok, 'POST', `/bora/${b2.id}/answer`, { state: 'in' });
ok(r.state === 'open' && r.in.length === 2, 'número bateu, mas ainda falta muito para o horário: continua aberto (sem sala)');
ok((await call(caio.tok, 'POST', `/guilds/${g.id}/bora`, { at: Date.now() + 2 * 864e5 }))._status === 400, 'outro dia: recusado (é evento)');
const b3 = await call(caio.tok, 'POST', `/guilds/${g.id}/bora`, { at: Date.now() + 60e3, min: 99 });
ok(b3.starts_at === null && b3.min === 10, '"daqui a 1 min" vira agora; mínimo limitado a 10');
ntfy.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nBORA OK'); process.exit(fails ? 1 : 0);
