// Radar (scouting de Clash): regras puras, sem rede nem banco — Riot ID, filas, estatísticas por jogador e o relatório do time.
// Princípio: nada é estimado. Cada número diz de quantas partidas veio; conclusões ("especialista", "pool concentrada",
// "posição principal") só aparecem com amostra mínima (MIN_*), e o relatório sempre traz período e limitações.

export const MIN = { wr: 5, mainRole: 8, specialist: 5, pool: 10, trend: 8 };

// "Nome#TAG" (gameName 3–16, tagLine 3–5, regra da Riot). Aceita espaços em volta do #.
export function parseRiotId(s) {
  const m = String(s || '').trim().match(/^(.{3,16}?)\s*#\s*([\p{L}\p{N}]{3,5})$/u);
  if (!m) return null;
  const name = m[1].trim(); if (name.length < 3) return null;
  return { gameName: name, tagLine: m[2], text: `${name}#${m[2]}` };
}
// colar uma lista solta: uma por linha, vírgulas, ou o texto do lobby ("Nome #TAG entrou no saguão")
export function parseRiotIds(text) {
  const out = [], seen = new Set();
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const line = raw.replace(/\s+(entrou no saguão|joined the lobby|saiu do saguão|left the lobby)\.?\s*$/i, '').trim();
    const id = parseRiotId(line); if (!id) continue;
    const k = id.text.toLowerCase(); if (seen.has(k)) continue;
    seen.add(k); out.push(id);
  }
  return out;
}

// servidores (plataforma) → região do Account-V1/Match-V5, e o código usado nos links externos
export const PLATFORMS = {
  br1: { name: 'Brasil', region: 'americas', site: 'br' }, la1: { name: 'LAN', region: 'americas', site: 'lan' }, la2: { name: 'LAS', region: 'americas', site: 'las' },
  na1: { name: 'América do Norte', region: 'americas', site: 'na' }, euw1: { name: 'Europa Oeste', region: 'europe', site: 'euw' }, eun1: { name: 'Europa Nórdica e Leste', region: 'europe', site: 'eune' },
  tr1: { name: 'Turquia', region: 'europe', site: 'tr' }, ru: { name: 'Rússia', region: 'europe', site: 'ru' }, kr: { name: 'Coreia', region: 'asia', site: 'kr' }, jp1: { name: 'Japão', region: 'asia', site: 'jp' },
  oc1: { name: 'Oceania', region: 'sea', site: 'oce' },
};

// filas de Summoner's Rift que entram nas estatísticas (ARAM, Arena e personalizadas ficam de fora: outro jogo/sem posições)
export const QUEUES = { 400: 'Normal (escolha)', 420: 'Ranqueada Solo/Duo', 430: 'Normal (às cegas)', 440: 'Ranqueada Flex', 490: 'Partida rápida', 700: 'Clash' };
export const isCustom = (q) => !q; // queueId 0 = personalizada: nunca usada (exige autorização própria da Riot)

export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const DIV = { IV: 0, III: 1, II: 2, I: 3 };
// valor para comparar elos (tier, divisão, PdL)
export const rankScore = (e) => (e && TIERS.includes(e.tier) ? TIERS.indexOf(e.tier) * 10000 + (TIERS.indexOf(e.tier) >= 7 ? 0 : (DIV[e.rank] ?? 0) * 1000) + Math.min(+e.leaguePoints || 0, 999) : -1);
export const rankText = (e) => (!e ? 'Sem ranque' : `${TIER_PT[e.tier] || e.tier}${TIERS.indexOf(e.tier) >= 7 ? '' : ' ' + e.rank} · ${e.leaguePoints} PdL`);

export const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
export const POS_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };

// resumo de uma partida do Match-V5 do ponto de vista de um jogador (só o que é usado; nada de outros participantes)
export function slimMatch(m, puuid) {
  const info = m?.info; if (!info) return null;
  const p = info.participants?.find(x => x.puuid === puuid); if (!p) return null;
  return { id: m.metadata?.matchId, queue: info.queueId, at: info.gameStartTimestamp || info.gameCreation, dur: info.gameDuration,
    champ: p.championId, champName: p.championName, pos: POSITIONS.includes(p.teamPosition) ? p.teamPosition : null,
    win: !!p.win, k: p.kills, d: p.deaths, a: p.assists, cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0), remake: !!p.gameEndedInEarlySurrender };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
