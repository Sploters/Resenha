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
| (este) | Ferramentas de medição em `scripts/` e este documento | — |

Testes novos: `mute-idle-test`, `emchamada-test`, `voice-resume-test`, `updready-test`, a leitura YUV/RGB no
`black-capture-test` e `janela_wgc_que_congela_nao_fica_trocando` no `lc-stream` (`cargo test`). Cada um falha no
código antigo.

**Precisa só atualizar o servidor:** mudo/PTT, animações, memória da transmissão, diagnóstico, `em-chamada.json`,
retomada da voz. **Precisa de nova versão do app desktop:** troca WGC/DXGI, janela coberta, atualização na abertura,
instalador menor.

## Como medir (ferramentas em `scripts/`)

| Ferramenta | Mede |
|---|---|
| `perf-call-states.mjs` | CPU da chamada por estado (ligado, mutado, ensurdecido ou um estado próprio). Ex. PTT solto: `STATES="ligado:() => { const v = window.__lc.voice; v.prefs.inputMode = 'vad'; v.setPtt(false); v.applyMute(); },ptt:() => { const v = window.__lc.voice; v.prefs.inputMode = 'ptt'; v.setPtt(false); v.applyMute(); }"` |
| `perf-streamer.mjs` | Quem transmite: recálculo de estilo, layout, thread principal e CPU total |
| `perf-stream-memory.mjs` | Memória por ciclo de transmissão, com bisseção (`NOMETERS`), memória por alocador (`DUMP=1`), heap snapshot e pressão de memória simulada |
| `perf-modes.mjs` | Os modos da auditoria (ocioso, servidor, voz, transmitindo, assistindo, depois de sair) |
| `noise-cpu.mjs`, `media-cpu.mjs`, `perf-audit.mjs`, `proc-cpu.mjs` | Já existiam (IA de ruído, clipes/E2EE, abertura e telas) |
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
- **Renderizar o `AudioContext` sem dispositivo** (`setSinkId({ type: 'none' })`) custa o mesmo. Já foi testado.
- **Teste offline (`OfflineAudioContext`) não serve** para mudo/desmudo (desconectar e reconectar a fonte): use tempo real.
- **Servidor de teste órfão:** teste que cai pode deixar `node server/index.js` vivo na porta fixa, e o próximo falha
  sem motivo aparente. Confira com `pgrep -f "node server/index.js"` e `/proc/<pid>/environ` (o `pkill -f` pelo nome da
  pasta não acha: ela está no ambiente, não na linha de comando).
- **A CSP do servidor bloqueia `new Function`** em experimentos na página: suba o servidor com `CSP=off`.
- **Processo Node que mantém um servidor filho** não termina sozinho e perde a saída se for morto pelo `timeout`: use
  `process.exit` no fim.
