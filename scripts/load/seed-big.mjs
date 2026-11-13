// Banco "grande" para achar gargalos de dados (scripts/perf-big.mjs): 5.000 pessoas (sessão "big-<i>") num servidor com
// 1.000 canais (50 categorias, 20 canais cada), 8 cargos, 100 mil mensagens (a maior parte em poucos canais, como na vida
// real) e a pessoa 0 com 500 conversas diretas. Mais 3 servidores pequenos com parte das pessoas.
// Uso: DATA_DIR=./.testdata-big node scripts/load/seed-big.mjs   (apaga e recria a pasta de dados)
import fs from 'node:fs';
import crypto from 'node:crypto';
const N = +(process.env.N || 5000), CH = +(process.env.CH || 1000), MSG = +(process.env.MSG || 100000), DMS = +(process.env.DMS || 500);
const DIR = process.env.DATA_DIR || './.testdata-big';
fs.rmSync(DIR, { recursive: true, force: true });
const { db } = await import('../../server/db.js');
const salt = 'big', hash = crypto.scryptSync('Teste.senha-123', salt, 64).toString('hex'), now = Date.now();
let id = 1700000000000000; const nid = () => String(id++);
const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245'];
db.exec('BEGIN');
const users = [];
const iu = db.prepare('INSERT INTO users(id,username,display_name,pass_hash,salt,color,avatar,bio,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
const is = db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)');
for (let i = 0; i < N; i++) { const u = nid(); users.push(u); iu.run(u, 'big' + i, 'Pessoa Grande ' + i, hash, salt, COLORS[i % 5], `/avatars/${1 + (i % 12)}.${(i % 12) === 9 ? 'webp' : 'png'}`, i % 3 ? 'Oi, eu sou a pessoa ' + i + '. ' + 'Gosto de jogos. '.repeat(i % 4) : '', now - i * 1000); is.run('big-' + i, u, now); }
const ig = db.prepare('INSERT INTO guilds(id,name,owner_id,created_at) VALUES(?,?,?,?)');
const ir = db.prepare('INSERT INTO roles(id,guild_id,name,color,perms,position) VALUES(?,?,?,?,?,?)');
const im = db.prepare('INSERT INTO members(guild_id,user_id,joined_at,nickname) VALUES(?,?,?,?)');
const imr = db.prepare('INSERT OR IGNORE INTO member_roles(guild_id,user_id,role_id) VALUES(?,?,?)');
const ic = db.prepare('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)');
const imsg = db.prepare('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)');
const idp = db.prepare('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)');
const gid = nid();
ig.run(gid, 'Servidor Grande', users[0], now);
ir.run(gid, gid, '@everyone', null, 1 | 2 | 4 | 32, 0); // como o padrão: ver/enviar; sem administrar
const roles = []; for (let r = 0; r < 8; r++) { const rid = nid(); roles.push(rid); ir.run(rid, gid, 'Cargo ' + r, COLORS[r % 5], r === 0 ? 8 | 256 : 0, 8 - r); }
for (let i = 0; i < N; i++) { im.run(gid, users[i], now - i * 1000, i % 10 === 0 ? 'Apelido ' + i : null); if (i % 4 === 0) imr.run(gid, users[i], roles[i % 8]); if (i % 50 === 0) imr.run(gid, users[i], roles[0]); }
const channels = []; let pos = 0;
for (let k = 0; k < CH / 20; k++) {
  const cat = nid(); ic.run(cat, gid, 4, 'Categoria ' + k, pos++, null, now);
  for (let c = 0; c < 20; c++) { const cid = nid(); channels.push(cid); ic.run(cid, gid, c === 19 ? 2 : 0, `canal-${k}-${c}`, pos++, cat, now); }
}
const text = channels.filter((_, i) => i % 20 !== 19);
// 70% das mensagens em 10 canais movimentados; o resto espalhado
for (let m = 0; m < MSG; m++) {
  const cid = m % 10 < 7 ? text[m % 10] : text[10 + (m * 31) % (text.length - 10)];
  imsg.run(nid(), cid, users[(m * 7) % N], `mensagem ${m} — ` + 'conteúdo de teste '.repeat(1 + (m % 8)) + (m % 50 === 0 ? ' https://exemplo.com/link?' + m : ''), now - (MSG - m) * 30e3);
}
// conversas diretas da pessoa 0
const dms = [];
for (let d = 1; d <= DMS; d++) { const cid = nid(); dms.push(cid); ic.run(cid, null, 1, null, 0, null, now - d * 60e3); idp.run(cid, users[0]); idp.run(cid, users[d]); for (let m = 0; m < 5; m++) imsg.run(nid(), cid, m % 2 ? users[0] : users[d], 'oi da conversa ' + d + ' #' + m, now - d * 60e3 + m); }
// 3 servidores pequenos (parte das pessoas em vários servidores)
for (let s = 0; s < 3; s++) {
  const g = nid(); ig.run(g, 'Pequeno ' + s, users[0], now); ir.run(g, g, '@everyone', null, 1 | 2 | 4 | 32, 0);
  for (let i = 0; i < 200; i++) im.run(g, users[(i * (s + 2)) % N], now, null);
  for (let c = 0; c < 10; c++) ic.run(nid(), g, c === 9 ? 2 : 0, 'geral-' + c, c, null, now);
}
db.exec('COMMIT');
fs.writeFileSync(DIR + '/big.json', JSON.stringify({ n: N, guild: gid, channels: text.slice(0, 40), busy: text.slice(0, 10), dms: dms.slice(0, 20), users: users.slice(0, 50) }));
console.log(`banco grande pronto: ${N} pessoas, ${CH} canais, ${MSG} mensagens, ${DMS} conversas diretas -> ${DIR}`);
