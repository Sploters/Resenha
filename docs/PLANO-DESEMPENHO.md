# Plano de desempenho (checklist)

O que ainda dá para melhorar ou testar depois da auditoria de 2026-11-11 (`docs/AUDITORIA-DESEMPENHO.md`).
Marque `[x]` ao concluir e anote o resultado medido. Ordem sugerida: os marcados com ★ primeiro.

## Desenho da interface
- [x] ★ **Redesenhar só o que mudou** na lista lateral e na lista de membros (2026-11-11, `scripts/perf-churn.mjs`:
      300 membros, ~6 entradas/saídas por segundo, quem está com a lista aberta). Thread principal **19,4% → 9,4%**;
      com a CPU 4x mais lenta **83,8% → 39,2%**. O que mudou: troca de status não redesenha mais o chat (as mensagens
      não mostram status) nem a lista de canais do servidor; ordenação com o cargo calculado uma vez e `Intl.Collator`;
      linha de membro guardada enquanto o que ela mostra não muda; `morph()`/`place()` (`util.js`) atualizam a lista
      no lugar (rolagem e fotos ficam). A lista atualizada aos pedaços sai idêntica a uma montada do zero.
- [ ] Discover: atualizar só a seção que chegou, em vez da página inteira.
- [ ] Listas longas que desenham só o que está na tela. **Feito em parte** (2026-11-11, junto com os dados grandes): lista de
      membros aos pedaços (200 por grupo, +300 ao rolar até o fim ou no "Mostrar mais") e categorias da lateral montadas
      quando chegam perto da tela. Faltam: conversas diretas (500 levam ~100 ms para abrir), busca e histórico.
- [ ] CSS: medir regras sem uso e seletores caros (`:has`, desfoque, sombras grandes, `backdrop-filter`); ~370 KB hoje.
- [x] ★ **Imagens no tamanho certo** (2026-11-11). As fotos enviadas já passavam pelo `imgUrl` (WebP do tamanho do quadro,
      `server/thumbs.js`); faltavam os 12 avatares padrão (554–1024 px, a foto de toda conta nova) e alguns lugares que
      usavam a foto original: ícone do servidor no convite, servidores em comum, caixa de entrada, avatar da menção,
      banners do servidor e do perfil e a cor média dos quadros da call. Avatares padrão ganharam versões de 64/128/256 px
      em WebP (`scripts/avatar-sizes.mjs`, rodar de novo ao trocar um). Servidor grande aberto com a lista de membros
      (`scripts/image-sizes-test.mjs`): avatares baixados **90 → 16 KB**, pixels decodificados **1,57 → 0,02 megapixel**,
      nenhum avatar maior que o dobro do quadro (antes, todos os 57).

## Voz e vídeo
- [x] ★ ~~"Falando" pelo nível de áudio que o WebRTC já entrega~~ (`getSynchronizationSources`) — **medido e descartado**
      (2026-11-11): implementado e comparado com 5 pessoas na call, com áudio parecido com fala. A thread de áudio ficou
      igual (9,1–9,7% com o analisador, 9,1–9,3% com o RTP): o analisador WebAudio já é barato. O "falando" pelo RTP
      batia com o do analisador, mas não compensou a complexidade; voltou ao analisador.
- [ ] "Falando" pelo servidor (`AudioLevelObserver` do mediasoup): ensurdecido continuaria vendo quem fala sem receber o
      áudio, e aí dá para pausar a voz dos outros mesmo com a janela aberta.
- [x] ★ **Câmera no tamanho do quadro e pausada fora de vista** (2026-11-11, `voice.js camFlow`, `app.js applyCamFlow`).
      Antes toda câmera chegava na camada cheia (1280 px, ~800 kbps cada), mesmo num quadro de 170 px ou com a sala fora da
      tela. Agora o tamanho do quadro (ResizeObserver, sem forçar layout) escolhe a camada (até 400 px na tela: 1/4; até
      800: metade; maior: cheia; o dobro em tela de alta densidade) e a câmera de quem não está à vista (outro canal, janela
      escondida, rolada para fora, "Desativar vídeo") pausa no servidor depois de 4 s; câmera nova já chega na camada do meio
      e pausada se a sala não está na tela. "Pausar vídeo fora da tela" desligado e janela flutuante (PiP) mantêm tudo.
      Medido (`scripts/cam-flow-test.mjs`, 2 câmeras falsas de 1280x720): grade de 2 **1.577 → 296 kbps (−81%)**; em outro
      canal ou janela escondida **~1.600 → 0 kbps**; câmera em destaque pede uma camada maior e a miniatura a menor.
