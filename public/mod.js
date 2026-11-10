// Moderação: castigo (timeout), banimento e registro de auditoria
import { h, icon, avatar, stamp, busy } from './util.js';
import { S, tryApi, toast, modal, nameOf, user, guild, member, can, PERM, channelById } from './state.js';
import { seg, toggle, row, section } from './ui.js';

const DURATIONS = { 60: '60 s', 300: '5 min', 600: '10 min', 3600: '1 hora', 86400: '1 dia', 604800: '1 semana' };
export const timedOutUntil = (gid, uid) => { const t = member(gid, uid)?.timeout_until; return t && t > Date.now() ? t : null; };

export function timeoutDialog(gid, uid) {
  let secs = 600; const reason = h('input', { maxLength: 300, placeholder: 'Opcional' });
  modal(`Castigo para ${nameOf(uid, gid)}`, 'Durante o castigo a pessoa não envia mensagens, não reage e não entra em canais de voz.',
    h('div', h('label.f', 'Duração', seg(DURATIONS, String(secs), v => (secs = +v))), h('label.f', 'Motivo', reason)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Aplicar castigo', cls: 'red', fn: async () => {
      const r = await tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { timeout_until: Date.now() + secs * 1000, reason: reason.value });
      if (r) toast(`${nameOf(uid, gid)} está de castigo por ${DURATIONS[secs]}`);
    } }]);
}
export const removeTimeout = (gid, uid) => tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { timeout_until: null }).then(r => r && toast('Castigo removido'));

export function banDialog(gid, uid, after) {
  const reason = h('input', { maxLength: 300, placeholder: 'Opcional' }), del = h('input', { type: 'checkbox' });
  modal(`Banir ${nameOf(uid, gid)}`, 'A pessoa sai do servidor e não consegue voltar por convite até ser desbanida.',
    h('div', h('label.f', 'Motivo', reason), h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, del, 'Apagar as mensagens dela das últimas 24 horas')),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Banir', cls: 'red', fn: async () => {
      const r = await tryApi('PUT', `/guilds/${gid}/bans/${uid}`, { reason: reason.value, delete_messages: del.checked });
      if (r) { toast('Usuário banido'); after?.(); }
    } }]);
}

const hint = (t) => h('div.hintline', t);
export function bansPage(gid) {
  const box = h('div');
  const draw = async () => {
    const list = await tryApi('GET', `/guilds/${gid}/bans`) || [];
    box.replaceChildren(...list.map(b => h('div.frow', { style: { cursor: 'default' } }, avatar(b.user || user(b.user_id), 36, { status: false }),
      h('div.fn', h('b', b.user?.display_name || 'Usuário excluído'), h('small', `${b.reason ? 'Motivo: ' + b.reason + ' • ' : ''}${stamp(b.created_at)}`)),
      h('button.btn.grey', { onclick: async () => { await tryApi('DELETE', `/guilds/${gid}/bans/${b.user_id}`); toast('Banimento removido'); draw(); } }, 'Desbanir'))));
    if (!list.length) box.append(hint('Ninguém banido.'));
  };
  draw();
  return h('div', h('h2', 'Banimentos'), box);
}

