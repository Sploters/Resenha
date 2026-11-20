# Próximos passos: passagem para a próxima sessão (nov/2026)

Guia para quem continuar (outra sessão do Claude ou uma pessoa). Resume o que a sessão de nov/2026 fez depois da
auditoria de recursos ([AUDITORIA-RECURSOS.md](AUDITORIA-RECURSOS.md)), com os números medidos, como medir de novo,
o que aprendeu e o que falta (roadmap em ordem). **Leia antes de começar.**

## Como o dono gosta de trabalhar

- **Medir antes e depois** de cada mudança, com a mesma ferramenta e na mesma máquina, e não exagerar números.
  Separar o comprovado do estimado e dizer quando algo não pôde ser medido.
- **Qualidade e estabilidade primeiro.** Nada de regressão em áudio, vídeo ou transmissão. Se uma otimização piorar
  algo, ela não fica.
- Preservar Electron, Rust, mediasoup e a arquitetura. Nada de reescrever tudo.
- **Economizar tokens:** sem subagentes em paralelo, medições curtas e diretas.
- Commits organizados por assunto. **Push só quando o dono pedir.** Nada de deploy.
- O que só dá para medir no Windows dele (app desktop, GPU, VRAM, bateria): dizer exatamente o que ele precisa rodar.
  Não chutar.

## Estado do repositório

- Branch de trabalho: `claude/hopeful-johnson-0xr9us`. Tudo abaixo já está nela.
- **A cópia local do dono** (`/home/user/Discord`, mesma branch) tem **alterações de música não commitadas**
  (`server/music.js`, `public/music.js`, `public/music.css`, `docs/MUSICA.md`, `public/changelog.js`, CSS...) e está
  ~205 commits atrás do remoto. **Não mexa nela sem pedir.** Esta sessão trabalhou numa worktree separada
  (`git worktree add`) e mandou para o remoto de lá (`git push origin <local>:claude/hopeful-johnson-0xr9us`).
- Testes de ponta a ponta usam portas fixas: **um por vez**, `flock /tmp/resenha-tests.lock node scripts/run-tests.mjs <nomes>`.

## O que foi feito (commits, do mais antigo ao mais novo)

Números em % de **um núcleo** (Xeon 2,1 GHz, 4 núcleos, sem GPU, Chromium 1243 sem janela), memória em PSS.

