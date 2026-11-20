# Prompts para sessões longas do Claude

Como escrever um pedido grande (horas de trabalho, várias rodadas) que o agente consiga terminar sozinho e que dê para
conferir no fim. A estrutura vem de um prompt que circulou para cenas 3D em WebGPU; aqui ela está adaptada ao Resenha.
Tem um modelo em branco e dois prompts prontos.

## Por que a estrutura funciona

| Seção | O que resolve |
|---|---|
| **Objetivo em uma frase + corte** ("só precisa…") | Diz o que **não** fazer. Sem isso o agente cria recurso novo quando era para polir. |
| **Prioridades em ordem** | É a parte que mais muda o comportamento. Quando qualidade e desempenho brigam, a decisão já está tomada. |
| **Restrições** | Fecham os atalhos: biblioteca nova, reescrever a arquitetura, copiar o Discord. |
| **Alvo com números** | "Rápido" e "leve" viram média, p99 e máximo num roteiro fixo e numa máquina definida. |
| **Lista do que tem que aparecer** | Cada item dá para conferir olhando. Nada de "deixe bonito". |
| **Verificação em portões** | Crítico visual cego, medição por instrumento e teste automatizado. Cada um reprova sozinho. |
| **Pronto quando + entregas** | O agente não tem como dizer que acabou antes da hora. |
| **Ambiente** | Onde estão as ferramentas, onde guardar o trabalho e o que não roda aqui. |

### O crítico cego

É a peça mais importante e a mais fácil de estragar:
- É um subagente **novo a cada rodada**: não lembra das desculpas da rodada anterior.
- Vê **só** imagens (as capturas e `referencia/`) e o `PEDIDO.md`. Nunca o código, o raciocínio nem "isso é de propósito".
  Se o agente puder explicar, ele convence o crítico de que o defeito é intencional.
- Usa uma **escala fixa** (grave / médio / menor) definida em termos do que uma pessoa nota, não de código.
- **Limite de rodadas** (ex.: 5). Cada rodada custa tokens; ao parar pelo limite, o agente lista o que sobrou.
- **Um por vez, nunca em paralelo** (regra do dono em [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md)).

### Adaptações para o Resenha

- **A sessão na nuvem não tem GPU nem Windows.** O alvo medido é o Chromium sem janela do container (4 núcleos, Xeon).
  O que só dá para medir no PC do dono (app desktop, GPU, VRAM, transmissão nativa) vira "diga o comando exato que eu
  rodo"; o `scripts/medir-resenha.ps1` já existe para isso.
- **Os portões de desempenho e de teste já existem:** `scripts/perf-audit.mjs` + `scripts/perf-budget.mjs --base`,
  `npm run check`, `npm run lint`, `npm run test:fast` e `scripts/run-tests.mjs <nomes>` (um por vez, com
  `flock /tmp/resenha-tests.lock`). Ver [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md).
- **O portão visual é o `scripts/critico-capturas.mjs`** (abaixo).
- **Medir antes de mexer.** A primeira coisa da sessão é a rodada `antes` (capturas e perf), com o código como está.

## Capturas para o crítico: `scripts/critico-capturas.mjs`

    node scripts/critico-capturas.mjs antes        # rodada "antes", com o código como está
    node scripts/critico-capturas.mjs r1           # depois de cada rodada de mudanças
    SO=telas node scripts/critico-capturas.mjs r2  # só as telas (~30 s); SO=movimento só os roteiros
    ESCALA=2 node scripts/critico-capturas.mjs final   # em 2x (3840×2160), para a entrega

Ele sobe um servidor próprio numa pasta de dados de teste (`.testdata-critico`, nunca a de verdade), cria sempre o mesmo
conteúdo (6 pessoas com avatar fixo, servidor com cargos, chat com markdown, resposta, menção, imagem, link, código,
enquete e reações, DM) e captura:

| Tela | O quê |
|---|---|
| `1-chat` | Chat com histórico rico, 5 pessoas online |
| `2-chamada` | Chamada com 5 pessoas, uma transmitindo a tela (falsa, sempre igual) e uma com câmera |
| `3-assistindo` | Assistindo a transmissão em tela cheia, com os controles visíveis |
| `4-amigos` | Amigos e o painel "Ativo agora" |
| `5-cargos` | Configurações do servidor → Cargos |
| `6-chat-celular` | A tela 1 em 390×844 |

As telas 1 a 5 saem em 1920×1080. Os roteiros de movimento são `abrir-app` (do primeiro pixel até o chat assentado),
`trocar-canal`, `entrar-chamada` e `abrir-fechar-modal`, gravados pelo screencast do Chromium.

