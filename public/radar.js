// Radar: scouting do Clash (League of Legends). Cola os cinco Riot IDs do time adversário, o servidor busca na API oficial
// da Riot (server/radar.js) e aqui aparecem o relatório do time e um cartão por jogador. Cada número diz de quantas
// partidas veio e de quando; sem amostra suficiente não há conclusão. Ícones dos campeões vêm do Data Dragon.
import { h, icon, avatar } from './util.js';
import { S, tryApi, toast, modal, confirmBox } from './state.js';
import { gamesTabs } from './gamestabs.js';

const st = { meta: null, list: [], cur: null, open: null, timer: 0, root: null };
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const POS_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
const QUEUE_PT = { 400: 'Normal', 420: 'Solo/Duo', 430: 'Às cegas', 440: 'Flex', 490: 'Rápida', 700: 'Clash' };
const HIGH = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const rankLine = (e) => (!e ? 'Sem ranque' : `${TIER_PT[e.tier] || e.tier}${HIGH.has(e.tier) ? '' : ' ' + e.rank} · ${e.leaguePoints} PdL`);
const date = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const period = (p) => (p ? `${date(p.from)} a ${date(p.to)}` : 'sem partidas');
const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`; };

// ---------- campeões (Data Dragon) ----------
const champ = (id) => st.meta?.ddragon?.champs?.[id];
const champName = (id, fb) => champ(id)?.name || fb || `#${id}`;
function champIcon(id, size = 32, fb) {
  const c = champ(id), dd = st.meta?.ddragon;
  if (!c || !dd) return h('span.rd-ci.rd-ci-txt', { style: { width: size + 'px', height: size + 'px' }, title: champName(id, fb) }, (fb || '?').slice(0, 2));
  return h('img.rd-ci', { src: `${dd.base}/cdn/${dd.version}/img/champion/${c.id}.png`, width: size, height: size, alt: c.name, title: c.name });
}
const profileIcon = (n) => (n != null && st.meta?.ddragon ? h('img.rd-pi', { src: `${st.meta.ddragon.base}/cdn/${st.meta.ddragon.version}/img/profileicon/${n}.png`, width: 56, height: 56, alt: '' }) : h('div.rd-pi.rd-pi-empty', icon('users', 24)));
const tierBadge = (e, cls = '') => h('span.rd-tier' + cls, { 'data-tier': e?.tier || 'NONE' }, rankLine(e));

// ---------- dados ----------
const meta = async () => (st.meta ||= await tryApi('GET', '/radar/meta'));
async function loadList() { st.list = (await tryApi('GET', '/radar')) || []; }
async function openScout(id) {
  st.open = id;
  const s = await tryApi('GET', '/radar/' + id);
  if (st.open !== id) return;
  st.cur = s; draw(); poll();
}
// enquanto algum jogador carrega, pergunta de novo (a busca respeita o limite da Riot e pode levar um minuto ou dois)
function poll() {
  clearTimeout(st.timer);
  if (!st.cur || !st.cur.players.some(p => p.status === 'pending' || p.status === 'loading')) return;
  st.timer = setTimeout(async () => {
    if (!st.root?.isConnected || !st.cur) return;
    const s = await tryApi('GET', '/radar/' + st.cur.id); if (!s || st.open !== s.id) return;
    st.cur = s; draw(); poll();
  }, 2500);
}

// ---------- página ----------
export async function renderRadar(main) {
  st.root = h('div.dbodywrap.rd-wrap', h('p.rd-muted', 'Carregando o Radar…'));
  main.replaceChildren(h('div#radarview', h('div#topbar', ...gamesTabs('radar')), st.root));
  await Promise.all([meta(), loadList()]);
  if (st.open && !st.list.some(s => s.id === st.open)) { st.open = null; st.cur = null; }
  if (st.open) return openScout(st.open);
  draw();
}

