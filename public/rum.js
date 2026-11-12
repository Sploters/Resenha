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

// Travadas: quadro que segurou a página por mais de 1 s (Long Animation Frame) vai ao servidor com o script e a função que
// rodavam e o que estava aberto (chamada, câmera, tela, filtro de ruído). O heap e as Web Vitals mostram que travou
// (INP de 11 s com "input delay" de 11 s), mas não quem: isto mostra. Também sai no console (console.warn).
const freezes = []; let freezeT = 0, freezeSent = 0;
function ctx() {
  const vc = window.__lc?.voice;
  return { view: (S.view?.cid ? 'canal' : S.view?.gid ? 'servidor' : 'home') + (document.querySelector('#stage') ? '+palco' : ''), call: !!vc?.channelId, cam: !!vc?.cam, screen: !!vc?.screen,
    noise: S.prefs?.noiseMode || 'standard', hidden: document.visibilityState === 'hidden', dom: document.getElementsByTagName('*').length };
}
function sendFreezes() {
  freezeT = 0; if (!S.token || !freezes.length) return;
  const device = window.lcDesktop ? 'app' : matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop', body = { device, freezes: freezes.splice(0) };
  freezeSent += body.freezes.length;
  fetch('/api/rum/freeze', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify(body) }).catch(() => { });
}
observe('long-animation-frame', (e) => {
  if (e.duration < 1000 || freezeSent + freezes.length >= 30) return;
  const r = Math.round, scripts = [...e.scripts].sort((a, b) => b.duration - a.duration).slice(0, 5).map(x => ({ ms: r(x.duration), layout_ms: r(x.forcedStyleAndLayoutDuration), invoker: String(x.invoker).slice(0, 120), fn: x.sourceFunctionName || '', src: (x.sourceURL || '').split('/').pop().split('?')[0] + ':' + x.sourceCharPosition }));
  const f = { at: r(e.startTime), ms: r(e.duration), blocking_ms: r(e.blockingDuration), render_ms: e.renderStart ? r(e.startTime + e.duration - e.renderStart) : 0, layout_ms: e.styleAndLayoutStart ? r(e.startTime + e.duration - e.styleAndLayoutStart) : 0, scripts, ...ctx() };
  freezes.push(f); console.warn('[travada]', f.ms + ' ms', f);
  if (!freezeT) freezeT = setTimeout(sendFreezes, 5000); // várias travadas seguidas vão juntas
});
addEventListener('pagehide', sendFreezes);

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
