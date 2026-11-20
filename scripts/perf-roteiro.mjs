// Roteiro fixo de chamada com transmissão (docs/PROMPTS.md, prompt 2): 3 pessoas em navegadores separados, as 3 falando
// (microfone falso do Chromium), a Alice transmitindo 1080p60 (câmera falsa do Chromium em 1920×1080 a 60 FPS) e o
// Bruno e a Carla assistindo. A Carla muta e desmuta a cada 20 s. Toda a mídia passa por um relé UDP (como no
// voice-network-test) que derruba a rede de propósito:
//   queda 1 (aos 30% do tempo): a rede do SERVIDOR pisca por 8 s (todo o UDP de todos para de passar);
//   queda 2 (aos 65%): a ALICE (quem transmite) fica 15 s sem rede (o UDP dela e a conexão em tempo real, que também
//   não consegue reconectar enquanto durar a queda), como numa troca de Wi-Fi.
// Mede, a cada segundo, o que cada um RECEBE (getStats: perda, oscilação, quadros por segundo, resolução, congelamentos,
// áudio inventado para tapar buraco) e, a cada 2 s, a CPU (% de um núcleo) e a memória de cada navegador inteiro.
// No fim: média, p99 e máximo por papel; quem viu alguém sair da sala; segundos sem imagem da transmissão.
// Uso: MIN=10 node scripts/perf-roteiro.mjs [rótulo]   -> .testshots/roteiro-<rótulo>.json
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
const PORT = 3352, BASE = `http://localhost:${PORT}`, DATA = './.testdata-roteiro', RTC = 41380;
const MIN = +(process.env.MIN || 10), LABEL = process.argv[2] || 'atual', TOTAL = MIN * 60000;
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('.testshots', { recursive: true });

// ---- relé UDP: 127.0.0.1:RTC (o que o navegador vê) <-> 127.0.0.2:RTC (o SFU) ----
const net = { all: false, ports: new Set() }; // all: ninguém passa; ports: portas locais (do navegador) sem rede
const front = dgram.createSocket('udp4'), back = new Map(); let closed = false, dropped = 0;
const send = (s, m, port, addr) => { if (!closed) s.send(m, port, addr); };
const cut = (port) => net.all || net.ports.has(port);
front.on('message', (msg, from) => {
  const k = from.address + ':' + from.port; let b = back.get(k);
  if (!b) { b = dgram.createSocket('udp4'); back.set(k, b); b.on('message', (m) => { if (cut(from.port)) { dropped++; return; } send(front, m, from.port, from.address); }); }
  if (cut(from.port)) { dropped++; return; }
  send(b, msg, RTC, '127.0.0.2');
});
await new Promise(r => front.bind(RTC, '127.0.0.1', r));

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC), RTC_ANNOUNCED_IP: '127.0.0.1', RTC_LISTEN_IP: '127.0.0.2' }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(100); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { nome: n, tok: r.token, id: me.id }; };

