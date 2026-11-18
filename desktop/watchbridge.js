// Ponte do Watch Together dentro da janela do serviço (preload de desktop/watchwin.js). Roda no "mundo isolado":
// enxerga o DOM da página (o <video>), mas não o JavaScript dela, e a página não enxerga a ponte.
// Relata: { t: 'drm', widevine } · { t: 'state', pos, dur, paused, buffering, ended, video, url, title } · { t: 'login' }
// · { t: 'error', code }. Aplica: play, pause, seek (exceto Netflix, feito pelo processo principal), volume.
// Só o elemento de vídeo que o próprio site toca é controlado; nada do conteúdo sai desta janela.
const { ipcRenderer } = require('electron');
const svc = (process.argv.find(a => a.startsWith('--resenha-watch=')) || '').split('=')[1] || '';
const send = (m) => ipcRenderer.send('watch-bridge', m);

// DRM: o serviço só toca com Widevine. Sem ele (Electron padrão), a interface explica e oferece o navegador.
(async () => {
  let widevine = false;
  try {
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }]);
    widevine = true;
  } catch { }
  send({ t: 'drm', widevine });
})();

// o vídeo principal: o maior <video> com fonte (os sites têm prévias pequenas e trailers no fundo)
const mainVideo = () => {
  let best = null, area = 0;
  for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(), a = r.width * r.height; if ((v.currentSrc || v.srcObject || v.src) && a >= area) { best = v; area = a; } }
  return best;
};
let hooked = null, lastErr = null;
function hook(v) {
  if (hooked === v) return; hooked = v;
  v.addEventListener('error', () => { const c = v.error?.code; const code = c === 2 ? 'network' : 'drm'; if (code !== lastErr) { lastErr = code; send({ t: 'error', code, detail: v.error?.message || '' }); } });
  for (const ev of ['play', 'pause', 'seeked', 'waiting', 'playing', 'ended']) v.addEventListener(ev, () => report(true));
}
let lastSent = 0;
function report(now) {
  const v = mainVideo(); if (v) hook(v);
  const t = Date.now(); if (!now && t - lastSent < 900) return; lastSent = t;
  const login = /\/(login|signin|sign-in)\b|\/ap\/signin|sso\.crunchyroll/i.test(location.href);
  if (login) return send({ t: 'login', url: location.href });
  send({ t: 'state', video: !!v, pos: v ? v.currentTime : 0, dur: v && isFinite(v.duration) ? v.duration : 0, paused: v ? v.paused : true, ended: !!v?.ended,
    buffering: !!v && !v.paused && v.readyState < 3, url: location.href, title: document.title.slice(0, 160), at: t });
}
setInterval(() => report(false), 500);
addEventListener('DOMContentLoaded', () => report(true));

ipcRenderer.on('watch-cmd', (_e, c) => {
  const v = mainVideo(); if (!v || !c) return;
  try {
    if (c.t === 'play') v.play().catch(() => send({ t: 'error', code: 'autoplay' }));
    else if (c.t === 'pause') v.pause();
    else if (c.t === 'seek' && svc !== 'netflix') v.currentTime = Math.max(0, +c.pos || 0);
    else if (c.t === 'volume') { v.volume = Math.max(0, Math.min(1, +c.v)); v.muted = !!c.muted; }
  } catch { }
  report(true);
});
