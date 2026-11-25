// Voz pelo túnel: o WebSocket /voz-tunel (o caminho da voz para quem não alcança a mídia direto; ver sfuTunnelAttach em
// server/sfu.js). Roda onde o SFU roda (processo da voz, server/voz.js; ou o próprio app sem ele, em testes), num servidor
// só em 127.0.0.1. Quem atende a internet é o app (server/index.js): confere o login e encaminha a conexão para cá com o
// id da pessoa assinado (server/tunnelproxy.js). Aqui só entra conexão com a assinatura certa.
//
// Protocolo (tudo pequeno, para caber bem no túnel):
//   app -> servidor  texto  {"t":"attach","cid":"..."}   entra na sala (a pessoa já entrou pelo gateway: VOICE_JOIN)
//                    texto  {"t":"off","on":true}         ensurdecido: as vozes param de chegar
//                    texto  {"t":"ping","n":1}
//                    binário [1][carimbo uint32][Opus]     20 ms do microfone (carimbo em amostras de 48 kHz)
//   servidor -> app  texto  {"t":"ready"} | {"t":"error","msg"} | {"t":"detached"} | {"t":"pong","n"}
//                    texto  {"t":"add","slot","uid","source"} | {"t":"del","slot"}
//                    binário [2][slot][seq uint16][carimbo uint32][Opus]
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { sfuTunnelAttach } from './sfu.js';

export const tunnelSig = (key, uid) => crypto.createHmac('sha256', key).update('voz-tunel:' + uid).digest('hex');
const SLOW = 128 * 1024; // quem não dá conta de receber: descarta voz em vez de acumular atraso

export function startTunnelServer() {
  const key = crypto.randomBytes(32).toString('hex');
  const srv = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 });
  srv.on('upgrade', (req, socket, head) => {
    const uid = String(req.headers['x-lc-uid'] || ''), sig = String(req.headers['x-lc-sig'] || '');
    const want = tunnelSig(key, uid);
    if (!uid || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => onConn(ws, uid));
  });
  return new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, key, close: () => srv.close() })); });
}

function onConn(ws, uid) {
  let h = null, cid = null, busy = false;
  const sendJ = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const out = {
    add: (slot, u, source) => sendJ({ t: 'add', slot, uid: u, source }),
    del: (slot) => sendJ({ t: 'del', slot }),
    frame: (slot, seq, ts, payload) => {
      if (ws.readyState !== 1 || ws.bufferedAmount > SLOW) return;
      const b = Buffer.allocUnsafe(8 + payload.length);
      b[0] = 2; b[1] = slot; b.writeUInt16BE(seq, 2); b.writeUInt32BE(ts >>> 0, 4); payload.copy(b, 8);
      ws.send(b);
    },
    closed: () => { h = null; sendJ({ t: 'detached' }); }, // a pessoa saiu da sala no SFU (ou ele refez a sala): o app entra de novo
  };
  ws.on('message', async (data, isBin) => {
    if (isBin) {
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (b.length > 5 && b[0] === 1 && h) h.audio(b.readUInt32BE(1), b.subarray(5));
      return;
    }
    let m; try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'ping') return sendJ({ t: 'pong', n: m.n });
    if (m.t === 'off') return h?.setOff(!!m.on);
    if (m.t === 'attach' && !busy) {
      busy = true; h?.close(); h = null; cid = String(m.cid || '');
      try { h = await sfuTunnelAttach(cid, uid, out); if (m.off) h.setOff(true); sendJ({ t: 'ready' }); }
      catch (e) { sendJ({ t: 'error', msg: e.message }); }
      finally { busy = false; }
      if (ws.readyState !== 1) { h?.close(); h = null; }
    }
  });
  ws.on('close', () => { h?.close(); h = null; });
  ws.on('error', () => { });
}