// CPU e memória de um navegador inteiro (todos os processos dele), por /proc
const kids = (root) => { const all = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d)).map(pid => { try { return [+pid, +fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]]; } catch { return null; } }).filter(Boolean); const k = new Set([root]); for (let i = 0; i < 5; i++) for (const [p, pp] of all) if (k.has(pp)) k.add(p); return [...k]; };
const ticks = (pids) => pids.reduce((t, pid) => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return t + +f[11] + +f[12]; } catch { return t; } }, 0) / 100;
const rssMB = (pids) => Math.round(pids.reduce((s, pid) => { try { return s + +fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1] * 4096; } catch { return s; } }, 0) / 1048576);

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const R = { label: LABEL, minutos: MIN, inicio: new Date().toISOString(), eventos: [], amostras: { cpu: {}, rx: {} }, saidasVistas: {}, erros: [] };
const P = {};
const ev = (msg) => { const t = +((Date.now() - (R.t0 || Date.now())) / 1000).toFixed(1); R.eventos.push({ t, msg }); console.log(`  [${String(t).padStart(6)} s] ${msg}`); };
async function abrir(u) {
  const br = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 120000, args });
  const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => R.erros.push(`${u.nome}: ${e.message}`));
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    // "tela" = câmera falsa do Chromium em 1080p60 (barata e sempre igual)
    navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080, frameRate: 60 }, audio: false });
    // conexões em tempo real: guarda todas, anota quem os outros viram sair e permite bloquear a reconexão (queda de rede)
    const W = window.WebSocket; window.__ws = []; window.__left = []; window.__blockWs = false;
    window.WebSocket = function (url, ...x) { const s = new W(window.__blockWs ? url.replace('/gateway?', '/gateway-sem-rede?') : url, ...x); window.__ws.push(s);
      s.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.t === 'VOICE_STATE' && m.d && !m.d.channel_id) window.__left.push({ uid: m.d.user_id, at: Date.now() }); } catch { } }); return s; };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  }, u.tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  P[u.nome] = { ...u, br, p, pids: kids(br.process().pid) };
  return P[u.nome];
}
// o que a pessoa recebe agora (contadores acumulados; a diferença entre amostras vira taxa)
const recebe = (p) => p.evaluate(async () => {
  const v = window.__lc.voice, s = v.sfu; if (!s?.recv) return { semSfu: true, naSala: !!v.channelId };
  const o = { naSala: !!v.channelId, recuperando: !!v.recovering, audio: {}, video: null };
  for (const e of s.consumers.values()) {
    const st = await e.c.rtpReceiver.getStats();
    st.forEach(x => {
      if (x.type !== 'inbound-rtp') return;
      if (x.kind === 'audio') o.audio[e.uid] = { rec: x.packetsReceived || 0, lost: x.packetsLost || 0, conc: x.concealedSamples || 0, samples: x.totalSamplesReceived || 0, jitter: x.jitter || 0 };
      else if (e.source === 'screen') o.video = { rec: x.packetsReceived || 0, lost: x.packetsLost || 0, dec: x.framesDecoded || 0, drop: x.framesDropped || 0, w: x.frameWidth || 0, h: x.frameHeight || 0, fps: x.framesPerSecond || 0, freezes: x.freezeCount || 0, freezeS: x.totalFreezesDuration || 0, jitter: x.jitter || 0, bytes: x.bytesReceived || 0 };
    });
  }
  return o;
});
// portas locais (UDP) das conexões de mídia da pessoa: o relé derruba só elas
const portas = (p) => p.evaluate(async () => { const s = window.__lc.voice.sfu, ps = new Set(); for (const t of [s?.send, s?.recv]) { if (!t) continue; (await t.getStats()).forEach(x => { if (x.type === 'local-candidate' && x.port) ps.add(x.port); }); } return [...ps]; });
async function semRede(u, ms) {
  const ps = await portas(u.p); for (const x of ps) net.ports.add(x);
  await u.p.evaluate(() => { window.__blockWs = true; window.__ws.at(-1)?.close(); });
  ev(`${u.nome} sem rede por ${ms / 1000} s (portas ${ps.join(', ')} e a conexão em tempo real)`);
  await sleep(ms);
  for (const x of ps) net.ports.delete(x);
  await u.p.evaluate(() => { window.__blockWs = false; });
  ev(`${u.nome} com rede de novo`);
}
const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const media = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;

