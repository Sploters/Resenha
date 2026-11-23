// Radar: scouting pré-jogo para o Clash de League of Legends. A pessoa cola os cinco Riot IDs do time adversário (visíveis
// no chaveamento do Clash) e o servidor busca, só pela API oficial da Riot, conta, elo, maestria e partidas recentes; o
// relatório do time é montado por server/radarstats.js. Nada de scraping (OP.GG/U.GG são só links) e nada simulado: sem
// chave, ou com a Riot fora do ar, o cartão diz o que faltou.
//
// Chave: RIOT_API_KEY (só no servidor; o cliente nunca a vê). Limites: RIOT_RATE ("20:1,100:120" = 20 por 1 s e 100 por
// 2 min, os da chave de desenvolvimento). RIOT_API_HOST e DDRAGON_BASE trocam os endereços (testes).
// Clash-V1 (descobrir o time a partir de um jogador): desligado até a Riot aprovar o produto — RIOT_CLASH_APPROVED=1.
// Partidas personalizadas (queueId 0) nunca entram: exigem autorização específica da Riot.
import { parseRiotId, PLATFORMS, slimMatch, playerStats, playerFlags, teamReport, extLinks, rankScore, isCustom, MIN } from './radarstats.js';

const env = (k, d) => process.env[k] || d;
const KEY = () => env('RIOT_API_KEY', '');
const HOST = (h) => env('RIOT_API_HOST', 'https://{host}.api.riotgames.com').replace('{host}', h);
const DDRAGON = () => env('DDRAGON_BASE', 'https://ddragon.leagueoflegends.com');
const MATCHES = () => Math.max(5, Math.min(40, +env('RADAR_MATCHES', 20) || 20));
const CLASH = () => env('RIOT_CLASH_APPROVED', '') === '1';
const MAX_SCOUTS = 40, NOTE_MAX = 500, H = 3600e3;
// quanto cada resposta fica guardada (partida não muda: guarda por mais tempo; elo e lista de partidas mudam rápido)
const TTL = { account: 24 * H, summoner: 6 * H, league: 10 * 60e3, mastery: 6 * H, ids: 10 * 60e3, match: 14 * 24 * H, ddragon: 12 * H };

export class RiotError extends Error { constructor(msg, status = 0) { super(msg); this.status = status; } }

// limite de requisições: janelas deslizantes ("20:1,100:120") + pausa geral quando a Riot responde 429 (Retry-After)
export function createLimiter(spec = env('RIOT_RATE', '20:1,100:120')) {
  const wins = String(spec).split(',').map(s => s.split(':').map(Number)).filter(([n, s]) => n > 0 && s > 0).map(([n, s]) => ({ n, ms: s * 1000, ts: [] }));
  let pausedUntil = 0, chain = Promise.resolve();
  const wait = async () => {
    for (;;) {
      const now = Date.now(); let delay = Math.max(0, pausedUntil - now);
      for (const w of wins) { w.ts = w.ts.filter(t => now - t < w.ms); if (w.ts.length >= w.n) delay = Math.max(delay, w.ms - (now - w.ts[0]) + 5); }
      if (!delay) { for (const w of wins) w.ts.push(now); return; }
      await new Promise(r => setTimeout(r, delay));
    }
  };
  return {
    take: () => (chain = chain.then(wait)), // em fila: a ordem de chegada é respeitada
    pause: (ms) => { pausedUntil = Math.max(pausedUntil, Date.now() + ms); },
    pending: () => Math.max(0, pausedUntil - Date.now()),
  };
}

