# Watch Together (Assistir juntos)

Atividade de chamada para assistir vídeos em grupo com reprodução sincronizada, fila compartilhada e controles de
anfitrião. Inspirada no Watch Together do Discord, expandida com adaptadores por serviço.

## 1. Auditoria: o que já existia e foi reaproveitado

| Necessidade | Já existia | Como é usado |
|---|---|---|
| Sala/participantes | `voice` (Map canal → Map uid → estado) em `server/index.js`, `currentVoice(uid)` | a sessão vive por sala de voz; só quem está na sala entra |
| Tempo real | gateway WebSocket (`send`, `roomSend`, `dispatch`), padrão pedido/resposta com `rid` do bot de música (`MUSIC`/`MUSIC_RES`) | `WATCH` / `WATCH_RES`, `WATCH_STATE`, `WATCH_SYNC`, `WATCH_MEMBERS` |
| Atividades da sala | `ROOM_ACT` (lousa, editor de código) + botões na barra da chamada | ganharam um lançador "Atividades" com o Watch Together |
| Entrada/saída/queda | `leaveVoice(uid, cid, reason)` com `reason: 'drop'` em queda de conexão; `VOICE_JOIN` | ganchos `watch.onVoiceJoin` / `watch.onVoiceLeave` (reconexão e troca de anfitrião) |
| Convites | `server/callinvites.js` (convite para a chamada, cartão na DM, aceitar → entra na sala) | opção `activity: 'watch'`: o convite diz "para assistir junto" e, ao aceitar, abre o Watch Together |
| Busca no YouTube | `searchTracks` do bot de música (yt-dlp, sem chave) | busca da atividade (ou a YouTube Data API v3 se `YOUTUBE_API_KEY` existir) |
| Fila do bot de música | lógica de fila (mover, remover, tirar repetidas) em `server/music.js` | mesmas operações, reescritas com as regras de permissão do Watch Together (a fila do bot é de áudio no servidor; aqui cada cliente toca o vídeo) |
| Links do YouTube | `videoLink()` em `public/media.js` | mesma lógica de URL (watch, youtu.be, shorts, live, embed, `t=`) no adaptador |
| Arquivos enviados | `/files/...` (uploads) | serviço "Link de vídeo": `.mp4`/`.webm` enviados no chat ou link direto |
| Janela flutuante | padrão do PiP de transmissão (`livepip.js`) | mini player ao minimizar |
| App desktop | Electron 45, `preload.js` com `lcDesktop` | janela de serviço com sessão persistente por serviço (`desktop/watchwin.js`) |

Não existia: sincronização de reprodução, relógio comum cliente/servidor, players de terceiros controlados por API.

## 2. Arquitetura

```
public/watchsvc.js     adaptadores de serviço (isomórfico: servidor e cliente) — reconhecer link, nível de integração
public/watchsync.js    lógica de sincronização pura (posição esperada, decisão de correção, relógio) — testável no Node
server/watch.js        sessões (uma por sala de voz): estado autoritativo, permissões, fila, anfitrião, reconexão
public/watchplayers.js players: YouTube IFrame API, HTML5 (link/arquivo), externo (assistido / janela do desktop)
public/watch.js        interface + motor que aplica o estado do servidor ao player
desktop/watchwin.js    janela de serviço (Netflix/Prime/Crunchyroll) com sessão própria e ponte de controles
desktop/watchbridge.js preload dessa janela: encontra o <video> da página, relata o estado e aplica play/pause/posição
```

### Estado autoritativo e anti-loop
- O servidor guarda `pb = { status, pos, at, rate, seq }`: a posição `pos` vale no instante `at` (relógio do servidor).
  Posição esperada agora = `pos + (agora − at) × rate` quando tocando.
- Todo comando aceito incrementa `seq`; clientes ignoram `WATCH_SYNC` com `seq` menor ou igual ao último aplicado.
- **Comandos só nascem de intenção do usuário na interface** (botões, barra, atalhos). Eventos do player
  (play/pause/buffer/fim) **nunca** viram comandos: só viram *relatórios* (`report`). Assim um estado recebido do
  servidor e aplicado ao player não volta como ação local (sem eco). O YouTube é carregado com `controls=0` e uma camada
  transparente por cima captura cliques.