- [ ] CPU de cada filtro de ruído; modo leve sugerir um mais leve quando o processador estiver no limite.
- [ ] Medir a gravação contínua dos clipes (F8) e a cifra quadro a quadro das chamadas protegidas.

## Rede e servidor
- [x] ★ **Presença só para quem está olhando o servidor** (2026-11-11). O app manda `VIEW` (servidor na tela; nenhum
      com a janela escondida); entrar/sair/trocar de aparelho vira um `PRESENCE` pequeno (id, status, aparelhos) para a
      própria pessoa, amigos, conversas diretas e quem está olhando um servidor dela; ao abrir um servidor chega
      `PRESENCE_SYNC` com quem está online. App antigo (sem `VIEW`) recebe como antes. Carga com 500 pessoas no mesmo
      servidor e 20% olhando: mensagens do gateway 789 mil → 655 mil (−17%), dados 597 → 536 MB, espalhar uma
      presença p95 9 → 2,4 ms; os avisos de presença caíram ~74%. Teste: `scripts/presence-test.mjs`.
- [x] ★ **"Digitando…" só para quem olha o servidor** (2026-11-11). Só aparece no chat e na prévia dos canais do
      servidor na tela, então vai para quem mandou `VIEW` daquele servidor (e app antigo); conversa direta continua indo
      ao outro lado sempre. Carga (`scripts/load/node-load.mjs`, agora com "digitando…" antes de cada
      mensagem; 500 pessoas no mesmo servidor, 20% olhando, `SPEED=2`), junto com o cache de consultas e os limites
      abaixo: mensagens do gateway **1,87 mi → 918 mil (−51%)**, dados 633 → 560 MB, CPU do servidor no teste inteiro
      **62,8 → 35,4 s (−44%)**, `GET mensagens` p95 18 → 10 ms (no servidor 4,8 → 2,3 ms), entrega de mensagem p95
      21 → 14 ms, READY p95 294 → 233 ms; 0 erros nos dois.
      Os outros avisos que vão ao servidor inteiro (`VOICE_STATE`, `MESSAGE_UPDATE`, membros, cargos) são estado que o app
      guarda: cortar exigiria sincronizar ao abrir o servidor, como o `PRESENCE_SYNC` — fica para depois.
- [x] ★ **READY menor: membros sob demanda** (2026-11-11). Servidor com `READY_LARGE` membros ou mais (padrão 1.000) vai
      no READY só com quem está online, a própria pessoa e o dono (`partial: true`, `member_count`); o app pede a lista
      inteira ao abrir o servidor ou as configurações dele (`GET /api/guilds/:id/members`, gzip; `state.js loadMembers`).
      Membros que chegam por evento durante o carregamento ficam como estão. Com 5.000 membros (`scripts/perf-big.mjs`):
      READY de um membro comum **2.844 → 195 KB** (comprimido 152 → 13 KB, montagem 48 → 21 ms); do dono com 500 conversas
      3.479 → 989 KB; abrir o app **2,8 → 0,6 s**; com 600 pessoas conectadas, `GET mensagens` p95 98 → 6 ms (o servidor
      parou de montar READYs enormes). Abrir o servidor grande pela 1ª vez custa ~100 ms a mais (a lista chega nessa hora).
      Teste: `scripts/big-data-test.mjs` (também com `READY_LARGE=2` no `presence-test`).
- [x] ★ **Mais de um worker do mediasoup** (2026-11-11, `server/sfu.js`). `SFU_WORKERS=N` (ou `auto`: núcleos, até 4);
      padrão continua 1. Cada sala fica inteira num worker — o com menos gente quando a sala abre — e cada worker extra
      escuta na própria porta (`RTC_EXTRA_PORT`, padrão 40011, 40012…; precisa estar aberta como a 40000). Worker que
      morre: salas novas vão para os outros. `/api/sfu/load` mostra a CPU do mais carregado e `per_worker`. Teste:
      `scripts/sfu-workers-test.mjs` (2 salas em 2 workers, voz chegando nas duas). Uma sala sozinha continua num núcleo
      só (dividir uma sala entre workers, com `pipeToRouter`, fica para quando uma sala passar de 1 núcleo).
