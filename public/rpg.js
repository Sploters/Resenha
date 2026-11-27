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

let T = null, node = null, tab = 'mesa', seen = null, adv = null, secret = false, lastExpr = '', rollAs = '', sel = null, selTurn = null, logAll = true, sheetOpen = null, jrFilter = '', known = null;
// animação dos dados e som: escolha de cada um (fica neste aparelho)
const fxp = (() => { try { return { anim: true, sound: false, ...JSON.parse(localStorage.rpgFx || '{}') }; } catch { return { anim: true, sound: false }; } })();
const saveFx = () => { try { localStorage.rpgFx = JSON.stringify(fxp); } catch { /* sem armazenamento */ } };
let actx = null;
function beep(kind) {
  if (!fxp.sound) return;
  try {
    actx ||= new AudioContext();
    const notes = kind === 'crit' ? [523, 659, 784] : kind === 'fumble' ? [392, 311, 233] : kind === 'ping' ? [660, 880] : [440];
    notes.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * .09; o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.08, t0 + .01); g.gain.exponentialRampToValueAtTime(.0001, t0 + .16); o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + .18); });
  } catch { /* sem áudio */ }
}
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
  if (prev !== seen) { const i = prev ? d.log.findIndex(e => e.id === prev) : -1, fresh = d.log.slice(i + 1).filter(e => e.kind === 'roll'); if (fresh.length) showResult(fresh.at(-1), !!prev); }
  // aviso (som) quando chega algo para mim: teste pedido, reação oferecida, momento decisivo
  const mine = new Set(d.chars.filter(c => c.owner === me()).map(c => c.id));
  const now = new Set([...d.asks.filter(a => a.open && a.targets.some(t => mine.has(t))).map(a => a.id), ...d.offers.filter(o => mine.has(o.char)).map(o => o.id), ...d.events.filter(e => e.open).map(e => e.id)]);
  if (known && [...now].some(x => !known.has(x))) beep('ping');
  known = now;
  render();
  if (sheetOpen) { if (sheetOpen.el.isConnected) renderSheet(); else sheetOpen = null; }
}
export const rpgReset = () => { T = null; node = null; seen = null; sel = selTurn = null; rollAs = ''; known = null; sheetOpen = null; };
export const rpgError = (d) => toast(d.error || 'Não deu certo', true);

