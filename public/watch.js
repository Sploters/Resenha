// Watch Together: interface + motor de sincronização do cliente. Servidor: server/watch.js; decisões técnicas em
// docs/WATCH-TOGETHER.md.
// - Camada própria (#wt, fixa no <body>): o player nunca muda de lugar no DOM (mover um iframe recarrega o vídeo).
//   Aberta, cobre o palco da chamada (a barra da chamada continua visível); minimizada ou fora da tela da chamada,
//   vira um mini player no canto. A voz continua a mesma: é tudo na mesma página.
// - Comandos só nascem de cliques/atalhos na interface do Resenha; eventos do player viram só relatórios (anti-eco).
// - A cada 400 ms o motor compara a posição do player com a esperada (estado do servidor + relógio comum) e corrige.
import { h, icon, avatar } from './util.js';
import { S, toast, user, nameOf, menu, confirmBox, closeFloating } from './state.js';
import { SERVICES, SERVICE_IDS, LEVELS, ERRORS, effectiveLevel, parseLink } from './watchsvc.js';
import { expectedPos, createClock, decide, syncState, fmtTime, waitingStart, parseTime } from './watchsync.js';
import { makePlayer, QUALITY_LABEL } from './watchplayers.js';
import { vrrSource, vrrPoke } from './vrrfix.js';

let ctx = { send: () => { }, voice: () => null, channelById: () => null, inviteCandidates: () => [], invite: async () => false, streams: () => [], watchStream: () => { } };
export const initWatch = (c) => { ctx = { ...ctx, ...c }; };
// app desktop: o YouTube toca num iframe (não é um <video> desta página), então avisa o anti-piscada (public/vrrfix.js)
// que tem vídeo tocando — sem isso, com G-Sync/FreeSync em janela, o monitor ficava trocando de frequência e piscando
vrrSource(() => !!W.joined && !!W.player && W.player.state() === 'playing' && !ui?.root.classList.contains('hidden'));

