// Arquivos: envio de corpo inteiro (POST /api/upload; o retomável fica em server/uploads.js) e, em mountFiles, a entrega
// de /files e das miniaturas de vídeo. São duas funções porque, no index.js, outros módulos são registrados entre as duas
// partes (a ordem das rotas no express fica a mesma de antes).
// thumbs chega por getter (d.thumbs) no mountUpload: é criado logo depois no index.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uxServerCount } from '../ux.js';

export function mountUpload(app, d) {
  const { auth, bad, clean, UPLOAD_DIR, MAX_UPLOAD } = d;
  // arquivo já gravado em uploads/: vídeo com o índice no começo (toca na hora) e .mov do iPhone vira .mp4 (server/thumbs.js faststart)
  // Vídeo: o codec da imagem vai no anexo (vc) e entra na medição de quem consegue assistir (server/ux.js, video_upload)
  async function finalizeUpload(fname, name, size, type, uid) {
    let f = fname, n = name;
    try {
      const r = await d.thumbs.faststart(fname);
      if (r !== fname) { f = r; n = name.replace(/\.[^.]*$/, '') + '.mp4'; type = 'video/mp4'; size = fs.statSync(path.join(UPLOAD_DIR, f)).size; }
    } catch { }
    try { d.thumbs.warm?.(f); } catch { } // foto: miniaturas do chat prontas antes de alguém abrir (server/thumbs.js)
    let vc = null;
    if (/\.(mp4|webm)$/i.test(f)) { vc = await d.thumbs.probe(f).catch(() => null); if (vc) uxServerCount(uid, 'video_upload', vc); }
    return { url: `/files/${f}/${encodeURIComponent(n)}`, name: n, size, type, ...(vc ? { vc } : {}) };
  }
  // Uploads (corpo bruto)
  app.post('/api/upload', auth, (req, res) => {
    const name = clean(req.query.name, 200).replace(/[\\/\0]/g, '_') || 'arquivo';
    const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const fname = crypto.randomBytes(12).toString('hex') + ext;
    const fp = path.join(UPLOAD_DIR, fname);
    if (+req.headers['content-length'] > MAX_UPLOAD) { res.set('Connection', 'close'); return bad(res, 'Arquivo muito grande', 413); } // nem começa a gravar
    const out = fs.createWriteStream(fp);
    let size = 0, aborted = false;
    const abort = () => { if (aborted) return; aborted = true; req.unpipe(out); out.destroy(); fs.unlink(fp, () => { }); };
    req.on('data', c => {
      size += c.length;
      if (size > MAX_UPLOAD && !aborted) { abort(); res.set('Connection', 'close'); bad(res, 'Arquivo muito grande', 413); req.resume(); }
    });
    // a pessoa fechou o app / caiu a conexão no meio do envio: o pipe não fecha o arquivo sozinho (ficava o descritor aberto
    // e um arquivo pela metade em uploads/ para sempre)
    req.on('close', () => { if (!req.complete) abort(); });
    req.pipe(out);
    out.on('finish', async () => {
      if (aborted) return;
      const r = await finalizeUpload(fname, name, size, clean(req.headers['content-type'], 100), req.uid);
      if (!res.headersSent) res.json(r);
    });
    out.on('error', () => { if (!res.headersSent) bad(res, 'Falha no upload', 500); });
  });
  return { finalizeUpload };
}

export function mountFiles(app, d) {
  const { wrapA, thumbs, clipKeys, UPLOAD_DIR } = d;
  const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4)|text\/plain|application\/pdf)$/;
  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain' };
  app.get('/thumbs/:f', (req, res) => thumbs.route(req, res)); // miniatura de vídeo (server/thumbs.js)
  app.get('/thumbs/:f/strip', wrapA(async (req, res) => { // faixa da linha do tempo do editor de corte
    const f = path.basename(String(req.params.f || ''));
    if (!/^[a-f0-9]{24}\.webm$/.test(f) || !fs.existsSync(path.join(UPLOAD_DIR, f))) return res.sendStatus(404);
    thumbs.stripRoute(req, res, await clipKeys(f));
  }));
  app.get('/files/:f/:name?', (req, res) => {
    const f = path.basename(req.params.f), p = path.join(UPLOAD_DIR, f);
    if (!fs.existsSync(p)) return res.sendStatus(404);
    const mime = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (!SAFE_INLINE.test(mime) || req.query.download) res.attachment(req.params.name || f);
    res.type(mime); // depois do attachment(): ele troca o tipo pela extensão do nome (um .html/.svg voltava a ser text/html / image/svg+xml)
    res.sendFile(f, { root: UPLOAD_DIR, dotfiles: 'allow' });
  });
}
