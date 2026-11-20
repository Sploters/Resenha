# Auditoria de consumo de recursos — pedido e ponto de partida

> **Atualização (nov/2026):** a auditoria e as otimizações já foram feitas. O estado atual, os números de antes e
> depois e o roadmap estão em [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md). Este arquivo fica como o pedido original e a
> referência de antes.

Guia para quem for fazer a auditoria (outra sessão do Claude ou uma pessoa). Primeiro vem o pedido do dono do projeto,
igual ao que ele escreveu. Depois, o estado em que o código ficou, o que já foi medido e o que ainda falta conferir.

## O pedido (do dono do projeto)

> Quero realizar uma auditoria completa de otimização e redução de consumo de recursos do Resenha.
> O objetivo é tornar o aplicativo mais leve, eficiente e econômico em hardware, tanto em computadores mais modestos
> quanto no meu próprio PC. Não quero apenas reduzir o tamanho do instalador. Quero investigar tudo que possa estar
> consumindo armazenamento, RAM, CPU, GPU, VRAM, rede e bateria desnecessariamente.
>
> 1. **Dependências e arquivos**: dependências não utilizadas, duplicadas ou desnecessárias; pacotes pesados que poderiam
>    ser substituídos por alternativas mais leves; arquivos, assets, fontes, bibliotecas e binários não utilizados;
>    dependências exclusivas de desenvolvimento incluídas indevidamente na distribuição; tamanho real de cada componente
>    do instalador.
> 2. **Electron e processos**: quantidade de processos ativos; consumo individual de memória e CPU; módulos carregados
>    desnecessariamente; processos e serviços que poderiam ser iniciados sob demanda; inicialização e encerramento.
> 3. **Frontend**: JavaScript e CSS desnecessários; renderizações e atualizações excessivas; timers, polling, listeners e
>    observers; animações e efeitos que continuam trabalhando sem necessidade; uso de DOM, canvas e GPU.
> 4. **Áudio**: custo computacional de RNNoise e GTCRN; processamento redundante; recursos ativos mesmo quando não existe
>    áudio relevante; possibilidades de processamento adaptativo sem prejudicar a qualidade.
> 5. **Vídeo e compartilhamento**: captura, codificação e decodificação; uso de CPU, GPU e VRAM; buffers e cópias
>    desnecessárias; recursos que permanecem ativos depois de encerrar uma transmissão; oportunidades no pipeline Rust e
>    Electron.
> 6. **Backend e comunicação**: WebSocket, eventos, polling e sincronizações; frequência de atualização de presença;
>    consultas SQLite e operações desnecessárias; tráfego de rede redundante.
> 7. **Modos de funcionamento**: aplicativo aberto e ocioso; conectado a um servidor, sem chamada; em chamada de voz; em
>    chamada com compartilhamento de tela; com áudio de jogos ativo; com múltiplas funcionalidades simultâneas.
>
> **Como quero o resultado:** primeiro, estabeleça métricas de referência; identifique os maiores consumidores de
> recursos; separe problemas comprovados de oportunidades hipotéticas; classifique as melhorias por impacto, risco e
> esforço; estime o benefício esperado de cada otimização, sem inventar números; identifique o que pode ser removido com
> segurança e o que é essencial; apresente uma comparação entre o consumo atual e as metas possíveis.
>
> **Não faça alterações nesta etapa.**
>
> **Restrições:** preserve Electron, Rust, mediasoup e a arquitetura atual; não remova funcionalidades importantes apenas
> para reduzir tamanho; não introduza regressões em áudio, vídeo, qualidade de transmissão ou estabilidade; não proponha
> reescritas completas. Quero descobrir onde o Resenha está desperdiçando recursos e quais otimizações realmente fariam
> diferença antes de começar a implementação.

## Lições da sessão anterior (ler antes de começar)

- **Medir antes e depois de cada mudança, e antes de juntar.** A separação do `public/app.js` em 24 módulos foi juntada
  sem medir e deixou a abertura do app 6% mais pesada (643 → 681 KB). Só foi percebido depois.
- **Não exagerar números.** Foi dito que o `.git` tinha 59 MB "de binários". O histórico compactado tem 7,8 MB; o resto
  eram objetos soltos de uma cópia local. Tamanho de repositório se mede com `git count-objects -vH` (`size-pack`).
- **Custo de tokens importa para o dono.** Subagentes em paralelo gastaram muito e bateram no limite. Prefira trabalho
  direto e medições curtas.
- **Testes de ponta a ponta usam portas fixas.** Rode um de cada vez:
  `flock /tmp/resenha-tests.lock node scripts/run-tests.mjs <nomes>`.

## Estado do código nesta branch

Já feito (ver `git log`):
- **Segurança:** CSP na página (`server/security.js`; `CSP=off|report`, `CSP_EXTRA`) e 3 bugs de links no `md()`
  corrigidos (`scripts/md-unit-test.mjs`).
