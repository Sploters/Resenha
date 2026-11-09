// Envio de arquivos do compositor.
// - Até 8 MB: um envio só (POST /api/upload), como sempre.
// - Maior: em pedaços de 8 MB (server/uploads.js). Se a internet cair (4G, troca de Wi-Fi, celular bloqueado), espera
//   voltar, pergunta ao servidor quanto já chegou e continua dali, sem recomeçar. Mostra o progresso.
// - Vídeo maior que o limite do servidor: é comprimido no próprio aparelho antes (compressVideo, por WebCodecs, com o
//   Mediabunny carregado só nessa hora) para caber no limite, em vez do aviso "arquivo muito grande".
import { S, api } from './state.js';

const SMALL = 8 * 1024 * 1024;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const online = () => navigator.onLine !== false ? Promise.resolve() : new Promise(r => addEventListener('online', r, { once: true }));
let limitP = null;
// limite do servidor (bytes); o servidor antigo não informa: 100 MB (padrão do MAX_UPLOAD_MB)
export const maxUpload = () => (limitP ||= fetch('/api/server-info').then(r => r.json()).then(j => +j.max_upload || 100 * 1048576, () => 100 * 1048576));
export const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name);

// XHR (e não fetch) para ter o progresso dentro do pedaço; erro de rede = rejeita (o laço espera a conexão voltar)
function put(url, body, onBytes, signal) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', '/api' + url); x.setRequestHeader('Authorization', 'Bearer ' + (S.token || '')); x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { } resolve({ status: x.status, ...j }); };
    x.onerror = x.ontimeout = () => reject(new Error('rede'));
    x.onabort = () => reject(new Error('Envio cancelado'));
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send(body);
  });
}

// opts: { onProgress(fração), signal }
export async function uploadFile(file, opts = {}) {
  const onProgress = opts.onProgress || (() => { });
  if (file.size <= SMALL) { const r = await api('POST', `/upload?name=${encodeURIComponent(file.name)}`, file); onProgress(1); return r; }
  const start = await api('POST', '/uploads', { name: file.name, size: file.size, type: file.type });
  const id = start.id, chunk = start.chunk || SMALL;
  let off = 0, wait = 1000;
  try {
    while (off < file.size) {
      if (opts.signal?.aborted) throw new Error('Envio cancelado');
      let r;
      onProgress(off / file.size);
      try { const o = off; r = await put(`/uploads/${id}?offset=${off}`, file.slice(off, Math.min(file.size, off + chunk)), (n) => onProgress(Math.min(1, (o + n) / file.size)), opts.signal); }
      catch (e) { // sem conexão: espera voltar e pergunta quanto já chegou
        if (opts.signal?.aborted) throw e;
        opts.onWait?.(true); await online(); await sleep(wait); wait = Math.min(wait * 2, 15000);
        try { off = (await api('GET', `/uploads/${id}`)).received; } catch (e) { if (e.status === 404) throw new Error('O envio expirou. Tente de novo.'); }
        continue;
      }
      if (r.status === 200) { off = r.received; wait = 1000; opts.onWait?.(false); onProgress(off / file.size); continue; }
      if (r.status === 409 && Number.isFinite(r.received)) { off = r.received; await sleep(300); continue; } // pedaço repetido/fora de ordem: segue do que o servidor tem
      if (r.status >= 500 || r.status === 0) { await sleep(wait); wait = Math.min(wait * 2, 15000); continue; }
      throw new Error(r.error || 'Falha no envio');
    }
    return await api('POST', `/uploads/${id}/finish`);
  } catch (e) { api('DELETE', `/uploads/${id}`).catch(() => { }); throw e; }
}

// ---------- compressão de vídeo no aparelho ----------
// Calcula a taxa para caber em ~90% do limite (pela duração), escolhe a resolução pela taxa (1080p/720p/480p/360p, lado
// menor, em pé ou deitado) e no máximo 30 fps. H.264 + AAC quando o aparelho codifica (toca em todo lugar); senão VP9/Opus.
// Se ainda passar do limite, tenta mais uma vez com 70% da taxa. onProgress(fração).
export const canCompress = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
export async function compressVideo(file, maxBytes, onProgress = () => { }) {
  if (!canCompress()) throw new Error('este aparelho não consegue comprimir vídeo');
  const MB = await import('/vendor/mediabunny/mediabunny.js');
  const run = async (factor) => {
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack(); if (!vt) throw new Error('vídeo sem imagem');
    const dur = await input.computeDuration(); if (!(dur > 0)) throw new Error('duração desconhecida');
    const audioBps = 96000, vbps = Math.max(200e3, Math.floor((maxBytes * 0.9 * 8 / dur - audioBps) * factor));
    const short = vbps > 4e6 ? 1080 : vbps > 1.6e6 ? 720 : vbps > 700e3 ? 480 : 360;
    const dw = vt.displayWidth, dh = vt.displayHeight, k = Math.min(1, short / Math.min(dw, dh));
    const size = dw >= dh ? { height: Math.round(dh * k / 2) * 2 } : { width: Math.round(dw * k / 2) * 2 };
    const vcodec = await MB.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width: Math.round(dw * k), height: Math.round(dh * k), bitrate: vbps });
    if (!vcodec) throw new Error('nenhum codificador de vídeo disponível');
    const fmt = vcodec === 'avc' ? new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) : new MB.WebMOutputFormat();
    const acodec = await MB.getFirstEncodableAudioCodec(vcodec === 'avc' ? ['aac', 'opus'] : ['opus', 'vorbis'], { bitrate: audioBps });
    const output = new MB.Output({ format: fmt, target: new MB.BufferTarget() });
    const fps = await vt.computePacketStats(120).then(x => x.averagePacketRate, () => 0);
    const conv = await MB.Conversion.init({ input, output, video: { ...size, codec: vcodec, bitrate: vbps, ...(fps > 31 ? { frameRate: 30 } : {}) }, audio: acodec ? { codec: acodec, bitrate: audioBps } : { discard: true } });
    if (!conv.isValid) throw new Error('formato não suportado');
    conv.onProgress = (p) => onProgress(Math.min(1, p));
    await conv.execute();
    const ext = vcodec === 'avc' ? 'mp4' : 'webm';
    return new File([output.target.buffer], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: 'video/' + ext, lastModified: file.lastModified });
  };
  let out = await run(1);
  if (out.size > maxBytes) out = await run(0.7);
  if (out.size > maxBytes) throw new Error('mesmo comprimido o vídeo passa do limite (é longo demais)');
  return out;
}
