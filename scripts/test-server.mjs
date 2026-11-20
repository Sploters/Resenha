// Servidor próprio para os testes que antes esperavam um servidor já rodando na porta 3000 (e2e, features, fase2):
// sem BASE/API no ambiente, sobe um em DATA_DIR limpo numa porta livre e o derruba quando o teste sai.
// Uso: const BASE = process.env.BASE || await ownServer('e2e', 3321, 41120)
import { spawn } from 'node:child_process'; import fs from 'node:fs';
// alertas de saúde desligados: dependem da máquina que roda o teste (ex.: "Disco quase cheio" no container) e viravam
// notificação no meio do teste; o health-test liga os dele
const HEALTH_OFF = { HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' };
export async function ownServer(name, port, rtcPort, env = {}) {
  const dir = `./.testdata-${name}`;
  fs.rmSync(dir, { recursive: true, force: true });
  const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), HTTPS: '0', DATA_DIR: dir, RTC_PORT: String(rtcPort), RTC_IPS: '127.0.0.1', ...HEALTH_OFF, ...env }, stdio: 'ignore' });
  const kill = () => { try { srv.kill(); } catch { } };
  process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit(130); });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) { try { await fetch(base + '/api/server-info'); console.log(`  (servidor de teste em ${base}, dados em ${dir})`); return base; } catch { await new Promise(r => setTimeout(r, 200)); } }
  kill(); throw new Error('servidor de teste não subiu em ' + base);
}
