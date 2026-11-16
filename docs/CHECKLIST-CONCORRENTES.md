# Checklist: ideias dos concorrentes

Ordem de trabalho das ideias aprovadas em `docs/CONCORRENTES.md` (seção "Decisões"). Marque `[x]` ao terminar cada item, com o commit ou a observação ao lado.

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

## 2. Moderação de voz (usa a hierarquia)
- [ ] Mutar e ensurdecer alguém para a sala (permissão nova).
- [ ] Mover para outra sala e desconectar da chamada.
- [ ] Menu de clique direito na pessoa da sala; registro de auditoria.
- [ ] Teste.

## 3. Confiança (barato) — feito
- [x] `SECURITY.md`: como relatar falha (relato privado do GitHub), resposta em até 7 dias, o que está dentro, dicas para quem hospeda.
- [x] `PRIVACIDADE.md`: o que o servidor guarda, quem vê, terceiros e como desligar cada um, nada vendido nem usado para treinar IA; abre em Privacidade e segurança → Como seus dados são tratados (`/privacidade`, `/seguranca`; entram na imagem Docker).

## 4. Eventos → Raids e times
- [ ] Composição por função (vagas por função, inscrição com função e reserva, quadro no cartão).
- [ ] Vários times no mesmo evento, mover entre times, balancear pelo elo do LFG.
- [ ] Lista de espera por função com promoção automática.
- [ ] Modelos por jogo (WoW, Dota 2, Deadlock, LoL Clash, Valorant, Grand Line Adventures, personalizado).
- [ ] Evento semanal (raid fixa).
- [ ] "Chamar quem falta" e uma sala de voz por time.

## 5. Voz para gamers
- [ ] Sala com limite de pessoas.
- [ ] Sala com senha.
- [ ] Orador prioritário.
- [ ] Pedir a vez de falar.
- [ ] Sussurro (tecla, alvos: pessoas, cargo, sala).
- [ ] Modo competitivo e ping por pessoa.

## 6. Moderação automática
- [ ] Automod (palavras, links, spam, menções em massa).
- [ ] Níveis de confiança para contas novas.
- [ ] Fila de aprovação opcional e denúncia com motivo.

## 7. Migração do Discord
- [ ] Importar a estrutura do servidor (canais, categorias, cargos, permissões, emojis).
- [ ] Guia "Vindo do Discord?".

## 8. E2EE mais ampla
- [ ] DMs em grupo.
- [ ] Verificação por emoji/QR e chave de recuperação.
- [ ] Sigilo futuro.

## A decidir / depois
- Tarefas com responsável e prazo, figurinhas, regras aceitas ao entrar (Root).
- Economia do servidor, "O que eu perdi?", ponte entre instalações, modo demonstração.
- Personalização: CSS, temas, multi-janela.
