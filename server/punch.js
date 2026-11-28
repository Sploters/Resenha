// Furo no CGNAT: ligação direta (UDP) com quem não tem VPN nem IPv6, sem servidor de fora.
// A internet de casa está atrás do CGNAT da operadora: nada de fora chega sem ter saído antes um pacote daqui para aquele
// endereço. O mediasoup nunca manda o primeiro pacote (ICE-lite), então quem faz isso é este repassador:
// 1. um socket UDP "público" descobre, por STUN, com que IP e porta o mundo o vê (só serve se o CGNAT usar a MESMA porta
//    para qualquer destino; se os servidores STUN discordarem, o furo fica desligado);
// 2. o app manda o endereço público dele (candidato srflx do próprio WebRTC; operação 'punch' do SFU) e o socket manda
//    pacotinhos para lá: o CGNAT daqui passa a aceitar a resposta, e o roteador de quem assiste também;
// 3. o que chega daquele IP vai ao mediasoup por um socket local (um por pessoa, para ele ver cada uma separada), e as
//    respostas voltam pelo socket público.
// O app recebe esse endereço como mais um candidato do transporte, com prioridade menor que a dos caminhos diretos. A
// cifra, as senhas do ICE e o controle de banda continuam de ponta a ponta com o mediasoup. Quem não conseguir (NAT que
// troca de porta a cada destino, UDP bloqueado) segue pelo túnel, como antes.
// Só são aceitos IPs informados por quem está numa chamada, e só endereços públicos.
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';

const MAGIC = 0x2112a442;
const STUN_DEFAULT = 'stun.l.google.com:19302,stun.cloudflare.com:3478';
const ALLOW_MS = 10 * 60e3, IDLE_MS = 90e3, MAX_SESSIONS = 200, PER_MINUTE = 40, MAX_PER_CALL = 4;
const SHOTS = [0, 100, 300, 700, 1500, 3000, 4500]; // ms: o primeiro pode chegar antes de o outro lado ter aberto o dele

