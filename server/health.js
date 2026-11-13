// Saúde do servidor (monitoramento sem serviço de fora): o que a VPS está aguentando e o que está dando errado.
// - A cada 30 s: CPU (% de todos os núcleos), memória, disco da pasta de dados, rede (download/upload em Mbps, somando as
//   interfaces menos a local), memória do processo, pessoas conectadas, chamadas, pessoas em chamada, transmissões e
//   câmeras, e o estado de cada worker do SFU (vivo/morto, recriações, CPU). Guarda as últimas 24 h (2.880 amostras).
// - Tráfego do mês (upload e download somados, guardado em <dados>/traffic.json): a Hostinger e outras VPS têm franquia
//   mensal de banda; HEALTH_MONTHLY_TB avisa ao chegar em 80%.
// - Erros do servidor (console.error): os últimos 100 em memória e todos em <dados>/errors.log (gira em 5 MB).
// - Alertas (server/alerts.js: app do administrador + ALERT_WEBHOOK no celular), no máximo um por assunto a cada 30 min:
//   CPU alta por 1,5 min (HEALTH_CPU_PCT, padrão 85), pouca memória livre (HEALTH_MEM_PCT, padrão 10), disco quase cheio
//   (HEALTH_DISK_PCT, padrão 10, ou menos de 2 GB), upload perto do limite do link (HEALTH_UPLINK_MBPS, se definido;
//   alerta em 85%), worker do SFU morto ou perto de 100% de um núcleo, e muitos erros (20 em 5 min).
// - GET /api/health (só o administrador da instalação) devolve tudo; GET /healthz (público, sem números) responde 200 se
//   está tudo de pé ou 503 se não, para um monitor de fora (UptimeRobot, Uptime Kuma) avisar quando o servidor cair.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { sendAlert, recentAlerts } from './alerts.js';

const SAMPLE_MS = +(process.env.HEALTH_SAMPLE_MS || 30e3), KEEP = Math.round(24 * 3600e3 / SAMPLE_MS);
const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? +process.env[k] : d);
const LIM = {
  cpu: env('HEALTH_CPU_PCT', 85), mem: env('HEALTH_MEM_PCT', 10), disk: env('HEALTH_DISK_PCT', 10), diskGB: 2,
  uplink: env('HEALTH_UPLINK_MBPS', 0), monthlyTB: env('HEALTH_MONTHLY_TB', 0), workerCpu: 85, errors5m: 20,
};
const EVERY = 30 * 60e3;
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// ---- leituras do sistema ----
function cpuTimes() { let idle = 0, total = 0; for (const c of os.cpus()) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; } return { idle, total }; }
function memInfo() {
  const total = os.totalmem(); let avail = os.freemem();
  try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) avail = +m[1] * 1024; } catch { }
  return { total, avail };
}
function netBytes() {
  try {
    let rx = 0, tx = 0, n = 0;
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const m = /^\s*([^:]+):\s*(.*)$/.exec(line); if (!m || m[1] === 'lo') continue;
      const f = m[2].trim().split(/\s+/).map(Number); rx += f[0] || 0; tx += f[8] || 0; n++;
    }
    return n ? { rx, tx } : null;
  } catch { return null; }
}
function diskInfo(dir) { try { const s = fs.statfsSync(dir); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; } }

