// Prepara um banco para o teste de carga: N pessoas já com sessão (token "load-<i>"), todas no mesmo servidor
// (pior caso: cada mensagem e cada mudança de status vai para todo mundo), 20 canais com 1.000 mensagens cada.
// Uso: DATA_DIR=./.loaddata node scripts/load/seed.mjs 1000      (apaga e recria a pasta de dados)
import fs from 'node:fs';
import crypto from 'node:crypto';
const N = +(process.argv[2] || 1000), DIR = process.env.DATA_DIR || './.loaddata';
fs.rmSync(DIR, { recursive: true, force: true });
const { db } = await import('../../server/db.js');
const salt = 'load', hash = crypto.scryptSync('Teste.senha-123', salt, 64).toString('hex'), now = Date.now();
let id = 1700000000000000; const nid = () => String(id++);
db.exec('BEGIN');
const users = [];
const iu = db.prepare('INSERT INTO users(id,username,display_name,pass_hash,salt,color,created_at) VALUES(?,?,?,?,?,?,?)');
const is = db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)');
for (let i = 0; i < N; i++) { const u = nid(); users.push(u); iu.run(u, 'carga' + i, 'Pessoa ' + i, hash, salt, '#5865f2', now); is.run('load-' + i, u, now); }
const gid = nid();
db.prepare('INSERT INTO guilds(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(gid, 'Servidor da carga', users[0], now);
db.prepare('INSERT INTO roles(id,guild_id,name,perms,position) VALUES(?,?,?,?,?)').run(gid, gid, '@everyone', 0x7fffffff, 0);
const im = db.prepare('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)');
for (const u of users) im.run(gid, u, now);
const ic = db.prepare('INSERT INTO channels(id,guild_id,type,name,position,created_at) VALUES(?,?,?,?,?,?)');
const imsg = db.prepare('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)');
const channels = [];
for (let c = 0; c < 20; c++) {
  const cid = nid(); channels.push(cid); ic.run(cid, gid, 0, 'canal-' + c, c, now);
  for (let m = 0; m < 1000; m++) imsg.run(nid(), cid, users[(m * 7 + c) % N], 'mensagem antiga ' + m + ' — ' + 'texto '.repeat(1 + (m % 12)), now - (1000 - m) * 60e3);
}
ic.run(nid(), gid, 2, 'Sala de voz', 30, now);
db.exec('COMMIT');
fs.writeFileSync(DIR + '/load.json', JSON.stringify({ n: N, guild: gid, channels, users }));
console.log(`banco de carga pronto: ${N} pessoas, 1 servidor, ${channels.length} canais x 1000 mensagens -> ${DIR}`);
