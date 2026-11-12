import { h, icon, avatar, framePos, parsePos, whenGone, soundEmoji, debounce, cleanLinks } from './util.js';
import { S, api, tryApi, loadMembers, savePrefs, setDevice, focusOn, setFocus, user, guild, can, PERM, PERM_LABELS, toast, confirmBox, promptBox, modal, menu, nameOf, desktop, applyTheme, emojiPicker, channelById } from './state.js';
import { createMic, newAudioContext, NOISE_MODES, VOICE_BITRATES } from './voice.js';
import { profileCard } from './card.js';
import { seg, toggle, row, section, factChips, slider, qualityPanel, captureKey, comboToAccel, infoTip, choiceCards, vrow, toggleCards, NOISE_INFO, noisePrev } from './ui.js';
import { playSound, SOUND_DEFS, soundCfg, SOUND_GROUP_VOL } from './sounds.js';
import { soundSources, mySounds, addSound, editSound, playLocal, soundVol } from './soundboard.js';
import { applyOutput, FOCUS_TIMES, focusUntilOf, focusLabel } from './quick.js';
import { timeoutDialog, removeTimeout, banDialog, timedOutUntil, bansPage, auditPage, repPage } from './mod.js';
import { LANGS, myLang } from './translate.js';
import { SOLID_THEMES, GRADIENT_THEMES, gradientCss, decodeTheme, PROFILE_THEMES, parseColorPair, isLightPair, NAME_FONTS, NAME_EFFECTS, TWO_COLOR_EFFECTS, styleName } from './themes.js';
import { openThemeEditor, shareTheme } from './themeeditor.js';
import { prettyName, DEFAULT_NAME_WORDS } from './chnames.js';
import { PREVIEW_TRIGGERS } from './chpreview.js';
import { MAX_VOL } from './quick.js';
import { refreshFreeze } from './freeze.js';
import { connectionsPage } from './activity.js';
import { litePage, liteOn } from './lite.js';
import { openNativeTest } from './nativetest.js';
import { newsPage } from './changelog.js';
import { backCloses } from './backclose.js';
import { checkAppUpdate, installAppUpdate, silentUpdate, runAppUpdate } from './appupdate.js';
import { openReport } from './diag.js';
import { storagePage, serverStoragePage } from './storagepage.js';
import { openMyMessages } from './mymessages.js';
import { track, clearUx, uxOn, settingsPage } from './ux.js';
import { e2eeLoad, e2eeState, e2eeSupported, myFingerprintKey, setupModal, unlockModal, changePassModal, newKeyModal, resetModal, lockHere, setPaused } from './e2ee.js';

const SWATCHES = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55d', '#faa61a', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#95a5a6', '#2c2f33', '#ffffff'];
const save = () => savePrefs();

async function uploadFile(accept = 'image/*', maxMB = 12) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, onchange: async () => {
      const f = i.files[0]; if (!f) return res(null);
      if (f.size > maxMB * 1048576) { toast(`Arquivo muito grande (máx. ${maxMB} MB)`, true); return res(null); }
      try { res({ ...(await api('POST', `/upload?name=${encodeURIComponent(f.name)}`, f)), file: f }); } catch (e) { toast(e.message, true); res(null); }
    } });
    i.click();
  });
}
const uploadImage = () => uploadFile('image/*', 12);
// avatares prontos do servidor + opção de enviar uma imagem própria
// ajustar enquadramento: arraste a imagem e use o zoom; salva "x,y,zoom"
function positionEditor(kind, url, current, onSave) {
  const isAv = kind === 'avatar', p = parsePos(current);
  const img = h('img', { src: url, alt: '', draggable: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } });
  const frame = h('div', { style: { position: 'relative', overflow: 'hidden', cursor: 'grab', touchAction: 'none', background: '#000', margin: '0 auto', ...(isAv ? { width: '220px', height: '220px', borderRadius: '50%' } : { width: '100%', maxWidth: '420px', aspectRatio: '3 / 1', borderRadius: '8px' }) } }, img);
  const apply = () => framePos(img, p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(2));
  apply();
  let drag = null;
  frame.onpointerdown = (e) => { frame.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }; frame.style.cursor = 'grabbing'; };
  frame.onpointerup = frame.onpointercancel = () => { drag = null; frame.style.cursor = 'grab'; };
  frame.onpointermove = (e) => {
    if (!drag) return; const r = frame.getBoundingClientRect();
    // arrastar para a direita mostra mais da esquerda da imagem (x diminui); o movimento útil é proporcional ao excesso da imagem
    p.x = Math.max(0, Math.min(100, drag.px - (e.clientX - drag.x) / r.width * 100));
    p.y = Math.max(0, Math.min(100, drag.py - (e.clientY - drag.y) / r.height * 100));
    apply();
  };
  const zoom = h('input', { type: 'range', min: 1, max: 3, step: 0.05, value: p.z, style: { width: '100%', marginTop: '14px' }, oninput: () => { p.z = +zoom.value; apply(); } });
  modal(isAv ? 'Ajustar avatar' : 'Ajustar banner', 'Arraste a imagem para reposicionar e use o controle para dar zoom.', h('div', frame, h('label.f', { style: { marginTop: '14px' } }, 'Zoom'), zoom),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Centralizar', cls: 'grey', fn: () => { p.x = p.y = 50; p.z = 1; zoom.value = 1; apply(); return false; } }, { label: 'Aplicar', cls: 'green', fn: () => onSave(p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(2)) }]);
}
async function avatarPicker(current, onPick) {
  const info = await fetch('/api/server-info').then(r => r.json()).catch(() => ({}));
  let m;
  const pick = (url) => { onPick(url, ''); m.close(); };
  // imagem própria: abre o enquadramento antes; só troca o avatar se o usuário aplicar
  const upload = async () => { const u = await uploadImage(); if (!u) return; m.close(); positionEditor('avatar', u.url, '', (pos) => onPick(u.url, pos)); };
  m = modal('Escolha seu avatar', 'Use um dos avatares prontos ou envie uma imagem sua.', h('div',
    h('div.avgrid', (info.default_avatars || []).map(url => h('button.avopt' + (url === current ? '.on' : ''), { title: 'Usar este avatar', onclick: () => pick(url) }, h('img', { src: url, alt: '' })))),
    h('button.btn', { style: { marginTop: '16px', width: '100%' }, onclick: upload }, 'Enviar uma imagem…')),
  [{ label: 'Cancelar', cls: 'link' }]);
}
const swatches = (cur, onPick) => {
  // cor personalizada: botão com a paleta (o seletor nativo fica invisível por cima); escolhida, o botão ganha a cor.
  // Marcar a seleção só troca classes/estilo: recriar o seletor fecharia o nativo no meio do arraste
  const inp = h('input', { type: 'color', name: 'custom-color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#5865f2', oninput: (e) => { onPick(e.target.value); mark(e.target.value); } });
  const own = h('label.swcustom', { title: 'Cor personalizada' }, icon('palette', 18), inp);
  const dots = SWATCHES.map(s => h('i', { style: { background: s }, onclick: () => { onPick(s); mark(s); } }));
  const mark = (c) => {
    dots.forEach((d, i) => d.classList.toggle('sel', SWATCHES[i] === c));
    const mine = !!c && !SWATCHES.includes(c); own.classList.toggle('sel', mine); own.style.background = mine ? c : '';
  };
  mark(cur); return h('div.swatches', ...dots, own);
};
const card = (...k) => h('div.card2', ...k);
const msgPrev = (compact) => h('div.mp' + (compact ? '.compact' : ''), [0, 1].map(i => h('div.mp-row', !compact && h('i.mp-av'), h('div.mp-lines', h('b', { style: { width: (compact ? 30 : 40) + i * 8 + '%' } }), h('u', { style: { width: 70 - i * 18 + '%' } })))));
const hint = (t) => h('div.hintline', t); // explicação: vira um ⓘ no título da seção (compactHints)
const note = (t) => h('div.hintline.keep', t); // fica sempre à vista: aviso sério ou lista vazia
// as explicações saem do meio da tela e vão para um ⓘ ao lado do título da seção (ou da página)
function compactHints(pane) {
  for (const el of pane.querySelectorAll('.hintline:not(.keep)')) {
    const box = el.parentElement, sec = box?.classList.contains('card2') ? box.previousElementSibling : el.previousElementSibling;
    let target = sec?.matches?.('h3.sec, h2') ? sec : null;
    if (!target && box?.firstElementChild?.matches?.('h2')) target = box.firstElementChild; // dica solta na página: no título dela
    if (!target || target.querySelector(':scope > .itip')) continue;
    target.append(infoTip([...el.childNodes]));
    el.remove();
  }
}

// ============================ shell ============================
const USER_GROUPS = [
  ['Você', [['account', 'Minha conta', 'senha usuário nome excluir'], ['privacy', 'Privacidade e segurança', 'amizade sessões dispositivos links bloqueados apagar mensagens em massa estatísticas telemetria uso anônimo'], ['connections', 'Contas vinculadas', 'steam jogos atividade vincular conta']]],
  ['Visual', [['appearance', 'Aparência', 'tema cor fonte compacto hora'], ['accessibility', 'Acessibilidade', 'movimento contraste saturação'], ['lite', 'Modo leve', 'desempenho otimizar leve fps jogo cpu gpu rápido pesado']]],
  ['Voz e vídeo', [['voice', 'Voz e vídeo', 'microfone ruído eco câmera dispositivo bitrate'], ['stream', 'Transmissão', 'tela resolução fps qualidade'], ['sounds', 'Sons', 'efeitos silenciar ensurdecer entrar sair'], ['soundboard', 'Soundboard', 'sons pad meme']]],
  ['Aplicativo', [['notifications', 'Notificações', 'avisos menção silenciar servidor'], ['storage', 'Armazenamento', 'espaço cache memória limpar mídias apagar arquivos celular disco cheio'], ['keys', 'Atalhos', 'teclas push-to-talk mutar'], ['extras', 'Recursos extras', 'plugins imagem lente zoom galeria prévia canal nomes volume amplificar links rastreio utm duplo clique responder editar celular plataforma amizade desfeita'], ['advanced', 'Avançado', 'desenvolvedor exportar importar redefinir']]],
  ['Ajuda', [['news', 'Novidades', 'novidades atualização changelog o que mudou versão'], ['report', 'Relatar um problema', 'bug erro problema relatório suporte ajuda travou log diagnóstico']]],
];
const NAV_ICONS = { uxstats: 'sliders', storage: 'file', account: 'user', profile: 'sparkle', privacy: 'shield', connections: 'link', appearance: 'palette', accessibility: 'eye', lite: 'bolt', voice: 'mic', stream: 'screen', sounds: 'vol', soundboard: 'soundboard', notifications: 'bell', keys: 'keyboard', extras: 'star', advanced: 'sliders', news: 'news', report: 'warn', app: 'layout',
  overview: 'gear', channels: 'hash', roles: 'tag', emojis: 'smile', members: 'users', bans: 'shield', reputation: 'shield', audit: 'clock', invites: 'invite' };
const SERVER_PAGES = [['overview', 'Visão geral', 'nome ícone banner dono'], ['channels', 'Canais', 'ordem renomear'], ['roles', 'Cargos', 'permissões'], ['emojis', 'Emojis', ''], ['sounds', 'Soundboard do servidor', 'sons áudio'], ['members', 'Membros', 'expulsar banir castigo'], ['bans', 'Banimentos', 'banir desbanir'], ['reputation', 'Reputação', 'spam trolls denúncia limite soft-mute comunidade'], ['audit', 'Registro de auditoria', 'log moderação histórico'], ['invites', 'Convites', 'link'], ['storage', 'Armazenamento', 'espaço disco mídias apagar antigas expirar']];

