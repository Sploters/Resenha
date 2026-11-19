// Watch Together: players. Interface comum usada pelo motor de sincronização (public/watch.js):
//   load(item, { pos, play }) · play() · pause() · seek(s) · time() · duration() · state() · buffering()
//   setVolume(0–100) · setMuted(bool) · destroy() — e callbacks onState(estado), onError(código), onEnded(), onDuration(s)
// estado: 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'idle'
// Os eventos do player só servem para relatar e detectar problemas; nunca viram comandos para a sala (anti-eco).
import { h } from './util.js';
import { SERVICES } from './watchsvc.js';

const noop = () => { };
class Base {
  constructor(host, cb = {}) { this.host = host; this.cb = { onState: noop, onError: noop, onEnded: noop, onDuration: noop, onReady: noop, ...cb }; this.st = 'idle'; this.vol = 100; this.muted = false; }
  set(st) { if (st === this.st) return; this.st = st; this.cb.onState(st); }
  state() { return this.st; }
  buffering() { return this.st === 'buffering' || this.st === 'loading'; }
  get controllable() { return true; }
  // ajuste fino pela velocidade (sincronia sem pulos): os players que aceitam sobrescrevem
  get canRate() { return false; }
  setRate() { }
  get seekTol() { return 0.25; }
  // qualidade por pessoa (só o YouTube tem degraus; vídeo direto e serviços externos ficam como estão)
  quality() { return null; }
  qualityFloor() { return 0; }
  setQualityDown() { }
  guardCaptions() { }
}

