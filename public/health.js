// Painel "Saúde do servidor" (Configurações → Administração), só para o administrador da instalação. Lê GET /api/health
// (server/health.js) e mostra: situação geral (com ícone + texto, não só cor), números de agora, gráficos das últimas
// horas (uma medida por gráfico, com o limite do alerta tracejado e o valor ao passar o mouse), workers do SFU, tráfego
// do mês, alertas enviados, erros recentes do servidor e o que aconteceu com o SFU. Atualiza sozinho a cada 30 s.
import { h, icon } from './util.js';
import { api } from './state.js';
import { seg } from './ui.js';

const nf = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const when = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const bytes = (b) => b >= 1e12 ? nf(b / 1e12, 2) + ' TB' : b >= 1e9 ? nf(b / 1e9, 1) + ' GB' : nf(b / 1e6, 0) + ' MB';
const dur = (min) => min >= 1440 ? `${nf(Math.floor(min / 1440))} d ${nf(Math.floor(min % 1440 / 60))} h` : min >= 60 ? `${nf(Math.floor(min / 60))} h ${nf(min % 60)} min` : `${nf(min)} min`;
const card = (title, sub, ...body) => h('section.ux-card', h('header', h('h3', title), sub && h('p', sub)), ...body);
const tile = (value, label, sub) => h('div.ux-tile', h('b', value), h('span', label), sub && h('small', sub));
const empty = (t) => h('p.ux-empty', t);

// situação de cada parte: ok / atenção / problema (ícone + palavra; a cor só reforça)
const STATE = { ok: ['check', 'Normal'], warn: ['warn', 'Atenção'], bad: ['warn', 'Problema'] };
const chip = (st, label, detail) => h('div.hl-chk.' + st, h('span.hl-st', icon(STATE[st][0], 14), STATE[st][1]), h('b', label), h('span', detail));

// gráfico de linha de uma medida (uma série: o título diz o que é, sem legenda). Limite do alerta tracejado.
function lineChart(pts, { key, unit = '', max, limit, limitLabel, digits = 0, count = false, wide = false }) {
  const vals = pts.map(p => p[key]).filter(v => v != null);
  if (vals.length < 2) return empty('Juntando medidas… (uma a cada 30 s)');
  // largura do desenho perto da de verdade (texto dos eixos legível): meio cartão ~340 px, cartão inteiro ~700 px
  const W = wide ? 700 : 360, H = wide ? 150 : 140, L = 30, R = 6, T = 12, B = 18;
  // contagem de pessoas: eixo em números inteiros
  const top = max ?? (count ? Math.max(2, Math.ceil(Math.max(...vals) * 1.25 / 2) * 2) : Math.max(1, limit || 0, ...vals) * 1.1), t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0);
  const x = (t) => L + (W - L - R) * (t - t0) / span, y = (v) => T + (H - T - B) * (1 - Math.min(v, top) / top);
  // falta de amostras (servidor desligado) quebra a linha em vez de ligar os pontos
  let d = '', prev = null; const gap = 3 * Math.max(30e3, span / pts.length);
  for (const p of pts) { if (p[key] == null) { prev = null; continue; } d += `${prev && p.t - prev.t < gap ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`; prev = p; }
  const svg = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hl-svg', role: 'img', 'aria-label': `${nf(vals.at(-1), digits)}${unit} agora; máximo ${nf(Math.max(...vals), digits)}${unit}` });
  const fmt = (v) => nf(v, digits) + unit;
  for (const v of [0, top / 2, top]) { s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'hl-grid' })); const tx = svg('text', { x: L - 4, y: y(v) + 3, class: 'hl-ax', 'text-anchor': 'end' }); tx.textContent = nf(v, !count && v < 10 && top < 10 ? 1 : 0); s.append(tx); }
  if (limit) { s.append(svg('line', { x1: L, x2: W - R, y1: y(limit), y2: y(limit), class: 'hl-limit' })); const tx = svg('text', { x: W - R, y: y(limit) - 4, class: 'hl-ax', 'text-anchor': 'end' }); tx.textContent = limitLabel || 'limite do alerta'; s.append(tx); }
  for (const [t, a] of [[t0, 'start'], [t1, 'end']]) { const tx = svg('text', { x: x(t), y: H - 4, class: 'hl-ax', 'text-anchor': a }); tx.textContent = hm(t); s.append(tx); }
  s.append(svg('path', { d, class: 'hl-line' }));
  // passar o mouse: linha vertical, ponto e o valor daquele momento
  const cross = svg('line', { y1: T, y2: H - B, class: 'hl-cross', visibility: 'hidden' }), dot = svg('circle', { r: 4, class: 'hl-dot', visibility: 'hidden' });
  s.append(cross, dot);
  const tip = h('div.hl-tip', { hidden: true });
  const hit = svg('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' }); s.append(hit);
  const show = (cx) => {
    const r = s.getBoundingClientRect(), tx = t0 + span * ((cx - r.left) * W / r.width - L) / (W - L - R);
    let best = null; for (const p of pts) if (p[key] != null && (!best || Math.abs(p.t - tx) < Math.abs(best.t - tx))) best = p;
    if (!best) return;
    cross.setAttribute('x1', x(best.t)); cross.setAttribute('x2', x(best.t)); dot.setAttribute('cx', x(best.t)); dot.setAttribute('cy', y(best[key]));
    cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.replaceChildren(h('b', fmt(best[key])), h('span', hm(best.t)));
    const px = x(best.t) / W * r.width; tip.style.left = Math.min(Math.max(px, 40), r.width - 40) + 'px';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('pointermove', (e) => show(e.clientX)); hit.addEventListener('pointerleave', hide);
  return h('div.hl-chart', s, tip, h('div.hl-now', 'Agora ', h('b', fmt(vals.at(-1))), ' · máximo no período ', h('b', fmt(Math.max(...vals)))));
}

