// em-chamada.json (server/index.js): o deploy (deploy/umbrel.sh) lê a contagem para esperar a chamada acabar e só confia
// num arquivo de menos de 60 s. Confere: sem chamada o servidor não regrava à toa (antes: a cada 10 s, 24 h por dia);
// com gente em chamada continua atualizando a cada ~10 s; ao sair, grava a contagem zerada e para de novo.
// Uso: node scripts/emchamada-test.mjs
import WebSocket from 'ws';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('emchamada', 3345, 41350), FILE = './.testdata-emchamada/em-chamada.json';
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
// observa o arquivo por ms: quantas vezes mudou desde o começo da observação e o último conteúdo
const read = () => { try { return fs.readFileSync(FILE, 'utf8'); } catch { return ''; } };
const watch = async (ms) => { let last = read(), n = 0, d = last ? JSON.parse(last) : null; const end = Date.now() + ms;
  while (Date.now() < end) { let s = ''; try { s = fs.readFileSync(FILE, 'utf8'); } catch { } if (s && s !== last) { n++; last = s; d = JSON.parse(s); } await sleep(250); }
  return { writes: n, last: d }; };
const tok = (await call('', 'POST', '/register', { username: 'emchamada', password: 'Teste.senha-123' })).token;
const g = await call(tok, 'POST', '/guilds', { name: 'T' });
const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok);
const gc = await new Promise((res) => ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'GUILD_CREATE' && m.d.id === g.id) res(m.d); if (m.t === 'READY') { const x = m.d.guilds?.find(y => y.id === g.id); if (x) res(x); } }));
const vch = gc.channels.find(c => c.type === 2);
const idle = await watch(25000);
ok(idle.writes === 0 && idle.last?.inCalls === 0, 'sem chamada: nenhuma regravação em 25 s (só a inicial, na subida)', idle);
ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: vch.id } }));
const inCall = await watch(25000);
ok(inCall.last?.inCalls === 1 && inCall.writes >= 2, 'em chamada: contagem certa e regravada a cada ~10 s', inCall);
ok(inCall.last && Date.now() - inCall.last.t < 15000, 'em chamada: arquivo sempre recente (o deploy só confia em menos de 60 s)', inCall.last && Date.now() - inCall.last.t);
ws.send(JSON.stringify({ t: 'VOICE_LEAVE', d: {} }));
const left = await watch(12000);
ok(left.last?.inCalls === 0, 'saiu: grava a contagem zerada', left);
const after = await watch(25000);
ok(after.writes === 0, 'depois de sair: para de regravar', after);
ws.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nEM-CHAMADA OK'); process.exit(fails ? 1 : 0);
