// Configurações → Administração → Usuários (só o administrador da instalação; server/admin.js): buscar contas,
// suspender/reativar, redefinir senha (mostra a temporária uma vez), encerrar sessões, excluir conta e o histórico do
// que foi feito. Carregado sob demanda pela página de configurações.
import { h, icon, avatar } from './util.js';
import { S, tryApi, toast, modal, confirmBox, promptBox, menu } from './state.js';

const when = (t) => {
  if (!t) return '—';
  const d = Date.now() - t, m = Math.round(d / 60e3);
  if (m < 2) return 'agora'; if (m < 60) return `há ${m} min`;
  const hr = Math.round(m / 60); if (hr < 24) return `há ${hr} h`;
  const dy = Math.round(hr / 24); if (dy < 30) return `há ${dy} ${dy === 1 ? 'dia' : 'dias'}`;
  return new Date(t).toLocaleDateString('pt-BR');
};
const ACTION = { ban: 'suspendeu', unban: 'reativou', password: 'redefiniu a senha de', logout: 'encerrou as sessões de', delete: 'excluiu a conta de' };

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
    logBox.replaceChildren(...(r.entries.length ? r.entries.map(e => h('div.au-logrow', h('span', h('b', '@' + (e.actor_name || '?')), ` ${ACTION[e.action] || e.action} `, h('b', '@' + e.target_name), e.detail ? ` · ${e.detail}` : ''), h('small', new Date(e.at).toLocaleString('pt-BR'))))
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
