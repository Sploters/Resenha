# Voz fora da VPN

A internet de casa do servidor tem **CGNAT**: ninguém de fora alcança o IPv4 dele, e abrir porta no roteador não
resolve. O site e o chat chegam a todo mundo pelo Cloudflare Tunnel. A voz tenta três caminhos, nesta ordem, e o app
escolhe sozinho:

| Caminho | Quem usa | Como | Observação |
|---|---|---|---|
| **VPN** (Tailscale) | quem tem a VPN ligada | direto ao IP da VPN, porta 40000 | o melhor: voz, câmera e tela |
| **IPv6 público** | quem tem IPv6 funcionando (o 4G costuma ter) | direto ao IPv6 do servidor, porta 40030 | voz, câmera e tela; ver abaixo |
| **Pelo túnel** | todo o resto | pela conexão do site (WebSocket `/voz-tunel`) | **só voz**; entra se o direto não conectar em 5 s |

No app, o ícone de sinal do painel de voz mostra o caminho em "Conexão" (UDP/TCP = direto; "Pelo site (túnel)").

## IPv6 público

- `server/ipv6watch.js` roda no container `resenha-ipv6` (rede do host) e grava o IPv6 do servidor em
  `~/resenha-data/ipv6` a cada minuto; `server/sfu.js` anuncia esse endereço na porta 40030 e se ajusta quando a
  operadora troca o prefixo.
- O roteador precisa deixar entrar IPv6 **UDP e TCP na porta 40030** para o IPv6 do servidor (no ZTE F670L:
  Internet → Segurança → Filtro IPv6, regra de permitir na direção WAN → LAN).

## Pelo túnel

- O app comprime o microfone em Opus (WebCodecs) em pacotes de 20 ms e manda pelo WebSocket; as vozes da sala voltam
  pelo mesmo caminho (`public/voztunnel.js`, `public/voztunnel-worklet.js`).
- O app do servidor confere o login e repassa a conexão ao processo da voz (`server/tunnelproxy.js`), que põe a
  pessoa na sala por um DirectTransport do mediasoup (`server/voztunnel.js`, `sfuTunnelAttach` em `server/sfu.js`):
  para os outros ela é uma pessoa como qualquer outra.
- Limites: só áudio (câmera e tela não passam); um pouco mais de atraso quando a internet oscila (TCP); precisa de
  navegador com WebCodecs (Chrome/Edge e o app desktop; Firefox recente); chamada protegida (ponta a ponta) não usa o
  túnel.

## TURN

Testado e descartado para este caso: o TURN da Cloudflare só entrega endereço IPv4, que não alcança o servidor
(ver [TURN.md](TURN.md) para um TURN próprio numa VPS, se um dia valer a pena).
