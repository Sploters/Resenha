// Importar a estrutura de um servidor do Discord por link de modelo (server/discordimport.js), com um Discord falso que
// devolve um modelo no formato da API (GET /guilds/templates/:code). Confere cargos (ordem, cor, permissões), categorias,
// canais (tipos, ordem, tópico, limite da sala), permissões por canal (sincronizado com a categoria ou próprio),
// quem pode importar, prévia e os avisos.
// Uso: node scripts/discord-structure-test.mjs
import http from 'node:http';
import WebSocket from 'ws';
import { ownServer } from './test-server.mjs';
const MOCK = 4621;
const D = (n) => (1n << BigInt(n));
const perm = (...bits) => bits.reduce((a, b) => a | D(b), 0n).toString();
const TEMPLATE = {
  code: 'raidtpl', name: 'Guilda', serialized_source_guild: {
    name: 'Guilda dos Amigos',
    roles: [
      { id: 0, name: '@everyone', color: 0, permissions: perm(0, 10, 11, 20, 21) },
      { id: 1, name: 'Oficial', color: 0xe67e22, permissions: perm(1, 2, 13, 22, 24, 40, 7), position: 3 },
      { id: 2, name: 'Raider', color: 0x3498db, permissions: perm(8), position: 2 },
      { id: 3, name: 'Recruta', color: 0, permissions: '0', position: 1 },
      { id: 4, name: 'Bot', color: 0, permissions: perm(3), position: 4, managed: true },
    ],
    channels: [
      { id: 10, type: 4, name: 'Informações', position: 0, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: perm(11) }, { id: 1, type: 0, allow: perm(11), deny: '0' }] },
      { id: 11, type: 0, name: 'regras', topic: 'Leia antes', position: 0, parent_id: 10, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: perm(11) }, { id: 1, type: 0, allow: perm(11), deny: '0' }] },
      { id: 12, type: 5, name: 'avisos', position: 1, parent_id: 10, permission_overwrites: [] },
      { id: 20, type: 4, name: 'Raid', position: 1, permission_overwrites: [] },
      { id: 21, type: 2, name: 'Raid principal', position: 0, parent_id: 20, user_limit: 20, permission_overwrites: [{ id: 3, type: 0, allow: '0', deny: perm(20) }] },
      { id: 22, type: 0, name: 'estrategias', position: 1, parent_id: 20, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: perm(10) }, { id: 2, type: 0, allow: perm(10, 11), deny: '0' }] },
      { id: 23, type: 13, name: 'Palco', position: 2, parent_id: 20, permission_overwrites: [] },
      { id: 24, type: 15, name: 'builds', position: 3, parent_id: 20, permission_overwrites: [] },
      { id: 30, type: 0, name: 'sem-categoria', position: 0, permission_overwrites: [] },
      { id: 31, type: 14, name: 'diretorio', position: 1, permission_overwrites: [] },
    ],
  },
};
const mock = http.createServer((q, r) => {
  if (q.url === '/api/guilds/templates/raidtpl') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(TEMPLATE)); }
  r.statusCode = 404; r.end('{"message":"Unknown Guild Template"}');
}).listen(MOCK);
const BASE = await ownServer('dsimport', 3432, 41770, { DISCORD_API: `http://127.0.0.1:${MOCK}/api` });
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const call = async (tok, method, path, body) => { const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const reg = async (n) => (await call('', 'POST', '/register', { username: n + Math.random().toString(36).slice(2, 6), password: 'Teste.senha-123' })).data.token;
const own = await reg('dono'), mem = await reg('membro');
const g = (await call(own, 'POST', '/guilds', { name: 'Casa' })).data;
const inv = (await call(own, 'POST', `/guilds/${g.id}/invites`)).data; await call(mem, 'POST', `/invites/${inv.code}`);
// um cargo que já existia continua em cima
const old = (await call(own, 'POST', `/guilds/${g.id}/roles`, { name: 'Antigo', perms: 0 })).data.id;

ok((await call(mem, 'POST', `/guilds/${g.id}/discord-structure/preview`, { template: 'https://discord.new/raidtpl' })).status === 403, 'membro sem administrador não importa');
ok((await call(own, 'POST', `/guilds/${g.id}/discord-structure/preview`, { template: 'isso não é link!' })).status === 400, 'texto que não é link é recusado');
{ const r = await call(own, 'POST', `/guilds/${g.id}/discord-structure/preview`, { template: 'https://discord.gg/abc123' });
  ok(r.status === 400 && /convite/.test(r.data.error) && /discord\.new/.test(r.data.error), 'link de convite: explica que não serve e onde achar o modelo', r.data); }
ok((await call(own, 'POST', `/guilds/${g.id}/discord-structure/preview`, { template: 'https://discord.new/naoexiste' })).status === 422, 'modelo inexistente: erro claro');
const pv = await call(own, 'POST', `/guilds/${g.id}/discord-structure/preview`, { template: 'https://discord.new/raidtpl' });
ok(pv.status === 200 && pv.data.counts.roles === 3 && pv.data.counts.categories === 2 && pv.data.counts.voice === 2 && pv.data.counts.text === 5, 'prévia: 3 cargos (sem o do bot), 2 categorias, 5 de texto, 2 de voz', pv.data.counts);
ok(pv.data.warnings?.some(w => /tipo/.test(w)) && pv.data.warnings.some(w => /palco/i.test(w)) && pv.data.warnings.some(w => /escondidos/.test(w)), 'avisos: tipo sem equivalente, palco vira voz, canal escondido', pv.data.warnings);

// tempo real: quem está no servidor recebe os canais novos
const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + mem); const got = [];
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'CHANNEL_CREATE' || m.t === 'ROLE_UPDATE') got.push(m.t); });
await new Promise(r => ws.on('open', r)); await new Promise(r => setTimeout(r, 300));
const res = await call(own, 'POST', `/guilds/${g.id}/discord-structure`, { template: 'discord.com/template/raidtpl' });
ok(res.status === 200 && res.data.created.roles === 3 && res.data.created.categories === 2 && res.data.created.channels === 7, 'importa: 3 cargos, 2 categorias, 7 canais', res.data);
await new Promise(r => setTimeout(r, 500));
ok(got.filter(t => t === 'CHANNEL_CREATE').length === 9 && got.includes('ROLE_UPDATE'), 'o membro recebe os canais e cargos ao vivo', got.length);
ws.close();

