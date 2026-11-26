# Checklist: ideias dos concorrentes

Ordem de trabalho das ideias aprovadas em `docs/historico/CONCORRENTES.md` (seção "Decisões"). Marque `[x]` ao terminar cada item, com o commit ou a observação ao lado.

## 1. Hierarquia de cargos (segurança, prioridade máxima) — feito
- [x] Posição dos cargos em ordem de verdade: posições 1..n, cargo novo entra no fim (posição 1); as posições aleatórias antigas são renumeradas uma vez sem mudar a ordem (`meta` `roles-position-1`); apagar um cargo fecha o buraco.
- [x] `rankOf` / `outranks` em `server/index.js` (dono acima de todos) e o espelho no app (`public/state.js`).
- [x] Expulsar, banir, castigar e mudar apelido de outro: só em quem está abaixo.
- [x] Dar e tirar cargos: só cargos abaixo do seu (os de cima que a pessoa já tem ficam como estão); mexer nos cargos de outro só se ele estiver abaixo.
- [x] Criar, editar e apagar cargos: só abaixo do seu; nunca dar nem tirar uma permissão que você não tem.
- [x] Reordenar: `PUT /api/guilds/:id/roles/order` e botões ▲ ▼ na lista de cargos, só abaixo do seu (arrastar fica para depois).
- [x] App: opções somem no clique direito e na lista de membros; cargos acima aparecem com 🔒 e "só para ver"; permissões que você não tem ficam travadas.
- [x] Teste: `scripts/roles-hierarchy-test.mjs` (32 verificações).
- [x] Permissões por canal: o ajuste de um cargo do seu nível para cima não muda nem some ao sincronizar.

## 2. Moderação de voz (usa a hierarquia) — feito
- [x] Permissão nova **Moderar voz** (`P.VOICE_MOD = 512`).
- [x] Mutar e ensurdecer para o servidor: vale em todas as salas e continua ao sair e voltar (`members.voice_mute/voice_deaf`) até alguém tirar. No SFU o microfone fica pausado no servidor e as vozes não chegam a quem foi ensurdecido (`sfuModerate` em `server/sfu.js`); no app o microfone também fecha. Sem SFU (malha P2P) vale só pelo app.
- [x] Mover para outra sala (o app da pessoa entra sozinho, com aviso) e desconectar da chamada (aviso + sai para todos).
- [x] Clique direito na pessoa (na sala ou na lista): Mutar/Ensurdecer para o servidor, Mover para, Desconectar; ícones vermelhos "pela moderação"; registro de auditoria (`voice_*`).
- [x] Teste: `scripts/voice-mod-test.mjs`.

## 3. Confiança (barato) — feito
- [x] `SECURITY.md`: como relatar falha (relato privado do GitHub), resposta em até 7 dias, o que está dentro, dicas para quem hospeda.
- [x] `PRIVACIDADE.md`: o que o servidor guarda, quem vê, terceiros e como desligar cada um, nada vendido nem usado para treinar IA; abre em Privacidade e segurança → Como seus dados são tratados (`/privacidade`, `/seguranca`; entram na imagem Docker).

## 4. Eventos → Raids e times
- [x] Composição por função (vagas por função, inscrição com função e espera, quadro no cartão) — `5415d73`, `server/events.js`.
- [ ] Vários times no mesmo evento, mover entre times, balancear pelo elo do LFG.
- [x] Lista de espera por função com promoção automática (também no evento sem funções) — `5415d73`.
- [x] Modelos por jogo (WoW raid e Mítica+, Dota 2, Deadlock, LoL/Clash, Valorant, dois times, personalizado) — `5415d73`. Grand Line Adventures ficou de fora (sem funções fixas conhecidas: usar o personalizado).
- [x] Evento semanal (raid fixa): o da semana seguinte é marcado ao terminar; cancelar pode parar a série — `5415d73`.
- [ ] "Chamar quem falta" e uma sala de voz por time.

## 5. Voz para gamers
- [x] Sala com limite de pessoas — `81329e3`, `server/voicerooms.js`.
- [x] Sala com senha (hash só no servidor; quem acertou volta sem digitar) — `81329e3`.
- [x] Orador prioritário (permissão de cargo; as outras vozes a 25% no app de quem ouve) — `81329e3`.
- [x] Pedir a vez de falar (fila na ordem; quem modera voz baixa a mão) — `81329e3`.
- [x] Sussurro para pessoas ou um cargo da mesma sala (o SFU pausa a voz para os outros) — `81329e3`. Ainda não: tecla de atalho e sussurro para outra sala.
- [ ] Modo competitivo e ping por pessoa.

## 6. Moderação automática
- [ ] Automod (palavras, links, spam, menções em massa).
- [ ] Níveis de confiança para contas novas.
- [ ] Fila de aprovação opcional e denúncia com motivo.

## 7. Migração do Discord
- [x] Importar a estrutura do servidor por link de modelo (canais, categorias, cargos, permissões) — `7cdac73`, `server/discordimport.js`. Emojis não vêm no modelo do Discord.
- [ ] Guia "Vindo do Discord?".

## 8. E2EE mais ampla
- [ ] DMs em grupo.
- [ ] Verificação por emoji/QR e chave de recuperação.
- [ ] Sigilo futuro.

## A decidir / depois
- Tarefas com responsável e prazo, figurinhas, regras aceitas ao entrar (Root).
- Economia do servidor, "O que eu perdi?", ponte entre instalações, modo demonstração.
- Personalização: CSS, temas, multi-janela.