export function healthPage() {
  const body = h('div.ux-body', h('p.ux-empty', 'Carregando…'));
  let hours = 6, data = null, timer = null;
  const load = async () => {
    try { data = await api('GET', '/health'); draw(); } catch (e) { body.replaceChildren(empty('Não foi possível carregar: ' + e.message)); }
  };
  const draw = () => {
    const n = data.now || {}, L = data.limits, since = Date.now() - hours * 3600e3, pts = data.history.filter(p => p.t >= since);
    const diskFreePct = n.diskUsedPct == null ? null : 100 - n.diskUsedPct, memFreePct = n.memTotalMB ? 100 * n.memAvailMB / n.memTotalMB : null;
    const lvl = (bad, warn) => bad ? 'bad' : warn ? 'warn' : 'ok';
    const checks = [
      chip(lvl(n.cpu >= L.cpu, n.cpu >= L.cpu * 0.75), 'Processador', `${nf(n.cpu)}% de ${n.cores} núcleo(s) · carga ${nf(n.load1, 1)}`),
      chip(lvl(memFreePct != null && memFreePct <= L.mem, memFreePct != null && memFreePct <= L.mem * 2), 'Memória', `${nf(n.memAvailMB)} MB livres de ${nf(n.memTotalMB)} MB · o Resenha usa ${nf(n.procMB)} MB`),
      chip(lvl(diskFreePct != null && (diskFreePct <= L.disk || n.diskFreeGB < L.diskGB), diskFreePct != null && diskFreePct <= L.disk * 2), 'Disco', `${nf(n.diskFreeGB, 1)} GB livres de ${nf(n.diskTotalGB, 0)} GB`),
      chip(lvl(n.sfuTotal && !n.sfuAlive, n.sfuAlive < n.sfuTotal || n.workers?.some(w => w.cpu >= L.workerCpu)), 'Servidor de voz (SFU)', n.sfuTotal ? `${n.sfuAlive} de ${n.sfuTotal} worker(s) de pé` : 'desligado (voz direta entre as pessoas)'),
      chip(L.uplink ? lvl(n.upMbps >= L.uplink * 0.85, n.upMbps >= L.uplink * 0.6) : 'ok', 'Upload', L.uplink ? `${nf(n.upMbps, 1)} de ${nf(L.uplink)} Mbps do link` : `${nf(n.upMbps, 1)} Mbps (defina HEALTH_UPLINK_MBPS para alertar perto do limite)`),
    ];
    const month = data.traffic.tx + data.traffic.rx;
    body.replaceChildren(...[
      h('div.hl-checks', checks),
      h('div.ux-tiles',
        tile(nf(n.online), 'pessoas conectadas', `${nf(n.connections)} conexões (abas e aparelhos)`),
        tile(nf(n.inCalls), 'pessoas em chamada', `${nf(n.calls)} chamada(s) · ${nf(n.screens)} transmissão(ões) · ${nf(n.cams)} câmera(s)`),
        tile(`${nf(n.upMbps, 1)} Mbps`, 'upload agora', `download ${nf(n.downMbps, 1)} Mbps`),
        tile(bytes(month), 'tráfego no mês', L.monthlyTB ? `${nf(100 * month / (L.monthlyTB * 1e12))}% da franquia de ${nf(L.monthlyTB)} TB` : `enviado ${bytes(data.traffic.tx)} · recebido ${bytes(data.traffic.rx)}`)),
      h('div.ux-grid',
        card('Processador da VPS', '% de todos os núcleos', lineChart(pts, { key: 'cpu', unit: '%', max: 100, limit: L.cpu, digits: 0 })),
        card('Memória em uso', '% da memória da VPS', lineChart(pts, { key: 'mem', unit: '%', max: 100, limit: 100 - L.mem, digits: 0 }))),
      h('div.ux-grid',
        card('Upload do servidor', 'Mbps saindo da VPS (voz, vídeo, transmissões e arquivos)', lineChart(pts, { key: 'up', unit: ' Mbps', limit: L.uplink ? L.uplink * 0.85 : 0, digits: 1 })),
        card('Pessoas em chamada', 'Somando todas as salas', lineChart(pts, { key: 'inCalls', digits: 0, count: true }))),
      n.sfuTotal > 0 && card('Workers do SFU', 'Cada worker é um processo (1 núcleo). Morreu: é recriado sozinho e as chamadas voltam em segundos',
        h('div.hl-table', { role: 'table' },
          h('div.hl-tr.hd', { role: 'row' }, ['Porta', 'Situação', 'CPU agora', 'Pico', 'Salas', 'Pessoas', 'Recriado'].map(t => h('span', { role: 'columnheader' }, t))),
          n.workers.map(w => h('div.hl-tr', { role: 'row' }, h('span', String(w.port)), h('span.hl-st.' + (w.alive ? 'ok' : 'bad'), icon(w.alive ? 'check' : 'warn', 14), w.alive ? 'de pé' : 'recriando'),
            h('span', w.cpu == null ? '—' : nf(w.cpu) + '%'), h('span', nf(w.peakCpu) + '%'), h('span', nf(w.rooms)), h('span', nf(w.peers)), h('span', w.restarts ? `${w.restarts}× (último ${when(w.diedAt)})` : 'nunca')))),
        lineChart(pts, { key: 'wcpu', unit: '%', limit: L.workerCpu, digits: 0, limitLabel: 'perto de 1 núcleo', wide: true })),
      h('div.ux-grid',
        card('Alertas enviados', 'No app e, com ALERT_WEBHOOK, no celular', data.alerts.length ? h('ul.hl-log', [...data.alerts].reverse().map(a => h('li', h('time', when(a.at)), a.text))) : empty('Nenhum alerta desde que o servidor abriu.')),
        card('Voz (SFU)', 'O que aconteceu com os workers', data.sfu_events.length ? h('ul.hl-log', data.sfu_events.map(e => h('li', h('time', when(e.at)), e.text))) : empty('Nada: nenhum worker morreu.'))),
      card('Erros do servidor', `Os últimos ${data.errors.length} (todos ficam em errors.log, na pasta de dados)`, data.errors.length ? h('ul.hl-log.err', data.errors.map(e => h('li', h('time', when(e.at)), h('code', e.text)))) : empty('Nenhum erro desde que o servidor abriu.')),
      h('p.ux-note', icon('info', 14), ` Ligado há ${dur(data.uptime_min)} · Node ${data.node} · ${data.host.platform} · ${data.host.cpu || ''}. `,
        'Para ser avisado no celular, defina ALERT_WEBHOOK (ntfy ou Discord). Para saber quando o servidor cai, aponte um monitor de fora (UptimeRobot, Uptime Kuma) para ', h('code', location.origin + '/healthz'), '.'),
    ].filter(Boolean));
  };
  const root = h('div.uxstats.health', h('h2', 'Saúde do servidor'),
    h('div.ux-bar-top', h('div.ux-filters', seg([[1, '1 hora'], [6, '6 horas'], [24, '24 horas']], hours, (v) => { hours = +v; if (data) draw(); })),
      h('button.btn.grey.sm', { onclick: load }, icon('refresh', 16), 'Atualizar')),
    body);
  load();
  timer = setInterval(() => { if (!root.isConnected) return clearInterval(timer); if (!document.hidden) load(); }, 30e3);
  return root;
}
