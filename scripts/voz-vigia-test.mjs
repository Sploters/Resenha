// Vigia do processo da voz (server/voz.js) sobre o app filho, sem navegador: app travado (SIGSTOP: existe mas não fala)
// é encerrado e reaberto; SIGTERM com o app travado não deixa o app órfão (SIGKILL no fim do prazo).
// Uso: node scripts/voz-vigia-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await Promise.resolve().then(fn).catch(() => false)) return true; await sleep(200); } return false; };
const PORT = 3364, DIR = path.resolve('.testdata-vozvigia');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const voz = spawn(process.execPath, ['server/voz.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41420', RTC_IPS: '127.0.0.1', VOZ_APP_HANG_MS: '6000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; voz.stdout.on('data', (c) => { log += c; }); voz.stderr.on('data', (c) => { log += c; });
process.on('exit', () => { try { voz.kill('SIGKILL'); } catch { } });
const up = () => fetch(`http://localhost:${PORT}/api/server-info`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
const appPid = () => { try { return +execFileSync('pgrep', ['-P', String(voz.pid), '-f', 'server/index.js']).toString().trim().split('\n')[0] || 0; } catch { return 0; } };
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
try {
  ok(await until(up, 30000), 'servidor subiu');
  const pid1 = appPid(); ok(pid1 > 0, 'app filho achado', pid1);
  await sleep(4000); // o app já mandou mensagens (o vigia só arma depois da primeira)
  process.kill(pid1, 'SIGSTOP');
  ok(await until(() => /não responde há/.test(log), 20000), 'processo da voz percebe o app travado');
  ok(await until(() => gone(pid1), 5000), 'app travado encerrado');
  ok(await until(async () => appPid() && appPid() !== pid1 && await up(), 30000), 'app reaberto e respondendo', appPid());
  const pid2 = appPid(); await sleep(1500);
  process.kill(pid2, 'SIGSTOP');
  const t0 = Date.now(); voz.kill('SIGTERM');
  ok(await until(() => voz.exitCode !== null, 12000), 'SIGTERM encerra o processo da voz mesmo com o app travado', { code: voz.exitCode, ms: Date.now() - t0 });
  ok(await until(() => gone(pid2), 3000), 'sem app órfão depois de encerrar', pid2);
} catch (e) { ok(false, 'erro: ' + e.message); }
if (fails) console.log(log.split('\n').filter(l => /\[voz\]/.test(l)).join('\n'));
fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
