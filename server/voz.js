// Processo da voz: o SFU (mediasoup) vive aqui, e o resto do servidor (HTTP, gateway, banco: server/index.js) roda como
// processo filho. Como os servidores de voz do Discord: atualizar ou reiniciar o servidor NÃO derruba as chamadas.
// A voz, a câmera e a transmissão vão do app direto para as portas do SFU (UDP/TCP 40000, nativa 40001-40010), que
// continuam abertas enquanto o filho reinicia. Quando o filho volta, ele pega daqui quem estava em cada sala (state) e
// cada app retoma a própria sessão (VOICE_RESUME): para ninguém a pessoa saiu da sala.
//
// Uso: node server/voz.js (é o que o Docker e o deploy/resenha.service rodam). `node server/index.js` sozinho continua
// funcionando com o SFU no mesmo processo (desenvolvimento e testes).
// Sinais: SIGUSR2 = reiniciar só o app (deploy/servidor.sh, código novo do servidor já no disco); SIGHUP = repassa ao
// app (interface nova sem reiniciar); SIGTERM/SIGINT = encerra tudo. O app que cair sozinho volta em 1 s, 2 s, 5 s…
//
// Conversa com o filho (IPC, server/sfuproxy.js): pedidos { id, call, args } -> { re: id, data | error }; avisos daqui
// para lá: notify (eventos do SFU para uma pessoa), info (estado para as consultas síncronas), sfu_event, native_closed.
import { fork } from 'node:child_process';
import './parentwatch.js'; // testes: encerra junto com quem abriu (EXIT_WITH_PARENT)
import { fileURLToPath } from 'node:url';
import { startSfu, sfuEnabled, sfuJoin, sfuLeave, sfuModerate, sfuDropVideo, sfuRequest, sfuAttachRtp, sfuAttachNative, sfuLoad, sfuWorkers, sfuEvents, onSfuEvent, sfuRooms, sfuLastVoices } from './sfu.js';

const APP = fileURLToPath(new URL('./index.js', import.meta.url));
const log = (...a) => console.log('  [voz]', ...a);
let child = null, stopping = false, restartAsked = false, crashes = 0, startedAt = 0;
let snap = null, snapAt = 0; // o último retrato que o app mandou (estado de cada pessoa nas salas: mudo, tela, cargo…)
const handles = new Map(); let hid = 0; // RTP do bot de música e transmissões nativas: h -> { kind, cid, uid, close, producer, out }

const toChild = (m) => { try { if (child?.connected) child.send(m); } catch { } };
const info = () => ({ enabled: sfuEnabled(), workers: sfuWorkers(), events: sfuEvents(), lastVoice: sfuLastVoices() });
const notifyFor = (cid, uid) => (t, d) => toChild({ ev: 'notify', cid, uid, t, d });
onSfuEvent((kind, text) => { toChild({ ev: 'sfu_event', kind, text }); toChild({ ev: 'info', info: info() }); });
setInterval(() => toChild({ ev: 'info', info: info() }), 2000).unref();

function track(kind, cid, uid, res, out) {
  const h = ++hid, e = { kind, cid, uid, close: res.close, producer: res.producer, out: { h, ...out } };
  handles.set(h, e);
  const gone = () => { if (!handles.delete(h)) return; if (kind === 'native') toChild({ ev: 'native_closed', h }); };
  res.producer?.observer.on('close', gone); res.transport?.observer.on('close', gone);
  return e.out;
}

const calls = {
  hello: async () => ({ info: info() }),
  join: (cid, uid) => sfuJoin(cid, uid, notifyFor(cid, uid)),
  leave: (cid, uid) => { sfuLeave(cid, uid); return {}; },
  moderate: (cid, uid, o) => { sfuModerate(cid, uid, o); return {}; },
  dropVideo: (cid, uid) => { sfuDropVideo(cid, uid); return {}; },
  request: (cid, uid, op, d) => sfuRequest(cid, uid, op, d),
  load: () => sfuLoad(),
  attachRtp: async (cid, uid) => {
    // a transmissão do bot usa o transporte que o próprio attach abre; guardo o transporte para saber quando fecha
    const r = await sfuAttachRtp(cid, uid);
    return track('rtp', cid, uid, r, { port: r.port, ssrc: r.ssrc, payloadType: r.payloadType });
  },
  attachNative: async (cid, uid, layers) => {
    const r = await sfuAttachNative(cid, uid, layers);
    return track('native', cid, uid, r, { producer_id: r.producer.id, port: r.port, ip: r.ip, ssrc: r.ssrc, ssrcs: r.ssrcs, payloadType: r.payloadType, key: r.key, serverKey: r.serverKey });
  },
  detach: (h) => { const e = handles.get(h); if (e) { handles.delete(h); e.close(); } return {}; },
  pstats: async (h) => { const p = handles.get(h)?.producer; return p && !p.closed ? p.getStats() : []; },
  snapshot: (data) => { snap = data; snapAt = Date.now(); return {}; },
  // o app (re)começou: quem está em cada sala aqui, o último retrato que ele mandou e as transmissões nativas vivas
  state: () => ({ rooms: sfuRooms(), snap, natives: [...handles.values()].filter(e => e.kind === 'native' && !e.producer?.closed).map(e => ({ cid: e.cid, uid: e.uid, ...e.out })) }),
};

