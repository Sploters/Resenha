// Mesa de RPG (server/rpg.js) sem servidor: dados, fichas, permissões, inimigos escondidos, combate e persistência.
// Uso: node scripts/rpg-unit-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { createRpg, roll, parseRoll, narr } from '../server/rpg.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const db = new DatabaseSync(':memory:');
const get = (q, ...a) => db.prepare(q).get(...a), all = (q, ...a) => db.prepare(q).all(...a), run = (q, ...a) => db.prepare(q).run(...a);
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; }; // rnd fixo: (k - 1) / faces + ε dá k
const face = (k, f) => (k - 1) / f + 1e-9;

// ---------- dados ----------
{ const r = roll('2d6+3', { rnd: seq(face(4, 6), face(5, 6)) }); ok(r.total === 12 && r.parts[0].rolls.length === 2, '2d6+3 soma dados e modificador', r); }
{ const r = roll('1d20', { adv: 'adv', rnd: seq(face(3, 20), face(17, 20)) }); ok(r.total === 17 && r.expr === '2d20kh1' && r.parts[0].rolls[0].drop, 'vantagem: 2d20, fica o maior', r); }
{ const r = roll('d20+5', { adv: 'dis', rnd: seq(face(3, 20), face(17, 20)) }); ok(r.total === 8, 'desvantagem: fica o menor', r); }
{ const r = roll('1d20', { rnd: seq(face(20, 20)) }); ok(r.crit && !r.fumble, '20 natural é crítico'); }
{ const r = roll('1d20+10', { rnd: seq(face(1, 20)) }); ok(r.fumble && !r.crit && r.total === 11, '1 natural é falha crítica (mesmo com bônus)'); }
{ const r = roll('2d6', { rnd: seq(face(6, 6)) }); ok(!r.crit, '2d6 somados não marcam crítico'); }
{ const r = roll('4d6dl1', { rnd: seq(face(1, 6), face(4, 6), face(5, 6), face(6, 6)) }); ok(r.total === 15, '4d6dl1 descarta o menor', r); }
{ const r = roll('1d6r2', { rnd: seq(face(1, 6), face(5, 6)) }); ok(r.total === 5 && r.parts[0].rolls[0].was === 1, 'r2: rerrola uma vez quem tirou 2 ou menos', r); }
{ const r = roll('1d7+1d13-2', { rnd: seq(face(7, 7), face(1, 13)) }); ok(r.total === 6, 'dados personalizados e modificador negativo', r); }
{ const r = roll('1d20+@for', { attrs: { FOR: 3 }, rnd: seq(face(10, 20)) }); ok(r.total === 13, '@atributo usa o valor da ficha (sem diferenciar maiúsculas)', r); }
{ const r = roll('1d6!', { rnd: seq(face(6, 6), face(6, 6), face(2, 6)) }); ok(r.total === 14 && r.parts[0].rolls.length === 3, 'explosão no máximo', r); }
{ const r = roll('d%', { rnd: seq(face(42, 100)) }); ok(r.total === 42, 'd% é d100'); }
ok(throws(() => parseRoll('1d1'), /faces/), 'recusa d1');
ok(throws(() => parseRoll('500d6'), /dados/), 'recusa dados demais');
ok(throws(() => parseRoll('1d20+@SOR', { FOR: 1 }), /atributo/), 'atributo que a ficha não tem: explica');
ok(throws(() => parseRoll('bola'), /Não entendi/), 'texto qualquer: explica o formato');
ok(narr(20, 20) === 'Ileso' && narr(9, 20) === 'Muito ferido' && narr(0, 20) === 'Derrotado', 'estados narrativos');