- [x] ★ **SQLite** (2026-11-11). WAL e `synchronous=NORMAL` já estavam. Novo: consulta preparada guardada pelo texto
      (`server/db.js`; preparar a cada chamada era ~4/5 do custo de uma consulta pequena: 6,8 → 1,6 µs), `busy_timeout`,
      `temp_store=MEMORY`, cache de 32 MB. Plano (`EXPLAIN QUERY PLAN`) das 268 consultas do servidor: sobraram 3
      varreduras que valiam índice — apagar canal varria `clips`, apagar conta varria `lfg_posts` e achar o admin varria
      `users`. O resto que varre são buscas com `LIKE '%…%'` (limpeza de arquivos, busca de música), que não usam índice.
- [x] ★ **Limite por conexão no gateway** (2026-11-11, `wsGate` em `server/index.js`). Balde de fichas por tipo e um
      geral (300/s). Para estado (`VIEW`, `VOICE_STATE`, `CLIENT_INFO`, `ACTIVE`, `ACTIVITY_LOCAL`, `ROOM_CODE`), passando
      do limite o último pedido é guardado e aplicado depois — o estado nunca fica errado; o resto é ignorado. 3.000
      ignoradas em 10 s fecham a conexão (4008; o app reconecta). `VOICE_STATE` igual ao atual não é mais espalhado para o
      servidor. Medido (`scripts/gateway-limits-test.mjs`): 60 trocas de mudo seguidas → 16 envios e o último vale; 41
      `VIEW` → 5 sincronizações de presença; 50 "digitando…" → 4; 6.000 mensagens → conexão fechada, as outras de pé.

## App desktop
- [ ] Jogo em tela cheia por cima da janela contar como "escondida" (o `lc-audio` sabe a janela da frente).
- [ ] Desaceleração da janela também em chamada quando escondida.

## Testes de brechas
- [x] ★ **PC fraco + resposta a cliques (INP)** (2026-11-11, `scripts/perf-inp.mjs`, CPU 6x mais lenta, 300 membros):
      digitar, enviar, emojis, trocar de canal, perfil, configurações, buscar membro e rolar o histórico. Achados e
      corrigidos: (1) o filtro de saturação ligado mesmo em 100% fazia o Chrome promover cada mensagem e avatar a uma
      camada própria (86 camadas com 37 mensagens; agora 9) — só liga com a saturação mudada; (2) cada página do
      histórico remontava o chat inteiro — agora só entram as mensagens novas no topo. Rolando: pior quadro 633 → 283 ms,
      35 → 49 fps, travadinhas 17 → 8; perfil 72 → 32 ms, configurações 64 → 32 ms; chat aos pedaços igual ao montado do
      zero. Fica: a 1ª abertura dos emojis (~250 ms nesse PC, ~40 ms num normal, uma vez só; a 2ª leva 60–80 ms).
- [x] ★ **Sessão longa** (2026-11-11, `scripts/perf-soak.mjs`): call de 3 aberta, gente entrando/saindo, mensagens
      chegando e o app usado em ciclos, medindo a cada minuto depois da coleta de lixo. Achou um vazamento real que eu
      mesmo tinha criado no redesenho incremental: a linha guardada da lista de membros segurava, pelo clique, a tela
      antiga inteira (30 min: 430 mil elementos, +600 MB/hora no navegador) — o cache agora vale só dentro do mesmo
      painel. E o chat de um canal movimentado crescia para sempre (~900 mensagens/hora): com a pessoa no fim, ficam as
      150 mais novas ao passar de 250 (`trimChat`; teste `scripts/chat-trim-test.mjs`). Depois, em 25 min: elementos
      oscilando entre 5,6 e 8,2 mil, memória JS ~4,5 MB, navegador ~1.280 MB e servidor 146–147 MB estáveis, SFU limpo.
      Testar mais longo (horas) numa máquina real ainda vale a pena.
- [x] ★ **Trace real: INP 328 ms e mouse lento** (2026-11-11, `scripts/namefx-emoji-test.mjs`, CPU 6x). Dois traces do
      Chrome mostraram: (1) quem usa nome **Arco-íris/Brilho** fazia o chat inteiro ser repintado em todo quadro — o efeito
      anima `background-position`, que o Chrome não anima fora da thread principal (3.164 repinturas em 6 s por um autor;
      até passar o mouse levava ~85 ms para aparecer). Agora o nome fica parado nas listas e só anima com o mouse em cima da
      linha; no perfil, cartão e editor anima sempre. 50 nomes na tela: **8.817 → 0 repinturas** em 3 s parado.
      (2) A 1ª abertura dos **emojis** era o INP: 144 ms de layout + 118 ms desenhando as letras coloridas. Emojis em blocos
      de 5 linhas com `content-visibility` + fonte aquecida aos poucos com a aba parada: **328 → ~100 ms**. E o "Adicionar
      amigo" aceita `@nome` e qualquer caixa (os 404 do console eram o nome não batendo).
