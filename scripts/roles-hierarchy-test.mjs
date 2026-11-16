// Hierarquia de cargos (server/index.js rankOf/outranks): quem está abaixo não expulsa, bane, castiga, renomeia nem
// mexe nos cargos de quem está acima; ninguém dá permissão que não tem; cargos só se movem abaixo do seu.
// Uso: node scripts/roles-hierarchy-test.mjs (sobe um servidor próprio) ou BASE=http://localhost:3111 node scripts/roles-hierarchy-test.mjs
import { ownServer } from './test-server.mjs';
import WebSocket from 'ws';
const BASE = process.env.BASE || await ownServer('hierarchy', 3344, 41350);
let fails = 0, last = null;
const ok = (c, msg) => { if (!c) console.log("   last:", JSON.stringify(last));  console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return (last = { status: r.status, data: await r.json().catch(() => ({})) });
};
const sfx = Math.random().toString(36).slice(2, 7);
const user = async (name) => { const tok = (await call('', 'POST', '/register', { username: name + sfx, password: 'Teste.senha-123' })).data.token; return { tok, id: await myId(tok) }; };
// id da conta: vem no READY do gateway
const ready = (tok) => new Promise((res) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), t = setTimeout(() => { ws.terminate(); res(null); }, 5000);
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') { clearTimeout(t); ws.close(); res(m.d); } });
});
const myId = async (tok) => (await ready(tok))?.user.id;
const P = { ADMIN: 1, MANAGE_GUILD: 2, KICK: 16, MANAGE_ROLES: 64, BAN: 128, MODERATE: 256 };

const [own, adm, mod, mem, mem2] = [await user('dono'), await user('admin'), await user('mod'), await user('membro'), await user('membro2')];
const g = (await call(own.tok, 'POST', '/guilds', { name: 'Hierarquia' })).data;
const inv = (await call(own.tok, 'POST', `/guilds/${g.id}/invites`)).data;
for (const u of [adm, mod, mem, mem2]) await call(u.tok, 'POST', `/invites/${inv.code}`);
ok([own, adm, mod, mem, mem2].every(u => u.tok && u.id), 'cinco contas criadas');
const guildRoles = async () => (await ready(own.tok))?.guilds.find(x => x.id === g.id)?.roles ?? null;

// cargo novo entra no fim (posição 1) e os outros sobem
const rMod = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', perms: P.KICK | P.BAN | P.MODERATE | P.MANAGE_ROLES })).data.id;
const rAdm = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Admin', perms: P.ADMIN })).data.id;
const rMem = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Membro', perms: 0 })).data.id;
ok(!!(rMod && rAdm && rMem), 'dono cria três cargos');
// ordem: Admin > Mod > Membro
ok((await call(own.tok, 'PUT', `/guilds/${g.id}/roles/order`, { ids: [rAdm, rMod, rMem] })).status === 200, 'dono reordena os cargos');
ok((await call(own.tok, 'PUT', `/guilds/${g.id}/roles/order`, { ids: [rAdm, rMod] })).status === 400, 'lista incompleta é recusada');
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${adm.id}`, { roles: [rAdm] });
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mod.id}`, { roles: [rMod] });
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mem.id}`, { roles: [rMem] });

const pos = async () => { const r = await guildRoles(); return r && Object.fromEntries(r.map(x => [x.name, x.position])); };
const p0 = await pos();
ok(p0 && p0.Admin === 3 && p0.Mod === 2 && p0.Membro === 1, 'posições 1..n na ordem: ' + JSON.stringify(p0));

// Mod contra Admin (acima): tudo recusado
ok((await call(mod.tok, 'DELETE', `/guilds/${g.id}/members/${adm.id}`)).status === 403, 'mod não expulsa admin');
ok((await call(mod.tok, 'PUT', `/guilds/${g.id}/bans/${adm.id}`, {})).status === 403, 'mod não bane admin');
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${adm.id}`, { timeout_until: Date.now() + 60000 })).status === 403, 'mod não castiga admin');
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${adm.id}`, { nickname: 'bobo' })).status === 403, 'mod não muda apelido do admin');
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${adm.id}`, { roles: [] })).status === 403, 'mod não tira o cargo do admin');
// Mod contra Mod (mesmo nível): recusado
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mem2.id}`, { roles: [rMod] });
ok((await call(mod.tok, 'DELETE', `/guilds/${g.id}/members/${mem2.id}`)).status === 403, 'mod não expulsa outro mod (mesmo nível)');
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mem2.id}`, { roles: [] });