function onMessage(c, m) {
  if (c !== child || !m || typeof m !== 'object' || !m.id) return; // resposta atrasada de um app que já saiu: ignora
  const fn = calls[m.call];
  Promise.resolve().then(() => { if (!fn) throw new Error('chamada desconhecida: ' + m.call); return fn(...(m.args || [])); })
    .then((data) => { if (c === child && c.connected) c.send({ re: m.id, data: data ?? null }); },
      (e) => { if (c === child && c.connected) c.send({ re: m.id, error: e?.message || String(e) }); });
}

const WAIT = [1000, 2000, 5000, 10000, 30000];
function startApp() {
  startedAt = Date.now();
  const c = child = fork(APP, process.argv.slice(2), { env: { ...process.env, LC_VOZ_IPC: '1' }, stdio: 'inherit' });
  c.on('message', (m) => onMessage(c, m));
  c.on('exit', (code, sig) => {
    if (c !== child) return;
    child = null;
    if (stopping) return finish();
    if (restartAsked) { restartAsked = false; crashes = 0; log('app reiniciado (as chamadas continuam)'); return startApp(); }
    if (Date.now() - startedAt > 60e3) crashes = 0;
    const wait = WAIT[Math.min(crashes++, WAIT.length - 1)];
    log(`o app saiu (${sig || 'código ' + code}); volta em ${wait / 1000} s. As chamadas continuam.`);
    setTimeout(() => { if (!stopping && !child) startApp(); }, wait);
  });
}
function restartApp() {
  if (!child) return startApp();
  restartAsked = true;
  const c = child; c.kill('SIGTERM');
  setTimeout(() => { if (child === c) c.kill('SIGKILL'); }, 10e3).unref();
}

// Sem retrato novo do app por muito tempo, a sala aqui pode ter gente que o app não conhece mais (caiu entre um retrato e
// outro). Quem está aqui e não aparece no retrato há mais de 3 min sai (o app também tira quem não voltar; isto é a rede).
const missing = new Map();
setInterval(() => {
  if (!child || !snap || Date.now() - snapAt > 30e3) return;
  const known = new Set(); for (const [cid, r] of Object.entries(snap.rooms || {})) for (const uid of Object.keys(r.peers || {})) known.add(cid + '|' + uid);
  const now = Date.now(), seen = new Set();
  for (const { cid, peers } of sfuRooms()) for (const uid of peers) {
    const k = cid + '|' + uid; seen.add(k);
    if (known.has(k)) { missing.delete(k); continue; }
    if (!missing.has(k)) missing.set(k, now);
    else if (now - missing.get(k) > 3 * 60e3) { missing.delete(k); log('tirando da sala quem o app não conhece mais', cid, uid); sfuLeave(cid, uid); }
  }
  for (const k of missing.keys()) if (!seen.has(k)) missing.delete(k);
}, 30e3).unref();

function finish() { log('encerrado'); process.exit(0); }
function stop(sig) {
  if (stopping) return; stopping = true;
  log(`${sig} recebido: encerrando o app e a voz`);
  if (!child) return finish();
  child.kill('SIGTERM');
  setTimeout(finish, 6000).unref(); // o app tem até 6 s para avisar os apps e salvar
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGUSR2', () => { log('SIGUSR2: reiniciando só o app'); restartApp(); });
process.on('SIGHUP', () => { if (child) child.kill('SIGHUP'); });

const ok = await startSfu();
if (!ok) log('SFU indisponível: o app usa a voz em malha P2P (reiniciar o app derruba essas chamadas)');
startApp();
