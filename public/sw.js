// Service worker do app instalável (PWA): abre na hora, mesmo com a internet lenta ou caindo.
// - Página (navegação): tenta a rede por até 2,5 s; se não vier, usa a última página guardada.
// - Scripts e CSS com versão no endereço (?v=…) ou hash no nome (pacotes: app.ABCD1234.js, server/bundle.mjs): guardados
//   para sempre (cada arquivo troca de versão só quando ele muda). Pacote de versão antiga sai do cache quando a página
//   nova chega sem ele na lista (<meta name="lc-files">).
// - Ícones, fontes, worklets e o resto estático: usa o guardado e atualiza em segundo plano.
// - API, gateway, arquivos enviados, miniaturas e downloads: sempre pela rede (nunca guardados aqui).
const CACHE = 'lc-app-v1';
const SKIP = /^\/(api|gateway|files|thumbs|desktop)(\/|$)/;
const HASHED = /^\/[\w-]+\.[A-Z0-9]{8}\.(js|css)$/;

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.add('/').catch(() => { }))); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const put = async (req, res) => { if (res && res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(req, res.clone()); } return res; };
// limpa versões antigas dos módulos quando chega uma nova (só a mais nova de cada arquivo fica)
async function prune(url) {
  const c = await caches.open(CACHE);
  for (const r of await c.keys()) { const u = new URL(r.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(r); }
}

// página nova da rede: tira do cache os pacotes que ela não usa mais (versões antigas)
async function pruneBundles(res) {
  try {
    const m = /<meta name="lc-files" content="([^"]*)">/.exec(await res.clone().text()); if (!m) return;
    const keep = new Set(m[1].split(' ')), c = await caches.open(CACHE);
    for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (HASHED.test(p) && !keep.has(p.slice(1))) await c.delete(r); }
  } catch { }
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin || SKIP.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const net = fetch(req).then(r => { if (r.ok) e.waitUntil(pruneBundles(r)); return put('/', r); });
      const slow = new Promise(r => setTimeout(r, 2500));
      const first = await Promise.race([net.catch(() => null), slow]);
      if (first) return first;
      const cached = await caches.match('/');
      return cached || net; // nada guardado ainda: espera a rede de qualquer jeito
    })());
    return;
  }
  if (url.searchParams.has('v') || HASHED.test(url.pathname)) { // módulo/CSS versionado ou pacote com hash: imutável
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (url.search) prune(url); return put(req, r); })));
    return;
  }
  e.respondWith((async () => { // resto estático: o guardado já, a rede atualiza por trás
    const hit = await caches.match(req);
    const net = fetch(req).then(r => put(req, r)).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});
