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
- [ ] Listas longas que desenham só o que está na tela (membros de servidor grande, conversas, busca, histórico).
- [ ] CSS: medir regras sem uso e seletores caros (`:has`, desfoque, sombras grandes, `backdrop-filter`); ~370 KB hoje.
- [ ] Imagens no tamanho certo (avatar de 117 px em espaço de 24 px): versões menores geradas pelo servidor.

## Voz e vídeo
- [x] ★ ~~"Falando" pelo nível de áudio que o WebRTC já entrega~~ (`getSynchronizationSources`) — **medido e descartado**
      (2026-11-11): implementado e comparado com 5 pessoas na call, com áudio parecido com fala. A thread de áudio ficou
      igual (9,1–9,7% com o analisador, 9,1–9,3% com o RTP): o analisador WebAudio já é barato. O "falando" pelo RTP
      batia com o do analisador, mas não compensou a complexidade; voltou ao analisador.
- [ ] "Falando" pelo servidor (`AudioLevelObserver` do mediasoup): ensurdecido continuaria vendo quem fala sem receber o
      áudio, e aí dá para pausar a voz dos outros mesmo com a janela aberta.
- [ ] Câmera chegando no tamanho do quadro na tela (camada do simulcast) e pausando fora de vista, como a transmissão.
- [ ] CPU de cada filtro de ruído; modo leve sugerir um mais leve quando o processador estiver no limite.
- [ ] Medir a gravação contínua dos clipes (F8) e a cifra quadro a quadro das chamadas protegidas.

## Rede e servidor
- [x] ★ **Presença só para quem está olhando o servidor** (2026-11-11). O app manda `VIEW` (servidor na tela; nenhum
      com a janela escondida); entrar/sair/trocar de aparelho vira um `PRESENCE` pequeno (id, status, aparelhos) para a
      própria pessoa, amigos, conversas diretas e quem está olhando um servidor dela; ao abrir um servidor chega
      `PRESENCE_SYNC` com quem está online. App antigo (sem `VIEW`) recebe como antes. Carga com 500 pessoas no mesmo
      servidor e 20% olhando: mensagens do gateway 789 mil → 655 mil (−17%), dados 597 → 536 MB, espalhar uma
      presença p95 9 → 2,4 ms; os avisos de presença caíram ~74%. Teste: `scripts/presence-test.mjs`.
- [ ] Mesma ideia para "digitando…" e outros avisos que vão para o servidor inteiro sem ninguém olhando o canal
      (o grosso do tráfego que sobrou na carga são as mensagens de chat, que precisam ir a todos pelas não lidas).
- [ ] READY menor: membros sob demanda.
- [ ] Mais de um worker do mediasoup (hoje 1 núcleo para todas as salas).
- [ ] SQLite: plano de todas as consultas, WAL e `synchronous`.
- [ ] Limite no servidor para `VOICE_STATE` e outras mensagens repetidas de um cliente modificado.

## App desktop
- [ ] Jogo em tela cheia por cima da janela contar como "escondida" (o `lc-audio` sabe a janela da frente).
- [ ] Desaceleração da janela também em chamada quando escondida.

## Testes de brechas
- [ ] ★ **PC fraco + resposta a cliques (INP)**: CPU 6x mais lenta; digitar, abrir emojis, trocar de servidor, rolar
      10 mil mensagens contando quadros perdidos.
- [ ] ★ **Sessão longa**: horas em call e uso simulado, comparando a memória do app e do servidor ao longo do tempo.
- [ ] Rede instável na voz (perda, oscilação, atraso), servidor reiniciando no meio da call, 500 reconectando juntos.
- [ ] Dados grandes: servidor com 1.000 canais, 5.000 membros, 100 mil mensagens; 500 conversas diretas.
- [ ] Conflitos: dois aparelhos/abas da mesma conta ao mesmo tempo; resposta antiga chegando depois e sobrescrevendo a
      tela ao trocar rápido de servidor.
- [ ] Abuso: inundação de mensagens pelo gateway, mensagens gigantes, textos que travam expressões regulares (markdown,
      `cleanLinks`).
- [ ] Celular/navegador: aba congelada ou descartada voltando; voltar/avançar do navegador.
- [ ] Orçamento de desempenho: comparar o JSON do `perf-audit`/`perf-stress` com limites a cada mudança.
- [ ] Consertar testes quebrados: `mic-rebuild-test` (botão que mudou de nome), lista de microfones do `ui-test`,
      `discover-test` (lançamentos), e `e2e`/`features`/`fase2`, que esperam um servidor na porta 3000.
