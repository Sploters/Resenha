// Conquistas e platinas (server/achievements.js): aba Conquistas da seção Jogos (as suas, com sincronizar e registrar
// platinas de outras plataformas) e a aba Conquistas no perfil de outra pessoa (só leitura, mesma regra de quem vê a
// biblioteca de jogos).
// Steam: oficial, pela API da Steam (jogos 100%, conquistas recentes, as mais raras e o progresso de cada jogo).
// PlayStation, Xbox, Epic e outras não têm API pública para isso: a pessoa registra, e aparece como "informado".
import { h, icon } from './util.js';
import { api, tryApi, toast, modal, confirmBox } from './state.js';
import { gamesTabs } from './gamestabs.js';
import { gameIcon } from './activity.js';

const PLATFORMS = [['psn', 'PlayStation'], ['xbox', 'Xbox'], ['epic', 'Epic Games'], ['switch', 'Nintendo Switch'], ['gog', 'GOG'], ['ea', 'EA app'], ['ubisoft', 'Ubisoft Connect'], ['battlenet', 'Battle.net'], ['other', 'Outra']];
const KIND = { platinum: 'Platina', complete: '100%' };
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'sem data');
const fmtPct = (p) => (p < 1 ? p.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(p)) + '%';
const rarity = (p) => (p == null ? null : p < 5 ? ['Ultrarrara', 'ur'] : p < 15 ? ['Rara', 'r'] : p < 40 ? ['Incomum', 'u'] : ['Comum', 'c']);
const steamGame = (x) => ({ platform: 'steam', game: { id: String(x.appid), title: x.title || x.game || '' } });
const openSettings = (k) => window.__lc?.openSettings?.(k);

