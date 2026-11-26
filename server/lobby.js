// "Times e fila" da sala de voz (atividade do foguete; cliente: public/lobby.js).
//
// Fila do lobby: o jogo tem N vagas (ex.: CS2 = 5) e a call tem mais gente. Quem entra na call vai para "Jogando" se tiver
// vaga, senão para o fim da fila. Saiu alguém de "Jogando" (passou a vez, saiu da call ou foi para "só na resenha"), o 1º da
// fila sobe e o app dele avisa ("Sua vez!"). "Fim da partida" faz o rodízio: quem está jogando há mais tempo cede a vaga para
// os primeiros da fila e vai para o fim dela. Quem sai da call e volta em até 2 min recupera o lugar (queda, F5).
//
// Sorteio de times: divide em 2 times quem está jogando (ou a call toda). "Na sorte" embaralha; "Equilibrado" usa a força
// de cada um naquele jogo (Elo guardado por servidor e jogo, atualizado quando alguém marca "Time A venceu") e, entre
// divisões quase iguais, prefere a que mais separa quem estava junto no sorteio anterior. Também sorteia mapa e
// agente/personagem a partir das listas que o app manda (presets do jogo ou lista própria).
//
// Tudo vive na memória da sala (acts.lobby, some quando a sala esvazia), menos a força de cada um (tabela team_ratings).
// O estado vai para a sala inteira no ROOM_STATE (campo lobby). Qualquer um da call pode mexer: é entre amigos.
export const MAX_SLOTS = 16, GRACE_MS = 120e3, BASE = 1000, K = 32;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const list = (v, max = 60) => (Array.isArray(v) ? [...new Set(v.map(x => clip(x, 40)).filter(Boolean))].slice(0, max) : []);
const gameKey = (g) => clip(g, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const shuffle = (a, rnd) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];

