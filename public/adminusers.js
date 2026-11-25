// Configurações → Administração → Usuários (só o administrador da instalação; server/admin.js): buscar contas,
// suspender/reativar, redefinir senha (mostra a temporária uma vez), encerrar sessões, excluir conta e o histórico do
// que foi feito. Carregado sob demanda pela página de configurações.
import { h, icon, avatar } from './util.js';
import { S, tryApi, toast, modal, confirmBox, promptBox, menu } from './state.js';
import { go } from './nav.js';

const when = (t) => {
  if (!t) return '—';
  const d = Date.now() - t, m = Math.round(d / 60e3);
  if (m < 2) return 'agora'; if (m < 60) return `há ${m} min`;
  const hr = Math.round(m / 60); if (hr < 24) return `há ${hr} h`;
  const dy = Math.round(hr / 24); if (dy < 30) return `há ${dy} ${dy === 1 ? 'dia' : 'dias'}`;
  return new Date(t).toLocaleDateString('pt-BR');
};
const ACTION = { ban: 'suspendeu', unban: 'reativou', password: 'redefiniu a senha de', logout: 'encerrou as sessões de', delete: 'excluiu a conta de', guild_join: 'entrou no servidor', guild_delete: 'excluiu o servidor', signup_mode: 'mudou o cadastro para', signup_code: 'criou o convite', signup_revoke: 'revogou o convite' };
const GUILD_ACT = new Set(['guild_join', 'guild_delete', 'signup_mode', 'signup_code', 'signup_revoke']); // alvo não é uma conta (sem @)

