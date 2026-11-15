# Próximas correções (depois do 1º teste com amigos)

Itens que **não** foram corrigidos de propósito: falta dado para saber a causa. A medição já está no app. Depois da
próxima jogatina, leia o painel (Configurações → Administração → Estatísticas de uso) e decida a partir daqui.

## 5. Troca de canal lenta no app

- **Situação:** o código não mostrou uma causa clara. Corrigir sem saber seria chute.
- **Medição:** quando a troca passa de 1 s, o app registra `slow_switch` (`public/app.js`, `slowSwitch`) com
  `onde:contexto`. No painel, procure **"Troca de canal lenta (onde foi o tempo)"**.
  - `rede`: mais da metade do tempo esperando `GET /channels/:id/messages` → olhar servidor/banco.
  - `desenho`: mais da metade montando as mensagens (`renderMessages`) → olhar o custo de montar a lista.
  - `espera`: nem rede nem desenho. A página estava ocupada com outra coisa (chamada, vídeo, filtro de ruído).
  - Contexto: `chamada`, `transmitindo`, `assistindo`, `cripto` (canal com mensagens protegidas).
- **Leitura esperada:** se dominar `espera:chamada+assistindo` (ou `transmitindo`), o problema é a mídia disputando a
  página, não o chat. Aí a correção vai para a voz e o vídeo, não para `loadChannel`.

## 9. Quedas de conexão

- **Situação:** reconectar mais rápido foi testado e **desfeito**. O tempo total de volta quase não mudou (5,6 s contra
  5,8 s), e o servidor ficou bem mais sobrecarregado.
- **Causa:** as quedas vêm do reinício do servidor a cada atualização.
- **Feito (2026-11-14):** o `deploy/umbrel.sh` agora espera a chamada acabar antes de trocar o container (ver README,
  "Atualizar sem derrubar a chamada"), e o app mostra "Servidor atualizando" em vez de "Conexão perdida".
- **Painel:** o cartão "Conexão" separa "Atualização do servidor" de "Queda de rede ou do servidor". Se as quedas de rede
  continuarem, aí sim há outra causa a investigar.

## Travadas da transmissão

- **Situação:** no teste, 20 s de tela parada não geraram travada falsa no Chrome. Então as travadas vistas no app
  podem ser reais, do lado de quem transmite.
- **Decisão:** ficaram **fora da nota da chamada** até os dados novos mostrarem a causa.
- **Painel:** "Travadas da transmissão (por minuto assistido)" (`freeze_scr`) junto com **"O que limitou a transmissão
  de quem transmitiu"** (CPU ou banda). Se as travadas coincidirem com limite por CPU ou banda, a causa está em quem
  transmite. Se não houver limite e mesmo assim travar, olhar quem assiste.

## FPS baixo (10-30) e oscilação acima de 20 ms em quem assiste (2026-11-14)

Relato: mesmo trocando a qualidade, com o modo leve desligado em quem transmite e 60 FPS forçado. Três causas no código,
corrigidas sem medição no Windows (falta conferir na próxima jogatina):
1. **Caminho do Chromium** (Windows 10, sem codificador na placa, conversa protegida ou volta do nativo): o teto `max` do
   fps igual ao pedido descartava os quadros da grade irregular do capturador. Pedindo 60 saíam ~32 fps; pedindo 30,
   ~21 (bate com `PASSO0-DIAGNOSTICO-FPS.md`). Agora o teto tem 25% de folga (`capFps`) e o limite exato fica no
   codificador (`maxFramerate`).
2. **Servidor** (`server/sfu.js`): o piso de 6 Mbps por espectador valia para sempre e impedia a estimativa de banda de
   baixar quando a fila crescia sem perda (oscilação alta, quadros atrasados). Agora vale só nos 15 s de subida do vídeo
   (novo, retomado ou trocado para uma camada maior); `SFU_FLOOR_MS=0` volta ao antigo.
3. **Programa nativo** (60/120 FPS): mandava cada quadro de uma vez (quadro-chave de 1080p = centenas de pacotes em
   rajada). Agora há um pacer: 2,5x a taxa pedida, acelerando se a fila passar de ~30 ms; envio recusado pelo sistema
   espera e tenta de novo em vez de perder o pacote. Precisa de um app desktop novo (o `lc-stream.exe` vai no instalador).

Para conferir: painel "Transmissão ao vivo" de quem assiste (fps, oscilação, perda) antes e depois. Se seguir baixo
com o nativo e sem perda, olhar os fps enviados pelo programa no painel de quem transmite.

## Transmissão a ~48 FPS e 960x540 (2026-11-15)

Relato: depois da correção acima, quem assiste vê 48-52 FPS (nunca 60) e 960x540 em vez de 1080p.
- **FPS:** 48 é o teto do capturador do Chromium (`PASSO0-DIAGNOSTICO-FPS.md`), ou seja, a transmissão saiu pelo modo
  normal e não pelo programa nativo.
- **960x540:** reproduzido aqui (VP8 pelo processador, 1080p60 pedido): o servidor manda a camada Alta, mas o
  codificador de quem transmite encolhe a imagem (1080p -> 720p -> 540p, limite "cpu") para segurar os fps. Com mais
  quadros chegando (correção do `capFps`) o processador deixou de dar conta. Mantendo a resolução, cai para ~25 fps.
- **Medição nova** (cartão "Qualidade técnica das chamadas"): por onde a transmissão saiu, por que não foi pelo nativo
  (Windows 10, sem codificador na placa, portas UDP, chamada protegida, menos de 60 FPS…), quem comprimiu (placa ou
  processador), a resolução enviada e se ficou abaixo da pedida. Se dominar "Windows 10" + "Processador", a saída é
  deixar o nativo rodar no Windows 10 (com a borda amarela, ou capturando por DXGI, que não tem borda).

## O que olhar no painel depois da próxima jogatina

1. **"Entrar na voz" por etapa:** preparar o microfone, resposta do servidor e conectar o áudio.
2. **"O que limitou a transmissão de quem transmitiu"**.
3. **"Travadas da transmissão"**.
4. **Trocas de canal lentas:** a distribuição de `onde:contexto`.
