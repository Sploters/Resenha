// Telemetria de UX, sem serviço de fora. Duas fontes:
// 1) O app conta o que acontece em pontos escolhidos (public/ux.js) e manda os totais de vez em quando: como as pessoas
//    voltam aos Amigos, abas de Jogos, ⓘ abertas, buscas sem resultado, funis, cliques com raiva/sem efeito, erros, tempos
//    (troca de canal, envio, voz, reconexão) e navegação (idas e voltas, menus abandonados). Guardamos só CONTAGENS por dia,
//    versão do app, aparelho, evento e detalhe: nada de quem fez, nada de mensagem.
// 2) O servidor marca, uma vez por dia, que uma pessoa usou o app e os primeiros passos de quem é novo (pôs avatar,
//    adicionou amigo, mandou mensagem, entrou na voz) para contar ativos, retenção e o funil do usuário novo. A pessoa é
//    guardada como um código embaralhado (hash com um segredo deste servidor), nunca o id nem o nome; o painel só mostra totais.
// Quem desliga "Enviar estatísticas de uso" em Privacidade fica de fora das duas. UX_TELEMETRY=0 desliga tudo no servidor.
// Tudo some depois de 60 dias. GET /api/ux (só o administrador da instalação) devolve os totais; o painel fica em
// Configurações → Administração → Estatísticas de uso (public/uxstats.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, all, get, run, DATA_DIR } from './db.js';

export const UX_KEEP_DAYS = 60;
export const UX_ENABLED = () => process.env.UX_TELEMETRY !== '0';
const MIN_COUNT = () => Math.max(1, +(process.env.UX_MIN_COUNT || 5)); // grupos pequenos: detalhe com menos que isto vira "outros"

