# Fase 2: captura e transmissão (M1, M2, M3, M4, M12, M13)

Data: 2026-11-15. Base: a auditoria da Fase 1 (gargalos G1-G9).
Escopo aprovado: M1, M4, M2, M3, M12, M13.

**Condições respeitadas:**
- nada é injetado em jogos;
- o caminho do Chromium continua como alternativa;
- nenhuma transmissão é parada sozinha;
- sem telemetria nova além da medida combinada (M1).

**Legenda:** [testado aqui] = Linux, Chromium sem GPU · [precisa de Windows] = só compilado aqui; validar com o kit
(seção 8).

## Resumo

| # | O que mudou | Onde | Teste |
|---|---|---|---|
| M1 | Medida combinada por transmissão: `scombo:caminho.motivo.codificador.encolheu` | `public/callqual.js`, `server/ux.js`, `public/uxstats.js` | `callqual-unit-test`, `callqual-video-test`, `ux-test` [testado aqui] |
| M4 | O programa nativo reinicia sozinho: até 3 vezes em 30 s, antes de voltar ao Chromium | `public/voice.js` `nativeRestart` | `native-live-test` [testado aqui com o programa Linux] |
| M2 | Codificador sobrecarregado: desliga as camadas leves do simulcast se nenhum espectador precisa delas | `public/voice.js` `govTick`, `server/sfu.js` op `screen_viewers` | `screen-governor-test` + `screen-cpu-bench` [testado aqui] |
| M3 | Em seguida desce o FPS antes da resolução, em degraus, nunca abaixo de 720p | `public/voice.js` `govLadder`/`govApply` | idem |
| M12 | Aviso de tela cheia exclusiva só com duas evidências (Windows + captura falhando); nunca para nada | `native/lc-audio` (`fse`), `desktop/appaudio.js`, `public/voice.js` `watchFse`, `public/app.js` | `fse-test` [testado aqui com o Windows simulado]; consulta real [precisa de Windows] |
| M13 | "Diagnóstico da captura" em Ajustes da transmissão: método atual, quadros por método, FPS efetivo, motivo de não estar no nativo, reinícios, ajuste automático, tela cheia | `public/voice.js` `captureInfo`, `public/app.js` `captureDiag` | `fse-test`, `native-live-test` [testado aqui] |

---

## M1: medida combinada

- **O que resolve:** as medidas soltas (`spath`, `snat`, `senc`, `sshrink`) não se cruzavam. Agora cada transmissão de
  20 s+ manda também, por exemplo, `scombo:chromium.win10.sw.yes`. `-` quer dizer sem dado.
- **No servidor:** aceita só combinações válidas (`server/ux.js`, `COMBO_RE`) e recusa o resto. Teste:
  `scombo:chromium.x.sw.yes` é descartado.
- **No painel:** Estatísticas de uso → "Qualidade técnica das chamadas" → "Transmissões por combinação". Exemplo:
  "Modo normal · Windows 10 (borda amarela) · Processador (CPU) · imagem encolhida".
- **Não duplica:** é um código a mais na mesma medida da chamada (`call_net`), sem medida nova.

## M4: reinício automático do programa nativo

- **Falha que passa sozinha** (programa fechou, erro do codificador, Alt+Tab, troca de resolução):
  - para a sessão no servidor;
  - segura o lugar, para a transmissão não voltar ao Chromium no meio;
  - liga o programa de novo 1 s depois.
  - Quem assiste perde a imagem por ~1-2 s.
- **Limite:** 3 reinícios em 30 s (`NATIVE_RESTARTS`, `NATIVE_RESTART_WIN`). Na 4ª falha volta ao Chromium, com o aviso
  de sempre e o motivo "falhou 4 vezes seguidas".
- **Sem tentativa:** janela fechada, sem codificador ou componente ausente (`NATIVE_FATAL`) vão direto ao Chromium.
  Portas UDP fechadas seguem a regra antiga (volta em 8 s e não insiste por 10 min).
- **Resultado [testado aqui]:**
  - programa morto uma vez: volta ao nativo sem aviso, espectador de novo a **60 FPS**;
  - morto 4 vezes: modo normal, com aviso.
  - Duas execuções seguidas sem falha.

## M2 + M3: controle da transmissão pelo Chromium