// conferir no banco pela API do próprio servidor (READY do dono)
const ready = await new Promise((resolve) => { const w = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + own); w.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') { w.close(); resolve(m.d); } }); });
const G = ready.guilds.find(x => x.id === g.id);
const roles = [...G.roles].sort((a, b) => b.position - a.position), byName = (n) => G.roles.find(r => r.name === n);
ok(roles[0].id === old && roles.slice(1, 4).map(r => r.name).join() === 'Oficial,Raider,Recruta', 'cargos novos abaixo do antigo, na ordem do Discord', roles.map(r => r.name));
ok(byName('Oficial').color === '#e67e22' && byName('Recruta').color === '#99aab5', 'cor do Discord (sem cor vira a padrão)');
ok(byName('Oficial').perms === (16 | 128 | 8 | 512 | 256 | 1024), 'Oficial: expulsar, banir, gerenciar mensagens, moderar voz, castigo, registro', byName('Oficial').perms);
ok(byName('Raider').perms === 2048, 'Raider: orador prioritário', byName('Raider').perms);
ok(!G.roles.some(r => r.name === 'Bot'), 'cargo de bot (gerenciado) fica de fora');
const ch = (n) => G.channels.find(c => c.name === n);
const info = ch('Informações'), raid = ch('Raid');
ok(info?.type === 4 && raid?.type === 4, 'categorias criadas');
ok(ch('regras')?.parent_id === info.id && ch('regras').topic === 'Leia antes' && ch('avisos')?.type === 5, 'regras (com tópico) e avisos (anúncios) dentro de Informações');
ok(ch('Raid principal')?.type === 2 && ch('Raid principal').user_limit === 20 && ch('Palco')?.type === 2 && ch('builds')?.type === 15, 'sala com limite de 20, palco virou voz, fórum');
ok(ch('sem-categoria') && !ch('sem-categoria').parent_id && !ch('diretorio'), 'canal sem categoria entra; tipo sem equivalente não');
const order = G.channels.filter(c => [info.id, raid.id].includes(c.parent_id) || c.id === info.id || c.id === raid.id || c.name === 'sem-categoria').sort((a, b) => a.position - b.position).map(c => c.name);
ok(order.join() === 'sem-categoria,Informações,regras,avisos,Raid,estrategias,builds,Raid principal,Palco', 'ordem: texto antes de voz dentro de cada categoria', order);
const ows = G.channel_perms || {};
const ev = (id, t) => (ows[id] || []).find(o => o.target === t);
ok(ev(info.id, 'everyone')?.deny === 1 && ev(info.id, byName('Oficial').id)?.allow === 1, 'categoria Informações: @everyone não escreve, Oficial escreve');
ok(ch('regras').perm_sync !== 0 && !(ows[ch('regras').id] || []).length, 'regras tem os mesmos ajustes da categoria: continua sincronizado');
ok(ch('Raid principal').perm_sync === 0 && ev(ch('Raid principal').id, byName('Recruta').id)?.deny === 8, 'Raid principal: Recruta não entra (própria)');
ok(ev(ch('estrategias').id, 'everyone')?.deny === 1 && ev(ch('estrategias').id, byName('Raider').id)?.allow === 1, '"ver canal" negado vira não escrever; Raider liberado');
ok(G.channels.some(c => c.name === 'geral'), 'o que já existia continua lá');

mock.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
