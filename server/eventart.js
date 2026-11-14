// Capa dos eventos para jogos fora da Steam (Riot, Battle.net, Epic, qualquer link) e imagens próprias.
//
// A capa sempre vira um arquivo desta instalação (uploads/): o servidor baixa a imagem uma vez e todo mundo carrega daqui.
// Assim ninguém vaza o IP para o site do jogo, a capa não quebra quando a loja troca a imagem, e o arquivo entra na conta
// de armazenamento como qualquer outro (events.banner é citado na lista de arquivos em uso).
//
// De onde vem: (1) link de uma página (loja da Epic, site do jogo, Battle.net…): lê o og:image / twitter:image do <head>;
// (2) link direto de uma imagem; (3) catálogo abaixo (Valorant, LoL, Overwatch…), que aponta para a página oficial.
// Segurança: só http(s), porta padrão, sem endereços internos (resolve o DNS e confere cada salto de redirecionamento),
// cabeçalho limitado a 400 KB, imagem até 8 MB e só png/jpeg/webp/gif/avif.
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// jogos populares fora da Steam: nome mostrado, loja e a página que tem a arte oficial (og:image)
export const ART_CATALOG = [
  ['Valorant', 'Riot Games', 'https://playvalorant.com/pt-br/'],
  ['League of Legends', 'Riot Games', 'https://www.leagueoflegends.com/pt-br/'],
  ['Teamfight Tactics', 'Riot Games', 'https://teamfighttactics.leagueoflegends.com/pt-br/'],
  ['Legends of Runeterra', 'Riot Games', 'https://playruneterra.com/pt-br/'],
  ['2XKO', 'Riot Games', 'https://2xko.riotgames.com/pt-br/'],
  ['Overwatch 2', 'Battle.net', 'https://overwatch.blizzard.com/pt-br/'],
  ['World of Warcraft', 'Battle.net', 'https://worldofwarcraft.blizzard.com/pt-br/'],
  ['Diablo IV', 'Battle.net', 'https://diablo4.blizzard.com/pt-br/'],
  ['Hearthstone', 'Battle.net', 'https://hearthstone.blizzard.com/pt-br'],
  ['StarCraft II', 'Battle.net', 'https://starcraft2.blizzard.com/pt-br/'],
  ['Call of Duty', 'Battle.net', 'https://www.callofduty.com/br/pt'],
  ['Fortnite', 'Epic Games', 'https://www.fortnite.com/'],
  ['Rocket League', 'Epic Games', 'https://www.rocketleague.com/'],
  ['Fall Guys', 'Epic Games', 'https://www.fallguys.com/'],
  ['Minecraft', 'Microsoft', 'https://www.minecraft.net/pt-br'],
  ['Genshin Impact', 'HoYoverse', 'https://genshin.hoyoverse.com/pt/'],
  ['Honkai: Star Rail', 'HoYoverse', 'https://hsr.hoyoverse.com/pt-pt/'],
  ['Free Fire', 'Garena', 'https://ff.garena.com/pt/'],
  ['Roblox', 'Roblox', 'https://www.roblox.com/'],
  ['GTA V / GTA Online', 'Rockstar', 'https://www.rockstargames.com/br/gta-online'],
].map(([name, store, page]) => ({ name, store, page }));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const catalogGame = (name) => { const n = norm(name); return n ? ART_CATALOG.find(g => norm(g.name) === n) || null : null; };

