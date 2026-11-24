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
const ACTION = { ban: 'suspendeu', unban: 'reativou', password: 'redefiniu a senha de', logout: 'encerrou as sessões de', delete: 'excluiu a conta de', guild_join: 'entrou no servidor', guild_delete: 'excluiu o servidor' };
const GUILD_ACT = new Set(['guild_join', 'guild_delete']); // alvo é um servidor (sem @)

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
