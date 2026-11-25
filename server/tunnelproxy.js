// /voz-tunel no app: confere o login (como o /gateway) e encaminha a conexão inteira para o servidor do túnel da voz
// (server/voztunnel.js, no processo da voz), com o id da pessoa assinado. Depois do encaminhamento os bytes passam
// direto entre as duas pontas (sem passar por mensagens entre processos a cada pacote de voz).
// Onde fica o servidor do túnel: processo da voz separado -> LC_TUNNEL_PORT/LC_TUNNEL_KEY (server/voz.js passa ao app);
// app sozinho (desenvolvimento, testes) -> abre o servidor do túnel aqui mesmo na primeira conexão.
import net from 'node:net';
import { sfuSplit } from './sfuapi.js';

let target = null;
async function tunnelTarget() {
  if (target) return target;
  if (sfuSplit) {
    if (!process.env.LC_TUNNEL_PORT || !process.env.LC_TUNNEL_KEY) return null;
    return (target = { port: +process.env.LC_TUNNEL_PORT, key: process.env.LC_TUNNEL_KEY });
  }
  const { startTunnelServer } = await import('./voztunnel.js');
  return (target = startTunnelServer().catch(() => { target = null; return null; }));
}

export async function pipeTunnel(req, socket, head, uid, { noVideo = false } = {}) {
  const tg = await tunnelTarget();
  if (!tg || socket.destroyed) { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return socket.destroy(); }
  const { tunnelSig } = await import('./voztunnel.js');
  const up = net.connect(tg.port, '127.0.0.1');
  up.setNoDelay(true); socket.setNoDelay(true);
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (!/^x-lc-/i.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  lines.push(`x-lc-uid: ${uid}`, `x-lc-sig: ${tunnelSig(tg.key, uid)}`, `x-lc-novideo: ${noVideo ? 1 : 0}`);
  up.write(lines.join('\r\n') + '\r\n\r\n');
  if (head?.length) up.write(head);
  up.pipe(socket); socket.pipe(up);
  const end = () => { up.destroy(); socket.destroy(); };
  up.on('error', end); socket.on('error', end); up.on('close', end); socket.on('close', end);
}
