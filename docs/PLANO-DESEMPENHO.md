# Plano de desempenho (checklist)

O que ainda dá para melhorar ou testar depois da auditoria de 2026-11-11 (`docs/AUDITORIA-DESEMPENHO.md`).
Marque `[x]` ao concluir e anote o resultado medido. Ordem sugerida: os marcados com ★ primeiro.

## Desenho da interface
- [x] ★ **Redesenhar só o que mudou** na lista lateral e na lista de membros (2026-11-11, `scripts/perf-churn.mjs`:
      300 membros, ~6 entradas/saídas por segundo, quem está com a lista aberta). Thread principal **19,4% → 9,4%**;
      com a CPU 4x mais lenta **83,8% → 39,2%**. O que mudou: troca de status não redesenha mais o chat (as mensagens
      não mostram status) nem a lista de canais do servidor; ordenação com o cargo calculado uma vez e `Intl.Collator`;
      linha de membro guardada enquanto o que ela mostra não muda; `morph()`/`place()` (`util.js`) atualizam a lista
      no lugar (rolagem e fotos ficam). A lista atualizada aos pedaços sai idêntica a uma montada do zero.
- [x] ★ **Discover: atualizar só a seção que chegou** (2026-11-11, `public/discover.js`). Cada seção do Início é montada
      sozinha (`SECS`); a resposta de uma fonte troca só a seção dela e o "Para você" (que junta todas), e "Ver tudo/Ver
      menos" troca só a própria seção. O resto — cartões, imagens e a rolagem dos carrosséis — fica como está (antes as 6
      respostas remontavam a página inteira, uma por vez). Junto: um comentário engolia metade do código do "Para você",
      que só juntava promoções e torneios (Steam, lançamentos e notícias nunca entravam). `discover-test` confere que só
      a seção muda e a rolagem do carrossel fica.
- [x] ★ Listas longas que desenham só o que está na tela. **Feito em partes** (2026-11-11, junto com os dados grandes): lista de
      membros aos pedaços (200 por grupo, +300 ao rolar até o fim ou no "Mostrar mais") e categorias da lateral montadas
      quando chegam perto da tela. **Conversas diretas** (2026-11-11): as 60 primeiras saem montadas, o resto vira um
      espaço do mesmo tamanho e monta 200 por vez chegando perto (a conversa aberta aparece sempre). Abrir as 500
      (`perf-big`): linhas montadas **500 → 60**, maior tarefa **68 → 0 ms**. Achado junto: a rolagem da lista de canais de
      um servidor era aplicada à lista de conversas (e ao fim dela, montando todas); agora cada lista guarda a sua.
      **Histórico** (2026-11-12, `app.js HIST_MAX`, `scripts/history-window-test.mjs`, CPU 4x, canal com 1.000 mensagens):
      cada página de 50 lida para cima se somava para sempre. Agora o chat guarda até 300: passando disso as mais novas saem
      de baixo e aparece "Você está vendo mensagens antigas / Ir para o presente" (o mesmo modo do pulo para o início);
      descendo, voltam as novas e saem as de cima, com a mensagem do topo da tela parada no lugar. 800 mensagens para trás:
      no chat **850 → 250**, elementos **17.014 → 5.006**, cada página no topo **110 → 230 ms crescendo → ~100–190 ms
      estável**; descendo chega ao presente sem buraco nem repetição. A **busca** já vem em páginas de 50 (servidor), então
      não precisa de janela.
- [x] ★ **CSS: seletores caros e regras sem uso** (2026-11-12, `scripts/css-audit.mjs`, 300 membros, CPU 4x, chat recebendo
      5 mensagens/s com gente entrando e saindo). As estatísticas de seletor do trace mostraram que os `:has()` com
      descendente num contêiner grande eram quase tudo: `body:has(#auth:not(.hidden)) #layer` e `#app:has(#chtabs) #rail`
      custavam ~1,5–1,9 ms **cada vez** que o estilo era recalculado (408 dos 676 ms casando seletores). Trocados por irmão
      (`#auth:not(.hidden) ~ #layer`), classe (`#app.ct-on`, posta por `plugins.js`) e `:has(> …)` só com filhos diretos
      (`#home`, `#chat.side`, `#lightbox`, menus do `#layer`). Casando seletores **676 → 280 ms**; recálculo de estilo
      **~2,69 → ~2,42 s** nos 12 s (−10%). Fica caro: o recálculo em si (~780 por 60 mensagens, ~3 ms cada a 4x) e
      `.msg.first:has(+ .msg.cont)` (~26 ms; trocar por classe exige marcar a mensagem anterior a cada envio).
      Cobertura numa volta pelo app (chat, perfil, emojis, configurações, Descobrir, conversas): 3.108 de 3.575 regras não
      casaram (~300 dos 360 KB) — candidatas, não prova: estados raros existem e há classes montadas no código
      (`'ff-' + fonte`, `'n' + quantidade`); 139 citam um nome que não aparece em nenhum JS, mas parte disso é montada.
      Não apaguei nada no automático. Desfoque e `backdrop-filter` não apareceram no custo (poucos, em elementos pequenos).
