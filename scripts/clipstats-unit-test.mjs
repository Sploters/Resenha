// Clipes: regras puras de engajamento (visualização qualificada, batidas do player e proteções), ranking semanal ponderado,
// categorias e recomendações (server/clipstats.js). Sem servidor nem navegador. Uso: node scripts/clipstats-unit-test.mjs
import { CFG, qualifyMs, applyBeat, isQualified, minViewsFor, weeklyRanking, recommend } from '../server/clipstats.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const T0 = 1_800_000_000_000, S = 1000, D = 864e5;

console.log('visualização qualificada');
ok(qualifyMs(30 * S) === 6000, 'clipe de 30 s: 6 s assistidos qualificam');
ok(qualifyMs(10 * S) === 4000, 'clipe de 10 s: 40% (4 s)');
ok(qualifyMs(2 * S) === 2000, 'nunca menos de 2 s');
ok(!isQualified(1500, 30 * S), 'abrir e fechar (1,5 s) não conta');
ok(isQualified(6000, 30 * S), '6 s de 30 s contam');

console.log('batidas do player (antimanipulação)');
const sess = (o = {}) => ({ started_at: T0, last_at: null, watched_ms: 0, covered_ms: 0, ...o });
let r = applyBeat(sess(), { watched_ms: 5000, covered_ms: 5000 }, { now: T0 + 5000, durationMs: 30 * S });
ok(r.watched_ms === 5000 && r.covered_ms === 5000 && !r.clamped.length, 'batida normal passa inteira', r);
r = applyBeat(sess(), { watched_ms: 60000, covered_ms: 30000 }, { now: T0 + 2000, durationMs: 30 * S });
ok(r.watched_ms <= 2000 * CFG.MAX_RATE + CFG.SLACK_MS && r.clamped.includes('rate'), 'relatar mais tempo que o relógio permite é cortado', r);
ok(!isQualified(r.covered_ms, 30 * S) || r.covered_ms <= 5500, 'script que manda "assisti tudo" em 2 s não ganha o clipe inteiro', r);
r = applyBeat(sess({ watched_ms: 30000, covered_ms: 30000, last_at: T0 + 30000 }), { watched_ms: 300000, covered_ms: 300000 }, { now: T0 + 200000, durationMs: 30 * S });
ok(r.covered_ms === 30000 && r.clamped.includes('duration'), 'loop: cobertura nunca passa da duração', r);
r = applyBeat(sess({ watched_ms: 8000, covered_ms: 8000, last_at: T0 + 8000 }), { watched_ms: 1000, covered_ms: 500 }, { now: T0 + 10000, durationMs: 30 * S });
ok(r.watched_ms === 8000 && r.covered_ms === 8000, 'valores nunca diminuem', r);
r = applyBeat(sess({ last_at: T0 + 5000 }), { watched_ms: 5100, covered_ms: 5100 }, { now: T0 + 5300, durationMs: 30 * S });
ok(r.ignored === 'burst', 'rajada de batidas (menos de 0,9 s) é ignorada', r);
r = applyBeat(sess(), { watched_ms: 5000, covered_ms: 5000 }, { now: T0 + 3 * 3600e3, durationMs: 30 * S });
ok(r.ignored === 'expired', 'sessão velha (mais de 2 h) não aceita batidas', r);
r = applyBeat(sess(), { watched_ms: 'abc', covered_ms: NaN }, { now: T0 + 4000, durationMs: 30 * S });
ok(r.watched_ms === 0 && r.covered_ms === 0, 'lixo vira zero', r);
r = applyBeat(sess({ watched_ms: 4000, covered_ms: 4000, last_at: T0 + 4000 }), { watched_ms: 30000, covered_ms: 30000 }, { now: T0 + 5000, durationMs: 30 * S });
ok(r.watched_ms <= 4000 + 1000 * CFG.MAX_RATE + CFG.SLACK_MS, 'salto desde a última batida também é limitado', r);
r = applyBeat(sess(), { watched_ms: 4000, covered_ms: 9000 }, { now: T0 + 6000, durationMs: 30 * S });
ok(r.covered_ms === 4000, 'cobertura não passa do tempo tocado', r);

