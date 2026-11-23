// Radar: regras puras (Riot ID, estatísticas, amostra mínima, relatório do time) e o limitador de requisições.
// Sem servidor nem navegador. Uso: node scripts/radar-unit-test.mjs
import { parseRiotId, parseRiotIds, slimMatch, playerStats, playerFlags, teamReport, extLinks, rankScore, MIN } from '../server/radarstats.js';
import { createLimiter } from '../server/radar.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

console.log('Riot ID');
ok(parseRiotId('Faker#KR1')?.text === 'Faker#KR1', 'Nome#TAG');
ok(parseRiotId('  Nome Longo #BR1 ')?.text === 'Nome Longo#BR1', 'espaços em volta do #');
ok(parseRiotId('ab#BR1') === null && parseRiotId('Nome#X') === null && parseRiotId('semtag') === null, 'curto demais ou sem tag: inválido');
ok(parseRiotIds('A1a#BR1\nB2b #BR1 entrou no saguão, a1a#br1; C3c#BR1').map(x => x.text).join('|') === 'A1a#BR1|B2b#BR1|C3c#BR1', 'lote: linhas, vírgulas, texto do saguão, sem repetidos');
ok(extLinks('Nome Longo#BR1', 'br1')[0].url === 'https://op.gg/lol/summoners/br/Nome%20Longo-BR1' && extLinks('Nome Longo#BR1', 'br1')[1].url.includes('u.gg/lol/profile/br1/'), 'links OP.GG e U.GG');

console.log('partidas');
const P = 'me';
const mk = (i, o = {}) => ({ metadata: { matchId: 'BR1_' + i }, info: { queueId: o.q ?? 420, gameStartTimestamp: 1e12 + i * 1e6, gameDuration: 1800,
  participants: [{ puuid: P, championId: o.c ?? 103, championName: o.n ?? 'Ahri', teamPosition: o.pos ?? 'MIDDLE', win: o.w ?? true, kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 200, neutralMinionsKilled: 4, gameEndedInEarlySurrender: !!o.remake }, { puuid: 'other', championId: 1 }] } });
ok(slimMatch(mk(1), 'nobody') === null, 'partida sem o jogador: ignorada');
const s1 = slimMatch(mk(1), P); ok(s1.champ === 103 && s1.cs === 204 && s1.pos === 'MIDDLE' && !('participants' in s1), 'resumo só com o jogador');
const few = playerStats([1, 2, 3].map(i => slimMatch(mk(i, { w: i !== 2 }), P)));
ok(few.games === 3 && few.wr === null && few.champs[0].wr === null && few.champs[0].wins === 2 && few.champs[0].small, 'amostra pequena: sem win rate (só V/D)', few.champs[0]);
ok(playerFlags(few).length === 0, 'amostra pequena: nenhum destaque');
const ms = [];
for (let i = 0; i < 8; i++) ms.push(slimMatch(mk(i, { w: i % 2 === 0 }), P));
for (let i = 8; i < 10; i++) ms.push(slimMatch(mk(i, { c: 238, n: 'Zed' }), P));
for (let i = 10; i < 12; i++) ms.push(slimMatch(mk(i, { c: 7, n: 'LeBlanc', pos: '' }), P));
ms.push(slimMatch(mk(20, { q: 450, c: 1, n: 'Annie' }), P), slimMatch(mk(21, { remake: true }), P), slimMatch(mk(22, { q: 0 }), P));
const st = playerStats(ms);
ok(st.games === 12, 'ARAM, remake e personalizada fora da amostra', st.games);
ok(st.champs[0].name === 'Ahri' && st.champs[0].games === 8 && st.champs[0].wr === 50 && st.champs[0].share === 67, 'campeão mais jogado com win rate', st.champs[0]);
ok(st.unknownPos === 2 && st.roles[0].pos === 'MIDDLE' && st.roles[0].share === 100 && st.mainRole === 'MIDDLE', 'posição principal só com posição conhecida');
ok(st.period.from < st.period.to && st.recent.length === 10 && st.recent[0].at >= st.recent[1].at, 'período e recentes em ordem');
const fl = playerFlags(st);
ok(fl.some(f => f.kind === 'specialist' && f.champ === 103) && fl.some(f => f.kind === 'pool') && fl.some(f => f.kind === 'role'), 'especialista, pool concentrada e posição', fl);

console.log('time');
const pl = (riotId, stats, tier) => ({ riotId, status: 'done', data: { ranks: { solo: tier ? { tier, rank: 'II', leaguePoints: 10 } : null }, stats, flags: playerFlags(stats) } });
const rep = teamReport([pl('A#BR1', st, 'GOLD'), pl('B#BR1', st, 'DIAMOND'), { riotId: 'C#BR1', status: 'error', data: null }]);
ok(rep.players === 2 && rep.totalGames === 24 && rep.highest.riotId === 'B#BR1', 'só os carregados entram; maior elo', rep.highest);
ok(rep.champs[0].games === 16 && rep.champs[0].players.length === 2, 'campeões somados no time');
ok(rep.trends.some(t => /Ahri.*2 jogadores/.test(t.text)), 'campeão forte para 2 jogadores vira candidato a ban', rep.trends);
ok(rep.limits.some(l => /1 de 3/.test(l)), 'limitação: jogador sem dados');
ok(!rep.trends.some(t => /Ninguém tem/.test(t.text)), 'posições não analisadas com menos de 4 jogadores');
ok(teamReport([]).players === 0 && teamReport([]).avg === null, 'time vazio');
ok(rankScore({ tier: 'GOLD', rank: 'I', leaguePoints: 0 }) > rankScore({ tier: 'GOLD', rank: 'IV', leaguePoints: 99 }) && rankScore(null) === -1, 'ordem de elos');
ok(MIN.wr >= 5 && MIN.pool >= 10, 'amostras mínimas');

console.log('limitador');
const lim = createLimiter('3:1'), t0 = Date.now();
for (let i = 0; i < 4; i++) await lim.take();
ok(Date.now() - t0 >= 990, '4ª requisição espera a janela de 1 s', Date.now() - t0);
lim.pause(300); const t1 = Date.now(); await lim.take(); ok(Date.now() - t1 >= 290, '429: pausa geral respeitada');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo certo'); process.exit(fails ? 1 : 0);
