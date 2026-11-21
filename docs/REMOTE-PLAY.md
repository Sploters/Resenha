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
| 1 | Comandos sem a fila de 16 ms (clique, tecla, rolagem e controle na hora; movimento no máximo 1 a cada 8 ms) | `remote-latency` antes × depois | **feito** (seção 7) |
| 2 | Servidor: participação única (`play`), permissões alteráveis, convite, vagas, compatível com páginas velhas | `remote-play-test` (43 verificações) + `remote-test` | **feito** |
| 3 | Interface: "Pedir para jogar", janela Jogadores, aviso do jogador | `remote-play-ui-test` (4 navegadores) + capturas | **feito** (seção 7) |
| 4 | Perfil de jogo: 60 FPS com o 1º jogador e volta ao sair o último (4b); receptor com `jitterBufferTarget` 0 (4a) | `remote-latency` alternando com e sem, LAN e WAN | **4b feito; 4a medido sem efeito e desfeito** (seção 7) |
| 5 | Painel Desempenho + eco de comando + copiar/exportar | `remote-play-ui-test` + `remote-latency PANEL=1` (painel × medido) | **feito** (seção 7) |
| 6 | `lc-input`: mouse relativo (pointer lock) | `cargo test` (13), `cargo check` Windows, testes de regra e de navegador | **feito; precisa de nova versão do app; não executado no Windows** |
| 7 | Comandos por DataChannel (se o painel mostrar o TCP segurando comandos no teste real) | painel com 2 PCs | depende da medição |
| 8 | Regressão: bateria completa | `run-tests` | pendente |
| 9 | Teste com 2 PCs reais (dono) em redes diferentes | roteiro abaixo | depende do dono |

## 7. Resultados por etapa

### Etapa 1: comandos na hora (`public/remote.js push/flush`)
Clique, tecla, rolagem e controle saem na hora; o movimento é agrupado (no máximo 1 a cada 8 ms, o último ponto vale) e sai
antes de um clique. Mesma máquina, mesma ferramenta, 20 cliques por rodada:

| ms (média / p95) | LAN antes (2) | LAN depois (2) | WAN 25±5, 0,5% antes (2) | WAN depois (3) |
|---|---|---|---|---|
| Comando (ida) | 20,9 / 35,8 · 21,8 / 59,3 | **3,5 / 6,1 · 4,1 / 15,8** | 45,7 / 51,5 · 44,8 / 51,0 | **29,4 / 37,6 · 29,9 / 42,1 · 29,4 / 33,9** |
| ↳ espera no app de quem joga | 19,1 / 30,3 | **1,3 / 4,7 · 1,4 / 5,1** | 17,9 · 17,6 | **1,2 · 1,4 · 1,0** |
| ↳ rede + servidor | 1,6 | 2,2 · 2,7 | 27,8 · 27,3 | 28,2 · 28,5 · 28,4 |
| Comando → tela | 76,6 / 112,6 · 89,9 / 131,3 | **60,5 / 93,3 · 57,4 / 77,5** | 126,5 / 147,1 · 149,2 / 199,2 | 123,1 / 177,5 · 122,7 / 195,8 · 133,6 / 240,6 |

- **Comprovado:** −16 a −18 ms na ida do comando, nas duas redes (o que era a fila). Na LAN, −20 a −30 ms no comando → tela.
- Na WAN o comando → tela mudou pouco perto da variação entre rodadas (o vídeo domina: captura → exibição 66–77 ms,
  p95 até 240 ms com perda). É o assunto das etapas 4 e 6.
- Achado de ferramenta: a 1ª versão do proxy TCP do `remote-latency` não desligava o Nagle (o servidor desliga, `ws`
  `setNoDelay`; o Chromium também), e com eventos saindo separados a WAN parecia pior (48–54 ms). Corrigido; as duas
  colunas WAN acima são com o proxy corrigido.
- Regressão: `remote-test`, `borderless-test`, `gameshare-test` passam.

### Etapas 2 e 3: participação única e janela Jogadores
- Servidor (`server/remote.js`, kind `play`): Player 2–4 (máx. 4 com o dono), permissões independentes alteráveis só pelo
  dono (`REMOTE_PERMS`), mouse para um só (dar a um tira do outro, avisando), convite (`REMOTE_INVITE`/`REMOTE_JOIN`, 60 s),
  revogar sem tirar, estado de volta na reconexão (`VOICE_RESUME` → `resync`). `control` e `pad` antigos continuam aceitos.
