// Cabeçalhos de segurança da interface (public/), principalmente a Content-Security-Policy (CSP) da página.
// A CSP é a defesa de reserva contra XSS: se algum texto de usuário escapar do md()/esc() e virar HTML, o navegador
// ainda assim não roda script de fora nem script inline (o único inline da página, o do index.html, vai pelo hash).
// - script: só os arquivos do próprio servidor, o script inline do index.html (hash), WebAssembly (filtro de ruído) e a
//   API do player do YouTube (Watch Together).
// - imagens e vídeo: qualquer endereço (não rodam script); iframes: https em geral (capas de jogo, GIFs da KLIPY/GIPHY, miniaturas, players embutidos dos sites).
// - conexões: o próprio servidor (API e /gateway) e a checagem de atualização do app no GitHub.
// Variáveis: CSP=off desliga, CSP=report só avisa no console do navegador (não bloqueia); CSP_EXTRA="http://host:porta ..."
// soma origens a script/imagem/mídia/conexão/iframe (os testes usam para os servidores falsos locais).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// hash (sha256) de cada <script> inline do index.html, para a CSP liberar só esses
function inlineHashes(indexFile) {
  let html = ''; try { html = fs.readFileSync(indexFile, 'utf8'); } catch { return []; }
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
}

export function buildCsp({ publicDir, extra = process.env.CSP_EXTRA || '' }) {
  const x = extra.split(/\s+/).filter(s => /^(https?|wss?):\/\/[\w.:[\]-]+$/.test(s)).join(' ');
  const plus = (s) => (x ? `${s} ${x}` : s);
  return [
    "default-src 'self'",
    plus(`script-src 'self' ${inlineHashes(path.join(publicDir, 'index.html')).join(' ')} 'wasm-unsafe-eval' https://www.youtube.com https://s.ytimg.com`),
    "style-src 'self' 'unsafe-inline'", // estilos inline (style="..." e el.style) são usados no app todo
    plus("img-src 'self' data: blob: https: http:"),
    plus("media-src 'self' data: blob: https: http:"),
    "font-src 'self' data:",
    plus("connect-src 'self' blob: data: https://api.github.com"),
    plus("frame-src 'self' https:"),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

// páginas da interface: "/", "/index.html" e rotas sem extensão (ex.: /@me, /channels/...) que caem no index.html
const isPage = (p) => !/^\/(api|files|gateway)(\/|$)/.test(p) && (p === '/' || p.endsWith('.html') || !path.extname(p));

export function mountSecurity(app, { publicDir }) {
  const mode = (process.env.CSP || 'on').toLowerCase();
  const csp = mode === 'off' ? null : buildCsp({ publicDir });
  const cspHeader = mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // origem (sem caminho) para outros sites: o player do YouTube exige saber de onde vem; nunca a URL inteira com ids
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if ((req.method === 'GET' || req.method === 'HEAD') && isPage(req.path)) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      if (csp) res.setHeader(cspHeader, csp);
    }
    next();
  });
}
