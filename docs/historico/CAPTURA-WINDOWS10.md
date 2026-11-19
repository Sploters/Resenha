# Transmissão no Windows 10: dados primeiro, depois captura nativa sem borda

Data: 2026-11-15. **Nada da captura atual muda até a telemetria confirmar o problema.** Este documento diz o que
medir, como decidir e o que cada caminho de correção pode e não pode fazer.

## Ponto de partida

- Relato: quem assiste vê 48-52 FPS e 960x540 numa transmissão pedida em 1080p60.
- Reproduzido no Linux (VP8 pelo processador): o servidor manda a camada Alta, mas o codificador de quem transmite
  encolhe a imagem (1080p → 720p → 540p, limite "cpu") para segurar os fps. Mantendo a resolução, cai para ~25 fps.
- Hipótese principal: quem transmite está no **Windows 10**, onde o app não usa o programa nativo
  (`desktop/native.js`: build < 20348) por causa da borda amarela do WGC. Sobra o modo normal (Chromium), que comprime
  pelo processador quando não acha codificador na placa e copia cada quadro para a memória do processador.
- **Ainda não confirmado:** o Windows de quem transmitiu, o codificador usado e quantas pessoas passam por isso.

### Detalhe que muda a análise do FPS

O teto de 48 FPS de `PASSO0-DIAGNOSTICO-FPS.md` vem do **WGC** sem `MinUpdateInterval` (medido no Windows 11). No
Windows 10 o app desliga o WGC no Chromium (`desktop/main.js`, `AllowWgcScreenCapturer`), e a tela inteira é capturada
por **DXGI Desktop Duplication**. Então, se a pessoa está no Windows 10, os ~48-52 FPS **não** são explicados pelo
mesmo teto. Causas possíveis, ainda não medidas:
- o capturador DXGI do Chromium copiando cada quadro para a memória do processador, disputando CPU com o jogo e com o
  codificador;
- o próprio codificador pelo processador (limite "cpu");
- o jogo rodando abaixo de 60 FPS (a captura só tem quadro novo quando a tela muda).

## 1. Coleta de dados (agora)

### O que já é medido (commit e5201d1, cartão "Qualidade técnica das chamadas")

Por chamada com 20 s+ de transmissão, do lado de quem transmite:

| Medida | Código | Responde |
|---|---|---|
| Por onde saiu | `spath:native` / `spath:chromium` | quantas transmissões ficam no modo normal |
| Por que não foi pelo nativo | `snat:win10`, `nohw`, `nocap`, `noexe`, `web`, `e2ee`, `lowfps`, `nosfu`, `udp`, `fail`, `other` | se o Windows 10 é o motivo dominante |
| Quem comprimiu | `senc:hw` / `senc:sw` | placa de vídeo ou processador |
| Resolução enviada | `send_res:0..4` (até 360p, 540p, 720p, 1080p, acima) | a imagem que sai |
| Encolheu? | `sshrink:yes` / `no` | o codificador baixou da resolução pedida |
| FPS enviado | `send_fps:0..4` | inclui o nativo desde este commit |
| O que limitou | `slim:cpu` / `bandwidth` / `none` | processador ou internet |

### Como coletar

1. Atualizar o servidor no Umbrel (a página do app vem dele; o app desktop instalado não precisa mudar).
2. Esperar **pelo menos duas jogatinas com transmissão**. Meta mínima: **20 transmissões medidas** (`spath` somado).
   Com o grupo atual (~8 pessoas ativas, ~8 transmissões medidas em 30 dias), isso pode levar algumas semanas.
3. No painel, filtrar pela versão nova (a partir da que contém e5201d1). Chamadas de versões antigas não têm essas
   medidas e diluem as porcentagens.
4. Exportar o JSON do painel e guardar junto deste documento a cada leitura.

### Limitações da telemetria atual (importantes para a decisão)

1. **Conta chamadas, não pessoas.** Os totais são "transmissões em que aconteceu X". Uma pessoa que transmite todo dia
   pesa mais do que três que transmitem uma vez. O painel não responde "quantos usuários são afetados".
2. **As medidas não se cruzam.** Cada código é contado à parte. "6 × `snat:win10`" e "6 × `senc:sw`" **não** provam
   que são as mesmas 6 transmissões. Para afirmar "Windows 10 **e** processador" é preciso um código combinado.