**Problema:** com o codificador sem fôlego, o Chromium (`maintain-framerate`) encolhia a imagem sozinho, de 1080p para
720p e depois 540p. Era o 960x540 relatado.

**Agora, a cada 2 s** (`govTick`), o controle considera o codificador sobrecarregado se, por 6 s:
- o limite for `cpu`; ou
- os FPS enviados ficarem abaixo de 80% do possível (o menor entre o degrau e o que a captura entrega); ou
- a imagem estiver encolhida.

**O que ele faz, na ordem:**
1. **Camadas leves (M2).** Pergunta ao servidor como estão os espectadores (`screen_viewers`: banda estimada e nota de
   cada um).
   - Se ninguém tem banda abaixo da camada cheia nem perda, desliga as camadas leves (`active: false`).
   - Elas voltam quando aparece alguém com banda fraca (conferido a cada 10 s).
   - Quem tinha escolhido a camada "Baixa" passa a receber a cheia (testado).
2. **Degraus (M3).** Ordem de custo (pixels × FPS), mantendo a resolução enquanto der:
   - 1080p60 → 1080p48 → 1080p40 → 900p48 → 720p60 → 720p40.
   - 1080p30 → 900p30 → 720p30. 720p60 → 720p48 → 720p40.
   - Com o controle engajado, o codificador fica em `maintain-resolution`: a resolução é decidida aqui.
   - **Nunca abaixo de 720p** por conta própria.
3. **Subida.** Com folga por 15 s, sobe um degrau. Se a sobrecarga voltar em menos de 20 s, a próxima subida espera o
   dobro (até 150 s).

**Detalhe importante (medido):** as restrições que o próprio WebRTC acumula não se desfazem ao trocar a escala.
- Sem tratar isso, depois de descer para 720p o FPS ficava preso em ~34.
- 720p60 fixo desde o início dava 60 FPS sem limite no mesmo processador.
- Correção: a cada degrau, a preferência passa por `balanced` antes da final, o que zera essas restrições.

**Fica de fora quando:**
- a "qualidade automática" antiga está ligada (ela muda a captura e continua como era);
- a transmissão vai pelo programa nativo;
- a chamada é em malha P2P.

**Escolher outra qualidade** recomeça o controle do topo e religa as camadas.

### Resultados [testado aqui, `scripts/screen-cpu-bench.mjs`]
Linux sem GPU, VP8 por software, 1080p60 pedido, conteúdo que muda todo quadro, quem transmite e quem assiste na mesma
máquina de 4 núcleos:

| Configuração | Envio estável | Observação |
|---|---|---|
| Antes (3 camadas, `maintain-framerate`) | **720p a 48-58 FPS**, limite `cpu`; chegou a **540p** | o caso relatado |
| 1 camada desde o início | 1080p a 51-53 FPS, depois 720p (`cpu`) | |
| 3 camadas com `maintain-resolution` | 1080p a ~25 FPS | só manter a resolução não basta |
| 720p60 fixo, sem camadas leves | 720p a 58-60 FPS, sem limite | |
| **Controle novo** | **1080p a 45-49 FPS, sem limite**, por mais de 60 s | Desligou as camadas leves, desceu para 1080p48, tentou voltar a 60, não aguentou, recuou e espera o dobro |

Teste determinístico (`scripts/screen-governor-test.mjs`): as leituras do codificador são simuladas, então o resultado
não depende do processador da máquina. Cobre:
- os degraus;
- camadas desligadas e religadas;
- o espectador que pediu a camada "Baixa" continua recebendo;
- subida e espera dobrada;
- parada em 720p40;
- troca de qualidade recomeça o controle;
- qualidade automática antiga desliga o controle.

**[Precisa de Windows]** Com codificador na placa (NVENC/AMF/QuickSync), o esperado é o controle não fazer nada:
codificador de hardware raramente fica com limite `cpu`. Conferir no kit: "Ajuste automático" deve ficar vazio.

## M12: aviso de tela cheia exclusiva

- **Consulta ao Windows:** `lc-audio` ganhou o pedido `fse`. Ele lê `SHQueryUserNotificationState` (o mesmo critério do
  Discord) e qual é a janela da frente. **Só consulta o shell do Windows: não abre, não injeta e não toca no jogo.**