// ---------- mesa ----------
const R = createRpg({ db, get, run, rnd: Math.random, now: () => 1e12 });
const C = 'ch1', members = ['mestre', 'ana', 'beto'];
const op = (uid, d) => R.op(C, uid, d, members);
R.open(C, 'mestre', members);
ok(R.view(C, 'ana').gm === 'mestre' && !R.view(C, 'ana').me_gm && R.view(C, 'mestre').me_gm, 'quem abre é o mestre');
ok(op('ana', { op: 'char.save', char: { name: 'Lyra', cls: 'Maga', level: 3, hp: { max: 18 }, res: { name: 'Mana', max: 30 }, attrs: { INT: 4 }, tags: ['elfa', 'elfa', 'curiosa'] } }).ok, 'jogadora cria ficha');
let lyra = R.view(C, 'ana').chars[0];
ok(lyra.hp.cur === 18 && lyra.res.cur === 30 && lyra.tags.length === 2 && R.view(C, 'ana').active.ana === lyra.id, 'vida/mana cheias, tags sem repetição, ficha ativa', lyra);
op('ana', { op: 'char.save', char: { name: 'Lyra 2' } });
ok(R.view(C, 'ana').chars.length === 2, 'vários personagens por jogador');
ok(op('beto', { op: 'char.hp', id: lyra.id, delta: -5 }).error, 'outro jogador não mexe na ficha alheia');
ok(op('mestre', { op: 'char.hp', id: lyra.id, delta: -25 }).ok && R.view(C, 'ana').chars[0].hp.cur === -7, 'mestre causa dano (pode ficar negativa)');
op('ana', { op: 'char.hp', id: lyra.id, delta: 999 });
ok(R.view(C, 'ana').chars[0].hp.cur === 18, 'cura não passa do máximo');
op('ana', { op: 'char.hp', id: lyra.id, res: true, delta: -10 });
ok(R.view(C, 'ana').chars[0].res.cur === 20, 'gasta mana');
op('ana', { op: 'tags', id: lyra.id, tags: ['ferida', 'em fuga'] });
ok(R.view(C, 'beto').chars[0].tags.join() === 'ferida,em fuga', 'tags editadas na hora aparecem para todos');
op('ana', { op: 'roll', expr: '1d20+@INT', label: 'Arcanismo' });
const lr = R.view(C, 'beto').log.at(-1);
ok(lr.kind === 'roll' && lr.roll.parts.length === 2 && lr.char === lyra.id, 'rolagem com atributo da ficha ativa vai para o histórico de todos', lr);
op('mestre', { op: 'roll', expr: '1d20', secret: true });
ok(R.view(C, 'mestre').log.at(-1).gm && R.view(C, 'ana').log.at(-1).id === lr.id, 'rolagem secreta do mestre não aparece para jogadores');
ok(op('ana', { op: 'roll', expr: '1d20', secret: true }).ok && !R.view(C, 'ana').log.at(-1).gm, 'jogador não faz rolagem secreta');

// ---------- inimigos ----------
ok(op('ana', { op: 'foe.save', foe: { name: 'Goblin' } }).error, 'jogador não cria inimigo');
op('mestre', { op: 'foe.save', foe: { name: 'Dragão', boss: true, mode: 'hidden', hp: { max: 200 }, weak: 'gelo', attacks: 'Sopro 10d6' } });
const drag = R.view(C, 'mestre').foes[0];
ok(!R.view(C, 'ana').foes.length, 'inimigo preparado fica escondido dos jogadores');
op('mestre', { op: 'foe.show', id: drag.id, on: true });
op('mestre', { op: 'foe.hp', id: drag.id, delta: -30 });
let pv = R.view(C, 'ana').foes[0];
ok(pv && pv.boss && pv.dmg === 30 && !pv.hp && !pv.weak && !pv.attacks, 'modo oculto: jogador vê só o dano, sem vida, fraquezas nem ataques', pv);
ok(/sofreu 30/.test(R.view(C, 'ana').log.at(-1).text) && !/200/.test(R.view(C, 'ana').log.at(-1).text), 'histórico do jogador não revela a vida');
op('mestre', { op: 'foe.save', foe: { ...drag, mode: 'narr' } });
pv = R.view(C, 'ana').foes[0];
ok(pv.state === 'Arranhado' && pv.dmg === undefined && !pv.hp && R.view(C, 'mestre').foes[0].hp.cur === 170, 'modo narrativo: só o estado; editar não cura', pv);
op('mestre', { op: 'foe.save', foe: { ...drag, mode: 'show' } });
ok(R.view(C, 'ana').foes[0].hp.cur === 170, 'modo visível: números para todos');
op('mestre', { op: 'foe.dup', id: drag.id });
ok(R.view(C, 'mestre').foes[1].name === 'Dragão 2' && !R.view(C, 'ana').foes[1], 'duplicar cria cópia escondida e numerada');

