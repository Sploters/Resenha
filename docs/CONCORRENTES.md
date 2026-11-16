# Concorrentes do Discord: o que copiar e o que evitar

Anotações dos concorrentes, para trazer o melhor de cada um para a Resenha. Cada entrada separa o que a Resenha **já tem**, o que **vale trazer** e o **erro a evitar**. A lista consolidada fica no fim.

---

## 1. Fluxer
Chat e voz no estilo Discord, open-source (AGPLv3), da Suécia, em beta público. ~100 mil usuários, nota 3,3.

**Pontos fortes**
- Interface familiar de canais, como no Discord.
- Open-source e auto-hospedável.
- Moderação granular, **CSS personalizado** e salvar mídia.
- **Entrar na voz de mais de um aparelho** ao mesmo tempo.
- Bots e API parecidos com os do Discord.
- Paridade com o Discord: texto, voz, vídeo, cargos, permissões, emojis, tela e DMs.
- Privacidade: GDPR, sem anúncios, sem treinar IA com o conteúdo, código auditável.

**Pontos fracos**
- Comunidade pequena e documentação fraca (ainda em beta).
- Sem app nativo de celular completo.
- Bloqueado num estado inteiro (Mississippi): depende de regras locais.
- E2EE ainda "em desenvolvimento".
- **IA analisa toda mídia enviada** atrás de NSFW, e o usuário só tem a "promessa" de que nada vai para terceiros.
- Risco de app indie: pode fechar ou mudar de rumo sem aviso.

**Comparando com a Resenha**
| Item | Fluxer | Resenha |
|---|---|---|
| Auto-hospedado | Sim | Sim (Umbrel/Docker) |
| Texto, voz, vídeo, tela, cargos, permissões, emojis, DMs | Sim | Sim |
| E2EE | Em desenvolvimento | **Já tem** nas DMs 1:1 (texto, arquivos e chamadas) |
| Salvar mídia | Sim | **Já tem**: Mídia favorita e aba Arquivos |
| Moderação granular | Sim | Parcial: cargos, permissões por canal, Reputação e auditoria; falta automod |
| CSS personalizado | Sim | Não (só 4 temas, cor, fonte e espaçamento) |
| Voz em vários aparelhos ao mesmo tempo | Sim | A conferir |
| Bots e API pública | Sim | Não (só o bot de música embutido) |
| App de celular | Incompleto | Navegador / app instalado (PWA) |
| Varredura de mídia por IA | Sim (polêmico) | Não |

**Vale trazer**
1. **API de bots com token**, compatível com o formato dos bots do Discord onde der. É a maior lacuna: o README lista "sem bots" nas limitações.
2. **CSS personalizado** (Aparência → CSS próprio), com temas da comunidade para importar e um "modo seguro" para desligar um CSS quebrado.
3. **Voz em vários aparelhos**: por exemplo, entrar pelo celular para falar e pelo PC para transmitir, sem derrubar a outra conexão.
4. **Moderação granular**: automod (palavras, links, spam, menções em massa), castigo com tempo e regras por canal.

**Erros a evitar**
- **Não fazer varredura de mídia por IA no servidor.** Se um dia existir filtro de NSFW, que seja opcional, por servidor e rodando local.
- Documentação: manter o README e os `docs/` em dia, que é onde o Fluxer peca.
- Não deixar o celular para depois.

---

## 2. TeamSpeak
VoIP proprietário, voz em primeiro lugar, referência para gamers há mais de 20 anos. Dos EUA, ~15 milhões de usuários, nota 3,3. O TeamSpeak 6 (beta desde 2025) trouxe UI moderna, compartilhamento de tela e mensagens globais.

**Pontos fortes**
- **Voz de baixíssima latência e muito limpa**: o padrão do jogo competitivo.
- Privacidade declarada: a empresa diz não ter acesso a voz nem texto.
- Tela e câmera no TS6.
- **Permissões por nível** ("Power" e "Needed Power"): cada ação exige um número, e cada cargo tem o seu. Granular ao extremo.
- **Whisper (sussurro)**: segurar uma tecla fala só com pessoas, cargos ou canais escolhidos, sem sair da sala.
- Multiplataforma, sem verificação de identidade.
- Plugins para bots e integrações.