- Testes instáveis conhecidos: `call-restart-test` (limite de 2.000 bytes de voz no passo "antes", deu 1.998 uma vez) e
  `black-capture-test` (deixa o servidor dele vivo quando falha). Testes que já falhavam neste ambiente:
  [AUDITORIA-RECURSOS.md](AUDITORIA-RECURSOS.md#testes-que-já-falham-no-código-original-neste-ambiente).

## Roadmap

### 1. Validar e fechar pendências (primeiro)
1. **Release no Windows 10 e 11**: troca WGC/DXGI, Alt+Tab com jogo em "janela sem bordas", atualização ao reabrir
   e instalador menor. Peça ao dono o `medir-resenha.ps1` antes e depois (transmitindo 5 min; mutado em chamada).
2. **Causa das quedas do WebSocket a cada ~5 min** (Windows 10, transmitindo). Já são inofensivas, mas o log do
   servidor agora tem `[voz] conexão de quem está em chamada caiu: código …; aberta havia N s`, e o diagnóstico da
   captura mostra o motivo do lado do app. Se "aberta havia" for sempre ~300 s, é proxy, túnel ou VPN com vida máxima
   de conexão: o ajuste é lá, não no app. Pergunte se o servidor usa VPN (Tailscale, ZeroTier, Radmin) ou túnel.
3. **Permissão "Criar convite"** não é conferida pelo servidor (`POST /api/guilds/:id/invites` em
   `server/routes/invites.js`): qualquer membro convida. Falha de segurança à espera da decisão do dono.
4. **Testes da minificação** que não terminaram: `ui-test ux-test chat-rich e2ee-test mymessages clips-test vadgate-chain
   noise-env appaudio-worklet voicefx watch-test tab-lifecycle pwa` (`STATIC_MINIFY=0` desliga).
5. **Primeira release com os `.exe` compilados no GitHub**: ainda não conferida.
6. **Juntar a cópia local do dono** (música) com o remoto, sem perder nada.
7. Consertar os testes instáveis acima.

### 2. Curto prazo (pequeno e seguro)
- **Contar reconexões de mídia nas estatísticas**: `voice_reconnect` e `voice_recovered` são descartados pela lista
  de eventos aceitos em `server/ux.js`. Liberar mostra as quedas de todos, não só de quem copiar o diagnóstico.
- **Modo reserva do Windows 10** (Chromium captura o monitor quando o nativo não roda): o Alt+Tab ainda mostra outras
  janelas. Aplicar a mesma regra do DXGI (`covered` em `native/lc-stream/src/capture.rs`), por exemplo pelo
  `sourceState` do app.
- **Atualização ao iniciar com o Windows** (`--hidden`): depois de instalar, reabre visível. Repassar o argumento.
- **Animações que restam**: `uoSlide` (anima `left`), `skShine` e `ns-shimmer` (`background-position`). Mesma técnica.
- **GPU e VRAM no Windows** com o `medir-resenha.ps1`.

### 3. Médio prazo (medir antes e depois; risco médio)
- **Pausar o GTCRN em silêncio longo** (porta fechada há muito tempo). Teto de ~6–7 pontos para quem usa GTCRN. Risco
  de cortar o começo das palavras: só com teste de escuta e voz real. O GTCRN é da biblioteca
  (`public/vendor/ns/gtcrn`), e a porta por voz é nossa (`public/vadgate-worklet.js`).
- **Carregar sob demanda** o JS e o CSS que a abertura não usa (76% do JS e 96% do CSS numa conta nova). Manter o
  pré-carregamento do `mediasoup-client` (é proposital). A divisão do `app.js` já piorou a abertura sem medir: medir.
- **Modo de ruído "Padrão" sem Web Audio** (ganho 100%) e "quem fala" pelo `RTCRtpReceiver.getSynchronizationSources()`:
  teto de ~12 pontos por chamada nesse modo (contexto suspenso: 20,2% → 7,9%).
- **Buffer de clipe da própria transmissão** (+18% de CPU quando `clipsOn`): levar ao caminho nativo, sem recomprimir.
- **`dxcompiler.dll`** (25,8 MB; WebGPU não é usado): só com teste no Windows, porque o Chromium pode tentar carregá-la.

### 4. Grandes atualizações
- **Atualização por diferença:** hoje cada versão baixa ~117 MB, sendo que o app (`app.asar`) tem 174 KB e os nativos
  ~5 MB. Baixar só o que mudou deixaria a maioria das atualizações em poucos MB. Mexe no atualizador próprio
  (`desktop/main.js`, `updready.js`) e na assinatura (`updatekey.js`).
- **Telemetria de desempenho real:** o "Consumo agora" do Modo leve agregado nas estatísticas por modo (ocioso, voz,
  transmitindo), para otimizar a partir do PC de quem usa.
- **Teste automático no Windows** (runner Windows no GitHub) para captura, atualização e instalador.

## Referências

- Pedido e métricas da auditoria: [AUDITORIA-RECURSOS.md](AUDITORIA-RECURSOS.md)
- Captura WGC/DXGI: [CAPTURA-WGC-DXGI.md](CAPTURA-WGC-DXGI.md) · porta por voz: [PORTA-POR-VOZ.md](PORTA-POR-VOZ.md)
- Problemas à espera de dados: [PROXIMAS-CORRECOES.md](PROXIMAS-CORRECOES.md)
