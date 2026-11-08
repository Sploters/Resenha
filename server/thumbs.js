// Miniaturas de vídeos (clipes e vídeos enviados no chat) e versões menores das fotos em WebP (ver IMAGE abaixo): uma imagem pequena gerada uma vez pelo ffmpeg e guardada ao
// lado do vídeo (<arquivo>.thumb.jpg). O chat e a galeria mostram a miniatura; o vídeo só baixa quando alguém dá play.
// GET /thumbs/<24 hex>.(webm|mp4): gera na primeira vez (fila de 1 em 1, para não pesar o servidor) e depois serve do disco.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const VIDEO = /^[a-f0-9]{24}\.(webm|mp4)$/;
// fotos (anexos, perfis, ícones de servidor): versões menores em WebP no tamanho em que a tela mostra. GIF fica de fora
// (perderia a animação). GET /thumbs/<24 hex>.<png|jpg|jpeg|webp|bmp>?s=<lado>
const IMAGE = /^[a-f0-9]{24}\.(png|jpe?g|webp|bmp)$/i;
const SIZES = [64, 128, 256, 480, 960, 1600];

export function createThumbs(dir) {
  const UPLOAD_DIR = path.resolve(dir);
  const thumbOf = (f) => path.join(UPLOAD_DIR, f + '.thumb.jpg');
  const pending = new Map(); // arquivo -> Promise<boolean>
  let chain = Promise.resolve();
  const run = (args) => new Promise((res) => {
    let p; try { p = spawn(FFMPEG, args, { stdio: 'ignore' }); } catch { return res(false); }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } res(false); }, 20000);
    p.on('error', () => { clearTimeout(t); res(false); }); p.on('exit', (c) => { clearTimeout(t); res(c === 0); });
  });
  // quadro de ~1 s (o 1º costuma ser preto); vídeo curto demais: o primeiro quadro
  const make = (f) => {
    const src = path.join(UPLOAD_DIR, f), out = thumbOf(f), tmp = out + '.tmp.jpg';
    const args = (ss) => ['-hide_banner', '-loglevel', 'error', '-y', ...(ss ? ['-ss', ss] : []), '-i', src, '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", '-q:v', '6', tmp];
    return run(args('1')).then(ok => (ok && fs.existsSync(tmp) && fs.statSync(tmp).size > 0 ? ok : run(args(null))))
      .then(ok => { if (ok && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return true; } try { fs.unlinkSync(tmp); } catch { } return false; });
  };
  function ensure(f) {
    if (!VIDEO.test(f)) return Promise.resolve(false);
    if (fs.existsSync(thumbOf(f))) return Promise.resolve(true);
    if (!fs.existsSync(path.join(UPLOAD_DIR, f))) return Promise.resolve(false);
    if (!pending.has(f)) { const p = (chain = chain.then(() => make(f))).finally(() => pending.delete(f)); pending.set(f, p); }
    return pending.get(f);
  }
  function route(req, res) {
    const f = path.basename(String(req.params.f || ''));
    if (IMAGE.test(f)) return imageRoute(req, res, f);
    if (!VIDEO.test(f)) return res.sendStatus(404);
    ensure(f).then(ok => {
      if (!ok) return res.sendStatus(404);
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.type('image/jpeg'); res.sendFile(thumbOf(f));
    }, () => res.sendStatus(500));
  }
  // faixa da linha do tempo do editor de corte: até 10 quadros lado a lado (128x72 cada) numa imagem só.
  // Decodifica só os quadros-chave (-skip_frame nokey) e pega os de índice `idx` (os mais próximos de cada décimo do
  // clipe): poucos décimos de segundo mesmo num clipe de 60 s. GET /thumbs/<arquivo>/strip
  const stripOf = (f) => path.join(UPLOAD_DIR, f + '.strip.jpg');
  const stripPending = new Map();
  function ensureStrip(f, idx) {
    if (!VIDEO.test(f) || !idx.length) return Promise.resolve(false);
    if (fs.existsSync(stripOf(f))) return Promise.resolve(true);
    if (!fs.existsSync(path.join(UPLOAD_DIR, f))) return Promise.resolve(false);
    if (!stripPending.has(f)) {
      const out = stripOf(f), tmp = out + '.tmp.jpg', sel = idx.map(i => `eq(n\\,${i})`).join('+');
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-skip_frame', 'nokey', '-i', path.join(UPLOAD_DIR, f), '-an',
        '-vf', `select='${sel}',scale=128:72,tile=${idx.length}x1`, '-frames:v', '1', '-fps_mode', 'vfr', '-q:v', '5', tmp];
      const p = (chain = chain.then(() => run(args)).then(ok => { if (ok && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return true; } try { fs.unlinkSync(tmp); } catch { } return false; }))
        .finally(() => stripPending.delete(f));
      stripPending.set(f, p);
    }
    return stripPending.get(f);
  }
  // keys: tempos (ms) dos quadros-chave do arquivo
  function stripRoute(req, res, keys) {
    const f = path.basename(String(req.params.f || ''));
    if (!VIDEO.test(f)) return res.sendStatus(404);
    const end = (keys.at(-1) || 0) + 1000, idx = [];
    for (let i = 0; i < 10 && keys.length; i++) {
      const want = end * (i + 0.5) / 10; let best = 0;
      keys.forEach((t, k) => { if (Math.abs(t - want) < Math.abs(keys[best] - want)) best = k; });
      if (idx.at(-1) !== best) idx.push(best);
    }
    ensureStrip(f, idx).then(ok => {
      if (!ok) return res.sendStatus(404);
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.type('image/jpeg'); res.sendFile(stripOf(f));
    }, () => res.sendStatus(500));
  }
  // ---- fotos em WebP ----
  // Gera uma vez por tamanho (<arquivo>.w<lado>.webp, ao lado do original), numa fila própria de até 2 por vez (fotos levam
  // dezenas de ms; não esperam miniaturas de vídeo). Se a versão menor não ficar menor que o original (ícone já pequeno),
  // ou se o ffmpeg falhar, a rota manda para o original: a imagem sempre aparece.
  const imgOf = (f, sz) => path.join(UPLOAD_DIR, `${f}.w${sz}.webp`);
  const imgPending = new Map(); let imgRunning = 0; const imgQueue = [];
  const imgSlot = (job) => new Promise((res) => { const go = () => { imgRunning++; job().then(res, () => res(false)).finally(() => { imgRunning--; imgQueue.shift()?.(); }); }; imgRunning < 2 ? go() : imgQueue.push(go); });
  function ensureImg(f, sz) {
    const out = imgOf(f, sz), key = f + ':' + sz;
    if (fs.existsSync(out)) return Promise.resolve(fs.statSync(out).size > 0);
    const src = path.join(UPLOAD_DIR, f); if (!fs.existsSync(src)) return Promise.resolve(false);
    if (!imgPending.has(key)) imgPending.set(key, imgSlot(async () => {
      const tmp = out + '.tmp.webp';
      const ok = await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-frames:v', '1',
        '-vf', `scale='min(${sz},iw)':'min(${sz},ih)':force_original_aspect_ratio=decrease`, '-c:v', 'libwebp', '-quality', '78', '-compression_level', '4', tmp]);
      if (!ok || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { } return false; }
      if (fs.statSync(tmp).size >= fs.statSync(src).size) { fs.unlinkSync(tmp); fs.writeFileSync(out, ''); return false; } // não compensa: marca e usa o original
      fs.renameSync(tmp, out); return true;
    }).finally(() => imgPending.delete(key)));
    return imgPending.get(key);
  }
  function imageRoute(req, res, f) {
    const want = +req.query.s || 480, sz = SIZES.find(x => x >= want) || SIZES.at(-1);
    const original = () => res.redirect(301, `/files/${f}/imagem${path.extname(f)}`);
    ensureImg(f, sz).then(ok => {
      if (!ok) return original();
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.type('image/webp'); res.sendFile(imgOf(f, sz));
    }, original);
  }
  const remove = (f) => {
    f = path.basename(f); fs.unlink(thumbOf(f), () => { }); fs.unlink(stripOf(f), () => { });
    for (const sz of SIZES) fs.unlink(imgOf(f, sz), () => { });
  };
  return { route, ensure, remove, stripRoute };
}
