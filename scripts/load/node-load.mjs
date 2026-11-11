// Mesmo cenário do k6-resenha.js, em Node (para rodar onde não há k6): pessoas abrindo o app pelo WebSocket, carregando
// mensagens, abrindo perfis e mandando mensagens; sobe para 100, segura, sobe para MAX e segura.
// Uso: BASE=http://localhost:3000 MAX=1000 node scripts/load/node-load.mjs   (banco do seed.mjs; WORKERS=3 processos)
// Mostra a cada 15 s: pessoas online, READY, chamadas, entrega de mensagens e o servidor (event loop, CPU, memória).
import { fork } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const BASE = process.env.BASE || 'http://localhost:3000', MAX = +(process.env.MAX || 1000), N = +(process.env.USERS || 1000);
const WORKERS = +(process.env.WORKERS || 3), SPEED = +(process.env.SPEED || 1); // SPEED 2 = fases na metade do tempo
// VIEW_PCT: % das pessoas olhando o servidor (as outras nas DMs); sem ele, clientes antigos (sem VIEW: recebem tudo)
const VIEW_PCT = process.env.VIEW_PCT != null ? +process.env.VIEW_PCT : null;
const PHASES = MAX <= 100 ? [[60, 100], [120, 100]] : [[60, 100], [90, 100], [120, MAX], [150, MAX]]; // [segundos, alvo]
// amostra justa de no máximo 20 mil valores (reservatório): com 1000 pessoas são centenas de milhares de entregas
const sample = (arr, v, n, max = 20000) => { if (arr.length < max) arr.push(v); else { const j = Math.floor(Math.random() * n); if (j < max) arr[j] = v; } };
const addAll = (a, b) => { for (const v of b) a.push(v); };
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