// ---------- rolagem ----------
function doRoll(expr, label, as = rollAs) {
  expr = String(expr || '').trim(); if (!expr) return toast('Escolha os dados ou digite uma rolagem, como 1d20+3', true);
  lastExpr = expr; send({ op: 'roll', expr, label: label || '', adv, ...(secret ? (isGM() ? { secret: true } : { priv: true }) : {}), ...(as ? { as } : {}) });
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
const syncToggles = () => {
  if (!advBtns) return; advBtns.adv.classList.toggle('on', adv === 'adv'); advBtns.dis.classList.toggle('on', adv === 'dis'); secretBtn.classList.toggle('on', secret);
  secretBtn.textContent = isGM() ? 'Secreta' : 'Privada'; secretBtn.title = isGM() ? 'Só você (mestre) vê o resultado' : 'Só você e o mestre veem o resultado';
};
// quem rola: o mestre escolhe qualquer ficha ou inimigo; o jogador, uma das fichas dele
function setAs(v) { rollAs = v; if (asSel) asSel.value = v; const [k, id] = v.split(':'); if (k === 'c' && charOf(id)?.owner === me() && T.active[me()] !== id) send({ op: 'char.active', id }); }

function diceChips(r) {
  return h('span.rpg-dice', r.parts.map((p, i) => [i || p.sign < 0 ? h('span.rpg-op', p.sign < 0 ? '−' : '+') : null,
    p.rolls ? h('span.rpg-grp', { title: p.t }, p.rolls.map(x => h('span.rpg-die' + (x.drop ? '.drop' : '') + (x.v === p.faces ? '.max' : x.v === 1 ? '.min' : ''),
      { title: x.was != null ? `Rerrolado (era ${x.was})` : x.ex ? 'Explodiu' : x.drop ? 'Descartado' : `d${p.faces}` }, x.was != null && h('s', String(x.was)), String(x.v)))) : h('span.rpg-mod', p.t.startsWith('@') ? `${p.t.slice(1)} ${sgn(p.v)}` : String(p.v))]));
}
const rollWho = (e) => e.who || (e.char && charOf(e.char)?.name) || who(e.uid);
const checkTxt = (c) => (c.ok == null ? null : `${c.ok ? 'Sucesso' : 'Falha'}${c.dc != null ? ` · CD ${c.dc}` : c.hid ? ' · CD escondida' : ''}`);
// resultado em destaque; com animação, o número gira um instante antes de parar (e o crítico/falha pulsa)
function showResult(e, live) {
  if (!resultEl) return;
  const r = e.roll, c = e.check, cls = c?.ok === true ? '.ok' : c?.ok === false ? '.no' : r.crit ? '.crit' : r.fumble ? '.fumble' : '';
  const tot = h('div.rpg-res-total', String(r.total));
  const card = h('div.rpg-res' + cls,
    h('div.rpg-res-who', rollWho(e), e.label && e.label !== r.expr ? ` · ${e.label}` : '', e.gm ? ' · secreta' : e.priv ? ' · privada' : ''),
    tot,
    h('div.rpg-res-tag', c?.ok != null ? checkTxt(c) + (r.crit ? ' (20 natural)' : r.fumble ? ' (1 natural)' : '') : r.crit ? 'Crítico' : r.fumble ? 'Falha crítica' : r.expr + (r.adv === 'adv' ? ' · vantagem' : r.adv === 'dis' ? ' · desvantagem' : '')),
    diceChips(r), e.fx?.length > 0 && h('div.rpg-res-fx', e.fx.join(' · ')));
  resultEl.replaceChildren(card);
  if (!live) return;
  beep(r.crit ? 'crit' : r.fumble ? 'fumble' : 'roll');
  const max = r.parts.reduce((s, p) => s + (p.faces ? p.faces : 0), 0) || 20;
  if (fxp.anim && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    card.classList.add('spin'); let k = 0;
    const t = setInterval(() => { tot.textContent = String(1 + Math.floor(Math.random() * max)); if (++k >= 9) { clearInterval(t); tot.textContent = String(r.total); card.classList.remove('spin'); card.classList.add('land'); } }, 45);
  }
}

// ---------- histórico (compacto: uma linha por coisa; clicar numa rolagem mostra os dados) ----------
function logItem(e) {
  const when = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (e.kind === 'roll') {
    const r = e.roll, c = e.check, li = h('li.rpg-li.roll' + (r.crit ? '.crit' : r.fumble ? '.fumble' : ''), { title: `${when} · ${r.expr}`, onclick: () => li.classList.toggle('open') },
      h('div.rpg-li-row', h('b', rollWho(e)), h('span.rpg-li-lab', e.label || r.expr), (e.gm || e.priv) && h('span.rpg-li-sec', { title: e.gm ? 'Secreta: só o mestre vê' : 'Privada: quem rolou e o mestre' }, icon('eyeoff', 12)),
        c?.ok != null && h('span.rpg-li-chk' + (c.ok ? '.ok' : '.no'), c.ok ? '✓' : '✗'), h('span.rpg-total', String(r.total))),
      h('div.rpg-li-det', diceChips(r), c?.ok != null && h('div.muted', checkTxt(c)), e.fx?.length > 0 && h('div.muted', e.fx.join(' · '))));
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
const condDesc = (n) => { const d = T.conds.find(c => c.name.toLowerCase() === String(n).toLowerCase()); return d ? [d.desc, d.adv === 'adv' ? 'Vantagem no d20' : d.adv === 'dis' ? 'Desvantagem no d20' : '', d.bonus && `${d.bonus} no d20`, d.tick && `${d.tick} de dano por turno`].filter(Boolean).join(' · ') : ''; };
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
    h('div.rpg-card-head', h('button.rpg-open', { title: 'Abrir a ficha', onclick: () => openSheet(ch) }, portrait(ch, 'c')),
      h('button.rpg-card-id.rpg-open', { title: 'Abrir a ficha', onclick: () => openSheet(ch) }, h('b', ch.name, ch.insp > 0 && h('span.rpg-insp', { title: `Inspiração ${ch.insp}/${T.insp.max}` }, icon('star', 12), ch.insp)), h('span', subtitle(ch))),
      isGM() && h('button.ibtn', { title: `Dar inspiração (${ch.insp}/${T.insp.max})`, onclick: () => send({ op: 'insp', id: ch.id, delta: 1 }) }, icon('sparkle', 16)),
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
      const s = C.order.find(e => e.id === sel), sn = s && ent(s.kind, s.ref)?.name;
      menu(ev, [{ label: 'Voltar um turno', icon: 'chevl', fn: () => send({ op: 'combat.prev' }) },
        sn && { label: `${sn}: jogar antes`, icon: 'chevl', fn: () => send({ op: 'combat.move', id: s.id, dir: -1 }) },
        sn && { label: `${sn}: jogar depois`, icon: 'chevr', fn: () => send({ op: 'combat.move', id: s.id, dir: 1 }) },
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
  const condNames = [...new Set([...T.conds.map(c => c.name), ...(t.conds || []).map(c => c.name)])];
  const asVal = (isF ? 'f:' : 'c:') + t.id;
  return h('div.rpg-focus',
    h('div.rpg-focus-head', isF ? portrait(t, e.kind, 48) : h('button.rpg-open', { title: 'Abrir a ficha', onclick: () => openSheet(t) }, portrait(t, e.kind, 48)),
      h('div.rpg-card-id', h('b', t.boss && icon('crown', 14), t.name, t.insp > 0 && h('span.rpg-insp', icon('star', 12), t.insp)),
        h('span', turn ? 'Vez agora' : 'Selecionado', ' · ', isF ? [t.kind || (t.boss ? 'Chefe' : 'Inimigo'), (t.phaseName || t.phases?.[t.phase]?.name) && ` · fase ${t.phaseName || t.phases[t.phase].name}`] : who(t.owner))),
      h('button.rpg-init-btn', { title: can ? 'Mudar a iniciativa' : 'Iniciativa', disabled: !can, onclick: () => initModal(e, t) }, h('small', 'Inic.'), h('b', String(e.init ?? '–'))),
      gm && h('button.ibtn', { title: 'Tirar do combate', onclick: () => send({ op: 'combat.remove', id: e.id }) }, icon('x', 16))),
    h('div.rpg-focus-hp', t.hp ? bar(t.hp, 'hp' + (isF ? '.foe' : ''), 'Vida', null) : h('div.rpg-hptext', foeHp(t)),
      can && h('div.rpg-hit', amt, h('button.btn.red.sm', { onclick: () => hit(-1) }, 'Dano'), h('button.btn.green.sm', { onclick: () => hit(1) }, 'Cura'))),
    !isF && t.res && bar(t.res, 'res', t.res.name, can ? () => hpModal(t, 'c', true) : null),
    T.economy?.length > 0 && h('div.rpg-focus-sec', h('span.rpg-lab', 'No turno'), h('div.rpg-chips', T.economy.map(n => { const used = (e.used || []).includes(n);
      return h('button.rpg-chip.eco' + (used ? '.used' : ''), { title: used ? `${n}: gasta neste turno` : `${n}: disponível`, disabled: !can, onclick: () => send({ op: 'eco', id: e.id, name: n }) }, n); }))),
    gm && !isF && h('div.rpg-quick',
      T.reactions?.length > 0 && h('button.btn.grey.sm', { onclick: (ev) => menu(ev, T.reactions.map(r => ({ label: r.name, hint: r.desc, fn: () => send({ op: 'react.offer', char: t.id, name: r.name }) }))) }, 'Oferecer reação'),
      h('button.btn.grey.sm', { onclick: () => askModal({ target: t.id }) }, 'Pedir teste'),
      h('button.btn.grey.sm', { onclick: () => send({ op: 'insp', id: t.id, delta: 1 }) }, 'Dar inspiração')),
    isF && t.desc && h('p.rpg-pre.muted', t.desc),
    isF && gm && t.phases?.length > 0 && h('div.rpg-focus-sec', h('span.rpg-lab', 'Fases (mudam sozinhas pela vida)'), h('div.rpg-chips',
      h('button.rpg-chip.tog' + (t.phase < 0 ? '.on' : ''), { onclick: () => send({ op: 'foe.phase', id: t.id, idx: -1 }) }, 'Normal'),
      t.phases.map((p, i) => h('button.rpg-chip.tog' + (t.phase === i ? '.on' : ''), { title: `${p.at}% da vida${p.note ? ' · ' + p.note : ''}`, onclick: () => send({ op: 'foe.phase', id: t.id, idx: i }) }, p.name)))),
    h('div.rpg-focus-sec', h('span.rpg-lab', 'Condições'),
      can ? [h('div.rpg-chips', condNames.map(n => { const on = active.get(n.toLowerCase());
        return h('button.rpg-chip.tog' + (on ? '.on' : ''), { title: condDesc(n), onclick: () => toggle(n) }, n, on?.turns != null && h('small', ` ${on.turns}`)); })),
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
    h('section.rpg-player', h('div.rpg-player-h', h('b', 'Conduzir')),
      h('div.rpg-actions',
        h('button.rpg-action', { onclick: () => askModal({}) }, icon('dice', 20), h('b', 'Pedir teste'), h('span', 'Perícia ou atributo, com CD, para um ou para o grupo')),
        h('button.rpg-action', { onclick: () => eventModal() }, icon('compass', 20), h('b', 'Momento decisivo'), h('span', 'Opções para o grupo votar, com teste opcional')),
        h('button.rpg-action', { onclick: () => jrModal({ kind: 'missao' }) }, icon('pin', 20), h('b', 'Nova missão'), h('span', 'Entra no diário para todos')),
        h('button.rpg-action', { onclick: () => restModal() }, icon('moon', 20), h('b', 'Descanso'), h('span', 'Curto ou longo: recupera vida e recursos')))),
    h('section.rpg-player', h('div.rpg-player-h', h('b', 'Inimigos e NPCs'), h('span.muted', `${T.foes.filter(f => f.shown).length} em cena`),
      h('button.btn.grey.sm', { onclick: () => foeModal(null) }, icon('plus', 14), 'Novo')),
    T.foes.length ? h('div.rpg-grid', T.foes.map(foeCard)) : h('p.rpg-empty', 'Prepare os inimigos aqui. Ficam escondidos até você pôr em cena (o olho).')),
    h('details.rpg-player.rpg-rules', h('summary', h('b', 'Regras da mesa'), h('span.muted', 'sistema, atributos, perícias, condições, reações, inspiração, descanso')), cfgForm()),
    h('section.rpg-player', h('div.rpg-player-h', h('b', 'Mestre')),
      h('div.rpg-quick', others.map(u => h('button.btn.grey.sm', { onclick: () => modal('Passar o posto de mestre?', `${who(u)} passa a controlar inimigos, combate e regras.`, null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Passar', fn: () => send({ op: 'gm.set', uid: u }) }]) }, 'Passar para ', who(u))),
        h('button.btn.grey.sm', { onclick: () => modal('Limpar o histórico?', 'Some para todos. As fichas e os inimigos ficam.', null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Limpar', cls: 'red', fn: () => send({ op: 'log.clear' }) }]) }, 'Limpar histórico'))),
  ];
}
// condições em texto, uma por linha: "Nome; efeitos; descrição" — efeitos: vantagem, desvantagem, +1d4 (bônus), dano 1d4 (por turno)
const condLine = (c) => [c.name, [c.adv === 'adv' && 'vantagem', c.adv === 'dis' && 'desvantagem', c.bonus, c.tick && `dano ${c.tick}`].filter(Boolean).join(', '), c.desc || ''].join('; ').replace(/(; )+$/, '');
const parseConds = (txt) => txt.split('\n').map(l => l.split(';').map(s => s.trim())).filter(p => p[0]).map(([name, fx = '', desc = '']) => {
  const c = { name, desc, adv: null, bonus: '', tick: '' };
  for (const t of fx.split(',').map(s => s.trim()).filter(Boolean)) { if (/^vantagem$/i.test(t)) c.adv = 'adv'; else if (/^desvantagem$/i.test(t)) c.adv = 'dis'; else if (/^dano\s+/i.test(t)) c.tick = t.replace(/^dano\s+/i, '').replace(/\s*\/\s*turno$/i, ''); else if (/^[+-]/.test(t)) c.bonus = t; }
  return c;
});
const lines = (v) => v.split('\n').map(l => l.trim()).filter(Boolean);
function cfgForm() {
  const sys = h('select', [['dnd5e', 'D&D 5e: valor do atributo + modificador'], ['livre', 'Livre: o número do atributo vai direto no dado']].map(([v, l]) => h('option', { value: v, selected: v === T.sys }, l)));
  const name = h('input', { value: T.name, maxlength: 40 }), attrs = h('input', { value: T.attrs.join(', ') }), ar = h('input', { value: T.attrRoll }), ir = h('input', { value: T.initRoll });
  const skills = h('textarea', { rows: 5 }, T.skills.map(s => `${s.name}: ${s.attr}`).join('\n')), conds = h('textarea', { rows: 6 }, T.conds.map(condLine).join('\n'));
  const eco = h('input', { value: T.economy.join(', '), placeholder: 'vazio = a mesa não usa' }), reacts = h('textarea', { rows: 3 }, T.reactions.map(r => [r.name, r.desc].filter(Boolean).join('; ')).join('\n'));
  const imax = h('input', { type: 'number', min: 1, max: 10, value: T.insp.max }), ire = h('input', { type: 'checkbox', checked: T.insp.reroll }), iadv = h('input', { type: 'checkbox', checked: T.insp.adv }), nat = h('input', { type: 'checkbox', checked: T.nat });
  const LV = [['none', 'nada'], ['quarter', '¼'], ['half', 'metade'], ['full', 'tudo']], rsel = (k, p) => h('select', { 'data-k': k, 'data-p': p }, LV.map(([v, l]) => h('option', { value: v, selected: T.rest[k][p] === v }, l)));
  const rest = [rsel('short', 'hp'), rsel('short', 'res'), rsel('long', 'hp'), rsel('long', 'res')];
  const list = (v) => v.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  return h('div.rpg-form',
    h('div.rpg-row', field('Nome da mesa', name), field('Sistema', sys)), field('Atributos das fichas', attrs),
    h('div.rpg-row', field('Teste de atributo', ar), field('Iniciativa', ir)),
    h('p.muted', '{m} = modificador, {v} = valor, @DES = modificador (D&D) ou valor (livre) do atributo da ficha, @PROF = proficiência.'),
    field('Perícias (uma por linha: Nome: ATRIBUTO)', skills),
    field('Condições (uma por linha: Nome; efeitos; descrição)', conds),
    h('p.muted', 'Efeitos: vantagem, desvantagem, +1d4 ou -2 (somam no d20), dano 1d4 (no começo do turno). Ex.: Abençoado; +1d4; Soma 1d4 em ataques e testes'),
    h('div.rpg-row', field('Ações por turno', eco), field('Inspiração: máximo', imax)),
    h('div.rpg-quick', h('label.rpg-check', ire, 'Inspiração rola de novo'), h('label.rpg-check', iadv, 'Inspiração dá vantagem'), h('label.rpg-check', nat, '20 natural passa e 1 natural falha nos testes')),
    field('Reações permitidas (uma por linha: Nome; descrição)', reacts),
    h('div.rpg-field', h('span', 'Descanso (quanto recupera)'), h('div.rpg-rest', h('span', 'Curto: vida'), rest[0], h('span', 'recurso'), rest[1], h('span', 'Longo: vida'), rest[2], h('span', 'recurso'), rest[3])),
    h('div', h('button.btn.sm', { onclick: () => send({ op: 'cfg', name: name.value, sys: sys.value, attrs: list(attrs.value), attrRoll: ar.value, initRoll: ir.value,
      skills: lines(skills.value).map(l => { const [n, a] = l.split(':').map(s => s.trim()); return { name: n, attr: (a || '').toUpperCase() }; }),
      conds: parseConds(conds.value), economy: list(eco.value), reactions: lines(reacts.value).map(l => { const [n, ...d] = l.split(';'); return { name: n.trim(), desc: d.join(';').trim() }; }),
      insp: { max: +imax.value, reroll: ire.checked, adv: iadv.checked }, nat: nat.checked,
      rest: Object.fromEntries(['short', 'long'].map(k => [k, Object.fromEntries(rest.filter(s => s.dataset.k === k).map(s => [s.dataset.p, s.value]))])) }) }, 'Salvar regras')));
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
    tags = h('input', { value: c.tags.join(', '), placeholder: 'curiosa, devendo favor…' }), skills = h('textarea', { rows: 3, maxlength: 2000 }, c.skills), notes = h('textarea', { rows: 2, maxlength: 2000 }, c.notes),
    story = h('textarea', { rows: 3, maxlength: 3000, placeholder: 'De onde veio, o que quer, quem deixou para trás…' }, c.story || ''), pnotes = h('textarea', { rows: 2, maxlength: 3000, placeholder: 'Só você e o mestre veem' }, c.pnotes || '');
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
    field('Tags (separadas por vírgula)', tags), field('Características', skills), field('História', story), field('Observações', notes), field('Anotações privadas', pnotes));
  update();
  const save = () => {
    const attrs = {}, abon = {}; for (const [k, r] of rows) { attrs[k] = +r.base.value || 0; if (+r.bon.value) abon[k] = +r.bon.value; }
    send({ op: 'char.save', char: { id: ch?.id, owner: owners?.value, name: name.value, cls: cls.value, race: race.value, level: +lvl.value, img: img.get(), hp: { max: +hpMax.value, cur: ch ? +hpCur.value : +hpMax.value },
      res: resName.value.trim() ? { name: resName.value, max: +resMax.value, cur: ch?.res ? ch.res.cur : +resMax.value } : null, attrs, abon, tags: tags.value.split(',').map(x => x.trim()).filter(Boolean), skills: skills.value, notes: notes.value, story: story.value, pnotes: pnotes.value } });
  };
  modal(ch ? 'Editar ficha' : 'Nova ficha', ch ? null : 'Tudo pode mudar depois, até no meio da sessão.', body, [
    ch && { label: 'Apagar', cls: 'red', fn: () => { modal('Apagar a ficha?', `${ch.name} some da mesa.`, null, [{ label: 'Cancelar', cls: 'grey' }, { label: 'Apagar', cls: 'red', fn: () => send({ op: 'char.del', id: ch.id }) }]); } },
    { label: 'Cancelar', cls: 'grey' }, { label: 'Salvar', fn: save }].filter(Boolean), { width: '620px' });
}
function foeModal(f) {
  const x = f || { name: '', boss: false, mode: 'show', hp: { cur: 10, max: 10 }, ini: 0, attacks: '', abilities: '', resist: '', weak: '', notes: '', kind: '', desc: '', phases: [] };
  const kind = h('input', { value: x.kind || '', maxlength: 40, placeholder: 'Morto-vivo, besta, humanoide…' }), desc = h('textarea', { rows: 2, maxlength: 600, placeholder: 'O que os jogadores veem (aparece para todos)' }, x.desc || '');
  const phases = h('textarea', { rows: 3, placeholder: 'Fúria; 50; passa a atacar duas vezes\nDesespero; 20; invoca lacaios' }, (x.phases || []).map(p => [p.name, p.at, p.note].filter(v => v !== '').join('; ')).join('\n'));
  const name = h('input', { value: x.name, maxlength: 40, placeholder: 'Goblin, Dragão vermelho…' }), img = imgField(x.img),
    boss = h('input', { type: 'checkbox', checked: x.boss }), hpMax = h('input', { type: 'number', value: x.hp.max, min: 0 }), hpCur = h('input', { type: 'number', value: x.hp.cur }), ini = h('input', { type: 'number', value: x.ini || 0 }),
    mode = h('select', [['show', 'Visível: números e barra'], ['hidden', 'Oculta: só o dano causado'], ['narr', 'Narrativa: só o estado (ferido, quase caindo…)']].map(([v, l]) => h('option', { value: v, selected: v === x.mode }, l))),
    attacks = h('textarea', { rows: 2, placeholder: 'Mordida: +5 para acertar, 2d6+3 perfurante' }, x.attacks), abilities = h('textarea', { rows: 2 }, x.abilities), resist = h('input', { value: x.resist, placeholder: 'fogo, veneno…' }), weak = h('input', { value: x.weak, placeholder: 'gelo, prata…' }), notes = h('textarea', { rows: 2 }, x.notes);
  const body = h('div.rpg-form', h('div.rpg-row', field('Nome', name), field('Tipo', kind)), field('Imagem', img.el), field('Descrição', desc), h('label.rpg-check', boss, 'Chefe'),
    h('div.rpg-row', field('Vida máxima', hpMax), field('Vida atual', hpCur), field('Bônus de iniciativa', ini)), field('Como os jogadores veem a vida', mode),
    field('Ataques', attacks), field('Habilidades', abilities), h('div.rpg-row', field('Resistências', resist), field('Fraquezas', weak)),
    field('Fases (opcional, uma por linha: Nome; % da vida em que começa; o que muda)', phases), field('Anotações', notes));
  modal(f ? 'Editar inimigo' : 'Novo inimigo', 'Ataques, defesas e anotações só o mestre vê.', body, [
    { label: 'Cancelar', cls: 'grey' },
    { label: 'Salvar', fn: () => send({ op: 'foe.save', foe: { id: f?.id, name: name.value, img: img.get(), boss: boss.checked, mode: mode.value, ini: +ini.value, hp: { max: +hpMax.value, cur: f ? +hpCur.value : +hpMax.value }, attacks: attacks.value, abilities: abilities.value, resist: resist.value, weak: weak.value, notes: notes.value,
      kind: kind.value, desc: desc.value, phases: lines(phases.value).map(l => { const [n, at, ...note] = l.split(';').map(s => s.trim()); return { name: n, at: +at || 50, note: note.join('; ') }; }) } }) },
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
  const gm = isGM(), tabs = [['mesa', T.combat ? `Mesa · rodada ${T.combat.round}` : 'Mesa'], ['diario', 'Diário'], gm && ['mestre', 'Mestre']].filter(Boolean);
  barInfo.replaceChildren(h('b', T.name), h('span.rpg-gm', { title: 'Mestre da sessão' }, icon('crown', 12), gm ? 'Você é o mestre' : who(T.gm)),
    !gm && !callIds().includes(T.gm) && h('button.rpg-link', { onclick: () => send({ op: 'gm.set' }) }, 'Assumir como mestre'));
  tabsEl.replaceChildren(...(tabs.length > 1 ? tabs.map(([k, l]) => h('button.rpg-tab' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; render(); } }, l)) : []));
  const top = bodyEl.scrollTop;
  bodyEl.replaceChildren(...[prompts(), tab === 'mestre' && gm ? tabGM() : tab === 'diario' ? tabJournal() : tabMesa()].flat(2).filter(Boolean)); bodyEl.scrollTop = top;
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
      h('div.rpg-asrow', h('span', 'Rolando como'), asSel, h('button.ibtn', { title: 'Animação e som', onclick: (e) => menu(e, [
        { label: 'Animação dos dados', checked: fxp.anim, fn: () => { fxp.anim = !fxp.anim; saveFx(); } },
        { label: 'Som nas rolagens e avisos', checked: fxp.sound, fn: () => { fxp.sound = !fxp.sound; saveFx(); if (fxp.sound) beep('ping'); } }]) }, icon('sliders', 16))),
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

// ---------- avisos: teste pedido, reação oferecida, momento decisivo (no topo de qualquer aba) ----------
function prompts() {
  const out = [], gm = isGM(), mine = new Set(myChars().map(c => c.id));
  for (const o of T.offers || []) {
    const ch = charOf(o.char); if (!ch) continue;
    out.push(h('div.rpg-prompt.react', h('div.rpg-prompt-t', h('b', `Reação: ${o.name}`), h('span', ch.name, o.text && ` · ${o.text}`)), o.desc && h('p.muted', o.desc),
      h('div.rpg-quick', ch.owner === me() ? [h('button.btn.sm', { onclick: () => send({ op: 'react.answer', id: o.id, accept: true }) }, 'Reagir'), h('button.btn.grey.sm', { onclick: () => send({ op: 'react.answer', id: o.id, accept: false }) }, 'Deixar passar')]
        : gm && [h('span.muted', `Esperando ${who(ch.owner)}…`), h('button.btn.grey.sm', { onclick: () => send({ op: 'react.answer', id: o.id, accept: false }) }, 'Cancelar')])));
  }
  for (const a of (T.asks || []).filter(x => x.open)) {
    const rows = a.targets.map(cid => {
      const ch = charOf(cid), r = a.res[cid]; if (!ch) return null;
      if (r) return h('span.rpg-rchip' + (r.ok === true ? '.ok' : r.ok === false ? '.no' : ''), `${ch.name} ${r.total}${r.ok == null ? '' : r.ok ? ' ✓' : ' ✗'}`);
      if (mine.has(cid) || gm) return h('button.btn.sm', { onclick: () => send({ op: 'check', ask: a.id, as: 'c:' + cid }) }, `Rolar ${a.key}`, mine.size > 1 || gm ? ` (${ch.name})` : '');
      return h('span.rpg-rchip', `${ch.name}…`);
    });
    out.push(h('div.rpg-prompt', h('div.rpg-prompt-t', h('b', `Teste de ${a.key}`), h('span', a.dc != null ? `CD ${a.dc}` : a.dcHidden ? 'CD escondida' : 'sem CD', a.label && ` · ${a.label}`)),
      gm && (a.pass || a.fail) && h('p.muted', [a.pass && `Sucesso: ${a.pass}`, a.fail && `Falha: ${a.fail}`].filter(Boolean).join(' · ')),
      h('div.rpg-chips', rows), gm && h('div.rpg-quick', h('button.btn.grey.sm', { onclick: () => send({ op: 'ask.close', id: a.id }) }, 'Encerrar teste'))));
  }
  for (const ev of (T.events || []).filter(x => x.open)) {
    const my = ev.votes?.[me()], tally = ev.options.map((_, i) => Object.values(ev.votes || {}).filter(v => v === i).length);
    out.push(h('div.rpg-prompt.event', h('div.rpg-prompt-t', h('b', ev.title), h('span', ev.mode === 'each' ? 'cada um responde' : 'o grupo vota')), ev.text && h('p', ev.text),
      ev.options.length > 0 && h('div.rpg-opts', ev.options.map((t, i) => h('button.rpg-opt' + (my === i ? '.on' : ''), { onclick: () => send({ op: 'ev.vote', id: ev.id, opt: my === i ? -1 : i }) }, h('span', t), tally[i] > 0 && h('b', String(tally[i]))))),
      ev.mode === 'each' && Object.keys(ev.votes || {}).length > 0 && h('p.muted', Object.entries(ev.votes).map(([u, i]) => `${who(u)}: ${ev.options[i]}`).join(' · ')),
      ev.checkRes?.text && h('p.muted', ev.checkRes.text),
      gm && h('div.rpg-quick', h('button.btn.sm', { onclick: () => closeEvent(ev) }, 'Decidir'), h('button.btn.grey.sm', { onclick: () => send({ op: 'ev.del', id: ev.id }) }, 'Descartar'))));
  }
  return out.length ? h('div.rpg-prompts', out) : null;
}
const keyOptions = (sel) => [h('optgroup', { label: 'Perícias' }, T.skills.map(s => h('option', { value: s.name, selected: s.name === sel }, `${s.name} (${s.attr})`))),
  h('optgroup', { label: 'Atributos' }, T.attrs.map(a => h('option', { value: a, selected: a === sel }, a)))];
function askModal({ target, key }) {
  const k = h('select', keyOptions(key)), dc = h('input', { type: 'number', min: 1, max: 40, value: 15 }), hid = h('input', { type: 'checkbox' }),
    tgt = h('select', h('option', { value: '' }, 'O grupo (fichas em uso na chamada)'), T.chars.map(c => h('option', { value: c.id, selected: c.id === target }, `${c.name} (${who(c.owner)})`))),
    label = h('input', { maxlength: 80, placeholder: 'Ex.: abrir a fechadura' }), pass = h('input', { maxlength: 300, placeholder: 'O que acontece se passar (opcional)' }), fail = h('input', { maxlength: 300, placeholder: 'A complicação se falhar (opcional)' });
  modal('Pedir teste', 'Cada jogador rola pelo aviso que aparece na mesa. A falha pode virar complicação em vez de travar a história.', h('div.rpg-form',
    h('div.rpg-row', field('Perícia ou atributo', k), field('Dificuldade (CD)', dc)), h('label.rpg-check', hid, 'Esconder a CD dos jogadores'),
    field('Para quem', tgt), field('Situação', label), field('Se passar', pass), field('Se falhar', fail)), [
    { label: 'Cancelar', cls: 'grey' },
    { label: 'Pedir', fn: () => send({ op: 'ask', key: k.value, dc: dc.value === '' ? null : +dc.value, dcHidden: hid.checked, targets: tgt.value ? [tgt.value] : [], label: label.value, pass: pass.value, fail: fail.value }) }], { width: '520px' });
}
function eventModal() {
  const title = h('input', { maxlength: 80, placeholder: 'O guarda desconfia' }), text = h('textarea', { rows: 3, maxlength: 600, placeholder: 'O que está acontecendo' }),
    opts = h('textarea', { rows: 3, placeholder: 'Convencer\nLutar\nFugir' }), mode = h('select', h('option', { value: 'vote' }, 'O grupo vota'), h('option', { value: 'each' }, 'Cada um responde')),
    withCheck = h('input', { type: 'checkbox' }), k = h('select', keyOptions('Persuasão')), dc = h('input', { type: 'number', min: 1, max: 40, value: 13 }), fail = h('input', { maxlength: 300, placeholder: 'A complicação se falhar' });
  modal('Momento decisivo', 'Aparece para todos na mesa. Quando decidir, a escolha e a consequência vão para o diário.', h('div.rpg-form',
    field('Título', title), field('Situação', text), h('div.rpg-row', field('Opções (uma por linha)', opts), field('Como decidem', mode)),
    h('label.rpg-check', withCheck, 'Com teste ligado (todos rolam)'), h('div.rpg-row', field('Perícia', k), field('CD', dc)), field('Se o teste falhar', fail)), [
    { label: 'Cancelar', cls: 'grey' },
    { label: 'Apresentar', fn: () => send({ op: 'ev.save', ev: { title: title.value, text: text.value, options: lines(opts.value), mode: mode.value, check: withCheck.checked ? { key: k.value, dc: +dc.value, fail: fail.value } : null } }) }], { width: '560px' });
}
function closeEvent(ev) {
  const tally = ev.options.map((_, i) => Object.values(ev.votes || {}).filter(v => v === i).length), best = tally.indexOf(Math.max(...tally, 0));
  const pick = h('select', h('option', { value: '' }, 'Nenhuma opção'), ev.options.map((t, i) => h('option', { value: i, selected: i === best && tally[i] > 0 }, `${t} (${tally[i]} voto${tally[i] === 1 ? '' : 's'})`)));
  const txt = h('textarea', { rows: 3, maxlength: 400, placeholder: 'O que acontece agora (vai para o diário)' });
  modal(ev.title, 'A decisão e a consequência ficam registradas no histórico e no diário.', h('div.rpg-form', field('Escolha do grupo', pick), field('Consequência', txt)), [
    { label: 'Cancelar', cls: 'grey' }, { label: 'Decidir', fn: () => send({ op: 'ev.close', id: ev.id, opt: pick.value === '' ? -1 : +pick.value, text: txt.value }) }]);
}
function restModal() {
  const d = (k) => ['hp', 'res'].map(p => `${p === 'hp' ? 'vida' : 'recurso'}: ${{ none: 'nada', quarter: '¼', half: 'metade', full: 'tudo' }[T.rest[k][p]]}`).join(', ');
  modal('Descanso', 'Vale para todas as fichas da mesa e encerra o combate. Dá para mudar quanto recupera nas regras da mesa.', h('div.rpg-form',
    h('p', h('b', 'Curto: '), d('short')), h('p', h('b', 'Longo: '), d('long'), ', e tira as condições')), [
    { label: 'Cancelar', cls: 'grey' }, { label: 'Descanso curto', cls: 'grey', fn: () => send({ op: 'rest', kind: 'short' }) }, { label: 'Descanso longo', fn: () => send({ op: 'rest', kind: 'long' }) }]);
}

// ---------- ficha completa (janela que acompanha a mesa ao vivo) ----------
function openSheet(ch, t = 'pericias') {
  const el = h('div.rpg-sheet');
  modal(ch.name, null, el, [{ label: 'Fechar', cls: 'grey' }], { width: '660px' });
  sheetOpen = { id: ch.id, tab: t, el }; renderSheet();
}
const skillTotal = (ch, s) => { const sc = score(ch, s.attr), m = dnd() ? mod(sc) : (ch.attrs[s.attr] != null ? sc : 0); return m + (ch.prof.includes(s.name) && dnd() ? prof(ch.level) : 0) + (ch.sbon?.[s.name] || 0); };
const KIND_ITEM = { comum: 'Comum', arma: 'Arma', armadura: 'Armadura', pocao: 'Poção', especial: 'Especial' }, KIND_ABIL = { habilidade: 'Habilidade', magia: 'Magia', caracteristica: 'Característica' };
function renderSheet() {
  const so = sheetOpen, ch = charOf(so.id);
  if (!ch) return so.el.replaceChildren(h('p.rpg-empty', 'Essa ficha foi apagada.'));
  const can = canChar(ch), mine = ch.owner === me(), gm = isGM(), as = 'c:' + ch.id;
  const head = h('div.rpg-sheet-head', portrait(ch, 'c', 64),
    h('div.rpg-card-id', h('b', ch.name), h('span', subtitle(ch), ' · ', who(ch.owner)),
      h('div.rpg-sheet-insp', h('span', icon('star', 13), ` Inspiração ${ch.insp}/${T.insp.max}`), ch.inspAdv && h('span.muted', '· vantagem guardada'),
        mine && ch.insp > 0 && T.insp.adv && !ch.inspAdv && h('button.rpg-link', { onclick: () => send({ op: 'insp.use', id: ch.id, mode: 'adv' }) }, 'Gastar: vantagem'),
        mine && ch.insp > 0 && T.insp.reroll && h('button.rpg-link', { onclick: () => send({ op: 'insp.use', id: ch.id, mode: 'reroll' }) }, 'Gastar: rolar de novo a última'),
        gm && h('button.rpg-link', { onclick: () => send({ op: 'insp', id: ch.id, delta: 1 }) }, '+1'), gm && ch.insp > 0 && h('button.rpg-link', { onclick: () => send({ op: 'insp', id: ch.id, delta: -1 }) }, '−1'))),
    can && h('button.btn.grey.sm', { onclick: () => sheetModal(ch) }, icon('edit', 14), 'Editar'));
  const bars = h('div.rpg-sheet-bars', bar(ch.hp, 'hp', 'Vida', can ? () => hpModal(ch, 'c') : null), ch.res && bar(ch.res, 'res', ch.res.name, can ? () => hpModal(ch, 'c', true) : null));
  const tabs = [['pericias', 'Perícias'], ['inv', `Inventário${ch.items.length ? ` · ${ch.items.length}` : ''}`], ['abil', `Habilidades${ch.abil.length ? ` · ${ch.abil.length}` : ''}`], ['hist', 'História']];
  const tabRow = h('div.rpg-seg', tabs.map(([k, l]) => h('button' + (so.tab === k ? '.on' : ''), { onclick: () => { so.tab = k; renderSheet(); } }, l)));
  let body;
  if (so.tab === 'inv') {
    body = [ch.items.length ? h('ul.rpg-list', ch.items.map(it => h('li.rpg-row-it' + (it.eq ? '.eq' : ''),
      h('div.rpg-it-main', h('b', it.name, it.qty > 1 && h('span.muted', ` ×${it.qty}`)), h('span.muted', [KIND_ITEM[it.kind], it.props, it.eq && 'equipado', it.heal && `cura ${it.heal}`].filter(Boolean).join(' · ')), it.desc && h('p.rpg-pre.muted', it.desc)),
      can && (it.kind === 'arma' || it.kind === 'armadura' || it.kind === 'especial') && h('button.btn.grey.sm', { onclick: () => send({ op: 'item.eq', char: ch.id, id: it.id }) }, it.eq ? 'Guardar' : 'Equipar'),
      can && (it.cons || it.heal) && h('button.btn.sm', { onclick: () => send({ op: 'item.use', char: ch.id, id: it.id }) }, 'Usar'),
      can && h('button.ibtn', { title: 'Mais', onclick: (e) => menu(e, [{ label: 'Editar', icon: 'edit', fn: () => itemModal(ch, it) },
        T.chars.length > 1 && { label: 'Entregar a', icon: 'gift', sub: T.chars.filter(c => c.id !== ch.id).map(c => ({ label: c.name, fn: () => send({ op: 'item.give', char: ch.id, id: it.id, to: c.id }) })) },
        '-', { label: 'Jogar fora', icon: 'trash', danger: true, fn: () => send({ op: 'item.del', char: ch.id, id: it.id }) }]) }, icon('more', 16))))) : h('p.rpg-empty', 'Inventário vazio.'),
    can && h('div', h('button.btn.grey.sm', { onclick: () => itemModal(ch, null) }, icon('plus', 14), gm && !mine ? 'Entregar item' : 'Adicionar item'))];
  } else if (so.tab === 'abil') {
    body = [ch.abil.length ? h('ul.rpg-list', ch.abil.map(a => h('li.rpg-row-it',
      h('div.rpg-it-main', h('b', a.name), h('span.muted', [KIND_ABIL[a.kind], a.cost && ch.res ? `${a.cost} ${ch.res.name.toLowerCase()}` : a.cost ? `custo ${a.cost}` : '', a.roll].filter(Boolean).join(' · ')), a.desc && h('p.rpg-pre.muted', a.desc)),
      can && h('button.btn.sm', { disabled: a.cost > 0 && (!ch.res || ch.res.cur < a.cost), onclick: () => send({ op: 'abil.use', char: ch.id, id: a.id }) }, 'Usar'),
      can && h('button.ibtn', { title: 'Mais', onclick: (e) => menu(e, [{ label: 'Editar', icon: 'edit', fn: () => abilModal(ch, a) }, { label: 'Apagar', icon: 'trash', danger: true, fn: () => send({ op: 'abil.del', char: ch.id, id: a.id }) }]) }, icon('more', 16))))) : h('p.rpg-empty', 'Nenhuma habilidade ou magia ainda.'),
    can && h('div', h('button.btn.grey.sm', { onclick: () => abilModal(ch, null) }, icon('plus', 14), 'Adicionar'))];
  } else if (so.tab === 'hist') {
    const sec = (t, v) => v && h('div.rpg-focus-sec', h('span.rpg-lab', t), h('p.rpg-pre', v));
    body = [sec('História', ch.story), sec('Características', ch.skills), sec('Observações', ch.notes), ch.pnotes != null && sec('Anotações privadas (só você e o mestre)', ch.pnotes),
      !ch.story && !ch.skills && !ch.notes && !ch.pnotes && h('p.rpg-empty', can ? 'Nada escrito ainda. Use "Editar" para contar a história do personagem.' : 'Nada escrito ainda.')];
  } else {
    body = [attrsRow(ch, can), T.skills.length ? h('ul.rpg-skills', T.skills.map(s => { const p = ch.prof.includes(s.name), tot = skillTotal(ch, s);
      return h('li', h('button.rpg-prof' + (p ? '.on' : ''), { title: p ? 'Treinada (soma a proficiência)' : 'Não treinada', disabled: !can, onclick: () => send({ op: 'char.prof', id: ch.id, skill: s.name, on: !p }) }),
        h('button.rpg-skill', { disabled: !can, title: can ? `Rolar ${s.name}` : s.name, onclick: () => send({ op: 'check', key: s.name, as }) }, h('span', s.name), h('small', s.attr), h('b', sgn(tot)))); }))
      : h('p.rpg-empty', 'A mesa não tem perícias (o mestre configura nas regras).'),
    can && T.skills.length > 0 && h('p.muted', 'Clique numa perícia para rolar; o círculo marca as treinadas.')];
  }
  so.el.replaceChildren(head, bars, ch.conds?.length > 0 && h('div.rpg-chips', ch.conds.map(c => h('span.rpg-chip.cond', { title: condDesc(c.name) }, condTxt(c)))), tabRow, h('div.rpg-sheet-body', body));
}
function itemModal(ch, it) {
  const x = it || { name: '', kind: 'comum', qty: 1, props: '', desc: '', cons: false, heal: '' };
  const name = h('input', { value: x.name, maxlength: 40, placeholder: 'Espada longa, Poção de cura…' }), kind = h('select', Object.entries(KIND_ITEM).map(([v, l]) => h('option', { value: v, selected: v === x.kind }, l))),
    qty = h('input', { type: 'number', min: 0, value: x.qty }), props = h('input', { value: x.props, maxlength: 120, placeholder: '1d8 cortante, CA +2, mágico…' }), desc = h('textarea', { rows: 2, maxlength: 500 }, x.desc),
    cons = h('input', { type: 'checkbox', checked: x.cons }), heal = h('input', { value: x.heal || '', maxlength: 40, placeholder: '2d4+2 (opcional)' });
  kind.addEventListener('change', () => { if (kind.value === 'pocao') { cons.checked = true; if (!heal.value) heal.value = '2d4+2'; } });
  modal(it ? 'Editar item' : `Item para ${ch.name}`, null, h('div.rpg-form', h('div.rpg-row', field('Nome', name), field('Tipo', kind), field('Qtd.', qty)), field('Propriedades', props), field('Descrição', desc),
    h('div.rpg-row', h('label.rpg-check', cons, 'Consumível (gasta ao usar)'), field('Cura ao usar', heal))), [
    { label: 'Cancelar', cls: 'grey' }, { label: 'Salvar', fn: () => send({ op: 'item.save', char: ch.id, item: { id: it?.id, name: name.value, kind: kind.value, qty: +qty.value, props: props.value, desc: desc.value, cons: cons.checked, heal: heal.value } }) }], { width: '520px' });
}
function abilModal(ch, a) {
  const x = a || { name: '', kind: 'habilidade', cost: 0, roll: '', desc: '' };
  const name = h('input', { value: x.name, maxlength: 40, placeholder: 'Ataque furtivo, Bola de fogo…' }), kind = h('select', Object.entries(KIND_ABIL).map(([v, l]) => h('option', { value: v, selected: v === x.kind }, l))),
    cost = h('input', { type: 'number', min: 0, value: x.cost }), roll = h('input', { value: x.roll, maxlength: 40, placeholder: '8d6, 1d20+@INT+@PROF (opcional)' }), desc = h('textarea', { rows: 3, maxlength: 800 }, x.desc);
  modal(a ? 'Editar habilidade' : 'Nova habilidade ou magia', ch.res ? `O custo sai de ${ch.res.name}.` : 'Para ter custo, a ficha precisa de um recurso extra (mana, energia…).', h('div.rpg-form',
    h('div.rpg-row', field('Nome', name), field('Tipo', kind), field('Custo', cost)), field('Rolagem ao usar', roll), field('Descrição', desc)), [
    { label: 'Cancelar', cls: 'grey' }, { label: 'Salvar', fn: () => send({ op: 'abil.save', char: ch.id, abil: { id: a?.id, name: name.value, kind: kind.value, cost: +cost.value, roll: roll.value, desc: desc.value } }) }], { width: '520px' });
}

// ---------- diário da campanha ----------
const JR = { missao: 'Missão', pista: 'Pista', npc: 'NPC', local: 'Local', evento: 'Acontecimento', decisao: 'Decisão', nota: 'Anotação' }, JR_PLAYER = ['pista', 'npc', 'local', 'nota'];
function tabJournal() {
  const gm = isGM(), J = [...(T.journal || [])].reverse(), act = J.filter(j => j.kind === 'missao' && j.status === 'ativa'), dec = J.filter(j => j.kind === 'decisao').slice(0, 3);
  const recap = (act.length || dec.length) && h('section.rpg-recap', h('span.rpg-lab', 'Para retomar'),
    act.length > 0 && h('p', h('b', 'Missões ativas: '), act.map(j => j.title).join(' · ')), dec.length > 0 && h('p', h('b', 'Últimas decisões: '), dec.map(j => j.title).join(' · ')));
  const kinds = Object.keys(JR).filter(k => J.some(j => j.kind === k));
  const list = J.filter(j => !jrFilter || j.kind === jrFilter);
  return [
    h('div.rpg-bar-row', h('div.rpg-chips', h('button.rpg-chip.tog' + (!jrFilter ? '.on' : ''), { onclick: () => { jrFilter = ''; render(); } }, 'Tudo'),
      kinds.map(k => h('button.rpg-chip.tog' + (jrFilter === k ? '.on' : ''), { onclick: () => { jrFilter = k; render(); } }, JR[k]))),
      h('button.btn.grey.sm', { onclick: () => jrModal({ kind: gm ? 'evento' : 'nota' }) }, icon('plus', 14), 'Escrever')),
    recap,
    list.length ? h('ul.rpg-journal', list.map(j => h('li.rpg-jr' + (j.status === 'concluida' || j.status === 'falhou' ? '.done' : ''),
      h('div.rpg-jr-h', h('span.rpg-jr-k', JR[j.kind]), h('b', j.title), j.status && h('span.muted', { ativa: 'ativa', concluida: 'concluída', falhou: 'fracassou' }[j.status]), j.priv && h('span.rpg-li-sec', { title: 'Só você (mestre) vê' }, icon('eyeoff', 12)),
        h('span.sp'), h('time', new Date(j.at).toLocaleDateString([], { day: '2-digit', month: '2-digit' })),
        (gm || j.by === me()) && j.kind !== 'decisao' && h('button.ibtn', { title: 'Editar', onclick: () => jrModal(j) }, icon('edit', 14)),
        (gm || j.by === me()) && h('button.ibtn', { title: 'Apagar', onclick: () => send({ op: 'jr.del', id: j.id }) }, icon('trash', 14))),
      j.text && h('p.rpg-pre', j.text),
      gm && j.kind === 'missao' && j.status === 'ativa' && h('div.rpg-quick', h('button.rpg-link', { onclick: () => send({ op: 'jr.save', entry: { ...j, status: 'concluida' } }) }, 'Concluir'), h('button.rpg-link', { onclick: () => send({ op: 'jr.save', entry: { ...j, status: 'falhou' } }) }, 'Fracassou'))))) :
      h('p.rpg-empty', 'O diário guarda missões, pistas, NPCs, lugares e as decisões do grupo — para retomar a campanha depois de semanas.'),
  ];
}
function jrModal(j) {
  const gm = isGM(), kinds = gm ? Object.keys(JR).filter(k => k !== 'decisao') : JR_PLAYER;
  const kind = h('select', kinds.map(k => h('option', { value: k, selected: k === j.kind }, JR[k]))), title = h('input', { value: j.title || '', maxlength: 80 }), text = h('textarea', { rows: 5, maxlength: 2000 }, j.text || ''),
    priv = h('input', { type: 'checkbox', checked: !!j.priv }), ann = h('input', { type: 'checkbox', checked: !j.id });
  modal(j.id ? 'Editar no diário' : 'Escrever no diário', gm ? null : 'Pistas, NPCs, lugares e anotações que o grupo todo vê.', h('div.rpg-form', h('div.rpg-row', field('Tipo', kind), field('Título', title)), field('Texto', text),
    gm && h('div.rpg-quick', h('label.rpg-check', priv, 'Privado (só o mestre)'), !j.id && h('label.rpg-check', ann, 'Avisar no histórico'))), [
    { label: 'Cancelar', cls: 'grey' }, { label: 'Salvar', fn: () => send({ op: 'jr.save', announce: gm && ann.checked, entry: { id: j.id, kind: kind.value, title: title.value, text: text.value, status: j.status, priv: gm && priv.checked } }) }], { width: '520px' });
}