// escalada de privilégio
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${mod.id}`, { roles: [rMod, rAdm] })).status === 403, 'mod não se dá o cargo Admin');
ok((await call(mod.tok, 'PATCH', `/roles/${rAdm}`, { perms: 0 })).status === 403, 'mod não edita o cargo Admin');
ok((await call(mod.tok, 'PATCH', `/roles/${rMod}`, { perms: P.ADMIN })).status === 403, 'mod não edita o próprio cargo');
ok((await call(mod.tok, 'DELETE', `/roles/${rAdm}`)).status === 403, 'mod não apaga o cargo Admin');
ok((await call(mod.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'x', perms: P.ADMIN })).status === 403, 'mod não cria cargo com Administrador');
ok((await call(mod.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'x', perms: P.MANAGE_GUILD })).status === 403, 'mod não cria cargo com permissão que não tem');
const rNew = (await call(mod.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Ajudante', perms: P.KICK })).data.id;
ok(!!rNew, 'mod cria cargo só com permissões que tem');
ok((await call(mod.tok, 'PATCH', `/roles/${rNew}`, { perms: P.KICK | P.MANAGE_GUILD })).status === 403, 'mod não acrescenta permissão que não tem');
ok((await call(mod.tok, 'PATCH', `/roles/${rNew}`, { name: 'Ajudante 2', perms: P.KICK | P.BAN })).status === 200, 'mod edita cargo abaixo com permissões que tem');

// reordenar: só abaixo do seu nível (Admin 4, Mod 3, Membro 2, Ajudante 1)
ok((await call(mod.tok, 'PUT', `/guilds/${g.id}/roles/order`, { ids: [rAdm, rNew, rMod, rMem] })).status === 403, 'mod não põe cargo acima do próprio');
ok((await call(mod.tok, 'PUT', `/guilds/${g.id}/roles/order`, { ids: [rMod, rAdm, rNew, rMem] })).status === 403, 'mod não mexe no Admin');
ok((await call(mod.tok, 'PUT', `/guilds/${g.id}/roles/order`, { ids: [rAdm, rMod, rNew, rMem] })).status === 200, 'mod troca dois cargos abaixo do seu');

// Mod contra Membro (abaixo): pode
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${mem.id}`, { roles: [rMem, rNew] })).status === 200, 'mod dá cargo abaixo a um membro');
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${mem.id}`, { nickname: 'novato' })).status === 200, 'mod muda apelido de membro');
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${mem.id}`, { timeout_until: Date.now() + 60000 })).status === 200, 'mod castiga membro');
ok((await call(mod.tok, 'PATCH', `/guilds/${g.id}/members/${mem2.id}`, { roles: [rMod] })).status === 403, 'mod não dá o próprio cargo (mesmo nível)');
// cargos acima que a pessoa já tem não atrapalham quem só mexe nos de baixo
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mem2.id}`, { roles: [] });

// permissões por canal: o ajuste de um cargo acima não muda
await call(own.tok, 'PATCH', `/roles/${rMod}`, { perms: P.KICK | P.BAN | P.MODERATE | P.MANAGE_ROLES | 4 });
const chan = (await ready(own.tok)).guilds.find(x => x.id === g.id).channels.find(c => c.type === 0);
ok((await call(own.tok, 'PUT', `/channels/${chan.id}/perms`, { overwrites: [{ target: rAdm, allow: 0, deny: 1 }] })).status === 200, 'dono ajusta o canal para o Admin');
ok((await call(mod.tok, 'PUT', `/channels/${chan.id}/perms`, { overwrites: [{ target: rMem, allow: 0, deny: 2 }] })).status === 403, 'mod não apaga o ajuste do Admin no canal');
ok((await call(mod.tok, 'PUT', `/channels/${chan.id}/perms`, { overwrites: [{ target: rAdm, allow: 0, deny: 1 }, { target: rMem, allow: 0, deny: 2 }] })).status === 200, 'mod ajusta o canal para o Membro mantendo o do Admin');
ok((await call(mod.tok, 'PUT', `/channels/${chan.id}/perms`, { overwrites: [{ target: rAdm, allow: 1, deny: 0 }, { target: rMem, allow: 0, deny: 2 }] })).status === 403, 'mod não muda o ajuste do Admin');
ok((await call(mod.tok, 'PUT', `/channels/${chan.id}/perms`, { sync: true })).status === 403, 'mod não sincroniza (apagaria o ajuste do Admin)');

// Admin (acima do Mod) pode agir sobre ele; o dono sobre todos
ok((await call(adm.tok, 'PATCH', `/guilds/${g.id}/members/${mod.id}`, { timeout_until: Date.now() + 60000 })).status === 200, 'admin castiga mod');
ok((await call(adm.tok, 'DELETE', `/guilds/${g.id}/members/${adm.id}`.replace(adm.id, own.id))).status === 400, 'ninguém expulsa o dono');
ok((await call(own.tok, 'DELETE', `/guilds/${g.id}/members/${adm.id}`)).status === 200, 'dono expulsa admin');

// apagar cargo fecha o buraco na ordem
ok((await call(own.tok, 'DELETE', `/roles/${rMod}`)).status === 200, 'dono apaga o cargo Mod');
const p1 = await pos();
ok(p1 && Object.values(p1).sort().join() === '1,2,3', 'posições continuam 1..n depois de apagar: ' + JSON.stringify(p1));

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
