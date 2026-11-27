// Mesa de RPG da chamada (atividade do foguete; servidor: server/rpg.js).
// Um quadro no palco da chamada, como a lousa e o editor de código: abas Mesa (jogadores, fichas e inimigos em cena),
// Combate (iniciativa e turnos), Mestre (inimigos, regras da mesa) e Histórico; ao lado, o rolador de dados e as
// últimas rolagens. O servidor rola os dados e manda a cada um a sua visão (RPG_STATE); aqui só se desenha e se pede.
// O quadro é o mesmo elemento entre redesenhos da sala (o campo da rolagem não perde o foco nem o texto).
import { h, icon, avatar } from './util.js';
import { S, toast, modal, nameOf, channelById, user } from './state.js';
import { uploadFile } from './upload.js';
import { voice } from './gateway.js';

let T = null, node = null, tab = 'mesa', seen = null, adv = null, secret = false, lastExpr = '';
let exprIn = null, bodyEl = null, sideLog = null, barInfo = null, tabsEl = null, asSel = null, resultEl = null, secretBtn = null, advBtns = null;
const send = (d) => voice?.send('RPG', d);
const gid = () => channelById(voice?.channelId)?.guild_id;
const who = (uid) => nameOf(uid, gid());
const callIds = () => [...S.voice.values()].filter(v => v.channel_id === voice?.channelId && !v.bot).map(v => v.user_id);
const me = () => S.me?.id;
const isGM = () => !!T?.me_gm;
const canChar = (ch) => isGM() || ch.owner === me();
const charOf = (id) => T?.chars.find(c => c.id === id);
const foeOf = (id) => T?.foes.find(f => f.id === id);
const myChars = () => (T?.chars || []).filter(c => c.owner === me());
const pct = (cur, max) => Math.max(0, Math.min(100, max > 0 ? cur / max * 100 : 0));

// ---------- estado vindo do servidor ----------
export function rpgSet(d) {
  if (d.channel_id !== voice?.channelId) return;
  const prev = seen; T = d; seen = d.log.at(-1)?.id || null;
  // rolagens novas: a última aparece em destaque no rolador (a de qualquer um da mesa)
  if (prev !== seen) { const i = prev ? d.log.findIndex(e => e.id === prev) : -1, fresh = d.log.slice(i + 1).filter(e => e.kind === 'roll'); if (fresh.length) showResult(fresh.at(-1)); }
  render();
}
export const rpgReset = () => { T = null; node = null; seen = null; };
export const rpgError = (d) => toast(d.error || 'Não deu certo', true);

// ---------- rolagem ----------
function doRoll(expr, label) {
  expr = String(expr || '').trim(); if (!expr) return toast('Escolha os dados ou digite uma rolagem, como 1d20+3', true);
  lastExpr = expr; send({ op: 'roll', expr, label: label || '', adv, secret: secret && isGM() });
  if (adv) { adv = null; syncToggles(); } // vantagem/desvantagem valem para uma rolagem
}
const attrRoll = (ch, k) => { const v = ch.attrs[k] ?? 0; doRoll(String(T.attrRoll || '1d20+{v}').replace(/\{v\}/g, String(v)).replace(/\+-/g, '-'), `${k} · ${ch.name}`); };
function addDie(f) { // clicar no mesmo dado soma mais um; outro dado entra na expressão
  const v = exprIn.value.trim(), re = new RegExp(`(^|[+-])(\\d*)d${f}(?![\\d%])`, 'i'), m = re.exec(v);
  if (exprIn.dataset.fresh === '1' || !v) exprIn.value = `1d${f}`;
  else if (m) exprIn.value = v.replace(re, (all, s, n) => `${s}${(+n || 1) + 1}d${f}`);
  else exprIn.value = `${v}+1d${f}`;
  exprIn.dataset.fresh = '';
}
function addMod(n) {
  const v = exprIn.value.trim() || '1d20', m = /([+-])(\d+)$/.exec(v);
  let k = m ? (m[1] === '-' ? -m[2] : +m[2]) : 0; k += n;
  const base = m ? v.slice(0, m.index) : v; exprIn.value = base + (k ? (k > 0 ? '+' : '-') + Math.abs(k) : ''); exprIn.dataset.fresh = '';
}
const syncToggles = () => { if (!advBtns) return; advBtns.adv.classList.toggle('on', adv === 'adv'); advBtns.dis.classList.toggle('on', adv === 'dis'); secretBtn.classList.toggle('on', secret); secretBtn.hidden = !isGM(); };