- [x] ★ **Imagens no tamanho certo** (2026-11-11). As fotos enviadas já passavam pelo `imgUrl` (WebP do tamanho do quadro,
      `server/thumbs.js`); faltavam os 12 avatares padrão (554–1024 px, a foto de toda conta nova) e alguns lugares que
      usavam a foto original: ícone do servidor no convite, servidores em comum, caixa de entrada, avatar da menção,
      banners do servidor e do perfil e a cor média dos quadros da call. Avatares padrão ganharam versões de 64/128/256 px
      em WebP (`scripts/avatar-sizes.mjs`, rodar de novo ao trocar um). Servidor grande aberto com a lista de membros
      (`scripts/image-sizes-test.mjs`): avatares baixados **90 → 16 KB**, pixels decodificados **1,57 → 0,02 megapixel**,
      nenhum avatar maior que o dobro do quadro (antes, todos os 57).

## Voz e vídeo
- [x] ★ ~~"Falando" pelo nível de áudio que o WebRTC já entrega~~ (`getSynchronizationSources`) — **medido e descartado**
      (2026-11-11): implementado e comparado com 5 pessoas na call, com áudio parecido com fala. A thread de áudio ficou
      igual (9,1–9,7% com o analisador, 9,1–9,3% com o RTP): o analisador WebAudio já é barato. O "falando" pelo RTP
      batia com o do analisador, mas não compensou a complexidade; voltou ao analisador.
- [x] ★ **"Falando" pelo servidor** (2026-11-12, `server/sfu.js levelsFor`, `voice.js syncVoiceFlow`). O SFU mede o volume de
      cada microfone (`AudioLevelObserver`, -50 dBov, 250 ms) e manda `SFU_SPEAKING` só para quem pediu ('levels') e só quando
      a lista muda. Ensurdecido agora pausa a voz dos outros **mesmo com a janela aberta** (antes só com ela escondida, porque
      o medidor daqui precisava do áudio) e vê quem fala pelo servidor; tirou o ensurdecer, a voz volta e o medidor local
      reassume. Servidor sem isso: como antes. Medido (`scripts/speaking-server-test.mjs`, microfone falso tocando um
      arquivo com fala e silêncio do volume alto ao baixo): voz chegando ao ensurdecido **~45 → 0 kbps**; o "falando" do
      servidor bate com o medidor local em 83–86% das amostras de 50 ms, acendendo ~100–150 ms depois; mutado some.
- [x] ★ **Câmera no tamanho do quadro e pausada fora de vista** (2026-11-11, `voice.js camFlow`, `app.js applyCamFlow`).
      Antes toda câmera chegava na camada cheia (1280 px, ~800 kbps cada), mesmo num quadro de 170 px ou com a sala fora da
      tela. Agora o tamanho do quadro (ResizeObserver, sem forçar layout) escolhe a camada (até 400 px na tela: 1/4; até
      800: metade; maior: cheia; o dobro em tela de alta densidade) e a câmera de quem não está à vista (outro canal, janela
      escondida, rolada para fora, "Desativar vídeo") pausa no servidor depois de 4 s; câmera nova já chega na camada do meio
      e pausada se a sala não está na tela. "Pausar vídeo fora da tela" desligado e janela flutuante (PiP) mantêm tudo.
      Medido (`scripts/cam-flow-test.mjs`, 2 câmeras falsas de 1280x720): grade de 2 **1.577 → 296 kbps (−81%)**; em outro
      canal ou janela escondida **~1.600 → 0 kbps**; câmera em destaque pede uma camada maior e a miniatura a menor.