console.log('mínimo de dados');
ok(minViewsFor(50) === 3 && minViewsFor(3) === 2 && minViewsFor(2) === 2, 'mínimo de 3 views (2 em grupos pequenos)', [minViewsFor(50), minViewsFor(3), minViewsFor(2)]);
const it = (id, o) => ({ id, views: 0, likes: 0, shares: 0, comp_sum: 0, watch_sum: 0, recent: 0, created_at: T0, min_views: 3, baseline: 0, ...o });
let w = weeklyRanking([]);
ok(w.top.length === 0 && w.quiet && !w.categories.length, 'semana vazia: nada, marcada como devagar', w);
w = weeklyRanking([it('a', { views: 2, likes: 2, comp_sum: 2 }), it('b', { views: 1 })]);
ok(w.top.length === 0 && w.eligible === 0, 'abaixo do mínimo não entra (2 views)', w);
w = weeklyRanking([it('a', { views: 3, likes: 1, comp_sum: 2.4 })]);
ok(w.top.length === 1 && w.quiet && w.top[0].score > 0, 'um único clipe elegível aparece, com aviso de semana devagar', w);

console.log('ranking ponderado e normalização');
const week = [
  it('viral', { views: 40, likes: 6, shares: 2, comp_sum: 40 * 0.35, recent: 5 }),   // muita gente, assistem pouco, curtem pouco
  it('joia', { views: 6, likes: 5, shares: 3, comp_sum: 6 * 0.95, recent: 2 }),     // pouca gente, todo mundo amou
  it('ok', { views: 10, likes: 2, shares: 0, comp_sum: 10 * 0.6 }),
  it('fraco', { views: 4, likes: 0, shares: 0, comp_sum: 4 * 0.2 }),
];
w = weeklyRanking(week);
ok(w.top[0].id === 'joia', 'clipe pequeno com ótima retenção/curtidas/compartilhamentos vence o "viral" de pouca qualidade', w.top.map(t => [t.id, t.score]));
ok(w.top.at(-1).id === 'fraco', 'retenção baixa e sem curtidas fica por último', w.top.map(t => t.id));
ok(w.top.every(t => Object.values(t.parts).every(v => v >= 0 && v <= 1.0001)), 'componentes normalizados entre 0 e 1', w.top.map(t => t.parts));
ok(w.top.find(t => t.id === 'viral').parts.views === 1 && w.top.find(t => t.id === 'joia').parts.views > 0.5, 'visualizações em escala log: 6 views ainda valem mais da metade de 40', w.top.map(t => [t.id, t.parts.views]));
const sc = (p) => Math.round(100 * (0.35 * p.retention + 0.25 * p.likes + 0.25 * p.shares + 0.15 * p.views));
ok(w.top.every(t => Math.abs(sc(t.parts) - t.score) <= 1), 'pesos 35/25/25/15 (nota = soma ponderada)', w.top.map(t => [t.score, sc(t.parts)]));
// suavização: 3 views e 3 curtidas não vira "100% de curtidas" contra 30 views e 24 curtidas
w = weeklyRanking([it('sorte', { views: 3, likes: 3, comp_sum: 3 * 0.7 }), it('consistente', { views: 30, likes: 24, comp_sum: 30 * 0.7 })]);
ok(w.top[0].id === 'consistente', 'taxa suavizada: poucos dados não ganham por sorte', w.top);
ok(weeklyRanking(Array.from({ length: 9 }, (_, i) => it('c' + i, { views: 3 + i, comp_sum: 2 }))).top.length === 5, 'Top 5 no máximo (o app mostra 3 e expande)');

