// Servidor reiniciando com todo mundo conectado: N pessoas (padrão 500, todas no mesmo servidor) caem juntas e
// reconectam como o app faz (public/app.js connect/onclose: confere a sessão com GET /users/0 e tenta de novo com espera
// crescente). Mede, depois que o servidor volta: quanto tempo até todos receberem o READY, READY p50/p95, tentativas
// recusadas e quanto o servidor demora a responder um pedido pequeno nesse meio-tempo. Compara a espera do app antigo (1, 2, 4, 8 s iguais para todos: chegam todos no
// mesmo milissegundo) com a nova (com sorteio, `reconnectDelay` em public/backoff.js).
// Uso: node scripts/reconnect-storm-test.mjs        (N=500 POLICY=old|new|both)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
import { reconnectDelay } from '../public/backoff.js';

const N = +(process.env.N || 500), PORT = 3327, BASE = `http://localhost:${PORT}`, DIR = './.testdata-storm';
const POLICIES = (process.env.POLICY || 'both') === 'both' ? ['old', 'new'] : [process.env.POLICY];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

console.log(`  preparando ${N} pessoas…`);
execFileSync(process.execPath, ['scripts/load/seed.mjs', String(N)], { env: { ...process.env, DATA_DIR: DIR }, stdio: 'ignore' });
const seed = JSON.parse(fs.readFileSync(DIR + '/load.json', 'utf8'));
let srv = null;
const up = async () => {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41170', RTC_IPS: '127.0.0.1', WS_DEFLATE: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); return performance.now(); } catch { await sleep(20); } }
  throw new Error('servidor não subiu');
};
const down = () => new Promise(r => { srv.once('exit', r); srv.kill('SIGTERM'); });
process.on('exit', () => { try { srv?.kill('SIGKILL'); } catch { } });
const cpuOf = () => { try { const f = fs.readFileSync(`/proc/${srv.pid}/stat`, 'utf8').split(') ')[1].split(' '); return (+f[11] + +f[12]) * 10; } catch { return null; } };

// uma "pessoa": a mesma lógica de reconexão do app
function person(i, policy, m) {
  const tok = 'load-' + i; let retry = 0, ws = null, t0 = 0, stopped = false, timer = null;
  const delay = () => policy === 'old' ? Math.min(1000 * 2 ** retry++, 8000) : reconnectDelay(retry++);
  const connect = () => {
    if (stopped) return; t0 = performance.now(); m.attempts++;
    ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok + '&tab=t' + i);
    ws.on('message', (raw) => {
      if (!raw.subarray(0, 20).toString().includes('"READY"')) return;
      retry = 0; m.ready.push(performance.now() - t0); m.readyAt.push(performance.now()); m.online++;
      if (i % 5 === 0) ws.send(JSON.stringify({ t: 'VIEW', d: { guild_id: seed.guild } })); // 20% olhando o servidor
    });
    ws.on('error', () => { });
    ws.on('close', async () => {
      if (stopped) return; m.online = Math.max(0, m.online - (ws.wasReady ? 1 : 0));
      try { await fetch(BASE + '/api/users/0', { headers: { authorization: 'Bearer ' + tok } }); m.checks++; } catch { m.refused++; }
      timer = setTimeout(connect, delay());
    });
    ws.on('message', function once(raw) { if (raw.subarray(0, 20).toString().includes('"READY"')) { ws.wasReady = true; ws.off('message', once); } });
  };
  connect();
  return { stop() { stopped = true; clearTimeout(timer); try { ws.terminate(); } catch { } } };
}

const results = {};
try {
  for (const policy of POLICIES) {
    await up();
    const m = { ready: [], readyAt: [], attempts: 0, refused: 0, checks: 0, online: 0 };
    const people = []; for (let i = 0; i < N; i++) { people.push(person(i, policy, m)); if (i % 50 === 49) await sleep(100); }
    for (let i = 0; i < 600 && m.ready.length < N; i++) await sleep(50);
    ok(m.ready.length >= N, `[${policy}] ${N} conectados antes de reiniciar`, m.ready.length);
    // reinicia: cai todo mundo, volta 3 s depois
    m.ready = []; m.readyAt = []; m.attempts = 0; m.refused = 0; m.checks = 0;
    await down(); const tDown = performance.now();
    await sleep(3000);
    const tUp = await up(), cpu0 = cpuOf();
    // sonda: alguém que já está com o app aberto pedindo algo pequeno a cada 50 ms — quanto o servidor demora a responder
    const probe = []; let probing = true;
    (async () => { while (probing) { const t = performance.now(); try { await fetch(BASE + '/api/server-info'); probe.push(performance.now() - t); } catch { } await sleep(50); } })();
    for (let i = 0; i < 600 && m.ready.length < N; i++) await sleep(50);
    probing = false;
    const all = m.ready.length >= N ? Math.round(Math.max(...m.readyAt) - tUp) : null;
    await sleep(500);
    const cpu1 = cpuOf();
    // quantos chegaram no mesmo instante: maior número de READY dentro de uma janela de 100 ms
    const at = [...m.readyAt].sort((a, b) => a - b); let burst = 0; for (let a = 0, b = 0; b < at.length; b++) { while (at[b] - at[a] > 100) a++; burst = Math.max(burst, b - a + 1); }
    results[policy] = { todos_de_volta_ms: all, ready_p50: q(m.ready, .5), ready_p95: q(m.ready, .95), ready_max: q(m.ready, 1), pico_100ms: burst,
      tentativas: m.attempts, recusadas: m.refused, cpu_servidor_ms: cpu1 != null && cpu0 != null ? cpu1 - cpu0 : null,
      api_p95: q(probe, .95), api_max: q(probe, 1), fora_ms: Math.round(tUp - tDown) };
    console.log(`  [${policy}]`, JSON.stringify(results[policy]));
    ok(m.ready.length >= N, `[${policy}] todos voltaram depois do reinício`, m.ready.length);
    people.forEach(p => p.stop()); await down(); await sleep(300);
  }
  if (results.new) {
    ok(results.new.pico_100ms < N / 2, 'nova espera: a volta se espalha (menos da metade no mesmo 1/10 de segundo)', results.new.pico_100ms);
    ok(results.new.todos_de_volta_ms != null && results.new.todos_de_volta_ms < 6000, 'nova espera: todos de volta em menos de 6 s depois que o servidor sobe', results.new.todos_de_volta_ms);
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
} catch (e) { console.log('ERRO', e); fails++; }
finally { try { srv?.kill('SIGKILL'); } catch { } console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