- **`.exe` nativos** fora do git, compilados na release (`desktop/build-native.mjs`, `.github/workflows/desktop-release.yml`).
  **A primeira release compilando no Windows do GitHub ainda não foi conferida.**
- **ESLint** (`npm run lint`) e testes rápidos (`npm run test:fast`) em todo push.
- **Docs:** README curto, índice em `docs/README.md`, histórico em `docs/historico/`.
- **`server/index.js`** dividido em `server/routes/`: 245 rotas, mesma ordem.
- **`public/app.js`** dividido em 24 módulos: ele virou só a montagem, com 125 linhas.
- **Minificação da interface** (último commit, `server/static.js` + `server/minify.mjs`): cada `.js`/`.css` da raiz de
  `public/` é minificado na subida, num processo à parte. **Os testes de navegador dessa mudança não chegaram a terminar**:
  rode `ui-test ux-test chat-rich e2ee-test mymessages clips-test vadgate-chain noise-env appaudio-worklet voicefx
  watch-test tab-lifecycle pwa` antes de confiar nela. `STATIC_MINIFY=0` desliga.

Não feito: regrupamento do CSS e organização de `scripts/`, ambos parados por custo e risco.

Decisão pendente com o dono: a permissão de cargo **"Criar convite"** não é conferida pelo servidor. Qualquer membro
convida (`POST /api/guilds/:id/invites`, agora em `server/routes/invites.js`).

## Métricas já medidas (referência)

Medidas nesta máquina de nuvem (Linux, sem GPU), 2 a 3 vezes cada. `c0e744a` é o código antes desta branch.

| Métrica | c0e744a | Agora | Como medir |
|---|---|---|---|
| Abertura do app, comprimida (brotli) | 643 KB | **520 KB** (−19%) | bytes de `/` + `<link modulepreload>` + CSS com `accept-encoding: br` |
| Abertura do app, sem compressão | 2.162 KB | 1.576 KB | idem, sem compressão |
| Arquivos baixados na abertura | 90 | 114 | conta os links da página |
| Servidor até responder | 340–515 ms | 390–445 ms | tempo até `GET /` responder |
| Memória do servidor parado (RSS, 30 s) | 88–92 MB | 89–91 MB | `/proc/<pid>/status` VmRSS |
| Histórico do git compactado | 7,8 MB | 7,8 MB | `git count-objects -vH` |

Números que já estavam no repositório (Xeon 2,1 GHz, 4 núcleos; a data não está registrada):
- `scripts/media-cpu.json`: buffer de clipes 1080p20 **+18,2% de CPU**; o modo "tap" **+0,3%**; E2EE na chamada +3,7%.
- `scripts/noise-cpu.json`: filtro de ruído padrão +0,2%, RNNoise +3,7%, **GTCRN +9,9%**.
- `scripts/perf-big-atual.json`: abrir o app 1.050 ms; trocar de canal 11 ms; dados iniciais do dono com 5 mil
  membros: 1.094 KB (56 KB comprimido). **"abrir os offline na lista de membros" = 60.026 ms**: parece o tempo limite do
  teste, não um valor real. Conferir primeiro.
- Limites do projeto em `scripts/perf-budget.json` (ex.: `open/kB` 600).

## O que falta medir (o grosso do pedido)

Nada abaixo foi medido ainda. É aqui que a auditoria começa.
- **App desktop (Electron, Windows):** processos, memória e CPU de cada um, tamanho de cada parte do instalador
  (`app.asar`, `lc-*.exe`, locales do Chromium, `ffmpeg.dll`…), inicialização e encerramento. Precisa do PC do dono ou da
  release do GitHub. O `desktop/dist/win-unpacked` local é de uma versão antiga.
- **Modos de funcionamento** (item 7 do pedido): ocioso, num servidor, em voz, transmitindo e com áudio do jogo.
- **Frontend:** timers e `setInterval`, observers, animações rodando em segundo plano. Ex.: `public/util.js` atualiza os
  horários relativos a cada 20 s. Há ferramentas prontas: `scripts/perf-audit.mjs`, `perf-soak.mjs`, `perf-inp.mjs`,
  `proc-cpu.mjs`.
- **Vídeo:** `native/lc-stream` (Rust) e `public/share.js`/`stage.js`; ver `docs/TRANSMISSAO-120FPS.md` e
  `docs/PROXIMAS-CORRECOES.md`.
- **Backend:** presença e WebSocket (`server/index.js`, gateway), consultas SQLite (`server/perf.js` grava as rotas
  lentas em `<dados>/slow.log`).

## Testes que já falham no código original neste ambiente

`ui-test` (exceção `reading 'click'`), `ux-test` (2 itens: "erro de JavaScript agrupado" e "resumo da semana"),
`pcactivity-test` (o app não abre no teste) e `community-test` (alerta de disco quase cheio da máquina de nuvem). Não
são regressões desta branch.