export function mountRadar(app, d) {
  const { auth, wrap, wrapA = wrap, bad, get, all, run, newId, userPub, clean, audienceOf, postDm = () => { } } = d;
  const now = () => Date.now();
  const limiter = createLimiter();

  // ---------- cache (SQLite) ----------
  const cacheGet = (k) => { const r = get('SELECT body, expires_at FROM radar_cache WHERE k=?', k); return r && r.expires_at > now() ? JSON.parse(r.body) : undefined; };
  const cacheSet = (k, v, ttl) => run('INSERT INTO radar_cache(k, body, expires_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, expires_at=excluded.expires_at', k, JSON.stringify(v), now() + ttl);
  const prune = () => { try { run('DELETE FROM radar_cache WHERE expires_at < ?', now()); } catch { } };
  prune(); setInterval(prune, 6 * H).unref?.();

  // ---------- Riot API ----------
  async function riot(host, path, { ttl, cacheKey, fresh = false } = {}) {
    const ck = cacheKey || `${host}${path}`;
    if (!fresh) { const c = cacheGet(ck); if (c !== undefined) return c; }
    if (!KEY()) throw new RiotError('Chave da Riot não configurada no servidor (RIOT_API_KEY)', 401);
    for (let attempt = 0; attempt < 3; attempt++) {
      await limiter.take();
      let r;
      try { r = await fetch(HOST(host) + path, { headers: { 'X-Riot-Token': KEY() }, signal: AbortSignal.timeout(10e3) }); }
      catch { if (attempt === 2) throw new RiotError('Sem resposta da Riot (rede)', 0); await new Promise(x => setTimeout(x, 800 * (attempt + 1))); continue; }
      if (r.status === 429) { limiter.pause((+r.headers.get('retry-after') || 5) * 1000); continue; }
      if (r.status >= 500) { if (attempt === 2) throw new RiotError(`Riot indisponível (${r.status})`, r.status); await new Promise(x => setTimeout(x, 1000 * (attempt + 1))); continue; }
      if (r.status === 404) { if (ttl) cacheSet(ck, null, Math.min(ttl, 10 * 60e3)); return null; }
      if (r.status === 401 || r.status === 403) throw new RiotError('A Riot recusou a chave (expirada ou sem acesso a este recurso)', r.status);
      if (!r.ok) throw new RiotError(`Riot respondeu ${r.status}`, r.status);
      const body = await r.json();
      if (ttl) cacheSet(ck, body, ttl);
      return body;
    }
    throw new RiotError('Limite de requisições da Riot: tente de novo em instantes', 429);
  }

  // ---------- Data Dragon (ícones e nomes dos campeões, pt_BR) ----------
  let dd = null, ddAt = 0, ddLoading = null;
  async function ddragon() {
    if (dd && now() - ddAt < TTL.ddragon) return dd;
    if (ddLoading) return ddLoading;
    ddLoading = (async () => {
      try {
        const vs = await (await fetch(DDRAGON() + '/api/versions.json', { signal: AbortSignal.timeout(8e3) })).json(), v = vs[0];
        const ch = await (await fetch(`${DDRAGON()}/cdn/${v}/data/pt_BR/champion.json`, { signal: AbortSignal.timeout(8e3) })).json();
        const champs = {}; for (const c of Object.values(ch.data || {})) champs[c.key] = { id: c.id, name: c.name };
        dd = { version: v, base: DDRAGON(), champs }; ddAt = now(); cacheSet('ddragon', dd, 30 * 24 * H);
      } catch { dd = dd || cacheGet('ddragon') || null; ddAt = now() - TTL.ddragon + 5 * 60e3; } // sem rede: tenta de novo em 5 min
      ddLoading = null; return dd;
    })();
    return ddLoading;
  }

  // ---------- maior elo observado (a API só dá o elo atual; o Radar guarda o maior que já viu) ----------
  function trackPeak(puuid, queue, e) {
    if (!e) return null;
    const s = rankScore(e), cur = get('SELECT * FROM radar_peaks WHERE puuid=? AND queue=?', puuid, queue);
    if (!cur) run('INSERT INTO radar_peaks(puuid, queue, tier, rank, lp, score, seen_at, first_seen) VALUES(?,?,?,?,?,?,?,?)', puuid, queue, e.tier, e.rank, e.leaguePoints, s, now(), now());
    else if (s > cur.score) run('UPDATE radar_peaks SET tier=?, rank=?, lp=?, score=?, seen_at=? WHERE puuid=? AND queue=?', e.tier, e.rank, e.leaguePoints, s, now(), puuid, queue);
    const p = get('SELECT * FROM radar_peaks WHERE puuid=? AND queue=?', puuid, queue);
    return { tier: p.tier, rank: p.rank, leaguePoints: p.lp, seen_at: p.seen_at, since: p.first_seen };
  }

  // ---------- busca de um jogador ----------
  const setPlayer = (sid, slot, f) => {
    const keys = Object.keys(f); if (!keys.length) return;
    run(`UPDATE radar_players SET ${keys.map(k => k + '=?').join(', ')} WHERE scout_id=? AND slot=?`, ...keys.map(k => (f[k] !== null && typeof f[k] === 'object' ? JSON.stringify(f[k]) : f[k])), sid, slot);
  };
  async function fetchPlayer(sid, slot, fresh) {
    const row = get('SELECT p.*, s.platform FROM radar_players p JOIN radar_scouts s ON s.id=p.scout_id WHERE p.scout_id=? AND p.slot=?', sid, slot);
    if (!row) return;
    const plat = PLATFORMS[row.platform] ? row.platform : 'br1', region = PLATFORMS[plat].region, id = parseRiotId(row.riot_id);
    if (!id) return setPlayer(sid, slot, { status: 'error', error: 'Riot ID inválido (use Nome#TAG)' });
    setPlayer(sid, slot, { status: 'loading', error: null, progress: { step: 'Conta', done: 0, total: 0 } });
    try {
      const acc = await riot(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id.gameName)}/${encodeURIComponent(id.tagLine)}`, { ttl: TTL.account, cacheKey: `acc:${region}:${id.text.toLowerCase()}` });
      if (!acc) return setPlayer(sid, slot, { status: 'error', error: 'Riot ID não encontrado', puuid: null, data: null });
      const puuid = acc.puuid, missing = [];
      const soft = async (label, fn) => { try { return await fn(); } catch (e) { if (e.status === 401 && !KEY()) throw e; missing.push(`${label}: ${e.message}`); return null; } };
      setPlayer(sid, slot, { puuid, riot_id: `${acc.gameName}#${acc.tagLine}`, progress: { step: 'Perfil e elo', done: 0, total: 0 } });
      const summ = await soft('Perfil', () => riot(plat, `/lol/summoner/v4/summoners/by-puuid/${puuid}`, { ttl: TTL.summoner }));
      const league = await soft('Elo', () => riot(plat, `/lol/league/v4/entries/by-puuid/${puuid}`, { ttl: TTL.league, fresh }));
      const mastery = await soft('Maestria', () => riot(plat, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=5`, { ttl: TTL.mastery }));
      const ids = await soft('Partidas', () => riot(region, `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${MATCHES()}`, { ttl: TTL.ids, fresh })) || [];
      const slim = []; let done = 0, skipped = 0;
      for (const mid of ids) {
        setPlayer(sid, slot, { progress: { step: 'Partidas', done, total: ids.length } });
        const s = await soft(`Partida ${mid}`, async () => {
          const ck = `m:${mid}:${puuid}`, c = cacheGet(ck); if (c !== undefined) return c;
          const m = await riot(region, `/lol/match/v5/matches/${mid}`, {}); // a partida inteira não fica guardada, só o resumo deste jogador
          const v = m && !isCustom(m.info?.queueId) ? slimMatch(m, puuid) : null;
          cacheSet(ck, v, TTL.match); return v;
        });
        if (s) slim.push(s); else skipped++;
        done++;
      }
      const solo = league?.find(e => e.queueType === 'RANKED_SOLO_5x5') || null, flex = league?.find(e => e.queueType === 'RANKED_FLEX_SR') || null;
      const pick = (e) => (e ? { tier: e.tier, rank: e.rank, leaguePoints: e.leaguePoints, wins: e.wins, losses: e.losses, hotStreak: !!e.hotStreak } : null);
      const stats = playerStats(slim);
      const data = {
        level: summ?.summonerLevel ?? null, icon: summ?.profileIconId ?? null,
        ranks: { solo: pick(solo), flex: pick(flex) }, rankFetched: league !== null,
        peaks: { solo: trackPeak(puuid, 'solo', solo), flex: trackPeak(puuid, 'flex', flex) },
        mastery: (mastery || []).map(m => ({ champ: m.championId, level: m.championLevel, points: m.championPoints, last: m.lastPlayTime })),
        stats, flags: playerFlags(stats),
        sample: { requested: MATCHES(), listed: ids.length, used: stats.games, skipped, otherModes: slim.length - stats.games },
        missing, fetched_at: now(),
      };
      setPlayer(sid, slot, { status: 'done', error: null, data, progress: null, fetched_at: now() });
    } catch (e) {
      setPlayer(sid, slot, { status: e.status === 401 && !KEY() ? 'blocked' : 'error', error: e.message, progress: null });
    }
  }

  // fila de busca: um jogador por vez (o limite da Riot é o que manda; em paralelo só embaralharia a ordem)
  const queue = []; let running = false;
  const enqueue = (sid, slot, fresh = false) => {
    if (queue.some(q => q.sid === sid && q.slot === slot)) return;
    setPlayer(sid, slot, { status: KEY() ? 'pending' : 'blocked', error: KEY() ? null : 'Chave da Riot não configurada no servidor', progress: null });
    if (!KEY()) return;
    queue.push({ sid, slot, fresh }); pump();
  };
  async function pump() {
    if (running) return; running = true;
    try { while (queue.length) { const q = queue.shift(); await fetchPlayer(q.sid, q.slot, q.fresh).catch(() => { }); } } finally { running = false; }
  }
  // reinício do servidor no meio de uma busca: retoma
  for (const r of all("SELECT scout_id, slot FROM radar_players WHERE status IN ('pending','loading')")) enqueue(r.scout_id, r.slot);

  // ---------- acesso ----------
  const canSee = (s, uid) => s.owner_id === uid || !!get('SELECT 1 x FROM radar_members WHERE scout_id=? AND user_id=?', s.id, uid);
  const scoutFor = (req, res, ownerOnly = false) => {
    const s = get('SELECT * FROM radar_scouts WHERE id=?', req.params.id);
    if (!s || !canSee(s, req.uid)) { bad(res, 'Scouting não encontrado', 404); return null; }
    if (ownerOnly && s.owner_id !== req.uid) { bad(res, 'Só quem criou o scouting pode fazer isso', 403); return null; }
    return s;
  };
  const playerObj = (p, plat) => ({ slot: p.slot, riotId: p.riot_id, status: p.status, error: p.error, progress: p.progress ? JSON.parse(p.progress) : null,
    data: p.data ? JSON.parse(p.data) : null, fetched_at: p.fetched_at, links: extLinks(p.riot_id, plat) });
  const scoutObj = (s, uid) => {
    const players = all('SELECT * FROM radar_players WHERE scout_id=? ORDER BY slot', s.id).map(p => playerObj(p, s.platform));
    return { id: s.id, title: s.title, platform: s.platform, platform_name: PLATFORMS[s.platform]?.name, created_at: s.created_at, updated_at: s.updated_at,
      owner: userPub(s.owner_id), mine: s.owner_id === uid,
      members: all('SELECT user_id FROM radar_members WHERE scout_id=? ORDER BY added_at', s.id).map(r => userPub(r.user_id)),
      players, report: teamReport(players), queue: queue.length, paused: limiter.pending(),
      notes: all('SELECT * FROM radar_notes WHERE scout_id=? ORDER BY created_at', s.id).map(n => ({ id: n.id, author: userPub(n.author_id), content: n.content, slot: n.slot, created_at: n.created_at })) };
  };
  const touch = (id) => run('UPDATE radar_scouts SET updated_at=? WHERE id=?', now(), id);
  const idsFrom = (b) => {
    const list = Array.isArray(b?.riot_ids) ? b.riot_ids : String(b?.riot_ids || '').split(/[\n,;]+/);
    const out = []; for (const x of list) { const t = String(x || '').trim(); if (!t) continue; const p = parseRiotId(t); if (!p) return { error: `Riot ID inválido: "${t.slice(0, 40)}" (use Nome#TAG)` }; if (!out.some(o => o.toLowerCase() === p.text.toLowerCase())) out.push(p.text); }
    if (!out.length) return { error: 'Informe ao menos um Riot ID' };
    if (out.length > 5) return { error: 'No máximo 5 jogadores por scouting' };
    return { ids: out };
  };

  // ---------- rotas ----------
  app.get('/api/radar/meta', auth, wrapA(async (req, res) => {
    res.json({ configured: !!KEY(), clash: CLASH(), matches: MATCHES(), min: MIN, platforms: Object.entries(PLATFORMS).map(([id, p]) => [id, p.name]), ddragon: await ddragon() });
  }));
  app.get('/api/radar', auth, wrap((req, res) => {
    const rows = all('SELECT DISTINCT s.* FROM radar_scouts s LEFT JOIN radar_members m ON m.scout_id=s.id WHERE s.owner_id=? OR m.user_id=? ORDER BY s.updated_at DESC LIMIT 100', req.uid, req.uid);
    res.json(rows.map(s => ({ id: s.id, title: s.title, platform: s.platform, updated_at: s.updated_at, mine: s.owner_id === req.uid, owner: userPub(s.owner_id),
      players: all('SELECT riot_id, status FROM radar_players WHERE scout_id=? ORDER BY slot', s.id).map(p => ({ riotId: p.riot_id, status: p.status })) })));
  }));
  app.post('/api/radar', auth, wrap((req, res) => {
    const b = req.body || {}, plat = PLATFORMS[b.platform] ? b.platform : 'br1';
    const r = idsFrom(b); if (r.error) return bad(res, r.error);
    if (get('SELECT COUNT(*) n FROM radar_scouts WHERE owner_id=?', req.uid).n >= MAX_SCOUTS) return bad(res, `No máximo ${MAX_SCOUTS} scoutings: apague os antigos`);
    const id = newId(), t = now();
    run('INSERT INTO radar_scouts(id, owner_id, title, platform, created_at, updated_at) VALUES(?,?,?,?,?,?)', id, req.uid, clean(b.title, 60) || 'Clash', plat, t, t);
    r.ids.forEach((rid, i) => run('INSERT INTO radar_players(scout_id, slot, riot_id, status) VALUES(?,?,?,?)', id, i, rid, 'pending'));
    r.ids.forEach((_, i) => enqueue(id, i));
    res.json(scoutObj(get('SELECT * FROM radar_scouts WHERE id=?', id), req.uid));
  }));
  app.get('/api/radar/:id', auth, wrap((req, res) => { const s = scoutFor(req, res); if (s) res.json(scoutObj(s, req.uid)); }));
  app.patch('/api/radar/:id', auth, wrap((req, res) => {
    const s = scoutFor(req, res, true); if (!s) return;
    const b = req.body || {};
    if (b.title != null) run('UPDATE radar_scouts SET title=? WHERE id=?', clean(b.title, 60) || 'Clash', s.id);
    if (b.riot_ids != null) { // troca a lista: quem continua mantém os dados; quem é novo é buscado
      const r = idsFrom(b); if (r.error) return bad(res, r.error);
      const old = all('SELECT * FROM radar_players WHERE scout_id=?', s.id);
      run('DELETE FROM radar_players WHERE scout_id=?', s.id);
      r.ids.forEach((rid, i) => {
        const o = old.find(p => p.riot_id.toLowerCase() === rid.toLowerCase());
        run('INSERT INTO radar_players(scout_id, slot, riot_id, puuid, status, error, data, fetched_at) VALUES(?,?,?,?,?,?,?,?)', s.id, i, o?.riot_id || rid, o?.puuid || null, o?.status === 'done' ? 'done' : 'pending', o?.error || null, o?.data || null, o?.fetched_at || null);
        if (o?.status !== 'done') enqueue(s.id, i);
      });
    }
    touch(s.id); res.json(scoutObj(get('SELECT * FROM radar_scouts WHERE id=?', s.id), req.uid));
  }));
  // atualizar: elo e lista de partidas buscados de novo (partidas já vistas vêm do cache)
  app.post('/api/radar/:id/refresh', auth, wrap((req, res) => {
    const s = scoutFor(req, res); if (!s) return;
    const slot = req.body?.slot;
    for (const p of all('SELECT slot, status FROM radar_players WHERE scout_id=?', s.id)) if ((slot == null || +slot === p.slot) && p.status !== 'loading' && p.status !== 'pending') enqueue(s.id, p.slot, true);
    touch(s.id); res.json(scoutObj(s, req.uid));
  }));
  app.delete('/api/radar/:id', auth, wrap((req, res) => {
    const s = scoutFor(req, res); if (!s) return;
    if (s.owner_id === req.uid) run('DELETE FROM radar_scouts WHERE id=?', s.id);
    else run('DELETE FROM radar_members WHERE scout_id=? AND user_id=?', s.id, req.uid); // quem recebeu só sai
    res.json({ ok: true });
  }));
  // compartilhar com amigos / quem divide servidor (a mesma regra de quem vê os anúncios do LFG)
  app.post('/api/radar/:id/share', auth, wrap((req, res) => {
    const s = scoutFor(req, res); if (!s) return;
    const aud = new Set(audienceOf(req.uid)), ids = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(String))].slice(0, 20);
    if (!ids.length) return bad(res, 'Escolha com quem compartilhar');
    const added = [];
    for (const uid of ids) {
      if (uid === s.owner_id || !aud.has(uid) || uid === req.uid) continue;
      if (get('SELECT 1 x FROM radar_members WHERE scout_id=? AND user_id=?', s.id, uid)) continue;
      run('INSERT INTO radar_members(scout_id, user_id, added_by, added_at) VALUES(?,?,?,?)', s.id, uid, req.uid, now()); added.push(uid);
      try { postDm(req.uid, uid, `📡 Compartilhei o scouting do Radar "${s.title}" com você: Jogos → Radar.`); } catch { }
    }
    touch(s.id); res.json({ ...scoutObj(s, req.uid), added: added.length });
  }));
  app.post('/api/radar/:id/notes', auth, wrap((req, res) => {
    const s = scoutFor(req, res); if (!s) return;
    const content = clean(req.body?.content, NOTE_MAX); if (!content) return bad(res, 'Escreva a observação');
    const slot = req.body?.slot == null || req.body.slot === '' ? null : Math.round(+req.body.slot);
    if (slot != null && !get('SELECT 1 x FROM radar_players WHERE scout_id=? AND slot=?', s.id, slot)) return bad(res, 'Jogador inválido');
    if (get('SELECT COUNT(*) n FROM radar_notes WHERE scout_id=?', s.id).n >= 200) return bad(res, 'Limite de observações atingido');
    run('INSERT INTO radar_notes(id, scout_id, author_id, slot, content, created_at) VALUES(?,?,?,?,?,?)', newId(), s.id, req.uid, slot, content, now());
    touch(s.id); res.json(scoutObj(s, req.uid));
  }));
  app.delete('/api/radar/:id/notes/:nid', auth, wrap((req, res) => {
    const s = scoutFor(req, res); if (!s) return;
    const n = get('SELECT * FROM radar_notes WHERE id=? AND scout_id=?', req.params.nid, s.id); if (!n) return bad(res, 'Observação não encontrada', 404);
    if (n.author_id !== req.uid && s.owner_id !== req.uid) return bad(res, 'Só quem escreveu (ou o dono do scouting) apaga', 403);
    run('DELETE FROM radar_notes WHERE id=?', n.id); res.json(scoutObj(s, req.uid));
  }));
  // Clash-V1: descobrir o time inteiro a partir de um jogador. Só com o produto aprovado pela Riot (RIOT_CLASH_APPROVED=1).
  app.post('/api/radar/clash-team', auth, wrapA(async (req, res) => {
    if (!CLASH()) return bad(res, 'A busca de time do Clash depende da aprovação da Riot para este servidor. Cole os cinco Riot IDs do chaveamento.', 403);
    const id = parseRiotId(req.body?.riot_id); if (!id) return bad(res, 'Riot ID inválido (use Nome#TAG)');
    const plat = PLATFORMS[req.body?.platform] ? req.body.platform : 'br1', region = PLATFORMS[plat].region;
    try {
      const acc = await riot(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id.gameName)}/${encodeURIComponent(id.tagLine)}`, { ttl: TTL.account });
      if (!acc) return bad(res, 'Riot ID não encontrado', 404);
      const regs = await riot(plat, `/lol/clash/v1/players/by-puuid/${acc.puuid}`, { ttl: 5 * 60e3 }) || [];
      const teamId = regs.find(r => r.teamId)?.teamId; if (!teamId) return bad(res, 'Este jogador não está num time de Clash ativo', 404);
      const team = await riot(plat, `/lol/clash/v1/teams/${teamId}`, { ttl: 5 * 60e3 });
      const ids = [];
      for (const p of team?.players || []) { const a = p.puuid && await riot(region, `/riot/account/v1/accounts/by-puuid/${p.puuid}`, { ttl: TTL.account }); if (a) ids.push(`${a.gameName}#${a.tagLine}`); }
      res.json({ name: team?.name, abbreviation: team?.abbreviation, riot_ids: ids });
    } catch (e) { bad(res, e.message, e.status === 429 ? 429 : 502); }
  }));
}
