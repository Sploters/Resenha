// Mede quanto de um clipe a pessoa realmente assistiu, para as visualizações qualificadas e a retenção (server/clipstats.js).
// Só conta tempo com o vídeo tocando, a aba visível e avançando normalmente: pular (seek) não conta como assistido, e voltar
// ao início num loop não soma cobertura nova (o clipe é dividido em pedaços de 0,5 s; cada um conta uma vez).
// Manda uma batida a cada 5 s e outra ao trocar de clipe ou fechar o player (keepalive: chega mesmo fechando a aba).
// O servidor não confia nos números: limita pelo relógio da sessão, pela duração e por pessoa.
import { S, api, tabId } from './state.js';

const PIECE = 0.5, BEAT_MS = 5000;
export function trackWatch(v, clipId, { onBeat } = {}) {
  let sid = null, watched = 0, lastT = null, dirty = false, done = false;
  const seen = new Set();
  api('POST', `/clips/${encodeURIComponent(clipId)}/view`).then(r => { sid = r?.session || null; }).catch(() => { });
  const onTime = () => {
    const t = v.currentTime;
    if (lastT != null && !v.paused && !v.seeking && !document.hidden) {
      const d = t - lastT;
      if (d > 0 && d < 1.5) { // pulo para frente (seek) ou volta (loop) não é tempo assistido
        watched += d; // tempo de vídeo tocado (a 2× conta o dobro; o servidor aceita até 2× o relógio)
        for (let p = Math.floor(lastT / PIECE); p < Math.ceil(t / PIECE); p++) seen.add(p);
        dirty = true;
      }
    }
    lastT = t;
  };
  const reset = () => { lastT = null; };
  const covered = () => Math.round(Math.min(seen.size * PIECE, Number.isFinite(v.duration) ? v.duration : Infinity) * 1000);
  const send = (keepalive = false) => {
    if (!sid || !dirty) return; dirty = false;
    const body = JSON.stringify({ session: sid, watched_ms: Math.round(watched * 1000), covered_ms: covered() });
    fetch(`/api/clips/${encodeURIComponent(clipId)}/watch`, { method: 'POST', keepalive, headers: { Authorization: 'Bearer ' + (S.token || ''), 'X-LC-Tab': tabId, 'Content-Type': 'application/json' }, body })
      .then(r => r.json()).then(r => onBeat?.(r)).catch(() => { });
  };
  v.addEventListener('timeupdate', onTime); v.addEventListener('seeking', reset); v.addEventListener('emptied', reset);
  const timer = setInterval(() => { if (!v.paused) send(); }, BEAT_MS);
  const hide = () => { if (document.hidden) send(true); }; document.addEventListener('visibilitychange', hide);
  return () => {
    if (done) return; done = true;
    clearInterval(timer); document.removeEventListener('visibilitychange', hide);
    v.removeEventListener('timeupdate', onTime); v.removeEventListener('seeking', reset); v.removeEventListener('emptied', reset);
    send(true);
  };
}