// dados da rolagem como fichas: os descartados apagados, os rerrolados com o valor antigo riscado
function diceChips(r) {
  return h('span.rpg-dice', r.parts.map((p, i) => [i ? h('span.rpg-op', p.sign < 0 ? '−' : '+') : (p.sign < 0 ? h('span.rpg-op', '−') : null),
    p.rolls ? h('span.rpg-grp', { title: p.t }, p.rolls.map(x => h('span.rpg-die' + (x.drop ? '.drop' : '') + (x.v === p.faces ? '.max' : x.v === 1 ? '.min' : '') + (x.ex ? '.ex' : ''),
      { title: x.was != null ? `Rerrolado (era ${x.was})` : x.ex ? 'Explodiu' : x.drop ? 'Descartado' : `d${p.faces}` }, x.was != null && h('s', String(x.was)), String(x.v)))) : h('span.rpg-mod', p.t.startsWith('@') ? `${p.t.slice(1)} ${p.v}` : String(p.v))]));
}
function showResult(e) {
  if (!resultEl) return;
  const r = e.roll, ch = e.char && charOf(e.char);
  resultEl.replaceChildren(h('div.rpg-res' + (r.crit ? '.crit' : r.fumble ? '.fumble' : '') + (e.gm ? '.secret' : ''),
    h('div.rpg-res-who', ch ? ch.name : who(e.uid), e.label && e.label !== r.expr ? ' · ' + e.label : '', e.gm && ' · secreta'),
    h('div.rpg-res-total', String(r.total)),
    h('div.rpg-res-tag', r.crit ? 'Crítico!' : r.fumble ? 'Falha crítica' : r.expr + (r.adv === 'adv' ? ' · vantagem' : r.adv === 'dis' ? ' · desvantagem' : '')),
    diceChips(r)));
}

// ---------- histórico ----------
function logItem(e) {
  const when = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (e.kind === 'roll') {
    const r = e.roll, ch = e.char && charOf(e.char);
    return h('li.rpg-li.roll' + (r.crit ? '.crit' : r.fumble ? '.fumble' : '') + (e.gm ? '.secret' : ''),
      h('div.rpg-li-top', h('b', ch ? ch.name : who(e.uid)), h('span.rpg-li-lab', e.label || r.expr), e.gm && h('span.rpg-pill', 'secreta'), h('time', when)),
      h('div.rpg-li-roll', diceChips(r), h('span.rpg-eq', '='), h('b.rpg-total', String(r.total)), r.crit && h('span.rpg-pill.crit', 'crítico'), r.fumble && h('span.rpg-pill.fumble', 'falha crítica')));
  }
  const txt = e.kind === 'info' ? `${who(e.uid)} ${e.text}` : e.text;
  return h('li.rpg-li.' + e.kind + (e.gm ? '.secret' : ''), h('span.rpg-li-ico', icon(e.kind === 'hp' ? 'heart' : e.kind === 'combat' ? 'shield' : e.kind === 'cond' ? 'sparkle' : 'info', 14)), h('span.rpg-li-txt', txt), e.gm && h('span.rpg-pill', 'só você'), h('time', when));
}

// ---------- peças ----------
const bar = (p, cls, label, onclick) => h('button.rpg-bar.' + cls, { title: label, onclick, disabled: !onclick },
  h('span.rpg-bar-fill', { style: { width: pct(p.cur, p.max) + '%' } }), h('span.rpg-bar-txt', `${label} ${p.cur}/${p.max}`));
const portrait = (img, fallback, size = 44) => (img ? h('img.rpg-img', { src: img, alt: '', style: { width: size + 'px', height: size + 'px' } }) : fallback);
const chips = (list, cls, onDel) => list.map(x => h('span.rpg-chip.' + cls, typeof x === 'string' ? x : x.name + (x.turns != null ? ` · ${x.turns}` : ''),
  onDel && h('button.rpg-chip-x', { title: 'Tirar', onclick: (ev) => { ev.stopPropagation(); onDel(x); } }, '×')));