export function openSettings(kind, ctx) {
  const prev = document.getElementById('settings'); if (prev) (prev._close ? prev._close('swap') : prev.remove()); // abrir de novo: fecha direito a anterior (solta os ouvintes; a entrada do voltar fica para esta)
  const root = h('div#settings'), pane = h('div.pane'), nav = h('div.nav'), content = h('div.content', pane);
  const cleanups = []; const reg = (f) => cleanups.push(f);
  // how: 'back' = fechou pelo voltar do navegador; 'swap' = outra tela de configurações abre no lugar
  const close = (how) => { settingsPage(null, { closing: true }); if (how !== 'back') unBack(how === 'swap'); cleanups.forEach(f => f()); cleanups.length = 0; root.remove(); document.removeEventListener('keydown', esc); document.removeEventListener('lite-changed', onLite); document.dispatchEvent(new Event('settings-closed')); };
  // (antes o ouvinte de "modo leve mudou" só saía quando o modo leve mudava: segurava a tela inteira na memória a cada abertura)
  const onLite = () => drawNav();
  const esc = (e) => { if (e.key === 'Escape' && !document.getElementById('tedit') && !document.querySelector('.backdrop:not(.leaving)') && !pane.querySelector('.capturing') && !document.querySelector('.popout,.menu,.emoji-picker')) close(); };
  const isServer = kind === 'server', gid = ctx?.gid;
  const R = {
    account: () => accountPage(close), profile: () => profilePage(), privacy: (r) => privacyPage(r), connections: (r) => connectionsPage(r), appearance: () => appearancePage(), accessibility: () => accessibilityPage(),
    voice: (r) => voicePage(ctx, r), stream: () => streamPage(), sounds: () => soundsPage(), soundboard: () => soundboardPage(), notifications: () => notificationsPage(), keys: () => keysPage(), extras: () => extrasPage(ctx), advanced: () => advancedPage(ctx), storage: () => (isServer ? serverStoragePage(gid) : storagePage()), news: () => newsPage(), report: () => reportPage(), app: () => appPage(), lite: () => litePage(ctx),
    // painel de estatísticas de uso: só o administrador da instalação vê (carregado sob demanda)
    uxstats: () => { const box = h('div', h('h2', 'Estatísticas de uso'), h('p.ux-empty', 'Carregando…')); import('./uxstats.js').then(m => box.replaceWith(m.uxStatsPage())); return box; },
    overview: () => overviewPage(gid), channels: () => channelsPage(gid), roles: () => rolesPage(gid), emojis: () => emojisPage(gid), sounds_srv: () => serverSoundsPage(gid), members: () => membersPage(gid), bans: () => bansPage(gid), reputation: () => repPage(gid), audit: () => auditPage(gid), invites: () => invitesPage(gid),
  };
  const sKey = (k) => (isServer && k === 'sounds' ? 'sounds_srv' : k);
  let current;
  // telemetria: nome da página (para "abriu e saiu em menos de 2 s")
  const pageLabel = (k) => k === 'profile' ? 'Perfil' : [...USER_GROUPS, ['', SERVER_PAGES], ['', [['app', 'Aplicativo (desktop)'], ['uxstats', 'Estatísticas de uso']]]].flatMap(([, l]) => l).find(([x]) => x === k)?.[1] || k;
  const show = (key, initial = false) => { settingsPage(pageLabel(key), { initial }); cleanups.forEach(f => f()); cleanups.length = 0; current = key; pane.replaceChildren(); pane.replaceChildren(R[sKey(key)](reg)); compactHints(pane); nav.querySelectorAll('.ni, .nme').forEach(n => n.classList.toggle('active', n.dataset.k === key)); content.scrollTop = 0; };
  const search = h('input.nsearch', { placeholder: 'Buscar configuração…', oninput: () => drawNav() });
  const groups = isServer ? [[guild(gid)?.name || 'Servidor', SERVER_PAGES]] : USER_GROUPS.map(([t, l]) => [t, desktop && t === 'Aplicativo' ? [...l, ['app', 'Aplicativo (desktop)', 'iniciar bandeja hardware']] : l]);
  // Administração (só o administrador da instalação): o servidor diz se é; a lista ganha a seção quando a resposta chega
  const ADMIN_GROUP = ['Administração', [['uxstats', 'Estatísticas de uso', 'telemetria estatísticas uso dados painel admin cliques funil']]];
  if (!isServer && S.uxAdmin) groups.push(ADMIN_GROUP);
  if (!isServer && S.uxAdmin === undefined) tryApi('GET', '/ux/access').then(r => { S.uxAdmin = !!r?.admin; if (S.uxAdmin && root.isConnected && !groups.includes(ADMIN_GROUP)) { groups.push(ADMIN_GROUP); drawNav(); } });
  let emptyT = 0;
  const drawNav = () => {
    const q = search.value.trim().toLowerCase();
    // telemetria: busca que não achou nada (o termo, depois de a pessoa parar de digitar por 1,5 s)
    clearTimeout(emptyT);
    if (q && !groups.some(([, items]) => items.some(([, l, kw]) => (l + ' ' + kw).toLowerCase().includes(q)))) emptyT = setTimeout(() => track('settings_search_empty', q.slice(0, 40), { once: true }), 1500);
    const meCard = !isServer && S.me && (!search.value.trim() || /perf|avatar|banner|bio|pronom|status/i.test(search.value)) && h('div.nme' + (current === 'profile' ? '.active' : ''), { 'data-k': 'profile', title: 'Editar perfil', onclick: () => show('profile') }, avatar(S.me, 40), h('div.nme-t', h('b', S.me.display_name), h('small', 'Editar perfil')), icon('edit', 16));
    // o campo de busca é o mesmo elemento, mas mudá-lo de lugar no DOM tira o foco: sem isto só a 1ª letra entrava
    const typing = document.activeElement === search, caret = search.selectionStart;
    queueMicrotask(() => { if (typing && search.isConnected && document.activeElement !== search) { search.focus(); search.setSelectionRange(caret, caret); } });
    nav.replaceChildren(h('div.ninner', meCard, search, ...groups.flatMap(([title, items]) => {
      const list = items.filter(([k, l, kw]) => !q || (l + ' ' + kw).toLowerCase().includes(q));
      return list.length ? [h('h6', title), ...list.map(([k, l]) => h('div.ni' + (k === current ? '.active' : ''), { 'data-k': k, onclick: () => show(k) }, icon(NAV_ICONS[sKey(k) === 'sounds_srv' ? 'soundboard' : k] || 'dot', 18), h('span.nl', l), k === 'lite' && liteOn() && h('span.nlite', { title: 'O modo leve está ligado neste computador' }, 'Ativo')))] : [];
    }), !isServer && h('div', { style: { height: '1px', background: 'var(--divider)', margin: '10px 8px' } }),
    !isServer && h('div.ni.danger', { onclick: async () => { if (await confirmBox('Sair', 'Deseja sair da sua conta?', 'Sair')) ctx.logout(); } }, icon('logout', 18), h('span.nl', 'Sair')),
    h('div.nfoot', 'Resenha' + (desktop ? ' Desktop' : ' Web'))));
  };
  root.append(nav, content, h('button.close', { onclick: close, title: 'Fechar (Esc)' }, icon('x', 20), h('small', 'ESC')));
  document.getElementById('layer').append(root); document.addEventListener('keydown', esc);
  const first = isServer ? (ctx?.page === 'storage' ? 'storage' : 'overview') : (['account', 'profile', 'privacy', 'connections', 'appearance', 'accessibility', 'voice', 'stream', 'sounds', 'soundboard', 'notifications', 'keys', 'extras', 'advanced', 'app', 'lite', 'news', 'report', 'storage', 'uxstats'].includes(kind) ? kind : 'account');
  current = first; drawNav(); show(first, true);
  root._close = close;
  const unBack = backCloses(() => close('back')); whenGone(root, () => unBack()); // voltar do navegador/celular fecha as configurações
  document.addEventListener('lite-changed', onLite);
}