const store = { get: (k, d) => { try { const v = localStorage.getItem('wt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('wt.' + k, JSON.stringify(v)); } catch { } } };
const W = {
  sess: null, cid: null, joined: false, open: false, mini: false, lastSeq: -1, clock: createClock(), clockTimer: null,
  player: null, itemId: null, ready: false, error: null, strikes: 0, lastFix: 0, seekLat: 0.25, drift: 0, fixes: 0, residualCheck: 0, rate: 1, nudges: 0, dHist: [], settleUntil: 0, startSeq: -1, startT: 0,
  reports: {}, tab: 'queue', results: null, suggest: null, searching: false, svc: 'youtube', pendingJoin: null,
  autoplayBlocked: false, bufSince: 0, lastReport: 0, lastRepKey: '', ready_ext: false, myPos: null,
  vol: store.get('vol', 80), muted: store.get('muted', false), cc: false, // legendas sempre começam desligadas (ligar vale só até sair)
  qDown: 0, stalls: [], qChangedAt: 0, qOkSince: 0, qProbe: 45_000, qGrace: 0, env: { desktopWindow: false, widevine: false },
};
export const watchState = () => ({ sess: W.sess, joined: W.joined, open: W.open, mini: W.mini, itemId: W.itemId, error: W.error, drift: W.drift, fixes: W.fixes, rate: W.rate, nudges: W.nudges, syncErr: W.player && W.sess?.current ? W.player.time() - expectedPos(W.sess.pb, W.clock.now(), W.sess.current.duration || W.player.duration() || 0) : null, playerTime: W.player?.time?.() ?? null, playerState: W.player?.state?.() ?? null, clockOffset: W.clock.offset, vol: W.vol, muted: W.muted, lastSeq: W.lastSeq, autoplayBlocked: W.autoplayBlocked, reports: W.reports });
// ---------- app desktop: janela do serviço com a conta de cada um (desktop/watchwin.js) ----------
const desk = typeof window !== 'undefined' && window.lcDesktop?.watchOpen ? window.lcDesktop : null;
W.env.desktopWindow = !!desk;
const bridges = new Map(); // serviço -> estado da ponte
function bridgeFor(service) {
  let b = bridges.get(service); if (b) return b;
  b = { service, ok: false, widevine: null, last: null, lastAt: 0, open: false, login: false, err: null,
    navigate: (url) => b.open && desk.watchCmd(service, { t: 'navigate', url }),
    cmd: (c) => { if (b.open) desk.watchCmd(service, c); },
    pos: () => { const l = b.last; if (!l) return 0; return l.pos + (!l.paused && !l.buffering ? (performance.now() - b.lastAt) / 1000 : 0); } };
  bridges.set(service, b); return b;
}
desk?.onWatchEvent?.((m) => {
  if (!m?.service) return; const b = bridgeFor(m.service);
  if (m.t === 'drm') { b.widevine = !!m.widevine; W.env.widevine = !!m.widevine; }
  else if (m.t === 'state') { b.last = m; b.lastAt = performance.now(); b.open = true; b.login = false; b.ok = !!b.widevine && !!m.video; }
  else if (m.t === 'login') { b.open = true; b.login = true; b.ok = false; }
  else if (m.t === 'error') { b.err = m.code; if (m.code === 'drm') b.ok = false; }
  else if (m.t === 'closed') { b.open = false; b.ok = false; b.last = null; }
  else if (m.t === 'seek_unsupported') toast('A Netflix não aceitou mudar a posição pela sala: ajuste a posição na janela dela.', true);
  if (W.sess?.current?.service === m.service) { paintOverlay(); paintSyncBadge(); }
});
async function openServiceWindow(it) {
  const r = await desk.watchOpen({ service: it.service, url: it.url }).catch(() => null);
  if (!r?.ok) return toast('Não foi possível abrir a janela do serviço' + (r?.error ? ': ' + r.error : ''), true);
  bridgeFor(it.service).open = true;
}
const me = () => S.me?.id;
const canCtl = (s = W.sess) => !!s && (s.mode === 'sharing' || s.host === me() || s.controllers.includes(me()));
const isHost = () => W.sess?.host === me();
const gid = () => ctx.channelById(W.cid)?.guild_id;
const nm = (uid) => (gid() ? nameOf(uid, gid()) : user(uid).display_name);
const levelOf = (it) => (it ? effectiveLevel(it.service, W.env) : null);
const external = (it = W.sess?.current) => !!it && SERVICES[it.service]?.level === 'assisted';

// ---------- rede ----------
let rid = 0; const waiting = new Map();
export const watchCmd = (op, extra = {}) => new Promise((resolve, reject) => {
  const id = ++rid; waiting.set(id, { resolve, reject });
  ctx.send('WATCH', { rid: id, op, ...extra });
  setTimeout(() => { if (waiting.delete(id)) reject(new Error('Sem resposta do servidor')); }, op === 'search' || op === 'add' ? 60_000 : 15_000);
});
const act = (op, extra) => watchCmd(op, extra).catch(e => { toast(e.message, true); return null; });
const fire = (op, extra) => ctx.send('WATCH', { op, ...extra }); // sem resposta (relatórios)

async function syncClock(n = 5) {
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try { const r = await watchCmd('clock', { t0 }); W.clock.add(t0, r.t, Date.now()); } catch { }
    await new Promise(r => setTimeout(r, 120));
  }
}

// ---------- eventos do servidor ----------
export function onWatchEvent(t, d) {
  if (t === 'WATCH_RES') { const w = waiting.get(d.rid); if (!w) return; waiting.delete(d.rid); if (d.error) { const e = new Error(d.error); e.code = d.code; w.reject(e); } else w.resolve(d.data); return; }
  const voice = ctx.voice(); if (!voice?.channelId || d.cid !== voice.channelId) return;
  if (t === 'WATCH_END') {
    const was = W.joined;
    teardown();
    if (was) toast(d.reason === 'host_ended' ? 'O anfitrião encerrou o Watch Together' : d.reason === 'empty' ? 'O Watch Together terminou (todos saíram)' : 'O Watch Together terminou');
    ctx.rerender?.(); return;
  }
  if (t === 'WATCH_STATE') return onState(d);
  if (t === 'WATCH_SYNC') {
    if (!W.sess || d.id !== W.sess.id || d.pb.seq <= W.lastSeq) return; // atrasado: já aplicamos um mais novo
    W.sess.pb = d.pb; W.lastSeq = d.pb.seq; W.strikes = 0; W.dHist = []; W.qGrace = performance.now() + 3000; // play/pulo da sala carrega: não é travada da conexão
    applyNow(); paint(); return;
  }
  if (t === 'WATCH_ASK') { if (W.sess && d.id === W.sess.id && isHost() && W.sess.mode === 'hosting' && !W.sess.controllers.includes(d.uid)) { W.asks = [...(W.asks || []).filter(u => u !== d.uid), d.uid]; paintAsk(); if (W.mini || !W.open) toast(`${nm(d.uid)} pediu para controlar o vídeo`); } return; }
  if (t === 'WATCH_MEMBERS') { if (W.sess && d.id === W.sess.id) { W.reports = d.reports; paintPeople(); paintSyncBadge(); } }
}
function onState(d) {
  const prevHost = W.sess?.host, prevId = W.sess?.id;
  if (prevId && prevId !== d.id) teardown(true); // sessão nova na mesma sala
  const prevPb = prevId === d.id ? W.sess?.pb : null;
  if (prevPb && d.pb.seq < prevPb.seq) d.pb = prevPb; // um WATCH_SYNC mais novo já tinha chegado
  W.sess = d; W.cid = d.cid; W.lastSeq = Math.max(W.lastSeq, d.pb.seq);
  const mine = d.members.find(m => m.id === me());
  const was = W.joined;
  W.joined = !!mine?.online;
  if (W.joined && !was) { W.open = true; if (!W.clock.synced) syncClock(); startLoops(); }
  if (!W.joined && was) { destroyPlayer(); W.open = false; }
  // convite aceito / reconexão: entra sozinho
  if (!W.joined && W.pendingJoin === d.cid) { W.pendingJoin = null; act('join'); }
  if (d.notice) toast(d.notice);
  if (d.host_changed?.to === me() && prevHost && prevHost !== me()) toast('Você agora é o anfitrião do Watch Together');
  if (W.asks?.length) W.asks = W.asks.filter(u => isHost() && d.mode === 'hosting' && !d.controllers.includes(u) && d.members.some(m => m.id === u && m.online));
  if (W.joined) { build(); loadCurrent(); }
  paint(); ctx.rerender?.();
}

// ---------- player ----------
function destroyPlayer() { try { W.player?.destroy(); } catch { } W.player = null; W.itemId = null; W.ready = false; W.error = null; }
function loadCurrent() {
  const it = W.sess?.current, host = ui?.playerHost; if (!host) return;
  // nada tocando (fila acabou ou o vídeo atual foi removido): o player sai da tela. Antes ele só pausava e continuava
  // visível atrás do "A fila acabou", e clicar no vídeo dava play só para você
  if (!it) { destroyPlayer(); vrrPoke(); return; }
  if (it.id === W.itemId) return;
  const now = W.clock.now(), dur = it.duration || 0, pb = W.sess.pb;
  const pos = expectedPos(pb, now, dur), play = pb.status === 'playing' && !waitingStart(pb, now);
  const sameKind = W.player && W.player.item?.service === it.service && it.service === 'youtube';
  if (!sameKind) destroyPlayer();
  W.itemId = it.id; W.error = it.error || null; W.ready = false; W.stuckSince = 0; W.mutedTry = false; W.playIssued = false; W.autoplayBlocked = false; W.strikes = 0; W.lastFix = 0; W.ready_ext = false; W.myPos = null; W.rate = 1; W.dHist = []; W.settleUntil = 0; W.startSeq = -1; clearTimeout(W.startT);
  if (!W.player) {
    W.player = makePlayer(it, host, {
      onReady: () => { W.ready = true; applyNow(); paint(); },
      onState: () => { const st = W.player?.state(); if (st === 'playing' && W.autoplayBlocked && navigator.userActivation?.hasBeenActive) tryUnmute(); if (st === 'playing') W.player?.applyCaptions?.(W.cc); if (st === 'buffering') noteStall(); vrrPoke(); report(); paintControls(); },
      onError: (code) => { if (code === 'embed_blocked' && W.sess?.current?.embed_ok) code = 'yt_refused'; if (code === 'autoplay') { W.autoplayBlocked = true; W.player?.setMuted?.(true); W.player?.play?.(); } else W.error = code; report(true); paintOverlay(); },
      onEnded: () => { const c = W.sess?.current; if (c) fire('ended', { item_id: c.id }); },
      onDuration: (s) => { const c = W.sess?.current; if (c && !(c.duration > 0) && s > 0) { c.duration = s; fire('meta', { item_id: c.id, duration: s }); paintControls(); } },
    }, W.env);
    W.player.setVolume(W.vol); W.player.setMuted(W.muted); W.player.ccPref = W.cc; W.player.qDown = W.qDown;
    if (external(it) && desk) W.player.attachBridge?.(bridgeFor(it.service)); // app desktop: janela do serviço (desktop/watchwin.js)
  }
  W.qGrace = performance.now() + 4000; W.stalls = []; // começo do vídeo carrega: não conta como travada
  W.player.load(it, { pos, play });
  paintOverlay();
}
// aplica o estado autoritativo ao player agora (comando recebido) — o laço de 400 ms cuida da deriva fina
function applyNow() { if (W.ready) tick(true); }
function tick(force) {
  const s = W.sess, p = W.player; if (!s?.current || !p || !W.ready || W.error) return;
  const now = W.clock.now(), dur = s.current.duration || p.duration() || 0, pb = s.pb;
  const exp = expectedPos(pb, now, dur), st = p.state();
  if (pb.status === 'playing') {
    if (waitingStart(pb, now)) { // começo marcado: espera parado no ponto exato de partida
      if (st === 'playing') p.pause();
      if (Math.abs(p.time() - pb.pos) > .05) p.seek(pb.pos);
      scheduleStart(pb);
      paintOverlay(); return;
    }
    if ((st === 'paused' || st === 'idle' || (st === 'ended' && exp < dur - 1)) && !W.autoplayBlocked) p.play();
    // player travado em "não iniciado" com a sala tocando (som automático bloqueado sem aviso, ou o site recusou):
    // 1º tenta sem som (o navegador sempre deixa) e avisa; se continuar parado, explica em vez de ficar preto
    // o YouTube carregado sem tocar fica em "não iniciado" (estado 'loading' aqui): é preciso mandar o play. Antes isso
    // não acontecia, e depois de 5 s a proteção abaixo tocava sem som (o ícone continuava com o volume ligado)
    if (st === 'loading' && !W.playIssued && !W.autoplayBlocked) { W.playIssued = true; W.stuckSince = performance.now(); p.play(); }
    if (st === 'loading') {
      W.stuckSince = W.stuckSince || performance.now();
      const stuck = performance.now() - W.stuckSince;
      if (stuck > 8000 && !W.mutedTry) { W.mutedTry = true; W.autoplayBlocked = true; p.setMuted(true); p.play(); paintOverlay(); }
      else if (stuck > 15000 && !W.error) { W.error = 'stuck'; report(true); paintOverlay(); return; }
    } else W.stuckSince = 0;
  } else if (st === 'playing' || (st === 'buffering' && pb.status !== 'playing')) p.pause();
  if (pb.status === 'idle' || pb.status === 'ended') return;
  if (external(s.current) && !p.controllable) { // assistido: o relógio virtual segue a sala exatamente
    if (Math.abs(p.time() - exp) > .25) p.seek(exp);
    return paintOverlay();
  }
  if (p.buffering()) { if (!W.bufSince) W.bufSince = performance.now(); } else W.bufSince = 0;
  const t = performance.now(), playing = pb.status === 'playing';
  if (t < W.settleUntil && !force) return; // logo depois de um pulo a posição informada pelo player ainda é velha
  // depois de um pulo, mede o que sobrou e ajusta a mira (latência de busca deste player/conexão)
  if (W.residualCheck && t > W.residualCheck && !p.buffering() && playing) { W.residualCheck = 0; const res = p.time() - exp; if (Math.abs(res) < 1.5) W.seekLat = Math.max(0, Math.min(1.5, W.seekLat - res * .6)); }
  // diferença medida = mediana das últimas leituras (uma leitura isolada do player pode vir atrasada)
  const raw = p.time() - exp;
  W.dHist.push(raw); if (W.dHist.length > 5) W.dHist.shift();
  const med = force ? raw : [...W.dHist].sort((a, b) => a - b)[W.dHist.length >> 1];
  const r = decide({ expected: exp, actual: exp + med, playing, buffering: p.buffering(), strikes: force ? 1 : W.strikes, lastFix: force ? 0 : W.lastFix, now: t,
    seekLatency: W.seekLat, canRate: p.canRate && playing, rate: W.rate, seekTol: p.seekTol });
  W.strikes = r.strikes; W.drift = med;
  if (r.action === 'seek') {
    if (W.rate !== 1) { W.rate = 1; p.setRate(1); }
    p.seek(r.target); W.lastFix = t; W.fixes++; W.dHist = []; W.settleUntil = t + 450; W.qGrace = t + 2500;
    if (playing) W.residualCheck = t + 1500;
  } else if (r.action === 'rate' || (r.action === 'wait' && W.rate !== 1)) {
    const nr = r.action === 'rate' ? r.rate : 1;
    if (nr !== W.rate) { W.rate = nr; p.setRate(nr); if (nr !== 1) W.nudges++; }
  }
  if (!playing && W.rate !== 1) { W.rate = 1; p.setRate(1); }
}
// começo/play marcado para o instante `at` do servidor: um timer no ponto exato (a conferência periódica a cada 200 ms
// chegava a começar até 400 ms atrasada, e cada um atrasava diferente)
function scheduleStart(pb) {
  if (W.startSeq === pb.seq) return;
  W.startSeq = pb.seq; clearTimeout(W.startT);
  W.startT = setTimeout(() => {
    const P = W.player, cur = W.sess?.pb;
    if (!P || !cur || cur.seq !== pb.seq || cur.status !== 'playing' || W.error) return;
    P.play(); W.dHist = []; W.settleUntil = performance.now() + 300;
  }, Math.max(0, pb.at - W.clock.now()));
}
// tocando sem som porque o navegador bloqueou: volta o som assim que der (a página já teve um clique, ou no próximo)
function tryUnmute() {
  if (!W.autoplayBlocked || W.muted || !W.player) return;
  W.autoplayBlocked = false; W.player.setMuted(false); W.player.setVolume(W.vol);
  setTimeout(() => { if (W.player && W.player.state() !== 'playing' && W.sess?.pb.status === 'playing') { W.autoplayBlocked = true; W.player.setMuted(true); W.player.play(); } paintOverlay(); }, 700);
  paintOverlay();
}
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => setTimeout(tryUnmute, 0), true);
// ---------- qualidade por pessoa ----------
// Cada um ajusta só a própria resolução: quem tem a conexão mais fraca desce de degrau em vez de ficar travando e
// atrasar (o que obrigaria pulos de correção). Começa em Full HD (ou a maior que o vídeo tiver abaixo disso).
//  - desce 1 degrau: carregando por mais de 1,2 s com a sala tocando, ou 2 travadas em 30 s
//  - sobe 1 degrau: 45 s seguidos sem travar; se travar logo depois de subir, desce e espera o dobro (até 4 min)
const STALL_LONG = 1200, STALL_WIN = 30_000, Q_STEP_GAP = 6000, Q_PROBE_MAX = 240_000;
function noteStall() {
  const t = performance.now();
  if (t < W.qGrace || W.sess?.pb.status !== 'playing' || waitingStart(W.sess.pb, W.clock.now())) return;
  W.stalls = W.stalls.filter(x => t - x < STALL_WIN); W.stalls.push(t);
}
function setQDown(n, why) {
  const p = W.player; if (!p) return;
  n = Math.max(0, Math.min(p.qualityFloor(), n)); if (n === W.qDown) return;
  const up = n < W.qDown, t = performance.now();
  if (!up && t - W.qChangedAt < STALL_WIN && W.qUpAt && t - W.qUpAt < 20_000) W.qProbe = Math.min(Q_PROBE_MAX, W.qProbe * 2); // subiu e travou: espera mais
  if (up) W.qUpAt = t;
  W.qDown = n; W.qChangedAt = t; W.qOkSince = t; W.stalls = []; W.qGrace = t + 3000;
  p.setQualityDown(n); report(true); paintControls();
  if (why) console.debug('[watch] qualidade', n ? `−${n}` : 'máxima', why);
}
function adaptQuality() {
  const s = W.sess, p = W.player; if (!s?.current || !p || !W.ready || W.error || s.current.service !== 'youtube') return;
  const t = performance.now();
  if (s.pb.status !== 'playing' || waitingStart(s.pb, W.clock.now())) { W.qOkSince = t; return; }
  if (p.state() === 'buffering') {
    W.qOkSince = t;
    if (t > W.qGrace && W.bufSince && t - W.bufSince > STALL_LONG && t - W.qChangedAt > Q_STEP_GAP) setQDown(W.qDown + 1, 'carregando há muito tempo');
    return;
  }
  W.stalls = W.stalls.filter(x => t - x < STALL_WIN);
  if (W.stalls.length >= 2 && t - W.qChangedAt > Q_STEP_GAP) return setQDown(W.qDown + 1, 'travadas seguidas');
  if (W.qDown > 0 && p.state() === 'playing' && t - W.qOkSince > W.qProbe && t - W.qChangedAt > W.qProbe) setQDown(W.qDown - 1, 'conexão estável');
  if (W.qDown === 0 && t - W.qChangedAt > Q_PROBE_MAX) W.qProbe = 45_000; // estável faz tempo: volta a ser rápido para subir
}
function report(now) {
  const s = W.sess, p = W.player; if (!W.joined || !s) return;
  const it = s.current, ext = external(it) && !p?.controllable;
  const r = { state: p?.state() || 'idle', pos: ext ? (W.myPos ?? p?.time() ?? 0) : (p?.time() || 0), buffering: !!p?.buffering() && !ext, error: W.error, item_id: it?.id || null, external: ext, ready: W.ready_ext, level: levelOf(it), q: p?.quality?.() || null, qd: W.qDown };
  const key = [r.state, r.buffering, r.error, r.item_id, r.ready, W.myPos, r.q, r.qd].join('|');
  const t = performance.now();
  if (!now && key === W.lastRepKey && t - W.lastReport < 2000) return;
  W.lastRepKey = key; W.lastReport = t;
  fire('report', r);
}
let loops = null;
function startLoops() {
  if (loops) return;
  // conferência a cada 200 ms; o relógio da sala é reamostrado a cada 10 s (fica a amostra de menor ida e volta)
  loops = [setInterval(() => { tick(); adaptQuality(); report(); paintTime(); }, 200), setInterval(() => W.player?.guardCaptions?.(), 1000), setInterval(() => { if (W.joined) syncClock(2); }, 10_000), setInterval(place, 250)];
}
function stopLoops() { (loops || []).forEach(clearInterval); loops = null; }
function teardown(keepUi) {
  destroyPlayer(); stopLoops();
  W.sess = null; W.joined = false; W.lastSeq = -1; W.qDown = 0; W.stalls = []; W.cc = false; W.reports = {}; W.results = null; W.suggest = null;
  if (!keepUi) { W.open = false; W.mini = false; }
  place();
}

// ---------- ações da interface ----------
export async function startWatch() {
  const v = ctx.voice(); if (!v?.channelId) return toast('Entre numa chamada para começar o Watch Together', true);
  const r = await act('start', { service: W.svc }); if (!r) return;
  W.mini = false; W.open = true; onState(r);
  if (!r.current) { W.tab = 'search'; paint(); setTimeout(() => ui?.search?.focus(), 50); }
}
export async function joinWatch() { const r = await act('join'); if (r) { W.mini = false; onState(r); } }
export const openWatch = () => { if (!W.joined) return joinWatch(); W.open = true; W.mini = false; place(); paint(); ctx.rerender?.(); };
export const minimizeWatch = () => { W.mini = true; place(); ctx.rerender?.(); };
// alguém pediu para assistir uma transmissão da sala (palco, lista, menu): o player vira mini e continua tocando, senão
// ele cobria o palco e a transmissão ficava escondida atrás dele
export const yieldStage = () => { if (W.joined && W.open && !W.mini) { W.mini = true; place(); } };
// transmissões de outras pessoas na sala: aparecem no topo do Watch Together (o palco fica coberto por ele)
function liveBtn() {
  const list = (ctx.streams() || []).filter(u => u !== me()); if (!list.length) return null;
  const go = (uid) => { minimizeWatch(); ctx.watchStream(uid); };
  const label = list.length === 1 ? `${nm(list[0])} ao vivo` : `${list.length} transmissões`;
  return h('button.wt-hbtn.wt-live', { title: list.length === 1 ? `Assistir a transmissão de ${nm(list[0])} (o vídeo continua no mini player)` : 'Assistir uma transmissão (o vídeo continua no mini player)',
    onclick: (e) => list.length === 1 ? go(list[0]) : menu(e, list.map(uid => ({ label: nm(uid), icon: 'screen', fn: () => go(uid) }))) },
  h('span.wt-livedot', 'AO VIVO'), h('span.wt-livel', label));
}
let liveKey = '';
export async function leaveWatch() { await act('leave'); teardown(); ctx.rerender?.(); }
export const pendingWatch = (cid) => { W.pendingJoin = cid; };
export const watchActive = () => !!W.sess;
export const watchJoined = () => W.joined;

function togglePlay() {
  const s = W.sess; if (!s?.current) return;
  if (!canCtl()) return lockedHint();
  if (s.pb.status === 'playing') { W.player?.pause(); act('pause', { pos: W.player?.time() }); }
  else act('play');
}
function seekTo(pos) {
  if (!canCtl()) return lockedHint();
  const d = W.sess?.current?.duration || W.player?.duration() || 0; pos = Math.max(0, d ? Math.min(d - .5, pos) : pos);
  W.player?.seek(pos); act('seek', { pos });
}
const lockedHint = () => toast(`Só ${nm(W.sess.host)} controla o vídeo agora. Use "Pedir controle" para pedir a vez.`);
async function askControl() { const r = await act('ask'); if (r && !r.already) toast(`Pedido enviado para ${nm(W.sess.host)}`); }
const setMode = (mode) => { if (W.sess && W.sess.mode !== mode) act('mode', { mode }); };
const grant = (uid, on) => { W.asks = (W.asks || []).filter(u => u !== uid); act('grant', { uid, on }); paintAsk(); };
function setVol(v, muted = W.muted) {
  W.vol = v; W.muted = muted; store.set('vol', v); store.set('muted', muted); W.player?.setVolume(v); W.player?.setMuted(muted);
  if (!muted) W.autoplayBlocked = false;
  // só o ícone e a posição do controle: sem redesenhar a barra (o controle sendo arrastado continua o mesmo)
  const ic = ui?.controls.querySelector('.wt-volbox > .wt-cb'), r = ui?.controls.querySelector('.wt-vol');
  if (ic) { ic.replaceChildren(icon(muted || !v ? 'volmute' : v < 50 ? 'vollow' : 'vol', 18)); ic.title = muted ? 'Ativar som (m)' : 'Silenciar (m)'; }
  if (r && !holding) { r.value = muted ? 0 : v; r.style.setProperty('--p', (muted ? 0 : v) + '%'); }
  if (ui?.overlay.querySelector('.wt-unmute') && !W.autoplayBlocked) paintOverlay();
}
const setCc = (on) => {
  W.cc = on; W.player?.applyCaptions?.(on, true); paintControls();
  if (on) setTimeout(() => { if (W.cc && W.player?.captionTracks?.() === 0) toast('Este vídeo não tem legendas'); }, 2500);
};
function resync() { W.lastFix = 0; W.strikes = 1; syncClock(3).then(() => tick(true)); if (W.error && !ERRORS[W.error]?.fatal) { const it = W.sess?.current; W.error = null; W.itemId = null; destroyPlayer(); if (it) loadCurrent(); } toast('Ressincronizando com a sala'); }
async function addLink(raw, extra = {}) {
  let url = String(raw || '').trim(); if (!url) return null;
  if (url.startsWith(location.origin + '/files/')) url = url.slice(location.origin.length);
  const r = await watchCmd('add', { url, service: W.svc, ...extra }).catch(async (e) => {
    if (e.code === 'duplicate' && await confirmBox('Já está na fila', 'Esse vídeo já está na fila. Adicionar de novo mesmo assim?', 'Adicionar')) return watchCmd('add', { url, service: W.svc, ...extra, force: true }).catch(e2 => { toast(e2.message, true); return null; });
    if (e.code !== 'duplicate') toast(e.message, true); return null;
  });
  if (r) toast(`Na fila: ${r.item.title}`);
  return r;
}
async function addItem(item, extra = {}) {
  const r = await watchCmd('add', { item, ...extra }).catch(async (e) => {
    if (e.code === 'duplicate' && await confirmBox('Já está na fila', `"${item.title}" já está na fila. Adicionar de novo?`, 'Adicionar')) return watchCmd('add', { item, ...extra, force: true }).catch(e2 => { toast(e2.message, true); return null; });
    if (e.code !== 'duplicate') toast(e.message, true); return null;
  });
  if (r) toast(`Na fila: ${r.item.title}`);
  return r;
}
async function doSearch(q) {
  q = q.trim(); if (!q) return;
  const link = parseLink(q.startsWith(location.origin + '/files/') ? q.slice(location.origin.length) : q);
  if (link) { const r = await addLink(q); if (r && ui) ui.search.value = ''; return; }
  if (!SERVICES[W.svc].search) return toast(`${SERVICES[W.svc].name}: cole um link. ${SERVICES[W.svc].hint}.`, true);
  W.searching = true; W.results = null; paintSide();
  const r = await watchCmd('search', { q }).catch(e => { toast(e.message, true); return null; });
  W.searching = false; W.results = r?.results || []; paintSide();
}

// ---------- interface ----------
let ui = null;
function build() {
  if (ui) return ui;
  const playerHost = h('div.wt-player');
  const catcher = h('div.wt-catch', { onclick: () => togglePlay(), ondblclick: () => fullscreen() });
  const overlay = h('div.wt-ov');
  const stagebox = h('div.wt-stagebox', playerHost, catcher, overlay);
  const head = h('div.wt-head'), controls = h('div.wt-ctl'), side = h('aside.wt-side'), people = h('div.wt-people');
  const search = h('input.wt-search', { type: 'search', maxLength: 500, autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(search.value); } } });
  const main = h('div.wt-main', { onpointermove: () => fsWake(), onpointerdown: () => fsWake() }, stagebox, controls);
  const askbar = h('div.wt-askbar');
  const root = h('div#wt.wt.hidden', { tabindex: '-1', role: 'region', 'aria-label': 'Watch Together', onkeydown: keys }, head, askbar, h('div.wt-body', main, side));
  document.body.append(root);
  // mini player arrastável pelo cabeçalho (não cobre o que você quer ver); a posição fica guardada neste aparelho
  head.addEventListener('pointerdown', (e) => {
    if (!root.classList.contains('mini') || e.target.closest('button')) return;
    const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId); root.classList.add('dragging');
    const move = (ev) => { const x = Math.max(4, Math.min(innerWidth - r.width - 4, ev.clientX - dx)), y = Math.max(4, Math.min(innerHeight - r.height - 4, ev.clientY - dy)); W.miniPos = { right: innerWidth - x - r.width, bottom: innerHeight - y - r.height }; applyMiniPos(); };
    const up = () => { head.removeEventListener('pointermove', move); root.classList.remove('dragging'); store.set('miniPos', W.miniPos); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up, { once: true });
  });
  ui = { root, head, askbar, playerHost, catcher, overlay, stagebox, controls, side, people, search, main };
  return ui;
}
function keys(e) {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo((W.player?.time() || 0) - 5); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo((W.player?.time() || 0) + 5); }
  else if (e.key === 'm') setVol(W.vol, !W.muted);
  else if (e.key === 'c') setCc(!W.cc);
  else if (e.key === 'f') fullscreen();
  else if (e.key === 'Escape' && !document.fullscreenElement) minimizeWatch();
}
function fullscreen() { if (!ui) return; if (document.fullscreenElement) document.exitFullscreen?.(); else ui.main.requestFullscreen?.().catch(() => { }); }
// tela cheia: o vídeo ocupa o monitor inteiro e os controles ficam por cima, sumindo com o mouse parado (antes a
// barra ficava embaixo do vídeo e "roubava" um pedaço da tela, como acontecia com os clipes)
let fsIdleT = 0;
function fsWake() {
  if (!ui || document.fullscreenElement !== ui.main) return;
  ui.main.classList.remove('fsidle'); clearTimeout(fsIdleT);
  fsIdleT = setTimeout(() => { if (!holding && !ui.controls.matches(':hover')) ui.main.classList.add('fsidle'); else fsWake(); }, 2500);
}
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', () => { if (!ui) return; if (document.fullscreenElement === ui.main) fsWake(); else { clearTimeout(fsIdleT); ui.main.classList.remove('fsidle'); } });