| Commit | O quê | Antes → depois (medido) |
|---|---|---|
| `deccd8e` | Mudo para a IA de ruído: a porta por voz (`vadgate-worklet.js`) rodava o RNNoise sobre zeros com o microfone fora da cadeia | Chamada mutada: RNNoise 17,7% → 14,0%; GTCRN 18,9% → 14,3% |
| `deccd8e` | Selo "AO VIVO" (`ux.css`): anel em `::after` com `transform`/`opacity` em vez de `box-shadow` | Thread principal de quem transmite: 7,0% → 4,2% |
| `deccd8e` | `electronLanguages: ["pt-BR", "en-US"]` (`desktop/package.json`) | Pacote do NSIS 125,98 → 117,45 MB; instalado 379,4 → 329,5 MB |
| `deccd8e` | `em-chamada.json` só gravado quando muda (com gente em chamada, continua a cada 10 s: o deploy exige) | 8.640 gravações/dia sem chamada → 0 |
| `7513e39` | A cadeia de IA para com o microfone fechado por **qualquer** motivo (PTT solto, moderação) | PTT solto: 16,5% → 12,7% |
| `df5089e` | Detector de tela preta (`meterBlack`) lê o quadro com `MediaStreamTrackProcessor` + `copyTo` | Renderer de quem transmite em 90 s: +168 MB → +6 MB |
| `acc8259` | Animações `lfgpulse` e `boteq` no compositor | 60 recálculos/s (+60 layouts/s no `boteq`) → 0 |
| `d45e6b1` | `lc-stream` (Windows 11, janela): fim do vai-e-volta WGC↔DXGI a cada ~5 min. Diagnóstico da captura registra quedas de mídia, de conexão e do controle de qualidade | Simulação de 30 min: 13 trocas → 5, todas nos primeiros 4 min |
| `a454209` | `lc-stream` DXGI: janela do jogo coberta por outra (Alt+Tab em "janela sem bordas") repete o último quadro em vez de mostrar a janela da frente | Não executado no Windows |
| `68bf041` | App desktop: versão baixada em segundo plano é instalada na próxima abertura (`desktop/updready.js`) | Não executado no Windows |
| `327ed9d` | **Queda do WebSocket não tira mais da chamada**: o servidor segura a sala 15 s (`holdVoice`, `VOICE_GRACE_MS`) e o app retoma (`VOICE_RESUME`, `voice.resume()`); a transmissão continua | Teste: com o código antigo o outro vê sair e a transmissão para; com o novo, nada |
| `c6034af` | Ferramentas de medição em `scripts/` e este documento | — |
| `5aa525b` `2977d97` | Testes: `ux-test`/`freeze-report-test` (CSP), `call-restart-test`, `voice-network-test`, `black-capture-test` | CI da `main` vermelho por eles → passam (rodando direto: `call-restart` 3 de 4 abaixo do limite antigo → 5 de 5 ok) |
| `f3902a1` | Estatísticas: quedas da mídia da chamada (`voice_reconnect`/`voice_recovered`) contadas, também minimizado | Eventos descartados → contados por motivo |
| `cccf096` | Modo reserva do Windows 10: Alt+Tab não mostra a janela da frente (`lc-audio` `over` + envio sem trilha) | Teste: 0 quadros para quem assiste com o jogo fora; não executado no Windows |
| `91b0a78` | Atualização numa abertura escondida reabre escondida | Não executado no Windows |
| `b43f82c` | `skShine` e `uoSlide` no compositor | Esqueletos 5,79% → 0,10% e barra 5,04% → 0,09% da thread principal |
| `b7eec79` | "Quem fala" dos outros pelo nível dos pacotes (sem Analyser por pessoa) | Por pessoa remota: Padrão 9,78% → 8,37%; RNNoise 11,43% → 10,73% |
| `2c676a7` | Clipes da própria transmissão pelo Chromium com os quadros do enviador (sem MediaRecorder) | Custo dos clipes: 1080p30 +14,9 → +0,5 ponto; 720p30 +10,1 → +4,6 |
| `e45e515` | Estatísticas: consumo real do app desktop por modo (faixas, a cada 5 min) | — (telemetria nova) |
| `a5b4714` | CI no Windows: nativos de verdade, atualização e instalador instalado em silêncio | Ainda não rodou (só depois do push) |

Testes novos: `mute-idle-test`, `emchamada-test`, `voice-resume-test`, `updready-test`, a leitura YUV/RGB no
`black-capture-test` e `janela_wgc_que_congela_nao_fica_trocando` no `lc-stream` (`cargo test`). Cada um falha no
código antigo.

**Precisa só atualizar o servidor:** mudo/PTT, animações, memória da transmissão, diagnóstico, `em-chamada.json`,
retomada da voz, quedas de mídia e consumo real nas estatísticas, "quem fala" pelos pacotes, clipes da própria
transmissão, esqueletos e barra de atualização, aviso `away` e `pause_producer` no servidor. **Precisa de nova versão do app desktop:** troca WGC/DXGI, janela coberta, atualização na abertura,
instalador menor (já na v1.0.54), modo reserva do Windows 10 (`lc-audio` novo + `appaudio.js`/`main.js`/`preload.js`),
atualização escondida (`main.js`/`updready.js`/`updsplash.js`).

## Chamada e transmissão: quedas e "sair e entrar" (nov/2026, 2ª passagem)

Pedido: o prompt 2 de [PROMPTS.md](PROMPTS.md) (gastar menos e se recuperar melhor, sem perder qualidade). Branch
`claude/jolly-galileo-cin4x4`. Comparações com o código de partida (`81489a8`) numa worktree, na mesma máquina
(container, 4 núcleos, Chromium 1243 sem janela, sem GPU).

**O que os números de partida já diziam:** os alvos de thread principal (`call3` ≤ 10%, `watching` ≤ 16%, `streamer`
≤ 16%) já estavam batidos antes de mexer: 1,7%, 2,2% e 4,2%. O custo de verdade é codificar e decodificar o vídeo no
Chromium (navegador inteiro, roteiro de 10 min: quem transmite 1080p ~70% de um núcleo, quem assiste ~30%), que no app
desktop vai para a placa de vídeo ou para o `lc-stream`. Nada foi mexido no caminho da mídia: a prioridade 1 era não
piorar qualidade.

