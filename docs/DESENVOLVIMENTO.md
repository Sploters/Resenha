# Desenvolvimento: scripts, testes e verificação automática

Como gerar os arquivos do cliente, montar o app desktop, rodar os testes e medir desempenho. Instalação do servidor:
[INSTALACAO.md](INSTALACAO.md).

## Scripts do `package.json`

    npm start              # sobe o servidor (node server/index.js)
    npm run check          # sintaxe de todo o JS (node --check em server/, public/, desktop/ e scripts/)
    npm run build:vendor   # gera os arquivos de public/vendor (ver abaixo)
    npm run perf:budget    # compara um relatório de desempenho com os limites (ver "Desempenho e carga")

## Arquivos gerados (`public/vendor`)
O cliente do SFU fica em `public/vendor/msc/` (gerado de `mediasoup-client`): `npm install && npm run build:vendor`.
O mesmo comando gera o QR Code (`public/vendor/qr/`), o Mediabunny (`scripts/vendor-mediabunny.mjs`) e o carregador do
RNNoise da porta por voz (`scripts/vendor-rnnoise-vad.mjs`).

## App desktop
Instaladores em `desktop/dist/`: `Resenha-Setup-<versão>.exe` e `Resenha-Portable-<versão>.exe`. Regerar:
`cd desktop && npm install && npm run dist`. O controle remoto usa o programa nativo `native/lc-input` (Rust); o `.exe` já
compilado está em `desktop/native/` e entra no instalador.

Release automática (`.github/workflows/desktop-release.yml`): a cada envio para a `main` que mexe em `desktop/` (ou pelo
botão *Run workflow*), uma máquina Windows do GitHub escolhe a versão (a do `desktop/package.json` se for maior que a
última release; senão, a última + 1 no último número), confere os arquivos do app (`scripts/desktop-files-check.mjs`),
monta o instalador e o portátil, assina o instalador (`scripts/update-sign.mjs`, segredo `DESKTOP_UPDATE_KEY`; sem ele a
release não sai) e publica a release com as últimas mensagens de commit de `desktop/`. Segurança das atualizações:
[ATUALIZACOES-E-RELATORIOS.md](ATUALIZACOES-E-RELATORIOS.md).

## Testes
**Verificação automática (GitHub Actions, `.github/workflows/testes.yml`):** a cada envio, em qualquer branch, roda a verificação de sintaxe de todo o JS (~1 min). Ao enviar para a `main`, em todo pull request, com `[testes]` na mensagem do commit ou pelo botão *Run workflow* (aba Actions → Testes), roda **todos os testes de ponta a ponta**, divididos em 3 máquinas ao mesmo tempo (~15 min). O resultado aparece no commit (✅/❌) e na página da execução, com uma tabela de cada teste e o fim da saída dos que falharam. Teste que falha roda de novo uma vez; se passar na 2ª, aparece como *instável*, mas não reprova. Cada execução completa leva ~12 min e gasta cerca de 40 minutos da cota do GitHub Actions (3 máquinas) (no plano gratuito de repositório privado são 2.000 min/mês); um envio novo na mesma branch cancela a verificação anterior.

Como cada máquina é preparada (`testes.yml`): Node 22, `ffmpeg` e `xvfb` pelo apt, `yt-dlp` pelo pipx, `npm ci` na raiz e em `desktop/` (com o binário do Electron garantido), o Chrome da própria máquina (`BROWSER=/usr/bin/google-chrome`) e cache do Rust (`~/.cargo`, `native/lc-stream/target` e `native/lc-audio/target`). Cada máquina tem até 45 min.

**Na sua máquina:**

    npm run check                          # sintaxe de todo o JS (rápido, sem servidor)
    node scripts/run-tests.mjs             # todos os testes, um por vez, com resumo no fim
    node scripts/run-tests.mjs ui privacy  # só os que têm esse pedaço no nome
    node scripts/run-tests.mjs --shard 1/3 # uma parte (como no GitHub)
    node scripts/run-tests.mjs --all       # inclui os marcados como fora (off) em tests.json

