// Alertas para o administrador da instalação (um lugar só para todos os módulos: desempenho, saúde do servidor, SFU):
// aviso no app dele (se estiver aberto) e, com ALERT_WEBHOOK, no celular: tópico do ntfy (https://ntfy.sh/<tópico>) ou
// webhook de canal do Discord. Cada chave avisa no máximo uma vez por `every` (padrão 15 min).
let notifyAdmin = () => { };
export const setAlertTarget = (fn) => { notifyAdmin = fn; };
const last = new Map(), recent = [];
export const recentAlerts = () => recent.slice();
export function sendAlert(key, text, { title = 'Resenha: alerta do servidor', tag = 'warning', every = 15 * 60e3, emoji = '⚠️' } = {}) {
  const now = Date.now(); if (now - (last.get(key) || 0) < every) return false; last.set(key, now);
  recent.push({ at: now, key, text }); if (recent.length > 50) recent.shift();
  console.log('  ALERTA:', text);
  try { notifyAdmin(text); } catch { }
  const hook = process.env.ALERT_WEBHOOK; if (!hook) return true;
  const discord = /discord(app)?\.com\/api\/webhooks\//.test(hook);
  fetch(hook, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': discord ? 'application/json' : 'text/plain; charset=utf-8', ...(discord ? {} : { Title: title, Tags: tag }) },
    body: discord ? JSON.stringify({ content: `${emoji} Resenha: ${text}`.slice(0, 1900) }) : text }).catch(() => { });
  return true;
}
