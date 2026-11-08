// Desempenho do servidor e do app de quem usa (sem serviço de fora):
// 1) Compressão das respostas JSON da API (Brotli ou Gzip, a partir de 1 KB). A interface (public/) já sai comprimida
//    pelo server/static.js; isto cobre a API (lista de mensagens, perfis, clipes…).
// 2) Rastreio das requisições: tempo de cada rota (agrupada: /api/channels/:id/messages), com mediana, p95 e máximo;
//    as lentas (> SLOW_MS) vão para <dados>/slow.log. É o papel do OpenTelemetry, sem precisar de coletor.
// 3) Velocidade real de quem usa (RUM): o app manda, uma vez por abertura, quanto demorou para ficar pronto, as Web
//    Vitals (LCP, CLS, INP) e as chamadas lentas; o servidor junta por tipo de aparelho.
// GET /api/perf (só o administrador da instalação) devolve tudo.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const SLOW_MS = +(process.env.SLOW_MS || 400);
const MIN_COMPRESS = 1024;

// "/api/channels/1794025582234002/messages" -> "/api/channels/:id/messages"
const routeOf = (url) => String(url).split('?')[0].replace(/\/\d{6,}(?=\/|$)/g, '/:id').replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:code');

// janela com as últimas amostras por chave (memória limitada)
class Stats {
  constructor(max = 300) { this.max = max; this.m = new Map(); }
  add(k, v) { let a = this.m.get(k); if (!a) this.m.set(k, a = { n: 0, s: [] }); a.n++; a.s.push(v); if (a.s.length > this.max) a.s.shift(); }
  dump() {
    const out = {};
    for (const [k, a] of this.m) { const s = [...a.s].sort((x, y) => x - y), q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
      out[k] = { n: a.n, p50: q(.5), p95: q(.95), max: +s[s.length - 1].toFixed(1) }; }
    return out;
  }
}

export function mountPerf(app, { auth, wrap, bad, isAdmin, dataDir }) {
  const routes = new Stats(), rum = new Stats(500);
  const slowLog = path.join(dataDir, 'slow.log');
  const logSlow = (line) => fs.appendFile(slowLog, `${new Date().toISOString()} ${line}\n`, () => { });

  app.use('/api', (req, res, next) => {
    const t0 = process.hrtime.bigint();
    // compressão: troca res.json para comprimir quando vale a pena e o navegador aceita
    const ae = String(req.headers['accept-encoding'] || '');
    const json = res.json.bind(res);
    res.json = (body) => {
      const raw = Buffer.from(JSON.stringify(body));
      if (raw.length < MIN_COMPRESS || res.headersSent) return json(body);
      res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (/\bbr\b/.test(ae)) { res.setHeader('Content-Encoding', 'br'); return res.end(zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })); }
      if (/\bgzip\b/.test(ae)) { res.setHeader('Content-Encoding', 'gzip'); return res.end(zlib.gzipSync(raw, { level: 5 })); }
      return res.end(raw);
    };
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6, r = req.method + ' ' + routeOf(req.originalUrl);
      routes.add(r, ms);
      if (ms > SLOW_MS && !/\/(files|download)\b/.test(r)) logSlow(`${Math.round(ms)}ms ${r} ${res.statusCode}`);
    });
    next();
  });

  // RUM: o app manda as medidas da abertura; valores fora do razoável são descartados
  const ok = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  app.post('/api/rum', auth, wrap((req, res) => {
    const b = req.body || {}, dev = ['desktop', 'mobile', 'app'].includes(b.device) ? b.device : 'desktop';
    for (const [k, max] of [['ready', 120e3], ['lcp', 120e3], ['fcp', 120e3], ['inp', 30e3], ['ttfb', 60e3]]) if (ok(b[k], max)) rum.add(`${dev} ${k}`, b[k]);
    if (ok(b.cls, 10)) rum.add(`${dev} cls`, b.cls * 1000); // em milésimos
    for (const a of Array.isArray(b.api) ? b.api.slice(0, 20) : []) if (a && ok(a.ms, 120e3) && typeof a.r === 'string') rum.add(`${dev} api ${routeOf(a.r).slice(0, 80)}`, a.ms);
    res.json({});
  }));

  app.get('/api/perf', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    let slow = ''; try { slow = fs.readFileSync(slowLog, 'utf8').trim().split('\n').slice(-50).join('\n'); } catch { }
    res.json({ servidor_ms: routes.dump(), usuarios_ms: rum.dump(), lentas: slow, slow_ms: SLOW_MS, memoria_mb: Math.round(process.memoryUsage().rss / 2 ** 20), ligado_ha_min: Math.round(process.uptime() / 60) });
  }));
}
