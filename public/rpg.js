// Mesa de RPG da chamada (atividade do foguete; servidor: server/rpg.js).
// Um quadro no palco da chamada, como a lousa e o editor de código. Aba Mesa: fichas, inimigos em cena e, durante o
// combate, a faixa de turnos com o painel de quem está selecionado (dano, cura, condições e rolar por ele) — tudo num
// lugar só. Aba Mestre (só o mestre a vê): inimigos e regras da mesa. Ao lado, o rolador e o histórico compacto.
// O servidor rola os dados e manda a cada um a sua visão (RPG_STATE); aqui só se desenha e se pede.
// Sistema D&D 5e (padrão): o atributo tem o valor (8 a 20) e o modificador que vai no dado ((valor − 10) ÷ 2).
import { h, icon, avatar } from './util.js';
import { S, toast, modal, nameOf, channelById, user, menu } from './state.js';
import { uploadFile } from './upload.js';
import { voice } from './gateway.js';

// ---------- D&D 5e (Livro do Jogador) ----------
const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }, POINTS = 27, ARRAY = [15, 14, 13, 12, 10, 8];
const RACES = { // bônus da raça (a sub-raça dá mais um, ex.: Anão da colina +1 SAB, Alto elfo +1 INT)
  Humano: { FOR: 1, DES: 1, CON: 1, INT: 1, SAB: 1, CAR: 1 }, Anão: { CON: 2 }, Elfo: { DES: 2 }, Halfling: { DES: 2 }, Draconato: { FOR: 2, CAR: 1 },
  Gnomo: { INT: 2 }, 'Meio-elfo': { CAR: 2 }, 'Meio-orc': { FOR: 2, CON: 1 }, Tiefling: { CAR: 2, INT: 1 },
};
const RACE_NOTE = { 'Meio-elfo': '+1 em outros dois atributos à escolha', Anão: 'a sub-raça dá mais +1 (colina: SAB) ou +2 (montanha: FOR)', Elfo: 'a sub-raça dá mais +1 (alto: INT; floresta: SAB; drow: CAR)', Halfling: 'a sub-raça dá mais +1 (pés-leves: CAR; robusto: CON)', Gnomo: 'a sub-raça dá mais +1 (floresta: DES; rochas: CON)' };
const CLASSES = { // dado de vida e a ordem recomendada dos atributos (para distribuir o conjunto padrão)
  Bárbaro: [12, 'FOR CON DES SAB CAR INT'], Bardo: [8, 'CAR DES CON SAB INT FOR'], Bruxo: [8, 'CAR CON DES SAB INT FOR'], Clérigo: [8, 'SAB CON FOR DES CAR INT'],
  Druida: [8, 'SAB CON DES INT CAR FOR'], Feiticeiro: [6, 'CAR CON DES SAB INT FOR'], Guerreiro: [10, 'FOR CON DES SAB CAR INT'], Ladino: [8, 'DES CON INT SAB CAR FOR'],
  Mago: [6, 'INT CON DES SAB CAR FOR'], Monge: [8, 'DES SAB CON FOR INT CAR'], Paladino: [10, 'FOR CAR CON SAB DES INT'], Patrulheiro: [10, 'DES SAB CON FOR INT CAR'],
};
const ASI = (cls, lvl) => [4, 8, 12, 16, 19, ...(cls === 'Guerreiro' ? [6, 14] : cls === 'Ladino' ? [10] : [])].filter(l => l <= lvl).length;
const mod = (sc) => Math.floor((sc - 10) / 2), prof = (lvl) => 2 + Math.floor((Math.max(1, Math.min(20, lvl || 1)) - 1) / 4);
const sgn = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
// vida: dado de vida cheio no 1º nível + CON; depois a média do dado (metade + 1) + CON por nível
const hpSuggest = (cls, lvl, con) => { const d = CLASSES[cls]?.[0]; if (!d) return null; const m = mod(con), l = Math.max(1, lvl || 1); return Math.max(l, d + m + (l - 1) * Math.max(1, d / 2 + 1 + m)); };

let T = null, node = null, tab = 'mesa', seen = null, adv = null, secret = false, lastExpr = '', rollAs = '', sel = null, selTurn = null, logAll = true;
let exprIn = null, bodyEl = null, sideLog = null, barInfo = null, tabsEl = null, asSel = null, resultEl = null, secretBtn = null, advBtns = null, logTabs = null;
const send = (d) => voice?.send('RPG', d);
const gid = () => channelById(voice?.channelId)?.guild_id;
const who = (uid) => nameOf(uid, gid());
const callIds = () => [...S.voice.values()].filter(v => v.channel_id === voice?.channelId && !v.bot).map(v => v.user_id);
const me = () => S.me?.id;
const isGM = () => !!T?.me_gm;
const dnd = () => T?.sys === 'dnd5e';
const canChar = (ch) => isGM() || ch.owner === me();
const charOf = (id) => T?.chars.find(c => c.id === id);
const foeOf = (id) => T?.foes.find(f => f.id === id);
const ent = (kind, id) => (kind === 'f' ? foeOf(id) : charOf(id));
const myChars = () => (T?.chars || []).filter(c => c.owner === me());
const pct = (cur, max) => Math.max(0, Math.min(100, max > 0 ? cur / max * 100 : 0));
const score = (ch, k) => (ch.attrs[k] ?? 10) + (ch.abon?.[k] || 0);

// ---------- estado vindo do servidor ----------
export function rpgSet(d) {
  if (d.channel_id !== voice?.channelId) return;
  const prev = seen; T = d; seen = d.log.at(-1)?.id || null;
  if (tab === 'mestre' && !d.me_gm) tab = 'mesa';
  // a seleção do combate acompanha a vez (até alguém clicar em outro)
  const cur = d.combat?.cur || null; if (cur !== selTurn) { selTurn = cur; sel = cur; }
  if (prev !== seen) { const i = prev ? d.log.findIndex(e => e.id === prev) : -1, fresh = d.log.slice(i + 1).filter(e => e.kind === 'roll'); if (fresh.length) showResult(fresh.at(-1)); }
  render();
}
export const rpgReset = () => { T = null; node = null; seen = null; sel = selTurn = null; rollAs = ''; };
export const rpgError = (d) => toast(d.error || 'Não deu certo', true);

