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
