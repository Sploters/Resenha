import { S } from './state.js';

// Avatares e banners animados (gif/webp/apng). Modos: 'always' (padrão), 'speak' (na chamada ficam parados e animam enquanto a pessoa fala; perfis seguem animados), 'never' (nada anima)
const ANIM = /\.(gif|webp|apng)(\?|#|$)|^data:image\/(gif|webp|apng)/i;
const SEL = '.avatar, .upbanner, .mebanner, [class*="banner"]';
const TILE = '.tile[data-bg="banner"]';
const stills = new Map(); // src -> Promise<dataURL>
const still = (src) => {
  if (!stills.has(src)) stills.set(src, new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); res(c.toDataURL('image/png')); } catch { res(null); } };
    im.onerror = () => res(null); im.src = src;
  }));
  return stills.get(src);
};
const mode = () => S.prefs?.animMode || 'always';
const freezeIt = (el) => { const m = mode(); return m === 'never' || (m === 'speak' && !!el.closest('#stage') && !el.closest('.speaking')); };

function applyImg(img) {
  if (!img.closest?.(SEL)) return;
  const src = img.dataset.orig || img.getAttribute('src') || '';
  if (!ANIM.test(src)) return;
  if (!freezeIt(img)) { if (img.dataset.orig && img.getAttribute('src') !== img.dataset.orig) img.src = img.dataset.orig; return; }
  img.dataset.orig = src;
  still(src).then((u) => { if (u && img.dataset.orig === src && freezeIt(img)) img.src = u; });
}
// fundo dos quadros da chamada (banner do usuário vira o fundo do quadro)
function applyTile(t) {
  const cur = t.style.getPropertyValue('--tbg'), orig = t.dataset.origbg || cur, m = /url\("([^"]+)"\)/.exec(orig);
  if (!m || !ANIM.test(m[1])) return;
  if (!freezeIt(t)) { if (t.dataset.origbg && cur !== t.dataset.origbg) t.style.setProperty('--tbg', t.dataset.origbg); return; }
  t.dataset.origbg = orig;
  still(m[1]).then((u) => { if (u && t.dataset.origbg === orig && freezeIt(t)) t.style.setProperty('--tbg', orig.replace(m[0], `url("${u}")`)); });
}
const scan = (root) => {
  if (root.tagName === 'IMG') applyImg(root);
  if (root.matches?.(TILE)) applyTile(root);
  root.querySelectorAll?.('img').forEach(applyImg);
  root.querySelectorAll?.(TILE).forEach(applyTile);
};
// Observa a página só quando algo pode precisar congelar (modo diferente de "Sempre"): no padrão, cada mensagem que chegava
// gerava registros de mudança e uma busca na página inteira por [data-orig] só para concluir que não havia nada a fazer.
const obs = new MutationObserver((ms) => {
  for (const m of ms) {
    if (m.type === 'childList') m.addedNodes.forEach(n => n.nodeType === 1 && scan(n));
    else if (m.target.nodeType === 1 && (m.oldValue || '').includes('speaking') !== m.target.classList.contains('speaking')) scan(m.target);
  }
});
let watching = false;
const syncWatch = () => {
  const need = mode() !== 'always';
  if (need === watching) return; watching = need;
  if (need) { obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true }); scan(document.body); }
  else { obs.disconnect(); obs.takeRecords(); scan(document.body); } // voltando para "Sempre": devolve as animações
};
// troca nas configurações chama refreshFreeze; a preferência também pode chegar de outro aparelho: confere a cada 5 s
export const refreshFreeze = () => { const was = watching; syncWatch(); if (was === watching) scan(document.body); };
setTimeout(syncWatch); setInterval(syncWatch, 5000); // no próximo tique: S.prefs e o corpo da página já existem
