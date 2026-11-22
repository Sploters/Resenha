// Log estruturado do servidor: nível + hora + componente + mensagem (+ campos), com segredos escondidos.
// - log('health').info('texto', { campo: 1 }) escreve no console no formato de sempre ("  [health] texto campo=1") ou,
//   com LOG_FORMAT=json, uma linha JSON por evento ({ t, lvl, c, msg, ...campos }) para quem junta logs (Loki, journald).
// - Guarda os últimos RING (500) em memória (recentLogs) para o diagnóstico do administrador (GET /api/health/diag).
// - captureConsole(): o console.log/warn/error do resto do servidor também entra no anel (a saída não muda).
// - redact(): esconde senha, token, cookie, chave, assinatura e cabeçalho Authorization (pelo nome do campo e por padrões
//   no texto: "Bearer …", JWT, ?token=…); com { ips: true } também troca o fim dos IPs (203.0.113.x), para o diagnóstico
//   que o administrador manda para alguém.
const RING = 500, MAX_TEXT = 1000;
const ring = [];
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = () => LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 20;
const SECRET_KEY = /pass(word)?|senha|token|secret|segredo|cookie|authori[sz]ation|api[-_]?key|private|sig(nature)?$|^key$|credential/i;
const HIDDEN = '[oculto]';

// troca o último pedaço do IP (IPv4: último número; IPv6: os últimos 4 grupos)
const maskIps = (s) => s
  .replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, '$1.x')
  .replace(/\b((?:[0-9a-f]{1,4}:){3}[0-9a-f]{1,4})(?::[0-9a-f]{0,4}){1,4}\b/gi, '$1:x');
export function redactText(s, { ips = false } = {}) {
  let t = String(s)
    .replace(/\b(Bearer|Basic|Token)\s+[\w.~+/=-]{6,}/gi, '$1 ' + HIDDEN)
    .replace(/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, HIDDEN) // JWT
    .replace(/([?&;\s"'](?:token|access_token|key|password|senha|secret|sig|code)=)[^&\s"';]+/gi, '$1' + HIDDEN)
    .replace(/("?(?:password|senha|token|secret|cookie|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"' + HIDDEN + '"')
    .replace(/\b(gh[pousr]_|github_pat_)[\w]{10,}/g, HIDDEN); // chave do GitHub
  if (ips) t = maskIps(t);
  return t;
}
// cópia do objeto com os segredos escondidos (campos com nome de segredo, e os textos passam por redactText)
export function redact(v, opt = {}, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return redactText(v, opt);
  if (v instanceof Error) return redactText(v.stack || v.message, opt);
  if (depth > 8) return '[…]';
  if (Array.isArray(v)) return v.map(x => redact(x, opt, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) && x != null && x !== '' && typeof x !== 'boolean' ? HIDDEN : redact(x, opt, depth + 1);
    return o;
  }
  return String(v);
}

const fmtField = (v) => (typeof v === 'string' ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v));
function push(e) { ring.push(e); if (ring.length > RING) ring.shift(); }
const toText = (a) => a.map(x => (x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ');

export function log(component) {
  const emit = (lvl, msg, fields) => {
    const e = { t: new Date().toISOString(), lvl, c: component, msg: redactText(msg).slice(0, MAX_TEXT), ...(fields ? redact(fields) : {}) };
    push(e);
    if (LEVELS[lvl] < minLevel()) return e;
    // console de agora (o do health.js guarda os erros); capturing: não entra de novo no anel pelo captureConsole
    const out = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    capturing++;
    try {
      if (process.env.LOG_FORMAT === 'json') out(JSON.stringify(e));
      else out(`  [${component}]${lvl === 'info' ? '' : ' ' + lvl.toUpperCase()} ${e.msg}${fields ? ' ' + Object.entries(e).slice(4).map(([k, v]) => `${k}=${fmtField(v)}`).join(' ') : ''}`);
    } finally { capturing--; }
    return e;
  };
  return { debug: (m, f) => emit('debug', m, f), info: (m, f) => emit('info', m, f), warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f) };
}

// console.* do resto do servidor também vai para o anel (com segredos escondidos); a saída no terminal não muda
let captured = false, capturing = 0;
export function captureConsole() {
  if (captured) return; captured = true;
  for (const [k, lvl] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      if (!capturing) try { push({ t: new Date().toISOString(), lvl, c: 'console', msg: redactText(toText(a)).trim().slice(0, MAX_TEXT) }); } catch { }
      orig(...a);
    };
  }
}
export const recentLogs = (n = RING) => ring.slice(-n);
