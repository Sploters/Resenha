# Fase 3 — Controle remoto (mouse e teclado)

Data: 2026-11-03. Escopo desta etapa: **só mouse e teclado**.
**2026-11-14:** entraram o **controle de videogame** e o controle **transmitindo só uma janela** (seção "Controle de
videogame e janela", no fim).

## Como funciona para quem usa
1. Na sala de voz, quem **assiste** a uma transmissão clica no ícone de cursor nos botões da transmissão em destaque ("Pedir controle").
2. Quem **transmite** (no app para Windows, transmitindo a **tela inteira**) vê um diálogo: "bob quer controlar seu PC", com caixas **Mouse** e **Teclado**, e escolhe o que libera. O pedido expira em 30 s.
3. Aceito, quem assiste clica dentro da transmissão (borda vermelha) para controlar: movimento, clique (esquerdo/meio/direito), arrastar, rolagem e, se liberado, teclado. Clicar fora da transmissão devolve o teclado ao próprio app.
4. Para parar: botão **Parar** no aviso (dos dois lados), **Ctrl+Alt+Shift+Q** no teclado físico do dono, sair da sala, desconectar ou parar de transmitir.

## Arquitetura
```
quem assiste (navegador/app)      servidor (gateway WS)              dono (app desktop Windows)
  captura no quadro do vídeo  ->  server/remote.js valida, filtra  ->  public/remote.js (renderer)
  coordenadas 0..1, códigos       por permissão, limita taxa          -> IPC -> desktop/remote.js (main)
  de tecla físicos (KeyA...)      só da conexão que está na sala       -> stdin -> native/lc-input.exe -> SendInput
```
- **server/remote.js**: pedido → consentimento → sessão ativa → fim. Uma sessão por pessoa (como dono ou controlador). Eventos aceitos: `m` (x,y em 0..1), `d`/`u` (botão 0–2), `w` (rolagem, ±2400 em unidades do Windows), `kd`/`ku` (`KeyboardEvent.code`, `^[A-Za-z][A-Za-z0-9]{0,23}$`). Campos extras são removidos. Máx. 64 eventos por mensagem; balde de 400 eventos/s com folga de 800. Teclas são descartadas se o teclado não foi liberado (o mesmo para o mouse). Pedido, resposta e comandos só valem vindos da conexão WebSocket que está na chamada.
- **public/remote.js**: botão no quadro, diálogo de consentimento, captura (fase de captura, `preventDefault`, mapeamento descontando as faixas pretas do `object-fit: contain`), fila com movimento agrupado a cada 16 ms, solta teclas/botões ao clicar fora ou perder o foco, aviso fixo no topo (`#remote-chip`) para os dois lados. Sem o app desktop, o pedido é recusado automaticamente com explicação (o navegador nunca pode ser controlado).
- **desktop/remote.js**: guarda a fonte transmitida (`setDisplayMediaRequestHandler`), calcula o retângulo do monitor em pixels físicos (`screen.dipToScreenRect`), inicia o `lc-input.exe` só quando a sessão é aceita, e abre uma **janela de aviso sempre no topo** (nível `screen-saver`, sem foco, sem JavaScript; o botão Parar é um link interceptado pelo processo principal). Fechar o aviso também para.
- **native/lc-input** (Rust): lê linhas JSON da entrada padrão (`arm` com o retângulo, `disarm`, `ev`), valida de novo, injeta com `SendInput` por **scancode** (a tecla sai igual à do teclado físico do dono, inclusive ABNT2: Ç = `Semicolon`, `/?` = `IntlRo`), só dentro do monitor transmitido, com DPI por monitor. Atalho de emergência por gancho `WH_KEYBOARD_LL` que **ignora entrada injetada** (`LLKHF_INJECTED`): quem controla não consegue acioná-lo nem bloqueá-lo. Ao desarmar, no atalho ou se o app fechar (fim da entrada padrão), solta toda tecla/botão pressionado. Sem porta de rede.

## Segurança (requisitos da Fase 0 e como foram atendidos)
| Requisito | Onde |
|---|---|
| Sessão criada no servidor com dono, controlador e permissões separadas | `server/remote.js` |
| Consentimento explícito no cliente do dono | diálogo em `public/remote.js`; o servidor só ativa com `REMOTE_ANSWER` do dono |
| Comandos validados no servidor (autor, formato, faixa, tamanho, taxa) | `cleanEvent` + balde de taxa |
| Revogação imediata | `REMOTE_STOP` dos dois lados; aviso nativo; atalho físico |
| Encerra ao sair da chamada / fechar transmissão / desconectar | `onLeave`, `onScreenOff`, `leaveVoice` |
| Indicador permanente não ocultável | janela sempre no topo do processo principal + aviso no app |
| Atalho de emergência no processo nativo | `lc-input` (gancho de baixo nível, só teclado físico) |
| Entrada aplicada só pelo processo nativo | o renderer nunca simula eventos; `lc-input` só injeta armado |

## Jogos com anti-cheat
- **Aviso para os dois lados.** Quem pede vê, na primeira vez, uma apresentação com o aviso e as limitações (fica marcado em `remoteIntroSeen`); quem transmite vê o aviso em todo pedido.
- **Detecção no PC do dono.** Ao receber o pedido, o app desktop lê a lista de processos (`tasklist`, só leitura) e procura anti-cheats conhecidos: Riot Vanguard, Easy Anti-Cheat, BattlEye, FACEIT, EA Javelin, nProtect GameGuard, ACE (Tencent), XIGNCODE3, PunkBuster, EQU8, Ricochet. Se encontrar, o aviso fica **vermelho** e cita o nome; senão, aviso **amarelo** geral.
- **O risco.** O anti-cheat pode ignorar a entrada injetada ou tratá-la como trapaça; quem arrisca suspensão/banimento é a **conta do jogo no PC controlado**. A recomendação mostrada é recusar ou fechar o jogo antes. Nada é bloqueado à força: a decisão é do dono.
- A detecção não é garantia: anti-cheats novos, renomeados ou que rodam só como driver podem não aparecer na lista.

## Limitações conhecidas
- Jogos em **tela cheia exclusiva** podem não receber os comandos e às vezes aparecem pretos na transmissão (use "janela sem bordas").
- A tela de bloqueio, o UAC e o Ctrl+Alt+Del não podem ser controlados.
- Com vários monitores, só o transmitido é controlado.
- **Janela**: os comandos só valem dentro da janela transmitida e com ela na frente (ver abaixo).
- **Janelas de administrador** (UAC) não recebem a entrada injetada (regra do Windows, UIPI). O dono vê um aviso quando isso acontece.
- **Jogos com anti-cheat** podem ignorar ou bloquear entrada injetada.
- **Ctrl+Alt+Del** não pode ser injetado (o Windows não permite).
- Latência: os comandos passam pelo servidor (VPN). Bom para ajudar alguém; para jogar remoto, medir antes.
- O cursor de quem controla é o do vídeo (o cursor do dono aparece na transmissão).

## Build
- O `desktop/native/lc-input.exe` está no repositório, compilado no Linux com `cargo build --release --target x86_64-pc-windows-gnu` em `native/lc-input` (só usa DLLs do Windows). `npm run dist` (desktop) chama `build-native.mjs`: com Rust no Windows, recompila; sem Rust, usa o incluído. O electron-builder copia para `resources/lc-input.exe`.
- Desktop **1.0.15**.

## Testes
- `cargo test` em `native/lc-input`: 9 testes (mapa de teclas sem repetição, estendidas, ABNT2, protocolo, limites, coordenadas em monitor à esquerda).
- `node scripts/remote-test.mjs`: 45 verificações — 22 do módulo do servidor (recusas, consentimento, permissões, validação, taxa, expiração, fim automático) e 23 com três navegadores reais (ponte do app desktop simulada que registra o que seria injetado): pedido, diálogo, só-mouse, posição normalizada, clique, rolagem, teclas na ordem com Shift, teclado que não vaza para o chat, tecla segurada solta ao clicar fora, atalho de emergência, botão Parar, dono no navegador comum (recusa automática), dono parando de transmitir.
- **Não testado aqui** (sem Windows): a injeção real (`SendInput`), o gancho do atalho e a janela de aviso do Electron. Roteiro manual abaixo.

## Roteiro de teste manual (2 PCs, app 1.0.15 no PC que será controlado)
1. PC A (app desktop) entra na sala e transmite a **tela inteira**. PC B (app ou navegador) entra e abre a transmissão.
2. B clica no ícone de cursor → A vê o diálogo; libere só o **mouse** → B move e clica: o cursor de A obedece; B digita: nada acontece em A.
3. Pare e peça de novo liberando **mouse e teclado**: abra o Bloco de Notas em A; B digita "ação ç /?": o texto sai certo no ABNT2.
4. Em A, aperte **Ctrl+Alt+Shift+Q**: o aviso vermelho some, B é avisado. Repita e use o botão **Parar** do aviso; repita e pare de transmitir.
5. Com a sessão ativa, B segura uma tecla e A aperta Ctrl+Alt+Shift+Q: a tecla não fica presa em A.
6. Em A, abra um programa como administrador e dê foco a ele: B não consegue clicar nele e A vê o aviso do Windows.
7. Com dois monitores em A, transmita o segundo: os cliques de B caem no monitor certo.

## Controle de videogame e janela (2026-11-14)
**Controle de videogame.** Quem controla usa o próprio controle (qualquer um que o navegador reconheça pela Gamepad API).
No PC de quem transmite ele aparece como um **controle de Xbox 360**, criado pelo driver gratuito **ViGEmBus**
(github.com/nefarius/ViGEmBus). Sem o driver, a opção aparece desligada no pedido, com o link.
- Permissão separada (`perms.gamepad`), escolhida pelo dono; vem desmarcada.
- `public/remote.js` lê o controle ~60 vezes por segundo, aplica zona morta de 8% nos analógicos e manda o **estado
  inteiro** só quando muda: `{ k: 'g', b: <bits do standard mapping, 17>, ax: [lx, ly, rx, ry], lt, rt }`. Sem foco na
  janela do navegador, manda o controle em repouso (nada fica apertado).
- `server/remote.js` valida faixa e formato (`cleanEvent`), como os outros eventos, dentro da mesma taxa.
- `lc-input` converte para o XInput (Y invertido, gatilhos 0–255, analógicos ±32767), liga o controle virtual no primeiro
  evento e, ao desarmar (Parar, atalho de emergência, fim da sessão, app fechado), solta tudo e desconecta.
- O programa avisa no `ready` se o driver respondeu (`"pad":true`); o app desktop repassa em `capable()`.

**Janela.** O id da fonte do Electron é `window:<HWND>:0`. O app arma o `lc-input` com `{"t":"arm","hwnd":N}` e o
programa lê o retângulo da janela a cada evento (`DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`, sem a sombra,
como a captura mostra), então a janela pode mudar de lugar ou tamanho. Regras para não mexer no que não aparece:
- clique e rolagem só onde a janela transmitida é a de cima (`WindowFromPoint`); se outra a cobre, tenta trazê-la para a
  frente uma vez e, se não der, descarta o comando;
- tecla só com ela em foco (`GetForegroundWindow`);
- minimizada ou fechada: comandos descartados;
- soltar tecla ou botão já apertado sempre passa (nada fica preso).
O dono recebe um aviso uma vez por sessão quando algo foi descartado (`covered`).

**Não testado aqui (sem Windows):** a injeção real na janela e o controle virtual. `cargo test` cobre o protocolo e a
conversão; `scripts/remote-test.mjs` cobre o fluxo com o app desktop simulado.

### Roteiro manual (2 PCs, app desktop novo no PC controlado)
1. No PC A, instale o ViGEmBus e reinicie o app. Transmita **uma janela** (ex.: Bloco de Notas). No PC B, abra a
   transmissão e peça o controle.
2. Em A, o pedido avisa que é uma janela. Libere mouse e teclado: B clica e digita no Bloco de Notas; arraste outra janela
   por cima: o clique de B é descartado e A vê o aviso. Mova a janela transmitida: os cliques continuam caindo certo.
3. Pare e peça de novo liberando só o **controle**. Em A, abra "Configurar controladores USB" (`joy.cpl`): aparece um
   "Controller (XBOX 360 For Windows)"; os botões e analógicos de B mexem nele. Aperte Ctrl+Alt+Shift+Q em A: o controle
   some e nada fica apertado.
