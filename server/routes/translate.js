// Rotas da tradução de mensagens (o motor fica em server/translate.js).
import { translate, translateEnabled, engineName } from '../translate.js';

export function mountTranslate(app, d) {
  const { auth, wrap, bad } = d;
  // Tradução
  const trRate = new Map();
  app.get('/api/translate/info', auth, (req, res) => res.json({ enabled: translateEnabled, engine: engineName }));
  app.post('/api/translate', auth, wrap(async (req, res) => {
    if (!translateEnabled) return bad(res, 'Tradução desativada neste servidor', 403);
    const now = Date.now(), hits = (trRate.get(req.uid) || []).filter(t => now - t < 60000);
    if (hits.length >= 40) return bad(res, 'Muitas traduções seguidas, aguarde um pouco', 429);
    hits.push(now); trRate.set(req.uid, hits);
    try { res.json(await translate(req.body.text, String(req.body.to || ''), req.body.from ? String(req.body.from) : '')); }
    catch (e) { bad(res, e.message, 502); }
  }));
}