console.log('categorias');
w = weeklyRanking([
  it('t1', { views: 9, likes: 6, shares: 3, comp_sum: 8 }), it('t2', { views: 8, likes: 5, shares: 2, comp_sum: 7 }), it('t3', { views: 8, likes: 4, shares: 2, comp_sum: 6.5 }),
  it('pop', { views: 30, likes: 3, comp_sum: 9 }), it('amado', { views: 12, likes: 7, comp_sum: 5 }),
  it('sobe', { views: 6, likes: 1, comp_sum: 3, recent: 6, baseline: 2 }), it('achado', { views: 3, likes: 2, shares: 1, comp_sum: 2.9 }),
]);
const cat = Object.fromEntries(w.categories.map(c => [c.kind, c.id]));
ok(cat.popular === 'pop', 'Mais popular: mais visualizações', cat);
ok(cat.crowd === 'amado', 'Favorito da galera: mais curtidas', cat);
ok(cat.surprise === 'sobe', 'Surpresa da semana: 3× o normal do criador nas últimas 48 h', cat);
ok(cat.discovery === 'achado', 'Descoberta: poucas views e engajamento alto', cat);
ok(new Set(w.categories.map(c => c.id)).size === w.categories.length, 'cada categoria com um clipe diferente');
w = weeklyRanking([it('x', { views: 3, comp_sum: 1 }), it('y', { views: 3, comp_sum: 1 })]);
ok(!w.categories.some(c => c.kind === 'crowd' || c.kind === 'surprise'), 'sem dado suficiente a categoria não aparece (nada de destaque inventado)', w.categories);

console.log('recomendações');
const prof = { games: new Map([['n:valorant', 5], ['n:hades', 1]]), gameTitles: new Map([['n:valorant', 'VALORANT']]), creators: new Map([['ana', 4]]) };
const cand = (id, o) => ({ id, created_at: T0 - D, game_keys: [], game_title: null, creators: ['zeca'], friend_author: false, you: false, friend_likes: 0, friend_shares: 0, friend_views: 0, quality: null, views: 0, ...o });
let rec = recommend([cand('val', { game_keys: ['n:valorant'], game_title: 'VALORANT' }), cand('nada'), cand('ana', { creators: ['ana'] }), cand('amigos', { friend_likes: 3 }), cand('eu', { you: true })], prof, { now: T0 });
const rid = rec.map(x => x.id);
ok(!rid.includes('nada'), 'sem nenhum sinal não é recomendado', rid);
ok(rec.find(x => x.id === 'val')?.reason.text === 'Porque você curte VALORANT', 'motivo explicável pelo jogo', rec);
ok(rec.find(x => x.id === 'amigos')?.reason.text === '3 amigos curtiram', 'motivo pelos amigos', rec);
ok(rec.find(x => x.id === 'ana')?.reason.kind === 'creator', 'criador com quem mais interage', rec);
ok(rid[0] === 'eu', 'você aparece no clipe vem primeiro', rid);
ok(rec.length <= 4, 'no máximo 4 recomendações');
// pouco dado (usuário novo, sem histórico): ainda recomenda pelo que é bom e pelo que é de amigo
rec = recommend([cand('bom', { quality: 0.9, views: 8 }), cand('amigo', { friend_author: true }), cand('velho', { created_at: T0 - 40 * D })], { games: new Map(), gameTitles: new Map(), creators: new Map() }, { now: T0 });
ok(rec[0]?.id === 'bom' && rec[0].reason.kind === 'quality', 'sem histórico: recomenda o que está em alta', rec);
ok(rec.some(x => x.id === 'amigo' && x.reason.kind === 'buddy'), 'sem histórico: clipe novo de amigo', rec);
// novidade pesa
rec = recommend([cand('novo', { game_keys: ['n:valorant'], created_at: T0 - 3600e3 }), cand('antigo', { game_keys: ['n:valorant'], created_at: T0 - 20 * D })], prof, { now: T0 });
ok(rec[0].id === 'novo', 'mesmo sinal: o mais novo primeiro', rec.map(x => x.id));

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
