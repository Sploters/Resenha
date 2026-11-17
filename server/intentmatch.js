// "A fim de jogar": regras puras (sem banco, sem rede), testadas em scripts/intents-unit-test.mjs.
// server/intents.js junta os sinais de cada pessoa (Steam, "Jogando…", histórico, perfil do LFG, presença, preferências)
// e pergunta aqui quem chamar, em que ordem, por quê e como avisar.

export const LIMITS = {
  fanout: 6,                    // convidados por rodada (quem criou chama mais com "Chamar mais")
  maxInvitees: 18,              // no total, por intenção
  rxPerHour: 3,                 // convites com aviso que a mesma pessoa recebe por hora (de qualquer um)
  pairCooldownMs: 30 * 60e3,    // o mesmo autor não toca para a mesma pessoa de novo antes disso
  minValidMin: 15, maxValidMin: 6 * 60, laterMaxMs: 12 * 3600e3,
  minSize: 2, maxSize: 10,
};

// peso de cada sinal; o motivo vira o texto mostrado para quem cria ("Por que chamar")
export const WEIGHTS = { playingNow: 6, playedRecent: 3, playedOld: 1, owns: 3, ownsLots: 1, lfgProfile: 2, wishlist: 1, friend: 1, online: 1, ignoredEach: -1, ignoredMax: -3 };

export const normTitle = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

// identidade do jogo: appid da Steam > jogo do catálogo do LFG > nome normalizado
export function gameKeyOf({ appid, lfg, title } = {}) {
  if (appid && /^\d{1,10}$/.test(String(appid))) return 'steam:' + appid;
  if (lfg && lfg !== 'other' && /^[a-z0-9]{1,20}$/.test(lfg)) return 'lfg:' + lfg;
  const n = normTitle(title);
  return n ? 'name:' + n.slice(0, 60) : null;
}

const daysText = (d) => (d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`);
const hoursText = (min) => (min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`);

// s: { uid, friend, status, playingNow, playedDaysAgo, ownsMinutes, wishlist, lfgProfile, ignoredRecent }
// devolve { score, reasons, match } — match = algum sinal do jogo (não só "amigo online")
export function scoreCandidate(s) {
  let score = 0; const reasons = [];
  if (s.playingNow) { score += WEIGHTS.playingNow; reasons.push('Jogando agora'); }
  else if (s.playedDaysAgo != null && s.playedDaysAgo <= 14) {
    if (s.playedDaysAgo <= 7) { score += WEIGHTS.playedRecent; reasons.push('Jogou ' + daysText(s.playedDaysAgo)); }
    else { score += WEIGHTS.playedOld; reasons.push('Jogou ' + daysText(s.playedDaysAgo)); }
  }
  if (s.ownsMinutes != null) {
    score += WEIGHTS.owns; if (s.ownsMinutes >= 600) score += WEIGHTS.ownsLots;
    reasons.push(s.ownsMinutes > 0 ? `Tem na Steam · ${hoursText(s.ownsMinutes)}` : 'Tem na Steam');
  }
  if (s.lfgProfile) { score += WEIGHTS.lfgProfile; reasons.push('Perfil do jogo no LFG'); }
  if (s.wishlist && s.ownsMinutes == null) { score += WEIGHTS.wishlist; reasons.push('Quer o jogo'); }
  const match = reasons.length > 0;
  if (s.friend) score += WEIGHTS.friend;
  if (s.status === 'online') score += WEIGHTS.online;
  if (s.ignoredRecent > 0) score += Math.max(WEIGHTS.ignoredMax, WEIGHTS.ignoredEach * s.ignoredRecent);
  return { score, reasons, match };
}

// pode receber? (preferências da pessoa) — prefs: { mode: 'all'|'friends'|'off', muted: { [gameKey]: até } }
export function excludedBy(s, gameKey, now = Date.now()) {
  const p = s.prefs || {};
  if (p.mode === 'off') return 'off';
  if (p.mode === 'friends' && !s.friend) return 'friends_only';
  const until = p.muted?.[gameKey] ?? p.muted?.['*'];
  if (until && (until === true || until > now)) return 'muted';
  return null;
}

// como avisar: 'push' (aviso com som), 'quiet' (só aparece no painel; a pessoa vê quando abrir)
// s.receivedLastHour, s.lastFromAuthorAt
export function deliveryFor(s, now = Date.now()) {
  if (s.status === 'offline' || s.status === 'invisible') return { delivery: 'quiet', why: 'offline' };
  if (s.status === 'dnd') return { delivery: 'quiet', why: 'dnd' };
  if ((s.receivedLastHour || 0) >= LIMITS.rxPerHour) return { delivery: 'quiet', why: 'limit' };
  if (s.lastFromAuthorAt && now - s.lastFromAuthorAt < LIMITS.pairCooldownMs) return { delivery: 'quiet', why: 'cooldown' };
  return { delivery: 'push', why: null };
}

