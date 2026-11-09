// Envio retomável (arquivos grandes, internet de celular): o arquivo sobe em pedaços e, se a conexão cair, o app pergunta
// quanto já chegou e continua dali — não recomeça do zero. Mesmo limite de tamanho do envio normal (MAX_UPLOAD_MB).
//   POST   /api/uploads              { name, size, type } -> { id, chunk, received: 0 }
//   GET    /api/uploads/:id          -> { received, size }
//   PUT    /api/uploads/:id?offset=N corpo bruto (até `chunk` bytes) -> { received }; offset diferente do que já chegou: 409 { received }
//   POST   /api/uploads/:id/finish   -> igual ao /api/upload: { url, name, size, type }
//   DELETE /api/uploads/:id          cancela
// Os pedaços ficam em <uploads>/.parts/<id>.part (+ .json com dono, nome e tamanho). Envio parado há 24 h é apagado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CHUNK = 8 * 1024 * 1024, TTL = 24 * 3600e3;

export function mountUploads(app, { auth, wrap, bad, clean, uploadDir, maxUpload, finalize }) {
  const dir = path.join(uploadDir, '.parts'); fs.mkdirSync(dir, { recursive: true });
  const metaOf = (id) => path.join(dir, id + '.json'), partOf = (id) => path.join(dir, id + '.part');
  const load = (req, res) => {
    const id = String(req.params.id || ''); if (!/^[a-f0-9]{32}$/.test(id)) { bad(res, 'Envio não encontrado', 404); return null; }
    let m; try { m = JSON.parse(fs.readFileSync(metaOf(id), 'utf8')); } catch { bad(res, 'Envio não encontrado (pode ter expirado)', 404); return null; }
    if (m.uid !== req.uid) { bad(res, 'Envio não encontrado', 404); return null; }
    let received = 0; try { received = fs.statSync(partOf(id)).size; } catch { }
    return { id, m, received };
  };
  const drop = (id) => { fs.unlink(metaOf(id), () => { }); fs.unlink(partOf(id), () => { }); };
  const busy = new Set(); // um pedaço por vez em cada envio

  app.post('/api/uploads', auth, wrap((req, res) => {
    const size = Math.floor(+req.body?.size || 0), name = clean(req.body?.name, 200).replace(/[\\/\0]/g, '_') || 'arquivo';
    if (!(size > 0)) return bad(res, 'Tamanho inválido');
    if (size > maxUpload) return bad(res, `Arquivo muito grande (limite de ${Math.round(maxUpload / 1048576)} MB)`, 413);
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(metaOf(id), JSON.stringify({ uid: req.uid, name, size, type: clean(req.body?.type, 100), at: Date.now() }));
    fs.writeFileSync(partOf(id), '');
    res.json({ id, chunk: CHUNK, received: 0 });
  }));
  app.get('/api/uploads/:id', auth, wrap((req, res) => { const u = load(req, res); if (u) res.json({ received: u.received, size: u.m.size }); }));
  app.put('/api/uploads/:id', auth, (req, res) => {
    const u = load(req, res); if (!u) return req.resume();
    const off = +req.query.offset;
    if (busy.has(u.id)) { req.resume(); return res.status(409).json({ error: 'Pedaço em andamento', received: u.received }); }
    if (off !== u.received) { req.resume(); return res.status(409).json({ error: 'Posição diferente', received: u.received }); }
    const len = +req.headers['content-length'];
    if (!(len > 0) || len > CHUNK || u.received + len > u.m.size) { req.resume(); return bad(res, 'Pedaço inválido'); }
    busy.add(u.id);
    const fd = fs.openSync(partOf(u.id), 'r+'); let pos = u.received, failed = false;
    const done = (ok) => {
      if (!busy.has(u.id)) return; busy.delete(u.id);
      try { if (!ok) fs.ftruncateSync(fd, u.received); } catch { } try { fs.closeSync(fd); } catch { } // pedaço pela metade: volta ao começo dele
      if (res.headersSent) return;
      if (ok) { fs.utimes(metaOf(u.id), new Date(), new Date(), () => { }); res.json({ received: pos }); } else bad(res, 'Pedaço incompleto', 400);
    };
    req.on('data', (c) => { if (failed) return; if (pos + c.length - u.received > len) { failed = true; return; } try { fs.writeSync(fd, c, 0, c.length, pos); pos += c.length; } catch { failed = true; } });
    req.on('end', () => done(!failed && pos - u.received === len));
    req.on('close', () => { if (!req.complete) done(false); });
    req.on('error', () => done(false));
  });
  app.post('/api/uploads/:id/finish', auth, wrap((req, res) => {
    const u = load(req, res); if (!u) return;
    if (busy.has(u.id)) return bad(res, 'Pedaço em andamento', 409);
    if (u.received !== u.m.size) return res.status(409).json({ error: 'Envio incompleto', received: u.received });
    const ext = path.extname(u.m.name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const fname = crypto.randomBytes(12).toString('hex') + ext;
    fs.renameSync(partOf(u.id), path.join(uploadDir, fname)); fs.unlink(metaOf(u.id), () => { });
    finalize(fname, u.m.name, u.m.size, u.m.type).then((r) => res.json(r), () => bad(res, 'Falha ao concluir o envio', 500));
  }));
  app.delete('/api/uploads/:id', auth, wrap((req, res) => { const u = load(req, res); if (!u) return; drop(u.id); res.json({}); }));

  const sweep = () => {
    try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); try { if (Date.now() - fs.statSync(p).mtimeMs > TTL) fs.unlinkSync(p); } catch { } } } catch { }
  };
  sweep(); setInterval(sweep, 3600e3).unref?.();
}
