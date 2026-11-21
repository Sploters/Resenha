# Jogar junto / controle compartilhado: auditoria e plano (nov/2026)

Referência de experiência: Steam Remote Play Together. Este documento é a auditoria **antes** de mudar o código: como funciona
hoje, o que foi medido, os gargalos comprovados, o que ainda é hipótese e o plano por etapas com a checklist.

## 1. Como funciona hoje

Dois sistemas separados, com dois botões no menu da transmissão (`public/share.js`):
- **"Pedir controle"** (`kind: 'control'`): mouse, teclado e/ou controle; **uma** pessoa por vez; o dono escolhe em caixas
  no diálogo de consentimento (`public/remote.js onRequest`).
- **"Entrar como jogador"** (`kind: 'pad'`): só controle de videogame, vagas 2–4, até 3 pessoas; "aceitar os próximos
  nesta chamada" (`onPadRequest`).
- Quem transmite vê os jogadores num aviso fixo no topo (`#remote-chip`), com um X para tirar; não há lista de pedidos, de
  quem assiste, nem como mudar permissão no meio da sessão (só parar e pedir de novo).

Caminho de um comando (5 saltos):
```
quem joga (página)                servidor (gateway WS)        quem transmite (página)      app desktop (main)      lc-input.exe
pointer/tecla/Gamepad API  --WS-->  server/remote.js valida  --WS-->  public/remote.js  --IPC-->  desktop/remote.js --stdin--> SendInput / ViGEm
fila de 16 ms (public/remote.js)    permissão, formato, taxa         onRemoteEvent              filtra por kind          (scancode, XInput)
```
Caminho do vídeo: Chromium (`getDisplayMedia` → WebRTC → SFU mediasoup → `<video>` de quem assiste) ou, no Windows com
placa compatível e 60+ FPS, o programa nativo `lc-stream` (DXGI/WGC → H.264 na placa, `MF_LOW_LATENCY`, CBR, sem quadros
B, pacer de 30 ms → RTP no SFU). Quem assiste sempre decodifica no Chromium.

## 2. Medição (linha de base)

Ferramenta nova: `scripts/remote-latency.mjs` — servidor + SFU de verdade, dois navegadores separados no mesmo PC (mesmo
relógio, então os tempos são **medidos**, não estimados):
- *comando (ida)*: `pointerdown` de quem joga → chegada na ponte do app de quem transmite (o ponto que vai ao `lc-input`);
  separado em "espera no app de quem joga" (até sair pelo WebSocket) e "WebSocket → servidor → quem transmite";
- *comando → tela*: clique → 1º quadro **exibido** em quem joga em que a "tela" de quem transmite já reagiu (a ponte pinta um
  quadrado no próximo quadro, como um jogo);
- *captura → exibição*: cada quadro leva o horário em blocos (32 bits, conferidos por uma faixa invertida); quem assiste lê
  no `requestVideoFrameCallback` (`expectedDisplayTime`).
- Rede: `NET=lan` ou `NET=wan:<ms por sentido>:<variação>:<perda %>` só para quem joga (relé UDP da mídia com fila por
  sentido + proxy TCP do gateway com o mesmo atraso; sem `tc` no container). O proxy TCP **não** simula perda.

Container (Chromium sem GPU, VP8 por software, 1280×720, transmissão a 30 FPS = o padrão), 20–30 cliques por rodada:

| Medida (ms, média / p95) | LAN (2 rodadas) | WAN 25 ms ±5, 0,5% perda (2) | WAN 25 ms ±5, 2% perda |
|---|---|---|---|
| Comando (ida) | 20,9 / 35,8 · 21,8 / 59,3 | 48,1 / 62,6 · 48,5 / 71,8 | 46,3 / 57,7 |
| ↳ espera no app de quem joga | **19,1 / 30,3** | — | **18,9 / 28,5** |
| ↳ WebSocket → servidor → quem transmite | 1,6 / 2,6 | — | 27,4 / 31,7 |
| Comando → tela | 76,6 / 112,6 · 89,9 / 131,3 | 136,0 / 167,3 · 139,5 / 219,6 | 152,1 / 258,6 |
| Captura → exibição | 37,1 / 45,7 · 51,3 / 58,4 | 67,9 / 78,6 · 68,2 / 78,5 | 70,4 / 96,4 |
| Recebido → exibição (rVFC) | 23,9 · 38,7 | 24,6 · 24,5 | 26,5 / 49,4 |
| Buffer de jitter (getStats, média por quadro) | 8,4 · 19,1 | 14,3 · 13,7 | 19,2 |
| Decodificação (getStats) | 3,2 · 3,0 | 3,3 · 3,5 | 3,4 |
| FPS exibidos (de 30) | 28,9 · 29,7 | 26,8 · 27,2 | 22,6 |

