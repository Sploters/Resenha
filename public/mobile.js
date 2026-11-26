// Celular e janelas estreitas:
// 1) Altura de verdade da área visível (--app-h). O 100vh do celular conta a barra do navegador, e o teclado virtual do
//    iPhone não encolhe a página: o campo de mensagem ficava atrás dele. Com o visualViewport a página acompanha o
//    teclado e o campo continua à vista. No computador (e no Electron) não muda nada: a altura é a da janela.
// 2) Gaveta da lista de canais (☰): fundo escurecido que fecha ao tocar fora, Esc fecha, e o gesto de arrastar da borda
//    esquerda abre (arrastar para a esquerda fecha), como nos apps de celular.
// 3) Barra do topo do canal: quando os botões não cabem (celular, janela estreita, tablet), os menos usados vão para um
//    botão "Mais opções" no fim da barra, em vez de saírem da tela. Nenhum botão some: todos ficam no menu.
// 4) Navegação inferior no celular (como nos apps): Servidores (abre a gaveta), Amigos, Jogos, Caixa de entrada (com o
//    número de menções e pedidos) e Você. Some dentro de uma conversa (volta com a gaveta) e com o teclado aberto.
import { h, icon } from './util.js';
import { S, menu } from './state.js';
import { go } from './nav.js';
import { showInbox, inboxBadge } from './inbox.js';

const narrow = matchMedia('(max-width: 640px)');
const root = document.documentElement;

// ---------- 1) altura visível ----------
const vv = window.visualViewport;
function syncHeight() {
  if (!vv) return;
  // só onde o teclado virtual existe ou a barra do navegador muda de tamanho: toque. Sem toque, a altura da janela basta
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) { root.style.removeProperty('--app-h'); return; }
  if (vv.scale > 1.01) return; // zoom de pinça: a área visível encolhe, mas a página não (e não briga com quem está arrastando)
  root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
  // iPhone: ao abrir o teclado o navegador rola a página inteira para cima; com a altura já ajustada, volta para o topo
  if (vv.offsetTop > 0 || scrollY > 0) requestAnimationFrame(() => window.scrollTo(0, 0));
}
if (vv) { vv.addEventListener('resize', syncHeight); vv.addEventListener('scroll', syncHeight); syncHeight(); }
// teclado abriu e a conversa estava no fim: continua no fim (a última mensagem não fica escondida atrás do campo)
document.addEventListener('focusin', (e) => {
  if (!e.target.closest?.('#composer')) return;
  const box = document.getElementById('msgs'); if (!box) return;
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (atEnd) setTimeout(() => { box.scrollTop = box.scrollHeight; }, 300);
});

// ---------- 2) gaveta ----------
const app = () => document.getElementById('app');
const isOpen = () => !!app()?.classList.contains('nav-open');
const setOpen = (v) => app()?.classList.toggle('nav-open', v);
function ensureScrim() {
  const a = app(); if (!a || a.querySelector(':scope > #nav-scrim')) return;
  a.append(h('div#nav-scrim', { 'aria-hidden': 'true', onclick: () => setOpen(false) }));
}
// o #app é remontado no login (nav.js): o fundo volta junto
if (app()) new MutationObserver(ensureScrim).observe(app(), { childList: true });
ensureScrim();
addEventListener('keydown', (e) => { if (e.key === 'Escape' && narrow.matches && isOpen() && !document.querySelector('.backdrop, .menu, .popout')) setOpen(false); });
// arrastar: começa na borda esquerda (abrir) ou em qualquer lugar com a gaveta aberta (fechar); só gesto bem horizontal
let sw = null;
addEventListener('touchstart', (e) => {
  if (!narrow.matches || e.touches.length !== 1) return (sw = null);
  const t = e.touches[0], open = isOpen();
  if (!open && t.clientX > 24) return (sw = null);
  if (document.querySelector('.backdrop, #lightbox, #settings')) return (sw = null); // janela aberta por cima: não mexe
  sw = { x: t.clientX, y: t.clientY, open };
}, { passive: true });
addEventListener('touchend', (e) => {
  if (!sw) return; const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, s = sw; sw = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  if (!s.open && dx > 0) setOpen(true); else if (s.open && dx < 0) setOpen(false);
}, { passive: true });
addEventListener('touchcancel', () => { sw = null; }, { passive: true });