- [x] ★ **CPU de cada filtro de ruído e sugestão de um mais leve** (2026-11-12, `scripts/noise-cpu.mjs` → `noise-cpu.json`;
      `lite.js startPressureWatch`, teste `scripts/noise-suggest-test.mjs`). O microfone do app (`createMic`) com um microfone
      falso tocando fala com chiado, 15 s por modo, 2 rodadas alternadas, Xeon 2,1 GHz de 4 núcleos, % de um núcleo além de
      "Nenhuma": **Leve (navegador) +0,2**, **Forte/RNNoise +3,0**, **Máxima/GTCRN +7,6** (a IA roda na thread de áudio da
      página: 4,1 e 8,0%). Os textos das opções e do "Consumo agora" mostram isso. Em chamada com uma das IAs e o
      processador **no limite** (pressão de CPU do sistema, `PressureObserver`, em "serious"/"critical" por 15 s seguidos —
      jogo, transmissão, PC fraco) aparece "Seu processador está no limite… Trocar para Forte/Leve | Agora não": GTCRN →
      RNNoise → navegador, o microfone é refeito sem sair da sala, uma vez por filtro por sessão; com a janela escondida
      (jogando) espera ela voltar. O modo leve automático do jogo continua sem mexer no ruído sozinho: assim a pessoa decide.
      Navegador sem `PressureObserver`: não sugere.
- [x] ★ **Gravação contínua dos clipes e cifra das chamadas protegidas, medidas** (2026-11-12, `scripts/media-cpu.mjs` →
      `media-cpu.json`, 15 s × 3 rodadas alternadas, mesma máquina). **Clipes**: uma transmissão 1080p 30 fps assistida
      custa 10,9% sem o buffer e **29,1% com ele (+18,2% de um núcleo por transmissão)** — o MediaRecorder recomprime em
      H.264 por software (Chromium sem codificador da placa; no Windows o Chrome/Electron costuma usar o da placa e pesa bem
      menos, falta medir lá); a ~6 Mb/s o buffer cheio (65 s) ocupa **~48 MB** por transmissão. O modo leve já desliga
      (e o "Consumo agora" agora diz o custo); o buffer só existe para transmissões assistidas. **Cifra quadro a quadro**:
      câmera 720p + microfone indo e voltando (quem envia cifra, quem recebe decifra; 140 quadros/s, ~720 kbps):
      **35,4% → 39,2% (+3,7%)**, dos quais o worker da cifra é **2,2%** (~0,15 ms por quadro) e o resto é levar os quadros
      até ele; nenhum quadro perdido, mesmo fps e taxa. Barato o bastante para ficar sempre ligado nas conversas protegidas.

## Rede e servidor
- [x] ★ **Presença só para quem está olhando o servidor** (2026-11-11). O app manda `VIEW` (servidor na tela; nenhum
      com a janela escondida); entrar/sair/trocar de aparelho vira um `PRESENCE` pequeno (id, status, aparelhos) para a
      própria pessoa, amigos, conversas diretas e quem está olhando um servidor dela; ao abrir um servidor chega
      `PRESENCE_SYNC` com quem está online. App antigo (sem `VIEW`) recebe como antes. Carga com 500 pessoas no mesmo
      servidor e 20% olhando: mensagens do gateway 789 mil → 655 mil (−17%), dados 597 → 536 MB, espalhar uma
      presença p95 9 → 2,4 ms; os avisos de presença caíram ~74%. Teste: `scripts/presence-test.mjs`.
- [x] ★ **"Digitando…" só para quem olha o servidor** (2026-11-11). Só aparece no chat e na prévia dos canais do
      servidor na tela, então vai para quem mandou `VIEW` daquele servidor (e app antigo); conversa direta continua indo
      ao outro lado sempre. Carga (`scripts/load/node-load.mjs`, agora com "digitando…" antes de cada
      mensagem; 500 pessoas no mesmo servidor, 20% olhando, `SPEED=2`), junto com o cache de consultas e os limites
      abaixo: mensagens do gateway **1,87 mi → 918 mil (−51%)**, dados 633 → 560 MB, CPU do servidor no teste inteiro
      **62,8 → 35,4 s (−44%)**, `GET mensagens` p95 18 → 10 ms (no servidor 4,8 → 2,3 ms), entrega de mensagem p95
      21 → 14 ms, READY p95 294 → 233 ms; 0 erros nos dois.
      Os outros avisos que vão ao servidor inteiro (`VOICE_STATE`, `MESSAGE_UPDATE`, membros, cargos) são estado que o app
      guarda: cortar exigiria sincronizar ao abrir o servidor, como o `PRESENCE_SYNC` — fica para depois.