// ============================ Conta ============================
function accountPage(close) {
  const me = S.me;
  return h('div', h('h2', 'Minha conta'),
    card(h('div.accrow', avatar(me, 80), h('div', h('div.big', me.display_name), h('div.mut', '@' + me.username))),
      vrow('Nome de usuário', '@' + me.username, h('button.btn.grey', { onclick: usernameDialog }, 'Alterar')),
      vrow('Nome de exibição', me.display_name, h('button.btn.grey', { onclick: async () => { const n = await promptBox('Nome de exibição', 'Como você aparece para os outros', me.display_name, 'Salvar'); if (n) { await tryApi('PATCH', '/me', { display_name: n }); toast('Nome atualizado'); } } }, 'Editar'))),
    section('Senha'), card(passwordForm()),
    section('Remoção da conta'), card(note('Excluir apaga seu perfil, suas mensagens, seus servidores (como dono) e remove você de todos os outros. Não dá para desfazer.'), h('button.btn.red', { onclick: () => deleteDialog(close) }, 'Excluir conta')));
}
function passwordForm() {
  const o = h('input', { type: 'password', autocomplete: 'current-password' }), n = h('input', { type: 'password', autocomplete: 'new-password' }), n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  return h('div', h('label.f', 'Senha atual', o), h('label.f', 'Nova senha', n), h('label.f', 'Confirmar nova senha', n2),
    h('button.btn', { onclick: async () => { if (n.value !== n2.value) return toast('As senhas não coincidem', true); if (await tryApi('POST', '/me/password', { old: o.value, new: n.value })) { toast('Senha alterada!'); o.value = n.value = n2.value = ''; } } }, 'Alterar senha'));
}
function usernameDialog() {
  const u = h('input', { value: S.me.username, maxLength: 32 }), p = h('input', { type: 'password' });
  modal('Alterar nome de usuário', 'Seus amigos usam esse nome para te adicionar.', h('div', h('label.f', 'Novo nome de usuário', u), h('label.f', 'Senha atual', p)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: async () => { if (await tryApi('POST', '/me/username', { username: u.value, password: p.value })) toast('Nome de usuário alterado'); else return false; } }]);
}
function deleteDialog(close) {
  const p = h('input', { type: 'password' });
  modal('Excluir conta', 'Digite sua senha para confirmar. Esta ação é permanente.', h('label.f', 'Senha', p),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Excluir minha conta', cls: 'red', fn: async () => { if (await tryApi('POST', '/me/delete', { password: p.value })) { localStorage.removeItem('lc_token'); location.reload(); } else return false; } }]);
}

// ============================ Perfil ============================
function profilePage({ full } = {}) {
  const me = S.me;
  const base = () => ({ name_style: me.name_style ? { ...me.name_style } : null, theme_primary: me.theme_primary || null, theme_accent: me.theme_accent || null, display_name: me.display_name, avatar: me.avatar, banner: me.banner, avatar_pos: me.avatar_pos || '', banner_pos: me.banner_pos || '', color: me.color, banner_color: me.banner_color || me.color, pronouns: me.pronouns || '', bio: me.bio || '', custom_status: me.custom_status || '', status_emoji: me.status_emoji || '' });
  const d = base(), wrap = h('div.profile-ed'), prevBox = h('div.preview'), bar = h('div.savebar.hidden');
  const draft = () => ({ ...me, ...d, status: me.status === 'invisible' ? 'invisible' : 'online' });
  const redraw = () => { prevBox.replaceChildren(h('div.popout.static', profileCard(draft(), { accent: d.banner ? null : d.banner_color, onEditAvatar: editAvatar, onEditBanner: editBanner }))); };
  const touch = () => { bar.classList.remove('hidden'); redraw(); };
  const changeAvatar = () => avatarPicker(d.avatar, (url, pos) => { d.avatar = url; d.avatar_pos = pos; touch(); });
  const editAvatar = (av) => { const r = av.getBoundingClientRect(); menu({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 6 }, [{ label: 'Trocar avatar', fn: changeAvatar },
    d.avatar && { label: 'Ajustar avatar', fn: () => positionEditor('avatar', d.avatar, d.avatar_pos, (v) => { d.avatar_pos = v; touch(); }) },
    d.avatar && { label: 'Remover avatar', danger: true, fn: () => { d.avatar = null; touch(); } }]); };
  const changeBanner = async () => { const u = await uploadImage(); if (u) positionEditor('banner', u.url, '', (v) => { d.banner = u.url; d.banner_pos = v; touch(); }); };
  const editBanner = (e) => menu({ preventDefault() {}, clientX: e.clientX, clientY: e.clientY }, [{ label: 'Trocar banner', fn: changeBanner },
    d.banner && { label: 'Ajustar banner', fn: () => positionEditor('banner', d.banner, d.banner_pos, (v) => { d.banner_pos = v; touch(); }) },
    d.banner && { label: 'Remover banner', danger: true, fn: () => { d.banner = null; touch(); } }]);
  const bind = (key, input) => { input.value = d[key]; input.oninput = () => { d[key] = input.value; touch(); }; return input; };
  const emojiBtn = h('button.btn.grey', { style: { minWidth: '44px' }, title: 'Escolher emoji', onclick: (e) => emojiPicker(e.currentTarget, (em) => { d.status_emoji = em.startsWith('<:') ? '' : em; emojiBtn.replaceChildren(d.status_emoji || icon('smile', 20)); touch(); }, { noCustom: true }) }, d.status_emoji || icon('smile', 20));
  const left = h('div.col',
    card(h('label.f', 'Nome de exibição', bind('display_name', h('input', { maxLength: 32 }))),
      h('label.f', 'Cor do avatar'), swatches(d.color, (c) => { d.color = c; touch(); }), h('label.f', { style: { marginTop: '16px' } }, 'Cor do banner / destaque'), swatches(d.banner_color, (c) => { d.banner_color = c; touch(); }), hint('Com tema do perfil ativo, o banner sem imagem usa a cor principal do tema.')),
    nameStyleCard(d, touch),
    profileThemeCard(d, touch),
    card(h('label.f', 'Status personalizado'), h('div.btns', emojiBtn, bind('custom_status', h('input', { maxLength: 100, placeholder: 'O que você está fazendo?', style: { flex: 1, background: 'var(--bg-tert)', border: 0, borderRadius: '3px', padding: '10px', minWidth: 0 } }))),
      h('label.f', { style: { marginTop: '16px' } }, 'Presença', seg({ online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível' }, me.status, (v) => tryApi('PATCH', '/me', { status: v }))),
      h('label.f', { style: { marginTop: '16px' } }, 'Sobre mim', bind('bio', h('textarea', { rows: 4, maxLength: 300 })))));
  bar.append(h('span', 'Cuidado — você tem alterações não salvas!'), h('div.btns', h('button.btn.link', { onclick: () => { Object.assign(d, base()); bar.classList.add('hidden'); redraw(); wrap.replaceWith(profilePage({ full })); } }, 'Redefinir'),
    h('button.btn.green', { onclick: async () => { const r = await tryApi('PATCH', '/me', { display_name: d.display_name, avatar: d.avatar || '', banner: d.banner || '', avatar_pos: d.avatar_pos || '', banner_pos: d.banner_pos || '', color: d.color, banner_color: d.banner_color, pronouns: d.pronouns, bio: d.bio, custom_status: d.custom_status, status_emoji: d.status_emoji, theme_primary: d.theme_primary || '', theme_accent: d.theme_accent || '', name_style: d.name_style }); if (r) { toast('Perfil salvo!'); bar.classList.add('hidden'); } } }, 'Salvar alterações')));
  wrap.append(h('h2', 'Perfil'), h('div.pgrid', left, h('div.col', h('div.fh', 'Prévia'), prevBox)), bar);
  redraw(); return wrap;
}
// "perfil completo": estilos à esquerda (avatar, banner, cores, tema, estilo do nome) e a prévia do cartão à direita
export function openFullProfile() {
  modal('Seu perfil completo', 'Edite avatar, banner, tema e informações. A prévia mostra como os outros veem o seu perfil.', profilePage({ full: true }), [{ label: 'Fechar', cls: 'link' }], { width: '1040px' });
}

// estilo do nome: fonte, efeito e até duas cores; a prévia ao lado mostra o resultado
function nameStyleCard(d, touch) {
  const box = h('div.nstyle'), name = () => d.display_name || S.me.username;
  const cur = () => d.name_style || { font: 'default', effect: 'solid', c1: '#5865f2', c2: '#eb459e' };
  const upd = (patch) => { d.name_style = { ...cur(), ...patch }; touch(); draw(); };
  const sample = (ns) => styleName(h('span', name()), ns);
  const colorIn = (key, label) => {
    const val = h('span', { style: { fontFamily: 'Consolas, monospace', fontSize: '14px', color: 'var(--text-strong)' } }, cur()[key].toUpperCase());
    const pick = h('input', { type: 'color', value: cur()[key], oninput: () => { d.name_style = { ...cur(), [key]: pick.value }; val.textContent = pick.value.toUpperCase(); touch(); box.querySelectorAll('.nsgrid span.ns').forEach(s => s.style.setProperty(key === 'c1' ? '--n1' : '--n2', pick.value)); } });
    return h('div.pcol', h('label.f', { style: { marginBottom: 0 } }, label), h('div', pick, val));
  };
  const draw = () => {
    const s = cur(), two = TWO_COLOR_EFFECTS.has(s.effect);
    box.replaceChildren(
      hint('Muda como seu nome aparece nas mensagens, na lista de membros e no seu perfil. Todo mundo vê.'),
      h('label.f', { style: { margin: '12px 0 0' } }, 'Fonte'),
      h('div.nsgrid', Object.entries(NAME_FONTS).map(([k, l]) => h('button' + (s.font === k ? '.on' : ''), { onclick: () => upd({ font: k }) }, sample({ ...s, font: k }), h('small', l)))),
      h('label.f', { style: { margin: 0 } }, 'Efeito'),
      h('div.nsgrid', Object.entries(NAME_EFFECTS).map(([k, l]) => h('button' + (s.effect === k ? '.on' : ''), { onclick: () => upd({ effect: k }) }, sample({ ...s, effect: k }), h('small', l)))),
      s.effect !== 'rainbow' && h('div.ptheme', h('div.pcols', colorIn('c1', two ? 'Cor 1' : 'Cor'), two && colorIn('c2', s.effect === 'gradient' || s.effect === 'shimmer' ? 'Cor 2' : 'Cor do efeito'))),
      d.name_style && h('div.pfoot', h('span'), h('button.btn.grey', { onclick: () => { d.name_style = null; touch(); draw(); } }, 'Remover estilo')));
  };
  draw();
  return card(h('label.f', { style: { marginBottom: '4px' } }, 'Estilo do nome'), box);
}

// tema do perfil: duas cores (principal → destaque), prontos ou colados do discordthemes.com
function profileThemeCard(d, touch) {
  const ctls = {}, gal = h('div.pgal'), foot = h('div.pfoot');
  const sync = () => { // atualiza campos, galeria e rodapé sem recriar os seletores (o nativo fecharia no meio do arraste)
    for (const [k, c] of Object.entries(ctls)) { if (document.activeElement !== c.txt) c.txt.value = d[k]?.toUpperCase() || ''; if (d[k]) c.pick.value = d[k]; }
    gal.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', d.theme_primary === PROFILE_THEMES[i].p && d.theme_accent === PROFILE_THEMES[i].a));
    foot.replaceChildren(h('a', { href: 'https://discordthemes.com/', target: '_blank', rel: 'noopener' }, 'Mais temas em discordthemes.com →'),
      d.theme_primary && h('button.btn.grey', { onclick: () => set(null, null) }, 'Remover tema'));
  };
  const set = (p, a) => { d.theme_primary = p; d.theme_accent = a; touch(); sync(); };
  const colorCtl = (label, key) => {
    const other = key === 'theme_primary' ? 'theme_accent' : 'theme_primary';
    // a primeira cor escolhida vale para as duas, para o tema já aparecer
    const apply = (v) => { d[key] = v; d[other] ||= v; touch(); sync(); };
    const txt = h('input', { type: 'text', maxLength: 7, placeholder: '#000000', onchange: () => { const v = parseColorPair(txt.value)?.[0]; if (v) apply(v); else sync(); } });
    const pick = h('input', { type: 'color', value: '#5865f2', oninput: () => apply(pick.value) });
    ctls[key] = { txt, pick };
    return h('div.pcol', h('label.f', { style: { marginBottom: 0 } }, label), h('div', pick, txt));
  };
  const paste = h('input.ppaste', { placeholder: 'Cole as cores aqui (ex.: #53aba9 #2f4451)', oninput: () => { const pr = parseColorPair(paste.value); if (pr) { paste.value = ''; set(...pr); toast('Cores aplicadas na prévia'); } } });
  gal.append(...PROFILE_THEMES.map(t => h('button' + (isLightPair(t.p, t.a) ? '.tlight' : '.tdark'),
    { title: t.name + (t.dt ? ' — discordthemes.com' : '') + `
${t.p} → ${t.a}`, style: { background: `linear-gradient(${t.p}, ${t.a})` }, onclick: () => set(t.p, t.a) }, t.name)));
  const box = h('div.ptheme', hint('Duas cores viram o fundo do seu cartão: a principal no topo e a de destaque embaixo. Todo mundo vê.'),
    h('div.pcols', colorCtl('Principal', 'theme_primary'), colorCtl('Destaque', 'theme_accent')), paste, gal, foot);
  sync();
  return card(h('label.f', { style: { marginBottom: '4px' } }, 'Tema do perfil'), box);
}

// ============================ Privacidade ============================
const agentName = (a) => {
  const b = /Electron/.test(a) ? 'Resenha Desktop' : /Edg\//.test(a) ? 'Edge' : /Firefox/.test(a) ? 'Firefox' : /Chrome/.test(a) ? 'Chrome' : /Safari/.test(a) ? 'Safari' : 'Navegador';
  const o = /Windows/.test(a) ? 'Windows' : /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iOS' : /Mac/.test(a) ? 'macOS' : /Linux/.test(a) ? 'Linux' : '';
  return `${b}${o ? ' em ' + o : ''}`;
};
// lista de bloqueados (antes era uma aba em Amigos)
function blockedCard() {
  const box = card();
  const draw = () => {
    const list = [...S.rels.values()].filter(r => r.type === 2);
    box.replaceChildren(...(list.length ? list.map(r => { const u = S.users.get(r.user.id) || r.user; return h('div.frow.blk', { style: { cursor: 'default' } }, avatar(u, 36, { status: false }), h('div.fn', h('b', u.display_name), h('small', '@' + u.username)),
      h('button.btn.grey', { onclick: async () => { if (await tryApi('DELETE', `/relationships/${u.id}`)) { S.rels.delete(u.id); draw(); toast(`${u.display_name} desbloqueado`); } } }, 'Desbloquear')); })
      : [note('Você não bloqueou ninguém. Para bloquear, clique com o botão direito em alguém → Bloquear.')]));
  };
  draw(); return box;
}
// ---------- privacidade: ligações e presença (o servidor aplica: server/privacy.js) ----------
const priv = () => (S.privacy ||= {});
async function savePrivacy(patch) {
  const r = await tryApi('PUT', '/me/settings', { privacy: patch });
  if (r?.privacy) S.privacy = r.privacy;
  return !!r;
}
// quem pode te ligar (DM) e te chamar para uma sala: quem não pode recebe "não está aceitando ligações"
function callsCard() {
  const c = { everyone: true, fof: true, friends: true, servers: true, ...(priv().calls || {}) };
  const box = h('div');
  const opt = (k, label, sub) => row(label, sub, toggle(c[k], async (v) => { c[k] = v; await savePrivacy({ calls: { [k]: v } }); draw(); }));
  const draw = () => box.replaceChildren(
    hint(c.everyone ? 'Qualquer pessoa pode te ligar e te chamar para uma sala de voz.' : 'Quem não puder te ligar recebe o aviso "não está aceitando ligações" e só pode mandar mensagem.'),
    opt('everyone', 'Todo mundo', 'Qualquer pessoa pode te ligar. Desligue para escolher abaixo quem pode.'),
    !c.everyone && opt('friends', 'Amigos', 'Seus amigos podem te ligar.'),
    !c.everyone && opt('fof', 'Amigos de amigos', 'Quem tem um amigo em comum com você.'),
    !c.everyone && opt('servers', 'Membros dos seus servidores', 'Quem está num servidor com você.'),
    !c.everyone && !c.friends && !c.fof && !c.servers && h('div.qinfo', 'Ninguém pode te ligar agora.'));
  draw(); return card(box);
}
// quem vê se você está online e o que está fazendo (jogo, música, atividade). Quem não pode ver te vê offline.
function presenceCard() {
  const p = { mode: 'everyone', allow: [], deny: [], ...(priv().presence || {}) };
  const box = h('div');
  // pessoas para escolher: amigos primeiro, depois quem divide servidor com você
  const people = () => {
    const ids = new Set([...S.rels.values()].filter(r => r.type === 1).map(r => r.user.id));
    const friends = [...ids];
    for (const g of S.guilds.values()) for (const id of g.members.keys()) if (id !== S.me.id && !user(id)?.bot) ids.add(id);
    return [...ids].map(id => ({ id, u: user(id), friend: friends.includes(id) })).filter(x => x.u && !x.u.username?.startsWith('bot_music_'))
      .sort((a, b) => (b.friend - a.friend) || a.u.display_name.localeCompare(b.u.display_name));
  };
  const chips = (key, emptyTxt) => h('div.pv-people', p[key].length ? p[key].map(id => h('span.pv-chip', avatar(user(id), 20, { status: false }), h('span', user(id)?.display_name || 'alguém'),
    h('button', { type: 'button', title: 'Tirar', onclick: async () => { p[key] = p[key].filter(x => x !== id); await savePrivacy({ presence: { [key]: p[key] } }); draw(); } }, icon('x', 12)))) : h('small.mut', emptyTxt),
    h('button.btn.grey.pv-add', { type: 'button', onclick: () => pick(key) }, icon('plus', 14), 'Escolher pessoas'));
  const pick = (key) => {
    const sel = new Set(p[key]), q = h('input', { placeholder: 'Procurar amigos e membros dos seus servidores' }), list = h('div.pv-pick');
    const drawList = () => { const f = q.value.toLowerCase(); list.replaceChildren(...people().filter(x => !f || x.u.display_name.toLowerCase().includes(f) || x.u.username?.toLowerCase().includes(f)).slice(0, 200).map(x =>
      h('label.pv-pi', h('input', { type: 'checkbox', checked: sel.has(x.id), onchange: (e) => { e.target.checked ? sel.add(x.id) : sel.delete(x.id); } }), avatar(x.u, 28, { status: false }), h('div', h('b', x.u.display_name), h('small', x.friend ? 'Amigo' : 'Membro de servidor'))))); };
    q.oninput = drawList; drawList();
    modal(key === 'allow' ? 'Quem pode ver' : 'Esconder de', key === 'allow' ? 'Só estas pessoas veem quando você está online e o que está jogando ou ouvindo.' : 'Estas pessoas te veem offline e sem atividade, mesmo que as outras vejam.',
      h('div', q, list), [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: async () => { p[key] = [...sel]; if (!(await savePrivacy({ presence: { [key]: p[key] } }))) return false; draw(); toast('Privacidade atualizada'); } }]);
  };
  const draw = () => box.replaceChildren(
    choiceCards([
      ['everyone', 'Todo mundo', h('span.pv-fr', icon('globe', 28))],
      ['friends', 'Só amigos', h('span.pv-fr', icon('users', 28))],
      ['chosen', 'Só quem eu escolher', h('span.pv-fr', icon('user', 28), h('b.pv-ok', icon('check', 14)))]], p.mode,
      async (v) => { p.mode = v; await savePrivacy({ presence: { mode: v } }); draw(); }),
    hint(p.mode === 'everyone' ? 'Todo mundo vê quando você está online e o que você está jogando ou ouvindo (conforme a privacidade de cada atividade em Conexões).'
      : p.mode === 'friends' ? 'Só seus amigos veem seu status e sua atividade. Para os outros você aparece offline — e continua recebendo mensagens normalmente.'
      : 'Só as pessoas escolhidas veem seu status e sua atividade. Para todo o resto você aparece offline.'),
    p.mode === 'chosen' && h('div.pv-sub', h('b', 'Quem pode ver'), chips('allow', 'Ninguém escolhido ainda: você aparece offline para todos.')),
    h('div.pv-sub', h('b', 'Esconder de pessoas específicas'), chips('deny', 'Ninguém. Útil para colegas de trabalho, por exemplo.')));
  draw(); return card(box);
}
// criptografia de ponta a ponta das conversas diretas (public/e2ee.js)
function e2eeCard(reg) {
  const box = card();
  const kidTxt = (k) => k ? k.kid.slice(0, 20).match(/.{4}/g).join(' ') : '';
  const draw = () => {
    const st = e2eeState(), k = myFingerprintKey(), redraw = () => draw();
    // o que a criptografia cobre, em figura: você 🔒 → servidor (embaralhado) → 🔒 amigo, e chips do que entra/fica de fora
    const limits = h('div',
      h('div.e2-flow', h('span', icon('user', 22), 'Você'), h('i', icon('lock')), h('span.e2-srv', icon('globe', 22), h('code', '#x9$f…'), 'Servidor'), h('i', icon('lock')), h('span', icon('user', 22), 'Amigo')),
      factChips([
        ['Protegido', 'ok', [['dm', 'Mensagens'], ['edit', 'Edições'], ['clip', 'Arquivos'], ['mic', 'Áudios'], ['phone', 'Chamadas'], ['screen', 'Vídeo e tela']]],
        ['Fica de fora', 'no', [['smile', 'Reações'], ['users', 'Grupos'], ['search', 'Busca'], ['translate', 'Tradução'], ['screen', '120 FPS']]],
        ['Servidor vê', 'info', [['users', 'Quem fala com quem'], ['clock', 'Quando'], ['file', 'Tamanho dos arquivos']]]]));
    if (st === 'unsupported') return box.replaceChildren(note('Precisa de https:// ou do app desktop.'));
    if (st === 'off') return box.replaceChildren(row('Proteger minhas conversas diretas', 'Ative com uma frase secreta. Vale nas conversas em que os dois ativaram.', h('button.btn.green', { onclick: () => setupModal(redraw) }, 'Ativar')), limits);
    if (st === 'locked') return box.replaceChildren(
      row('Trancada neste aparelho', 'Digite a frase para ler e enviar mensagens protegidas aqui.', h('button.btn.green', { onclick: () => unlockModal(redraw) }, 'Desbloquear')),
      row('Esqueci a frase', 'Apaga as chaves. Mensagens protegidas antigas ficam ilegíveis.', h('button.btn.red', { onclick: () => resetModal(redraw) }, 'Apagar chaves')), limits);
    box.replaceChildren(
      row('Proteger minhas conversas diretas', st === 'paused' ? 'Pausado: novas mensagens chegam sem criptografia.' : 'Ligado. O cadeado no topo da conversa mostra o número de segurança.', toggle(st === 'on', async (v) => { try { await setPaused(!v); } catch (e) { toast(e.message, true); } redraw(); })),
      k && h('div.perm', h('div.rt', 'Sua chave'), h('code.e2-kid', { title: 'Identificador da sua chave pública' }, kidTxt(k))),
      row('Trocar a frase', 'As conversas continuam iguais.', h('button.btn.grey', { onclick: () => changePassModal(redraw) }, 'Trocar')),
      row('Trocar de chave', 'Chave nova nas próximas mensagens; as antigas seguem abrindo.', h('button.btn.grey', { onclick: () => newKeyModal(redraw) }, 'Chave nova')),
      row('Trancar neste aparelho', 'Para computador emprestado. Depois, digite a frase.', h('button.btn.grey', { onclick: async () => { await lockHere(); redraw(); } }, 'Trancar')),
      row('Esqueci a frase', 'Apaga as chaves. Mensagens protegidas antigas ficam ilegíveis.', h('button.btn.red', { onclick: () => resetModal(redraw) }, 'Apagar chaves')),
      limits);
  };
  if (!e2eeSupported()) draw(); else { box.replaceChildren(h('div.hintline.keep', 'Carregando…')); e2eeLoad().then(draw); }
  const on = () => draw(); document.addEventListener('e2ee-changed', on); reg?.(() => document.removeEventListener('e2ee-changed', on));
  return box;
}
function privacyPage(reg) {
  const sessions = h('div');
  const draw = async () => {
    const list = await tryApi('GET', '/sessions') || [];
    sessions.replaceChildren(...list.map(s => h('div.frow.pv-sess', { style: { cursor: 'default' } }, h('span.pv-dev' + (s.current ? '.cur' : ''), icon(/Android|iPhone|iPad|Mobile/.test(s.agent) ? 'phone' : /Electron/.test(s.agent) ? 'layout' : 'screen', 22)), h('div.fn', h('b', agentName(s.agent)), h('small', `${s.current ? 'Este dispositivo • ' : ''}entrou em ${new Date(+s.created_at).toLocaleString('pt-BR')}`)),
      !s.current && h('button.btn.red', { onclick: async () => { await tryApi('DELETE', `/sessions/${s.id}`); draw(); } }, 'Encerrar'))));
  };
  draw();
  return h('div', h('h2', 'Privacidade e segurança'),
    section('Pedidos de amizade'), card(choiceCards([['all', 'Qualquer pessoa pode enviar', h('span.pv-fr', icon('users', 28), h('b.pv-ok', icon('check', 14)))], ['none', 'Ninguém pode enviar', h('span.pv-fr', icon('users', 28), h('b.pv-no', icon('x', 14)))]], S.friendPolicy || 'all', (v) => { S.friendPolicy = v; api('PUT', '/me/settings', { friend_policy: v }).catch(e => toast(e.message, true)); })),
    section('Ligações'), callsCard(),
    section('Quem vê seu status e sua atividade'), presenceCard(),
    section('Criptografia de ponta a ponta'), e2eeCard(reg),
    section('Suas mensagens'), card(row('Apagar minhas mensagens', 'Apaga de uma vez as mensagens que você enviou.', h('button.btn.red', { onclick: () => openMyMessages() }, 'Abrir')),
      factChips([
        ['Onde', 'info', [['globe', 'Tudo'], ['dm', 'Conversas diretas'], ['hash', 'Um servidor'], ['logout', 'Servidores que saiu']]],
        ['Filtros', 'info', [['calendar', 'Período'], ['search', 'Texto'], ['clip', 'Com arquivos']]],
        ['Antes', 'ok', [['eye', 'Mostra quantas e onde'], ['dl', 'Baixar uma cópia']]]])),
    section('Usuários bloqueados'), blockedCard(),
    section('Ajudar a melhorar o app'), card(row('Enviar estatísticas de uso anônimas', 'Só contagens, sem dizer quem: por exemplo, quantas vezes o Esc é usado para voltar aos Amigos, quanto demora para abrir um canal ou quantas pessoas usaram o app hoje. Nunca mensagens nem nomes. Ficam 60 dias.', toggle(uxOn(), (v) => { S.prefs.uxStats = v; if (!v) clearUx(); save(); })),
      factChips([['Envia', 'ok', [['pointer', 'Cliques em botões e abas'], ['info', 'Explicações abertas'], ['search', 'Buscas sem resultado'], ['clock', 'Tempos de carregamento'], ['warn', 'Erros do app'], ['users', 'Uso por dia (sem identificar)']]], ['Nunca', 'no', [['dm', 'Mensagens'], ['user', 'Quem fez'], ['file', 'Arquivos']]]]),
      h('button.btn.link.sm.uxv-open', { onclick: () => import('./uxview.js').then(m => m.openUxView()) }, icon('eye', 16), 'Ver o que é enviado')),
    section('Links'), card(toggleCards([{ on: !!S.prefs.confirmLinks, label: 'Confirmar antes de abrir links', sub: 'Mostra o endereço antes de abrir', prev: h('span.pv-link', h('u', 'site.com/…'), h('span.pv-dlg', h('b', 'Abrir link externo?'), h('i'))), fn: v => { S.prefs.confirmLinks = v; save(); } }])),
    section('Dispositivos conectados'), card(hint('Encerre sessões que você não reconhece.'), sessions, h('button.btn.red', { style: { marginTop: '12px' }, onclick: async () => { if (await confirmBox('Sair de todos os outros dispositivos', 'Essas sessões precisarão entrar de novo.', 'Encerrar todas')) { await tryApi('DELETE', '/sessions'); draw(); } } }, 'Encerrar todas as outras sessões')));
}

// ============================ Aparência / acessibilidade ============================
function appearancePage() {
  const th = h('div.cards'), gr = h('div.cards'), val = h('div.cards'), mine = h('div.cards');
  const pick = (k) => { S.prefs.theme = k; save(); applyTheme(); drawTh(); };
  const gcard = (k, t, extra) => h('div.ncard.tgrad' + (t.base === 'light' ? '.light' : '') + (S.prefs.theme === k ? '.on' : ''), { style: { background: gradientCss(t) }, onclick: () => pick(k) }, extra, h('b', t.name));
  const drawTh = () => {
    th.replaceChildren(...Object.entries(SOLID_THEMES).map(([k, l]) => h('div.ncard.theme-' + k + (S.prefs.theme === k ? '.on' : ''), { onclick: () => pick(k) }, h('b', l))));
    const preset = ([k, t]) => gcard('g:' + k, t, h('div.tact', h('button', { title: 'Personalizar uma cópia', onclick: (e) => { e.stopPropagation(); openThemeEditor({ ...t, name: t.name + ' (cópia)' }, { onExit: drawTh }); } }, icon('edit', 14))));
    const all = Object.entries(GRADIENT_THEMES);
    gr.replaceChildren(...all.filter(([, t]) => !t.group).map(preset));
    val.replaceChildren(...all.filter(([, t]) => t.group === 'valorant').map(preset));
    mine.replaceChildren(...(S.prefs.customThemes || []).map(t => gcard('c:' + t.id, t, h('div.tact',
      h('button', { title: 'Copiar código para compartilhar', onclick: (e) => { e.stopPropagation(); shareTheme(t); } }, icon('link', 14)),
      h('button', { title: 'Editar', onclick: (e) => { e.stopPropagation(); openThemeEditor(t, { onExit: drawTh }); } }, icon('edit', 14)),
      h('button', { title: 'Excluir', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Excluir tema', `"${t.name}" será removido.`, 'Excluir')) { S.prefs.customThemes = S.prefs.customThemes.filter(x => x !== t); if (S.prefs.theme === 'c:' + t.id) S.prefs.theme = t.base; save(); applyTheme(); drawTh(); } } }, icon('trash', 14))))),
      h('div.ncard.tnew', { onclick: () => openThemeEditor(null, { onExit: drawTh }) }, icon('palette', 20), h('small', 'Criar tema')),
      h('div.ncard.tnew', { onclick: async () => { const code = await promptBox('Importar tema', 'Cole o código do tema', '', 'Importar'); if (code == null) return; const t = decodeTheme(code); if (!t) return toast('Código de tema inválido', true); openThemeEditor(t, { onExit: drawTh }); } }, icon('dl', 20), h('small', 'Importar código')));
  };
  drawTh();
  const set = (k) => (v) => { S.prefs[k] = v; save(); applyTheme(); };
  return h('div', h('h2', 'Aparência'), section('Tema'), card(th),
    section('Temas em gradiente'), card(gr, hint('Passe o mouse num tema e clique no lápis para criar uma versão sua a partir dele.')),
    section('Agentes do Valorant'), card(val, hint('Um tema para cada agente, nas cores dele.')),
    section('Seus temas'), card(mine, hint('Crie um gradiente com até 5 cores e compartilhe: o código colado no chat vira um cartão com o botão "Usar tema".')),
    section('Cor de destaque'), card(swatches(S.prefs.accent, (c) => { S.prefs.accent = c; save(); applyTheme(); })),
    section('Fonte'), card(h('label.f', 'Família da fonte'), choiceCards([['default', 'Padrão'], ['rounded', 'Arredondada'], ['serif', 'Serifada'], ['mono', 'Monoespaçada'], ['dyslexia', 'Legível (dislexia)']].map(([k, l]) => [k, l, h('span.ff-prev.ff-' + k, 'Aa')]), S.prefs.fontFamily || 'default', set('fontFamily')),
      h('label.f', 'Tamanho da interface', slider(80, 140, S.prefs.zoom, 5, set('zoom'), v => v + '%'))),
    section('Mensagens'), card(h('label.f', 'Exibição das mensagens'), choiceCards([[0, 'Confortável', msgPrev(false)], [1, 'Compacta', msgPrev(true)]], S.prefs.compact ? 1 : 0, v => { S.prefs.compact = !!v; save(); }),
      h('label.f', { style: { marginTop: '12px' } }, 'Espaço entre grupos de mensagens', slider(0, 32, S.prefs.msgGap, 1, set('msgGap'), v => v + 'px')),
      h('label.f', 'Arredondamento dos cartões', slider(0, 20, S.prefs.radius, 1, set('radius'), v => v + 'px')),
      h('label.f', 'Formato da hora'), choiceCards([[0, '24 horas', h('span.hr-prev', '21:30')], [1, '12 horas', h('span.hr-prev', '9:30 PM')]], S.prefs.hour12 ? 1 : 0, (v) => { S.prefs.hour12 = !!v; save(); applyTheme(); }),
      row('Mostrar imagens de links no chat', 'Pré-visualiza links que terminam em .png/.jpg/.gif.', toggle(S.prefs.embedLinks !== false, v => { S.prefs.embedLinks = v; save(); })),
      row('Cores dos cargos nos nomes', null, toggle(S.prefs.roleColors !== false, v => { S.prefs.roleColors = v; save(); })),
      row('Enviar imagens no tamanho original', 'Desligado: as fotos são comprimidas antes de enviar (WebP, até 2560 px), ficando bem mais leves para enviar e abrir. GIFs nunca são alterados.', toggle(!!S.prefs.imgOriginal, v => { S.prefs.imgOriginal = v; save(); }))),
    section('Animações'), card(row('Animações aprimoradas', 'Transições suaves ao trocar de canal, abrir janelas e menus e receber mensagens. "Reduzir animações" em Acessibilidade tem prioridade.', toggle(S.prefs.animations !== false, set('animations')))),
    section('Avatares e banners animados'), card(h('label.f', 'Avatares e banners em GIF/WebP', seg({ always: 'Sempre', speak: 'Na chamada, só quando fala', never: 'Nunca (desligar todas)' }, S.prefs.animMode || 'always', (v) => { S.prefs.animMode = v; save(); refreshFreeze(); }))),
    section('Tradução'), card(
      h('label.f', 'Traduzir mensagens para', (() => { const s = h('select', { onchange: () => { S.prefs.trLang = s.value; save(); } }, Object.entries(LANGS).map(([k, l]) => h('option', { value: k, selected: myLang() === k }, l))); return s; })()),
      row('Manter o original ao enviar com $idioma', 'Ex.: "$en bom dia" envia "good morning" e, em spoiler, o texto original.', toggle(!!S.prefs.trSendOriginal, v => { S.prefs.trSendOriginal = v; save(); }))),
    hint('Clique direito numa mensagem → Traduzir. No compositor, o botão de tradução converte o rascunho. O texto passa pelo servidor, que usa o tradutor configurado (LIBRETRANSLATE_URL ou Google).'));
}
// ============================ Recursos extras (inspirados em plugins) ============================
function linkDemo() { // antes → depois da limpeza dos links
  const ex = ['https://youtu.be/dQw4w9WgXcQ?si=Ab12Cd34&t=42', 'https://open.spotify.com/track/4uLU6hMC?si=9f8e7d6c5b', 'https://loja.com/produto?id=7&utm_source=insta&fbclid=IwAR0x'];
  return h('div.chdemo', ex.map(u => h('div.chdemo-row', h('span.from', u), h('span.arrow', '→'), h('b', cleanLinks(u)))));
}
function extrasPage(ctx) {
  const P = S.prefs, set = (k, after) => (v) => { P[k] = v; save(); after?.(); };
  // nomes de canais: prévia ao vivo com exemplos
  const SAMPLES = ['bate-papo', 'regras_e_avisos', '🎮-jogos-de-rpg', 'faq-do-servidor'];
  const demo = h('div.chdemo');
  const drawDemo = () => demo.replaceChildren(...SAMPLES.map(n => h('div.chdemo-row', h('span.from', '# ' + n), h('span.arrow', '→'), h('b', '# ' + prettyName(n)))));
  const words = h('input', { value: P.chNameWords ?? DEFAULT_NAME_WORDS, placeholder: DEFAULT_NAME_WORDS, oninput: () => { P.chNameWords = words.value; save(); drawDemo(); } });
  drawDemo();
  // volumes salvos
  const vols = h('div');
  const drawVols = () => {
    const ent = Object.entries(P.userVolumes || {});
    vols.replaceChildren(vrow('Volumes salvos por pessoa', ent.length ? ent.map(([id, v]) => `${nameOf(id)}: ${v}%`).join(' • ') : 'Nenhum — todos em 100%.',
      ent.length > 0 && h('button.btn.grey', { onclick: () => { P.userVolumes = {}; P.streamVolumes = {}; save(); ctx?.voice?.peers.forEach((_, id) => ctx.voice.applyVolume(id)); drawVols(); toast('Volumes redefinidos para 100%'); } }, 'Redefinir')));
  };
  drawVols();
  return h('div', h('h2', 'Recursos extras'),
    hint('Recursos inspirados em plugins populares da comunidade, feitos do zero para a Resenha.'),
    section('Mensagens'),
    card(
      row('Tirar rastreio dos links ao enviar', 'Remove de links do YouTube, Spotify, Instagram, TikTok, X, Amazon, Mercado Livre, Shopee e outros o que só serve para rastrear quem compartilhou (utm_, fbclid, si=…). O link continua abrindo a mesma coisa; o tempo do vídeo (t=) e a playlist ficam.', toggle(P.cleanLinks !== false, set('cleanLinks'))),
      linkDemo(),
      row('Duplo clique para editar ou responder', 'Duplo clique na sua mensagem abre a edição; na de outra pessoa, começa a resposta. Links, imagens, vídeos e reações continuam com o clique normal.', toggle(P.dblClickMsg !== false, set('dblClickMsg'))),
      row('Ctrl + ↑ / ↓ para escolher a mensagem a responder', 'No campo de mensagem: Ctrl + ↑ sobe para a mensagem anterior, Ctrl + ↓ desce; passar da última cancela a resposta. Esc também cancela.', toggle(P.quickReply !== false, set('quickReply')))),
    hint('Para marcar um horário que cada um vê no próprio fuso, use o + do campo de mensagem → Inserir horário (ou escreva <t:SEGUNDOS:R>).'),
    section('Pessoas'),
    card(
      row('Mostrar de onde cada um está conectado', 'Ícones ao lado do nome na lista de membros, nas conversas e no perfil: app para computador, celular ou navegador. Quem aparece offline para você (invisível ou com a presença escondida) não mostra nada.', toggle(P.platformIcons !== false, set('platformIcons', () => document.dispatchEvent(new Event('prefs-changed-elsewhere'))))),
      row('Avisar quando alguém desfizer a amizade', 'Mostra um aviso na hora e guarda por 30 dias na caixa de entrada → Pedidos, com o botão para mandar o pedido de novo. Também vale se aconteceu com o app fechado.', toggle(P.friendLossNotice !== false, set('friendLossNotice')))),
    section('Visualizador de imagens'),
    card(
      toggleCards([
        { on: !!P.lensClick, label: 'Lente no clique', sub: 'Desligado: segure o botão', desc: 'Ligado: um clique liga a lente e outro desliga. Desligado: segure o botão do mouse sobre a imagem.', prev: h('span.ex-lens', h('i.ex-img'), h('i.ex-glass'), icon('pointer', 18)), fn: set('lensClick') },
        { on: !!P.lensPixel, label: 'Lente pixelada', sub: 'Pixels nítidos ao ampliar', desc: 'Mostra os pixels nítidos ao ampliar, em vez de suavizar.', prev: h('span.ex-pix', Array.from({ length: 16 }, (_, i) => h('i', { style: { opacity: [1, .6, .3, .8, .5, 1, .7, .4, .9, .3, .6, 1, .4, .8, 1, .5][i] } }))), fn: set('lensPixel') }]),
      h('label.f', { style: { marginTop: '12px' } }, 'Tamanho da lente', slider(100, 500, P.lensSize ?? 220, 10, set('lensSize'), v => v + ' px')),
      h('label.f', 'Ampliação da lente', slider(1.5, 12, P.lensZoom ?? 3, .5, set('lensZoom'), v => v + '×'))),
    hint('No visualizador: ← → trocam de imagem do canal, R gira, F alterna tamanho real, roda do mouse com a lente muda o zoom e Shift + roda muda o tamanho. Clique com o botão direito numa imagem para copiar, salvar ou abrir no navegador.'),
    section('Prévia de canais'),
    card(
      h('label.f', 'Como abrir a prévia'), choiceCards(PREVIEW_TRIGGERS.map(([k, l]) => [k, l, h('span.ex-trig', k === 'hover' ? icon('pointer', 26) : k === 'shift' ? [h('kbd', 'Shift'), icon('pointer', 22)] : k === 'middle' ? h('span.ex-mouse', h('i')) : icon('x', 26))]), P.chPreview ?? 'hover', set('chPreview')),
      h('label.f', { style: { marginTop: '12px' } }, 'Atraso ao passar o mouse', slider(100, 2000, P.chPreviewDelay ?? 450, 50, set('chPreviewDelay'), v => (v / 1000).toFixed(2).replace('.', ',') + ' s')),
      h('label.f', 'Quantidade de mensagens', slider(10, 100, P.chPreviewCount ?? 20, 5, set('chPreviewCount'))),
      h('label.f', 'Altura da prévia', slider(20, 90, P.chPreviewHeight ?? 45, 5, set('chPreviewHeight'), v => v + '% da janela')),
      h('label.f', 'Escurecer o chat atrás da prévia', slider(0, 70, P.chPreviewDim ?? 0, 5, set('chPreviewDim'), v => v + '%')),
      row('Mostrar quem está digitando', null, toggle(P.chPreviewTyping !== false, set('chPreviewTyping')))),
    hint('A prévia não abre o canal nem marca as mensagens como lidas.'),
    section('Nomes de canais'),
    card(
      toggleCards([
        { on: !!P.chCaps, label: 'Maiúscula no início', prev: h('span.ex-name', h('s', 'bate papo'), h('b', 'Bate Papo')), fn: set('chCaps', drawDemo) },
        { on: !!P.chDashes, label: 'Hífens viram espaços', prev: h('span.ex-name', h('s', 'bate-papo'), h('b', 'bate papo')), fn: set('chDashes', drawDemo) },
        { on: !!P.chNoEmoji, label: 'Sem emojis no nome', prev: h('span.ex-name', h('s', '🎮-jogos'), h('b', 'jogos')), fn: set('chNoEmoji', drawDemo) },
        { on: !!P.chNamesVoice, label: 'Também em salas de voz', prev: h('span.ex-name.voice', icon('voice', 20), h('b', 'Sala Geral')), fn: set('chNamesVoice') }]),
      h('label.f', { style: { marginTop: '12px' } }, 'Palavras com grafia fixa (separadas por vírgula)', words),
      demo),
    hint('Só muda como os nomes aparecem para você: na lista, no topo, na caixa de mensagem e nas abas. O nome real do canal continua o mesmo.'),
    section('Volume das pessoas'),
    card(vols),
    hint(`Clique com o botão direito em alguém na chamada → "Volume do usuário" para digitar valores até ${MAX_VOL}% (acima de 100% o som é amplificado). Também dá para ajustar cada pessoa no menu de saída de áudio (seta ao lado do fone).`));
}

function accessibilityPage() {
  const set = (k) => (v) => { S.prefs[k] = v; save(); applyTheme(); };
  const sat = h('div.ac-sat', ['#5865f2', '#23a559', '#f0b232', '#f23f43', '#eb459e'].map(c => h('i', { style: { background: c } })));
  const paintSat = () => { sat.style.filter = `saturate(${(S.prefs.saturation ?? 100) / 100})`; };
  paintSat();
  return h('div', h('h2', 'Acessibilidade'),
    card(toggleCards([
      { on: S.prefs.reduceMotion, label: 'Reduzir animações', desc: 'Desliga transições e movimentos da interface.', prev: h('span.ac-motion', h('i.am-box'), h('i.am-arrow', '→'), h('i.am-box.still')), fn: set('reduceMotion') },
      { on: S.prefs.highContrast, label: 'Alto contraste', desc: 'Bordas e textos mais fortes.', prev: h('span.ac-contrast', h('span.lo', 'Aa'), h('span.hi', 'Aa')), fn: set('highContrast') },
      { on: S.prefs.underlineLinks, label: 'Sublinhar links', desc: 'Todo link no chat aparece sublinhado.', prev: h('span.ac-link', 'veja ', h('u', 'este link')), fn: set('underlineLinks') }]),
      h('label.f', { style: { marginTop: '12px' } }, 'Saturação das cores', slider(0, 100, S.prefs.saturation, 5, (v) => { set('saturation')(v); paintSat(); }, v => v + '%')), sat),
    hint('Dica: em Aparência há uma fonte legível para dislexia e o tamanho da interface.'));
}

// ============================ Voz e vídeo ============================
function voicePage(ctx, reg) {
  const voice = ctx.voice;
  const sel = (kind, key, label, after) => {
    const s = h('select', { onchange: () => { setDevice(key, s.value, s.selectedOptions[0]?.dataset.label); save(); after?.(); } }, h('option', { value: '' }, 'Padrão'));
    navigator.mediaDevices?.enumerateDevices().then(ds => ds.filter(d => d.kind === kind).forEach(d => s.append(h('option', { value: d.deviceId, 'data-label': d.label, selected: S.prefs[key] === d.deviceId }, d.label || d.kind))));
    return h('label.f', label, s);
  };
  const meterBar = h('i'), gateMark = h('b.gatemark'), meterWrap = h('div.meter.big', meterBar, gateMark);
  const placeMark = () => { gateMark.style.left = Math.max(0, Math.min(100, (S.prefs.gateDb + 70) / 70 * 100)) + '%'; };
  let test = null, raf = 0, loopback = false, testCtx;
  const stopTest = () => { cancelAnimationFrame(raf); test?.dispose(); test = null; testCtx?.close(); testCtx = null; meterBar.style.width = '0'; testBtn.textContent = 'Testar microfone'; };
  reg(stopTest);
  // reiniciar o teste: um de cada vez (cliques seguidos viram um só); o anterior sempre é desligado antes
  let testBusy = null, testAgain = false;
  const restartTest = () => {
    if (voice.active) voice.rebuildMic();
    if (!test && !testBusy) return;
    if (testBusy) { testAgain = true; return; }
    testBusy = (async () => { do { testAgain = false; stopTest(); await startTest(); } while (testAgain); })().finally(() => { testBusy = null; });
  };
  const startTest = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Acesse via HTTPS ou use o app desktop para usar o microfone.');
      const myCtx = testCtx = newAudioContext(); await myCtx.resume();
      const t = await createMic(S.prefs, myCtx);
      if (testCtx !== myCtx) { t.dispose(); myCtx.close(); return; } // parou (ou recomeçou) enquanto abria o microfone
      test = t; test.setLoopback(loopback);
      if (test.error) toast(test.error, true);
      const buf = new Uint8Array(test.analyser.fftSize);
      const loop = () => { test.analyser.getByteTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v - 128)); const db = 20 * Math.log10(Math.max(p / 128, 1e-4)); meterBar.style.width = Math.max(0, Math.min(100, (db + 70) / 70 * 100)) + '%'; raf = requestAnimationFrame(loop); };
      loop(); testBtn.textContent = 'Parar teste';
    } catch (e) { toast(e.message || 'Falha ao acessar o microfone', true); stopTest(); }
  };
  const testBtn = h('button.btn', { onclick: () => (test ? stopTest() : startTest()) }, 'Testar microfone');
  // supressão de ruído: cada nível mostra a voz (barras altas) e o ruído (pontinhos) que sobra
  const noiseCards = h('div'), drawNoise = () => noiseCards.replaceChildren(choiceCards(Object.keys(NOISE_MODES).map(k => [k, h('span.nz-l', h('b', NOISE_INFO[k][0]), h('small', NOISE_INFO[k][1])), noisePrev(k)]), S.prefs.noiseMode || 'standard', (k) => { if ((S.prefs.noiseMode || 'standard') === k) return; S.prefs.noiseMode = k; save(); restartTest(); }));
  drawNoise(); setTimeout(placeMark, 0);
  const gateLbl = h('span', S.prefs.gateDb + ' dB');
  const gateBox = h('label.f', { style: { marginTop: '4px' } }, 'Limite da porta: ', h('span', S.prefs.gateDb + ' dB')); gateBox.style.display = S.prefs.gate ? '' : 'none';
  const gate = h('input', { type: 'range', min: -70, max: -10, value: S.prefs.gateDb, oninput: () => { S.prefs.gateDb = +gate.value; gateLbl.textContent = gate.value + ' dB'; gateBox.firstElementChild.textContent = gate.value + ' dB'; placeMark(); }, onchange: () => { save(); restartTest(); } });
  gateBox.append(gate);
  const pttBtn = captureKey(h('button.btn.grey'), S.prefs.pttKey, (c) => { S.prefs.pttKey = c; save(); }, { combo: false, label: 'Tecla de push-to-talk: ' });
  const dev = (kind) => async () => { try { const s = await navigator.mediaDevices.getUserMedia(kind === 'cam' ? { video: true } : { audio: true }); s.getTracks().forEach(t => t.stop()); toast('Permissão concedida. Reabra a página para listar os nomes.'); } catch (e) { toast(e.message, true); } };
  const camPrev = h('video', { autoplay: true, muted: true, playsInline: true, style: { width: '100%', borderRadius: '8px', background: '#000', display: 'none', marginTop: '12px' } });
  let camStream; reg(() => camStream?.getTracks().forEach(t => t.stop()));
  const camBtn = h('button.btn.grey', { onclick: async () => { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; camPrev.style.display = 'none'; return; } try { camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: S.prefs.videoId ? { exact: S.prefs.videoId } : undefined, height: { ideal: S.prefs.camRes }, frameRate: { ideal: S.prefs.camFps } } }); camPrev.srcObject = camStream; camPrev.style.display = 'block'; } catch (e) { toast('Câmera: ' + e.message, true); } } }, 'Testar câmera');
  return h('div', h('h2', 'Voz e vídeo'),
    card(sel('audioinput', 'inputId', 'Dispositivo de entrada', restartTest), sel('audiooutput', 'outputId', 'Dispositivo de saída', () => applyOutput(voice)),
      h('label.f', 'Volume do microfone', slider(0, 200, S.prefs.inputVolume, 5, v => { S.prefs.inputVolume = v; save(); if (test) test.gain.gain.value = v / 100; if (voice.micGraph) voice.micGraph.gain.gain.value = v / 100; }, v => v + '%')),
      h('label.f', 'Volume geral da voz', slider(0, 100, S.prefs.volume, 5, v => { S.prefs.volume = v; save(); voice.peers.forEach((_, id) => voice.applyVolume(id)); }, v => v + '%')),
      !navigator.mediaDevices?.enumerateDevices ? null : h('button.btn.grey', { onclick: dev('mic') }, 'Pedir permissão do microfone')),
    section('Supressão de ruído'), card(noiseCards,
      toggleCards([
        { on: S.prefs.gate, label: 'Porta de ruído', desc: 'Silencia o microfone abaixo do limite. Útil com teclado mecânico e ventoinhas.', prev: h('span.vp-gate', h('i.g1'), h('i.g2'), h('i.g3'), h('i.g4'), h('i.g5'), h('b.vp-line')), fn: v => { S.prefs.gate = v; save(); gateBox.style.display = v ? '' : 'none'; restartTest(); } },
        { on: S.prefs.echo !== false, label: 'Cancelamento de eco', desc: 'Evita que o som dos seus alto-falantes volte pelo microfone.', prev: h('span.vp-echo', icon('vol', 26), h('i.e1'), h('i.e2'), h('i.e3')), fn: v => { S.prefs.echo = v; save(); restartTest(); } },
        { on: S.prefs.agc !== false, label: 'Ganho automático', desc: 'Deixa sua voz sempre no mesmo volume, perto ou longe do microfone.', prev: h('span.vp-agc', h('i', { style: { height: '30%' } }), h('i', { style: { height: '70%' } }), h('i', { style: { height: '45%' } }), h('b.vp-eq'), h('i.eq', { style: { height: '55%' } }), h('i.eq', { style: { height: '55%' } }), h('i.eq', { style: { height: '55%' } })), fn: v => { S.prefs.agc = v; save(); restartTest(); } }]),
      gateBox),
    section('Teste de microfone'), card(h('div.btns', testBtn, h('span', { style: { color: 'var(--text-muted)' } }, 'Ouvir a mim mesmo (use fones!)'), toggle(false, (v) => { loopback = v; test?.setLoopback(v); })), meterWrap),
    section('Modo de entrada'), card(choiceCards([['vad', 'Atividade de voz', h('span.im-prev', icon('waves', 28), h('small', 'Fala e já sai'))], ['ptt', 'Push-to-talk', h('span.im-prev', icon('keyboard', 28), h('small', 'Segura a tecla para falar'))]], S.prefs.inputMode || 'vad', v => { S.prefs.inputMode = v; save(); voice.applyMute(); }), h('div', { style: { marginTop: '12px' } }, pttBtn), hint('O push-to-talk funciona com a janela do app em foco.')),
    section('Qualidade da voz'), card(h('label.f', 'Taxa de bits do áudio', seg(VOICE_BITRATES, S.prefs.voiceBitrate ?? 'auto', v => { S.prefs.voiceBitrate = v; save(); voice?.retuneAudio(); })), hint('Automático: voz mono a 64 kbps, que já soa perfeita; desce para 48 ou 32 kbps se a sua conexão tiver perda ou ping alto. 128 kbps ou mais só faz diferença para música e pesa para todos: o servidor repassa a sua voz para cada pessoa da sala. O nível atual aparece no painel de voz.')),
    section('Efeitos de voz'), card(toggleCards([{ on: S.prefs.hearFx !== false, label: 'Ouvir efeitos de voz dos outros', sub: 'Desligado: todo mundo com a voz normal', desc: 'Dá também para desligar só de uma pessoa: clique direito nela → "Ouvir sem efeito de voz".', prev: h('span.vp-fx', icon('mask', 30), h('i.fx-w'), h('i.fx-w.w2')), fn: v => { S.prefs.hearFx = v; save(); if (voice) for (const uid of voice.peers.keys()) voice.applyVolume(uid); } }])),
    section('Câmera'), card(sel('videoinput', 'videoId', 'Câmera'), h('label.f', 'Resolução', seg({ 360: '360p', 720: '720p', 1080: '1080p' }, S.prefs.camRes, v => { S.prefs.camRes = v; save(); })), h('label.f', 'Quadros por segundo', seg({ 15: '15', 30: '30', 60: '60' }, S.prefs.camFps, v => { S.prefs.camFps = v; save(); })), camBtn, camPrev),
    section('Diagnóstico'), card(h('button.btn.grey', { onclick: async () => { const st = voice.active ? await voice.stats() : []; modal('Diagnóstico de voz', voice.active ? 'Conexões com os outros participantes' : 'Você não está em uma sala de voz', h('div', ...st.map(s => row(user(s.uid).display_name, `estado: ${s.state}`, h('b', s.rtt != null ? s.rtt + ' ms' : '—'))), !st.length && hint('Entre em uma sala de voz para ver os dados.')), [{ label: 'Fechar' }]); } }, 'Ver conexões agora'),
      h('button.btn.grey', { style: { marginLeft: '8px' }, onclick: () => { voice.active ? voice.rebuildMic().then(() => toast('Áudio reiniciado')) : toast('Entre em uma sala primeiro', true); } }, 'Reiniciar áudio')),
    !window.isSecureContext && card(note([h('span.hint-ic', icon('warn', 16)), 'Conexão não segura (HTTP): navegadores só liberam microfone/câmera/tela em HTTPS. Use https://…:3443 ou o aplicativo desktop.'])));
}