3. **Grupo pequeno.** Com 8 pessoas, contar pessoas por categoria pode identificar alguém ("só uma pessoa está no
   Windows 10"). O painel esconde só grupos pequenos de avisos de erro, não estes.
4. **Quem desligou "Enviar estatísticas de uso" fica de fora.**

### Como confirmar quantas pessoas são afetadas

Opções, da mais simples à mais completa (nenhuma foi implementada; decidir antes):

| Opção | O que dá | Custo / risco |
|---|---|---|
| **A. Perguntar ao grupo** (Windows 10 ou 11? apareceu o aviso da placa de vídeo?) | número exato hoje | depende de resposta; não acompanha o tempo |
| **B. Código combinado** na telemetria (ex.: `scombo:win10.sw.shrink`) | quantas **transmissões** têm as três coisas juntas | pequeno; não identifica ninguém |
| **C. Contar pessoas distintas** por categoria (hash diário como `ux_seen`, mostrado só com 3+ pessoas) | quantas **pessoas** afetadas | maior; precisa cuidado de privacidade num grupo pequeno |

Recomendação: **A agora + B** para a decisão. C só se o grupo crescer.

### Critério para começar a investigação da captura nativa

Começar o Spike C (abaixo) se, nas transmissões da versão nova:
- `spath:chromium` for a maioria, **e**
- `snat:win10` for o motivo mais comum entre elas, **e**
- houver `senc:sw` ou `sshrink:yes` em boa parte delas (com B: a combinação aparece em ≥ 30% das transmissões).

Se o motivo dominante for outro, a prioridade muda:
- `udp`: portas 40001-40010 fechadas (configuração do roteador/Umbrel, não código).
- `nohw`: sem codificador na placa. Nenhuma captura nativa resolve; o caminho é ajustar o modo normal (menos camadas,
  30 FPS ou 720p).
- `lowfps`: a pessoa pediu menos de 60 FPS; o nativo nem é tentado. Não é bug.
- `fail`: o programa nativo falhou; investigar o erro.

## 2. Possibilidades para o Windows 10

### Caminho 1 (prioridade): captura nativa por DXGI Desktop Duplication, sem borda

O `native/lc-stream` hoje captura só por WGC. Acrescentar o DXGI Desktop Duplication como captura alternativa no
Windows 10, mantendo o resto igual (conversão na placa → codificador de hardware → RTP).

**Por que é promissor**
- Não desenha borda, em nenhuma versão do Windows.
- Os quadros ficam na memória da placa (textura D3D11): nada passa pelo processador, ao contrário do capturador DXGI do
  Chromium, que copia cada quadro para a memória do processador.
- Medido: 144 FPS sem perda no PC de 143 Hz (Windows 11); 59,7 apresentações/s no PC de 60 Hz com Windows 10
  (`PASSO0-DIAGNOSTICO-FPS.md`, Spike A). O código de medição existe em `spikes/wgc-capture` (`--api dxgi`).
- O Chromium do próprio app já usa DXGI no Windows 10 sem queixas de compatibilidade conhecidas.

**Limitações**
- **Só tela inteira (monitor).** Não captura uma janela isolada. Para "transmitir uma janela" seria preciso recortar o
  retângulo dela no monitor, e aí entra o que estiver por cima (outras janelas, notificações) e o recorte precisa
  acompanhar a janela. Proposta: no Windows 10, janela continua pelo caminho atual; só a tela inteira vai por DXGI.
- **Cursor não vem no quadro.** É preciso desenhar à parte (`GetFramePointerShape` + posição), inclusive cursor
  monocromático e colorido com máscara.
- **Só manda quadro quando a tela muda.** O programa já repete o último quadro para manter o ritmo; conferir com DXGI.
- **A placa precisa ser a dona do monitor.** Em notebooks com duas placas, duplicar a saída a partir da placa errada
  falha (`DXGI_ERROR_UNSUPPORTED`); o codificador e a cópia precisam ficar na placa certa ou copiar entre placas.
- **HDR e telas giradas** exigem tratamento (formato diferente do BGRA comum; rotação informada pela saída).

**Riscos (a medir antes de entrar no produto)**

| Risco | Efeito | Como testar |
|---|---|---|
| Jogo em tela cheia exclusiva | quadro preto, travado ou "acesso perdido" | 2-3 jogos em tela cheia exclusiva, sem borda e em janela |
| `DXGI_ERROR_ACCESS_LOST` (trocar resolução, UAC, tela de bloqueio, Alt+Tab no jogo) | transmissão para | provocar cada caso; o programa recria a duplicação sem derrubar a transmissão |
| Outro programa duplicando a tela (OBS, gravador da placa) | a duplicação pode ser recusada | rodar junto com o OBS |
| Conteúdo protegido (vídeo com DRM) | sai preto | aceitável; avisar |
| Notebook com duas placas | falha ou cópia cara entre placas | 1 notebook híbrido |
| Peso no jogo | FPS do jogo cai | comparar FPS do jogo com e sem transmissão |
| Antivírus / anti-cheat | normalmente não reagem a DXGI (sem injeção), mas confirmar | um jogo com anti-cheat |

**Teste em Windows real é obrigatório.** O Linux aqui só valida RTP, servidor e app (`scripts/native-live-test.mjs`
com ffmpeg). Nada da captura DXGI pode ser validado sem um PC com Windows 10.

### Caminho 2 (opcional, configurável): WGC com borda amarela

O programa nativo já funciona no Windows 10 com WGC; só desligamos por causa da borda.
- **Proposta:** opção **desligada por padrão** em Configurações → Transmissão, com uma prévia ou texto explicando a
  borda ("O Windows 10 desenha uma borda amarela em volta do que está sendo transmitido; quem assiste não vê a borda").
  *A confirmar: se a borda aparece ou não no vídeo enviado.*
- **Vantagens:** pouco código; janela isolada também funciona; serve de saída enquanto o DXGI não fica pronto.
- **Limitações:** a borda fica na tela de quem transmite durante toda a transmissão (incomoda em jogo); no Windows 10
  o `MinUpdateInterval` não existe (Spike A: "No such interface supported"), então o WGC pode não passar de ~60
  quadros únicos por segundo, com ~40% de quadros repetidos medidos no PC de 60 Hz.
- **Não deve virar padrão**, pela experiência visual.

### Caminho 3 (paralelo, sem mexer na captura): aliviar o modo normal no Windows 10

Vale independentemente do resultado, para quem fica no modo normal:
- confirmar se o Chromium achou codificador na placa (`senc`) e por que não, quando não achou;
- quando o processador limita, oferecer 1080p a 30 FPS ou 720p a 60 FPS em vez de deixar o codificador encolher
  para 540p (já existe "qualidade automática", desligada por padrão).

### Descartados

- **Captura por injeção no jogo** (como a "captura de jogo" do OBS): risco com anti-cheat e antivírus, muito código
  por API gráfica. Não compensa para um grupo de amigos.
- **Exigir Windows 11:** fora do nosso controle.

## 3. Plano da investigação (Spike C), quando os dados confirmarem

Fora do produto, como os Spikes A e B:
1. **C1, só captura:** `spikes/wgc-capture --api dxgi` num PC com Windows 10. Medir FPS de captura com um jogo
   aberto (janela, sem borda, tela cheia exclusiva), uso de CPU/GPU e casos de "acesso perdido".
2. **C2, ponta a ponta:** DXGI → conversão na placa → codificador de hardware → RTP → SFU, no `lc-stream` com uma opção
   escondida (`--capture dxgi`), sem ligar no app. Medir FPS recebido, resolução, CPU do jogo.
3. **Critério para entrar no produto:** 1080p com ≥ 58 FPS recebidos em 60 Hz, sem aumento perceptível de CPU, e
   recuperação automática de "acesso perdido" em menos de 2 s, em pelo menos 2 PCs com Windows 10 (um com placa NVIDIA
   ou AMD, um notebook se houver).
4. Só então: o app usa DXGI para tela inteira no Windows 10; janela segue como hoje; a opção da borda (Caminho 2)
   fica disponível para quem quiser transmitir janela a 60 FPS.

## Atualização (Fase 2, 2026-11-15)
- A medida combinada (opção B) existe: `scombo:` no cartão "Transmissões por combinação".
- O modo normal não encolhe mais para 540p: controle da transmissão (M2/M3).
- Kit de testes para Windows 10 e 11: `native/pacote-captura/` (`docs/historico/FASE2-CAPTURA.md`, seção 8).

## O que precisa de quem tem Windows 10

- Dizer a versão do Windows e se apareceu o aviso "Transmissão pela placa de vídeo indisponível".
- Para o Spike C: rodar o pacote de teste (como nos Spikes A e B) e mandar o JSON gerado.