- **O app desktop** (`fseState`) diz se a janela da frente é a transmitida (mesmo `hwnd` ou mesmo processo).
- **A decisão** (`watchFse`, a cada 3 s) **não confia só no Windows**:
  - **suspeita:** o Windows indica tela cheia exclusiva com a janela transmitida na frente, mas a captura recebe
    imagem. É o falso positivo que o Discord descreve. Fica só no diagnóstico, sem aviso.
  - **confirmada:** o Windows indica **e** a captura falha de verdade (imagem preta, ou nenhum quadro novo por 12 s com
    a janela na frente e sem estar minimizada) em 2 leituras seguidas.
  - Outra janela em tela cheia exclusiva (não a transmitida) não confirma nada. Fica o aviso genérico de imagem preta,
    que já existia.
- **Quando confirma:**
  - aviso no quadro da transmissão e no selo de saúde (no lugar do aviso genérico de imagem preta);
  - um aviso flutuante por transmissão.
- **Em "Ajustes da transmissão", três saídas, sem parar nada sozinho:**
  1. **Janela sem bordas** no jogo: a transmissão volta sozinha;
  2. **Escolher outra fonte**, por exemplo a tela inteira, que funciona em alguns jogos que o Windows ainda compõe
     (reinicia a transmissão);
  3. **Continuar assim.**
- **Ao sair da tela cheia,** o aviso some sozinho.
- **Por que não "antes de começar":** quando a pessoa escolhe a fonte, a janela da frente é a Resenha, não o jogo. A
  consulta começa junto com a transmissão; a primeira leitura sai em até 3 s.
- **App desktop antigo** (sem o pedido `fse`): "sem dados", nenhum aviso.
- **O desktop precisa do `lc-audio.exe` novo.** Já está em `desktop/native/lc-audio.exe`, compilado aqui para Windows.
  Entra no próximo instalador.

**[Testado aqui, `scripts/fse-test.mjs`, com o Windows simulado]:**
- Windows normal: nada.
- Windows indicando com a captura funcionando: só suspeita, sem aviso.
- Tela cheia de outra janela com imagem preta: não confirma, fica o aviso genérico.
- Janela transmitida com imagem preta: confirma; aviso no quadro, no selo e flutuante; quem assiste continua vendo.
- Ajustes: as 3 opções e o diagnóstico; "Continuar assim" mantém a transmissão.
- Volta à janela sem bordas: o aviso some.
- Imagem congelada: confirma em ~12 s e volta ao normal com os quadros.
- App antigo: sem dados.

**[Precisa de Windows]:** o que o Windows responde de verdade em cada modo de cada jogo. É a parte 2 do kit, inclusive
o Valorant.

## M13: diagnóstico da captura

"Ajustes da transmissão" → **Diagnóstico da captura** (fechado por padrão; atualiza a cada 1 s):

- **Método em uso:** programa nativo (WGC → codificador da placa), iniciando, reiniciando após falha, ou modo normal
  (Chromium).
- **Pedido:** resolução e FPS escolhidos.
- **Capturando:** quadros/s que o capturador entrega (nativo: quadros novos da WGC; Chromium: quadros do capturador).
- **Enviando:** FPS e resolução que saem. **Codificador:** nome e o que o limita.
- **Quadros capturados por método:** total e média por segundo, desde o início da transmissão, para o programa nativo
  (WGC, com os enviados) e para o Chromium. Ao cair do nativo para o Chromium, os dois aparecem.
