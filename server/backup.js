// Cópias de segurança do banco (resenha.db), consistentes com o servidor no ar:
// - Usa a API de backup do SQLite (página por página, inclui o que ainda está no -wal; nunca copia o arquivo vivo).
//   Não usa VACUUM INTO: ele pode renumerar o rowid de messages, de que o índice de busca (messages_fts) depende.
// - Cada cópia nasce como .tmp, é aberta e verificada (quick_check), vira um arquivo só (journal DELETE, sem -wal),
//   vai para o disco (fsync) e só então é renomeada para resenha-<data>-<hora>.db. Cópia que reprova é apagada e as
//   antigas ficam (banco corrompido não empurra as boas para fora da rotação).
// - Automática: a cada BACKUP_HOURS (24; 0 desliga), guarda as BACKUP_KEEP (7) mais novas em BACKUP_DIR
//   (<dados>/backups). Checkpoint do WAL de hora em hora (o SQLite também faz sozinho a cada ~4 MB) e completo ao fechar.
// - Os anexos (uploads/) não entram: são arquivos que não mudam depois de enviados (copie a pasta de dados inteira).
// Linha de comando (o restaurar exige o servidor parado; docs/ADMINISTRACAO.md → Cópias do banco e restauração):
//   node server/backup.js copiar [pasta-de-dados]            cópia agora (pode com o servidor no ar)
//   node server/backup.js listar [pasta-de-dados]            cópias existentes, da mais nova para a mais velha
//   node server/backup.js verificar <arquivo>                abre e confere a integridade
//   node server/backup.js restaurar <arquivo> [pasta-de-dados]   troca o banco pela cópia (o atual vai para antes-da-restauracao-<data>/)
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-'); // UTC
const NAME = /^resenha-\d{8}-\d{6}(-\d+)?\.db$/;
export const backupDirOf = (dataDir) => process.env.BACKUP_DIR || path.join(dataDir, 'backups');
const fsyncPath = (p) => { try { const fd = fs.openSync(p, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { } }; // pasta: nem todo sistema deixa
const rmDb = (f) => { for (const ext of ['', '-wal', '-shm', '-journal']) fs.rmSync(f + ext, { force: true }); };

// abre e confere um arquivo de banco: { ok, error?, tables, users, messages }
export function verifyFile(file) {
  let d;
  try {
    if (!fs.existsSync(file)) return { ok: false, error: 'arquivo não existe' };
    d = new DatabaseSync(file, { readOnly: true });
    const r = d.prepare('PRAGMA quick_check(20)').all().map(x => Object.values(x)[0]);
    if (r.length !== 1 || r[0] !== 'ok') return { ok: false, error: r.slice(0, 5).join('; ') };
    const tables = d.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n;
    const has = (t) => !!d.prepare('SELECT 1 x FROM sqlite_master WHERE name=?').get(t);
    if (!has('users') || !has('messages')) return { ok: false, error: 'não é um banco do Resenha (faltam tabelas)', tables };
    return { ok: true, tables, users: d.prepare('SELECT count(*) n FROM users').get().n, messages: d.prepare('SELECT count(*) n FROM messages').get().n };
  } catch (e) { return { ok: false, error: e.message }; } finally { try { d?.close(); } catch { } }
}
// deixa o arquivo autossuficiente (sem -wal) e confere; usado na cópia nova e no arquivo a restaurar
function seal(file) {
  try { const d = new DatabaseSync(file); try { d.exec('PRAGMA journal_mode = DELETE'); } finally { d.close(); } } catch (e) { return { ok: false, error: e.message }; }
  for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  const v = verifyFile(file);
  if (v.ok) fsyncPath(file);
  return v;
}

export function listBackups(dir) {
  let names = []; try { names = fs.readdirSync(dir).filter(f => NAME.test(f)); } catch { }
  // mais nova primeiro: pelo nome (data e hora) e, no mesmo segundo, pelo número de ordem (-2, -3…)
  const key = (f) => { const m = f.match(/^resenha-(\d{8}-\d{6})(?:-(\d+))?\.db$/); return m[1] + String(+m[2] || 1).padStart(4, '0'); };
  return names.sort((a, b) => key(b).localeCompare(key(a))).map(f => { const p = path.join(dir, f); let st = null; try { st = fs.statSync(p); } catch { } return { file: p, name: f, size: st?.size || 0, at: st?.mtimeMs || 0 }; });
}
function rotate(dir, keep) {
  const list = listBackups(dir);
  for (const b of list.slice(Math.max(1, keep))) rmDb(b.file);
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) fs.rmSync(path.join(dir, f), { force: true }); } catch { } // de cópia interrompida
}

