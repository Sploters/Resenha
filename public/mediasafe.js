// Mídia mais segura (ideia "Spoiler Button and GIF Freeze Option for Accessibility", Stoat #1374), pensando em quem tem
// epilepsia fotossensível ou sensibilidade à luz:
// - anexo marcado como spoiler no envio (olho na prévia do anexo): borrado para todo mundo até clicar;
// - "Esconder imagens e vídeos até clicar" (Acessibilidade): em todo lugar ou só nos servidores; as suas não são escondidas;
// - "GIFs parados" (Acessibilidade): GIF mostra o primeiro quadro e só anima com o mouse em cima ou ao tocar. Vale para o
//   GIF do seletor, o GIF enviado como arquivo e o modo leve/animações desligadas (que já paravam os GIFs).
import { h, icon } from './util.js';
import { S, channelById } from './state.js';
import { liteOn } from './lite.js';

export const hideMode = () => (['servers', 'all'].includes(S.prefs.mediaHide) ? S.prefs.mediaHide : 'off');
export const gifFrozen = () => !!S.prefs.gifFreeze || liteOn() || S.prefs.animMode === 'never';
const revealed = new Set(); // url (ou chave) já mostrada nesta abertura: ao redesenhar o chat continua visível

// a mídia desta mensagem deve começar escondida? 'spoiler' | 'hidden' | null
export function coverReason(m, f) {
  if (f?.spoiler) return 'spoiler';
  const mode = hideMode(); if (mode === 'off' || !m || m.author_id === S.me?.id) return null;
  if (mode === 'all') return 'hidden';
  const ch = channelById(m.channel_id);
  return ch?.guild_id ? 'hidden' : null;
}

// cobre um elemento de mídia: borrão + botão. key: o que lembrar como "já mostrado"
export function coverMedia(node, reason, key) {
  if (!reason || (key && revealed.has(key))) return node;
  const tag = reason === 'spoiler' ? [icon('eye', 16), h('b', 'SPOILER')] : [icon('eyeoff', 16), h('b', 'Mídia escondida'), h('small', 'Clique para mostrar')];
  const box = h('div.mcover' + (reason === 'spoiler' ? '.spoil' : ''), { role: 'button', tabindex: '0', 'aria-label': reason === 'spoiler' ? 'Spoiler: clique para mostrar' : 'Mídia escondida: clique para mostrar' });
  // o conteúdo fica embaixo, borrado e inerte (não toca nem recebe clique); ao mostrar, volta para o lugar da capa
  // "Mídia escondida" não carrega nada por baixo (nem borrado: um GIF borrado ainda pisca); o spoiler mostra borrado
  const under = h('div.mc-under', { 'aria-hidden': 'true', inert: '' }, reason === 'spoiler' && !gifFrozen() ? node : null);
  const show = (e) => { e.stopPropagation(); e.preventDefault(); if (key) revealed.add(key); under.replaceChildren(); box.replaceWith(node); };
  box.onclick = show; box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') show(e); };
  box.append(under, h('span.mc-tag', ...tag));
  return box;
}

// primeiro quadro de um GIF (precisa de CORS para sites de fora; arquivo daqui sempre funciona). null: não deu
const stills = new Map();
export function still(src) {
  if (!stills.has(src)) stills.set(src, new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); res(c.toDataURL('image/png')); } catch { res(null); } };
    im.onerror = () => res(null); im.src = src;
  }));
  return stills.get(src);
}
export const isGifName = (n) => /\.gif(\?|$)/i.test(String(n || ''));

// GIF parado: mostra o quadro parado; anima com o mouse em cima, com o foco do teclado ou ao tocar (tocar de novo para)
export function freezeGif(img, url, box = img.parentElement) {
  if (!gifFrozen()) return;
  let playing = false;
  const stop = () => still(url).then(s => { if (s && gifFrozen() && !playing) { img.src = s; box?.classList.add('paused'); } });
  const play = () => { playing = true; img.src = url; box?.classList.remove('paused'); };
  const pause = () => { playing = false; stop(); };
  img.addEventListener('mouseenter', play); img.addEventListener('mouseleave', pause);
  img.addEventListener('touchstart', (e) => { if (!playing) { e.preventDefault(); play(); } else pause(); }, { passive: false });
  stop();
}