- [x] ★ **READY menor: membros sob demanda** (2026-11-11). Servidor com `READY_LARGE` membros ou mais (padrão 1.000) vai
      no READY só com quem está online, a própria pessoa e o dono (`partial: true`, `member_count`); o app pede a lista
      inteira ao abrir o servidor ou as configurações dele (`GET /api/guilds/:id/members`, gzip; `state.js loadMembers`).
      Membros que chegam por evento durante o carregamento ficam como estão. Com 5.000 membros (`scripts/perf-big.mjs`):
      READY de um membro comum **2.844 → 195 KB** (comprimido 152 → 13 KB, montagem 48 → 21 ms); do dono com 500 conversas
      3.479 → 989 KB; abrir o app **2,8 → 0,6 s**; com 600 pessoas conectadas, `GET mensagens` p95 98 → 6 ms (o servidor
      parou de montar READYs enormes). Abrir o servidor grande pela 1ª vez custa ~100 ms a mais (a lista chega nessa hora).
      Teste: `scripts/big-data-test.mjs` (também com `READY_LARGE=2` no `presence-test`).
- [x] ★ **Mais de um worker do mediasoup** (2026-11-11, `server/sfu.js`). `SFU_WORKERS=N` (ou `auto`: núcleos, até 4);
      padrão continua 1. Cada sala fica inteira num worker — o com menos gente quando a sala abre — e cada worker extra
      escuta na própria porta (`RTC_EXTRA_PORT`, padrão 40011, 40012…; precisa estar aberta como a 40000). Worker que
      morre: salas novas vão para os outros. `/api/sfu/load` mostra a CPU do mais carregado e `per_worker`. Teste:
      `scripts/sfu-workers-test.mjs` (2 salas em 2 workers, voz chegando nas duas). Uma sala sozinha continua num núcleo
      só (dividir uma sala entre workers, com `pipeToRouter`, fica para quando uma sala passar de 1 núcleo).
- [x] ★ **SQLite** (2026-11-11). WAL e `synchronous=NORMAL` já estavam. Novo: consulta preparada guardada pelo texto
      (`server/db.js`; preparar a cada chamada era ~4/5 do custo de uma consulta pequena: 6,8 → 1,6 µs), `busy_timeout`,
      `temp_store=MEMORY`, cache de 32 MB. Plano (`EXPLAIN QUERY PLAN`) das 268 consultas do servidor: sobraram 3
      varreduras que valiam índice — apagar canal varria `clips`, apagar conta varria `lfg_posts` e achar o admin varria
      `users`. O resto que varre são buscas com `LIKE '%…%'` (limpeza de arquivos, busca de música), que não usam índice.
- [x] ★ **Limite por conexão no gateway** (2026-11-11, `wsGate` em `server/index.js`). Balde de fichas por tipo e um
      geral (300/s). Para estado (`VIEW`, `VOICE_STATE`, `CLIENT_INFO`, `ACTIVE`, `ACTIVITY_LOCAL`, `ROOM_CODE`), passando
      do limite o último pedido é guardado e aplicado depois — o estado nunca fica errado; o resto é ignorado. 3.000
      ignoradas em 10 s fecham a conexão (4008; o app reconecta). `VOICE_STATE` igual ao atual não é mais espalhado para o
      servidor. Medido (`scripts/gateway-limits-test.mjs`): 60 trocas de mudo seguidas → 16 envios e o último vale; 41
      `VIEW` → 5 sincronizações de presença; 50 "digitando…" → 4; 6.000 mensagens → conexão fechada, as outras de pé.

## App desktop
- [x] ★ **Jogo em tela cheia por cima da janela conta como "escondida"** (2026-11-12, `native/lc-audio --front`,
      `desktop/frontwatch.js`, teste `scripts/frontwatch-test.mjs`). O `lc-audio` ganhou um modo que fica aberto e olha a
      janela da frente 1x/s (`GetForegroundWindow`, custo desprezível): se é de outro programa, não está minimizada, não é a
      área de trabalho/barra de tarefas, está no **mesmo monitor** da Resenha e cobre o monitor inteiro (tela cheia ou sem
      bordas; coordenadas sem virtualização de DPI), avisa `covered`. O `main.js` soma isso ao "escondida" que a página já
      recebe (`win-state`), então tudo que pausa com a janela minimizada pausa também com o jogo na frente (vídeo das
      transmissões e câmeras no servidor, "falando", presença do servidor na tela). Voltar o foco para a Resenha descobre na
      hora (não espera a leitura). Jogo em outro monitor: continua à vista. Programa velho sem `--front`: desiste depois de 3
      tentativas e fica como antes; programa que cai é reaberto. **Precisa de um app desktop novo** (o `lc-audio.exe` foi
      recompilado com `cargo build --release --target x86_64-pc-windows-gnu`); não testado num Windows de verdade ainda.