// cópia nova de `db` (conexão aberta) em `dir`. Devolve { ok, file?, size?, ms, error? }
let running = null;
export function makeBackup(db, dir, { keep = 7 } = {}) {
  if (running) return running; // uma por vez
  running = (async () => {
    const t0 = Date.now();
    fs.mkdirSync(dir, { recursive: true });
    let name = `resenha-${stamp()}.db`; for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `resenha-${stamp()}-${i}.db`;
    const file = path.join(dir, name), tmp = file + '.tmp';
    try {
      try { // espaço: o banco cabe com folga?
        const s = fs.statfsSync(dir), size = db.prepare('SELECT page_count * page_size n FROM pragma_page_count(), pragma_page_size()').get().n;
        if (s.bavail * s.bsize < size * 1.2 + 50 * 2 ** 20) throw new Error(`pouco espaço livre em ${dir}`);
      } catch (e) { if (/espaço/.test(e.message)) throw e; }
      rmDb(tmp);
      await sqliteBackup(db, tmp, { rate: 256 }); // 256 páginas (~1 MB) por passo: o servidor continua atendendo entre os passos
      const v = seal(tmp);
      if (!v.ok) throw new Error('a cópia não passou na verificação: ' + String(v.error).slice(0, 300));
      fs.renameSync(tmp, file); fsyncPath(dir);
      rotate(dir, keep);
      return { ok: true, file, size: fs.statSync(file).size, ms: Date.now() - t0, users: v.users, messages: v.messages };
    } catch (e) { rmDb(tmp); return { ok: false, error: e.message, ms: Date.now() - t0 }; }
  })().finally(() => { running = null; });
  return running;
}

// servidor: cópias automáticas e checkpoint periódico (chamado por server/index.js depois de montar o health)
export function startBackups(db, dataDir, { dbProblem } = {}) {
  if (dbProblem) console.error(`Banco com problema de integridade na abertura: ${dbProblem.errors.slice(0, 3).join('; ')}. Cópia do estado: ${dbProblem.aside || '-'}. Restaure com node server/backup.js restaurar`);
  const hours = Math.max(0, +(process.env.BACKUP_HOURS ?? 24) || 0), keep = Math.max(1, +process.env.BACKUP_KEEP || 7), dir = backupDirOf(dataDir);
  setInterval(() => { try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { } }, 3600e3).unref();
  if (!hours) return { dir, run: () => makeBackup(db, dir, { keep }) };
  const due = () => Date.now() - (listBackups(dir)[0]?.at || 0) >= hours * 3600e3 - 60e3;
  const tick = async () => {
    if (!due()) return;
    const r = await makeBackup(db, dir, { keep });
    if (r.ok) console.log(`  Cópia do banco: ${path.basename(r.file)} (${(r.size / 1048576).toFixed(1)} MB, ${r.ms} ms)`);
    else console.error('Cópia automática do banco falhou:', r.error);
  };
  setTimeout(tick, +process.env.BACKUP_FIRST_MS || 10 * 60e3).unref(); // a primeira espera o servidor assentar
  setInterval(tick, Math.min(hours * 3600e3, 3600e3)).unref();
  return { dir, run: () => makeBackup(db, dir, { keep }) };
}