// ---------- rolagem ----------
function doRoll(expr, label, as = rollAs) {
  expr = String(expr || '').trim(); if (!expr) return toast('Escolha os dados ou digite uma rolagem, como 1d20+3', true);
  lastExpr = expr; send({ op: 'roll', expr, label: label || '', adv, secret: secret && isGM(), ...(as ? { as } : {}) });
  if (adv) { adv = null; syncToggles(); } // vantagem/desvantagem valem para uma rolagem
}
function attrRoll(ch, k) {
  const sc = score(ch, k), m = dnd() ? mod(sc) : sc;
  doRoll(String(T.attrRoll || '1d20+{m}').replace(/\{m\}/g, String(m)).replace(/\{v\}/g, String(sc)).replace(/\+-/g, '-'), k, 'c:' + ch.id);
}
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
  exprIn.value = (m ? v.slice(0, m.index) : v) + (k ? (k > 0 ? '+' : '-') + Math.abs(k) : ''); exprIn.dataset.fresh = '';
}
const syncToggles = () => { if (!advBtns) return; advBtns.adv.classList.toggle('on', adv === 'adv'); advBtns.dis.classList.toggle('on', adv === 'dis'); secretBtn.classList.toggle('on', secret); secretBtn.hidden = !isGM(); };
// quem rola: o mestre escolhe qualquer ficha ou inimigo; o jogador, uma das fichas dele
function setAs(v) { rollAs = v; if (asSel) asSel.value = v; const [k, id] = v.split(':'); if (k === 'c' && charOf(id)?.owner === me() && T.active[me()] !== id) send({ op: 'char.active', id }); }

function diceChips(r) {
  return h('span.rpg-dice', r.parts.map((p, i) => [i || p.sign < 0 ? h('span.rpg-op', p.sign < 0 ? '−' : '+') : null,
    p.rolls ? h('span.rpg-grp', { title: p.t }, p.rolls.map(x => h('span.rpg-die' + (x.drop ? '.drop' : '') + (x.v === p.faces ? '.max' : x.v === 1 ? '.min' : ''),
      { title: x.was != null ? `Rerrolado (era ${x.was})` : x.ex ? 'Explodiu' : x.drop ? 'Descartado' : `d${p.faces}` }, x.was != null && h('s', String(x.was)), String(x.v)))) : h('span.rpg-mod', p.t.startsWith('@') ? `${p.t.slice(1)} ${sgn(p.v)}` : String(p.v))]));
}
const rollWho = (e) => e.who || (e.char && charOf(e.char)?.name) || who(e.uid);
function showResult(e) {
  if (!resultEl) return;
  const r = e.roll;
  resultEl.replaceChildren(h('div.rpg-res' + (r.crit ? '.crit' : r.fumble ? '.fumble' : ''),
    h('div.rpg-res-who', rollWho(e), e.label && e.label !== r.expr ? ` · ${e.label}` : '', e.gm && ' · secreta'),
    h('div.rpg-res-total', String(r.total)),
    h('div.rpg-res-tag', r.crit ? 'Crítico' : r.fumble ? 'Falha crítica' : r.expr + (r.adv === 'adv' ? ' · vantagem' : r.adv === 'dis' ? ' · desvantagem' : '')),
    diceChips(r)));
}

// ---------- histórico (compacto: uma linha por coisa; clicar numa rolagem mostra os dados) ----------
function logItem(e) {
  const when = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (e.kind === 'roll') {
    const r = e.roll, li = h('li.rpg-li.roll' + (r.crit ? '.crit' : r.fumble ? '.fumble' : ''), { title: `${when} · ${r.expr}`, onclick: () => li.classList.toggle('open') },
      h('div.rpg-li-row', h('b', rollWho(e)), h('span.rpg-li-lab', e.label || r.expr), e.gm && h('span.rpg-li-sec', { title: 'Secreta: só o mestre vê' }, icon('eyeoff', 12)), h('span.rpg-total', String(r.total))),
      h('div.rpg-li-det', diceChips(r)));
    return li;
  }
  return h('li.rpg-li.note', { title: when }, e.kind === 'info' ? `${who(e.uid)} ${e.text}` : e.text, e.gm && h('span.rpg-li-sec', { title: 'Só você vê' }, icon('eyeoff', 12)));
}

// ---------- peças ----------
const bar = (p, cls, label, onclick) => h('button.rpg-bar.' + cls, { title: label, onclick, disabled: !onclick },
  h('span.rpg-bar-fill', { style: { width: pct(p.cur, p.max) + '%' } }), h('span.rpg-bar-txt', `${label} ${p.cur} / ${p.max}`));
const portrait = (t, kind, size = 40) => (t.img ? h('img.rpg-img', { src: t.img, alt: '', style: { width: size + 'px', height: size + 'px' } })
  : kind === 'f' ? h('span.rpg-foe-ico', { style: { width: size + 'px', height: size + 'px' } }, icon(t.boss ? 'crown' : 'shield', Math.round(size / 2)))
    : avatar(user(t.owner), size, { status: false }));