- Interface: "Pedir para jogar" (um botão), janela Jogadores (`public/players.js`), aviso fixo com "Player N" e as
  permissões acesas. Ao aceitar, só o Controle vem marcado.
- Ponte com o app desktop **atual**: o controle vai numa entrada `pad` da vaga e o mouse/teclado numa `control` à parte
  (`id:kb`), ligadas e desligadas conforme as permissões. Não exige app novo.
- Testes: `remote-play-test` (43, regras: vagas, limite de 4, isolamento, só o dono muda permissão, mouse exclusivo,
  revogar, tirar, convite aceito/recusado/cancelado/expirado, reconexão, saída, fim da transmissão, tipos antigos) e
  `remote-play-ui-test` (4 navegadores: botão único, pedido com só o Controle, Player 1–4, controle chega e clique/tecla
  não, liberar teclado e mouse, mouse passa de um para outro, convite, reconexão de quem joga, Revogar tudo, Tirar, Sair,
  perfil de jogo, fim da transmissão). `remote-test` adaptado: o fluxo antigo pedido como uma página antiga.
- Capturas: `.testshots/play-pedido.png` (pedido), `play-janela.png` (4/4 com permissões diferentes),
  `play-jogador.png` (aviso de quem joga).

### Etapa 4: perfil de jogo
Comparação **alternando com e sem na mesma máquina** (3 pares por rede, 20 cliques cada). Sequências separadas enganam: a
1ª leitura da 4a parecia −10 ms e era ruído entre sessões.

**4a — receptor com `jitterBufferTarget = 0` (desfeito, sem efeito):** o alvo foi aplicado (`[0]` lido de volta), mas o
Chromium já usa o menor buffer que a variação permite; o alvo só pede um mínimo.

| WAN 25±5, 0,5% (ms) | sem (3) | com (3) |
|---|---|---|
| Comando → tela, média | 120,5 · 124,6 · 123,5 | 122,2 · 120,5 · 123,8 |
| Captura → exibição, média | 68,8 · 70,4 · 77,0 | 73,2 · 68,7 · 70,1 |

**4b — 60 FPS enquanto houver jogador (mantido):** `public/remote.js gameProfile`. Ao entrar o 1º jogador a transmissão
vai a 60 FPS (no Windows, isso também leva ao caminho nativo quando disponível); quando o último sai, volta ao que era
(se a pessoa mudou a qualidade no meio, a escolha dela fica).

| ms (média / p95) | 30 FPS (3 pares) | 60 FPS |
|---|---|---|
| LAN: comando → tela | 73,1 / 101,1 · 63,2 / 101,5 · 86,6 / 129,5 | **57,4 / 77,9 · 53,3 / 75,4 · 57,6 / 86,6** |
| LAN: FPS exibidos | 25,8 · 27,2 · 28,0 | 41,8 · 43,5 · 42,4 (limite do VP8 por software aqui) |
| WAN: comando → tela | 130,3 / 182,3 · 126,1 / 186,6 · 120,6 / 202,1 | **108,6 / 160,8 · 108,1 / 133,7 · 112,9 / 157,1** |
| WAN: captura → exibição | 72,0 · 68,8 · 67,0 | 65,0 · 64,6 · 66,4 |

Comprovado: −10 a −30 ms no comando → tela (menor em todos os pares) e p95 −25 a −50 ms. Custa mais CPU/banda em quem
transmite (o dobro de quadros); no Windows o caminho nativo usa a placa de vídeo.

### Acumulado no container (etapas 1 + 4b), mesma ferramenta
| ms (média) | Linha de base | Agora |
|---|---|---|
| LAN: comando (ida) | 20,9 · 21,8 | 3,5 · 4,1 |
| LAN: comando → tela | 76,6 · 89,9 | 53,3–57,6 |
| WAN: comando (ida) | 45,7 · 44,8 (proxy corrigido) | 29,4–29,9 |
| WAN: comando → tela | 126,5 · 149,2 (proxy corrigido) | 108,1–112,9 |