- **Por que não o nativo:** a mensagem real (ex.: "No Windows 10 a captura…", "o programa de transmissão fechou; falhou
  4 vezes seguidas"), ou o motivo pelo código.
- **Reinícios do nativo** e o último erro (M4). **Ajuste automático:** o último passo do controle (M2/M3).
- **Tela cheia exclusiva:** não / só o Windows indica (provável falso positivo) / confirmada / sem dados.

Nada disso vai para a telemetria. O resumo da chamada já leva caminho, motivo, codificador e a combinação (M1).

---

## 7. Testes rodados aqui

| Teste | Resultado |
|---|---|
| `callqual-unit-test` | ok (20 verificações) |
| `callqual-video-test` (sozinho) | ok |
| `ux-test` | ok |
| `screen-governor-test` (novo) | ok |
| `fse-test` (novo) | ok |
| `native-live-test` (com reinício e diagnóstico) | ok, 2 execuções seguidas |
| `streamhealth`, `screen-release`, `desktop-share`, `e2ee`, `gameshare`, `cam-flow`, `helper`, `desktop-test`, `appaudio-watch`, `frontwatch` | ok |
| `cargo build` de `lc-audio` e `lc-stream` para Windows (`x86_64-pc-windows-gnu`) | ok |
| `cargo test` de `lc-stream` | ok (5) |

**Falha que já existia:** `callqual-video-test` falha pelo executor da suíte (`node scripts/run-tests.mjs`). Ali a voz cai
na malha P2P e falta a etapa "conectar o áudio" do SFU. Com o código anterior a estas mudanças (`git stash`), falha
igual; sozinho, passa. Não é regressão destas mudanças, mas precisa de correção à parte (o teste não fixa `RTC_IPS`).

## 8. Kit de testes para Windows 10 e 11

**Pacote:** `native/pacote-captura/`. Para montar o zip (no Linux, com o alvo do Windows instalado):

```bash
sh native/pacote-captura/montar.sh
```

O zip contém `lc-audio.exe`, `lc-stream.exe`, `testar.ps1`, `LEIA-ME.txt` e o atalho `.bat`. Não instala nada, não muda
configurações e não toca no jogo. Gera `resultado-captura-<PC>.json`.

1. **Sistema:**
   - versão e build do Windows;
   - placas, driver, resolução e Hz;
   - `lc-stream --probe` (codificador na placa e WGC) e `lc-audio --probe`.
2. **Tela cheia exclusiva, por modo do jogo** (Tela cheia / Janela sem bordas / Janela, ~30 s cada):
   - `lc-audio --fse 30` registra, segundo a segundo, o que o Windows diz e qual janela está na frente;
   - inclui a pergunta da Xbox Game Bar (Win+G), o teste caseiro que o Discord recomenda.
3. **Transmissão de verdade na Resenha:** 4 casos (Tela cheia ou Janela sem bordas × janela do jogo ou tela inteira).
   A pessoa copia o que o **Diagnóstico da captura** mostra e responde:
   - o aviso apareceu?
   - quem assiste vê o jogo, preto ou parado?
   - FPS do jogo com e sem transmitir;
   - Alt+Tab volta sozinho?

### Matriz mínima
| PC | Windows | Jogo | Precisa responder |
|---|---|---|---|
| A | 10 22H2 (build 1904x) | Valorant + 1 jogo DX11/DX12 qualquer | O Windows indica tela cheia no modo "Tela cheia"? A janela é capturada? O aviso aparece **só** quando a imagem falha? "Por que não o nativo" = Windows 10? O controle (M2/M3) segura 1080p quando o codificador é por software? |
| B | 11 (build 22000+) | os mesmos | Método = programa nativo a 60 FPS? Alt+Tab e troca de resolução reiniciam o nativo sem cair para o modo normal (M4)? Com codificador na placa, "Ajuste automático" fica vazio? Tela cheia exclusiva de verdade dá aviso, e janela sem bordas não? |

### Critérios de aceite
- **Nenhum aviso de tela cheia** em "Janela sem bordas" ou "Janela", em nenhum dos dois PCs.
- **Em "Tela cheia" com a imagem chegando** (Windows ainda compondo): sem aviso; o diagnóstico pode dizer "só o Windows
  indica".
- **Em "Tela cheia" com a imagem preta ou parada para quem assiste:** aviso em até ~10 s, e a transmissão continua no ar.
- **Windows 11 nativo:** ≥ 58 FPS recebidos em 1080p60; Alt+Tab volta em < 3 s sem mudar para o modo normal.
- **Windows 10 (modo normal):** se o codificador for por software e limitar, o envio fica em ≥ 900p, sem cair para 540p.

---

## 9. O que ficou de fora (de propósito)

- **Gancho/injeção em jogos.** É o que o Discord usa para tela cheia exclusiva, mas depende de DLL assinada e da
  tolerância dos anti-cheats. Não entra.
- **Captura nativa sem borda no Windows 10 (DXGI, M10)** e **opção "aceitar a borda" (M11).** Esperam os dados do kit
  e da telemetria (`docs/historico/CAPTURA-WINDOWS10.md`).
- **Melhorias só no Windows** (placa certa em PC com duas placas, taxa ajustável no nativo, perfil High, laço por
  evento: M5-M9). Etapa seguinte, depois do kit.