// posição da camada: cobre o palco da chamada (menos a barra) ou vira mini player
let lastRect = '';
function place() {
  if (!W.open || !W.joined) { if (ui) { ui.root.classList.add('hidden'); } document.querySelector('#stage.wt-cover')?.classList.remove('wt-cover'); lastRect = ''; return; }
  build();
  const stage = document.getElementById('stage'), voice = ctx.voice();
  const onCall = stage && voice?.channelId === W.cid && stage.getClientRects().length && stage.offsetWidth > 300;
  const mini = W.mini || !onCall;
  if (ui.root.classList.contains('hidden') || ui.root.classList.contains('mini') !== mini) ccRecheck(); // mudou de tamanho: o YouTube costuma religar a legenda
  ui.root.classList.remove('hidden'); ui.root.classList.toggle('mini', mini);
  stage?.classList.toggle('wt-cover', !mini && !!onCall);
  if (mini) { if (lastRect !== 'mini') { lastRect = 'mini'; Object.assign(ui.root.style, { left: '', top: '', width: '', height: '' }); applyMiniPos(); } return; }
  ui.root.style.right = ui.root.style.bottom = '';
  // topo da barra pela posição no layout (offsetTop), não pelo retângulo na tela: o retângulo inclui o deslocamento da
  // animação de esconder a barra, e o player crescia por cima dela enquanto ela estava escondida
  const r = stage.getBoundingClientRect(), bar = stage.querySelector(':scope > .bar');
  const hgt = Math.max(240, (bar && bar.offsetHeight ? bar.offsetTop : r.height) - 4);
  const key = [r.left, r.top, r.width, hgt].map(Math.round).join(',');
  if (key === lastRect) return; lastRect = key;
  Object.assign(ui.root.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: hgt + 'px' });
  ui.root.classList.toggle('narrow', r.width < 1000); ui.root.classList.toggle('stack', r.width < 760); // layout pela largura real (o chat da sala pode estar aberto ao lado)
}
function applyMiniPos() {
  let p = W.miniPos || store.get('miniPos', null); if (!ui) return;
  // sem posição escolhida: no canto, mas acima da barra da chamada (antes cobria o "Sair da chamada")
  if (!p) {
    const st = document.getElementById('stage'), bar = st?.querySelector(':scope > .bar'); // posição de layout (a barra pode estar escondida/deslocada)
    ui.root.style.right = ui.root.style.bottom = '';
    if (bar?.offsetHeight && st.getClientRects().length) ui.root.style.bottom = Math.max(16, innerHeight - (st.getBoundingClientRect().top + bar.offsetTop) + 8) + 'px';
    return;
  }
  W.miniPos = p; ui.root.style.right = Math.max(4, Math.min(innerWidth - 120, p.right)) + 'px'; ui.root.style.bottom = Math.max(4, Math.min(innerHeight - 80, p.bottom)) + 'px'; }