- O relógio do cliente é ajustado ao do servidor (amostras estilo NTP, escolhe a de menor ida e volta).
- Correção de deriva: |diferença| ≤ 0,5 s ok; > 0,5 s (por 2 leituras seguidas) → pula para a posição esperada mais a
  latência de busca medida; pausado → alinha na hora. Com buffer, espera e corrige ao voltar. Intervalo mínimo entre
  correções para não ficar pulando.
- Começo de vídeo: o servidor marca `at` 1,5 s no futuro (todos carregam e começam juntos).

### Permissões
Na interface: Hosting = "Só eu" e Sharing = "Todos" (seletor "Quem controla" no topo, só o anfitrião muda). Em Pessoas,
o anfitrião tem uma chave por pessoa (`grant`). Quem não controla tem "Pedir controle" (`ask`: o servidor manda
`WATCH_ASK` só para o anfitrião, no máximo 1 pedido a cada 20 s por pessoa), e o pedido aparece numa faixa no topo com
Liberar / Agora não / Liberar para todos.

| Ação | Hosting | Sharing |
|---|---|---|
| Adicionar à fila | todos | todos |
| Remover item | o próprio item; anfitrião/autorizados removem qualquer | todos |
| Reordenar, pular, tocar item | anfitrião/autorizados | todos |
| Play, pause, posição | anfitrião/autorizados | todos |
| Mudar modo, passar anfitrião, autorizar | anfitrião | anfitrião |
| Volume | sempre local | sempre local |

## 3. Níveis de integração por serviço (o que foi efetivamente alcançado)

Três níveis, sem misturar: **Integrado** (toca dentro do Resenha, sincronia completa), **Controles sincronizados**
(toca na conta de cada um, numa janela do serviço no app desktop, e a sala comanda o `<video>` da página) e
**Sincronização assistida** (cada um abre na própria conta; o Resenha combina o título, a posição e a contagem para o
play, sem controlar o player).

| Serviço | Nível alcançado | Play/pause | Posição | Próximo/episódio | Volume | Validado com o serviço real? |
|---|---|---|---|---|---|---|
| YouTube | **Integrado** (IFrame Player API oficial, `controls=0`) | sim | sim | fila + próximo automático | local | API real usada no código; testes automáticos com a API simulada (`watch-ytmock.js`). Falta validar à mão com vídeos reais (ver §7) |
| Link de vídeo (.mp4/.webm, vídeo enviado no chat) | **Integrado** (`<video>`) | sim | sim | sim | local | sim (testes de ponta a ponta) |
| Netflix | **Assistida** em qualquer lugar. **Controles** só num app desktop com Widevine (o atual não tem) | ponte pronta | pela API do player da página (experimental); `currentTime` direto quebra o player deles, então não é usado | troca pelo link na fila | local | **não** — sem Widevine o vídeo não toca na janela do app; nada testado com conta real |
| Prime Video | idem | ponte pronta | `currentTime` (experimental) | link na fila | local | **não** |
| Crunchyroll | idem | ponte pronta | `currentTime` (experimental) | link na fila | local | **não** (o site também recusa acessos automatizados daqui: 403) |

### Por que Netflix, Prime Video e Crunchyroll não tocam dentro do Resenha
- **DRM/Widevine:** os três exigem o CDM Widevine. O Electron padrão (o app usa o 45) **não inclui** o Widevine; só
  builds com o CDM (por exemplo o "Electron for Content Security" da castLabs) e, para a Netflix e outros, com
  assinatura VMP do app. A janela do serviço detecta isso (`requestMediaKeySystemAccess('com.widevine.alpha')`) e a
  interface explica e oferece o navegador. No navegador, o Resenha (uma página comum) não pode controlar outra aba.
- **Incorporação:** nenhum dos três tem player incorporável para terceiros; as páginas proíbem iframe
  (`X-Frame-Options`/`frame-ancestors`) e não há API pública de controle.
- **Política adotada:** não contornar DRM, não extrair fluxo, não capturar nem transmitir o vídeo de uma pessoa para
  outra. Cada participante assiste com a própria assinatura.