- [x] ★ **Desaceleração da janela também em chamada** (2026-11-12, `lite.js throttleWanted`, testes `scripts/lite-test.mjs`
      e `scripts/call-throttle-test.mjs`). Com o modo leve, a economia em segundo plano agora vale em chamada; fica de fora só
      quem está transmitindo (os medidores da transmissão rodam a cada 1–3 s). Medido no Chromium com a aba de quem está na
      call escondida, 20 s, com e sem a desaceleração: a voz chega e sai igual, mensagens chegam pelo gateway, ao voltar a
      tela e o "falando" se atualizam em < 1,5 s. **Achado**: com o microfone capturando, o Chromium não desacelera os timers
      de jeito nenhum (seguiram a 10x/s mesmo com todos mudos), e a página escondida em chamada já gasta só **~2–3 ms/s**
      (0,2–0,3% de um núcleo) porque pausa vídeo, "falando" e desenho sozinha — então o ganho é pequeno (2,3 → 2,0 ms/s).
      O que mais pesa com o jogo aberto está no item acima (ser tratada como escondida).

## Testes de brechas
- [x] ★ **PC fraco + resposta a cliques (INP)** (2026-11-11, `scripts/perf-inp.mjs`, CPU 6x mais lenta, 300 membros):
      digitar, enviar, emojis, trocar de canal, perfil, configurações, buscar membro e rolar o histórico. Achados e
      corrigidos: (1) o filtro de saturação ligado mesmo em 100% fazia o Chrome promover cada mensagem e avatar a uma
      camada própria (86 camadas com 37 mensagens; agora 9) — só liga com a saturação mudada; (2) cada página do
      histórico remontava o chat inteiro — agora só entram as mensagens novas no topo. Rolando: pior quadro 633 → 283 ms,
      35 → 49 fps, travadinhas 17 → 8; perfil 72 → 32 ms, configurações 64 → 32 ms; chat aos pedaços igual ao montado do
      zero. Fica: a 1ª abertura dos emojis (~250 ms nesse PC, ~40 ms num normal, uma vez só; a 2ª leva 60–80 ms).
- [x] ★ **Sessão longa** (2026-11-11, `scripts/perf-soak.mjs`): call de 3 aberta, gente entrando/saindo, mensagens
      chegando e o app usado em ciclos, medindo a cada minuto depois da coleta de lixo. Achou um vazamento real que eu
      mesmo tinha criado no redesenho incremental: a linha guardada da lista de membros segurava, pelo clique, a tela
      antiga inteira (30 min: 430 mil elementos, +600 MB/hora no navegador) — o cache agora vale só dentro do mesmo
      painel. E o chat de um canal movimentado crescia para sempre (~900 mensagens/hora): com a pessoa no fim, ficam as
      150 mais novas ao passar de 250 (`trimChat`; teste `scripts/chat-trim-test.mjs`). Depois, em 25 min: elementos
      oscilando entre 5,6 e 8,2 mil, memória JS ~4,5 MB, navegador ~1.280 MB e servidor 146–147 MB estáveis, SFU limpo.
      Testar mais longo (horas) numa máquina real ainda vale a pena.
- [x] ★ **Trace real: INP 328 ms e mouse lento** (2026-11-11, `scripts/namefx-emoji-test.mjs`, CPU 6x). Dois traces do
      Chrome mostraram: (1) quem usa nome **Arco-íris/Brilho** fazia o chat inteiro ser repintado em todo quadro — o efeito
      anima `background-position`, que o Chrome não anima fora da thread principal (3.164 repinturas em 6 s por um autor;
      até passar o mouse levava ~85 ms para aparecer). Agora o nome fica parado nas listas e só anima com o mouse em cima da
      linha; no perfil, cartão e editor anima sempre. 50 nomes na tela: **8.817 → 0 repinturas** em 3 s parado.
      (2) A 1ª abertura dos **emojis** era o INP: 144 ms de layout + 118 ms desenhando as letras coloridas. Emojis em blocos
      de 5 linhas com `content-visibility` + fonte aquecida aos poucos com a aba parada: **328 → ~100 ms**. E o "Adicionar
      amigo" aceita `@nome` e qualquer caixa (os 404 do console eram o nome não batendo).