function ccRecheck() { if (!W.cc) setTimeout(() => W.player?.captionsOff?.(), 50); }
if (typeof document !== 'undefined') { document.addEventListener('visibilitychange', () => { if (!document.hidden) ccRecheck(); }); window.addEventListener('focus', ccRecheck); }
export const placeWatch = () => { if (W.open) place(); };

function paint() { if (!W.joined) return place(); build(); paintHead(); paintAsk(); paintControls(); paintSide(); paintOverlay(); place(); }

const svcDot = (id) => h('span.wt-svc', { style: { '--svc': SERVICES[id]?.color || '#888' } }, SERVICES[id]?.name || id);
const thumbOf = (it, cls = '.wt-th') => it.thumb ? h('img' + cls, { src: it.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('div' + cls + '.ph', { style: { '--svc': SERVICES[it.service]?.color } }, h('b', (SERVICES[it.service]?.name || '?')[0]));

// quem controla: o anfitrião escolhe ali mesmo no topo ("Só eu" / "Todos"); os outros veem quem controla
function ctlSwitch() {
  const s = W.sess, sharing = s.mode === 'sharing';
  if (isHost()) {
    const opt = (mode, label, tip) => h('button' + (s.mode === mode ? '.on' : ''), { role: 'radio', 'aria-checked': s.mode === mode ? 'true' : 'false', title: tip, onclick: () => setMode(mode) }, label);
    return h('div.wt-ctlsw', { role: 'radiogroup', 'aria-label': 'Quem controla o vídeo' },
      h('span.wt-ctlsw-l', 'Quem controla'),
      opt('hosting', 'Só eu', 'Só você (e quem você liberar em Pessoas) dá play, pausa, muda a posição e organiza a fila'),
      opt('sharing', 'Todos', 'Todo mundo que está assistindo controla o vídeo e a fila'));
  }
  const mine = canCtl();
  return h('div.wt-ctlinfo', { title: sharing ? 'Todo mundo que está assistindo controla o vídeo e a fila' : mine ? `${nm(s.host)} liberou o controle para você` : `Só ${nm(s.host)} controla o vídeo` },
    icon(sharing || mine ? 'users' : 'lock', 14), h('span', sharing ? 'Todos controlam' : mine ? 'Você pode controlar' : `${nm(s.host)} controla`));
}
function paintHead() {
  const s = W.sess, host = s.host; liveKey = (ctx.streams() || []).join(',');
  ui.head.replaceChildren(
    h('div.wt-brand', h('span.wt-logo', icon('tv', 18)), h('div', h('b', 'Watch Together'), h('small', s.current ? s.current.title : 'Nada tocando'))),
    h('div.wt-hsp'),
    liveBtn(),
    h('div.wt-hostchip', { title: `${nm(host)} é o anfitrião` }, avatar(user(host), 20, { status: false }), h('span', nm(host)), icon('crown', 12)),
    ctlSwitch(),
    h('span.wt-hsep'),
    h('button.wt-hbtn', { title: 'Convidar amigos para assistir', onclick: (e) => invitePicker(e.currentTarget) }, icon('invite', 18), h('span.wt-hl', 'Convidar')),
    h('button.wt-hbtn.wt-minbtn', { title: 'Minimizar (Esc): continua tocando e você continua na chamada', 'aria-label': 'Minimizar', onclick: minimizeWatch }, icon('shrink', 18)),
    h('button.wt-hbtn.wt-expbtn', { title: 'Abrir o Watch Together (volta para a chamada)', 'aria-label': 'Expandir', onclick: () => { const v = ctx.voice(), ch = ctx.channelById(W.cid); if (ch && v?.channelId === W.cid && !document.getElementById('stage')) ctx.goCall?.(ch); openWatch(); } }, icon('expand', 18)),
    h('button.wt-hbtn.wt-leave', { title: 'Sair do Watch Together', 'aria-label': 'Sair do Watch Together', onclick: (e) => isHost() ? menu(e, [{ label: 'Sair (outra pessoa vira anfitrião)', icon: 'logout', fn: leaveWatch }, { label: 'Encerrar para todos', icon: 'x', danger: true, fn: () => act('end') }]) : leaveWatch() }, icon('x', 18)));
}
// pedidos de controle (só o anfitrião vê): uma faixa discreta embaixo do topo, com Liberar / Agora não
function paintAsk() {
  if (!ui) return;
  const list = isHost() && W.sess?.mode === 'hosting' ? (W.asks || []) : [];
  ui.askbar.replaceChildren(...list.slice(0, 3).map(uid => h('div.wt-ask', avatar(user(uid), 20, { status: false }), h('span', h('b', nm(uid)), ' pediu para controlar o vídeo'),
    h('button.btn.sm', { onclick: () => grant(uid, true) }, 'Liberar'),
    h('button.btn.sm.grey', { onclick: () => { W.asks = W.asks.filter(u => u !== uid); paintAsk(); } }, 'Agora não'),
    list.length === 1 && h('button.wt-asklink', { onclick: () => setMode('sharing') }, 'Liberar para todos'))));
}
let bar = null, holding = false, pendingCtl = false;
// arrastando a barra do vídeo ou o volume: nada redesenha os controles (redesenhar destruía o controle no meio do
// arraste, e o volume "fechava" sozinho); o que ficou pendente é aplicado ao soltar
if (typeof window !== 'undefined') window.addEventListener('pointerup', () => { if (!holding) return; holding = false; ui?.controls.classList.remove('voldrag'); if (pendingCtl) { pendingCtl = false; paintControls(); } }, true);
function paintControls() {
  if (!ui || !W.sess) return;
  if (holding) { pendingCtl = true; return; }
  const s = W.sess, it = s.current, ctl = canCtl(), playing = s.pb.status === 'playing';
  const dis = !it || !ctl;
  const title = ctl ? '' : ` (só ${nm(s.host)} controla)`;
  const hold = () => { holding = true; };
  bar = h('input.wt-seek', { type: 'range', min: 0, max: 1000, step: 1, value: 0, disabled: dis, 'aria-label': 'Posição do vídeo', onpointerdown: hold,
    oninput: () => { bar.dragging = true; paintTime(); }, onchange: () => { bar.dragging = false; const d = it?.duration || W.player?.duration() || 0; if (d) seekTo(+bar.value / 1000 * d); } });
  // volume: ícone do alto-falante + controle curto que abre ao passar o mouse (só para você), separado da barra do vídeo
  const vol = h('input.wt-vol', { type: 'range', min: 0, max: 100, value: W.muted ? 0 : W.vol, 'aria-label': 'Volume (só para você)', onpointerdown: () => { hold(); ui.controls.classList.add('voldrag'); }, oninput: (e) => { e.target.style.setProperty('--p', e.target.value + '%'); setVol(+e.target.value, +e.target.value === 0); } });
  vol.style.setProperty('--p', (W.muted ? 0 : W.vol) + '%');
  const volIco = W.muted || !W.vol ? 'volmute' : W.vol < 50 ? 'vollow' : 'vol';
  ui.controls.replaceChildren(
    h('div.wt-seekrow', bar),
    h('div.wt-btnrow',
      h('button.wt-cb.wt-prev', { title: 'Anterior' + title, 'aria-label': 'Anterior', disabled: dis, onclick: () => act('prev') }, icon('skip', 18)),
      h('button.wt-cb.wt-pp', { title: (playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)') + title, 'aria-label': playing ? 'Pausar' : 'Reproduzir', disabled: !it, onclick: togglePlay }, icon(playing ? 'pause' : 'play', 22)),
      h('button.wt-cb', { title: 'Próximo' + title, 'aria-label': 'Próximo', disabled: dis, onclick: () => act('skip', { item_id: it?.id }) }, icon('skip', 18)),
      h('div.wt-volbox', { title: 'Volume só para você' },
        h('button.wt-cb', { title: W.muted ? 'Ativar som (m)' : 'Silenciar (m)', 'aria-label': W.muted ? 'Ativar som' : 'Silenciar', onclick: () => setVol(W.vol || 60, !W.muted) }, icon(volIco, 18)),
        h('div.wt-volslide', vol)),
      h('span.wt-clock', h('span.wt-time', '0:00'), h('span.wt-dur', ' / ' + (it?.duration ? fmtTime(it.duration) : '--:--'))),
      h('div.wt-sp'),
      h('span.wt-sync'),
      it?.service === 'youtube' && h('button.wt-cb.wt-ccbtn' + (W.cc ? '.on' : ''), { title: W.cc ? 'Desativar legendas (c) — só para você' : 'Ativar legendas (c) — só para você', 'aria-label': 'Legendas', 'aria-pressed': W.cc ? 'true' : 'false', onclick: () => setCc(!W.cc) }, h('span.wt-cc', 'CC')),
      it && !ctl && h('button.wt-askbtn', { title: `Só ${nm(s.host)} controla o vídeo agora. Peça para controlar também.`, onclick: askControl }, icon('lock', 14), h('span', 'Pedir controle')),
      h('button.wt-cb', { title: 'Ressincronizar com a sala', 'aria-label': 'Ressincronizar', onclick: resync }, icon('refresh', 16)),
      h('button.wt-cb', { title: 'Tela cheia (f)', 'aria-label': 'Tela cheia', onclick: fullscreen }, icon('expand', 16))));
  paintTime(); paintSyncBadge();
}
function paintTime() {
  if (!ui || !W.sess?.current || ui.root.classList.contains('hidden')) return;
  const it = W.sess.current, p = W.player, d = it.duration || p?.duration() || 0;
  const pos = external(it) && !p?.controllable ? expectedPos(W.sess.pb, W.clock.now(), d) : p?.time() || 0;
  // só escreve o que mudou: cada escrita repinta por cima do vídeo (no app desktop isso já causou piscadas)
  const put = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };
  put(ui.controls.querySelector('.wt-time'), fmtTime(bar?.dragging && d ? +bar.value / 1000 * d : pos));
  if (bar && !bar.dragging && d) { const v = Math.round(pos / d * 1000); if (+bar.value !== v) bar.value = v; }
  if (bar) { const pc = (bar.value / 10) + '%'; if (bar.style.getPropertyValue('--p') !== pc) bar.style.setProperty('--p', pc); }
  if (d) put(ui.controls.querySelector('.wt-dur'), ' / ' + fmtTime(d));
  const cd = ui.overlay.querySelector('.wt-count b'); if (cd) { const left = Math.ceil((W.sess.pb.at - W.clock.now()) / 1000); if (left <= 0) paintOverlay(); else cd.textContent = left; }
  const vc = ui.overlay.querySelector('.wt-vclock'); if (vc) vc.textContent = fmtTime(expectedPos(W.sess.pb, W.clock.now(), d));
  if (W.bufSince && performance.now() - W.bufSince > 8000 && !ui.overlay.querySelector('.wt-slow')) paintOverlay();
  if (!W.bufSince && ui.overlay.querySelector('.wt-slow')) paintOverlay();
}
function paintSyncBadge() {
  const el = ui?.controls.querySelector('.wt-sync'); if (!el || !W.sess) return;
  const it = W.sess.current;
  if (!it) return el.replaceChildren();
  if (external(it) && !W.player?.controllable) { el.className = 'wt-sync ext'; el.replaceChildren(icon('users', 12), h('span', LEVELS[levelOf(it)].label)); el.title = LEVELS[levelOf(it)].desc; return; }
  const p = W.player, buf = p?.buffering(), d = W.drift;
  const st = W.error ? 'err' : buf ? 'buf' : Math.abs(d) <= .15 ? 'ok' : 'off';
  el.className = 'wt-sync ' + st;
  el.title = st === 'ok' ? `Sincronizado com a sala (diferença ${(d * 1000).toFixed(0)} ms)` : st === 'off' ? `Fora de sincronia por ${(Math.abs(d) * 1000).toFixed(0)} ms — ${W.rate !== 1 ? 'ajustando a velocidade' : 'corrigindo'}` : st === 'buf' ? 'Carregando o vídeo' : 'Erro no player';
  el.replaceChildren(h('i'), h('span', st === 'ok' ? 'Sincronizado' : st === 'off' ? (d > 0 ? '+' : '−') + (Math.abs(d) < 1 ? (Math.abs(d) * 1000).toFixed(0) + ' ms' : Math.abs(d).toFixed(1) + ' s') : st === 'buf' ? 'Carregando…' : 'Erro'));
}

function paintOverlay() {
  if (!ui || !W.sess) return;
  const s = W.sess, it = s.current, ov = ui.overlay, now = W.clock.now();
  const items = [];
  ui.stagebox.classList.toggle('ext', external(it) && !W.player?.controllable);
  ui.stagebox.classList.toggle('err', !!(it && W.error));
  ui.catcher.classList.toggle('off', !it || (external(it) && !W.player?.controllable));
  if (!it) {
    const goAdd = (id) => { if (id) W.svc = id; W.tab = 'search'; W.results = null; paintSide(); ui.search.focus(); };
    items.push(h('div.wt-empty',
      h('div.wt-empty-ic', icon('tv', 32)),
      h('h2', s.history.length ? 'A fila acabou' : 'O que vamos assistir?'),
      h('p', s.history.length ? 'Adicione mais vídeos para continuar assistindo juntos.' : 'Busque no YouTube ou cole um link. Os vídeos tocam em ordem, no mesmo ponto para todo mundo.'),
      h('div.wt-acts', h('button.btn', { onclick: () => goAdd('youtube') }, icon('search', 16), 'Buscar no YouTube'), h('button.btn.grey', { onclick: () => goAdd() }, icon('link', 16), 'Colar um link')),
      h('div.wt-svcline', 'Também funciona com ', SERVICE_IDS.filter(id => SERVICES[id].level === 'assisted').map((id, i, a) => [h('button', { onclick: () => goAdd(id) }, SERVICES[id].name), i < a.length - 2 ? ', ' : i === a.length - 2 ? ' e ' : '']).flat())));
  } else if (W.error) {
    const e = ERRORS[W.error] || ERRORS.html5, svc = SERVICES[it.service];
    const btn = { open: () => h('button.btn', { onclick: () => window.open(svc.openUrl(it, W.player?.time?.() || 0), '_blank', 'noopener') }, icon('external', 14), 'Abrir ' + svc.on),
      skip: () => canCtl() ? h('button.btn.grey', { onclick: () => act('skip', { item_id: it.id }) }, icon('skip', 14), 'Pular para o próximo') : h('span.wt-hintline', `${nm(s.host)} pode pular este vídeo`),
      retry: () => h('button.btn.grey', { onclick: resync }, icon('refresh', 14), 'Tentar de novo'),
      resume: () => h('button.btn', { onclick: () => { W.error = null; W.player?.setMuted(W.muted); W.player?.play(); paintOverlay(); } }, icon('play', 14), 'Assistir'),
      login: () => h('button.btn', { onclick: () => ctx.serviceLogin ? ctx.serviceLogin(it.service) : window.open(svc.login, '_blank', 'noopener') }, 'Entrar na conta') };
    items.push(h('div.wt-err', h('div.wt-err-ic', icon('warn', 28)), h('b', e.title), h('p', e.text), h('div.wt-acts', e.actions.map(a => btn[a]?.()).filter(Boolean)),
      h('small', 'Os outros participantes continuam assistindo. Você volta a acompanhar no próximo vídeo.')));
  } else if (external(it) && !W.player?.controllable) {
    items.push(externalPanel(it));
  } else if (external(it)) { // controles sincronizados: o vídeo toca na janela do serviço, comandado pela sala
    const svc = SERVICES[it.service];
    items.push(h('div.wt-ext.ctl', { style: { '--svc': svc.color } }, h('div.wt-ext-top', svcDot(it.service), h('span.wt-lvl', { title: LEVELS.controls.desc }, LEVELS.controls.label + ' · experimental')),
      h('h2', it.title), h('p.wt-ext-why', `O vídeo está tocando na janela ${svc.on.replace(/^n[oa] /, 'd' + (svc.on.startsWith('na') ? 'a ' : 'o '))} com a sua conta. Play, pause e posição da sala são aplicados nela.`),
      h('div.wt-acts', h('button.btn', { onclick: () => desk.watchCmd(it.service, { t: 'show' }) }, icon('tv', 14), 'Mostrar a janela'))));
  } else {
    if (!W.ready) items.push(h('div.wt-loading', it.thumb && h('img', { src: it.thumb, alt: '', referrerPolicy: 'no-referrer' }), h('div.wt-spin'), h('span', 'Carregando o vídeo…')));
    else if (waitingStart(s.pb, now) && s.pb.at - now > 300) items.push(h('div.wt-count.soft', h('span', 'Começando juntos'), h('b', Math.ceil((s.pb.at - now) / 1000))));
    if (W.autoplayBlocked) items.push(h('button.wt-unmute', { onclick: () => { W.autoplayBlocked = false; setVol(W.vol || 60, false); W.player?.play(); paintOverlay(); } }, icon('volmute', 18), 'O navegador começou sem som. Clique para ativar o som'));
    if (W.bufSince && performance.now() - W.bufSince > 8000) items.push(h('div.wt-slow', icon('wifi', 16), h('span', 'Sua conexão está lenta: o vídeo está demorando para carregar. Você continua na sala e volta a acompanhar sozinho.'), h('button', { onclick: resync }, 'Ressincronizar')));
    if (s.pb.status === 'paused' && W.ready) items.push(h('div.wt-paused', icon('pause', 18), h('span', s.pb.by ? `Pausado por ${nm(s.pb.by)}` : 'Pausado')));
  }
  ov.replaceChildren(...items);
}
// sincronização assistida: cada um abre na própria conta; o Resenha mostra a posição combinada e conta para o play
function externalPanel(it) {
  const s = W.sess, svc = SERVICES[it.service], lvl = levelOf(it), now = W.clock.now(), pb = s.pb;
  const counting = pb.status === 'playing' && pb.at > now;
  const deskWin = desk && svc.desktopWindow, br = deskWin ? bridgeFor(it.service) : null;
  const myPos = h('input.wt-mypos', { placeholder: 'mm:ss', 'aria-label': 'Em que ponto você está', value: W.myPos != null ? fmtTime(W.myPos) : '', onchange: (e) => { const t = parseTime(e.target.value); W.myPos = t; report(true); } });
  return h('div.wt-ext', { style: { '--svc': svc.color } },
    h('div.wt-ext-top', svcDot(it.service), h('span.wt-lvl', { title: LEVELS[lvl].desc }, LEVELS[lvl].label)),
    h('h2', it.title),
    h('p.wt-ext-why', 'Este serviço protege o vídeo (DRM) e não permite que ele toque dentro de outro app nem seja transmitido. Cada participante assiste na própria conta; o Resenha combina o momento e a posição.'),
    h('div.wt-acts',
      deskWin && h('button.btn', { onclick: () => openServiceWindow(it) }, icon('tv', 14), `Abrir ${svc.on} (janela do app)`),
      h('button.btn' + (deskWin ? '.grey' : ''), { onclick: () => window.open(svc.openUrl(it), '_blank', 'noopener') }, icon('external', 14), deskWin ? 'Abrir no navegador' : `Abrir ${svc.on}`),
      h('button.btn.grey', { onclick: () => window.open(svc.login, '_blank', 'noopener') }, 'Entrar na conta')),
    br?.open && h('div.wt-bridge' + (br.widevine === false || br.err ? '.bad' : ''), icon(br.widevine === false ? 'warn' : 'tv', 14),
      h('span', br.widevine === false ? 'A janela abriu, mas este app não tem o módulo Widevine (DRM) que o serviço exige: o vídeo não vai tocar nela. Use "Abrir no navegador" — a sincronização assistida continua aqui.'
        : br.login ? 'Entre na sua conta na janela do serviço. O login fica guardado só nela.'
        : br.err ? (ERRORS[br.err]?.title || 'Erro no player do serviço')
        : br.last?.video ? 'Vídeo encontrado na janela: os controles da sala vão comandá-lo.' : 'Janela aberta. Escolha o título/episódio nela.')),
    counting ? h('div.wt-count', h('span', 'Dê play em'), h('b', Math.ceil((pb.at - now) / 1000)))
      : h('div.wt-vbox', h('small', pb.status === 'playing' ? 'Tocando — posição combinada' : 'Pausado na posição combinada'), h('b.wt-vclock', fmtTime(expectedPos(pb, now, it.duration))), pb.status === 'playing' ? h('span.wt-go', 'Dê play agora ' + svc.on) : h('span', canCtl() ? 'Quando todos estiverem prontos, aperte play aqui: todos recebem a contagem.' : `${nm(s.host)} vai dar o play com contagem para todos.`)),
    h('div.wt-me',
      h('button.wt-ready' + (W.ready_ext ? '.on' : ''), { onclick: () => { W.ready_ext = !W.ready_ext; report(true); paintOverlay(); } }, icon('check', 14), W.ready_ext ? 'Estou pronto' : 'Marcar como pronto'),
      h('label', 'Estou em', myPos),
      h('small', 'Opcional: ajuda a turma a ver quem está atrasado.')));
}

function paintSide() {
  if (!ui || !W.sess) return;
  const s = W.sess, nq = s.queue.length + (s.current ? 1 : 0), online = s.members.filter(m => m.online).length;
  // redesenhar não pode tirar o foco de quem está digitando na busca (alguém entra, a fila muda…): guardar ANTES de
  // montar o painel, que já move o campo de lugar
  const focused = document.activeElement === ui.search, a = ui.search.selectionStart, b = ui.search.selectionEnd, scroll = ui.side.querySelector('.wt-pane')?.scrollTop || 0;
  const tab = (id, label, n) => h('button.wt-tab' + (W.tab === id ? '.on' : ''), { role: 'tab', 'aria-selected': W.tab === id ? 'true' : 'false', onclick: () => { W.tab = id; paintSide(); if (id === 'search') { ui.search.focus(); if (!W.results && !W.suggest) loadSuggest(); } } }, label, n ? h('span.wt-n', n) : null);
  const body = W.tab === 'search' ? searchPane() : W.tab === 'people' ? (paintPeople(), ui.people) : queuePane();
  ui.side.replaceChildren(h('div.wt-tabs', { role: 'tablist' }, tab('queue', 'Fila', nq), tab('search', 'Adicionar'), tab('people', 'Pessoas', online)), h('div.wt-pane', body));
  ui.side.querySelector('.wt-pane').scrollTop = scroll;
  if (focused && ui.search.isConnected) { ui.search.focus({ preventScroll: true }); try { ui.search.setSelectionRange(a, b); } catch { } }
}
async function loadSuggest() { const r = await watchCmd('suggest').catch(() => null); W.suggest = r?.results || []; if (W.tab === 'search') paintSide(); }
function queuePane() {
  const s = W.sess, ctl = canCtl(), out = [];
  if (s.current) out.push(h('div.wt-now', thumbOf(s.current), h('div.wt-meta', h('small', s.pb.status === 'playing' ? 'Tocando agora' : s.pb.status === 'paused' ? 'Pausado' : 'Atual'), h('b', s.current.title), h('span', svcDot(s.current.service), s.current.channel && ' · ' + s.current.channel), byLine(s.current)),
    (ctl || s.current.by === me()) && h('button.wt-ib', { title: 'Remover e tocar o próximo', 'aria-label': 'Remover o vídeo atual', onclick: () => act('remove', { id: s.current.id }) }, icon('trash', 16))));
  if (!s.queue.length) out.push(h('div.wt-qempty', s.current ? 'Nada na fila depois deste.' : 'A fila está vazia.', h('button.btn.sm', { onclick: () => { W.tab = 'search'; paintSide(); ui.search.focus(); } }, icon('plus', 14), 'Adicionar vídeos')));
  let drag = null;
  s.queue.forEach((it, i) => {
    const mineOrCtl = ctl || it.by === me();
    const row = h('div.wt-qi', { draggable: ctl ? 'true' : 'false', 'data-id': it.id,
      ondragstart: (e) => { drag = it.id; e.dataTransfer.effectAllowed = 'move'; row.classList.add('drag'); },
      ondragend: () => row.classList.remove('drag'),
      ondragover: (e) => { if (drag && drag !== it.id) { e.preventDefault(); row.classList.add('over'); } },
      ondragleave: () => row.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); row.classList.remove('over'); if (drag && drag !== it.id) act('move', { id: drag, to: i }); drag = null; } },
      h('span.wt-qn', ctl ? icon('more', 14) : String(i + 1)), thumbOf(it, '.wt-qth'),
      h('div.wt-meta', h('b', { title: it.title }, it.title), h('span', svcDot(it.service), it.duration ? ' · ' + fmtTime(it.duration) : ''), byLine(it)),
      h('div.wt-qa',
        ctl && h('button.wt-ib', { title: 'Tocar agora', 'aria-label': 'Tocar agora', onclick: () => act('play_item', { id: it.id }) }, icon('play', 14)),
        mineOrCtl && h('button.wt-ib', { title: 'Remover da fila', 'aria-label': 'Remover da fila', onclick: () => act('remove', { id: it.id }) }, icon('trash', 14))));
    out.push(row);
  });
  if (s.queue.length && !ctl) out.push(h('div.wt-note', icon('lock', 12), `Você pode adicionar e remover os seus vídeos. ${nm(s.host)} organiza a fila.`));
  return h('div.wt-queue', out);
}
const byLine = (it) => h('span.wt-by', avatar(user(it.by), 14, { status: false }), 'adicionado por ' + (it.by === me() ? 'você' : nm(it.by)));
function searchPane() {
  const svc = SERVICES[W.svc];
  ui.search.placeholder = svc.hint;
  const out = [h('div.wt-svcs', { role: 'radiogroup', 'aria-label': 'Serviço' }, SERVICE_IDS.map(id => h('button.wt-svcchip' + (W.svc === id ? '.on' : ''), { role: 'radio', 'aria-checked': W.svc === id ? 'true' : 'false', style: { '--svc': SERVICES[id].color }, title: LEVELS[SERVICES[id].level].desc, onclick: () => { W.svc = id; W.results = null; paintSide(); ui.search.focus(); } }, h('i'), SERVICES[id].name))),
    h('div.wt-level', h('b', LEVELS[svc.level].label), h('span', LEVELS[svc.level].desc)),
    h('div.wt-sbox', icon(svc.search ? 'search' : 'link', 16), ui.search, h('button.btn.sm', { onclick: () => doSearch(ui.search.value) }, svc.search ? 'Buscar' : 'Adicionar'))];
  if (svc.level === 'assisted') out.push(h('div.wt-note', icon('warn', 12), `${svc.name}: cada participante precisa da própria assinatura. Nada é transmitido de uma pessoa para outra.`));
  if (W.searching) out.push(h('div.wt-spinrow', h('div.wt-spin'), 'Buscando…'));
  const list = W.results || (svc.search ? W.suggest : null);
  if (list) {
    if (!W.results && list.length) out.push(h('div.wt-sub', 'Assistidos recentemente neste servidor'));
    if (W.results && !list.length) out.push(h('div.wt-qempty', 'Nada encontrado.'));
    for (const r of list) out.push(h('div.wt-res', thumbOf(r, '.wt-rth'), h('div.wt-meta', h('b', { title: r.title }, r.title), h('span', [r.channel, r.duration ? fmtTime(r.duration) : ''].filter(Boolean).join(' · '))),
      h('button.wt-add', { title: 'Adicionar à fila', 'aria-label': 'Adicionar à fila: ' + r.title, onclick: () => addItem(r) }, icon('plus', 18))));
  }
  return h('div.wt-search-pane', out);
}
function paintPeople() {
  if (!ui || !W.sess) return;
  const s = W.sess, voice = ctx.voice(), now = W.clock.now();
  const rows = [...s.members].sort((a, b) => (b.online - a.online) || (a.joined_at - b.joined_at)).map(m => {
    const rep = W.reports[m.id], st = !m.online ? 'offline' : syncState(rep && { ...rep, at: rep.at }, s.pb, now, s.current?.duration || 0);
    const label = { ok: 'Sincronizado', ahead: 'Adiantado', behind: 'Atrasado', buffering: 'Carregando', error: rep?.error ? (ERRORS[rep.error]?.title || 'Erro') : 'Erro', offline: 'Reconectando…', external: 'Assistindo fora', ready: 'Pronto', unknown: 'Entrando…' }[st] || st;
    const extra = (rep?.external && rep.pos ? ' · ' + fmtTime(rep.pos) : '') + (m.online && rep?.q && QUALITY_LABEL[rep.q] ? ' · ' + QUALITY_LABEL[rep.q] + (rep.qd ? ' (reduzida)' : '') : '');
    const other = isHost() && m.id !== me();
    const hostMenu = other && m.online ? (e) => menu(e, [{ label: 'Passar o anfitrião', icon: 'crown', fn: () => act('host', { uid: m.id }) }]) : null;
    const lets = s.controllers.includes(m.id);
    // anfitrião no "Só eu": a chave à vista em cada pessoa libera (ou tira) o controle só dela
    const sw = other && s.mode === 'hosting' && h('button.wt-sw' + (lets ? '.on' : ''), { role: 'switch', 'aria-checked': lets ? 'true' : 'false', title: lets ? `${nm(m.id)} pode controlar o vídeo. Clique para tirar` : `Deixar ${nm(m.id)} controlar o vídeo`, 'aria-label': 'Pode controlar: ' + nm(m.id), onclick: () => grant(m.id, !lets) }, h('i'));
    return h('div.wt-person' + (voice?.speaking?.has(m.id) ? '.speaking' : '') + (m.online ? '' : '.off'), { 'data-uid': m.id, oncontextmenu: hostMenu },
      avatar(user(m.id), 32, { status: false }),
      h('div.wt-meta', h('b', nm(m.id), m.id === s.host && h('span.wt-crown', { title: 'Anfitrião' }, icon('crown', 12))), h('span.wt-st.' + st, h('i'), (m.id === s.host ? 'Anfitrião · ' : lets ? 'Controla · ' : '') + label + extra)),
      sw, hostMenu && h('button.wt-ib', { title: 'Opções', 'aria-label': 'Opções de ' + nm(m.id), onclick: hostMenu }, icon('more', 14)));
  });
  const head = isHost()
    ? h('div.wt-pphead', h('div', h('b', 'Quem controla o vídeo'), h('small', s.mode === 'sharing' ? 'Todos podem dar play, pausar, pular e organizar a fila.' : 'Só você e quem estiver com a chave ligada.')),
      h('div.wt-seg', h('button' + (s.mode === 'hosting' ? '.on' : ''), { onclick: () => setMode('hosting') }, 'Só eu'), h('button' + (s.mode === 'sharing' ? '.on' : ''), { onclick: () => setMode('sharing') }, 'Todos')))
    : h('div.wt-pphead', h('div', h('b', s.mode === 'sharing' ? 'Todos controlam o vídeo' : canCtl() ? 'Você pode controlar o vídeo' : `${nm(s.host)} controla o vídeo`), h('small', s.mode === 'sharing' || canCtl() ? 'Play, pausa, posição e fila valem para todo mundo.' : 'Você pode adicionar vídeos e remover os seus.')),
      !canCtl() && s.current && h('button.btn.sm', { onclick: askControl }, 'Pedir controle'));
  ui.people.replaceChildren(head, ...rows, h('button.btn.grey.sm.wt-invbtn', { onclick: (e) => invitePicker(e.currentTarget) }, icon('invite', 14), 'Convidar mais gente'));
}

// convidar: amigos e membros do servidor que não estão na chamada recebem o convite "para assistir junto"
function invitePicker(anchor) {
  const list = ctx.inviteCandidates();
  const body = h('div.wt-inv', h('b', 'Convidar para assistir junto'), h('small', 'A pessoa recebe o convite com toque; aceitar coloca na chamada e abre o Watch Together.'),
    list.length ? h('div.wt-invlist', list.slice(0, 30).map(u => h('div.wt-invrow', avatar(user(u), 28), h('span', nm(u)), h('button.btn.sm', { onclick: async (e) => { const b = e.currentTarget; if (await ctx.invite(u)) { b.disabled = true; b.textContent = 'Enviado'; } } }, 'Convidar')))) : h('div.wt-qempty', 'Ninguém disponível para convidar (amigos ou membros do servidor fora da chamada).'));
  closeFloating();
  const el = h('div.popout.wt-invpop', body); document.getElementById('layer').append(el);
  const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.right - w.width, innerWidth - w.width - 8)) + 'px'; el.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - w.height - 8)) + 'px';
}