| Commit | O quê | Antes → depois (medido) |
|---|---|---|
| `e066e3e` | `perf-roteiro.mjs`: roteiro fixo de 10 min (3 navegadores, 1080p60, 2 assistindo, mudo/desmudo a cada 20 s, relé UDP derrubando a rede do servidor 8 s e a de quem transmite 15 s) | — (ferramenta) |
| `3d1d2d5` | **Sair e entrar na mesma sala** (o `rejoin()` da recuperação faz isso): o aviso atrasado da própria saída tirava da entrada nova (`ownLeaveEcho`); passando do limite de entradas por segundo o servidor ignorava o `VOICE_JOIN` sem resposta e o app ficava "conectando" para sempre (agora `WS_KEEP`: guarda e aplica quando sobra ficha; `VOICE_LEAVE` cancela; `VOICE_STATE` espera a entrada); a mídia cancelada da entrada anterior virava "Falha ao conectar a voz" e `voice_fail` | Sonda de 40 ciclos: 20 ruins → 0. `voice-join-race-test`: antigo 15 de 30 ruins e o erro na tela; novo 0. `perf-stress` `joinLeave15`: 1.484 → 689 ms por ciclo (2 de 15 ciclos travavam 10 s) |
| `3d1d2d5` | **Queda de rede de até 15 s**: em chamada, no máximo ~2 s entre tentativas de reconectar (era até 10 s ±50%); a conferência da sessão (`GET /users/0`) não segura mais a reconexão; tentativa que não abre em 6 s é refeita; evento `online` reconecta na hora; tolerância do servidor 15 → 20 s | `voice-outage-test` (15 s sem rede, tolerância padrão): antigo falha em 5 itens (sai da sala para os outros, transmissão para); novo reconecta 1,3 s depois de a rede voltar. Roteiro de 10 min: antigo, os 2 que assistiam viram quem transmite sair e a transmissão terminou parada; novo, ninguém saiu e a transmissão seguiu |
| `8b8d654` | Testes: queda simulada por `/gateway-sem-rede` (outra porta a CSP bloqueia e a tentativa nunca avisa que fechou); cenários do selo AO VIVO no `perf-anim` | — |

**Roteiro de 10 min, mesmo trecho nas duas rodadas (0–385 s, antes da queda de quem transmite)** — CPU em % de um
núcleo do navegador inteiro (média / p99 / máximo) e áudio inventado para tapar buraco (inclui a queda de 8 s do servidor):

| | Antes | Depois |
|---|---|---|
| Quem transmite (fala + 1080p60) | 71,9 / 91,0 / 91,9 | 68,7 / 84,9 / 90,1 |
| Quem assiste (Bruno) | 32,7 / 38,4 / 45,7 | 31,3 / 39,1 / 47,1 |
| Quem assiste (Carla, muda/desmuta) | 30,7 / 37,6 / 41,7 | 29,5 / 37,2 / 44,5 |
| Áudio tapado (Bruno / Carla / quem transmite) | 2,04 / 2,00 / 2,14% | 2,06 / 2,01 / 2,13% |
| Vídeo recebido (10 min inteiros) | 1080p, 19,5 FPS, 0% perdido, 3 congelamentos (1,0 s) | 1080p, 19,7 FPS, 0% perdido, 0–1 congelamento (0–0,6 s) |
| Viu alguém sair / transmissão no fim | 2 viram / parada | 0 / no ar |

Ou seja: CPU e qualidade iguais dentro do ruído (nada mudou na mídia); a diferença é a queda. O container não codifica
1080p60 por software: ~20 FPS chegam a quem assiste nas duas versões. Os ~8 s "sem imagem" são as duas quedas (a de 8 s
do servidor é sem rede para todos).

**Não atingido:** `joinLeave15` ≤ 400 ms. Entrar leva 40–80 ms (sonda, com 3 pessoas e RNNoise); o `perf-stress` sai e
entra mais de uma vez por segundo e bate no limite contra abuso do `VOICE_JOIN` (rajada de 5, depois 1 por segundo,
`WS_RATE` em `server/index.js`). Antes a entrada passando do limite se perdia (ciclo de 10 s); agora espera a vez
(~1 s). Chegar a 400 ms exige afrouxar esse limite: **decisão do dono**.

