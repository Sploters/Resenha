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
CREATE TABLE IF NOT EXISTS ux_meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ux_first(h TEXT NOT NULL, step TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(h, step)) WITHOUT ROWID;
`);

// fluxos com começo e fim, para o funil: quantos começam e quantos terminam
export const UX_FLOWS = { e2ee: 'Ativar a criptografia', mymsgs: 'Apagar minhas mensagens', lfg_post: 'Criar anúncio em Jogos', add_server: 'Criar ou entrar num servidor' };
// tempos medidos no app, em faixas (guardamos só quantos caíram em cada faixa; o painel estima mediana e pior caso)
export const UX_TIMINGS = { channel_switch: 'Trocar de canal ou conversa', msg_send: 'Mandar mensagem (até o servidor confirmar)', voice_connect: 'Entrar na voz', ws_offline: 'Tempo desconectado' };
export const UX_BUCKETS = [100, 250, 500, 1000, 2500, 5000, Infinity]; // faixa i: até UX_BUCKETS[i] ms
// primeiros passos de quem é novo, na ordem do funil
export const UX_CALL_ISSUES = { audio_cut: 'Áudio cortando', echo: 'Eco ou chiado', lag: 'Atraso', video: 'Vídeo ou tela travando', cant_hear: 'Não ouvia as pessoas', not_heard: 'Não me ouviam', other: 'Outro' };
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
  // avaliação depois de uma chamada (pergunta rara: ~5% das chamadas, no máximo 1 vez por semana por pessoa)
  call_rating: (d) => /^(shown|good|bad|ignored)$/.test(d),
  call_issue: (d) => Object.hasOwn(UX_CALL_ISSUES, d),
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

export function mountUx(app, { auth, wrap, bad, isAdmin, prefsOf = () => ({}), sendDigest = () => { } }) {
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

  // resumo da semana: o painel mostra no topo; toda segunda (a partir das 9 h, hora do servidor) vai para o administrador
  // no app e, com UX_DIGEST_WEBHOOK (ou ALERT_WEBHOOK), no celular. "Enviar agora" no painel manda na hora.
  app.get('/api/ux/digest', auth, wrap((req, res) => { if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403); res.json(buildDigest()); }));
  app.post('/api/ux/digest/send', auth, wrap((req, res) => { if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403); const d = buildDigest(); sendDigest(d); res.json(d); }));
  const weekly = () => {
    if (!UX_ENABLED()) return;
    const now = new Date(); if (now.getDay() !== 1 || now.getHours() < 9) return; // segunda-feira, 9 h
    const wk = day(now.getTime()); if (get("SELECT v FROM ux_meta WHERE k='digest_day'")?.v === wk) return;
    run("INSERT INTO ux_meta(k,v) VALUES('digest_day',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", wk);
    try { sendDigest(buildDigest()); } catch (e) { console.error('resumo da semana', e); }
  };
  setInterval(weekly, 30 * 60e3).unref(); setTimeout(weekly, 60e3).unref();

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
    const cr = eventos.call_rating?.detalhes || {}, good = cr.good?.total || 0, badN = cr.bad?.total || 0, shown = cr.shown?.total || 0;
    // quase ninguém aperta 👍 (quem não teve problema só fecha): a medida honesta é "das chamadas perguntadas, em quantas
    // relataram problema" (fechar/ignorar = sem problema relatado). A taxa de boas entre quem respondeu fica só de apoio
    const chamadas = { perguntas: shown, responderam: good + badN, boas: good, ruins: badN, taxa_problema: shown ? Math.round((Math.min(badN, shown) / shown) * 100) : null, taxa_boas: good + badN ? Math.round((good / (good + badN)) * 100) : null,
      problemas: Object.entries(eventos.call_issue?.detalhes || {}).map(([k, v]) => ({ k, nome: UX_CALL_ISSUES[k] || k, n: v.total })) };
    res.json({ desde: since, dias: days, guarda_dias: UX_KEEP_DAYS, ligado: UX_ENABLED(), minimo_grupo: min, versao: version, versoes, faixas_ms: UX_BUCKETS.map(x => (x === Infinity ? null : x)), eventos, funis, tempos, chamadas, por_dia, pessoas: people(since) });
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

// ---------- resumo da semana: últimos 7 dias comparados com os 7 anteriores ----------
// Cada linha tem um tom: 'bom' (melhorou), 'ruim' (piorou ou precisa de atenção) ou 'neutro'. Só entra o que tem dado.
export function buildDigest(now = Date.now()) {
  const d = (k) => day(now - k * 86400e3), A = [d(6), d(0)], B = [d(13), d(7)]; // semana atual e a anterior (dias inclusivos)
  const sum = (ev, [a, b], detail) => get(`SELECT COALESCE(SUM(n),0) n FROM ux_daily WHERE event=? AND day BETWEEN ? AND ?${detail ? ' AND detail=?' : ''}`, ev, a, b, ...(detail ? [detail] : [])).n;
  const distinct = ([a, b]) => get('SELECT COUNT(DISTINCT h) n FROM ux_seen WHERE day BETWEEN ? AND ?', a, b).n;
  const nf = (n) => Number(n).toLocaleString('pt-BR'), arrow = (a, b) => (b ? ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% vs. semana anterior)` : '');
  const fmtMs = (v) => (v === Infinity ? 'mais de 5 s' : v >= 1000 ? (v / 1000).toLocaleString('pt-BR') + ' s' : v + ' ms');
  const L = [];
  // pessoas
  const act = distinct(A), actB = distinct(B);
  if (act || actB) L.push({ tipo: 'pessoas', tom: actB && act < actB * 0.85 ? 'ruim' : actB && act > actB * 1.1 ? 'bom' : 'neutro', texto: `${nf(act)} ${act === 1 ? 'pessoa usou' : 'pessoas usaram'} o app${arrow(act, actB)}.` });
  const novos = get('SELECT COUNT(*) n FROM ux_user WHERE cohort BETWEEN ? AND ?', ...A).n;
  if (novos) {
    const msg = get("SELECT COUNT(*) n FROM ux_first f JOIN ux_user u ON u.h=f.h WHERE u.cohort BETWEEN ? AND ? AND f.step='message'", ...A).n, p = Math.round((msg / novos) * 100);
    L.push({ tipo: 'novos', tom: p < 50 ? 'ruim' : 'neutro', texto: `${nf(novos)} ${novos === 1 ? 'conta nova' : 'contas novas'}; ${p}% mandaram a 1ª mensagem.` });
  }
  // erros: total e os que apareceram pela primeira vez nesta semana
  const err = sum('js_error', A), errB = sum('js_error', B);
  const fresh = all(`SELECT detail, SUM(n) n FROM ux_daily WHERE event='js_error' AND day BETWEEN ? AND ? AND detail NOT IN (SELECT detail FROM ux_daily WHERE event='js_error' AND day < ?) GROUP BY detail ORDER BY n DESC LIMIT 3`, ...A, A[0]);
  if (err || errB) L.push({ tipo: 'erros', tom: err > errB ? 'ruim' : err < errB ? 'bom' : 'neutro', texto: `${nf(err)} ${err === 1 ? 'erro do app' : 'erros do app'}${arrow(err, errB)}.` + (fresh.length ? ` Novos: ${fresh.map(f => `"${f.detail}" (${f.n})`).join('; ')}.` : '') });
  // tempos: só com medições suficientes nas duas semanas
  for (const [m, nome] of [['channel_switch', 'abrir um canal'], ['msg_send', 'mandar mensagem'], ['voice_connect', 'entrar na voz']]) {
    const counts = (w) => { const c = Array(UX_BUCKETS.length).fill(0); for (const r of all("SELECT detail, SUM(n) n FROM ux_daily WHERE event='timing' AND detail LIKE ? AND day BETWEEN ? AND ? GROUP BY detail", m + ':%', ...w)) c[+r.detail.split(':')[1]] += r.n; return quantiles(c); };
    const q = counts(A), qB = counts(B); if (!q || q.n < 5) continue;
    const worse = qB && qB.n >= 5 && q.p95 > qB.p95, better = qB && qB.n >= 5 && q.p95 < qB.p95;
    L.push({ tipo: 'tempo', tom: worse ? 'ruim' : better ? 'bom' : 'neutro', texto: `Para ${nome}: metade até ${fmtMs(q.p50)}, 95% até ${fmtMs(q.p95)}` + (qB && qB.n >= 5 && q.p95 !== qB.p95 ? ` (antes 95% até ${fmtMs(qB.p95)}).` : '.') });
  }
  // chamadas
  // (problemas relatados sobre as chamadas perguntadas: quem não teve problema costuma só fechar o cartão)
  const asked = sum('call_rating', A, 'shown'), b = sum('call_rating', A, 'bad'), askedB = sum('call_rating', B, 'shown'), bB = sum('call_rating', B, 'bad');
  if (asked >= 3) {
    const top = get("SELECT detail, SUM(n) n FROM ux_daily WHERE event='call_issue' AND day BETWEEN ? AND ? GROUP BY detail ORDER BY n DESC LIMIT 1", ...A);
    const p = Math.round((Math.min(b, asked) / asked) * 100), pB = askedB >= 3 ? Math.round((Math.min(bB, askedB) / askedB) * 100) : null;
    L.push({ tipo: 'chamadas', tom: p >= 15 || (pB != null && p > pB + 5) ? 'ruim' : pB != null && p < pB - 5 ? 'bom' : 'neutro',
      texto: `Chamadas: problema relatado em ${p}% das ${nf(asked)} perguntadas` + (pB != null ? ` (antes ${pB}%)` : '') + (top ? `; mais citado: ${UX_CALL_ISSUES[top.detail] || top.detail}.` : '.') });
  }
  // fluxos que caíram 10 pontos ou mais
  for (const [k, nome] of Object.entries(UX_FLOWS)) {
    const rate = (w) => { const st = sum('flow', w, k + ':start'), dn = sum('flow', w, k + ':done'); return st >= 3 ? Math.round(Math.min(1, dn / st) * 100) : null; };
    const r = rate(A), rB = rate(B);
    if (r != null && rB != null && rB - r >= 10) L.push({ tipo: 'fluxo', tom: 'ruim', texto: `"${nome}": ${r}% terminam (eram ${rB}%).` });
  }
  // o que mais irrita
  const rage = get("SELECT detail, SUM(n) n FROM ux_daily WHERE event='rage_click' AND day BETWEEN ? AND ? GROUP BY detail ORDER BY n DESC LIMIT 1", ...A);
  if (rage?.n >= 3) L.push({ tipo: 'cliques', tom: 'ruim', texto: `Mais cliques com raiva em: ${rage.detail} (${rage.n}).` });
  const de = A[0], ate = A[1], ruins = L.filter(x => x.tom === 'ruim').length;
  const titulo = !L.length ? 'Semana sem dados ainda.' : ruins ? `${ruins} ${ruins === 1 ? 'ponto pede' : 'pontos pedem'} atenção.` : 'Tudo em ordem nesta semana.';
  return { de, ate, titulo, linhas: L, texto: `Resumo da semana (${de} a ${ate}): ${titulo}\n` + L.map(x => (x.tom === 'ruim' ? '⚠️ ' : x.tom === 'bom' ? '✅ ' : '• ') + x.texto).join('\n') };
}
