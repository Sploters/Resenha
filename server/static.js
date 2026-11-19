// Entrega da interface (public/): comprimida (brotli/gzip, guardada em memória), com versão no endereço dos módulos e
// cache longo, e com a lista de módulos avisada na página (modulepreload) para o navegador baixar tudo em paralelo.
// - index.html: sem cache (sempre revalida); aponta para app.js?v=<versão> e os CSS ?v=<versão>.
// - módulos e CSS da raiz com ?v=<versão atual>: "immutable" por 1 ano. Os imports dentro deles também ganham ?v.
//   A versão é um hash de todos os arquivos: qualquer mudança (deploy) troca a versão e tudo é baixado de novo.
// - o resto (vendor, worklets, imagens): comprimido quando é texto/wasm, com ETag (revalida).
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
  // versão: conteúdo de todos os .js/.css/.html da raiz de public
  const top = fs.readdirSync(root).filter(f => /\.(js|css|html)$/.test(f)).sort();
  const hash = crypto.createHash('sha1'); for (const f of top) hash.update(f).update(fs.readFileSync(path.join(root, f)));
  const V = hash.digest('hex').slice(0, 10);
  const mods = new Set(top.filter(f => f.endsWith('.js')));
  const rewrite = (src) => src.replace(IMPORT_RE, (m, kw, q, f) => (mods.has(f) ? `${kw}${q}./${f}?v=${V}${q}` : m))
    .replace(DYN_RE, (m, kw, q, f) => (mods.has(f) ? `${kw}${q}./${f}?v=${V}${q}` : m));
  // módulos que o app.js puxa (direta ou indiretamente) — vão no modulepreload
  const graph = new Set(); const walk = (f) => { if (graph.has(f) || !mods.has(f)) return; graph.add(f); for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(IMPORT_RE)) walk(m[3]); };
  walk('app.js');
  const index = () => fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/(href|src)="\/([\w.-]+\.(?:js|css))"/g, (m, a, f) => `${a}="/${f}?v=${V}"`)
    .replace('</head>', [...graph].map(f => `<link rel="modulepreload" href="/${f}?v=${V}">`).join('\n') + '\n</head>');

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
  function send(req, res, rel, longCache) {
    const e = entry(rel, path.join(root, rel)); if (!e) return false;
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
  let warm = null;
  app.use((req, res, next) => {
    if (warm && /\.(js|css)$/.test(req.path)) return void warm.then(() => serve(req, res, next));
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
    if (!fs.existsSync(file)) { // rota da interface (ex.: /@me): a página
      if (!path.extname(rel)) return send(req, res, 'index.html', false) || next();
      return next();
    }
    const versioned = req.query.v === V && (mods.has(rel) || /^[\w.-]+\.css$/.test(rel));
    return send(req, res, rel, versioned) || next();
  }
  // minifica tudo logo na subida, num processo à parte e sem travar o servidor: quem pedir .js/.css antes de terminar
  // (fração de segundo) espera ficar pronto
  if (!minOff) {
    const files = fs.readdirSync(root).filter(f => /\.(js|css)$/.test(f));
    const items = files.map(f => { const src = fs.readFileSync(path.join(root, f), 'utf8'); return { ext: path.extname(f), code: mods.has(f) ? rewrite(src) : src }; });
    warm = runMinify(items, false).then((out) => {
      let ok = 0; out.forEach((m, i) => { if (m != null) { minDone.set(items[i].code, m); ok++; } });
      if (!ok) minOff = true, console.warn('[static] não deu para minificar (esbuild instalado?): a interface sai como está no disco');
      warm = null;
      // já monta o que vai ser entregue e solta os textos-fonte (só o minificado fica na memória)
      for (const f of files) entry(f, path.join(root, f));
      minDone.clear();
    });
  }
  return V;
}
