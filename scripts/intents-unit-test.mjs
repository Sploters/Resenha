// "A fim de jogar": regras puras de compatibilidade, ranking, limites de aviso, formação do grupo e validade
// (server/intentmatch.js). Sem servidor nem navegador. Uso: node scripts/intents-unit-test.mjs
import { LIMITS, gameKeyOf, scoreCandidate, excludedBy, deliveryFor, rankCandidates, validity, sizeRules, groupState, statusOf, canJoin, findDuplicate, normTitle } from '../server/intentmatch.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const NOW = 1_800_000_000_000, MIN = 60e3, H = 3600e3;

console.log('chave do jogo');
ok(gameKeyOf({ appid: '730', lfg: 'cs2', title: 'Counter-Strike 2' }) === 'steam:730', 'appid da Steam tem prioridade');
ok(gameKeyOf({ lfg: 'valorant', title: 'Valorant' }) === 'lfg:valorant', 'jogo do catálogo do LFG');
ok(gameKeyOf({ lfg: 'other', title: 'Deep Rock Galactic!' }) === 'name:deeprockgalactic', '"Outro jogo" usa o nome normalizado');
ok(gameKeyOf({ title: 'VALORANT' }) === gameKeyOf({ title: 'Valorant' }), 'maiúsculas e acentos não mudam a chave');
ok(gameKeyOf({ title: '  ' }) === null && gameKeyOf({ appid: 'abc' }) === null, 'sem nome válido: sem chave');
ok(normTitle('Pokémon Unite') === 'pokemonunite', 'acentos removidos');

console.log('compatibilidade');
const base = { uid: 'x', friend: true, status: 'online' };
const now1 = scoreCandidate({ ...base, playingNow: true });
ok(now1.match && now1.reasons[0] === 'Jogando agora', 'jogando agora é o sinal mais forte', now1);
const own = scoreCandidate({ ...base, ownsMinutes: 7200 });
ok(own.match && own.reasons.includes('Tem na Steam · 120 h'), 'tem na Steam com horas', own.reasons);
const rec = scoreCandidate({ ...base, playedDaysAgo: 1 }), old = scoreCandidate({ ...base, playedDaysAgo: 10 }), tooOld = scoreCandidate({ ...base, playedDaysAgo: 30 });
ok(rec.reasons[0] === 'Jogou ontem' && rec.score > old.score, 'jogou ontem vale mais que há 10 dias', [rec, old]);
ok(!tooOld.match, 'jogou há 30 dias não conta');
ok(scoreCandidate({ ...base, wishlist: true }).reasons[0] === 'Quer o jogo', 'wishlist conta pouco, mas conta');
ok(!scoreCandidate({ ...base, wishlist: true, ownsMinutes: 10 }).reasons.includes('Quer o jogo'), 'quem já tem não aparece como "quer"');
ok(!scoreCandidate({ ...base }).match, 'só ser amigo online não é compatibilidade com o jogo');
const ign = scoreCandidate({ ...base, ownsMinutes: 0, ignoredRecent: 9 });
ok(ign.score === scoreCandidate({ ...base, ownsMinutes: 0 }).score - 3, 'quem ignorou muitas vezes perde no máximo 3 pontos');
ok(scoreCandidate({ ...base, friend: false, ownsMinutes: 0 }).score < scoreCandidate({ ...base, ownsMinutes: 0 }).score, 'amigo vem antes de quem só divide servidor');

console.log('preferências');
ok(excludedBy({ prefs: { mode: 'off' } }, 'lfg:valorant') === 'off', 'desligado: não recebe');
ok(excludedBy({ friend: false, prefs: { mode: 'friends' } }, 'lfg:valorant') === 'friends_only', 'só amigos: quem só divide servidor não chama');
ok(excludedBy({ friend: true, prefs: { mode: 'friends' } }, 'lfg:valorant') === null, 'só amigos: amigo chama');
ok(excludedBy({ prefs: { muted: { 'lfg:valorant': NOW + H } } }, 'lfg:valorant', NOW) === 'muted', 'jogo silenciado hoje');
ok(excludedBy({ prefs: { muted: { 'lfg:valorant': NOW - 1 } } }, 'lfg:valorant', NOW) === null, 'silêncio vencido volta a receber');
ok(excludedBy({ prefs: { muted: { 'lfg:valorant': true } } }, 'lfg:valorant', NOW) === 'muted', 'jogo silenciado para sempre');
ok(excludedBy({ prefs: {} }, 'lfg:valorant') === null, 'sem preferência: recebe (padrão)');

