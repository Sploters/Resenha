// Mesa de RPG da chamada de voz (atividade do foguete; cliente: public/rpg.js).
//
// Uma mesa por sala de voz, guardada no banco (tabela rpg_tables): fechar a mesa ou esvaziar a sala não perde a
// campanha; abrir de novo na mesma sala traz fichas, inimigos e histórico de volta.
//
// Universal (não só D&D): os atributos da ficha, as condições prontas e a rolagem de atributo ({v} = valor) são da mesa
// e o mestre troca. Os dados rolam no servidor (ninguém "escolhe" o resultado) e entram no histórico.
//
// Permissões: o mestre (quem abriu a mesa, ou quem assumiu porque o mestre não estava na chamada) mexe em tudo; o
// jogador mexe nas próprias fichas (vida, mana, tags, condições, iniciativa). Inimigos são só do mestre; os jogadores
// veem só os revelados e, conforme o modo de vida de cada um, os números, só o dano causado ou um estado narrativo.
// A visão de cada pessoa é montada por view(): o que é do mestre (rolagens secretas, ataques, fraquezas, anotações
// privadas, a CD escondida) não sai dele; a rolagem privada de um jogador só ele e o mestre veem.
//
// Além das fichas e do combate: perícias e testes (o mestre pede a um ou ao grupo, com CD), inspiração, condições com
// efeito (vantagem, desvantagem, bônus, dano por turno), ações por turno, reações oferecidas pelo mestre, chefes com
// fases, inventário, habilidades e magias, momentos decisivos (votação ou resposta de cada um), diário e descanso.
// Tudo configurável pelo mestre (cfg): nada aqui é regra fixa de D&D.
export const LIMITS = { chars: 40, foes: 60, log: 200, dice: 200, count: 100, faces: 1000, tags: 12, conds: 12, attrs: 16, items: 80, abil: 60, journal: 300, events: 30, asks: 20, skills: 40 };
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const strList = (v, max, len) => (Array.isArray(v) ? [...new Set(v.map(x => clip(x, len)).filter(Boolean))].slice(0, max) : []);
const imgUrl = (v) => { const s = clip(v, 500); return /^(\/files\/|\/avatars\/|https:\/\/)[^\s"'<>]*$/.test(s) ? s : ''; };
const HP_MODES = ['show', 'hidden', 'narr'];
const DEF_ATTRS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
// condições prontas: adv = vantagem/desvantagem nas rolagens de d20 de quem está com ela; bonus = soma nessas rolagens;
// tick = dano no começo do turno de quem está com ela
const DEF_CONDS = [
  { name: 'Envenenado', desc: 'Desvantagem em ataques e testes.', adv: 'dis' }, { name: 'Atordoado', desc: 'Não age nem reage; falha em testes de FOR e DES.' },
  { name: 'Queimando', desc: 'Sofre 1d4 de fogo no começo do turno.', tick: '1d4' }, { name: 'Amedrontado', desc: 'Desvantagem enquanto vê a fonte do medo.', adv: 'dis' },
  { name: 'Invisível', desc: 'Vantagem nos ataques; atacá-lo tem desvantagem.', adv: 'adv' }, { name: 'Inconsciente', desc: 'Caído, não age e não percebe nada.' },
  { name: 'Abençoado', desc: '+1d4 em ataques e testes.', bonus: '+1d4' }, { name: 'Paralisado', desc: 'Não se move nem age.' },
  { name: 'Sangrando', desc: 'Perde 1d4 de vida no começo do turno.', tick: '1d4' }, { name: 'Cego', desc: 'Desvantagem nos ataques.', adv: 'dis' }, { name: 'Caído', desc: 'No chão: levantar gasta movimento.' },
];
const DEF_SKILLS = [['Acrobacia', 'DES'], ['Adestrar Animais', 'SAB'], ['Arcanismo', 'INT'], ['Atletismo', 'FOR'], ['Atuação', 'CAR'], ['Enganação', 'CAR'], ['Furtividade', 'DES'],
  ['História', 'INT'], ['Intimidação', 'CAR'], ['Intuição', 'SAB'], ['Investigação', 'INT'], ['Medicina', 'SAB'], ['Natureza', 'INT'], ['Percepção', 'SAB'], ['Persuasão', 'CAR'],
  ['Prestidigitação', 'DES'], ['Religião', 'INT'], ['Sobrevivência', 'SAB']].map(([name, attr]) => ({ name, attr }));
const DEF_REACTIONS = [{ name: 'Proteger aliado', desc: 'Põe-se no caminho: o ataque contra um aliado próximo tem desvantagem.' }, { name: 'Contra-ataque', desc: 'Ataca quem acabou de errar você.' }, { name: 'Interceptar', desc: 'Reduz o dano que um aliado vai sofrer.' }];
const DEF_ECONOMY = ['Ação', 'Ação bônus', 'Movimento', 'Reação'];
const ITEM_KINDS = ['comum', 'arma', 'armadura', 'pocao', 'especial'], ABIL_KINDS = ['habilidade', 'magia', 'caracteristica'];
const JR_KINDS = ['missao', 'pista', 'npc', 'local', 'evento', 'decisao', 'nota'], JR_PLAYER = ['pista', 'npc', 'local', 'nota'];
const REST_LV = { none: 0, quarter: .25, half: .5, full: 1 };
const mergeAdv = (a, b) => (!a ? b || null : !b ? a : a === b ? a : null); // vantagem + desvantagem se anulam
// expressão de dados opcional (dano por turno, cura de poção, bônus): vazia, ou válida pelo parser
const exprOk = (e, sign = false) => { const s = clip(e, 40).replace(/\s+/g, ''); if (!s) return ''; parseRoll(sign ? '0' + (/^[+-]/.test(s) ? s : '+' + s) : s); return sign && !/^[+-]/.test(s) ? '+' + s : s; };

// ---------- dados ----------
// Expressão: termos somados/subtraídos. Dado: NdM (d% = d100) com kh/kl (manter maiores/menores), dh/dl (descartar),
// rN (rerrola uma vez quem tirar N ou menos) e ! (explode no máximo). Também números e @ATRIBUTO (valor da ficha).
// Vantagem/desvantagem: o primeiro 1d20 vira 2d20kh1 / 2d20kl1.
const TERM = /^(\d*)d(\d+|%)((?:kh\d*|kl\d*|dh\d*|dl\d*|r\d+|!)*)$/i;
export function parseRoll(expr, attrs = {}, adv = null) {
  const src = clip(expr, 120).replace(/\s+/g, '').toLowerCase();
  if (!src) throw new Error('Digite uma rolagem, como 1d20+3');
  const toks = src.match(/[+-]?[^+-]+/g) || [], terms = [];
  let dice = 0, advDone = !adv;
  for (const raw of toks) {
    const sign = raw[0] === '-' ? -1 : 1, t = raw.replace(/^[+-]/, '');
    if (/^\d+$/.test(t)) { terms.push({ k: 'n', sign, v: Math.min(1e6, +t) }); continue; }
    if (/^@[\p{L}\d_]+$/u.test(t)) {
      const key = Object.keys(attrs).find(a => a.toLowerCase() === t.slice(1));
      if (key === undefined) throw new Error(`A ficha não tem o atributo ${t.slice(1).toUpperCase()}`);
      terms.push({ k: 'n', sign, v: int(attrs[key], -1e6, 1e6), label: key }); continue;
    }
    const m = TERM.exec(t); if (!m) throw new Error(`Não entendi "${t}". Use algo como 2d6+3, 1d20kh1 ou 4d6dl1`);
    let n = m[1] === '' ? 1 : +m[1]; const faces = m[2] === '%' ? 100 : +m[2];
    let mods = m[3] || '';
    if (n < 1 || n > LIMITS.count) throw new Error(`De 1 a ${LIMITS.count} dados por vez`);
    if (faces < 2 || faces > LIMITS.faces) throw new Error(`Dados de 2 a ${LIMITS.faces} faces`);
    if (!advDone && n === 1 && faces === 20 && !/k|d/.test(mods)) { n = 2; mods = (adv === 'adv' ? 'kh1' : 'kl1') + mods; advDone = true; }
    const o = { k: 'd', sign, n, faces, keep: null, reroll: 0, explode: false };
    for (const mm of mods.matchAll(/(kh|kl|dh|dl)(\d*)|r(\d+)|(!)/g)) {
      if (mm[1]) { const c = mm[2] === '' ? 1 : +mm[2]; o.keep = mm[1] === 'kh' ? ['h', c] : mm[1] === 'kl' ? ['l', c] : mm[1] === 'dh' ? ['l', n - c] : ['h', n - c]; }
      else if (mm[3]) o.reroll = Math.min(faces - 1, +mm[3]);
      else o.explode = true;
    }
    if (o.keep) o.keep[1] = Math.max(0, Math.min(n, o.keep[1]));
    dice += n; if (dice > LIMITS.dice) throw new Error(`No máximo ${LIMITS.dice} dados numa rolagem`);
    terms.push(o);
  }
  if (!terms.length) throw new Error('Digite uma rolagem, como 1d20+3');
  return terms;
}
const termText = (o) => (o.k === 'n' ? (o.label ? '@' + o.label : String(o.v)) : `${o.n}d${o.faces}${o.keep ? (o.keep[0] === 'h' ? 'kh' : 'kl') + o.keep[1] : ''}${o.reroll ? 'r' + o.reroll : ''}${o.explode ? '!' : ''}`);
export function roll(expr, { attrs = {}, adv = null, rnd = Math.random } = {}) {
  const terms = parseRoll(expr, attrs, adv), d = (f) => 1 + Math.floor(rnd() * f);
  let total = 0, crit = false, fumble = false, judged = false; const parts = [];
  for (const o of terms) {
    if (o.k === 'n') { total += o.sign * o.v; parts.push({ t: termText(o), sign: o.sign, v: o.v }); continue; }
    const rolls = [];
    for (let i = 0; i < o.n; i++) {
      let v = d(o.faces), was = null;
      if (o.reroll && v <= o.reroll) { was = v; v = d(o.faces); }
      rolls.push({ v, ...(was != null ? { was } : {}) });
      if (o.explode) for (let x = 0; v === o.faces && x < 20 && rolls.length < LIMITS.dice; x++) { v = d(o.faces); rolls.push({ v, ex: 1 }); }
    }
    if (o.keep) { // marca quem fica (os maiores ou os menores; empate: o primeiro)
      const idx = rolls.map((r, i) => i).sort((a, b) => (o.keep[0] === 'h' ? rolls[b].v - rolls[a].v : rolls[a].v - rolls[b].v) || a - b);
      const keep = new Set(idx.slice(0, o.keep[1])); rolls.forEach((r, i) => { if (!keep.has(i)) r.drop = 1; });
    }
    const kept = rolls.filter(r => !r.drop), sum = kept.reduce((s, r) => s + r.v, 0);
    total += o.sign * sum;
    // crítico/falha: o primeiro grupo de dados em que fica um dado só (1d20, 2d20kh1...)
    if (!judged && kept.length === 1 && o.sign > 0) { judged = true; crit = kept[0].v === o.faces; fumble = kept[0].v === 1; }
    parts.push({ t: termText(o), sign: o.sign, faces: o.faces, rolls, sum });
  }
  return { expr: terms.map((o, i) => (i || o.sign < 0 ? (o.sign < 0 ? '-' : '+') : '') + termText(o)).join(''), total, parts, crit, fumble, ...(adv ? { adv } : {}) };
}

// estado narrativo pela fração de vida
// D&D 5e: o valor do atributo (1 a 30, normal até 20) vira o modificador que entra no dado: 10-11 = +0, 20 = +5, 8 = -1.
// Bônus de proficiência pelo nível: +2 (1-4), +3 (5-8), +4 (9-12), +5 (13-16), +6 (17-20).
export const mod = (score) => Math.floor((score - 10) / 2);
export const prof = (level) => 2 + Math.floor((Math.max(1, Math.min(20, level || 1)) - 1) / 4);
export const narr = (cur, max) => { const f = max > 0 ? cur / max : 0; return cur <= 0 ? 'Derrotado' : f >= 1 ? 'Ileso' : f > .75 ? 'Arranhado' : f > .5 ? 'Ferido' : f > .25 ? 'Muito ferido' : 'Quase caindo'; };

export function createRpg({ db, get, run, rnd = Math.random, now = () => Date.now() }) {
  db.exec('CREATE TABLE IF NOT EXISTS rpg_tables(channel_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const tables = new Map(); // channelId -> mesa carregada
  const id = () => Math.floor(rnd() * 36 ** 8).toString(36).padStart(8, '0');
  const fresh = (gm) => ({ v: 1, gm, name: 'Mesa de RPG', attrs: [...DEF_ATTRS], conds: structuredClone(DEF_CONDS), sys: 'dnd5e', attrRoll: '1d20+{m}', initRoll: '1d20+@DES', chars: [], active: {}, foes: [], combat: null, log: [] });
  function load(c) {
    let T = tables.get(c); if (T) return T;
    const row = get('SELECT data FROM rpg_tables WHERE channel_id=?', c);
    try { T = row ? JSON.parse(row.data) : null; } catch { T = null; }
    if (T) { migrate(T); tables.set(c, T); }
    return T;
  }
  // mesas de antes do sistema de atributos: a com os atributos de sempre vira D&D 5e, as outras ficam no modo livre
  function migrate(T) {
    if (!T.sys) { T.sys = T.attrs.join() === DEF_ATTRS.join() ? 'dnd5e' : 'livre'; if (T.sys === 'dnd5e') { if (T.attrRoll === '1d20+{v}') T.attrRoll = '1d20+{m}'; if (T.initRoll === '1d20') T.initRoll = '1d20+@DES'; } }
    // condições viraram objetos com efeito; o resto (perícias, inspiração, diário…) chegou depois
    T.conds = (T.conds || []).map(x => (typeof x === 'string' ? DEF_CONDS.find(d => d.name === x) || { name: x } : x));
    T.skills ||= T.sys === 'dnd5e' ? structuredClone(DEF_SKILLS) : [];
    T.economy ||= T.sys === 'dnd5e' ? [...DEF_ECONOMY] : [];
    T.reactions ||= structuredClone(DEF_REACTIONS);
    T.insp ||= { max: 4, reroll: true, adv: true };
    T.rest ||= { short: { hp: 'quarter', res: 'half' }, long: { hp: 'full', res: 'full' } };
    T.nat ??= true; T.asks ||= []; T.offers ||= []; T.events ||= []; T.journal ||= [];
    for (const ch of T.chars) { ch.abon ||= {}; ch.prof ||= []; ch.sbon ||= {}; ch.items ||= []; ch.abil ||= []; ch.insp ||= 0; ch.story ??= ''; ch.pnotes ??= ''; }
    for (const f of T.foes) { f.phases ||= []; f.phase ??= -1; f.kind ??= ''; f.desc ??= ''; }
  }
  const condDef = (T, name) => T.conds.find(c => c.name.toLowerCase() === String(name).toLowerCase()) || null;
  // efeitos das condições de alguém nas rolagens de d20: vantagem/desvantagem (se anulam) e bônus somados
  const fxFor = (T, t) => {
    let adv = null, bonus = '', names = [], first = true;
    for (const c of t?.conds || []) { const d = condDef(T, c.name); if (!d || (!d.adv && !d.bonus)) continue; if (d.adv) { adv = first ? d.adv : mergeAdv(adv, d.adv); first = false; } if (d.bonus) bonus += d.bonus; names.push(d.name); }
    return { adv, bonus, names };
  };
  // o que @ATRIBUTO vale na rolagem: o modificador (D&D) ou o próprio valor (livre); @PROF = bônus de proficiência
  const rollAttrs = (T, ch) => {
    const out = {}; if (!ch?.attrs) return out;
    for (const [k, v] of Object.entries(ch.attrs)) { const sc = v + (ch.abon?.[k] || 0); out[k] = T.sys === 'dnd5e' ? mod(sc) : sc; }
    if (T.sys === 'dnd5e') out.PROF = prof(ch.level);
    return out;
  };
  // iniciativa de alguém do combate: a expressão da mesa (@DES da ficha; inimigo usa o bônus próprio)
  const rollInit = (T, e) => {
    const isF = e.kind === 'f', t = isF ? T.foes.find(x => x.id === e.ref) : T.chars.find(x => x.id === e.ref); if (!t) return null;
    const attrs = isF ? {} : rollAttrs(T, t);
    let expr = T.initRoll.replace(/@([\p{L}\d_]+)/gu, (m0, k) => (Object.keys(attrs).some(a => a.toLowerCase() === k.toLowerCase()) ? m0 : '0'));
    if (isF && t.ini) expr += (t.ini > 0 ? '+' : '-') + Math.abs(t.ini);
    const r = roll(expr, { attrs, rnd }); e.init = r.total; return r;
  };
  const save = (c, T) => run('INSERT INTO rpg_tables(channel_id, data, updated_at) VALUES(?,?,?) ON CONFLICT(channel_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', c, JSON.stringify(T), now());
  const log = (T, uid, kind, text, extra = {}) => { T.log.push({ id: id(), at: now(), uid, kind, text: clip(text, 300), ...extra }); if (T.log.length > LIMITS.log) T.log.splice(0, T.log.length - LIMITS.log); };
  const charOf = (T, cid) => T.chars.find(x => x.id === cid);
  const foeOf = (T, fid) => T.foes.find(x => x.id === fid);
  const canChar = (T, uid, ch) => !!ch && (T.gm === uid || ch.owner === uid);
  const conds = (v) => (Array.isArray(v) ? v.slice(0, LIMITS.conds).map(x => ({ name: clip(x?.name, 30), turns: x?.turns == null || x.turns === '' ? null : int(x.turns, 0, 99) })).filter(x => x.name) : []);
  const pool = (v, old) => { const max = int(v?.max, 0, 1e6, old?.max ?? 10); return { max, cur: int(v?.cur, -1e6, max, old?.cur ?? max) }; };
  const skillOf = (T, key) => T.skills.find(s => s.name.toLowerCase() === String(key).toLowerCase()) || null;
  // quem rola: a ficha em uso, ou (mestre) qualquer ficha ou inimigo
  function actorFor(T, uid, as) {
    if (as) {
      const [k, rid] = String(as).split(':'), isF = k === 'f', a = isF ? foeOf(T, rid) : charOf(T, rid);
      if (!a || (isF ? T.gm !== uid : !canChar(T, uid, a))) throw new Error('Você não pode rolar por esse personagem');
      return { actor: a, isF };
    }
    const a = charOf(T, T.active[uid]); return { actor: a && canChar(T, uid, a) ? a : null, isF: false };
  }
  // toda rolagem passa por aqui: efeitos das condições e a vantagem da inspiração entram nas de d20; fica no histórico
  // com o que é preciso para rolar de novo (inspiração)
  function rollFor(T, uid, p) {
    const gm = T.gm === uid, { actor, isF } = actorFor(T, uid, p.as);
    let expr = clip(p.expr, 120), adv = p.adv === 'adv' || p.adv === 'dis' ? p.adv : null;
    const fxNames = [], d20 = /d20/i.test(expr);
    if (actor && d20) {
      const fx = fxFor(T, actor); if (fx.bonus) expr += fx.bonus; if (fx.adv) adv = mergeAdv(adv, fx.adv); fxNames.push(...fx.names);
      if (!isF && actor.inspAdv) { adv = 'adv'; actor.inspAdv = false; fxNames.push('Inspiração'); }
    }
    const r = roll(expr, { attrs: { ...(isF ? {} : rollAttrs(T, actor)), ...(p.attrs || {}) }, adv, rnd });
    const label = clip(p.label, 60), secret = (!!p.secret && gm) || (isF && !actor.shown);
    const priv = !secret && !!p.priv;
    const e = { roll: r, label, ...(actor ? { who: actor.name, char: isF ? null : actor.id } : {}), ...(fxNames.length ? { fx: fxNames } : {}), ...(secret ? { gm: true } : {}), ...(priv ? { priv: true } : {}),
      src: { expr: p.expr, as: actor ? (isF ? 'f:' : 'c:') + actor.id : null, adv: p.adv || null, attrs: p.attrs || null, label: p.label, priv: !!p.priv, secret: !!p.secret, check: p.check || null } };
    if (p.check) {
      const dc = p.check.dc;
      let ok = dc == null ? null : r.total >= dc; if (dc != null && T.nat && r.crit) ok = true; if (dc != null && T.nat && r.fumble) ok = false;
      e.check = { key: p.check.key, dc, ok, ...(p.check.hid ? { hid: true } : {}), ...(p.check.ask ? { ask: p.check.ask } : {}) };
    }
    log(T, uid, 'roll', label || r.expr, e);
    return { e: T.log.at(-1), actor, isF };
  }
  // teste de perícia ou atributo: 1d20 + modificador do atributo + proficiência (se treinado) + bônus da ficha
  function checkFor(T, uid, d) {
    const { actor, isF } = actorFor(T, uid, d.as);
    if (!actor || isF) throw new Error('Escolha uma ficha para fazer o teste');
    const key = clip(d.key, 30), sk = skillOf(T, key), attr = sk ? sk.attr : Object.keys(actor.attrs).find(a => a.toLowerCase() === key.toLowerCase());
    if (!attr) throw new Error(`A mesa não tem a perícia ou o atributo "${key}"`);
    const ra = rollAttrs(T, actor), am = Object.keys(ra).find(a => a.toLowerCase() === attr.toLowerCase());
    const attrs = { [attr]: am ? ra[am] : 0 };
    let expr = `1d20+@${attr}`;
    if (sk && actor.prof.includes(sk.name)) { attrs.PROF = T.sys === 'dnd5e' ? prof(actor.level) : 0; if (attrs.PROF) expr += '+@PROF'; }
    const b = int(actor.sbon?.[sk ? sk.name : attr], -99, 99); if (b) { attrs.BONUS = b; expr += '+@BONUS'; }
    const dc = d.dc == null || d.dc === '' ? null : int(d.dc, 1, 99);
    return rollFor(T, uid, { expr, attrs, as: 'c:' + actor.id, adv: d.adv, priv: d.priv, label: sk ? sk.name : attr, check: { key: sk ? sk.name : attr, dc, hid: !!d.hid, ask: d.ask || null } });
  }
  const askTargets = (T, members) => members.map(u => T.active[u]).filter(cid => charOf(T, cid));

  // ---------- visão por pessoa ----------
  function view(c, uid) {
    const T = load(c); if (!T) return null;
    const gm = T.gm === uid;
    const foes = gm ? T.foes : T.foes.filter(f => f.shown).map(f => {
      const pub = { id: f.id, name: f.name, img: f.img, boss: f.boss, mode: f.mode, conds: f.conds, shown: true, kind: f.kind, desc: f.desc, phaseName: f.phase >= 0 ? f.phases[f.phase]?.name || null : null };
      if (f.mode === 'show') pub.hp = f.hp;
      else if (f.mode === 'hidden') pub.dmg = Math.max(0, f.hp.max - f.hp.cur);
      pub.state = narr(f.hp.cur, f.hp.max); // nos três modos: "Derrotado" aparece para todos
      return pub;
    });
    const fShown = new Set(foes.map(f => f.id));
    const combat = T.combat && { ...T.combat, order: gm ? T.combat.order : T.combat.order.filter(e => e.kind === 'c' || fShown.has(e.ref)) };
    // de quem é a vez (se for de um inimigo escondido, o jogador não vê ninguém marcado)
    if (combat) combat.cur = T.combat.order[T.combat.turn]?.id || null;
    // o que é do mestre não sai dele: anotações privadas das fichas alheias, a CD escondida, o diário privado,
    // consequências dos testes antes de encerrar, reações oferecidas a outros
    const chars = gm ? T.chars : T.chars.map(ch => (ch.owner === uid ? ch : { ...ch, pnotes: undefined }));
    const openAsk = new Set(T.asks.filter(a => a.open && a.dcHidden).map(a => a.id));
    const logv = T.log.filter(e => gm || (!e.gm && (!e.priv || e.uid === uid || (e.char && charOf(T, e.char)?.owner === uid)))).map(e => {
      let x = e; if (!gm && e.pub != null) x = { ...x, text: e.pub, pub: undefined };
      if (!gm && e.check?.hid && openAsk.has(e.check.ask)) x = { ...x, check: { ...e.check, dc: null } };
      return gm ? x : { ...x, src: undefined };
    });
    const asks = T.asks.filter(a => a.open || gm).map(a => (gm ? a : { ...a, dc: a.dcHidden ? null : a.dc, pass: undefined, fail: undefined }));
    return { channel_id: c, gm: T.gm, me_gm: gm, name: T.name, sys: T.sys, attrs: T.attrs, conds: T.conds, attrRoll: T.attrRoll, initRoll: T.initRoll,
      skills: T.skills, economy: T.economy, reactions: T.reactions, insp: T.insp, rest: T.rest, nat: T.nat,
      chars, active: T.active, foes, combat, log: logv, asks, events: T.events,
      offers: gm ? T.offers : T.offers.filter(o => charOf(T, o.char)?.owner === uid),
      journal: gm ? T.journal : T.journal.filter(j => !j.priv) };
  }

  // abre a mesa da sala: nova (quem abriu é o mestre) ou a guardada; o mestre que não está na chamada passa a vez
  function open(c, uid, members = []) {
    let T = load(c);
    if (!T) { T = fresh(uid); migrate(T); tables.set(c, T); log(T, uid, 'info', 'abriu a mesa e é o mestre'); }
    else if (!members.includes(T.gm)) { T.gm = uid; log(T, uid, 'info', 'abriu a mesa e assumiu como mestre'); }
    save(c, T); return T;
  }
  const canClose = (c, uid, members = []) => { const T = load(c); return !T || T.gm === uid || !members.includes(T.gm); };

  // ---------- operações ----------
  // devolve { ok } ou { error }; quem chama manda a visão nova para a sala
  function op(c, uid, d = {}, members = []) {
    const T = load(c); if (!T) return { error: 'A mesa não está aberta' };
    const gm = T.gm === uid, need = (cond, msg = 'Só o mestre pode fazer isso') => { if (!cond) throw new Error(msg); };
    const nm = (ch) => ch?.name || 'Personagem';
    try {
      switch (String(d.op || '')) {
        case 'roll': {
          rollFor(T, uid, { expr: d.expr, label: d.label, as: d.as, adv: d.adv, secret: d.secret, priv: d.priv });
          break;
        }
        case 'check': { // teste de perícia/atributo; com ask: resposta a um teste pedido pelo mestre
          let ask = null;
          if (d.ask) {
            ask = T.asks.find(a => a.id === String(d.ask)); need(ask && ask.open, 'Esse teste já foi encerrado');
            const { actor } = actorFor(T, uid, d.as); need(actor && ask.targets.includes(actor.id), 'Esse teste não foi pedido para essa ficha');
            need(!ask.res[actor.id], 'Essa ficha já fez esse teste');
            d = { ...d, key: ask.key, dc: ask.dc, hid: ask.dcHidden, ask: ask.id };
          }
          const { e, actor } = checkFor(T, uid, d);
          if (ask) ask.res[actor.id] = { total: e.roll.total, ok: e.check.ok, log: e.id };
          break;
        }
        case 'ask': { need(gm); // o mestre pede um teste a uma ficha ou ao grupo
          const key = clip(d.key, 30); need(skillOf(T, key) || T.attrs.some(a => a.toLowerCase() === key.toLowerCase()), 'Escolha uma perícia ou atributo da mesa');
          const targets = (Array.isArray(d.targets) && d.targets.length ? d.targets.map(String).filter(x => charOf(T, x)) : askTargets(T, members)).slice(0, LIMITS.chars);
          need(targets.length, 'Ninguém para fazer o teste: os jogadores precisam de ficha em uso');
          const a = { id: id(), at: now(), key: skillOf(T, key)?.name || key.toUpperCase(), dc: d.dc == null || d.dc === '' ? null : int(d.dc, 1, 99), dcHidden: !!d.dcHidden,
            label: clip(d.label, 80), pass: clip(d.pass, 300), fail: clip(d.fail, 300), targets, res: {}, open: true, ev: d.ev ? String(d.ev) : null };
          T.asks.push(a); if (T.asks.length > LIMITS.asks) T.asks.splice(0, T.asks.length - LIMITS.asks);
          log(T, uid, 'ask', `Teste de ${a.key}${a.dc != null && !a.dcHidden ? ` (CD ${a.dc})` : ''}${a.label ? `: ${a.label}` : ''} para ${targets.length > 1 ? 'o grupo' : nm(charOf(T, targets[0]))}`);
          break;
        }
        case 'ask.close': { need(gm); const a = T.asks.find(x => x.id === String(d.id)); need(a && a.open, 'Esse teste já foi encerrado');
          a.open = false; const res = Object.entries(a.res), oks = res.filter(([, r]) => r.ok).length;
          // em grupo, passa se pelo menos metade passou; a falha vira complicação (o texto do mestre), não um bloqueio
          const pass = a.dc == null ? null : res.length > 0 && oks * 2 >= res.length;
          const who = res.map(([cid, r]) => `${nm(charOf(T, cid))} ${r.total}${r.ok == null ? '' : r.ok ? ' ✓' : ' ✗'}`).join(', ') || 'ninguém rolou';
          const outcome = pass == null ? '' : pass ? (a.pass ? ` Sucesso: ${a.pass}` : ' Sucesso.') : (a.fail ? ` Falha: ${a.fail}` : ' Falha.');
          log(T, uid, 'ask', `${a.key}${a.dc != null ? ` CD ${a.dc}` : ''}: ${who}.${outcome}`);
          if (a.ev) { const ev = T.events.find(x => x.id === a.ev); if (ev) ev.checkRes = { pass, text: outcome.trim() }; }
          break;
        }
        case 'char.prof': { // perícia treinada (soma a proficiência) e bônus extra numa perícia
          const ch = charOf(T, String(d.id)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador');
          const sk = skillOf(T, d.skill); need(sk, 'Perícia não encontrada');
          if (d.on != null) ch.prof = d.on ? [...new Set([...ch.prof, sk.name])] : ch.prof.filter(x => x !== sk.name);
          if (d.bonus != null) { const b = int(d.bonus, -99, 99); if (b) ch.sbon[sk.name] = b; else delete ch.sbon[sk.name]; }
          break;
        }
        case 'insp': { need(gm); const ch = charOf(T, String(d.id)); need(ch, 'Ficha não encontrada'); // o mestre dá (ou tira) inspiração
          const before = ch.insp; ch.insp = int(ch.insp + int(d.delta, -10, 10), 0, T.insp.max);
          if (ch.insp > before) log(T, uid, 'insp', `${ch.name} ganhou inspiração (${ch.insp}/${T.insp.max})${d.why ? `: ${clip(d.why, 80)}` : ''}`);
          else if (ch.insp < before) log(T, uid, 'insp', `${ch.name} perdeu inspiração (${ch.insp}/${T.insp.max})`);
          else need(false, `${ch.name} já está no máximo (${T.insp.max})`);
          break;
        }
        case 'insp.use': { // gastar inspiração: vantagem na próxima rolagem de d20, ou rolar de novo a última
          const ch = charOf(T, String(d.id)); need(ch && ch.owner === uid, 'Só o dono da ficha gasta a inspiração'); need(ch.insp > 0, 'Sem inspiração');
          if (d.mode === 'adv') { need(T.insp.adv, 'Nesta mesa a inspiração não dá vantagem'); need(!ch.inspAdv, 'A vantagem já está guardada para a próxima rolagem'); ch.insp--; ch.inspAdv = true; log(T, uid, 'insp', `${ch.name} gastou inspiração: vantagem na próxima rolagem`); break; }
          need(T.insp.reroll, 'Nesta mesa a inspiração não rola de novo');
          const last = [...T.log].reverse().slice(0, 40).find(e => e.kind === 'roll' && e.char === ch.id && e.src && !e.redone); need(last, 'Nenhuma rolagem recente dessa ficha para rolar de novo');
          ch.insp--; last.redone = true;
          const s = last.src, { e } = rollFor(T, uid, { ...s, as: 'c:' + ch.id, label: `${s.label || last.roll.expr} (inspiração)`, adv: s.adv });
          const ask = s.check?.ask && T.asks.find(a => a.id === s.check.ask && a.open);
          if (ask && e.check) ask.res[ch.id] = { total: e.roll.total, ok: e.check.ok, log: e.id };
          break;
        }
        case 'eco': { const C = T.combat; need(C, 'Não há combate'); const e = C.order.find(x => x.id === String(d.id)); need(e, 'Não está no combate'); // ação, movimento, reação gastos no turno
          const t = e.kind === 'c' ? charOf(T, e.ref) : foeOf(T, e.ref); need(e.kind === 'c' ? canChar(T, uid, t) : gm, 'Só o dono da ficha ou o mestre');
          const n = clip(d.name, 20); need(T.economy.includes(n), 'Essa ação não existe nesta mesa');
          e.used ||= []; e.used = e.used.includes(n) ? e.used.filter(x => x !== n) : [...e.used, n];
          break;
        }
        case 'react.offer': { need(gm); // o mestre oferece uma reação: o jogador aceita ou recusa
          const r = T.reactions.find(x => x.name === clip(d.name, 40)); need(r, 'Reação não permitida nesta mesa');
          const ch = charOf(T, String(d.char)); need(ch, 'Ficha não encontrada');
          T.offers = T.offers.filter(o => o.char !== ch.id);
          T.offers.push({ id: id(), at: now(), char: ch.id, name: r.name, desc: r.desc, text: clip(d.text, 160) });
          break;
        }
        case 'react.answer': { const o = T.offers.find(x => x.id === String(d.id)); need(o, 'Essa reação já passou');
          const ch = charOf(T, o.char); need(ch && (ch.owner === uid || gm), 'Essa reação é de outro jogador');
          T.offers = T.offers.filter(x => x !== o);
          if (!d.accept) { log(T, uid, 'combat', `${ch.name} deixou passar: ${o.name}`); break; }
          const e = T.combat?.order.find(x => x.kind === 'c' && x.ref === ch.id), slot = T.economy.find(x => /rea[çc][ãa]o/i.test(x));
          if (e && slot) { e.used ||= []; need(!e.used.includes(slot), `${ch.name} já usou a reação nesta rodada`); e.used.push(slot); }
          log(T, uid, 'combat', `${ch.name} reagiu: ${o.name}${o.text ? ` (${o.text})` : ''}`);
          break;
        }
        case 'combat.move': { need(gm); const C = T.combat; need(C, 'Não há combate'); // ajustar a ordem na mão
          const i = C.order.findIndex(x => x.id === String(d.id)), j = i + (d.dir < 0 ? -1 : 1); need(i >= 0 && j >= 0 && j < C.order.length, 'Não dá para mover para lá');
          const cur = C.order[C.turn]?.id; [C.order[i], C.order[j]] = [C.order[j], C.order[i]]; C.turn = Math.max(0, C.order.findIndex(x => x.id === cur));
          break;
        }
        case 'foe.phase': { need(gm); const f = foeOf(T, String(d.id)); need(f, 'Inimigo não encontrado'); const i = int(d.idx, -1, f.phases.length - 1);
          if (i === f.phase) break; f.phase = i; phaseLog(T, uid, f); break; }
        case 'item.save': { // inventário: o dono ou o mestre (que pode entregar itens a qualquer ficha)
          const ch = charOf(T, String(d.char)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador');
          const x = d.item || {}, old = x.id ? ch.items.find(i => i.id === String(x.id)) : null;
          if (!old) need(ch.items.length < LIMITS.items, 'Inventário cheio');
          const it = { id: old?.id || id(), name: clip(x.name, 40) || 'Item', kind: ITEM_KINDS.includes(x.kind) ? x.kind : 'comum', qty: int(x.qty, 0, 9999, 1), desc: clip(x.desc, 500), props: clip(x.props, 120),
            eq: old ? old.eq : !!x.eq, cons: !!x.cons, heal: exprOk(x.heal) };
          if (old) Object.assign(old, it); else { ch.items.push(it); if (uid !== ch.owner) log(T, uid, 'item', `${ch.name} recebeu ${it.qty > 1 ? it.qty + '× ' : ''}${it.name}`); }
          break;
        }
        case 'item.del': case 'item.eq': case 'item.use': case 'item.give': {
          const ch = charOf(T, String(d.char)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador');
          const it = ch.items.find(i => i.id === String(d.id)); need(it, 'Item não encontrado');
          if (d.op === 'item.del') { ch.items = ch.items.filter(i => i !== it); break; }
          if (d.op === 'item.eq') { it.eq = !it.eq; log(T, uid, 'item', `${ch.name} ${it.eq ? 'equipou' : 'guardou'} ${it.name}`); break; }
          if (d.op === 'item.give') { const to = charOf(T, String(d.to)); need(to && to !== ch, 'Escolha outra ficha'); need(to.items.length < LIMITS.items, 'O inventário de destino está cheio');
            ch.items = ch.items.filter(i => i !== it); to.items.push({ ...it, eq: false }); log(T, uid, 'item', `${ch.name} entregou ${it.name} a ${to.name}`); break; }
          need(it.qty > 0, 'Acabou'); // usar: consumível gasta um; com cura, rola e cura
          let txt = `${ch.name} usou ${it.name}`;
          if (it.heal) { const r = roll(it.heal, { rnd }); const before = ch.hp.cur; ch.hp.cur = Math.min(ch.hp.max, Math.max(ch.hp.cur, 0) + r.total); txt += `: +${ch.hp.cur - before} de vida (${it.heal} = ${r.total})`; }
          if (it.cons) { it.qty--; if (!it.qty) ch.items = ch.items.filter(i => i !== it); }
          log(T, uid, 'item', txt); break;
        }
        case 'abil.save': { const ch = charOf(T, String(d.char)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador'); // habilidades e magias
          const x = d.abil || {}, old = x.id ? ch.abil.find(a => a.id === String(x.id)) : null;
          if (!old) need(ch.abil.length < LIMITS.abil, 'Habilidades demais');
          const a = { id: old?.id || id(), name: clip(x.name, 40) || 'Habilidade', kind: ABIL_KINDS.includes(x.kind) ? x.kind : 'habilidade', cost: int(x.cost, 0, 999), roll: exprOk(x.roll), desc: clip(x.desc, 800) };
          if (a.roll) parseRoll(a.roll, rollAttrs(T, ch));
          if (old) Object.assign(old, a); else ch.abil.push(a);
          break;
        }
        case 'abil.del': { const ch = charOf(T, String(d.char)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador'); ch.abil = ch.abil.filter(a => a.id !== String(d.id)); break; }
        case 'abil.use': { const ch = charOf(T, String(d.char)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador');
          const a = ch.abil.find(x => x.id === String(d.id)); need(a, 'Habilidade não encontrada');
          if (a.cost) { need(ch.res, `${ch.name} não tem recurso para gastar`); need(ch.res.cur >= a.cost, `${ch.res.name} insuficiente (${ch.res.cur}/${a.cost})`); ch.res.cur -= a.cost; }
          const cost = a.cost ? ` (−${a.cost} ${ch.res.name.toLowerCase()})` : '';
          if (a.roll) rollFor(T, uid, { expr: a.roll, as: 'c:' + ch.id, label: a.name + cost, adv: d.adv, priv: d.priv });
          else log(T, uid, 'abil', `${ch.name} usou ${a.name}${cost}`);
          break;
        }
        case 'ev.save': { need(gm); // momento decisivo: opções para votar (ou cada um responder) e, se quiser, um teste ligado
          const x = d.ev || {}, old = x.id ? T.events.find(e => e.id === String(x.id)) : null;
          const options = strList(x.options, 6, 80); need(options.length || x.check, 'Dê pelo menos uma opção ou um teste');
          if (x.check?.key) need(skillOf(T, x.check.key) || T.attrs.some(a => a.toLowerCase() === String(x.check.key).toLowerCase()), 'O teste precisa de uma perícia ou atributo da mesa');
          const ev = { id: old?.id || id(), at: old?.at || now(), title: clip(x.title, 80) || 'Momento decisivo', text: clip(x.text, 600), options, mode: x.mode === 'each' ? 'each' : 'vote',
            votes: old?.votes || {}, open: old ? old.open : true, result: old?.result || null, checkRes: old?.checkRes || null };
          if (old) Object.assign(old, ev); else {
            T.events.push(ev); if (T.events.length > LIMITS.events) T.events.splice(0, T.events.length - LIMITS.events);
            log(T, uid, 'event', `Momento decisivo: ${ev.title}`);
            if (x.check?.key) op(c, uid, { op: 'ask', key: x.check.key, dc: x.check.dc, dcHidden: x.check.dcHidden, pass: x.check.pass, fail: x.check.fail, label: ev.title, ev: ev.id }, members);
          }
          break;
        }
        case 'ev.vote': { const ev = T.events.find(e => e.id === String(d.id)); need(ev && ev.open, 'Esse momento já foi decidido'); need(members.includes(uid), 'Entre na chamada para votar');
          const o = int(d.opt, -1, ev.options.length - 1); if (o < 0) delete ev.votes[uid]; else ev.votes[uid] = o; break; }
        case 'ev.close': { need(gm); const ev = T.events.find(e => e.id === String(d.id)); need(ev && ev.open, 'Esse momento já foi decidido');
          const tally = ev.options.map((_, i) => Object.values(ev.votes).filter(v => v === i).length);
          const pick = d.opt != null && d.opt !== '' ? int(d.opt, 0, ev.options.length - 1) : (tally.length ? tally.indexOf(Math.max(...tally)) : -1);
          ev.open = false; ev.result = { opt: pick, text: clip(d.text, 400), tally };
          const choice = pick >= 0 ? ev.options[pick] : null;
          const txt = [choice && `Decisão: ${choice}.`, ev.checkRes?.text, ev.result.text && `Consequência: ${ev.result.text}`].filter(Boolean).join(' ');
          log(T, uid, 'event', `${ev.title}: ${txt || 'encerrado'}`);
          T.journal.push({ id: id(), at: now(), by: uid, kind: 'decisao', title: ev.title, text: txt, status: null, priv: false });
          break;
        }
        case 'ev.del': { need(gm); T.events = T.events.filter(e => e.id !== String(d.id)); break; }
        case 'jr.save': { // diário: missões e eventos são do mestre; pistas, NPCs, locais e notas, de todos
          const x = d.entry || {}, old = x.id ? T.journal.find(j => j.id === String(x.id)) : null;
          const kind = JR_KINDS.includes(x.kind) ? x.kind : 'nota';
          need(gm || (JR_PLAYER.includes(kind) && (!old || old.by === uid)), 'Só o mestre escreve isso no diário');
          if (!old) need(T.journal.length < LIMITS.journal, 'Diário cheio: apague entradas antigas');
          const j = { id: old?.id || id(), at: old?.at || now(), by: old?.by || uid, kind, title: clip(x.title, 80) || 'Sem título', text: clip(x.text, 2000),
            status: kind === 'missao' ? (x.status === 'concluida' ? 'concluida' : x.status === 'falhou' ? 'falhou' : 'ativa') : null, priv: gm && !!x.priv };
          if (old) { const done = old.status !== j.status && j.status !== 'ativa'; Object.assign(old, j); if (done && !j.priv) log(T, uid, 'journal', `Missão ${j.status === 'concluida' ? 'concluída' : 'fracassada'}: ${j.title}`); }
          else { T.journal.push(j); if (!j.priv && (kind === 'missao' || kind === 'evento' || d.announce)) log(T, uid, 'journal', `${kind === 'missao' ? 'Nova missão' : 'No diário'}: ${j.title}`); }
          break;
        }
        case 'jr.del': { const j = T.journal.find(x => x.id === String(d.id)); need(j && (gm || j.by === uid), 'Só o mestre ou quem escreveu apaga'); T.journal = T.journal.filter(x => x !== j); break; }
        case 'rest': { need(gm); // descanso: recupera vida e recurso conforme as regras da mesa; o longo tira as condições
          const k = d.kind === 'long' ? 'long' : 'short', R = T.rest[k], out = [];
          for (const ch of T.chars) {
            const rec = (p, lv) => { if (!p || !REST_LV[lv]) return 0; const b = p.cur; p.cur = Math.min(p.max, Math.max(p.cur, 0) + Math.ceil(p.max * REST_LV[lv])); return p.cur - b; };
            const hp = rec(ch.hp, R.hp), rs = rec(ch.res, R.res);
            if (k === 'long') ch.conds = [];
            if (hp || rs) out.push(`${ch.name}${hp ? ` +${hp} vida` : ''}${rs ? ` +${rs} ${ch.res.name.toLowerCase()}` : ''}`);
          }
          if (T.combat) T.combat = null;
          log(T, uid, 'rest', `Descanso ${k === 'long' ? 'longo' : 'curto'}${out.length ? ': ' + out.join(', ') : ''}`);
          break;
        }
        case 'char.save': { // cria ou edita uma ficha
          const x = d.char || {}, old = x.id ? charOf(T, String(x.id)) : null;
          if (old) need(canChar(T, uid, old), 'Essa ficha é de outro jogador');
          else need(T.chars.length < LIMITS.chars, `A mesa já tem ${LIMITS.chars} personagens`);
          const owner = gm && x.owner ? clip(x.owner, 40) : (old?.owner || uid);
          const attrs = {};
          const dnd = T.sys === 'dnd5e', abon = {};
          for (const [k, v] of Object.entries(x.attrs || {}).slice(0, LIMITS.attrs)) { const kk = clip(k, 12); if (kk) attrs[kk] = dnd ? int(v, 1, 30, 10) : int(v, -999, 9999); }
          for (const [k, v] of Object.entries(x.abon || {})) if (k in attrs && int(v, -10, 10)) abon[k] = int(v, -10, 10);
          const ch = { id: old?.id || id(), owner, name: clip(x.name, 40) || 'Sem nome', img: imgUrl(x.img), cls: clip(x.cls, 40), race: clip(x.race, 30), level: int(x.level, 0, 999, 1),
            story: clip(x.story, 3000), pnotes: clip(x.pnotes, 3000), prof: old?.prof || strList(x.prof, LIMITS.skills, 30), sbon: old?.sbon || {}, items: old?.items || [], abil: old?.abil || [], insp: old?.insp || 0,
            hp: pool(x.hp, old?.hp), res: x.res && clip(x.res.name, 20) ? { name: clip(x.res.name, 20), ...pool(x.res, old?.res) } : null,
            attrs, abon, tags: strList(x.tags, LIMITS.tags, 24), skills: clip(x.skills, 2000), notes: clip(x.notes, 2000), conds: old ? old.conds : [] };
          if (old) Object.assign(old, ch); else { T.chars.push(ch); if (!T.active[owner]) T.active[owner] = ch.id; log(T, uid, 'info', `criou a ficha de ${ch.name}`); }
          break;
        }
        case 'char.del': { const ch = charOf(T, String(d.id)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador');
          T.chars = T.chars.filter(x => x !== ch); for (const k in T.active) if (T.active[k] === ch.id) delete T.active[k];
          if (T.combat) dropFromCombat(T, 'c', ch.id); log(T, uid, 'info', `apagou a ficha de ${ch.name}`); break; }
        case 'char.active': { const ch = charOf(T, String(d.id)); need(ch && ch.owner === uid, 'Escolha uma ficha sua'); T.active[uid] = ch.id; break; }
        case 'char.hp': case 'foe.hp': { // dano (delta < 0), cura (delta > 0) ou valor exato (set); res = mana/energia da ficha
          const isFoe = d.op === 'foe.hp', t = isFoe ? foeOf(T, String(d.id)) : charOf(T, String(d.id));
          need(t && (isFoe ? gm : canChar(T, uid, t)), isFoe ? undefined : 'Essa ficha é de outro jogador');
          const p = !isFoe && d.res ? t.res : t.hp; need(p, 'Essa ficha não tem esse recurso');
          const before = p.cur; p.cur = d.set != null ? int(d.set, -1e6, p.max) : int(p.cur + int(d.delta, -1e6, 1e6), -1e6, p.max);
          const diff = p.cur - before; if (!diff) break;
          const what = !isFoe && d.res ? t.res.name : 'vida', verb = diff < 0 ? (d.res ? 'gastou' : 'sofreu') : 'recuperou';
          const txt = `${nm(t)} ${verb} ${Math.abs(diff)} de ${what}`;
          if (!isFoe) log(T, uid, 'hp', `${txt} (${p.cur}/${p.max})`);
          else if (!t.shown) log(T, uid, 'hp', `${txt} (${p.cur}/${p.max})`, { gm: true });
          else { // a frase pública segue o modo de vida do inimigo
            const pub = t.mode === 'show' ? `${txt} (${p.cur}/${p.max})` : t.mode === 'hidden' ? (diff < 0 ? `${txt}` : `${nm(t)} se recuperou`) : `${nm(t)} está ${narr(p.cur, p.max).toLowerCase()}`;
            log(T, uid, 'hp', `${txt} (${p.cur}/${p.max})`, { pub });
          }
          if (isFoe && t.phases?.length) { // chefe com fases: a vida cruzou o limite de uma fase nova
            const pc = t.hp.max > 0 ? t.hp.cur / t.hp.max * 100 : 0; let i = -1; t.phases.forEach((ph, k) => { if (pc <= ph.at) i = k; });
            if (i > t.phase) { t.phase = i; phaseLog(T, uid, t); }
          }
          break;
        }
        case 'tags': { const ch = charOf(T, String(d.id)); need(canChar(T, uid, ch), 'Essa ficha é de outro jogador'); ch.tags = strList(d.tags, LIMITS.tags, 24); break; }
        case 'cond.add': case 'cond.del': { // condições de combate em fichas (dono ou mestre) e inimigos (mestre)
          const ch = d.kind === 'f' ? foeOf(T, String(d.id)) : charOf(T, String(d.id));
          need(ch && (d.kind === 'f' ? gm : canChar(T, uid, ch)), d.kind === 'f' ? undefined : 'Essa ficha é de outro jogador');
          const name = clip(d.name, 30); need(name, 'Dê um nome para a condição');
          ch.conds = (ch.conds || []).filter(x => x.name.toLowerCase() !== name.toLowerCase());
          if (d.op === 'cond.add') { need(ch.conds.length < LIMITS.conds, 'Condições demais'); ch.conds.push(...conds([{ name, turns: d.turns }])); }
          const pub = d.kind !== 'f' || ch.shown;
          log(T, uid, 'cond', `${nm(ch)} ${d.op === 'cond.add' ? 'ficou' : 'não está mais'} ${name.toLowerCase()}${d.op === 'cond.add' && d.turns ? ` (${int(d.turns, 0, 99)} turnos)` : ''}`, pub ? {} : { gm: true });
          break;
        }
        case 'foe.save': { need(gm);
          const x = d.foe || {}, old = x.id ? foeOf(T, String(x.id)) : null;
          if (!old) need(T.foes.length < LIMITS.foes, `No máximo ${LIMITS.foes} inimigos`);
          const phases = (Array.isArray(x.phases) ? x.phases : []).slice(0, 6).map(p => ({ name: clip(p?.name, 40), at: int(p?.at, 1, 100, 50), note: clip(p?.note, 300) })).filter(p => p.name).sort((a, b) => b.at - a.at);
          const f = { id: old?.id || id(), name: clip(x.name, 40) || 'Inimigo', img: imgUrl(x.img), boss: !!x.boss, mode: HP_MODES.includes(x.mode) ? x.mode : 'show',
            kind: clip(x.kind, 40), desc: clip(x.desc, 600), phases, phase: old && old.phases.length === phases.length ? old.phase : -1,
            hp: pool(x.hp, old?.hp), attacks: clip(x.attacks, 2000), abilities: clip(x.abilities, 2000), resist: clip(x.resist, 300), weak: clip(x.weak, 300),
            notes: clip(x.notes, 2000), ini: int(x.ini, -20, 30), conds: old ? old.conds : [], shown: old ? old.shown : !!x.shown };
          if (old) Object.assign(old, f); else { T.foes.push(f); log(T, uid, 'info', `preparou ${f.boss ? 'o chefe' : 'o inimigo'} ${f.name}`, { gm: true }); }
          break;
        }
        case 'foe.dup': { need(gm); const f = foeOf(T, String(d.id)); need(f && T.foes.length < LIMITS.foes, 'No máximo ' + LIMITS.foes + ' inimigos');
          const base = f.name.replace(/\s+\d+$/, ''), n = T.foes.filter(x => x.name.replace(/\s+\d+$/, '') === base).length + 1;
          T.foes.push({ ...structuredClone(f), id: id(), name: `${base} ${n}`.slice(0, 40), hp: { ...f.hp, cur: f.hp.max }, conds: [], shown: false }); break; }
        case 'foe.del': { need(gm); const f = foeOf(T, String(d.id)); if (!f) break; T.foes = T.foes.filter(x => x !== f); if (T.combat) dropFromCombat(T, 'f', f.id); break; }
        case 'foe.show': { need(gm); const f = foeOf(T, String(d.id)); need(f, 'Inimigo não encontrado'); f.shown = !!d.on;
          if (f.shown) log(T, uid, 'scene', `${f.boss ? 'O chefe ' : ''}${f.name} entrou em cena`); break; }
        case 'gm.set': { // passar o mestre (o mestre) ou assumir (quando o mestre não está na chamada)
          const to = clip(d.uid || uid, 40);
          need(gm || (to === uid && !members.includes(T.gm)), 'Só o mestre passa o posto (ou assuma quando ele não estiver na chamada)');
          need(members.includes(to), 'Essa pessoa não está na chamada'); if (to === T.gm) break;
          T.gm = to; log(T, uid, 'info', to === uid ? 'assumiu como mestre' : 'passou o posto de mestre', { to }); break;
        }
        case 'cfg': { need(gm);
          if (d.name != null) T.name = clip(d.name, 40) || 'Mesa de RPG';
          if (d.attrs) T.attrs = strList(d.attrs, LIMITS.attrs, 12);
          if (d.sys === 'dnd5e' || d.sys === 'livre') T.sys = d.sys;
          if (Array.isArray(d.conds)) T.conds = d.conds.slice(0, 30).map(x => ({ name: clip(x?.name, 30), desc: clip(x?.desc, 200), adv: x?.adv === 'adv' || x?.adv === 'dis' ? x.adv : null, bonus: exprOk(x?.bonus, true), tick: exprOk(x?.tick) })).filter(x => x.name);
          if (Array.isArray(d.skills)) T.skills = d.skills.slice(0, LIMITS.skills).map(s => ({ name: clip(s?.name, 30), attr: clip(s?.attr, 12) })).filter(s => s.name && s.attr);
          if (Array.isArray(d.economy)) T.economy = strList(d.economy, 8, 20);
          if (Array.isArray(d.reactions)) T.reactions = d.reactions.slice(0, 12).map(r => ({ name: clip(r?.name, 40), desc: clip(r?.desc, 200) })).filter(r => r.name);
          if (d.insp) T.insp = { max: int(d.insp.max, 1, 10, 4), reroll: !!d.insp.reroll, adv: !!d.insp.adv };
          if (d.rest) for (const k of ['short', 'long']) for (const p of ['hp', 'res']) if (d.rest[k]?.[p] in REST_LV) T.rest[k][p] = d.rest[k][p];
          if (d.nat != null) T.nat = !!d.nat;
          if (d.attrRoll != null) { const e = clip(d.attrRoll, 60) || '1d20+{m}'; roll(e.replace(/\{[vm]\}/g, '1'), { rnd: () => 0 }); T.attrRoll = e; }
          if (d.initRoll != null) { const e = clip(d.initRoll, 60) || '1d20'; roll(e.replace(/@[\p{L}\d_]+/gu, '0'), { rnd: () => 0 }); T.initRoll = e; }
          break;
        }
        case 'combat.start': { need(gm); // entra quem tem ficha ativa na chamada e os inimigos em cena
          const order = [];
          for (const u of members) { const ch = charOf(T, T.active[u]); if (ch) order.push({ id: id(), kind: 'c', ref: ch.id, init: null }); }
          for (const f of T.foes) if (f.shown && f.hp.cur > 0) order.push({ id: id(), kind: 'f', ref: f.id, init: null });
          need(order.length, 'Ninguém para o combate: crie fichas ou ponha inimigos em cena');
          T.combat = { round: 1, turn: 0, order }; for (const e of order) rollInit(T, e); sortCombat(T); T.combat.turn = 0; // todo mundo entra com a iniciativa rolada
          log(T, uid, 'combat', 'Combate começou'); break;
        }
        case 'combat.add': { need(gm); need(T.combat, 'Comece um combate primeiro'); const kind = d.kind === 'f' ? 'f' : 'c', ref = String(d.ref);
          need(kind === 'f' ? foeOf(T, ref) : charOf(T, ref), 'Não encontrado');
          if (!T.combat.order.some(e => e.kind === kind && e.ref === ref)) { const e = { id: id(), kind, ref, init: null }; T.combat.order.push(e); rollInit(T, e); sortCombat(T); } break; }
        case 'combat.remove': { need(gm); need(T.combat); const e = T.combat.order.find(x => x.id === String(d.id)); if (e) dropFromCombat(T, e.kind, e.ref); break; }
        case 'combat.init': { // valor exato ou rolagem da iniciativa (expr da mesa, @atributo da ficha); all: o mestre rola para quem falta
          need(T.combat, 'Não há combate');
          const list = d.all ? (need(gm), T.combat.order.filter(e => e.init == null)) : [T.combat.order.find(x => x.id === String(d.id))];
          for (const e of list) {
            if (!e) continue; const ch = e.kind === 'c' ? charOf(T, e.ref) : foeOf(T, e.ref);
            need(e.kind === 'c' ? canChar(T, uid, ch) : gm, 'Só o dono da ficha ou o mestre');
            if (d.set != null) e.init = int(d.set, -999, 9999);
            else {
              const r = rollInit(T, e);
              if (!d.all && r) log(T, uid, 'roll', 'Iniciativa', { roll: r, label: 'Iniciativa', who: ch.name, ...(e.kind === 'f' && !ch.shown ? { gm: true } : {}) });
            }
          }
          sortCombat(T); break;
        }
        case 'combat.next': case 'combat.prev': { need(gm); const C = T.combat; need(C && C.order.length, 'Não há combate');
          if (d.op === 'combat.next') { // pula inimigo derrotado (ficha a 0 ainda joga: testes contra a morte)
            for (let i = 0; i < C.order.length; i++) {
              C.turn++; if (C.turn >= C.order.length) { C.turn = 0; C.round++; log(T, uid, 'combat', `Rodada ${C.round}`); }
              const e = C.order[C.turn], f = e.kind === 'f' && foeOf(T, e.ref); if (!f || f.hp.cur > 0) break;
            }
            tickConds(T, C.order[C.turn], uid);
          }
          else { C.turn--; if (C.turn < 0) { if (C.round > 1) { C.round--; C.turn = C.order.length - 1; } else C.turn = 0; } }
          break;
        }
        case 'combat.end': { need(gm); if (!T.combat) break; T.combat = null; T.offers = []; log(T, uid, 'combat', 'Combate encerrado'); break; }
        case 'log.clear': { need(gm); T.log = []; log(T, uid, 'info', 'limpou o histórico'); break; }
        default: return { error: 'Operação desconhecida' };
      }
    } catch (e) { return { error: e.message || 'Não deu certo' }; }
    save(c, T); return { ok: true };
  }
  function dropFromCombat(T, kind, ref) {
    const C = T.combat, i = C.order.findIndex(e => e.kind === kind && e.ref === ref); if (i < 0) return;
    C.order.splice(i, 1); if (i < C.turn || C.turn >= C.order.length) C.turn = Math.max(0, Math.min(C.turn - (i < C.turn ? 1 : 0), C.order.length - 1));
  }
  // maior iniciativa primeiro; quem está jogando agora continua sendo a vez
  function sortCombat(T) {
    const C = T.combat, cur = C.order[C.turn]?.id;
    C.order.sort((a, b) => (b.init ?? -1e9) - (a.init ?? -1e9));
    C.turn = Math.max(0, C.order.findIndex(e => e.id === cur));
  }
  // no começo do turno de alguém, as condições com duração perdem um turno (e somem no zero)
  function phaseLog(T, uid, f) {
    const ph = f.phases[f.phase]; if (!ph) { log(T, uid, 'scene', `${f.name} voltou ao normal`, f.shown ? {} : { gm: true }); return; }
    log(T, uid, 'scene', `${f.name} entrou na fase “${ph.name}”`, f.shown ? {} : { gm: true });
    if (ph.note) log(T, uid, 'scene', `${f.name}, fase “${ph.name}”: ${ph.note}`, { gm: true }); // o que muda é só do mestre
  }
  // começo do turno de alguém: ações do turno voltam, dano das condições (queimando, sangrando) e a duração anda
  function tickConds(T, e, uid) {
    if (!e) return; e.used = []; const t = e.kind === 'c' ? charOf(T, e.ref) : foeOf(T, e.ref); if (!t?.conds?.length) return;
    const hide = e.kind === 'f' && !t.shown;
    for (const x of t.conds) { const d = condDef(T, x.name); if (!d?.tick) continue;
      const r = roll(d.tick, { rnd }); t.hp.cur = Math.max(-1e6, t.hp.cur - r.total);
      log(T, uid, 'hp', `${t.name} sofreu ${r.total} (${d.name.toLowerCase()})${e.kind === 'c' || t.mode === 'show' ? ` (${t.hp.cur}/${t.hp.max})` : ''}`, hide ? { gm: true } : {}); }
    for (const x of t.conds) if (x.turns != null) x.turns--;
    const gone = t.conds.filter(x => x.turns != null && x.turns <= 0); t.conds = t.conds.filter(x => !gone.includes(x));
    for (const x of gone) log(T, uid, 'cond', `${t.name} não está mais ${x.name.toLowerCase()}`, e.kind === 'f' && !t.shown ? { gm: true } : {});
  }
  return { open, view, op, canClose, has: (c) => !!load(c), DEF_SKILLS };
}