// ============================ Transmissão ============================
function streamPage() {
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, ...S.prefs.screen };
  const commit = () => { S.prefs.screen = { res: o.res, fps: o.fps, hint: o.hint, audio: o.audio }; save(); };
  return h('div', h('h2', 'Transmissão de tela'), hint('Esses são os valores iniciais ao clicar em "Transmitir tela". Você ainda escolhe a tela/janela e pode mudar a qualidade durante a transmissão.'),
    card(qualityPanel(o, commit), row('Compartilhar áudio do sistema por padrão', null, toggle(o.audio, v => { o.audio = v; commit(); }))),
    section('Experimental'),
    card(row('Teste: transmissão a 120 FPS', 'A transmissão normal fica limitada a ~48 FPS pelo Windows. Este teste usa um programa à parte (pacote de teste) que captura sem esse limite, e mede aqui quantos quadros chegam. Entre numa sala de voz antes.',
      h('button.btn', { onclick: () => openNativeTest() }, 'Abrir teste'))));
}

// ============================ Sons do app ============================
function soundsPage() {
  const groups = { voz: ['Voz', 'mic'], transmissão: ['Transmissão', 'screen'], chat: ['Mensagens e chamadas', 'dm'] };
  // ícone de cada som: o que acontece quando ele toca
  const ICON = { mute: 'micoff', unmute: 'mic', deafen: 'headoff', undeafen: 'headset', selfJoin: 'arrowr', selfLeave: 'phoneoff', join: 'users', leave: 'logout', camOn: 'video', camOff: 'eye',
    streamStart: 'live', streamStop: 'stop', selfStreamStart: 'screen', selfStreamStop: 'stop', ring: 'phone', mention: 'bell', message: 'dm', friend: 'invite', error: 'warn' };
  const tileFor = (name) => {
    const [label] = SOUND_DEFS[name], cfg = soundCfg(name);
    const status = h('small.snd-st', cfg.url ? 'Som personalizado' : 'Som padrão');
    const tile = h('div.snd-tile' + (cfg.on ? '.on' : ''));
    const sw = h('button.snd-sw', { type: 'button', role: 'switch', 'aria-checked': String(!!cfg.on), 'aria-label': (cfg.on ? 'Desligar ' : 'Ligar ') + label, onclick: () => { cfg.on = !cfg.on; save(); tile.classList.toggle('on', cfg.on); sw.setAttribute('aria-checked', String(cfg.on)); } }, h('span.tg-sw'));
    const vol = h('input', { type: 'range', min: 0, max: 100, step: 5, value: cfg.vol, 'aria-label': 'Volume de ' + label, oninput: () => { cfg.vol = +vol.value; volLbl.textContent = vol.value + '%'; }, onchange: () => save() });
    const volLbl = h('small.snd-vl', cfg.vol + '%');
    tile.append(
      h('div.snd-top', h('span.snd-ic', icon(ICON[name] || 'vol', 22)), sw),
      h('b.snd-name', label), status,
      h('div.snd-vol', icon('vollow', 14), vol, volLbl),
      h('div.snd-acts',
        h('button.snd-play', { type: 'button', title: 'Testar', onclick: () => playSound(name, { force: true }) }, icon('play', 16), 'Ouvir'),
        h('button.snd-b', { type: 'button', title: 'Usar seu próprio áudio (até 1 MB, 5 s)', onclick: async () => { const u = await uploadFile('audio/*', 1); if (u) { cfg.url = u.url; save(); status.textContent = 'Som personalizado'; } } }, icon('music', 16)),
        h('button.snd-b', { type: 'button', title: 'Voltar ao som padrão', onclick: () => { cfg.url = null; save(); status.textContent = 'Som padrão'; } }, icon('refresh', 16))));
    return tile;
  };
  // volume de cada grupo, sem mexer nos outros: notificações baixinhas e os sons da chamada no normal (ou o contrário)
  const GV = { chat: ['Volume das notificações', 'Mensagens, menções, mensagens diretas, chamadas recebidas e pedidos de amizade'], voz: ['Volume dos sons da chamada', 'Entrar, sair, mutar, câmera'], transmissão: ['Volume dos sons de transmissão', 'Começar e parar de transmitir'] };
  const groupVol = (g) => { const k = SOUND_GROUP_VOL[g]; return h('div.snd-gvol', h('label.f', GV[g][0], h('small.mut', GV[g][1]), slider(0, 100, S.prefs[k] ?? 100, 5, v => { S.prefs[k] = v; save(); }, v => v + '%', () => playSound({ chat: 'mention', voz: 'join', transmissão: 'streamStart' }[g], { force: true })))); };
  return h('div', h('h2', 'Sons'),
    card(toggleCards([{ on: !!S.prefs.soundsMuted, label: 'Silenciar todos os sons do app', sub: 'Nenhum efeito sonoro toca', prev: h('span.snd-hero', icon('volmute', 30), h('i.sh-x')), fn: v => { S.prefs.soundsMuted = v; save(); } }]),
      h('label.f', { style: { marginTop: '12px' } }, 'Volume geral dos sons', slider(0, 100, S.prefs.soundVolume, 5, v => { S.prefs.soundVolume = v; save(); }, v => v + '%'))),
    ...Object.entries(groups).flatMap(([g, [title, ic]]) => [h('h3.sec.snd-sec', icon(ic, 16), title), groupVol(g), h('div.snd-grid', Object.keys(SOUND_DEFS).filter(n => SOUND_DEFS[n][1] === g).map(tileFor))]),
    hint([icon('music', 14), ' troca o som pelo seu próprio arquivo de áudio; ', icon('refresh', 14), ' volta ao padrão. As configurações acompanham sua conta.']));
}

