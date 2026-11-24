// Central de boas-vindas do servidor (server/onboarding.js): a tela que o membro vê ao entrar (apresentação, regras para
// aceitar, perguntas de interesse que dão cargos e canais recomendados), a linha "Boas-vindas" no topo da lista de
// canais, o aviso no campo de mensagem enquanto as regras obrigatórias não foram aceitas e o editor nas configurações
// do servidor (Gerenciar servidor).
// Abre sozinha uma vez por sessão ao entrar num servidor em que a pessoa ainda não concluiu (onbAutoOpen, chamado pela
// navegação). O estado de cada servidor fica em ST (carregado sob demanda; a versão v diz quando recarregar).
import { h, icon, imgUrl } from './util.js';
import { S, api, tryApi, toast, can, PERM, guild, user, channelById, chVisible, roleBelow } from './state.js';
import { chName } from './chnames.js';
import { go } from './nav.js';
import { toggle, row, section } from './ui.js';
import { chIcon } from './side.js';

const ST = new Map(); // gid -> { config, v, me, can_edit }
const loading = new Map(), autoShown = new Set();
// permissões que um cargo dado pela resposta não pode ter (o servidor recusa; aqui só some da lista)
const DANGER = PERM.ADMIN | PERM.MANAGE_GUILD | PERM.MANAGE_CHANNELS | PERM.MANAGE_MESSAGES | PERM.KICK | PERM.MANAGE_ROLES | PERM.BAN | PERM.MODERATE | PERM.VOICE_MOD | PERM.VIEW_MSGLOG;
const fresh = (gid) => { const st = ST.get(gid), v = guild(gid)?.onboarding?.v || 0; return st && st.v === v ? st : null; };
export function loadOnb(gid, force = false) {
  if (!force && fresh(gid)) return Promise.resolve(ST.get(gid));
  if (loading.has(gid)) return loading.get(gid);
  const p = tryApi('GET', `/guilds/${gid}/onboarding`).then(r => { loading.delete(gid); if (r) ST.set(gid, r); return r; });
  loading.set(gid, p); return p;
}
const exempt = (gid) => guild(gid)?.owner_id === S.me?.id || can(gid, PERM.MANAGE_GUILD);
// central ligada e a pessoa ainda não concluiu (ponto na linha "Boas-vindas")
export const onbPending = (gid) => { const st = fresh(gid); return !!guild(gid)?.onboarding?.enabled && !!st && !st.me?.done_at; };
// regras obrigatórias ainda não aceitas: o campo de mensagem vira um aviso (o servidor recusa o envio de qualquer jeito)
export function needsRules(gid) {
  const o = guild(gid)?.onboarding; if (!gid || !o?.require_rules || exempt(gid)) return false;
  const st = fresh(gid);
  if (!st) { loadOnb(gid).then(r => { if (r && !r.me?.rules_at && S.view.gid === gid) document.getElementById('composer-wrap')?.replaceWith(rulesLock(gid)); }); return false; }
  return !st.me?.rules_at;
}
export const rulesLock = (gid) => h('div#composer-wrap', h('div.composer-locked.onb-lock', { role: 'status' }, icon('shield', 18),
  h('span', 'Aceite as regras do servidor para conversar.'), h('button.btn.sm', { type: 'button', onclick: () => go(gid, 'welcome') }, 'Ver as regras')));