- [ ] Rede instável na voz (perda, oscilação, atraso), servidor reiniciando no meio da call, 500 reconectando juntos.
- [x] ★ **Dados grandes** (2026-11-11, `scripts/load/seed-big.mjs` + `scripts/perf-big.mjs`): 5.000 membros, 1.000 canais
      em 50 categorias, 8 cargos, 100 mil mensagens, 500 conversas diretas, 600 pessoas conectadas. Achados e corrigidos:
      READY enorme (acima); abrir os 5.000 offline da lista de membros montava 5.000 linhas numa tarefa de 310 ms → aos
      pedaços, **410 → 45 ms** e sem tarefa longa; cada `renderSide` montava as 1.000 linhas de canal (~45 ms) → categorias
      longe da tela viram um espaço do tamanho delas e são montadas ao chegar perto (**45 → 7 ms**); o layout forçado do chat
      ao abrir um canal caiu de 55 para 17 ms. Estão bem: trocar de canal (mediana 24 ms), GET mensagens antigas (p95 4 ms),
      busca (≤ 50 ms), rolar a lista de canais e de membros (sem tarefa longa), memória JS 8 MB. Ficam: abrir as 500
      conversas diretas (tarefa de ~100 ms) e abrir o servidor grande (~150 ms, metade montando o chat).
- [x] ★ **Resposta antiga sobrescrevendo a tela** (2026-11-11, `scripts/stale-response-test.mjs`, respostas atrasadas de
      propósito no navegador). Achados e corrigidos: (1) pular para uma mensagem (`jumpTo`, pelas fixadas/busca/resposta)
      e trocar de canal antes da resposta **guardava as mensagens do canal antigo no canal novo**; (2) fixadas do canal
      antigo abriam por cima do canal novo; (3) galeria de clipes: trocar de aba com outra carregando ignorava a aba nova e
      mostrava a resposta velha; (4) busca do canal, grupo da busca global e cartão de perfil (clicar em A e logo em B):
      a resposta mais lenta cobria a mais nova; (5) páginas do histórico chegando depois de trocar de canal. A → B → A
      rápido já funcionava (o `api()` junta pedidos iguais em andamento). A versão anterior falha em 4 dos 8 testes.
- [ ] Conflitos: dois aparelhos/abas da mesma conta ao mesmo tempo.
- [x] ★ **Abuso: mensagens gigantes e expressões que travam** (2026-11-11, `scripts/abuse-regex-test.mjs`; inundação
      pelo gateway já estava no limite por conexão, acima). Cada função que lê o texto da mensagem (markdown, `cleanLinks`,
      convites, chamadas, clipes, horários, temas, GIF, links de vídeo, "só emoji") recebe ~45 textos de 4.000 caracteres
      feitos para forçar retrocesso, num worker que é morto se travar. Achado grave: o **"só emoji"** (mostra emoji
      grande) tinha repetição dentro de repetição — "😀 😀 … 😀 x" levava 22 s com 14 emojis e, com 27, **travava para
      sempre a aba de todo mundo que abrisse o canal**. Virou uma verificação linear (0,2 ms; mesmo resultado nos casos
      normais). O resto ficou abaixo de 2 ms no pior caso. No servidor: `reply_to` guardava qualquer texto (até 1 MB) → só id
      de mensagem do mesmo canal; menções a contas fora do canal eram gravadas (900 por mensagem) → só quem está no canal,
      até 50; @everyone de qualquer membro notificava todo mundo a cada mensagem (5.000 linhas na caixa de entrada por
      envio) → quem não modera notifica 1 vez a cada 5 min por servidor (a mensagem vai normalmente; só não notifica de
      novo); a caixa de entrada é gravada numa transação.
- [ ] Celular/navegador: aba congelada ou descartada voltando; voltar/avançar do navegador.
- [ ] Orçamento de desempenho: comparar o JSON do `perf-audit`/`perf-stress` com limites a cada mudança.
- [ ] Consertar testes quebrados: `mic-rebuild-test` (botão que mudou de nome), lista de microfones do `ui-test`,
      `discover-test` (lançamentos), e `e2e`/`features`/`fase2`, que esperam um servidor na porta 3000.