// tabela de contagens com a versão do app na chave (a da etapa 1 não tinha: é recriada com os dados antigos em versão '')
{
  const cols = all("SELECT name FROM pragma_table_info('ux_daily')").map(c => c.name);
  if (cols.length && !cols.includes('version')) {
    db.exec(`ALTER TABLE ux_daily RENAME TO ux_daily_old`);
    db.exec(`CREATE TABLE ux_daily(day TEXT NOT NULL, version TEXT NOT NULL DEFAULT '', device TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, version, device, event, detail))`);
    db.exec(`INSERT INTO ux_daily(day,version,device,event,detail,n) SELECT day,'',device,event,detail,n FROM ux_daily_old; DROP TABLE ux_daily_old`);
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS ux_daily(day TEXT NOT NULL, version TEXT NOT NULL DEFAULT '', device TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, version, device, event, detail));
CREATE TABLE IF NOT EXISTS ux_seen(day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY(day, h)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ux_user(h TEXT PRIMARY KEY, cohort TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ux_first(h TEXT NOT NULL, step TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(h, step)) WITHOUT ROWID;
`);

// fluxos com começo e fim, para o funil: quantos começam e quantos terminam
export const UX_FLOWS = { e2ee: 'Ativar a criptografia', mymsgs: 'Apagar minhas mensagens', lfg_post: 'Criar anúncio em Jogos', add_server: 'Criar ou entrar num servidor' };
// tempos medidos no app, em faixas (guardamos só quantos caíram em cada faixa; o painel estima mediana e pior caso)
export const UX_TIMINGS = { channel_switch: 'Trocar de canal ou conversa', msg_send: 'Mandar mensagem (até o servidor confirmar)', voice_connect: 'Entrar na voz', ws_offline: 'Tempo desconectado' };
export const UX_BUCKETS = [100, 250, 500, 1000, 2500, 5000, Infinity]; // faixa i: até UX_BUCKETS[i] ms
// primeiros passos de quem é novo, na ordem do funil
export const UX_STEPS = { avatar: 'Pôs uma foto', friend: 'Fez um amigo', message: 'Mandou a 1ª mensagem', voice: 'Entrou na voz' };

const free = (max) => (d) => d.length <= max;
const FLOW_RE = new RegExp(`^(${Object.keys(UX_FLOWS).join('|')}):(start|done)$`), TIMING_RE = new RegExp(`^(${Object.keys(UX_TIMINGS).join('|')}):[0-${UX_BUCKETS.length - 1}]$`);
// eventos aceitos e o detalhe permitido de cada um (o que não casa é descartado: o app não consegue mandar outra coisa)
export const UX_EVENTS = {
  back_to_friends: (d) => /^(esc|rail)$/.test(d), // saiu de uma conversa direta para Amigos: pelo Esc ou pelo ícone de Mensagens
  games_open: (d) => d === '', // abriu a seção Jogos pela barra
  games_tab: (d) => /^(lfg|home|news|tournaments)$/.test(d), // trocou de aba dentro de Jogos
  info_tip: free(80), // abriu a explicação ⓘ: "Página › opção"
  settings_search_empty: free(40), // busca nas Configurações que não achou nada (o termo, em minúsculas)
  flow: (d) => FLOW_RE.test(d), // começou / terminou um fluxo (funil)
  rage_click: free(80), // 3+ cliques rápidos no mesmo lugar: "área › botão"
  dead_click: free(80), // clique em algo com cara de botão que não mudou nada na tela em 1 s
  js_error: free(140), // erro de JavaScript: "mensagem @ arquivo:linha" (números, aspas e endereços trocados por marcadores)
  error_shown: free(100), // aviso de erro mostrado na tela (o texto, sem números)
  timing: (d) => TIMING_RE.test(d), // "métrica:faixa"
  voice_fail: (d) => /^[a-z_]{1,24}$/.test(d), // não conseguiu entrar na voz: motivo
  ws_reconnect: (d) => d === '', // a conexão em tempo real caiu e voltou
  u_turn: free(60), // foi de A para B e voltou para A em menos de 3 s: "A → B"
  quick_exit: free(80), // abriu uma página das Configurações e saiu em menos de 2 s
  menu_open: free(80), menu_abandoned: free(80), // menu aberto / fechado sem escolher nada: "área › botão"
};
// detalhes que podem conter algo digitado ou um nome: no painel, só aparecem com pelo menos MIN_COUNT ocorrências
const SENSITIVE = new Set(['settings_search_empty', 'error_shown']);
const DEVICES = ['desktop', 'mobile', 'app'];
const MAX_PER_POST = 100, MAX_N = 200; // um envio normal tem poucos eventos; números absurdos são descartados

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export function cleanUx(now = Date.now()) {
  const old = day(now - UX_KEEP_DAYS * 86400e3);
  run('DELETE FROM ux_daily WHERE day < ?', old); run('DELETE FROM ux_seen WHERE day < ?', old);
  run('DELETE FROM ux_first WHERE h IN (SELECT h FROM ux_user WHERE cohort < ?)', old); run('DELETE FROM ux_user WHERE cohort < ?', old);
  run('DELETE FROM ux_first WHERE day < ? AND h NOT IN (SELECT h FROM ux_user)', old);
}

// ---------- pessoas (servidor): ativos, novos, primeiros passos ----------
// segredo deste servidor para embaralhar o id: sem ele não dá para voltar do código para a pessoa
let SALT = null;
function salt() {
  if (SALT) return SALT;
  const f = path.join(DATA_DIR, 'ux-salt');
  try { SALT = fs.readFileSync(f, 'utf8').trim(); } catch { }
  if (!SALT) { SALT = crypto.randomBytes(32).toString('hex'); try { fs.writeFileSync(f, SALT, { mode: 0o600 }); } catch { } }
  return SALT;
}
const hashOf = (uid) => crypto.createHash('sha256').update(salt() + ':' + uid).digest('hex').slice(0, 20);
let optedOut = () => false; // definido no mountUx (lê a preferência da conta)
const seenToday = new Set(); let seenDay = '';
// chamado quando a pessoa conecta (abre o app): no máximo uma gravação por pessoa por dia
export function uxSeen(uid) {
  if (!UX_ENABLED() || !uid) return;
  const d = day(); if (d !== seenDay) { seenDay = d; seenToday.clear(); }
  if (seenToday.has(uid)) return; seenToday.add(uid);
  if (optedOut(uid)) return;
  run('INSERT OR IGNORE INTO ux_seen(day,h) VALUES(?,?)', d, hashOf(uid));
}
// conta criada agora: começa uma "turma" (o dia do cadastro) para o funil e a retenção
export function uxSignup(uid) {
  if (!UX_ENABLED() || !uid) return;
  const h = hashOf(uid); run('INSERT OR IGNORE INTO ux_user(h,cohort) VALUES(?,?)', h, day()); run('INSERT OR IGNORE INTO ux_seen(day,h) VALUES(?,?)', day(), h);
}
const firstDone = new Set(); // "uid:passo" já gravado (evita ir ao banco a cada mensagem)
export function uxFirst(uid, step) {
  if (!UX_ENABLED() || !uid || !UX_STEPS[step]) return;
  const k = uid + ':' + step; if (firstDone.has(k)) return; firstDone.add(k);
  if (firstDone.size > 50000) firstDone.clear();
  if (optedOut(uid)) return;
  const h = hashOf(uid); if (!get('SELECT 1 x FROM ux_user WHERE h=?', h)) return; // só quem se cadastrou depois de ligar a telemetria
  run('INSERT OR IGNORE INTO ux_first(h,step,day) VALUES(?,?,?)', h, step, day());
}

// mediana e pior caso (p95) aproximados a partir das faixas: o limite de cima da faixa onde o percentil cai
function quantiles(counts) {
  const total = counts.reduce((a, b) => a + b, 0); if (!total) return null;
  const at = (p) => { let acc = 0; for (let i = 0; i < counts.length; i++) { acc += counts[i]; if (acc >= p * total) return UX_BUCKETS[i]; } return Infinity; };
  return { n: total, p50: at(0.5), p95: at(0.95), faixas: counts };
}

export function mountUx(app, { auth, wrap, bad, isAdmin, prefsOf = () => ({}) }) {
  optedOut = (uid) => { try { return prefsOf(uid)?.uxStats === false; } catch { return false; } };
  cleanUx(); setInterval(cleanUx, 6 * 3600e3).unref();
  const add = db.prepare('INSERT INTO ux_daily(day,version,device,event,detail,n) VALUES(?,?,?,?,?,?) ON CONFLICT(day,version,device,event,detail) DO UPDATE SET n = n + excluded.n');
  app.post('/api/ux', auth, wrap((req, res) => {
    if (!UX_ENABLED()) return res.json({ kept: 0, disabled: true }); // o app para de juntar eventos
    const b = req.body || {}, dev = DEVICES.includes(b.device) ? b.device : 'desktop', today = day();
    const ver = typeof b.version === 'string' && /^[\w.-]{1,24}$/.test(b.version) ? b.version : '';
    let kept = 0;
    db.exec('BEGIN');
    try {
      for (const x of Array.isArray(b.events) ? b.events.slice(0, MAX_PER_POST) : []) {
        const ev = String(x?.e ?? ''), d = String(x?.d ?? '').replace(/\s+/g, ' ').trim(), n = x?.n;
        if (!Object.hasOwn(UX_EVENTS, ev) || !UX_EVENTS[ev](d) || !Number.isInteger(n) || n < 1 || n > MAX_N) continue;
        add.run(today, ver, dev, ev, d, n); kept++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ kept });
  }));
  // o app pergunta se mostra o painel (sem dar 403 para todo mundo) e se a coleta está ligada no servidor
  app.get('/api/ux/access', auth, wrap((req, res) => res.json({ admin: !!isAdmin(req.uid), enabled: UX_ENABLED() })));

  app.get('/api/ux', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    const days = Math.min(UX_KEEP_DAYS, Math.max(1, +req.query.days || 30)), since = day(Date.now() - (days - 1) * 86400e3);
    const version = typeof req.query.version === 'string' && req.query.version ? req.query.version.slice(0, 24) : null;
    const vWhere = version ? ' AND version = ?' : '', vArgs = version ? [version] : [];
    // versões vistas no período (a mais nova primeiro), com o primeiro e o último dia em que apareceram
    const versoes = all("SELECT version, MIN(day) desde, MAX(day) ate, SUM(n) n FROM ux_daily WHERE day >= ? AND version <> '' GROUP BY version ORDER BY desde DESC", since);
    const rows = all(`SELECT event, detail, device, SUM(n) n FROM ux_daily WHERE day >= ?${vWhere} GROUP BY event, detail, device`, since, ...vArgs);
    const eventos = {};
    for (const r of rows) {
      const e = (eventos[r.event] ||= { total: 0, detalhes: {} }), d = (e.detalhes[r.detail || '-'] ||= { total: 0 });
      e.total += r.n; d.total += r.n; d[r.device] = r.n;
    }
    const min = MIN_COUNT();
    for (const [k, e] of Object.entries(eventos)) {
      let list = Object.entries(e.detalhes).sort((a, b) => b[1].total - a[1].total);
      if (SENSITIVE.has(k)) { // grupos pequenos: o que apareceu poucas vezes pode apontar uma pessoa
        const few = list.filter(([, v]) => v.total < min);
        list = list.filter(([, v]) => v.total >= min);
        if (few.length) list.push([`(outros: ${few.length} com menos de ${min} cada)`, { total: few.reduce((n, [, v]) => n + v.total, 0), escondido: true }]);
      }
      e.detalhes = Object.fromEntries(list);
    }
    const funis = Object.fromEntries(Object.entries(UX_FLOWS).map(([k, nome]) => {
      const st = eventos.flow?.detalhes?.[k + ':start']?.total || 0, dn = eventos.flow?.detalhes?.[k + ':done']?.total || 0;
      return [k, { nome, comecaram: st, terminaram: dn, taxa: st ? Math.round(Math.min(1, dn / st) * 100) : null }];
    }));
    // tempos: por métrica e aparelho, mediana e p95 aproximados
    const tempos = {};
    for (const r of all(`SELECT detail, device, SUM(n) n FROM ux_daily WHERE event='timing' AND day >= ?${vWhere} GROUP BY detail, device`, since, ...vArgs)) {
      const [m, b] = r.detail.split(':'), t = (tempos[m] ||= { nome: UX_TIMINGS[m] || m, todos: Array(UX_BUCKETS.length).fill(0), aparelhos: {} });
      t.todos[+b] += r.n; (t.aparelhos[r.device] ||= Array(UX_BUCKETS.length).fill(0))[+b] += r.n;
    }
    for (const t of Object.values(tempos)) { t.geral = quantiles(t.todos); for (const [k, v] of Object.entries(t.aparelhos)) t.aparelhos[k] = quantiles(v); delete t.todos; }
    const por_dia = all(`SELECT day, event, SUM(n) n FROM ux_daily WHERE day >= ?${vWhere} GROUP BY day, event ORDER BY day`, since, ...vArgs);
    res.json({ desde: since, dias: days, guarda_dias: UX_KEEP_DAYS, ligado: UX_ENABLED(), minimo_grupo: min, versao: version, versoes, faixas_ms: UX_BUCKETS.map(x => (x === Infinity ? null : x)), eventos, funis, tempos, por_dia, pessoas: people(since) });
  }));
}

// ativos (hoje, 7 e 30 dias), ativos por dia, retenção (D1, D7, D30) e funil de quem se cadastrou no período
function people(since) {
  const today = day(), cnt = (from) => get('SELECT COUNT(DISTINCT h) n FROM ux_seen WHERE day >= ?', from).n;
  const ativos = { hoje: get('SELECT COUNT(*) n FROM ux_seen WHERE day = ?', today).n, d7: cnt(day(Date.now() - 6 * 86400e3)), d30: cnt(day(Date.now() - 29 * 86400e3)) };
  const por_dia = all('SELECT day, COUNT(*) n FROM ux_seen WHERE day >= ? GROUP BY day ORDER BY day', since);
  // retenção: dos que se cadastraram há tempo suficiente, quantos voltaram no dia seguinte / na 2ª semana / no 2º mês
  const ret = (from, to) => {
    const r = get(`SELECT COUNT(*) elegiveis, SUM(EXISTS(SELECT 1 FROM ux_seen s WHERE s.h = u.h AND s.day BETWEEN date(u.cohort, '+${from} day') AND date(u.cohort, '+${to} day'))) voltaram
      FROM ux_user u WHERE u.cohort IS NOT NULL AND u.cohort >= ? AND date(u.cohort, '+${from} day') <= ?`, since, today);
    return { elegiveis: r.elegiveis, voltaram: r.voltaram || 0, taxa: r.elegiveis ? Math.round(((r.voltaram || 0) / r.elegiveis) * 100) : null };
  };
  const retencao = { d1: ret(1, 1), d7: ret(7, 13), d30: ret(30, 36) };
  // funil do usuário novo
  const novos = get('SELECT COUNT(*) n FROM ux_user WHERE cohort >= ?', since).n;
  const passos = Object.entries(UX_STEPS).map(([k, nome]) => ({ passo: k, nome, n: get('SELECT COUNT(*) n FROM ux_first f JOIN ux_user u ON u.h = f.h WHERE u.cohort >= ? AND f.step = ?', since, k).n }));
  passos.push({ passo: 'returned', nome: 'Voltou outro dia', n: get('SELECT COUNT(*) n FROM ux_user u WHERE u.cohort >= ? AND EXISTS(SELECT 1 FROM ux_seen s WHERE s.h = u.h AND s.day > u.cohort)', since).n });
  return { ativos, por_dia, retencao, novos, funil_novos: passos };
}