Arquivos: `.testshots/remote-latency-antes-*.json`.

## 3. Por que está ruim: gargalos

**Comprovados (medidos aqui):**
1. **Fila de 16 ms no app de quem joga** (`public/remote.js push/flush`): todo evento, inclusive clique e tecla, espera o
   temporizador. São ~19 ms de ~21 ms da ida na LAN (o servidor custa 1,6 ms). Só o movimento precisa ser agrupado.
2. **30 FPS por padrão**: o quadro que mostra a reação espera em média meio intervalo (≈17 ms a 30 FPS, ≈8 ms a 60) além da
   própria captura. Entra duas vezes no "comando → tela" (quadro capturado e quadro exibido).
3. **Quem assiste não pede baixa latência ao receptor**: nenhum `jitterBufferTarget`/`playoutDelayHint` (o Chromium decide
   sozinho; buffer de 8–19 ms medido, "recebido → exibição" de 24–39 ms). Para jogar, o alvo pode ir a 0 quando a rede
   permite (medir o efeito em travadas).
4. **Perda na mídia**: com 2% de perda o p95 de "comando → tela" vai a 259 ms e os FPS exibidos caem para 22,6
   (retransmissão custa +1 RTT). É da rede, mas o painel precisa mostrar.
5. **Mouse só absoluto** (`lc-input`: `MOUSEEVENTF_ABSOLUTE`) e sem `requestPointerLock` na página: jogo 3D que gira a câmera
   pelo movimento relativo (raw input) não responde ao mouse remoto. Não é latência, mas faz o mouse "não funcionar"
   para jogar. Precisa de modo relativo no `lc-input` (nova versão do app).

**Hipóteses (não medidas aqui; o painel novo e o teste com 2 PCs vão dizer):**
6. **Comandos por TCP (WebSocket)**: um segmento perdido segura todos os comandos seguintes até a retransmissão (≥ 1 RTT,
   às vezes 200 ms+). Sem `tc` não dá para simular perda de TCP. Alternativa dentro da arquitetura: DataChannel pelo
   mesmo transporte UDP do SFU (mediasoup tem SCTP), sem ordem para o movimento e confiável para botões.
7. **Página de quem transmite ocupada** (codificação, prévia, efeitos): o comando passa pelo JavaScript dela antes do IPC.
   Medir no Windows com a carimbagem nova (chegada no renderer → escrita no `lc-input`).
8. **Caminho nativo no Windows** (H.264 na placa, 60 FPS): deve ser bem melhor que o VP8 por software medido aqui; só dá
   para medir lá. O painel mostra por onde a transmissão saiu.

Já está bom (auditado): codificador nativo em baixa latência (CBR, sem B, `MF_LOW_LATENCY`, GOP 2 s), pacer com fila máxima
de 30 ms, validação no servidor (1,6 ms incluindo dois saltos de WebSocket), controle mandado só quando muda.

## 4. Nova experiência: uma participação só

- **Quem assiste:** um botão **"Pedir para jogar"** na transmissão (some "Pedir controle" e "Entrar como jogador"). Pedido
  pendente vira "Cancelar pedido". Aceito: aviso fixo "Você é o **Player 2** · Controle ✓ · Teclado ✗ · Mouse ✗" com
  "Sair do jogo"; mudança de permissão aparece na hora.
