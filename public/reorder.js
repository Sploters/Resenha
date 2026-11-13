// Segurar e arrastar para trocar a ordem (abas de canais, servidores e conversas fixadas na barra da esquerda).
// O próprio item segue o mouse e os vizinhos do mesmo grupo abrem espaço; ao soltar, onDrop recebe a nova ordem (data-id).
// No toque, é preciso segurar um instante antes de arrastar (senão é só rolar a lista).
// O arrastar nativo do navegador (imagem que abre em outra aba ou cai no chat) fica desligado nesses contêineres.
let active = null;
export const reordering = () => !!active;

export function sortable(box, { items, ignore, axis = 'y', group = () => '', onDrop }) {
  box.addEventListener('dragstart', (e) => e.preventDefault());
  box.addEventListener('pointerdown', (e) => {
    if (active || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = e.target.closest(items); if (!el || !box.contains(el) || (ignore && e.target.closest(ignore))) return;
    const touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
    let started = false, ready = !touch, t = 0, off = 0, timer = 0, last = e;
    const pos = (ev) => axis === 'y' ? ev.clientY : ev.clientX;
    const near = (r) => axis === 'y' ? r.top : r.left, size = (r) => axis === 'y' ? r.height : r.width;
    const peers = () => [...box.querySelectorAll(items)].filter(p => p !== el && group(p) === group(el));
    const place = () => {
      const p = pos(last), r = el.getBoundingClientRect(), nat = near(r) - t;
      t = p - off - nat; el.style.transform = axis === 'y' ? `translateY(${t}px)` : `translateX(${t}px)`;
    };
    const start = () => {
      started = true; active = el; off = pos(last) - near(el.getBoundingClientRect());
      el.classList.add('reordering'); document.body.classList.add('reorder-on');
      if (navigator.vibrate && touch) try { navigator.vibrate(15); } catch { /* sem vibração */ }
      place();
    };
    const move = (ev) => {
      if (ev.pointerId !== id) return; last = ev;
      if (!started) {
        const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) > (touch ? 8 : 5);
        if (!ready) { if (far) end(); return; }
        if (!far) return; start();
      }
      ev.preventDefault();
      const p = pos(ev), list = peers(), all = [...el.parentNode.children];
      for (const s of list) {
        const r = s.getBoundingClientRect(), a = near(r), b = a + size(r); if (p < a || p > b) continue;
        const after = all.indexOf(s) > all.indexOf(el);
        if (after && p > a + size(r) / 2) s.after(el); else if (!after && p < a + size(r) / 2) s.before(el);
        break;
      }
      // perto da borda da lista que rola: rola junto
      const sc = el.parentNode, rr = sc.getBoundingClientRect(), lo = near(rr), hi = lo + size(rr);
      const d = p < lo + 24 ? -12 : p > hi - 24 ? 12 : 0;
      if (d) axis === 'y' ? sc.scrollTop += d : sc.scrollLeft += d;
      place();
    };
    const noScroll = (ev) => { if (started) ev.preventDefault(); };
    const end = (ev) => {
      if (ev && ev.pointerId !== id) return;
      clearTimeout(timer);
      removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
      removeEventListener('touchmove', noScroll);
      if (!started) return;
      active = null; el.classList.remove('reordering'); el.style.transform = ''; document.body.classList.remove('reorder-on');
      // o clique que vem junto com o soltar não abre o item
      const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
      addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => removeEventListener('click', eat, { capture: true }), 0);
      onDrop([el, ...peers()].sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1).map(p => p.dataset.id), el);
    };
    if (touch) timer = setTimeout(() => { ready = true; start(); }, 350);
    addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', end); addEventListener('pointercancel', end);
    addEventListener('touchmove', noScroll, { passive: false });
  });
}