// ============================ Soundboard (gerenciar) ============================
function soundboardPage() {
  const box = h('div');
  const draw = () => {
    box.replaceChildren(...soundSources().map(src => {
      const canEdit = src.own || (src.guild && can(src.guild.id, PERM.MANAGE_GUILD));
      const head = h('div.sbp-head',
        src.own ? h('span.sbp-ic', icon('user', 20)) : src.guild?.icon ? h('img.sbp-ic', { src: src.guild.icon, alt: '' }) : h('span.sbp-ic', (src.title || '?').slice(0, 2).toUpperCase()),
        h('div.sbp-t', h('b', src.title), h('small', `${src.sounds.length} ${src.sounds.length === 1 ? 'som' : 'sons'}`)),
        !src.own && h('button.sbp-use' + (!src.off ? '.on' : ''), { type: 'button', role: 'switch', 'aria-checked': String(!src.off), title: 'Mostrar os sons deste servidor no soundboard', onclick: () => { (S.prefs.sbOffGuilds ||= {})[src.key] = !src.off; save(); draw(); } }, h('span.tg-sw'), 'Usar neste servidor'));
      const pads = src.sounds.length ? h('div.sbp-grid' + (src.off ? '.off' : ''), src.sounds.map(s => h('div.sbp-pad',
        h('button.sbp-play', { type: 'button', title: 'Ouvir ' + s.name, onclick: (e) => { playLocal(s.url, soundVol(s)); const b = e.currentTarget; b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); } },
          h('span.sbp-e', soundEmoji(s.emoji)), h('span.sbp-n', s.name), h('small.sbp-v', icon('vol', 12), soundVol(s) + '%')),
        canEdit && h('button.sbp-edit', { type: 'button', title: 'Editar ' + s.name, 'aria-label': 'Editar ' + s.name, onclick: () => editSound(src, s) }, icon('edit', 14)))),
        canEdit && src.own && h('button.sbp-pad.sbp-add', { type: 'button', onclick: () => addSound(null) }, icon('plus', 26), h('span', 'Novo som')))
        : h('div.sbp-empty', icon('soundboard', 28), h('span', src.own ? 'Você ainda não tem sons. Adicione um curtinho (até 15 s).' : 'Nenhum som neste servidor ainda.'), src.own && h('button.btn', { onclick: () => addSound(null) }, '+ Novo som'));
      return card(head, pads);
    }));
  };
  const onChange = () => draw();
  document.addEventListener('sb-changed', onChange); draw(); queueMicrotask(() => whenGone(box, () => document.removeEventListener('sb-changed', onChange)));
  return h('div', h('h2', 'Soundboard'),
    card(toggleCards([{ on: !!S.prefs.sbMuted, label: 'Silenciar sons do soundboard', sub: 'Você deixa de ouvir os sons que os outros tocam', prev: h('span.snd-hero', icon('soundboard', 30), h('i.sh-x')), fn: v => { S.prefs.sbMuted = v; save(); } }]),
      h('label.f', { style: { marginTop: '12px' } }, 'Volume dos sons que você ouve', slider(0, 100, S.prefs.sbVolume ?? 70, 5, v => { S.prefs.sbVolume = v; save(); }, v => v + '%'))),
    hint(['Abra o soundboard rapidamente pelo botão ', icon('soundboard', 14), ' da barra do usuário ou da chamada. Clique direito num som: favoritar, atalho, prévia.']), box);
}

