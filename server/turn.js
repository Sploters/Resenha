// Servidores ICE que o app recebe no READY (STUN e, se configurado, TURN).
// TURN serve para quem não alcança a porta da voz (40000) direto: o servidor anuncia só o IP da VPN e, com CGNAT na
// internet de casa, a porta não abre no roteador. Um TURN numa máquina com IP público que esteja na mesma VPN repassa a
// mídia até o SFU (passo a passo: docs/TURN.md). Quem alcança direto (VPN ligada) continua direto: o navegador só usa o
// TURN quando o caminho direto não funciona.
// - TURN_URL: um ou mais endereços separados por vírgula (ex.: turn:1.2.3.4:3478?transport=udp,turn:1.2.3.4:443?transport=tcp)
// - TURN_SECRET (recomendado): o mesmo static-auth-secret do coturn (use-auth-secret). Cada pessoa recebe usuário e senha
//   temporários (TURN_TTL_H horas, padrão 48), que valem só para ela; vazar um não dá acesso permanente ao TURN.
// - TURN_USER / TURN_PASS: usuário e senha fixos (o mesmo para todos), para servidores TURN sem use-auth-secret.
import crypto from 'node:crypto';

const STUN = { urls: 'stun:stun.l.google.com:19302' };
const urls = () => String(process.env.TURN_URL || '').split(',').map(s => s.trim()).filter(Boolean);

// credencial temporária no formato do coturn (TURN REST API): usuário "<expira em segundos>:<id>", senha = HMAC-SHA1
export function turnCredential(secret, id, now = Date.now(), ttlH = Number(process.env.TURN_TTL_H) || 48) {
  const username = `${Math.floor(now / 1000) + Math.round(ttlH * 3600)}:${id}`;
  return { username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') };
}

export function iceServers(uid) {
  const list = [STUN], u = urls();
  if (!u.length) return list;
  if (process.env.TURN_SECRET) list.push({ urls: u, ...turnCredential(process.env.TURN_SECRET, uid || 'anon') });
  else list.push({ urls: u, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  return list;
}