### O que a janela de serviço do app desktop faz (desktop/watchwin.js + watchbridge.js)
- Uma janela por serviço com **sessão própria e persistente** (`persist:watch-<serviço>`): o login fica guardado só
  nela, separado do Resenha e dos outros serviços.
- Só navega em domínios do serviço (o resto abre no navegador do sistema). Identificador do navegador sem "Electron/".
- A ponte roda no mundo isolado (a página não a enxerga), acha o maior `<video>` com fonte, relata
  posição/pausa/buffer/fim, reconhece tela de login e erro de DRM, e aplica play, pause, posição e volume.
- Com Widevine presente, o nível passa sozinho de "assistida" para "controles sincronizados" e o motor de sincronia
  (o mesmo do YouTube) corrige a deriva pela ponte.

### Sincronização assistida (o que funciona hoje para os três)
- O item entra na fila pelo link (título opcional; a Crunchyroll dá o título pelo próprio link). Começa **pausado**,
  esperando a turma abrir na própria conta.
- Cada um marca **"Estou pronto"** e pode informar **"Estou em mm:ss"**; o anfitrião vê na aba Pessoas.
- Play pela sala → **contagem 3-2-1** para todos e "Dê play agora"; pausa/posição aparecem como "posição combinada" (o
  relógio da sala), que cada um acompanha.

## 4. Estados e erros tratados (todos com explicação e ação)

| Situação | O que a pessoa vê | Ação oferecida |
|---|---|---|
| Vídeo do YouTube que proíbe incorporação | recusado ao adicionar (oEmbed 401/Data API `embeddable=false`); se só descobrir ao tocar (erro 101/150), tela explicando | Abrir no YouTube · Pular; se todos têm o erro, pula sozinho |
| Removido/privado/inexistente | recusado ao adicionar (404) ou tela "Vídeo indisponível" | Pular |
| Região/idade | tela explicando, só para quem tem o problema (os outros continuam) | Abrir no YouTube · Pular |
| Player do YouTube não carrega (rede/bloqueador) | "O player do YouTube não carregou" | Tentar de novo · Abrir no YouTube |
| Navegador bloqueia som automático | toca sem som e mostra "clique para ativar o som" | Ativar som |
| Sem assinatura / sem acesso / login | painel do serviço explica; a janela do app reconhece a tela de login | Entrar na conta · Abrir no navegador |
| DRM indisponível | aviso na janela do app (sem Widevine) | Abrir no navegador (assistida) |
| Serviço fora do ar | erro de carregamento da janela | Tentar de novo |
| Buffering longo (> 8 s) | faixa "Sua conexão está lenta…" e indicador "Carregando" para todos | Ressincronizar |
| Perda de sincronia | indicador ±s no controle e "Adiantado/Atrasado" em Pessoas; correção automática | Ressincronizar (manual) |
| Falha de conexão / app fechado | participante "Reconectando…" na sessão; ao voltar à sala, volta sozinho na posição atual | — |
| Entrada tardia | estado completo + relógio do servidor: já entra na posição certa | — |
| Anfitrião sai | saída explícita: troca na hora; queda: espera 30 s (`WATCH_HOST_GRACE_MS`) e passa para quem está há mais tempo | Anfitrião pode passar o controle |
| Todos saem | sessão espera 2 min (`WATCH_EMPTY_GRACE_MS`) por alguém voltar | — |
| Troca de conteúdo | todos carregam o próximo e começam juntos (início marcado 1,5 s no futuro) | — |

## 5. Configuração
- `YOUTUBE_API_KEY` (opcional): busca e metadados pela YouTube Data API v3. Sem ela, a busca usa o yt-dlp do bot de
  música e os metadados vêm do oEmbed (sem chave).
- `WATCH_HOST_GRACE_MS` (30000) · `WATCH_EMPTY_GRACE_MS` (120000).
- Só para testes: `WATCH_YT_API`, `WATCH_OEMBED_URL`, `WATCH_OEMBED=0`; no app desktop `RESENHA_WATCH_TEST_HOSTS`.

## 6. Testes
- `scripts/watch-unit-test.mjs` (Node, sem navegador): adaptadores, lógica de sincronia, sessões (Hosting/Sharing,
  permissões, duplicados, concorrência, troca de anfitrião, reconexão, fim automático, erros).