Saída em `trabalho/<rodada>/` (fora do git):
- `telas/` e `movimento/<roteiro>/` com todos os quadros e o tempo de cada um (`quadros.json`);
- `critico/`: **o único lugar que o crítico vê**. Tem as telas, uma amostra a cada 100 ms de cada roteiro, uma rajada de
  8 quadros seguidos no trecho que mais mudou, a cópia de `referencia/` (se houver) e o `PEDIDO.md`, com a escala e a
  lista de arquivos;
- `relatorio.json`: o que deu certo, o que falhou e os tempos.

Limites: os roteiros não têm passo fixo de verdade (o relógio da página corre normal), então servem para pegar salto de
layout, piscada e esqueleto sumindo de uma vez, não para medir tempo de quadro (isso é do `perf-audit`). Duas rodadas do
mesmo código saem quase iguais: mudam o horário das mensagens e a borda de alguns avatares.

**`referencia/`** (fora do git): capturas de apps cujo acabamento você quer como patamar. Valem só como nível de
espaçamento, tipografia, contraste e movimento. Nunca para copiar layout, ícone ou logotipo, e nunca entram no app.

## Modelo em branco

```text
<Objetivo em uma frase.> Só precisa <o corte: o que basta, o que NÃO é para fazer>.

PRIORIDADES (nesta ordem, quando entrarem em conflito)
1. <normalmente: não quebrar nada / nenhuma regressão em áudio, vídeo ou transmissão>
2. <o objetivo principal>
3. <desempenho / orçamento>
4. <tamanho, custo, conveniência>

RESTRIÇÕES
- <o que é proibido: biblioteca nova, reescrever arquitetura, copiar o Discord, mexer em X>
- <regras do dono: commits por assunto, push e deploy só quando eu pedir>

ALVO
- <máquina onde se mede (container: Chromium sem janela, 4 núcleos) e o roteiro fixo>
- <números: média, p99, máximo; limites do perf-budget; "não piorar contra a rodada antes">

<O QUE TEM QUE APARECER / O QUE TEM QUE ACONTECER>
- <lista de itens que dá para conferir olhando ou medindo, um por linha>

VERIFICAÇÃO
- <portão 1: crítico cego, com o que ele recebe, a escala e o limite de rodadas>
- <portão 2: medição por instrumento, antes e depois, com a ferramenta exata>
- <portão 3: testes automatizados, com os nomes>

PRONTO QUANDO: <os portões passarem>. Entregue <commits, comparações antes→depois, relatórios, revisão do crítico, o
que eu preciso rodar no Windows>.

AMBIENTE
<onde estão as ferramentas, onde guardar o trabalho (trabalho/), o que não dá para rodar aqui>
```

## Prompt 1: acabamento visual da interface

```text
Deixe a interface web do Resenha (public/) com acabamento de app de comunicação de ponta de 2026: chat, chamada e
transmissão. Não é para criar recurso novo, só para a imagem e o movimento ficarem impecáveis.

PRIORIDADES (nesta ordem, quando entrarem em conflito)
1. Não quebrar nada: nenhum teste que passa hoje pode falhar, nenhuma regressão em áudio, vídeo ou transmissão
2. Qualidade visual e de movimento
3. Desempenho dentro de scripts/perf-budget.json e sem piorar contra a medição de antes
4. Tamanho do que o cliente baixa

RESTRIÇÕES
- Sem framework novo, sem biblioteca de UI, sem fonte ou ícone de fora. Só o que já está em public/.
- Nada do Discord: nem código, nem assets, nem cópia de layout. As capturas em referencia/ valem só como patamar
  (espaçamento, tipografia, contraste, densidade, animação) e não entram no app.
- Animação só com transform/opacity (compositor). Nenhum layout ou recálculo de estilo por quadro com o app parado.
- Funcionar em todos os temas que já existem e na largura de celular (PWA).
- Não mexer na arquitetura (Electron, Rust, mediasoup). Commits por assunto. Push e deploy só quando eu pedir.

ALVO
- Chromium sem janela deste container, conteúdo fixo do scripts/critico-capturas.mjs.
- perf-audit antes e depois. perf-budget com --base no relatório de antes, sem passar de limite e sem piorar.

TELAS E MOVIMENTO
As 6 telas e os 4 roteiros do scripts/critico-capturas.mjs (docs/PROMPTS.md). Comece com
`node scripts/critico-capturas.mjs antes` e `node scripts/perf-audit.mjs antes`, antes de mexer em qualquer coisa.

VERIFICAÇÃO
- Crítico visual: a cada rodada, `node scripts/critico-capturas.mjs rN` e um subagente NOVO, um por vez, nunca em
  paralelo, que recebe só o caminho de trabalho/rN/critico/ e a instrução "leia PEDIDO.md e siga". Ele não recebe
  código, raciocínio, lista do que mudou nem explicação do que é de propósito. Itere até não haver nada acima de
  "menor", no máximo 5 rodadas. Se parar pelo limite, liste o que sobrou.
- Desempenho: scripts/perf-audit.mjs depois, e scripts/perf-budget.mjs --base no de antes.
- Funcional: npm run check, npm run lint, npm run test:fast e os testes das telas que mudaram (ui, ux, chat-rich,
  themes e os outros que tocarem no que mudou), um por vez com flock /tmp/resenha-tests.lock.

PRONTO QUANDO: os três portões passarem. Entregue os commits, as 6 telas antes e depois lado a lado
(`ESCALA=2 node scripts/critico-capturas.mjs final`), a revisão final do crítico, a tabela de desempenho antes→depois e
uma entrada em public/changelog.js.

AMBIENTE
Container Linux com Chromium e Playwright prontos, ffmpeg no PATH. Capturas e pacotes do crítico em trabalho/ (fora do
git). O que só dá para ver no app desktop do Windows: diga exatamente o que eu preciso rodar.
```

