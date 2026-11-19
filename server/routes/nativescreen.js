// Transmissão nativa (programa de captura do app desktop, até 120 FPS): sessão por pessoa no SFU e rotas do pacote de
// teste. Devolve natives/endNative/startNative/nativeOut, usados pelo gateway e pelas permissões de vídeo das salas.
import { sfuEnabled, sfuAttachNative } from '../sfu.js';

export function mountNativeScreen(app, d) {
  const { auth, bad, dispatch, currentVoice } = d;
  // ---- transmissão nativa (teste de 120 FPS): gera um código com IP, porta UDP e ssrc; o programa de captura no PC
  // manda o H.264 para lá. O app de quem gerou assiste a própria transmissão pelo servidor e mede os FPS. ----
  const natives = new Map(); // uid -> sessão
  function endNative(uid, why) {
    const n = natives.get(uid); if (process.env.DEBUG_NATIVE) console.log('endNative', uid, why, n?.producer.id); if (!n) return;
    natives.delete(uid); clearInterval(n.timer); n.close();
    dispatch([uid], 'NATIVE_SCREEN_END', { producer_id: n.producer.id, reason: why });
  }
  // live: transmissão de verdade (o programa repete o último quadro com a tela parada, então 6 s sem pacotes = parou)
  // test: o pacote de teste (código colado à mão): até 10 min para começar e no máximo 30 min
  async function startNative(uid, cid, live, layers = 1) {
    endNative(uid, 'replaced');
    const n = await sfuAttachNative(cid, uid, layers);
    n.host = process.env.RTC_ANNOUNCED_IP ? process.env.RTC_ANNOUNCED_IP.split(',')[0].trim() : (n.ip && n.ip !== '0.0.0.0' ? n.ip : null);
    n.started = 0; n.last = 0; n.bytes = 0; n.t0 = Date.now();
    n.timer = setInterval(async () => {
      if (n.producer.closed) return endNative(uid, 'closed');
      const st = await n.producer.getStats().catch(() => []), b = st.reduce((x, e) => x + (e.byteCount || 0), 0), now = Date.now();
      if (b > n.bytes) {
        n.bytes = b; n.last = now;
        // primeiros pacotes: o app de quem transmite fica sabendo que a porta UDP está aberta (sem isso ele volta ao Chromium)
        if (!n.started) { n.started = now; if (live) dispatch([uid], 'NATIVE_SCREEN_LIVE', { producer_id: n.producer.id }); }
      }
      if (!n.started && now - n.t0 > (live ? 60_000 : 10 * 60_000)) endNative(uid, 'timeout');
      else if (n.started && now - n.last > 6000) endNative(uid, 'stopped');
      else if (!live && now - n.t0 > 30 * 60_000) endNative(uid, 'limit');
    }, 2000);
    natives.set(uid, n); if (process.env.DEBUG_NATIVE) console.log('startNative', uid, n.producer.id);
    n.producer.observer.on('close', () => { if (natives.get(uid) === n) endNative(uid, 'closed'); });
    return n;
  }
  const nativeOut = (n, host) => ({ producer_id: n.producer.id, host: n.host || host, port: n.port, ssrc: n.ssrc, ssrcs: n.ssrcs, pt: n.payloadType, key: n.key, serverKey: n.serverKey });
  app.post('/api/native-screen', auth, (req, res) => (async () => {
    const cid = currentVoice(req.uid);
    if (!cid) return bad(res, 'Entre numa sala de voz primeiro');
    if (!sfuEnabled()) return bad(res, 'O servidor de voz (SFU) está desligado');
    const o = nativeOut(await startNative(req.uid, cid, false), req.hostname);
    res.json({ ...o, code: `LC120 ${o.host} ${o.port} ${o.ssrc} ${o.pt} ${o.key} ${o.serverKey}` });
  })().catch(e => { console.error('native-screen', e); if (!res.headersSent) bad(res, 'Não consegui preparar a transmissão: ' + e.message, 500); }));
  app.post('/api/native-screen/stop', auth, (req, res) => { endNative(req.uid, 'stopped'); res.json({ ok: true }); });
  return { natives, endNative, startNative, nativeOut };
}