// endereço interno/reservado (não deixa o servidor ser usado para espiar a rede local)
export function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
}
async function checkUrl(u, allowPrivate) {
  let url; try { url = new URL(u); } catch { throw new Error('Link inválido'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (!allowPrivate && url.port && !['80', '443'].includes(url.port))) throw new Error('Link inválido');
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
    if (!addrs.length) throw new Error('Não achei esse site');
    if (addrs.some(privateIp)) throw new Error('Link inválido');
  }
  return url;
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
async function fetchSafe(u, accept, allowPrivate, hops = 4) {
  for (let i = 0; i <= hops; i++) {
    const url = await checkUrl(u, allowPrivate);
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { r.body?.cancel().catch(() => { }); u = new URL(r.headers.get('location'), url).href; continue; }
    if (!r.ok) { r.body?.cancel().catch(() => { }); throw new Error(r.status === 403 || r.status === 429 ? 'O site recusou o pedido (proteção contra robôs). Envie uma imagem.' : 'O site respondeu com erro ' + r.status); }
    return { r, url: url.href };
  }
  throw new Error('Redirecionamentos demais');
}
async function readMax(r, max, stopAt) {
  const rd = r.body.getReader(), parts = []; let n = 0;
  for (; ;) {
    const { done, value } = await rd.read(); if (done) break;
    n += value.length; if (n > max) { if (stopAt) { parts.push(value); break; } rd.cancel().catch(() => { }); throw new Error('Imagem grande demais (máx. 8 MB)'); }
    parts.push(value);
    if (stopAt && stopAt(Buffer.concat(parts).toString('utf8'))) break;
  }
  rd.cancel().catch(() => { });
  return Buffer.concat(parts);
}
const decodeAttr = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// imagem de capa citada no <head>: og:image > twitter:image > link rel=image_src
export function pageImage(html) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const find = (re) => { for (const m of metas) if (re.test(m)) { const c = m.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i); const v = c && (c[2] ?? c[3]); if (v && v.trim()) return decodeAttr(v.trim()); } return null; };
  const title = find(/(property|name)\s*=\s*["']og:title["']/i) || (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || '').trim();
  const img = find(/(property|name)\s*=\s*["']og:image(:secure_url|:url)?["']/i) || find(/(property|name)\s*=\s*["']twitter:image(:src)?["']/i)
    || (html.match(/<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i)?.[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1]) || null;
  return { img, title: decodeAttr(title || '') };
}
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const sniff = (b) => b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : b.slice(0, 3).toString() === 'GIF' ? 'image/gif' : b.slice(4, 12).toString().startsWith('ftypavi') ? 'image/avif' : null;

// link (página ou imagem) -> { url: '/files/<arquivo>/capa.jpg', title, source }
export function createArt({ uploadDir, allowPrivate = false, log = console.log }) {
  const cache = new Map(); // link -> { at, p }
  async function resolve(link) {
    let { r, url } = await fetchSafe(link, 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5', allowPrivate);
    let ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), title = '';
    if (!ct.startsWith('image/')) {
      const html = (await readMax(r, 400000, (s) => /<\/head>/i.test(s))).toString('utf8');
      const p = pageImage(html); title = p.title;
      if (!p.img) throw new Error('Essa página não tem imagem de capa. Envie uma imagem.');
      ({ r, url } = await fetchSafe(new URL(p.img, url).href, 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', allowPrivate));
      ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    }
    const buf = await readMax(r, 8 * 2 ** 20);
    const type = sniff(buf) || (IMG_EXT[ct] ? ct : null);
    if (!type || !IMG_EXT[type]) throw new Error('O link não é uma imagem (png, jpg, webp, gif ou avif)');
    const fname = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + IMG_EXT[type]; // mesma imagem = mesmo arquivo
    const fp = path.join(uploadDir, fname);
    if (!fs.existsSync(fp)) await fs.promises.writeFile(fp, buf);
    return { url: `/files/${fname}/capa${IMG_EXT[type]}`, title: title.slice(0, 100), source: link };
  }
  return function art(link) {
    const c = cache.get(link);
    if (c && Date.now() - c.at < 6 * 3600e3 && fs.existsSync(path.join(uploadDir, c.v?.url.split('/')[2] || '-'))) return Promise.resolve(c.v);
    if (c?.p) return c.p;
    const p = resolve(link).then(v => { cache.set(link, { at: Date.now(), v }); if (cache.size > 300) cache.delete(cache.keys().next().value); return v; })
      .catch(e => { cache.delete(link); log('[eventos] capa ' + link + ': ' + e.message); throw e; });
    cache.set(link, { at: Date.now(), p });
    return p;
  };
}