const chip = (txt, cls, onDel) => h('span.rpg-chip' + (cls ? '.' + cls : ''), txt, onDel && h('button.rpg-chip-x', { title: 'Tirar', onclick: (ev) => { ev.stopPropagation(); onDel(); } }, '×'));
const condTxt = (c) => c.name + (c.turns != null ? ` · ${c.turns}` : '');
const foeHp = (f) => (f.hp ? null : f.mode === 'hidden' ? (f.state === 'Derrotado' ? 'Derrotado' : `${f.dmg} de dano`) : f.state);
function attrsRow(ch, canRoll) {
  const keys = Object.keys(ch.attrs); if (!keys.length) return null;
  return h('div.rpg-attrs', keys.map(k => { const sc = score(ch, k);
    return h('button.rpg-attr', { title: canRoll ? `Rolar ${k}` : k, disabled: !canRoll, onclick: () => attrRoll(ch, k) },
      h('small', k), dnd() ? [h('b', sgn(mod(sc))), h('i', String(sc))] : h('b', String(sc))); }));
}
const subtitle = (ch) => [ch.race, ch.cls, ch.level ? `nível ${ch.level}` : '', dnd() && ch.level ? `prof. ${sgn(prof(ch.level))}` : ''].filter(Boolean).join(' · ') || 'Aventureiro';

function charCard(ch) {
  const mine = canChar(ch), active = T.active[ch.owner] === ch.id;
  return h('div.rpg-card',
    h('div.rpg-card-head', portrait(ch, 'c'),
      h('div.rpg-card-id', h('b', ch.name), h('span', subtitle(ch))),
      ch.owner === me() && myChars().length > 1 && h('button.ibtn' + (active ? '.on' : ''), { title: active ? 'Ficha em uso nas rolagens' : 'Usar esta ficha nas rolagens', onclick: () => send({ op: 'char.active', id: ch.id }) }, icon('star', 16)),
      mine && h('button.ibtn', { title: 'Editar ficha', onclick: () => sheetModal(ch) }, icon('edit', 16))),
    bar(ch.hp, 'hp', 'Vida', mine ? () => hpModal(ch, 'c') : null),
    ch.res && bar(ch.res, 'res', ch.res.name, mine ? () => hpModal(ch, 'c', true) : null),
    attrsRow(ch, mine),
    (ch.tags.length || ch.conds?.length || mine) && h('div.rpg-chips', ch.tags.map(t => chip(t, '', mine && (() => send({ op: 'tags', id: ch.id, tags: ch.tags.filter(x => x !== t) })))),
      (ch.conds || []).map(c => chip(condTxt(c), 'cond', mine && (() => send({ op: 'cond.del', id: ch.id, name: c.name })))),
      mine && h('button.rpg-chip.add', { title: 'Adicionar tag', onclick: () => tagModal(ch) }, icon('plus', 12), 'tag')),
    (ch.skills || ch.notes) && h('details.rpg-notes', h('summary', 'Habilidades e observações'), ch.skills && h('p', ch.skills), ch.notes && h('p.muted', ch.notes)));
}
function foeCard(f) {
  const gm = isGM();
  return h('div.rpg-card.foe' + (gm && !f.shown ? '.offstage' : '') + (f.state === 'Derrotado' || f.hp?.cur <= 0 ? '.down' : ''),
    h('div.rpg-card-head', portrait(f, 'f'),
      h('div.rpg-card-id', h('b', f.boss && icon('crown', 13), f.name), h('span', f.boss ? 'Chefe' : 'Inimigo', gm && ` · ${{ show: 'vida visível', hidden: 'vida oculta', narr: 'narrativo' }[f.mode]}`, gm && !f.shown && ' · fora de cena')),
      gm && h('button.ibtn' + (f.shown ? '.on' : ''), { title: f.shown ? 'Tirar de cena (esconder dos jogadores)' : 'Pôr em cena (os jogadores veem)', onclick: () => send({ op: 'foe.show', id: f.id, on: !f.shown }) }, icon(f.shown ? 'eye' : 'eyeoff', 16)),
      gm && h('button.ibtn', { title: 'Mais', onclick: (e) => menu(e, [{ label: 'Editar', icon: 'edit', fn: () => foeModal(f) }, { label: 'Duplicar', icon: 'copy', fn: () => send({ op: 'foe.dup', id: f.id }) }, '-', { label: 'Apagar', icon: 'trash', danger: true, fn: () => send({ op: 'foe.del', id: f.id }) }]) }, icon('more', 16))),
    f.hp ? bar(f.hp, 'hp.foe', 'Vida', gm ? () => hpModal(f, 'f') : null) : h('div.rpg-hptext', foeHp(f)),
    f.conds?.length > 0 && h('div.rpg-chips', f.conds.map(c => chip(condTxt(c), 'cond', gm && (() => send({ op: 'cond.del', kind: 'f', id: f.id, name: c.name }))))));
}

