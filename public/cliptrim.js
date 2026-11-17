// Cortar clipe: escolhe o trecho numa linha do tempo (miniaturas + duas alças) e corta o WebM.
// O corte é exato nas duas pontas: se o início cai num quadro-chave, só recorta (instantâneo, sem perda); se não cai, o
// trecho é recodificado começando no ponto marcado (cliprecode.js). Antes o início voltava até ~1 s para o quadro-chave
// anterior e o vídeo começava antes do que foi escolhido.
import { h, icon, whenGone } from './util.js';
import { modal, toast } from './state.js';
import { trimWebm, keyframeTimes } from './webm.js';
import { exactTrim } from './cliprecode.js';

const fmt = (ms) => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
// volume do editor: o mesmo lembrado pelo player de vídeo do app
const vPref = { get: (k, d) => { try { const x = localStorage.getItem('lc_v_' + k); return x == null ? d : JSON.parse(x); } catch { return d; } }, set: (k, x) => { try { localStorage.setItem('lc_v_' + k, JSON.stringify(x)); } catch { } } };
const SNAP_OK = 40; // ms: início a até isso de um quadro-chave = recorte direto (a diferença não se vê)

// miniaturas da linha do tempo: um vídeo escondido vai pulando pelo arquivo e desenha cada quadro
async function filmstrip(url, durMs, n, box) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
  try { await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; setTimeout(no, 8000); }); } catch { return; }
  for (let i = 0; i < n; i++) {
    if (!box.isConnected) break;
    try { v.currentTime = (durMs / 1000) * (i + 0.5) / n; await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 1500); }); } catch { break; }
    const c = h('canvas', { width: 128, height: 72 }); try { c.getContext('2d').drawImage(v, 0, 0, 128, 72); } catch { }
    box.children[i]?.replaceWith(c);
  }
  v.removeAttribute('src'); v.load();
}

/**
 * Abre o editor. src: Uint8Array do WebM (clipe no aparelho), ou um clipe que já está no servidor:
 * { url, keys: () => Promise<[ms]>, strip: (durS) => url da faixa de miniaturas, download: () => Promise<Uint8Array>,
 *   serverCut: async ({ startMs, endMs, title }) => bool } — o vídeo toca do servidor (abre na hora); ao salvar, se o início
 *   cai num quadro-chave o próprio servidor recorta (sem baixar nada); se não, baixa e corta no ponto exato aqui.
 * opts: { heading, title, action, onSave(resultado), secondary: { label, fn(resultado) } }
 * resultado: { blob, secs, title, startMs, endMs, whole }. onSave/fn devolvem false para manter o editor aberto.
 */