// navegação entrou num servidor: na primeira vez da sessão, se a pessoa não concluiu, abre a central
export function onbAutoOpen(gid) {
  if (!guild(gid)?.onboarding?.enabled || autoShown.has(gid)) return;
  autoShown.add(gid);
  loadOnb(gid).then(r => { if (r && !r.me?.done_at && S.view.gid === gid && S.view.kind === 'guild') go(gid, 'welcome'); });
}
// GUILD_ONBOARDING_UPDATE: a configuração mudou (o resumo vem no evento; o resto recarrega quando precisar)
export function onbUpdated(d) {
  const g = guild(d.guild_id); if (!g) return;
  g.onboarding = d.onboarding || null; ST.delete(d.guild_id);
  return S.view.gid === d.guild_id;
}
// linha fixa no topo da lista de canais
export function onbRow(g) {
  if (!g.onboarding?.enabled) return null;
  if (!fresh(g.id)) loadOnb(g.id).then(() => { const el = document.querySelector('#side-list .onb-row'); if (el && onbPending(g.id)) el.classList.add('pending'); });
  return h('div.ch.onb-row' + (S.view.kind === 'welcome' && S.view.gid === g.id ? '.active' : '') + (onbPending(g.id) ? '.pending' : ''),
    { role: 'button', tabIndex: 0, title: 'Apresentação, regras e canais para você', onclick: () => go(g.id, 'welcome'), onkeydown: (e) => { if (e.key === 'Enter') go(g.id, 'welcome'); } },
    icon('sparkle', 20), h('span.name', 'Boas-vindas'), h('i.onb-dot', { 'aria-label': 'Falta concluir' }));
}

