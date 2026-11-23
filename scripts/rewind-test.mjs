// Rewind (resumo da semana, do mês e do ano) e sugestões de jogos para a turma: períodos, navegação para trás, rótulos,
// compatibilidade com ?year= e quem pode ver. Sem Steam (DISCOVER_OFF): as sugestões vêm vazias, mas com as sementes.
// Uso: node scripts/rewind-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { ownServer } from './test-server.mjs';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const BASE = await ownServer('rewind', 3396, 41396, { DISCOVER_OFF: '1' });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ _status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const ana = await reg('ana'), bia = await reg('bia');
const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' });
const db = new DatabaseSync('./.testdata-rewind/resenha.db');
db.prepare('UPDATE guilds SET created_at=? WHERE id=?').run(Date.now() - 400 * 864e5, g.id); // servidor antigo: dá para voltar
const ch = db.prepare('SELECT id FROM channels WHERE guild_id=? AND type=0 LIMIT 1').get(g.id);
await call(ana.tok, 'POST', `/channels/${ch.id}/messages`, { content: 'bora' });
db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)').run('x1', ana.id, 'pc', 'game_stop', 'deadlock', 'Deadlock', JSON.stringify({ seconds: 4000, steam: '1422450' }), Date.now() - 3600e3);

const now = new Date();
const w = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?period=week`);
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
ok(w.period === 'week' && w.from === monday.getTime() && w.to - w.from === 7 * 864e5, 'semana: de segunda a domingo', { label: w.label });
ok(w.group?.messages >= 1 && w.has_prev === true && w.has_next === false, 'semana atual: conta a mensagem; dá para voltar, não para avançar');
const w1 = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?period=week&offset=-1`);
ok(w1.to === w.from && w1.has_next === true && w1.group.messages === 0, 'semana anterior: termina onde a atual começa, sem a mensagem de hoje');
const m = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?period=month`), m1 = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?period=month&offset=-1`);
ok(new Date(m.from).getDate() === 1 && new Date(m.from).getMonth() === now.getMonth() && /de \d{4}$/.test(m.label), 'mês: do dia 1 ao fim do mês', m.label);
ok(m1.to === m.from, 'mês anterior encaixa no atual', m1.label);
const y = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?period=year`), yOld = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?year=${now.getFullYear() - 1}`);
ok(y.label === String(now.getFullYear()) && y.year === now.getFullYear(), 'ano atual', y.label);
ok(yOld.year === now.getFullYear() - 1 && yOld.period === 'year', '?year= (antigo) continua valendo', yOld.label);
const far = await call(ana.tok, 'GET', `/guilds/${g.id}/retro?period=year&offset=-3`);
ok(far.has_prev === false, 'não deixa voltar a antes da criação do servidor');
ok((await call(bia.tok, 'GET', `/guilds/${g.id}/retro?period=week`))._status === 404, 'quem não é do servidor não vê o resumo');
const s = await call(ana.tok, 'GET', `/guilds/${g.id}/suggestions`);
ok(s._status === 200 && Array.isArray(s.items) && s.seeds?.[0]?.appid === '1422450', 'sugestões: sementes vêm do que a turma joga (Steam desligada: sem itens)', s.seeds);
ok((await call(bia.tok, 'GET', `/guilds/${g.id}/suggestions`))._status === 404, 'quem não é do servidor não vê as sugestões');
console.log(fails ? `\n${fails} FALHA(S)` : '\nREWIND OK'); process.exit(fails ? 1 : 0);