**Pontos fracos**
- Texto fraco perto do Discord: sem emojis próprios, chat pobre.
- **Código fechado**: a promessa de privacidade não dá para auditar; E2EE "desconhecido".
- Sem canais de vídeo fixos (só tela).
- TS6 ainda em beta, instável.
- **TS3 gratuito limitado a 32 vagas.**
- Comunidade rachada entre TS3 e TS6 (migração lenta).
- Servidores oficiais lotam em horários de pico.
- O sistema de Power é poderoso, mas **confuso para quem não é admin**.

**Comparando com a Resenha**
| Item | TeamSpeak | Resenha |
|---|---|---|
| Qualidade e latência da voz | Referência | SFU (mediasoup), Opus 64 kbps, redução de ruído por IA, diagnóstico de conexão |
| Whisper / falar só com alguns | Sim | Não |
| Permissões | Power numérico, muito granular | Cargos + permitir/seguir/negar por categoria e canal (mais simples) |
| Texto rico, emojis próprios | Fraco / não | **Já tem** (bem à frente) |
| Canais de vídeo | Não | **Já tem** (câmera na sala de voz) |
| Código aberto, auditável | Não | Auto-hospedado, código próprio |
| Limite de vagas | 32 no TS3 grátis | Sem limite de licença (P2P ~6-8; SFU aguenta mais) |
| Plugins / bots | Sim | Não (só o de música) |

**Vale trazer**
1. **Whisper / sussurro**: tecla própria (como o push-to-talk, funcionando com o jogo em foco) que fala só com alvos salvos: pessoas, um cargo ("Time A") ou outra sala, sem sair da chamada. Indicador para quem recebe ("sussurrando para você"). Ótimo para shotcaller, torneio e dois times na mesma sala.
2. **Foco em latência como bandeira**: um modo "competitivo" na sala de voz (Opus em baixa latência, quadros menores, sem efeitos pesados, prioridade na rede) e um ping visível por pessoa.
3. **Permissões finas sem a confusão**: manter o modelo simples de hoje e oferecer um modo avançado opcional. Exemplo: "quem pode mover/mutar quem" depende da posição do cargo, como a hierarquia do Discord, que é o mesmo efeito do Power do TS sem números.
4. **Recursos de sala de voz do TS**: limite de pessoas por sala, sala com senha, **orador prioritário** (abaixa os outros quando ele fala) e "falar só com permissão" (fila para pedir a vez).

**Erros a evitar**
- Código fechado e privacidade "acredite em mim": a Resenha deve continuar auditável.
- Limite de vagas como modelo de negócio.
- Deixar o texto pobre: é justamente onde a Resenha ganha.
- Racha de versões: atualizações sem quebrar quem está na versão antiga (o app já se atualiza sozinho; manter assim).
- Permissões que só um especialista entende.

---

## 3. Matrix / Element
Protocolo aberto e **federado** (como e-mail: cada um tem seu servidor, e todos conversam entre si), com E2EE por padrão, voz, vídeo e tela. O Element é o cliente mais completo (Web/Desktop e o Element X no celular, reescrito em Rust). ~120 milhões de usuários, nota 3,2. Usado por governos, ONU e TPI.

**Pontos fortes**
- **E2EE por padrão** em tudo, inclusive grupos: nem o servidor lê.
- **Federação**: servidores diferentes conversam entre si, sem ponto central.
- Sem verificação de identidade; escolha um servidor público ou hospede o seu.
- Dados sob controle de quem hospeda.
- Confiança institucional (governos, ONU).
- Element X: app de celular muito mais rápido (Rust).
- **Spaces** (agrupam salas, como servidores) e **threads** (tópicos dentro de uma mensagem).
- Bots por uma interface padrão e aberta.

**Pontos fracos**
- **Interface de Slack/empresa**, estranha para quem vem do Discord.
- **Tela sem áudio**, limitação antiga e sem previsão.
- Federação traz complexidade, atraso e experiência desigual conforme o servidor.
- O servidor padrão (matrix.org) é da própria empresa: "descentralizado" na teoria.
- **Metadados expostos**: o servidor vê quem fala com quem e quando, mesmo com E2EE.
- Histórico de **ignorar falhas de segurança** relatadas.
- Sem cargos personalizados (só níveis de poder).
- Desempenho irregular em contas e servidores grandes; troca forçada do app antigo pelo Element X.