// ---------- 3) barra do topo que se ajusta ----------
// ordem: os primeiros vão para o menu antes
const PRIO = ['#hide-side', '.dmp-btn', '.files-btn', '.members-btn', '.pins-btn', '.notif-btn', '.grid-btn', '.pt-btn', '#e2-btn'];
const labelOf = (b) => b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent.trim() || 'Opção';
let cur = null, ro = null, mo = null, busy = false;
function fit() {
  const top = cur; if (!top?.isConnected || busy) return;
  busy = true;
  try {
    const all = PRIO.flatMap(s => [...top.querySelectorAll(':scope > ' + s + ', :scope > div > ' + s)]);
    for (const b of all) b.classList.remove('tb-off', 'tb-proxy');
    let more = top.querySelector(':scope > .tb-more');
    if (!all.length) { more?.remove(); return; }
    if (!more) {
      more = h('button.ibtn.tb-more', { type: 'button', title: 'Mais opções', 'aria-label': 'Mais opções', onclick: (e) => openMore(e, top) }, icon('more', 22));
      top.append(more);
    }
    more.classList.add('tb-off');
    const name = top.querySelector(':scope > span:not(.hash):not(.topic)');
    const tight = () => top.scrollWidth > top.clientWidth + 1 || (name && name.clientWidth < Math.min(name.scrollWidth, 96));
    if (!tight()) return;
    more.classList.remove('tb-off');
    for (const b of all) { if (b.hidden || getComputedStyle(b).display === 'none') continue; b.classList.add('tb-off'); if (!tight()) break; }
  } finally { busy = false; }
}
function openMore(e, top) {
  const r = e.currentTarget.getBoundingClientRect();
  const hiddenBtns = PRIO.flatMap(s => [...top.querySelectorAll(':scope > ' + s + ', :scope > div > ' + s)]).filter(b => b.classList.contains('tb-off') && !b.hidden);
  menu(e, hiddenBtns.map(b => ({ label: labelOf(b) + (b.classList.contains('sel') ? ' ✓' : ''), fn: () => {
    // o botão escondido "aparece" invisível em cima do Mais: o que ele abre (cartão, lista de fixadas) se posiciona ali
    b.classList.remove('tb-off'); b.classList.add('tb-proxy');
    Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.bottom }));
  } })));
}
const schedule = () => requestAnimationFrame(fit);
function watch() {
  const t = document.getElementById('topbar');
  if (t === cur) return;
  ro?.disconnect(); mo?.disconnect(); cur = t; if (!t) return;
  ro = new ResizeObserver(schedule); ro.observe(t);
  mo = new MutationObserver(schedule); mo.observe(t, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  schedule();
}
new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
watch();

// ---------- 4) navegação inferior ----------
let mnav = null, typing = false;
const tab = (id, ic, label, fn) => h('button.mn-tab', { type: 'button', 'data-tab': id, 'aria-label': label, onclick: fn }, h('span.mn-ic', icon(ic, 22)), h('span.mn-l', label));
function buildNav() {
  mnav = h('nav#mnav', { 'aria-label': 'Navegação' },
    tab('servers', 'grid', 'Servidores', () => setOpen(!isOpen())),
    tab('home', 'users', 'Amigos', () => { setOpen(false); go('@me'); }),
    tab('games', 'gamepad', 'Jogos', () => { setOpen(false); go('@me', 'lfg'); }),
    tab('inbox', 'inbox', 'Caixa', (e) => { setOpen(false); showInbox(e.currentTarget); }),
    tab('me', 'user', 'Você', () => { setOpen(false); window.__lc?.openSettings?.('account'); }));
  document.body.append(mnav);
}
function syncNav() {
  // numa conversa (com o campo de mensagem) a barra sai para dar espaço, como nos apps; a gaveta (☰ ou arrastar) traz de volta
  const inChat = !!document.querySelector('#app #composer');
  const show = narrow.matches && !!app() && !!S.me && !typing && (isOpen() || !inChat);
  root.classList.toggle('has-mnav', show);
  if (!show) { if (mnav) mnav.hidden = true; return; }
  if (!mnav) buildNav();
  mnav.hidden = false;
  const v = S.view || {}, on = isOpen() ? 'servers' : v.gid === '@me' && v.cid === 'lfg' ? 'games' : v.gid === '@me' && !v.cid ? 'home' : null;
  for (const b of mnav.children) b.classList.toggle('on', b.dataset.tab === on);
  const ib = mnav.querySelector('[data-tab=inbox] .mn-ic'), badge = inboxBadge();
  ib.querySelector('.ibadge')?.remove(); if (badge) ib.append(badge);
}
document.addEventListener('focusin', (e) => { if (!e.target.closest?.('#composer') && e.target.matches?.('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]), [contenteditable=true]')) { typing = true; syncNav(); } });
document.addEventListener('focusout', () => { typing = false; setTimeout(syncNav, 50); });
narrow.addEventListener?.('change', syncNav);
addEventListener('hashchange', () => setTimeout(syncNav, 0));
if (app()) new MutationObserver(syncNav).observe(app(), { attributes: true, attributeFilter: ['class'] }); // gaveta abriu/fechou
setInterval(() => { if (narrow.matches && !document.hidden) syncNav(); }, 2000); // número da caixa de entrada
syncNav();