export function mountHealth(app, { auth, wrap, bad, isAdmin, dataDir, appStats, sfu }) {
  // ---- erros do servidor ----
  const errors = [], errLog = path.join(dataDir, 'errors.log');
  const origError = console.error.bind(console);
  console.error = (...a) => {
    origError(...a);
    try {
      const text = a.map(x => x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 2000);
      if (/^\(node:\d+\) \w*Warning/.test(text)) return; // aviso do próprio Node (ex.: SQLite experimental), não é erro
      errors.push({ at: Date.now(), text: text.slice(0, 400) }); if (errors.length > 100) errors.shift();
      try { if (fs.statSync(errLog).size > 5 * 2 ** 20) fs.renameSync(errLog, errLog + '.1'); } catch { }
      fs.appendFile(errLog, `${new Date().toISOString()} ${text.replace(/\n/g, '\n    ')}\n`, () => { });
      const recent = errors.filter(e => Date.now() - e.at < 5 * 60e3).length;
      if (recent >= LIM.errors5m) sendAlert('health:errors', `${recent} erros no servidor nos últimos 5 minutos. O último: ${text.split('\n')[0].slice(0, 200)}`, { every: EVERY });
    } catch { }
  };

  // ---- tráfego do mês (sobrevive a reinícios) ----
  const trafficFile = path.join(dataDir, 'traffic.json'), month = () => new Date().toISOString().slice(0, 7);
  let traffic = { month: month(), rx: 0, tx: 0 };
  try { const t = JSON.parse(fs.readFileSync(trafficFile, 'utf8')); if (t.month === traffic.month) traffic = { month: t.month, rx: +t.rx || 0, tx: +t.tx || 0 }; } catch { }
  let trafficDirty = false;
  const saveTraffic = () => { if (!trafficDirty) return; trafficDirty = false; fs.writeFile(trafficFile, JSON.stringify(traffic), () => { }); };
  setInterval(saveTraffic, 5 * 60e3).unref();

  // ---- amostras ----
  const hist = []; let prevCpu = cpuTimes(), prevNet = netBytes(), prevAt = Date.now(), cur = null, hiCpu = 0;
  async function sample() {
    const now = Date.now(), dt = Math.max(1, (now - prevAt) / 1000);
    const c = cpuTimes(), dTot = c.total - prevCpu.total, cpu = dTot > 0 ? 100 * (1 - (c.idle - prevCpu.idle) / dTot) : null; prevCpu = c;
    const nb = netBytes(); let down = null, up = null;
    if (nb && prevNet) {
      const drx = Math.max(0, nb.rx - prevNet.rx), dtx = Math.max(0, nb.tx - prevNet.tx);
      down = drx * 8 / dt / 1e6; up = dtx * 8 / dt / 1e6;
      if (traffic.month !== month()) traffic = { month: month(), rx: 0, tx: 0 };
      traffic.rx += drx; traffic.tx += dtx; trafficDirty = true;
    }
    prevNet = nb; prevAt = now;
    const m = memInfo(), d = diskInfo(dataDir), proc = process.memoryUsage();
    let a = {}; try { a = appStats() || {}; } catch { }
    let workers = []; try { workers = sfu.workers(); } catch { }
    let load = null; try { load = await sfu.load(); } catch { }
    const wcpu = load?.current?.per_worker ? Object.fromEntries(load.current.per_worker.map(x => [x.port, x.cpu])) : load?.current ? { [workers[0]?.port]: load.current.cpu } : {};
    for (const w of workers) w.cpu = wcpu[w.port] ?? null;
    cur = {
      t: now, cpu: r1(cpu), cores: os.cpus().length, load1: r1(os.loadavg()[0]),
      memUsedPct: r1(100 * (1 - m.avail / m.total)), memTotalMB: Math.round(m.total / 2 ** 20), memAvailMB: Math.round(m.avail / 2 ** 20),
      procMB: Math.round(proc.rss / 2 ** 20), heapMB: Math.round(proc.heapUsed / 2 ** 20),
      diskFreeGB: d ? r1(d.free / 2 ** 30) : null, diskTotalGB: d ? r1(d.total / 2 ** 30) : null, diskUsedPct: d ? r1(100 * (1 - d.free / d.total)) : null,
      downMbps: r1(down), upMbps: r1(up),
      online: a.online ?? null, connections: a.connections ?? null, calls: a.calls ?? null, inCalls: a.inCalls ?? null, screens: a.screens ?? null, cams: a.cams ?? null,
      sfuAlive: workers.filter(w => w.alive).length, sfuTotal: workers.length, workers,
    };
    hist.push({ t: now, cpu: cur.cpu, mem: cur.memUsedPct, up: cur.upMbps, down: cur.downMbps, online: cur.online, inCalls: cur.inCalls, calls: cur.calls, wcpu: workers.length ? Math.max(...workers.map(w => w.cpu ?? 0)) : null });
    if (hist.length > KEEP) hist.shift();
    check(cur);
    return cur;
  }
  // ---- alertas ----
  function check(s) {
    hiCpu = s.cpu != null && s.cpu >= LIM.cpu ? hiCpu + 1 : 0;
    if (hiCpu >= Math.max(1, Math.round(90e3 / SAMPLE_MS))) sendAlert('health:cpu', `CPU da VPS em ${Math.round(s.cpu)}% há mais de 1 minuto (${s.cores} núcleo(s), ${s.inCalls ?? 0} pessoa(s) em chamada). Se continuar, as chamadas vão picotar.`, { every: EVERY });
    if (s.memAvailMB != null && 100 * s.memAvailMB / s.memTotalMB <= LIM.mem) sendAlert('health:mem', `Memória da VPS quase cheia: ${s.memAvailMB} MB livres de ${s.memTotalMB} MB (o servidor usa ${s.procMB} MB).`, { every: EVERY });
    if (s.diskFreeGB != null && (100 - s.diskUsedPct <= LIM.disk || s.diskFreeGB < LIM.diskGB)) sendAlert('health:disk', `Disco quase cheio: ${s.diskFreeGB} GB livres de ${s.diskTotalGB} GB. Envios de arquivo e o banco podem falhar.`, { every: EVERY });
    if (LIM.uplink > 0 && s.upMbps != null && s.upMbps >= LIM.uplink * 0.85) sendAlert('health:uplink', `Upload do servidor em ${s.upMbps} Mbps, ${Math.round(100 * s.upMbps / LIM.uplink)}% do link (${LIM.uplink} Mbps). Transmissões e vozes vão começar a travar.`, { every: EVERY });
    if (LIM.monthlyTB > 0) { const tb = (traffic.tx + traffic.rx) / 1e12; if (tb >= LIM.monthlyTB * 0.8) sendAlert('health:monthly', `Tráfego do mês em ${tb.toFixed(2).replace('.', ',')} TB de ${LIM.monthlyTB} TB da franquia (${Math.round(100 * tb / LIM.monthlyTB)}%).`, { every: 24 * 3600e3 }); }
    for (const w of s.workers) if (w.alive && w.cpu != null && w.cpu >= LIM.workerCpu) sendAlert('health:wcpu:' + w.port, `Worker do SFU (porta ${w.port}) em ${Math.round(w.cpu)}% de um núcleo com ${w.peers} pessoa(s). Perto do limite: use SFU_WORKERS=auto (e abra as portas extras).`, { every: EVERY });
    if (s.sfuTotal && !s.sfuAlive) sendAlert('health:sfu-down', 'Nenhum worker do SFU está de pé: as chamadas estão sem áudio. O servidor está tentando recriar.', { every: 5 * 60e3 });
  }
  sfu.onEvent?.((kind, text) => {
    if (kind === 'worker_died') sendAlert('health:worker-died', text + '. Recriando sozinho; as chamadas voltam em alguns segundos.', { every: 5 * 60e3 });
    if (kind === 'worker_restart_failed') sendAlert('health:worker-restart', text, { every: 15 * 60e3 });
  });
  setTimeout(() => { sample().catch(() => { }); setInterval(() => sample().catch(() => { }), SAMPLE_MS).unref(); }, 2000).unref();

  app.get('/api/health', auth, wrap(async (req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    const now = cur && Date.now() - cur.t < 5e3 ? cur : await sample().catch(() => cur);
    let events = []; try { events = sfu.events(); } catch { }
    res.json({ now, history: hist, sample_ms: SAMPLE_MS, limits: LIM, traffic: { ...traffic }, alerts: recentAlerts().slice(-30), errors: errors.slice(-50).reverse(), sfu_events: events.slice(-20).reverse(),
      uptime_min: Math.round(process.uptime() / 60), node: process.version, host: { platform: `${os.type()} ${os.release()}`, cores: os.cpus().length, cpu: os.cpus()[0]?.model } });
  }));
  // monitor de fora: só "está de pé ou não" (nada de números para quem não é administrador)
  app.get('/healthz', (req, res) => {
    const down = []; if (cur?.sfuTotal && !cur.sfuAlive) down.push('voz'); if (cur?.diskFreeGB != null && cur.diskFreeGB < 0.2) down.push('disco');
    res.set('Cache-Control', 'no-store').status(down.length ? 503 : 200).json({ ok: !down.length, ...(down.length ? { falhando: down } : {}) });
  });
  return { sample, flush: saveTraffic };
}
