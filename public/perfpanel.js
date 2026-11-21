// Painel "Desempenho" da transmissão (jogar junto e controle remoto), para quem transmite e para quem joga/assiste.
// Uma vez por segundo lê os contadores do navegador (getStats) e, com jogadores, o eco de comando (REMOTE_PING/PONG pelo
// mesmo caminho dos comandos). Cada número diz de onde vem:
//  - medido: contador do navegador/programa ou tempo cronometrado aqui;
//  - estimado: conta a partir de números medidos (ex.: ida = metade da ida e volta);
//  - anfitrião: medido no PC de quem transmite e mandado no eco (o relógio dele, não o daqui).
// Sem dado confiável, mostra "—" (nunca um número inventado). Copiar (texto) e Exportar (JSON, últimos 2 min).
import { h, icon } from './util.js';
import { S, toast, user } from './state.js';
import { voice } from './gateway.js';
import { perf, myPlay, playersOf, sessionsForPing, sendPing } from './remote.js';

const KEEP = 120; // amostras (1 por segundo)
let panel = null, timer = 0, target = null, samples = [], prev = new Map(), rvfc = null;
const nm = (uid) => user(uid)?.display_name || user(uid)?.username || '?';
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const pct = (a, q) => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; };
const delta = (key, now, vals) => { const p = prev.get(key); prev.set(key, { t: now, ...vals }); return p; };

