// YouTube IFrame Player API simulada para os testes do Watch Together (scripts/watch-test.mjs).
// Mesma interface do YT.Player oficial (eventos onReady/onStateChange/onError, playVideo, pauseVideo, seekTo,
// getCurrentTime, getDuration, setVolume, mute, loadVideoById, cueVideoById, destroy), tocando um <video> local.
// Ids especiais: "EMBEDOFF..." dá o erro 150 (incorporação proibida), "GONE......." o erro 100 (removido).
// O endereço base dos vídeos vem do próprio <script src> (…/ytmock.js → …/v/<id>.webm).
(function () {
  const base = document.currentScript.src.replace(/[^/]+$/, '');
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  window.__ytmock = { players: [] };
  function Player(el, o) {
    const div = typeof el === 'string' ? document.getElementById(el) : el;
    const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto';
    v.style.cssText = 'width:100%;height:100%;background:#000;object-fit:contain'; v.className = 'ytmock';
    div.replaceWith(v);
    this.v = v; this.o = o; this.ev = o.events || {}; this.vol = 100;
    const st = (s) => { this.state = s; this.ev.onStateChange?.({ data: s, target: this }); };
    v.addEventListener('playing', () => st(S.PLAYING));
    v.addEventListener('pause', () => { if (!v.ended) st(S.PAUSED); });
    v.addEventListener('waiting', () => st(S.BUFFERING));
    v.addEventListener('ended', () => st(S.ENDED));
    window.__ytmock.players.push(this);
    // legendas: a conta simulada tem legendas automáticas ligadas (o YouTube ignora cc_load_policy=0 nesse caso)
    this.cc = { on: true, track: 'pt' };
    this._load(o.videoId, (o.playerVars || {}).start || 0, !!(o.playerVars || {}).autoplay, true);
  }
  // window.__ytmockLag (ms, opcional): como o YouTube real, depois de seekTo/loadVideoById o player continua relatando
  // por um tempo a posição antiga e (na troca de vídeo) a duração e um último "tocando" do vídeo anterior
  const lag = () => +window.__ytmockLag || 0;
  Player.prototype._load = function (id, start, play, first) {
    if (!first && lag()) {
      this._stale = { t: this.v.currentTime, d: this.getDuration(), until: performance.now() + lag() };
      setTimeout(() => { this.state = S.PLAYING; this.ev.onStateChange?.({ data: S.PLAYING, target: this }); }, 30);
    }
    this.id = id;
    if (/^EMBEDOFF/.test(id) || /^GONE/.test(id)) {
      setTimeout(() => { if (first) this.ev.onReady?.({ target: this }); this.ev.onError?.({ data: /^GONE/.test(id) ? 100 : 150, target: this }); }, 150);
      return;
    }
    const v = this.v; v.src = base + 'v/' + id + '.webm';
    v.onloadedmetadata = () => {
      this.vid = id; // como no YouTube real: getVideoData só passa a dizer o vídeo novo depois que ele carrega
      if (start) v.currentTime = start;
      if (first) { first = false; this.ev.onReady?.({ target: this }); }
      // como no YouTube real: o 1º vídeo carregado sem autoplay fica "não iniciado" (-1) até alguém mandar o play;
      // só o cueVideoById deixa "pronto" (5)
      if (play) this.playVideo(); else if (first) { this.state = S.UNSTARTED; this.ev.onStateChange?.({ data: S.UNSTARTED, target: this }); } else { this.state = S.CUED; this.ev.onStateChange?.({ data: S.CUED, target: this }); }
    };
  };
  Player.prototype.playVideo = function () { this.v.play().catch(() => this.ev.onAutoplayBlocked?.({ target: this })); };
  Player.prototype.pauseVideo = function () { this.v.pause(); };
  Player.prototype.seekTo = function (s) { if (lag()) this._stale = { t: this.v.currentTime, d: this.getDuration(), until: performance.now() + lag() }; this.v.currentTime = s; };
  const stale = (p) => p._stale && performance.now() < p._stale.until ? p._stale : null;
  Player.prototype.getCurrentTime = function () { return stale(this)?.t ?? this.v.currentTime; };
  Player.prototype.getDuration = function () { const st = stale(this); if (st && st.d) return st.d; return isFinite(this.v.duration) ? this.v.duration : 0; };
  Player.prototype.getPlayerState = function () { return this.state; };
  Player.prototype.getVideoData = function () { return { video_id: this.vid || '' }; };
  Player.prototype.setVolume = function (n) { this.vol = n; this.v.volume = n / 100; };
  Player.prototype.getVolume = function () { return this.vol; };
  Player.prototype.mute = function () { this.v.muted = true; };
  Player.prototype.unMute = function () { this.v.muted = false; };
  Player.prototype.isMuted = function () { return this.v.muted; };
  Player.prototype.loadVideoById = function (o) { const id = typeof o === 'string' ? o : o.videoId; this._load(id, o.startSeconds || 0, true); };
  Player.prototype.cueVideoById = function (o) { const id = typeof o === 'string' ? o : o.videoId; this._load(id, o.startSeconds || 0, false); };
  // velocidade: o player simulado aceita frações (0,95×…); com window.__ytmockRoundRates arredonda como os da lista
  Player.prototype.setPlaybackRate = function (r) { this.v.playbackRate = window.__ytmockRoundRates ? Math.round(r * 4) / 4 : r; };
  Player.prototype.getPlaybackRate = function () { return this.v.playbackRate; };
  Player.prototype.loadModule = function (m) { if (m === 'captions') this.cc.on = true; };
  Player.prototype.unloadModule = function (m) { if (m === 'captions' || m === 'cc') this.cc.on = false; };
  Player.prototype.getOption = function (m, k) { if (m !== 'captions') return undefined; if (k === 'tracklist') return [{ languageCode: 'en' }, { languageCode: 'pt' }]; if (k === 'track') return this.cc.on ? { languageCode: this.cc.track || 'en' } : {}; return undefined; };
  // qualidade: o vídeo simulado "tem" até 4K; guarda o que foi pedido (o YouTube real pode ignorar, aqui obedece)
  Player.prototype.getAvailableQualityLevels = function () { return ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'auto']; };
  Player.prototype.setPlaybackQuality = function (q) { this.q = q; (this.qAsked = this.qAsked || []).push(q); };
  Player.prototype.setPlaybackQualityRange = function (a) { this.q = a; };
  Player.prototype.getPlaybackQuality = function () { return this.q || 'hd2160'; };
  Player.prototype.setOption = function (m, k, v) { if (m === 'captions' && k === 'track') { this.cc.on = true; this.cc.track = v?.languageCode || null; } };
  Player.prototype.destroy = function () { this.v.pause(); this.v.remove(); };
  window.YT = { Player, PlayerState: S };
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 30);
})();
