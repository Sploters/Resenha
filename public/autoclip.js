// Clipes automáticos: transmitindo na call (o jogo), quando a call explode (risada, grito, todo mundo junto) a Resenha
// salva o lance sozinha, neste aparelho, como o F8 faria. Ideia do "Auto Clips" do Discord.
// - Vem ligado: transmitir já grava os últimos segundos da sua transmissão (stage.js clipsAuto) para isso funcionar.
//   Configurações → Clipes → "Clipes automáticos" desliga (e "Gravar clipes: Desligado" desliga tudo).
// - Tudo acontece aqui: o volume de cada voz é medido num AudioWorklet (autoclip-worklet.js) e a decisão é do
//   autoclip-core.js. Nada vai para o servidor; o clipe fica no aparelho até a pessoa compartilhar (nunca posta sozinho).
// - No máximo 3 clipes automáticos por transmissão e 1 a cada 90 s. Espera ~5 s depois do pico para pegar o desfecho.
// - Quem desligou "Permitir que minha voz entre em clipes" não entra no clipe nem conta para disparar.
import { S, savePrefs } from './state.js';
import { createDetector, FRAME_MS } from './autoclip-core.js';
import { clipKeys, saveClip, clipSecs } from './clips.js';
import { playSound } from './sounds.js';

export const AUTO_MAX = 3, AUTO_GAP_MS = 90e3, AUTO_AFTER_MS = 5000;
export const autoClipsOn = () => S.prefs.autoClips === true && S.prefs.clipsOn !== false; // desligado por padrão (só liga à mão)
export const setAutoClips = (v) => { S.prefs.autoClips = !!v; savePrefs(); };

let run = null; // { key, ctx, det, nodes: Map<id, {node, src, sink, stream}>, count, lastAt, pend }
let deps = null; // { voice, clipCtx, clipFlash } (stage.js; evita importar o palco aqui)
const repaint = () => queueMicrotask(() => document.dispatchEvent(new Event('voice-rerender'))); // painel de voz: "Clipes auto" e a contagem
const REASON = { laugh: 'Risada na call', shout: 'Grito na call', group: 'A call explodiu' };

export const autoClipActive = () => !!run;
export const autoClipCount = () => run?.count || 0;

// chamado a cada desenho da chamada (stage.js), depois de ligar/desligar os buffers de clipe
export function syncAutoClip(d) {
  deps = d || deps; const voice = deps?.voice;
  const key = S.me && 's:' + S.me.id;
  const want = !!(voice?.active && voice.screen && autoClipsOn() && key && clipKeys().includes(key));
  if (!want) { if (run) stopAutoClip(); return; }
  if (!run || run.key !== key) { stopAutoClip(); start(key, voice); }
  if (run) syncSources(voice);
}

function start(key, voice) {
  const ctx = voice.getCtx?.(); if (!ctx?.audioWorklet) return;
  run = { key, ctx, det: createDetector(), nodes: new Map(), count: 0, lastAt: 0, pend: null, ready: null, t: 0 };
  const r = run;
  r.ready = ctx.audioWorklet.addModule('/autoclip-worklet.js').then(() => { if (run === r) syncSources(voice); }).catch(() => { if (run === r) run = null; });
  voice.sendState?.(); repaint();
}
export function stopAutoClip() {
  const r = run; run = null; if (!r) return;
  clearTimeout(r.pend);
  for (const id of [...r.nodes.keys()]) unhook(r, id);
  deps?.voice?.sendState?.(); repaint();
}

// vozes que contam: a minha (microfone) e a de cada pessoa na sala, menos bots e quem pediu para não entrar em clipes
function sources(voice) {
  const out = new Map();
  if (voice.mic && !S.prefs.clipVoiceOff) out.set('me', voice.mic);
  for (const p of voice.peers?.values() || []) {
    if (voice.isMusicBot?.(p.uid) || S.voice.get(p.uid)?.noclip) continue;
    const st = p.audioEl?.srcObject || p.audioEl?.raw; if (st) out.set(p.uid, st);
  }
  return out;
}
function syncSources(voice) {
  const r = run; if (!r || !r.ready) return;
  r.ready.then(() => {
    if (run !== r) return;
    const want = sources(voice);
    for (const [id, n] of r.nodes) if (want.get(id) !== n.stream) unhook(r, id);
    for (const [id, stream] of want) if (!r.nodes.has(id)) hook(r, id, stream);
  });
}
function hook(r, id, stream) {
  try {
    const node = new AudioWorkletNode(r.ctx, 'autoclip-meter', { numberOfOutputs: 1 }), src = r.ctx.createMediaStreamSource(stream), sink = r.ctx.createGain();
    sink.gain.value = 0; src.connect(node); node.connect(sink).connect(r.ctx.destination); // precisa chegar ao destino para o navegador processar
    node.port.onmessage = (e) => onFrames(r, id, e.data);
    r.nodes.set(id, { node, src, sink, stream });
  } catch { /* fluxo sem áudio: ignora essa voz */ }
}
function unhook(r, id) {
  const n = r.nodes.get(id); r.nodes.delete(id); r.det.drop(id); if (!n) return;
  try { n.node.port.postMessage('stop'); n.src.disconnect(); n.node.disconnect(); n.sink.disconnect(); } catch { }
}

// diagnóstico (relatório de problema / testes): quais vozes estão sendo medidas e quantos quadros chegaram
export const autoClipDebug = () => run && { key: run.key, voices: [...run.nodes.keys()], frames: run.frames || 0, count: run.count, pending: !!run.pend };
export const autoClipFire = (why = 'group') => run && trigger(run, why); // testes: simula a call explodindo

function onFrames(r, id, arr) {
  if (run !== r) return;
  r.frames = (r.frames || 0) + arr.length / 2;
  const now = performance.now();
  for (let i = 0; i < arr.length; i += 2) {
    // hora de cada quadro: os últimos chegam "agora"; cada um tem 20 ms
    const t = now - ((arr.length - i) / 2 - 1) * FRAME_MS;
    const why = r.det.frame(id, arr[i], arr[i + 1], t);
    if (why) { trigger(r, why); break; }
  }
}
function trigger(r, why) {
  r.det.reset();
  const now = Date.now();
  if (r.pend || r.count >= AUTO_MAX || now - r.lastAt < AUTO_GAP_MS) return;
  r.lastAt = now; r.count++;
  // espera o desfecho do lance (a risada depois da jogada) e corta os últimos segundos
  r.pend = setTimeout(() => {
    r.pend = null; if (run !== r || !deps) return;
    const secs = clipSecs(), ctx = deps.clipCtx(r.key);
    saveClip(r.key, secs, { ...ctx, auto: why, onCaptured: (ok) => {
      if (!ok) { r.count--; return; }
      playSound('clip');
      deps.clipFlash(true, 'Clipe automático salvo', `${REASON[why] || 'Lance salvo'} · ${r.count}/${AUTO_MAX}`); repaint();
    } });
  }, AUTO_AFTER_MS);
}
