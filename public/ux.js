// Telemetria de UX: conta, sem dizer quem, o que as pessoas fazem em alguns pontos escolhidos e manda os totais ao
// servidor (POST /api/ux, server/ux.js) a cada 2 minutos ou quando a aba é escondida/fechada. Nada de conteúdo: só o nome
// do evento e um detalhe curto (ex.: 'esc', 'news', "Privacidade › Trocar a frase"), mais a versão do app e o aparelho.
// Desligar: Configurações → Privacidade e segurança → "Enviar estatísticas de uso anônimas" (S.prefs.uxStats = false).
// Para não pesar: track() só soma num Map (nada de rede, nada de DOM); no máximo MAX_EVENTS por abertura; com a aba
// escondida não conta interação; se o servidor desligar a coleta (UX_TELEMETRY=0), o app para de juntar.
import { S, toastHooks, menuHooks } from './state.js';

const SEND_MS = 120e3, SEP = '\u0001', MAX_EVENTS = 1500;
const queue = new Map(), seen = new Set();
let timer = 0, counted = 0, serverOff = false;
// versão do app = a versão no endereço dos módulos (?v=…, troca a cada atualização do servidor)
export const UX_VERSION = (() => { try { return new URL(import.meta.url).searchParams.get('v') || 'dev'; } catch { return 'dev'; } })();
export const uxOn = () => !serverOff && S.prefs?.uxStats !== false;
// once: conta uma vez só por abertura do app (ex.: a mesma ⓘ aberta 5 vezes seguidas conta 1)
// bg: conta mesmo com a aba escondida (erros, tempo desconectado); o resto só conta com o app à vista
export function track(event, detail = '', { once = false, bg = false } = {}) {
  if (!uxOn() || counted >= MAX_EVENTS || (!bg && document.visibilityState === 'hidden')) return;
  const k = event + SEP + String(detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (once) { if (seen.has(k)) return; seen.add(k); }
  counted++;
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
  sentLog.unshift({ at: Date.now(), version: UX_VERSION, device, events }); if (sentLog.length > 30) sentLog.pop();
  return fetch('/api/ux', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify({ version: UX_VERSION, device, events }) })
    .then(r => r.json()).then(j => { if (j?.disabled) { serverOff = true; queue.clear(); } }).catch(() => { });
}
// "Ver o que é enviado" (Privacidade): o que está na fila agora e as últimas remessas desta abertura do app
const sentLog = [];
export const uxPending = () => [...queue].map(([k, n]) => { const [e, d] = k.split(SEP); return { e, d, n }; });
export const uxSent = () => sentLog.slice();
export const clearUx = () => { queue.clear(); clearTimeout(timer); timer = 0; }; // desligou: o que estava na fila não vai
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUx(); });
addEventListener('pagehide', () => flushUx());

// ---------- tempos: guardados em faixas (o servidor só vê quantos caíram em cada uma) ----------
const BUCKETS = [100, 250, 500, 1000, 2500, 5000];
export const bucketOf = (ms) => { const i = BUCKETS.findIndex(b => ms <= b); return i < 0 ? BUCKETS.length : i; };
export function timing(metric, ms, opts) { if (Number.isFinite(ms) && ms >= 0 && ms < 600e3) track('timing', metric + ':' + bucketOf(ms), opts); }
// cronômetro nomeado: start('channel_switch'); … stop('channel_switch') mede e conta (um por vez por nome)
const marks = new Map();
export const startTimer = (name, key = '') => marks.set(name, { t: performance.now(), key });
export function stopTimer(name, key = '') {
  const m = marks.get(name); if (!m || (key && m.key && m.key !== key)) return;
  marks.delete(name);
  // a aba ficou escondida no meio: o tempo não diz nada sobre o app
  if (document.visibilityState !== 'visible') return null;
  const ms = performance.now() - m.t; timing(name, ms); return ms; // devolve o tempo medido (para detalhar os lentos)
}
export const cancelTimer = (name) => marks.delete(name);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') for (const k of [...marks.keys()]) if (k !== 'ws_offline') marks.delete(k); });

