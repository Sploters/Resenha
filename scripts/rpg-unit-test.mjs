// Mesa de RPG (server/rpg.js) sem servidor: dados, fichas, permissões, inimigos escondidos, combate e persistência.
// Uso: node scripts/rpg-unit-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { createRpg, roll, parseRoll, narr, mod, prof } from '../server/rpg.js';
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

// ---------- D&D 5e: valor do atributo vira modificador ----------
ok(mod(17) === 3 && mod(10) === 0 && mod(8) === -1 && mod(20) === 5 && mod(1) === -5, 'modificador: (valor − 10) ÷ 2, para baixo');
ok(prof(1) === 2 && prof(4) === 2 && prof(5) === 3 && prof(13) === 5 && prof(20) === 6, 'proficiência pelo nível');
{
  const D = 'dnd', m2 = ['gm', 'joa'], o = (u, d) => R.op(D, u, d, m2);
  R.open(D, 'gm', m2);
  ok(R.view(D, 'gm').sys === 'dnd5e' && R.view(D, 'gm').attrRoll === '1d20+{m}', 'mesa nova já é D&D 5e');
  o('joa', { op: 'char.save', char: { name: 'Tor', level: 5, attrs: { FOR: 15, DES: 12 }, abon: { FOR: 2 } } });
  o('joa', { op: 'roll', expr: '1d20+@FOR+@PROF' });
  const parts = R.view(D, 'joa').log.at(-1).roll.parts;
  ok(parts[1].v === 3 && parts[2].v === 3, 'FOR 15 + 2 da raça = 17 → +3 no dado (não +17); proficiência do nível 5 = +3', parts);
  ok(o('joa', { op: 'char.save', char: { name: 'Y', attrs: { FOR: 99 } } }).ok && R.view(D, 'joa').chars.at(-1).attrs.FOR === 30, 'valor do atributo vai até 30');
  o('gm', { op: 'foe.save', foe: { name: 'Lobo', hp: { max: 11 }, ini: 2 } });
  const lobo = R.view(D, 'gm').foes[0];
  o('gm', { op: 'roll', expr: '1d20+4', as: 'f:' + lobo.id });
  ok(R.view(D, 'gm').log.at(-1).who === 'Lobo' && R.view(D, 'gm').log.at(-1).gm && R.view(D, 'joa').log.at(-1)?.who !== 'Lobo', 'mestre rola pelo inimigo; fora de cena, só ele vê');
  ok(o('joa', { op: 'roll', expr: '1d20', as: 'f:' + lobo.id }).error, 'jogador não rola pelo inimigo');
  o('gm', { op: 'foe.show', id: lobo.id, on: true }); o('gm', { op: 'foe.dup', id: lobo.id });
  o('gm', { op: 'combat.start' });
  const cb = R.view(D, 'gm').combat;
  ok(cb.order.length === 2 && cb.order.every(e => Number.isFinite(e.init)), 'começar combate já rola a iniciativa de todos (o lobo fora de cena não entra)', cb.order);
  const first = cb.order[0], second = cb.order[1];
  const foeE = cb.order.find(e => e.kind === 'f');
  o('gm', { op: 'foe.hp', id: foeE.ref, set: 0 });
  if (first.kind === 'c') { o('gm', { op: 'combat.next' }); ok(R.view(D, 'gm').combat.round === 2 && R.view(D, 'gm').combat.cur === first.id, 'inimigo derrotado é pulado no próximo turno'); }
  else { o('gm', { op: 'combat.next' }); ok(R.view(D, 'gm').combat.cur === second.id, 'próximo turno vai para a ficha'); o('gm', { op: 'combat.next' }); ok(R.view(D, 'gm').combat.round === 2 && R.view(D, 'gm').combat.cur === second.id, 'inimigo derrotado é pulado no próximo turno'); }
  // mesa salva antes do sistema de atributos
  run('INSERT INTO rpg_tables(channel_id, data, updated_at) VALUES(?,?,?)', 'velha', JSON.stringify({ v: 1, gm: 'gm', name: 'X', attrs: ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'], conds: [], attrRoll: '1d20+{v}', initRoll: '1d20', chars: [{ id: 'a', owner: 'joa', name: 'A', attrs: { FOR: 3 }, tags: [], hp: { cur: 1, max: 1 } }], active: {}, foes: [], combat: null, log: [] }), 1);
  const V = R.view('velha', 'gm');
  ok(V.sys === 'dnd5e' && V.attrRoll === '1d20+{m}' && V.initRoll === '1d20+@DES' && V.chars[0].abon, 'mesa antiga com atributos de D&D passa para o sistema novo', V);
}

// ---------- perícias, testes pedidos, inspiração, efeitos, reações, fases, inventário, eventos, diário, descanso ----------
{
  const B = 'bg', mm = ['gm', 'ana', 'beto'], o = (u, d) => R.op(B, u, d, mm), V = (u) => R.view(B, u), last = (u) => V(u).log.at(-1);
  R.open(B, 'gm', mm);
  ok(V('ana').skills.length === 18 && V('ana').skills.find(s => s.name === 'Furtividade').attr === 'DES', 'perícias do D&D prontas (configuráveis)');
  o('ana', { op: 'char.save', char: { name: 'Lyra', level: 1, attrs: { FOR: 8, DES: 14, CON: 12, INT: 15, SAB: 10, CAR: 13 }, hp: { max: 20 }, res: { name: 'Mana', max: 10 }, pnotes: 'segredo da Lyra' } });
  o('beto', { op: 'char.save', char: { name: 'Bruk', level: 1, attrs: { FOR: 16, DES: 10 }, hp: { max: 30 } } });
  const lyra = V('ana').chars.find(c => c.name === 'Lyra'), bruk = V('ana').chars.find(c => c.name === 'Bruk');
  ok(V('beto').chars.find(c => c.id === lyra.id).pnotes === undefined && V('gm').chars.find(c => c.id === lyra.id).pnotes === 'segredo da Lyra', 'anotação privada: só a dona e o mestre');
  ok(o('beto', { op: 'char.prof', id: lyra.id, skill: 'Furtividade', on: true }).error, 'perícia treinada de outro: não');
  o('ana', { op: 'char.prof', id: lyra.id, skill: 'Furtividade', on: true });
  o('ana', { op: 'check', key: 'Furtividade', dc: 12 });
  let e = last('ana');
  ok(e.check?.key === 'Furtividade' && e.roll.parts.map(p => p.t).join() === '1d20,@DES,@PROF' && e.roll.parts[1].v === 2 && e.roll.parts[2].v === 2, 'teste: d20 + DES (+2) + proficiência (+2)', e.roll.parts);
  ok(e.check.ok === (e.roll.crit || (!e.roll.fumble && e.roll.total >= 12)), 'sucesso contra a CD (20 natural passa, 1 natural falha)', e.check);
  // teste pedido pelo mestre, com CD escondida
  ok(o('ana', { op: 'ask', key: 'Atletismo', dc: 15 }).error, 'só o mestre pede teste');
  o('gm', { op: 'ask', key: 'Atletismo', dc: 15, dcHidden: true, pass: 'A porta cede.', fail: 'O barulho acorda os guardas.' });
  const ask = V('gm').asks.at(-1);
  ok(ask.targets.length === 2 && V('ana').asks[0].dc === null && V('ana').asks[0].fail === undefined && V('gm').asks.at(-1).dc === 15, 'teste para o grupo; jogador não vê a CD escondida nem as consequências');
  o('ana', { op: 'check', ask: ask.id });
  ok(V('ana').asks[0].res[lyra.id] && last('beto').check.dc === null, 'resposta registrada; a CD continua escondida no histórico', last('beto').check);
  ok(o('ana', { op: 'check', ask: ask.id }).error, 'não repete o teste pedido');
  o('beto', { op: 'check', ask: ask.id, as: 'c:' + bruk.id });
  o('gm', { op: 'ask.close', id: ask.id });
  ok(/Atletismo CD 15: Lyra \d+ [✓✗], Bruk \d+ [✓✗]\. (Sucesso: A porta cede\.|Falha: O barulho acorda os guardas\.)/.test(last('ana').text) && !V('ana').asks.length, 'encerrar: resultado do grupo e a consequência para todos', last('ana').text);
  // rolagem privada
  o('ana', { op: 'roll', expr: '1d20', priv: true });
  ok(last('ana').priv && last('gm').priv && !last('beto').priv, 'rolagem privada: quem rolou e o mestre');
  // inspiração
  ok(o('ana', { op: 'insp', id: lyra.id, delta: 1 }).error, 'jogador não se dá inspiração');
  o('gm', { op: 'insp', id: lyra.id, delta: 1, why: 'boa ideia' });
  ok(V('ana').chars.find(c => c.id === lyra.id).insp === 1 && /ganhou inspiração/.test(last('ana').text), 'mestre dá inspiração (registrado)');
  ok(o('beto', { op: 'insp.use', id: lyra.id, mode: 'adv' }).error, 'só a dona gasta');
  o('ana', { op: 'insp.use', id: lyra.id, mode: 'adv' });
  o('ana', { op: 'roll', expr: '1d20+1' });
  e = last('ana');
  ok(e.roll.adv === 'adv' && e.fx?.includes('Inspiração') && V('ana').chars.find(c => c.id === lyra.id).insp === 0, 'inspiração: vantagem na próxima rolagem de d20', e);
  ok(o('ana', { op: 'insp.use', id: lyra.id, mode: 'reroll' }).error, 'sem inspiração não rola de novo');
  o('gm', { op: 'insp', id: lyra.id, delta: 1 });
  o('ana', { op: 'check', key: 'Arcanismo', dc: 10 });
  const before = last('ana').id;
  o('ana', { op: 'insp.use', id: lyra.id, mode: 'reroll' });
  e = last('ana');
  ok(e.id !== before && /Arcanismo \(inspiração\)/.test(e.label) && e.check?.key === 'Arcanismo', 'inspiração: rola de novo a última (o mesmo teste)', e.label);
  o('gm', { op: 'cfg', insp: { max: 2, reroll: false, adv: true } });
  o('gm', { op: 'insp', id: lyra.id, delta: 1 });
  ok(o('ana', { op: 'insp.use', id: lyra.id, mode: 'reroll' }).error, 'o mestre configura o que a inspiração faz');
  // condições com efeito
  o('gm', { op: 'cond.add', id: bruk.id, name: 'Envenenado' });
  o('beto', { op: 'roll', expr: '1d20+3', as: 'c:' + bruk.id });
  ok(last('beto').roll.adv === 'dis' && last('beto').fx?.includes('Envenenado'), 'envenenado: desvantagem no d20');
  o('beto', { op: 'roll', expr: '2d6', as: 'c:' + bruk.id });
  ok(!last('beto').roll.adv && !last('beto').fx, 'efeito não entra em rolagem sem d20 (dano)');
  o('gm', { op: 'cond.add', id: bruk.id, name: 'Abençoado' });
  o('beto', { op: 'check', key: 'Atletismo', as: 'c:' + bruk.id });
  ok(last('beto').roll.parts.some(p => p.t === '1d4') && last('beto').roll.adv === 'dis', 'abençoado: +1d4 no teste (e o veneno continua)', last('beto').roll.parts.map(p => p.t));
  o('gm', { op: 'cond.add', id: bruk.id, name: 'Invisível' });
  o('beto', { op: 'roll', expr: '1d20', as: 'c:' + bruk.id });
  ok(!last('beto').roll.adv, 'vantagem e desvantagem se anulam');
  // combate: ações por turno, reações, ordem, dano por turno, fases do chefe
  o('gm', { op: 'foe.save', foe: { name: 'Ogro', hp: { max: 100 }, desc: 'Fede.', kind: 'Gigante', phases: [{ name: 'Fúria', at: 50, note: 'ataca duas vezes' }] } });
  const ogro = V('gm').foes[0];
  o('gm', { op: 'foe.show', id: ogro.id, on: true });
  o('gm', { op: 'combat.start' });
  let C = V('gm').combat; const eBruk = C.order.find(x => x.ref === bruk.id), eOgro = C.order.find(x => x.ref === ogro.id);
  o('beto', { op: 'eco', id: eBruk.id, name: 'Ação' });
  ok(V('ana').combat.order.find(x => x.id === eBruk.id).used.includes('Ação'), 'ação gasta aparece para todos');
  ok(o('ana', { op: 'eco', id: eBruk.id, name: 'Ação' }).error, 'ação de outro: não');
  o('gm', { op: 'react.offer', char: bruk.id, name: 'Proteger aliado', text: 'o ogro ataca a Lyra' });
  ok(V('beto').offers.length === 1 && V('ana').offers.length === 0, 'reação oferecida aparece só para o dono da ficha');
  ok(o('gm', { op: 'react.offer', char: bruk.id, name: 'Voar' }).error, 'só reações permitidas pela mesa');
  o('beto', { op: 'react.answer', id: V('beto').offers[0].id, accept: true });
  ok(V('ana').combat.order.find(x => x.id === eBruk.id).used.includes('Reação') && /Bruk reagiu: Proteger aliado/.test(last('ana').text), 'aceitou: gasta a reação e fica no histórico');
  o('gm', { op: 'react.offer', char: bruk.id, name: 'Contra-ataque' });
  ok(o('beto', { op: 'react.answer', id: V('beto').offers[0].id, accept: true }).error, 'reação já usada na rodada: não');
  const i0 = C.order.findIndex(x => x.id === eOgro.id);
  o('gm', { op: 'combat.move', id: eOgro.id, dir: i0 === 0 ? 1 : -1 });
  ok(V('gm').combat.order.findIndex(x => x.id === eOgro.id) === (i0 === 0 ? 1 : i0 - 1), 'mestre ajusta a ordem');
  o('gm', { op: 'cond.add', kind: 'f', id: ogro.id, name: 'Queimando' });
  const hp0 = V('gm').foes[0].hp.cur;
  for (let k = 0; k < 4 && V('gm').combat.cur !== eOgro.id; k++) o('gm', { op: 'combat.next' });
  if (V('gm').combat.cur !== eOgro.id) o('gm', { op: 'combat.next' });
  ok(V('gm').foes[0].hp.cur < hp0, 'queimando: dano no começo do turno', { hp0, now: V('gm').foes[0].hp.cur });
  o('gm', { op: 'foe.hp', id: ogro.id, set: 40 });
  ok(V('ana').foes[0].phaseName === 'Fúria' && V('ana').foes[0].desc === 'Fede.' && !V('ana').log.some(x => /duas vezes/.test(x.text)) && V('gm').log.some(x => /duas vezes/.test(x.text)), 'chefe muda de fase sozinho; o que muda é só do mestre');
  // inventário
  o('ana', { op: 'item.save', char: lyra.id, item: { name: 'Poção de cura', kind: 'pocao', qty: 2, cons: true, heal: '2d4+2' } });
  ok(o('ana', { op: 'item.save', char: lyra.id, item: { name: 'X', heal: 'bola' } }).error, 'cura inválida é recusada');
  o('gm', { op: 'char.hp', id: lyra.id, delta: -15 });
  const pot = V('ana').chars.find(c => c.id === lyra.id).items[0];
  o('ana', { op: 'item.use', char: lyra.id, id: pot.id });
  const ly = V('ana').chars.find(c => c.id === lyra.id);
  ok(ly.hp.cur > 5 && ly.items[0].qty === 1 && /usou Poção de cura: \+\d+ de vida/.test(last('beto').text), 'poção: cura e gasta uma', ly.hp);
  o('ana', { op: 'item.give', char: lyra.id, id: pot.id, to: bruk.id });
  ok(!V('ana').chars.find(c => c.id === lyra.id).items.length && V('ana').chars.find(c => c.id === bruk.id).items[0].name === 'Poção de cura', 'entregar item a outra ficha');
  o('gm', { op: 'item.save', char: lyra.id, item: { name: 'Espada longa', kind: 'arma', props: '1d8 cortante' } });
  ok(/Lyra recebeu Espada longa/.test(last('ana').text), 'mestre entrega item (registrado)');
  ok(o('beto', { op: 'item.save', char: lyra.id, item: { name: 'Roubo' } }).error, 'inventário de outro: não');
  const sw = V('ana').chars.find(c => c.id === lyra.id).items[0];
  o('ana', { op: 'item.eq', char: lyra.id, id: sw.id });
  ok(V('ana').chars.find(c => c.id === lyra.id).items[0].eq, 'equipar');
  // habilidades e magias
  o('ana', { op: 'abil.save', char: lyra.id, abil: { name: 'Mísseis mágicos', kind: 'magia', cost: 3, roll: '3d4+3' } });
  const mm1 = V('ana').chars.find(c => c.id === lyra.id).abil[0];
  o('ana', { op: 'abil.use', char: lyra.id, id: mm1.id });
  ok(V('ana').chars.find(c => c.id === lyra.id).res.cur === 7 && /Mísseis mágicos \(−3 mana\)/.test(last('ana').label), 'magia gasta mana e rola', last('ana').label);
  o('ana', { op: 'abil.use', char: lyra.id, id: mm1.id }); o('ana', { op: 'abil.use', char: lyra.id, id: mm1.id });
  ok(o('ana', { op: 'abil.use', char: lyra.id, id: mm1.id }).error, 'sem mana: não usa');
  // momento decisivo
  o('gm', { op: 'combat.end' });
  ok(o('ana', { op: 'ev.save', ev: { title: 'X', options: ['a'] } }).error, 'só o mestre cria momentos decisivos');
  o('gm', { op: 'ev.save', ev: { title: 'O guarda desconfia', text: 'Ele bloqueia o portão.', options: ['Convencer', 'Lutar', 'Fugir'], check: { key: 'Persuasão', dc: 13, fail: 'Ele chama reforços.' } } });
  const ev = V('ana').events[0];
  ok(ev.open && ev.options.length === 3 && V('ana').asks.at(-1).label === 'O guarda desconfia', 'momento decisivo com opções e teste ligado');
  o('ana', { op: 'ev.vote', id: ev.id, opt: 0 }); o('beto', { op: 'ev.vote', id: ev.id, opt: 0 }); o('beto', { op: 'ev.vote', id: ev.id, opt: 2 });
  ok(V('gm').events[0].votes.beto === 2, 'voto pode mudar');
  o('gm', { op: 'ev.close', id: ev.id, text: 'O portão se abre.' });
  ok(/Decisão: Convencer|Decisão: Fugir/.test(last('ana').text) && V('ana').journal.some(j => j.kind === 'decisao' && /O portão se abre/.test(j.text)), 'decisão registrada no histórico e no diário', last('ana').text);
  // diário
  ok(o('ana', { op: 'jr.save', entry: { kind: 'missao', title: 'X' } }).error && o('ana', { op: 'jr.save', entry: { kind: 'pista', title: 'Pegadas de lobo' } }).ok, 'jogador anota pistas; missões são do mestre');
  o('gm', { op: 'jr.save', entry: { kind: 'missao', title: 'Resgatar o ferreiro' } });
  o('gm', { op: 'jr.save', entry: { kind: 'nota', title: 'O ferreiro é o vilão', priv: true } });
  ok(V('ana').journal.some(j => j.title === 'Resgatar o ferreiro' && j.status === 'ativa') && !V('ana').journal.some(j => /vilão/.test(j.title)) && V('gm').journal.some(j => /vilão/.test(j.title)), 'missão ativa para todos; anotação privada só do mestre');
  const pista = V('gm').journal.find(j => j.kind === 'pista');
  ok(o('beto', { op: 'jr.del', id: pista.id }).error && o('ana', { op: 'jr.del', id: pista.id }).ok, 'apaga só quem escreveu (ou o mestre)');
  // descanso
  o('gm', { op: 'char.hp', id: bruk.id, set: 2 });
  o('gm', { op: 'rest', kind: 'short' });
  ok(V('ana').chars.find(c => c.id === bruk.id).hp.cur === 2 + Math.ceil(30 * .25) && V('ana').chars.find(c => c.id === bruk.id).conds.length === 3, 'descanso curto: um quarto da vida, condições ficam');
  o('gm', { op: 'rest', kind: 'long' });
  const bk = V('ana').chars.find(c => c.id === bruk.id), lx = V('ana').chars.find(c => c.id === lyra.id);
  ok(bk.hp.cur === 30 && !bk.conds.length && lx.res.cur === 10 && /Descanso longo/.test(last('ana').text), 'descanso longo: vida e mana cheias, condições somem');
  ok(o('ana', { op: 'rest', kind: 'long' }).error, 'só o mestre manda descansar');
  ok(R.op(B, 'gm', { op: 'cfg', conds: [{ name: 'Gelado', adv: 'dis', tick: '1d6', bonus: '-1' }] }, mm).ok && V('ana').conds[0].bonus === '-1', 'mestre cria condição com efeitos');
  ok(R.op(B, 'gm', { op: 'cfg', conds: [{ name: 'Ruim', tick: 'abc' }] }, mm).error, 'efeito inválido é recusado');
}

// ---------- persistência ----------
const R2 = createRpg({ db, get, run });
ok(R2.view(C, 'ana').chars.length === 4 && R2.view(C, 'ana').me_gm, 'mesa volta do banco (servidor reiniciou)');
R2.open(C, 'beto', ['beto']);
ok(R2.view(C, 'beto').me_gm, 'reabrir sem o mestre na chamada: quem abriu assume');
ok(R2.canClose(C, 'beto', ['beto', 'ana']) && !R2.canClose(C, 'ana', ['beto', 'ana']), 'só o mestre fecha a mesa');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