// painel de conquistas de uma pessoa (uid: '@me' para as suas). Monta na hora e preenche quando os dados chegam;
// as suas atualizam sozinhas quando a sincronização termina (evento ACHIEVEMENTS_UPDATE)
export function achievementsView(uid, { compact = false } = {}) {
  const root = h('div.achv' + (compact ? '.compact' : ''), h('div.ach-loading', 'Carregando conquistas…'));
  let data = null, syncing = false;
  const load = async () => {
    const r = await api('GET', `/users/${encodeURIComponent(uid)}/achievements`).catch(e => ({ error: e.message }));
    if (!root.isConnected && data) return;
    data = r; syncing = !!r?.steam?.syncing; draw();
  };
  const onUpd = (e) => {
    if (!root.isConnected) return removeEventListener('rs-achievements', onUpd);
    if (!data?.me) return;
    if (e.detail?.syncing === true) { syncing = true; draw(); return; }
    load();
  };
  addEventListener('rs-achievements', onUpd);

  const syncNow = async (btn) => {
    btn.disabled = true; syncing = true; draw();
    const r = await tryApi('POST', '/achievements/sync'); syncing = false;
    if (r) { data = r; toast(r.state === 'private' ? 'Seu perfil da Steam está privado' : 'Conquistas atualizadas'); }
    draw();
  };
  const addManual = () => {
    const plat = h('select', PLATFORMS.map(([k, l]) => h('option', { value: k }, l)));
    const title = h('input', { placeholder: 'Ex.: God of War Ragnarök', maxLength: 120 });
    const kind = h('select', h('option', { value: 'platinum' }, 'Platina'), h('option', { value: 'complete' }, '100% (todas as conquistas)'));
    const when = h('input', { type: 'date', max: new Date().toISOString().slice(0, 10) });
    const m = modal('Registrar platina', 'PlayStation, Xbox, Epic e outras lojas não deixam outros apps lerem os seus troféus. Registre aqui; aparece no seu perfil como "informado".',
      h('div', h('label.f', 'Plataforma', plat), h('label.f', 'Jogo', title), h('label.f', 'O que você conquistou', kind), h('label.f', 'Quando (opcional)', when)),
      [{ label: 'Cancelar', cls: 'link' }, { label: 'Registrar', fn: async () => {
        if (!title.value.trim()) { toast('Diga o nome do jogo', true); return false; }
        const r = await tryApi('POST', '/achievements/manual', { platform: plat.value, title: title.value, kind: kind.value, achieved_at: when.value || null });
        if (!r) return false; data = r; draw(); toast(`${KIND[kind.value]} de ${title.value.trim()} registrada`);
      } }]);
    setTimeout(() => title.focus()); return m;
  };
  const delManual = async (x) => {
    if (!await confirmBox('Remover registro', `Remover ${KIND[x.kind] === '100%' ? 'o 100%' : 'a platina'} de ${x.title}?`, 'Remover')) return;
    const r = await tryApi('DELETE', `/achievements/manual/${encodeURIComponent(x.id)}`); if (r) { data = r; draw(); }
  };

  const tile = (n, label, ic) => h('div.ach-tile', h('span.ach-ti', icon(ic, 18)), h('b', n == null ? '—' : String(n)), h('small', label));
  const sec = (title, ...body) => h('section.ach-sec', h('h3', title), ...body);
  function steamLine(d) {
    const s = d.steam;
    if (syncing) return h('div.ach-note', h('span.ach-spin'), 'Buscando as suas conquistas na Steam…');
    if (!d.me) return null;
    if (!s.linked) return h('div.ach-note', icon('link', 16), h('span', 'Vincule a Steam para trazer as conquistas e os jogos 100% automaticamente.'), h('button.btn.sm', { onclick: () => openSettings('connections') }, 'Vincular a Steam'));
    if (s.state === 'private') return h('div.ach-note.warn', icon('lock', 16), h('span', 'Seu perfil da Steam está privado. Na Steam, em Privacidade, deixe "Detalhes do jogo" como Público e sincronize de novo.'));
    if (s.state === 'nokey' || !s.configured) return h('div.ach-note.warn', icon('info', 16), h('span', 'Este servidor da Resenha não tem a chave da Steam configurada (STEAM_API_KEY); as conquistas da Steam não podem ser lidas.'));
    return h('div.ach-note.ok', icon('check', 16), h('span', s.synced_at ? `Steam sincronizada ${fmtDate(s.synced_at)}` + (s.state === 'error' ? ' (alguns jogos não responderam)' : '') : 'Steam vinculada'),
      h('button.btn.grey.sm', { onclick: (e) => syncNow(e.currentTarget) }, icon('refresh', 14), 'Sincronizar agora'));
  }
  function perfectCard(x) {
    const ic = x.manual ? h('span.ach-pi', icon(x.kind === 'platinum' ? 'medal' : 'trophy', 26)) : gameIcon(steamGame(x), 44);
    return h('div.ach-card' + (x.manual ? '.manual' : '') + (x.kind === 'platinum' ? '.plat' : ''),
      ic, h('div.ach-ci', h('b', { title: x.title }, x.title),
        h('small', x.manual ? `${x.platform_name} · ${KIND[x.kind]}` : `Steam · 100% · ${x.total} conquistas`),
        h('small.ach-when', fmtDate(x.at), x.manual && h('span.ach-inf', { title: 'Registrado pela pessoa; a plataforma não permite conferir' }, 'informado'))),
      data.me && x.manual && h('button.ibtn.ach-del', { title: 'Remover', 'aria-label': `Remover ${x.title}`, onclick: () => delManual(x) }, icon('x', 14)));
  }
  function achRow(a) {
    const rr = rarity(a.pct);
    return h('div.ach-row', a.icon ? h('img.ach-ai', { src: a.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('span.ach-ai', icon('trophy', 18))) }) : h('span.ach-ai', icon('trophy', 18)),
      h('div.ach-ri', h('b', a.name), a.desc && h('small', a.desc), h('small.ach-g', [a.game, fmtDate(a.at)].filter(Boolean).join(' · '))),
      rr && h('span.ach-rar.r-' + rr[1], { title: `${fmtPct(a.pct)} dos jogadores têm esta conquista` }, rr[0], h('small', fmtPct(a.pct))));
  }
  function gameRow(g) {
    const pct = Math.round(g.unlocked / g.total * 100);
    return h('div.ach-grow', gameIcon(steamGame(g), 28), h('div.ach-gi', h('div.ach-gt', h('b', g.title), h('small', `${g.unlocked}/${g.total}`)),
      h('div.ach-bar', { role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${g.title}: ${pct}%` }, h('i', { style: { width: pct + '%' } }))), h('span.ach-gp' + (pct === 100 ? '.full' : ''), pct + '%'));
  }
  function draw() {
    if (!data) return;
    if (data.error) return root.replaceChildren(h('div.ach-empty', icon('lock', 28), h('p', data.error)));
    const d = data, perfect = [...d.manual, ...d.perfect].sort((x, y) => (y.at || 0) - (x.at || 0));
    const nothing = !perfect.length && !d.recent.length && !d.games.length;
    root.replaceChildren(
      h('div.ach-sum', tile(d.summary.perfect, 'Platinas e 100%', 'medal'), tile(d.summary.unlocked, 'Conquistas', 'trophy'), tile(d.summary.games, 'Jogos com conquistas', 'gamepad'), tile(d.summary.completion != null ? d.summary.completion + '%' : null, 'Conclusão média', 'check')),
      steamLine(d),
      sec('Platinas e 100%', perfect.length ? h('div.ach-grid', perfect.map(perfectCard)) : h('p.ach-none', d.me ? 'Nenhum jogo 100% ainda. Termine um na Steam ou registre uma platina de outra plataforma.' : 'Nenhum jogo 100% ainda.'),
        d.me && h('button.btn.grey.sm.ach-add', { onclick: addManual }, icon('plus', 14), 'Registrar platina (PlayStation, Xbox, Epic…)')),
      d.rare.length > 0 && sec('As mais raras', h('div.ach-list', d.rare.map(achRow))),
      d.recent.length > 0 && sec('Desbloqueadas recentemente', h('div.ach-list', d.recent.slice(0, compact ? 8 : 24).map(achRow))),
      d.games.length > 0 && sec('Progresso por jogo', h('div.ach-games', d.games.slice(0, compact ? 10 : 60).map(gameRow))),
      nothing && !d.me && h('div.ach-empty', icon('trophy', 28), h('p', 'Ainda não há conquistas para mostrar.')));
  }
  load();
  return root;
}

// aba Conquistas da seção Jogos (as suas)
export function renderTrophies(main) {
  main.replaceChildren(h('div#trophyview',
    h('div#topbar', ...gamesTabs('trophies')),
    h('div.dbodywrap', h('div.ach-head', h('h1', 'Suas conquistas'), h('p', 'Jogos 100% e conquistas da Steam, e as platinas que você registrar de outras plataformas. Quem vê: a mesma regra da sua biblioteca de jogos (Configurações → Contas vinculadas).')),
      achievementsView('@me'))));
}