// ---- restaurar (servidor parado) ----
// em uso: algum processo com o banco aberto (no WAL, sair do modo WAL exige ser o único) ou em-chamada.json recente
function inUse(dbFile, dataDir) {
  try { const t = JSON.parse(fs.readFileSync(path.join(dataDir, 'em-chamada.json'), 'utf8')).t; if (Date.now() - t < 60e3) return 'em-chamada.json foi atualizado há menos de 1 min'; } catch { }
  if (!fs.existsSync(dbFile)) return null;
  let d; try {
    d = new DatabaseSync(dbFile, { timeout: 0 });
    d.exec('PRAGMA journal_mode = DELETE'); // também junta o -wal no arquivo (o banco antigo fica inteiro num arquivo só)
  } catch (e) { if (/locked|busy/i.test(e.message)) return 'o banco está aberto por outro processo'; } finally { try { d?.close(); } catch { } }
  return null;
}
export function restore(src, dataDir) {
  const dbFile = path.join(dataDir, 'resenha.db'), tmp = dbFile + '.restaurando';
  src = path.resolve(src);
  if (!fs.existsSync(src)) throw new Error('cópia não encontrada: ' + src);
  if (src === path.resolve(dbFile)) throw new Error('a cópia é o próprio banco em uso');
  // copia junto o -wal da origem, se houver (cópia bruta de uma pasta de dados, ex.: o .tgz do deploy)
  rmDb(tmp); fs.copyFileSync(src, tmp); if (fs.existsSync(src + '-wal')) fs.copyFileSync(src + '-wal', tmp + '-wal');
  const v = seal(tmp);
  if (!v.ok) { rmDb(tmp); throw new Error('a cópia não passou na verificação: ' + String(v.error).slice(0, 300)); }
  const busy = inUse(dbFile, dataDir);
  if (busy) { rmDb(tmp); throw new Error(`o servidor parece estar rodando (${busy}). Pare antes (docker stop resenha / systemctl stop resenha)`); }
  let aside = null;
  if (fs.existsSync(dbFile)) {
    aside = path.join(dataDir, 'antes-da-restauracao-' + stamp()); fs.mkdirSync(aside, { recursive: true });
    for (const ext of ['', '-wal', '-shm', '-journal']) if (fs.existsSync(dbFile + ext)) fs.renameSync(dbFile + ext, path.join(aside, 'resenha.db' + ext));
  }
  fs.renameSync(tmp, dbFile); fsyncPath(dataDir);
  return { ...v, aside, file: dbFile };
}

// ---- linha de comando ----
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd, a, b] = process.argv.slice(2);
  const dataOf = (x) => path.resolve(x || process.env.DATA_DIR || 'data');
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  try {
    if (cmd === 'copiar') {
      const dataDir = dataOf(a), f = path.join(dataDir, 'resenha.db');
      if (!fs.existsSync(f)) throw new Error('banco não encontrado: ' + f);
      const d = new DatabaseSync(f, { readOnly: true }); d.exec('PRAGMA busy_timeout = 5000');
      const r = await makeBackup(d, backupDirOf(dataDir), { keep: Math.max(1, +process.env.BACKUP_KEEP || 7) }); d.close();
      if (!r.ok) throw new Error(r.error);
      console.log(`cópia pronta e verificada: ${r.file} (${mb(r.size)}, ${r.users} contas, ${r.messages} mensagens)`);
    } else if (cmd === 'listar') {
      const list = listBackups(backupDirOf(dataOf(a)));
      if (!list.length) console.log('nenhuma cópia em ' + backupDirOf(dataOf(a)));
      for (const x of list) console.log(`${x.file}  ${mb(x.size)}  ${new Date(x.at).toLocaleString('pt-BR')}`);
    } else if (cmd === 'verificar' && a) {
      const v = verifyFile(path.resolve(a));
      console.log(v.ok ? `ok: ${v.tables} tabelas, ${v.users} contas, ${v.messages} mensagens` : 'COM PROBLEMA: ' + v.error);
      process.exitCode = v.ok ? 0 : 1;
    } else if (cmd === 'restaurar' && a) {
      const r = restore(a, dataOf(b));
      console.log(`restaurado: ${r.file} (${r.users} contas, ${r.messages} mensagens)`);
      if (r.aside) console.log(`o banco anterior ficou em ${r.aside} (apague quando tiver certeza)`);
    } else {
      console.log('uso: node server/backup.js copiar [dados] | listar [dados] | verificar <arquivo> | restaurar <arquivo> [dados]');
      process.exitCode = 2;
    }
  } catch (e) { console.error('erro: ' + e.message); process.exitCode = 1; }
}
