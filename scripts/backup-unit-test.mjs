// Cópias do banco e restauração (server/backup.js, server/db.js) sem servidor, numa pasta temporária:
// cópia consistente com o banco aberto (inclui o que está no -wal), verificação, rotação, busca (rowid) preservada,
// restaurar recusa com o banco em uso e cópia corrompida, restaura guardando o banco antigo, checkpoint ao fechar,
// banco corrompido/ilegível na abertura.
// Uso: node scripts/backup-unit-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resenha-backup-test-'));
const node = (args, env = {}) => spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
// estraga páginas do fim do arquivo (dados das mensagens): o esquema, no começo, continua legível
const corrupt = (f) => { const buf = fs.readFileSync(f), ps = buf.readUInt16BE(16) || 65536, fd = fs.openSync(f, 'r+'); for (let p = Math.floor(buf.length / ps * 0.6); p * ps < buf.length; p += 2) fs.writeSync(fd, Buffer.alloc(ps, 0x5a), 0, ps, p * ps); fs.closeSync(fd); };

if (process.argv[2] === 'filho') { // processo com DATA_DIR próprio: db.js abre o banco no import
  const { db, run, get, newId, closeDb, DB_FILE } = await import('../server/db.js');
  const B = await import('../server/backup.js');
  const DATA = process.env.DATA_DIR, dir = B.backupDirOf(DATA);
  const addUser = (n) => run('INSERT INTO users(id, username, pass_hash, salt, created_at) VALUES(?,?,?,?,?)', newId(), n, 'x', 'y', Date.now());
  const g = newId(), ch = newId(), u0 = newId();
  run('INSERT INTO users(id, username, pass_hash, salt, created_at) VALUES(?,?,?,?,?)', u0, 'dono', 'x', 'y', Date.now());
  run('INSERT INTO guilds(id, name, owner_id, created_at) VALUES(?,?,?,?)', g, 'Teste', u0, Date.now());
  run('INSERT INTO channels(id, guild_id, name, type, position) VALUES(?,?,?,?,?)', ch, g, 'geral', 0, 0);
  db.exec('BEGIN'); for (let i = 0; i < 3000; i++) run('INSERT INTO messages(id, channel_id, author_id, content, created_at) VALUES(?,?,?,?,?)', newId(), ch, u0, `mensagem ${i} pastel${i % 7 ? '' : ' abacaxi'}`, Date.now()); db.exec('COMMIT');
  for (let i = 0; i < 20; i++) addUser('pessoa' + i);
  ok(fs.statSync(DB_FILE + '-wal').size > 0, 'há dados ainda só no -wal');

  console.log('— cópia com o banco aberto');
  const r1 = await B.makeBackup(db, dir, { keep: 2 });
  ok(r1.ok && fs.existsSync(r1.file), 'cópia criada', r1);
  ok(r1.users === 21 && r1.messages === 3000, 'cópia tem tudo (inclusive o que estava no -wal)', r1);
  ok(!fs.existsSync(r1.file + '-wal') && !fs.readdirSync(dir).some(f => f.endsWith('.tmp')), 'cópia é um arquivo só (sem -wal nem .tmp)');
  ok(B.verifyFile(r1.file).ok, 'verificação da cópia passa');
  { const { DatabaseSync } = await import('node:sqlite'); const d = new DatabaseSync(r1.file, { readOnly: true });
    const n = d.prepare("SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'abacaxi'").get().n, m = d.prepare("SELECT count(*) n FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH 'abacaxi' AND m.content LIKE '%abacaxi%'").get().n;
    d.close(); ok(n > 0 && n === m, 'busca na cópia aponta para as mesmas mensagens (rowid preservado)', { n, m }); }

  console.log('— rotação');
  addUser('depois1'); const r2 = await B.makeBackup(db, dir, { keep: 2 });
  addUser('depois2'); const r3 = await B.makeBackup(db, dir, { keep: 2 });
  const list = B.listBackups(dir);
  ok(r2.ok && r3.ok && list.length === 2 && list[0].file === r3.file && !fs.existsSync(r1.file), 'guarda só as 2 mais novas', list.map(x => x.name));
  const both = await Promise.all([B.makeBackup(db, dir, { keep: 5 }), B.makeBackup(db, dir, { keep: 5 })]);
  ok(both[0] === both[1] || both[0].file === both[1].file, 'duas pedidas juntas = uma cópia só');

  console.log('— restaurar com o servidor no ar');
  let err = null; try { B.restore(r2.file, DATA); } catch (e) { err = e.message; }
  ok(err && /rodando/.test(err), 'recusa com o banco aberto por outro processo', err);
  ok(get('SELECT count(*) n FROM users').n === 23, 'banco em uso intacto');

  addUser('depois3');
  closeDb();
  ok(!fs.existsSync(DB_FILE + '-wal') || fs.statSync(DB_FILE + '-wal').size === 0, 'fechar faz checkpoint completo (-wal vazio)');
  fs.writeFileSync(path.join(DATA, 'r2.txt'), r2.file);
  process.exit(fails ? 1 : 0);
}

