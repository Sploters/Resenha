# "A fim de jogar": disponibilidade social, intenção de jogar e LFG invertido

Objetivo: o Resenha deixa de só esperar alguém chamar. Quem está a fim de jogar diz **o quê, até quando e com quantas
pessoas**; o servidor descobre **quem dos amigos tem/joga aquele jogo**, convida só essas pessoas e, quando o mínimo topa,
**escolhe a sala e manda o convite para a chamada** (ninguém é colocado na sala à força).

Status: 🟡 em andamento · branch `claude/jolly-galileo-cin4x4`

---

## 0. Auditoria (o que já existe e será reaproveitado)

| Sistema | Arquivo | O que reaproveitamos |
|---|---|---|
| LFG (anúncios, vagas, pedidos, perfil por jogo) | `server/lfg.js`, `public/lfg.js` | catálogo de jogos (`GAMES`), perfis de jogador (`lfg_profiles`) como sinal de compatibilidade, público (`lfgAudience`) e o mural como **alternativa** quando a intenção expira sem grupo |
| Convite para a chamada | `server/callinvites.js`, `public/callinvite.js` | o convite final para a sala (toque, cartão na DM, aceitar já coloca no servidor e na sala, expira em 5 min) |
| "Jogando…" e histórico | `server/activity.js` | quem está jogando o jogo agora e quem jogou nos últimos 14 dias (tabela `activities`), sempre pela regra de privacidade `canSee` |
| Biblioteca/wishlist Steam | `server/games.js` | quem tem o jogo (`game_library`, com horas) e quem quer (`wishlist`), pela regra `games_share` |
| Presença | `server/index.js` (`realStatus`, `privacy`) | online/ausente/não perturbe/invisível; bloqueios |
| Preferências da conta | `users.settings` (`S.prefs` no app) | preferências de aviso das intenções (o servidor lê como o `ux.js` já faz) |
| Painel "Ativo agora" | `public/activity.js` | a nova seção "A fim de jogar" entra no topo do painel (sem tela nova) |
| Telemetria sem identificar ninguém | `server/ux.js`, `public/uxstats.js` | métricas sociais com o mesmo cuidado (código embaralhado, opt-out, 60 dias) e no mesmo painel do administrador |

O que **não** existia: intenção com validade, compatibilidade por jogo, convite direcionado, formação automática do grupo,
escolha/criação de sala, limites de aviso por pessoa e métricas sociais.

## 1. Decisões

- **Intenção ≠ anúncio do LFG.** O anúncio é público para todo o círculo; a intenção é direcionada (só os convidados veem).
  Tabelas próprias (`play_intents`, `intent_members`), mas o LFG continua igual e vira o plano B ("Publicar no mural").
- **Compatibilidade explicável.** Cada convidado tem o motivo ("Tem na Steam · 120 h", "Jogou ontem", "Jogando agora").
  Quem cria vê a lista antes de enviar e pode desmarcar pessoas.
- **Regras puras em `server/intentmatch.js`** (sem banco), testadas por unidade; `server/intents.js` só junta os dados.
- **Sala:** a sala de voz onde quem criou já está → senão, uma sala vazia do servidor que todos podem usar → senão, uma
  sala temporária "🎮 Jogo" criada pelo Resenha e apagada quando esvazia.
- **Convite final = convite para a chamada existente**, com uma opção para convidar para uma sala onde quem convida ainda
  não está (a intenção formada).
- **Sem push indiscriminado:** no máximo N convidados por vez, limite por hora por pessoa, intervalo entre o mesmo par,
  "Não perturbe" e offline recebem em silêncio (aparece no painel quando voltarem), preferências (todos / só amigos /
  desligado, jogos silenciados).

## 2. Checklist

### Etapa 1: Regras de compatibilidade e formação (puro + testes de unidade)
- [x] `server/intentmatch.js`: chave do jogo, pontuação de compatibilidade com motivos, ranking, limites de aviso, formação, validade
- [x] `scripts/intents-unit-test.mjs` (63 casos, todos passando)
- **Pronto quando:** todos os casos de unidade passam (compatibilidade, jogo sem dado da Steam, preferências, limites, formação, validade).