// ---------- palco da chamada: quadro da atividade (entrar / abrir) ----------
export function watchTile() {
  const s = W.sess, v = ctx.voice(); if (!s || !v?.channelId || s.cid !== v.channelId) return null;
  if (W.joined && W.open && !W.mini) return null;
  const it = s.current, on = s.members.filter(m => m.online);
  return h('div.tile.wttile', { 'data-key': 'watch' },
    it?.thumb && h('img.wtt-bg', { src: it.thumb, alt: '', referrerPolicy: 'no-referrer' }),
    h('div.wtt', h('span.wt-logo', icon('tv', 22)), h('b', 'Watch Together'), h('span', it ? it.title : 'Escolhendo o que assistir…'),
      h('div.wtt-av', on.slice(0, 5).map(m => avatar(user(m.id), 24, { status: false })), on.length > 5 && h('span', '+' + (on.length - 5))),
      W.joined ? h('button.btn.green', { onclick: openWatch }, icon('expand', 14), 'Abrir') : h('button.btn.green', { onclick: joinWatch }, icon('play', 14), 'Entrar no Watch Together')));
}
// chamado pelo app a cada redesenho da chamada: saiu da sala → fecha tudo
export function watchVoiceChanged() {
  const v = ctx.voice();
  if (W.sess && (!v?.channelId || v.channelId !== W.cid)) { teardown(); }
  if (W.joined && ui && (ctx.streams() || []).join(',') !== liveKey) paintHead(); // alguém começou/parou de transmitir
  place();
}