### Etapa 5: painel Desempenho (`public/perfpanel.js`)
"Desempenho" no menu da transmissão, dos dois lados (flutuante, só para quem abre). Cada número tem a origem: **medido**
(contador do navegador/programa ou cronometrado), **estimado** (conta sobre medidos) ou **anfitrião** (medido no PC de
quem transmite e mandado pelo eco); sem dado, "—". Copiar (texto com média/p50/p95) e Exportar (JSON, 2 min de amostras).
- Quem joga: comando ida e volta (eco `REMOTE_PING/PONG` pelo mesmo caminho dos comandos, só entre as pontas de uma sessão
  ativa) e ida = metade; FPS recebidos/decodificados/exibidos (rVFC), decodificação, buffer de jitter, decodificador,
  codec, resolução, bitrate, RTT ao servidor, jitter, perda, transporte (UDP/TCP, direto/relay); de quem transmite:
  caminho, FPS capturados/enviados, codificação, codificador, RTT dele. Captura → exibição só como **mínimo estimado**: o
  `captureTime` do quadro não chega pelo SFU aqui.
- Quem transmite: caminho (nativo/Chromium), FPS capturados e enviados, codificação (no nativo, o `encMs` do `lc-stream`),
  codificador (placa/processador), limitação, resolução, bitrate, RTT, transporte e, por jogador, comando ida e volta e
  comandos por segundo.
- **Conferido contra a medição independente** (`remote-latency PANEL=1`, mesmo relógio):

| | Painel | Medido de ponta a ponta |
|---|---|---|
| LAN: ida do comando | 2,3 ms (estimado) | 4,8 ms (inclui 1,5 ms de espera no app, fora do eco) |
| WAN: ida do comando | 28,7 ms | 31,5 ms |
| FPS exibidos (LAN · WAN) | 43,4 · 40,1 | 43,8 · 41,1 |
| Captura → exibição (LAN · WAN) | 21,8 · 53 ms (mínimo) | 35,8 · 65 ms |

  A estimativa de captura → exibição fica 12–14 ms abaixo do real (não vê a espera da captura nem da tela): por isso o
  rótulo diz "mínimo".
- Testes: `remote-play-ui-test` (+6: números com origem, eco dos dois lados, Copiar, Exportar) e `remote-play-test` (+5:
  eco só entre as pontas da sessão, resumo limitado). Capturas: `.testshots/play-painel-jogador.png`,
  `play-painel-anfitriao.png`.

### Etapa 6: mouse travado (relativo) para jogos 3D
- `lc-input`: evento `r` (`dx`, `dy`, até ±2000) aplicado com `MOUSEEVENTF_MOVE` sem `ABSOLUTE` (o jogo lê como raw
  input). Avisa no `ready` (`"rel":true`); o app desktop repassa em `remoteCapable().rel`. **Segurança:** como o relativo
  pode levar o cursor para fora do monitor transmitido, clique e rolagem só passam com o cursor dentro dele (transmitindo
  uma janela: relativo só com ela em foco, como as teclas).
- Servidor: `r` só passa com o Mouse liberado **e** a sessão marcada com o app que suporta (`caps.rel`, do aceite/convite
  de quem transmite). App antigo de quem transmite: a opção nem aparece e o servidor descarta.
- Quem joga: "Mouse travado" no aviso (só quando disponível). O 1º clique na transmissão trava o cursor
  (`requestPointerLock({ unadjustedMovement: true })`); vão os deslocamentos somados a cada 8 ms e os cliques; Esc solta.
- Testes: `cargo test` (13, +1 mouse relativo), `cargo check --target x86_64-pc-windows-gnu`, `remote-play-test` (+5) e
  `remote-play-ui-test` (+2: opção aparece; travado manda deslocamento e clique, nunca posição). **Não executado no
  Windows** (precisa da nova versão do app: `lc-input.exe` e `desktop/remote.js`).
- Não feito: carimbo de tempo dentro do `lc-input` (o eco do painel mede até a página de quem transmite; o trecho
  página → processo principal → `lc-input` é IPC + pipe local e fica de fora da medida).

**Não está validado:** isto é o container (mesmo PC, VP8 por software, sem `lc-stream`/`lc-input` reais). A latência
só conta como resolvida depois do teste com 2 PCs, nos dois sentidos e em redes diferentes (seção 8).

Limitações honestas desta medição: tudo no mesmo PC, sem GPU (VP8 por software), sem o `lc-stream` e o `lc-input` reais,
rede simulada sem perda de TCP. O ganho real no Windows precisa do teste com 2 PCs e do painel.