const ACTIONS = {
  member_kick: 'expulsou', member_ban: 'baniu', member_unban: 'desbaniu', member_timeout: 'deu castigo a', member_timeout_remove: 'tirou o castigo de',
  member_roles: 'alterou os cargos de', message_delete: 'apagou uma mensagem de', message_spoiler: 'marcou como spoiler uma mensagem de', message_unspoiler: 'tirou o spoiler de uma mensagem de', role_create: 'criou o cargo', role_update: 'editou o cargo', role_delete: 'excluiu o cargo',
  channel_create: 'criou o canal', channel_update: 'editou o canal', channel_delete: 'excluiu o canal', guild_update: 'editou o servidor', guild_transfer: 'transferiu o servidor para', invite_delete: 'revogou o convite',
};
const USER_TARGET = /^(member_|message_delete|message_spoiler|message_unspoiler|guild_transfer)/;
export function auditPage(gid) {
  const box = h('div'), more = h('button.btn.grey', { style: { marginTop: '12px' } }, 'Carregar mais');
  const names = new Map();
  const nm = (id) => (id && guild(gid)?.members.has(id) ? nameOf(id, gid) : names.get(id)?.display_name || user(id).display_name);
  const load = async (before) => {
    const r = await tryApi('GET', `/guilds/${gid}/audit${before ? '?before=' + before : ''}`); if (!r) return;
    for (const u of r.users) names.set(u.id, u);
    for (const e of r.entries) {
      const tgt = USER_TARGET.test(e.action) ? h('b', nm(e.target_id)) : null;
      let det = e.details || '';
      if (e.action === 'member_timeout' && /^\d{4}-/.test(det)) det = 'até ' + new Date(det.slice(0, 24)).toLocaleString('pt-BR') + det.slice(24);
      const sys = !e.actor_id; // ação automática (reputação): sem pessoa
      box.append(h('div.frow', { style: { cursor: 'default' } }, sys ? h('div.rep-sys', icon('shield', 20)) : avatar(names.get(e.actor_id) || user(e.actor_id), 32, { status: false }),
        h('div.fn', h('span', h('b', sys ? 'Reputação (automático)' : nm(e.actor_id)), ' ', ACTIONS[e.action] || e.action, tgt && ' ', tgt, det && !tgt ? ' ' : '', det && !tgt ? h('b', det) : null),
          h('small', stamp(e.created_at) + (det && tgt ? ' • ' + det : '')))));
    }
    more.style.display = r.entries.length === 100 ? '' : 'none';
    more.onclick = () => busy(more, load(r.entries.at(-1).id));
    if (!box.children.length) box.append(hint('Nenhuma ação registrada ainda.'));
  };
  load();
  return h('div', h('h2', 'Registro de auditoria'), hint('Ações de moderação e de administração feitas neste servidor.'), box, more);
}