Outras opções do executor: `--timeout <segundos>` (padrão 300, de `tests.json`), `--no-retry` (não repete o que falhou) e `--json <arquivo>` (salva o resultado de cada teste com o fim da saída). Sai com código 1 se algum falhar; no GitHub, o resumo vai para a página da execução.

O executor (`scripts/run-tests.mjs`) acha o navegador sozinho (Chromium do Playwright, Chrome/Chromium do sistema ou Edge; `BROWSER=<caminho>` escolhe outro), dá até 5 min para cada teste e derruba o servidor e o navegador que sobrarem. Os testes do app desktop e o `call-throttle-test` abrem janela de verdade: no Linux sem tela rodam numa tela virtual (`xvfb-run`). Precisam estar instalados: `ffmpeg`, `yt-dlp` (bot de música, sem usar o YouTube), Rust/`cargo` (transmissão nativa) e as dependências de `desktop/` (`cd desktop && npm ci`, para o Electron). Em `scripts/tests.json` ficam os testes que precisam de tela virtual, o **preparo** de cada um (bancos grandes do `scripts/load` e programas nativos em Rust, gerados na hora se ainda não existirem), o tempo de cada um (para dividir as partes) e os que estiverem fora da verificação (`off`, com o motivo). Cada teste também roda sozinho: `node scripts/ui-test.mjs` (`RTC=0` para voz em malha P2P), `node scripts/desktop-test.mjs`… Os que dependem de um servidor já rodando: `BASE=http://localhost:3000 node scripts/e2e.mjs` e `features-test`/`fase2-test` (sem `BASE`/`API`, sobem o próprio).

## Desempenho e carga
Medição da interface: `node scripts/perf-audit.mjs <rótulo>` (abertura com latência de VPN simulada, app parado no chat, call com 3 pessoas e assistindo uma transmissão; resultado em `.testshots/perf-<rótulo>.json`). Orçamento: `node scripts/perf-budget.mjs .testshots/perf-depois.json [--base .testshots/perf-antes.json] [--tol 20]` compara com os limites de `scripts/perf-budget.json` e com um relatório anterior, e sai com código 1 se algo passou do limite ou piorou.

Teste de carga (`scripts/load/`), numa pasta de dados de teste, nunca a de verdade:
```
DATA_DIR=./.loaddata node scripts/load/seed.mjs 1000                 # 1000 pessoas no mesmo servidor, 20 canais com histórico
DATA_DIR=./.loaddata PORT=3000 node server/index.js
k6 run -e BASE=http://IP-DO-SERVIDOR:3000 scripts/load/k6-resenha.js   # 100 pessoas, depois 1000 (de outro computador)
BASE=http://localhost:3000 MAX=1000 node scripts/load/node-load.mjs     # o mesmo cenário sem k6
node scripts/load/sfu-load.mjs                                         # voz: várias salas no SFU (sobe o próprio servidor)
node scripts/load/sfu-video-load.mjs                                   # vídeo pesado: 120 FPS em 1080p/1440p/4K, várias salas, sem navegador
```
Resultado de referência (4 núcleos; servidor e simulador na mesma máquina), com 1000 pessoas: abrir o app ~11 ms de trabalho do servidor por pessoa, rotas da API ~5 ms, mensagens entregues a todos em ~50 ms (p50), 0 erros. Voz (`sfu-load.mjs`, cenários `CENARIOS="8x10@1 8x10@2 1x60:3@1"` = salas x pessoas[:falando]@workers): 8 salas de 10 pessoas todas falando = 45% de um núcleo num worker (22% + 22% em dois), sala de 60 com 3 falando = 28%, 0% de perda; ~1,2% de núcleo por mil pacotes/s repassados (detalhes em `docs/historico/PLANO-DESEMPENHO.md`). Vídeo (`sfu-video-load.mjs`): um worker aguenta ~4 salas com uma transmissão 1440p120 e 5 espectadores cada (~500 Mb/s saindo); acima disso, `SFU_WORKERS`. O limite real costuma ser o upload: 1440p120 para 5 pessoas já é ~100 Mb/s.

## Novidades
Para anunciar uma atualização na janela "Novidades" (ver [RECURSOS.md](RECURSOS.md#novidades)): acrescente uma entrada no topo de `NEWS` em `public/changelog.js` com um id novo (a data).