// ============================ Notificações ============================
function notificationsPage() {
  const root = h('div');
  const cfgAll = (S.prefs.notifyCfg ||= {}), chLv = (cfgAll.chLevel ||= {}), chMute = (cfgAll.channels ||= {}), chUn = (cfgAll.chUnmute ||= {});
  const gcfg = (g) => (cfgAll[g.id] ||= { level: 'all', muted: false, noEveryone: false });
  const tile = (on, cls, ic, label, sub, fn, title) => h('button.ntile.big' + cls + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), title, onclick: fn }, ic, h('span.nt-l', label), sub && h('small', sub));
  const levelCards = (cur, on) => choiceCards([
    ['all', 'Todas as mensagens', h('span.nl-prev', icon('bell', 26), h('i.nl-bars', h('b'), h('b'), h('b')))],
    ['mentions', 'Só @menções', h('span.nl-prev.at', '@')],
    ['none', 'Nada', h('span.nl-prev.off', icon('volmute', 26))]], cur || 'all', on);
  const draw = () => {
    const preview = S.prefs.notifPreview !== false;
    // canais com ajuste próprio ou silenciados
    const custom = [...new Set([...Object.keys(chLv), ...Object.keys(chMute), ...Object.keys(chUn)])].map(id => channelById(id)).filter(Boolean);
    const until = (id) => { const u = chMute[id]; return u === true ? 'até você reativar' : u > Date.now() ? 'até ' + new Date(u).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null; };
    const LVL = { all: 'Todas', mentions: 'Só @menções', none: 'Nada' };
    root.replaceChildren(h('h2', 'Notificações'),
      section('Como você é avisado'),
      card(h('div.np-row',
        h('div.nc-tiles.np-tiles',
          tile(!!S.prefs.desktopNotif, '.nt-desk', icon('screen', 26), 'Área de trabalho', S.prefs.desktopNotif ? 'Ligado' : 'Desligado', async () => {
            if (!S.prefs.desktopNotif && 'Notification' in window && Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') return toast('O navegador bloqueou as notificações', true);
            S.prefs.desktopNotif = !S.prefs.desktopNotif; save(); draw();
          }, 'Avisos do sistema para menções e mensagens diretas quando a janela não está em foco'),
          tile(preview, '.nt-every', icon('eye', 26), 'Mostrar o texto', preview ? 'A mensagem aparece no aviso' : 'Só "Nova mensagem"', () => { S.prefs.notifPreview = !preview; save(); draw(); }, 'Mostrar o texto da mensagem dentro do aviso'),
          tile(S.prefs.quietElsewhere !== false, '.nt-else', icon('phone', 26), 'Só onde estou', S.prefs.quietElsewhere !== false ? 'Silencia aqui se outro aparelho estiver em uso' : 'Avisa em todos os aparelhos', () => { S.prefs.quietElsewhere = S.prefs.quietElsewhere === false; save(); draw(); }, 'Com o PC em uso, o celular (e as outras janelas) não tocam nem mostram aviso; o que você lê num aparelho some das notificações dos outros na hora'),
          tile(false, '.nt-link', icon('vol', 26), 'Sons', 'Abrir a página de sons', () => document.querySelector('#settings .ni[data-k="sounds"]')?.click(), 'Sons de mensagem, menção, chamada e voz')),
        // prévia: como o aviso aparece
        h('div.np-preview', { 'aria-hidden': 'true' }, h('small', 'Prévia'),
          h('div.np-toast' + (S.prefs.desktopNotif ? '' : '.off'), h('div.np-ic', icon('dm', 18)), h('div', h('b', 'Ana Clara'), h('span', preview ? 'bora jogar hoje? 🎮' : 'Nova mensagem')))))),
      card(h('label.f.np-vol', 'Volume das notificações', h('small.mut', 'Mensagens, menções, mensagens diretas, chamadas e pedidos de amizade. Os sons da chamada têm o volume deles, em Sons.'),
        slider(0, 100, S.prefs.notifVolume ?? 100, 5, v => { S.prefs.notifVolume = v; save(); }, v => v + '%', () => playSound('mention', { force: true })))),
      section('Modo foco'),
      card(h('div.np-focus',
        h('p.mut', 'Só mensagens diretas e chamadas para você tocam som e mostram aviso. Os servidores continuam marcando o que não foi lido, em silêncio. Seu status não muda: os amigos continuam te vendo online.'),
        choiceCards([['off', 'Desligado', h('span.nl-prev', icon('bell', 26))], ['on', 'Ligado', h('span.nl-prev.at', icon('dm', 26))]], focusOn() ? 'on' : 'off',
          (v) => { setFocus(v === 'on' ? true : null); draw(); }),
        focusOn() && h('div.np-focus-t', h('small.mut', 'Modo foco ' + focusLabel() + '. Desligar automaticamente:'),
          h('div.seg', FOCUS_TIMES.map(([l, v]) => h('button', { type: 'button', onclick: () => { setFocus(focusUntilOf(v)); draw(); } }, l)))))),
      section('Por servidor'),
      ...(S.guilds.size ? [...S.guilds.values()].map(g => {
        const c = gcfg(g), set = (fn) => { fn(); save(); draw(); };
        return card(h('div.np-srv',
          h('div.np-srv-h', g.icon ? h('img.np-gi', { src: g.icon, alt: '' }) : h('div.np-gi', g.name.slice(0, 2).toUpperCase()), h('b', g.name)),
          levelCards(c.level, (v) => set(() => { c.level = v; })),
          h('div.nc-tiles.np-tiles',
            tile(!c.noEveryone, '.nt-every', h('span.nt-chips', h('i', '@everyone'), h('i', '@here')), null, null, () => set(() => { c.noEveryone = !c.noEveryone; }), c.noEveryone ? 'Avisos de @everyone e @here desligados' : 'Receber avisos de @everyone e @here'),
            tile(!!c.muted, '.nt-mute', icon(c.muted ? 'volmute' : 'bell', 24), c.muted ? 'Servidor silenciado' : 'Silenciar servidor', null, () => set(() => { c.muted = !c.muted; }), 'Silenciar o servidor inteiro')),
          c.muted && h('div.np-unmute', icon('bell', 14), h('span', 'Quer avisos só de alguns canais (anúncios, por exemplo)? Clique direito no canal ou na categoria → ', h('b', 'Reativar este canal'), '. O resto do servidor continua silenciado.'),
            ...g.channels.filter(x => chUn[x.id]).map(x => h('span.np-unch', (x.type === 4 ? '' : '#') + x.name)))));
      }) : [note('Você ainda não está em nenhum servidor.')]),
      custom.length > 0 && section('Canais e conversas com ajuste próprio'),
      custom.length > 0 && card(h('div.np-chs', custom.map(ch => {
        const g = ch.guild_id && guild(ch.guild_id), u = until(ch.id), name = ch.type === 1 ? '@' + (user(ch.recipients?.find(r => r.id !== S.me.id)?.id)?.display_name || 'conversa') : '#' + ch.name;
        return h('div.np-ch', h('div.np-ch-t', h('b', name), h('small', [g?.name, ch.type === 4 && 'categoria', chLv[ch.id] && LVL[chLv[ch.id]], u && 'silenciado ' + u, chUn[ch.id] && (cfgAll[ch.guild_id]?.muted ? 'reativado (servidor silenciado)' : 'reativado se o servidor for silenciado')].filter(Boolean).join(' · '))),
          h('button.btn.grey', { onclick: () => { delete chLv[ch.id]; delete chMute[ch.id]; delete chUn[ch.id]; save(); draw(); } }, 'Voltar ao padrão'));
      }))));
  };
  draw();
  return root;
}