console.log('como avisar (limites)');
ok(deliveryFor({ status: 'online' }, NOW).delivery === 'push', 'online: aviso com som');
ok(deliveryFor({ status: 'dnd' }, NOW).why === 'dnd', 'não perturbe: em silêncio');
ok(deliveryFor({ status: 'offline' }, NOW).why === 'offline' && deliveryFor({ status: 'invisible' }, NOW).why === 'offline', 'offline/invisível: em silêncio (vê quando voltar)');
ok(deliveryFor({ status: 'online', receivedLastHour: LIMITS.rxPerHour }, NOW).why === 'limit', `${LIMITS.rxPerHour} avisos na última hora: o próximo é em silêncio`);
ok(deliveryFor({ status: 'online', receivedLastHour: LIMITS.rxPerHour - 1 }, NOW).delivery === 'push', 'abaixo do limite: aviso normal');
ok(deliveryFor({ status: 'online', lastFromAuthorAt: NOW - 10 * MIN }, NOW).why === 'cooldown', 'mesmo autor há 10 min: em silêncio');
ok(deliveryFor({ status: 'online', lastFromAuthorAt: NOW - 31 * MIN }, NOW).delivery === 'push', 'mesmo autor há 31 min: pode tocar');

console.log('ranking e convites direcionados');
const C = [
  { uid: 'ana', name: 'ana', friend: true, status: 'online', playingNow: true },
  { uid: 'beto', name: 'beto', friend: true, status: 'online', ownsMinutes: 7200 },
  { uid: 'caio', name: 'caio', friend: false, status: 'online', playedDaysAgo: 2 },
  { uid: 'duda', name: 'duda', friend: true, status: 'online' },                      // não tem o jogo
  { uid: 'eva', name: 'eva', friend: true, status: 'dnd', ownsMinutes: 30 },
  { uid: 'fabi', name: 'fabi', friend: true, status: 'online', ownsMinutes: 60, prefs: { mode: 'off' } },
  { uid: 'gil', name: 'gil', friend: true, status: 'offline', lfgProfile: true },
];
const r = rankCandidates(C, 'lfg:valorant', { now: NOW, fanout: 3 });
ok(!r.fallback, 'há gente com o jogo: sem plano B');
ok(r.list[0].uid === 'ana' && r.list[1].uid === 'beto', 'ordem: jogando agora > tem com muitas horas', r.list.map(x => x.uid));
ok(!r.list.some(x => x.uid === 'duda'), 'quem não tem nenhum sinal do jogo não é chamado');
ok(r.excluded.some(x => x.uid === 'fabi' && x.why === 'off') && !r.list.some(x => x.uid === 'fabi'), 'preferência desligada é respeitada');
ok(r.list.filter(x => x.selected).length === 3, 'só os 3 primeiros (fanout) vêm marcados');
ok(r.list.find(x => x.uid === 'eva')?.delivery === 'quiet' && r.list.find(x => x.uid === 'gil')?.delivery === 'quiet', 'não perturbe e offline entram em silêncio');
const r2 = rankCandidates(C, 'lfg:valorant', { now: NOW, skip: new Set(['ana', 'beto']) });
ok(!r2.list.some(x => x.uid === 'ana' || x.uid === 'beto'), '"Chamar mais" pula quem já foi chamado');
const fb = rankCandidates([{ uid: 'duda', friend: true, status: 'online' }, { uid: 'zeca', friend: true, status: 'offline' }, { uid: 'srv', friend: false, status: 'online' }], 'name:jogoobscuro', { now: NOW });
ok(fb.fallback && fb.list.length === 1 && fb.list[0].uid === 'duda' && fb.list[0].reasons[0] === 'Amigo online', 'jogo sem informação: plano B só com amigos online', fb);
ok(rankCandidates([], 'lfg:valorant').list.length === 0, 'sem ninguém no círculo: lista vazia, sem erro');