### Etapa 2: Servidor (intenções, convites, formação, sala, expiração)
- [x] tabelas e rotas em `server/intents.js` (prévia, criar, responder, chamar mais, cancelar, listar)
- [x] formação automática atômica (sem passar das vagas, sem duas salas)
- [x] escolha/criação de sala + convite para a chamada (`callinvites.js` com sala informada)
- [x] expiração (intenção e convites), "ignorou", aviso para quem criou e plano B (LFG)
- [x] deduplicação: intenção aberta do mesmo jogo no círculo → oferecer entrar nela
- **Pronto quando:** testes de integração, concorrência e expiração passam e os testes antigos de LFG/convites continuam passando.
- ✅ `scripts/intents-test.mjs` 105/105 · `lfg-test` 62/62 · `callinvite-test` 29/29
- Problema encontrado: "VALORANT" (Jogando…/digitado) e "Valorant" (catálogo) viravam chaves diferentes e a deduplicação falhava. Corrigido: nome ou appid do catálogo do LFG vira o jogo do catálogo.

### Etapa 3: Interface
- [x] seção "A fim de jogar" no topo do Ativo agora (minha intenção + convites para mim)
- [x] janela "A fim de jogar" com prévia de quem será chamado e por quê
- [x] aviso de convite (Topo / Agora não / silenciar o jogo hoje) e "Grupo formado → Entrar na sala"
- [x] atalho no LFG ("Chamar quem tem o jogo") e plano B no fim da intenção
- [x] Configurações → Notificações: preferências de convites para jogar
- **Pronto quando:** fluxo completo em 3 navegadores com capturas, sem erro de página.
- ✅ `scripts/intents-ui-test.mjs` 37/37 (inclui erro 500 na prévia e queda de rede ao topar)
- Problemas encontrados: o aviso flutuante herdava o estilo por id do `#call-banner` e ficava sem posição (CSS próprio, desce quando os dois aparecem); título do aviso quebrava em 3 linhas (botões numa linha própria); seletor de preferência quebrava (rótulos mais curtos).

### Etapa 4: Métricas
- [x] sessões com 2+ pessoas, retornos por convite/atividade, interações, intenções → grupos, convites aceitos/ignorados/recusados
- [ ] painel do administrador (Estatísticas de uso → Encontros)
- **Pronto quando:** teste confere os números depois de um fluxo conhecido.

### Etapa 5: Qualidade
- [ ] cenários de falha: rede, desconexão, offline, jogo sem dado, sala cheia, convite expirado, erro do servidor
- [ ] regressão (LFG, convites, atividade, painel, jogos, eventos, recursos) + `npm run check`
- [ ] build
- **Pronto quando:** tudo verde, ou a pendência real registrada aqui.

## 3. Riscos e possíveis regressões

| Risco | Mitigação |
|---|---|
| Mudar `callinvites.js` quebrar o convite manual | parâmetro opcional; `callinvite-test` roda de novo |
| Avisos demais (vira spam) | limites por pessoa/hora e por par, máximo de convidados, preferências, silêncio em Não perturbe/offline |
| Duas intenções para o mesmo jogo criando duas salas | deduplicação na criação + formação atômica (UPDATE condicional) |
| Vagas ultrapassadas com várias respostas ao mesmo tempo | contagem e escrita na mesma transação |
| Sala temporária sobrando | apagada quando fica vazia depois de formada (ou se ninguém entra em 15 min) |
| Vazar o que alguém joga | só usa sinais pelas regras de privacidade existentes (`canSee` da atividade, `games_share`) |
| Reinício do servidor | intenções no banco, varredura periódica; convites de chamada já tratam "expirado" |
| Painel "Ativo agora" ficar pesado | a seção some quando não há intenção |

## 4. Evidências

Capturas em `.testshots/intents/` (antes/depois) e saída dos testes no fim deste documento.
