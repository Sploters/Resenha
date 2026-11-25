// Vigia do IPv6 público do servidor (host). Roda num container à parte, na rede do host (deploy/servidor.sh:
// resenha-ipv6, --network host), porque o container do Resenha não enxerga o IPv6 do host. A cada minuto grava o endereço
// em <DATA_DIR>/ipv6 (só quando muda); o SFU anuncia esse endereço para a voz (server/sfu.js, IPv6 público).
// Escolhe um IPv6 global (2000::/3) de uma interface de verdade: fora VPN (tailscale), Docker e endereços temporários
// (privacidade), que mudam sozinhos e quebrariam quem está na chamada. Enquanto o escolhido existir, continua com ele.
// Uso: node server/ipv6watch.js   (IP6_ONCE=1: grava uma vez e sai)
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.RTC_IP6_FILE || path.join(process.env.DATA_DIR || 'data', 'ipv6');
const SRC = process.env.IF_INET6 || '/proc/net/if_inet6';
const SKIP_IF = /^(tailscale|docker|br-|veth|virbr|wg|tun|zt|lo$)/;
const F_TEMPORARY = 0x01, F_DEPRECATED = 0x20, F_TENTATIVE = 0x40, F_DADFAILED = 0x08;

// linhas de /proc/net/if_inet6: endereço(32 hex) índice prefixo escopo flags interface
export function candidates(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const [hex, , , scope, flags, ifname] = line.trim().split(/\s+/);
    if (!hex || hex.length !== 32 || !ifname || SKIP_IF.test(ifname)) continue;
    if (scope !== '00') continue; // global
    const f = parseInt(flags, 16);
    if (f & (F_TEMPORARY | F_DEPRECATED | F_TENTATIVE | F_DADFAILED)) continue;
    if (!/^[23]/.test(hex)) continue; // 2000::/3: público (fora ULA fd00::/8, link-local etc.)
    out.push({ addr: hex.match(/.{4}/g).map(x => x.replace(/^0+(?=.)/, '')).join(':'), ifname });
  }
  return out.sort((a, b) => a.ifname.localeCompare(b.ifname) || a.addr.localeCompare(b.addr));
}

export function pick(list, current) {
  if (current && list.some(x => x.addr === current)) return current;
  return list[0]?.addr || null;
}

function tick() {
  let cur = null; try { cur = fs.readFileSync(FILE, 'utf8').trim() || null; } catch { }
  let text = ''; try { text = fs.readFileSync(SRC, 'utf8'); } catch { }
  const next = pick(candidates(text), cur);
  if (next === cur) return;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, next ? next + '\n' : ''); fs.renameSync(tmp, FILE);
  console.log(`${new Date().toISOString()} IPv6 público: ${cur || 'nenhum'} -> ${next || 'nenhum'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  tick();
  if (process.env.IP6_ONCE !== '1') setInterval(tick, Number(process.env.IP6_EVERY_MS) || 60000);
}
