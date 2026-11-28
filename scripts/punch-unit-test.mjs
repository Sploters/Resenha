// Furo no CGNAT (server/punch.js), sem navegador e sem internet: um STUN de mentira, um "mediasoup" de mentira e um
// "amigo" em sockets locais. Confere o endereço público descoberto, os pacotes que abrem a passagem, o repasse nos dois
// sentidos, o que é recusado (IP não informado, pacote que não é teste de conexão, endereço privado, excesso de pedidos)
// e o desligamento quando o NAT troca de porta por destino.
// Uso: node scripts/punch-unit-test.mjs
import dgram from 'node:dgram';
import { startPunch, publicV4, mappedAddress } from '../server/punch.js';

let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { for (const t = Date.now() + ms; Date.now() < t; await sleep(20)) if (fn()) return true; return false; };
const udp = () => new Promise((res) => { const s = dgram.createSocket('udp4'); s.got = []; s.on('message', (m, from) => s.got.push({ m, from })); s.bind(0, '127.0.0.1', () => res(s)); });
const MAGIC = 0x2112a442;
const stun = (type, extra = Buffer.alloc(0)) => { const b = Buffer.alloc(20); b.writeUInt16BE(type, 0); b.writeUInt16BE(extra.length, 2); b.writeUInt32BE(MAGIC, 4); b.write('abcdefghijkl', 8); return Buffer.concat([b, extra]); };
// STUN de mentira: responde o endereço de quem perguntou (shift: diz uma porta diferente, como um NAT por destino)
async function fakeStun(shift = 0) {
  const s = await udp();
  s.on('message', (q, from) => {
    const r = Buffer.alloc(32); r.writeUInt16BE(0x0101, 0); r.writeUInt16BE(12, 2); r.writeUInt32BE(MAGIC, 4); q.copy(r, 8, 8, 20);
    r.writeUInt16BE(0x0020, 20); r.writeUInt16BE(8, 22); r[25] = 1; r.writeUInt16BE((from.port + shift) ^ (MAGIC >>> 16), 26);
    r.writeUInt32BE((from.address.split('.').reduce((n, x) => n * 256 + +x, 0) ^ MAGIC) >>> 0, 28);
    s.send(r, from.port, from.address);
  });
  return s;
}

try {
  ok(publicV4('45.168.120.220') && !publicV4('192.168.7.19') && !publicV4('10.1.2.3') && !publicV4('100.66.43.146') && !publicV4('127.0.0.1') && !publicV4('172.20.0.1') && !publicV4('224.0.0.1') && !publicV4('999.1.1.1') && !publicV4('::1'), 'só endereços IPv4 públicos');

  const st = await fakeStun(), media = await udp(), friend = await udp(), stranger = await udp();
  media.on('message', (m, from) => media.send(Buffer.concat([Buffer.from('eco:'), m]), from.port, from.address));
  const logs = [];
  const p = await startPunch({ stun: `127.0.0.1:${st.address().port}`, allowPrivate: true, log: (m) => logs.push(m) });
  ok(await until(() => p.address(), 3000) && p.address().ip === '127.0.0.1', 'descobre o próprio endereço pelo STUN', p.address());
  ok(mappedAddress(stun(0x0101)) === null, 'resposta sem endereço: ignorada');
  const pub = p.address().port, send = (s, b) => s.send(b, pub, '127.0.0.1');

  send(friend, stun(0x0001)); await sleep(200);
  ok(media.got.length === 0, 'IP que ninguém informou: nada chega ao mediasoup');

  ok(p.open('u1', [{ ip: '127.0.0.1', port: friend.address().port }], media.address().port) === 1, 'quem está na chamada informa o endereço');
  ok(await until(() => friend.got.length >= 3, 2000) && friend.got[0].from.port === pub && friend.got[0].m.readUInt16BE(0) === 0x0011, 'o servidor manda os primeiros pacotes do socket público (abre a passagem)', friend.got.length);

  send(stranger, Buffer.from('lixo qualquer de um socket sem teste de conexão')); await sleep(200);
  ok(media.got.length === 0, 'sessão nova só começa com um teste de conexão (STUN)');

  friend.got.length = 0; send(friend, stun(0x0001, Buffer.from('ping')));
  ok(await until(() => friend.got.some(x => x.m.subarray(0, 4).toString() === 'eco:'), 2000), 'ida e volta com o mediasoup pelo furo');
  send(friend, Buffer.from([0x80, 96, 1, 2, 3]));
  ok(await until(() => media.got.some(x => x.m[0] === 0x80), 2000), 'depois de aberta, a mídia (RTP) passa também');
  ok(p.stats().sessions === 1 && logs.some(l => /ligação direta aberta/.test(l)), 'conta a ligação aberta', p.stats());

  // cada pessoa chega ao mediasoup por um socket diferente
  const other = await udp(); send(other, stun(0x0001));
  ok(await until(() => new Set(media.got.map(x => x.from.port)).size === 2, 2000), 'cada um é visto separado pelo mediasoup');

  let n = 0; for (let i = 0; i < 30; i++) n += p.open('abusado', Array.from({ length: 10 }, () => ({ ip: '127.0.0.1', port: 9 })), media.address().port);
  ok(n === 40, 'no máximo 4 endereços por pedido e 40 por minuto por pessoa', n);
  ok(p.open('u2', [{ ip: '127.0.0.1', port: 0 }, { ip: 'exemplo.com', port: 80 }], 1) === 0, 'porta ou endereço inválido: recusado');
  p.close();

  const strict = await startPunch({ stun: `127.0.0.1:${st.address().port}` });
  await until(() => strict.address(), 3000);
  ok(strict.open('u1', [{ ip: '192.168.0.10', port: 5000 }, { ip: '127.0.0.1', port: 5000 }], 40000) === 0, 'em produção, endereço da rede local não é alvo');
  strict.close();

  const st2 = await fakeStun(7);
  const sym = await startPunch({ stun: `127.0.0.1:${st.address().port},127.0.0.1:${st2.address().port}`, allowPrivate: true });
  await sleep(500);
  ok(sym.address() === null && sym.open('u1', [{ ip: '127.0.0.1', port: 5000 }], 40000) === 0, 'NAT que troca de porta por destino: furo desligado');
  sym.close();
  for (const s of [st, st2, media, friend, stranger, other]) s.close();
} catch (e) { ok(false, 'erro: ' + e.stack); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