// ---------- combate: faixa de turnos + painel do selecionado ----------
function tracker() {
  const C = T.combat, gm = isGM();
  const items = C.order.map(e => {
    const t = ent(e.kind, e.ref); if (!t) return null;
    const down = (t.hp?.cur ?? 1) <= 0 || t.state === 'Derrotado';
    return h('button.rpg-tk' + (e.id === C.cur ? '.cur' : '') + (e.id === sel ? '.sel' : '') + (down ? '.down' : '') + (e.kind === 'f' ? '.foe' : ''),
      { title: `${t.name} · iniciativa ${e.init ?? '–'}`, onclick: () => { sel = e.id; render(); } },
      h('span.rpg-tk-init', e.init ?? '–'), portrait(t, e.kind, 26), h('span.rpg-tk-name', t.name),
      t.hp && h('span.rpg-tk-hp', h('span', { style: { width: pct(t.hp.cur, t.hp.max) + '%' } })));
  });
  return h('div.rpg-track',
    h('div.rpg-track-round', h('small', 'Rodada'), h('b', String(C.round))),
    h('div.rpg-track-list', items),
    gm && h('button.btn.rpg-next', { onclick: () => send({ op: 'combat.next' }) }, 'Próximo turno', icon('chevr', 16)),
    gm && h('button.ibtn', { title: 'Mais opções do combate', onclick: (ev) => {
      const inC = new Set(C.order.map(e => e.kind + e.ref)), out = [...T.chars.map(c => ['c', c]), ...T.foes.map(f => ['f', f])].filter(([k, x]) => !inC.has(k + x.id));
      menu(ev, [{ label: 'Voltar um turno', icon: 'chevl', fn: () => send({ op: 'combat.prev' }) },
        out.length && { label: 'Adicionar ao combate', icon: 'plus', sub: out.map(([k, x]) => ({ label: x.name + (k === 'f' && !x.shown ? ' (fora de cena)' : ''), fn: () => send({ op: 'combat.add', kind: k, ref: x.id }) })) },
        '-', { label: 'Encerrar combate', icon: 'x', danger: true, fn: () => send({ op: 'combat.end' }) }]);
    } }, icon('more', 18)));
}
function focusPanel() {
  const C = T.combat, e = C.order.find(x => x.id === sel) || C.order.find(x => x.id === C.cur); if (!e) return null;
  const t = ent(e.kind, e.ref); if (!t) return null;
  const isF = e.kind === 'f', gm = isGM(), can = isF ? gm : canChar(t), turn = e.id === C.cur;
  const amt = h('input.rpg-amt', { type: 'number', min: 1, placeholder: '0', onkeydown: (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') hit(-1); } });
  const hit = (sign) => { const v = Math.abs(+amt.value || 0); if (!v) return amt.focus(); send({ op: isF ? 'foe.hp' : 'char.hp', id: t.id, delta: sign * v }); amt.value = ''; };
  const active = new Map((t.conds || []).map(c => [c.name.toLowerCase(), c]));
  const turns = h('input.rpg-turns', { type: 'number', min: 1, max: 99, placeholder: '∞', title: 'Duração em turnos das condições que você marcar (vazio = até tirar)', onkeydown: (ev) => ev.stopPropagation() });
  const toggle = (name) => (active.has(name.toLowerCase()) ? send({ op: 'cond.del', kind: e.kind, id: t.id, name }) : send({ op: 'cond.add', kind: e.kind, id: t.id, name, turns: turns.value ? +turns.value : null }));
  const condNames = [...new Set([...T.conds, ...(t.conds || []).map(c => c.name)])];
  const asVal = (isF ? 'f:' : 'c:') + t.id;
  return h('div.rpg-focus',
    h('div.rpg-focus-head', portrait(t, e.kind, 48),
      h('div.rpg-card-id', h('b', t.boss && icon('crown', 14), t.name), h('span', turn ? 'Vez agora' : 'Selecionado', ' · ', isF ? (t.boss ? 'Chefe' : 'Inimigo') : who(t.owner))),
      h('button.rpg-init-btn', { title: can ? 'Mudar a iniciativa' : 'Iniciativa', disabled: !can, onclick: () => initModal(e, t) }, h('small', 'Inic.'), h('b', String(e.init ?? '–'))),
      gm && h('button.ibtn', { title: 'Tirar do combate', onclick: () => send({ op: 'combat.remove', id: e.id }) }, icon('x', 16))),
    h('div.rpg-focus-hp', t.hp ? bar(t.hp, 'hp' + (isF ? '.foe' : ''), 'Vida', null) : h('div.rpg-hptext', foeHp(t)),
      can && h('div.rpg-hit', amt, h('button.btn.red.sm', { onclick: () => hit(-1) }, 'Dano'), h('button.btn.green.sm', { onclick: () => hit(1) }, 'Cura'))),
    !isF && t.res && bar(t.res, 'res', t.res.name, can ? () => hpModal(t, 'c', true) : null),
    h('div.rpg-focus-sec', h('span.rpg-lab', 'Condições'),
      can ? [h('div.rpg-chips', condNames.map(n => { const on = active.get(n.toLowerCase());
        return h('button.rpg-chip.tog' + (on ? '.on' : ''), { onclick: () => toggle(n) }, n, on?.turns != null && h('small', ` ${on.turns}`)); })),
      h('label.rpg-turns-row', 'Duração das próximas', turns, 'turnos')]
        : h('div.rpg-chips', (t.conds || []).length ? t.conds.map(c => chip(condTxt(c), 'cond')) : h('span.muted', 'Nenhuma'))),
    !isF && attrsRow(t, can),
    can && h('div.rpg-focus-sec', h('span.rpg-lab', `Rolar por ${t.name}`),
      h('div.rpg-quick', h('button.btn.grey.sm', { onclick: () => { setAs(asVal); doRoll('1d20', 'd20'); } }, '1d20'),
        h('button.btn.grey.sm', { onclick: () => { setAs(asVal); exprIn.focus(); } }, 'Usar no rolador'))),
    isF && gm && (t.attacks || t.abilities) && h('div.rpg-focus-sec', h('span.rpg-lab', 'Ataques e habilidades'), t.attacks && h('p.rpg-pre', t.attacks), t.abilities && h('p.rpg-pre.muted', t.abilities),
      (t.resist || t.weak) && h('p.muted', t.resist && `Resiste: ${t.resist}. `, t.weak && `Fraco contra: ${t.weak}.`)));
}

// ---------- abas ----------
function tabMesa() {
  const out = [], gm = isGM(), ids = callIds();
  if (T.combat) out.push(tracker(), focusPanel());
  else if (gm) out.push(h('div.rpg-bar-row', h('span.muted', 'A iniciativa de todos é rolada ao começar e a ordem se ajusta sozinha.'), h('button.btn.sm', { onclick: () => send({ op: 'combat.start' }) }, 'Começar combate')));
  const owners = [...new Set([...ids, ...T.chars.map(c => c.owner)])], groups = [];
  for (const uid of owners) {
    const list = T.chars.filter(c => c.owner === uid), here = ids.includes(uid);
    if (!list.length && !here) continue;
    if (!list.length && uid === T.gm && uid !== me()) continue; // o mestre sem ficha não precisa de seção
    groups.push(h('section.rpg-player' + (here ? '' : '.away'),
      h('div.rpg-player-h', avatar(user(uid), 22, { status: false }), h('b', who(uid)), uid === T.gm && h('span.rpg-gm', icon('crown', 12), 'Mestre'), !here && h('span.muted', 'fora da chamada'),
        uid === me() && h('button.btn.grey.sm', { onclick: () => sheetModal(null) }, icon('plus', 14), 'Nova ficha')),
      list.length ? h('div.rpg-grid', list.map(charCard)) : h('p.rpg-empty', uid === me() ? (gm ? 'Mestres também podem ter fichas (aliados, NPCs).' : 'Crie sua ficha para entrar na aventura.') : 'Ainda sem ficha.')));
  }
  const foes = T.foes.filter(f => f.shown);
  if (foes.length) groups.push(h('section.rpg-player', h('div.rpg-player-h', h('b', 'Em cena')), h('div.rpg-grid', foes.map(foeCard))));
  if (T.combat) out.push(h('details.rpg-all', h('summary', 'Fichas e inimigos'), groups)); else out.push(...groups);
  return out;
}
function tabGM() {
  const others = callIds().filter(u => u !== me());
  return [
    h('section.rpg-player', h('div.rpg-player-h', h('b', 'Inimigos e NPCs'), h('span.muted', `${T.foes.filter(f => f.shown).length} em cena`),
      h('button.btn.grey.sm', { onclick: () => foeModal(null) }, icon('plus', 14), 'Novo')),
    T.foes.length ? h('div.rpg-grid', T.foes.map(foeCard)) : h('p.rpg-empty', 'Prepare os inimigos aqui. Ficam escondidos até você pôr em cena (o olho).')),
    h('section.rpg-player', h('div.rpg-player-h', h('b', 'Regras da mesa')), cfgForm()),
    h('section.rpg-player', h('div.rpg-player-h', h('b', 'Mestre')),
      h('div.rpg-quick', others.map(u => h('button.btn.grey.sm', { onclick: () => modal('Passar o posto de mestre?', `${who(u)} passa a controlar inimigos, combate e regras.`, null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Passar', fn: () => send({ op: 'gm.set', uid: u }) }]) }, 'Passar para ', who(u))),
        h('button.btn.grey.sm', { onclick: () => modal('Limpar o histórico?', 'Some para todos. As fichas e os inimigos ficam.', null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Limpar', cls: 'red', fn: () => send({ op: 'log.clear' }) }]) }, 'Limpar histórico'))),
  ];
}
function cfgForm() {
  const sys = h('select', [['dnd5e', 'D&D 5e: valor do atributo + modificador'], ['livre', 'Livre: o número do atributo vai direto no dado']].map(([v, l]) => h('option', { value: v, selected: v === T.sys }, l)));
  const name = h('input', { value: T.name, maxlength: 40 }), attrs = h('input', { value: T.attrs.join(', ') }),
    conds = h('input', { value: T.conds.join(', ') }), ar = h('input', { value: T.attrRoll }), ir = h('input', { value: T.initRoll });
  const list = (v) => v.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  return h('div.rpg-form', h('div.rpg-row', field('Nome da mesa', name), field('Sistema', sys)), field('Atributos das fichas', attrs), field('Condições prontas', conds),
    h('div.rpg-row', field('Teste de atributo', ar), field('Iniciativa', ir)),
    h('p.muted', '{m} = modificador, {v} = valor, @DES = modificador (D&D) ou valor (livre) do atributo da ficha, @PROF = proficiência. Ex.: 1d20+{m}, {v}d6, 1d100.'),
    h('div', h('button.btn.sm', { onclick: () => send({ op: 'cfg', name: name.value, sys: sys.value, attrs: list(attrs.value), conds: list(conds.value), attrRoll: ar.value, initRoll: ir.value }) }, 'Salvar regras')));
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
const opts = (id, list) => h('datalist', { id }, list.map(v => h('option', { value: v })));
function sheetModal(ch) {
  const D = dnd();
  const c = ch || { name: '', cls: '', race: '', level: 1, hp: { cur: 10, max: 10 }, res: null, attrs: Object.fromEntries(T.attrs.map(a => [a, D ? 8 : 0])), abon: {}, tags: [], skills: '', notes: '' };
  const name = h('input', { value: c.name, maxlength: 40, placeholder: 'Nome do personagem' }), lvl = h('input', { type: 'number', value: c.level, min: 1, max: 20 }),
    cls = h('input', { value: c.cls, maxlength: 40, placeholder: D ? 'Guerreiro, Mago…' : 'Classe, arquétipo, papel…', list: 'rpg-cls' }),
    race = h('input', { value: c.race || '', maxlength: 30, placeholder: D ? 'Humano, Elfo…' : 'Raça, origem…', list: 'rpg-race' }), img = imgField(c.img),
    hpMax = h('input', { type: 'number', value: c.hp.max, min: 0 }), hpCur = h('input', { type: 'number', value: c.hp.cur }),
    resName = h('input', { value: c.res?.name || '', placeholder: 'Mana, energia… (vazio = não usa)', maxlength: 20 }), resMax = h('input', { type: 'number', value: c.res?.max ?? 10, min: 0 }),
    tags = h('input', { value: c.tags.join(', '), placeholder: 'curiosa, devendo favor…' }), skills = h('textarea', { rows: 3, maxlength: 2000 }, c.skills), notes = h('textarea', { rows: 2, maxlength: 2000 }, c.notes);
  // atributos: valor (o que você distribui) + bônus (raça, aumentos de nível) = total; o modificador sai do total
  const keys = [...new Set([...T.attrs, ...Object.keys(c.attrs)])], rows = new Map(), table = h('div.rpg-at');
  const info = h('div.rpg-at-info'), hpHint = h('button.btn.grey.sm', { type: 'button', hidden: true });
  const total = (k) => (+rows.get(k).base.value || 0) + (+rows.get(k).bon.value || 0);
  let method = ch ? 'livre' : 'pontos';
  const rollStats = () => { for (let i = 1; i <= 6; i++) send({ op: 'roll', expr: '4d6dl1', label: `Atributo ${i} de 6`, ...(ch ? { as: 'c:' + ch.id } : {}) }); };
  const methodSel = D && h('div.rpg-seg', [['pontos', 'Compra de pontos'], ['padrao', 'Conjunto padrão'], ['rolar', 'Rolar 4d6'], ['livre', 'Livre']].map(([v, l]) =>
    h('button', { type: 'button', 'data-m': v, onclick: () => { method = v; if (v === 'pontos') for (const r of rows.values()) if (COST[+r.base.value] == null) r.base.value = 8; if (v === 'rolar') rollStats(); update(); } }, l)));
  const update = () => {
    if (!D) return;
    methodSel.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === method));
    let spent = 0, bad = false;
    for (const [k, r] of rows) {
      const b = +r.base.value || 0, t = total(k); r.tot.textContent = t; r.mod.textContent = sgn(mod(t));
      r.el.classList.toggle('warn', t > 20); if (COST[b] == null) bad = true; else spent += COST[b];
    }
    const cn = cls.value.trim(), cl = CLASSES[cn], l = Math.max(1, +lvl.value || 1), asi = ASI(cn, l), notes = [];
    if (method === 'pontos') notes.push(h('span' + (spent > POINTS || bad ? '.bad' : ''), bad ? 'Na compra de pontos cada valor vai de 8 a 15.' : `Pontos: ${spent} de ${POINTS}${spent < POINTS ? ` (sobram ${POINTS - spent})` : spent > POINTS ? ' — passou do limite' : ''}`));
    if (method === 'padrao') notes.push(h('span', 'Distribua 15, 14, 13, 12, 10 e 8, um em cada atributo.'));
    if (method === 'rolar') notes.push(h('span', 'Os 6 resultados (4d6, sem o menor) aparecem no histórico: ponha um em cada atributo.'));
    if (cl) notes.push(h('span', `${cn}: dado de vida d${cl[0]}, priorize ${cl[1].split(' ').slice(0, 2).join(' e ')}. `,
      method !== 'rolar' && h('button.rpg-link', { type: 'button', onclick: () => { method = 'padrao'; cl[1].split(' ').forEach((k, i) => { if (rows.get(k)) rows.get(k).base.value = ARRAY[i]; }); update(); } }, 'Distribuir pela classe')));
    const rc = race.value.trim(); if (RACE_NOTE[rc]) notes.push(h('span', `${rc}: ${RACE_NOTE[rc]}.`));
    notes.push(h('span', `Nível ${l}: proficiência ${sgn(prof(l))}`, asi ? `; ${asi} aumento${asi > 1 ? 's' : ''} de atributo (+2 num ou +1 em dois, na coluna bônus).` : '.'));
    if ([...rows.keys()].some(k => total(k) > 20)) notes.push(h('span.bad', 'Acima de 20 só com itens mágicos ou dons especiais.'));
    info.replaceChildren(...notes);
    const hs = rows.get('CON') && hpSuggest(cn, l, total('CON'));
    hpHint.hidden = !hs; if (hs) { hpHint.textContent = `Usar ${hs} (sugerida)`; hpHint.onclick = () => { hpMax.value = hs; hpCur.value = hs; }; }
  };
  const step = (inp, n) => h('button.rpg-step', { type: 'button', title: n > 0 ? '+1' : '−1', onclick: () => { inp.value = (+inp.value || 0) + n; update(); } }, n > 0 ? '+' : '−');
  const addAttr = (k, v, bon) => {
    if (!k || rows.has(k)) return;
    const base = h('input', { type: 'number', value: v ?? (D ? 8 : 0), oninput: update }), b = h('input', { type: 'number', value: bon || 0, oninput: update, title: 'Bônus de raça e aumentos de atributo' });
    const r = { base, bon: b, tot: h('b'), mod: h('b.rpg-at-mod') };
    r.el = D ? h('div.rpg-at-row', h('span.rpg-at-k', k), h('span.rpg-at-base', step(base, -1), base, step(base, 1)), b, r.tot, r.mod) : h('div.rpg-at-row.livre', h('span.rpg-at-k', k), base);
    rows.set(k, r); table.append(r.el);
  };
  if (D) table.append(h('div.rpg-at-row.head', h('span', 'Atributo'), h('span', 'Valor'), h('span', 'Bônus'), h('span', 'Total'), h('span', 'Mod.')));
  keys.forEach(k => addAttr(k, c.attrs[k], c.abon?.[k]));
  race.addEventListener('change', () => { const rb = RACES[race.value.trim()]; if (rb) for (const [k, r] of rows) r.bon.value = rb[k] || 0; update(); });
  cls.addEventListener('input', update); lvl.addEventListener('input', update);
  const newAttr = h('input', { placeholder: 'Outro atributo', maxlength: 12, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addAttr(newAttr.value.trim()); newAttr.value = ''; update(); } } });
  const owners = isGM() && !ch ? h('select', callIds().map(u => h('option', { value: u, selected: u === me() }, who(u)))) : null;
  const body = h('div.rpg-form.sheet', opts('rpg-cls', D ? Object.keys(CLASSES) : []), opts('rpg-race', D ? Object.keys(RACES) : []),
    h('div.rpg-row', field('Nome', name), field('Nível', lvl)), h('div.rpg-row', field(D ? 'Raça' : 'Origem', race), field('Classe', cls)),
    field('Imagem', img.el), owners && field('Jogador', owners),
    h('div.rpg-field', h('span', 'Atributos'), methodSel, table, info, h('div.rpg-row', newAttr, h('button.btn.grey.sm', { type: 'button', onclick: () => { addAttr(newAttr.value.trim()); newAttr.value = ''; update(); } }, 'Adicionar'))),
    h('div.rpg-row', field('Vida máxima', hpMax), field('Vida atual', hpCur), h('div.rpg-field.end', hpHint)),
    h('div.rpg-row', field('Recurso extra', resName), field('Máximo', resMax)),
    field('Tags (separadas por vírgula)', tags), field('Habilidades', skills), field('Observações', notes));
  update();
  const save = () => {
    const attrs = {}, abon = {}; for (const [k, r] of rows) { attrs[k] = +r.base.value || 0; if (+r.bon.value) abon[k] = +r.bon.value; }
    send({ op: 'char.save', char: { id: ch?.id, owner: owners?.value, name: name.value, cls: cls.value, race: race.value, level: +lvl.value, img: img.get(), hp: { max: +hpMax.value, cur: ch ? +hpCur.value : +hpMax.value },
      res: resName.value.trim() ? { name: resName.value, max: +resMax.value, cur: ch?.res ? ch.res.cur : +resMax.value } : null, attrs, abon, tags: tags.value.split(',').map(x => x.trim()).filter(Boolean), skills: skills.value, notes: notes.value } });
  };
  modal(ch ? 'Editar ficha' : 'Nova ficha', ch ? null : 'Tudo pode mudar depois, até no meio da sessão.', body, [
    ch && { label: 'Apagar', cls: 'red', fn: () => { modal('Apagar a ficha?', `${ch.name} some da mesa.`, null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Apagar', cls: 'red', fn: () => send({ op: 'char.del', id: ch.id }) }]); } },
    { label: 'Cancelar', cls: 'grey' }, { label: 'Salvar', fn: save }].filter(Boolean), { width: '620px' });
}
function foeModal(f) {
  const x = f || { name: '', boss: false, mode: 'show', hp: { cur: 10, max: 10 }, ini: 0, attacks: '', abilities: '', resist: '', weak: '', notes: '' };
  const name = h('input', { value: x.name, maxlength: 40, placeholder: 'Goblin, Dragão vermelho…' }), img = imgField(x.img),
    boss = h('input', { type: 'checkbox', checked: x.boss }), hpMax = h('input', { type: 'number', value: x.hp.max, min: 0 }), hpCur = h('input', { type: 'number', value: x.hp.cur }), ini = h('input', { type: 'number', value: x.ini || 0 }),
    mode = h('select', [['show', 'Visível: números e barra'], ['hidden', 'Oculta: só o dano causado'], ['narr', 'Narrativa: só o estado (ferido, quase caindo…)']].map(([v, l]) => h('option', { value: v, selected: v === x.mode }, l))),
    attacks = h('textarea', { rows: 2, placeholder: 'Mordida: +5 para acertar, 2d6+3 perfurante' }, x.attacks), abilities = h('textarea', { rows: 2 }, x.abilities), resist = h('input', { value: x.resist, placeholder: 'fogo, veneno…' }), weak = h('input', { value: x.weak, placeholder: 'gelo, prata…' }), notes = h('textarea', { rows: 2 }, x.notes);
  const body = h('div.rpg-form', field('Nome', name), field('Imagem', img.el), h('label.rpg-check', boss, 'Chefe'),
    h('div.rpg-row', field('Vida máxima', hpMax), field('Vida atual', hpCur), field('Bônus de iniciativa', ini)), field('Como os jogadores veem a vida', mode),
    field('Ataques', attacks), field('Habilidades', abilities), h('div.rpg-row', field('Resistências', resist), field('Fraquezas', weak)), field('Anotações', notes));
  modal(f ? 'Editar inimigo' : 'Novo inimigo', 'Ataques, defesas e anotações só o mestre vê.', body, [
    { label: 'Cancelar', cls: 'grey' },
    { label: 'Salvar', fn: () => send({ op: 'foe.save', foe: { id: f?.id, name: name.value, img: img.get(), boss: boss.checked, mode: mode.value, ini: +ini.value, hp: { max: +hpMax.value, cur: f ? +hpCur.value : +hpMax.value }, attacks: attacks.value, abilities: abilities.value, resist: resist.value, weak: weak.value, notes: notes.value } }) },
  ], { width: '540px' });
}
function hpModal(t, kind, res = false) {
  const p = res ? t.res : t.hp, n = h('input', { type: 'number', min: 0, placeholder: 'Quanto?', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(-1); m.close(); } } });
  const go = (sign) => { const v = Math.abs(+n.value || 0); if (!v && sign) return; send({ op: kind === 'f' ? 'foe.hp' : 'char.hp', id: t.id, res, ...(sign ? { delta: sign * v } : { set: +n.value || 0 }) }); };
  const m = modal(`${t.name}: ${res ? p.name : 'vida'}`, `Agora: ${p.cur} de ${p.max}`, h('div.rpg-form', n), [
    { label: 'Definir', cls: 'grey', fn: () => go(0) }, { label: res ? 'Recuperar' : 'Curar', cls: 'green', fn: () => go(1) }, { label: res ? 'Gastar' : 'Dano', cls: 'red', fn: () => go(-1) }]);
}
function tagModal(ch) {
  const name = h('input', { placeholder: 'Ex.: ferido, procurado, devendo favor', maxlength: 24 });
  modal(`Tag para ${ch.name}`, 'Tags descrevem o personagem e todos veem na hora.', name, [{ label: 'Cancelar', cls: 'grey' },
    { label: 'Adicionar', fn: () => { const v = name.value.trim(); if (!v) return false; send({ op: 'tags', id: ch.id, tags: [...ch.tags, v] }); } }]);
}
function initModal(e, t) {
  const n = h('input', { type: 'number', value: e.init ?? '', placeholder: 'Valor' });
  modal(`Iniciativa: ${t.name}`, `Rolar usa ${T.initRoll}${e.kind === 'f' && t.ini ? ` ${sgn(t.ini)}` : ''}.`, n, [{ label: 'Cancelar', cls: 'grey' },
    { label: 'Definir', cls: 'grey', fn: () => { if (n.value === '') return false; send({ op: 'combat.init', id: e.id, set: +n.value }); } },
    { label: 'Rolar de novo', fn: () => send({ op: 'combat.init', id: e.id }) }]);
}

// ---------- quadro ----------
function render() {
  if (!node || !T) return;
  const gm = isGM(), tabs = [['mesa', T.combat ? `Mesa · rodada ${T.combat.round}` : 'Mesa'], gm && ['mestre', 'Mestre']].filter(Boolean);
  barInfo.replaceChildren(h('b', T.name), h('span.rpg-gm', { title: 'Mestre da sessão' }, icon('crown', 12), gm ? 'Você é o mestre' : who(T.gm)),
    !gm && !callIds().includes(T.gm) && h('button.rpg-link', { onclick: () => send({ op: 'gm.set' }) }, 'Assumir como mestre'));
  tabsEl.replaceChildren(...(tabs.length > 1 ? tabs.map(([k, l]) => h('button.rpg-tab' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; render(); } }, l)) : []));
  const top = bodyEl.scrollTop;
  bodyEl.replaceChildren(...[tab === 'mestre' && gm ? tabGM() : tabMesa()].flat(2).filter(Boolean)); bodyEl.scrollTop = top;
  // rolando como: o mestre escolhe qualquer um; o jogador, uma das fichas dele
  const choices = gm ? [['', 'Mestre'], ...T.chars.map(c => ['c:' + c.id, c.name]), ...T.foes.map(f => ['f:' + f.id, `${f.name} (inimigo)`])] : myChars().map(c => ['c:' + c.id, c.name]);
  if (!gm && (!rollAs || !choices.some(([v]) => v === rollAs))) rollAs = T.active[me()] ? 'c:' + T.active[me()] : '';
  if (gm && rollAs && !choices.some(([v]) => v === rollAs)) rollAs = '';
  asSel.replaceChildren(...(choices.length ? choices.map(([v, l]) => h('option', { value: v, selected: v === rollAs }, l)) : [h('option', { value: '' }, 'Sem ficha')]));
  asSel.disabled = choices.length < 2;
  logTabs.forEach(b => b.classList.toggle('on', (b.dataset.all === '1') === logAll));
  sideLog.replaceChildren(...T.log.filter(e => logAll || e.kind === 'roll').slice(-40).reverse().map(logItem));
  if (!sideLog.childElementCount) sideLog.append(h('li.rpg-empty', 'Rolagens e o que acontece na mesa aparecem aqui.'));
  syncToggles();
}
export function rpgTile({ onFocus, onClose }) {
  if (node) return node;
  barInfo = h('div.rpg-title'); tabsEl = h('div.rpg-tabs'); bodyEl = h('div.rpg-body'); sideLog = h('ul.rpg-log');
  resultEl = h('div.rpg-result', h('div.rpg-res.idle', h('div.rpg-res-tag', 'Escolha os dados e role')));
  exprIn = h('input.rpg-expr', { placeholder: '1d20+3, 4d6dl1, 1d20+@FOR…', maxlength: 120, spellcheck: false,
    oninput: () => { exprIn.dataset.fresh = ''; },
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); doRoll(exprIn.value); exprIn.dataset.fresh = '1'; } } });
  asSel = h('select.rpg-as', { title: 'Quem está rolando (os @ATRIBUTOS vêm da ficha)', onchange: () => setAs(asSel.value) });
  advBtns = { adv: h('button.rpg-tog', { title: 'Rola 2d20 e fica o maior', onclick: () => { adv = adv === 'adv' ? null : 'adv'; syncToggles(); } }, 'Vantagem'),
    dis: h('button.rpg-tog', { title: 'Rola 2d20 e fica o menor', onclick: () => { adv = adv === 'dis' ? null : 'dis'; syncToggles(); } }, 'Desvantagem') };
  secretBtn = h('button.rpg-tog', { title: 'Só você (mestre) vê o resultado', onclick: () => { secret = !secret; syncToggles(); } }, 'Secreta');
  const custom = h('input.rpg-cust', { type: 'number', min: 2, max: 1000, placeholder: 'dX', title: 'Dado com qualquer número de faces', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && +custom.value >= 2) { addDie(+custom.value); custom.value = ''; } } });
  logTabs = [h('button.rpg-ltab', { 'data-all': '1', onclick: () => { logAll = true; render(); } }, 'Tudo'), h('button.rpg-ltab', { 'data-all': '0', onclick: () => { logAll = false; render(); } }, 'Rolagens')];
  const side = h('div.rpg-side',
    h('div.rpg-roller',
      h('label.rpg-asrow', h('span', 'Rolando como'), asSel),
      resultEl,
      h('div.rpg-dicerow', [4, 6, 8, 10, 12, 20, 100].map(f => h('button.rpg-dbtn', { title: `Adicionar 1d${f}`, onclick: () => addDie(f) }, 'd' + f)), custom),
      h('div.rpg-exprrow', h('button.rpg-mbtn', { title: 'Modificador −1', onclick: () => addMod(-1) }, '−'), exprIn, h('button.rpg-mbtn', { title: 'Modificador +1', onclick: () => addMod(1) }, '+')),
      h('div.rpg-togrow', advBtns.adv, advBtns.dis, secretBtn),
      h('div.rpg-rollrow', h('button.btn.rpg-go', { onclick: () => { doRoll(exprIn.value); exprIn.dataset.fresh = '1'; } }, 'Rolar'),
        h('button.btn.grey', { title: 'Rolar de novo a última', onclick: () => (lastExpr ? doRoll(lastExpr) : toast('Nenhuma rolagem ainda')) }, icon('refresh', 16)))),
    h('div.rpg-loghead', h('span', 'Histórico'), h('div.rpg-ltabs', logTabs)),
    sideLog);
  node = h('div.tile.rpgtile', { 'data-key': 'rpg', onclick: (e) => e.stopPropagation(), onkeydown: (e) => { if (e.target.matches('input,textarea,select')) e.stopPropagation(); } },
    h('div.rpg-top', icon('dice', 18), barInfo, tabsEl, h('span.sp'),
      h('button.ibtn', { title: 'Destacar / voltar à grade', onclick: onFocus }, icon('expand', 16)),
      h('button.ibtn', { title: 'Fechar a mesa (a campanha fica guardada)', onclick: onClose }, icon('x', 16))),
    h('div.rpg-main', bodyEl, side));
  render();
  return node;
}
