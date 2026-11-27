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
// A visão de cada pessoa é montada por view(): o que é do mestre (rolagens secretas, ataques, fraquezas) não sai dele.
export const LIMITS = { chars: 40, foes: 60, log: 150, dice: 200, count: 100, faces: 1000, tags: 12, conds: 12, attrs: 16 };
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const strList = (v, max, len) => (Array.isArray(v) ? [...new Set(v.map(x => clip(x, len)).filter(Boolean))].slice(0, max) : []);
const imgUrl = (v) => { const s = clip(v, 500); return /^(\/files\/|\/avatars\/|https:\/\/)[^\s"'<>]*$/.test(s) ? s : ''; };
const HP_MODES = ['show', 'hidden', 'narr'];
const DEF_ATTRS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
const DEF_CONDS = ['Envenenado', 'Queimando', 'Atordoado', 'Sangrando', 'Caído', 'Cego', 'Paralisado', 'Amedrontado', 'Invisível', 'Abençoado'];

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
  const fresh = (gm) => ({ v: 1, gm, name: 'Mesa de RPG', attrs: [...DEF_ATTRS], conds: [...DEF_CONDS], sys: 'dnd5e', attrRoll: '1d20+{m}', initRoll: '1d20+@DES', chars: [], active: {}, foes: [], combat: null, log: [] });
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
    for (const ch of T.chars) ch.abon ||= {};
  }
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

  // ---------- visão por pessoa ----------
  function view(c, uid) {
    const T = load(c); if (!T) return null;
    const gm = T.gm === uid;
    const foes = gm ? T.foes : T.foes.filter(f => f.shown).map(f => {
      const pub = { id: f.id, name: f.name, img: f.img, boss: f.boss, mode: f.mode, conds: f.conds, shown: true };
      if (f.mode === 'show') pub.hp = f.hp;
      else if (f.mode === 'hidden') pub.dmg = Math.max(0, f.hp.max - f.hp.cur);
      pub.state = narr(f.hp.cur, f.hp.max); // nos três modos: "Derrotado" aparece para todos
      return pub;
    });
    const fShown = new Set(foes.map(f => f.id));
    const combat = T.combat && { ...T.combat, order: gm ? T.combat.order : T.combat.order.filter(e => e.kind === 'c' || fShown.has(e.ref)) };
    // de quem é a vez (se for de um inimigo escondido, o jogador não vê ninguém marcado)
    if (combat) combat.cur = T.combat.order[T.combat.turn]?.id || null;
    return { channel_id: c, gm: T.gm, me_gm: gm, name: T.name, sys: T.sys, attrs: T.attrs, conds: T.conds, attrRoll: T.attrRoll, initRoll: T.initRoll,
      chars: T.chars, active: T.active, foes, combat, log: gm ? T.log : T.log.filter(e => !e.gm).map(e => (e.pub != null ? { ...e, text: e.pub, pub: undefined, gmText: undefined } : e)) };
  }

  // abre a mesa da sala: nova (quem abriu é o mestre) ou a guardada; o mestre que não está na chamada passa a vez
  function open(c, uid, members = []) {
    let T = load(c);
    if (!T) { T = fresh(uid); tables.set(c, T); log(T, uid, 'info', 'abriu a mesa e é o mestre'); }
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
          // rolar como: a ficha em uso, ou (mestre) qualquer ficha ou inimigo
          let actor = null, isF = false;
          if (d.as) { const [k, rid] = String(d.as).split(':'); isF = k === 'f'; actor = isF ? foeOf(T, rid) : charOf(T, rid); need(actor && (isF ? gm : canChar(T, uid, actor)), 'Você não pode rolar por esse personagem'); }
          else { actor = charOf(T, T.active[uid]) || null; if (actor && !canChar(T, uid, actor)) actor = null; }
          const adv = d.adv === 'adv' || d.adv === 'dis' ? d.adv : null;
          const r = roll(d.expr, { attrs: isF ? {} : rollAttrs(T, actor), adv, rnd });
          const label = clip(d.label, 40), secret = (!!d.secret && gm) || (isF && !actor.shown); // inimigo fora de cena: só o mestre vê
          log(T, uid, 'roll', label || r.expr, { roll: r, label, ...(actor ? { who: actor.name, char: isF ? null : actor.id } : {}), ...(secret ? { gm: true } : {}) });
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
          const f = { id: old?.id || id(), name: clip(x.name, 40) || 'Inimigo', img: imgUrl(x.img), boss: !!x.boss, mode: HP_MODES.includes(x.mode) ? x.mode : 'show',
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
          if (d.conds) T.conds = strList(d.conds, 30, 30);
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
        case 'combat.end': { need(gm); if (!T.combat) break; T.combat = null; log(T, uid, 'combat', 'Combate encerrado'); break; }
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
  function tickConds(T, e, uid) {
    if (!e) return; const t = e.kind === 'c' ? charOf(T, e.ref) : foeOf(T, e.ref); if (!t?.conds?.length) return;
    for (const x of t.conds) if (x.turns != null) x.turns--;
    const gone = t.conds.filter(x => x.turns != null && x.turns <= 0); t.conds = t.conds.filter(x => !gone.includes(x));
    for (const x of gone) log(T, uid, 'cond', `${t.name} não está mais ${x.name.toLowerCase()}`, e.kind === 'f' && !t.shown ? { gm: true } : {});
  }
  return { open, view, op, canClose, has: (c) => !!load(c) };
}