## Prompt 2: chamada e transmissão (desempenho primeiro)

```text
Faça a chamada e a transmissão do Resenha gastarem menos e se recuperarem melhor, sem perder qualidade de áudio e vídeo.
Não é para criar recurso novo.

PRIORIDADES (nesta ordem, quando entrarem em conflito)
1. Qualidade de áudio e vídeo igual ou melhor (nenhuma regressão)
2. A chamada não cair: queda de rede, troca de Wi-Fi, servidor reiniciando
3. Menos CPU e memória para quem está na chamada, assiste ou transmite
4. Menos banda

RESTRIÇÕES
- Manter mediasoup, Electron e os nativos em Rust. Nada de reescrever.
- Toda otimização medida antes e depois, com a mesma ferramenta e na mesma máquina. Se piorar algo, ela não fica.
- Separar o comprovado do estimado. O que não deu para medir aqui fica escrito como "não executado".
- Commits por assunto. Push e deploy só quando eu pedir.

ALVO (container, Chromium sem janela, 4 núcleos)
- call3/cpuPct ≤ 10, watching/cpuPct ≤ 16, streamer/cpuPct ≤ 16 (hoje o limite é 12/20/20)
- leak60s sem crescer; joinLeave15 ≤ 400 ms cada
- Queda do WebSocket de até 15 s: ninguém vê ninguém sair e a transmissão não para
- Roteiro fixo de 10 min: 3 pessoas falando, 1 transmitindo 1080p60, 2 assistindo, 2 quedas de rede simuladas,
  mute/unmute a cada 20 s

VERIFICAÇÃO
- Desempenho: perf-audit, perf-stress e perf-soak antes e depois, e perf-budget --base. Informe média, p99 e máximo da
  CPU por papel, e o crescimento da memória.
- Qualidade: getStats de quem recebe (perda, jitter, quadros por segundo, resolução, congelamentos) no roteiro de
  10 min, antes e depois, lado a lado.
- Funcional: os testes de voz, transmissão e recuperação (voice-*, call-*, screen-*, streamhealth, rejoin,
  reconnect-storm), um por vez com flock /tmp/resenha-tests.lock.

PRONTO QUANDO: o alvo for atingido e nenhum número de qualidade piorar. Entregue os commits, a tabela antes→depois, a
atualização do docs/PROXIMOS-PASSOS.md e a lista exata do que eu preciso medir no Windows, com o comando.

AMBIENTE
Container Linux com Chromium, ffmpeg e Rust. Relatórios em .testshots/ e trabalho/. Sem GPU e sem Windows aqui.
```

## Dicas

- **Todo adjetivo vira um número ou um portão.** "Fluido" fica "layoutsPerS ≤ 1 parado". "Bonito" fica "crítico sem
  nada acima de menor".
- **Prioridades antes de tudo.** Se só der tempo de escrever uma seção, é ela.
- **Não explique nada ao crítico.** Só o caminho do pacote e "leia PEDIDO.md e siga".
- **Limite de rodadas e "pronto quando" sempre juntos.** Um evita gastar demais, o outro evita parar cedo.
