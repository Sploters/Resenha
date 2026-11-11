// Cifra/decifra cada quadro de áudio e vídeo das chamadas protegidas (conversa direta com criptografia de ponta a ponta).
// Roda num worker, fora da tela, ligado a cada envio/recebimento do WebRTC (RTCRtpScriptTransform ou, nos navegadores
// mais antigos, createEncodedStreams). A chave vem pronta do app (CryptoKey AES-GCM não exportável, public/e2ee.js).
// Quadro cifrado: [primeiros bytes em claro][cifrado + etiqueta GCM][iv 12 bytes][0xE2]
// Os primeiros bytes ficam em claro (como no Jitsi/LiveKit) para o navegador e o servidor reconhecerem quadro-chave e
// camadas do VP8 (10 bytes no quadro-chave, 3 nos outros) e o cabeçalho do Opus (1 byte); entram como dados autenticados.
// Quadro que não abre (adulterado, chave errada, sem cifra) é descartado: nunca toca/mostra mídia sem proteção.
const MAGIC = 0xE2, TAIL = 12 + 1, TAG = 16;
const stats = { enc: 0, dec: 0, bad: 0 };
const clearBytes = (f) => (f.type === undefined ? 1 : f.type === 'key' ? 10 : 3); // áudio não tem "type"

function transformer(op, key) {
  return new TransformStream({
    async transform(frame, ctl) {
      const d = new Uint8Array(frame.data);
      if (!d.length) return ctl.enqueue(frame); // quadro vazio (silêncio do Opus): não há o que esconder
      try {
        if (op === 'enc') {
          const n = Math.min(clearBytes(frame), d.length), iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: d.subarray(0, n) }, key, d.subarray(n)));
          const out = new Uint8Array(n + ct.length + TAIL);
          out.set(d.subarray(0, n)); out.set(ct, n); out.set(iv, n + ct.length); out[out.length - 1] = MAGIC;
          frame.data = out.buffer; stats.enc++;
        } else {
          if (d.length < TAG + TAIL || d[d.length - 1] !== MAGIC) { stats.bad++; return; }
          const plainLen = d.length - TAG - TAIL, n = Math.min(clearBytes(frame), plainLen);
          const iv = d.subarray(d.length - TAIL, d.length - 1);
          const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: d.subarray(0, n) }, key, d.subarray(n, d.length - TAIL)));
          const out = new Uint8Array(n + pt.length); out.set(d.subarray(0, n)); out.set(pt, n);
          frame.data = out.buffer; stats.dec++;
        }
        ctl.enqueue(frame);
      } catch { stats.bad++; }
    },
  });
}
const run = (op, key, readable, writable) => readable.pipeThrough(transformer(op, key)).pipeTo(writable).catch(() => { });
self.onrtctransform = (e) => { const t = e.transformer; run(t.options.op, t.options.key, t.readable, t.writable); };
self.onmessage = (e) => { const { op, key, readable, writable } = e.data || {}; if (readable && writable) run(op, key, readable, writable); };
setInterval(() => self.postMessage({ stats }), 1000);
