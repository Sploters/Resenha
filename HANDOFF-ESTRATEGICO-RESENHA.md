# Handoff estratégico do Resenha (22/11/2026)

Documento de passagem para a próxima sessão do Claude (outra conta). Reúne o contexto do projeto, o que foi feito nas
últimas rodadas, a avaliação estratégica e a primeira iniciativa recomendada, para continuar **sem depender do histórico
da conversa anterior**. Leia inteiro antes de começar (instruções na [seção 6](#6-instruções-para-o-próximo-claude)).

**Legenda usada em todo o documento**

- **[VERIFICADO]**: conferido no código ou no git nesta passagem (com arquivo:linha ou commit).
- **[DECISÃO]**: decisão já tomada pelo dono ou combinada em rodada anterior. Não rediscutir sem motivo novo.
- **[PROPOSTA]**: ideia ou desenho ainda não implementado. Nada aqui existe no código até alguém implementar.
- **[SUPOSIÇÃO]**: não confirmado; confira antes de depender disso.

Os números de linha valem para o commit em que este documento entrou; se o código mudar, procure pelo nome da função.

---

## Sumário

1. [Contexto do projeto](#1-contexto-do-projeto)
2. [Histórico recente de desenvolvimento](#2-histórico-recente-de-desenvolvimento)
3. [Avaliação estratégica](#3-avaliação-estratégica)
4. [Primeira iniciativa: registro de sessões e "Desde a última vez"](#4-primeira-iniciativa-registro-de-sessões-e-desde-a-última-vez)
5. [Próximas oportunidades](#5-próximas-oportunidades)
6. [Instruções para o próximo Claude](#6-instruções-para-o-próximo-claude)

---

## 1. Contexto do projeto

### 1.1 Objetivo e visão

O Resenha é um app de chat, voz, vídeo e transmissão de tela **auto-hospedado**, com layout inspirado no Discord (sem
código nem assets do Discord), feito para **um grupo de amigos que joga junto**. O servidor roda na casa do dono (Umbrel,
Docker) e os amigos entram pela VPN (Tailscale/Hamachi/Radmin), pelo app desktop para Windows ou pelo navegador.

Objetivo de produto atual: fazer os amigos **preferirem o Resenha ao Discord** e **abrirem o app com frequência**, inclusive
quando ninguém chamou. A avaliação da seção 3 mostra o que falta para isso.

### 1.2 Stack e arquitetura [VERIFICADO]

| Parte | Onde | Detalhes |
|---|---|---|
| Servidor | `server/` (55 arquivos + `server/routes/`) | Node ≥ 22.5, Express 4, `ws` 8, `node:sqlite` (WAL), mediasoup 3.32. Dependências de produção: só `esbuild`, `express`, `mediasoup`, `ws` (`package.json`). `npm start` = `node server/voz.js`. |
| Processo da voz | `server/voz.js` | Processo pai que mantém o SFU (mediasoup) e roda o app (`server/index.js`) como filho: atualizar o app reinicia só o filho (~2 s) e as chamadas continuam. |
| SFU | `server/sfu.js` | Codecs: Opus, VP8, H.264 High e Baseline (`sfu.js:11-15`). `SFU_WORKERS` padrão 1 (`sfu.js:20,72`). `AudioLevelObserver` no servidor para "quem fala" de quem está ensurdecido (`sfu.js:201-207`). |
| Gateway e estado | `server/index.js` (~1.360 linhas longas, ~110 KB) | Estado da voz em memória: `const voice = new Map()` (canal → pessoas), `index.js:93`. Cobre canais de servidor **e** chamadas de DM. |
| Banco | `server/db.js` + tabelas criadas pelos próprios módulos | Migração por `CREATE TABLE IF NOT EXISTS` e `addCol()` (ALTER TABLE ADD COLUMN que ignora erro, `db.js:103`). Não há número de versão de esquema. Lista de tabelas na seção 4.2. |
| Cliente | `public/` (128 arquivos `.js`, ESM sem framework) | Entregue com versão por arquivo (`server/static.js`, ver 2.1). `window.__lc` expõe estado e módulos para os testes. |
| App desktop | `desktop/` | Electron 45 (`desktop/package.json`, versão 1.0.40 no arquivo; releases publicadas pelo CI já passaram de 1.0.54). Só Windows (NSIS e portátil). Atualização automática com assinatura (`updatekey.js`, `updready.js`). |
| Nativos (Rust) | `native/lc-input`, `native/lc-stream`, `native/lc-audio` | Entrada (PTT global, controle remoto, ViGEmBus), transmissão a 60/120 FPS pela GPU (H.264), áudio do jogo e do app. Só Windows em execução; `cargo test` roda no Linux. |
| Deploy | `deploy/umbrel.sh`, `deploy/servidor.sh` | Menor reinício possível (só interface, só app ou container). Skill `.claude/skills/deploy/SKILL.md`. **Não fazer deploy sem pedido explícito.** |
| CI | `.github/workflows/testes.yml`, `windows-testes.yml`, `desktop-release.yml` | Release do desktop quando `desktop/` ou `native/` mudam na `main`. |
| Testes | `scripts/` (166 `*test*.mjs`), `scripts/run-tests.mjs`, `scripts/tests.json` | Puppeteer-core com Chromium. Detalhes em 1.6. |

### 1.3 Funcionalidades já implementadas [VERIFICADO no README e em `docs/RECURSOS.md`]

- **Servidores:** categorias, canais de texto, voz, fórum, anúncios, galeria e documento; cargos, permissões por categoria e
  canal, convites, emojis e soundboard do servidor, eventos com Vou/Talvez, auditoria, reputação (anti-spam).
- **Mensagens:** markdown, respostas, reações, menções, anexos de até 500 MB com retomada, enquetes, mensagens de voz,
  tradução, busca (FTS5), encaminhar, importar conversa do Discord.
- **DMs** com chamadas e criptografia de ponta a ponta (mensagens, arquivos e chamadas 1:1).
- **Voz:** SFU com malha P2P de reserva, RNNoise e GTCRN, porta guiada por voz, PTT com o jogo em foco, efeitos de voz,
  moderação de voz, recuperação automática (conexão, ICE, microfone que morre).
- **Transmissão:** até 1440p/original, áudio só do jogo, 60/120 FPS pela GPU no desktop, clipes (F8) com galeria, ranking
  semanal e controle remoto.
- **Atividades na chamada:** Watch Together (YouTube, links, sincronização assistida de Netflix/Prime/Crunchyroll) e bot
  de música.
- **Jogos:** "Jogando…" pelo PC, cartão da Steam, biblioteca e wishlist com alerta de promoção, conquistas, "O que jogar
  hoje?", LFG, "A fim de jogar" (intenções), painel "Ativo agora" com "A semana da galera".
- **Jogar junto (Remote Play):** entrar como jogador 2–4 com o próprio controle, mouse e teclado, janela Jogadores,
  painel Desempenho, mouse travado (etapas 1–6 de `docs/REMOTE-PLAY.md`).
- **App desktop:** bandeja, atalhos globais, modo leve automático com jogo aberto, atualização assinada.
- **Para quem hospeda:** saúde do servidor com alertas (`ALERT_WEBHOOK`, ex.: ntfy), estatísticas anônimas de uso
  (`server/ux.js`, `server/social.js`), limites e expiração de arquivos, cópias do banco.

### 1.4 Estado dos principais sistemas [VERIFICADO]

| Sistema | Estado |
|---|---|
| Voz | Estável e testada. Recuperação de queda, ICE e microfone morto (`public/voice.js`, `public/micwatch.js`). Bug de mudo vazando ao remontar o microfone corrigido em `d451cd7`. |
| Transmissão 120 FPS / captura nativa | Compilada e testada no Linux; **não exercitada no Windows** (`docs/TRANSMISSAO-120FPS.md:43`). `captura-metodo-test` falha no passo 11 desde `47b22d8` (não investigado). |
| Jogar junto | Etapas 1–6 feitas. **Falta validação com 2 PCs reais** (`docs/REMOTE-PLAY.md` §6/§8). Comandos vão pelo WebSocket (TCP); DataChannel só se a medição justificar. ViGEmBus fixado na v1.22.0 (`desktop/remote.js:177`). |
| Watch Together | Funciona; YouTube real e Netflix/Prime ainda pedem validação manual (`docs/WATCH-TOGETHER.md`). |
| Bot de música | Funciona e volta depois de o worker do SFU morrer (`9fbc97f`, `music-worker-test`). Vigia de travamento novo (`8e0749c`). Ver 2.4 sobre o redesenho não integrado. |
| Banco e dados | Verificação na abertura, cópias automáticas verificadas, restauração (`server/backup.js`, `92cbaad`). |
| Atividade e presença | Histórico de jogos **apaga depois de 30 dias e passa de 200 eventos por pessoa** (`KEEP_DAYS = 30, KEEP_PER_USER = 200`, `server/activity.js:23`, apagamento em `:63-64`). |
| Sessões de voz | **Não são registradas.** Só contagens anônimas por dia (`server/social.js:56-71`, chamado de `server/index.js:638`). |
| Notificações fora do app | **Não há Web Push.** `public/sw.js` (49 linhas) só trata `install`/`activate`/`fetch`. No PC, a bandeja do desktop. No celular, nada. |

### 1.5 Infraestrutura e ambiente de execução [VERIFICADO]

- Servidor de produção: Umbrel na casa do dono, Docker (`Dockerfile`), dados em `~/resenha-data` (`DATA_DIR`).
- Rede: os amigos entram pela VPN. O ICE usa STUN do Google; TURN só se `TURN_URL` estiver definido (`server/index.js:666-669`).
  A Tailscale pode cair em relay DERP (mais atraso, `docs/BANDA-E-LATENCIA.md`).
- Portas: 3000/3443 TCP, 40000 UDP+TCP (voz), 40001–40010 UDP (transmissão nativa: no máximo 10 ao mesmo tempo).
- **O upload da casa do dono é o teto** de transmissão (cada espectador custa a banda inteira).
- Chaves opcionais: sem `STEAM_API_KEY` ficam de fora biblioteca, conquistas e "O que jogar hoje?" (`docs/CONFIGURACAO.md`).
- Ambiente das sessões do Claude: container Linux na nuvem, **efêmero** (o que não estiver no GitHub se perde quando o
  container é reciclado), sem GPU nem Windows. Chromium em `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.

### 1.6 Testes: como rodar [VERIFICADO]

- **Portas fixas:** os testes de ponta a ponta usam portas fixas. Rode um por vez:
  `flock /tmp/resenha-tests.lock node scripts/run-tests.mjs <nomes>`. A bateria inteira é `node scripts/run-tests.mjs`
  (≈ 60 min, 164 testes no `tests.json` da última rodada).
- Para rodar em paralelo (ex.: em worktrees), copie o teste trocando `PORT`, `RTC_PORT` e `DATA_DIR`.
- **Não use `| head` num teste:** o servidor de teste fica órfão e segura a porta (ver "Lições" em `docs/PROXIMOS-PASSOS.md`).
- `npm run check` (`scripts/check.mjs`) confere sintaxe e imports.
- **Lint:** `npm run lint` chama `eslint .`, mas o ESLint **não está instalado** em `node_modules` deste ambiente. Na
  sessão anterior ele foi instalado à parte (eslint 9 numa pasta temporária, com cópia de `eslint.config.js`). Linha de
  base: 0 erros, 4 avisos em scripts de teste não mexidos.
- `docs/DESENVOLVIMENTO.md` tem os scripts, `docs/PROXIMOS-PASSOS.md` tem as ferramentas de medição e as lições.

### 1.7 Decisões técnicas e restrições que não devem ser ignoradas [DECISÃO]

1. **Preservar Electron, Rust, mediasoup e a arquitetura.** Nada de reescrever tudo nem trocar de framework.
2. **Qualidade e estabilidade primeiro:** nenhuma regressão em áudio, vídeo ou transmissão. Otimização que piora algo sai.
3. **Medir antes e depois**, com a mesma ferramenta e na mesma máquina, sem exagerar números. Separar comprovado de estimado.
4. **Push, merge e deploy só com autorização explícita do dono**, a cada vez. Autorização anterior não vale para a próxima rodada.
5. **Não mexer na `main`.**
6. **Não mexer no stash `wip-musica-antigo-local` nem na branch `musica-junta`** sem pedido (ver 2.4).
7. **Não enfraquecer testes** (subir timeout, tirar verificação) para fazer passar: achar a causa real.
8. Privacidade: nada é analisado por IA no servidor; telemetria só em contagens anônimas e respeita quem desligou
   "Enviar estatísticas de uso" (`PRIVACIDADE.md`, `server/social.js:1-3`). Qualquer dado novo por pessoa precisa entrar
   no `PRIVACIDADE.md`.
9. Commits e comentários **em português**, por assunto, com a atribuição exigida pelo ambiente; sem identificador de modelo.
10. Textos da interface em português, no tom do app. Fade entre telas foi rejeitado pelo dono (troca seca).
11. Lição do microfone: `Producer.replaceTrack` do mediasoup-client força `track.enabled = !paused`; depois de trocar a
    trilha, chamar `applyMute()` (`d451cd7`). `producer.pause()` desliga a trilha (quadro preto); para parar o envio sem
    mexer na trilha use `rtpSender.replaceTrack(null)`.
12. Mudança de preferência de trabalho: o `docs/PROXIMOS-PASSOS.md` diz "sem subagentes em paralelo" (preferência antiga).
    **Nas rodadas de 22/11 o dono pediu explicitamente multiagente com worktrees**, e é isso que vale agora (seção 6).

---

## 2. Histórico recente de desenvolvimento

Branch de trabalho até aqui: `claude/hopeful-johnson-0xr9us`. Esta branch (`claude/jolly-galileo-cin4x4`) foi criada a
partir dela em `145c3bb` e contém tudo. A `origin/claude/jolly-galileo-cin4x4` antiga (`b150ac0`) era ancestral: nada
se perdeu. Commits anteriores a 20/11 estão em `docs/PROXIMOS-PASSOS.md` ("O que foi feito").

### 2.1 Rodadas de 21 e 22/11/2026 [VERIFICADO no git]

**Jogar junto (21/11):** `558277a` linha de base de latência (`scripts/remote-latency.mjs`); etapas 1–6: `de443af`
comandos sem fila de 16 ms, `6daf3d0` participação única, `9d6dde4` "Pedir para jogar" e janela Jogadores, `1e9bdc7`
perfil de jogo a 60 FPS, `936e1ee` painel Desempenho, `6c4e4eb` mouse travado; `b6f0391` jogador 2–4 com o próprio controle.
Medido em container: comando → tela ≈ 57 ms na LAN e ≈ 110 ms com WAN simulada de 25 ms, a 60 FPS (`docs/REMOTE-PLAY.md` §7).

**Outros de 21/11:** `47b22d8` Valorant em janela sem bordas; `38ad009` testes sem o alerta de disco cheio; `9fbc97f` bot
de música volta ao SFU; `7a38037` Watch Together com playlists do YouTube; `dc404cd` microfone se recupera quando a captura
morre.

**Sprint de confiabilidade (22/11, 5 agentes em paralelo):**

| Commit | Área | O que entrou |
|---|---|---|
| `92cbaad` / `49f54b6` | Banco | `quick_check` na abertura (`DB_CHECK`, `DB_ON_CORRUPT=stop`), `closeDb()` com `wal_checkpoint(TRUNCATE)`, `server/backup.js` (cópia online verificada, rotação `BACKUP_HOURS`/`BACKUP_KEEP`, CLI copiar/listar/verificar/restaurar), `deploy/servidor.sh` com cópia parada. Teste `backup-unit-test`. |
| `69d8ff3` / `702ffe5` | Segurança e diagnóstico | Atualizador mais rígido (`desktop/main.js`: redirecionamentos, limites de tamanho/tempo, nome do instalador, nova conferência do hash antes de rodar), `server/log.js` (log estruturado com redação e anel de 500 eventos), `GET /api/health/diag` e "Baixar diagnóstico". Teste `log-diag-test`. |
| `f13a053` / `b2df1af` | Memória | Poda de canais fora da tela (`public/chat.js`), limite de blobs E2EE, URLs de objeto liberadas, `pruneHits` nos limites do servidor, varredura de caches. Teste `leaks-unit-test`. |
| `8992ef3` / `83fbd05` | Voz | `resume()` com contador de geração, `linkDown()`, reinício de ICE um por transporte, pedidos ao SFU falham na hora sem conexão. Teste `voice-recover-unit-test`. |
| `8e0749c` / `620b4ae` | Processos | Vigia de travamento dos workers do SFU (`SFU_HANG_MS`), do app filho (`VOZ_APP_HANG_MS`), do bot de música (`MUSIC_STALL_MS`) e dos nativos. Testes `sfu-recover`, `voz-vigia`, `music-stall`, `helper-hang-unit`. |

**Investigação do `mic-dead-test` (22/11) → `d451cd7`** (já enviado ao GitHub):
- Causa real 1: o teste lia o nível de áudio uma vez a cada ~250 ms e entrava em fase com o bipe do microfone falso do
  Chrome (≈ 0,5 s). Agora amostra dentro da página a cada 10 ms por 500 ms, com o mesmo limiar e a mesma janela.
- Causa real 2 (bug do app): ao remontar o microfone com o mudo ligado, a trilha nova saía **ligada** (o `replaceTrack` do
  mediasoup-client a religava). Correção: `applyMute()` depois da troca (`public/voice.js`, `rebuildOnce`).
- Causa real 3 (bug do app): `syncVoiceFlow` entrava em laço de pedidos `levels`/`pause` porque `modDeaf` começava
  `undefined`. Correção: `!!((this.deafened || this.modDeaf) && !this.screen)`.
- Resultado: `mic-dead-test` 10/10 depois da correção.

**Quatro frentes de melhoria (22/11, 4 agentes em worktrees):**

| Commit | Frente | O que entrou |
|---|---|---|
| `744c391` / `8ebf75d` | UX | Busca rápida (Ctrl+K) com setas/Tab, prioridade com busca vazia (menções, não lidas, recentes em `localStorage.lc_qs_recent`), busca sem acento, prefixos `#` `!` `@` `*`, ARIA (`public/userbar.js`). Contador nos últimos 500 caracteres e texto colado com mais de 4.000 caracteres vira `mensagem.txt` (`public/composer.js`). Teste `quickswitch-test`. |
| `095b4b6` / `113b434` | Social | Lista de amigos com jogo, sala e "Entrar" (`public/home.js`); aviso "jogando o mesmo que você" (`sameGameCheck`, `public/activity.js`), opção `prefs.sameGameAlert`. Teste `friends-presence-test`. |
| `73fcabb` / `51c02fa` | Voz | Aviso "Você está mutado" ao falar mutado (`talkMutedStep` em `public/micwatch.js`, `public/voicenote.js`), avisos de microfone caindo/voltando/sem som, opção `prefs.mutedTalkWarn`. Testes `talkmuted-unit-test`, `muted-talk-test`. |
| `42d30c5` / `d81567c` | Desempenho | Versão por arquivo na interface (`server/static.js`: mapa `vers`, hash por componente fortemente conexo de Tarjan para módulos que se importam, `<meta name="lc-lazy">`, versão anterior do arquivo mudado continua servida). Medido: 1ª abertura depois de um deploy **121 pedidos / 583 KB / 1.791 ms → 35 / 171 KB / 1.434 ms**; mudar só CSS: 8 pedidos / 17 KB. Testes `static-vers-test`, `perf-deploy`. |
| `2009796` | Integração | Novidade `2026-11-22-1` no `public/changelog.js`, número formatado no aviso de texto longo, nome do jogo ao passar o mouse. |
| `145c3bb` | Teste | `static-vers-test` escolhe o módulo pelo grafo de imports e exige o conjunto exato de arquivos que mudam (o teste antigo supunha que só um arquivo importava o `changelog.js`; o `gateway.js` importa e meio app importa o `gateway.js`). |

### 2.2 Testes executados e resultados [VERIFICADO nesta sessão]

| Quando | Resultado |
|---|---|
| Sprint de confiabilidade (base `fa5e1ff` + 5 agentes) | 60 de 62 (os 2 que falharam: `mic-dead-test`, investigado e corrigido em `d451cd7`; `ui-test`, instável, passou ao repetir) |
| `mic-dead-test` depois de `d451cd7` | 10 de 10 |
| Bateria completa depois de `d451cd7` | 158 de 159 (só `captura-metodo-test`) |
| Testes direcionados das 4 frentes | 22 de 22 |
| **Bateria completa sobre tudo integrado (`d81567c`)** | **162 de 164**: `captura-metodo-test` (antigo) e `static-vers-test` (corrigido em `145c3bb`; passou 4 vezes seguidas sozinho; lint limpo) |

Instáveis já vistos neste ambiente (passam ao repetir, por disputa de CPU ou porta): `ui-test`, `streamhealth-test`,
`voice-network-test`.

### 2.3 Problemas conhecidos e limitações [VERIFICADO salvo indicação]

1. **`captura-metodo-test` falha no passo 11** ("nativo falhou com jogo em TELA CHEIA → quem assiste vê pelo Chromium")
   desde `47b22d8`. Não investigado. Comparar com uma worktree num commit anterior.
2. **Nada do Windows foi exercitado** nesta máquina: lc-stream a 120 FPS, troca WGC/DXGI e Alt+Tab, modo reserva do
   Windows 10, mouse travado, atualização ao iniciar com o Windows. Lista completa em `docs/PROXIMOS-PASSOS.md`
   ("O que depende do dono").
3. **Quedas do WebSocket a cada ~5 min** com alguém transmitindo no Windows 10 (suspeita de VPN/túnel; o log do servidor
   já registra "aberta havia N s"). `docs/PROXIMOS-PASSOS.md`, roadmap 1.2.
4. Tudo que é nativo (Remote Play, PTT global, áudio de jogo, 120 FPS) é **só Windows**; Mac, Linux e navegador ficam com menos.
5. ViGEmBus é driver de terceiro fixado na v1.22.0 [SUPOSIÇÃO: o projeto foi descontinuado pelo autor; conferir].
6. A transmissão nativa tem no máximo 10 portas (10 transmissões ao mesmo tempo).
7. **Já resolvido (não repetir como pendência):** "a grade da chamada se reorganiza 3 vezes ao entrar e os quadros ficam
   pretos". Foi corrigido na 3ª passagem (`43a66b9`, `cd73dee`; `docs/PROXIMOS-PASSOS.md` "Acabamento e pendências").
   Um dos agentes da avaliação apontou isso como pendente por ler um trecho antigo do documento.

### 2.4 O que está integrado e o que precisa de validação

- **Integrado e testado no Linux:** tudo da seção 2.1.
- **Precisa do dono (Windows, 2 PCs, ouvido):** jogar junto com 2 PCs e redes diferentes; nova versão do app desktop
  (mouse travado, modo reserva); `medir-resenha.ps1` antes e depois; teste de escuta do GTCRN pausado.
- **Música do dono, NÃO integrada:**
  - Branch local `musica-junta` (`78daba6`, 20/11): "Música de cara nova (alterações locais do dono juntadas com o
    remoto)": `public/music.css` novo, `public/music.js`, `server/music.js`, `docs/MUSICA.md`. **Deixada de lado a pedido
    do dono** (`docs/PROXIMOS-PASSOS.md`, roadmap 1.6). Não está nesta branch.
  - Stash `wip-musica-antigo-local` (21/11): as alterações originais do dono que não estavam em commit.
  - **Atenção:** os dois existem só no repositório local desta máquina (o container da sessão anterior). Numa conta
    nova eles não estarão disponíveis, a menos que o dono os publique. Não recriar nem juntar sem pedido.
- **Envio ao GitHub:** a branch antiga `claude/hopeful-johnson-0xr9us` foi enviada até `145c3bb`. Esta branch
  (`claude/jolly-galileo-cin4x4`) e o commit deste documento **não foram enviados** nesta passagem (o dono pediu sem push).

---

## 3. Avaliação estratégica

Feita em 22/11 com 4 agentes em paralelo (produto e social; comunicação e multiplayer; diferenciação; auditoria técnica),
só leitura do código. As afirmações principais foram conferidas no código pelo coordenador. Notas de 1 a 5;
**esforço** P = até 3 dias, M = 4–10 dias, G = mais de 10 dias para uma pessoa.

### 3.1 Diagnóstico

**O Resenha é ótimo quando todo mundo está online e não oferece nada no resto do tempo.** Na chamada ele já está à frente
do Discord (120 FPS, ruído, recuperação de microfone, clipes, jogar junto). Três falhas de estrutura tiram o motivo de
abrir o app sem alguém ter chamado:

1. **Não guarda memória.** Histórico de jogo apagado depois de 30 dias / 200 eventos (`server/activity.js:23,63-64`);
   sessões de voz viram só contagens anônimas (`server/social.js:56-71`). Não há registro de quem esteve em qual chamada,
   com quem e por quanto tempo. **Cada dia sem isso é memória perdida para sempre.**
2. **Não mostra o que aconteceu enquanto você estava fora.** Com ninguém online a Home mostra "Tudo quieto por aqui…"
   (`public/activity.js:618`). O servidor já calcula e envia a linha do tempo dos amigos (`feedFor` devolve
   `{ friends, events }`, `server/activity.js:164-176`), mas **o cliente nunca lê `feed.events`** (só `feed.week`,
   `public/activity.js:481`). [VERIFICADO]
3. **Não alcança ninguém com o app fechado.** Sem Web Push (`public/sw.js`, 49 linhas). É isso que segura o Discord no
   celular de todo mundo.

### 3.2 As 15 melhores ideias, por potencial [PROPOSTA]

| # | Ideia | Valor | Frequência | Migração | Diferenciação | Esforço | Custo |
|---|---|---|---|---|---|---|---|
| 1 | Registro de sessões e resumo diário permanente (base do resto) | 5 | 4 | 3 | 5 | P/M | 1 |
| 2 | "Desde a última vez" na Home | 5 | 4 | 4 | 4 | P/M | 2 |
| 3 | Aviso no celular (ntfy primeiro, Web Push depois) | 5 | 4 | 5 | 1 | P → M | 2 |
| 4 | Sobreposição no jogo sem injeção (quem fala, mudo, aviso) | 5 | 5 | 4 | 4 | M | 2 |
| 5 | "A fim de resenhar" (convite sem jogo definido) | 4 | 4 | 3 | 4 | P | 1 |
| 6 | Momentos (2+ pessoas apertam F8 juntas → clipe coletivo) | 4 | 4 | 3 | 4 | P/M | 2 |
| 7 | Livro de pérolas e "clipe vira som" | 4 | 4 | 4 | 4 | P/M | 1 |
| 8 | Qualidade da conexão de cada pessoa na chamada | 4 | 4 | 3 | 4 | P | 1 |
| 9 | Agenda "Hoje e esta semana" e eventos que se repetem | 4 | 3 | 3 | 3 | P/M | 1 |
| 10 | Jogar junto em 1 clique (cartão na sala) | 4 | 3 | 5 | 5 | M | 3 |
| 11 | "Resenha da semana" como ritual de segunda-feira | 4 | 2 | 3 | 5 | P | 1 |
| 12 | "Nesta data" (memórias de 1 ano atrás) | 4 | 4 | 2 | 5 | P* | 1 |
| 13 | Salas mostrando o que acontece nelas (vídeo, música, transmissão) | 3 | 4 | 3 | 3 | P | 1 |
| 14 | Sussurro e canal de time (2ª tecla, prioridade de quem fala) | 4 | 3 | 4 | 5 | M | 2 |
| 15 | "O que a gente joga hoje?" cruzando a biblioteca de quem está na sala | 4 | 4 | 3 | 3 | P | 1 |

\* Esforço pequeno, mas só vale com ~1 ano de dados: mais um motivo para começar a guardar já.

Evidências e dependências de cada uma [VERIFICADO onde há arquivo:linha]:

1. Só se sabe que uma sessão começou e acabou (`social.onVoice`, `server/social.js:56`). Falta a tabela de participantes e
   o resumo diário. Detalhes na seção 4.
2. Reaproveita `feed.events` (já enviado e descartado), clipes da semana (`server/clipstats.js`), conquistas e eventos.
   Precisa de 1 para "ficaram 2h na Geral".
3. Começa barato com ntfy: o webhook já existe para o administrador (`server/alerts.js`; digest de segunda em
   `server/ux.js:205-212`). Web Push precisa de chaves VAPID, HTTPS válido e, no iPhone, da PWA instalada.
4. A janela transparente, sempre no topo, sem foco e fora da captura já existe em `desktop/clipflash.js:55-65`
   (`setAlwaysOnTop(true, 'screen-saver')`); o aviso do remoto usa a mesma técnica (`desktop/remote.js:118`). Não aparece
   em tela cheia exclusiva, só em janela sem bordas. Hoje o app diz "A Resenha não injeta nada no jogo, então não há
   overlay" (`public/lite.js:148`): o texto precisa mudar junto.
5. O servidor recusa intenção sem jogo (`'Escolha o jogo'`, `server/intents.js:54`). Convite, formação e "mais tarde" já existem.
6. `clips` já tem `streamer_id`, `channel_id`, `created_at` (`server/db.js:183-188`). Agrupar é fácil; montagem automática
   exige ffmpeg no servidor (já está na imagem Docker por causa do bot de música, segundo o README).
7. Reações, FTS de mensagens, soundboard (`sounds`, `server/db.js:165`) e recorte de clipe (`public/cliptrim.js`) existem.
8. O SFU já tem a nota de cada consumidor (`server/sfu.js:338,372`); a tela só mostra o próprio ping (`public/ping.js`);
   o cliente mede perda e jitter (`public/callqual.js`). "Ping por pessoa" desmarcado em `docs/CHECKLIST-CONCORRENTES.md`.
9. Eventos presos por servidor (`GET /api/guilds/:id/events`, `server/events.js:93`); a tabela `events` não tem repetição
   (`server/events.js:28-32`); "mais tarde" das intenções é um segundo jeito de marcar horário.
10. Depende da validação do jogar junto com 2 PCs (`docs/REMOTE-PLAY.md`). Reaproveita `REMOTE_INVITE`, `gameProfile`,
    convites para a chamada (`server/callinvites.js`).
11. "A semana da galera" (`weekFor`, `server/activity.js:233`) existe, mas fica no fim do painel (`weekSections()`).
12. Depende de 1 e do resumo permanente.
13. O sinal do Watch Together já chega à lista lateral (`public/side.js:266`), mas o cartão da sala ignora (`roomLine`,
    `public/activity.js:286`).
14. O PTT global aceita uma tecla só (`public/ptt.js`, `desktop/main.js:464-468`): precisa de nova versão do app.
15. `game_library`, `wishlist`, promoções com "outros que querem" (`server/games.js:34-51,237`).

**Descartadas de propósito [DECISÃO da avaliação]:**
- Transcrição/resumo das chamadas por IA: invasivo, mata a espontaneidade, pesa no Umbrel e contradiz o `PRIVACIDADE.md`.
- Detecção automática de risadas/picos: exige gravar sempre, muitos falsos positivos. O F8 coletivo dá o mesmo sinal com consentimento.
- XP, níveis, sequência de login, rankings de pessoas: motivo artificial e atrito num grupo pequeno.
- Feed estilo rede social (posts, stories): vira obrigação e depois cidade fantasma. O feed mostra o que o grupo **fez**.
- Mini-jogos embutidos; VP9/AV1 (ganho não comprovado, custo de CPU); Netflix sincronizada de verdade (DRM/Widevine).

### 3.3 As 5 com mais potencial de diferenciação

1. **Registro de sessões e memórias** (1, 2, 12): só existem com servidor próprio, grupo fechado e histórico sem limite. É
   o que pode virar a identidade do Resenha.
2. **Momentos** (6): transforma o melhor recurso do app (F8 e 120 FPS) em memória do grupo.
3. **Sobreposição sem injeção** (4): a do Discord injeta no jogo e briga com anti-cheat; a do Resenha é uma janela por cima.
4. **Jogar junto em 1 clique** (10): o Discord não tem; o Steam Remote Play Together faz, mas fora da conversa.
5. **Pérolas e "clipe vira som"** (7): fábrica de piadas internas; no Discord exige bot externo e upload manual.

### 3.4 As 5 de maior impacto com pouco esforço

1. **Mostrar `feed.events` na Home** (o servidor já envia; falta desenhar). Tira a Home do vazio antes mesmo do item 1.
2. **Salas mostrando o que acontece nelas** (13): o dado já chega ao cliente.
3. **Qualidade da conexão de cada pessoa** (8): nota já calculada no SFU; ~2–3 dias.
4. **"A fim de resenhar"** (5): tirar a exigência de jogo e trocar a regra de quem é chamado.
5. **Aviso no celular pelo ntfy** (1–2 dias, reaproveitando `server/alerts.js`): testa se aviso fora do app traz gente de
   volta antes de investir em Web Push.

### 3.5 Melhorar o que já existe antes de criar

- **Validar no Windows** o que já foi entregue (lista em 2.3) e investigar o `captura-metodo-test`: é o recurso que mais
  diferencia o app e está sem prova real.
- **Quedas do WebSocket a cada ~5 min** transmitindo (2.3, item 3).
- **"A semana da galera" escondida** no fim do painel; o "Ativo agora" vira gaveta atrás de um ícone em tela estreita ou
  no celular (`public/home.js:88`).
- **Perfil fragmentado:** a aba Atividade do perfil ignora o jogo (`public/usermenu.js:89`); jogos e wishlist só pelo
  clique direito (`public/usermenu.js:215`).
- **Conquistas sem eco:** `ACHIEVEMENTS_UPDATE` vai só para o dono (`server/achievements.js:134`). Conquista rara poderia
  virar cartão com "GG". Sincronização automática a cada 24 h (`AUTO_EVERY`, `server/achievements.js:28`), 40 jogos.
- **Eventos e "mais tarde"** não se conversam: unificar antes de criar uma agenda nova.
- **Buffer de clipe da própria transmissão** desligado por padrão (padrão `'others'`, `public/settings.js:898`). O custo
  caiu para ~+0,5 ponto de CPU em 1080p30 (`2c676a7`). Sem buffer não há Momentos: reavaliar o padrão (medindo).
- Já resolvido, não reabrir: grade da chamada tremendo ao entrar (2.3, item 7).

### 3.6 Roadmap [PROPOSTA]

**Curto prazo (2–4 semanas): dar motivo para abrir o app**
- Registro de sessões de voz e resumo diário permanente, com opção de não aparecer (seção 4).
- "Desde a última vez" na Home, começando pelo `feed.events` já pronto.
- Aviso no celular pelo ntfy (1ª fase).
- Ganhos rápidos: salas com contexto, qualidade por pessoa, "A fim de resenhar".
- Em paralelo: investigar `captura-metodo-test`; preparar o roteiro de validação no Windows para o dono.

**Médio prazo (1–3 meses): consolidar a identidade**
- Sobreposição sem injeção; Momentos; pérolas e "clipe vira som".
- Agenda unificada e eventos recorrentes; "Resenha da semana" como ritual.
- Jogar junto validado com 2 PCs e, depois, o cartão "Jogar junto".
- Web Push de verdade, se o ntfy provar que o aviso funciona.

**Longo prazo (mais de 3 meses): o que cresce com o tempo**
- "Nesta data" e retrospectiva mensal e anual.
- Sussurro e canal de time; redundância de áudio para rede ruim (Opus RED), depois de medir.
- 3 ou 4 automações fixas ("quando 3+ entram jogando X…"), sem editor genérico.

### 3.7 Recomendação: o que fazer primeiro e por quê

**Registro de sessões junto com o "Desde a última vez"**, seguido do aviso pelo ntfy.

1. É a única decisão com prazo: memória não guardada não volta.
2. Ataca o problema principal: Home vazia ensina que não vale abrir; Home com "a galera ficou 2h jogando CS2 ontem, com 2
   clipes" dá motivo para entrar e vontade de estar na próxima.
3. Barato e de baixo risco: metade existe (`feed.events`, `weekFor`, `clipstats`, regras de privacidade). Não depende do
   Windows nem de release do desktop. Não pesa no Umbrel se o resumo for calculado com antecedência.
4. Destrava 5 das 15 ideias (memórias, retrospectiva, Momentos, perfil "nós dois", dupla da semana).
5. Dá para medir o efeito: `server/social.js` já conta retornos e o motivo (`return`, `return_acted`).

Dois alertas: toda entrada nova da linha do tempo passa pelas mesmas regras de privacidade (`canSee`, `priv`, modo
invisível); e nada de ranking de pessoas, só o grupo e duplas.

---

## 4. Primeira iniciativa: registro de sessões e "Desde a última vez"

**Tudo nesta seção é [PROPOSTA], exceto o que está marcado [VERIFICADO].** Não foi implementado nada.

### 4.1 Objetivo

Guardar para sempre, de forma enxuta e respeitando a privacidade, **quem esteve em cada chamada de grupo, quando, por
quanto tempo e o que aconteceu nela** (jogos, clipes, vídeos, evento associado), e usar isso para:
- a faixa **"Desde a última vez"** no topo do "Ativo agora" (Home);
- o resumo diário permanente que alimenta "Nesta data", retrospectivas, Momentos e o perfil "nós dois" no futuro.

Critério de sucesso: a Home deixa de ficar vazia para quem abre depois de horas fora, e `return`/`return_acted` em
`server/social.js` mostram se mais gente volta. Medir antes de mudar.

### 4.2 O que existe hoje [VERIFICADO]

- **Estado da voz em memória:** `voice` (`server/index.js:93`): `channelId → Map<userId, {ws, mute, deaf, video, screen, bot?}>`.
  Inclui chamadas de DM (`server/index.js:689`).
- **Gancho de entrada/saída:** `socialVoice(cid, joined)` (`server/index.js:634-639`) chama `social.onVoice(cid, people, …)`
  a cada entrada e saída, com `people` sem bots (`voicePeople`). `onVoice` detecta início (2+), pico e fim (<2) da sessão,
  mas só grava contagens (`server/social.js:56-71`). `activity.onVoice(uid)` marca que a pessoa está em call para as
  horas de jogo (`server/index.js:759,1028`).
- **Jogos:** `activities` (`server/db.js:172-175`): `game_start`/`game_stop` com `data.seconds` = segundos em call
  (`server/activity.js:17,70`). Apagado após 30 dias / 200 por pessoa (`server/activity.js:23,63-64`).
- **Clipes:** `clips(id, guild_id, channel_id, message_id, author_id, streamer_id, title, url, size, secs, has_audio,
  created_at)` (`server/db.js:183-188`). Não guarda quem estava na call. `clipGame` deduz o jogo do clipe
  (`server/activity.js`, procure `clipGame`). Clipes ficam no aparelho por padrão até alguém enviar (`public/cliplocal.js`).
- **Eventos:** `events(…, guild_id, channel_id, game, appid, starts_at, duration_min, started_at, cancelled_at …)` e
  `event_rsvps` (`server/events.js:28-37`).
- **Intenções:** `play_intents(…, channel_id, formed_at, ended_at …)` e `intent_members` (`server/intents.js:32-45`);
  `intents.isIntentRoom(cid)`.
- **Watch Together:** `watch_history(guild_id, service, ref, url, title, …, by_id, at)` (`server/index.js:775`), por
  servidor, sem canal nem sessão.
- **Privacidade:** `canSee(viewer, owner, platform)` (`server/activity.js:40-47`): modo invisível, `presenceOk`
  (`server/privacy.js`), `pc_activity` (`'servers'|'friends'|'off'`), `linked_accounts.visibility`; `priv` por evento;
  `hiddenGame` (`game_prefs.hidden`). "A semana da galera" soma sem identificar quem escondeu (`weekFor`, `anon`).
- **Feed:** `feedFor(viewer)` (`server/activity.js:164-176`) devolve `events` de 7 dias já filtrados por `canSee`, `priv`,
  `hiddenGame` e launchers. Rota em `server/routes/activity.js:61-64`. O cliente não usa `events`.
- **Home vazia:** `public/activity.js:618` ("Tudo quieto por aqui…"); "Ativo agora" montado em `public/activity.js`
  (seções `now`, `forMe`, `srv`, `weekSections()`).
- **Telemetria anônima:** `social_daily` some depois de 60 dias e respeita quem desligou "Enviar estatísticas de uso".
- **Tabelas existentes** (para não colidir nomes): em `server/db.js` users, sessions, guilds, roles, members,
  member_roles, channels, dm_participants, messages, messages_fts, reactions, invites, relationships, read_states, emojis,
  bans, audit_log, mentions, meta, sounds, linked_accounts, activities, game_prefs, clips, clip_favs, clip_shares,
  clip_views, polls, poll_votes, lfg_posts, lfg_requests, lfg_profiles, lfg_messages, game_icons, friend_losses, gif_favs;
  nos módulos ux_daily, ux_seen, ux_user, ux_meta, ux_first, rep_flags, rep_cases, e2ee_keys, imports, social_daily,
  events, event_rsvps, play_intents, intent_members, media_favs, media_fav_cats, ach_games, ach_unlocks, ach_info,
  ach_sync, ach_manual, watch_history, clip_watch, clip_likes, game_library, wishlist, game_sync, game_prices,
  deal_alerts, forum_posts, forum_votes, channel_perms, music_playlists. **Atenção:** `sessions` já existe (tokens de
  login): use outro nome, por exemplo `voice_sessions`.

### 4.3 Registro permanente de sessões e participantes [PROPOSTA]

Escopo: **só canais de voz de servidor**. Chamadas de DM ficam de fora por padrão (são 1:1 e cifradas; registrar
contradiz a promessa das DMs protegidas). Sessão = período com **2+ pessoas (sem bots)** na sala, a mesma regra de
`social.onVoice`.

Esboço de tabelas (nomes livres, conferir colisões):

```sql
CREATE TABLE IF NOT EXISTS voice_sessions(
  id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,            -- sem FK com CASCADE: a sala apagada não deve apagar a memória (decidir)
  channel_name TEXT,                   -- nome na época (a sala pode ser renomeada ou apagada)
  started_at INTEGER NOT NULL, ended_at INTEGER, peak INTEGER NOT NULL DEFAULT 2,
  intent_id TEXT, event_id TEXT,       -- associação com intenção/evento, quando houver
  summary TEXT                         -- JSON calculado no fim: jogos, nº de clipes, vídeos, músicas (cache)
);
CREATE INDEX IF NOT EXISTS voice_sessions_guild ON voice_sessions(guild_id, started_at DESC);
CREATE TABLE IF NOT EXISTS voice_session_members(
  session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, secs INTEGER NOT NULL DEFAULT 0, -- soma dos trechos
  PRIMARY KEY(session_id, user_id));
CREATE INDEX IF NOT EXISTS voice_session_members_user ON voice_session_members(user_id, first_at DESC);
```

Regras:
- Gancho único: estender `socialVoice` / `social.onVoice` (ou criar `server/sessions.js` chamado do mesmo lugar) para
  abrir a sessão ao chegar a 2+, somar trechos de cada pessoa e fechar ao cair para <2. **Não espalhar chamadas pelo
  `index.js`.**
- Gravar com o mínimo de escritas: uma linha ao abrir, atualização por pessoa ao sair, fechamento no fim. Nada por segundo.
- **Reinício do app (deploy):** o `voice` é memória do app filho; as chamadas continuam no `voz.js` e os clientes retomam
  (`resume`). Ao subir, sessões com `ended_at IS NULL` não podem ser fechadas na hora: dar uma carência (ex.: 2–3 min) para
  os clientes voltarem e reaproveitar a sessão aberta da mesma sala; depois disso, fechar com `last_at` dos membros.
- Sessões muito curtas (ex.: < 3 min) podem ser descartadas no fechamento para não poluir.
- Bots (bot de música) não contam nem viram membros.

### 4.4 Associação de jogos, clipes e eventos [PROPOSTA]

- **Jogos:** derivar dos `game_start`/`game_stop` dos membros dentro da janela da sessão, já filtrando por `canSee` na
  leitura (não gravar o jogo de quem escondeu). Como `activities` expira em 30 dias, o resumo da sessão (`summary`) deve
  guardar no fechamento só agregados: jogo → minutos e nº de pessoas, **sem** nomes de quem está invisível/oculto.
- **Clipes:** associar por `channel_id` + `created_at` dentro de `[started_at, ended_at]`. Alternativa: `addCol('clips',
  'session_id', 'TEXT')` preenchido na criação; clipes antigos ficam com `NULL` (sem retroativo forçado).
- **Eventos e intenções:** se a sala é a `channel_id` de um evento que começou (`events.started_at`) ou de uma intenção
  formada (`play_intents.formed_at`), gravar `event_id`/`intent_id` na sessão.
- **Watch Together e música:** hoje `watch_history` não tem canal nem sessão e o histórico do bot fica em memória (30
  faixas, `server/music.js`). Para o resumo, contar "vídeos assistidos" e "músicas tocadas" durante a sessão a partir dos
  eventos que o próprio servidor já despacha (só contagens e títulos, sem quem pediu, se quiser ser conservador).

### 4.5 Resumo diário permanente [PROPOSTA]

Para não depender de `activities` (30 dias), gravar um agregado diário por pessoa e jogo:

```sql
CREATE TABLE IF NOT EXISTS activity_daily(
  day TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, game_id TEXT NOT NULL, title TEXT,
  secs_call INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, user_id, platform, game_id)) WITHOUT ROWID;
```

- Preencher no `game_stop` (`server/activity.js`, onde hoje grava `data.seconds`), com `INSERT … ON CONFLICT DO UPDATE`
  (mesmo padrão de `social_daily`).
- Dia no fuso do servidor (o `weekFor` já trata fuso: reaproveitar a mesma função).
- Respeitar `hiddenGame` e `priv` na **leitura** (e não gravar o que a pessoa escondeu de propósito).
- Tamanho esperado: poucas linhas por pessoa por dia; desprezível no SQLite.

### 4.6 Experiência "Desde a última vez" na Home [PROPOSTA]

- Faixa curta (3–6 itens) no topo do "Ativo agora" quando a pessoa volta depois de um tempo fora (ex.: 2 h). Exemplos:
  "Ana, Beto e Caio ficaram 2h10 na Geral jogando CS2 · 2 clipes"; "Evento sexta 21h marcado"; "Grupo de Valorant formou
  sem você"; "Clipe mais visto da semana".
- **Fase 0 (sem tabela nova, ganho rápido):** desenhar o `feed.events` que o servidor já envia (jogos dos amigos dos
  últimos 7 dias), agrupado por pessoa/jogo, no lugar de "Tudo quieto por aqui…".
- **Fase 1:** endpoint (ex.: `GET /api/activity/since?t=`) ou campo novo em `feedFor` que junta sessões encerradas desde a
  última visita, clipes, eventos marcados e intenções formadas, **pré-calculado no fechamento da sessão**.
- "Última visita": guardar por pessoa no servidor (ex.: em `users.settings` ou tabela própria), não só no navegador, para
  valer entre aparelhos.
- Cada item com ação: Entrar na sala, Ver clipe, Vou ao evento.
- Fechar/dispensar a faixa; não repetir o que a pessoa já viu.
- Celular/tela estreita: o "Ativo agora" hoje é gaveta (`public/home.js:88`); a faixa precisa aparecer também ali.

### 4.7 Privacidade e controles de visibilidade [PROPOSTA, com base VERIFICADA]

- **Quem vê uma sessão:** só membros do servidor da sala, e **só os participantes que essa pessoa pode ver**. Quem está em
  modo invisível ou com presença restrita (`presenceOk`) aparece como "+1 pessoa", nunca pelo nome.
- **Jogos da sessão:** sempre por `canSee(viewer, owner, platform)`, `priv` e `hiddenGame`, como `feedFor` já faz.
- **Opção nova por pessoa:** "Guardar minhas sessões no histórico do grupo" (ligada por padrão, decidir com o dono), em
  Configurações > Privacidade. Desligada: a pessoa não entra como membro nas sessões (só conta no pico, anônima).
- **Apagar:** a pessoa pode apagar a própria participação; o administrador pode apagar uma sessão.
- **Sem minutagem de fala, sem "quem falou mais", sem ranking individual.**
- DMs fora do registro.
- **Atualizar `PRIVACIDADE.md`** (tabela "o que é guardado") no mesmo commit da funcionalidade.
- Quem saiu do servidor ou desfez amizade: não aparece mais para quem perdeu o vínculo (há `friend_losses`).

### 4.8 Migrações seguras e compatibilidade [PROPOSTA, mecanismo VERIFICADO]

- Seguir o padrão do projeto: `CREATE TABLE IF NOT EXISTS` no módulo dono e `addCol()` para colunas novas
  (`server/db.js:103`). Sem apagar nem reescrever tabelas existentes.
- **Sem retroativo inventado:** não há dados antigos de sessões; o histórico começa no deploy. Opcional: preencher
  `activity_daily` a partir dos `activities` dos últimos 30 dias, uma vez, marcando em `meta` que já foi feito.
- **Não mexer na retenção de `activities`** (continua 30 dias / 200): o permanente fica no agregado.
- O backup (`server/backup.js`) já copia o banco inteiro: as tabelas novas entram sem mudança. Conferir com
  `backup-unit-test`.
- Consultas pesadas fora do caminho do gateway: o SQLite é síncrono e trava o event loop; resumo calculado no fechamento
  da sessão e guardado (`summary`), leitura com índice e `LIMIT`.
- Compatibilidade de clientes: campo novo em resposta existente é ignorado por clientes antigos; o desktop não precisa
  de release (tudo é servidor + `public/`).

### 4.9 Dependências técnicas e riscos

- **Dependências:** `server/social.js` (gancho de sessão), `server/index.js` (`voice`, `socialVoice`), `server/activity.js`
  (`canSee`, `feedFor`, `weekFor`, `game_stop`), `server/clipstats.js`, `server/events.js`, `server/intents.js`,
  `server/privacy.js`, `public/activity.js` e `public/home.js` (Home), `public/settings.js` (opção de privacidade),
  `PRIVACIDADE.md`.
- **Riscos:** sensação de vigilância (mitigar com 4.7); sessões fantasmas após reinício (4.3); duplicar sessão quando a
  mesma sala cai para 1 e volta a 2 em segundos (usar carência curta antes de fechar); custo de escrita (mínimo); cadeia
  de testes (`tests.json`) com portas fixas.
- **Testes sugeridos:** unitário sem navegador para abrir/fechar/somar trechos/carência de reinício (no estilo de
  `scripts/voice-recover-unit-test.mjs`); teste de ponta a ponta com 3 contas (uma invisível) conferindo o que cada uma
  vê; teste de privacidade (opção desligada); `backup-unit-test`; o `friends-presence-test` e o `quickswitch-test` para
  não quebrar a Home.

---

## 5. Próximas oportunidades [PROPOSTA]

Detalhes de pontuação na seção 3.2. Base no código indicada; nada implementado.

- **Aviso no celular.** Fase 1: ntfy por pessoa (tópico próprio), reaproveitando `server/alerts.js`, para "grupo formou",
  convite para a chamada e evento em 30 min (os despachos já existem em `server/intents.js`, `server/callinvites.js`,
  `server/events.js`). Fase 2: Web Push no `public/sw.js` com VAPID (sem dependência nova, ou uma pequena), HTTPS válido
  no Umbrel [SUPOSIÇÃO: Tailscale HTTPS/MagicDNS resolve o certificado]; iPhone só com a PWA instalada (iOS 16.4+).
- **Sobreposição no jogo sem injeção.** Janela do Electron como `desktop/clipflash.js` (transparente, sem foco,
  `setIgnoreMouseEvents`, fora da captura) com quem fala, mudo/PTT e o aviso "falando mutado" (`public/voicenote.js`).
  Detectar jogo em primeiro plano com `desktop/frontwatch.js`. Limitação: não sobre tela cheia exclusiva. Precisa de
  release do desktop e teste no Windows; medir GPU com `medir-resenha.ps1`.
- **Momentos coletivos.** 2+ pessoas diferentes apertam F8 em ~20 s na mesma sala → um "Momento" agrupando os clipes
  (ângulos de cada transmissão). Base: `clips.streamer_id/channel_id/created_at`. Montagem no fim da noite com ffmpeg:
  depois, medindo CPU e disco. Depende de o buffer de clipe estar ligado (3.5).
- **Livro de pérolas e "clipe vira som".** Reação reservada ou menu "Guardar pérola" → mural com autor, data, jogo e
  sessão; o autor da mensagem pode retirar. Recorte de 1–5 s do áudio do clipe → som do soundboard (`sounds`,
  `public/cliptrim.js`).
- **Retrospectivas.** "Resenha da semana" (cartão de segunda-feira publicável num canal, reaproveitando `weekFor`, as
  categorias de `server/clipstats.js` e o agendador de segunda de `server/ux.js:205-212`), mensal e anual. Só grupo e
  duplas, nunca "quem menos apareceu". Depende do resumo permanente (4.5) e das sessões (4.3).
- **"Nesta data".** Cartão "1 ano atrás: 4h de Valheim com A, B e C; clipe mais visto; mensagem mais reagida". Opção
  "não mostrar este dia"; excluir quem saiu (`friend_losses`). Depende de 4.3/4.5 e de tempo de dados.
- **Conquistas ao vivo e desafios do grupo.** Conquista rara (< ~5%) durante a call vira aviso na sala e entra no
  histórico; "GG" em 1 clique por DM. Base `ach_unlocks`/`ach_info` (`server/achievements.js:31-40`). Limitação: Steam
  só sincroniza a cada 24 h e por jogo (cota), perfil precisa ser público.
- **Agenda e rituais.** "Hoje e esta semana" juntando eventos de todos os servidores e intenções "mais tarde"; eventos
  recorrentes com sequência **do grupo** ("12 quintas seguidas"), cartaz (`server/eventart.js`).
- **"A fim de resenhar".** Intenção sem jogo (`server/intents.js:54`), chamando amigos online/compatíveis por horário.
- **Qualidade por pessoa na chamada.** Nota/perda/transporte de cada um com dica acionável ("está em relay da
  Tailscale"), a partir de `server/sfu.js:338,372` e `public/callqual.js`, sem expor IP, atualizando a cada ~5 s.
- **Jogar junto em 1 clique.** Cartão "Fulano abriu Overcooked · 2 vagas · Entrar como Player 2", juntando detecção de
  jogo, perfil de jogo, convite e janela Jogadores. Só depois de validar com 2 PCs; ler controle a 8 ms ou por
  `requestAnimationFrame` (`public/remote.js:200`); vibração do ViGEm para quem joga.
- **Sussurro e canal de time.** 2ª tecla de PTT para falar só com algumas pessoas (pausar consumers por pessoa no SFU,
  como a moderação já faz); orador prioritário. Precisa de nova versão do `lc-input`.
- **Voz em rede ruim.** Opus RED quando a nota cai (o SFU não declara `audio/red`, `server/sfu.js:11-15`) [SUPOSIÇÃO:
  a versão do mediasoup repassa RED]. Medir com `bandwidth-audit.mjs` e perda simulada.
- **Salas com contexto.** Mostrar no cartão da sala o vídeo do Watch Together, a música do bot e quem transmite qual jogo.
- **"O que a gente joga hoje?" por sala.** Interseção da biblioteca de quem está na sala, wishlist em promoção e "faz 3
  meses que vocês não jogam X" (este último depende de 4.5).
- **Regras da casa (automações).** Só 3–4 receitas fixas, nunca editor genérico.

---

## 6. Instruções para o próximo Claude

1. **Trabalhe exclusivamente na branch `claude/jolly-galileo-cin4x4`.** Não crie outra branch de trabalho sem pedido.
2. **Leia este documento inteiro antes de começar**, depois `docs/PROXIMOS-PASSOS.md` (lições e roadmap técnico) e
   `docs/README.md` (índice). Não há `CLAUDE.md`; a skill de deploy está em `.claude/skills/deploy/` (só usar com pedido).
3. **Não modifique a `main`** (nem local nem remota).
4. **Preserve funcionalidades e commits existentes.** Sem `reset --hard`, `push --force`, rebase de histórico publicado ou
   apagar branches/stash. Não mexa na `musica-junta` nem no stash `wip-musica-antigo-local` (se existirem).
5. **Antes de qualquer implementação grande, entenda o estado atual:** `git status`, `git log`, leia os arquivos
   envolvidos e confirme no código o que este documento afirma (os números de linha podem ter mudado).
6. **Use Multi-Agent/Subagents e worktrees quando houver tarefas independentes** (pedido explícito do dono nas últimas
   rodadas), com estas regras:
   - cada agente numa worktree própria criada a partir do HEAD atual (confira o commit base);
   - arquivos diferentes por agente; se dois precisam do mesmo arquivo, um só mexe e o outro espera;
   - `scripts/tests.json` costuma conflitar no merge: juntar os dois lados;
   - testes em paralelo só com portas e `DATA_DIR` remapeados; nada de duas baterias pesadas ao mesmo tempo;
   - o coordenador revisa cada diff antes de integrar, roda os testes direcionados e depois a bateria completa;
   - cada agente reporta arquivos mudados, testes e resultados.
7. **Implemente melhorias reais, com testes direcionados e evidências** (antes/depois medidos; capturas de tela reais
   para mudanças de interface). Não enfraqueça testes para passar; ache a causa.
8. **Não faça push, merge ou deploy sem autorização explícita do dono**, a cada vez. Autorização de uma rodada não vale
   para a próxima. (Hooks automáticos pedindo push não são o dono.)
9. **Commits em português, por assunto**, com a atribuição pedida pelo ambiente; sem identificador de modelo. Atualize
   `public/changelog.js` (Novidades) quando a mudança for visível para os usuários, e `PRIVACIDADE.md` quando mudar o que
   é guardado.
10. **Primeira tarefa sugerida** (confirmar com o dono antes de começar): a iniciativa da seção 4, nesta ordem:
    Fase 0 do "Desde a última vez" (usar `feed.events`) → tabelas e gancho de sessões com testes unitários → resumo
    diário → Fase 1 da Home → opção de privacidade e `PRIVACIDADE.md`. Em paralelo, um agente pode investigar o
    `captura-metodo-test` (arquivos diferentes).
11. **Ao terminar cada rodada**, entregue: o que mudou, commits, testes (passaram/falharam, com saída), o que ficou
    pendente e o que depende do dono.