console.log('validade');
const v1 = validity({ availability: 'now', validMin: 60 }, NOW);
ok(v1.startsAt === NOW && v1.expiresAt === NOW + H, 'agora por 1 h');
const v2 = validity({ availability: 'later', startsAt: NOW + 2 * H, validMin: 90 }, NOW);
ok(v2.startsAt === NOW + 2 * H && v2.expiresAt === NOW + 3.5 * H, 'mais tarde: começa no horário e vale 1h30 depois');
ok(validity({ validMin: 5 }, NOW).error && validity({ validMin: 999 }, NOW).error, 'validade fora de 15 min–6 h é recusada');
ok(validity({ availability: 'later', startsAt: NOW + 13 * H, validMin: 60 }, NOW).error, 'mais de 12 h à frente é recusado');
ok(validity({ availability: 'later', startsAt: NOW - 2 * H, validMin: 60 }, NOW).error, 'horário no passado é recusado');
ok(validity({ availability: 'sempre' }, NOW).error, 'disponibilidade desconhecida é recusada');

console.log('tamanho e formação');
ok(sizeRules({ min: 1 }).error && sizeRules({ min: 11 }).error, 'mínimo fora de 2–10 é recusado');
ok(sizeRules({ min: 4, max: 3 }).error, 'máximo menor que o mínimo é recusado');
ok(JSON.stringify(sizeRules({ min: '3', max: '' })) === '{"min":3,"max":null}', 'máximo vazio = sem limite');
ok(!groupState({ min: 3, max: 5, joined: 1 }).reached && groupState({ min: 3, max: 5, joined: 1 }).missing === 1, '2 de 3: falta 1');
ok(groupState({ min: 3, max: 5, joined: 2 }).reached, '3 de 3: forma');
ok(groupState({ min: 3, max: 5, joined: 4 }).full && groupState({ min: 3, max: 5, joined: 4 }).free === 0, '5 de 5: completo');
ok(!groupState({ min: 2, max: null, joined: 30 }).full, 'sem máximo nunca fica completo');

console.log('estado e entrada');
const it = { state: 'open', expires_at: NOW + H, min_size: 2, max_size: 3 };
ok(statusOf(it, NOW) === 'open' && statusOf(it, NOW + H) === 'expired', 'aberta → expirada no horário');
ok(statusOf({ ...it, state: 'formed' }, NOW + 2 * H) === 'ended', 'formada que passou do horário: encerrada (não "expirada")');
ok(statusOf({ ...it, state: 'canceled' }, NOW) === 'canceled', 'cancelada');
ok(canJoin(it, 0, NOW).ok && canJoin(it, 1, NOW).ok, 'há vaga: entra');
ok(canJoin(it, 2, NOW).code === 'full', 'sala cheia (3 de 3): não entra');
ok(canJoin(it, 0, NOW + H).code === 'expired', 'expirada: não entra');
ok(canJoin({ ...it, state: 'canceled' }, 0, NOW).code === 'canceled', 'cancelada: não entra');

console.log('deduplicação');
const live = [
  { id: 'i1', author_id: 'ana', game_key: 'lfg:valorant', state: 'open', expires_at: NOW + H, invited: ['eu'] },
  { id: 'i2', author_id: 'beto', game_key: 'lfg:valorant', state: 'open', expires_at: NOW + H, invited: [] },
  { id: 'i3', author_id: 'caio', game_key: 'steam:730', state: 'open', expires_at: NOW - 1, invited: ['eu'] },
];
ok(findDuplicate(live, { gameKey: 'lfg:valorant', me: 'eu', visible: () => true }, NOW)?.id === 'i1', 'prefere a intenção em que já fui convidado');
ok(findDuplicate(live, { gameKey: 'lfg:valorant', me: 'eu', visible: (a) => a === 'beto' }, NOW.valueOf())?.id === 'i1', 'convidado vale mesmo fora do círculo visível');
ok(findDuplicate(live.slice(1), { gameKey: 'lfg:valorant', me: 'eu', visible: (a) => a === 'beto' }, NOW)?.id === 'i2', 'senão, uma do meu círculo');
ok(findDuplicate(live, { gameKey: 'steam:730', me: 'eu', visible: () => true }, NOW) === null, 'expirada não conta');
ok(findDuplicate(live, { gameKey: 'lfg:valorant', me: 'ana', visible: () => false }, NOW) === null, 'a minha própria não é duplicata');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