// ============================ Atalhos ============================
const KEY_DEFAULTS = { keyMute: 'Ctrl+Shift+KeyM', keyDeafen: 'Ctrl+Shift+KeyD', keyClip: 'F8', keyFx: 'Ctrl+Shift+KeyE', keyShare: 'Ctrl+Shift+KeyS' };
function keysPage() {
  const cap = (key, label, desktopKey) => captureKey(h('button.btn.grey', { style: { minWidth: '190px' } }), S.prefs[key] || KEY_DEFAULTS[key], (c) => { S.prefs[key] = c; save(); if (desktop && desktopKey) desktop.setSettings({ [desktopKey]: comboToAccel(c) }); }, { combo: true });
  const rows = [['Ctrl + K', 'Busca rápida'], ['↑ (campo vazio)', 'Editar sua última mensagem'], ['Ctrl + ↑ / ↓', 'Escolher a mensagem a responder'], ['Esc', 'Cancelar resposta / fechar / sair da conversa direta'], ['Shift + Enter', 'Quebra de linha']];
  return h('div', h('h2', 'Atalhos'),
    card(row('Silenciar / ativar microfone', desktop ? 'Funciona também com o app em segundo plano.' : 'Com a aba em foco.', cap('keyMute', '', 'hotkeyMute')),
      row('Ensurdecer / ativar áudio', null, cap('keyDeafen', '', 'hotkeyDeafen')),
      row('Salvar clipe da transmissão', 'Salva os últimos segundos da transmissão em destaque no chat da sala (clipes ficam ligados por padrão nas transmissões dos outros).', cap('keyClip', '', 'hotkeyClip')),
      row('Iniciar / encerrar transmissão', desktop ? 'Funciona com o jogo aberto. Começa na hora, sem escolher nada: transmite a janela em primeiro plano (jogo em janela ou em tela cheia) com a qualidade e o áudio da última vez.' : 'Transmite com a qualidade e o áudio da última vez; o navegador ainda pede para escolher a tela (no app desktop começa direto na janela da frente).', cap('keyShare', '', 'hotkeyShare')),
      row('Oferecer transmitir o jogo', 'Ao abrir um jogo durante a chamada, pergunta se você quer transmitir (app desktop).', toggle(S.prefs.gameShareOffer !== false, (v) => { S.prefs.gameShareOffer = v; save(); })),
      row('Ligar / desligar efeito de voz', 'Liga o último efeito usado (Robô na primeira vez) ou desliga. Com o app em foco.', cap('keyFx', '')),
      row('Duração do clipe do atalho', null, seg({ 15: '15s', 30: '30s', 60: '60s' }, S.prefs.clipSecs || 30, (v) => { S.prefs.clipSecs = +v; save(); })),
      row('Push-to-talk', 'Segurar para falar (modo "Push-to-talk" em Voz e vídeo).', captureKey(h('button.btn.grey', { style: { minWidth: '190px' } }), S.prefs.pttKey, (c) => { S.prefs.pttKey = c; save(); }, { combo: false }))),
    section('Fixos'), card(...rows.map(([k, d]) => row(d, null, h('kbd', k)))),
    hint('Atalhos para tocar sons do soundboard: clique direito no som → "Definir atalho".'));
}

// ============================ Avançado ============================
function advancedPage(ctx) {
  const exportBtn = h('button.btn.grey', { onclick: () => { const p = { ...S.prefs }; ['inputId', 'outputId', 'videoId'].forEach(k => delete p[k]); const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })), download: 'resenha-configuracoes.json' }); a.click(); } }, 'Exportar configurações');
  const importBtn = h('button.btn.grey', { onclick: () => { const i = h('input', { type: 'file', accept: '.json', onchange: async () => { try { Object.assign(S.prefs, JSON.parse(await i.files[0].text())); save(); applyTheme(); toast('Configurações importadas'); } catch { toast('Arquivo inválido', true); } } }); i.click(); } }, 'Importar configurações');
  const resetBtn = h('button.btn.red', { onclick: async () => { if (await confirmBox('Redefinir configurações', 'Volta tudo ao padrão (tema, voz, sons, atalhos…).', 'Redefinir')) { const keep = { inputId: S.prefs.inputId, outputId: S.prefs.outputId, videoId: S.prefs.videoId }; for (const k of Object.keys(S.prefs)) delete S.prefs[k]; localStorage.removeItem('lc_prefs'); S.prefs.inputId = keep.inputId; save(); location.reload(); } } }, 'Redefinir tudo');
  const dsk = h('div'); if (desktop) desktop.getSettings().then(s => dsk.replaceChildren(
    row('Aceleração de hardware', 'Usa a GPU para desenhar a interface. Reinicia o app.', toggle(s.hardwareAcceleration !== false, v => { desktop.setSettings({ hardwareAcceleration: v }); toast('Reinicie o app para aplicar'); })),
    row('Limpar cache do app', 'Libera espaço; as configurações e a conta permanecem.', h('button.btn.grey', { onclick: async () => { await desktop.clearCache(); toast('Cache limpo'); } }, 'Limpar')),
    row('Reiniciar o aplicativo', null, h('button.btn.grey', { onclick: () => desktop.relaunch() }, 'Reiniciar'))));
  return h('div', h('h2', 'Avançado'),
    card(row('Modo desenvolvedor', 'Mostra "Copiar ID" nos menus.', toggle(!!S.prefs.devMode, v => { S.prefs.devMode = v; save(); }))),
    desktop && [section('Aplicativo'), card(dsk)],
    section('Configurações'), card(h('div.btns', exportBtn, importBtn, resetBtn), hint('Suas preferências ficam salvas na conta e acompanham você em outros dispositivos (menos os dispositivos de áudio).')),
    section('Informações'), card(row('Contexto seguro (HTTPS)', 'Necessário para microfone, câmera e tela.', h('b', window.isSecureContext ? 'Sim' : 'Não')), vrow('Servidores ICE', (S.ice || []).map(i => i.urls).join(', ') || '—', null), vrow('Navegador', navigator.userAgent.slice(0, 90), null)));
}
// relatar um problema: explica o que vai junto e abre o formulário
function reportPage() {
  return h('div', h('h2', 'Relatar um problema'),
    card(h('p', { style: { marginTop: 0 } }, 'Algo travou, não apareceu ou ficou estranho? Conte o que aconteceu e o relatório vai com as informações técnicas que ajudam a achar a causa: versões do app e do navegador, placa de vídeo, log do app desktop, estado da call e erros recentes.'),
      hint('Não vai senha, chave nem o conteúdo das suas mensagens. Dá para ver tudo antes de enviar.'),
      h('button.btn.green', { style: { marginTop: '12px' }, onclick: () => openReport() }, 'Relatar um problema')));
}
// versão do app desktop com "Procurar atualização": diz se já está na mais nova ou oferece atualizar
function versionRow(version) {
  const status = h('span', `Resenha Desktop ${version}`);
  let latest = null; // depois de achar a versão nova, o mesmo botão passa a atualizar (um handler só)
  const btn = h('button.btn.grey', { onclick: async () => {
    if (latest) {
      if (silentUpdate()) return void runAppUpdate(latest); // tela "Atualizando" com o progresso, até o app fechar e reabrir
      btn.disabled = true; btn.textContent = 'Baixando…';
      if (!await installAppUpdate()) { btn.disabled = false; btn.textContent = `Atualizar para ${latest}`; toast('Baixando o instalador: quando terminar, abra o Resenha-Setup.'); }
      return;
    }
    btn.disabled = true; btn.textContent = 'Procurando…';
    const r = await checkAppUpdate();
    btn.disabled = false;
    if (!r?.latest) { btn.textContent = 'Procurar atualização'; return toast('Não consegui consultar as atualizações agora. Tente de novo em instantes.', true); }
    if (!r.available) { btn.textContent = 'Procurar atualização'; status.textContent = `Resenha Desktop ${version} — você está na versão mais nova`; return toast('Você já está na versão mais nova'); }
    latest = r.latest;
    status.textContent = `Resenha Desktop ${version} — versão ${latest} disponível`;
    btn.className = 'btn green'; btn.textContent = silentUpdate() ? `Reiniciar e atualizar para ${latest}` : `Atualizar para ${latest}`;
  } }, 'Procurar atualização');
  return vrow('Versão', status, btn);
}
function appPage() {
  const box = h('div.card2', 'Carregando…');
  desktop.getSettings().then((s) => box.replaceChildren(
    row('Iniciar com o Windows', 'Abre a Resenha ao ligar o computador.', toggle(s.autoStart, v => desktop.setSettings({ autoStart: v }))),
    row('Iniciar minimizado', null, toggle(s.startMinimized, v => desktop.setSettings({ startMinimized: v }))),
    row('Fechar para a bandeja', 'Ao fechar a janela o app continua rodando (para ficar em chamada).', toggle(s.closeToTray, v => desktop.setSettings({ closeToTray: v }))),
    row('Atalhos globais', 'Mutar/ensurdecer funcionam com o app em segundo plano (veja Atalhos).', toggle(s.globalHotkeys, v => desktop.setSettings({ globalHotkeys: v }))),
    row('Compatibilidade de vídeo', 'Por padrão o app desenha igual ao navegador. Ligue se as letras ficam borradas ou os vídeos piscam/aparecem escuros só no app (no navegador normais): o vídeo é decodificado pela CPU, em sRGB e sem a sobreposição de vídeo da placa (um pouco mais pesado). Em placas antigas também desenha o texto pela CPU. "Automático" liga sozinho em placas de vídeo antigas.' + (s.gpuName ? ` Placa: ${s.gpuName}.` : '') + ` Agora: ${s.gpuCompatActive ? 'ligada' : 'desligada'}.`,
      h('select.gpucompat', { onchange: async (e) => { await desktop.setSettings({ gpuCompat: e.target.value }); if (await confirmBox('Reiniciar a Resenha?', 'A compatibilidade de vídeo só muda depois de reiniciar o app. Se estiver numa chamada, você sai dela.', 'Reiniciar agora')) desktop.relaunch(); else toast('Vale na próxima vez que abrir o app'); } },
        [['auto', 'Automático'], ['on', 'Ligada'], ['off', 'Desligada']].map(([v, l]) => h('option', { value: v, selected: (s.gpuCompat || 'auto') === v }, l)))),
    vrow('Servidor', s.server, h('button.btn.grey', { onclick: () => desktop.changeServer() }, 'Trocar servidor')),
    versionRow(s.version)));
  return h('div', h('h2', 'Aplicativo (desktop)'), box);
}