if (process.argv[2] === 'worker') {
  // ---------- processo que simula uma fatia das pessoas ----------
  const [, , , from, step] = process.argv.map(Number);
  const vus = new Map(); let m = { ready: [], http: {}, entrega: [], erros: 0, wsFail: 0, recebidas: 0, frames: 0, bytes: 0 };
  const rec = (name, ms, ok) => { (m.http[name] ||= []).push(ms); if (!ok) m.erros++; };
  const call = async (name, path, opt = {}) => { const t0 = performance.now(); try { const r = await fetch(BASE + path, opt); await r.arrayBuffer(); rec(name, performance.now() - t0, r.ok); } catch { rec(name, performance.now() - t0, false); } };
  function start(k) {
    const i = (from + k * step) % N, tok = 'load-' + i, auth = { authorization: 'Bearer ' + tok };
    const v = { timers: [], ws: null, alive: true }; vus.set(k, v);
    const t0 = performance.now(), ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/gateway?token=' + tok); v.ws = ws;
    const every = (ms, fn) => v.timers.push(setInterval(fn, ms + Math.random() * ms * 0.4));
    ws.on('message', (raw) => {
      m.frames++; m.bytes += raw.length;
      // só decodifica o que interessa (o simulador também roda nesta máquina; não pode virar o gargalo)
      const head = raw.subarray(0, 40).toString();
      if (!head.includes('"READY"') && !head.includes('"MESSAGE_CREATE"')) return;
      const e = JSON.parse(raw);
      if (e.t === 'READY') {
        m.ready.push(performance.now() - t0);
        if (VIEW_PCT != null) ws.send(JSON.stringify({ t: 'VIEW', d: { guild_id: Math.random() * 100 < VIEW_PCT ? e.d.guilds[0].id : null } }));
        const g = e.d.guilds[0], chans = g.channels.filter(c => c.type === 0).map(c => c.id), mem = g.members.map(x => x.user_id);
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        every(10e3, () => call('GET mensagens', `/api/channels/${pick(chans)}/messages?limit=50`, { headers: { ...auth, 'accept-encoding': 'br' } }));
        every(20e3, () => call('GET perfil', `/api/users/${pick(mem)}`, { headers: auth }));
        // quem escreve manda "digitando…" antes (o app manda a cada 3 s enquanto digita); TYPING=0 desliga
        if (process.env.TYPING !== '0') every(30e3, () => { const c = pick(chans); ws.send(JSON.stringify({ t: 'TYPING', d: { channel_id: c } })); setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'TYPING', d: { channel_id: c } })), 3000); });
        every(30e3, () => call('POST mensagem', `/api/channels/${pick(chans)}/messages`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ content: `carga ${i} @${Date.now()}` }) }));
        v.timers.push(setTimeout(() => { stop(k); if (vus.size < target) start(k); }, (120 + Math.random() * 120) * 1000)); // sai e volta (reabre o app)
      } else if (e.t === 'MESSAGE_CREATE') { m.recebidas++; const at = /@(\d{13})$/.exec(e.d.content || ''); if (at) sample(m.entrega, Date.now() - +at[1], m.recebidas); }
    });
    ws.on('error', () => { m.wsFail++; }); ws.on('close', () => { if (v.alive) { stop(k); } });
  }
  function stop(k) { const v = vus.get(k); if (!v) return; v.alive = false; v.timers.forEach(t => { clearInterval(t); clearTimeout(t); }); try { v.ws.close(); } catch { } vus.delete(k); }
  let target = 0;
  process.on('message', (msg) => {
    if (msg.target != null) { target = msg.target; let k = 0; while (vus.size < target) { while (vus.has(k)) k++; start(k); } for (const kk of [...vus.keys()]) if (vus.size > target) stop(kk); }
    if (msg.report) { process.send({ m, online: vus.size }); m = { ready: [], http: {}, entrega: [], erros: 0, wsFail: 0, recebidas: 0, frames: 0, bytes: 0 }; }
    if (msg.end) { for (const k of [...vus.keys()]) stop(k); setTimeout(() => process.exit(0), 500); }
  });
} else {
  // ---------- coordenador ----------
  const admin = { authorization: 'Bearer load-0' }; // a conta mais antiga = administrador (vê /api/perf)
  const pid = +(process.env.SERVER_PID || 0);
  const cpu = () => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (+f[11] + +f[12]) / 100; } catch { return null; } };
  const rss = () => { try { return Math.round(+fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1] / 1024); } catch { return null; } };
  const ws = Array.from({ length: WORKERS }, (_, w) => fork(new URL(import.meta.url).pathname, ['worker', w, WORKERS]));
  const all = { ready: [], http: {}, entrega: [], erros: 0, wsFail: 0, recebidas: 0, frames: 0, bytes: 0 };
  let phase = 0, phaseT = 0, cur = 0, lastCpu = cpu(), t = 0;
  const setTarget = (n) => { cur = n; ws.forEach((w, i) => w.send({ target: Math.floor(n / WORKERS) + (i < n % WORKERS ? 1 : 0) })); };
  const rows = [];
  const tick = async () => {
    const parts = await Promise.all(ws.map(w => new Promise(r => { w.once('message', r); w.send({ report: true }); })));
    const s = { ready: [], http: {}, entrega: [], erros: 0, wsFail: 0, recebidas: 0, frames: 0, bytes: 0 }; let online = 0;
    for (const p of parts) { online += p.online; addAll(s.ready, p.m.ready); addAll(s.entrega, p.m.entrega); s.erros += p.m.erros; s.wsFail += p.m.wsFail; s.recebidas += p.m.recebidas; s.frames += p.m.frames; s.bytes += p.m.bytes; for (const [k, a] of Object.entries(p.m.http)) addAll(s.http[k] ||= [], a); }
    all.n = (all.n || 0); for (const v of s.entrega) sample(all.entrega, v, ++all.n);
    addAll(all.ready, s.ready); all.erros += s.erros; all.wsFail += s.wsFail; all.recebidas += s.recebidas; all.frames += s.frames; all.bytes += s.bytes; for (const [k, a] of Object.entries(s.http)) addAll(all.http[k] ||= [], a);
    const perf = await fetch(BASE + '/api/perf', { headers: admin }).then(r => r.json()).catch(() => null);
    const c = cpu(), cpuPct = c != null && lastCpu != null ? Math.round((c - lastCpu) / 15 * 100) : null; lastCpu = c;
    const httpAll = Object.values(s.http).flat();
    const row = { t, online, ready_p95: q(s.ready, .95), http_p95: q(httpAll, .95), http_max: q(httpAll, 1), entrega_p95: q(s.entrega, .95), erros: s.erros + s.wsFail,
      loop_p99: perf?.event_loop_ms?.event_loop_p99?.max ?? null, cpu: cpuPct, mem: rss() };
    rows.push(row);
    console.log(`${String(t).padStart(4)}s  online ${String(online).padStart(4)}  READY p95 ${row.ready_p95 ?? '-'} ms  API p95 ${row.http_p95 ?? '-'} ms (máx ${row.http_max ?? '-'})  entrega p95 ${row.entrega_p95 ?? '-'} ms  erros ${row.erros}  | servidor: event loop p99 ${row.loop_p99 != null ? Math.round(row.loop_p99) : '-'} ms, CPU ${cpuPct ?? '-'}%, ${row.mem ?? '-'} MB`);
  };
  const total = PHASES.reduce((a, [s]) => a + s, 0) / SPEED;
  console.log(`Teste de carga: até ${MAX} pessoas, ${Math.round(total)} s, ${WORKERS} processos, servidor ${BASE}`);
  const timer = setInterval(async () => {
    t += 5; phaseT += 5;
    if (phase < PHASES.length) {
      const [secs, to] = PHASES[phase], from = phase ? PHASES[phase - 1][1] : 0;
      setTarget(Math.round(from + (to - from) * Math.min(1, phaseT / (secs / SPEED))));
      if (phaseT >= secs / SPEED) { phase++; phaseT = 0; }
    }
    if (t % 15 === 0) await tick();
    if (phase >= PHASES.length) {
      clearInterval(timer); await tick();
      const perf = await fetch(BASE + '/api/perf', { headers: admin }).then(r => r.json()).catch(() => null);
      console.log('\n=== resumo do teste inteiro ===');
      console.log(`READY: p50 ${q(all.ready, .5)} ms · p95 ${q(all.ready, .95)} ms · máx ${q(all.ready, 1)} ms (${all.ready.length} aberturas)`);
      for (const [k, a] of Object.entries(all.http)) console.log(`${k}: p50 ${q(a, .5)} ms · p95 ${q(a, .95)} ms · máx ${q(a, 1)} ms (${a.length})`);
      console.log(`entrega de mensagem: p50 ${q(all.entrega, .5)} ms · p95 ${q(all.entrega, .95)} ms (${all.recebidas} recebidas)`);
      console.log(`erros: ${all.erros} chamadas, ${all.wsFail} conexões`);
      console.log(`gateway: ${all.frames} mensagens recebidas pelas pessoas, ${(all.bytes / 1048576).toFixed(1)} MB`);
      if (perf) { console.log('servidor (rotas mais lentas, p95):'); Object.entries(perf.servidor_ms).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 6).forEach(([k, v]) => console.log(`  ${k}: p95 ${v.p95} ms, máx ${v.max} ms (${v.n})`)); console.log('alertas:', perf.alertas?.map(a => a.text) || []); }
      fs.writeFileSync(process.env.OUT || '.load-result.json', JSON.stringify({ rows, perf }, null, 1));
      ws.forEach(w => w.send({ end: true })); setTimeout(() => process.exit(0), 1500);
    }
  }, 5000);
}
