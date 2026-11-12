// Painel "Estatísticas de uso" (telemetria de UX), só para o administrador da instalação: Configurações → Administração.
// Lê GET /api/ux (server/ux.js) e desenha, sem biblioteca, em blocos que respondem uma pergunta cada:
// - Pessoas: ativos (hoje, 7 e 30 dias), ativos por dia, retenção e o funil de quem é novo
// - Desempenho: quanto demora trocar de canal, mandar mensagem, entrar na voz; quedas de conexão e falhas na voz
// - Chamadas: avaliação ("Teve algum problema?") e a qualidade técnica medida em toda chamada (public/callqual.js)
// - Erros: erros do app e avisos de erro mostrados na tela
// - Encontrar as coisas: idas e voltas rápidas, páginas deixadas em 2 s, menus abandonados, buscas sem resultado, ⓘ
// - Fluxos, Amigos/Jogos e cliques com raiva / sem efeito
// Filtros: período (7/30/60 dias) e versão do app (para comparar antes e depois de uma atualização).
// Tudo é contagem anônima; cada barra mostra o número ao lado e o detalhe por aparelho ao passar o mouse.
import { h, icon } from './util.js';
import { api, toast } from './state.js';
import { seg } from './ui.js';
import { UX_VERSION } from './ux.js';