- `scripts/watch-test.mjs` (servidor real + 4 navegadores + SFU de voz, YouTube simulado): fluxo completo com capturas
  em `.testshots/watch-*.png`.
- `scripts/watch-desktop-test.mjs` (Electron real, tela virtual): janela de serviço, ponte, DRM, login, sessão
  persistente, bloqueio de domínios, busca da Netflix pela API do player.

## 7. Validação manual pendente (não automatizável aqui)
- YouTube real: vídeos com incorporação proibida, restrição de idade, lives, Shorts, anúncios (o player oficial mostra
  anúncios; a sincronia é retomada quando o anúncio acaba, mas não foi medido com anúncios reais).
- Netflix/Prime Video/Crunchyroll com contas reais: hoje só a sincronização assistida é utilizável. Para "controles
  sincronizados" é preciso um build do app com Widevine (+ VMP) e testar com cada serviço se o `<video>`/API do player
  aceita os comandos.
- Mobile: a interface funciona em tela estreita (lateral embaixo), mas não foi testada em aparelho real.

## Checklist

- [x] Auditoria da arquitetura existente (§1)
- [x] Adaptadores de serviço (`watchsvc.js`) + testes
- [x] Lógica de sincronização pura (`watchsync.js`) + testes
- [x] Servidor: sessões, fila, permissões, anfitrião, reconexão, fim automático (`server/watch.js`) + testes
- [x] Gateway `WATCH` + ganchos de voz (entrar/sair/queda)
- [x] Interface: player grande, fila lateral, busca, participantes com indicador de sincronia, controles
- [x] Seleção de serviço e modos Hosting/Sharing (com autorização individual e troca de anfitrião)
- [x] Player YouTube (IFrame API), player HTML5 (link/arquivo), player externo (assistido/ponte)
- [x] Lançador de atividades na chamada (Watch Together, lousa, código, "O que jogar")
- [x] Convite para assistir junto (cartão na DM, aviso com toque, aceitar abre a atividade)
- [x] Minimizar sem sair da chamada (mini player arrastável; continua em outros canais)
- [x] Estados de erro com explicação e ação (§4), incluindo player travado e recusa do YouTube
- [x] App desktop: janela de serviço com sessão própria + ponte de controles + detecção de DRM/login
- [x] Testes: unitário (93), ponta a ponta com 4 navegadores (56), app desktop com Electron (17)
- [x] Capturas de tela (`.testshots/watch-*.png`)
- [x] Regressão: voz, reconexão, permissões, música, atividades, gateway, desktop (ver §8)
- [x] Documentação dos limites de cada serviço (§3, §7)
- [ ] **Não feito:** controles sincronizados reais para Netflix/Prime/Crunchyroll (exige build com Widevine + VMP; ver §3)
- [ ] **Não feito:** reprodução real do YouTube validada daqui (o YouTube recusa tocar neste ambiente de nuvem — erro 150 até na página mínima do player). Carregamento da API oficial, oEmbed e leitura da duração reais foram validados (`scripts/watch-youtube-real.mjs`)
- [ ] **Não feito:** sugestões/"em alta" do YouTube na aba Adicionar (mostra os assistidos recentemente no servidor)

## 8. Regressão (2026-11-18)
Passaram: activity-ui, appaudio-watch, desktop, features, frontwatch, gamenight, gateway-limits, intents-ui, lfg-room,
music, reconnect-storm, rejoin, voice-mod, voice-perms, voice-recovery, watch-desktop, watch, watch-unit.
`callinvite-test` (página não abre no teste) e `ui-test` ("modo de voz: SFU") falham **igualmente no commit anterior
ao Watch Together** (046fd81) neste ambiente: não são regressão desta funcionalidade.

## Piscadas no app desktop e fila vazia (2026-11-18)
- O YouTube toca num iframe, então as três correções das transmissões e dos clipes (docs/DESKTOP-VISUAL.md) não valiam
  para ele. Agora: o iframe recebe `filter: opacity(.999)` no app (`html.lc-desk`); o player avisa o ponto anti-VRR de
  `public/vrrfix.js` (`vrrSource`) enquanto toca; nada por cima do vídeo usa `backdrop-filter` ou animação contínua; e
  o relógio da barra só escreve no DOM quando o texto muda.
