# Transmissão a 60/120 FPS pela placa de vídeo (app desktop, Windows)

O capturador de tela do Chromium usa o Windows Graphics Capture com o intervalo mínimo padrão (~20,8 ms) e fica em
~48 fps (ver `PASSO0-DIAGNOSTICO-FPS.md`), inclusive pedindo 60. **A partir de 60 FPS** (até 2026-11-13: só acima de 60) o
app desktop passa o **vídeo** para um programa próprio
(`native/lc-stream`, empacotado como `lc-stream.exe`), que captura sem esse limite e comprime na placa de vídeo.
Medido no PC de 143 Hz (RTX 3080): 1080p a 120 fps de ponta a ponta, 0 perdas.

## Como funciona
| Parte | O que faz |
|---|---|
| Seletor "Transmitir tela" | 60 ou 120 fps escolhido + app desktop no Windows 11 + codificador de hardware (`lc-stream --probe`) + conversa não protegida = modo nativo (`voice.js` `wantNative`, `NATIVE_MIN_FPS`). Senão, o caminho de sempre. |
| Chromium (`getDisplayMedia`) | Continua capturando a mesma tela/janela, mas só para o **áudio do sistema** (WebRTC, como antes) e a **prévia local**, rebaixada para 10 fps / 360p — ou 30 fps na resolução escolhida (até 1080p) quando os clipes da própria transmissão estão ligados, porque o clipe grava essa trilha (`previewSpec`). |
| Servidor (`sfu.js` `sfuAttachNative`, op `native_start` no gateway) | Cria um `PlainTransport` **SRTP** (AES_CM_128_HMAC_SHA1_80) numa porta de `RTC_NATIVE_PORTS` (40001-40010/udp) e um producer H.264 registrado como a tela da pessoa. Gera a chave de quem envia e devolve as duas chaves só pelo gateway autenticado. |
| App desktop (`desktop/native.js`) | Converte a fonte escolhida (janela = HWND; tela = ponto no centro do monitor, em pixels físicos) e liga o `lc-stream --stdin` com a configuração em JSON pela entrada padrão (as chaves não aparecem na linha de comando). Repassa os eventos (`started`, `stats` 1/s, `error`, `exit`). |
| Versão leve (simulcast) | O app pede **2 camadas**: a cheia (resolução/fps/taxa escolhidas) e uma leve (540p a 2,5 Mbps; 360p a 1,2 Mbps se a cheia for 720p; 60 fps, ou o fps da cheia se for menor). O programa abre um codificador e um conversor para cada uma (sessões da mesma placa), com ssrc próprio e o mesmo relógio. O producer tem as duas como simulcast por ssrc: o SFU começa cada espectador na leve e sobe quando a banda dele permite, igual à transmissão normal; também respeita a qualidade escolhida pelo espectador. PLI/FIR/NACK chegam ao fluxo certo pelo ssrc. Se a placa não abrir a sessão extra, segue só com a cheia (`layerError`). |
| Porta UDP fechada | Enviar UDP nunca falha do lado de quem manda. O servidor avisa `NATIVE_SCREEN_LIVE` quando os primeiros pacotes chegam; sem esse aviso em 8 s (`NATIVE_LIVE_MS`) o app volta ao Chromium com aviso das portas e não tenta o nativo de novo por 10 min. Antes, quem assistia via tela preta até o servidor desistir (60 s). |
| Prioridades | `lc-stream`: sem EcoQoS do Windows 11 (`ProcessPowerThrottling`), thread de captura/codificação acima do normal (não tempo real) e prioridade de GPU +1 (`SetGPUThreadPriority`). `lc-audio --capture`: thread no MMCSS "Audio" (sem MMCSS: acima do normal) e sem EcoQoS. O resultado de cada passo vai no evento `started` (`prio`). Ganho ainda **não medido** no Windows. |
| `lc-stream` | WGC (`MinUpdateInterval = 0`), cursor conforme "mostrar o cursor" (`cursor` na configuração) → BGRA→NV12 com escala e barras pretas no `ID3D11VideoProcessor` → codificador H.264 de hardware do Media Foundation (NVENC/AMF/QuickSync, o da mesma placa) → RTP → **SRTP**. Reenvia por NACK, quadro-chave por PLI/FIR, abre o SRTCP do servidor. Janela redimensionada: recria a captura e mantém a proporção. Tela parada: repete o último quadro ~10x/s. Janela fechada: erro. |

Quem assiste não muda nada: recebe um producer de tela H.264 comum.

## Ao vivo
- Mudar para menos de 60 fps: o programa para e o vídeo volta para o Chromium (mesma transmissão, sem parar).
- Voltar para 60/120 fps, ou mudar resolução/fps/taxa no modo nativo: reinicia o programa (1-2 s).
- O programa falhou ou fechou: aviso e a transmissão continua pelo modo normal.
- O servidor encerrou a sessão (reconexão): tenta de novo até 2 vezes, depois volta ao modo normal.
- Painel "Transmissão ao vivo": mostra os fps enviados pelo programa e o codificador.

## Limitações conhecidas
- Só app desktop no Windows (10 1903+; o fim do limite de 48 fps depende do Windows 11, onde existe `MinUpdateInterval`).
- 2 camadas (não 3 como na transmissão normal): no menu de qualidade de quem assiste, "Média" e "Alta" dão a cheia.
- Placas GeForce antigas limitam sessões simultâneas de codificação; com OBS/gravação ligados, a camada leve pode não abrir.
- A prévia local e o clipe da **própria** transmissão saem da captura do Chromium (10 fps/360p; 30 fps até 1080p com os clipes próprios ligados), não do vídeo do programa.
- Portas: `RTC_NATIVE_PORTS` tem 10 portas por padrão = no máximo 10 transmissões nativas ao mesmo tempo no servidor. Com 60 FPS também nativo, isso pode faltar antes; a 11ª volta ao Chromium com aviso.
- Portas UDP 40001-40010 precisam estar abertas/mapeadas (já estão no `deploy/umbrel.sh`).

## Testes
- `node scripts/native-live-test.mjs`: fluxo completo com o app desktop simulado e o programa em versão Linux (ffmpeg no
  lugar da captura + placa): seletor, cursor, áudio pelo WebRTC, ~120 fps no palco de quem assiste, camada leve (360p ~60 fps) e volta à cheia,
  aviso de chegada dos pacotes, prévia de 30 fps com clipes próprios, 120→30→120 e 120→60 (nativo, ~60 fps no espectador) ao vivo,
  queda do programa, parar e porta UDP fechada (volta ao Chromium em ~8 s e não insiste). As prioridades do Windows só são
  compiladas aqui (`cargo build --target x86_64-pc-windows-gnu`), não exercitadas: falta medir num PC com Windows.
- `node scripts/native-test.mjs`: teste manual (código) e SRTP — sem a chave o servidor descarta os pacotes.
- `cargo test` em `native/lc-stream`: empacotamento RTP e SRTP (vetores do RFC 3711).
