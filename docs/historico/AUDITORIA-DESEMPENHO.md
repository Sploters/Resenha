# Auditoria de desempenho (2026-11-04)

Medido com `node scripts/perf-audit.mjs <rótulo>` (Chromium sem placa de vídeo, 3 rodadas, mediana; abertura com a rede
de uma VPN simulada: 40 ms de ida e volta, 20 Mbps). CPU = tempo de tarefas na thread principal da página por segundo.

| Medida | Antes | Depois |
|---|---|---|
| Abrir o app (primeira vez) | 752 ms, 764 KB | **572 ms, 244 KB** |
| Abrir de novo (com cache) | 520 ms (47 consultas ao servidor) | **144 ms** (nenhuma consulta de módulo) |
| Processamento na abertura | 135 ms | 121 ms |
| Parado no chat (150 mensagens) | 0,1% CPU | 0,1% |
| Call com 3 pessoas | 4,6% CPU, 29 mudanças na página/s | 4,2%, **15 mudanças/s** |
| Assistindo transmissão | 8,0% | 9,2% (dentro da variação entre rodadas: 6–11%) |
| Transmitindo | 5,7% | 3,5% |
| Servidor (call / transmissão) | 1,9% / 2,6% CPU, ~117 MB | igual |

## O que foi corrigido
1. **Entrega da interface** (`server/static.js`): arquivos comprimidos (brotli/gzip, guardados em memória), endereço
   com a versão do servidor (`?v=<hash de todos os arquivos>`) e cache "imutável" de 1 ano para módulos e CSS; a página
   já lista todos os módulos (`modulepreload`) para o navegador baixar em paralelo. A página em si sempre revalida, então
   um deploy troca a versão e todo mundo baixa a nova. `STATIC_OFF=1` volta ao modo antigo (emergência).
2. **Vazamentos de memória** — telas fechadas que continuavam presas na memória por ouvintes de eventos globais:
   configurações (cada abertura deixava ~430 elementos e ~90 ouvintes), soundboard (painel e páginas das configurações),
   player da galeria de clipes e gráfico de ping. Novo `whenGone(el, fn)` (`util.js`) solta os ouvintes quando a tela sai.
   Abrir e fechar 20x agora não acumula nada.
3. **Microfones "zumbis" ao trocar o filtro de ruído** (relatado em uso): trocas rápidas deixavam montagens antigas do
   microfone ligadas — cada uma com a IA de ruído processando — o que acumulava atraso no áudio; uma delas ficava ligada até
   depois de sair da call. Agora as trocas são uma de cada vez (cliques seguidos se juntam), a montagem que ficou velha é
   desligada, e clicar no filtro já ativo não faz nada. Vale para o painel da call, o menu do botão de microfone e o teste
   das configurações (`scripts/mic-rebuild-test.mjs`).
4. **Ping medido a cada fala**: cada vez que alguém começava/parava de falar, o app fazia uma medição de ping extra
   (mensagem ao servidor + estatísticas). Agora só a medição normal de 1 s. O selo de ping/qualidade só é redesenhado quando
   o valor muda (antes 5x por segundo).
5. **Índice `messages(created_at)`**: "GIFs do grupo" com 200 mil mensagens: 15 ms -> 7 ms.

## O que foi verificado e está bem
- Sem vazamento numa call de 60 s nem trocando de canal 40x (elementos, ouvintes e memória estáveis).
- Parado no chat o app praticamente não usa CPU; o servidor ocioso usa ~0,5%.
- Timers fixos: poucos e leves (ping 1 s, qualidade da voz 3 s, relógios da call 1 s).
- Não valeu a pena carregar módulos sob demanda: com compressão e cache, o ganho seria de poucos ms.

## Clipes no chat (2026-11-04)
Relatado: abrir o chat da sala de voz num notebook fraco no Wi-Fi demorava, carregando os clipes do mais antigo ao mais
novo. Causa: cada clipe era um player de vídeo com `preload=metadata`; os clipes gravados pelo app não têm índice interno
(Cues), então o navegador baixava o arquivo **inteiro** de cada um para saber a duração.

Medido (`node scripts/clips-chat-test.mjs`, 12 clipes reais de ~3 MB + 1 vídeo comum):
| Ao abrir o chat da sala | Antes | Depois |
|---|---|---|
| Vídeo baixado | 79 MB | 0 |
| Miniaturas | — | 88 KB |
| Processamento | 740 ms | 250 ms |
| Players de vídeo | 13 | 1 (o vídeo comum, sem baixar) |

- `server/thumbs.js`: miniatura de cada vídeo gerada uma vez pelo ffmpeg (fila de 1 em 1), em `/thumbs/<arquivo>`.
- Clipes antigos (só mensagem no chat) entram na galeria ao iniciar o servidor (idempotente; quem transmitiu é achado pelo
  nome quando é único no servidor).
- Mensagem de clipe no chat = cartão leve (miniatura, título, "Ver na galeria"); o vídeo toca ali mesmo ao clicar.
- Vídeos comuns no chat: `preload=none` + miniatura. Galeria: miniaturas; o vídeo só baixa ao passar o mouse (prévia).

