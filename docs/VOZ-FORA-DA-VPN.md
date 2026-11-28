# Voz fora da VPN

A internet de casa do servidor tem **CGNAT**: ninguém de fora alcança o IPv4 dele, e abrir porta no roteador não
resolve. O site e o chat chegam a todo mundo pelo Cloudflare Tunnel. A voz tenta estes caminhos e o app
escolhe sozinho:

| Caminho | Quem usa | Como | Observação |
|---|---|---|---|
| **Rede de casa** | quem está na mesma rede do servidor, mesmo abrindo o site pelo Cloudflare | direto ao IP local do servidor, porta 40050 (`RTC_LAN_IP`, detectado no deploy) | sem VPN; o programa nativo manda para o mesmo endereço |
| **VPN** (Tailscale) | quem tem a VPN ligada | direto ao IP da VPN, porta 40000 | o melhor: voz, câmera e tela |
| **IPv6 público** | quem tem IPv6 funcionando (o 4G costuma ter) | direto ao IPv6 do servidor, porta 40030 | voz, câmera e tela; ver abaixo |
| **Pelo túnel** | todo o resto | pela conexão do site (WebSocket `/voz-tunel`) | voz, câmera e tela (com o som); entra se o direto não conectar em 5 s |

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
- Câmera e tela (`public/voztunnel-video.js`): o navegador comprime (WebCodecs `VideoEncoder`: H.264 pela placa quando
  houver, senão VP8) e já empacota em RTP; o servidor só confere o ssrc e repassa ao producer da sala. Quem assiste
  direto recebe como qualquer transmissão; pedidos de quadro-chave (PLI/FIR) voltam a quem transmite. O que chega da
  sala vai como RTP inteiro e o app monta e descomprime (`VideoDecoder`) numa faixa de vídeo comum. Vídeo que chega
  começa pausado e só anda enquanto a pessoa assiste. Áudio da transmissão: Opus estéreo, como o microfone.
- Pelo túnel a tela vai a até 1080p e ~60% da taxa da mídia direta; o programa nativo de 120 FPS não passa (volta à
  captura do navegador). Rede travada: o vídeo cede antes da voz (quadros pulados antes de comprimir; quem recebe e
  perdeu pacote espera o próximo quadro-chave).
- Limites: um pouco mais de atraso quando a internet oscila (TCP); precisa de navegador com WebCodecs (Chrome/Edge e o
  app desktop; Firefox recente); chamada protegida (ponta a ponta) não usa o túnel.
- **Camada que vai pelo túnel** (28/11): a maior que cabe em `TUNNEL_VIDEO_KBPS` (padrão 8000), medida no que quem
  transmite está mandando; descartando pacotes, desce um degrau. Antes ia sempre a cheia e uma transmissão de 20 Mbps
  travava e saltava. "Baixa/Média/Alta" no painel de qualidade vale pelo túnel. Quem recebe tem uma folga de até 400 ms
  contra as rajadas do TCP.
- **Volta sozinha** (28/11): pelo túnel, o app testa a mídia direta (operação `probe` do SFU) depois de 15 s, com a
  espera dobrando até 2 min; conectou, sai do túnel sem sair da sala. Antes ficava no túnel até a pessoa sair da chamada
  (caso real: VPN ainda ligando na hora de entrar). A telemetria conta `voice_tunnel` e `voice_direct`.
- Testes: `voztunnel-test` (voz), `voztunnel-todos-test` (todos pelo túnel), `voztunnel-video-test` (tela e som nos
  dois sentidos, túnel -> túnel).

## TURN

Testado e descartado para este caso: o TURN da Cloudflare só entrega endereço IPv4, que não alcança o servidor
(ver [TURN.md](TURN.md) para um TURN próprio numa VPS, se um dia valer a pena).
