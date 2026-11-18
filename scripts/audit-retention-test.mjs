// Registro de auditoria guardado por 45 dias: a leitura não mostra o que passou disso e, ao subir, o servidor apaga.
// Uso: node scripts/audit-retention-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const PORT = 3398, BASE = `http://localhost:${PORT}`, DIR = './.testdata-audit';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let srv = null;
const up = async () => {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41540', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(200); } }
  throw new Error('servidor não subiu');
};
const down = () => new Promise(r => { if (!srv || srv.exitCode !== null) return r(); srv.once('exit', r); srv.kill(); });
process.on('exit', () => { try { srv?.kill(); } catch { } });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json()) }));
fs.rmSync(DIR, { recursive: true, force: true });
try {
  await up();
  const tok = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token;
  const g = await call(tok, 'POST', '/guilds', { name: 'G' });
  await call(tok, 'POST', `/guilds/${g.id}/roles`, { name: 'agora' }); // entrada de verdade, de agora
  const db = new DatabaseSync(DIR + '/resenha.db'), day = 864e5;
  const ins = db.prepare("INSERT INTO audit_log(id,guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,NULL,'role_create',NULL,?,?)");
  ins.run('0000old46', g.id, '46 dias', Date.now() - 46 * day); ins.run('0000old44', g.id, '44 dias', Date.now() - 44 * day);
  const r = await call(tok, 'GET', `/guilds/${g.id}/audit`), det = r.entries.map(e => e.details);
  ok(r.keep_days === 45, 'informa o prazo (45 dias)', r.keep_days);
  ok(det.includes('agora') && det.includes('44 dias'), 'mostra o que tem menos de 45 dias', det);
  ok(!det.includes('46 dias'), 'não mostra o que passou de 45 dias');
  const page = await call(tok, 'GET', `/guilds/${g.id}/audit?before=zzzzzzzzzzzz`);
  ok(!page.entries.some(e => e.details === '46 dias'), '"Carregar mais" também não traz o vencido');
  await down(); await up(); // ao subir, apaga o vencido do banco
  const left = db.prepare('SELECT details FROM audit_log WHERE guild_id=?').all(g.id).map(x => x.details);
  ok(!left.includes('46 dias') && left.includes('44 dias') && left.includes('agora'), 'ao subir, o servidor apaga só o que passou de 45 dias', left);
  db.close();
} finally { await down(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
