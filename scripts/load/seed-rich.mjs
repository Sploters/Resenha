// Banco com chat "de verdade" para medir o chat grande: uma conversa direta e um canal de servidor com N mensagens
// cada (padrão 3.000), misturando o que aparece no dia a dia: markdown (negrito, itálico, código, citação, spoiler),
// menções, emojis, links, respostas, reações, mensagens editadas, longas, só-emoji e imagens (PNGs de verdade em
// uploads/, de tamanhos variados). 30 pessoas no servidor; "rich-0" e "rich-1" são as duas da conversa direta.
// Uso: DATA_DIR=./.testdata-rich node scripts/load/seed-rich.mjs 3000   (apaga e recria a pasta de dados)
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
const N = +(process.argv[2] || 3000), DIR = process.env.DATA_DIR || './.testdata-rich';
fs.rmSync(DIR, { recursive: true, force: true });
const { db } = await import('../../server/db.js');
const up = DIR + '/uploads'; fs.mkdirSync(up, { recursive: true });

// PNG simples (faixas de cor) para as imagens anexadas
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, band = ((x >> 6) + (y >> 6) + seed) % 6; raw[o] = 40 + band * 35; raw[o + 1] = 200 - band * 25; raw[o + 2] = (x * 255 / w) | 0; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const imgs = [[1600, 1200], [800, 600], [1080, 1920], [400, 400], [1920, 1080], [640, 360]].map(([w, h], i) => {
  const f = `rich${i}.png`, b = png(w, h, i); fs.writeFileSync(`${up}/${f}`, b); return { url: `/files/${f}`, name: `foto${i}.png`, size: b.length, type: 'image/png', width: w, height: h };
});

const salt = 'rich', hash = crypto.scryptSync('Teste.senha-123', salt, 64).toString('hex'), now = Date.now();
let id = BigInt(now - N * 2 * 60e3) * 1000n; const nid = () => String(id++);
db.exec('BEGIN');
const users = [];
const iu = db.prepare('INSERT INTO users(id,username,display_name,pass_hash,salt,color,created_at) VALUES(?,?,?,?,?,?,?)');
const is = db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)');
for (let i = 0; i < 30; i++) { const u = nid(); users.push(u); iu.run(u, 'rico' + i, 'Pessoa ' + i, hash, salt, ['#5865f2', '#eb459e', '#57f287', '#fee75c'][i % 4], now); is.run('rich-' + i, u, now); }
const gid = nid();
db.prepare('INSERT INTO guilds(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(gid, 'Servidor do chat', users[0], now);
db.prepare('INSERT INTO roles(id,guild_id,name,perms,position) VALUES(?,?,?,?,?)').run(gid, gid, '@everyone', 0x7fffffff, 0);
for (const u of users) db.prepare('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)').run(gid, u, now);
const ic = db.prepare('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)');
const chan = nid(); ic.run(chan, gid, 0, 'geral', 0, null, now); ic.run(nid(), gid, 2, 'Voz', 1, null, now);
const dm = nid(); ic.run(dm, null, 1, null, 0, null, now);
db.prepare('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)').run(dm, users[0]);
db.prepare('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)').run(dm, users[1]);
db.prepare('INSERT INTO relationships(user_id,other_id,type) VALUES(?,?,1),(?,?,1)').run(users[0], users[1], users[1], users[0]);

const words = 'bora jogar hoje alguém viu aquele vídeo que eu mandei ontem tá muito bom kkkk sério mesmo não acredito nisso cara partida ranked amanhã cedo fechou'.split(' ');
const say = (r, n) => Array.from({ length: n }, () => words[(r() * words.length) | 0]).join(' ');
let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const kinds = [
  (r, u) => say(r, 3 + ((r() * 12) | 0)),
  (r, u) => `**${say(r, 2)}** ${say(r, 5)} *${say(r, 2)}*`,
  (r, u) => `<@${u[(r() * u.length) | 0]}> ${say(r, 6)}`,
  (r) => `olha isso https://example.com/${say(r, 1)}?id=${(r() * 1e6) | 0} ${say(r, 3)}`,
  (r) => '```js\nconst x = ' + ((r() * 100) | 0) + ';\nfunction f(a) { return a * 2 + x; }\nconsole.log(f(3));\n```',
  (r) => `> ${say(r, 8)}\n${say(r, 4)}`,
  (r) => ['😂😂😂', '🔥', '👍👍', '😭', '🎉🎉🎉🎉'][(r() * 5) | 0],
  (r) => `||${say(r, 4)}|| ${say(r, 3)} \`codigo_inline()\``,
  (r) => Array.from({ length: 4 }, () => say(r, 25)).join('\n'), // mensagem longa
  (r) => `${say(r, 4)} 😄 ${say(r, 3)} 🎮`,
];
const im = db.prepare('INSERT INTO messages(id,channel_id,author_id,content,created_at,edited_at,reply_to,attachments) VALUES(?,?,?,?,?,?,?,?)');
const ir = db.prepare('INSERT OR IGNORE INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)');
const EMO = ['👍', '😂', '❤️', '🔥', '😮', '🎉'];
function fill(cid, authors) {
  const ids = []; let t = now - N * 60e3;
  for (let i = 0; i < N; i++) {
    const mid = nid(), a = authors[(rnd() * authors.length) | 0];
    // rajadas do mesmo autor (mensagens agrupadas) como num chat real
    const author = i && rnd() < .45 ? db.prepare('SELECT author_id FROM messages WHERE id=?').get(ids.at(-1)).author_id : a;
    t += 5e3 + rnd() * 110e3;
    const content = kinds[(rnd() * kinds.length) | 0](rnd, authors);
    const atts = rnd() < .1 ? [imgs[(rnd() * imgs.length) | 0]] : [];
    const reply = ids.length > 5 && rnd() < .15 ? ids[ids.length - 1 - ((rnd() * 5) | 0)] : null;
    im.run(mid, cid, author, atts.length && rnd() < .5 ? '' : content, Math.round(t), rnd() < .05 ? Math.round(t + 60e3) : null, reply, JSON.stringify(atts));
    if (rnd() < .2) { const k = 1 + ((rnd() * 4) | 0); for (let j = 0; j < k; j++) ir.run(mid, authors[(rnd() * authors.length) | 0], EMO[(rnd() * EMO.length) | 0]); }
    ids.push(mid);
  }
}
fill(chan, users);
fill(dm, users.slice(0, 2));
db.exec('COMMIT');
fs.writeFileSync(DIR + '/rich.json', JSON.stringify({ guild: gid, channel: chan, dm, users: users.slice(0, 5) }));
console.log(`chat grande pronto: ${N} mensagens no canal e ${N} na conversa direta -> ${DIR}`);