**Comparando com a Resenha**
| Item | Matrix/Element | Resenha |
|---|---|---|
| E2EE | Padrão, inclusive grupos | Só DMs 1:1, opcional; sem sigilo futuro |
| Metadados | Servidor vê | Servidor vê (o mesmo) |
| Federação | Sim | Não (cada instalação é isolada) |
| Interface | Estilo Slack | **Estilo Discord** (vantagem) |
| Tela com áudio | Não | **Já tem** (áudio do sistema) |
| Cargos personalizados | Não | **Já tem** |
| Threads | Sim | Não (fórum existe; threads não) |
| Spaces | Sim | Servidores (equivalente) |
| Bots com interface aberta | Sim | Não |
| App de celular nativo e rápido | Sim (Element X) | Navegador/PWA |

**Vale trazer**
1. **Threads**: responder abrindo um tópico ao lado do canal, com contador de respostas e "seguir tópico". Está nas limitações do README e todo concorrente tem.
2. **E2EE em grupos e por padrão**: estender a criptografia das DMs para DMs em grupo e, opcionalmente, canais marcados como "protegidos". Avaliar **sigilo futuro** (catraca de chaves, como o Megolm/Signal) e **verificação de aparelho por emoji/QR** (mais simples que o número de 60 dígitos).
3. **Ligar servidores de amigos (federação leve)**: não precisa do protocolo inteiro. Basta uma ponte entre duas instalações da Resenha (por exemplo, a sua e a de outro grupo), com DMs e um canal compartilhado entre elas. Ou, mais barato, **ponte com o Matrix** para quem já está lá.
4. **Backup de chaves**: o Element guarda as chaves cifradas no servidor com uma frase de recuperação. A Resenha já faz algo parecido; vale adicionar a **chave de recuperação** impressa/baixada como alternativa à frase.

**Erros a evitar**
- Interface corporativa: manter a cara de Discord, que é o que o público quer.
- Tela sem áudio: a Resenha já resolveu; não regredir.
- Ignorar falhas de segurança: ter um canal claro para relatar (`SECURITY.md`) e responder.
- Prometer privacidade total e esconder que **metadados** vazam: a Resenha já avisa isso no README; manter honesto.
- Forçar migração de app de uma vez.

---

<!-- Próximos concorrentes entram aqui, no mesmo formato. -->

## Lista consolidada (prioridades)
| # | Ideia | Origem | Status na Resenha |
|---|---|---|---|
| 1 | API de bots + tokens | Fluxer | Não tem |
| 2 | CSS personalizado / temas da comunidade | Fluxer | Não tem |
| 3 | Voz em vários aparelhos ao mesmo tempo | Fluxer | A conferir |
| 4 | Automod / moderação granular | Fluxer | Parcial |
| 5 | Whisper / sussurro para pessoas, cargos ou salas | TeamSpeak | Não tem |
| 6 | Modo de voz competitivo (baixa latência) + ping por pessoa | TeamSpeak | Parcial (diagnóstico de conexão) |
| 7 | Hierarquia de cargos para mover/mutar/expulsar | TeamSpeak | A conferir |
| 8 | Sala de voz: limite de pessoas, senha, orador prioritário, pedir a vez | TeamSpeak | Não tem |
| 9 | Threads (tópicos a partir de uma mensagem) | Matrix | Não tem |
| 10 | E2EE em DMs de grupo / canais protegidos, sigilo futuro, verificação por emoji/QR | Matrix | Parcial (só DM 1:1) |
| 11 | Ponte entre instalações da Resenha (ou com o Matrix) | Matrix | Não tem |
| 12 | Chave de recuperação da E2EE (além da frase) | Matrix | Parcial |
| 13 | `SECURITY.md` com canal para relatar falhas | Matrix (evitar o erro) | Não tem |
| ✗ | Varredura de mídia por IA no servidor | Fluxer (evitar) | Não fazer |
| ✗ | Código fechado / limite de vagas / permissões confusas | TeamSpeak (evitar) | Não fazer |
