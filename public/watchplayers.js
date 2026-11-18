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
const YT_ERR = { 2: 'not_found', 5: 'html5', 100: 'not_found', 101: 'embed_blocked', 150: 'embed_blocked', 152: 'embed_blocked', 153: 'api_blocked' };
export class YouTubePlayer extends Base {
  async load(item, { pos = 0, play = false } = {}) {
    this.item = item; this.set('loading');
    let YT; try { YT = await loadYouTubeApi(); } catch { return this.cb.onError('api_blocked'); }
    if (this.dead) return;
    const startAt = Math.floor(pos);
    if (this.p && this.ready) { // mesmo iframe para o próximo vídeo (troca mais rápida, sem recriar)
      this.lastDur = 0;
      play ? this.p.loadVideoById({ videoId: item.ref, startSeconds: pos }) : this.p.cueVideoById({ videoId: item.ref, startSeconds: pos });
      this.cb.onReady(); // a API já está pronta; o motor volta a sincronizar este vídeo novo
      return;
    }
    const div = h('div.wt-yt'); this.host.replaceChildren(div);
    this.ready = false;
    this.p = new YT.Player(div, {
      videoId: item.ref, width: '100%', height: '100%',
      host: window.__wtYtHost || 'https://www.youtube.com',
      playerVars: { autoplay: play ? 1 : 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, start: startAt, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { this.ready = true; this.applyVol(); if (Math.abs(pos - startAt) > .3) this.p.seekTo(pos, true); if (play) this.p.playVideo(); this.cb.onReady(); this.dur(); },
        onStateChange: (e) => {
          const m = { '-1': 'loading', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'paused' }[e.data];
          if (m) this.set(m);
          if (e.data === 1) this.dur();
          if (e.data === 0) this.cb.onEnded();
        },
        onError: (e) => this.cb.onError(YT_ERR[e.data] || 'html5'),
        onAutoplayBlocked: () => this.cb.onError('autoplay'),
      },
    });
  }
  dur() { const d = this.duration(); if (d > 0 && d !== this.lastDur) { this.lastDur = d; this.cb.onDuration(d); } }
  play() { this.ready && this.p.playVideo(); }
  pause() { this.ready && this.p.pauseVideo(); }
  seek(s) { this.ready && this.p.seekTo(Math.max(0, s), true); }
  time() { try { return this.ready ? +this.p.getCurrentTime() || 0 : 0; } catch { return 0; } }
  duration() { try { return this.ready ? +this.p.getDuration() || 0 : 0; } catch { return 0; } }
  applyVol() { if (!this.ready) return; this.p.setVolume(this.vol); this.muted ? this.p.mute() : this.p.unMute(); }
  setVolume(v) { this.vol = Math.max(0, Math.min(100, v)); this.applyVol(); }
  setMuted(m) { this.muted = !!m; this.applyVol(); }
  destroy() { this.dead = true; try { this.p?.destroy(); } catch { } this.host.replaceChildren(); }
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