export function createLobby({ db, get, run, all, rnd = Math.random, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS team_ratings(scope TEXT NOT NULL, game TEXT NOT NULL, user_id TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT ${BASE}, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope, game, user_id));`);
  const ratingOf = (scope, game, uid) => get('SELECT rating, games, wins FROM team_ratings WHERE scope=? AND game=? AND user_id=?', scope, game, uid) || { rating: BASE, games: 0, wins: 0 };

  // o que vai para o app (sem os lugares guardados de quem caiu)
  function state(L) {
    if (!L) return null;
    const T = L.teams && { ...L.teams, deltas: undefined };
    return { game: L.game, slots: L.slots, playing: [...L.playing], queue: [...L.queue], round: L.round, by: L.by, teams: T, stats: L.stats || {} };
  }
  // sobe gente da fila até encher as vagas
  const fill = (L) => { while (L.playing.length < L.slots && L.queue.length) L.playing.push(L.queue.shift()); };
  const drop = (L, uid) => { L.playing = L.playing.filter(x => x !== uid); L.queue = L.queue.filter(x => x !== uid); };
  // força de cada um no jogo do lobby (mostrada nos times: V-D)
  const refreshStats = (L) => {
    const key = gameKey(L.game); L.stats = {};
    if (!key) return;
    for (const r of all('SELECT user_id, games, wins FROM team_ratings WHERE scope=? AND game=?', L.scope, key)) L.stats[r.user_id] = { g: r.games, w: r.wins };
  };

  function open(L0, scope, members, uid, d) {
    const slots = Math.max(1, Math.min(MAX_SLOTS, Math.round(+d.slots) || 5)), game = clip(d.game, 60) || 'Partida';
    if (!L0) {
      const L = { scope, game, slots, playing: members.slice(0, slots), queue: members.slice(slots), round: 1, by: uid, teams: null, gone: new Map(), last: null };
      refreshStats(L); return L;
    }
    const changedGame = gameKey(game) !== gameKey(L0.game);
    Object.assign(L0, { game, slots });
    while (L0.playing.length > slots) L0.queue.unshift(L0.playing.pop()); // menos vagas: os últimos que entraram voltam para a frente da fila
    fill(L0);
    if (changedGame) { L0.teams = null; refreshStats(L0); }
    return L0;
  }

  // divide `pool` em dois times. balanced: soma de força parecida; entre as quase iguais, separa quem estava junto antes
  function split(L, pool, mode) {
    const n = pool.length, sizeA = Math.floor(n / 2);
    if (mode !== 'balanced' || n < 3) { const s = shuffle(pool, rnd); return { a: s.slice(0, sizeA || 1), b: s.slice(sizeA || 1) }; }
    const key = gameKey(L.game), r = Object.fromEntries(pool.map(u => [u, ratingOf(L.scope, key, u).rating]));
    const together = (A) => { // pares que estavam no mesmo time no último sorteio
      if (!L.last) return 0; let c = 0;
      const same = (x, y) => (L.last.a.includes(x) && L.last.a.includes(y)) || (L.last.b.includes(x) && L.last.b.includes(y));
      const B = pool.filter(u => !A.includes(u));
      for (const T of [A, B]) for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) if (same(T[i], T[j])) c++;
      return c;
    };
    const total = pool.reduce((s, u) => s + r[u], 0), cands = [];
    // combinações de tamanho sizeA (n até 20: no máximo ~185 mil, rápido); a 1ª pessoa fica sempre no A para não repetir espelhadas
    const sh = shuffle(pool, rnd), first = sh[0], rest = sh.slice(1), need = n % 2 ? sizeA : sizeA - 1;
    const walk = (start, acc) => {
      if (acc.length === need) { const A = [first, ...acc], sa = A.reduce((s, u) => s + r[u], 0); cands.push({ A, diff: Math.abs(sa / A.length - (total - sa) / (n - A.length)) }); return; }
      for (let i = start; i <= rest.length - (need - acc.length); i++) walk(i + 1, [...acc, rest[i]]);
    };
    walk(0, []);
    const best = Math.min(...cands.map(c => c.diff)), near = cands.filter(c => c.diff <= best + 15); // 15 pontos de Elo: na prática empatadas
    const minT = Math.min(...near.map(c => together(c.A))), top = near.filter(c => together(c.A) === minT);
    const A = pick(top, rnd).A;
    return { a: A, b: pool.filter(u => !A.includes(u)) };
  }
  function drawAgents(T) {
    T.picks = {};
    if (T.agents.length) for (const team of [T.a, T.b]) {
      let bag = shuffle(T.agents, rnd); // sem repetir dentro do time enquanto der
      for (const u of team) { if (!bag.length) bag = shuffle(T.agents, rnd); T.picks[u] = bag.shift(); }
    }
  }
  function drawExtras(T, maps, agents) {
    T.maps = maps; T.agents = agents;
    T.map = maps.length ? pick(maps, rnd) : null;
    drawAgents(T);
  }

  // d.op: open | close | join | pass | out | move | rotate | teams | reroll | result | clear_teams
  function op(a, { uid, members, scope }, d) {
    let L = a.lobby;
    if (d.op === 'open') { a.lobby = open(L, scope, members, uid, d); return true; }
    if (!L) return false;
    switch (d.op) {
      case 'close': a.lobby = null; return true;
      case 'join': if (L.playing.includes(uid) || L.queue.includes(uid)) return false; L.queue.push(uid); fill(L); return true;
      case 'pass': if (!L.playing.includes(uid)) return false; drop(L, uid); fill(L); L.queue.push(uid); return true; // passa a vez: o 1º da fila sobe, você vai pro fim
      case 'out': drop(L, uid); fill(L); return true; // só na resenha
      case 'move': {
        const who = String(d.uid || ''); if (!members.includes(who)) return false;
        if (d.to === 'playing') { if (L.playing.includes(who)) return false; if (L.playing.length >= L.slots) return 'full'; drop(L, who); L.playing.push(who); return true; }
        if (d.to === 'queue') { drop(L, who); const i = Math.max(0, Math.min(L.queue.length, Math.round(+d.index) || 0)); L.queue.splice(d.index == null ? L.queue.length : i, 0, who); fill(L); return true; }
        if (d.to === 'out') { drop(L, who); fill(L); return true; }
        return false;
      }
      case 'rotate': { // fim da partida
        const k = Math.min(L.queue.length, L.playing.length);
        const leaving = L.playing.slice(0, k);
        L.playing = [...L.playing.slice(k), ...L.queue.slice(0, k)]; L.queue = [...L.queue.slice(k), ...leaving]; fill(L);
        L.round++; L.teams = null; return true;
      }
      case 'teams': {
        const pool = (d.pool === 'call' ? members : L.playing).filter(u => members.includes(u));
        if (pool.length < 2) return 'few';
        const T = { ...split(L, pool, d.mode === 'balanced' ? 'balanced' : 'luck'), mode: d.mode === 'balanced' ? 'balanced' : 'luck', pool: d.pool === 'call' ? 'call' : 'playing', by: uid, at: now(), result: null };
        drawExtras(T, list(d.maps), list(d.agents, 200));
        L.teams = T; L.last = { a: T.a, b: T.b }; refreshStats(L); return true;
      }
      case 'reroll': {
        const T = L.teams; if (!T) return false;
        if (d.what === 'map' && T.maps?.length) T.map = T.maps.length > 1 ? pick(T.maps.filter(m => m !== T.map), rnd) : T.maps[0];
        else if (d.what === 'agents' && T.agents?.length) drawAgents(T);
        else return false;
        return true;
      }
      case 'result': {
        const T = L.teams, win = d.win === 'a' || d.win === 'b' ? d.win : null; if (!T || !win || T.result) return false;
        const key = gameKey(L.game); if (!key) return false;
        const avg = (team) => team.reduce((s, u) => s + ratingOf(L.scope, key, u).rating, 0) / team.length;
        const ra = avg(T.a), rb = avg(T.b), ea = 1 / (1 + 10 ** ((rb - ra) / 400)), sa = win === 'a' ? 1 : 0;
        T.deltas = {};
        for (const [team, delta] of [[T.a, K * (sa - ea)], [T.b, K * ((1 - sa) - (1 - ea))]]) {
          const won = (team === T.a) === (win === 'a');
          for (const u of team) {
            const cur = ratingOf(L.scope, key, u);
            run(`INSERT INTO team_ratings(scope, game, user_id, rating, games, wins) VALUES(?,?,?,?,?,?)
              ON CONFLICT(scope, game, user_id) DO UPDATE SET rating=excluded.rating, games=excluded.games, wins=excluded.wins`,
            L.scope, key, u, cur.rating + delta, cur.games + 1, cur.wins + (won ? 1 : 0));
            T.deltas[u] = delta;
          }
        }
        T.result = win; T.resultBy = uid; refreshStats(L); return true;
      }
      case 'undo_result': { // marcou errado: devolve exatamente o que o resultado mudou
        const T = L.teams; if (!T?.result || !T.deltas) return false;
        const key = gameKey(L.game), win = T.result;
        for (const team of [T.a, T.b]) {
          const won = (team === T.a) === (win === 'a');
          for (const u of team) run('UPDATE team_ratings SET rating=rating-?, games=MAX(0, games-1), wins=MAX(0, wins-?) WHERE scope=? AND game=? AND user_id=?', T.deltas[u] || 0, won ? 1 : 0, L.scope, key, u);
        }
        T.result = null; T.deltas = null; refreshStats(L); return true;
      }
      case 'clear_teams': L.teams = null; return true;
    }
    return false;
  }

  // entrou na call com o lobby aberto: volta ao lugar se caiu há pouco, senão vaga livre ou fim da fila
  function onJoin(a, uid) {
    const L = a?.lobby; if (!L || L.playing.includes(uid) || L.queue.includes(uid)) return false;
    const g = L.gone.get(uid); L.gone.delete(uid);
    if (g && now() - g.at < GRACE_MS) {
      if (g.where === 'out') return false;
      if (g.where === 'playing' && L.playing.length < L.slots) L.playing.push(uid);
      else L.queue.splice(Math.min(g.where === 'queue' ? g.i : 0, L.queue.length), 0, uid);
      return true;
    }
    if (L.playing.length < L.slots) L.playing.push(uid); else L.queue.push(uid);
    return true;
  }
  function onLeave(a, uid) {
    const L = a?.lobby; if (!L) return false;
    const where = L.playing.includes(uid) ? 'playing' : L.queue.includes(uid) ? 'queue' : 'out';
    L.gone.set(uid, { where, i: L.queue.indexOf(uid), at: now() });
    for (const [k, v] of L.gone) if (now() - v.at > GRACE_MS) L.gone.delete(k);
    if (where === 'out') return false;
    drop(L, uid); fill(L); return true;
  }
  return { state, op, onJoin, onLeave, gameKey };
}
