// Registro de mensagens (server/msglog.js): edição e exclusão registradas com antes/depois e responsável, DMs fora,
// permissão própria (dono/Administrador ou "Ver registro de mensagens"), filtros, busca, retenção e registros imutáveis.
// Uso: node scripts/msglog-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const PORT = 3417, BASE = `http://localhost:${PORT}`, DIR = './.testdata-msglog';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DIR, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC: '0', GAMES_SYNC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
try {
  const dono = await reg('dono'), mod = await reg('mod'), ana = await reg('ana');
  const g = await call(dono.tok, 'POST', '/guilds', { name: 'G' }), code = (await call(dono.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [mod, ana]) await call(u.tok, 'POST', '/invites/' + code);
  const ch = await call(dono.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'papo', type: 0 });
  const m1 = await call(ana.tok, 'POST', `/channels/${ch.id}/messages`, { content: 'bora jogar às 21h' });
  ok(m1.id, 'mensagem enviada', m1);
  await call(ana.tok, 'PATCH', `/channels/${ch.id}/messages/${m1.id}`, { content: 'bora jogar às 22h' });
  const m2 = await call(ana.tok, 'POST', `/channels/${ch.id}/messages`, { content: 'texto que o dono apaga' });
  await call(dono.tok, 'DELETE', `/channels/${ch.id}/messages/${m2.id}`);
  const m3 = await call(ana.tok, 'POST', `/channels/${ch.id}/messages`, { content: 'apaguei eu mesma' });
  await call(ana.tok, 'DELETE', `/channels/${ch.id}/messages/${m3.id}`);
  // DM: nunca entra
  await call(dono.tok, 'POST', '/relationships', { username: 'ana' }); await call(ana.tok, 'PUT', '/relationships/' + dono.id, {});
  const dm = await call(dono.tok, 'POST', '/dms', { user_id: ana.id });
  ok(dm.id, 'DM aberta', dm);
  if (dm.id) { const dmm = await call(dono.tok, 'POST', `/channels/${dm.id}/messages`, { content: 'segredo na dm' }); await call(dono.tok, 'PATCH', `/channels/${dm.id}/messages/${dmm.id}`, { content: 'segredo editado' }); await call(dono.tok, 'DELETE', `/channels/${dm.id}/messages/${dmm.id}`); }

  const r = await call(dono.tok, 'GET', `/guilds/${g.id}/msglog`);
  ok(r.status === 200 && r.entries.length === 3, 'dono vê 3 registros (1 edição, 2 exclusões)', r);
  const ed = r.entries.find(e => e.kind === 'edit');
  ok(ed && ed.before === 'bora jogar às 21h' && ed.after === 'bora jogar às 22h' && ed.author_id === ana.id && ed.channel_name === 'papo', 'edição com antes, depois, autor e canal', ed);
  const byOwner = r.entries.find(e => e.message_id === m2.id), self = r.entries.find(e => e.message_id === m3.id);
  ok(byOwner?.actor_id === dono.id && byOwner.author_id === ana.id && byOwner.before === 'texto que o dono apaga', 'exclusão por moderador: autor, responsável e conteúdo', byOwner);
  ok(self?.actor_id === ana.id && self.author_id === ana.id, 'exclusão pelo próprio autor identificada', self);
  ok(!r.entries.some(e => /segredo/.test(e.before + e.after)), 'conversa direta não é registrada');
  ok(r.keep_days === 30 && r.can_configure === true, 'retenção padrão de 30 dias; dono pode configurar', r);
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog?kind=edit`)).entries.length === 1, 'filtro por tipo');
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog?q=22h`)).entries.length === 1, 'busca no texto');
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog?q=%25`)).entries.length === 0, 'busca trata % como texto');
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog?user=${dono.id}`)).entries.length === 1, 'filtro por pessoa (autor ou responsável)');
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog?channel=x`)).entries.length === 0, 'filtro por canal');
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog?from=${Date.now() + 60000}`)).entries.length === 0, 'filtro por período');
  // permissões
  ok((await call(ana.tok, 'GET', `/guilds/${g.id}/msglog`)).status === 403, 'membro comum não vê');
  const role = await call(dono.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'mod', perms: 8 }); // só Gerenciar mensagens
  await call(dono.tok, 'PATCH', `/guilds/${g.id}/members/${mod.id}`, { roles: [role.id] });
  ok((await call(mod.tok, 'GET', `/guilds/${g.id}/msglog`)).status === 403, 'moderador sem "Ver registro de mensagens" não vê');
  await call(dono.tok, 'PATCH', `/roles/${role.id}`, { perms: 8 | 1024 });
  const rm = await call(mod.tok, 'GET', `/guilds/${g.id}/msglog`);
  ok(rm.status === 200 && rm.entries.length === 3 && rm.can_configure === false, 'com a permissão vê, mas não configura', rm);
  ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/msglog`, { days: 0 })).status === 403, 'moderador não muda a retenção');
  ok((await call(mod.tok, 'GET', `/guilds/${g.id}/audit`)).status === 403, 'registro de moderação continua só para quem gerencia');
  // imutável
  const db = new DatabaseSync(DIR + '/resenha.db');
  let blocked = false; try { db.prepare("UPDATE message_log SET before='x'").run(); } catch { blocked = true; }
  ok(blocked, 'banco recusa alterar um registro');
  // retenção: 7 dias tira o que tem mais de 7 dias; desligar apaga tudo e para de registrar
  db.prepare('INSERT INTO message_log(id,guild_id,kind,before,created_at) VALUES(?,?,?,?,?)').run('0000old', g.id, 'delete', 'velho', Date.now() - 10 * 864e5);
  ok((await call(dono.tok, 'GET', `/guilds/${g.id}/msglog`)).entries.some(e => e.before === 'velho'), 'com 30 dias, mostra o de 10 dias');
  ok((await call(dono.tok, 'PATCH', `/guilds/${g.id}/msglog`, { days: 7 })).keep_days === 7, 'retenção muda para 7 dias');
  ok(!db.prepare("SELECT 1 FROM message_log WHERE before='velho'").get(), 'o que passou de 7 dias é apagado');
  ok((await call(dono.tok, 'PATCH', `/guilds/${g.id}/msglog`, { days: 5 })).status === 400, 'prazo fora da lista é recusado');
  const au = await call(dono.tok, 'GET', `/guilds/${g.id}/audit`);
  ok(au.entries.some(e => e.action === 'msglog_settings' && e.details === '7 dias'), 'mudança de retenção vai para o registro de auditoria');
  await call(dono.tok, 'PATCH', `/guilds/${g.id}/msglog`, { days: 0 });
  ok(db.prepare('SELECT COUNT(*) n FROM message_log WHERE guild_id=?').get(g.id).n === 0, 'desligar apaga os registros');
  const m4 = await call(ana.tok, 'POST', `/channels/${ch.id}/messages`, { content: 'depois de desligar' }); await call(ana.tok, 'DELETE', `/channels/${ch.id}/messages/${m4.id}`);
  ok(db.prepare('SELECT COUNT(*) n FROM message_log WHERE guild_id=?').get(g.id).n === 0, 'desligado: nada novo é registrado');
  db.close();
} finally { srv.kill(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