// ---------- erros: agrupados pela forma, sem números, aspas, endereços ou ids ----------
export const normErr = (t) => String(t || '').replace(/https?:\/\/\S+/g, '<url>').replace(/(["'`«“]).*?(["'`»”])/g, '"…"').replace(/\b[0-9a-f]{8,}\b/gi, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const fileOf = (u) => String(u || '').split('/').pop().split('?')[0];
function onError(msg, file, line) {
  const where = file ? ` @ ${fileOf(file)}:${line || '?'}` : '';
  track('js_error', (normErr(msg).slice(0, 110) || 'erro sem mensagem') + where, { once: true, bg: true });
}
// "Script error." sem arquivo: erro de um script de fora (extensão do navegador, outro site) — o navegador esconde tudo, não ajuda
addEventListener('error', (e) => { if ((e.error || e.message) && !(/^Script error\.?$/.test(e.message) && !e.filename)) onError(e.message, e.filename, e.lineno); });
addEventListener('unhandledrejection', (e) => {
  const r = e.reason, st = String(r?.stack || '').split('\n').find(l => /\.js/.test(l)) || '', m = /([\w.-]+\.js)(?:\?[^:]*)?:(\d+)/.exec(st);
  if (r?.name === 'AbortError') return; // cancelado de propósito
  onError((r?.name && r?.name !== 'Error' ? r.name + ': ' : '') + (r?.message || r), m?.[1], m?.[2]);
});
// avisos de erro mostrados na tela (toast vermelho)
// (registrado depois de todos os módulos carregarem: state.js → e2ee.js → ux.js formam um ciclo de imports)
queueMicrotask(() => toastHooks.push((msg, err) => { if (err) track('error_shown', normErr(typeof msg === 'string' ? msg : msg?.textContent).slice(0, 100), { bg: true }); }));

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
    const c0 = performance.now(); try { onClick(e); } finally { const ms = performance.now() - c0; uxCost.n++; uxCost.total += ms; if (ms > uxCost.max) uxCost.max = ms; }
  }, true);
  function onClick(e) {
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
  }
}
// quanto a telemetria custa por clique (o teste exige média abaixo de 1 ms)
export const uxCost = { n: 0, total: 0, max: 0 };

// ---------- navegação: idas e voltas rápidas e menus abandonados ----------
// navTo(chave, rótulo) a cada troca de tela: de A para B e de volta para A em menos de 3 s = entrou no lugar errado
const nav = [];
export function navTo(key, label) {
  const now = performance.now(), b = nav[nav.length - 1], a = nav[nav.length - 2];
  if (b?.key === key) return;
  if (a && a.key === key && now - b.t < 3000) track('u_turn', `${a.label} → ${b.label}`);
  nav.push({ key, label, t: now }); if (nav.length > 3) nav.shift();
}
// página das Configurações aberta pela pessoa e deixada em menos de 2 s SEM seguir adiante: fechou as Configurações ou
// voltou para a página de antes (a primeira, que abre sozinha, não conta). Passar de página em página olhando a lista
// (A → B → C) não conta mais: no 1º teste isso dava 80 "saídas" espalhadas por todas as páginas, sem dizer nada.
let page = null;
export function settingsPage(label, { initial = false, closing = false } = {}) {
  const now = performance.now();
  if (page && !page.initial && now - page.t < 2000 && (closing || label === page.prev)) track('quick_exit', 'configurações › ' + page.label);
  page = closing ? null : { label, t: now, initial, prev: page?.label };
}
queueMicrotask(() => menuHooks.push((what, e, key) => {
  if (!uxOn()) return;
  const where = describeClick(e?.target || document.body);
  if (what === 'pick') { if (/^[a-z_]{1,24}$/.test(key || '')) track('menu_pick', where.slice(0, 55) + ' › ' + key); }
  else track(what === 'open' ? 'menu_open' : 'menu_abandoned', where);
}));
