// Voz pelo túnel: o WebSocket /voz-tunel (o caminho da voz para quem não alcança a mídia direto; ver sfuTunnelAttach em
// server/sfu.js). Roda onde o SFU roda (processo da voz, server/voz.js; ou o próprio app sem ele, em testes), num servidor
// só em 127.0.0.1. Quem atende a internet é o app (server/index.js): confere o login e encaminha a conexão para cá com o
// id da pessoa assinado (server/tunnelproxy.js). Aqui só entra conexão com a assinatura certa.
//
// Protocolo (tudo pequeno, para caber bem no túnel):
//   app -> servidor  texto  {"t":"attach","cid":"..."}   entra na sala (a pessoa já entrou pelo gateway: VOICE_JOIN)
//                    texto  {"t":"off","on":true}         ensurdecido: as vozes param de chegar
//                    texto  {"t":"ping","n":1}
//                    texto  {"t":"vstart","source":"screen","codec":"vp8"|"h264","ssrc":123}  começa a mandar vídeo
//                    texto  {"t":"stop","source":"screen"}  parou de mandar (cam, screen, screenaudio)
//                    texto  {"t":"pause","slot":3,"on":false}  assiste (ou não) o que chega naquele slot
//                    texto  {"t":"key","slot":3}           o vídeo que chega quebrou: pede um quadro-chave
//                    binário [1][carimbo uint32][Opus]     20 ms do microfone (carimbo em amostras de 48 kHz)
//                    binário [5][carimbo uint32][Opus]     20 ms do áudio da transmissão (estéreo)
//                    binário [4][fonte 1=cam 2=tela]([tamanho uint16][pacote RTP])...  vídeo, um quadro (ou pedaço)
//   servidor -> app  texto  {"t":"ready"} | {"t":"error","msg"} | {"t":"detached"} | {"t":"pong","n"}
//                    texto  {"t":"add","slot","uid","source","kind","codec"} | {"t":"del","slot"}
//                    texto  {"t":"vstarted","source","ok"} | {"t":"key","source"}  (quem assiste pediu quadro-chave)
//                    binário [2][slot][seq uint16][carimbo uint32][Opus]
//                    binário [3][slot][pacote RTP]         vídeo
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { sfuTunnelAttach } from './sfu.js';

export const tunnelSig = (key, uid) => crypto.createHmac('sha256', key).update('voz-tunel:' + uid).digest('hex');
// quem não dá conta de receber: descarta em vez de acumular atraso. O vídeo cede antes da voz (o app pede um quadro-chave
// quando falta pedaço)
const SLOW = 384 * 1024, SLOW_V = 160 * 1024;

export function startTunnelServer() {
  const key = crypto.randomBytes(32).toString('hex');
  const srv = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 });
  srv.on('upgrade', (req, socket, head) => {
    const uid = String(req.headers['x-lc-uid'] || ''), sig = String(req.headers['x-lc-sig'] || '');
    const want = tunnelSig(key, uid);
    if (!uid || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    const noVideo = String(req.headers['x-lc-novideo'] || '') === '1';
    wss.handleUpgrade(req, socket, head, (ws) => onConn(ws, uid, noVideo));
  });
  return new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, key, close: () => srv.close() })); });
}

const SRC = { 1: 'cam', 2: 'screen' };
function onConn(ws, uid, noVideo) {
  let h = null, cid = null, busy = false;
  const sendJ = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const out = {
    add: (slot, u, source, kind, codec) => sendJ({ t: 'add', slot, uid: u, source, kind, codec }),
    del: (slot) => sendJ({ t: 'del', slot }),
    frame: (slot, seq, ts, payload) => {
      if (ws.readyState !== 1 || ws.bufferedAmount > SLOW) return;
      const b = Buffer.allocUnsafe(8 + payload.length);
      b[0] = 2; b[1] = slot; b.writeUInt16BE(seq, 2); b.writeUInt32BE(ts >>> 0, 4); payload.copy(b, 8);
      ws.send(b);
    },
    rtp: (slot, pkt) => {
      if (ws.readyState !== 1 || ws.bufferedAmount > SLOW_V) return;
      const b = Buffer.allocUnsafe(2 + pkt.length); b[0] = 3; b[1] = slot; pkt.copy(b, 2);
      ws.send(b);
    },
    key: (source) => sendJ({ t: 'key', source }),
    closed: () => { h = null; sendJ({ t: 'detached' }); }, // a pessoa saiu da sala no SFU (ou ele refez a sala): o app entra de novo
  };
  ws.on('message', async (data, isBin) => {
    if (isBin) {
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!h || b.length < 2) return;
      if (b[0] === 1 || b[0] === 5) { if (b.length > 5) h.audio(b[0] === 1 ? 'mic' : 'screenaudio', b.readUInt32BE(1), b.subarray(5)); return; }
      if (b[0] === 4 && SRC[b[1]]) {
        for (let o = 2; o + 2 <= b.length;) { const n = b.readUInt16BE(o); o += 2; if (o + n > b.length) break; h.vrtp(SRC[b[1]], b.subarray(o, o + n)); o += n; }
      }
      return;
    }
    let m; try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'ping') return sendJ({ t: 'pong', n: m.n });
    if (m.t === 'off') return h?.setOff(!!m.on);
    if (m.t === 'pause') return h?.pause(m.slot | 0, !!m.on);
    if (m.t === 'key') return h?.key(m.slot | 0);
    if (m.t === 'stop') return h?.stop(String(m.source || ''));
    if (m.t === 'vstart') { const ok = h ? await h.vstart(String(m.source || ''), String(m.codec || ''), Number(m.ssrc)) : false; return sendJ({ t: 'vstarted', source: m.source, ok }); }
    if (m.t === 'attach' && !busy) {
      busy = true; h?.close(); h = null; cid = String(m.cid || '');
      try { h = await sfuTunnelAttach(cid, uid, out, { noVideo }); if (m.off) h.setOff(true); sendJ({ t: 'ready' }); }
      catch (e) { sendJ({ t: 'error', msg: e.message }); }
      finally { busy = false; }
      if (ws.readyState !== 1) { h?.close(); h = null; }
    }
  });
  ws.on('close', () => { h?.close(); h = null; });
  ws.on('error', () => { });
}
