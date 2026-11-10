// Privacidade da pessoa (users.privacy, JSON):
//   calls:    quem pode te ligar (DM) e te chamar para uma sala: { everyone, fof, friends, servers } (cada um liga/desliga)
//   presence: quem vê se você está online e o que está fazendo (jogo, música, atividade):
//             { mode: 'everyone' | 'friends' | 'chosen', allow: [ids], deny: [ids] }
//             'chosen' = só as pessoas em allow; deny esconde de pessoas específicas em qualquer modo.
// Quem não pode ver te vê offline e sem atividade. Tudo é decidido aqui no servidor: o app de quem não pode ver
// nunca recebe o status nem a atividade de verdade.
export const CALL_DEFAULT = { everyone: true, fof: true, friends: true, servers: true };
export const PRESENCE_DEFAULT = { mode: 'everyone', allow: [], deny: [] };
const MAX_LIST = 500;

const ids = (a) => [...new Set((Array.isArray(a) ? a : []).map(String).filter(x => /^[\w-]{1,40}$/.test(x)))].slice(0, MAX_LIST);
export function cleanPrivacy(p, cur = {}) {
  const out = { calls: { ...CALL_DEFAULT, ...(cur.calls || {}) }, presence: { ...PRESENCE_DEFAULT, ...(cur.presence || {}) } };
  if (p?.calls && typeof p.calls === 'object') for (const k of Object.keys(CALL_DEFAULT)) if (k in p.calls) out.calls[k] = !!p.calls[k];
  if (p?.presence && typeof p.presence === 'object') {
    const q = p.presence;
    if (['everyone', 'friends', 'chosen'].includes(q.mode)) out.presence.mode = q.mode;
    if ('allow' in q) out.presence.allow = ids(q.allow);
    if ('deny' in q) out.presence.deny = ids(q.deny);
  }
  return out;
}

export function createPrivacy({ get, all }) {
  const cache = new Map(); // uid -> { calls, presence: { mode, allow:Set, deny:Set } } (só de quem mudou algo)
  const parse = (raw) => { try { return cleanPrivacy(JSON.parse(raw)); } catch { return null; } };
  const keep = (uid, p) => {
    if (!p) return cache.delete(uid);
    cache.set(uid, { calls: p.calls, presence: { mode: p.presence.mode, allow: new Set(p.presence.allow), deny: new Set(p.presence.deny) }, raw: p });
  };
  for (const r of all('SELECT id, privacy FROM users WHERE privacy IS NOT NULL')) keep(r.id, parse(r.privacy));

  const areFriends = (a, b) => !!get('SELECT 1 x FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id WHERE r1.user_id=? AND r1.other_id=? AND r1.type=1 AND r2.type=1', a, b);
  const shareGuild = (a, b) => !!get('SELECT 1 x FROM members m1 JOIN members m2 ON m2.guild_id=m1.guild_id WHERE m1.user_id=? AND m2.user_id=?', a, b);
  const mutualFriend = (a, b) => !!get(`SELECT 1 x FROM relationships a1 JOIN relationships a2 ON a2.user_id=a1.other_id AND a2.other_id=a1.user_id AND a2.type=1
    JOIN relationships b1 ON b1.other_id=a1.other_id AND b1.user_id=? AND b1.type=1 JOIN relationships b2 ON b2.user_id=b1.other_id AND b2.other_id=b1.user_id AND b2.type=1
    WHERE a1.user_id=? AND a1.type=1 LIMIT 1`, b, a);

  const of = (uid) => cache.get(uid)?.raw || { calls: { ...CALL_DEFAULT }, presence: { ...PRESENCE_DEFAULT } };
  // esconde a presença de alguém? (para o status "genérico", o que vai em mensagens, perfis etc. para todo mundo)
  const restricted = (owner) => { const p = cache.get(owner)?.presence; return !!p && (p.mode !== 'everyone' || p.deny.size > 0); };
  function presenceVisible(viewer, owner) {
    if (!viewer || viewer === owner) return true;
    const p = cache.get(owner)?.presence; if (!p) return true;
    if (p.deny.has(viewer)) return false;
    if (p.mode === 'chosen') return p.allow.has(viewer);
    if (p.mode === 'friends') return p.allow.has(viewer) || areFriends(viewer, owner);
    return true;
  }
  // `caller` pode ligar para `target`? Bloqueio é tratado antes, em quem chama.
  function canCall(caller, target) {
    if (caller === target) return true;
    const c = cache.get(target)?.calls; if (!c || c.everyone) return true;
    if (c.friends && areFriends(caller, target)) return true;
    if (c.servers && shareGuild(caller, target)) return true;
    if (c.fof && mutualFriend(caller, target)) return true;
    return false;
  }
  return {
    of, restricted, presenceVisible, canCall,
    set(uid, p) { keep(uid, p); },
  };
}