function charCard(ch) {
  const mine = canChar(ch), active = T.active[ch.owner] === ch.id;
  return h('div.rpg-card' + (active ? '.active' : ''),
    h('div.rpg-card-head',
      portrait(ch.img, avatar(user(ch.owner), 44, { status: false })),
      h('div.rpg-card-id', h('b', ch.name), h('span', [ch.cls, ch.level ? `nível ${ch.level}` : ''].filter(Boolean).join(' · ') || 'Aventureiro')),
      ch.owner === me() && myChars().length > 1 && h('button.ibtn' + (active ? '.on' : ''), { title: active ? 'Ficha em uso' : 'Usar esta ficha nas rolagens', onclick: () => send({ op: 'char.active', id: ch.id }) }, icon('star', 16)),
      mine && h('button.ibtn', { title: 'Editar ficha', onclick: () => sheetModal(ch) }, icon('edit', 16))),
    bar(ch.hp, 'hp', 'Vida', mine ? () => hpModal(ch, 'c') : null),
    ch.res && bar(ch.res, 'res', ch.res.name, mine ? () => hpModal(ch, 'c', true) : null),
    Object.keys(ch.attrs).length > 0 && h('div.rpg-attrs', Object.entries(ch.attrs).map(([k, v]) => h('button.rpg-attr', { title: mine ? `Rolar ${k}` : k, disabled: !mine, onclick: () => attrRoll(ch, k) }, h('small', k), h('b', String(v))))),
    h('div.rpg-chips', chips(ch.tags, 'tag', mine && ((t) => send({ op: 'tags', id: ch.id, tags: ch.tags.filter(x => x !== t) }))),
      chips(ch.conds || [], 'cond', mine && ((c) => send({ op: 'cond.del', id: ch.id, name: c.name }))),
      mine && h('button.rpg-chip.add', { title: 'Tag ou condição', onclick: () => tagModal(ch, 'c') }, icon('plus', 12))),
    (ch.skills || ch.notes) && h('details.rpg-notes', h('summary', 'Habilidades e observações'), ch.skills && h('p', ch.skills), ch.notes && h('p.muted', ch.notes)));
}
function foeCard(f) {
  const gm = isGM();
  const hp = f.hp ? bar(f.hp, 'hp.foe', 'Vida', gm ? () => hpModal(f, 'f') : null)
    : f.mode === 'hidden' ? h('div.rpg-hidden', icon('eyeoff', 14), f.state === 'Derrotado' ? 'Derrotado' : `${f.dmg} de dano causado`)
      : h('div.rpg-narr.s-' + (f.state || '').toLowerCase().replace(/\s+/g, '-'), f.state);
  return h('div.rpg-card.foe' + (f.boss ? '.boss' : '') + (gm && !f.shown ? '.offstage' : '') + (f.state === 'Derrotado' || f.hp?.cur <= 0 ? '.down' : ''),
    h('div.rpg-card-head',
      portrait(f.img, h('span.rpg-foe-ico', icon(f.boss ? 'crown' : 'shield', 22))),
      h('div.rpg-card-id', h('b', f.name), h('span', f.boss ? 'Chefe' : 'Inimigo', gm && ` · ${{ show: 'vida visível', hidden: 'vida oculta', narr: 'narrativo' }[f.mode]}`, gm && !f.shown && ' · fora de cena')),
      gm && h('button.ibtn' + (f.shown ? '.on' : ''), { title: f.shown ? 'Tirar de cena (esconder dos jogadores)' : 'Pôr em cena (os jogadores veem)', onclick: () => send({ op: 'foe.show', id: f.id, on: !f.shown }) }, icon(f.shown ? 'eye' : 'eyeoff', 16)),
      gm && h('button.ibtn', { title: 'Duplicar', onclick: () => send({ op: 'foe.dup', id: f.id }) }, icon('copy', 16)),
      gm && h('button.ibtn', { title: 'Editar', onclick: () => foeModal(f) }, icon('edit', 16))),
    hp,
    h('div.rpg-chips', chips(f.conds || [], 'cond', gm && ((c) => send({ op: 'cond.del', kind: 'f', id: f.id, name: c.name }))),
      gm && h('button.rpg-chip.add', { title: 'Condição', onclick: () => tagModal(f, 'f') }, icon('plus', 12))),
    gm && (f.attacks || f.abilities || f.resist || f.weak || f.notes) && h('details.rpg-notes', h('summary', 'Ataques, habilidades e defesas'),
      f.attacks && h('p', h('b', 'Ataques: '), f.attacks), f.abilities && h('p', h('b', 'Habilidades: '), f.abilities),
      f.resist && h('p', h('b', 'Resiste: '), f.resist), f.weak && h('p', h('b', 'Fraco contra: '), f.weak), f.notes && h('p.muted', f.notes)));
}