**Medido, causa não achada:** com a pessoa transmitindo e olhando a sala, **toda** animação da página roda na thread
principal (o selo "AO VIVO", `livePulse`, faz 61 recálculos de estilo/s e ~3,4% da thread principal). Isolada, a mesma
animação fica no compositor (0/s); na página inicial, transmitindo, também. Esconder a sala, `#app` inteiro ou qualquer
quadro não muda; não há `<video>` no documento; não é o detector de tela preta nem o buffer de clipes (desligado por
padrão para a própria transmissão). Próximo passo: trace com `cc` e `viz` (`disabled-by-default-cc.debug`) para ver o
que pede um quadro principal a cada vsync, ou bissecar o que `stage.js` monta só com a própria transmissão no ar.

**Orçamento (`perf-budget --base`)**: três itens apareceram como "piorou" na primeira rodada e eram ruído, conferido
alternando as duas versões na mesma máquina (5 pares; 2 com a ordem invertida, porque o 2º de cada par saía pior):
abertura (thread principal, ms) antigo 223/413/323/265/349 × novo 369/440/379/283/329; mensagens enviadas no
`perf-stress` (`muteSpam/wsOutTotal`, é o total desde a abertura da página, não só do teste) antigo 1.738/2.412/2.086 ×
novo 2.734/2.145/2.416; quem transmite no `perf-audit` (janela de 5 s) antigo 4,2/7,7/5,7/5,7/6,1 × novo
9,4/10,1/6,5/6,5/7,0 — com o `perf-streamer` (janelas de 15 s, alternando): antigo 4,75/5,07% da thread principal e
46,9/49,3% do navegador × novo 4,31/4,44% e 46,0/46,6%. `perf-soak` de 10 min (tendência por hora): memória JS
1,72 → 1,94 MB/h, navegador 65,5 → 44,2 MB/h, servidor 61,1 → 54,1 MB/h, consumidores sobrando no SFU 0 → 0.
`idleChat/layoutsPerS` e `stylePerS` (2,3/s) já estouravam o orçamento antes, igual nas duas versões.

### O que medir no Windows (dono)
Precisa só atualizar o servidor (`sh deploy/umbrel.sh`): tudo desta passagem está em `public/` e `server/`; o app
desktop pega a interface nova sozinho.
1. **Queda de verdade no meio da chamada, transmitindo**: em chamada com alguém assistindo, desligue o Wi-Fi (ou tire o
   cabo, ou desconecte a VPN) por ~10 s e religue. Esperado: ninguém vê você sair, a transmissão volta sozinha em
   poucos segundos. Depois, no servidor:
   `docker logs resenha 2>&1 | grep "\[voz\] conexão de quem está em chamada caiu"` — deve aparecer "aguardando 20 s".
2. **Mesmo teste com 25 s de queda**: aí deve sair da sala (passa da tolerância) e voltar sozinho quando a rede voltar.
3. **Consumo transmitindo, antes e depois de atualizar** (nada mudou na mídia; serve para confirmar que não piorou):
   `powershell -ExecutionPolicy Bypass -File medir-resenha.ps1 -Label transmitindo -Secs 120`, transmitindo um jogo
   com alguém assistindo, nas duas versões.
4. **Decidir o limite de entradas por segundo** (`VOICE_JOIN: [1, 5]` em `server/index.js`): hoje, passando de 5
   entradas seguidas, cada uma espera ~1 s. Para gente de verdade não faz diferença; só o `perf-stress` sente.

## Como medir (ferramentas em `scripts/`)

