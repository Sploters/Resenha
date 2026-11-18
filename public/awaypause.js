// Janela minimizada, na bandeja ou fora de foco (jogando, outra janela na frente): GIFs e vídeos sem som param de animar.
// No app desktop a página roda sem desaceleração (backgroundThrottling: false) e o navegador continua decodificando cada
// quadro de cada GIF do chat e de cada vídeo em loop mesmo sem ninguém olhando — tempo de CPU e de placa de vídeo que o
// jogo poderia usar. Aqui:
// - GIFs do chat (mensagem só com o GIF, GIF enviado como arquivo, prévia de link .gif) trocam pelo primeiro quadro;
// - vídeos tocando sem som (loops, prévias) pausam e voltam a tocar de onde estavam;
// - avatares e banners animados param (freeze.js setAway).
// Vídeo tocando COM som não é tocado: a pessoa está ouvindo. Transmissões e câmeras da chamada (srcObject) também não:
// elas já seguem a visibilidade em app.js (applyVisibility/applyCamFlow).
// Fora de foco só conta depois de AWAY_MS (alt-tab rápido, menu do sistema ou clique num player do YouTube dentro do chat
// não piscam nada). Minimizada/escondida vale na hora. Configurações → Aparência → "Pausar GIFs e vídeos fora de foco".
import { S } from './state.js';
import { still, gifFrozen } from './mediasafe.js';
import { setAway } from './freeze.js';

const AWAY_MS = 1500;
const enabled = () => S.prefs?.awayPause !== false;
const frozen = new Map(); // <img> -> endereço original do GIF
const paused = new Set(); // <video> que pausamos
let away = false, timer = 0, obs = null;

const animUrl = (img) => {
  const src = img.getAttribute('src') || '';
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
  if (img.closest('.gifmsg')) return src; // mensagem que é só um GIF/WebP animado
  return /\.gif(\?|#|$)/i.test(src) && img.closest('.attach, .giftile, .gifpicker') ? src : null;
};
function freezeImg(img) {
  if (frozen.has(img) || gifFrozen()) return; // GIFs parados / modo leve: mediasafe.js já cuida
  const url = animUrl(img); if (!url) return;
  frozen.set(img, url);
  still(url).then((s) => { if (s && away && frozen.get(img) === url && img.getAttribute('src') === url) img.src = s; else if (!s) frozen.delete(img); });
}
function pauseVideo(v) {
  if (v.srcObject || v.paused || v.ended || paused.has(v)) return;
  if (!(v.muted || v.volume === 0)) return; // com som: a pessoa está ouvindo
  paused.add(v); v.pause();
}
const scan = (root) => {
  if (root.nodeType !== 1) return;
  if (root.tagName === 'IMG') freezeImg(root); else if (root.tagName === 'VIDEO') pauseVideo(root);
  root.querySelectorAll?.('img').forEach(freezeImg);
  root.querySelectorAll?.('video').forEach(pauseVideo);
};

function goAway() {
  if (away || !enabled()) return;
  away = true; setAway(true);
  scan(document.body);
  // o que chega enquanto a janela está longe (mensagem nova com GIF) também fica parado
  obs = new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(scan); });
  obs.observe(document.body, { childList: true, subtree: true });
}
function comeBack() {
  clearTimeout(timer); timer = 0;
  if (!away) return;
  away = false; setAway(false);
  obs?.disconnect(); obs = null;
  for (const [img, url] of frozen) if (img.isConnected && img.getAttribute('src')?.startsWith('data:')) img.src = url;
  frozen.clear();
  for (const v of paused) if (v.isConnected && v.paused && !v.ended) v.play().catch(() => { });
  paused.clear();
}
// a pessoa deu play num vídeo com a janela longe (clicou sem focar): não é pausado de novo nem retomado por nós
document.addEventListener('play', (e) => paused.delete(e.target), true);

function check() {
  if (document.hidden) { clearTimeout(timer); timer = 0; return goAway(); }
  if (document.hasFocus()) return comeBack();
  // perdeu o foco: espera um pouco e confere de novo (foco num iframe do chat conta como foco da página)
  if (!timer) timer = setTimeout(() => { timer = 0; if (!document.hasFocus() || document.hidden) goAway(); }, AWAY_MS);
}
document.addEventListener('visibilitychange', check);
addEventListener('blur', check);
addEventListener('focus', check);
addEventListener('pointerdown', () => { if (away && document.hasFocus()) comeBack(); }, true);

// a preferência mudou (aqui ou em outro aparelho): desligada no meio de um "longe" devolve tudo
export function refreshAwayPause() { if (!enabled()) comeBack(); else check(); }
export const isAway = () => away; // testes