- Sem item atual (fila acabou ou o atual foi removido), o player é destruído. Antes ele só pausava e continuava visível
  (e clicável) atrás de "A fila acabou".

## Sincronia fina, som no começo, legendas e tela cheia (2026-11-18)
- **Sincronia** (`decide` em `public/watchsync.js`): diferença medida pela mediana das últimas 5 leituras, a cada
  200 ms. Tocando: até 40 ms está ok; acima de 0,1 s (2 leituras) o vídeo acelera ou freia entre 0,9× e 1,1×
  (`setRate`) até voltar a menos de 40 ms, sem pular; acima de 1,5 s pula na hora. Player que não aceita velocidade
  fracionada (o YouTube às vezes arredonda para 0,75/1/1,25; conferido 0,7 s depois de pedir) cai para pulos com
  tolerância de 0,25 s. Pausado: alinha no ponto exato acima de 50 ms. Começo e play marcados no futuro (`at`) são
  disparados por um timer no instante exato, não pela conferência periódica. Relógio da sala reamostrado a cada 10 s.
  Teste de ponta a ponta: cada navegador a menos de 150 ms da sala, por 3 s seguidos, depois de pausar, voltar, entrar
  tarde, reconectar e trocar de anfitrião.
- **Mudo no começo:** o YouTube carregado sem autoplay fica "não iniciado" (-1) e o motor não mandava o play; depois
  de 5 s a proteção de autoplay tocava sem som. Agora manda o play nesse estado, a proteção só age depois de 8 s, e
  se o navegador realmente bloquear, o som volta sozinho no primeiro clique.
- **Legendas:** desligadas por padrão (`unloadModule('captions')`, porque o YouTube liga pela conta mesmo com
  `cc_load_policy=0`); botão CC e tecla C ligam a faixa em português (ou no idioma do aparelho). Só para quem ligou.
- **Volume:** arrastar não redesenha mais os controles (redesenhar destruía o controle no meio do arraste).
- **Tela cheia:** o vídeo ocupa a tela inteira e os controles ficam por cima, sumindo com o mouse parado.


## Transmissões, barra da chamada e eco (2026-11-18)
- **Transmissão de outra pessoa com o Watch Together aberto:** o player cobre o palco (`#stage.wt-cover`), então a
  transmissão ficava escondida sem aviso. Agora o topo mostra "AO VIVO · Fulano ao vivo" (`liveBtn`, lista vinda de
  `ctx.streams`); o clique minimiza o player e abre a transmissão (`ctx.watchStream` → `watchOnly`). Qualquer outro
  "Assistir" (lista da sala, menu da pessoa, quadro do palco) chama `yieldStage()` e também minimiza.
- **Barra da chamada por cima do player:** o `#wt` fica fora do `#vcall`; com o mouse no player a regra
  `#vcall:not(:hover)` escondia a barra (deslocada para baixo), `place()` media o retângulo deslocado e o player crescia
  por cima dela, e ao voltar a barra aparecia sobre os controles do vídeo. Agora, com o palco coberto, a barra e o topo
  ficam parados e à vista, a altura vem de `bar.offsetTop` (posição de layout, sem a animação) e os botões que flutuam
  acima da barra (`.partbtn`, `.layoutbtn`, `.bar-ctl`, layout do topo) saem. O mini player nasce acima da barra.
- **Cancelamento de eco cortando a voz:** com `echoCancellation: true` o Chromium usa como referência todo som que a
  página toca, inclusive o vídeo do YouTube; com o vídeo tocando sem parar o filtro cortava a voz de quem falava por
  cima dele, mesmo de fone. O microfone agora pede `echoCancellation: 'remote-only'` (só o áudio da chamada, que chega
  pelo WebRTC, é cancelado; `echoConstraint` em `public/voice.js`). "Cancelar também o som do app" (`prefs.echoAll`)
  volta ao modo antigo. Navegadores sem `'remote-only'` leem o texto como `true`.
  Limite: vozes com volume acima de 100% ou com efeito de voz passam pelo WebAudio e não entram nessa referência; quem
  usa caixa de som e aumenta alguém acima de 100% pode precisar ligar "Cancelar também o som do app".