| Ferramenta | Mede |
|---|---|
| `perf-call-states.mjs` | CPU da chamada por estado (ligado, mutado, ensurdecido ou um estado próprio). Ex. PTT solto: `STATES="ligado:() => { const v = window.__lc.voice; v.prefs.inputMode = 'vad'; v.setPtt(false); v.applyMute(); },ptt:() => { const v = window.__lc.voice; v.prefs.inputMode = 'ptt'; v.setPtt(false); v.applyMute(); }"` |
| `perf-streamer.mjs` | Quem transmite: recálculo de estilo, layout, thread principal e CPU total |
| `perf-stream-memory.mjs` | Memória por ciclo de transmissão, com bisseção (`NOMETERS`), memória por alocador (`DUMP=1`), heap snapshot e pressão de memória simulada |
| `perf-modes.mjs` | Os modos da auditoria (ocioso, servidor, voz, transmitindo, assistindo, depois de sair) |
| `noise-cpu.mjs`, `media-cpu.mjs`, `perf-audit.mjs`, `proc-cpu.mjs` | Já existiam (IA de ruído, clipes/E2EE, abertura e telas) |
| `perf-anim.mjs` | Uma animação sozinha na tela: recálculos de estilo/s, layouts/s, % da thread principal |
| `perf-open.mjs` | Abertura: tempo até pronto, thread por tipo, bytes, cobertura de JS/CSS (`CPU=4`, `BLOCK=` experimento) |
| `perf-clip-own.mjs` | CPU de quem transmite com os próprios clipes: sem clipes × MediaRecorder × quadros enviados |
| `perf-roteiro.mjs` | Roteiro fixo de 10 min (`MIN=`): 3 navegadores, 1080p60, quedas de rede pelo relé UDP; CPU e memória por papel (média, p99, máximo), o que cada um recebe (getStats a cada 1 s), quem viu alguém sair |
| `medir-resenha.ps1` | **No Windows do dono**: CPU, memória privada, GPU e VRAM por processo do Resenha (`-Label modo -Secs 60`, grava CSV) |

- **Voz de verdade no microfone falso:** baixe `https://raw.githubusercontent.com/microsoft/MS-SNSD/master/clean_test/clnsp1.wav`,
  converta com `ffmpeg -i clnsp1.wav -ar 48000 -ac 1 -c:a pcm_s16le voz.wav` e use `WAV=voz.wav`. O GTCRN abafa a
  "fala" sintética, então para medir nível com GTCRN só serve voz real.
- **Comparar com o código antigo:** suba uma worktree no commit antigo (`git worktree add --detach ../base <commit>`,
  `npm ci`), copie a ferramenta e rode as duas versões em sequência, na mesma máquina.
- **Instalador Windows sem wine:** em `desktop/`, `npm ci`, crie `native/lc-*.exe` de mentira com o mesmo tamanho e
  rode `npx electron-builder --win nsis -c.win.signAndEditExecutable=false -c.directories.output=<pasta>`. O NSIS final
  falha (precisa de wine), mas o `*.nsis.7z` (o pacote que vai dentro dele) é gerado com o mesmo compressor da release:
  compare esse arquivo.
- **`lc-stream`:** `cargo test` roda no Linux. `cargo check --target x86_64-pc-windows-gnu` (alvo instalado) confere o
  código do Windows. Executar, só no Windows.

## Lições desta sessão (não repetir)

- **O "AO VIVO" só aparece para quem transmite**, não para todos (a auditoria tinha dito o contrário).
- **Contar trilhas com `WeakRef` engana:** o `deref()` segura o objeto até o fim da tarefa. Use heap snapshot.
- **Memória que cresce e volta com `Memory.simulatePressureNotification`** é cache, não vazamento. Desenhar quadros de
  vídeo num canvas 2D (por `<video>`, `ImageBitmap` ou `VideoFrame`, com ou sem `willReadFrequently`) enche um cache do
  Chromium até ~470 MB. Ler o `VideoFrame` com `copyTo` não enche.