- [x] ★ **Traces e heap de uma sessão real** (2026-11-11, 2 traces de 5 s abrindo o app e rolando o Descobrir + heap).
      Estava bem: sem tarefa longa depois de abrir (a maior, 37 ms, é a 1ª pintura do Descobrir), cliques ≤ 15 ms, rolagem
      com 12% da thread principal, memória JS 4–5 MB. Achados e corrigidos: (1) o aquecimento dos emojis caía na abertura
      do app — 10 lotes de 15–30 ms de layout (~150 ms) entre 0,3 e 0,5 s, com a thread 70% ocupada → começa 4 s depois,
      lotes de 6 e só em folga de ≥ 12 ms (o painel continua abrindo em ~100 ms); (2) dos 1.288 elementos desanexados do
      heap, ~600 eram do app: o cache de linhas da lista de membros segurava o `#members` antigo e, por ele, o chat antigo
      inteiro (mensagens, mensagens de voz com as barras e ouvintes), e o Descobrir segurava a própria tela depois de sair.
      Agora soltam ao trocar de tela (`releaseOldScreens`). O resto era o DevTools (o painel Elements guarda o que mostrou).
      Teste: `scripts/screen-release-test.mjs` (WeakRef + coleta de lixo; a versão anterior falha nos dois).
- [x] ★ **Heap e timeline de outra sessão real** (2026-11-12, snapshot + 138 s de timeline de alocação). Estava bem:
      memória JS 18–21 MB, e na timeline quase nada criado nos últimos ~45 s sobreviveu (sem vazamento contínuo); os
      maiores blocos são código, CSS e strings externas, e o `CSSRuleSourceData` é do próprio DevTools. Mas sobravam
      **1.716 elementos desanexados** (335 no snapshot). Separando o que o DevTools, a seleção do navegador e a pilha nativa
      seguram (artefatos da captura), ficaram 5 retentores reais, todos telas que já tinham saído: a **galeria de clipes**
      (`st.root`, 1.016 elementos com 30 `<video>`), os **Arquivos** (`st.root`, 109), a tela de **Amigos** (`S.redrawHome`)
      e o painel **Ativo agora** (`S.redrawFeed` e o relógio de 30 s, que só se cancelava no tique seguinte, ~300 elementos),
      e o **palco da chamada** pelo ResizeObserver (`observedStage`), que segurava junto o chat e o compositor ao lado.
      Agora `releaseOldScreens` solta todos ao trocar de tela (a galeria também para os vídeos); voltar a cada tela continua
      igual. `scripts/screen-release-test.mjs` cobre os 4 casos (a versão anterior falha em todos).
- [x] ★ **Terceira sessão real: travada sem culpado no heap, e o cronômetro em 0:20** (2026-11-12). Heap limpo (11,7 MB,
      3 elementos desanexados), mas INP de 11 s com "input delay" de 3–11 s em 16 cliques seguidos: a página ficou
      ocupada por vários segundos várias vezes, e o heap não diz por quem (as travadas que o Chrome guarda nele não expõem
      o script). Aqui não repetiu (duas pessoas, câmera, tela e RNNoise: nenhum quadro acima de 100 ms). Por isso o app
      agora **conta as próprias travadas**: quadro acima de 1 s (Long Animation Frame) vai a `POST /api/rum/freeze` com os
      5 scripts mais longos (função, arquivo:posição, layout forçado) e o que estava aberto (chamada, câmera, tela, filtro
      de ruído, nº de elementos); o administrador vê as últimas 30 em `GET /api/perf` (`travadas`) e todas em
      `freeze.log`; também sai `[travada]` no console. **Cronômetro**: `started_at` vem com a hora do servidor e o app
      subtraía da hora do PC — com o relógio do PC ~20 s adiantado, a chamada "começava" em 0:20 (no navegador e no
      desktop, mesma máquina). O READY agora leva `now` e o app corrige a diferença. Teste:
      `scripts/freeze-report-test.mjs` (relógio 20 s adiantado e um clique que trava 1,5 s).