// ---------- combate ----------
op('beto', { op: 'char.save', char: { name: 'Bruk', attrs: { DES: 2 } } });
op('mestre', { op: 'combat.start' });
let cb = R.view(C, 'mestre').combat;
ok(cb.order.length === 3 && cb.round === 1, 'combate: fichas ativas da chamada + inimigos em cena (não os escondidos)', cb);
ok(R.view(C, 'ana').combat.order.length === 3, 'jogador vê a ordem');
const eLyra = cb.order.find(e => e.ref === lyra.id), eDrag = cb.order.find(e => e.kind === 'f');
ok(op('beto', { op: 'combat.init', id: eLyra.id, set: 30 }).error, 'iniciativa alheia: não');
op('ana', { op: 'combat.init', id: eLyra.id, set: 5 });
op('mestre', { op: 'combat.init', id: eDrag.id, set: 20 });
op('mestre', { op: 'combat.init', all: true });
cb = R.view(C, 'mestre').combat;
ok(cb.order.every(e => e.init != null) && cb.order[0].id === eDrag.id, 'ordem pela iniciativa, mestre rola o resto', cb.order);
op('ana', { op: 'cond.add', id: lyra.id, name: 'Envenenado', turns: 1 });
ok(R.view(C, 'beto').chars[0].conds[0].name === 'Envenenado', 'condição com duração');
const steps = cb.order.length; for (let i = 0; i < steps; i++) op('mestre', { op: 'combat.next' });
ok(R.view(C, 'mestre').combat.round === 2, 'próximo turno avança a rodada');
ok(!R.view(C, 'mestre').chars[0].conds.length, 'condição some quando acaba a duração');
ok(op('ana', { op: 'combat.next' }).error, 'jogador não passa o turno');
op('mestre', { op: 'foe.del', id: drag.id });
ok(R.view(C, 'mestre').combat.order.length === steps - 1, 'inimigo apagado sai do combate');
op('mestre', { op: 'combat.end' });
ok(!R.view(C, 'ana').combat, 'encerrar combate');

// ---------- mestre e config ----------
ok(op('ana', { op: 'gm.set' }).error, 'não assume com o mestre na chamada');
ok(op('ana', { op: 'gm.set' }) && R.op(C, 'ana', { op: 'gm.set' }, ['ana', 'beto']).ok && R.view(C, 'ana').me_gm, 'assume quando o mestre saiu da chamada');
ok(R.op(C, 'ana', { op: 'cfg', attrs: ['Corpo', 'Mente'], attrRoll: '{v}d6' }, ['ana']).ok && R.view(C, 'beto').attrs.join() === 'Corpo,Mente', 'mestre troca os atributos e a rolagem (universal)');
ok(R.op(C, 'ana', { op: 'cfg', attrRoll: 'abc' }, ['ana']).error, 'rolagem de atributo inválida é recusada');
ok(R.op(C, 'beto', { op: 'char.save', char: { name: 'X', img: 'javascript:alert(1)' } }, ['ana', 'beto']).ok && R.view(C, 'ana').chars.at(-1).img === '', 'imagem só de /files, /avatars ou https');

// ---------- persistência ----------
const R2 = createRpg({ db, get, run });
ok(R2.view(C, 'ana').chars.length === 4 && R2.view(C, 'ana').me_gm, 'mesa volta do banco (servidor reiniciou)');
R2.open(C, 'beto', ['beto']);
ok(R2.view(C, 'beto').me_gm, 'reabrir sem o mestre na chamada: quem abriu assume');
ok(R2.canClose(C, 'beto', ['beto', 'ana']) && !R2.canClose(C, 'ana', ['beto', 'ana']), 'só o mestre fecha a mesa');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
