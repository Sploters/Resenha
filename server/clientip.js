// IP de quem fez o pedido, para os limites de tentativa (login, cadastro, QR Code).
// Atrás do Cloudflare Tunnel (ou outro proxy na mesma máquina), todo pedido chega do próprio proxy: o servidor via todo
// mundo com o mesmo IP, e 30 senhas erradas de UMA pessoa bloqueavam o login de TODAS por 15 minutos. O Cloudflare manda o
// IP de verdade no cabeçalho CF-Connecting-IP (e outros proxies no X-Forwarded-For / X-Real-IP).
// Só confia no cabeçalho quando a conexão vem da própria máquina ou da rede interna do Docker (onde roda o cloudflared):
// quem chega direto (VPN, internet) não consegue inventar outro IP mandando o cabeçalho.
import net from 'node:net';

const strip = (a) => String(a || '').replace(/^::ffff:/i, '');
export function isLocalProxy(addr) {
  const a = strip(addr);
  if (a === '::1' || /^127\./.test(a)) return true;
  // rede interna do Docker (172.16.0.0/12) e redes de contêiner comuns
  const m = /^172\.(\d+)\./.exec(a); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^(fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i.test(a)) return true;
  return false;
}
const header = (req) => {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xr = req.headers['x-real-ip']; if (xr) return String(xr).trim();
  const xf = req.headers['x-forwarded-for']; if (xf) return String(xf).split(',')[0].trim();
  return null;
};
export function clientIp(req) {
  const raw = req.socket?.remoteAddress || '?';
  if (!isLocalProxy(raw) || process.env.TRUST_PROXY === '0') return strip(raw) || '?';
  const h = header(req);
  return h && net.isIP(strip(h)) ? strip(h) : strip(raw) || '?';
}