// ranking: só quem tem algum sinal do jogo; se ninguém tem (jogo sem dado na Steam, ninguém jogou), plano B: amigos
// online/ausentes, avisando que é por falta de informação. fanout: quantos vêm marcados para convidar.
export function rankCandidates(cands, gameKey, { fanout = LIMITS.fanout, now = Date.now(), skip = new Set() } = {}) {
  const scored = [], excluded = [];
  for (const s of cands) {
    if (skip.has(s.uid)) continue;
    const ex = excludedBy(s, gameKey, now);
    if (ex) { excluded.push({ uid: s.uid, why: ex }); continue; }
    scored.push({ s, ...scoreCandidate(s) });
  }
  let pool = scored.filter(x => x.match), fallback = false;
  if (!pool.length) {
    fallback = true;
    pool = scored.filter(x => x.s.friend && (x.s.status === 'online' || x.s.status === 'idle')).map(x => ({ ...x, reasons: ['Amigo online'] }));
  }
  pool.sort((a, b) => b.score - a.score || (b.s.friend - a.s.friend) || String(a.s.name || a.s.uid).localeCompare(String(b.s.name || b.s.uid)));
  const list = pool.map((x, i) => ({ uid: x.s.uid, score: x.score, reasons: x.reasons, ...deliveryFor(x.s, now), selected: i < fanout }));
  return { list, fallback, excluded };
}

// validade: 'now' → de agora até +valid; 'later' → de startsAt até startsAt + valid (startsAt em até 12 h)
export function validity({ availability = 'now', startsAt = null, validMin = 60 } = {}, now = Date.now()) {
  const v = Math.round(+validMin);
  if (!(v >= LIMITS.minValidMin && v <= LIMITS.maxValidMin)) return { error: `Validade: de ${LIMITS.minValidMin} min a ${LIMITS.maxValidMin / 60} h` };
  if (availability === 'later') {
    const s = Math.round(+startsAt);
    if (!Number.isFinite(s) || s < now - 60e3 || s > now + LIMITS.laterMaxMs) return { error: 'Horário inválido (até 12 h a partir de agora)' };
    return { startsAt: Math.max(s, now), expiresAt: Math.max(s, now) + v * 60e3 };
  }
  if (availability !== 'now') return { error: 'Disponibilidade inválida' };
  return { startsAt: now, expiresAt: now + v * 60e3 };
}

export function sizeRules({ min, max } = {}) {
  const mn = Math.round(+min), mx = max == null || max === '' ? null : Math.round(+max);
  if (!(mn >= LIMITS.minSize && mn <= LIMITS.maxSize)) return { error: `Mínimo de ${LIMITS.minSize} a ${LIMITS.maxSize} pessoas (contando você)` };
  if (mx != null && !(mx >= mn && mx <= LIMITS.maxSize)) return { error: 'O máximo precisa ser maior ou igual ao mínimo' };
  return { min: mn, max: mx };
}

// situação do grupo: joined = quantos toparam (sem contar o autor)
export function groupState({ min, max, joined }) {
  const size = joined + 1;
  return { size, reached: size >= min, full: max != null && size >= max, missing: Math.max(0, min - size), free: max == null ? null : Math.max(0, max - size) };
}

// estado visível da intenção num instante
export function statusOf(it, now = Date.now()) {
  if (it.state === 'canceled') return 'canceled';
  if (it.state === 'ended') return 'ended';
  if (now >= it.expires_at) return it.state === 'formed' ? 'ended' : 'expired';
  return it.state; // open | formed
}

// pode entrar agora? (devolve o motivo quando não)
export function canJoin(it, joined, now = Date.now()) {
  const st = statusOf(it, now);
  if (st === 'expired' || st === 'ended') return { ok: false, code: 'expired', error: 'Essa intenção já expirou' };
  if (st === 'canceled') return { ok: false, code: 'canceled', error: 'Quem chamou cancelou' };
  if (groupState({ min: it.min_size, max: it.max_size, joined }).full) return { ok: false, code: 'full', error: 'O grupo já está completo' };
  return { ok: true };
}

// já existe uma intenção aberta para o mesmo jogo no meu círculo? (evita duas salas para o mesmo grupo)
// intents: [{ id, author_id, game_key, state, expires_at, invited: Set|[] }]; visible(authorId) = está no meu círculo
export function findDuplicate(intents, { gameKey, me, visible }, now = Date.now()) {
  const live = intents.filter(it => it.game_key === gameKey && it.author_id !== me && (statusOf(it, now) === 'open' || statusOf(it, now) === 'formed'));
  const inv = live.find(it => (it.invited instanceof Set ? it.invited.has(me) : (it.invited || []).includes(me)));
  return inv || live.find(it => visible(it.author_id)) || null;
}