// endereço IPv4 da internet (nada de rede local, CGNAT, loopback, multicast: não dá para usar o servidor contra eles)
export function publicV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || ''); if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some(n => n > 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)));
}
const isStun = (b) => b.length >= 20 && (b[0] & 0xc0) === 0 && b.readUInt32BE(4) === MAGIC;
const stunMsg = (type, id) => { const b = Buffer.alloc(20); b.writeUInt16BE(type, 0); b.writeUInt32BE(MAGIC, 4); id.copy(b, 8); return b; };
export function mappedAddress(b) {
  for (let o = 20; o + 4 <= b.length;) {
    const t = b.readUInt16BE(o), l = b.readUInt16BE(o + 2);
    if (t === 0x0020 && l >= 8 && o + 12 <= b.length && b[o + 5] === 1) {
      const x = (b.readUInt32BE(o + 8) ^ MAGIC) >>> 0;
      return { ip: [x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.'), port: b.readUInt16BE(o + 6) ^ (MAGIC >>> 16) };
    }
    o += 4 + l + ((4 - (l % 4)) % 4);
  }
  return null;
}

// opts: { stun: 'host:porta,host:porta', refreshMs, allowPrivate (só testes), log }
export async function startPunch(opts = {}) {
  const log = opts.log || (() => { });
  const allowIp = (ip) => (opts.allowPrivate ? /^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '') : publicV4(ip));
  const sock = dgram.createSocket('udp4');
  await new Promise((res, rej) => { sock.once('error', rej); sock.bind(0, () => { sock.off('error', rej); res(); }); });
  sock.on('error', (e) => log('socket: ' + e.message));
  try { sock.setRecvBufferSize(4 * 1024 * 1024); sock.setSendBufferSize(4 * 1024 * 1024); } catch { /* o sistema limita */ }

  const asked = new Map(); // id da pergunta STUN -> servidor
  const seen = new Map(); // servidor STUN -> { ip, port, at }
  const allowed = new Map(); // ip -> { target: porta do mediasoup, exp }
  const sessions = new Map(); // 'ip:porta' -> { up, last, replied }
  const rate = new Map(); // quem pediu -> [horas]
  let pub = null, closed = false, warned = false, opened = 0;

  const servers = String(opts.stun || STUN_DEFAULT).split(',').map(s => s.trim()).filter(Boolean);
  function judge() {
    const now = Date.now(), list = [...seen.values()].filter(x => now - x.at < 90e3);
    const keys = new Set(list.map(x => x.ip + ':' + x.port));
    if (keys.size > 1) { if (!warned) { warned = true; log('o CGNAT usa uma porta diferente para cada destino: furo desligado'); } pub = null; return; }
    const next = list[0] ? { ip: list[0].ip, port: list[0].port } : null;
    if (next && (!pub || pub.ip !== next.ip || pub.port !== next.port)) log(`endereço público ${next.ip}:${next.port}`);
    pub = next; if (next) warned = false;
  }
  async function refresh() {
    for (const s of servers) {
      const i = s.lastIndexOf(':'), host = s.slice(0, i), port = +s.slice(i + 1);
      try {
        const { address } = await dns.lookup(host, 4); if (closed) return;
        const id = crypto.randomBytes(12); asked.set(id.toString('hex'), s);
        if (asked.size > 50) asked.delete(asked.keys().next().value);
        sock.send(stunMsg(0x0001, id), port, address);
      } catch { /* sem DNS agora: tenta na próxima volta */ }
    }
  }

  const drop = (key) => { const s = sessions.get(key); if (!s) return; sessions.delete(key); try { s.up.close(); } catch { } };
  function session(key, from, target) {
    let s = sessions.get(key);
    if (s && s.target === target) return s;
    if (s) drop(key);
    if (sessions.size >= MAX_SESSIONS) return null;
    const up = dgram.createSocket('udp4');
    s = { up, target, last: Date.now(), replied: false, queue: [] };
    sessions.set(key, s);
    up.on('error', () => drop(key));
    up.on('message', (m) => {
      if (!s.replied) { s.replied = true; opened++; log(`ligação direta aberta (${[...sessions.values()].filter(x => x.replied).length} agora)`); }
      sock.send(m, from.port, from.address, () => { });
    });
    up.connect(target, '127.0.0.1', () => { try { up.setRecvBufferSize(2 * 1024 * 1024); } catch { } const q = s.queue; s.queue = null; for (const m of q) up.send(m, () => { }); });
    return s;
  }

  sock.on('message', (msg, from) => {
    // resposta de um servidor STUN a uma pergunta nossa
    if (isStun(msg) && msg.readUInt16BE(0) === 0x0101) {
      const k = msg.subarray(8, 20).toString('hex'), srv = asked.get(k);
      if (srv) { asked.delete(k); const m = mappedAddress(msg); if (m) { seen.set(srv, { ...m, at: Date.now() }); judge(); } return; }
    }
    const key = from.address + ':' + from.port;
    let s = sessions.get(key);
    const a = allowed.get(from.address);
    // sessão nova só começa com um teste de conexão do ICE (STUN) vindo de um IP informado por alguém da chamada
    if (a && a.exp > Date.now() && isStun(msg) && msg.readUInt16BE(0) === 0x0001) s = session(key, from, a.target);
    if (!s) return;
    s.last = Date.now();
    if (s.queue) { if (s.queue.length < 20) s.queue.push(Buffer.from(msg)); } else s.up.send(msg, () => { });
  });

  const timers = new Set();
  // who: quem pediu (limite por minuto). list: [{ ip, port }] do app. target: porta do mediasoup da sala dele
  function open(who, list, target) {
    if (closed || !pub) return 0;
    const now = Date.now(), hist = (rate.get(who) || []).filter(t => now - t < 60e3);
    let n = 0;
    for (const c of (Array.isArray(list) ? list : []).slice(0, MAX_PER_CALL)) {
      const ip = String(c?.ip || ''), port = Number(c?.port);
      if (!allowIp(ip) || !Number.isInteger(port) || port < 1 || port > 65535 || hist.length >= PER_MINUTE) continue;
      hist.push(now); n++;
      allowed.set(ip, { target, exp: now + ALLOW_MS });
      for (const ms of SHOTS) { const t = setTimeout(() => { timers.delete(t); if (!closed) sock.send(stunMsg(0x0011, crypto.randomBytes(12)), port, ip, () => { }); }, ms); timers.add(t); }
    }
    rate.set(who, hist);
    return n;
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, s] of sessions) {
      if (now - s.last > IDLE_MS) { drop(key); continue; }
      const a = allowed.get(key.slice(0, key.lastIndexOf(':'))); if (a) a.exp = now + ALLOW_MS; // em uso: continua liberado
    }
    for (const [ip, a] of allowed) if (a.exp < now) allowed.delete(ip);
    for (const [who, h] of rate) if (!h.some(t => now - t < 60e3)) rate.delete(who);
  }, 15e3);
  // a pergunta repetida também mantém o mapeamento aberto no CGNAT (UDP parado costuma expirar em 30 s ou mais)
  const keep = setInterval(refresh, opts.refreshMs || 15e3);
  sweep.unref?.(); keep.unref?.();
  await refresh();

  return {
    open,
    address: () => pub,
    stats: () => ({ address: pub, sessions: [...sessions.values()].filter(x => x.replied).length, opened, allowed: allowed.size }),
    close() { if (closed) return; closed = true; clearInterval(sweep); clearInterval(keep); for (const t of timers) clearTimeout(t); for (const k of [...sessions.keys()]) drop(k); sock.close(); },
  };
}
