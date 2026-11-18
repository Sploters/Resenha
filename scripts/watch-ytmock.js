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
    this._load(o.videoId, (o.playerVars || {}).start || 0, !!(o.playerVars || {}).autoplay, true);
  }
  Player.prototype._load = function (id, start, play, first) {
    this.id = id;
    if (/^EMBEDOFF/.test(id) || /^GONE/.test(id)) {
      setTimeout(() => { if (first) this.ev.onReady?.({ target: this }); this.ev.onError?.({ data: /^GONE/.test(id) ? 100 : 150, target: this }); }, 150);
      return;
    }
    const v = this.v; v.src = base + 'v/' + id + '.webm';
    v.onloadedmetadata = () => {
      if (start) v.currentTime = start;
      if (first) { first = false; this.ev.onReady?.({ target: this }); }
      if (play) this.playVideo(); else { this.state = S.CUED; this.ev.onStateChange?.({ data: S.CUED, target: this }); }
    };
  };
  Player.prototype.playVideo = function () { this.v.play().catch(() => this.ev.onAutoplayBlocked?.({ target: this })); };
  Player.prototype.pauseVideo = function () { this.v.pause(); };
  Player.prototype.seekTo = function (s) { this.v.currentTime = s; };
  Player.prototype.getCurrentTime = function () { return this.v.currentTime; };
  Player.prototype.getDuration = function () { return isFinite(this.v.duration) ? this.v.duration : 0; };
  Player.prototype.getPlayerState = function () { return this.state; };
  Player.prototype.setVolume = function (n) { this.vol = n; this.v.volume = n / 100; };
  Player.prototype.getVolume = function () { return this.vol; };
  Player.prototype.mute = function () { this.v.muted = true; };
  Player.prototype.unMute = function () { this.v.muted = false; };
  Player.prototype.isMuted = function () { return this.v.muted; };
  Player.prototype.loadVideoById = function (o) { const id = typeof o === 'string' ? o : o.videoId; this._load(id, o.startSeconds || 0, true); };
  Player.prototype.cueVideoById = function (o) { const id = typeof o === 'string' ? o : o.videoId; this._load(id, o.startSeconds || 0, false); };
  Player.prototype.destroy = function () { this.v.pause(); this.v.remove(); };
  window.YT = { Player, PlayerState: S };
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 30);
})();