// ---------------------------------------------------------------- a tela
export function renderWelcome(main, gid) {
  const g = guild(gid), root = h('div#onbview');
  main.replaceChildren(root);
  const top = h('div#topbar', h('span.hash', icon('sparkle', 24)), h('span', 'Boas-vindas'), h('span.topic', g?.name || ''));
  let st = fresh(gid), picks = null, accepted = false, busy = false, done = null;
  const draw = () => {
    if (!root.isConnected) return;
    if (!st) { root.replaceChildren(top, h('div.cbody', h('div.onb', h('p.onb-muted', 'Carregando…')))); return; }
    const c = st.config, me = st.me || {};
    if (!c.enabled) { root.replaceChildren(top, h('div.cbody', h('div.onb', h('div.onb-empty', icon('sparkle', 36), h('b', 'Este servidor não tem central de boas-vindas'),
      st.can_edit && h('button.btn', { onclick: () => editHere(gid) }, 'Configurar'))))); return; }
    picks ||= Object.fromEntries(c.questions.map(q => [q.id, new Set(me.answers?.[q.id] || [])]));
    const rulesOk = !!me.rules_at || accepted, needRules = c.require_rules && c.rules.length > 0;
    const vis = (id) => { const ch = channelById(id); return ch && ch.guild_id === gid && chVisible(ch) ? ch : null; };
    // canais: os recomendados para todos + os das opções escolhidas (sem repetir)
    const recIds = [...new Set([...c.channels, ...c.questions.flatMap(q => q.options.filter(o => picks[q.id]?.has(o.id)).flatMap(o => o.channels))])];
    const recs = recIds.map(vis).filter(Boolean);
    const members = g.members?.size || 0, online = g.members ? [...g.members.keys()].filter(u => { const s = user(u)?.status; return s && s !== 'offline' && s !== 'invisible'; }).length : 0;
    const hero = h('header.onb-hero' + (g.banner ? '.has-banner' : ''), g.banner && { style: { backgroundImage: `url("${String(imgUrl(g.banner, 960)).replace(/["\\\n]/g, encodeURIComponent)}")` } },
      h('div.onb-hero-in',
        h('div.onb-gicon', g.icon ? h('img', { src: imgUrl(g.icon, 96), alt: '' }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)),
        h('div.onb-hero-t', h('small', 'Boas-vindas a'), h('h1', g.name),
          h('p.onb-stats', h('span', h('i.onb-on'), `${online} online`), h('span', `${members} ${members === 1 ? 'membro' : 'membros'}`)))));
    const steps = [];
    if (c.intro) steps.push(h('section.onb-sec', h('p.onb-intro', c.intro)));
    if (c.rules.length) steps.push(h('section.onb-sec',
      h('div.onb-sech', h('h2', 'Regras'), needRules && h('span.onb-tag', 'Obrigatório')),
      h('ol.onb-rules', c.rules.map((r, i) => h('li.onb-rule', h('span.onb-n', String(i + 1)), h('span', r)))),
      h('label.onb-accept' + (rulesOk ? '.on' : ''), h('input', { type: 'checkbox', checked: rulesOk, disabled: !!me.rules_at, onchange: (e) => { accepted = e.target.checked; draw(); } }),
        h('span', me.rules_at ? `Você aceitou as regras em ${new Date(me.rules_at).toLocaleDateString('pt-BR')}` : 'Li e aceito as regras'))));
    for (const q of c.questions) steps.push(h('section.onb-sec',
      h('div.onb-sech', h('h2', q.title), h('small', q.multi ? 'Escolha quantas quiser' : 'Escolha uma')),
      h('div.onb-opts', { role: q.multi ? 'group' : 'radiogroup', 'aria-label': q.title }, q.options.map(o => {
        const on = picks[q.id].has(o.id);
        return h('button.onb-opt' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), onclick: () => { const s = picks[q.id]; if (on) s.delete(o.id); else { if (!q.multi) s.clear(); s.add(o.id); } draw(); } },
          o.emoji && h('span.onb-emo', o.emoji), h('span.onb-ot', h('b', o.label), o.desc && h('small', o.desc)), h('span.onb-check', icon('check', 14)));
      }))));
    if (recs.length) steps.push(h('section.onb-sec',
      h('div.onb-sech', h('h2', 'Canais para você'), h('small', c.questions.length ? 'Mudam com o que você escolher' : '')),
      h('div.onb-chans', recs.map(ch => h('button.onb-ch', { type: 'button', onclick: () => go(gid, ch.id) }, chIcon(ch, 18), h('span.onb-cht', h('b', chName(ch)), ch.topic && h('small', ch.topic)), icon('chevr', 16))))));
    const finish = async () => {
      if (busy) return; busy = true; draw();
      const answers = Object.fromEntries(Object.entries(picks).map(([k, s]) => [k, [...s]]));
      const r = await tryApi('POST', `/guilds/${gid}/onboarding/complete`, { rules: rulesOk, answers });
      busy = false;
      if (r) { st = { ...st, me: r.me }; ST.set(gid, st); done = r; document.querySelector('#side-list .onb-row')?.classList.remove('pending'); }
      draw(); root.querySelector('.cbody')?.scrollTo({ top: 0 });
    };
    const foot = h('div.onb-foot',
      h('span.onb-foot-t', needRules && !rulesOk ? 'Aceite as regras para concluir' : me.done_at ? 'Mudou de ideia? Salve as novas escolhas.' : 'Tudo certo? É só concluir.'),
      !me.done_at && !needRules && h('button.btn.link', { type: 'button', onclick: () => go(gid) }, 'Agora não'),
      h('button.btn.onb-finish', { type: 'button', disabled: busy || (needRules && !rulesOk), onclick: finish }, busy ? 'Salvando…' : me.done_at ? 'Salvar escolhas' : 'Concluir'));
    const adminBar = st.can_edit && h('div.onb-admin', icon('eye', 16), h('span', 'Você está vendo como um membro novo vê.'), h('button.btn.sm.grey', { type: 'button', onclick: () => editHere(gid) }, 'Editar'));
    const doneCard = done && (() => {
      const roles = (done.added || []).map(id => g.roles.find(r => r.id === id)).filter(Boolean);
      return h('div.onb-done', h('div.onb-done-ic', icon('check', 28)), h('div', h('b', 'Tudo pronto!'),
        h('p', roles.length ? 'Você ganhou: ' : 'Suas escolhas foram salvas.', roles.map(r => h('span.onb-role', h('i', { style: { background: r.color || 'var(--text-muted)' } }), r.name))),
        h('div.onb-done-acts', recs[0] && h('button.btn', { type: 'button', onclick: () => go(gid, recs[0].id) }, `Ir para ${chName(recs[0])}`), h('button.btn.grey', { type: 'button', onclick: () => go(gid) }, 'Ver o servidor'))));
    })();
    // redesenhar não pode levar a página para o topo (marcar o aceite das regras ou uma opção pulava a tela)
    const keep = root.querySelector('.cbody')?.scrollTop || 0;
    root.replaceChildren(top, h('div.cbody', h('div.onb', adminBar, hero, doneCard, ...steps, foot)));
    if (keep) root.querySelector('.cbody').scrollTop = keep;
  };
  draw();
  if (!st) loadOnb(gid, true).then(r => { st = r; draw(); });
}
const editHere = (gid) => import('./nav.js').then(m => m.openSettings('server', { gid, page: 'onboarding', go }));

