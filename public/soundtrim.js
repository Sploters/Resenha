// Cortar áudio para o soundboard: o arquivo é lido aqui mesmo (mesmo que passe de 15 s ou de 2 MB), a pessoa escolhe o
// trecho numa forma de onda com duas alças (no máximo 15 s; arrastar o meio move a janela inteira) e o trecho vira um WAV
// mono de 44,1 kHz (15 s ≈ 1,3 MB, cabe no limite de 2 MB). Se o arquivo já serve inteiro, sobe o original, sem recodificar.
import { h, icon, whenGone } from './util.js';
import { modal, toast } from './state.js';

const RATE = 44100, MIN_MS = 300, FADE_S = 0.008; // fade curtinho nas pontas: corte no meio da onda dá estalo
export const MAX_FILE = 60 * 1024 * 1024; // só para ler aqui; o que sobe é o trecho

const fmt = (ms) => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

export async function decodeAudio(file) {
  const ctx = new OfflineAudioContext(1, 1, RATE); // decodifica já reamostrado para 44,1 kHz
  return ctx.decodeAudioData(await file.arrayBuffer());
}

// trecho [a, b) em segundos → WAV mono 16 bits
function toWav(buf, a, b) {
  const s0 = Math.floor(a * buf.sampleRate), n = Math.max(1, Math.floor(b * buf.sampleRate) - s0);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const fade = Math.min(Math.floor(FADE_S * buf.sampleRate), n >> 2);
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (p, s) => { for (let i = 0; i < s.length; i++) out.setUint8(p + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    let v = 0; for (const c of chans) v += c[s0 + i] || 0; v /= chans.length;
    if (i < fade) v *= i / fade; else if (i >= n - fade) v *= (n - 1 - i) / fade;
    out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

// forma de onda: pico por coluna, desenhada no tamanho real do canvas
function drawWave(cv, buf) {
  const w = cv.width = Math.max(1, cv.clientWidth * devicePixelRatio), hh = cv.height = Math.max(1, cv.clientHeight * devicePixelRatio);
  const g = cv.getContext('2d'), data = buf.getChannelData(0), step = Math.max(1, Math.floor(data.length / w));
  g.clearRect(0, 0, w, hh); g.fillStyle = getComputedStyle(cv).color;
  for (let x = 0; x < w; x++) {
    let pk = 0; const from = x * step; for (let i = from; i < from + step && i < data.length; i += 4) { const v = Math.abs(data[i]); if (v > pk) pk = v; }
    const bh = Math.max(1, pk * hh * 0.92); g.fillRect(x, (hh - bh) / 2, 1, bh);
  }
}

/**
 * Abre o editor. Resolve com { blob, secs, name, whole } (whole: o arquivo original serve como está) ou null se cancelar.
 * maxSecs: tamanho máximo do trecho; maxBytes: se o original couber inteiro (e for curto) sobe sem recodificar.
 */
export function trimAudio(file, buf, { maxSecs = 15, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const dur = Math.round(buf.duration * 1000), maxMs = maxSecs * 1000;
    let a = 0, b = Math.min(dur, maxMs), settled = false, done = false;
    const finish = (v) => { if (settled) return; settled = true; stop(); done = true; resolve(v); };

    const cv = h('canvas.atwave');
    const sel = h('div.trsel'), head = h('div.trhead', { style: { display: 'none' } });
    const hs = h('div.trhandle.s', { title: 'Início (arraste)' }), he = h('div.trhandle.e', { title: 'Fim (arraste)' });
    const track = h('div.trtrack.attrack', cv, sel, head, hs, he);
    const lab = h('div.trlab'), note = h('div.qinfo');
    const play = h('button.btn.grey.trplay', { type: 'button', onclick: () => toggle() }, icon('play', 16), 'Ouvir trecho');

    const pos = (ms) => (dur ? (ms / dur) * 100 : 0) + '%';
    const paint = () => {
      hs.style.left = pos(a); he.style.left = pos(b); sel.style.left = pos(a); sel.style.width = ((b - a) / dur) * 100 + '%';
      lab.replaceChildren(h('span', 'Início ', h('b', fmt(a))), h('span', 'Fim ', h('b', fmt(b))), h('span', 'Trecho ', h('b', ((b - a) / 1000).toFixed(1) + ' s')), h('span', 'Arquivo ', h('b', fmt(dur))));
      note.textContent = dur > maxMs ? `O áudio tem ${Math.round(dur / 1000)} s: escolha até ${maxSecs} s. Arraste as alças, ou o meio do trecho para movê-lo.`
        : 'Arraste as alças para tirar o silêncio ou o que não quiser.';
    };

    // prévia: toca o trecho e repete; a cabeça de leitura acompanha
    let actx = null, srcNode = null, t0 = 0, raf = 0;
    const stop = () => {
      cancelAnimationFrame(raf); head.style.display = 'none';
      if (srcNode) { srcNode.onended = null; try { srcNode.stop(); } catch { } srcNode = null; }
      play.replaceChildren(icon('play', 16), 'Ouvir trecho');
    };
    const tick = () => {
      if (!srcNode) return;
      const ms = a + (actx.currentTime - t0) * 1000;
      head.style.left = pos(Math.min(ms, b)); raf = requestAnimationFrame(tick);
    };
    const start = () => {
      stop();
      actx ||= new AudioContext(); actx.resume?.();
      srcNode = actx.createBufferSource(); srcNode.buffer = buf; srcNode.connect(actx.destination);
      srcNode.onended = () => { if (srcNode && !done) start(); };
      t0 = actx.currentTime; srcNode.start(0, a / 1000, (b - a) / 1000);
      head.style.display = ''; play.replaceChildren(icon('pause', 16), 'Parar'); tick();
    };
    const toggle = () => (srcNode ? stop() : start());

    // arrastar: alça muda uma ponta (a outra acompanha se passar de maxSecs); o meio move a janela inteira
    const msAt = (e) => { const r = track.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur); };
    const drag = (which, e, jump) => {
      e.preventDefault(); e.stopPropagation();
      const wasPlaying = !!srcNode; stop();
      const grab = msAt(e), a0 = a, b0 = b;
      const move = (ev) => {
        const t = msAt(ev);
        if (which === 'm') { const len = b0 - a0; a = Math.max(0, Math.min(dur - len, a0 + t - grab)); b = a + len; }
        else if (which === 's') { a = Math.max(0, Math.min(t, b - MIN_MS)); if (b - a > maxMs) b = a + maxMs; }
        else { b = Math.min(dur, Math.max(t, a + MIN_MS)); if (b - a > maxMs) a = b - maxMs; }
        paint();
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (wasPlaying || which !== 'm') start(); };
      if (jump) move(e);
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    hs.addEventListener('pointerdown', (e) => drag('s', e)); he.addEventListener('pointerdown', (e) => drag('e', e));
    track.addEventListener('pointerdown', (e) => {
      const t = msAt(e);
      if (t > a && t < b && (b - a) < dur) return drag('m', e); // dentro do trecho: move
      drag(Math.abs(t - a) < Math.abs(t - b) ? 's' : 'e', e, true);
    });
    const keys = (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); toggle(); } };
    addEventListener('keydown', keys);

    const body = h('div.trimmer.atrim', track, lab, h('div.trrow', play, h('small.mut', 'Espaço: ouvir/parar')), note);
    const m = modal('Cortar áudio', file.name, body, [
      { label: 'Cancelar', cls: 'link', fn: () => finish(null) },
      { label: 'Usar trecho', cls: 'green', fn: () => {
        const whole = a <= 0 && b >= dur && dur <= maxMs && file.size <= maxBytes;
        const blob = whole ? file : toWav(buf, a / 1000, b / 1000);
        if (blob.size > maxBytes) { toast('O trecho ficou grande demais (máx. 2 MB)', true); return false; }
        finish({ blob, secs: (b - a) / 1000, whole, name: file.name.replace(/\.[^.]+$/, '') });
      } }], { width: '640px', sticky: true });
    whenGone(m.el, () => { removeEventListener('keydown', keys); finish(null); actx?.close?.(); });
    paint();
    requestAnimationFrame(() => drawWave(cv, buf));
  });
}
