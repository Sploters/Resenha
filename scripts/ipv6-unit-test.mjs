// Voz por IPv6 público (CGNAT no IPv4 de casa), sem navegador:
// 1) server/ipv6watch.js escolhe o IPv6 certo do host em /proc/net/if_inet6 (fora VPN, temporário, link-local, ULA) e
//    grava em <DATA_DIR>/ipv6 só quando muda
// 2) server/sfu.js anuncia esse IPv6 na porta 40030 além do IP da VPN; arquivo mudou: workers recriados com o novo
// Uso: node scripts/ipv6-unit-test.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { for (const t = Date.now() + ms; Date.now() < t; await sleep(100)) if (await fn()) return true; return false; };
const DIR = './.testdata-ipv6'; fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR);

// como no Umbrel (ip -6 addr, 2026-11-25): enp1s0 com IPv6 público e tailscale0 com o da VPN; mais um temporário,
// um link-local e uma interface do Docker, que não podem ser escolhidos
const HOST = [
  'fe80000000000000a00027fffe4e1f2a 02 40 20 80 enp1s0',
  '280453c400003ac0aaaabbbbccccdddd 02 40 00 01 enp1s0', // temporário (privacidade)
  '280453c400003ac0487cdd18168fd67b 02 40 00 200 enp1s0',
  'fd7a115ca1e0000000000000df380380 0f 80 00 80 tailscale0',
  '2001db80000000000000000000000001 05 40 00 80 docker0',
].join('\n');
const { candidates, pick } = await import('../server/ipv6watch.js');
const c = candidates(HOST);
ok(c.length === 1 && c[0].addr === '2804:53c4:0:3ac0:487c:dd18:168f:d67b', 'escolhe o IPv6 público da placa de rede', c);
ok(pick([...c, { addr: '2804:53c4:0:3ac0:1:2:3:4', ifname: 'enp1s0' }], '2804:53c4:0:3ac0:1:2:3:4') === '2804:53c4:0:3ac0:1:2:3:4', 'mantém o atual enquanto ele existir');
ok(pick(candidates('fd7a115ca1e0000000000000df380380 0f 80 00 80 tailscale0'), null) === null, 'só VPN: nenhum');

// o vigia grava o arquivo (e só quando muda)
const SRC = DIR + '/if_inet6', FILE = DIR + '/ipv6'; fs.writeFileSync(SRC, HOST);
const run = () => execFileSync(process.execPath, ['server/ipv6watch.js'], { env: { ...process.env, IF_INET6: SRC, RTC_IP6_FILE: FILE, IP6_ONCE: '1' } }).toString();
ok(/-> 2804:53c4:0:3ac0:487c:dd18:168f:d67b/.test(run()) && fs.readFileSync(FILE, 'utf8').trim() === '2804:53c4:0:3ac0:487c:dd18:168f:d67b', 'vigia gravou o arquivo');
ok(run() === '', 'sem mudança: não regrava');

// SFU anuncia o IPv6 do arquivo e troca quando o prefixo muda
process.env.RTC_PORT = '41340'; process.env.RTC_IPS = '127.0.0.1'; process.env.RTC_IP6_PORT = '41370';
process.env.RTC_IP6_FILE = FILE; process.env.RTC_IP6_CHECK_MS = '300';
const sfu = await import('../server/sfu.js');
const evs = []; sfu.onSfuEvent((k, t) => evs.push({ k, t }));
const cands = async (cid) => {
  await sfu.sfuJoin(cid, 'u1', () => { });
  const t = await sfu.sfuRequest(cid, 'u1', 'transport', { dir: 'recv' });
  sfu.sfuLeave(cid, 'u1');
  return t.iceCandidates.map(x => `${x.protocol} ${x.address}:${x.port}`);
};
try {
  ok(await sfu.startSfu(), 'SFU abriu');
  const a = await cands('sala1');
  ok(a.includes('udp 127.0.0.1:41340') && a.includes('udp 2804:53c4:0:3ac0:487c:dd18:168f:d67b:41370') && a.includes('tcp 2804:53c4:0:3ac0:487c:dd18:168f:d67b:41370'), 'anuncia o IP da VPN e o IPv6 público (UDP e TCP)', a);
  fs.writeFileSync(FILE, '2804:53c4:0:9999::7\n');
  ok(await until(() => evs.some(e => e.k === 'ipv6_changed') && evs.some(e => e.k === 'worker_restarted'), 8000), 'prefixo novo: workers recriados', evs.map(e => e.t));
  const b = await cands('sala2');
  ok(b.includes('udp 2804:53c4:0:9999::7:41370') && !b.some(x => x.includes('487c')), 'passa a anunciar o endereço novo', b);
  fs.writeFileSync(FILE, 'fd00::1\n'); // inválido (não público): deixa de anunciar IPv6
  ok(await until(async () => evs.filter(e => e.k === 'worker_restarted').length >= 2, 8000), 'endereço inválido: recriado sem IPv6');
  const d = await cands('sala3');
  ok(!d.some(x => x.includes(':41370')) && d.includes('udp 127.0.0.1:41340'), 'sem IPv6 válido: só o IP da VPN', d);
} catch (e) { ok(false, 'erro: ' + e.message); }
fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