- **Não rode teste direto com `| head`:** o `head` fecha a saída, o teste morre antes de encerrar o servidor dele e o
  órfão fica com a porta (inclusive a de voz padrão, 40000): o próximo teste falha "sem motivo" (ex.: `ui-test` "modo de
  voz: SFU"). Use `grep` sem `head`, ou o `run-tests.mjs`.
- **A CSP do servidor também vale nos testes:** `addScriptTag({ content })` não roda. Use `page.setBypassCSP(true)` na
  página do teste, sem desligar a CSP do servidor.
- **O microfone falso do Chromium manda de ~30 a ~6.000 bytes/s** (bipe + porta por voz + DTX). Teste de "ouve a voz"
  compara enviado × recebido na mesma janela, não um número fixo.
- **`track()` descarta evento com a janela oculta** sem `{ bg: true }`: evento de chamada ou transmissão precisa dele.
- **Medir abertura pelo tempo até "pronto" engana** para efeitos de ~40 ms: a mesma versão varia 1,2–1,4 s entre
  rodadas. Use o profiler (tempo próprio por arquivo/linha, `positionTicks`) ou alterne na mesma sessão.
- **A 1ª criação de qualquer `Intl`** custa ~40 ms a 4x (ICU): adiar um não ganha nada se outro roda na abertura.
- **CPU entre sessões varia muito** (o mesmo código: 8–13% numa chamada): compare alternando os estados na mesma
  chamada (`perf-call-states` com estados próprios).
- **`producer.pause()` do mediasoup-client desliga a trilha** (`disableTrackOnPause`): vira quadro preto e apaga a
  prévia. Para parar o envio sem mexer na trilha: `rtpSender.replaceTrack(null)`.
- **O palco cria o buffer do clipe no 1º desenho**: o que fica pronto depois (encaixe no enviador) precisa redesenhar.
- **Renderizar o `AudioContext` sem dispositivo** (`setSinkId({ type: 'none' })`) custa o mesmo. Já foi testado.
- **Teste offline (`OfflineAudioContext`) não serve** para mudo/desmudo (desconectar e reconectar a fonte): use tempo real.
- **Servidor de teste órfão:** teste que cai pode deixar `node server/index.js` vivo na porta fixa, e o próximo falha
  sem motivo aparente. Confira com `pgrep -f "node server/index.js"` e `/proc/<pid>/environ` (o `pkill -f` pelo nome da
  pasta não acha: ela está no ambiente, não na linha de comando).
- **A CSP do servidor bloqueia `new Function`** em experimentos na página: suba o servidor com `CSP=off`.
- **Processo Node que mantém um servidor filho** não termina sozinho e perde a saída se for morto pelo `timeout`: use
  `process.exit` no fim.
- Testes instáveis conhecidos: `reconnect-storm-test` e `watch-test` (passam na 2ª tentativa no CI). Corrigidos nesta
  passagem: `call-restart-test`, `black-capture-test`, `voice-network-test`, `ux-test` e `freeze-report-test`.
- **Bateria completa nesta máquina (nov/2026, depois desta passagem): 131 de 134.** Os 3 que falham falham igual no
  código de antes (`c6034af`, conferido numa worktree): `community-test` e a 2ª tentativa do `focus-fly-test` (o alerta
  "Disco quase cheio" da máquina de nuvem vira notificação no meio do teste), 1ª tentativa do `focus-fly-test` ("Até eu
  desligar" já ligado) e `screen-release-test` ("voltar ao Descobrir mostra as seções"). No CI do GitHub passam. Testes que já falhavam neste ambiente:
  [AUDITORIA-RECURSOS.md](AUDITORIA-RECURSOS.md#testes-que-já-falham-no-código-original-neste-ambiente).

- **Simular queda de rede na página** mandando a reconexão para outra porta (`127.0.0.1:9`) não serve: a CSP bloqueia e
  a tentativa bloqueada nunca dispara `close`, então o app parece não reconectar. Use um caminho que o servidor derruba
  (`/gateway-sem-rede`).
- **Comparar duas versões sempre na mesma ordem engana:** nos 3 primeiros pares o 2º saía pior em abertura e em quem
  transmite. Inverta a ordem em metade dos pares; para quem transmite use o `perf-streamer` (janela de 15 s), não o
  `perf-audit` (5 s).
- **`muteSpam/wsOutTotal` do `perf-stress` é o total desde a abertura da página**, não só do teste de mudo: o limite
  de 120 do orçamento nunca bateu.
- **`joinLeave15` mede o limite contra abuso**, não o tempo de entrar (40–80 ms): o teste entra mais de 1 vez/s.

## Roadmap

### 1. Validar e fechar pendências (primeiro)
1. **Release no Windows 10 e 11**: troca WGC/DXGI, Alt+Tab com jogo em "janela sem bordas", atualização ao reabrir
   e instalador menor. Peça ao dono o `medir-resenha.ps1` antes e depois (transmitindo 5 min; mutado em chamada).
2. **Causa das quedas do WebSocket a cada ~5 min** (Windows 10, transmitindo). Já são inofensivas, mas o log do
   servidor agora tem `[voz] conexão de quem está em chamada caiu: código …; aberta havia N s`, e o diagnóstico da
   captura mostra o motivo do lado do app. Se "aberta havia" for sempre ~300 s, é proxy, túnel ou VPN com vida máxima
   de conexão: o ajuste é lá, não no app. Pergunte se o servidor usa VPN (Tailscale, ZeroTier, Radmin) ou túnel.
3. ~~Permissão "Criar convite"~~ **feito** (`61d785a`, decisão do dono: opção por servidor). "Membros sem cargo podem
   convidar" (`guilds.invite_all`, ligada por padrão = como antes); desligada, só o cargo com "Criar convite", o dono
   e os administradores, no link e no convite para a chamada. Teste `invite-perm-test`.
4. ~~Testes da minificação~~ **feito**: os 13 passam com a minificação ligada (o `ux-test` falhava pela CSP, item 7).
5. ~~Primeira release com os `.exe` compilados~~ **conferida**: v1.0.54 (CI Windows, "Compilar os programas nativos"
   ok). Setup 122,69 → 113,39 MB e Portátil 111,31 → 103,11 MB em relação à v1.0.53 (tamanho real dos arquivos).
6. ~~Juntar a cópia local do dono~~ (música): **deixado de lado a pedido do dono.** A junção ficou guardada na branch
   local `musica-junta` (`78daba6`, não enviada) caso seja útil depois.
7. ~~Consertar os testes instáveis~~ **feito**: `ux-test` e `freeze-report-test` (a CSP bloqueava o `<script>` inline que
   eles injetam; o CI da `main` ficava vermelho por isso), `call-restart-test` (compara enviado × recebido em vez de um
   número fixo de bytes), `voice-network-test` (envio atrasado depois de fechar o socket) e `black-capture-test`
   (servidor órfão). Ainda instáveis no CI: `reconnect-storm-test` e `watch-test` (passam na 2ª tentativa).

### 2. Curto prazo (pequeno e seguro)
- ~~Contar reconexões de mídia nas estatísticas~~ **feito** (`f3902a1`): quadro "Mídia da chamada" no painel; conta
  também com o app minimizado.
- ~~Modo reserva do Windows 10~~ **feito** (`cccf096`): `lc-audio` ganhou o vigia `over` (mesma regra do `covered`) e o
  vídeo fica sem trilha no envio enquanto o jogo está fora do monitor (quem assiste fica com a última imagem e o aviso
  "O jogo não está na tela"). Teste `screen-over-test`. **Não executado no Windows** (precisa de nova versão do app).
- ~~Atualização ao iniciar com o Windows~~ **feito** (`91b0a78`): a reabertura até 5 min depois de instalar numa
  abertura escondida continua escondida, sem a janelinha. **Não executado no Windows.**
- ~~Animações que restam~~ **feito** (`b43f82c`): `skShine` e `uoSlide` por `transform` (`perf-anim.mjs`: esqueletos
  5,79% → 0,10% da thread principal; barra 5,04% → 0,09%). `ns-shimmer` fica: é fundo recortado no texto
  (`background-clip: text`), que não vai para o compositor sem mudar o visual; já só anima com o mouse em cima.
- **GPU e VRAM no Windows** com o `medir-resenha.ps1`: depende do dono.

### 3. Médio prazo (medir antes e depois; risco médio)
- **Pausar o GTCRN em silêncio longo**: **depende do dono** (teste de escuta). O GTCRN é opcional ("Máxima"; o padrão é
  o RNNoise) e minificado (`public/vendor/ns/gtcrn`): pausar exige tirar e recolocar o nó no grafo no começo da fala,
  com o estado do modelo velho e a troca de atraso (~30 ms). Teto de ~6–7 pontos só para quem escolheu o GTCRN.
- ~~Carregar sob demanda~~ **medido, não aplicado** (`perf-open.mjs`, CPU 4x mais lenta: pronto em ~1,2–1,4 s). O JS
  executa pouco na abertura; o maior item ("topo" do `util.js`, ~50 ms a 4x) é a 1ª inicialização do ICU, que qualquer
  `Intl` paga (adiar o `RelativeTimeFormat` não mudou nada: desfeito). CSS: teto de −15% sem os 6 arquivos pouco usados
  (estilo 143 → 44 ms), mas a abertura usa um pedaço de cada; sem só os 2 com 0% de uso (`watch.css`, `extra.css`):
  −10 ms de estilo a 4x, dentro do ruído. Dividir por tela só com teste visual de todas as telas.
- ~~"Quem fala" pelo nível dos pacotes~~ **feito** (`b7eec79`): sem Analyser por pessoa no AudioContext; −1,4 ponto
  (Padrão) e −0,7 (RNNoise) por pessoa remota, alternando na mesma chamada. Teste `speaking-ssrc-test`.
  Microfone sem Web Audio no modo "Padrão": **medido, não aplicado**. Com o "quem fala" dos outros já fora do
  AudioContext, o teto (microfone cru direto no envio e o contexto suspenso) é 8,6% → 8,0% (3 x 20 s alternando na
  mesma chamada; numa rodada o direto ficou acima), e com o `getStats` a cada 100 ms para o "falando" próprio, 8,0%:
  dentro do ruído, sem compensar mexer no volume de entrada, teste de microfone e efeitos de voz.
- ~~Buffer de clipe da própria transmissão~~ **feito** (`2c676a7`): pelo Chromium, os quadros saem do enviador para o
  buffer (`perf-clip-own.mjs`: custo dos clipes em 1080p30 +14,9 → +0,5 ponto; 720p30 +10,1 → +4,6). Pelo programa
  nativo já era o buffer nativo. Teste `clip-own-tap-test`.
- **`dxcompiler.dll`** (25,8 MB; WebGPU não é usado): só com teste no Windows, porque o Chromium pode tentar carregá-la.

### 4. Grandes atualizações
- **Atualização por diferença:** **depende do dono** (teste no Windows). Hoje cada versão baixa ~113 MB (v1.0.54), sendo
  que o app (`app.asar`) tem 174 KB e os nativos ~5 MB. Um atualizador que falhe deixa todo mundo sem as próximas
  versões (inclusive a que o corrigiria): só com o ciclo baixar → conferir assinatura → trocar → reabrir testado no
  Windows 10 e 11. Mexe em `desktop/main.js`, `updready.js` e na assinatura (`updatekey.js`).
- ~~Telemetria de desempenho real~~ **feito** (`e45e515`): quadro "Consumo real do app desktop" (metade e 90% por modo).
- ~~Teste automático no Windows~~ **preparado** (`a5b4714`, `windows-testes.yml`): roda no GitHub depois do push; o
  primeiro resultado precisa ser conferido. Não cobre captura de verdade nem GPU (a máquina do GitHub não tem).

### O que depende do dono (resumo)
1. Windows 10 e 11 com a próxima versão do app: transmitir 5 min e ficar mutado em chamada com o `medir-resenha.ps1`
   (antes e depois); Alt+Tab com jogo em "janela sem bordas" (DXGI) e em tela cheia no Windows 10 (modo reserva: quem
   assiste deve ver a última imagem e o aviso "O jogo não está na tela"); iniciar com o Windows com uma versão baixada
   (deve continuar escondido); GPU e VRAM.
2. Quedas a cada ~5 min: as linhas `[voz] conexão de quem está em chamada caiu` do log e se há VPN/túnel/proxy.
5. Teste de escuta para pausar o GTCRN em silêncio; teste no Windows para a atualização por diferença e o `dxcompiler.dll`.
6. Push (5+ commits locais) e conferir o primeiro resultado do `windows-testes.yml`.
7. Chamada e transmissão (nov/2026, 2ª passagem): o teste de queda de verdade e a decisão do limite de entradas por
   segundo, em [O que medir no Windows](#o-que-medir-no-windows-dono).

## Referências

- Pedido e métricas da auditoria: [AUDITORIA-RECURSOS.md](AUDITORIA-RECURSOS.md)
- Captura WGC/DXGI: [CAPTURA-WGC-DXGI.md](CAPTURA-WGC-DXGI.md) · porta por voz: [PORTA-POR-VOZ.md](PORTA-POR-VOZ.md)
- Problemas à espera de dados: [PROXIMAS-CORRECOES.md](PROXIMAS-CORRECOES.md)