// ---------------------------------------------------------------- editor (configurações do servidor)
export function onboardingPage(gid) {
  const g = guild(gid), box = h('div.onbcfg', h('h2', 'Boas-vindas'), h('p.onb-muted', 'Carregando…'));
  let c = null, dirty = false;
  const set = (fn) => { fn(); dirty = true; draw(); };
  const rid = () => Math.random().toString(36).slice(2, 10);
  // cargos que podem ser dados pelas respostas: abaixo do seu mais alto e sem moderação/administração
  const roleOk = (r) => roleBelow(gid, r) && !((r.perms | 0) & DANGER);
  const chans = () => g.channels.filter(ch => ch.type !== 4 && ch.type !== 11);
  const chips = (all, sel, label, onFlip) => h('div.onbcfg-chips', all.length ? all.map(x => h('button.onbcfg-chip' + (sel.includes(x.id) ? '.on' : ''), { type: 'button', 'aria-pressed': String(sel.includes(x.id)), onclick: () => onFlip(x.id) }, label(x))) : h('small.onb-muted', 'Nenhum disponível'));
  const flip = (arr, id) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); };
  const input = (val, ph, on, max, cls = '') => h('input' + cls, { value: val || '', placeholder: ph, maxLength: max, oninput: (e) => { on(e.target.value); dirty = true; saveBtn.disabled = false; } });
  const saveBtn = h('button.btn', { type: 'button', onclick: async () => {
    saveBtn.disabled = true;
    const r = await tryApi('PUT', `/guilds/${gid}/onboarding`, c);
    if (r) { c = structuredClone(r.config); dirty = false; ST.delete(gid); toast('Boas-vindas salva'); draw(); } else saveBtn.disabled = false;
  } }, 'Salvar');
  const draw = () => {
    if (!box.isConnected && c) return;
    saveBtn.disabled = !dirty;
    const qCard = (q, qi) => h('div.onbcfg-q',
      h('div.onbcfg-qh', input(q.title, 'Pergunta (ex.: Do que você curte jogar?)', v => { q.title = v; }, 100, '.onbcfg-qt'),
        h('div.seg', h('button' + (!q.multi ? '.on' : ''), { type: 'button', onclick: () => set(() => { q.multi = false; }) }, 'Uma'), h('button' + (q.multi ? '.on' : ''), { type: 'button', onclick: () => set(() => { q.multi = true; }) }, 'Várias')),
        h('button.ibtn', { type: 'button', title: 'Apagar pergunta', 'aria-label': 'Apagar pergunta', onclick: () => set(() => c.questions.splice(qi, 1)) }, icon('trash', 18))),
      ...q.options.map((o, oi) => h('div.onbcfg-o',
        h('div.onbcfg-orow', input(o.emoji, '🙂', v => { o.emoji = v; }, 16, '.onbcfg-emo'), input(o.label, 'Opção (ex.: Tiro)', v => { o.label = v; }, 60), input(o.desc, 'Descrição (opcional)', v => { o.desc = v; }, 100),
          h('button.ibtn', { type: 'button', title: 'Apagar opção', 'aria-label': 'Apagar opção', onclick: () => set(() => q.options.splice(oi, 1)) }, icon('x', 16))),
        h('div.onbcfg-sub', h('small', 'Dá os cargos'), chips(g.roles.filter(roleOk).sort((a, b) => b.position - a.position), o.roles, r => [h('i', { style: { background: r.color || 'var(--text-muted)' } }), r.name], id => set(() => flip(o.roles, id)))),
        h('div.onbcfg-sub', h('small', 'Recomenda os canais'), chips(chans(), o.channels, ch => [chIcon(ch, 14), chName(ch)], id => set(() => flip(o.channels, id)))))),
      q.options.length < 12 && h('button.btn.link.sm', { type: 'button', onclick: () => set(() => q.options.push({ id: rid(), label: '', emoji: '', desc: '', roles: [], channels: [] })) }, icon('plus', 14), 'Opção'));
    box.replaceChildren(h('h2', 'Boas-vindas'),
      h('p.onb-muted', 'O que um membro novo vê ao entrar: apresentação, regras, perguntas que dão cargos e canais recomendados. Abre sozinha na primeira visita e fica no topo da lista de canais.'),
      h('div.card2', row('Ligar a central de boas-vindas', 'Desligada, ninguém vê a central e as regras não são exigidas.', toggle(c.enabled, v => set(() => { c.enabled = v; })))),
      section('Apresentação'),
      h('textarea.onbcfg-intro', { value: c.intro, maxLength: 1000, rows: 4, placeholder: 'Conte do que é o servidor, quando o pessoal joga, o que esperar…', oninput: (e) => { c.intro = e.target.value; dirty = true; saveBtn.disabled = false; } }),
      section('Regras'),
      h('div.onbcfg-rules', c.rules.map((r, i) => h('div.onbcfg-rule', h('span.onb-n', String(i + 1)), input(r, 'Regra', v => { c.rules[i] = v; }, 300),
        h('button.ibtn', { type: 'button', title: 'Apagar regra', 'aria-label': 'Apagar regra', onclick: () => set(() => c.rules.splice(i, 1)) }, icon('x', 16))))),
      c.rules.length < 20 && h('button.btn.link.sm', { type: 'button', onclick: () => set(() => c.rules.push('')) }, icon('plus', 14), 'Regra'),
      h('div.card2', row('Exigir aceite das regras para conversar', 'Até aceitar, a pessoa lê o servidor mas não manda mensagem. Quem gerencia o servidor não passa por isso.', toggle(c.require_rules, v => set(() => { c.require_rules = v; })))),
      section('Perguntas de interesse'),
      h('p.onb-muted', 'Cada opção pode dar cargos (só os abaixo do seu e sem permissões de moderação) e recomendar canais.'),
      ...c.questions.map(qCard),
      c.questions.length < 6 && h('button.btn.grey.sm', { type: 'button', onclick: () => set(() => c.questions.push({ id: rid(), title: '', multi: true, options: [{ id: rid(), label: '', emoji: '', desc: '', roles: [], channels: [] }] })) }, icon('plus', 14), 'Pergunta'),
      section('Canais recomendados para todos'),
      chips(chans(), c.channels, ch => [chIcon(ch, 14), chName(ch)], id => set(() => flip(c.channels, id))),
      h('div.onbcfg-foot', h('button.btn.grey', { type: 'button', onclick: () => { document.getElementById('settings')?._close?.(); go(gid, 'welcome'); } }, icon('eye', 16), 'Ver como membro'), saveBtn));
  };
  api('GET', `/guilds/${gid}/onboarding`).then(r => { c = structuredClone(r.config); draw(); }).catch(e => box.replaceChildren(h('h2', 'Boas-vindas'), h('p.onb-muted', e.message)));
  return box;
}
