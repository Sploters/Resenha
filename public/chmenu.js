// Menus e configurações de canal: criar, duplicar, sincronizar permissões e editar.
import { openMyMessages } from './mymessages.js';
import { importModal } from './importer.js';
import { h, icon } from './util.js';
import { S, tryApi, can, canInvite, PERM, toast, modal, confirmBox, promptBox, menu, channelMuted, serverMuted, setChannelUnmuted, savePrefs, CH, CH_LABELS, CH_KINDS, isChatCh } from './state.js';
import { chName } from './chnames.js';
import { ack } from './unread.js';
import { go } from './nav.js';
import { inviteModal } from './rail.js';
import { renderSide } from './side.js';
import { isFav, toggleFav, favGroupMenuItem } from './favs.js';
import { joinVoice } from './userbar.js';
import { playInviteModal } from './callinvite.js';
export function channelModal(g, type, parent) {
  const name = h('input', { placeholder: type === 2 ? 'Sala de voz' : type === 4 ? 'Nova categoria' : type === 15 ? 'ideias-e-discussões' : 'novo-canal', maxLength: 100 });
  let t = type;
  // tipos de canal em cartões (ideia "Kinds of Channels", Stoat #1027)
  const KINDS = [[0, 'Texto', 'Conversa normal: mensagens, fotos, GIFs e enquetes'], [2, 'Voz', 'Chamada de voz e vídeo, com transmissão de tela'],
    [5, 'Anúncios', 'Só a moderação escreve; todos leem e reagem. Libere um cargo nas permissões do canal'],
    [15, 'Fórum', 'Posts com título, tags, votos e comentários'], [16, 'Galeria', 'Cada post é uma foto ou vídeo; abre em grade'],
    [17, 'Documento', 'Uma página para regras, guias e listas de tarefas, editada pela moderação']];
  const PH = { 2: 'Sala de voz', 5: 'anúncios', 15: 'ideias-e-discussões', 16: 'fotos-e-vídeos', 17: 'regras' };
  const typeSel = type === 4 ? null : h('div.chkinds', { role: 'radiogroup' });
  const drawKinds = () => typeSel?.replaceChildren(...KINDS.map(([k, l, d]) => h('button.chkind' + (t === k ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(t === k),
    onclick: () => { t = k; name.placeholder = PH[k] || 'novo-canal'; drawKinds(); } }, h('span.ck-ic', icon(CH_KINDS[k][0], 22)), h('span.ck-t', h('b', l), h('small', d)))));
  drawKinds();
  modal(type === 4 ? 'Criar categoria' : 'Criar canal', '', h('div', typeSel && h('div.f', h('span', 'Tipo de canal'), typeSel), h('label.f', 'Nome', name)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Criar', fn: async () => { const r = await tryApi('POST', `/guilds/${g.id}/channels`, { name: name.value, type: t, parent_id: parent }); if (!r) return false; if (t !== 4) setTimeout(() => go(g.id, r.id), 100); } }]);
}
export function channelMenu(e, g, c) {
  menu(e, [
    c.type === 2 && { label: 'Entrar no canal de voz', fn: () => { go(g.id, c.id); joinVoice(c.id); } },
    c.type === 2 && { label: 'Chamar pra jogar', fn: () => playInviteModal(c.id) },
    c.type === 2 && { label: 'Separar por jogos', checked: !!S.prefs.voiceByGame, fn: () => { S.prefs.voiceByGame = !S.prefs.voiceByGame; savePrefs(); renderSide(); } },
    c.type !== 4 && { label: isFav(c.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos', fn: () => toggleFav(c) },
    c.type !== 4 && isFav(c.id) && favGroupMenuItem(c.id),
    S.unread[c.id] && { label: 'Marcar como lido', fn: () => ack(c.id) },
    // servidor silenciado: o canal (ou a categoria inteira) pode voltar a avisar sem tirar o silêncio do resto
    serverMuted(g.id) && !channelMuted(c.id) ? (S.prefs.notifyCfg?.chUnmute?.[c.id]
      ? { label: c.type === 4 ? 'Silenciar a categoria de novo' : 'Silenciar de novo (seguir o servidor)', fn: () => { setChannelUnmuted(c.id, false); renderSide(); toast(c.type === 4 ? 'A categoria voltou a seguir o servidor silenciado' : `#${chName(c)} voltou a seguir o servidor silenciado`); } }
      : { label: c.type === 4 ? 'Reativar esta categoria' : 'Reativar este canal', hint: 'O servidor continua silenciado', fn: () => { setChannelUnmuted(c.id, true); renderSide(); toast(c.type === 4 ? 'Categoria reativada: o resto do servidor continua silenciado' : `#${chName(c)} reativado: o resto do servidor continua silenciado`); } })
      : c.type !== 4 && { label: channelMuted(c.id) ? 'Reativar canal' : 'Silenciar canal', fn: () => { const n = (S.prefs.notifyCfg ||= {}); const ch = (n.channels ||= {}); channelMuted(c.id) ? delete ch[c.id] : (ch[c.id] = true); savePrefs(); renderSide(); } },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: c.type === 4 ? 'Editar categoria' : 'Editar canal', hint: can(g.id, PERM.MANAGE_ROLES) ? 'Nome, descrição e permissões' : null, fn: () => channelSettings(g, c) },
    can(g.id, PERM.MANAGE_CHANNELS) && c.type !== 4 && { label: 'Duplicar canal', hint: 'Mesma categoria, tópico e permissões', fn: () => duplicateChannel(g, c) },
    can(g.id, PERM.MANAGE_CHANNELS) && can(g.id, PERM.MANAGE_ROLES) && c.type === 4 && g.channels.some(k => k.parent_id === c.id && k.perm_sync === 0) && { label: 'Sincronizar canais com a categoria', hint: 'Os canais com permissões próprias voltam a seguir a categoria', fn: () => syncChildren(g, c) },
    canInvite(g) && { label: 'Convidar pessoas', fn: () => inviteModal(g) },
    isChatCh(c) && { label: 'Apagar minhas mensagens aqui…', fn: () => openMyMessages({ places: [c.id], title: '#' + chName(c) }) },
    isChatCh(c) && can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Importar conversa do Discord…', fn: () => importModal(c) },
    S.prefs.devMode && { label: 'Copiar ID do canal', fn: () => navigator.clipboard?.writeText(c.id) },
    can(g.id, PERM.MANAGE_CHANNELS) && '-',
    can(g.id, PERM.MANAGE_CHANNELS) && { label: c.type === 4 ? 'Excluir categoria' : 'Excluir canal', hint: c.type === 4 ? 'Os canais dela ficam sem categoria' : null, danger: true, fn: async () => { if (await confirmBox(`Excluir ${c.name}`, 'Isto não pode ser desfeito.', 'Excluir')) tryApi('DELETE', `/channels/${c.id}`); } },
  ]);
}
async function duplicateChannel(g, c) {
  const n = await promptBox(`Duplicar ${c.type === 2 ? c.name : '#' + chName(c)}`, 'Nome do canal novo', c.name, 'Duplicar'); if (n == null) return;
  const r = await tryApi('POST', `/channels/${c.id}/duplicate`, { name: n || c.name });
  if (r?.id) { toast('Canal duplicado'); if (c.type !== 2) setTimeout(() => go(g.id, r.id), 100); }
}
async function syncChildren(g, cat) {
  const n = g.channels.filter(k => k.parent_id === cat.id && k.perm_sync === 0).length;
  if (!await confirmBox('Sincronizar canais', `${n === 1 ? '1 canal tem' : n + ' canais têm'} permissões próprias em ${cat.name}. Eles voltam a seguir as permissões da categoria (as próprias são apagadas).`, 'Sincronizar')) return;
  const r = await tryApi('POST', `/channels/${cat.id}/sync-children`); if (r) toast(r.synced === 1 ? '1 canal sincronizado' : `${r.synced} canais sincronizados`);
}
// Configurações do canal ou da categoria: nome, tópico/descrição, categoria e permissões por cargo (permitir / seguir / negar).
// Canal sincronizado mostra (e edita) as permissões da categoria; mudar algo aqui tira a sincronia e o canal passa a ter as próprias.
export function channelSettings(g, c) {
  const cat = c.type === 4, name = h('input', { value: c.name, maxLength: 100 }), topic = h('textarea', { value: c.topic || '', maxLength: 1024, rows: 2, placeholder: cat ? 'Para que serve esta categoria (aparece ao passar o mouse)' : 'Sobre o que é este canal' });
  const cats = g.channels.filter(x => x.type === 4);
  const parentSel = !cat && c.type !== 11 && h('select', h('option', { value: '' }, 'Sem categoria'), cats.map(x => h('option', { value: x.id, selected: x.id === c.parent_id }, x.name)));
  const manageRoles = can(g.id, PERM.MANAGE_ROLES);
  const parentCat = () => g.channels.find(x => x.id === (parentSel ? parentSel.value || null : c.parent_id) && x.type === 4);
  let synced = !cat && !!c.parent_id && c.perm_sync !== 0, dirty = false, wantSync = false;
  const load = (id) => new Map((g.channel_perms?.[id] || []).map(o => [o.target, { allow: o.allow, deny: o.deny }]));
  let ows = load(synced ? c.parent_id : c.id), target = 'everyone';
  const VOICE_BITS = CH.CONNECT | CH.SPEAK | CH.VIDEO; // só fazem sentido em sala de voz (e na categoria, que pode ter salas)
  const bits = CH_LABELS.filter(([b]) => cat || c.type === 2 || !(b & VOICE_BITS));
  const targets = () => [{ id: 'everyone', name: '@everyone', color: '' }, ...g.roles.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name, color: r.color }))];
  const permBox = h('div.chp');
  const draw = () => {
    const pc = parentCat();
    const syncLine = !cat && (pc ? h('div.chp-sync' + (synced ? '.on' : ''), icon(synced ? 'link' : 'warn', 16),
        h('span', synced ? `Sincronizado com a categoria ${pc.name}. Mudar algo aqui dá a este canal permissões próprias (a categoria não muda).` : `Permissões próprias: não segue a categoria ${pc.name}.`),
        !synced && h('button.btn.grey.sm', { type: 'button', onclick: () => { synced = true; wantSync = true; dirty = false; ows = load(pc.id); draw(); } }, 'Sincronizar agora'))
      : h('div.chp-sync', icon('info', 16), h('span', 'Sem categoria: as permissões valem só para este canal.')));
    const o = ows.get(target) || { allow: 0, deny: 0 };
    const set = (bit, v) => { // v: 1 permitir, 0 seguir, -1 negar
      const n = { allow: o.allow & ~bit, deny: o.deny & ~bit }; if (v > 0) n.allow |= bit; if (v < 0) n.deny |= bit;
      if (synced) { synced = false; wantSync = false; } // editar um sincronizado: copia o da categoria e passa a ter o próprio
      ows.set(target, n); dirty = true; draw();
    };
    const tri = (bit) => { const v = o.allow & bit ? 1 : o.deny & bit ? -1 : 0;
      return h('div.chp-tri', [[-1, 'x', 'Negar'], [0, 'slash', target === 'everyone' ? 'Padrão (liberado)' : 'Seguir (@everyone e outros cargos)'], [1, 'check', 'Permitir']].map(([k, ic, t]) =>
        h('button.chp-b' + (v === k ? '.sel.v' + (k + 1) : ''), { type: 'button', title: t, 'aria-label': t, 'aria-pressed': String(v === k), onclick: () => set(bit, k) }, ic === 'slash' ? '/' : icon(ic, 14)))); };
    permBox.replaceChildren(syncLine || '',
      h('div.chp-grid',
        h('div.chp-roles', targets().map(t => { const has = ows.get(t.id), mark = has && (has.allow || has.deny);
          return h('button.chp-role' + (t.id === target ? '.sel' : ''), { type: 'button', onclick: () => { target = t.id; draw(); } }, h('i.dot', { style: { background: t.color && t.color !== '#99aab5' ? t.color : 'var(--text-muted)' } }), h('span', t.name), mark && h('small', '•')); })),
        h('div.chp-perms', h('div.chp-h', 'Permissões de ', h('b', targets().find(t => t.id === target)?.name || '')),
          bits.map(([bit, label, hint]) => h('div.chp-row', h('div', h('b', label), h('small', hint)), tri(bit))),
          h('small.mut', 'Dono, administradores e quem gerencia canais nunca são barrados. O permitir de um cargo vence o negar de outro.'))));
  };
  if (manageRoles) draw();
  const body = h('div', h('label.f', cat ? 'Nome da categoria' : 'Nome do canal', name),
    (cat || [0, 2, 5, 15, 16, 17].includes(c.type)) && h('label.f', cat ? 'Descrição' : 'Tópico', topic),
    parentSel && h('label.f', 'Categoria', parentSel),
    manageRoles && h('div.f', h('div.chp-title', 'Permissões'), cat && h('small.mut', { style: { display: 'block', marginBottom: '8px' } }, 'Valem para todos os canais sincronizados desta categoria.'), permBox));
  if (parentSel) parentSel.addEventListener('change', () => { if (synced) { const pc = parentCat(); if (pc) ows = load(pc.id); else { synced = false; ows = load(c.id); } draw(); } });
  const dlg = modal(cat ? 'Configurações da categoria' : 'Configurações do canal', c.name, body,
    [{ label: 'Excluir', cls: 'red', fn: async () => { if (await confirmBox(cat ? 'Excluir categoria' : 'Excluir canal', `Excluir ${c.name}?${cat ? ' Os canais dela ficam sem categoria.' : ''}`, 'Excluir')) await tryApi('DELETE', `/channels/${c.id}`); } }, { label: 'Cancelar', cls: 'link' },
     { label: 'Salvar', fn: async () => {
       const patch = { name: name.value, topic: topic.value }; if (parentSel) patch.parent_id = parentSel.value || null;
       if (!await tryApi('PATCH', `/channels/${c.id}`, patch)) return false;
       if (manageRoles && wantSync && parentCat()) { if (!await tryApi('PUT', `/channels/${c.id}/perms`, { sync: true })) return false; }
       else if (manageRoles && dirty) { if (!await tryApi('PUT', `/channels/${c.id}/perms`, { overwrites: [...ows].map(([t, v]) => ({ target: t, ...v })) })) return false; }
     } }], { width: manageRoles ? '620px' : undefined });
  dlg.el.querySelector('.modal')?.classList.add('chset');
}
