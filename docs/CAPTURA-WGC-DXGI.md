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