- [x] ★ **Rede instável, servidor reiniciando e 500 reconectando** (2026-11-12).
      (1) **500 reconectando** (`scripts/reconnect-storm-test.mjs`, servidor reinicia com 500 conectadas): o app tentava de
      novo em 1, 2, 4, 8 s iguais para todos — voltavam no mesmo milissegundo e o servidor montava 500 READY de uma vez
      (a compressão do WebSocket, 4 por vez, virava fila). Agora a espera tem sorteio de ±50% e vai até 10 s
      (`public/backoff.js`): READY depois do reinício p50 **1.030 → 19 ms**, p95 **2.345 → 154 ms**; todos de volta em ~6 s
      nos dois (a espera crescente enquanto o servidor estava fora); o servidor seguiu respondendo (pedido pequeno p95 10–12 ms).
      (2) **Servidor reiniciando no meio da call** (`scripts/call-restart-test.mjs`): as duas pessoas voltam sozinhas para a
      sala em 0,7–3,5 s, mudo mantido, ninguém duplicado e a voz volta — já funcionava, agora tem teste.
      (3) **Rede instável** (`scripts/voice-network-test.mjs`: um relé UDP entre os navegadores e o SFU perde/atrasa pacotes
      nos dois sentidos; `RTC_LISTEN_IP` novo no `sfu.js` para escutar num IP e anunciar outro). Com 5% de perda em cada
      sentido ~6–8% do áudio é inventado para tapar buraco (a correção FEC do Opus entra sozinha); 80 ± 40 ms de oscilação
      viram ~150 ms de buffer e quase nada inventado; a voz volta limpa quando a rede melhora. ~~NACK de áudio~~ (o SFU
      reenviando a voz perdida; o Chromium não anuncia, mas honra quando negociado com `enableRtx` no consumer) — **medido e
      descartado**: na descida com 5% de perda melhorou (3 → 0,1–2%), com 15% piorou nas duas rodadas (4,5 → 7,8–12,9%), e
      não cobre a subida. Voltou ao que era.
- [x] ★ **Dados grandes** (2026-11-11, `scripts/load/seed-big.mjs` + `scripts/perf-big.mjs`): 5.000 membros, 1.000 canais
      em 50 categorias, 8 cargos, 100 mil mensagens, 500 conversas diretas, 600 pessoas conectadas. Achados e corrigidos:
      READY enorme (acima); abrir os 5.000 offline da lista de membros montava 5.000 linhas numa tarefa de 310 ms → aos
      pedaços, **410 → 45 ms** e sem tarefa longa; cada `renderSide` montava as 1.000 linhas de canal (~45 ms) → categorias
      longe da tela viram um espaço do tamanho delas e são montadas ao chegar perto (**45 → 7 ms**); o layout forçado do chat
      ao abrir um canal caiu de 55 para 17 ms. Estão bem: trocar de canal (mediana 24 ms), GET mensagens antigas (p95 4 ms),
      busca (≤ 50 ms), rolar a lista de canais e de membros (sem tarefa longa), memória JS 8 MB. Ficam: abrir as 500
      conversas diretas (tarefa de ~100 ms) e abrir o servidor grande (~150 ms, metade montando o chat).
- [x] ★ **Resposta antiga sobrescrevendo a tela** (2026-11-11, `scripts/stale-response-test.mjs`, respostas atrasadas de
      propósito no navegador). Achados e corrigidos: (1) pular para uma mensagem (`jumpTo`, pelas fixadas/busca/resposta)
      e trocar de canal antes da resposta **guardava as mensagens do canal antigo no canal novo**; (2) fixadas do canal
      antigo abriam por cima do canal novo; (3) galeria de clipes: trocar de aba com outra carregando ignorava a aba nova e
      mostrava a resposta velha; (4) busca do canal, grupo da busca global e cartão de perfil (clicar em A e logo em B):
      a resposta mais lenta cobria a mais nova; (5) páginas do histórico chegando depois de trocar de canal. A → B → A
      rápido já funcionava (o `api()` junta pedidos iguais em andamento). A versão anterior falha em 4 dos 8 testes.
- [x] ★ **Conflitos: dois aparelhos/abas da mesma conta** (2026-11-11, `scripts/conflict-test.mjs`). Achado: as
      preferências iam inteiras para a conta, então o último aparelho a enviar desfazia o que o outro tinha acabado de
      mudar, e a mudança ainda não enviada (o envio espera 1,2 s) era sobrescrita pela que chegava do outro aparelho — e
      depois enviada de volta com o valor velho (tema mudado num aparelho sumia). Agora cada um manda só o que mudou desde a
      última versão da conta que conhece (`patch`/`removed`, guardada no aparelho por conta) e o servidor junta; o que chega
      de outro aparelho é juntado em 3 vias (o pendente daqui fica). App antigo, que manda tudo, continua funcionando. O
      teste cobre: mudanças quase juntas, mesma chave nos dois, pendente quando chega a do outro, recarregar com envio
      pendente, duas abas do mesmo navegador, lido num aparelho tirando a não lida no outro e mensagens enviadas juntas.
      A versão anterior falha no caso do pendente.
