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
| Ação | Hosting | Sharing |
|---|---|---|
| Adicionar à fila | todos | todos |
| Remover item | o próprio item; anfitrião/autorizados removem qualquer | todos |
| Reordenar, pular, tocar item | anfitrião/autorizados | todos |
| Play, pause, posição | anfitrião/autorizados | todos |
| Mudar modo, passar anfitrião, autorizar | anfitrião | anfitrião |
| Volume | sempre local | sempre local |

## 3. Níveis de integração por serviço

(preenchido na seção 6 com o que foi efetivamente alcançado)

## Checklist

- [x] Auditoria da arquitetura existente
- [ ] Adaptadores de serviço (`watchsvc.js`) + testes
- [ ] Lógica de sincronização pura (`watchsync.js`) + testes
- [ ] Servidor: sessões, fila, permissões, anfitrião, reconexão, fim automático (`server/watch.js`) + testes
- [ ] Gateway `WATCH` + ganchos de voz
- [ ] Interface: player grande, fila lateral, busca, participantes com indicador de sincronia, controles
- [ ] Seleção de serviço e modos Hosting/Sharing
- [ ] Player YouTube (IFrame API), player HTML5 (link/arquivo), player externo
- [ ] Lançador de atividades na chamada
- [ ] Convite para assistir junto
- [ ] Minimizar sem sair da chamada (mini player)
- [ ] Estados de erro com ação (incorporação bloqueada, indisponível, DRM, login, buffering, perda de sincronia…)
- [ ] App desktop: janela de serviço + ponte de controles + detecção de DRM
- [ ] Testes E2E com vários navegadores
- [ ] Capturas de tela
- [ ] Regressão (voz, música, atividades)
- [ ] Documentação final dos limites de cada serviço