// ---------- Reputação (moderação comunitária) ----------
// Casos abertos: quem foi limitado automaticamente porque várias pessoas marcaram as mensagens, com as mensagens marcadas.
// O moderador decide: "Falso alarme" (libera e quem marcou perde peso), "Confirmar" (libera o limite e registra que era
// mesmo; normalmente seguido de castigo/banimento, nos botões ao lado). Quem gerencia o servidor ajusta a regra.
const KIND_LABEL = { spam: 'spam', toxic: 'ofensiva', block: 'bloqueio' };
export const isRepMod = (gid) => can(gid, PERM.MODERATE) || can(gid, PERM.MANAGE_MESSAGES);
export function repPage(gid, { onJump } = {}) {
  const box = h('div'), cfgBox = h('div');
  const until = (t) => (t ? 'limite até ' + new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' (se ninguém analisar)' : '');
  const STATE = { cleared: 'Falso alarme', confirmed: 'Confirmado', expired: 'Expirou sem análise' };
  const caseEl = (c, open) => h('div.rep-case' + (open ? '.open' : ''),
    h('div.rep-head', avatar(user(c.user_id), 36, { status: false }),
      h('div.fn', h('b', nameOf(c.user_id, gid)), h('small', `${c.flaggers} ${c.flaggers === 1 ? 'pessoa marcou' : 'pessoas marcaram'} · ${stamp(c.created_at)}${open ? ' · ' + until(c.softmute_until) : ' · ' + (STATE[c.state] || c.state) + (c.resolved_by ? ' por ' + nameOf(c.resolved_by, gid) : '')}`)),
      open && h('div.rep-act',
        h('button.btn.grey.sm', { title: 'Ninguém fez nada de errado: tira o limite e quem marcou passa a pesar menos', onclick: (e) => busy(e.currentTarget, resolve(c, 'clear')) }, 'Falso alarme'),
        h('button.btn.sm', { title: 'Era mesmo: tira o limite e registra (use castigo ou banimento se precisar)', onclick: (e) => busy(e.currentTarget, resolve(c, 'confirm')) }, 'Confirmar'),
        can(gid, PERM.MODERATE) && h('button.btn.red.sm', { onclick: () => timeoutDialog(gid, c.user_id) }, 'Castigo…'),
        can(gid, PERM.BAN) && h('button.btn.red.sm', { onclick: () => banDialog(gid, c.user_id, draw) }, 'Banir…'))),
    c.messages?.length > 0 && h('div.rep-msgs', c.messages.map(m => h('button.rep-msg', { type: 'button', title: 'Ir para a mensagem', onclick: () => onJump?.(m) },
      h('span.rep-k', m.kinds.map(k => KIND_LABEL[k] || k).join(', ') + ` · ${m.n}`), h('span.rep-t', m.content || '(anexo)'), h('small', '#' + (channelById(m.channel_id)?.name || 'canal') + ' · ' + stamp(m.created_at))))));
  const resolve = async (c, action) => { const r = await tryApi('POST', `/guilds/${gid}/reputation/${c.user_id}/resolve`, { action }); if (r) { toast(action === 'clear' ? 'Limite retirado (falso alarme)' : 'Caso confirmado e limite retirado'); draw(); } };
  const drawCfg = (st) => {
    if (!can(gid, PERM.MANAGE_GUILD)) return cfgBox.replaceChildren(hint(st.on ? `Ligado: ${st.threshold} pessoas em 10 min → 1 mensagem a cada ${st.slow >= 60 ? st.slow / 60 + ' min' : st.slow + ' s'}.` : 'Desligado neste servidor.'));
    const save = async (patch) => { const r = await tryApi('PATCH', `/guilds/${gid}/reputation`, patch); if (r) { drawCfg(r); toast('Regra salva'); } };
    cfgBox.replaceChildren(
      row('Limitar automaticamente', 'Quando várias pessoas diferentes marcam mensagens de alguém como spam ou ofensivas (ou o bloqueiam logo depois de ele falar) em 10 minutos, a pessoa passa a enviar só 1 mensagem a cada intervalo, até a moderação analisar. Donos e moderadores nunca são limitados; contas que entraram há menos de 10 minutos não contam.', toggle(st.on, (v) => save({ on: v }))),
      st.on && row('Quantas pessoas', 'Pessoas diferentes que precisam marcar (cada uma conta uma vez).', seg([[2, '2'], [3, '3'], [4, '4'], [5, '5'], [8, '8']], st.threshold, (v) => save({ threshold: v }))),
      st.on && row('Enquanto limitado', 'Intervalo mínimo entre as mensagens de quem foi limitado. O limite some sozinho em 24 h se ninguém analisar.', seg([[60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min']], st.slow, (v) => save({ slow: v }))));
  };
  const draw = async () => {
    const r = await tryApi('GET', `/guilds/${gid}/reputation`); if (!r) return;
    drawCfg(r.settings);
    box.replaceChildren(section('Casos abertos'), ...(r.open.length ? r.open.map(c => caseEl(c, true)) : [hint('Nenhum caso aberto. Quando alguém for limitado pela comunidade, aparece aqui (e os moderadores recebem um aviso).')]),
      r.closed.length > 0 && section('Analisados'), ...r.closed.slice(0, 20).map(c => caseEl(c, false)));
  };
  draw();
  const root = h('div.rep-page', h('h2', 'Reputação'), hint('Proteção instantânea contra spam e trolls sem banir ninguém por robô: a comunidade sinaliza, o app limita o envio por um tempo e a moderação decide.'), cfgBox, box);
  root._refresh = draw;
  return root;
}
export function repModal(gid, onJump) {
  let m; const page = repPage(gid, { onJump: (msg) => { m?.close(); onJump?.(msg); } });
  m = modal('Reputação', guild(gid)?.name || '', page, [{ label: 'Fechar', cls: 'grey' }], { width: '640px' });
  return m;
}
// marcar uma mensagem (menu da mensagem): esconde para mim na hora e conta como sinal para a reputação do autor
const FKEY = 'lc_flagged';
export const flaggedMap = (() => { try { return new Map(JSON.parse(localStorage.getItem(FKEY) || '[]')); } catch { return new Map(); } })();
const saveFlagged = () => { try { localStorage.setItem(FKEY, JSON.stringify([...flaggedMap].slice(-300))); } catch { } };
export async function flagMessage(m, kind, after) {
  const r = await tryApi('POST', `/channels/${m.channel_id}/messages/${m.id}/flag`, { kind }); if (!r) return;
  flaggedMap.set(m.id, kind); saveFlagged(); after?.();
  toast(kind === 'spam' ? 'Marcada como spam e escondida para você. Obrigado por avisar.' : 'Denúncia registrada e mensagem escondida para você. A moderação vai ver.');
}
export async function unflagMessage(m, after) {
  await tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/flag`);
  flaggedMap.delete(m.id); saveFlagged(); after?.();
}
