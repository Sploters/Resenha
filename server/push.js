// Aviso no celular pelo ntfy (https://ntfy.sh): cada pessoa escolhe um tópico próprio em Configurações → Notificações
// (prefs.pushTopic, guardado nas preferências da conta) e assina esse tópico no app do ntfy (Android/iPhone).
//
// Só os avisos que importam: "Bora?" (chamaram a turma, formou, começou) e convite direto para a chamada. Regras:
// - só quando a pessoa NÃO está com o Resenha aberto (no app ela já recebe o aviso na tela);
// - Não perturbe: nada;
// - cada tipo pode ser desligado (prefs.pushBora, prefs.pushInvites; ligados por padrão quando há tópico);
// - orçamento: no máximo PER_DAY avisos por pessoa a cada 24 h (o convite direto não conta: é para ela);
// - o servidor do ntfy é o da instalação (NTFY_URL, padrão https://ntfy.sh): a pessoa não escolhe endereço (o servidor
//   do Resenha não faz pedido para um endereço qualquer digitado por alguém).
// O conteúdo passa pelo servidor do ntfy: o texto é curto (quem, o jogo, a sala) e o tópico, aleatório, é a senha.
export const PER_DAY = 8;
export const TOPIC_RE = /^[A-Za-z0-9_-]{12,64}$/;

export function createPush({ prefsOf, isOnline, statusOf = () => 'online', publicUrl = () => process.env.PUBLIC_URL, log = console.log, now = () => Date.now(), fetchFn = (...a) => fetch(...a) }) {
  const base = () => String(process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '');
  const sent = new Map(); // uid -> [instantes] das últimas 24 h
  const budgetOk = (uid) => { const t = now(), list = (sent.get(uid) || []).filter(x => t - x < 864e5); sent.set(uid, list); return list.length < PER_DAY; };
  // publicação em JSON (POST na raiz do servidor do ntfy): título e texto em UTF-8, sem os limites de cabeçalho HTTP
  async function post(topic, { title, body, click, tags, priority }) {
    const r = await fetchFn(base() + '/', { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title: String(title || 'Resenha').slice(0, 120), message: String(body || '').slice(0, 400), ...(tags ? { tags: String(tags).split(',') } : {}), ...(priority ? { priority } : {}), ...(click ? { click } : {}) }) });
    if (!r.ok) throw new Error('ntfy respondeu ' + r.status);
  }
  const clickUrl = (path) => { const u = publicUrl(); return u ? String(u).replace(/\/+$/, '') + (path || '/') : undefined; }; // endereço oficial (server/siteurl.js)
  return {
    // kind: 'bora' | 'invite'. Devolve true se mandou.
    send(uid, kind, msg) {
      const p = prefsOf(uid) || {}, topic = p.pushTopic;
      if (!topic || !TOPIC_RE.test(String(topic))) return false;
      if (kind === 'bora' && p.pushBora === false) return false;
      if (kind === 'invite' && p.pushInvites === false) return false;
      if (isOnline(uid) || statusOf(uid) === 'dnd') return false;
      if (kind !== 'invite' && !budgetOk(uid)) return false;
      if (kind !== 'invite') sent.get(uid).push(now());
      post(topic, { ...msg, click: msg.click || clickUrl(msg.path) }).catch(e => log(`[celular] aviso não enviado: ${e.message}`));
      return true;
    },
    // botão "Testar" das Configurações: manda na hora (sem as regras acima); erro volta para a pessoa ver
    test(uid, topic) {
      if (!TOPIC_RE.test(String(topic || ''))) return Promise.reject(new Error('Tópico inválido: use de 12 a 64 letras, números, - ou _'));
      return post(topic, { title: 'Resenha', body: 'Pronto! Os avisos do Resenha vão chegar aqui.', tags: 'tada', click: clickUrl('/') });
    },
    server: base,
  };
}
