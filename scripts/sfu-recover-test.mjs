// Recuperação dos workers do mediasoup (server/sfu.js), sem navegador: worker morto é recriado na mesma porta, worker
// travado (SIGSTOP: o processo existe mas não responde) é detectado pelo vigia e recriado, e crash em laço espera mais.
// Uso: node scripts/sfu-recover-test.mjs
process.env.RTC_PORT ||= '41300'; process.env.RTC_IPS ||= '127.0.0.1';
process.env.SFU_SAMPLE_MS = '500'; process.env.SFU_HANG_MS = '700';
const { startSfu, sfuWorkers, onSfuEvent, sfuReady } = await import('../server/sfu.js');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const evs = []; onSfuEvent((kind, text) => evs.push({ kind, text, at: Date.now() }));
const until = async (fn, ms) => { for (const t = Date.now() + ms; Date.now() < t; await sleep(100)) if (fn()) return true; return false; };
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
try {
  ok(await startSfu(), 'SFU abriu');
  const pid0 = sfuWorkers()[0].pid;
  // 1) morte: recriado na mesma porta
  process.kill(pid0, 'SIGKILL');
  ok(await until(() => evs.some(e => e.kind === 'worker_restarted'), 5000), 'worker morto foi recriado', evs.map(e => e.kind));
  const w1 = sfuWorkers();
  ok(w1.length === 1 && w1[0].alive && w1[0].pid !== pid0 && w1[0].port === 41300 && w1[0].restarts === 1, 'um só worker, vivo, mesma porta', w1);
  // 2) travado: SIGSTOP; o vigia (getResourceUsage com prazo) mata e recria
  const pid1 = w1[0].pid; evs.length = 0;
  process.kill(pid1, 'SIGSTOP');
  ok(await until(() => evs.some(e => e.kind === 'worker_hung'), 6000), 'worker travado detectado', evs.map(e => e.kind));
  ok(await until(() => evs.some(e => e.kind === 'worker_restarted'), 8000), 'worker travado recriado', evs.map(e => e.text));
  ok(await until(() => gone(pid1), 3000), 'processo travado não ficou órfão');
  const w2 = sfuWorkers();
  ok(w2.length === 1 && w2[0].alive && w2[0].pid !== pid1 && sfuReady(), 'voltou a ter worker vivo', w2);
  // 3) crash em laço: cada queda logo depois de recriar espera mais (2 s, 5 s, 10 s…), não volta a 1 s
  evs.length = 0; const t0 = Date.now();
  process.kill(w2[0].pid, 'SIGKILL');
  ok(await until(() => evs.some(e => e.kind === 'worker_restarted'), 14000), 'recriado depois da 3ª queda');
  const dt = evs.find(e => e.kind === 'worker_restarted').at - t0;
  ok(dt >= 8000, 'queda logo depois de recriar espera mais (crash em laço)', { ms: dt });
  ok(sfuWorkers().length === 1, 'sem worker duplicado');
} catch (e) { ok(false, 'erro: ' + e.message); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
