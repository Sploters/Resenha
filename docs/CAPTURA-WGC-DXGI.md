# Captura WGC + DXGI no lc-stream — pesquisa de bibliotecas

Pedido: um componente nativo que (1) detecte o jogo e o modo de apresentação, (2) escolha o método de captura sozinho,
(3) capture sem pegar o monitor inteiro, (4) entregue texturas direto ao encoder da GPU e (5) caia para outro método
quando o principal falhar. Pergunta: já existe código aberto que faça parte disso e que possamos usar legalmente?

## O que o lc-stream já faz (native/lc-stream/src/win.rs)
- WGC (`CreateForWindow` / `CreateForMonitor`), sem intervalo mínimo (`SetMinUpdateInterval(0)`), sem borda no Windows 11.
- BGRA -> NV12 na GPU (`ID3D11VideoProcessor`) -> H.264 de hardware do Media Foundation com texturas D3D11 (sem CPU).
- Ou seja, os itens 3 e 4 já existem. Falta: DXGI Desktop Duplication como alternativa, a escolha automática (item 2),
  a detecção do modo de apresentação (item 1) e o fallback dentro do próprio programa (item 5; hoje a volta é para o
  Chromium, inteira).

## Bibliotecas encontradas

| Projeto | Licença | O que dá | Serve para nós? |
|---|---|---|---|
| [windows-capture](https://github.com/NiiightmareXD/windows-capture) (Rust, 2.0.1, ago/2026, ~2,8 mi downloads) | **MIT** | WGC (janela/monitor, sem intervalo mínimo, sem borda, dirty regions) **e** DXGI Desktop Duplication (`DxgiDuplicationApi`), quadro como `ID3D11Texture2D`, encoder próprio pelo Media Foundation | **Sim, melhor candidata.** Usa o mesmo `windows = 0.62` que o lc-stream. Limite: o modo DXGI cria o próprio `ID3D11Device`; o encoder tem que ser aberto nesse device (`device()`), ou copiar a textura para um device compartilhado. |
| [win_desktop_duplication](https://github.com/rhinostream/win_desktop_duplication) (Rust) | MIT OR Apache-2.0 | Só DXGI, com textura na GPU e espera pelo vsync | Possível, mas parado desde 2024 e em `windows` mais antigo. |
| [dxgi-capture-rs](https://github.com/RobbyV2/dxgi-capture-rs) (Rust) | MIT | Só DXGI | Pequena, mais voltada a buffer na CPU. |
| [xcap](https://github.com/nashaofu/xcap), [scap](https://github.com/helmerapp/scap), [CrabGrab](https://github.com/AugmendTech/CrabGrab) | Apache-2.0 / MIT | Captura multiplataforma | Focadas em imagem/CPU; não acrescentam nada ao que já temos. |
| dxgcap / dxgcap2 / captrs | **AGPL-3.0** | DXGI | **Não usar**: AGPL obrigaria a abrir o app inteiro. |
| [Sunshine](https://github.com/LizardByte/Sunshine) (C++) | **GPL-3.0** | DXGI + WGC + NVENC/AMF/QSV, escolha e fallback — é a arquitetura pedida pronta | **Só como referência de estudo.** Copiar código obriga a distribuir o Resenha sob GPL. |
| OBS `win-capture/graphics-hook` (C) | **GPL-2.0+** | Captura por injeção no Direct3D/Vulkan do jogo (texturas compartilhadas) | **Não usar**: GPL, e injetar DLL em jogos com anticheat (Vanguard, EAC, BattlEye) pode render banimento. |

## Recomendação
1. Adotar `windows-capture` (MIT) só para o caminho **DXGI Desktop Duplication**, mantendo o nosso WGC (que já está
   ajustado). Manter o aviso de licença MIT no pacote (`THIRD-PARTY.txt`).
2. Escolha automática no lc-stream, sem hook nenhum (seguro com anticheat):
   - fonte = janela -> WGC da janela (único que não pega o monitor inteiro). Se falhar ou só vier quadro preto
     (alguns jogos em tela cheia exclusiva no Windows 10), tentar WGC do monitor onde a janela está, recortando o
     retângulo da janela no `ID3D11VideoProcessor` (`SourceRect`), e por fim DXGI desse monitor com o mesmo recorte.
   - fonte = monitor -> WGC; Windows 10 (borda amarela obrigatória) ou falha -> DXGI.
   - “modo de apresentação”: `SHQueryUserNotificationState` (já usado no `fse`) + janela do tamanho do monitor;
     `DXGI_OUTDUPL_DESC.DesktopImageInSystemMemory` e quadros sem atualização indicam que o método atual não serve.
3. Fallback dentro do programa: emitir `{"t":"method","m":"wgc|dxgi"}` e trocar de método sem derrubar o RTP
   (forçando um quadro-chave), em vez de voltar inteiro para o Chromium.
4. Não fazer hook/injeção (OBS/Sunshine-style): risco de anticheat e de licença.

## Correção já feita junto
"Áudio só desta tela indisponível (tela não encontrada)": `desktop/main.js` pegava o número do id `screen:N:0` como se
fosse o id do monitor; no Windows ele é um índice interno do Chromium. Agora usa `display_id` da lista do
`desktopCapturer` (como `desktop/native.js` já fazia), com o número e o monitor único como reserva.

---

# Fase 1: prova de conceito (DXGI no lc-stream)

Situação: **PoC escrita e compilada; medições pendentes num PC com Windows** (o container não tem Windows nem placa
de vídeo). Nada aqui foi integrado ao caminho de produção.

## 1. Como o WGC entrega texturas ao codificador hoje (native/lc-stream/src/win.rs)
- Um único `ID3D11Device` (BGRA + `VIDEO_SUPPORT`, multithread) é dono de tudo: o frame pool do WGC, o
  `ID3D11VideoProcessor` (BGRA -> NV12 + escala, um por camada do simulcast) e o codificador MF (`IMFDXGIDeviceManager`).
- Por quadro: `TryGetNextFrame` (só o mais recente) -> `ID3D11Texture2D` -> `CreateVideoProcessorInputView` ->
  `VideoProcessorBlt` num anel de 8 texturas NV12 -> `MFCreateDXGISurfaceBuffer` -> `ProcessInput`. Sem CPU.
- A saída do codificador tem tamanho fixo (ow x oh). Quando a fonte muda de tamanho só muda `set_rects` (barras pretas).
- Os timestamps vêm do relógio do `Meter` (início da transmissão), não da captura.
- Consequência: **trocar a fonte de quadros não exige recriar o codificador, o RTP/SRTP nem a sessão no SFU**, desde que
  a nova textura esteja no mesmo device. Basta: nova fonte -> ajustar o recorte -> `force_key()` (quadro-chave).

## 2. API real da windows-capture 2.0.1 (MIT, windows 0.62.2 = a mesma do lc-stream)
- `DxgiDuplicationApi::new()` / `new_options()` **sempre criam o próprio ID3D11Device** (sem `VIDEO_SUPPORT`). Não há
  construtor que aceite um device externo. A textura do quadro (`frame.texture()`) fica no device dela.
- Logo, para o nosso VideoProcessor/codificador há só três caminhos:
  a) cópia entre devices por textura compartilhada (NT handle + keyed mutex) — custo medido pela PoC;
  b) usar o device dela para tudo — a PoC testa se ele aceita VideoProcessor sem a flag `VIDEO_SUPPORT`;
  c) chamar `IDXGIOutput5::DuplicateOutput1` direto no nosso device (~60 linhas com o crate `windows`, que já usamos),
     sem cópia. A biblioteca serviu de referência; não haveria dependência nova.
- Também: só procura o monitor nas saídas da placa padrão (notebook híbrido: `OutputNotFound`) e liga
  `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` no processo.

## 3. O que a PoC mede (`lc-stream --poc-captura`, só com `cargo build --features poc`)
Kit: `sh native/pacote-poc-dxgi/montar.sh` -> `poc-captura-dxgi.zip` (parte automática ~2 min, manual 3 min).
| Teste | Como |
|---|---|
| Ambiente | build do Windows, placas, qual placa liga cada monitor (híbrido), HDR, escala, rotação, Hz, propriedades do WGC (IsBorderRequired, MinUpdateInterval) |
| WGC monitor (linha de base) | quadro inteiro -> codificador real; fps capturado/entregue/codificado, tempo de GPU do Blt (timestamp queries) |
| DXGI no nosso device | idem, sem cópia; se a textura do DXGI não servir direto ao VideoProcessor, cai para cópia no mesmo device |
| DXGI no nosso device + cópia forçada | custo de uma cópia no mesmo device (GPU ms) |
| DXGI pela windows-capture | custo da cópia entre devices (GPU ms no device dela + CPU ms do keyed mutex) e se o device dela faz VideoProcessor |
| Troca ao vivo | WGC -> DXGI -> WGC -> DXGI -> WGC com o MESMO codificador e relógio, fria e quente: tempo até o 1º quadro da nova fonte, maior lacuna sem quadro, quadros até o IDR depois do `force_key`, timestamps fora de ordem, erros do codificador |
| Recorte/sobreposição | janela verde de teste + janela magenta por cima: livre, metade encoberta, toda encoberta, movida, redimensionada, meio fora do monitor, minimizada — % de verde no recorte por WGC janela, WGC monitor+recorte, DXGI+recorte |
| Janela andando | % de verde no recorte refeito a cada quadro enquanto a janela anda (atraso do recorte) |
| Tela preta | sonda 64x36 na GPU: reconhece a janela preta? custo de leitura |
| Manual (por segundo) | WGC e DXGI lado a lado + estado de tela cheia: resolução, Ctrl+Alt+Del, jogo exclusivo e sem bordas, queda de GPU (`dxcap -forcetdr`) com tempo de recuperação |

## 4. Limitações do DXGI (documentadas pela Microsoft; a PoC confirma ou não em cada PC)
- Captura o **monitor inteiro**. Recorte por janela = o que estiver na tela naquele retângulo: janela por cima,
  notificação, menu, o próprio overlay da Resenha entram no vídeo; janela minimizada ou noutro desktop virtual não
  aparece. Não existe isolamento de janela no DXGI.
- Não desenha o **cursor** na imagem (vem separado: `GetFramePointerShape`). Para a opção "mostrar cursor" seria
  preciso desenhar à parte.
- `DXGI_ERROR_ACCESS_LOST` em: mudança de resolução/rotação, Ctrl+Alt+Del, UAC, troca de usuário, jogo entrando/saindo
  de tela cheia exclusiva. Precisa recriar a duplicação (a PoC mede quanto demora).
- Conteúdo protegido (Netflix etc.) sai preto. Monitor girado: a imagem vem sem rotação (falta girar no Blt).
- Notebook híbrido: o monitor pode estar ligado na placa integrada e o codificador na dedicada; a duplicação no device
  do codificador falha e precisaria de cópia entre placas.
- HDR: pedimos BGRA 8 bits; o Windows converte (pode ficar lavado).
- Windows 10 x 11: `DuplicateOutput1` existe desde o Windows 10 1703; a PoC cai para `DuplicateOutput` se faltar.
  No Windows 10 o WGC desenha borda amarela que o DXGI capta se as duas capturas estiverem abertas juntas (troca quente).

## 5. Garantia de que produção não mudou
- `win.rs`/`main.rs`: só visibilidade (`pub(crate)`) e o módulo `poc` atrás de `#[cfg(feature = "poc")]`.
- Build normal comparado com o original: mesmas seções, mesmo tamanho, 309.092 instruções idênticas (desmontagem com
  endereços normalizados). O hash do .exe não serve de prova: nem o código original reproduz o próprio hash (MinGW grava
  data no cabeçalho).
- `cargo test`: 5/5 passam.

## Próximo passo (depois das medições)
Só depois dos números: escolher entre (c) DuplicateOutput1 no nosso device e (a) windows-capture + cópia, e então
implementar a fonte DXGI no `win.rs` como alternativa ao WGC, com o seletor e o painel de diagnóstico.

## 6. Problemas encontrados até agora (antes das medições)
| # | Problema | Situação |
|---|---|---|
| 1 | windows-capture cria o próprio ID3D11Device (sem `VIDEO_SUPPORT`) e não aceita um externo: a textura dela não chega direto ao codificador. | A PoC mede as 3 saídas (cópia entre devices, device dela, DuplicateOutput1 no nosso). |
| 2 | Build MinGW não é reprodutível (hash muda sem mudança no código), então hash não prova nada. | Comparação feita por desmontagem: código de produção idêntico. |
| 3 | O `montar.sh` da PoC compilava na mesma pasta `target/` de onde os outros kits copiam o lc-stream; se falhasse no meio, essa pasta ficaria com o exe da PoC. | Corrigido: a PoC compila em `native/lc-stream/target-poc/` (no .gitignore). O instalador nunca usa nenhuma das duas: usa `desktop/native/lc-stream.exe` (sem a PoC, conferido) ou `cargo build --release` sem a feature. |
| 4 | Na revisão da PoC: cada método reiniciava o relógio com o mesmo codificador (timestamps voltando e o ritmo descartando quadros), e a troca "quente" largava a fonte velha cedo demais. | Corrigidos antes de gerar o kit. |
| 5 | O lc-stream de produção não declara DPI por monitor; recebe coordenadas em pixels físicos do app. Com WGC isso não pesa, mas o recorte do DXGI depende de posição de janela e monitor na mesma escala. | A anotar na integração (declarar per-monitor v2 ou converter). Não verificado como defeito em produção. |
| 6 | A PoC decide se a textura do DXGI entra direto no VideoProcessor pelos bind flags (heurística). | Se errar, aparece como `InputView` em `errors` e fedFps 0 no JSON; os flags reais vão no JSON. |

## 7. Garantias do kit (native/pacote-poc-dxgi)
- Executável com outro nome (`lc-stream-poc.exe`), roda da pasta extraída; não lê nem substitui o lc-stream instalado.
- Não grava no registro (só lê a versão do Windows); único arquivo criado: o `.json` na pasta do kit.
- Prioridade de processo/thread/GPU e a escala por monitor valem só para o processo do teste.
- Não altera resolução nem configuração de tela: os testes de resolução e tela cheia são feitos à mão pela pessoa.

## 8. Resultados — Windows 11, rodada 1 (16/11/2026)
PC: Windows 11 Pro 25H2 (build 26200.9711), AMD Radeon integrada (APU, 496 MB), codificador `AMDh264Encoder`,
1 monitor 1920x1080 @ 60 Hz, escala 125%, sem HDR, sem placa híbrida. Saída do codificador 1920x1080@120.
O monitor é de 60 Hz: todos os métodos ficam presos em 60 fps; 120 fps não pôde ser medido neste PC.

### Métodos (quadro inteiro -> codificador real, 6 s cada)
| Método | fps cap/entregue/codificado | GPU conversão p50/p95 (ms) | Cópia GPU p50/p95 (ms) | CPU por quadro p50 (ms) | 1º quadro (ms) |
|---|---|---|---|---|---|
| wgc_monitor (produção) | 60/60/60 | 0,91 / 1,83 | — | 0,07 | 22,2 |
| dxgi_proprio (nosso device) | 60/60/60 | 0,80 / 1,67 | — (entrada direta) | 0,03 | 12,8 |
| dxgi_proprio_copia | 60/60/60 | 1,14 / 1,72 | 0,32 / 0,54 | 0,03 | 7,0 |
| dxgi_windows_capture | 60/60/60 | 0,80 / 1,28 | 0,42 / 0,67 (device dela) | 0,14 (troca do keyed mutex 0,11) | 12,1 |
- A textura do DXGI entra **direto** no VideoProcessor do nosso device (bind 0x28 = RT|SRV): zero cópia.
- O device da windows-capture aceita VideoProcessor mesmo sem `VIDEO_SUPPORT` (neste driver AMD).
- Cópia entre devices custa ~0,4 ms de GPU + ~0,1 ms de CPU por quadro: pequena, mas desnecessária.

### Troca ao vivo (mesmo codificador e relógio; WGC -> DXGI -> WGC -> DXGI -> WGC)
| | fria | quente |
|---|---|---|
| Erros do codificador / recriado | 0 / não | 0 / não |
| Timestamps fora de ordem | 0 | 0 |
| Quadros até o IDR após `force_key` | 1,1,1,1 | 1,1,1,1 |
| Troca -> 1º quadro: para DXGI / para WGC (ms) | 27 / 57 | 20 / 59 |
| Maior lacuna sem quadro no trecho: DXGI / WGC (ms) | 37 / 74 | 30-32 / 21-26 |
Conclusão: **a troca de fonte funciona sem recriar codificador, RTP ou sessão**; o IDR sai no quadro seguinte.
Abrir o WGC leva ~45 ms (o DXGI ~3 ms); a troca quente esconde isso (lacuna máxima 32 ms ≈ 2 quadros a 60 Hz).

### Recorte e sobreposição — rodada inválida para DXGI e WGC-monitor (defeitos da PoC, corrigidos)
- DXGI: "sonda Blt: Parametro incorreto" — a PoC lia o quadro depois de devolvê-lo (o quadro do DXGI só vale até o
  próximo AcquireNextFrame). Não afeta o pipeline (que usa o quadro na hora). **Regra para a integração:** nunca
  guardar a textura do DXGI; repetir quadro parado reaproveitando o NV12 (como já faz o win.rs).
- WGC monitor + recorte: a janela verde de teste ficou atrás da janela do cmd (83% preto = console). No cenário
  "meio fora do monitor", fora do cmd, deu 95,9% verde: o recorte acerta a posição e mostra o que está por cima.
- Válido: **WGC de janela isola a janela**: 100% verde com metade e com toda a janela encoberta, movida e
  redimensionada. Minimizada: 0 quadros. Parte fora do monitor: sai preta (50% preto) também no WGC de janela.
- Detecção de tela preta: janela preta 100% detectada, verde 0%; leitura da sonda 0,22 ms (p50, bloqueante).

### Manual (180 s, WGC e DXGI lado a lado)
- fps iguais nos dois o tempo todo (soma 7461 x 7514): o ritmo vem do que muda na tela, não do método.
- Mudança de resolução (1920x1080 -> 1366x768): DXGI perdeu o acesso 2x e recriou em 21 ms e 4 ms; os dois
  passaram a entregar 1366x768; o WGC recriou o pool 1x sozinho. Nenhum quadro preto.
- Ctrl+Alt+Del (provável, t=170 s): os dois quase sem quadro por ~2 s (área segura do Windows); DXGI recriou em
  1449 ms (tenta até a área de trabalho voltar); WGC seguiu sem precisar recriar.
- YouTube em tela cheia (estado "ocupado"): os dois normais, sem preto.
- Sem jogo instalado: tela cheia exclusiva e sem bordas não testadas -> modo `--tela-cheia` sintético acrescentado.
- Falha de GPU não simulada (opcional).

### Correções na PoC depois da rodada 1
1. Sonda lê o quadro no momento em que chega (DXGI). 2. Janela alvo sempre por cima das janelas normais (a magenta,
criada depois, continua por cima dela). 3. `--so-recorte` (só a parte 3). 4. `--tela-cheia`: "jogo" Direct3D
sintético sem bordas (flip) e em tela cheia exclusiva (SetFullscreenState), com WGC e DXGI medindo ao mesmo tempo.

## 9. Resultados — Windows 10, rodada 1 (kit antigo)
PC: Windows 10 Pro 22H2 (build 19045.6456), Intel HD Graphics 4000 (32 MB), codificador Intel Quick Sync,
1 monitor 1366x768 @ 60 Hz, escala 100%. Kit da rodada 1 (antes das correções do recorte).

### O que muda no Windows 10
- O WGC deste Windows **não tem** `IsBorderRequired` nem `MinUpdateInterval` (a propriedade nem existe): borda amarela
  obrigatória e intervalo mínimo padrão. Por isso o app hoje não usa a transmissão nativa no Windows 10.
- O DXGI (`DuplicateOutput1`) funciona normalmente aqui: sem borda e sem intervalo mínimo. **É o candidato a
  liberar a transmissão nativa no Windows 10.** (O ritmo acima de 60 fps não foi medido: monitor de 60 Hz.)
- Abrir o WGC custa ~120 ms (no Windows 11, ~45 ms); o DXGI, 1-7 ms.

### Métodos (6 s cada)
| Método | fps cap/entregue/codificado | CPU por quadro p50 (ms) | 1º quadro (ms) | Observação |
|---|---|---|---|---|
| wgc_monitor | 60/60/59,8 | 0,21 | 35 | borda obrigatória |
| dxgi_proprio | 59,8/59,8/60 | 0,07 | 12,7 | entrada direta (bind 0x28) |
| dxgi_proprio_copia | 59,5/59,5/59,8 | 0,09 | 10,2 | cópia 0,76 ms GPU |
| dxgi_windows_capture | 59,8/59,5/59,5 | 0,24 (pico 8,3) | 30,5 | cópia 0,58 ms GPU, troca do keyed mutex até 7,8 ms |
- Os cronômetros de GPU da Intel HD 4000 voltaram 0,0 ms na conversão (timestamps sem resolução neste driver);
  só os números com cópia saíram diferentes de zero. **Não dá para comparar o tempo de GPU da conversão neste PC.**

### Troca ao vivo
| | fria | quente |
|---|---|---|
| Erros do codificador / recriado | 0 / não | 0 / não |
| Timestamps fora de ordem | 0 | 0 |
| Quadros até o IDR | 2,2,1,2 | 1,2,1,2 |
| Troca -> 1º quadro: para DXGI / para WGC (ms) | 21-27 / 134-152 | 8-19 / 125-139 |
| Maior lacuna sem quadro: DXGI / WGC (ms) | 33-35 / **145** | 32-45 / 31-33 |
- No Windows 10 a troca fria para o WGC deixa ~145 ms sem quadro (~9 quadros a 60 Hz); a quente resolve (~33 ms).

### Recorte (WGC de monitor; o DXGI teve o mesmo defeito da PoC da rodada 1)
- Janela livre 99,96% verde; metade encoberta 50/50; toda encoberta 100% magenta; movida 100%; redimensionada
  99,96%; meio fora do monitor 99,96% (recorte limitado à borda certo). Minimizada: aparece o que está atrás.
- Janela andando (recorte refeito a cada quadro): **DXGI 100% verde (p50), p5 98,4%**; WGC monitor 98,4% (p50),
  p5 96,9%. O recorte do DXGI acompanha a janela pelo menos tão bem quanto o do WGC.
- WGC de janela: `CreateForWindow` E_INVALIDARG — o WGC do Windows 10 recusa janela com `WS_EX_TOOLWINDOW`, estilo
  que a PoC usava. Corrigido (a janela alvo agora é comum). Vale para a produção: janelas assim (alguns overlays e
  launchers) não podem ser transmitidas por WGC no Windows 10; o DXGI com recorte seria a alternativa.
- Sem o WGC de janela, o teste de tela preta não rodou neste PC.

## 10. Resultados — Windows 10, rodada 2 (kit corrigido)
Mesmo PC da seção 9 (Windows 10 22H2, Intel HD 4000, 1366x768 @ 60 Hz).

### Recorte e sobreposição — agora válido para os três métodos
| Cenário | WGC janela | WGC monitor + recorte | DXGI + recorte |
|---|---|---|---|
| livre | 100% verde | 99,96% | 99,96% |
| metade encoberta | **100% verde** | 50% verde / 50% magenta | 50% / 50% |
| toda encoberta | **100% verde** | 100% magenta | 100% magenta |
| movida | 100% | 99,96% | 99,96% |
| redimensionada (900x500) | 100% | 99,96% | 99,96% |
| meio fora do monitor | 50% verde, 48% preto | 99,96% (só a parte visível) | 99,96% (só a parte visível) |
| minimizada (rect -32000) | 0 quadros | "fora do monitor" | "fora do monitor" |
| janela andando (p50 / p5) | — | 98,4% / 96,9% | **100% / 98,4%** |
- Confirmado: **só o WGC de janela isola a janela**. WGC monitor e DXGI com recorte mostram o que está por cima, com a
  mesma precisão de posição (os dois recortes deram números idênticos em todos os cenários parados).
- Janela minimizada vem com posição -32000: dá para detectar e não recortar lixo.
- A correção da janela comum funcionou: o WGC de janela do Windows 10 capturou a janela de teste.
- Tela preta: detectada (100% x 0%). A leitura bloqueante da sonda custa 2,3 ms na Intel HD 4000 (0,22 ms na AMD):
  na transmissão ela precisa ser assíncrona (rodízio de texturas, lida 2 quadros depois).

### Tela cheia sintética (sem bordas -> exclusiva -> volta para janela)
| Fase | Jogo (q/s) | WGC monitor | DXGI | Estado do Windows |
|---|---|---|---|---|
| sem bordas (flip) | 60 | 60 fps | 30 fps (ver abaixo) | 2 (ocupado) |
| **tela cheia exclusiva** | 60 | **24 -> 11 -> 5 -> 1 fps, imagem congelada** | 30 fps, imagem atualizando | 3 (D3D exclusiva) |
| volta para janela | 60 | 60 fps | 0 (erro da PoC, ver abaixo) | 2 |
- **Achado principal: em tela cheia exclusiva no Windows 10 o WGC de monitor praticamente para.** Cai para 1 fps em 4 s
  e repete sempre a mesma imagem (luma fixo em 88,84 enquanto o jogo troca de cor). A imagem **não fica preta**:
  a detecção de tela preta não pega esse caso. O DXGI continuou entregando imagem nova.
  -> Gatilho de troca para o seletor: estado 3 (`SHQueryUserNotificationState`, que o app já consulta) e/ou queda da
  taxa de quadros do WGC enquanto o jogo está na frente. Só "tela preta" não basta.
- Entrar na exclusiva: 187 ms; o DXGI perdeu o acesso 1x e recriou em 1,9 ms. Sair: 186 ms.
- **Problema real:** ao sair da exclusiva, `AcquireNextFrame` devolveu `DXGI_ERROR_INVALID_CALL` (0x887A0001), e não
  `ACCESS_LOST`. A PoC tratou como erro fatal e largou o DXGI (0 fps até o fim). Corrigido na PoC: INVALID_CALL também
  recria. Na integração: todo erro do AcquireNextFrame que não seja timeout -> recriar a duplicação (com limite de
  tentativas) antes de cair para outro método.
- **DXGI a 30 fps: provável defeito do teste**, não do DXGI. O laço esperava o vsync no Present e só então consultava
  cada captura uma vez, sem espera; o WGC guarda o quadro numa fila, o DXGI pode ainda não ter composto. Corrigido:
  o "jogo" desenha no ritmo do monitor sem bloquear e as capturas são consultadas a cada 1 ms; o JSON agora traz
  `dxgiAccumulated` por segundo para confirmar.

### Métodos e troca ao vivo (rodada 2): iguais à seção 9
DXGI direto 59,75 fps sem cópia; windows-capture com picos de 8 ms de CPU; troca sem erro, IDR em 1-2 quadros,
0 timestamps fora de ordem; troca fria para o WGC ~147 ms sem quadro, quente 29-32 ms.

## 11. Resultados — Windows 11, rodada 2
Mesmo PC da seção 8 (Windows 11 25H2, AMD Radeon integrada, 1920x1080 @ 60 Hz, 125%). Kit da rodada 2
(ainda sem as correções de INVALID_CALL e do laço da tela cheia).

### Recorte — válido, igual ao Windows 10
| Cenário | WGC janela | WGC monitor + recorte | DXGI + recorte |
|---|---|---|---|
| livre / movida / redimensionada | 100% | 100% | 100% |
| metade encoberta | **100%** | 50% / 50% | 50% / 50% |
| toda encoberta | **100%** | 100% magenta | 100% magenta |
| meio fora do monitor | 50% verde / 50% preto | 100% (parte visível) | 100% (parte visível) |
| minimizada | 0 quadros | "fora do monitor" | "fora do monitor" |
| janela andando (p50 / p5) | — | 98,4% / 98,4% | 100% / 98,4% (resultado) e 98,4% / 98,4% (recorte) |
- O WGC de janela só entrega quadro quando a janela muda (1 quadro em 0,9 s com a janela parada): normal.
- Sonda de tela preta: 0,22 ms p50, mas picos de 16-18 ms bloqueando -> confirma que precisa ser assíncrona.

### Tela cheia sintética
| Fase | Jogo | WGC monitor | DXGI | Estado |
|---|---|---|---|---|
| sem bordas | 60 | 30 fps | 30 fps | 2 |
| **tela cheia exclusiva** | 60 | **55-60 fps, imagem atualizando** | erro e desistiu (PoC antiga) | 3 |
| volta para janela | 60 | 30 fps | — | 2 |
- **No Windows 11 o WGC NÃO congela na tela cheia exclusiva** (55-60 fps com a cor mudando). No Windows 10 congelou
  (1 fps). O Windows 11 converte a "exclusiva" do jogo em apresentação pelo compositor, e o WGC continua vendo.
- O DXGI recebeu `DXGI_ERROR_INVALID_CALL` logo ao ENTRAR na exclusiva (no Windows 10 foi ao SAIR). Mesmo erro, momento
  diferente: confirma que INVALID_CALL tem que recriar a duplicação. A correção já está no kit da rodada 3.
- **30 fps nos DOIS métodos na fase sem bordas** (o jogo a 60): reforça que é defeito do laço do teste (consulta 1x por
  vsync), não do DXGI. Corrigido no kit da rodada 3.
- Entrar na exclusiva: 89 ms (Windows 10: 187 ms). Sair: 65 ms (Windows 10: 186 ms).

### Métodos e troca ao vivo (repetição da rodada 1 no mesmo PC)
- 60 fps em todos; conversão p50 1,3 ms (rodada 1: 0,8-0,9 ms; variação de relógio da GPU integrada, igual em
  todos os métodos). DXGI continua com entrada direta, sem cópia.
- Cópia: mesmo device 0,68 ms; pela windows-capture 1,08 ms de GPU + 0,11 ms de CPU.
- Troca: 8/8 sem erro, IDR no 1º quadro, 0 timestamps fora de ordem. Fria para WGC: 72-74 ms sem quadro; quente: 20-30 ms.

## 12. Conclusões até aqui (2 PCs, 2 rodadas)
1. **DXGI no device do codificador (`DuplicateOutput1` direto), sem a windows-capture.** Entrada direta no
   VideoProcessor nos dois drivers (AMD e Intel), zero cópia, CPU 0,02-0,07 ms por quadro. A windows-capture só
   acrescenta uma cópia (0,4-1,1 ms de GPU) e, na Intel, picos de 8 ms de CPU, sem nada que o caminho direto não faça.
   A dependência ficaria só na PoC (ou sairia de vez).
2. **Trocar de fonte sem derrubar a transmissão funciona** nos dois PCs: mesmo codificador, mesmo RTP/sessão,
   timestamps contínuos, IDR em 1-2 quadros. A troca deve ser **quente** (abrir a nova antes de fechar a velha):
   fria para o WGC deixa 72 ms (Windows 11) a 147 ms (Windows 10) sem quadro; quente fica em 20-45 ms.
3. **Windows 11:** WGC continua sendo a 1ª opção (janela isolada, sem borda, funcionou até na exclusiva sintética).
   DXGI entra como alternativa (WGC falhando, tela preta/parada, captura de monitor).
4. **Windows 10:** o DXGI é o que viabiliza a transmissão nativa (sem borda amarela, sem intervalo mínimo) e é o único
   que segue funcionando na tela cheia exclusiva (o WGC congelou em 1 fps, **sem ficar preto**).
5. Gatilhos de troca: erro do WGC, tela preta (sonda assíncrona), **WGC parado** (sem quadro novo enquanto o
   estado é 3 / o jogo está na frente) e estado 3 no Windows 10. Todo erro do DXGI que não seja timeout -> recriar
   (com limite) antes de trocar.
6. Recorte de janela por DXGI/WGC-monitor acerta posição e tamanho, mas mostra o que estiver por cima: usar só
   quando o WGC de janela não serve, e avisar no app.

### Pendente
- Rodada 3 (atalho 4) no Windows 11: ver a recuperação depois do INVALID_CALL ao entrar na exclusiva. (Windows 10: feito, seção 13.)
- Jogo real (nenhum dos PCs tem), 120 Hz (os dois monitores são de 60 Hz), notebook híbrido, HDR, monitor girado,
  falha de GPU (TDR): não testados.

## 13. Resultados — Windows 10, rodada 3 (kit com as correções)
Mesmo PC (Windows 10 22H2, Intel HD 4000, 1366x768 @ 60 Hz). Recorte e métodos/troca: iguais à rodada 2
(reprodutíveis; troca 8/8 sem erro, IDR em 1-2 quadros, 0 timestamps fora de ordem).

### Tela cheia sintética
| Fase | Jogo | WGC monitor | DXGI (entregues / acumulados pelo Windows) | Estado |
|---|---|---|---|---|
| sem bordas | 60 | 59-60 fps | **55-60 / 55-60** | 2 |
| tela cheia exclusiva | 60 | **1-3 fps, imagem congelada** (luma fixo 88,84) | **59-60 / 59-60, imagem atualizando** | 3 |
| volta para janela | 60 | 60 fps | 57-60 / 57-60 | 2 |
- **Os 30 fps da rodada 2 eram defeito do teste**: com o laço corrigido o DXGI entrega 55-60 fps e o número de
  quadros acumulados pelo Windows é igual ao de entregues (nenhum quadro perdido).
- **O congelamento do WGC na exclusiva do Windows 10 se repetiu** (rodadas 2 e 3), sem ficar preto; o DXGI seguiu a 60 fps.
- Entrar: 131 ms, DXGI perdeu o acesso e recriou em 1,3 ms. Sair: 164 ms, desta vez veio `ACCESS_LOST` (não
  INVALID_CALL) e o DXGI recriou em 0,8 ms e continuou. Nesta rodada o caminho de INVALID_CALL não foi exercitado no
  Windows 10 (a ordem dos erros varia entre execuções); falta vê-lo no Windows 11, onde apareceu ao entrar.

## 14. Resultados — Windows 11, rodada 3
Mesmo PC (Windows 11 25H2, AMD integrada, 1920x1080 @ 60 Hz). Recorte e métodos/troca iguais às rodadas anteriores
(troca 8/8 sem erro, IDR em 1-2 quadros, 0 timestamps fora de ordem; DXGI direto: conversão 0,72 ms p50, CPU 0,02 ms).

| Fase | Jogo | WGC monitor | DXGI (entregues / acumulados) | Estado |
|---|---|---|---|---|
| sem bordas | 60 | 55-60 | 55-60 / 56-60 | 2 |
| tela cheia exclusiva | 60 | 59-60, atualizando | 55-60 / 58-60, atualizando | 3 |
| volta para janela | 60 | 57-60 | 54-60 / 56-60 | 2 |
- Confirma: os 30 fps eram do teste; no Windows 11 os dois métodos funcionam na exclusiva sintética.
- Entrar: 83 ms, `ACCESS_LOST`, DXGI recriou em 0,46 ms. Sair: 65 ms, `ACCESS_LOST`, recriou em 0,35 ms.
- `INVALID_CALL` não apareceu na rodada 3 em nenhum PC (apareceu 1x em cada PC na rodada 2). O tratamento (recriar,
  igual ao ACCESS_LOST) está na PoC mas **não foi exercitado de verdade**: fica como risco coberto pela regra
  "todo erro do AcquireNextFrame que não seja timeout -> recriar, com limite de tentativas".

## 15. Fim da fase de medição — decisões para a integração
Medido em 2 PCs (Windows 10 + Intel HD 4000; Windows 11 + AMD integrada), 3 rodadas, resultados reprodutíveis.

| Pergunta do pedido | Resposta medida |
|---|---|
| 1. Como o WGC entrega ao codificador | Um device só; textura -> VideoProcessor (NV12) -> MF. Fonte é trocável no meio. |
| 2. API da windows-capture | Cria device próprio; não aceita o nosso. |
| 3. DXGI no device do codificador | **Funciona**, entrada direta no VideoProcessor (AMD e Intel), sem cópia. |
| 4. Custo de cópia | Mesmo device 0,3-0,8 ms GPU; entre devices (windows-capture) 0,4-1,1 ms GPU + picos de 8 ms CPU (Intel). |
| 5. DXGI com janela encoberta | Mostra o que está por cima (50%/100% magenta nos testes). Posição/tamanho do recorte corretos, também com a janela andando. |
| 6. Windows 10 x 11 | DXGI igual nos dois. WGC do 10: borda obrigatória, sem intervalo mínimo, recusa janela "tool", **congela na exclusiva**. WGC do 11: ok em tudo. |
| Troca sem derrubar | Sim: mesmo codificador/RTP/sessão, IDR em 1-2 quadros, timestamps contínuos. Troca quente: 20-45 ms sem quadro. |

Recomendações (a decidir):
1. Implementar o DXGI com `DuplicateOutput1` direto no device do codificador; **não usar a windows-capture** no
   produto (ela fica só na feature `poc`, ou é removida).
2. Primeira etapa da integração: a fonte DXGI no `win.rs` como alternativa ao WGC, escolhida por parâmetro
   (sem seletor automático ainda), desligada por padrão; troca quente; recriação em qualquer erro do DXGI.
3. Depois de validada: seletor (Windows 10 -> DXGI para monitor e para jogo em tela cheia; Windows 11 -> WGC com
   DXGI de reserva; gatilhos: erro, tela preta, WGC parado, estado 3 no Windows 10) e o painel com os campos pedidos.
4. Não testado (risco declarado): jogo real com anti-cheat, 120 Hz+, notebook híbrido, HDR, monitor girado, TDR.

---

# Fase 2: integração (WGC + DXGI + seleção automática)

Situação: **implementado, compilado para Windows e testado no Linux com simulação; ainda NÃO medido num Windows de
verdade**. Os números de FPS/CPU/latência de troca em jogos reais dependem do roteiro `docs/TESTE-CAPTURA-AMIGOS.md`.

## O que entrou
| Parte | Onde | O que faz |
|---|---|---|
| Seletor | `native/lc-stream/src/select.rs` | Lógica pura (sem Windows), 14 testes próprios no `cargo test`. Ordem inicial, validação cruzada, limites. |
| Captura com método | `native/lc-stream/src/capture.rs` | Fontes WGC e DXGI (`DuplicateOutput1` no device do codificador), sonda de tela preta/parada, troca quente, recriação do DXGI, reconstrução após perda da placa. |
| Caminho clássico | `native/lc-stream/src/win.rs` (`win::run`) | **Intocado** (só ganhou `set_src`, usado pelo caminho novo). É usado quando o app não manda `capture`. |
| Simulação | `native/lc-stream/src/sim.rs` | Fora do Windows: o seletor real com fontes simuladas (`LC_SIM`), para os testes do app. |
| App desktop | `desktop/native.js`, `preload.js`, `main.js` | Repassa o método e o build do Windows; com método, o Windows 10 também usa o nativo (pelo DXGI). |
| Página | `public/voice.js`, `app.js`, `settings.js` | Opção "Método de captura", troca ao vivo, histórico, painel, Chromium como último recurso. |
| Teste | `scripts/captura-metodo-test.mjs` | Ponta a ponta com o lc-stream real (Linux) + SFU real, 8 cenários. |

## Como decide (modo Automático)
1. Ordem inicial: Windows 11 (build >= 22000) -> WGC, DXGI. Windows 10 -> DXGI, WGC. Se o primeiro não abrir
   (ex.: monitor em outra placa, monitor girado, WGC ausente), abre o segundo. O motivo vai para o painel.
2. A cada 0,5 s a fonte ativa é avaliada: quadros novos, e uma miniatura 64x36 lida da GPU a cada 250 ms sem travar
   (texturas de leitura em rodízio, `D3D11_MAP_FLAG_DO_NOT_WAIT`): preta? mudou desde a anterior?
3. Gatilhos:
   - **erro** que a fonte não resolveu (o DXGI já tenta recriar sozinho por até 8 s) -> troca direta para o outro método;
   - **tela preta** por 3 s -> abre o outro método ao lado (candidato);
   - **imagem parada** por 4 s com sinal de que devia mudar (jogo/vídeo em tela cheia na frente, no que está sendo
     transmitido: `SHQueryUserNotificationState` 2/3 + janela da frente) -> candidato. No Windows 10 com WGC e tela cheia
     exclusiva o limite é 1,5 s (a PoC viu o WGC congelar ali);
   - **nenhum quadro** em 3 s depois de abrir -> erro.
   Área de trabalho parada sem tela cheia na frente NÃO conta como problema (o WGC só entrega quadro quando algo muda).
4. O candidato roda ao lado por até 2,5 s, só alimentando a sonda (não vai para o codificador). Troca se ele entregar
   imagem não preta e, se a ativa estava parada, imagem mudando. Senão é descartado e a próxima tentativa espera
   10 s, 20 s, 40 s ... até 5 min. Exemplo: conteúdo protegido sai preto nos dois -> não troca, só registra.
5. Janela no Windows 11 que caiu para o DXGI: tenta voltar ao WGC (que isola a janela) depois de 60 s, 120 s, ...
   No Windows 10 não volta (lá o DXGI é o preferido).
6. Limites contra laço: no máximo 6 trocas em 5 min; um método com 3 erros em 2 min fica desligado na transmissão;
   sem método -> o programa encerra com "nenhum metodo de captura nativa funcionou" e a página volta ao Chromium
   **sem** reiniciar o programa (está na lista de erros definitivos). Os outros erros continuam com o limite antigo
   (3 reinícios em 30 s).
7. Forçar WGC/DXGI: nunca troca de método (só recria dentro dele); problema de imagem só vira anotação no histórico.

## Troca sem reiniciar codificador, SFU ou sessão
As duas fontes usam o mesmo `ID3D11Device` do codificador. Trocar = outra textura de entrada no `VideoProcessorBlt`,
outro retângulo de origem (`set_src`) e `force_key()` em todas as camadas. RTP/SRTP, SSRCs, relógio e a sessão no
SFU continuam. O evento `method` traz `ms` (da troca até o 1º quadro da nova fonte no codificador) e `testMs` (quanto
tempo os dois métodos ficaram comparados lado a lado, sem afetar a transmissão).

## Recuperação
- DXGI: `ACCESS_LOST`, `INVALID_CALL` e qualquer erro que não seja timeout -> recria a duplicação com espera de
  0,1 s a 1 s; desiste após 8 s sem acesso ou 30 recriações em 60 s (aí o seletor decide).
- Resolução e tela cheia: o DXGI recria e passa a entregar o tamanho novo; o WGC recria o pool. O codificador mantém a
  saída e encaixa a imagem nova com barras pretas (igual ao caminho clássico).
- Janela mudou de monitor (DXGI): duplica a saída do monitor novo. Minimizada: repete o último quadro.
- Placa de vídeo perdida (`GetDeviceRemovedReason`): recria device, codificadores e fonte e manda os parâmetros
  novos (SPS/PPS) pelo mesmo RTP; até 3 vezes em 2 min, depois erro -> Chromium.

## Controles
Configurações > Transmissão > Experimental > **Método de captura (teste)**, e o mesmo seletor em "Ajustes da
transmissão" durante a live (troca na hora, reinicia só o vídeo, 1-2 s):
Automático (padrão) · Forçar WGC · Forçar DXGI · Forçar Chromium · **Clássico (versão anterior)**.

## Painel (Ajustes da transmissão > Diagnóstico da captura)
Pedido, método em uso (e candidato sendo testado), por que começou assim, o que não abriu, FPS capturado/codificado,
CPU do programa nativo (% de um núcleo), tempo de codificação, resolução de captura -> envio, erros, recriações do DXGI,
perdas da placa, avisos (DXGI em janela mostra o que estiver por cima; sem cursor no DXGI) e o histórico de trocas e
decisões com horário e motivo. Botão "Copiar relatório do teste" (JSON) para mandar os resultados.

## Segurança e volta atrás
- Sem injeção de DLL, hook ou acesso a processo de jogo: só WGC e DXGI Desktop Duplication (APIs públicas de captura).
- Caminho atual preservado: `win::run` sem mudança de comportamento; o lc-stream só sai dele quando recebe `capture`.
- Volta atrás em 3 níveis: (1) "Clássico (versão anterior)" ou "Forçar Chromium" nas configurações, na hora;
  (2) app antigo: a página nova manda `capture` só se o app disser que suporta (`modes`); app antigo segue igual;
  página antiga + app novo também segue no clássico; (3) código: o commit `cc6c4a1` (PoC) é o estado anterior a esta
  integração; o instalador anterior continua nas releases do GitHub.
- A voz não passa pelo lc-stream: nada aqui toca no microfone, no Opus ou no transporte da voz.

## Testes feitos (Linux, sem Windows)
| Teste | Resultado |
|---|---|
| `cargo test` (14 do seletor + 5 de RTP/SRTP) | 19/19 |
| `cargo build --target x86_64-pc-windows-gnu` | sem erro e sem aviso |
| `scripts/captura-metodo-test.mjs` (8 cenários, lc-stream real + SFU real) | tudo ok |
| `native-live-test`, `native-test` (caminho clássico), `fse-test`, `streamhealth-test`, `callqual-unit-test`, `black-capture-test` | ok |
| `node scripts/check.mjs`, `desktop-files-check` | ok |
| App portátil para Windows montado aqui (`electron-builder --win portable`, sem assinatura de código) | ok, **não executado** (sem Windows) |

O que os testes no Linux NÃO provam: que as chamadas do Windows (WGC, DXGI, sonda na GPU, `GetDeviceRemovedReason`,
`SHQueryUserNotificationState`) se comportam como esperado. O código foi escrito em cima do que a PoC mediu nos dois
PCs (mesmas chamadas), mas o caminho integrado só vai ser provado no roteiro `docs/TESTE-CAPTURA-AMIGOS.md`.

Bugs que os testes pegaram e já estão corrigidos:
- a regra "voltar ao método preferido" tentava voltar ao DXGI no Windows 10 logo depois de ele falhar (agora só volta
  ao WGC, no Windows 11, para janela, depois de 60 s);
- numa troca a frio em que o substituto não abria, o programa ainda tentava abri-lo mais 2 vezes antes de desistir.

## Entrega para teste
- Branch `claude/jolly-galileo-cin4x4`. O servidor precisa rodar esta branch (página nova).
- App: `Resenha-Teste-Captura-1.0.40.exe` (portátil, roda sem instalar e sem mexer na Resenha instalada).
  Montar de novo: `cd desktop && npx electron-builder --win portable --publish never -c.win.signExecutable=false
  -c.portable.artifactName='Resenha-Teste-Captura-${version}.${ext}'` (o `lc-stream.exe` já está em `desktop/native`).
- O instalador oficial só sai quando isto chegar na `main` (workflow `desktop-release.yml`).

## Problemas conhecidos e limitações (não escondidas)
1. **DXGI não isola janela.** Transmitindo uma janela pelo DXGI, tudo o que ficar por cima dela (outra janela, menu,
   notificação, o próprio overlay) aparece na transmissão. Minimizada: imagem para. O painel avisa quando isso vale.
   No Windows 10 o Automático usa DXGI também para janela (o WGC de janela lá tem borda amarela).
2. **Cursor não aparece no DXGI** (o DXGI entrega o ponteiro à parte; desenhar ficou para depois).
3. DXGI precisa que o monitor esteja na mesma placa do codificador: notebook híbrido com monitor na integrada -> DXGI
   indisponível (cai no WGC). Monitor girado -> DXGI indisponível (a imagem viria deitada).
4. No Windows 10, enquanto o candidato WGC é testado (até 2,5 s) a borda amarela pode aparecer e ser captada pelo DXGI.
5. Tela realmente preta (tela de carregamento longa, filme com proteção) dispara um teste do outro método; ele é
   descartado e a espera dobra. Custo: abrir uma captura extra por até 2,5 s.
6. A sonda olha uma miniatura 64x36: um jogo muito escuro (média < 4 e máximo < 24 de 255) conta como preto.
7. HDR: pedimos BGRA 8 bits; o Windows converte (pode ficar lavado). Não testado.
8. 120 Hz/120 FPS, jogos reais (Valorant com Vanguard), notebook híbrido, TDR real: **não testados**, só os
   caminhos de código. A PoC só tinha monitores de 60 Hz.
9. Trocas de resolução mantêm a saída do codificador (barras pretas), como o caminho clássico; não reabre o
   codificador na resolução nova.
10. O Automático é o padrão para quem tiver a página E o app novos. Quem tiver só um dos dois fica no clássico.