export function adminUsersPage() {
  const q = h('input.au-q', { type: 'search', placeholder: 'Buscar por usuário ou nome', 'aria-label': 'Buscar contas', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div.au-list', h('p.au-muted', 'Carregando…')), count = h('span.au-muted'), logBox = h('div.au-log');
  let users = [], t = 0;
  const load = async () => {
    const r = await tryApi('GET', '/admin/users' + (q.value.trim() ? '?q=' + encodeURIComponent(q.value.trim()) : ''));
    if (!r) return;
    users = r.users; count.textContent = `${r.total} ${r.total === 1 ? 'conta' : 'contas'}`; draw();
  };
  const loadLog = async () => {
    const r = await tryApi('GET', '/admin/log'); if (!r) return;
    logBox.replaceChildren(...(r.entries.length ? r.entries.map(e => h('div.au-logrow', h('span', h('b', '@' + (e.actor_name || '?')), ` ${ACTION[e.action] || e.action} `, h('b', (GUILD_ACT.has(e.action) ? '' : '@') + e.target_name), e.detail ? ` · ${e.detail}` : ''), h('small', new Date(e.at).toLocaleString('pt-BR'))))
      : [h('p.au-muted', 'Nenhuma ação ainda.')]));
  };
  const refresh = () => { load(); loadLog(); };
  const act = async (u, what) => {
    if (what === 'ban') {
      const reason = await promptBox(`Suspender @${u.username}?`, 'Motivo (opcional, fica no histórico)', '', 'Suspender');
      if (reason === null) return;
      const r = await tryApi('POST', `/admin/users/${u.id}/ban`, { reason }); if (r) toast(`@${u.username} suspenso. Saiu de ${r.ended} ${r.ended === 1 ? 'aparelho' : 'aparelhos'}.`);
    } else if (what === 'unban') {
      if (await tryApi('POST', `/admin/users/${u.id}/unban`)) toast(`@${u.username} pode entrar de novo.`);
    } else if (what === 'password') {
      if (!await confirmBox(`Redefinir a senha de @${u.username}?`, 'Gera uma senha temporária, que aparece só agora para você passar para a pessoa. Ela sai de todos os aparelhos e deve trocar a senha em Configurações → Minha conta depois de entrar.', 'Redefinir')) return;
      const r = await tryApi('POST', `/admin/users/${u.id}/password`); if (!r) return;
      const copy = h('button.btn.sm.grey', { type: 'button', onclick: () => { navigator.clipboard?.writeText(r.password).then(() => toast('Senha copiada')); } }, icon('copy', 14), 'Copiar');
      modal('Senha temporária', `Passe para @${u.username} por um canal seguro. Ela não aparece de novo.`, h('div.au-pw', h('code', r.password), copy), [{ label: 'Pronto', cls: 'green' }], { width: '440px' });
    } else if (what === 'logout') {
      const r = await tryApi('POST', `/admin/users/${u.id}/logout`); if (r) toast(`Sessões encerradas: ${r.ended}.`);
    } else if (what === 'delete') {
      const typed = await promptBox(`Excluir a conta @${u.username}?`, `Apaga a conta, as mensagens, as conversas diretas${u.owns ? ` e ${u.owns === 1 ? 'o servidor' : `os ${u.owns} servidores`} de que é dono` : ''}. Não dá para desfazer. Digite ${u.username} para confirmar:`, '', 'Excluir para sempre');
      if (typed === null) return;
      if (typed !== u.username) return toast('O nome digitado não confere. Nada foi apagado.', true);
      if (await tryApi('POST', `/admin/users/${u.id}/delete`, { confirm: typed })) toast(`Conta @${u.username} excluída.`);
    }
    refresh();
  };
  const row = (u) => {
    const self = u.id === S.me?.id;
    const tags = [u.admin && h('span.au-tag.adm', 'Admin'), u.banned_at && h('span.au-tag.ban', 'Suspensa'), u.online && h('span.au-tag.on', 'Online')].filter(Boolean);
    const info = [`criada ${when(u.created_at)}`, `último acesso ${when(u.last_seen)}`, `${u.guilds} ${u.guilds === 1 ? 'servidor' : 'servidores'}`, u.sessions ? `${u.sessions} ${u.sessions === 1 ? 'sessão' : 'sessões'}` : 'sem sessão aberta'];
    const more = !self && h('button.ibtn.au-more', { type: 'button', title: 'Ações', 'aria-label': `Ações para @${u.username}`, onclick: (e) => menu(e, [
      u.banned_at ? { label: 'Reativar conta', icon: 'check', fn: () => act(u, 'unban') } : { label: 'Suspender conta', icon: 'shield', hint: 'Sai de todos os aparelhos e não entra mais', fn: () => act(u, 'ban') },
      { label: 'Redefinir senha', icon: 'lock', hint: 'Gera uma senha temporária', fn: () => act(u, 'password') },
      u.guilds > 0 && { label: 'Ver servidores', icon: 'grid', hint: `Os ${u.guilds} ${u.guilds === 1 ? 'servidor' : 'servidores'} em que a conta está`, fn: () => userGuildsModal(u) },
      { label: 'Encerrar sessões', icon: 'logout', hint: 'Sai de todos os aparelhos', fn: () => act(u, 'logout') },
      '-', { label: 'Excluir conta', icon: 'trash', danger: true, fn: () => act(u, 'delete') }]) }, icon('more', 18));
    return h('div.au-row' + (u.banned_at ? '.banned' : ''),
      avatar({ id: u.id, display_name: u.display_name, username: u.username, avatar: u.avatar }, 36, { status: false }),
      h('div.au-t', h('div.au-name', h('b', u.display_name || u.username), h('span.au-user', '@' + u.username), ...tags),
        h('small', info.join(' · ')), u.banned_at && h('small.au-why', `Suspensa ${when(u.banned_at)}${u.banned_reason ? ': ' + u.banned_reason : ''}`)),
      self ? h('small.au-muted', 'Você') : more);
  };
  const draw = () => list.replaceChildren(...(users.length ? users.map(row) : [h('p.au-muted', q.value.trim() ? 'Nenhuma conta com esse nome.' : 'Nenhuma conta.')]));
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  refresh();
  return h('div.adminusers', h('h2', 'Usuários'),
    h('p.au-muted', 'Contas desta instalação do Resenha. Só você, como administrador, vê esta página. Cada ação fica no histórico abaixo.'),
    h('div.au-bar', h('label.au-search', icon('search', 16), q), count),
    list,
    h('h3.sec', 'Histórico'), logBox);
}

// ---------------------------------------------------------------- servidores (server/admin.js /admin/guilds)
// lista de servidores: dono, membros, canais e a última mensagem. Para ver o que tem dentro, o admin entra no servidor
// (aparece para todos como "entrou no servidor"). Excluir pede o nome do servidor.
function guildList({ user = null, onChange = () => { } } = {}) {
  const q = h('input.au-q', { type: 'search', placeholder: 'Buscar servidor', 'aria-label': 'Buscar servidores', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div.au-list', h('p.au-muted', 'Carregando…')), count = h('span.au-muted');
  let t = 0;
  const closeAll = () => { document.querySelectorAll('.backdrop:not(.leaving)').forEach(b => b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); document.getElementById('settings')?._close?.(); document.querySelector('#settings .close')?.click(); };
  const open = async (g) => {
    if (!g.mine) {
      if (!await confirmBox(`Entrar em ${g.name}?`, 'Você entra como membro: todo mundo do servidor vê "entrou no servidor", como acontece com qualquer pessoa. Para sair depois, use o menu do servidor.', 'Entrar')) return;
      const r = await tryApi('POST', `/admin/guilds/${g.id}/join`); if (!r) return;
    }
    closeAll(); setTimeout(() => go(g.id), 300);
  };
  const del = async (g) => {
    const typed = await promptBox(`Excluir o servidor ${g.name}?`, `Apaga o servidor com todos os canais e mensagens, para os ${g.members} ${g.members === 1 ? 'membro' : 'membros'}. Não dá para desfazer. Digite o nome do servidor para confirmar:`, '', 'Excluir para sempre');
    if (typed === null) return;
    if (typed !== g.name) return toast('O nome digitado não confere. Nada foi apagado.', true);
    if (await tryApi('POST', `/admin/guilds/${g.id}/delete`, { confirm: typed })) { toast(`Servidor ${g.name} excluído.`); load(); onChange(); }
  };
  const row = (g) => h('div.au-row',
    h('div.au-gicon', g.icon ? h('img', { src: g.icon, alt: '' }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)),
    h('div.au-t', h('div.au-name', h('b', g.name), g.mine && h('span.au-tag.on', 'Você está')),
      h('small', [`dono @${g.owner_name || '?'}`, `${g.members} ${g.members === 1 ? 'membro' : 'membros'}`, `${g.channels} ${g.channels === 1 ? 'canal' : 'canais'}`, `criado ${when(g.created_at)}`, `última mensagem ${when(g.last_message)}`].join(' · '))),
    h('button.btn.sm' + (g.mine ? '.grey' : ''), { type: 'button', onclick: () => open(g) }, g.mine ? 'Abrir' : 'Entrar'),
    h('button.ibtn', { type: 'button', title: 'Excluir servidor', 'aria-label': `Excluir ${g.name}`, onclick: () => del(g) }, icon('trash', 18)));
  const load = async () => {
    const qs = [user && 'user=' + encodeURIComponent(user.id), q.value.trim() && 'q=' + encodeURIComponent(q.value.trim())].filter(Boolean).join('&');
    const r = await tryApi('GET', '/admin/guilds' + (qs ? '?' + qs : '')); if (!r) return;
    count.textContent = `${r.guilds.length} ${r.guilds.length === 1 ? 'servidor' : 'servidores'}`;
    list.replaceChildren(...(r.guilds.length ? r.guilds.map(row) : [h('p.au-muted', 'Nenhum servidor.')]));
  };
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
  return h('div', h('div.au-bar', h('label.au-search', icon('search', 16), q), count), list);
}
function userGuildsModal(u) {
  modal(`Servidores de @${u.username}`, 'Para ver o que tem dentro, entre no servidor (todos veem que você entrou).', h('div.adminusers.au-modal', guildList({ user: u })), [{ label: 'Fechar', cls: 'grey' }], { width: 'min(720px, 96vw)' });
}
export function adminServersPage() {
  return h('div.adminusers', h('h2', 'Servidores'),
    h('p.au-muted', 'Todos os servidores desta instalação. Só você, como administrador, vê esta página. Entrar e excluir ficam no histórico em Usuários.'),
    guildList());
}

// ---------------------------------------------------------------- cadastro por convite (server/signup.js)
// como contas novas entram (aberto / só com código / fechado) e os códigos: gerar com limite de usos, validade, recado e
// servidor em que a pessoa já entra; copiar o link /convite/<código>; revogar; ver quem criou conta com cada um
const MODES = [['open', 'Aberto', 'Qualquer pessoa com o endereço cria uma conta.'], ['invite', 'Só com convite', 'Contas novas só com um código gerado aqui.'], ['closed', 'Fechado', 'Ninguém cria conta nova.']];
const STATE = { active: ['Ativo', 'on'], used: ['Esgotado', ''], expired: ['Expirado', ''], revoked: ['Revogado', 'ban'] };
export function adminSignupPage() {
  const modeBox = h('div.au-modes'), list = h('div.au-list', h('p.au-muted', 'Carregando…')), forcedNote = h('p.au-muted.hidden');
  const uses = h('select', { 'aria-label': 'Usos' }, [[1, '1 pessoa'], [5, '5 pessoas'], [10, '10 pessoas'], [25, '25 pessoas'], [0, 'Sem limite']].map(([v, l]) => h('option', { value: v }, l)));
  const days = h('select', { 'aria-label': 'Validade' }, [[7, 'Vale 7 dias'], [1, 'Vale 1 dia'], [30, 'Vale 30 dias'], [0, 'Não expira']].map(([v, l]) => h('option', { value: v }, l)));
  const guildSel = h('select', { 'aria-label': 'Servidor' }, h('option', { value: '' }, 'Não entra em servidor'));
  const note = h('input.au-q', { maxLength: 80, placeholder: 'Para quem? (só você vê)', 'aria-label': 'Recado' });
  let data = null;
  const link = (c) => `${location.origin}/convite/${c}`;
  const copy = (c) => navigator.clipboard?.writeText(link(c)).then(() => toast('Link do convite copiado'), () => toast(link(c)));
  const drawModes = () => modeBox.replaceChildren(...MODES.map(([k, l, d]) => h('button.au-mode' + (data?.mode === k ? '.on' : ''), { type: 'button', 'aria-pressed': String(data?.mode === k), disabled: !!data?.forced,
    onclick: async () => { if (data.mode === k) return; const r = await tryApi('POST', '/admin/signup/mode', { mode: k }); if (r) { data.mode = r.mode; drawModes(); toast(k === 'invite' ? 'Agora só entra quem tiver um código.' : k === 'closed' ? 'Cadastro fechado.' : 'Cadastro aberto para qualquer pessoa.'); } } },
  h('b', l), h('small', d))));
  const row = (c) => {
    const [st, cls] = STATE[c.state];
    const info = [`${c.uses}${c.max_uses ? '/' + c.max_uses : ''} ${c.uses === 1 ? 'uso' : 'usos'}`, c.expires_at ? (c.state === 'expired' ? 'expirou ' : 'vale até ') + new Date(c.expires_at).toLocaleDateString('pt-BR') : 'não expira', c.guild_name && `entra em ${c.guild_name}`, `criado ${when(c.created_at)}`].filter(Boolean);
    return h('div.au-row' + (c.state !== 'active' ? '.banned' : ''),
      h('div.au-t', h('div.au-name', h('code.au-code', c.code), h('span.au-tag' + (cls ? '.' + cls : ''), st), c.note && h('span.au-user', c.note)),
        h('small', info.join(' · ')),
        c.users.length ? h('small', 'Criaram conta: ' + c.users.map(u => '@' + u.username).join(', ')) : null),
      c.state === 'active' && h('button.btn.sm', { type: 'button', onclick: () => copy(c.code) }, icon('copy', 14), 'Copiar link'),
      c.state === 'active' && h('button.ibtn', { type: 'button', title: 'Revogar', 'aria-label': `Revogar ${c.code}`, onclick: async () => {
        if (!await confirmBox('Revogar este convite?', 'O código para de valer na hora. Quem já criou conta com ele continua com a conta.', 'Revogar')) return;
        if (await tryApi('POST', `/admin/signup/codes/${c.code}/revoke`)) load();
      } }, icon('trash', 18)));
  };
  const load = async () => {
    const r = await tryApi('GET', '/admin/signup'); if (!r) return;
    data = r; drawModes();
    forcedNote.classList.toggle('hidden', !r.forced); forcedNote.textContent = 'O cadastro está fechado pela configuração do servidor (OPEN_REGISTRATION=0). Tire essa opção do container para escolher aqui.';
    const cur = guildSel.value; guildSel.replaceChildren(h('option', { value: '' }, 'Não entra em servidor'), ...r.guilds.map(g => h('option', { value: g.id, selected: g.id === cur }, 'Entra em ' + g.name)));
    list.replaceChildren(...(r.codes.length ? r.codes.map(row) : [h('p.au-muted', 'Nenhum convite ainda.')]));
  };
  const create = h('button.btn', { type: 'button', onclick: async () => {
    const r = await tryApi('POST', '/admin/signup/codes', { max_uses: +uses.value, days: +days.value, note: note.value.trim(), guild_id: guildSel.value || null }); if (!r) return;
    note.value = ''; await load();
    const btn = h('button.btn.sm.grey', { type: 'button', onclick: () => copy(r.code) }, icon('copy', 14), 'Copiar');
    modal('Convite criado', 'Mande o link para a pessoa. Abrindo, a tela de criar conta já vem com o código preenchido.', h('div.au-pw', h('code.au-link', link(r.code)), btn), [{ label: 'Pronto', cls: 'green' }], { width: '520px' });
    if (data?.mode === 'open') toast('O cadastro está aberto: o código não é exigido. Escolha "Só com convite" acima para exigir.');
  } }, icon('plus', 16), 'Gerar convite');
  load();
  return h('div.adminusers', h('h2', 'Convites de cadastro'),
    h('p.au-muted', 'Escolha como contas novas entram nesta instalação do Resenha. No modo "Só com convite", cada pessoa precisa de um código gerado aqui. Só você, como administrador, vê esta página.'),
    h('h3.sec', 'Quem pode criar conta'), modeBox, forcedNote,
    h('h3.sec', 'Novo convite'), h('div.au-new', uses, days, guildSel, note, create),
    h('h3.sec', 'Convites'), list);
}