## Estresse, segundo plano e mutado (2026-11-11)
Medido com `node scripts/perf-stress.mjs <rótulo>`: cada pessoa num navegador separado, CPU da **árvore de processos inteira**
(inclui a thread de áudio, onde roda a IA de ruído, e o compositor — que o "TaskDuration" da página não enxerga), rede
WebRTC e mensagens do gateway. Call de 3 com RNNoise; Chromium sem placa de vídeo (compositor em software, o pior caso).
Aba escondida simulada pelo `document.hidden`.

| Medida (alice, % de um núcleo) | Antes | Depois |
|---|---|---|
| Olhando a tela da call (2 pessoas, só voz) | 73–103% | **23–26%** |
| Call, mutado (sem olhar a tela) | 13,6% | **7,4%** (a IA de ruído para) |
| Call ensurdecido + janela escondida | 24% e 133 kbps chegando | **10%** e **0 kbps** chegando |
| Depois de sair da call | contexto de áudio rodando | **2%**, nenhum contexto de áudio rodando |
| Mutar 100x + ensurdecer 51x seguidos | 181 mensagens ao servidor, ~55 mil elementos criados | **31 mensagens**, ~0 |
| Servidor, 500 pessoas no mesmo servidor (`scripts/load/node-load.mjs`) | — | API p95 ≤ 19 ms, event loop p99 36 ms, 0 erros |

### O que foi corrigido
1. **Tela da call repintando sem parar** (o maior gasto): o anel verde de quem fala tinha transição de 0,12–0,2 s no
   `box-shadow` (`extra.css`, `features.css`) e o indicador ligava/desligava a cada pausa entre sílabas. Cada troca repintava
   a página inteira por ~8 quadros; com 2–3 pessoas falando era repintura contínua. Agora o anel troca sem transição e
   "falando" só desliga depois de 300 ms de silêncio (`voice.js` `poll`), como no Discord.
2. **IA de ruído processando com o microfone mutado**: mutado (ou ensurdecido), o microfone sai da cadeia
   (`createMic` → `setIdle`) e o RNNoise/GTCRN fica sem entrada — esses nós não fazem nada sem entrada. O teste de microfone
   do painel rápido mantém a cadeia ligada enquanto está aberto (`voice.holdMic`).
3. **Ensurdecido com a janela escondida**: o servidor para de mandar a voz dos outros (consumers de `mic` pausados,
   `voice.syncVoiceFlow`); volta na hora ao mostrar a janela ou desensurdecer. Transmitindo não pausa (o clipe leva a voz).
4. **Contextos de áudio rodando à toa**: o da voz é suspenso ao sair da call; os dos sons da interface (`sounds.js`,
   `state.js` `beep`, `voice.js` `playTone`) dormem 3–4 s depois do último som. Rodando, cada um mantém a thread de áudio e
   a saída de som processando silêncio.
5. **Entrar em salas com cliques seguidos** (corrida): `join(A)` seguido de `join(B)` antes de o primeiro terminar
   deixava a pessoa **fora de qualquer sala**, com o medidor de fala (100 ms) e um microfone a mais ligados. Agora só a
   última entrada vale e sair cancela uma entrada em andamento.
6. **Câmera/tela abertas em dobro**: clicar de novo enquanto a câmera abria abria outra; só a última ficava no app e as
   outras continuavam ligadas (luz da câmera acesa) até fechar o app — 10 cliques = 9 câmeras vazadas. Agora é um pedido
   de cada vez (`voice.once`); câmera que termina de abrir depois de sair da sala é fechada.
7. **Mutar/ensurdecer em sequência**: cada toque redesenhava a lista lateral e o palco inteiros na hora e mandava um
   `VOICE_STATE`. Agora mudanças na mesma rodada viram um redesenho (`voiceUpdate`) e uma mensagem (`sendState`).
8. **Janela escondida**: quem está falando não é desenhado (um redesenho ao voltar) e o ping é medido a cada 5 s em vez de 1 s.
9. **App desktop minimizado/na bandeja era tratado como visível**: com `backgroundThrottling: false` o Electron nunca marca a
   página como escondida, então nada do que depende de `document.hidden` valia no app — inclusive a pausa do vídeo da
   transmissão assistida fora de vista (a banda inteira da transmissão continuava chegando com a janela minimizada).
   Desde o app **1.0.25** o processo principal avisa o estado real da janela (`win-state`) e `state.js` faz
   `document.hidden` refletir isso. Versões anteriores do app seguem como antes.
10. Trocar de canal rápido gerava promessas rejeitadas ("Transition was skipped") sem tratamento (`motion.js`).

### O que foi verificado e está bem
- Trocar de canal 50x, entrar/sair 15x, trocar o filtro de ruído 20x e ligar/desligar a transmissão 6x: depois da coleta
  de lixo, elementos e ouvintes voltam ao normal; no servidor sobram exatamente os transportes/producers/consumers esperados
  (e zero depois que todos saem).
- Parado fora da call: 0,6% de CPU e 0,1 mensagem/s do gateway; escondido, nenhuma.
- Rajada de 120 mensagens em ~1,7 s: 0,4 s de CPU para quem está com o canal aberto, 0,2 s com a aba escondida.
- Ainda pesa (de propósito): a call com a tela aberta ainda desenha o anel de fala e o relógio; assistir transmissão
  decodifica vídeo. Numa máquina com placa de vídeo o compositor custa bem menos do que nesta medição.
