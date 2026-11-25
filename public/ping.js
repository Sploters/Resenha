// Ping com o servidor: medida, gráfico e a qualidade automática da voz.
import { h, icon, whenGone } from './util.js';
import { S, popout, savePrefs } from './state.js';
import { VOICE_BITRATES } from './voice.js';
import { seg } from './ui.js';
import { ws, voice, gwSend } from './gateway.js';
// latência até o servidor (SFU) ou pior par (malha): Wi-Fi colorido; passar o mouse = ms; clicar = gráfico do último minuto
const pingHist = []; // [{ t, ms }] dos últimos 60 s
const lastPing = () => pingHist.at(-1)?.ms ?? null;
const pingLevel = (p) => (p == null ? '' : p < 80 ? 'good' : p < 200 ? 'mid' : 'bad');
export const pingEl = () => { const el = h('button#vp-ping.ping', { onclick: (e) => openPingChart(e.currentTarget) }, icon('wifi', 16)); paintPing(el); return el; };
// só mexe no que mudou: trocar className/title à toa faz o navegador recalcular o estilo da página
const setIf = (el, k, v) => { if (el[k] !== v) el[k] = v; };
function paintPing(el) {
  const p = lastPing();
  setIf(el, 'className', 'ping ' + pingLevel(p));
  setIf(el, 'title', p == null ? 'Medindo a conexão…' : `Ping: ${p} ms — clique para ver a conexão e a qualidade da voz`);
}
// ida e volta pelo gateway: funciona mesmo sem transporte de mídia conectado (sem microfone, sozinho ouvindo)
export const wsPings = new Map(); let wsPingN = 0;
export function wsPing() {
  return new Promise((resolve) => {
    const n = ++wsPingN, t0 = performance.now();
    const done = (v) => { wsPings.delete(n); resolve(v); };
    wsPings.set(n, () => done(Math.round(performance.now() - t0)));
    if (ws?.readyState !== 1) return done(null);
    gwSend('PING', { n });
    setTimeout(() => wsPings.has(n) && done(null), 5000);
  });
}
function updatePing() {
  if (!voice.active) { pingHist.length = 0; return; }
  const cid = voice.channelId;
  Promise.resolve().then(() => voice.ping()).catch(() => null).then(p => p ?? wsPing()).then(p => {
    if (voice.channelId !== cid) return;
    const now = Date.now();
    if (p != null) pingHist.push({ t: now, ms: p });
    while (pingHist.length && now - pingHist[0].t > 60000) pingHist.shift();
    const el = document.getElementById('vp-ping'); if (el) paintPing(el);
    document.dispatchEvent(new Event('ping-sample'));
  });
}
// janela escondida/minimizada: mede a cada 5 s em vez de 1 s (ninguém está olhando o selo; o gráfico só fica mais espaçado)
let pingTick = 0;
setInterval(() => (voice?.active ? (!document.hidden || ++pingTick % 5 === 0) && updatePing() : (pingHist.length = 0)), 1000);
// qualidade da voz: selo no painel (nível atual) e ajuste automático a cada 3 s
const isAutoAbr = () => S.prefs.voiceBitrate === 'auto' || S.prefs.voiceBitrate == null;
// (fica dentro do popup do sinal de conexão: a qualidade enviada depende dela, e ninguém precisa ver o número o tempo todo)
function paintAbr(el) {
  const k = voice.micKbps(), auto = isAutoAbr();
  setIf(el, 'textContent', `${auto ? 'Automático · ' : ''}${k} kbps${voice.sentKbps != null ? ` (enviando ~${voice.sentKbps})` : ''}`);
}
function abrSection() {
  const now = h('b.abr-now'); paintAbr(now);
  return h('div.abrsec', h('div.abrsec-h', h('h4', 'Qualidade da voz'), now),
    seg(VOICE_BITRATES, isAutoAbr() ? 'auto' : S.prefs.voiceBitrate, (v) => { S.prefs.voiceBitrate = v; savePrefs(); voice.retuneAudio(); paintAbr(now); }),
    h('div.hintline', 'Automático (recomendado): voz mono a 64 kbps, que já soa perfeita, descendo para 48 ou 32 se a sua conexão piorar. 128 kbps ou mais só vale para música, e pesa para todos: o servidor repassa a sua voz para cada pessoa da sala.'));
}
setInterval(() => {
  if (!voice?.active) return;
  voice.adaptAudio().catch(() => { }).then(() => document.querySelectorAll('.abr-now').forEach(paintAbr));
}, 3000);
function openPingChart(anchor) {
  const W = 300, H = 120, L = 34, R = 8, T = 10, B = 20;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pchart'); svg.setAttribute('role', 'img');
  const avgEl = h('b'), lastEl = h('b'), rangeEl = h('b'), tip = h('div.ptip.hidden'), connBox = h('div.pconn');
  const body = h('div.qpop.pingpop', h('h4', 'Ping até o servidor — último minuto'), h('div.pwrap', svg, tip),
    h('div.pstats', h('div', h('small', 'Último'), lastEl), h('div', h('small', 'Média'), avgEl), h('div', h('small', 'Mín – máx'), rangeEl)), connBox, abrSection());
  const ns = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let pts = [];
  const draw = () => {
    const now = Date.now(), data = pingHist.filter(s => now - s.t <= 60000);
    const vals = data.map(s => s.ms), max = Math.max(50, ...vals), top = Math.ceil(max * 1.2 / 20) * 20;
    const x = (t) => L + (W - L - R) * (1 - (now - t) / 60000), y = (ms) => T + (H - T - B) * (1 - ms / top);
    svg.replaceChildren();
    for (const v of [0, top / 2, top]) { // grade discreta + rótulos
      svg.append(ns('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'pgrid' }));
      const tx = ns('text', { x: L - 6, y: y(v) + 4, class: 'paxis', 'text-anchor': 'end' }); tx.textContent = Math.round(v); svg.append(tx);
    }
    for (const [t, lbl] of [[now - 60000, '-60s'], [now - 30000, '-30s'], [now, 'agora']]) { const tx = ns('text', { x: x(t), y: H - 4, class: 'paxis', 'text-anchor': t === now ? 'end' : t === now - 60000 ? 'start' : 'middle' }); tx.textContent = lbl; svg.append(tx); }
    pts = data.map(s => ({ ...s, x: x(s.t), y: y(s.ms) }));
    if (pts.length > 1) svg.append(ns('polyline', { points: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), class: 'pline' }));
    if (pts.length) { const p = pts.at(-1); svg.append(ns('circle', { cx: p.x, cy: p.y, r: 4, class: 'pdot' })); }
    if (!pts.length) { const tx = ns('text', { x: (L + W - R) / 2, y: H / 2, class: 'paxis', 'text-anchor': 'middle' }); tx.textContent = 'Medindo…'; svg.append(tx); }
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    lastEl.textContent = vals.length ? `${vals.at(-1)} ms` : '—'; avgEl.textContent = avg != null ? `${avg} ms` : '—';
    rangeEl.textContent = vals.length ? `${Math.min(...vals)} – ${Math.max(...vals)} ms` : '—';
    svg.setAttribute('aria-label', `Ping no último minuto: média ${avg ?? '—'} ms, último ${vals.at(-1) ?? '—'} ms`);
    paintConn(vals);
  };
  // diagnóstico: protocolo, perda, oscilação e o que fazer
  // refazendo a mídia (sem transporte agora): ci vazio mostra o aviso de voz sem conectar
  let ci = null; const readConn = () => voice?.connInfo?.().then(x => { ci = x || (voice?.recovering ? { proto: null } : null); paintConn(pingHist.filter(s => Date.now() - s.t <= 60000).map(s => s.ms)); }).catch(() => { });
  const paintConn = (vals) => {
    if (!ci) return connBox.replaceChildren(h('small', 'Analisando a conexão…'));
    const loss = Math.max(ci.sendLoss ?? 0, ci.recvLoss ?? 0), spread = vals.length > 5 ? Math.max(...vals) - Math.min(...vals) : 0, avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const tips = [];
    // o ping acima vem do WebSocket (passa pelo site/túnel); a voz vai direto à porta 40000 do servidor. Sem par ICE
    // escolhido, a mídia não conectou: o número bom do ping não diz nada sobre a voz
    const noMedia = !ci.proto && (voice?.recovering || ['failed', 'disconnected', 'connecting'].includes(voice?.sfu?.send?.connectionState));
    const hasTurn = (S.ice || []).some(x => [].concat(x.urls).some(u => /^turns?:/.test(u)));
    const v6 = ci.v6;
    const rl = ci.relay;
    if (noMedia && hasTurn && rl && (v6?.local ? !(v6.sent > 0 && !v6.answered) : true)) tips.push(['bad', !rl.v4 && !rl.v6
      ? 'A voz não conectou, nem pelo servidor TURN: a sua rede pode estar bloqueando o TURN. Com a VPN (Tailscale) ligada neste aparelho a voz vai direto.'
      : rl.v6 ? 'A voz não conectou, nem pelo servidor TURN (ele entregou um endereço IPv6, mas o servidor de voz não respondeu nele).'
        : 'A voz não conectou: o servidor TURN só entregou um endereço IPv4, e de fora o servidor de voz só aceita IPv6. Por enquanto, sem IPv6 na sua internet, use a VPN (Tailscale) neste aparelho.']);
    else if (noMedia && v6?.remote) tips.push(['bad', !v6.local
      ? 'A voz não conectou: a internet deste aparelho não tem IPv6, e fora da VPN a voz só chega ao servidor por IPv6. Ligue a VPN (Tailscale) neste aparelho, ou use outra rede (o 4G costuma ter IPv6).'
      : v6.sent > 0 && !v6.answered ? 'A voz não conectou: esta internet tem IPv6, mas o servidor não respondeu nele. A porta da voz por IPv6 (40030 UDP/TCP) está bloqueada no caminho, normalmente no firewall IPv6 do roteador do servidor.'
        : 'Conectando a voz pelo IPv6…']);
    else if (noMedia) tips.push(['bad', hasTurn
      ? 'A voz não conectou, nem pelo servidor TURN: a sua rede pode estar bloqueando a porta do TURN (3478), ou o TURN está fora do ar. Com a VPN (Tailscale) ligada neste aparelho a voz vai direto.'
      : 'A voz não conectou: o app fala com o servidor pelo site, mas a voz vai direto ao servidor e não chegou. Fora da VPN (Tailscale), ela só chega se a sua internet tiver IPv6; sem IPv6, ligue a VPN neste aparelho.']);
    if (ci.proto === 'tcp') tips.push(['bad', 'A conexão de voz está indo por TCP: o UDP parece bloqueado na sua rede (ou na VPN). TCP atrasa a voz quando há qualquer perda. Peça para liberar a porta 40000/UDP do servidor.']);
    if (loss > .02) tips.push(['bad', `Perda de pacotes de ${(loss * 100).toFixed(1)}%: a voz pode picotar. Wi-Fi fraco ou rede congestionada são as causas mais comuns; cabo de rede ajuda muito.`]);
    if (spread > 80 || (ci.jitterMs ?? 0) > 30) tips.push(['mid', 'Ping instável (variando muito): costuma ser Wi-Fi, download pesado na mesma rede ou a VPN passando por um relay em vez de ligar direto.']);
    if (avg > 120) tips.push(['mid', `Ping alto (${Math.round(avg)} ms). Se a VPN (Tailscale) estiver usando um relay, uma conexão direta reduz bastante: no seu computador, rode tailscale ping ${location.hostname} — se aparecer "via DERP", a ligação não está direta.`]);
    connBox.replaceChildren(
      h('div.pcrow', h('span', 'Conexão'), h('b', ci.proto ? [ci.proto.toUpperCase() + (ci.candidate === 'relay' ? ' via TURN' : ''), ci.proto === 'udp' && icon('check', 14)] : '—'), h('span', 'Perda'), h('b', `${(loss * 100).toFixed(1)}%`), h('span', 'Oscilação'), h('b', ci.jitterMs != null ? `${ci.jitterMs} ms` : '—')),
      ...(tips.length ? tips.map(([k, t]) => h('div.ptipline.' + k, t)) : [h('div.ptipline.good', 'Conexão boa e estável.')]));
  };
  readConn();
  document.addEventListener('ping-sample', readConn); queueMicrotask(() => whenGone(body, () => document.removeEventListener('ping-sample', readConn)));
  // dica ao passar o mouse: amostra mais próxima
  svg.addEventListener('mousemove', (e) => {
    if (!pts.length) return;
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width);
    const p = pts.reduce((a, b) => (Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a));
    svg.querySelector('.pcross')?.remove(); svg.querySelector('.phov')?.remove();
    svg.append(ns('line', { x1: p.x, x2: p.x, y1: T, y2: H - B, class: 'pcross' }), ns('circle', { cx: p.x, cy: p.y, r: 4, class: 'pdot phov' }));
    tip.textContent = `${p.ms} ms · há ${Math.round((Date.now() - p.t) / 1000)} s`; tip.classList.remove('hidden');
    tip.style.left = Math.min(r.width - 110, Math.max(0, p.x * r.width / W - 50)) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); svg.querySelector('.pcross')?.remove(); svg.querySelector('.phov')?.remove(); });
  draw();
  const onSample = () => { if (tip.classList.contains('hidden')) draw(); };
  document.addEventListener('ping-sample', onSample); queueMicrotask(() => whenGone(body, () => document.removeEventListener('ping-sample', onSample)));
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, r.left) + 'px';
}
