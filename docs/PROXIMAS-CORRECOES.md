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

## O que olhar no painel depois da próxima jogatina

1. **"Entrar na voz" por etapa:** preparar o microfone, resposta do servidor e conectar o áudio.
2. **"O que limitou a transmissão de quem transmitiu"**.
3. **"Travadas da transmissão"**.
4. **Trocas de canal lentas:** a distribuição de `onde:contexto`.
