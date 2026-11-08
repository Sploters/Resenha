// Velocidade real de quem usa (RUM), sem serviço de fora: uma vez por abertura manda ao servidor (POST /api/rum)
// quanto o app levou para ficar pronto, as Web Vitals (primeira pintura, LCP, CLS, INP), o tempo da 1ª resposta
// (TTFB) e as chamadas à API que passaram de 300 ms. O administrador vê em GET /api/perf (server/perf.js), separado
// por app desktop, celular e computador.
import { S } from './state.js';

const v = { cls: 0, inp: 0 };
const observe = (type, fn, opts = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch { } };
observe('largest-contentful-paint', (e) => { v.lcp = e.startTime; });
observe('layout-shift', (e) => { if (!e.hadRecentInput) v.cls += e.value; });
observe('event', (e) => { if (e.interactionId) v.inp = Math.max(v.inp, e.duration); }, { durationThreshold: 40 }); // INP aproximado: a interação mais lenta
observe('paint', (e) => { if (e.name === 'first-contentful-paint') v.fcp = e.startTime; });

let sent = false;
function send() {
  if (sent || !S.token || v.ready == null) return; sent = true;
  const nav = performance.getEntriesByType('navigation')[0];
  const device = window.lcDesktop ? 'app' : matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  const r = (x) => (x == null ? undefined : Math.round(x));
  const body = { device, ready: r(v.ready), fcp: r(v.fcp), lcp: r(v.lcp), cls: +v.cls.toFixed(3), inp: v.inp ? r(v.inp) : undefined, ttfb: r(nav?.responseStart), api: S.apiSlow.slice(0, 20) };
  fetch('/api/rum', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify(body) }).catch(() => { });
}
// chamado quando o app fica pronto pela primeira vez; manda 20 s depois (já com as primeiras interações) ou ao sair da página
export function rumReady() {
  if (v.ready != null) return;
  v.ready = performance.now();
  setTimeout(send, 20e3);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
}
