// Clipes de transmissão: buffer circular por transmissão e o corte dos últimos 15 s a 2 min. Como no Discord, o clipe fica
// guardado só neste aparelho (cliplocal.js) até a pessoa compartilhar; quem preferir pode postar direto no chat da sala.
import { h } from './util.js';
import { S, api, toast } from './state.js';
import { addLocalClip } from './cliplocal.js';
import { createBuffer, createMixer, createNativeBuffer, createTapBuffer } from './clipbuf.js';
import { openTrimmer } from './cliptrim.js';
import { uploadFile } from './upload.js';

const bufs = new Map(); // chave da transmissão -> buffer
export const clipping = (key) => bufs.has(key);
export const clipLengths = [15, 30, 60, 120];
export const lenLabel = (n) => (n >= 120 ? `${n / 60} min` : `${n}s`);
// tamanho do clipe do atalho e quanto o buffer guarda (o maior entre 60 s e a duração escolhida, mais a folga do quadro-chave)
export const clipSecs = () => (clipLengths.includes(S.prefs.clipSecs) ? S.prefs.clipSecs : 30);
const keepMs = () => Math.max(60, clipSecs()) * 1000 + 5000;
export const maxClipSecs = () => Math.max(60, clipSecs());
// onde o clipe vai: 'local' (padrão, só neste aparelho) ou 'post' (sobe e posta no chat da sala, como antes)
// FPS do clipe: 30, 60 (padrão) ou 0 = o da transmissão (até 120)
export const clipFps = () => ([30, 60, 0].includes(S.prefs.clipFps) ? S.prefs.clipFps : 60);
export const clipDest = () => (S.prefs.clipDest === 'post' ? 'post' : 'local');
export const clipKeys = () => [...bufs.keys()];
// diagnóstico (relatório de problema / testes): quantas fontes de áudio entram no clipe de cada transmissão
export const clipInfo = (key) => { const b = bufs.get(key); return b && { hasAudio: !!b.hasAudio, audioSources: b.mixer?.size ?? (b.hasAudio ? 1 : 0), fps: b.fps, maxFps: b.maxFps, limiter: b.how, bps: b.bps, mime: b.mimeType, native: !!b.native, mode: b.mode, last: b.last || null, error: b.error || null }; };

// audio: fontes de áudio do clipe — o áudio da transmissão e o MICROFONE de quem transmite (só no clipe: na transmissão ao
// vivo a voz continua indo separada, como voz da call). ctx: AudioContext para misturar (sem ele, usa só a primeira fonte).
// De onde vem o vídeo do clipe (o áudio é sempre gravado aqui):
// - opts.native: a sua transmissão está indo pelo programa nativo do app desktop: os quadros que ele já comprimiu
//   (clipbuf.js createNativeBuffer) — sem capturar e comprimir a tela de novo
// - opts.tap (voice.screenTap): a transmissão de outra pessoa: os quadros comprimidos como chegam do servidor
//   (createTapBuffer) — sem recomprimir o vídeo decodificado
// - nenhum dos dois (ou não deu): MediaRecorder grava e comprime o vídeo da tela (createBuffer), como sempre
const vsig = (stream) => stream.getVideoTracks().map(t => t.id).join(',');
export function startBuffer(key, stream, audio = [], ctx = null, opts = {}) {
  const sources = (Array.isArray(audio) ? audio : [audio]).filter(Boolean), cur = bufs.get(key);
  const mode = opts.native ? 'native' : opts.tap ? 'tap' : 'rec';
  const same = cur && cur.mode === mode && cur.keep === keepMs() && (mode === 'native' || mode === 'tap' && cur.tap === opts.tap
    || mode === 'rec' && cur.stream === stream && cur.vsig === vsig(stream) && cur.hw === (S.prefs.clipHw !== false) && cur.maxFps === clipFps());
  // tap que não deu (navegador sem o encaixe, codec diferente): fica no MediaRecorder sem tentar de novo a cada redesenho
  const fellBack = cur && mode === 'tap' && cur.mode === 'rec' && cur.tapFailed === opts.tap && cur.stream === stream && cur.keep === keepMs();
  if (same || fellBack) { cur.stream = stream; cur.mixer?.set(sources); return; } // áudio mudou (microfone trocado, chegou depois): só remistura, sem perder o que já foi gravado
  if (cur) stopBuffer(key);
  const mixer = ctx ? createMixer(ctx) : null;
  mixer?.set(sources);
  const hw = S.prefs.clipHw !== false, audioIn = mixer ? mixer.stream : sources.find(s => s.getAudioTracks().length);
  let b = mode === 'native' ? createNativeBuffer(audioIn, { keep: keepMs() }) : mode === 'tap' ? createTapBuffer(opts.tap, audioIn, { keep: keepMs() }) : null;
  if (b) b.mode = mode;
  else if (mode !== 'native') {
    b = createBuffer(new MediaStream(stream.getVideoTracks()), audioIn, { keep: keepMs(), hw, maxFps: clipFps() });
    if (b) { b.mode = 'rec'; if (mode === 'tap') b.tapFailed = opts.tap; }
  }
  if (!b) { mixer?.stop(); return; }
  Object.assign(b, { stream, vsig: vsig(stream), mixer, hw });
  if (mixer) Object.defineProperty(b, 'hasAudio', { get: () => mixer.had });
  b.onEnd = () => { if (bufs.get(key) === b) { bufs.delete(key); mixer?.stop(); } };
  bufs.set(key, b);
}
export function stopBuffer(key) { const b = bufs.get(key); bufs.delete(key); b?.stop(); b?.mixer?.stop(); }
export const stopAllBuffers = () => [...bufs.keys()].forEach(stopBuffer);
export const pruneBuffers = (live) => [...bufs.keys()].forEach(k => { if (!live.has(k)) stopBuffer(k); });