// ---------- YouTube (IFrame Player API oficial) ----------
// controls=0: os controles são os do Resenha (cliques passam por uma camada por cima do vídeo), e o teclado do iframe
// fica desligado (disablekb) — assim nada que a pessoa faça dentro do iframe vira uma ação "fora" da sala.
let ytApi = null;
export function loadYouTubeApi(timeout = 12000) {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    const t = setTimeout(() => { ytApi = null; reject(new Error('api_blocked')); }, timeout);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); try { prev?.(); } catch { } resolve(window.YT); };
    const s = document.createElement('script'); s.src = window.__wtYtApi || 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { clearTimeout(t); ytApi = null; s.remove(); reject(new Error('api_blocked')); };
    document.head.append(s);
  });
  return ytApi;
}
// qualidades do YouTube, da maior para a menor
export const QUALITIES = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
export const QUALITY_LABEL = { highres: '4K+', hd2880: '5K', hd2160: '4K', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p' };
const YT_ERR = { 2: 'not_found', 5: 'html5', 100: 'not_found', 101: 'embed_blocked', 150: 'embed_blocked', 152: 'embed_blocked', 153: 'api_blocked' };
export class YouTubePlayer extends Base {
  async load(item, { pos = 0, play = false } = {}) {
    this.item = item; this.set('loading');
    let YT; try { YT = await loadYouTubeApi(); } catch { return this.cb.onError('api_blocked'); }
    if (this.dead) return;
    const startAt = Math.floor(pos);
    if (this.p && this.ready) { // mesmo iframe para o próximo vídeo (troca mais rápida, sem recriar)
      this.lastDur = 0;
      const q = this.wantQuality();
      play ? this.p.loadVideoById({ videoId: item.ref, startSeconds: pos, suggestedQuality: q }) : this.p.cueVideoById({ videoId: item.ref, startSeconds: pos, suggestedQuality: q });
      this.qKey = '';
      this.cb.onReady(); // a API já está pronta; o motor volta a sincronizar este vídeo novo
      return;
    }
    const div = h('div.wt-yt'); this.host.replaceChildren(div);
    this.ready = false;
    this.p = new YT.Player(div, {
      videoId: item.ref, width: '100%', height: '100%',
      host: window.__wtYtHost || 'https://www.youtube.com',
      playerVars: { autoplay: play ? 1 : 0, cc_load_policy: this.ccPref ? 1 : 0, vq: this.wantQuality(), hl: (navigator.language || 'pt-BR').split('-')[0], cc_lang_pref: (navigator.language || 'pt-BR').split('-')[0], controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, start: startAt, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { this.ready = true; this.applyVol(); this.applyQuality(); this.applyCaptions(this.ccPref, true); if (Math.abs(pos - startAt) > .3) this.p.seekTo(pos, true); if (play) this.p.playVideo(); this.cb.onReady(); this.dur(); },
        onStateChange: (e) => {
          const m = { '-1': 'loading', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'paused' }[e.data];
          if (m) this.set(m);
          if (e.data === 1) this.dur();
          // o YouTube escolhe a qualidade e liga legendas de novo a cada play/carregamento: reaplica as escolhas da sala
          if (e.data === 1 || e.data === 3 || e.data === -1 || e.data === 5) { this.applyQuality(); if (!this.ccPref) this.captionsOff(); }
          if (e.data === 0) this.cb.onEnded();
        },
        onError: (e) => this.cb.onError(YT_ERR[e.data] || 'html5'),
        onAutoplayBlocked: () => this.cb.onError('autoplay'),
      },
    });
  }
  // legendas: começam desligadas. O YouTube liga sozinho conforme a conta/idioma (mesmo com cc_load_policy=0) e volta
  // a ligar ao dar play, ao trocar de vídeo e quando a janela/o player muda de tamanho (minimizar e voltar). Por isso,
  // desligadas, são desligadas de novo a cada play/carregamento e conferidas periodicamente (guardCaptions, chamado
  // pelo laço do motor). Ligadas: carrega o módulo e escolhe a faixa em português (ou no idioma do aparelho, ou a primeira)
  applyCaptions(on = this.ccPref, force) {
    this.ccPref = !!on; if (!this.ready || !this.p) return;
    const key = this.item?.ref + '|' + this.ccPref; if (!force && this.ccKey === key) return; this.ccKey = key;
    clearTimeout(this.ccT);
    if (!this.ccPref) return this.captionsOff();
    const go = () => { try {
      this.p.loadModule?.('captions');
      const lang = (navigator.language || 'pt').split('-')[0].toLowerCase();
      const list = this.p.getOption?.('captions', 'tracklist') || [];
      const t = list.find(x => /^pt/i.test(x.languageCode || '')) || list.find(x => x.languageCode?.toLowerCase().startsWith(lang)) || list[0]; // o app é em português
      if (t) this.p.setOption?.('captions', 'track', { languageCode: t.languageCode });
    } catch { } };
    go(); this.ccT = setTimeout(go, 1500);
  }
  // desliga agora e de novo logo depois (o módulo de legendas costuma ser carregado só depois que o vídeo começa)
  captionsOff() {
    if (this.ccPref || !this.ready || !this.p) return;
    const off = () => { if (this.ccPref || this.dead || !this.p) return; try { this.p.unloadModule?.('captions'); this.p.unloadModule?.('cc'); } catch { } };
    off(); clearTimeout(this.ccOffT); clearTimeout(this.ccOffT2);
    this.ccOffT = setTimeout(off, 600); this.ccOffT2 = setTimeout(off, 2500);
  }
  // conferência periódica: com a legenda desligada na sala, se o YouTube mostrou uma faixa, desliga de novo
  guardCaptions() {
    if (this.ccPref || !this.ready || !this.p) return;
    let tr = null; try { tr = this.p.getOption?.('captions', 'track'); } catch { }
    if (tr && tr.languageCode) { try { this.p.unloadModule?.('captions'); this.p.unloadModule?.('cc'); } catch { } }
  }
  // ---------- qualidade ----------
  // Full HD (1080p) forçado; se o vídeo não tem 1080p, a mais alta que ele tiver. `qDown` (motor da sala, por pessoa)
  // desce degraus a partir daí quando a conexão desta pessoa não aguenta, para o vídeo dela não travar nem dessincronizar.
  // A API não garante a troca (o YouTube pode decidir sozinho): o pedido é refeito a cada play/carregamento.
  wantQuality() { return this.qPick ? this.qPick : 'hd1080'; }
  setQualityDown(n) { n = Math.max(0, Math.min(QUALITIES.length, n | 0)); if (n === this.qDown) return; this.qDown = n; this.qKey = ''; this.applyQuality(); }
  applyQuality() {
    if (!this.ready || !this.p) return;
    let avail = []; try { avail = (this.p.getAvailableQualityLevels?.() || []).filter(q => QUALITIES.includes(q)); } catch { }
    if (!avail.length) avail = QUALITIES.slice(QUALITIES.indexOf('hd1080'));
    avail.sort((a, b) => QUALITIES.indexOf(a) - QUALITIES.indexOf(b)); // da maior para a menor
    const base = avail.findIndex(q => QUALITIES.indexOf(q) >= QUALITIES.indexOf('hd1080')); // 1080p ou a mais alta abaixo
    const ladder = avail.slice(base < 0 ? 0 : base);
    const q = ladder[Math.min(ladder.length - 1, this.qDown || 0)] || 'hd1080';
    this.qPick = q;
    const key = this.item?.ref + '|' + q + '|' + avail.join(',');
    if (this.qKey === key && this.quality() === q) return; this.qKey = key;
    try { this.p.setPlaybackQualityRange?.(q, q); } catch { }
    try { this.p.setPlaybackQuality?.(q); } catch { }
  }
  // degraus que ainda dá para descer a partir da qualidade atual
  qualityFloor() { let avail = []; try { avail = (this.p?.getAvailableQualityLevels?.() || []).filter(q => QUALITIES.includes(q)); } catch { } return avail.length ? Math.max(0, avail.filter(q => QUALITIES.indexOf(q) >= QUALITIES.indexOf('hd1080')).length - 1) : 4; }
  quality() { try { return this.ready ? this.p.getPlaybackQuality?.() || null : null; } catch { return null; } }
  captionTracks() { try { return (this.p.getOption('captions', 'tracklist') || []).length; } catch { return -1; } }
  dur() { const d = this.duration(); if (d > 0 && d !== this.lastDur) { this.lastDur = d; this.cb.onDuration(d); } }
  play() { this.ready && this.p.playVideo(); }
  pause() { this.ready && this.p.pauseVideo(); }
  seek(s) { this.ready && this.p.seekTo(Math.max(0, s), true); }
  time() { try { return this.ready ? +this.p.getCurrentTime() || 0 : 0; } catch { return 0; } }
  // velocidade fracionada (0,95×, 1,05×…): o YouTube aceita em vários players, mas pode arredondar para as da lista
  // (0,75/1/1,25). Confere logo depois de pedir; se não ficou como pedido, desiste e o motor passa a pular
  get canRate() { return this.rateOk !== false; }
  setRate(r) {
    if (!this.ready) return; try { this.p.setPlaybackRate(r); } catch { this.rateOk = false; return; }
    if (r !== 1 && this.rateOk === undefined) setTimeout(() => { try { const got = +this.p.getPlaybackRate(); if (Math.abs(got - r) > 0.001) { this.rateOk = false; this.p.setPlaybackRate(1); } else this.rateOk = true; } catch { this.rateOk = false; } }, 700);
  }
  duration() { try { return this.ready ? +this.p.getDuration() || 0 : 0; } catch { return 0; } }
  applyVol() { if (!this.ready) return; this.p.setVolume(this.vol); this.muted ? this.p.mute() : this.p.unMute(); }
  setVolume(v) { this.vol = Math.max(0, Math.min(100, v)); this.applyVol(); }
  setMuted(m) { this.muted = !!m; this.applyVol(); }
  destroy() { this.dead = true; clearTimeout(this.ccT); clearTimeout(this.ccOffT); clearTimeout(this.ccOffT2); try { this.p?.destroy(); } catch { } this.host.replaceChildren(); }
}

// ---------- vídeo direto (link .mp4/.webm ou vídeo enviado no chat) ----------
export class Html5Player extends Base {
  load(item, { pos = 0, play = false } = {}) {
    this.item = item; this.set('loading');
    const v = this.v || (this.v = h('video.wt-v', { playsInline: true, preload: 'auto' }));
    if (v.parentNode !== this.host) this.host.replaceChildren(v);
    v.onloadedmetadata = () => { if (v.duration && isFinite(v.duration)) this.cb.onDuration(v.duration); if (pos) v.currentTime = pos; if (play) this.play(); else this.set('paused'); this.cb.onReady(); };
    v.onplaying = () => this.set('playing');
    v.onpause = () => { if (!v.ended) this.set('paused'); };
    v.onwaiting = () => this.set('buffering');
    v.onseeking = () => { if (!v.paused) this.set('buffering'); };
    v.onseeked = () => this.set(v.paused ? 'paused' : 'playing');
    v.onended = () => { this.set('ended'); this.cb.onEnded(); };
    v.onerror = () => { const c = v.error?.code; this.cb.onError(c === 2 ? 'network' : c === 4 && /^https?:/.test(item.url) && !item.url.startsWith(location.origin) ? 'html5' : c === 4 ? 'not_found' : 'html5'); };
    v.src = item.url; this.applyVol();
  }
  play() { const p = this.v?.play(); p?.catch?.((e) => { if (e?.name === 'NotAllowedError') this.cb.onError('autoplay'); }); }
  pause() { this.v?.pause(); }
  seek(s) { if (this.v) this.v.currentTime = Math.max(0, s); }
  time() { return this.v?.currentTime || 0; }
  get canRate() { return true; }
  setRate(r) { if (this.v) { this.v.preservesPitch = true; this.v.playbackRate = r; } }
  duration() { const d = this.v?.duration; return d && isFinite(d) ? d : 0; }
  applyVol() { if (this.v) { this.v.volume = this.vol / 100; this.v.muted = this.muted; } }
  setVolume(v) { this.vol = Math.max(0, Math.min(100, v)); this.applyVol(); }
  setMuted(m) { this.muted = !!m; this.applyVol(); }
  destroy() { this.dead = true; if (this.v) { this.v.removeAttribute('src'); this.v.load(); } this.host.replaceChildren(); }
}

// ---------- serviços com DRM (Netflix, Prime Video, Crunchyroll) ----------
// O vídeo não toca dentro do Resenha. Duas formas:
//  1. App desktop com janela do serviço (desktop/watchwin.js): cada um entra na própria conta numa janela com sessão
//     guardada; a ponte relata o <video> da página e aplica play/pause/posição — só se a janela tiver Widevine.
//  2. Sincronização assistida (navegador, ou desktop sem Widevine): abre na conta da pessoa e o Resenha mantém um
//     relógio virtual da sala (posição combinada, contagem para o play) que a interface mostra.
export class ExternalPlayer extends Base {
  constructor(host, cb, env = {}) { super(host, cb); this.env = env; this.vt = 0; this.vtAt = 0; this.vPlaying = false; this.bridge = null; }
  get controllable() { return !!this.bridge?.ok; }
  get seekTol() { return 0.5; } // pular na Netflix/Prime pesa: tolerância maior
  state() { const l = this.bridge?.ok && this.bridge.last; if (!l) return this.st; return l.ended ? 'ended' : l.buffering ? 'buffering' : l.paused ? 'paused' : 'playing'; }
  buffering() { const l = this.bridge?.ok && this.bridge.last; return l ? !!l.buffering : false; }
  load(item, { pos = 0, play = false } = {}) {
    this.item = item; this.vt = pos; this.vtAt = performance.now(); this.vPlaying = play;
    this.set(play ? 'playing' : 'paused'); this.cb.onReady();
    if (this.bridge) this.bridge.navigate(item.url);
  }
  // relógio virtual (sem ponte): segue o estado da sala, para a interface mostrar a posição combinada
  play() { if (!this.vPlaying) { this.vt = this.time(); this.vtAt = performance.now(); this.vPlaying = true; } this.bridge?.cmd({ t: 'play' }); this.set('playing'); }
  pause() { if (this.vPlaying) { this.vt = this.time(); this.vPlaying = false; } this.bridge?.cmd({ t: 'pause' }); this.set('paused'); }
  seek(s) { this.vt = s; this.vtAt = performance.now(); this.bridge?.cmd({ t: 'seek', pos: s }); }
  time() { if (this.bridge?.ok && this.bridge.last) return this.bridge.pos(); return this.vt + (this.vPlaying ? (performance.now() - this.vtAt) / 1000 : 0); }
  duration() { return this.bridge?.last?.dur || 0; }
  setVolume(v) { this.vol = v; this.bridge?.cmd({ t: 'volume', v: v / 100, muted: this.muted }); }
  setMuted(m) { this.muted = !!m; this.bridge?.cmd({ t: 'volume', v: this.vol / 100, muted: this.muted }); }
  attachBridge(b) { this.bridge = b; }
  destroy() { this.dead = true; this.host.replaceChildren(); }
}

export function makePlayer(item, host, cb, env) {
  const s = SERVICES[item.service];
  if (item.service === 'youtube') return new YouTubePlayer(host, cb);
  if (item.service === 'file') return new Html5Player(host, cb);
  if (s) return new ExternalPlayer(host, cb, env);
  return null;
}
