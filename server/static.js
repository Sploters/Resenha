// Entrega da interface (public/): comprimida (brotli/gzip, guardada em memória), com versão no endereço dos módulos e
// cache longo, e com a lista de módulos avisada na página (modulepreload) para o navegador baixar tudo em paralelo.
// - index.html: sem cache (sempre revalida); aponta para app.js?v=<versão> e os CSS ?v=<versão>.
// - módulos e CSS da raiz com ?v=<versão do arquivo>: "immutable" por 1 ano. Os imports dentro deles também ganham ?v.
//   Cada arquivo tem a sua versão: hash do próprio texto e das versões do que ele importa (módulos que se importam em
//   roda dividem uma só). Num deploy só é baixado de novo o que mudou e quem o importa; antes a versão era uma só para
//   tudo e cada atualização baixava os ~130 arquivos da abertura (588 KB) de novo. A versão geral (V, <meta lc-ui>) segue
//   sendo o hash de tudo: é ela que diz à página aberta que há interface nova (public/uiupdate.js) e é a do app.js.
// - o resto (vendor, worklets, imagens): comprimido quando é texto/wasm, com ETag (revalida).
// - pacotes (server/bundle.mjs, ligado por padrão; STATIC_BUNDLE=0 desliga): a página aponta para app.<hash>.js e um CSS
//   só (ui.<hash>.css); a abertura baixa ~10 arquivos em vez de ~130. Pelo túnel até o servidor cada pedido custa ~25–30 ms
//   de fila, então abrir do zero levava ~3 s só nisso. Os módulos soltos com ?v continuam servidos (página de antes da
//   atualização, testes com STATIC_BUNDLE=0, e se o esbuild falhar a página volta para eles sozinha).
// - .js e .css da raiz saem minificados (esbuild, arquivo por arquivo: os nomes e o jeito de carregar não mudam). O código
//   é cheio de comentários e espaço, que só pesavam no download. STATIC_MINIFY=0 entrega como está no disco.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' };
// minificador: server/minify.mjs (esbuild) num processo à parte; sem esbuild (instalação antiga), entrega sem minificar
let minOff = process.env.STATIC_MINIFY === '0';
const minWorker = fileURLToPath(new URL('./minify.mjs', import.meta.url));
// pacotes da interface (server/bundle.mjs): a abertura em ~10 arquivos em vez de ~130. STATIC_BUNDLE=0: módulos soltos
const bundleOn = process.env.STATIC_BUNDLE !== '0';
const bundleWorker = fileURLToPath(new URL('./bundle.mjs', import.meta.url));
const minDone = new Map(); // fonte -> minificado
const runMinify = (items, sync) => {
  const opts = { input: JSON.stringify(items), maxBuffer: 64 << 20, encoding: 'utf8' };
  if (sync) { try { return JSON.parse(execFileSync(process.execPath, [minWorker], opts)); } catch { return items.map(() => null); } }
  return new Promise((res) => { const c = execFile(process.execPath, [minWorker], opts, (err, out) => { try { res(err ? items.map(() => null) : JSON.parse(out)); } catch { res(items.map(() => null)); } }); c.stdin.end(opts.input); });
};
const minify = (code, ext) => {
  if (minOff) return code;
  if (!minDone.has(code)) minDone.set(code, runMinify([{ ext, code }], true)[0]); // arquivo mudou depois da subida (desenvolvimento)
  return minDone.get(code) ?? code;
};
const COMPRESS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.wasm', '.txt', '.map', '.webmanifest']);
const IMPORT_RE = /(\bfrom\s*|\bimport\s*)(['"])\.\/([\w.-]+\.js)\2/g;
// import('./x.js') dinâmico (tela aberta sob demanda): também ganha ?v, mas NÃO entra no modulepreload da abertura
const DYN_RE = /(\bimport\(\s*)(['"])\.\/([\w.-]+\.js)\2/g;

export function mountStatic(app, dir) {
  const root = path.resolve(dir);
  // Estado que depende dos arquivos de public/: montado na subida e de novo em reload() (atualização só da interface,
  // sem reiniciar o servidor: deploy/umbrel.sh troca public/ e manda SIGHUP; ver server/index.js)
  let V = '', mods = new Set(), graph = new Set(), vers = new Map(), deps = new Map(); // vers: arquivo -> versão dele
  function scan() {
    // versão geral: conteúdo de todos os .js/.css/.html da raiz de public
    const top = fs.readdirSync(root).filter(f => /\.(js|css|html)$/.test(f)).sort();
    const src = new Map(top.map(f => [f, fs.readFileSync(path.join(root, f))]));
    const hash = crypto.createHash('sha1'); for (const f of top) hash.update(f).update(src.get(f));
    V = hash.digest('hex').slice(0, 10);
    mods = new Set(top.filter(f => f.endsWith('.js')));
    deps = new Map([...mods].map(f => { const t = src.get(f).toString('utf8'); return [f, { st: [...t.matchAll(IMPORT_RE)].map(m => m[3]).filter(x => mods.has(x)), all: [...new Set([...t.matchAll(IMPORT_RE), ...t.matchAll(DYN_RE)].map(m => m[3]).filter(x => mods.has(x)))] }]; }));
    // módulos que o app.js puxa (direta ou indiretamente) — vão no modulepreload
    graph = new Set(); const walk = (f) => { if (graph.has(f) || !mods.has(f)) return; graph.add(f); for (const d of deps.get(f).st) walk(d); };
    walk('app.js');
    // versão de cada arquivo (Tarjan: cada grupo de módulos que se importam em roda sai depois de tudo o que ele importa)
    vers = new Map(top.filter(f => !mods.has(f)).map(f => [f, crypto.createHash('sha1').update(src.get(f)).digest('hex').slice(0, 10)]));
    let n = 0; const idx = new Map(), low = new Map(), stack = [], on = new Set();
    const visit = (f) => {
      idx.set(f, n); low.set(f, n++); stack.push(f); on.add(f);
      for (const d of deps.get(f).all) { if (!idx.has(d)) { visit(d); low.set(f, Math.min(low.get(f), low.get(d))); } else if (on.has(d)) low.set(f, Math.min(low.get(f), idx.get(d))); }
      if (low.get(f) !== idx.get(f)) return;
      const grp = []; let x; do { x = stack.pop(); on.delete(x); grp.push(x); } while (x !== f);
      grp.sort(); const h = crypto.createHash('sha1'), ext = new Set();
      for (const g of grp) { h.update(g).update(src.get(g)); for (const d of deps.get(g).all) if (!grp.includes(d)) ext.add(d); }
      for (const d of [...ext].sort()) h.update(d + '=' + vers.get(d));
      const v = h.digest('hex').slice(0, 10); for (const g of grp) vers.set(g, v);
    };
    for (const f of mods) if (!idx.has(f)) visit(f);
    if (mods.has('app.js') && ![...deps.values()].some(d => d.all.includes('app.js'))) vers.set('app.js', V); // ninguém importa o app.js
  }
  scan();
  const rewrite = (src) => src.replace(IMPORT_RE, (m, kw, q, f) => (mods.has(f) ? `${kw}${q}./${f}?v=${vers.get(f)}${q}` : m))
    .replace(DYN_RE, (m, kw, q, f) => (mods.has(f) ? `${kw}${q}./${f}?v=${vers.get(f)}${q}` : m));
  // <meta name="lc-ui">: a página sabe com qual versão abriu (public/uiupdate.js compara com a do servidor)
  const index = () => (bun ? bundledIndex() : fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/(href|src)="\/([\w.-]+\.(?:js|css))"/g, (m, a, f) => `${a}="/${f}?v=${vers.get(f) || V}"`)
    // lc-lazy: versão dos módulos fora da abertura (telas sob demanda), para o window.__lc.import dos testes (public/app.js)
    .replace('</head>', `<meta name="lc-ui" content="${V}">\n<meta name="lc-lazy" content="${[...mods].filter(f => !graph.has(f)).map(f => f + ':' + vers.get(f)).join(' ')}">\n` + [...graph].map(f => `<link rel="modulepreload" href="/${f}?v=${vers.get(f)}">`).join('\n') + '\n</head>'));
  // com os pacotes (server/bundle.mjs): app.<hash>.js no lugar do app.js, um CSS só no lugar dos 9, e o modulepreload só
  // dos pedaços da abertura. lc-mods: o pacote com todos os módulos (window.__lc.import dos testes); lc-files: os arquivos
  // desta versão (o service worker apaga do cache os pacotes de versões antigas que não estão mais na lista)
  const bundledIndex = () => {
    let css = false;
    return fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace(/<link rel="stylesheet" href="\/([\w.-]+\.css)">\n?/g, (m, f) => (!bun.cssList.includes(f) ? m : css ? '' : (css = true, `<link rel="stylesheet" href="/${bun.css}">\n`)))
      .replace(/src="\/app\.js"/, `src="/${bun.app}"`)
      .replace(/(href|src)="\/([\w.-]+\.(?:js|css))"/g, (m, a, f) => (bunFiles.has(f) ? m : `${a}="/${f}?v=${vers.get(f) || V}"`))
      .replace('</head>', `<meta name="lc-ui" content="${V}">\n<meta name="lc-mods" content="/${bun.mods}">\n<meta name="lc-files" content="${[...bun.names].join(' ')}">\n` + bun.boot.filter(f => f !== bun.app).map(f => `<link rel="modulepreload" href="/${f}">`).join('\n') + '\n</head>');
  };

  const cache = new Map(); // caminho -> { mtime, body, br, gz, etag, type }
  function entry(rel, file) {
    let st; try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const c = cache.get(rel); if (c && c.mtime === st.mtimeMs) return c;
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (rel === 'index.html') body = Buffer.from(index());
    else if (mods.has(rel)) body = Buffer.from(minify(rewrite(body.toString('utf8')), ext));
    else if (ext === '.css' && !rel.includes('/')) body = Buffer.from(minify(body.toString('utf8'), ext));
    const e = { mtime: st.mtimeMs, body, type: TYPES[ext] || null, ext, etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"' };
    cache.set(rel, e); return e;
  }
  const encoded = (e, enc) => {
    if (enc === 'br') return (e.br ||= zlib.brotliCompressSync(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.body.length } }));
    return (e.gz ||= zlib.gzipSync(e.body, { level: 9 }));
  };
  function send(req, res, rel, longCache, e = entry(rel, path.join(root, rel))) {
    if (!e) return false;
    if (e.type) res.setHeader('Content-Type', e.type);
    res.setHeader('Cache-Control', longCache ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.setHeader('ETag', e.etag); res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === e.etag) { res.statusCode = 304; res.end(); return true; }
    const ae = String(req.headers['accept-encoding'] || ''), enc = COMPRESS.has(e.ext) && e.body.length > 512 ? (/\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null) : null;
    const out = enc ? encoded(e, enc) : e.body;
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', out.length);
    res.end(req.method === 'HEAD' ? undefined : out);
    return true;
  }
  // pacotes: bun = o da versão atual; bunFiles = arquivos das últimas versões (nome com hash: página aberta antes de um
  // deploy ainda acha os pedaços dela ao abrir uma tela sob demanda)
  let bun = null; const bunFiles = new Map(), bunBuilds = [];
  let warm = null, prev = null; // prev: { vers, cache } da versão anterior da interface (só .js/.css da raiz)
  // arquivo da versão anterior pedido por uma página aberta antes da atualização (só o que mudou: o resto tem a mesma versão)
  const prevEntry = (rel, v) => (prev && v && v !== vers.get(rel) && prev.vers.get(rel) === v ? prev.cache.get(rel) : null);
  app.use((req, res, next) => {
    // montando a interface (subida ou atualização): .js/.css e a página esperam (fração de segundo; a página precisa dos
    // nomes dos pacotes)
    if (warm && !/^\/(api|files|gateway)(\/|$)/.test(req.path)) return void warm.then(() => serve(req, res, next));
    serve(req, res, next);
  });
  function serve(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (/^\/(api|files|gateway)(\/|$)/.test(req.path)) return next();
    let rel = decodeURIComponent(req.path).replace(/^\/+/, '');
    if (rel === '' || rel === 'index.html') return send(req, res, 'index.html', false) || next();
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    rel = path.relative(root, file).split(path.sep).join('/');
    const bf = bunFiles.get(rel); if (bf) return send(req, res, rel, true, bf);
    const old = prevEntry(rel, req.query.v);
    if (!fs.existsSync(file) && !old) { // rota da interface (ex.: /@me): a página
      if (!path.extname(rel)) return send(req, res, 'index.html', false) || next();
      return next();
    }
    // página aberta antes de uma atualização da interface pedindo um módulo da versão dela (tela aberta sob demanda):
    // entrega o da versão anterior, guardado em memória, para não misturar módulos novos e velhos na mesma página
    if (old) return send(req, res, rel, true, old);
    const versioned = req.query.v === vers.get(rel) && (mods.has(rel) || /^[\w.-]+\.css$/.test(rel));
    return send(req, res, rel, versioned) || next();
  }
  // minifica tudo logo na subida, num processo à parte e sem travar o servidor: quem pedir .js/.css antes de terminar
  // (fração de segundo) espera ficar pronto
  function prewarm() {
    const files = fs.readdirSync(root).filter(f => /\.(js|css)$/.test(f));
    const bundling = bundleOn && mods.has('app.js') ? runBundle() : Promise.resolve(null);
    let minified;
    // sem minificar: monta tudo já assim mesmo (a versão anterior guardada em reload() precisa de todos os arquivos)
    if (minOff) { for (const f of files) entry(f, path.join(root, f)); minified = Promise.resolve(); }
    else {
      const items = files.map(f => { const src = fs.readFileSync(path.join(root, f), 'utf8'); return { ext: path.extname(f), code: mods.has(f) ? rewrite(src) : src }; });
      minified = runMinify(items, false).then((out) => {
        let ok = 0; out.forEach((m, i) => { if (m != null) { minDone.set(items[i].code, m); ok++; } });
        if (!ok) minOff = true, console.warn('[static] não deu para minificar (esbuild instalado?): a interface sai como está no disco');
        // já monta o que vai ser entregue e solta os textos-fonte (só o minificado fica na memória)
        for (const f of files) entry(f, path.join(root, f));
        minDone.clear();
      });
    }
    const p = warm = Promise.all([bundling, minified]).then(async ([b]) => {
      bun = b ? await useBundle(b) : null;
      if (warm === p) warm = null;
    }).catch((e) => { console.warn('[static] pacotes:', e?.message || e); bun = null; if (warm === p) warm = null; });
  }
  // ---------- pacotes (server/bundle.mjs) ----------
  // entradas: app.js e cada módulo aberto sob demanda (import('./x.js')); lc-mods: todos os módulos que o app alcança
  function runBundle() {
    const reach = new Set(), walk = (f) => { if (reach.has(f) || !mods.has(f)) return; reach.add(f); for (const d of deps.get(f).all) walk(d); };
    walk('app.js');
    const lazy = new Set(); for (const f of reach) for (const d of deps.get(f).all) if (!deps.get(f).st.includes(d)) lazy.add(d);
    const input = JSON.stringify({ root, entries: ['app.js', ...[...lazy].filter(f => f !== 'app.js').sort()], mods: [...reach].filter(f => f !== 'app.js').sort(), minify: !minOff });
    return new Promise((res) => {
      const c = execFile(process.execPath, [bundleWorker], { maxBuffer: 256 << 20, encoding: 'utf8' }, (err, out) => {
        let r = null; try { r = JSON.parse(out); } catch { }
        if (err || !r || r.error) { console.warn('[static] não deu para montar os pacotes, a interface sai em módulos soltos:', r?.error || err?.message || 'sem resposta'); return res(null); }
        res(r);
      });
      c.stdin.end(input);
    });
  }
  const mk = (body, ext) => ({ mtime: 0, body, type: TYPES[ext] || null, ext, etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"' });
  const brAsync = (e) => new Promise((res) => zlib.brotliCompress(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.body.length } }, (err, out) => { if (!err) e.br = out; res(); }));
  async function useBundle(b) {
    // CSS: os da página, na mesma ordem, num arquivo só (já minificados pela entrega de cada um)
    const cssList = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="\/([\w.-]+\.css)">/g)].map(m => m[1]).filter(f => fs.existsSync(path.join(root, f)));
    const cssBody = Buffer.from(cssList.map(f => entry(f, path.join(root, f)).body.toString('utf8')).join('\n'));
    const css = `ui.${crypto.createHash('sha1').update(cssBody).digest('hex').slice(0, 8).toUpperCase()}.css`;
    const names = new Set([...Object.keys(b.files), css]);
    const fresh = [];
    for (const [n, text] of Object.entries(b.files)) if (!bunFiles.has(n)) { const e = mk(Buffer.from(text), '.js'); bunFiles.set(n, e); fresh.push(e); }
    if (!bunFiles.has(css)) { const e = mk(cssBody, '.css'); bunFiles.set(css, e); fresh.push(e); }
    await Promise.all(fresh.map(brAsync)); // comprime fora da linha principal (o brotli de ~1 MB travaria o servidor)
    // guarda as 3 últimas versões; arquivo que só as mais antigas usavam sai da memória
    bunBuilds.push(names);
    while (bunBuilds.length > 3) { const gone = bunBuilds.shift(); for (const n of gone) if (!bunBuilds.some(s => s.has(n))) bunFiles.delete(n); }
    return { app: b.entries['app.js'], boot: b.boot, mods: b.mods, css, cssList, names };
  }
  prewarm();
  return {
    get version() { return V; },
    // public/ mudou no disco: versão nova, tudo montado de novo. Devolve true se a versão mudou
    reload() {
      const before = V, beforeVers = vers, old = new Map([...cache].filter(([rel]) => !rel.includes('/') && /\.(js|css)$/.test(rel)));
      scan();
      if (V === before) return false;
      prev = { vers: beforeVers, cache: old };
      cache.clear(); minDone.clear(); prewarm();
      return true;
    },
  };
}
