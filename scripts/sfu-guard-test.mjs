// SFU no servidor, direto pelo gateway (sem navegador):
// 1) duas entradas seguidas na mesma sala: a 1ª, ao terminar depois da 2ª, não pode tirar do SFU o par da 2ª
//    (antes: o "saiu enquanto entrava" chamava sfuLeave e a pessoa ficava na sala sem mídia: "fora da sala")
// 2) mutado pela moderação, refazer a mídia (SFU_REJOIN) não devolve a voz: o microfone novo nasce pausado no servidor
// 3) a fonte define o tipo: vídeo marcado como 'mic' é recusado (driblava a permissão Vídeo da sala)
// Uso: node scripts/sfu-guard-test.mjs
import WebSocket from 'ws';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('sfuguard', 3408, 41370);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };

// cliente do gateway: guarda as mensagens, espera por tipo e faz pedidos ao SFU (rid -> resposta)
function client(tok) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), msgs = [], waiters = [];
  let rid = 0; const pend = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw); msgs.push(m);
    if (m.t === 'SFU_RES' && pend.has(m.d.rid)) { pend.get(m.d.rid)(m.d); pend.delete(m.d.rid); }
    for (const w of [...waiters]) if (w.f(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (f, ms = 8000) => new Promise((res) => { const hit = msgs.find(f); if (hit) return res(hit); const w = { f, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms); });
  const send = (t, d) => ws.send(JSON.stringify({ t, d }));
  const sfu = (op, d = {}) => new Promise((res) => { const r = ++rid; pend.set(r, res); send('SFU', { op, rid: r, ...d }); setTimeout(() => { if (pend.delete(r)) res({ error: 'sem resposta' }); }, 8000); });
  return { ws, msgs, wait, send, sfu, open: new Promise(r => ws.on('open', r)) };
}
const OPUS = (ssrc) => ({ codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 } }], encodings: [{ ssrc }] });
const VP8 = (ssrc) => ({ codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }], encodings: [{ ssrc }] });

const dono = await reg('dono'), bia = await reg('bia');
const g = await call(dono.tok, 'POST', '/guilds', { name: 'G' }); const inv = await call(dono.tok, 'POST', `/guilds/${g.id}/invites`); await call(bia.tok, 'POST', `/invites/${inv.code}`);
const A = client(dono.tok), B = client(bia.tok); await A.open; await B.open;
const ready = await A.wait(m => m.t === 'READY'), vch = ready.d.guilds.find(x => x.id === g.id).channels.find(c => c.type === 2); await sleep(500);

// 1) entrada dupla
B.send('VOICE_JOIN', { channel_id: vch.id }); B.send('VOICE_JOIN', { channel_id: vch.id });
await B.wait(m => m.t === 'VOICE_JOINED'); await sleep(800);
const tr = await B.sfu('transport', { dir: 'send' });
ok(!tr.error && tr.data?.id, 'entrada dupla na mesma sala: o par da última entrada continua no SFU', tr.error);

// 2) mudo da moderação + SFU_REJOIN
A.send('VOICE_JOIN', { channel_id: vch.id }); const ja = await A.wait(m => m.t === 'VOICE_JOINED' && m.d.channel_id === vch.id);
const caps = ja?.d.sfu?.rtpCapabilities;
const mod = await call(dono.tok, 'PATCH', `/api/guilds/${g.id}/voice/${bia.id}`.replace('/api', ''), { mute: true });
ok(!mod.message, 'dono muta a bia pela moderação', mod);
const nJoined = B.msgs.filter(m => m.t === 'VOICE_JOINED').length;
B.send('SFU_REJOIN', { channel_id: vch.id }); await B.wait(m => m.t === 'VOICE_JOINED' && m.d.rejoin && B.msgs.filter(x => x.t === 'VOICE_JOINED').length > nJoined); await sleep(300);
const tb = await B.sfu('transport', { dir: 'send' });
const pb = tb.data && await B.sfu('produce', { transport_id: tb.data.id, source: 'mic', kind: 'audio', rtpParameters: OPUS(22220001) });
ok(pb?.data?.id, 'depois do SFU_REJOIN a bia publica o microfone', pb?.error);
const ra = await A.sfu('transport', { dir: 'recv' });
const cons = ra.data && await A.sfu('consume', { transport_id: ra.data.id, producer_id: pb?.data?.id, rtpCapabilities: caps });
ok(cons?.data?.producerPaused === true, 'mutada pela moderação: o microfone novo fica pausado no servidor (ninguém ouve)', cons?.data ? { producerPaused: cons.data.producerPaused } : cons?.error);

// 3) vídeo marcado como microfone
const pv = await B.sfu('produce', { transport_id: tb.data?.id, source: 'mic', kind: 'video', rtpParameters: VP8(22220002) });
ok(!!pv.error, "vídeo com a fonte 'mic' é recusado", pv.data || pv.error);
const pa = await B.sfu('produce', { transport_id: tb.data?.id, source: 'cam', kind: 'audio', rtpParameters: OPUS(22220003) });
ok(!!pa.error, "áudio com a fonte 'cam' é recusado", pa.data || pa.error);

A.ws.close(); B.ws.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