// ---------- abas ----------
function tabMesa() {
  const ids = callIds(), owners = [...new Set([...ids, ...T.chars.map(c => c.owner)])];
  const out = [];
  for (const uid of owners) {
    const list = T.chars.filter(c => c.owner === uid), here = ids.includes(uid);
    if (!list.length && !here) continue;
    out.push(h('section.rpg-player' + (here ? '' : '.away'),
      h('div.rpg-player-h', avatar(user(uid), 24, { status: false }), h('b', who(uid)), uid === T.gm && h('span.rpg-gm', icon('crown', 12), 'Mestre'), !here && h('span.muted', 'fora da chamada'),
        uid === me() && h('button.btn.sm', { onclick: () => sheetModal(null) }, icon('plus', 14), 'Nova ficha')),
      list.length ? h('div.rpg-grid', list.map(charCard)) : h('p.rpg-empty', uid === me() ? 'Crie sua ficha para entrar na aventura.' : uid === T.gm ? 'Conduzindo a história.' : 'Ainda sem ficha.')));
  }
  const foes = T.foes.filter(f => f.shown);
  if (foes.length) out.push(h('section.rpg-player.scene', h('div.rpg-player-h', icon('shield', 18), h('b', 'Em cena')), h('div.rpg-grid', foes.map(foeCard))));
  return out;
}
function tabCombat() {
  const C = T.combat, gm = isGM();
  if (!C) return h('div.rpg-blank', icon('shield', 40), h('b', 'Nenhum combate agora'),
    gm ? [h('p', 'Entram as fichas em uso de quem está na chamada e os inimigos em cena.'), h('button.btn', { onclick: () => send({ op: 'combat.start' }) }, 'Começar combate')] : h('p', 'Quando o mestre começar, a ordem de turnos aparece aqui.'));
  const row = (e, i) => {
    const t = e.kind === 'c' ? charOf(e.ref) : foeOf(e.ref); if (!t) return null;
    const mine = e.kind === 'c' ? canChar(t) : gm, cur = e.id === C.cur;
    const hpEl = e.kind === 'c' || t.hp ? h('span.rpg-ord-hp', h('span.rpg-mini', h('span', { style: { width: pct(t.hp.cur, t.hp.max) + '%' } })), `${t.hp.cur}/${t.hp.max}`)
      : h('span.rpg-ord-hp.muted', t.mode === 'hidden' ? `${t.dmg} de dano` : t.state);
    return h('li.rpg-ord' + (cur ? '.cur' : '') + (e.kind === 'f' ? '.foe' : '') + (t.boss ? '.boss' : '') + ((t.hp?.cur ?? 1) <= 0 || t.state === 'Derrotado' ? '.down' : ''),
      h('button.rpg-init', { title: mine ? 'Rolar ou definir a iniciativa' : 'Iniciativa', disabled: !mine, onclick: () => initModal(e, t) }, e.init == null ? '–' : String(e.init)),
      e.kind === 'c' ? portrait(t.img, avatar(user(t.owner), 32, { status: false }), 32) : portrait(t.img, h('span.rpg-foe-ico.sm', icon(t.boss ? 'crown' : 'shield', 16)), 32),
      h('div.rpg-ord-id', h('b', t.name, cur && h('span.rpg-pill.turn', 'vez')), h('span', e.kind === 'c' ? who(t.owner) : t.boss ? 'Chefe' : 'Inimigo', ' ', chips(t.conds || [], 'cond'))),
      hpEl,
      mine && h('button.ibtn', { title: 'Dano ou cura', onclick: () => hpModal(t, e.kind) }, icon('heart', 16)),
      mine && h('button.ibtn', { title: 'Condição', onclick: () => tagModal(t, e.kind) }, icon('sparkle', 16)),
      gm && h('button.ibtn', { title: 'Tirar do combate', onclick: () => send({ op: 'combat.remove', id: e.id }) }, icon('x', 16)));
  };
  const out = [h('div.rpg-round', h('b', `Rodada ${C.round}`),
    gm && h('div.rpg-ctl',
      h('button.btn.grey.sm', { onclick: () => send({ op: 'combat.prev' }) }, icon('chevl', 14), 'Voltar'),
      h('button.btn.sm', { onclick: () => send({ op: 'combat.next' }) }, 'Próximo turno', icon('chevr', 14)),
      C.order.some(e => e.init == null) && h('button.btn.grey.sm', { onclick: () => send({ op: 'combat.init', all: true }) }, icon('dice', 14), 'Rolar iniciativas'),
      h('button.btn.grey.sm', { onclick: addToCombat }, icon('plus', 14), 'Adicionar'),
      h('button.btn.red.sm', { onclick: () => send({ op: 'combat.end' }) }, 'Encerrar')))];
  out.push(C.order.length ? h('ol.rpg-order', C.order.map(row)) : h('p.rpg-empty', 'Ninguém no combate. Adicione fichas ou inimigos.'));
  return out;
}
function tabGM() {
  if (!isGM()) return h('div.rpg-blank', icon('crown', 40), h('b', `${who(T.gm)} é o mestre`), h('p', 'O painel do mestre fica com ele.'),
    !callIds().includes(T.gm) && h('button.btn', { onclick: () => send({ op: 'gm.set' }) }, 'Assumir como mestre'));
  const others = callIds().filter(u => u !== me());
  return [
    h('section.rpg-player', h('div.rpg-player-h', icon('shield', 18), h('b', 'Inimigos e NPCs'), h('span.muted', `${T.foes.filter(f => f.shown).length} em cena`),
      h('button.btn.sm', { onclick: () => foeModal(null) }, icon('plus', 14), 'Novo')),
    T.foes.length ? h('div.rpg-grid', T.foes.map(foeCard)) : h('p.rpg-empty', 'Prepare os inimigos aqui. Eles ficam escondidos até você pôr em cena (o olho).')),
    h('section.rpg-player', h('div.rpg-player-h', icon('sliders', 18), h('b', 'Regras da mesa')), cfgForm()),
    h('section.rpg-player', h('div.rpg-player-h', icon('crown', 18), h('b', 'Mestre')),
      h('div.rpg-ctl', others.length ? others.map(u => h('button.btn.grey.sm', { onclick: () => modal('Passar o posto de mestre?', `${who(u)} passa a controlar inimigos, combate e regras.`, null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Passar', fn: () => send({ op: 'gm.set', uid: u }) }]) }, 'Passar para ', who(u))) : h('span.muted', 'Ninguém mais na chamada para passar o posto.'),
        h('button.btn.red.sm', { onclick: () => modal('Limpar o histórico?', 'Some para todos. As fichas e os inimigos ficam.', null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Limpar', cls: 'red', fn: () => send({ op: 'log.clear' }) }]) }, 'Limpar histórico'))),
  ];
}
function cfgForm() {
  const name = h('input', { value: T.name, maxlength: 40 }), attrs = h('input', { value: T.attrs.join(', '), placeholder: 'FOR, DES, CON…' }),
    conds = h('input', { value: T.conds.join(', ') }), ar = h('input', { value: T.attrRoll, placeholder: '1d20+{v}' }), ir = h('input', { value: T.initRoll, placeholder: '1d20+@DES' });
  const list = (v) => v.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  return h('div.rpg-form', field('Nome da mesa', name), field('Atributos das fichas (separados por vírgula)', attrs), field('Condições prontas', conds),
    h('div.rpg-row', field('Rolagem de atributo ({v} = valor)', ar), field('Iniciativa (@ATRIBUTO da ficha)', ir)),
    h('p.muted', 'Exemplos: 1d20+{v} (d20), {v}d6 (pilha de dados), 1d100 (porcentagem). Iniciativa: 1d20+@DES.'),
    h('div', h('button.btn.sm', { onclick: () => send({ op: 'cfg', name: name.value, attrs: list(attrs.value), conds: list(conds.value), attrRoll: ar.value, initRoll: ir.value }) }, 'Salvar regras')));
}
function tabLog() {
  if (!T.log.length) return h('p.rpg-empty', 'Nada ainda. Rolagens, dano, cura e combate ficam aqui.');
  return h('ul.rpg-log.full', [...T.log].reverse().map(logItem));
}

// ---------- janelas ----------
const field = (label, el) => h('label.rpg-field', h('span', label), el);
function imgField(val) {
  const inp = h('input', { value: val || '', placeholder: 'https://… ou envie uma imagem' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = file.files[0]; if (!f) return; btn.disabled = true; btn.textContent = 'Enviando…';
    try { inp.value = (await uploadFile(f)).url; } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = 'Enviar'; }
  } });
  const btn = h('button.btn.grey.sm', { type: 'button', onclick: () => file.click() }, 'Enviar');
  return { el: h('div.rpg-imgf', inp, btn, file), get: () => inp.value.trim() };
}
function sheetModal(ch) {
  const c = ch || { name: '', cls: '', level: 1, hp: { cur: 10, max: 10 }, res: null, attrs: Object.fromEntries(T.attrs.map(a => [a, 0])), tags: [], skills: '', notes: '' };
  const name = h('input', { value: c.name, maxlength: 40, placeholder: 'Nome do personagem' }), cls = h('input', { value: c.cls, maxlength: 40, placeholder: 'Classe, arquétipo, papel…' }),
    lvl = h('input', { type: 'number', value: c.level, min: 0, max: 999 }), img = imgField(c.img),
    hpMax = h('input', { type: 'number', value: c.hp.max, min: 0 }), hpCur = h('input', { type: 'number', value: c.hp.cur }),
    resName = h('input', { value: c.res?.name || '', placeholder: 'Mana, energia… (vazio = não usa)', maxlength: 20 }), resMax = h('input', { type: 'number', value: c.res?.max ?? 10, min: 0 }), resCur = h('input', { type: 'number', value: c.res?.cur ?? 10 }),
    tags = h('input', { value: c.tags.join(', '), placeholder: 'elfa, furtiva, devendo favor…' }), skills = h('textarea', { rows: 3, maxlength: 2000 }, c.skills), notes = h('textarea', { rows: 2, maxlength: 2000 }, c.notes);
  // atributos: os da mesa + os próprios da ficha; dá para criar outro
  const keys = [...new Set([...T.attrs, ...Object.keys(c.attrs)])], attrIn = new Map(), attrBox = h('div.rpg-attr-ed');
  const addAttr = (k, v) => { if (!k || attrIn.has(k)) return; const i = h('input', { type: 'number', value: v ?? 0 }); attrIn.set(k, i); attrBox.append(h('label.rpg-attr-in', h('span', k), i)); };
  keys.forEach(k => addAttr(k, c.attrs[k]));
  const newAttr = h('input', { placeholder: 'Outro atributo', maxlength: 12, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addAttr(newAttr.value.trim(), 0); newAttr.value = ''; } } });
  const owners = isGM() && !ch ? h('select', callIds().map(u => h('option', { value: u, selected: u === me() }, who(u)))) : null;
  const body = h('div.rpg-form',
    h('div.rpg-row', field('Nome', name), field('Nível', lvl)), field('Classe', cls), field('Imagem', img.el), owners && field('Jogador', owners),
    h('div.rpg-row', field('Vida máxima', hpMax), field('Vida atual', hpCur)),
    h('div.rpg-row', field('Recurso', resName), field('Máximo', resMax), field('Atual', resCur)),
    h('div.rpg-field', h('span', 'Atributos'), attrBox, h('div.rpg-row', newAttr, h('button.btn.grey.sm', { type: 'button', onclick: () => { addAttr(newAttr.value.trim(), 0); newAttr.value = ''; } }, 'Adicionar'))),
    field('Tags (separadas por vírgula)', tags), field('Habilidades', skills), field('Observações', notes));
  const save = () => {
    const attrs = {}; for (const [k, i] of attrIn) attrs[k] = +i.value || 0;
    send({ op: 'char.save', char: { id: ch?.id, owner: owners?.value, name: name.value, cls: cls.value, level: +lvl.value, img: img.get(), hp: { max: +hpMax.value, cur: ch ? +hpCur.value : +hpMax.value },
      res: resName.value.trim() ? { name: resName.value, max: +resMax.value, cur: +resCur.value } : null, attrs, tags: tags.value.split(',').map(x => x.trim()).filter(Boolean), skills: skills.value, notes: notes.value } });
  };
  modal(ch ? 'Editar ficha' : 'Nova ficha', ch ? null : 'Tudo pode mudar depois, até no meio da sessão.', body, [
    ch && { label: 'Apagar', cls: 'red', fn: () => { modal('Apagar a ficha?', `${ch.name} some da mesa.`, null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Apagar', cls: 'red', fn: () => send({ op: 'char.del', id: ch.id }) }]); } },
    { label: 'Cancelar', cls: 'grey' }, { label: 'Salvar', fn: save }].filter(Boolean), { width: '560px' });
}
function foeModal(f) {
  const x = f || { name: '', boss: false, mode: 'show', hp: { cur: 10, max: 10 }, attacks: '', abilities: '', resist: '', weak: '', notes: '' };
  const name = h('input', { value: x.name, maxlength: 40, placeholder: 'Goblin, Dragão vermelho…' }), img = imgField(x.img),
    boss = h('input', { type: 'checkbox', checked: x.boss }), hpMax = h('input', { type: 'number', value: x.hp.max, min: 0 }), hpCur = h('input', { type: 'number', value: x.hp.cur }),
    mode = h('select', [['show', 'Visível: números e barra'], ['hidden', 'Oculta: só o dano causado'], ['narr', 'Narrativa: só o estado (ferido, quase caindo…)']].map(([v, l]) => h('option', { value: v, selected: v === x.mode }, l))),
    attacks = h('textarea', { rows: 2 }, x.attacks), abilities = h('textarea', { rows: 2 }, x.abilities), resist = h('input', { value: x.resist, placeholder: 'fogo, veneno…' }), weak = h('input', { value: x.weak, placeholder: 'gelo, prata…' }), notes = h('textarea', { rows: 2 }, x.notes);
  const body = h('div.rpg-form', field('Nome', name), field('Imagem', img.el), h('label.rpg-check', boss, 'Chefe (destaque especial)'),
    h('div.rpg-row', field('Vida máxima', hpMax), field('Vida atual', hpCur)), field('Como os jogadores veem a vida', mode),
    field('Ataques', attacks), field('Habilidades', abilities), h('div.rpg-row', field('Resistências', resist), field('Fraquezas', weak)), field('Anotações (só você vê)', notes));
  modal(f ? 'Editar inimigo' : 'Novo inimigo', 'Ataques, defesas e anotações só o mestre vê.', body, [
    f && { label: 'Apagar', cls: 'red', fn: () => send({ op: 'foe.del', id: f.id }) },
    { label: 'Cancelar', cls: 'grey' },
    { label: 'Salvar', fn: () => send({ op: 'foe.save', foe: { id: f?.id, name: name.value, img: img.get(), boss: boss.checked, mode: mode.value, hp: { max: +hpMax.value, cur: f ? +hpCur.value : +hpMax.value }, attacks: attacks.value, abilities: abilities.value, resist: resist.value, weak: weak.value, notes: notes.value } }) },
  ].filter(Boolean), { width: '540px' });
}
function hpModal(t, kind, res = false) {
  const p = res ? t.res : t.hp, n = h('input', { type: 'number', min: 0, placeholder: 'Quanto?', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(-1); m.close(); } } });
  const go = (sign) => { const v = Math.abs(+n.value || 0); if (!v && sign) return; send({ op: kind === 'f' ? 'foe.hp' : 'char.hp', id: t.id, res, ...(sign ? { delta: sign * v } : { set: +n.value || 0 }) }); };
  const m = modal(`${t.name}: ${res ? p.name : 'vida'}`, `Agora: ${p.cur} de ${p.max}`, h('div.rpg-form', n, h('div.rpg-quick', [1, 2, 5, 10].map(v => h('button.btn.grey.sm', { type: 'button', onclick: () => { n.value = (+n.value || 0) + v; } }, '+' + v)))), [
    { label: 'Definir', cls: 'grey', fn: () => go(0) }, { label: res ? 'Recuperar' : 'Curar', cls: 'green', fn: () => go(1) }, { label: res ? 'Gastar' : 'Dano', cls: 'red', fn: () => go(-1) }]);
}
function tagModal(t, kind) {
  const name = h('input', { placeholder: kind === 'c' ? 'Nome da tag ou da condição' : 'Nome da condição', maxlength: 30 }), turns = h('input', { type: 'number', min: 1, max: 99, placeholder: 'Turnos (vazio = até tirar)' });
  const cond = (c) => { send({ op: 'cond.add', kind, id: t.id, name: c, turns: turns.value ? +turns.value : null }); m.close(); };
  const m = modal(t.name, kind === 'c' ? 'Tags descrevem o personagem; condições valem no combate (com duração opcional).' : 'Condição de combate (com duração opcional).',
    h('div.rpg-form', name, h('div.rpg-quick', T.conds.map(c => h('button.rpg-chip.cond.pick', { type: 'button', onclick: () => cond(c) }, c))), turns), [
      { label: 'Cancelar', cls: 'grey' },
      kind === 'c' && { label: 'Adicionar tag', cls: 'grey', fn: () => { const v = name.value.trim(); if (!v) return false; send({ op: 'tags', id: t.id, tags: [...t.tags, v] }); } },
      { label: 'Adicionar condição', fn: () => { const v = name.value.trim(); if (!v) return false; cond(v); } }].filter(Boolean));
}
function initModal(e, t) {
  const n = h('input', { type: 'number', value: e.init ?? '', placeholder: 'Valor' });
  modal(`Iniciativa: ${t.name}`, `Rolar usa ${T.initRoll}.`, n, [{ label: 'Cancelar', cls: 'grey' },
    { label: 'Definir', cls: 'grey', fn: () => { if (n.value === '') return false; send({ op: 'combat.init', id: e.id, set: +n.value }); } },
    { label: 'Rolar', fn: () => send({ op: 'combat.init', id: e.id }) }]);
}
function addToCombat() {
  const inC = new Set(T.combat.order.map(e => e.kind + e.ref));
  const opts = [...T.chars.map(c => ['c', c]), ...T.foes.map(f => ['f', f])].filter(([k, x]) => !inC.has(k + x.id));
  if (!opts.length) return toast('Todo mundo já está no combate');
  const m = modal('Adicionar ao combate', 'Inimigos fora de cena entram escondidos dos jogadores até você pôr em cena.', h('div.rpg-pick', opts.map(([k, x]) =>
    h('button.rpg-pick-it', { onclick: () => { send({ op: 'combat.add', kind: k, ref: x.id }); m.close(); } }, icon(k === 'c' ? 'user' : x.boss ? 'crown' : 'shield', 16), x.name, h('span.muted', k === 'c' ? who(x.owner) : x.shown ? 'em cena' : 'fora de cena')))), [{ label: 'Fechar', cls: 'grey' }]);
}

// ---------- quadro ----------
function render() {
  if (!node || !T) return;
  const gm = isGM(), tabs = [['mesa', 'Mesa', 'users'], ['combate', 'Combate' + (T.combat ? ` · R${T.combat.round}` : ''), 'shield'], ['mestre', 'Mestre', 'crown'], ['log', 'Histórico', 'clock']];
  barInfo.replaceChildren(h('b', T.name), h('span.rpg-gm', { title: 'Mestre da sessão' }, icon('crown', 12), who(T.gm)), gm && h('span.rpg-pill.me', 'você é o mestre'));
  tabsEl.replaceChildren(...tabs.map(([k, l, ic]) => h('button.rpg-tab' + (tab === k ? '.on' : ''), { title: l, onclick: () => { tab = k; render(); } }, icon(ic, 14), h('span', l))));
  const top = bodyEl.scrollTop;
  const content = tab === 'combate' ? tabCombat() : tab === 'mestre' ? tabGM() : tab === 'log' ? tabLog() : tabMesa();
  bodyEl.replaceChildren(...[content].flat(2).filter(Boolean)); bodyEl.scrollTop = top;
  // rolando como: a ficha em uso (os @ATRIBUTOS da rolagem vêm dela)
  const mine = myChars(), act = T.active[me()];
  asSel.replaceChildren(...(mine.length ? mine.map(c => h('option', { value: c.id, selected: c.id === act }, c.name)) : [h('option', { value: '' }, gm ? 'Mestre' : 'Sem ficha')]));
  asSel.disabled = mine.length < 2;
  sideLog.replaceChildren(...T.log.filter(e => e.kind === 'roll').slice(-25).reverse().map(logItem));
  if (!sideLog.childElementCount) sideLog.append(h('li.rpg-empty', 'As rolagens da mesa aparecem aqui.'));
  syncToggles();
}
export function rpgTile({ onFocus, onClose }) {
  if (node) return node;
  barInfo = h('div.rpg-title'); tabsEl = h('div.rpg-tabs'); bodyEl = h('div.rpg-body'); sideLog = h('ul.rpg-log'); resultEl = h('div.rpg-result', h('div.rpg-res.idle', h('div.rpg-res-total', icon('dice', 34)), h('div.rpg-res-tag', 'Escolha os dados e role')));
  exprIn = h('input.rpg-expr', { placeholder: '1d20+3, 4d6dl1, 2d8+@FOR…', maxlength: 120, spellcheck: false,
    oninput: () => { exprIn.dataset.fresh = ''; },
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); doRoll(exprIn.value); exprIn.dataset.fresh = '1'; } } });
  asSel = h('select.rpg-as', { title: 'Ficha usada nas rolagens (@ATRIBUTO)', onchange: () => send({ op: 'char.active', id: asSel.value }) });
  advBtns = { adv: h('button.rpg-tog', { title: 'Rola 2d20 e fica o maior', onclick: () => { adv = adv === 'adv' ? null : 'adv'; syncToggles(); } }, 'Vantagem'),
    dis: h('button.rpg-tog', { title: 'Rola 2d20 e fica o menor', onclick: () => { adv = adv === 'dis' ? null : 'dis'; syncToggles(); } }, 'Desvantagem') };
  secretBtn = h('button.rpg-tog', { title: 'Só você (mestre) vê o resultado', onclick: () => { secret = !secret; syncToggles(); } }, icon('eyeoff', 13), 'Secreta');
  const custom = h('input.rpg-cust', { type: 'number', min: 2, max: 1000, placeholder: 'dX', title: 'Dado personalizado: número de faces', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && +custom.value >= 2) { addDie(+custom.value); custom.value = ''; } } });
  const side = h('div.rpg-side',
    resultEl,
    h('div.rpg-dicebox',
      h('div.rpg-dicerow', [4, 6, 8, 10, 12, 20, 100].map(f => h('button.rpg-dbtn' + (f === 20 ? '.d20' : ''), { title: `Adicionar 1d${f}`, onclick: () => addDie(f) }, 'd' + f)), custom),
      h('div.rpg-exprrow', h('button.rpg-mbtn', { title: '−1', onclick: () => addMod(-1) }, '−'), exprIn, h('button.rpg-mbtn', { title: '+1', onclick: () => addMod(1) }, '+')),
      h('div.rpg-togrow', advBtns.adv, advBtns.dis, secretBtn),
      h('div.rpg-rollrow', h('button.btn.rpg-go', { onclick: () => { doRoll(exprIn.value); exprIn.dataset.fresh = '1'; } }, icon('dice', 16), 'Rolar'),
        h('button.btn.grey', { title: 'Rolar de novo a última', onclick: () => (lastExpr ? doRoll(lastExpr) : toast('Nenhuma rolagem ainda')) }, icon('refresh', 16))),
      h('label.rpg-asrow', h('span', 'Rolando como'), asSel)),
    sideLog);
  node = h('div.tile.rpgtile', { 'data-key': 'rpg', onclick: (e) => e.stopPropagation(), onkeydown: (e) => { if (e.target.matches('input,textarea,select')) e.stopPropagation(); } },
    h('div.rpg-top', h('span.rpg-logo', icon('dice', 18)), barInfo, tabsEl, h('span.sp'),
      h('button.ibtn', { title: 'Destacar / voltar à grade', onclick: onFocus }, icon('expand', 16)),
      h('button.ibtn', { title: 'Fechar a mesa (a campanha fica guardada)', onclick: onClose }, icon('x', 16))),
    h('div.rpg-main', bodyEl, side));
  render();
  return node;
}