- **Quem transmite:** janela **Jogadores** (botão na própria transmissão e no aviso fixo), com:
  - **Jogando:** Player 1 (você) e Player 2…4 com avatar, nome e número; três chaves por pessoa (**Controle**, **Teclado**,
    **Mouse**), alteráveis a qualquer momento; **Tirar** remove na hora.
  - **Pedidos:** quem pediu, com Aceitar (com as permissões escolhidas ali) e Recusar.
  - **Assistindo:** quem está vendo a transmissão sem jogar, com **Convidar** (a pessoa recebe "X convidou você para
    jogar" e entra com um clique).
  - **Revogar tudo** (mantém as pessoas, desliga as permissões) e "Aceitar os próximos pedidos nesta chamada".
  - Padrão ao aceitar: só **Controle** (como o Steam); teclado e mouse são escolha explícita. Mais de uma pessoa com mouse:
    aviso de que o cursor é um só.
- **Desempenho:** opção "Desempenho" no menu da transmissão (dos dois lados) abre o painel de diagnóstico (seção 5).
  Fora dele, nada técnico na interface.
- **Servidor:** uma sessão por jogador (`kind: 'play'`, vaga 2–4), permissões independentes e **alteráveis pelo dono**
  (`REMOTE_PERMS`), convite (`REMOTE_INVITE`) e o mesmo porteiro de hoje (formato, faixa, taxa, só a conexão da sala).
  Os tipos antigos continuam aceitos enquanto houver página velha aberta.
- **App desktop atual** (não muda sozinho): a página manda à ponte uma entrada `pad` (vaga do jogador) para o controle e,
  se houver mouse/teclado, uma `control` à parte. Funciona com o app que as pessoas já têm; o modo relativo do mouse e a
  carimbagem de tempo no `lc-input` entram na próxima versão do app.

## 5. Painel de diagnóstico

Cada número com a origem: **medido** (contador do navegador ou do programa) ou **estimado** (conta a partir de medidas).
- Quem joga: RTT do par de mídia (medido), jitter e perda (medido), FPS recebidos/decodificados/exibidos (medido; exibidos
  pelo `requestVideoFrameCallback`), decodificação e buffer de jitter (medido, média por quadro), bitrate, resolução, codec
  e decodificador (medido), transporte (UDP direto, TCP ou relay; medido pelo par de candidatos), **comando ida e volta**
  (medido: eco de quem transmite) e ida ≈ metade (estimado), captura → exibição (**estimado**: o Chromium não expôs o
  `captureTime` aqui; usa a diferença de relógio medida pelo eco).
- Quem transmite: FPS capturados (medido) e enviados (medido), codificação (medido: `totalEncodeTime/framesEncoded`),
  limitação (CPU/banda), bitrate, resolução, codificador (placa ou processador) e caminho (nativo ou Chromium); com o
  nativo, os contadores do `lc-stream`; por jogador: comandos por segundo e ida e volta.
- "Copiar" (texto) e "Exportar" (JSON com as amostras dos últimos 2 min), para comparar testes.

## 6. Etapas e checklist

| # | Etapa | Como confere | Estado |
|---|---|---|---|
| 0 | Auditoria e linha de base (`remote-latency.mjs`) | tabela acima | **feito** |
| 1 | Comandos sem a fila de 16 ms (clique, tecla, rolagem e controle na hora; movimento agrupado por quadro) | `remote-latency` antes × depois | pendente |
| 2 | Servidor: participação única (`play`), permissões alteráveis, convite, vagas, compatível com páginas velhas | `remote-test` (isolamento, concessão, revogação, vagas, reconexão) | pendente |
| 3 | Interface: "Pedir para jogar", janela Jogadores, aviso do jogador | `remote-test` + capturas | pendente |
| 4 | Receptor em baixa latência enquanto joga (`jitterBufferTarget`) e 60 FPS sugeridos ao aceitar o 1º jogador | `remote-latency` antes × depois (LAN e WAN), travadas | pendente |
| 5 | Painel Desempenho + eco de comando + copiar/exportar | teste do painel; valores batem com o `remote-latency` | pendente |
| 6 | `lc-input`: mouse relativo (pointer lock) e carimbo de tempo | `cargo test`, `cargo check` Windows | pendente (nova versão do app) |
| 7 | Comandos por DataChannel (se o painel mostrar o TCP segurando comandos no teste real) | painel com 2 PCs | depende da medição |
| 8 | Regressão: bateria completa | `run-tests` | pendente |
| 9 | Teste com 2 PCs reais (dono) em redes diferentes | roteiro abaixo | depende do dono |

Limitações honestas desta medição: tudo no mesmo PC, sem GPU (VP8 por software), sem o `lc-stream` e o `lc-input` reais,
rede simulada sem perda de TCP. O ganho real no Windows precisa do teste com 2 PCs e do painel.