const p2 = (n) => String(n).padStart(2, '0');
const stampTitle = (who) => { const d = new Date(); return `${who} — ${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
// envia o vídeo e posta no canal (o servidor também guarda na galeria do servidor). Devolve true se deu certo.
export async function postClip(blob, { channelId, secs, streamerId, hasAudio = true, title, who, quiet }) {
  const d = new Date(), name = `clipe-${secs}s-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.webm`;
  const mb = Math.max(1, Math.round(blob.size / 1048576));
  toast(`Enviando clipe (${mb} MB)…`);
  try {
    // em pedaços, com o andamento na tela, continuando de onde parou se a conexão oscilar (um clipe longo passa do limite
    // de 100 MB por pedido do Cloudflare)
    let shown = 0;
    const r = await uploadFile(new File([blob], name, { type: 'video/webm' }), { onProgress: (p) => { const n = Math.floor(p * 4) * 25; if (n > shown && n < 100) { shown = n; toast(`Enviando clipe (${mb} MB)… ${n}%`); } } });
    const t = title || stampTitle(who); // nome padrão distinto (dá para renomear na galeria)
    await api('POST', `/channels/${channelId}/clips`, { url: r.url, name: r.name, size: r.size, secs, streamer_id: streamerId, has_audio: hasAudio, title: t });
    if (!quiet) toast(hasAudio ? 'Clipe postado no chat' : 'Clipe postado, mas sem áudio: esta transmissão não está enviando som.', !hasAudio);
    return true;
  } catch (e) { toast('Falha ao enviar o clipe: ' + e.message, true); return false; }
}

// guarda no aparelho (padrão) ou posta no chat da sala, conforme Configurações → Clipes
// auto: clipe automático (autoclip.js) — sempre fica no aparelho, nunca posta sozinho
async function keepClip(blob, { channelId, secs, streamerId, hasAudio, title, who, game, guildId, auto }) {
  if (clipDest() === 'post' && !auto) return postClip(blob, { channelId, secs, streamerId, hasAudio, title, who });
  try {
    await addLocalClip({ blob, title: title || (auto ? 'Automático: ' : '') + stampTitle(who), secs, streamerId, who, game: game || '', hasAudio, guildId: guildId || null, channelId, ...(auto ? { auto } : {}) });
    // "Mandar para a turma" no próprio aviso: compartilhar sem ir ao + do campo de mensagem
    let sent = false;
    const share = h('button.btn.green.sm', { style: { marginLeft: '10px' }, onclick: () => { if (sent) return; sent = true; document.getElementById('toast')?.remove(); postClip(blob, { channelId, secs, streamerId, hasAudio, title, who }); } }, 'Mandar para a turma');
    toast(h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, auto ? 'Clipe automático salvo neste aparelho.' : hasAudio ? 'Clipe salvo neste aparelho.' : 'Clipe salvo neste aparelho, mas sem áudio.', share), !hasAudio, 8000);
    return true;
  } catch (e) { toast('Não consegui guardar o clipe neste aparelho: ' + (e?.message || 'sem espaço'), true); return false; }
}

// corta os últimos `secs` segundos e guarda (ou posta).
// onCaptured(ok, motivo): chamado logo depois do corte (local, instantâneo), antes de guardar — é a hora do aviso "capturado"
export async function saveClip(key, secs, { channelId, who, game, guildId, onCaptured, auto }) {
  const b = bufs.get(key);
  if (!b) { onCaptured?.(false, 'Os clipes não estão ligados'); return auto ? null : toast('Ative os clipes primeiro.', true); }
  const blob = await b.cut(secs);
  if (!blob) { onCaptured?.(false, 'Ainda não há vídeo suficiente gravado'); return auto ? null : toast('Ainda não há vídeo suficiente gravado. Aguarde alguns segundos.', true); }
  onCaptured?.(true);
  return keepClip(blob, { channelId, secs, streamerId: key.slice(2), hasAudio: !!b.hasAudio, who, game, guildId, auto });
}

// pega o que estiver gravado (até a maior duração) e abre o editor para escolher o trecho antes de guardar/postar
export async function saveClipTrim(key, { channelId, who, game, guildId }) {
  const b = bufs.get(key);
  if (!b) return toast('Ative os clipes primeiro.', true);
  const blob = await b.cut(maxClipSecs());
  if (!blob) return toast('Ainda não há vídeo suficiente gravado. Aguarde alguns segundos.', true);
  const base = { channelId, streamerId: key.slice(2), hasAudio: !!b.hasAudio, who, game, guildId };
  const local = clipDest() === 'local';
  openTrimmer(new Uint8Array(await blob.arrayBuffer()), { title: stampTitle(who), action: local ? 'Salvar no aparelho' : 'Postar clipe',
    secondary: local ? { label: 'Postar no chat da sala', fn: ({ blob: cut, secs, title }) => postClip(cut, { ...base, secs, title }) } : null,
    onSave: ({ blob: cut, secs, title }) => keepClip(cut, { ...base, secs, title }) });
}
