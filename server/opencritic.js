// Nota da crítica (OpenCritic) no popup do jogo: complemento das avaliações da Steam. Só pela API oficial do OpenCritic
// (RapidAPI), com a chave no servidor: o cliente nunca a vê e o nome do jogo é a única coisa enviada.
//
// GET /api/critic?title=<nome do jogo>  ->  { score, tier, pct, reviews, name, url }  ou  {} (sem chave, não achou,
// jogo sem nota ainda, cota do dia gasta ou OpenCritic fora do ar). Nunca dá erro para o popup: sem nota, ele só não mostra.
//
// Configuração: OPENCRITIC_KEY (chave da RapidAPI; sem ela tudo fica desligado). OPENCRITIC_DAILY = no máximo quantos
// pedidos por dia ao OpenCritic (padrão 100; o plano grátis é pequeno). OPENCRITIC_API e OPENCRITIC_HOST trocam o
// endereço (testes). Cada jogo pesquisado fica guardado no banco (14 dias com nota, 3 dias sem): o mesmo jogo aberto por
// todo mundo gasta 2 pedidos (busca + jogo) uma vez só, e reiniciar o servidor não gasta de novo.
const env = (k, d) => process.env[k] || d;
const KEY = () => env('OPENCRITIC_KEY', '');
const RHOST = () => env('OPENCRITIC_HOST', 'opencritic-api.p.rapidapi.com');
const BASE = () => env('OPENCRITIC_API', 'https://' + RHOST());
const DAILY = () => Math.max(0, +env('OPENCRITIC_DAILY', 100) || 0);
const DAY = 864e5, HIT_TTL = 14 * DAY, MISS_TTL = 3 * DAY;
// selos do OpenCritic em português
export const TIERS = { Mighty: 'Poderoso', Strong: 'Forte', Fair: 'Razoável', Weak: 'Fraco' };
// "The Witcher® 3: Wild Hunt" e "the witcher 3 wild hunt" são o mesmo jogo
export const nameKey = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '');
// resultado da busca que é mesmo o jogo: nome igual (sem pontuação/maiúsculas) ou quase igual pela distância do próprio
// OpenCritic. Na dúvida não mostra (nota de outro jogo é pior que nenhuma)
export function pickMatch(title, list) {
  const k = nameKey(title); if (!k || !Array.isArray(list)) return null;
  return list.find(x => x && nameKey(x.name) === k) || list.find(x => x && typeof x.dist === 'number' && x.dist <= 0.1 && Math.abs(nameKey(x.name).length - k.length) <= 3) || null;
}
// resposta do /game/:id -> o que o popup usa. Nota -1 = ainda sem críticas suficientes
export function slimGame(g) {
  const score = Math.round(+g?.topCriticScore);
  if (!g || !(score >= 0)) return null;
  const pct = Math.round(+g.percentRecommended);
  const slug = g.url ? String(g.url) : g.id ? `https://opencritic.com/game/${g.id}/${encodeURIComponent(String(g.slug || 'game'))}` : 'https://opencritic.com/';
  return { score, tier: TIERS[g.tier] || null, pct: pct >= 0 ? pct : null, reviews: +g.numReviews || +g.numTopCriticReviews || 0, name: String(g.name || ''), url: /^https:\/\/opencritic\.com\//.test(slug) ? slug : 'https://opencritic.com/' };
}

export function mountOpenCritic(app, { auth, wrapA, db }) {
  db.exec('CREATE TABLE IF NOT EXISTS critic_cache(k TEXT PRIMARY KEY, v TEXT, at INTEGER NOT NULL)');
  const readC = db.prepare('SELECT v, at FROM critic_cache WHERE k=?'), writeC = db.prepare('INSERT OR REPLACE INTO critic_cache(k,v,at) VALUES(?,?,?)');
  const quota = { day: '', used: 0 }, busy = new Map();
  let warned = false;
  const take = () => {
    const d = new Date().toISOString().slice(0, 10); if (quota.day !== d) Object.assign(quota, { day: d, used: 0 });
    if (quota.used >= DAILY()) return false; quota.used++; return true;
  };
  const call = async (path) => {
    if (!take()) throw new Error('cota do dia');
    const r = await fetch(BASE() + path, { headers: { 'X-RapidAPI-Key': KEY(), 'X-RapidAPI-Host': RHOST(), Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (r.status === 429) { quota.used = DAILY(); throw new Error('limite do OpenCritic'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  async function lookup(title) {
    const found = pickMatch(title, await call('/game/search?criteria=' + encodeURIComponent(title.slice(0, 80))));
    return found?.id ? slimGame(await call('/game/' + encodeURIComponent(found.id))) : null;
  }
  function critic(title) {
    const k = nameKey(title); if (k.length < 2) return Promise.resolve(null);
    const c = readC.get(k);
    if (c && Date.now() - c.at < (c.v ? HIT_TTL : MISS_TTL)) return Promise.resolve(c.v ? JSON.parse(c.v) : null);
    if (!busy.has(k)) busy.set(k, lookup(title).then(v => { writeC.run(k, v ? JSON.stringify(v) : null, Date.now()); warned = false; return v; })
      .catch(e => { if (!warned) { warned = true; console.log(`  OpenCritic: ${e.message}`); } return c?.v ? JSON.parse(c.v) : null; }) // falhou: serve o antigo, sem guardar a falha
      .finally(() => busy.delete(k)));
    return busy.get(k);
  }
  app.get('/api/critic', auth, wrapA(async (req, res) => {
    const title = String(req.query.title || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
    if (!KEY() || title.length < 2 || title.length > 100) return res.json({});
    const v = await critic(title);
    res.set('Cache-Control', 'private, max-age=3600');
    res.json(v || {});
  }));
}
