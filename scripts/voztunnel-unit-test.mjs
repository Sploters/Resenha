// Voz pelo túnel, lado do servidor (server/voztunnel.js + sfuTunnelAttach em server/sfu.js), sem navegador:
// duas pessoas na sala pelo túnel; o que uma manda (Opus em pacotes de 20 ms) chega à outra com o mesmo conteúdo e o
// carimbo de tempo; assinatura errada é recusada; ensurdecer para a chegada; moderação (ensurdecida) também; sair da
// sala no SFU avisa "detached"; e quem está pela mídia normal recebe o microfone do túnel como um producer comum.
// Uso: node scripts/voztunnel-unit-test.mjs
import WebSocket from 'ws';
process.env.RTC_PORT ||= '41350'; process.env.RTC_IPS ||= '127.0.0.1';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { for (const t = Date.now() + ms; Date.now() < t; await sleep(50)) if (fn()) return true; return false; };
const sfu = await import('../server/sfu.js');
const { startTunnelServer, tunnelSig } = await import('../server/voztunnel.js');

function client(port, key, uid, sig = tunnelSig(key, uid)) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/voz-tunel`, { headers: { 'x-lc-uid': uid, 'x-lc-sig': sig } });
  const c = { ws, msgs: [], frames: [] };
  ws.on('message', (d, bin) => { if (bin) { const b = Buffer.from(d); c.frames.push({ slot: b[1], seq: b.readUInt16BE(2), ts: b.readUInt32BE(4), payload: b.subarray(8) }); } else c.msgs.push(JSON.parse(String(d))); });
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (q, r) => rej(new Error('HTTP ' + r.statusCode))); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.audio = (ts, bytes) => { const b = Buffer.alloc(5 + bytes.length); b[0] = 1; b.writeUInt32BE(ts, 1); Buffer.from(bytes).copy(b, 5); ws.send(b); };
  c.has = (t) => c.msgs.some(m => m.t === t);
  return c;
}
try {
  ok(await sfu.startSfu(), 'SFU abriu');
  const tun = await startTunnelServer();
  const notes = { a: [], b: [], d: [] };
  await sfu.sfuJoin('sala', 'a', (t, d) => notes.a.push({ t, d }));
  await sfu.sfuJoin('sala', 'b', (t, d) => notes.b.push({ t, d }));

  const bad = client(tun.port, tun.key, 'a', 'x'.repeat(64));
  ok(await bad.open.then(() => false, (e) => /401/.test(e.message)), 'assinatura errada: recusado');

  const A = client(tun.port, tun.key, 'a'), B = client(tun.port, tun.key, 'b');
  await Promise.all([A.open, B.open]);
  A.send({ t: 'attach', cid: 'sala' }); B.send({ t: 'attach', cid: 'sala' });
  ok(await until(() => A.has('ready') && B.has('ready'), 3000), 'as duas entraram pelo túnel', [A.msgs, B.msgs]);
  const X = client(tun.port, tun.key, 'x'); await X.open; X.send({ t: 'attach', cid: 'sala' });
  ok(await until(() => X.has('error'), 3000) && X.msgs.find(m => m.t === 'error').msg === 'fora da sala', 'quem não entrou na sala pelo gateway: recusado');

  // a fala: 20 pacotes de "Opus" (o SFU não decodifica, só repassa)
  for (let i = 0; i < 20; i++) { A.audio(1000 + i * 960, [0xfc, i, 1, 2, 3]); await sleep(20); }
  ok(await until(() => B.msgs.some(m => m.t === 'add' && m.uid === 'a' && m.source === 'mic'), 3000), 'B soube que A tem microfone', B.msgs);
  ok(await until(() => B.frames.length >= 15, 3000), 'B recebeu a voz de A', B.frames.length);
  const f = B.frames.at(-1);
  ok(f && f.payload[0] === 0xfc && f.payload.length === 5 && (f.ts - 1000) % 960 === 0, 'conteúdo e carimbo de tempo preservados', f && { ts: f.ts, p: [...f.payload] });
  ok(notes.b.some(n => n.t === 'SFU_NEW_PRODUCER' && n.d.user_id === 'a' && n.d.source === 'mic'), 'quem está pela mídia normal é avisado do microfone do túnel');
  ok(A.frames.length === 0, 'ninguém recebe a própria voz');

  // ensurdecido no app: para de chegar
  B.send({ t: 'off', on: true }); await sleep(200); let n0 = B.frames.length;
  for (let i = 0; i < 10; i++) { A.audio(30000 + i * 960, [0xfc, 9]); await sleep(20); }
  await sleep(300);
  ok(B.frames.length === n0, 'ensurdecido: a voz para de chegar', B.frames.length - n0);
  B.send({ t: 'off', on: false }); await sleep(200); n0 = B.frames.length;
  for (let i = 0; i < 10; i++) { A.audio(40000 + i * 960, [0xfc, 9]); await sleep(20); }
  ok(await until(() => B.frames.length > n0 + 5, 2000), 'voltou a ouvir');

  // moderação: B ensurdecido pela moderação
  sfu.sfuModerate('sala', 'b', { deaf: true }); await sleep(200); n0 = B.frames.length;
  for (let i = 0; i < 10; i++) { A.audio(50000 + i * 960, [0xfc, 9]); await sleep(20); }
  await sleep(300);
  ok(B.frames.length === n0, 'ensurdecido pela moderação: não chega', B.frames.length - n0);
  sfu.sfuModerate('sala', 'b', { deaf: false });

  // a sala é refeita para A (SFU_REJOIN / reconexão): o túnel avisa e A entra de novo
  await sfu.sfuJoin('sala', 'a', (t, d) => notes.a.push({ t, d }));
  ok(await until(() => A.has('detached'), 2000), 'peer refeito: túnel avisa "detached"');
  ok(await until(() => B.msgs.some(m => m.t === 'del'), 2000), 'B soube que o microfone antigo de A acabou');
  A.msgs.length = 0; A.send({ t: 'attach', cid: 'sala' });
  ok(await until(() => A.has('ready'), 3000), 'A entrou de novo');
  n0 = B.frames.length;
  for (let i = 0; i < 10; i++) { A.audio(60000 + i * 960, [0xfc, 7]); await sleep(20); }
  ok(await until(() => B.frames.length > n0 + 5, 3000), 'B volta a ouvir A');

  // fechar o WebSocket fecha o microfone de A (os outros recebem SFU_PRODUCER_CLOSED)
  A.ws.close();
  ok(await until(() => notes.b.some(n => n.t === 'SFU_PRODUCER_CLOSED' && n.d.user_id === 'a'), 3000), 'saiu do túnel: microfone fechado para os outros');
  B.ws.close(); X.ws.close(); tun.close();
} catch (e) { ok(false, 'erro: ' + e.stack); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
