// Servidores ICE que o app recebe no READY (STUN e, se configurado, TURN).
// TURN serve para quem não alcança a voz direto: o servidor anuncia o IP da VPN e o IPv6 público (server/sfu.js), e a
// internet de casa tem CGNAT no IPv4. Quem alcança direto continua direto: o navegador só usa o TURN quando o caminho
// direto não funciona.
// Duas formas:
// - Cloudflare (TURN da Cloudflare Realtime): CF_TURN_KEY_ID e CF_TURN_API_TOKEN. O servidor pede credenciais
//   temporárias à API da Cloudflare (validade CF_TURN_TTL_H, padrão 48 h) e renova na metade do prazo. Todos recebem
//   a mesma credencial do momento; a chave da API nunca sai do servidor.
// - TURN próprio (coturn; docs/TURN.md): TURN_URL (um ou mais, separados por vírgula) e TURN_SECRET (static-auth-secret,
//   credencial temporária por pessoa) ou TURN_USER/TURN_PASS (fixos).
import crypto from 'node:crypto';

const STUN = { urls: 'stun:stun.l.google.com:19302' };
const urls = () => String(process.env.TURN_URL || '').split(',').map(s => s.trim()).filter(Boolean);

// credencial temporária no formato do coturn (TURN REST API): usuário "<expira em segundos>:<id>", senha = HMAC-SHA1
export function turnCredential(secret, id, now = Date.now(), ttlH = Number(process.env.TURN_TTL_H) || 48) {
  const username = `${Math.floor(now / 1000) + Math.round(ttlH * 3600)}:${id}`;
  return { username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') };
}

// ---------- Cloudflare ----------
let cf = null, cfTimer = null; // { servers: [...], at }
const cfOn = () => !!(process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN);
// resposta da API: { iceServers: [{ urls: [...], username?, credential? }, ...] } (ou um objeto só, na versão antiga)
export function cfServers(json) {
  const list = [].concat(json?.iceServers || []).filter(x => x && x.urls);
  const turn = list.filter(x => [].concat(x.urls).some(u => /^turns?:/.test(u)) && x.username && x.credential);
  return turn.length ? turn.map(x => ({ urls: [].concat(x.urls), username: x.username, credential: x.credential })) : null;
}
export async function refreshCf(fetchFn = globalThis.fetch) {
  if (!cfOn()) return false;
  const ttl = Math.round((Number(process.env.CF_TURN_TTL_H) || 48) * 3600);
  clearTimeout(cfTimer);
  try {
    const base = process.env.CF_TURN_API || 'https://rtc.live.cloudflare.com/v1/turn/keys';
    const r = await fetchFn(`${base}/${encodeURIComponent(process.env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { authorization: 'Bearer ' + process.env.CF_TURN_API_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const servers = cfServers(await r.json());
    if (!servers) throw new Error('resposta sem TURN');
    const first = !cf; cf = { servers, at: Date.now() };
    if (first) console.log('  TURN da Cloudflare: credenciais ok (' + servers.flatMap(x => x.urls).length + ' endereços)');
    cfTimer = setTimeout(() => refreshCf(fetchFn), ttl * 500); // renova na metade do prazo
    cfTimer.unref?.();
    return true;
  } catch (e) {
    console.log('  TURN da Cloudflare: não consegui as credenciais (' + e.message + '); tentando de novo em 5 min');
    cfTimer = setTimeout(() => refreshCf(fetchFn), 5 * 60e3); cfTimer.unref?.();
    return false;
  }
}

export function iceServers(uid) {
  const list = [STUN];
  if (cf) list.push(...cf.servers);
  const u = urls();
  if (!u.length) return list;
  if (process.env.TURN_SECRET) list.push({ urls: u, ...turnCredential(process.env.TURN_SECRET, uid || 'anon') });
  else list.push({ urls: u, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  return list;
}