const DEV = { desktop: 'PC', mobile: 'Celular', app: 'App desktop' };
const TABS = { lfg: 'Procurar jogadores', home: 'Início', news: 'Notícias', tournaments: 'Torneios' };
const VOICE_FAIL = { join_error: 'Erro ao entrar', sfu_error: 'Falha no servidor de mídia', ice_failed: 'Conexão de áudio caiu', outdated: 'App desatualizado', calls_off: 'Pessoa não aceita ligações', denied: 'Recusado pelo servidor' };
const nf = (n) => Number(n || 0).toLocaleString('pt-BR');
const pl = (n, one, many) => `${nf(n)} ${Number(n) === 1 ? one : many}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const ms = (v) => (v == null ? 'mais de 5 s' : v >= 1000 ? (v / 1000).toLocaleString('pt-BR') + ' s' : v + ' ms');
const devTip = (d) => Object.entries(DEV).map(([k, l]) => d?.[k] ? `${l}: ${nf(d[k])}` : '').filter(Boolean).join(' · ');
const empty = (t = 'Nada ainda neste período.') => h('p.ux-empty', t);
const card = (title, sub, ...body) => h('section.ux-card', h('header', h('h3', title), sub && h('p', sub)), ...body);
const block = (title, sub) => h('div.ux-block', h('h3', title), sub && h('p', sub));
const fmtDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });

// barras horizontais em ordem (uma cor só: aqui a cor não identifica nada, o tamanho é o dado)
function bars(entries, { label = (k) => k, value = (v) => v.total, text = (v) => nf(v.total), max } = {}) {
  if (!entries.length) return empty();
  const top = max ?? Math.max(1, ...entries.map(([, v]) => value(v)));
  return h('div.ux-bars', { role: 'table' }, entries.map(([k, v]) => h('div.ux-bar' + (v.escondido ? '.muted' : ''), { role: 'row', title: v.tip || devTip(v) || null },
    h('span.ux-bl', { role: 'cell', title: label(k) }, label(k)),
    h('span.ux-bt', { role: 'cell' }, h('i', { style: { width: Math.max(2, (value(v) / top) * 100) + '%' } })),
    h('b.ux-bv', { role: 'cell' }, text(v)))));
}
const list = (ev, n = 10, label) => bars(Object.entries(ev?.detalhes || {}).slice(0, n), { label });

// número grande com legenda (sem gráfico: é um valor só)
const tile = (value, label, sub) => h('div.ux-tile', h('b', value), h('span', label), sub && h('small', sub));

// colunas por dia; os dias sem nada aparecem vazios (a série não pula datas)
function daily(rows, since, days, unit = 'eventos') {
  const tot = new Map(); for (const r of rows) tot.set(r.day, (tot.get(r.day) || 0) + r.n);
  const start = new Date(since + 'T00:00:00Z'), series = [];
  for (let i = 0; i < days; i++) { const d = new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10); series.push([d, tot.get(d) || 0]); }
  const max = Math.max(1, ...series.map(([, n]) => n));
  if (!series.some(([, n]) => n)) return empty();
  return h('div.ux-daily',
    h('div.ux-ymax', nf(max)),
    h('div.ux-cols', series.map(([d, n]) => h('div.ux-col', { title: `${fmtDay(d)}: ${nf(n)} ${unit}` }, h('i', { style: { height: (n / max) * 100 + '%' } })))),
    h('div.ux-xaxis', h('span', fmtDay(series[0][0])), h('span', fmtDay(series[series.length - 1][0]))));
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

// funil genérico: [{ nome, n, de }] → barra com a taxa e "x de y"
const funnelRows = (rows) => h('div.ux-funnels', rows.map(x => h('div.ux-fun', { title: `${x.nome}: ${nf(x.n)} de ${nf(x.de)}` },
  h('div.ux-fun-t', h('span', x.nome), h('b', x.de ? `${pct(x.n, x.de)}%` : '—'), h('small', `${nf(x.n)} de ${nf(x.de)}`)),
  h('div.ux-bt', h('i', { style: { width: Math.max(x.n ? 2 : 0, pct(x.n, x.de)) + '%' } })))));
function funnels(f) {
  const rows = Object.values(f || {}).filter(x => x.comecaram).sort((a, b) => b.comecaram - a.comecaram);
  return rows.length ? funnelRows(rows.map(x => ({ nome: x.nome, n: Math.min(x.terminaram, x.comecaram), de: x.comecaram }))) : empty('Ninguém começou nenhum destes fluxos ainda neste período.');
}

// tempos: mediana e "95% até", com a distribuição em faixas (colunas pequenas) e o detalhe por aparelho
function timings(t, faixas) {
  const rows = Object.entries(t || {}).filter(([, v]) => v.geral);
  if (!rows.length) return empty('Nenhuma medição ainda neste período.');
  const labels = faixas.map((b, i) => (b == null ? `> ${ms(faixas[i - 1])}` : `até ${ms(b)}`));
  return h('div.ux-times', { role: 'table' },
    h('div.ux-trow.head', { role: 'row' }, h('span', 'O quê'), h('span', 'Metade até'), h('span', '95% até'), h('span', 'Distribuição'), h('span', 'Medições')),
    rows.map(([, v]) => {
      const g = v.geral, max = Math.max(1, ...g.faixas);
      const devs = Object.entries(v.aparelhos).filter(([, q]) => q).map(([k, q]) => `${DEV[k] || k}: metade até ${ms(q.p50)}, 95% até ${ms(q.p95)} (${nf(q.n)})`).join('\n');
      return h('div.ux-trow', { role: 'row', title: devs || null },
        h('span', v.nome), h('b', ms(g.p50)), h('b', ms(g.p95)),
        h('span.ux-hist', g.faixas.map((n, i) => h('i', { title: `${labels[i]}: ${nf(n)}`, style: { height: Math.max(n ? 8 : 0, (n / max) * 100) + '%' } }))),
        h('small', nf(g.n)));
    }));
}

// menus: quantos foram fechados sem escolher nada, por menu (só os abertos pelo menos 3 vezes)
function menus(E) {
  const open = E.menu_open?.detalhes || {}, ab = E.menu_abandoned?.detalhes || {};
  const rows = Object.entries(open).filter(([, v]) => v.total >= 3).map(([k, v]) => [k, { total: ab[k]?.total || 0, de: v.total, tip: `${k}: ${nf(ab[k]?.total || 0)} de ${nf(v.total)} fechados sem escolher` }])
    .sort((a, b) => b[1].total / b[1].de - a[1].total / a[1].de).slice(0, 10);
  return rows.length ? bars(rows, { value: (v) => pct(v.total, v.de), max: 100, text: (v) => `${pct(v.total, v.de)}%` }) : empty('Poucos menus abertos ainda (cada um precisa de 3 aberturas).');
}

function people(p, data) {
  if (!p) return empty();
  const r = p.retencao, rrow = (nome, x) => ({ nome, n: x.voltaram, de: x.elegiveis });
  const steps = p.funil_novos || [];
  return [
    h('div.ux-tiles',
      tile(nf(p.ativos.hoje), 'ativos hoje'),
      tile(nf(p.ativos.d7), 'ativos em 7 dias', p.ativos.d30 ? `${pct(p.ativos.d7, p.ativos.d30)}% dos ativos do mês` : null),
      tile(nf(p.ativos.d30), 'ativos em 30 dias'),
      tile(nf(p.novos), p.novos === 1 ? 'conta nova' : 'contas novas', `nos últimos ${data.dias} dias`)),
    h('div.ux-grid',
      card('Ativos por dia', 'Pessoas diferentes que abriram o app', daily(p.por_dia || [], data.desde, data.dias, 'pessoas')),
      card('Retenção', 'Dos novos que já tiveram tempo, quantos voltaram',
        r.d1.elegiveis || r.d7.elegiveis ? funnelRows([rrow('No dia seguinte', r.d1), rrow('Na 2ª semana (dias 7–13)', r.d7), rrow('No 2º mês (dias 30–36)', r.d30)].filter(x => x.de)) : empty('Ainda não há contas novas com tempo para voltar.'))),
    card('Primeiros passos de quem é novo', p.novos ? `Das ${pl(p.novos, 'conta criada', 'contas criadas')} no período` : null,
      p.novos ? funnelRows(steps.map(s => ({ nome: s.nome, n: s.n, de: p.novos }))) : empty('Nenhuma conta nova neste período.')),
  ];
}

// resumo da semana (os mesmos itens que o administrador recebe toda segunda): cada linha com ícone + texto, nunca só cor
function digestCard() {
  const box = h('section.ux-card.ux-digest', h('p.ux-empty', 'Montando o resumo da semana…'));
  const TONE = { bom: ['check', 'Melhorou'], ruim: ['warn', 'Atenção'], neutro: ['dot', ''] };
  const draw = (d) => box.replaceChildren(
    h('header', h('h3', 'Resumo da semana'), h('p', `${fmtDay(d.de)} a ${fmtDay(d.ate)} comparado com os 7 dias anteriores · chega toda segunda às 9 h`)),
    h('p.ux-dg-title', d.titulo),
    d.linhas.length ? h('ul.ux-dg', d.linhas.map(l => h('li.' + l.tom, h('span.ux-dg-ic', { title: TONE[l.tom]?.[1] || null }, icon(TONE[l.tom]?.[0] || 'dot', 14)), h('span', l.texto)))) : null,
    h('button.btn.grey.sm', { onclick: async () => { try { draw(await api('POST', '/ux/digest/send')); toast('Resumo enviado para você' + ' (e para o webhook, se houver)'); } catch (e) { toast(e.message, true); } } }, icon('send', 14), 'Enviar agora'));
  api('GET', '/ux/digest').then(draw).catch(e => box.replaceChildren(h('p.ux-empty', 'Resumo indisponível: ' + e.message)));
  return box;
}
// qualidade das chamadas: % de boas entre quem respondeu, taxa de resposta e os problemas mais citados
// (a medida principal é "em quantas das perguntadas relataram problema": quem não teve problema quase sempre só fecha)
function calls(c) {
  if (!c?.perguntas) return empty('Ninguém foi perguntado ainda (a pergunta aparece em ~5% das chamadas com outra pessoa).');
  return h('div',
    h('div.ux-tiles.mini', tile(c.taxa_problema + '%', 'relataram problema', `${nf(c.ruins)} de ${nf(c.perguntas)} chamadas perguntadas`), tile(nf(c.boas), 'disseram que foi bem', 'fechar o cartão conta como "sem problema relatado"')),
    c.problemas.length ? bars(c.problemas.sort((a, b) => b.n - a.n).map(p => [p.nome, { total: p.n }])) : null);
}

// qualidade técnica medida pelo WebRTC em toda chamada (public/callqual.js): nota, o que mais pesou, cada indicador em faixas
// e o cruzamento com a avaliação (problema relatado com rede boa = microfone, fone ou o app, não a internet)
const GRADE = { good: 'Boa', fair: 'Média', poor: 'Ruim' };
function netq(q) {
  if (!q?.chamadas) return empty('Nenhuma chamada medida ainda (conta toda chamada de 20 s+ em que chegou a voz de alguém).');
  const I = q.indicadores, c = q.conexao, x = q.cruzamento?.bad;
  const tips = (g) => Object.entries(q.aparelhos || {}).map(([d, a]) => a[g] ? `${DEV[d] || d}: ${nf(a[g])}` : '').filter(Boolean).join(' · ');
  return h('div',
    h('div.ux-tiles.mini',
      tile(q.taxa_ruim + '%', 'com a rede ruim', `${nf(q.notas.poor)} de ${pl(q.chamadas, 'chamada medida', 'chamadas medidas')}; média em ${q.taxa_media}%`),
      tile(I.rtt.acima == null ? '—' : I.rtt.acima + '%', 'com atraso acima de 200 ms', 'atraso típico de cada chamada (ida e volta)'),
      tile(c.tcp == null ? '—' : c.tcp + '%', 'sem UDP (por TCP)', c.relay == null ? 'rede bloqueando UDP: mais atraso' : `${c.relay}% passando por relay (TURN)`),
      x?.total ? tile(q.problema_com_rede_boa + '%', 'dos problemas relatados com a rede boa', `${nf(x.total)} ${x.total === 1 ? 'relato' : 'relatos'} cruzados: aponta para microfone, fone ou o app`) : null),
    h('div.ux-grid',
      h('div', h('h4.ux-sub', 'Nota da rede'), bars(Object.keys(GRADE).map(g => [GRADE[g], { total: q.notas[g], tip: tips(g) }]))),
      h('div', h('h4.ux-sub', 'O que mais pesou nas chamadas médias e ruins'), q.causas.length ? bars(q.causas.map(k => [k.nome, { total: k.n }])) : empty('Nenhuma chamada média ou ruim.'))),
    h('div.ux-grid', Object.values(I).filter(v => v.medidas).map(v => h('div', h('h4.ux-sub', v.nome), bars(v.faixas.map(f => [f.faixa, { total: f.n }]), { text: (o) => nf(o.total) + ' · ' + pct(o.total, v.medidas) + '%' })))));
}

export function uxStatsPage() {
  const body = h('div.ux-body', h('p.ux-empty', 'Carregando…'));
  let days = 30, version = '', data = null;
  const digest = digestCard(); // não depende do período: é sempre a última semana
  const verSel = h('select.ux-ver', { 'aria-label': 'Versão do app', onchange: () => { version = verSel.value; load(); } }, h('option', { value: '' }, 'Todas as versões'));
  const load = async () => {
    body.classList.add('loading');
    try { data = await api('GET', `/ux?days=${days}${version ? '&version=' + encodeURIComponent(version) : ''}`); draw(); } catch (e) { body.replaceChildren(h('p.ux-empty', 'Não foi possível carregar: ' + e.message)); }
    body.classList.remove('loading');
  };
  const drawVersions = () => {
    const vs = data.versoes || [];
    verSel.replaceChildren(h('option', { value: '' }, 'Todas as versões'), ...vs.map(v => h('option', { value: v.version, selected: v.version === version },
      `${v.version.slice(0, 7)}${v.version === UX_VERSION ? ' (atual)' : ''} · ${fmtDay(v.desde)}${v.ate !== v.desde ? ' a ' + fmtDay(v.ate) : ''}`)));
    verSel.hidden = !vs.length;
  };
  const draw = () => {
    drawVersions();
    const E = data.eventos || {}, total = Object.values(E).reduce((n, e) => n + e.total, 0);
    const back = E.back_to_friends?.detalhes || {}, esc = back.esc?.total || 0, backAll = esc + (back.rail?.total || 0);
    const fl = Object.values(data.funis || {}), st = fl.reduce((n, x) => n + x.comecaram, 0), dn = fl.reduce((n, x) => n + Math.min(x.terminaram, x.comecaram), 0);
    const sw = data.tempos?.channel_switch?.geral;
    body.replaceChildren(...[ // (o filtro tira os 'false' das partes condicionais: replaceChildren escreveria "false")
      !data.ligado && h('p.ux-warn', icon('warn', 16), ' A coleta está desligada neste servidor (UX_TELEMETRY=0): nada novo entra.'),
      h('div.ux-tiles',
        tile(nf(total), total === 1 ? 'evento contado' : 'eventos contados', `nos últimos ${data.dias} dias${data.versao ? ' nesta versão' : ''}`),
        tile(sw ? ms(sw.p50) : '—', 'para abrir um canal (metade das vezes)', sw ? `95% até ${ms(sw.p95)}` : 'sem medições'),
        tile(nf(E.js_error?.total), (E.js_error?.total || 0) === 1 ? 'erro do app' : 'erros do app', pl(E.error_shown?.total || 0, 'aviso de erro mostrado', 'avisos de erro mostrados')),
        tile(st ? pct(dn, st) + '%' : '—', 'dos fluxos são concluídos', st ? `${nf(dn)} de ${nf(st)}` : 'sem dados')),
      digest,

      block('Pessoas', 'Contado pelo servidor, sem guardar quem: só um código embaralhado por pessoa, para não contar duas vezes'),
      ...[people(data.pessoas, data)].flat(),

      block('Desempenho', 'Do jeito que a pessoa sente'),
      card('Tempos', 'Passe o mouse numa linha para ver por aparelho', timings(data.tempos, data.faixas_ms || [])),
      h('div.ux-grid',
        card('Conexão', `Caiu e voltou ${pl(E.ws_reconnect?.total || 0, 'vez', 'vezes')}`, data.tempos?.ws_offline?.geral ? h('p.ux-line', 'Tempo sem conexão: metade até ', h('b', ms(data.tempos.ws_offline.geral.p50)), ', 95% até ', h('b', ms(data.tempos.ws_offline.geral.p95))) : empty('Nenhuma queda neste período.')),
        card('Falhas na voz', 'Por que não conectou', list(E.voice_fail, 10, (k) => VOICE_FAIL[k] || k))),
      card('Qualidade das chamadas', 'Pergunta rápida depois de algumas chamadas; quem teve problema diz o motivo', calls(data.chamadas)),
      card('Qualidade técnica das chamadas', 'Medida pela conexão em toda chamada, sem perguntar: atraso, perda de pacotes, oscilação, voz picotada, vídeo travando e quedas', netq(data.qualidade)),
      card('Eventos por dia', null, daily(data.por_dia || [], data.desde, data.dias)),

      block('Erros', 'Agrupados pela forma: números, nomes entre aspas e endereços viram marcadores'),
      h('div.ux-grid',
        card('Erros do app', 'Mensagem @ arquivo:linha (cada um conta uma vez por abertura)', list(E.js_error, 12)),
        card('Avisos de erro mostrados', `O que as pessoas viram em vermelho (grupos com menos de ${data.minimo_grupo} ficam em "outros")`, list(E.error_shown, 12))),

      block('Encontrar as coisas', 'Sinais de que a pessoa não achou o que queria de primeira'),
      h('div.ux-grid',
        card('Idas e voltas rápidas', 'Foi de A para B e voltou para A em menos de 3 s', list(E.u_turn)),
        card('Páginas deixadas em 2 s', 'Abriu nas Configurações e saiu logo', list(E.quick_exit))),
      h('div.ux-grid',
        card('Menus fechados sem escolher', 'Abriu e não achou a opção (% das vezes)', menus(E)),
        card('Buscas sem resultado', `O que procuram nas Configurações e não acham (menos de ${data.minimo_grupo} vira "outros")`, list(E.settings_search_empty))),
      card('Explicações mais abertas', 'ⓘ abertas: muito aberta = o texto curto não basta', list(E.info_tip)),

      block('Uso'),
      card('Fluxos', 'Quantos terminam o que começaram', funnels(data.funis)),
      h('div.ux-grid',
        card('Voltar para Amigos', 'Como as pessoas saem de uma conversa direta', split(E.back_to_friends)),
        card('Abas de Jogos', `Seção aberta ${pl(E.games_open?.total || 0, 'vez', 'vezes')} pela barra`, bars(Object.entries(E.games_tab?.detalhes || {}), { label: (k) => TABS[k] || k }))),
      h('div.ux-grid',
        card('Cliques com raiva', '3 cliques rápidos no mesmo lugar', list(E.rage_click)),
        card('Cliques sem efeito', 'Parecia botão, mas nada mudou em 1 s', list(E.dead_click)))].filter(Boolean));
  };
  const dl = () => { if (!data) return; const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `estatisticas-uso-${data.desde}.json` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Arquivo baixado'); };
  load();
  return h('div.uxstats', h('h2', 'Estatísticas de uso'),
    h('div.ux-bar-top', h('div.ux-filters', seg([[7, '7 dias'], [30, '30 dias'], [60, '60 dias']], days, (v) => { days = +v; load(); }), verSel),
      h('button.btn.grey.sm', { onclick: dl }, icon('dl', 16), 'Baixar dados (JSON)')),
    h('p.ux-note', icon('shield', 14), ' Contagens anônimas de quem deixou ligado "Enviar estatísticas de uso" em Privacidade. Sem nomes e sem mensagens; ficam 60 dias.'),
    body);
}
