// Telemetria de UX (etapa 1), sem serviço de fora: o app conta o que as pessoas fazem em alguns pontos escolhidos
// (como voltam para Amigos, quais abas de Jogos usam, quais ⓘ abrem, o que buscam nas Configurações e não acham) e manda
// os totais de vez em quando. Aqui só guardamos CONTAGENS por dia, tipo de aparelho, evento e detalhe: nada de quem fez,
// nada de conteúdo de mensagem. Cada pessoa pode desligar em Privacidade e segurança. Fica 60 dias e some.
// GET /api/ux (só o administrador da instalação) devolve os totais.
import { db, all, run } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS ux_daily(day TEXT NOT NULL, device TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, device, event, detail))`);

export const UX_KEEP_DAYS = 60;
// eventos aceitos e o detalhe permitido de cada um (o que não casa é descartado: o app não consegue mandar outra coisa)
const free = (max) => (d) => d.length <= max;
export const UX_EVENTS = {
  back_to_friends: (d) => /^(esc|rail)$/.test(d), // saiu de uma conversa direta para Amigos: pelo Esc ou pelo ícone de Mensagens
  games_open: (d) => d === '', // abriu a seção Jogos pela barra
  games_tab: (d) => /^(lfg|home|news|tournaments)$/.test(d), // trocou de aba dentro de Jogos
  info_tip: free(80), // abriu (clicou ou parou o mouse em cima) a explicação ⓘ: "Página › opção"
  settings_search_empty: free(40), // busca nas Configurações que não achou nada (o termo, em minúsculas)
};
const DEVICES = ['desktop', 'mobile', 'app'];
const MAX_PER_POST = 100, MAX_N = 200; // um envio normal tem poucos eventos; números absurdos são descartados

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export function cleanUx(now = Date.now()) { run('DELETE FROM ux_daily WHERE day < ?', day(now - UX_KEEP_DAYS * 86400e3)); }

export function mountUx(app, { auth, wrap, bad, isAdmin }) {
  cleanUx(); setInterval(cleanUx, 6 * 3600e3).unref();
  const add = db.prepare('INSERT INTO ux_daily(day,device,event,detail,n) VALUES(?,?,?,?,?) ON CONFLICT(day,device,event,detail) DO UPDATE SET n = n + excluded.n');
  app.post('/api/ux', auth, wrap((req, res) => {
    const b = req.body || {}, dev = DEVICES.includes(b.device) ? b.device : 'desktop', today = day();
    let kept = 0;
    db.exec('BEGIN');
    try {
      for (const x of Array.isArray(b.events) ? b.events.slice(0, MAX_PER_POST) : []) {
        const ev = String(x?.e ?? ''), d = String(x?.d ?? '').replace(/\s+/g, ' ').trim(), n = x?.n;
        if (!Object.hasOwn(UX_EVENTS, ev) || !UX_EVENTS[ev](d) || !Number.isInteger(n) || n < 1 || n > MAX_N) continue;
        add.run(today, dev, ev, d, n); kept++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ kept });
  }));
  // totais: por evento e detalhe (mais usados primeiro), separados por aparelho, e a série por dia
  app.get('/api/ux', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    const days = Math.min(UX_KEEP_DAYS, Math.max(1, +req.query.days || 30)), since = day(Date.now() - (days - 1) * 86400e3);
    const rows = all('SELECT event, detail, device, SUM(n) n FROM ux_daily WHERE day >= ? GROUP BY event, detail, device', since);
    const eventos = {};
    for (const r of rows) {
      const e = (eventos[r.event] ||= { total: 0, detalhes: {} }), d = (e.detalhes[r.detail || '-'] ||= { total: 0 });
      e.total += r.n; d.total += r.n; d[r.device] = r.n;
    }
    for (const e of Object.values(eventos)) e.detalhes = Object.fromEntries(Object.entries(e.detalhes).sort((a, b) => b[1].total - a[1].total));
    const por_dia = all('SELECT day, event, SUM(n) n FROM ux_daily WHERE day >= ? GROUP BY day, event ORDER BY day', since);
    res.json({ desde: since, dias: days, guarda_dias: UX_KEEP_DAYS, eventos, por_dia });
  }));
}