// ---- processo principal ----
const DATA = path.join(tmpRoot, 'dados');
try {
  const f = node([fileURLToPath(import.meta.url), 'filho'], { DATA_DIR: DATA, BACKUP_DIR: '' });
  process.stdout.write(f.stdout); if (f.status) { process.stdout.write(f.stderr); fails++; }
  const B = await import('../server/backup.js');
  const r2 = fs.readFileSync(path.join(DATA, 'r2.txt'), 'utf8'), dbFile = path.join(DATA, 'resenha.db');

  console.log('— restaurar (servidor parado)');
  const bad = path.join(tmpRoot, 'estragada.db'); fs.copyFileSync(r2, bad); corrupt(bad);
  ok(!B.verifyFile(bad).ok, 'verificação acusa a cópia estragada', B.verifyFile(bad));
  const cli = node(['server/backup.js', 'verificar', bad]);
  ok(cli.status === 1 && /PROBLEMA/.test(cli.stdout), 'linha de comando: verificar sai com erro', cli.stdout);
  const before = B.verifyFile(dbFile).users;
  let err = null; try { B.restore(bad, DATA); } catch (e) { err = e.message; }
  ok(err && /verificação/.test(err) && before === 24 && B.verifyFile(dbFile).users === 24, 'cópia estragada não substitui o banco', err);
  ok(!fs.readdirSync(DATA).some(f => f.includes('restaurando')), 'sem temporário sobrando');
  const res = node(['server/backup.js', 'restaurar', r2, DATA]);
  ok(res.status === 0 && /restaurado/.test(res.stdout), 'linha de comando: restaurar', res.stdout + res.stderr);
  const v = B.verifyFile(dbFile);
  ok(v.ok && v.users === 22, 'banco agora é o da cópia (22 contas, sem as 2 de depois)', v);
  const aside = fs.readdirSync(DATA).find(f => f.startsWith('antes-da-restauracao-'));
  ok(aside && B.verifyFile(path.join(DATA, aside, 'resenha.db')).users === 24, 'banco anterior guardado inteiro ao lado', aside);
  const cp = node(['server/backup.js', 'copiar', DATA]);
  ok(cp.status === 0 && /verificada/.test(cp.stdout), 'linha de comando: copiar', cp.stdout + cp.stderr);

  console.log('— abertura com o banco corrompido');
  const D2 = path.join(tmpRoot, 'corrompido'); fs.mkdirSync(D2); fs.copyFileSync(r2, path.join(D2, 'resenha.db')); corrupt(path.join(D2, 'resenha.db'));
  const open = (dir, env = {}) => node(['--input-type=module', '-e', "const m = await import('./server/db.js'); console.log('PROBLEMA=' + !!m.dbProblem);"], { DATA_DIR: dir, ...env });
  const c1 = open(D2, { DB_ON_CORRUPT: 'stop' });
  ok(c1.status === 1 && /INTEGRIDADE/.test(c1.stderr), 'DB_ON_CORRUPT=stop: para avisando', c1.stderr.slice(0, 300));
  ok(fs.readdirSync(D2).some(f => f.startsWith('corrompido-')), 'guarda cópia do estado corrompido antes de escrever');
  const D3 = path.join(tmpRoot, 'lixo'); fs.mkdirSync(D3); fs.writeFileSync(path.join(D3, 'resenha.db'), Buffer.alloc(8192, 7));
  const c2 = open(D3);
  ok(c2.status === 1 && /ILEGÍVEL/.test(c2.stderr), 'arquivo que não é banco: para com instrução de restaurar', c2.stderr.slice(0, 300));
  const D4 = path.join(tmpRoot, 'bom'); fs.mkdirSync(D4); fs.copyFileSync(r2, path.join(D4, 'resenha.db'));
  const c3 = open(D4);
  ok(c3.status === 0 && /PROBLEMA=false/.test(c3.stdout), 'banco bom abre sem aviso', c3.stdout + c3.stderr);
} finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
