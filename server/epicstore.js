// Epic Games Store: arte do jogo e catálogo de conquistas (público, sem conta nem chave), para as platinas e os 100%
// registrados à mão (server/achievements.js).
//   - página do jogo: store-content…/api/pt-BR/content/products/<slug> → nome, "sandbox" (namespace) e as imagens da loja
//   - conquistas do jogo: api.epicgames.dev/epic/achievements/v1/public/achievements/product/<sandbox>/locale/pt-BR →
//     nome, descrição, ícone e raridade de cada conquista e quantos % platinaram. NÃO diz o que UMA pessoa desbloqueou
//     (isso a Epic só mostra para o próprio jogo), por isso a Epic continua "informado" na tela.
// O endereço do jogo na loja (slug) é adivinhado pelo nome ("Alan Wake 2" → alan-wake-2) e conferido pelo nome que volta.
// EPIC_CONTENT_BASE / EPIC_ACH_BASE trocam os endereços (testes).
const CONTENT = () => process.env.EPIC_CONTENT_BASE || 'https://store-content-ipv4.ak.epicgames.com/api/pt-BR/content/products';
const ACH = () => process.env.EPIC_ACH_BASE || 'https://api.epicgames.dev/epic/achievements/v1/public/achievements/product';

export const nameKey = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[™®©]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const slugOf = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[™®©'’]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function getJson(url, ms = 8000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } }); return r.ok ? await r.json().catch(() => null) : null; }
  catch { return null; } finally { clearTimeout(t); }
}
// imagem da loja num tamanho pequeno (o CDN da Epic redimensiona pelo endereço)
const sized = (src, w, h) => (src && /^https:\/\/cdn\d?\.(unrealengine|epicgames)\.com\//.test(src) ? `${src.split('?')[0]}?h=${h}&quality=medium&resize=1&w=${w}` : src || null);

// { slug, title, sandbox, image, thumb } ou null. Tenta o nome inteiro e, se tiver subtítulo, só o começo ("X: Edição Y" → x)
export async function findEpicGame(title) {
  const want = nameKey(title); if (want.length < 2) return null;
  const tries = [...new Set([slugOf(title), slugOf(String(title).split(/[:\-–]/)[0])].filter(s => s.length >= 2))];
  for (const slug of tries) {
    const j = await getJson(`${CONTENT()}/${encodeURIComponent(slug)}`);
    const home = j?.pages?.find(p => p.type === 'productHome') || j?.pages?.[0];
    if (!j || !home) continue;
    const name = j.productName || home.productName || '';
    if (nameKey(name) !== want && !want.startsWith(nameKey(name)) && !nameKey(name).startsWith(want)) continue; // outro jogo com o mesmo endereço
    const imgs = home._images_ || [];
    const wide = home.data?.editions?.editions?.[0]?.image?.src || imgs.find(u => /1920x1080|2560x1440/.test(u)) || imgs[0] || null;
    return { slug, title: name, sandbox: j.namespace || home.namespace || null, image: sized(wide, 460, 215), thumb: sized(wide, 228, 128) };
  }
  return null;
}
// catálogo de conquistas do jogo: { total, platinumPct, list: [{ name, desc, icon, pct, tier }] } ou null
export async function epicAchievements(sandbox) {
  if (!/^[a-z0-9-]{2,64}$/i.test(String(sandbox || ''))) return null;
  const j = await getJson(`${ACH()}/${encodeURIComponent(sandbox)}/locale/pt-BR`);
  if (!j?.achievements) return null;
  const list = j.achievements.map(x => x.achievement || x).filter(a => a && (a.unlockedDisplayName || a.lockedDisplayName)).map(a => ({
    name: a.unlockedDisplayName || a.lockedDisplayName, desc: a.unlockedDescription || a.lockedDescription || '', icon: a.unlockedIconLink || null,
    pct: a.rarity?.percent ?? null, tier: a.tier?.name || null }));
  return { total: j.totalAchievements || list.length, platinumPct: j.platinumRarity?.percent ?? null, list };
}