// ---------- lançador de atividades (botão da barra da chamada) ----------
export function activityLauncher(anchor, entries) {
  if (document.querySelector('.actpop:not(.leaving)')) return closeFloating();
  closeFloating();
  const card = (e) => h('button.act-card' + (e.on ? '.on' : ''), { onclick: () => { closeFloating(); e.fn(); }, style: e.color ? { '--acc': e.color } : null },
    h('span.act-ic', icon(e.icon, 26)), h('div', h('b', e.title, e.badge && h('span.act-badge', e.badge)), h('small', e.desc)), e.on && h('span.act-on', 'Ativo'));
  const el = h('div.popout.actpop', h('div.act-head', h('b', 'Atividades'), h('small', 'Para fazer junto com quem está na chamada')), h('div.act-list', entries.filter(Boolean).map(card)));
  document.getElementById('layer').append(el);
  const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w.width / 2, innerWidth - w.width - 8)) + 'px';
  el.style.top = Math.max(8, r.top - w.height - 10) + 'px';
  return el;
}
export function watchLauncherEntry() {
  const s = W.sess;
  return { icon: 'tv', title: 'Watch Together', badge: 'Novo', color: '#e5484d', on: !!s,
    desc: s ? (W.joined ? 'Voltar para o Watch Together' : `Entrar: ${s.members.filter(m => m.online).length} assistindo`) : 'Vídeos do YouTube no mesmo ponto para todos, com fila compartilhada',
    fn: () => (s ? openWatch() : startWatch()) };
}
export const watchSetEnv = (env) => { Object.assign(W.env, env); if (W.joined) paint(); };
