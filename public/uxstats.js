// Painel "Estatísticas de uso" (etapa 2 da telemetria de UX), só para o administrador da instalação:
// Configurações → Administração. Lê GET /api/ux (server/ux.js) e desenha, sem biblioteca:
// - resumo (eventos no período, quantos voltam aos Amigos pelo Esc, fluxos concluídos, cliques com raiva)
// - eventos por dia (colunas), Esc × ícone (barra dividida), abas de Jogos, funis dos fluxos
// - listas: ⓘ mais abertas, buscas sem resultado, cliques com raiva e cliques sem efeito
// Tudo é contagem anônima; cada barra mostra o número ao lado e o detalhe por aparelho ao passar o mouse.
import { h, icon } from './util.js';
import { api, toast } from './state.js';
import { seg } from './ui.js';

const DEV = { desktop: 'PC', mobile: 'Celular', app: 'App desktop' };
const TABS = { lfg: 'Procurar jogadores', home: 'Início', news: 'Notícias', tournaments: 'Torneios' };
const nf = (n) => Number(n || 0).toLocaleString('pt-BR');
const pl = (n, one, many) => `${nf(n)} ${Number(n) === 1 ? one : many}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const devTip = (d) => Object.entries(DEV).map(([k, l]) => d?.[k] ? `${l}: ${nf(d[k])}` : '').filter(Boolean).join(' · ');
const empty = (t = 'Nada ainda neste período.') => h('p.ux-empty', t);
const card = (title, sub, ...body) => h('section.ux-card', h('header', h('h3', title), sub && h('p', sub)), ...body);

// barras horizontais em ordem (uma cor só: aqui a cor não identifica nada, o tamanho é o dado)
function bars(entries, { label = (k) => k, max } = {}) {
  if (!entries.length) return empty();
  const top = max ?? Math.max(...entries.map(([, v]) => v.total));
  return h('div.ux-bars', { role: 'table' }, entries.map(([k, v]) => h('div.ux-bar', { role: 'row', title: devTip(v) || null },
    h('span.ux-bl', { role: 'cell', title: label(k) }, label(k)),
    h('span.ux-bt', { role: 'cell' }, h('i', { style: { width: Math.max(2, (v.total / top) * 100) + '%' } })),
    h('b.ux-bv', { role: 'cell' }, nf(v.total)))));
}
const list = (ev, n = 10, label) => bars(Object.entries(ev?.detalhes || {}).slice(0, n), { label });

// número grande com legenda (sem gráfico: é um valor só)
const tile = (value, label, sub) => h('div.ux-tile', h('b', value), h('span', label), sub && h('small', sub));

// colunas por dia: total de eventos; os dias sem nada aparecem vazios (a série não pula datas)
function daily(rows, since, days) {
  const tot = new Map(); for (const r of rows) tot.set(r.day, (tot.get(r.day) || 0) + r.n);
  const start = new Date(since + 'T00:00:00Z'), series = [];
  for (let i = 0; i < days; i++) { const d = new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10); series.push([d, tot.get(d) || 0]); }
  const max = Math.max(1, ...series.map(([, n]) => n));
  if (!series.some(([, n]) => n)) return empty();
  const fmt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return h('div.ux-daily',
    h('div.ux-ymax', nf(max)),
    h('div.ux-cols', series.map(([d, n]) => h('div.ux-col', { title: `${fmt(d)}: ${nf(n)} eventos` }, h('i', { style: { height: (n / max) * 100 + '%' } })))),
    h('div.ux-xaxis', h('span', fmt(series[0][0])), h('span', fmt(series[series.length - 1][0]))));
}

// Esc × ícone: uma barra dividida (duas categorias, com legenda e o número escrito, não só a cor)
function split(ev) {
  const esc = ev?.detalhes?.esc?.total || 0, rail = ev?.detalhes?.rail?.total || 0, all = esc + rail;
  if (!all) return empty('Ninguém saiu de uma conversa direta ainda neste período.');
  const part = (cls, n, l, d) => n ? h('i.' + cls, { style: { flexGrow: n }, title: `${l}: ${nf(n)} (${pct(n, all)}%)${devTip(d) ? ' — ' + devTip(d) : ''}` }) : null;
  return h('div',
    h('div.ux-split', part('s1', esc, 'Esc', ev.detalhes.esc), part('s2', rail, 'Ícone de Mensagens', ev.detalhes.rail)),
    h('div.ux-legend',
      h('span', h('i.s1'), 'Esc ', h('b', `${pct(esc, all)}%`), h('small', ` (${nf(esc)})`)),
      h('span', h('i.s2'), 'Ícone de Mensagens ', h('b', `${pct(rail, all)}%`), h('small', ` (${nf(rail)})`))));
}

// funil: quantos começaram e quantos terminaram cada fluxo
function funnels(f) {
  const rows = Object.values(f || {}).filter(x => x.comecaram);
  if (!rows.length) return empty('Ninguém começou nenhum destes fluxos ainda neste período.');
  return h('div.ux-funnels', rows.sort((a, b) => b.comecaram - a.comecaram).map(x => h('div.ux-fun', { title: `${x.nome}: ${nf(x.comecaram)} começaram, ${nf(x.terminaram)} terminaram` },
    h('div.ux-fun-t', h('span', x.nome), h('b', `${x.taxa}%`), h('small', `${nf(x.terminaram)} de ${nf(x.comecaram)}`)),
    h('div.ux-bt', h('i', { style: { width: Math.max(2, x.taxa) + '%' } })))));
}

export function uxStatsPage() {
  const body = h('div.ux-body', h('p.ux-empty', 'Carregando…'));
  let days = 30, data = null;
  const load = async () => {
    body.classList.add('loading');
    try { data = await api('GET', `/ux?days=${days}`); draw(); } catch (e) { body.replaceChildren(h('p.ux-empty', 'Não foi possível carregar: ' + e.message)); }
    body.classList.remove('loading');
  };
  const draw = () => {
    const E = data.eventos || {}, total = Object.values(E).reduce((n, e) => n + e.total, 0);
    const back = E.back_to_friends?.detalhes || {}, esc = back.esc?.total || 0, backAll = esc + (back.rail?.total || 0);
    const fl = Object.values(data.funis || {}), st = fl.reduce((n, x) => n + x.comecaram, 0), dn = fl.reduce((n, x) => n + Math.min(x.terminaram, x.comecaram), 0);
    const tabs = Object.entries(E.games_tab?.detalhes || {});
    body.replaceChildren(
      h('div.ux-tiles',
        tile(nf(total), total === 1 ? 'evento contado' : 'eventos contados', `nos últimos ${data.dias} dias`),
        tile(backAll ? pct(esc, backAll) + '%' : '—', 'voltam aos Amigos pelo Esc', backAll ? `${nf(esc)} de ${nf(backAll)}` : 'sem dados'),
        tile(st ? pct(dn, st) + '%' : '—', 'dos fluxos são concluídos', st ? `${nf(dn)} de ${nf(st)}` : 'sem dados'),
        tile(nf(E.rage_click?.total), (E.rage_click?.total || 0) === 1 ? 'clique com raiva' : 'cliques com raiva', pl(E.dead_click?.total || 0, 'clique sem efeito', 'cliques sem efeito'))),
      card('Eventos por dia', null, daily(data.por_dia || [], data.desde, data.dias)),
      h('div.ux-grid',
        card('Voltar para Amigos', 'Como as pessoas saem de uma conversa direta', split(E.back_to_friends)),
        card('Abas de Jogos', `Seção aberta ${pl(E.games_open?.total || 0, 'vez', 'vezes')} pela barra`, bars(tabs, { label: (k) => TABS[k] || k }))),
      card('Fluxos', 'Quantos terminam o que começaram', funnels(data.funis)),
      h('div.ux-grid',
        card('Explicações mais abertas', 'ⓘ abertas: muito aberta = o texto curto não basta', list(E.info_tip)),
        card('Buscas sem resultado', 'O que procuram nas Configurações e não acham', list(E.settings_search_empty))),
      h('div.ux-grid',
        card('Cliques com raiva', '3 cliques rápidos no mesmo lugar', list(E.rage_click)),
        card('Cliques sem efeito', 'Parecia botão, mas nada mudou em 1 s', list(E.dead_click))));
  };
  const dl = () => { if (!data) return; const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `estatisticas-uso-${data.desde}.json` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Arquivo baixado'); };
  load();
  return h('div.uxstats', h('h2', 'Estatísticas de uso'),
    h('div.ux-bar-top', seg([[7, '7 dias'], [30, '30 dias'], [60, '60 dias']], days, (v) => { days = +v; load(); }),
      h('button.btn.grey.sm', { onclick: dl }, icon('dl', 16), 'Baixar dados (JSON)')),
    h('p.ux-note', icon('shield', 14), ' Contagens anônimas de quem deixou ligado "Enviar estatísticas de uso" em Privacidade. Sem nomes e sem mensagens; ficam 60 dias.'),
    body);
}