// ============================ Servidor ============================
function overviewPage(gid) {
  const g = guild(gid), canEdit = can(gid, PERM.MANAGE_GUILD);
  let icn = g.icon, ban = g.banner, accent = g.accent || '#5865f2';
  const name = h('input', { value: g.name, maxLength: 100, disabled: !canEdit }), desc = h('textarea', { value: g.description || '', rows: 3, maxLength: 300, disabled: !canEdit, placeholder: 'Do que se trata este servidor?' });
  const iconEl = h('div.rail-item', { style: { width: '88px', height: '88px', borderRadius: '50%', fontSize: '30px', cursor: canEdit ? 'pointer' : 'default' } }), bannerEl = h('div.srv-banner');
  const draw = () => { iconEl.replaceChildren(icn ? h('img', { src: icn }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)); bannerEl.style.backgroundImage = ban ? `url("${String(ban).replace(/["\\\n]/g, encodeURIComponent)}")` : ''; bannerEl.style.backgroundColor = accent; };
  iconEl.onclick = async () => { if (!canEdit) return; const u = await uploadImage(); if (u) { icn = u.url; draw(); } };
  draw();
  let members = [...g.members.keys()].filter(id => id !== S.me.id);
  if (g.partial) loadMembers(gid).then(() => { members = [...g.members.keys()].filter(id => id !== S.me.id); }).catch(() => { }); // servidor grande: a lista inteira
  return h('div', h('h2', 'Visão geral do servidor'), h('div.card2', { style: { padding: 0, overflow: 'hidden' } }, bannerEl, h('div', { style: { padding: '0 16px 16px', display: 'flex', gap: '16px', alignItems: 'flex-end', marginTop: '-44px', flexWrap: 'wrap' } }, iconEl,
    canEdit && h('div.btns', h('button.btn', { onclick: async () => { const u = await uploadImage(); if (u) { ban = u.url; draw(); } } }, 'Banner'), h('button.btn.grey', { onclick: () => { ban = null; draw(); } }, 'Remover banner'), h('button.btn.grey', { onclick: () => { icn = null; draw(); } }, 'Remover ícone')))),
  card(h('label.f', 'Nome do servidor', name), h('label.f', 'Descrição', desc), h('label.f', 'Cor de destaque'), swatches(accent, (c) => { accent = c; draw(); })),
  canEdit && h('button.btn', { onclick: async () => { if (await tryApi('PATCH', `/guilds/${gid}`, { name: name.value, icon: icn || '', banner: ban || '', description: desc.value, accent })) toast('Servidor salvo!'); } }, 'Salvar alterações'),
  g.owner_id === S.me.id && [section('Zona de perigo'), card(
    row('Transferir propriedade', 'Escolha outro membro como dono.', h('button.btn.grey', { onclick: async () => { if (!members.length) return toast('Não há outros membros', true); const sel = h('select', ...members.map(id => h('option', { value: id }, nameOf(id, gid)))); modal('Transferir propriedade', 'O novo dono terá controle total.', h('label.f', 'Novo dono', sel), [{ label: 'Cancelar', cls: 'link' }, { label: 'Transferir', cls: 'red', fn: async () => { if (!(await tryApi('PATCH', `/guilds/${gid}`, { owner_id: sel.value }))) return false; toast('Propriedade transferida'); } }]); } }, 'Transferir')),
    row('Excluir servidor', 'Apaga canais e mensagens para sempre.', h('button.btn.red', { onclick: async () => { if (await confirmBox(`Excluir ${g.name}`, 'Permanente: apaga canais e mensagens.', 'Excluir servidor')) { await tryApi('DELETE', `/guilds/${gid}`); document.getElementById('settings')?.remove(); } } }, 'Excluir')))]);
}
function channelsPage(gid) {
  const g = guild(gid), box = h('div'), canEdit = can(gid, PERM.MANAGE_CHANNELS);
  const draw = () => {
    const cats = g.channels.filter(c => c.type === 4), kids = (pid) => g.channels.filter(c => c.type !== 4 && (c.parent_id || null) === pid);
    const move = async (c, siblings, dir) => { const i = siblings.indexOf(c), j = i + dir; if (j < 0 || j >= siblings.length) return; const o = siblings[j]; const [a, b] = [c.position, o.position]; await tryApi('PATCH', `/channels/${c.id}`, { position: b === a ? b + dir : b }); await tryApi('PATCH', `/channels/${o.id}`, { position: a }); setTimeout(draw, 250); };
    const line = (c, siblings) => h('div.chrow', h('span.ico', icon(c.type === 2 ? 'voice' : c.type === 4 ? 'caret' : 'hash', 16)), h('span.cn', c.name),
      canEdit && h('div.btns', h('button.ibtn', { title: 'Subir', onclick: () => move(c, siblings, -1) }, '▲'), h('button.ibtn', { title: 'Descer', onclick: () => move(c, siblings, 1) }, '▼'),
        h('button.btn.grey', { onclick: async () => { const n = await promptBox('Renomear canal', 'Nome', c.name); if (n) { await tryApi('PATCH', `/channels/${c.id}`, { name: n }); setTimeout(draw, 250); } } }, 'Renomear'),
        h('button.btn.red', { onclick: async () => { if (await confirmBox('Excluir canal', `Excluir ${c.name}?`, 'Excluir')) { await tryApi('DELETE', `/channels/${c.id}`); setTimeout(draw, 250); } } }, 'Excluir')));
    box.replaceChildren(...kids(null).map(c => line(c, kids(null))), ...cats.flatMap(cat => [line(cat, cats), h('div.chkids', ...kids(cat.id).map(c => line(c, kids(cat.id))))]));
  };
  draw();
  const create = (type) => async () => { const n = await promptBox(type === 4 ? 'Nova categoria' : type === 2 ? 'Novo canal de voz' : 'Novo canal de texto', 'Nome', '', 'Criar'); if (n) { await tryApi('POST', `/guilds/${gid}/channels`, { name: n, type }); setTimeout(draw, 300); } };
  return h('div', h('h2', 'Canais'), canEdit && h('div.btns', { style: { marginBottom: '16px' } }, h('button.btn', { onclick: create(0) }, '+ Texto'), h('button.btn', { onclick: create(2) }, '+ Voz'), h('button.btn.grey', { onclick: create(4) }, '+ Categoria')), card(box));
}
function emojisPage(gid) {
  const g = guild(gid), canEdit = can(gid, PERM.MANAGE_GUILD), box = h('div.emoji-list');
  const draw = () => { box.replaceChildren(...(g.emojis || []).map(e => h('div.emoji-item', h('img', { src: e.url }), h('span', ':' + e.name + ':'), canEdit && h('button.ibtn', { title: 'Excluir', onclick: async () => { await tryApi('DELETE', `/emojis/${e.id}`); setTimeout(draw, 250); } }, icon('trash', 16))))); if (!g.emojis?.length) box.append(hint('Nenhum emoji personalizado ainda.')); };
  draw();
  return h('div', h('h2', 'Emojis'), canEdit && card(hint('Envie imagens quadradas (PNG/GIF). Use no chat digitando :nome: ou pelo seletor de emojis.'), h('button.btn', { onclick: async () => {
    const u = await uploadImage(); if (!u) return;
    const nm = await promptBox('Nome do emoji', 'Nome (letras, números e _)', u.name.replace(/\.[^.]+$/, '').replace(/\W/g, '_').slice(0, 32), 'Adicionar'); if (!nm) return;
    if (await tryApi('POST', `/guilds/${gid}/emojis`, { name: nm, url: u.url })) setTimeout(draw, 300);
  } }, 'Enviar emoji')), box);
}
function serverSoundsPage(gid) {
  const g = guild(gid), canEdit = can(gid, PERM.MANAGE_GUILD), box = h('div');
  const draw = () => {
    const src = { key: gid, title: g.name, guild: g, sounds: g.sounds || [] };
    box.replaceChildren(...(src.sounds.length ? src.sounds.map(s => h('div.srow2', h('span.e', soundEmoji(s.emoji)), h('span.n', s.name), h('small.mut', soundVol(s) + '%'), h('button.btn.grey', { onclick: () => playLocal(s.url, soundVol(s)) }, '▶'), canEdit && h('button.btn.grey', { onclick: () => editSound(src, s) }, 'Editar'))) : [hint('Nenhum som neste servidor ainda.')]));
  };
  const onChange = () => draw(); document.addEventListener('sb-changed', onChange); draw(); queueMicrotask(() => whenGone(box, () => document.removeEventListener('sb-changed', onChange)));
  return h('div', h('h2', 'Soundboard do servidor'), canEdit && card(hint('Sons curtos (até 15 s, 2 MB) que qualquer membro pode tocar na sala de voz, até 48 por servidor.'), h('button.btn', { onclick: () => addSound(gid) }, '+ Adicionar som')), card(box));
}
function invitesPage(gid) {
  const box = h('div'), draw = async () => {
    const list = await tryApi('GET', `/guilds/${gid}/invites`) || [];
    box.replaceChildren(...list.map(i => h('div.frow', { style: { cursor: 'default' } }, h('div.fn', h('b', `${location.origin}/invite/${i.code}`), h('small', `${i.uses} uso(s) • por ${nameOf(i.creator_id, gid)}`)),
      h('button.btn.grey', { onclick: () => { navigator.clipboard?.writeText(`${location.origin}/invite/${i.code}`); toast('Copiado!'); } }, 'Copiar'), h('button.btn.red', { onclick: async () => { await tryApi('DELETE', `/invites/${i.code}`); draw(); } }, 'Revogar'))));
    if (!list.length) box.append(note('Nenhum convite ativo.'));
  };
  draw();
  return h('div', h('h2', 'Convites'), h('button.btn', { style: { marginBottom: '16px' }, onclick: async () => { await tryApi('POST', `/guilds/${gid}/invites`); draw(); } }, 'Criar convite'), box);
}
function rolesPage(gid) {
  const g = guild(gid), box = h('div'), editor = h('div');
  const draw = () => {
    box.replaceChildren(...g.roles.map(r => h('div.role-row', { onclick: () => edit(r) }, h('i.dot', { style: { background: r.color } }), h('span', { style: { flex: 1 } }, r.name), h('small', { style: { color: 'var(--text-muted)' } }, `${[...g.members.values()].filter(m => m.roles.includes(r.id)).length} membros`))));
    if (!g.roles.length) box.append(note('Nenhum cargo ainda.'));
  };
  const edit = (r) => {
    let color = r.color, perms = r.perms; const name = h('input', { value: r.name, maxLength: 50 });
    editor.replaceChildren(card(h('h3', { style: { marginTop: 0, color: 'var(--header)' } }, 'Editar cargo'), h('label.f', 'Nome do cargo', name), h('label.f', 'Cor'), swatches(color, c => (color = c)),
      h('div', { style: { marginTop: '16px' } }, PERM_LABELS.map(([bit, label, desc]) => row(label, desc, toggle(perms & bit, on => { perms = on ? perms | bit : perms & ~bit; })))),
      h('div.btns', { style: { marginTop: '16px' } }, h('button.btn', { onclick: async () => { await tryApi('PATCH', `/roles/${r.id}`, { name: name.value, color, perms }); toast('Cargo salvo!'); setTimeout(draw, 200); } }, 'Salvar'),
        h('button.btn.red', { onclick: async () => { if (await confirmBox('Excluir cargo', `Excluir ${r.name}?`, 'Excluir')) { await tryApi('DELETE', `/roles/${r.id}`); editor.replaceChildren(); setTimeout(draw, 200); } } }, 'Excluir'))));
  };
  draw();
  return h('div', h('h2', 'Cargos'), can(gid, PERM.MANAGE_ROLES) && h('button.btn', { style: { marginBottom: '16px' }, onclick: async () => { await tryApi('POST', `/guilds/${gid}/roles`, { name: 'novo cargo' }); setTimeout(draw, 250); } }, 'Criar cargo'), box, editor);
}
function membersPage(gid) {
  const g = guild(gid), box = h('div'), q = h('input.fsearch', { placeholder: 'Buscar membro', oninput: debounce(() => draw(), 120) });
  const draw = () => {
    box.replaceChildren(...[...g.members.values()].filter(m => nameOf(m.user_id, gid).toLowerCase().includes(q.value.toLowerCase())).map(m => {
      const u = user(m.user_id);
      return h('div.frow', { style: { cursor: 'default' } }, avatar(u, 36, { ring: 'var(--bg-pri)' }), h('div.fn', h('b', nameOf(m.user_id, gid)), h('small', '@' + u.username + (g.owner_id === u.id ? ' • Dono' : '') + (timedOutUntil(gid, u.id) ? ' • de castigo até ' + new Date(timedOutUntil(gid, u.id)).toLocaleString('pt-BR') : ''))),
        can(gid, PERM.MANAGE_ROLES) && g.roles.length > 0 && h('button.btn.grey', { onclick: () => rolePicker(g, m) }, 'Cargos'),
        can(gid, PERM.MODERATE) && u.id !== g.owner_id && u.id !== S.me.id && h('button.btn.grey', { onclick: () => (timedOutUntil(gid, u.id) ? removeTimeout(gid, u.id) : timeoutDialog(gid, u.id)) }, timedOutUntil(gid, u.id) ? 'Tirar castigo' : 'Castigo'),
        can(gid, PERM.BAN) && u.id !== g.owner_id && u.id !== S.me.id && h('button.btn.red', { onclick: () => banDialog(gid, u.id, () => setTimeout(draw, 300)) }, 'Banir'),
        can(gid, PERM.KICK) && u.id !== g.owner_id && u.id !== S.me.id && h('button.btn.red', { onclick: async () => { if (await confirmBox('Expulsar', `Expulsar ${u.display_name}?`, 'Expulsar')) { await tryApi('DELETE', `/guilds/${gid}/members/${u.id}`); setTimeout(draw, 300); } } }, 'Expulsar'));
    }));
  };
  const title = h('h2', `Membros — ${g.member_count || g.members.size}`);
  if (g.partial) { box.append(h('div.qinfo', 'Carregando a lista de membros…')); loadMembers(gid).then(() => { if (!box.isConnected) return; title.textContent = `Membros — ${g.members.size}`; draw(); }).catch(() => { }); }
  else draw();
  return h('div', title, q, box);
}
function rolePicker(g, m) {
  const sel = new Set(m.roles);
  modal(`Cargos de ${nameOf(m.user_id, g.id)}`, '', h('div', g.roles.map(r => row(r.name, null, toggle(sel.has(r.id), on => (on ? sel.add(r.id) : sel.delete(r.id)))))),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: () => tryApi('PATCH', `/guilds/${g.id}/members/${m.user_id}`, { roles: [...sel] }) }]);
}
void channelById;