- [x] ★ **Abuso: mensagens gigantes e expressões que travam** (2026-11-11, `scripts/abuse-regex-test.mjs`; inundação
      pelo gateway já estava no limite por conexão, acima). Cada função que lê o texto da mensagem (markdown, `cleanLinks`,
      convites, chamadas, clipes, horários, temas, GIF, links de vídeo, "só emoji") recebe ~45 textos de 4.000 caracteres
      feitos para forçar retrocesso, num worker que é morto se travar. Achado grave: o **"só emoji"** (mostra emoji
      grande) tinha repetição dentro de repetição — "😀 😀 … 😀 x" levava 22 s com 14 emojis e, com 27, **travava para
      sempre a aba de todo mundo que abrisse o canal**. Virou uma verificação linear (0,2 ms; mesmo resultado nos casos
      normais). O resto ficou abaixo de 2 ms no pior caso. No servidor: `reply_to` guardava qualquer texto (até 1 MB) → só id
      de mensagem do mesmo canal; menções a contas fora do canal eram gravadas (900 por mensagem) → só quem está no canal,
      até 50; @everyone de qualquer membro notificava todo mundo a cada mensagem (5.000 linhas na caixa de entrada por
      envio) → quem não modera notifica 1 vez a cada 5 min por servidor (a mensagem vai normalmente; só não notifica de
      novo); a caixa de entrada é gravada numa transação.
- [x] ★ **Aba congelada/descartada, queda de conexão e voltar/avançar** (2026-11-12, `scripts/tab-lifecycle-test.mjs`; um
      proxy TCP corta a conexão da página, porque o modo offline do Chrome não derruba um WebSocket aberto). Achados e
      corrigidos: (1) **conexão que caía e voltava perdia as mensagens do meio-tempo** — o canal aberto e os já visitados
      ficavam sem elas até recarregar (a aba congelada caía no mesmo caso); agora o READY de uma reconexão esquece os canais
      guardados e o aberto busca as mais novas (`catchUp`: substitui se estava no fim, só acrescenta se estava lendo acima,
      recarrega se passaram de 50); (2) **voltar com as configurações abertas** trocava a tela de baixo e deixava o painel
      por cima — agora voltar (ou o gesto do celular) fecha a camada de cima: configurações, imagem ampliada e janelas
      (`public/backclose.js`); fechar pelo Esc/X tira a entrada do histórico, então o voltar seguinte troca de tela;
      (3) **rascunho sumia** ao trocar de canal, recarregar ou o navegador descartar a aba — agora fica por canal no aparelho
      (`lc_drafts`, até 50, gravado também no `pagehide`/`freeze`). Voltar/avançar entre canais, servidores, Descobrir e
      conversa já funcionava; agora tem teste.
- [x] ★ **Orçamento de desempenho** (2026-11-11, `scripts/perf-budget.mjs` + `scripts/perf-budget.json`). Lê o JSON do
      `perf-audit`, `perf-stress` ou `perf-big` (reconhece pelo nome), compara com os limites de cada item (máximo, mínimo,
      igual, ou quanto um par [antes, depois] pode crescer) e, com `--base <anterior.json>`, aponta o que piorou mais que
      20% e mais que 20% do limite do item (números pequenos oscilam). Sai com código 1 se algo estourou ou piorou.
      Ex.: `npm run perf:budget -- scripts/perf-big-depois.json --base scripts/perf-big-antes.json`. Limites folgados
      (máquinas diferentes); o `--base` na mesma máquina é o que pega regressão. Medidas de tempo do `perf-big` oscilam
      ~±50% entre rodadas idênticas nesta máquina: na dúvida, rode de novo antes de procurar culpado.
- [x] ★ **Testes quebrados consertados** (2026-11-11). `mic-rebuild-test`: as configurações abrem aos poucos (esperar o
      botão) e os cartões de ruído viraram `.choice`. `discover-test`: os cartões do carrossel fora da tela têm
      `content-visibility` (o `innerText` vinha vazio → `textContent`) e "Hoje/Amanhã" dependia do relógio (perto da
      meia-noite o torneio de daqui a 3 h caía amanhã → o navegador roda num fuso onde é meio-dia). `fase2-test`: qualidade e
      "Destacar para todos" foram para o menu "Mais opções" do quadro. `e2e`, `features` e `fase2` sobem um servidor
      próprio (`scripts/test-server.mjs`) quando não há `BASE`/`API`. O `ui-test` já passava com o Chromium. Navegador
      padrão dos testes fora do Windows: o Chromium pré-instalado.