function draw() {
  if (!st.root?.isConnected) return;
  const m = st.meta;
  st.root.replaceChildren(h('div.rd',
    h('aside.rd-side',
      h('button.btn.rd-new', { onclick: () => { st.open = null; st.cur = null; draw(); } }, icon('plus', 16), 'Novo scouting'),
      h('div.rd-cap', 'Seus scoutings'),
      st.list.length ? st.list.map(s => h('button.rd-item' + (s.id === st.open ? '.on' : ''), { onclick: () => openScout(s.id) },
        h('b', s.title), h('small', `${s.players.length} jogadores · ${s.mine ? ago(s.updated_at) : 'de ' + (s.owner?.display_name || s.owner?.username)}`)))
        : h('p.rd-muted.rd-small', 'Nenhum ainda.')),
    h('section.rd-main',
      m && !m.configured && h('div.rd-banner.warn', icon('warn', 18), h('div', h('b', 'Busca na Riot indisponível neste servidor. '),
        'Falta a chave da API da Riot (RIOT_API_KEY) no servidor. Dá para criar o scouting e usar os links do OP.GG e U.GG; as estatísticas aparecem quando a chave for configurada. Nenhum dado é simulado.')),
      st.cur ? scoutView(st.cur) : createForm())));
}

// ---------- criar ----------
function createForm() {
  const m = st.meta || {};
  const title = h('input.rd-in', { placeholder: 'Ex.: Clash sábado — semifinal', maxLength: 60 });
  const plat = h('select.rd-in', (m.platforms || [['br1', 'Brasil']]).map(([id, n]) => h('option', { value: id }, n)));
  const slots = [0, 1, 2, 3, 4].map(i => h('input.rd-in.rd-slot', { placeholder: `Jogador ${i + 1} — Nome#TAG`, maxLength: 30, oninput: count }));
  const paste = h('textarea.rd-in.rd-paste', { rows: 3, placeholder: 'Cole aqui os cinco Riot IDs (um por linha, separados por vírgula, ou o texto do saguão "Nome #TAG entrou no saguão")', oninput: () => fill(paste.value) });
  const hint = h('small.rd-muted');
  function fill(text) {
    const ids = [];
    for (const raw of String(text).split(/[\n,;]+/)) {
      const t = raw.replace(/\s+(entrou no saguão|joined the lobby|saiu do saguão|left the lobby)\.?\s*$/i, '').trim();
      const mm = t.match(/^(.{3,16}?)\s*#\s*([\p{L}\p{N}]{3,5})$/u); if (mm && !ids.some(x => x.toLowerCase() === `${mm[1].trim()}#${mm[2]}`.toLowerCase())) ids.push(`${mm[1].trim()}#${mm[2]}`);
    }
    ids.slice(0, 5).forEach((v, i) => { slots[i].value = v; }); count();
  }
  function count() { const n = slots.filter(s => s.value.trim()).length; hint.textContent = n ? `${n} de 5 jogadores` : ''; }
  const go = async () => {
    const riot_ids = slots.map(s => s.value.trim()).filter(Boolean);
    if (!riot_ids.length) return toast('Informe ao menos um Riot ID', true);
    const s = await tryApi('POST', '/radar', { title: title.value, platform: plat.value, riot_ids });
    if (!s) return;
    await loadList(); st.open = s.id; st.cur = s; draw(); poll();
  };
  return h('div.rd-create',
    h('div.rd-hero', h('span.rd-hero-ic', icon('radar', 28)), h('div', h('h1', 'Radar do Clash'),
      h('p', 'Cole os cinco Riot IDs do time adversário (estão no chaveamento do Clash) e veja elo, campeões, posições e partidas recentes de todos de uma vez — com um relatório do time para a call.'))),
    h('div.rd-form',
      h('label.rd-lbl', 'Nome do scouting', title),
      h('label.rd-lbl', 'Servidor', plat),
      h('label.rd-lbl.rd-wide', 'Colar em lote', paste),
      h('div.rd-slots.rd-wide', slots),
      h('div.rd-wide.rd-actions', hint, h('button.btn.green', { onclick: go }, icon('search', 16), 'Montar scouting'))),
    h('p.rd-muted.rd-small', `Fonte: API oficial da Riot (Account, Summoner, League, Champion Mastery e Match-V5) — até ${m.matches || 20} partidas recentes de cada jogador, só filas de Summoner's Rift (personalizadas nunca entram). OP.GG e U.GG aparecem como links; nada é copiado desses sites.`));
}

// ---------- scouting ----------
function scoutView(s) {
  const loading = s.players.filter(p => p.status === 'pending' || p.status === 'loading').length;
  const tools = h('div.rd-tools',
    h('button.btn.grey.sm', { onclick: () => share(s) }, icon('users', 14), 'Compartilhar'),
    h('button.btn.grey.sm', { onclick: () => copySummary(s) }, icon('copy', 14), 'Copiar resumo'),
    s.mine && h('button.btn.grey.sm', { onclick: () => editPlayers(s) }, icon('edit', 14), 'Jogadores'),
    h('button.btn.grey.sm', { disabled: loading > 0 || !st.meta?.configured, onclick: async () => { const r = await tryApi('POST', `/radar/${s.id}/refresh`, {}); if (r) { st.cur = r; draw(); poll(); } } }, icon('refresh', 14), 'Atualizar'),
    h('button.btn.link.sm', { onclick: async () => { if (!await confirmBox(s.mine ? 'Apagar scouting' : 'Sair do scouting', s.mine ? 'Apaga para todos com quem foi compartilhado.' : 'Ele deixa de aparecer para você.', s.mine ? 'Apagar' : 'Sair')) return; if (await tryApi('DELETE', '/radar/' + s.id)) { st.open = null; st.cur = null; await loadList(); draw(); } } }, icon('trash', 14)));
  return h('div.rd-scout',
    h('header.rd-head', h('div', h('h1', s.title), h('p.rd-muted', `${s.platform_name || s.platform} · criado por ${s.owner?.display_name || s.owner?.username}`, s.members.length ? ` · com ${s.members.map(u => u.display_name || u.username).join(', ')}` : '')), tools),
    loading > 0 && h('div.rd-banner', h('span.rd-spin'), h('div', `Buscando ${loading} jogador${loading > 1 ? 'es' : ''} na Riot…`, s.paused > 0 ? ` Limite de requisições atingido: retomando em ${Math.ceil(s.paused / 1000)} s.` : ' Respeitando o limite de requisições da API, pode levar um ou dois minutos.')),
    teamView(s),
    h('h2.rd-h2', 'Jogadores'),
    h('div.rd-cards', s.players.map(p => playerCard(p, s))),
    notesView(s));
}

function teamView(s) {
  const r = s.report;
  if (!r.players) return h('section.rd-team.rd-empty', h('p.rd-muted', 'O relatório do time aparece quando ao menos um jogador terminar de carregar.'));
  const box = (title, ic, body) => h('div.rd-box', h('h3', icon(ic, 16), title), body);
  const none = (t) => h('p.rd-muted.rd-small', t);
  return h('section.rd-team',
    h('div.rd-sample', icon('info', 16), h('span', h('b', 'Amostra: '), `${r.totalGames} partidas de Summoner's Rift de ${r.players} jogador${r.players > 1 ? 'es' : ''} · período ${period(r.period)}. `,
      `Win rate só aparece com ${st.meta?.min?.wr || 5}+ partidas no campeão; destaques exigem amostra mínima.`)),
    h('div.rd-grid',
      box('Elos (Solo/Duo)', 'medal', h('div',
        h('div.rd-elos', r.elo.map(e => h('div.rd-elo', h('span.rd-elo-n', e.riotId.split('#')[0]), tierBadge(e.solo, '.sm'), e.flex && h('small.rd-muted', 'Flex: ' + rankLine(e.flex))))),
        r.avg && h('p.rd-small', `Média aproximada: ${TIER_PT[r.avg.tier]} ${r.avg.rank} (${r.avg.n} com ranque)`))),
      box('Campeões mais jogados pelo time', 'gamepad', r.champs.length ? h('div.rd-tchamps', r.champs.slice(0, 8).map(c => h('div.rd-tchamp', champIcon(c.champ, 36, c.name),
        h('div', h('b', champName(c.champ, c.name)), h('small', `${c.games} partidas${c.wr != null ? ` · ${c.wr}% WR` : ` · ${c.wins}V ${c.games - c.wins}D`}`), h('small.rd-muted', c.players.map(x => x.riotId.split('#')[0]).join(', '))))))
        : none('Sem partidas na amostra.')),
      box('Especialistas', 'star', r.specialists.length ? h('ul.rd-ul', r.specialists.map(x => h('li', champIcon(x.champ, 22), h('span', h('b', x.riotId.split('#')[0]), ' — ', x.text.replace(/^Especialista: /, ''))))) : none('Ninguém com um campeão em 40%+ das partidas (mín. 5).')),
      box('Pools concentradas', 'eye', r.pools.length ? h('ul.rd-ul', r.pools.map(x => h('li', h('b', x.riotId.split('#')[0]), ' — ', x.text.replace(/^Pool concentrada: /, '')))) : none('Nenhuma pool concentrada com amostra suficiente (mín. 10 partidas).')),
      box('Tendências', 'bolt', r.trends.length ? h('ul.rd-ul', r.trends.map(t => h('li', t.text, h('small.rd-muted', ' · ' + t.base)))) : none('Nenhuma tendência com base suficiente.'))),
    r.limits.length > 0 && h('details.rd-limits', h('summary', `Limitações dos dados (${r.limits.length})`), h('ul', r.limits.map(l => h('li', l)))));
}

function playerCard(p, s) {
  const d = p.data, name = p.riotId.split('#');
  const links = h('div.rd-links', p.links.map(l => h('a.rd-link', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name, icon('link', 12))));
  const head = h('div.rd-ph', d ? profileIcon(d.icon) : h('div.rd-pi.rd-pi-empty', icon('users', 24)),
    h('div.rd-pid', h('b', name[0]), h('small.rd-muted', '#' + (name[1] || '')), d?.level != null && h('small.rd-muted', ` · nível ${d.level}`)), links);
  if (p.status !== 'done') {
    const pr = p.progress;
    return h('article.rd-card.rd-' + p.status, head, h('div.rd-state',
      p.status === 'loading' ? [h('span.rd-spin'), h('span', pr?.total ? `${pr.step}: ${pr.done}/${pr.total}` : (pr?.step || 'Buscando…'))]
        : p.status === 'pending' ? [h('span.rd-spin'), h('span', 'Na fila')]
          : [icon('warn', 16), h('span', p.error || 'Sem dados')]),
      p.status === 'error' && h('button.btn.grey.sm', { onclick: async () => { const r = await tryApi('POST', `/radar/${s.id}/refresh`, { slot: p.slot }); if (r) { st.cur = r; draw(); poll(); } } }, 'Tentar de novo'));
  }
  const stt = d.stats, solo = d.ranks.solo, flex = d.ranks.flex;
  const peak = d.peaks?.solo && (!solo || d.peaks.solo.tier !== solo.tier || d.peaks.solo.rank !== solo.rank) ? d.peaks.solo : null;
  const flags = d.flags || [];
  return h('article.rd-card', { 'data-tier': solo?.tier || 'NONE' }, head,
    h('div.rd-ranks',
      h('div', h('small.rd-muted', 'Solo/Duo'), tierBadge(solo), solo && h('small.rd-muted', `${solo.wins}V ${solo.losses}D na temporada${solo.hotStreak ? ' · 🔥 sequência' : ''}`)),
      h('div', h('small.rd-muted', 'Flex'), tierBadge(flex, '.sm')),
      h('div', h('small.rd-muted', 'Maior elo'), peak ? tierBadge(peak, '.sm') : h('span.rd-small', solo ? 'igual ao atual' : '—'),
        h('small.rd-muted', { title: 'A API da Riot só informa o elo atual. O Radar guarda o maior que já viu desta conta.' }, `visto pelo Radar desde ${date(d.peaks?.solo?.since || d.fetched_at)}`))),
    flags.length > 0 && h('div.rd-flags', flags.map(f => h('span.rd-flag.rd-flag-' + f.kind, f.text))),
    h('div.rd-sec', h('h4', 'Campeões ', h('small.rd-muted', `· ${stt.games} partidas · ${period(stt.period)}`)),
      stt.champs.length ? h('div.rd-champs', stt.champs.slice(0, 5).map(c => h('div.rd-champ', champIcon(c.champ, 34, c.name),
        h('div', h('b', champName(c.champ, c.name)), h('small', `${c.games}× · ${c.wr != null ? c.wr + '% WR' : `${c.wins}V ${c.games - c.wins}D`}${c.kda != null ? ' · KDA ' + c.kda : ''}`), c.small && h('small.rd-muted', 'amostra pequena')))))
        : h('p.rd-muted.rd-small', 'Sem partidas de Summoner\'s Rift na amostra.')),
    stt.roles.length > 0 && h('div.rd-sec', h('h4', 'Posições'), h('div.rd-roles', stt.roles.map(r => h('div.rd-role', h('span', POS_PT[r.pos]), h('div.rd-bar', h('i', { style: { width: r.share + '%' } })), h('small', `${r.games} (${r.share}%)`))))),
    d.mastery.length > 0 && h('div.rd-sec', h('h4', 'Maestria ', h('small.rd-muted', '· todas as partidas da conta')), h('div.rd-mast', d.mastery.map(m => h('div.rd-m', { title: `${champName(m.champ)} — nível ${m.level}, ${m.points.toLocaleString('pt-BR')} pontos` }, champIcon(m.champ, 30), h('small', Math.round(m.points / 1000) + ' mil'))))),
    stt.recent.length > 0 && h('div.rd-sec', h('h4', 'Partidas recentes'), h('div.rd-recent', stt.recent.map(r => h('div.rd-r' + (r.win ? '.w' : '.l'), { title: `${r.win ? 'Vitória' : 'Derrota'} · ${champName(r.champ, r.champName)} · ${r.k}/${r.d}/${r.a} · ${QUEUE_PT[r.queue] || r.queue}${r.pos ? ' · ' + POS_PT[r.pos] : ''} · ${date(r.at)}` }, champIcon(r.champ, 28, r.champName), h('small', `${r.k}/${r.d}/${r.a}`))))),
    h('p.rd-foot.rd-muted', `Amostra: ${d.sample.used} de ${d.sample.listed} partidas listadas (pedidas ${d.sample.requested})${d.sample.otherModes ? ` · ${d.sample.otherModes} de outros modos fora` : ''} · atualizado ${ago(d.fetched_at)}`,
      d.missing?.length ? h('span.rd-miss', ` · faltou: ${d.missing.length > 2 ? d.missing.length + ' itens' : d.missing.join('; ')}`) : null));
}

function notesView(s) {
  const inp = h('textarea.rd-in', { rows: 2, maxLength: 500, placeholder: 'Observação para o time (ex.: banir Ahri, o jungle invade cedo…)' });
  const who = h('select.rd-in.rd-who', h('option', { value: '' }, 'Time todo'), s.players.map(p => h('option', { value: p.slot }, p.riotId.split('#')[0])));
  const send = async () => { if (!inp.value.trim()) return; const r = await tryApi('POST', `/radar/${s.id}/notes`, { content: inp.value, slot: who.value }); if (r) { st.cur = r; draw(); } };
  return h('section.rd-notes', h('h2.rd-h2', 'Observações compartilhadas'),
    s.notes.length ? h('div.rd-nlist', s.notes.map(n => h('div.rd-note', avatar(n.author, 28), h('div', h('b', n.author.display_name || n.author.username),
      n.slot != null && h('span.rd-tag', s.players.find(p => p.slot === n.slot)?.riotId.split('#')[0] || '?'), h('small.rd-muted', ' ' + ago(n.created_at)), h('p', n.content)),
      (n.author.id === S.me?.id || s.mine) && h('button.ibtn', { title: 'Apagar', onclick: async () => { const r = await tryApi('DELETE', `/radar/${s.id}/notes/${n.id}`); if (r) { st.cur = r; draw(); } } }, icon('trash', 14)))))
      : h('p.rd-muted.rd-small', 'Ninguém escreveu ainda. Quem recebe o scouting também pode anotar.'),
    h('div.rd-nform', who, inp, h('button.btn', { onclick: send }, 'Anotar')));
}

// ---------- ações ----------
function share(s) {
  const friends = [...S.rels.values()].filter(r => r.type === 1).map(r => S.users.get(r.user.id) || r.user)
    .filter(u => u.id !== s.owner?.id && !s.members.some(m => m.id === u.id));
  const sel = new Set();
  const body = friends.length ? h('div.rd-share', friends.map(u => h('label.rd-pick', h('input', { type: 'checkbox', onchange: (e) => e.target.checked ? sel.add(u.id) : sel.delete(u.id) }), avatar(u, 24), h('span', u.display_name || u.username))))
    : h('p', 'Todos os seus amigos já têm acesso (ou você ainda não tem amigos adicionados). Use "Copiar resumo" para colar num canal.');
  modal('Compartilhar scouting', 'Quem receber vê os cartões, o relatório e as observações, e recebe uma mensagem direta.', body,
    [{ label: 'Cancelar', cls: 'link' }, friends.length && { label: 'Compartilhar', fn: async () => { if (!sel.size) { toast('Escolha alguém', true); return false; } const r = await tryApi('POST', `/radar/${s.id}/share`, { user_ids: [...sel] }); if (!r) return false; st.cur = r; draw(); toast(`Compartilhado com ${r.added} pessoa${r.added === 1 ? '' : 's'}`); } }].filter(Boolean));
}
function editPlayers(s) {
  const ta = h('textarea.rd-in', { rows: 6, value: s.players.map(p => p.riotId).join('\n') });
  modal('Jogadores do scouting', 'Um Riot ID por linha (até 5). Quem continuar na lista mantém os dados já buscados.', ta,
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: async () => { const r = await tryApi('PATCH', '/radar/' + s.id, { riot_ids: ta.value.split('\n').map(x => x.trim()).filter(Boolean) }); if (!r) return false; st.cur = r; await loadList(); draw(); poll(); } }]);
}
function copySummary(s) {
  const r = s.report, L = [`📡 Radar — ${s.title} (${s.platform_name})`, `Amostra: ${r.totalGames} partidas · ${period(r.period)}`];
  for (const p of s.players) {
    const d = p.data;
    if (!d) { L.push(`• ${p.riotId} — ${p.error || 'sem dados'}`); continue; }
    const top = d.stats.champs.slice(0, 3).map(c => `${champName(c.champ, c.name)} ${c.games}×${c.wr != null ? ` ${c.wr}%` : ''}`).join(', ');
    L.push(`• ${p.riotId} — ${rankLine(d.ranks.solo)}${d.stats.mainRole ? ' · ' + POS_PT[d.stats.mainRole] : ''} · ${top || 'sem partidas'} (${d.stats.games} partidas)`);
  }
  if (r.specialists.length) L.push('Especialistas: ' + r.specialists.map(x => `${x.riotId.split('#')[0]} (${champName(x.champ)})`).join(', '));
  for (const t of r.trends) L.push('⚠ ' + t.text);
  for (const n of s.notes) L.push(`📝 ${n.content}`);
  navigator.clipboard?.writeText(L.join('\n')).then(() => toast('Resumo copiado'), () => toast('Não deu para copiar', true));
}
