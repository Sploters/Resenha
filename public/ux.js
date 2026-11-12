// Telemetria de UX (etapa 1): conta, sem dizer quem, o que as pessoas fazem em alguns pontos escolhidos e manda os totais
// ao servidor (POST /api/ux, server/ux.js) a cada 2 minutos ou quando a aba é escondida/fechada. Nada de conteúdo:
// só o nome do evento e um detalhe curto (ex.: 'esc', 'news', "Privacidade › Trocar a frase").
// Desligar: Configurações → Privacidade e segurança → "Ajudar a melhorar o app" (S.prefs.uxStats = false).
import { S } from './state.js';

const SEND_MS = 120e3, SEP = '\u0001';
const queue = new Map(), seen = new Set();
let timer = 0;
export const uxOn = () => S.prefs?.uxStats !== false;
// once: conta uma vez só por abertura do app (ex.: a mesma ⓘ aberta 5 vezes seguidas conta 1)
export function track(event, detail = '', { once = false } = {}) {
  if (!uxOn()) return;
  const k = event + SEP + String(detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (once) { if (seen.has(k)) return; seen.add(k); }
  queue.set(k, (queue.get(k) || 0) + 1);
  if (!timer) timer = setTimeout(flushUx, SEND_MS);
}
export function flushUx() {
  clearTimeout(timer); timer = 0;
  if (!queue.size || !S.token) return;
  if (!uxOn()) { queue.clear(); return; }
  const device = window.lcDesktop ? 'app' : matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  const events = [...queue].map(([k, n]) => { const [e, d] = k.split(SEP); return { e, d, n: Math.min(n, 200) }; });
  queue.clear();
  return fetch('/api/ux', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify({ device, events }) }).catch(() => { });
}
export const clearUx = () => { queue.clear(); clearTimeout(timer); timer = 0; }; // desligou: o que estava na fila não vai
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUx(); });
addEventListener('pagehide', () => flushUx());

// ---------- etapa 2: fluxos, cliques repetidos ("com raiva") e cliques sem efeito ----------
// fluxo: flow('e2ee', 'start') ao abrir, flow('e2ee', 'done') ao concluir; o painel mostra quantos terminam
export const flow = (name, step) => track('flow', name + ':' + step);

// onde foi o clique, sem nada pessoal: "área › rótulo do botão". Dentro de listas com conteúdo das pessoas (mensagens,
// membros, conversas, amigos, canais) só a classe do elemento vai, nunca o texto, o título ou o nome
const AREAS = [['.modal', 'janela'], ['.menu', 'menu'], ['#settings', 'configurações'], ['#rail', 'barra de servidores'], ['#topbar', 'barra de cima'], ['#composer', 'campo de mensagem'],
  ['#msgs', 'mensagens'], ['#members', 'membros'], ['#side', 'lista lateral'], ['#home', 'amigos'], ['#lfgview', 'jogos'], ['#discoverview', 'jogos'], ['#userbar', 'seu perfil'], ['#voicebar, #stage', 'chamada']];
const PRIVATE = '#msgs, #members, #side-list, .dmrow, .frow, .an-card, .rail-dm, [data-gid], .upbd, .lfgcard, .pv-sess';
const CLICKABLE = 'button, a, [role=button], [role=tab], [role=switch], [role=menuitem], .ni, .ch, .dtab, .rail-item, .switch, .choice, label, summary';
export function describeClick(el) {
  const t = el.closest?.(CLICKABLE) || el;
  const area = AREAS.find(([s]) => t.closest?.(s))?.[1] || 'outro';
  let label = '';
  if (!t.closest?.(PRIVATE)) label = t.getAttribute?.('aria-label') || t.getAttribute?.('title') || (t.matches?.('button, [role=button], [role=tab], .ni, .dtab, summary') ? t.textContent : '');
  label = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const cls = (t.tagName || '').toLowerCase() + (t.classList?.[0] ? '.' + t.classList[0] : '');
  return (area + ' › ' + (label || cls)).slice(0, 80);
}
const typingTag = (t) => /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(t?.tagName) || t?.isContentEditable;
let watching = false;
export function watchClicks() {
  if (watching) return; watching = true;
  let last = null; // rajada atual: { key, x, y, t, n, sent }
  let probe = null; // clique esperando para ver se algo mudou
  addEventListener('click', (e) => {
    if (!uxOn() || !e.isTrusted || typingTag(e.target)) return;
    const key = describeClick(e.target), now = performance.now();
    // com raiva: 3 cliques em 0,8 s cada, a menos de 40 px, no mesmo lugar
    if (last && last.key === key && now - last.t < 800 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) { last.n++; last.t = now; }
    else last = { key, x: e.clientX, y: e.clientY, t: now, n: 1, sent: false };
    if (last.n >= 3 && !last.sent) { last.sent = true; track('rage_click', key); }
    // sem efeito: tinha cara de clicável (cursor de mãozinha) e nada mudou na página (DOM, endereço ou foco) em 1 s
    if (probe || last.n > 1) return;
    const t = e.target.closest?.(CLICKABLE) || e.target;
    if (getComputedStyle(t).cursor !== 'pointer' || t.closest('a[href]:not([href="#"]), label, [disabled], .disabled')) return;
    const hash = location.hash, focus = document.activeElement;
    let changed = false;
    const mo = new MutationObserver(() => { changed = true; mo.disconnect(); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    probe = setTimeout(() => { mo.disconnect(); probe = null; if (!changed && location.hash === hash && document.activeElement === focus && document.visibilityState === 'visible' && !(last?.key === key && last.n >= 3)) track('dead_click', key); }, 1000); // rajada já contou como "com raiva"
  }, true);
}