export function openTrimmer(src, opts = {}) {
  const local = src instanceof Uint8Array; let bytes = local ? src : null;
  const url = local ? URL.createObjectURL(new Blob([src], { type: 'video/webm' })) : src.url;
  const video = h('video.trvid', { src: url, playsInline: true, preload: local ? 'auto' : 'metadata' });
  video.volume = vPref.get('vol', 1); video.muted = vPref.get('muted', false);
  const strip = h('div.trstrip', Array.from({ length: 10 }, () => h('i')));
  const sel = h('div.trsel'), head = h('div.trhead');
  const hs = h('div.trhandle.s', { title: 'Início (arraste)' }), he = h('div.trhandle.e', { title: 'Fim (arraste)' });
  const track = h('div.trtrack', strip, sel, head, hs, he);
  const lab = h('div.trlab'), note = h('div.qinfo');
  const title = h('input', { name: 'clip-title', maxLength: 100, value: opts.title || '' });
  const play = h('button.btn.grey.trplay', { type: 'button', onclick: () => toggle() }, icon('play', 16), 'Assistir trecho');
  // volume: mudo + barra (lembrados)
  const volIco = () => icon(video.muted || video.volume === 0 ? 'volmute' : 'vol', 18);
  const muteBtn = h('button.ibtn.trmute', { type: 'button', title: 'Silenciar (M)', 'aria-label': 'Silenciar', onclick: () => setVol(video.volume || 1, !video.muted) }, volIco());
  const volRange = h('input.trvol', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((video.muted ? 0 : video.volume) * 100), 'aria-label': 'Volume', title: 'Volume',
    oninput: (e) => { const v = +e.target.value / 100; setVol(v, v === 0); } });
  const setVol = (v, muted) => {
    video.volume = Math.max(0, Math.min(1, v)); video.muted = muted;
    if (!muted) vPref.set('vol', video.volume); vPref.set('muted', muted);
    volRange.value = String(Math.round((muted ? 0 : video.volume) * 100)); muteBtn.replaceChildren(volIco());
  };
  let dur = 0, a = 0, b = 0, snapped = 0, busy = false;
  let keysAt = local ? keyframeTimes(bytes) : []; // calculado uma vez: arrastar não relê o arquivo
  let status = '', failed = false;

  // uma busca de cada vez: várias seguidas antes da anterior terminar (arrastar a alça, clicar na faixa) deixavam o player
  // do Chromium preso em "buscando" e a prévia não tocava mais. A última pedida vale.
  let seekWant = null;
  const seekTo = (s) => { if (video.seeking) { seekWant = s; return; } video.currentTime = s; };
  video.addEventListener('seeked', () => { if (seekWant == null) return; const s = seekWant; seekWant = null; if (Math.abs(video.currentTime - s) > 0.0005) video.currentTime = s; });
  const pos = (ms) => (dur ? (ms / dur) * 100 : 0) + '%';
  const exact = () => Math.abs(a - snapped) <= SNAP_OK || (a <= 0 && b >= dur); // o recorte direto já começa no ponto certo
  const paint = () => {
    hs.style.left = pos(a); he.style.left = pos(b); sel.style.left = pos(a); sel.style.width = dur ? ((b - a) / dur) * 100 + '%' : '0';
    snapped = keysAt.filter(t => t <= a).pop() ?? keysAt[0] ?? a; // quadro-chave anterior (onde um recorte direto começaria)
    lab.replaceChildren(h('span', 'Início ', h('b', fmt(a))), h('span', 'Fim ', h('b', fmt(b))), h('span', 'Duração ', h('b', ((b - a) / 1000).toFixed(1) + ' s')));
    note.textContent = status || (exact() ? 'O corte não recomprime o vídeo: é instantâneo e sem perda de qualidade.'
      : 'O início não cai num quadro-chave: ao salvar, o trecho é recodificado para começar exatamente aí (leva alguns segundos).');
    note.classList.toggle('err', failed);
  };
  // assistir/pausar: pausar mantém o ponto; continuar segue de onde parou. Fora do trecho (ou no fim), recomeça do início dele
  const toggle = () => {
    if (!video.paused) { video.pause(); return; }
    const t = (seekWant ?? video.currentTime) * 1000;
    if (t < a - 1 || t >= b - 30) seekTo(a / 1000);
    video.play().catch(() => { });
  };
  video.addEventListener('play', () => play.replaceChildren(icon('pause', 16), 'Pausar'));
  video.addEventListener('pause', () => play.replaceChildren(icon('play', 16), 'Assistir trecho'));
  // fim do trecho: confere a cada quadro (o timeupdate chega só a cada ~250 ms e o vídeo passava do fim) e repete o trecho
  const atEnd = (ms) => { if (!video.paused && ms >= b) seekTo(a / 1000); };
  const frameLoop = () => { if (done) return; video.requestVideoFrameCallback?.((_, m) => { atEnd(m.mediaTime * 1000); head.style.left = pos(m.mediaTime * 1000); frameLoop(); }); };
  // fim marcado = fim do arquivo: o vídeo termina antes de algum quadro chegar a `b`; repete do início do trecho também
  video.addEventListener('ended', () => { if (!done && !busy) { seekTo(a / 1000); video.play().catch(() => { }); } });
  video.addEventListener('timeupdate', () => { head.style.left = pos(video.currentTime * 1000); atEnd(video.currentTime * 1000); });
  // arrastar as alças (ou clicar na faixa: move a alça mais próxima)
  const msAt = (e) => { const r = track.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur); };
  const drag = (which, jump) => (e) => {
    if (busy) return;
    e.preventDefault(); e.stopPropagation(); track.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const t = msAt(ev);
      if (which === 's') a = Math.min(t, b - 500); else b = Math.max(t, a + 500);
      a = Math.max(0, a); b = Math.min(dur, b);
      video.pause(); seekTo((which === 's' ? a : b) / 1000); paint();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    if (jump) move(e); // clique na faixa: a alça vai para onde clicou
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  hs.addEventListener('pointerdown', drag('s')); he.addEventListener('pointerdown', drag('e'));
  track.addEventListener('pointerdown', (e) => { const t = msAt(e); drag(Math.abs(t - a) < Math.abs(t - b) ? 's' : 'e', true)(e); });

  video.addEventListener('loadedmetadata', () => {
    dur = Math.round((isFinite(video.duration) ? video.duration : 0) * 1000);
    if (!dur) { lab.textContent = 'Não consegui ler a duração deste vídeo.'; return; }
    a = 0; b = dur; paint();
    if (local) filmstrip(url, dur, 10, strip);
    // faixa pronta do servidor (uma imagem). loading 'eager': h() cria imagens com loading=lazy, e uma imagem preguiçosa fora da
    // página nunca carrega (esta só entra na página no onload)
    else { const img = h('img.trsprite', { src: src.strip(dur / 1000), alt: '', loading: 'eager', onload: () => strip.replaceChildren(img) }); }
  });
  if (!local) src.keys().then((k) => { keysAt = k || []; paint(); }).catch(() => { });
  paint();
  // atalhos: espaço = assistir/pausar, I/O = marcar início/fim onde o vídeo está, M = silenciar
  const keys = (e) => {
    if (e.target.tagName === 'INPUT' && e.target !== volRange) return;
    if (busy) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.key === 'i' || e.key === 'I') { a = Math.max(0, Math.min(Math.round(video.currentTime * 1000), b - 500)); paint(); }
    if (e.key === 'o' || e.key === 'O') { b = Math.min(dur, Math.max(Math.round(video.currentTime * 1000), a + 500)); paint(); }
    if (e.key === 'm' || e.key === 'M') setVol(video.volume || 1, !video.muted);
  };
  addEventListener('keydown', keys);
  let done = false;
  const cleanup = () => { done = true; removeEventListener('keydown', keys); video.pause(); video.removeAttribute('src'); video.load(); if (local) URL.revokeObjectURL(url); };
  const body = h('div.trimmer', video, track, lab,
    h('div.trrow', play, h('div.trvolbox', muteBtn, volRange), h('small.mut', 'Espaço: assistir/pausar · I / O: marcar início / fim no ponto atual · M: som')), note, h('label.f', 'Título', title));
  frameLoop();
  // corta e entrega o resultado; o trecho inteiro não é recortado de novo (mantém o arquivo como está)
  const result = async () => {
    const t = title.value.trim();
    if (!bytes) { // clipe do servidor: baixa só agora, para cortar no ponto exato
      status = 'Baixando o clipe para cortar no ponto exato…'; failed = false; paint();
      try { bytes = await src.download(); } finally { status = ''; paint(); }
    }
    if (a <= 0 && b >= dur) return { blob: new Blob([bytes], { type: 'video/webm' }), secs: Math.max(1, Math.round(dur / 1000)), title: t, startMs: 0, endMs: dur, whole: true };
    let r = null;
    if (!exact()) {
      status = 'Recortando no ponto exato… 0%'; failed = false; paint();
      try { r = await exactTrim(bytes, a, b, (p) => { status = `Recortando no ponto exato… ${Math.round(p * 100)}%`; paint(); }); }
      catch (e) { console.warn('corte exato falhou, usando o recorte no quadro-chave', e); toast(`Não deu para cortar no ponto exato (${e.message}); o início ficou no quadro-chave anterior, ${((a - snapped) / 1000).toFixed(1)} s antes.`, true); }
      status = ''; paint();
    }
    r ||= trimWebm(bytes, a, b);
    return r && { blob: new Blob([r.bytes], { type: 'video/webm' }), secs: Math.max(1, Math.round((r.endMs - r.startMs) / 1000)), title: t, startMs: r.startMs, endMs: r.endMs };
  };
  const run = (cb) => async () => {
    if (busy) return false;
    busy = true; video.pause();
    const btns = [...(m?.el?.querySelectorAll('button') || [])]; btns.forEach(x => { x.disabled = true; });
    try {
      if (!local && exact()) { // o servidor recorta o arquivo que já tem: sem download e sem upload
        const ok = await src.serverCut({ startMs: a, endMs: b, title: title.value.trim() });
        if (ok === false) return false;
        cleanup(); return;
      }
      const r = await result();
      if (!r) { toast('Não consegui cortar este vídeo', true); return false; }
      const ok = await cb?.(r);
      if (ok === false) return false;
      cleanup();
    } catch (e) { toast('Não consegui cortar: ' + (e?.message || e), true); return false;
    } finally { busy = false; btns.forEach(x => { x.disabled = false; }); }
  };
  // opts.secondary: { label, fn(resultado) } — segundo botão (ex.: "Salvar" no aparelho ao lado de "Compartilhar")
  const m = modal(opts.heading || 'Cortar clipe', 'Arraste as alças para escolher o trecho.', body, [
    { label: 'Cancelar', cls: 'link', fn: () => { if (busy) return false; cleanup(); } },
    opts.secondary && { label: opts.secondary.label, cls: 'grey', fn: run(opts.secondary.fn) },
    { label: opts.action || 'Postar clipe', cls: 'green', fn: run(opts.onSave) }].filter(Boolean), { width: '760px', sticky: true });
  whenGone(m.el, () => { if (!done) cleanup(); }); // fechou pelo Esc/fora: solta o vídeo
  setTimeout(() => { if (document.activeElement === title) title.blur(); }, 0); // o modal foca o título; os atalhos (espaço, I, O) valem fora dele
  return m;
}