// estatísticas de um jogador a partir das partidas resumidas (slimMatch). Remakes não contam.
export function playerStats(matches) {
  const ms = (matches || []).filter(m => m && !m.remake && QUEUES[m.queue]).sort((a, b) => b.at - a.at);
  const n = ms.length, champs = new Map(), pos = Object.fromEntries(POSITIONS.map(p => [p, 0])), queues = {};
  let wins = 0, unknownPos = 0;
  for (const m of ms) {
    if (m.win) wins++;
    queues[m.queue] = (queues[m.queue] || 0) + 1;
    if (m.pos) pos[m.pos]++; else unknownPos++;
    const c = champs.get(m.champ) || { champ: m.champ, name: m.champName, games: 0, wins: 0, k: 0, d: 0, a: 0 };
    c.games++; if (m.win) c.wins++; c.k += m.k; c.d += m.d; c.a += m.a; champs.set(m.champ, c);
  }
  const champList = [...champs.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).map(c => ({
    champ: c.champ, name: c.name, games: c.games, wins: c.wins, share: pct(c.games, n),
    wr: c.games >= MIN.wr ? pct(c.wins, c.games) : null, // win rate só com amostra mínima; abaixo disso mostra V/D
    kda: c.d ? +((c.k + c.a) / c.d).toFixed(1) : null, small: c.games < MIN.wr }));
  const known = n - unknownPos;
  const roles = POSITIONS.map(p => ({ pos: p, games: pos[p], share: pct(pos[p], known) })).filter(r => r.games).sort((a, b) => b.games - a.games);
  const main = known >= MIN.mainRole && roles[0] && roles[0].share >= 60 ? roles[0].pos : null;
  return {
    games: n, wins, wr: n >= MIN.wr ? pct(wins, n) : null,
    period: n ? { from: ms[n - 1].at, to: ms[0].at } : null,
    queues, champs: champList, roles, mainRole: main, unknownPos,
    recent: ms.slice(0, 10).map(m => ({ id: m.id, champ: m.champ, champName: m.champName, win: m.win, k: m.k, d: m.d, a: m.a, pos: m.pos, queue: m.queue, at: m.at, dur: m.dur })),
  };
}

// observações individuais com base suficiente (o que vira destaque no cartão)
export function playerFlags(st) {
  const out = [];
  if (!st || st.games === 0) return out;
  const top = st.champs[0];
  if (top && top.games >= MIN.specialist && top.share >= 40) out.push({ kind: 'specialist', champ: top.champ, text: `Especialista: ${top.name} em ${top.games} de ${st.games} partidas (${top.share}%)` });
  if (st.games >= MIN.pool) {
    const top3 = st.champs.slice(0, 3).reduce((s, c) => s + c.games, 0);
    if (pct(top3, st.games) >= 70) out.push({ kind: 'pool', text: `Pool concentrada: ${st.champs.slice(0, 3).map(c => c.name).join(', ')} somam ${pct(top3, st.games)}% de ${st.games} partidas` });
    else if (st.champs.length >= Math.ceil(st.games * 0.6)) out.push({ kind: 'wide', text: `Pool ampla: ${st.champs.length} campeões diferentes em ${st.games} partidas` });
  }
  if (st.mainRole) { const r = st.roles[0]; out.push({ kind: 'role', pos: r.pos, text: `Joga de ${POS_PT[r.pos]} em ${r.share}% das partidas com posição (${r.games})` }); }
  return out;
}