// par de candidatos em uso: RTT do ICE (medido) e por onde a mídia passa (UDP/TCP, direto ou relay)
async function transportOf(t) {
  if (!t || t.closed) return null;
  try {
    const st = await t.getStats(); let pair = null; const by = new Map(); st.forEach(r => by.set(r.id, r));
    st.forEach(r => { if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && (!pair || r.nominated)) pair = r; });
    if (!pair) return null;
    const lc = by.get(pair.localCandidateId), rc = by.get(pair.remoteCandidateId);
    const proto = (lc?.relayProtocol || lc?.protocol || rc?.protocol || '').toUpperCase();
    return { rtt: pair.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null, via: `${proto || '?'}${lc?.candidateType === 'relay' ? ' por relay (TURN)' : lc?.candidateType === 'host' ? ' direto (rede local)' : ' direto'}` };
  } catch { return null; }
}
// FPS exibidos: quadros que chegaram à tela no <video> da transmissão (requestVideoFrameCallback)
function countFrames(uid) {
  const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`);
  if (rvfc?.v === v) return rvfc; if (!v?.requestVideoFrameCallback) return (rvfc = null);
  const st = rvfc = { v, n: 0 };
  const cb = () => { if (rvfc !== st) return; st.n++; v.requestVideoFrameCallback(cb); };
  v.requestVideoFrameCallback(cb); return st;
}
// quem assiste/joga: o que CHEGA da transmissão de uid
async function viewerSample(uid, now) {
  const out = { role: 'jogador', host: uid };
  const e = [...(voice.sfu?.consumers.values() || [])].filter(x => x.uid === uid && x.source === 'screen' && !x.c.closed).at(-1);
  if (e) {
    try {
      const st = await e.c.getStats(); let r = null, codec = null; st.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') r = x; });
      if (r) { st.forEach(x => { if (x.id === r.codecId) codec = x; });
        const p = delta('in:' + uid, now, { fr: r.framesReceived, fd: r.framesDecoded, fx: r.framesDropped, dt: r.totalDecodeTime, jd: r.jitterBufferDelay, je: r.jitterBufferEmittedCount, b: r.bytesReceived, pl: r.packetsLost, pr: r.packetsReceived, fz: r.freezeCount });
        Object.assign(out, { w: r.frameWidth, h: r.frameHeight, codec: codec?.mimeType?.replace('video/', '') || null, decoder: r.decoderImplementation || null, hwDecoder: r.powerEfficientDecoder ?? null, jitter: r.jitter != null ? r.jitter * 1000 : null, freezes: r.freezeCount ?? null });
        if (p) { const dt = (now - p.t) / 1000, dd = r.framesDecoded - p.fd, de = r.jitterBufferEmittedCount - p.je, dl = r.packetsLost - p.pl, dr = r.packetsReceived - p.pr;
          Object.assign(out, { fpsIn: (r.framesReceived - p.fr) / dt, fpsDec: dd / dt, dropped: r.framesDropped - p.fx, decMs: dd > 0 ? (r.totalDecodeTime - p.dt) / dd * 1000 : null, jbMs: de > 0 ? (r.jitterBufferDelay - p.jd) / de * 1000 : null,
            kbps: (r.bytesReceived - p.b) * 8 / dt / 1000, loss: dl + dr > 0 ? Math.max(0, dl) / (dl + dr) * 100 : 0 }); }
      }
    } catch { }
  }
  const f = countFrames(uid), pf = delta('shown:' + uid, now, { n: f?.n ?? 0 });
  if (f && pf) out.fpsShown = (f.n - pf.n) / ((now - pf.t) / 1000);
  const tr = await transportOf(voice.sfu?.recv); if (tr) { out.rtt = tr.rtt; out.via = tr.via; }
  const s = myPlay(uid);
  if (s?.state === 'active') {
    const a = perf.rtt.get(s.id) || []; out.cmdRtt = pct(a.slice(-30).map(x => x.ms), .5); out.cmdRtt95 = pct(a.slice(-30).map(x => x.ms), .95); out.cmdN = a.length;
    const hi = perf.host.get(s.id); if (hi && now - hi.at < 5000) out.hostInfo = hi.h;
  }
  // captura -> exibição: o Chromium não expõe o horário de captura do quadro aqui (abs-capture-time não chega pelo SFU),
  // então é a soma do que foi medido em cada ponta: codificação + metade do RTT de cada um ao servidor + buffer + decodificação
  const hI = out.hostInfo;
  if (hI?.encMs != null && hI.rtt != null && out.rtt != null && out.jbMs != null && out.decMs != null) out.glassEst = hI.encMs + hI.rtt / 2 + out.rtt / 2 + out.jbMs + out.decMs;
  return out;
}
// quem transmite: o que SAI (Chromium ou programa nativo) e os jogadores
export async function hostSample(now = performance.now(), tag = 'painel') { // tag: quem lê (o painel e o eco têm cada um o seu "último valor")
  const out = { role: 'anfitrião', path: voice.native && !voice.native.pending ? 'nativo' : voice.screen ? 'chromium' : null };
  if (voice.native?.stats) { const n = voice.native.stats; Object.assign(out, { w: n.w, h: n.h, fpsCap: n.cap ?? null, fpsOut: n.fps, kbps: n.kbps, encMs: n.encMs ?? null, encoder: 'Placa de vídeo (programa nativo' + (voice.native.encoder ? ': ' + voice.native.encoder : '') + ')' }); }
  else {
    const pr = voice.sfu?.producers.screen;
    if (pr && !pr.closed) {
      try {
        const st = await pr.getStats(); let best = null, src = null; st.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video' && (!best || (r.frameWidth || 0) > (best.frameWidth || 0))) best = r; if (r.type === 'media-source' && r.kind === 'video') src = r; });
        if (best) { const p = delta('out:' + tag, now, { fe: best.framesEncoded, te: best.totalEncodeTime, b: best.bytesSent });
          Object.assign(out, { w: best.frameWidth, h: best.frameHeight, fpsOut: best.framesPerSecond ?? null, fpsCap: src?.framesPerSecond ?? null, limit: best.qualityLimitationReason || 'none', encoder: best.encoderImplementation || null, hwEncoder: best.powerEfficientEncoder ?? null });
          if (p) { const df = best.framesEncoded - p.fe, dt = (now - p.t) / 1000; out.encMs = df > 0 ? (best.totalEncodeTime - p.te) / df * 1000 : null; out.kbps = (best.bytesSent - p.b) * 8 / dt / 1000; } }
      } catch { }
    }
  }
  const tr = await transportOf(voice.sfu?.send); if (tr) { out.rtt = tr.rtt; out.via = tr.via; }
  out.players = playersOf(S.me.id).map(p => { const a = perf.rtt.get(p.id) || [], c = perf.inputs.get(p.id); return { slot: p.slot, name: nm(p.controller), cmdRtt: r1(pct(a.slice(-30).map(x => x.ms), .5)), cmdRtt95: r1(pct(a.slice(-30).map(x => x.ms), .95)), cmdPerS: c ? c.rate : null }; });
  return out;
}
// resumo que vai no eco para o painel de quem joga (números medidos no PC de quem transmite)
export async function hostSummary() { const s = await hostSample(performance.now(), 'eco'); return { path: s.path, fpsCap: r1(s.fpsCap), fpsOut: r1(s.fpsOut), encMs: r1(s.encMs), rtt: r1(s.rtt), kbps: Math.round(s.kbps || 0) || null, w: s.w, h: s.h, encoder: s.encoder ? String(s.encoder).slice(0, 60) : null }; }

const TAG = { m: ['medido', 'Contador do navegador ou do programa, ou tempo cronometrado aqui'], e: ['estimado', 'Calculado a partir de números medidos'], a: ['anfitrião', 'Medido no PC de quem transmite e mandado pelo eco de comando'] };
const row = (label, v, unit, tag, hint) => h('div.pf-row', { title: hint || '' }, h('span.pf-l', label), h('b.pf-v', v == null || v === '' ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v : r1(v)) + (unit || '') : v), h('i.pf-t.' + tag, { title: TAG[tag][1] }, TAG[tag][0]));
const sec = (t, ...kids) => h('section.pf-sec', h('h5', t), ...kids);
function render(x) {
  if (!panel) return;
  const body = panel.querySelector('.pf-body');
  if (x.role === 'anfitrião') {
    body.replaceChildren(
      sec('Envio', row('Caminho', x.path === 'nativo' ? 'Programa nativo' : x.path === 'chromium' ? 'Chromium' : null, '', 'm'),
        row('FPS capturados', x.fpsCap, '', 'm'), row('FPS enviados', x.fpsOut, '', 'm'), row('Codificação', x.encMs, ' ms', 'm', 'Tempo médio para comprimir um quadro no último segundo'),
        row('Codificador', x.encoder ? x.encoder + (x.hwEncoder === true ? ' (placa)' : x.hwEncoder === false ? ' (processador)' : '') : null, '', 'm'),
        row('Resolução', x.w ? `${x.w}×${x.h}` : null, '', 'm'), row('Bitrate', x.kbps != null ? (x.kbps >= 1000 ? r1(x.kbps / 1000) + ' Mbps' : Math.round(x.kbps) + ' kbps') : null, '', 'm'),
        x.limit && x.limit !== 'none' ? row('Limitado por', x.limit === 'cpu' ? 'processador' : x.limit === 'bandwidth' ? 'banda' : x.limit, '', 'm') : null),
      sec('Rede', row('RTT ao servidor', x.rtt, ' ms', 'm', 'Ida e volta da mídia até o servidor de voz (ICE)'), row('Transporte', x.via, '', 'm')),
      sec('Jogadores', ...(x.players.length ? x.players.flatMap(p => [row(`P${p.slot} ${p.name} · comando`, p.cmdRtt != null ? `${r1(p.cmdRtt)} ms · p95 ${r1(p.cmdRtt95)}` : null, '', 'm', 'Eco pelo mesmo caminho dos comandos: você → servidor → jogador → servidor → você'), row(`P${p.slot} · comandos/s`, p.cmdPerS, '', 'm')]) : [h('p.pf-empty', 'Ninguém jogando agora.')])));
  } else {
    const hI = x.hostInfo || {};
    body.replaceChildren(
      sec('Comandos', row('Ida e volta', x.cmdRtt != null ? `${r1(x.cmdRtt)} ms · p95 ${r1(x.cmdRtt95)}` : null, '', 'm', 'Eco pelo mesmo caminho dos comandos: você → servidor → quem transmite → servidor → você'),
        row('Ida (até quem transmite)', x.cmdRtt != null ? x.cmdRtt / 2 : null, ' ms', 'e', 'Metade da ida e volta')),
      sec('Vídeo recebido', row('FPS recebidos', x.fpsIn, '', 'm'), row('FPS decodificados', x.fpsDec, '', 'm'), row('FPS exibidos', x.fpsShown, '', 'm', 'Quadros que chegaram à tela (requestVideoFrameCallback)'),
        row('Decodificação', x.decMs, ' ms', 'm'), row('Buffer de jitter', x.jbMs, ' ms', 'm', 'Quanto cada quadro esperou para sair no tempo certo'),
        row('Decodificador', x.decoder ? x.decoder + (x.hwDecoder === true ? ' (placa)' : x.hwDecoder === false ? ' (processador)' : '') : null, '', 'm'),
        row('Codec · resolução', x.codec ? `${x.codec} · ${x.w}×${x.h}` : null, '', 'm'), row('Bitrate', x.kbps != null ? (x.kbps >= 1000 ? r1(x.kbps / 1000) + ' Mbps' : Math.round(x.kbps) + ' kbps') : null, '', 'm'),
        row('Captura → exibição (mínimo)', x.glassEst, ' ms', 'e', 'Piso: soma do que foi medido (codificação + metade do RTT de cada um ao servidor + buffer + decodificação). Não inclui a espera da captura nem a da tela; no teste de referência o real ficou 12 a 14 ms acima')),
      sec('Rede', row('RTT ao servidor', x.rtt, ' ms', 'm'), row('Jitter', x.jitter, ' ms', 'm'), row('Perda', x.loss, '%', 'm'), row('Transporte', x.via, '', 'm')),
      sec('Quem transmite', row('Caminho', hI.path === 'nativo' ? 'Programa nativo' : hI.path === 'chromium' ? 'Chromium' : null, '', 'a'), row('FPS capturados', hI.fpsCap, '', 'a'), row('FPS enviados', hI.fpsOut, '', 'a'),
        row('Codificação', hI.encMs, ' ms', 'a'), row('Codificador', hI.encoder, '', 'a'), row('RTT dele ao servidor', hI.rtt, ' ms', 'a'),
        x.cmdRtt == null ? h('p.pf-empty', 'Os números de quem transmite chegam pelo eco de comando: só enquanto você joga.') : null));
  }
}
async function tick() {
  if (!panel?.isConnected) return stop();
  const now = performance.now();
  for (const s of sessionsForPing()) sendPing(s.id);
  const x = target === S.me.id ? await hostSample(now) : await viewerSample(target, now);
  x.at = Date.now(); samples.push(x); if (samples.length > KEEP) samples.shift();
  render(x);
}
function stop() { clearInterval(timer); timer = 0; panel?.remove(); panel = null; target = null; samples = []; prev.clear(); rvfc = null; }
export const perfOpen = (uid) => !!panel && target === uid;
export function openPerf(uid) {
  if (panel && target === uid) return stop();
  stop(); target = uid;
  const title = uid === S.me.id ? 'Desempenho · sua transmissão' : `Desempenho · transmissão de ${nm(uid)}`;
  panel = h('div#perfpanel', { role: 'dialog', 'aria-label': title },
    h('div.pf-head', icon('gauge', 16), h('b', title), h('button.ibtn', { title: 'Fechar', 'aria-label': 'Fechar', onclick: stop }, icon('x', 16))),
    h('div.pf-body', h('p.pf-empty', 'Medindo…')),
    h('div.pf-foot', h('small', 'medido · estimado · anfitrião: passe o mouse para ver de onde vem cada número'),
      h('button.btn.sm.grey', { onclick: copyText }, 'Copiar'), h('button.btn.sm.grey', { onclick: exportJson }, 'Exportar')));
  document.body.append(panel);
  tick(); timer = setInterval(tick, 1000);
}
const summary = () => {
  const keys = ['cmdRtt', 'fpsIn', 'fpsDec', 'fpsShown', 'decMs', 'jbMs', 'rtt', 'jitter', 'loss', 'kbps', 'glassEst', 'fpsCap', 'fpsOut', 'encMs'];
  const o = {}; for (const k of keys) { const v = samples.map(s => s[k]).filter(x => x != null && Number.isFinite(x)); if (v.length) o[k] = { media: r1(v.reduce((a, b) => a + b, 0) / v.length), p50: r1(pct(v, .5)), p95: r1(pct(v, .95)), n: v.length }; }
  return o;
};
const LABELS = { cmdRtt: 'Comando, ida e volta (ms, medido)', fpsIn: 'FPS recebidos', fpsDec: 'FPS decodificados', fpsShown: 'FPS exibidos', decMs: 'Decodificação (ms)', jbMs: 'Buffer de jitter (ms)', rtt: 'RTT ao servidor (ms)', jitter: 'Jitter (ms)', loss: 'Perda (%)', kbps: 'Bitrate (kbps)', glassEst: 'Captura → exibição, mínimo (ms, estimado)', fpsCap: 'FPS capturados', fpsOut: 'FPS enviados', encMs: 'Codificação (ms)' };
function copyText() {
  const last = samples.at(-1) || {}, sm = summary();
  const lines = [`Resenha · ${panel?.querySelector('.pf-head b')?.textContent} · ${new Date().toLocaleString()}`, `${samples.length} s de amostras (média · p50 · p95)`,
    ...Object.entries(sm).map(([k, v]) => `${LABELS[k] || k}: ${v.media} · ${v.p50} · ${v.p95}`),
    `caminho/codec: ${last.path || last.hostInfo?.path || '—'} · ${last.codec || last.encoder || '—'} · ${last.w || '—'}×${last.h || '—'} · ${last.via || '—'}`];
  navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('Métricas copiadas'), () => toast('Não consegui copiar', true));
}
function exportJson() {
  const data = { app: 'Resenha', painel: panel?.querySelector('.pf-head b')?.textContent, quando: new Date().toISOString(), resumo: summary(), amostras: samples, legenda: { medido: TAG.m[1], estimado: TAG.e[1], anfitriao: TAG.a[1] } };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: `resenha-desempenho-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
export const perfSamples = () => samples.slice(); // testes