let fim = false;
try {
  const [alice, bruno, carla] = [await reg('alice'), await reg('bruno'), await reg('carla')];
  const g = await api(alice.tok, 'POST', '/guilds', { name: 'Turma' }), inv = (await api(alice.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [bruno, carla]) await api(u.tok, 'POST', '/invites/' + inv);
  for (const u of [alice, bruno, carla]) await abrir(u);
  const vc = await P.alice.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const n of ['alice', 'bruno', 'carla']) await P[n].p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 200 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await P.alice.p.evaluate(() => window.__lc.voice.toggleScreen({ res: 1080, fps: 60, audio: false, hint: 'motion' }));
  for (const n of ['bruno', 'carla']) await P[n].p.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'screen'), { timeout: 30000 }, alice.id).catch(() => R.erros.push(n + ' não recebeu a transmissão'));
  for (const n of ['bruno', 'carla']) await P[n].p.evaluate((uid) => window.__lc.voice.openStream(uid), alice.id);
  await sleep(8000); // tudo assentado (o controle de banda sobe a qualidade)
  R.t0 = Date.now(); ev('começou');
  const mem0 = {}; for (const n in P) mem0[n] = { rssMB: rssMB(P[n].pids = kids(P[n].br.process().pid)), heapMB: await P[n].p.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)) };

  // CPU de cada navegador a cada 2 s
  const cpu = (async () => { let last = {}; for (const n in P) last[n] = ticks(P[n].pids); let lt = Date.now();
    while (!fim) { await sleep(2000); const now = Date.now(), dt = (now - lt) / 1000; lt = now;
      for (const n in P) { P[n].pids = kids(P[n].br.process().pid); const t = ticks(P[n].pids); (R.amostras.cpu[n] ||= []).push(+((t - last[n]) / dt * 100).toFixed(1)); last[n] = t; } } })();
  // o que cada um recebe, a cada 1 s
  const rx = (async () => { while (!fim) { const t = +((Date.now() - R.t0) / 1000).toFixed(1); for (const n in P) { try { (R.amostras.rx[n] ||= []).push({ t, ...(await recebe(P[n].p)) }); } catch (e) { R.erros.push(`getStats ${n}: ${e.message}`); } } await sleep(1000); } })();
  // Carla: muta e desmuta a cada 20 s
  const mute = (async () => { while (!fim) { await sleep(20000); if (!fim) await P.carla.p.evaluate(() => window.__lc.voice.toggleMute()).catch(() => { }); } })();
  // as duas quedas
  const quedas = (async () => {
    await sleep(TOTAL * 0.30); if (fim) return; net.all = true; ev('rede do servidor caiu (todo o UDP) por 8 s'); await sleep(8000); net.all = false; ev('rede do servidor voltou');
    await sleep(TOTAL * 0.35 - 8000); if (fim) return; await semRede(P.alice, 15000);
  })();
  await sleep(TOTAL); fim = true; await Promise.all([cpu, rx, mute, quedas]);
  ev('fim');

  // ---------- resumo ----------
  const S = R.resumo = { cpu: {}, memoria: {}, recebe: {}, saidasVistas: {}, continuaNaSala: {} };
  for (const n in P) { const a = R.amostras.cpu[n]; S.cpu[n] = { media: media(a), p99: pct(a, 0.99), max: Math.max(...a) }; }
  for (const n in P) { P[n].pids = kids(P[n].br.process().pid); S.memoria[n] = { rssMB: [mem0[n].rssMB, rssMB(P[n].pids)], heapMB: [mem0[n].heapMB, await P[n].p.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1))] }; }
  for (const n in P) { S.saidasVistas[n] = await P[n].p.evaluate(() => window.__left.length); S.continuaNaSala[n] = await P[n].p.evaluate(() => !!window.__lc.voice.channelId && !!window.__lc.voice.sfu?.ready); }
  S.aliceTransmitindo = await P.alice.p.evaluate(() => !!window.__lc.voice.screen);
  for (const n in P) {
    const a = R.amostras.rx[n].filter(x => !x.semSfu), o = S.recebe[n] = {};
    // áudio: soma de todas as vozes recebidas
    const aud = (x) => Object.values(x.audio || {}).reduce((s, y) => ({ rec: s.rec + y.rec, lost: s.lost + y.lost, conc: s.conc + y.conc, samples: s.samples + y.samples }), { rec: 0, lost: 0, conc: 0, samples: 0 });
    const A0 = aud(a[0]), A1 = aud(a.at(-1)), jit = a.flatMap(x => Object.values(x.audio || {}).map(y => y.jitter * 1000));
    o.audio = { perdidos_pct: +(((A1.lost - A0.lost) / Math.max(1, (A1.rec - A0.rec) + (A1.lost - A0.lost))) * 100).toFixed(2), tapado_pct: +(((A1.conc - A0.conc) / Math.max(1, A1.samples - A0.samples)) * 100).toFixed(2), jitter_ms: { media: media(jit), p99: pct(jit, 0.99), max: Math.max(0, ...jit) } };
    const vs = a.filter(x => x.video);
    if (vs.length > 2) {
      const fps = [], res = [], jv = []; let semImagem = 0;
      for (let i = 1; i < vs.length; i++) { const d = (vs[i].video.dec - vs[i - 1].video.dec) / Math.max(0.5, vs[i].t - vs[i - 1].t); fps.push(+d.toFixed(1)); if (d < 1) semImagem += vs[i].t - vs[i - 1].t; res.push(vs[i].video.h); jv.push(vs[i].video.jitter * 1000); }
      const v0 = vs[0].video, v1 = vs.at(-1).video;
      o.video = { fps: { media: media(fps), p01: pct(fps, 0.01), min: Math.min(...fps) }, altura: { media: media(res), min: Math.min(...res), max: Math.max(...res) },
        perdidos_pct: +(((v1.lost - v0.lost) / Math.max(1, (v1.rec - v0.rec) + (v1.lost - v0.lost))) * 100).toFixed(2), descartados: v1.drop - v0.drop,
        congelamentos: v1.freezes - v0.freezes, congelado_s: +(v1.freezeS - v0.freezeS).toFixed(1), sem_imagem_s: +semImagem.toFixed(1), jitter_ms: { media: media(jv), p99: pct(jv, 0.99) }, Mbps: +(((v1.bytes - v0.bytes) * 8 / 1e6) / Math.max(1, vs.at(-1).t - vs[0].t)).toFixed(2) };
    }
  }
  console.log('\nResumo:'); console.log(JSON.stringify(S, null, 1));
} catch (e) { R.erros.push('geral: ' + (e.stack || e.message)); console.log('ERRO', e); }
finally {
  fim = true; R.fim = new Date().toISOString(); R.relePerdeu = dropped; R.servidor = srvLog.split('\n').filter(l => /\[voz\]|erro|error/i.test(l)).slice(-30);
  fs.writeFileSync(`.testshots/roteiro-${LABEL}.json`, JSON.stringify(R, null, 1));
  console.log(`\n.testshots/roteiro-${LABEL}.json  (erros: ${R.erros.length})`); for (const e of R.erros.slice(0, 10)) console.log('  -', e);
  for (const n in P) await P[n].br.close().catch(() => { });
  try { srv.kill('SIGKILL'); } catch { } closed = true; front.close(); for (const b of back.values()) b.close();
  setTimeout(() => process.exit(R.erros.length ? 1 : 0), 300);
}