// relatório do time: só jogadores já carregados entram; cada conclusão traz a base
export function teamReport(players) {
  const ok = players.filter(p => p && p.status === 'done' && p.data);
  const elo = ok.map(p => ({ riotId: p.riotId, solo: p.data.ranks?.solo || null, flex: p.data.ranks?.flex || null }));
  const ranked = elo.filter(e => e.solo).sort((a, b) => rankScore(b.solo) - rankScore(a.solo));
  // campeões mais jogados pelo time (soma das amostras de cada um)
  const champMap = new Map();
  for (const p of ok) for (const c of p.data.stats?.champs || []) {
    const t = champMap.get(c.champ) || { champ: c.champ, name: c.name, games: 0, wins: 0, players: [] };
    t.games += c.games; t.wins += c.wins; t.players.push({ riotId: p.riotId, games: c.games }); champMap.set(c.champ, t);
  }
  const champs = [...champMap.values()].sort((a, b) => b.games - a.games).slice(0, 10).map(c => ({ ...c, wr: c.games >= MIN.wr ? pct(c.wins, c.games) : null }));
  const specialists = [], pools = [], trends = [];
  for (const p of ok) for (const f of p.data.flags || []) {
    if (f.kind === 'specialist') specialists.push({ riotId: p.riotId, champ: f.champ, text: f.text });
    if (f.kind === 'pool') pools.push({ riotId: p.riotId, text: f.text });
  }
  // posições: quem cobre cada uma pela posição principal (só com amostra mínima)
  const byPos = {}; for (const p of ok) { const r = p.data.stats?.mainRole; if (r) (byPos[r] ||= []).push(p.riotId); }
  const withRole = ok.filter(p => (p.data.stats?.games || 0) - (p.data.stats?.unknownPos || 0) >= MIN.mainRole);
  if (withRole.length >= 4) {
    const open = POSITIONS.filter(pos => !byPos[pos]);
    if (open.length) trends.push({ text: `Sem jogador fixo de ${open.map(p => POS_PT[p]).join(', ')} nas partidas recentes`, base: `${withRole.length} jogadores com ${MIN.mainRole}+ partidas com posição` });
    for (const [pos, ids] of Object.entries(byPos)) if (ids.length > 1) trends.push({ text: `${ids.length} jogadores têm ${POS_PT[pos]} como principal: ${ids.join(', ')}`, base: 'possível troca de posição no Clash' });
  }
  // campeão em comum: ameaça de ban (2+ jogadores com 3+ partidas cada)
  for (const c of champs) { const pl = c.players.filter(x => x.games >= 3); if (pl.length >= 2) trends.push({ text: `${c.name} aparece forte para ${pl.length} jogadores (${pl.map(x => `${x.riotId}: ${x.games}`).join(', ')})`, base: 'candidato a ban' }); }
  // fase atual: muitas derrotas/vitórias seguidas (só com amostra mínima)
  for (const p of ok) {
    const r = p.data.stats?.recent || []; if (r.length < MIN.trend) continue;
    let s = 1; while (s < r.length && r[s].win === r[0].win) s++;
    if (s >= 4) trends.push({ text: `${p.riotId}: ${s} ${r[0].win ? 'vitórias' : 'derrotas'} seguidas nas últimas partidas`, base: `${r.length} partidas recentes` });
  }
  const totalGames = ok.reduce((s, p) => s + (p.data.stats?.games || 0), 0);
  const froms = ok.map(p => p.data.stats?.period?.from).filter(Boolean), tos = ok.map(p => p.data.stats?.period?.to).filter(Boolean);
  const limits = [];
  if (ok.length < players.length) limits.push(`${players.length - ok.length} de ${players.length} jogadores sem dados (carregando ou com erro): o relatório usa só os carregados.`);
  for (const p of ok) if ((p.data.stats?.games || 0) < MIN.pool) limits.push(`${p.riotId}: só ${p.data.stats?.games || 0} partidas de Summoner's Rift na amostra — sem conclusões sobre a pool.`);
  return {
    players: ok.length, totalGames, period: froms.length ? { from: Math.min(...froms), to: Math.max(...tos) } : null,
    elo, avg: ranked.length ? avgTier(ranked.map(e => e.solo)) : null, highest: ranked[0] || null, lowest: ranked[ranked.length - 1] || null,
    champs, specialists, pools, trends, limits,
  };
}
// elo médio (só Solo/Duo, sem PdL de Mestre+) — por extenso, para não parecer mais preciso do que é
function avgTier(entries) {
  const v = entries.map(e => TIERS.indexOf(e.tier) * 4 + (TIERS.indexOf(e.tier) >= 7 ? 0 : DIV[e.rank] ?? 0));
  const m = Math.round(v.reduce((a, b) => a + b, 0) / v.length), t = Math.floor(m / 4), tier = TIERS[Math.min(t, 9)];
  return { tier, rank: t >= 7 ? '' : ['IV', 'III', 'II', 'I'][m % 4], n: entries.length };
}

// links externos (só abrem o site; nada é consultado de lá)
export function extLinks(riotId, platform) {
  const id = parseRiotId(riotId); if (!id) return [];
  const site = PLATFORMS[platform]?.site || 'br', slug = `${encodeURIComponent(id.gameName)}-${encodeURIComponent(id.tagLine)}`;
  return [{ name: 'OP.GG', url: `https://op.gg/lol/summoners/${site}/${slug}` }, { name: 'U.GG', url: `https://u.gg/lol/profile/${platform}/${slug}/overview` }];
}
