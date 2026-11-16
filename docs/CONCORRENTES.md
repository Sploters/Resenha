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

## 4. Valour
Chat de comunidades open-source (AGPL-3.0, cliente e servidor), feito por voluntários, em Alpha (app.valour.gg). Dos EUA, ~21 mil usuários, nota 3,0. Diferenciais: **várias janelas de chat ao mesmo tempo** e **economia da comunidade**.

**Pontos fortes**
- Código aberto e auditável, sem dinheiro de empresa.
- Testar na hora no Alpha hospedado, sem instalar nada.
- Coleta mínima: sem anúncios, sem e-mail de marketing, **sem Google Analytics** ou rastreadores.
- **Multi-janela**: vários canais e comunidades abertos lado a lado, em janelas redimensionáveis.
- **Economia da comunidade**: moeda do servidor para recompensas, trocas e integrações.
- Desenvolvimento ativo e equipe que responde.
- **API oficial para bots.**
- Apps nativos para Windows e Android.
- Todos os recursos do Discord da lista (texto, voz, vídeo, cargos, permissões, emojis, tela, DMs).

**Pontos fracos**
- Alpha: bugs, mudanças que quebram, falta de acabamento.
- **Auto-hospedar é difícil**: Postgres, Redis e configuração manual.
- Depende de terceiros (SendGrid, Sentry, Stripe, Firebase, Tenor).
- Servidores nos EUA (jurisdição americana); IP registrado.
- Pede **data de nascimento** (para servidores NSFW).
- Sem E2EE.
- Android só por .apk, fora da Play Store.
- Equipe voluntária pequena: futuro incerto.

**Comparando com a Resenha**
| Item | Valour | Resenha |
|---|---|---|
| Auto-hospedar | Difícil (Postgres, Redis, config manual) | **Fácil**: Docker/Umbrel, banco migra sozinho |
| E2EE | Não | **Já tem** (DMs 1:1) |
| Terceiros | SendGrid, Sentry, Stripe, Firebase, Tenor | Poucos: KLIPY (GIFs), APIs públicas da Steam, YouTube no bot de música |
| Rastreadores / analytics | Nenhum | Nenhum (manter) |
| Multi-janela / canais lado a lado | Sim | Não |
| Economia / moeda do servidor | Sim | Não |
| API de bots | Sim | Não |
| App Windows | Sim | **Já tem** |
| App Android | .apk | Navegador/PWA |
| Testar sem instalar | Alpha hospedado | Navegador, mas precisa de uma instalação e da VPN |

**Vale trazer**
1. **Multi-janela / divisão de tela**: abrir um canal ou DM numa janela separada (app desktop) ou em painel lado a lado. A Resenha já tem o painel de busca que fica aberto ao trocar de canal; dá para generalizar: "Abrir ao lado" no clique direito de um canal, e "Abrir em janela" no app desktop (útil com dois monitores ou durante o jogo).
2. **Economia do servidor**, adaptada ao público gamer da Resenha: pontos por presença em call, eventos ("Vou" cumprido), vitórias no "O que jogar hoje?", apostas de brincadeira em enquetes, loja do servidor com cargos/cores/sons do soundboard. Tudo opcional e por servidor, sem dinheiro real.
3. **API de bots**: terceiro concorrente seguido que tem. Já é prioridade 1.
4. **Instância de demonstração**: um modo "experimentar" (servidor de teste, só leitura ou que se apaga sozinho) para mostrar a Resenha a alguém sem pedir para instalar VPN.

**Erros a evitar**
- Auto-hospedagem complicada: manter o Docker de um comando, que é vantagem.
- Encher de serviços de terceiros: cada um que entrar, documentar no README e permitir desligar.
- Pedir data de nascimento ou dados sem necessidade.
- Android por .apk solto: se houver app de celular, publicar na loja ou manter o PWA bem feito.
- Economia que vira cobrança ou pay-to-win.

---

## 5. Discourse
Fórum open-source com tópicos em tempo real e salas de chat. Dos EUA, usado por mais de 22 mil comunidades (algumas com milhões de pessoas); ~50 milhões de usuários, nota 3,1. Não é concorrente de voz: é a referência em **fórum**.

**Pontos fortes**
- **Tópicos ao vivo**: post novo e "digitando…" aparecem sem recarregar.
- Salas de chat em tempo real, parecidas com as do Discord.
- Auto-hospedável, com controle total dos dados.
- **Temas totalmente personalizáveis.**
- Funciona bem no celular e no computador.
- **Muitos plugins gratuitos** (e os pagos saem de graça se hospedar sozinho: SSO, votação etc.).
- Controle de acesso detalhado por cargo.
- **Moderação robusta**: níveis de confiança automáticos, fila de aprovação, sinalizações, silenciar, histórico de punições.
- IA opcional (plugin): **resumo de tópicos**, sugestão de resposta, busca por significado.

**Pontos fracos**
- **Qualquer moderador vê o IP** das pessoas.
- Chat escondido para visitantes: quem não está logado não descobre.
- Padrões que desencorajam posts rápidos e curtos (precisa ajustar).
- Sem voz, vídeo nem tela.
- Hospedagem oficial cara ($20 a $500/mês).
- Lento em navegadores antigos de celular.
- **Pede muita RAM no servidor.**
- Sem E2EE.

**Comparando com a Resenha**
| Item | Discourse | Resenha |
|---|---|---|
| Fórum | Completo | **Já tem** a etapa 1 (`docs/FORUM.md`): posts, votos, tags, ordem, fixar/trancar |
| Atualização ao vivo no fórum | Sim | Comentários sim (são um chat); lista de posts a conferir |
| Seguir tópico / não lidas de post | Sim | Não (pendente no `FORUM.md`) |
| "Resolvido" / melhor resposta | Sim (plugin) | Não (pendente) |
| Feed geral dos fóruns | Sim ("Últimos") | Não (pendente: seção Fóruns) |
| Voz, vídeo, tela | Não | **Já tem** |
| Níveis de confiança automáticos | Sim | Parcial (Reputação conta contas novas e falsos alarmes) |
| Temas personalizáveis | Total | 4 temas + ajustes |
| Plugins | Muitos | Não ("Recursos extras" embutidos) |
| Resumo por IA | Plugin | Não |
| IP visível para moderadores | Sim | Não mostra (manter assim) |
| RAM | Alta | A medir (alvo: rodar bem no Umbrel) |

**Vale trazer**
1. **Terminar o fórum** com o que o Discourse faz de melhor: seguir post e não lidas de post, **melhor resposta / "Resolvido"**, feed geral dos fóruns ("Últimos", "Em alta"), lista de posts que atualiza ao vivo ("3 posts novos — mostrar") e **transformar uma conversa do chat em post** (selecionar mensagens → "Criar post").
2. **Níveis de confiança automáticos**: quem é novo começa com limites (sem links, sem anexos grandes, sem convidar, ritmo menor) e sobe sozinho com tempo e participação. Encaixa com a Reputação, que já existe.
3. **Fila de aprovação** opcional por canal (posts de quem é novo esperam um moderador) e **sinalização com motivo** que vai para uma fila única de moderação.
4. **"O que eu perdi?"**: resumo das mensagens não lidas de um canal ou post. Se tiver IA, opcional, desligada por padrão, e de preferência com modelo local; sem IA, um resumo simples (mais reagidas, fixadas, links, quem falou mais).
5. **Temas personalizáveis**: reforça a ideia 2 (CSS personalizado), agora com temas para compartilhar entre servidores.

**Erros a evitar**
- **Mostrar IP para moderadores**: na Resenha, IP só para o administrador da instalação, se tanto.
- Peso de RAM: continuar medindo (`docs/AUDITORIA-DESEMPENHO.md`) para rodar em máquina modesta.
- Padrões que travam conversa rápida: limites só para quem é novo, nunca para todos.
- Esconder recursos de quem chega: a primeira tela deve mostrar o que existe.

---

## 6. Stoat (ex-Revolt)
Clone open-source do Discord (o antigo Revolt, renomeado no fim de 2025), escrito em Rust para ser rápido e leve. Do Reino Unido, ~1 milhão de usuários, nota 2,3. Cresceu muito em 2026 com quem saiu do Discord pelas mudanças de política.

**Pontos fortes**
- Privacidade: sem anúncios nem rastreadores, GDPR, base na Europa.
- Sem verificação de identidade.
- Auto-hospedável.
- **Termos de uso abertos e transparentes**, junto com o código.
- Coleta mínima de dados.
- Canais, permissões, **bots** e voz já funcionando.
- Leve e rápido (Rust).
- Estrutura de servidor igual à do Discord, fácil para quem migra.

**Pontos fracos**
- **Vídeo e tela ainda não lançados** (precisam de muito servidor).
- **Apps de celular presos ao servidor oficial**: para usar o seu, tem que recompilar o app.
- Federação limitada: instâncias próprias não falam com a oficial.
- Instância principal sofre com picos de acesso.
- Bloqueado por uma operadora (Verizon).
- Sem E2EE.
- Nota baixa (2,3): a experiência ainda decepciona quem vem do Discord.

**Comparando com a Resenha**
| Item | Stoat | Resenha |
|---|---|---|
| Vídeo e tela | Em desenvolvimento | **Já tem** (SFU, 120 FPS nativo, controle remoto) |
| E2EE | Não | **Já tem** (DMs 1:1) |
| App aponta para o seu servidor | Não (precisa recompilar) | **Já tem**: o app desktop pergunta o endereço (`desktop/connect.html`) |
| Picos de acesso | Instância central sofre | Cada grupo tem a sua; não há instância central |
| Bloqueio por operadora | Sim (Verizon) | Passa pela VPN (Tailscale/Hamachi/Radmin) |
| Bots | Sim | Não |
| Termos de uso / política de privacidade públicos | Sim | Não (o README explica o que é guardado, mas não há um documento) |
| Leveza | Rust | Node + nativos em Rust (`lc-input`, `lc-audio`); modo leve automático |

**Vale trazer**
1. **Bots**: quinto concorrente em seis com API de bots. Confirma a prioridade 1.
2. **Termos e política de privacidade abertos**: um `PRIVACIDADE.md` curto e honesto (o que o servidor guarda, quem vê, por quanto tempo, o que vai para terceiros como KLIPY e Steam), com link nas Configurações. O dono de cada instalação pode ajustar.
3. **Facilitar a migração do Discord**: o Stoat cresceu porque pegou quem fugiu do Discord. A Resenha já importa conversas; dá para ir além: **importar a estrutura de um servidor** (canais, categorias, cargos, permissões e emojis, a partir de um modelo de servidor do Discord ou de um export) e uma página "Vindo do Discord?" mostrando onde fica cada coisa.

**Erros a evitar**
- Lançar sem vídeo e tela: a Resenha já tem; manter a qualidade como diferencial.
- App de celular preso a um servidor: se vier app nativo, ele precisa pedir o endereço, como o desktop já faz.
- Uma instância central que cai nos picos: o modelo "cada grupo tem a sua" é vantagem.
- Experiência abaixo do Discord para quem migra: a nota 2,3 do Stoat mostra que só ter os recursos não basta; acabamento importa.

---

## 7. Root
Plataforma de comunidades com chat **e ferramentas de coordenação** (tarefas, planejamento de raids). Visual muito parecido com o Discord e importa servidores do Discord. Dos EUA, código fechado e centralizado, ~50 mil usuários, nota 1,5. **É de onde vem a ideia de Raids.**

**Pontos fortes**
- Paridade com o Discord: texto, voz, vídeo, tela, cargos, permissões, emojis e DMs.
- **Planejamento de raids** e **tarefas** dentro da comunidade.
- **Figurinhas** (stickers).
- Apps personalizados dentro do servidor.
- **Importa servidores do Discord** para facilitar a migração.
- **Termos de uso próprios por comunidade.**
- Sem verificação de identidade.

**Pontos fracos**
- **Os primeiros termos de uso permitiam vender os dados e treinar IA com eles**; só mudou depois da revolta do público.
- Centralizado, sem auto-hospedar: pode mudar a política de novo sem avisar.
- Código fechado: nada verificável.
- Sem E2EE.
- Novo, com bugs; comunidade pequena.
- Nota 1,5: a pior da lista, puxada pela desconfiança.

**Comparando com a Resenha**
| Item | Root | Resenha |
|---|---|---|
| Voz, vídeo, tela | Sim | **Já tem** |
| Planejamento de raids | Sim | Não (eventos com vagas, sem funções nem times) |
| Tarefas | Sim | Parcial: canal Documento com `- [ ]` marcável |
| Figurinhas | Sim | Não (emojis e soundboard, sem figurinhas) |
| Importar servidor do Discord | Sim | Parcial (importa conversas, não a estrutura) |
| Termos por comunidade | Sim | Não |
| Apps personalizados | Sim | Não (fora do plano, como os bots) |
| Auto-hospedar, código próprio | Não | **Já tem** |
| E2EE | Não | **Já tem** (DMs 1:1) |
| Dados vendidos / IA | Já previu nos termos | Nada sai do servidor do grupo |

**Vale trazer**
1. **Raids e montar times** (já detalhado em "Decisões"): composição por função, vários times, lista de espera, modelos por jogo, raid semanal.
2. **Tarefas ligadas ao evento ou ao grupo**: checklist com responsável e prazo ("quem leva o farm de consumíveis", "quem cria a sala", "comprar o DLC até sexta"), que avisa quem foi marcado. Pode nascer do canal Documento, que já tem caixinhas: falta só o responsável, o prazo e o aviso.
3. **Figurinhas do servidor**: imagens ou GIFs maiores que um emoji, enviadas sozinhas, com seletor próprio ao lado dos emojis. Encaixa na Mídia favorita, que já organiza GIFs e imagens.
4. **Importar o servidor do Discord inteiro**: reforça a #22.
5. **Regras do servidor que a pessoa aceita ao entrar**: o servidor tem um texto de regras (pode ser um canal Documento) e quem entra precisa aceitar antes de escrever. É a versão útil dos "termos por comunidade".

**Erros a evitar**
- **Termos que permitem vender dados ou treinar IA**: a Resenha não faz isso, e o `PRIVACIDADE.md` deve dizer explicitamente.
- Mudar a política em silêncio: qualquer mudança no `PRIVACIDADE.md` aparece em "Novidades".
- Código fechado e centralizado.

---

## Lista consolidada (prioridades)
| # | Ideia | Origem | Status na Resenha |
|---|---|---|---|
| 1 | API de bots + tokens | Fluxer, TeamSpeak, Matrix, Valour, Stoat | Não tem |
| 2 | CSS personalizado / temas da comunidade | Fluxer, Discourse | Não tem |
| 3 | Voz em vários aparelhos ao mesmo tempo | Fluxer | Não tem (uma conexão de voz por conta, `dropStaleVoice`) |
| 4 | Automod / moderação granular | Fluxer, Discourse | Parcial |
| 5 | Whisper / sussurro para pessoas, cargos ou salas | TeamSpeak | Não tem |
| 6 | Modo de voz competitivo (baixa latência) + ping por pessoa | TeamSpeak | Parcial (diagnóstico de conexão) |
| 7 | Hierarquia de cargos para mover/mutar/expulsar | TeamSpeak | Não encontrada no servidor |
| 8 | Sala de voz: limite de pessoas, senha, orador prioritário, pedir a vez | TeamSpeak | Não tem |
| 9 | Threads (tópicos a partir de uma mensagem) | Matrix | Não tem |
| 10 | E2EE em DMs de grupo / canais protegidos, sigilo futuro, verificação por emoji/QR | Matrix | Parcial (só DM 1:1) |
| 11 | Ponte entre instalações da Resenha (ou com o Matrix) | Matrix | Não tem |
| 12 | Chave de recuperação da E2EE (além da frase) | Matrix | Parcial |
| 13 | `SECURITY.md` com canal para relatar falhas | Matrix (evitar o erro) | Não tem |
| 14 | Multi-janela: canal/DM ao lado ou em janela separada | Valour | Não tem |
| 15 | Economia do servidor (pontos, loja de cargos/cores/sons) | Valour | Não tem |
| 16 | Modo de demonstração para testar sem instalar | Valour | Não tem |
| 17 | Fórum completo: seguir post, melhor resposta, feed geral, lista ao vivo, chat → post | Discourse | Parcial (etapa 1) |
| 18 | Níveis de confiança automáticos para contas novas | Discourse | Parcial (Reputação) |
| 19 | Fila de aprovação e sinalização com motivo | Discourse | Parcial |
| 20 | "O que eu perdi?" (resumo das não lidas, IA opcional e local) | Discourse | Não tem |
| 21 | `PRIVACIDADE.md` / termos abertos, com link nas Configurações | Stoat | Não tem |
| 22 | Importar a estrutura de um servidor do Discord + guia "Vindo do Discord?" | Stoat, Root | Parcial (importa conversas) |
| 23 | Raids e montar times nos Eventos (funções, vários times, lista de espera, modelos, semanal) | Root | Não tem |
| 24 | Tarefas com responsável, prazo e aviso (a partir do canal Documento) | Root | Parcial (caixinhas no Documento) |
| 25 | Figurinhas do servidor | Root | Não tem |
| 26 | Regras do servidor aceitas ao entrar | Root | Não tem |
| ✗ | Varredura de mídia por IA no servidor | Fluxer (evitar) | Não fazer |
| ✗ | Código fechado / limite de vagas / permissões confusas | TeamSpeak (evitar) | Não fazer |
| ✗ | IP visível para moderadores | Discourse (evitar) | Não fazer |
| ✗ | App preso a um servidor / instância central única | Stoat (evitar) | Não fazer |
| ✗ | Termos que permitem vender dados ou treinar IA; mudar a política em silêncio | Root (evitar) | Não fazer |

## Onde a Resenha já ganha de todos
- **Voz, vídeo e tela completos**: o Stoat ainda não lançou, o Discourse não tem, o Element não manda áudio da tela, o TeamSpeak não tem canais de vídeo. A Resenha tem SFU, 120 FPS nativo, áudio só do jogo, clipes e controle remoto.
- **E2EE nas DMs**: só o Matrix tem algo melhor; Fluxer (em desenvolvimento), Valour, Stoat, Discourse e TeamSpeak (desconhecido) não.
- **Auto-hospedar fácil** (Docker/Umbrel) e app que aponta para qualquer servidor.
- **Recursos para gamers** que nenhum deles tem: Steam (cartões, biblioteca, wishlist, promoções), "O que jogar hoje?", LFG, eventos, "Jogando…", modo leve automático, push-to-talk com o jogo em foco.
- **Cara de Discord** com texto rico (o Element parece Slack; o TeamSpeak tem texto pobre).

## Decisões (16/11/2026)

**Fora do plano**
- **API de bots** (#1): não vai ser feita.
- **Threads e terminar o fórum** (#9, #17): o grupo não usa nem threads nem fórum. Do fórum, só vale aproveitar ideias para outros lugares (ver Raids abaixo).
- **Voz em vários aparelhos ao mesmo tempo** (#3): não.

**Ver melhor depois**
- **Personalização** (#2 CSS e temas, #14 multi-janela).

**Aprovadas**
1. **Hierarquia de cargos** (#7). **Importante.** Ver o diagnóstico abaixo.
2. **Moderação**: automod, níveis de confiança para contas novas, fila de aprovação e denúncia com motivo (#4, #18, #19).
3. **Voz para gamers**: sussurro, modo competitivo com ping por pessoa, sala com limite, senha, orador prioritário e pedir a vez (#5, #6, #8).
4. **Migração do Discord**: importar a estrutura do servidor e o guia "Vindo do Discord?" (#22).
5. **E2EE mais ampla**: DMs em grupo, canais protegidos, sigilo futuro, verificação por emoji/QR e chave de recuperação (#10, #12).
6. **Confiança**: `SECURITY.md` e `PRIVACIDADE.md` (#13, #21).
7. **Do Root**: Raids e times (#23), tarefas com responsável e prazo (#24), figurinhas (#25), regras aceitas ao entrar (#26). A decidir.
8. **Extras**: economia do servidor (#15), "O que eu perdi?" (#20), ponte entre instalações (#11), modo demonstração (#16).

**Ideia nova: Eventos → Raids e montar times** (#23, vinda do Root)
Hoje o evento tem vagas e Vou / Talvez / Não vou (`server/events.js`), e o LFG já conhece funções por jogo (`server/lfg.js`: Duelista/Controlador…, Topo/Selva/Meio…). A ideia é juntar os dois:
- **Composição por função**: o evento define quantas vagas de cada função (WoW: 2 tanques, 5 healers, 13 DPS; Dota/LoL/Deadlock: uma de cada posição; Valorant: duelista, controlador…). Cada um se inscreve escolhendo a função (e uma reserva), e o cartão mostra o quadro: "Tanque 2/2 · Healer 3/5 · DPS 9/13".
- **Vários times no mesmo evento**: Clash do LoL ou um 5v5 interno com Time A e Time B; arrastar pessoas entre times; botão "balancear" pelo elo do perfil de jogador do LFG.
- **Lista de espera por função** e promoção automática quando alguém sai.
- **Modelos por jogo**: WoW (raid de 10/20/25, masmorra de 5), Dota 2, Deadlock, LoL Clash, Valorant, Grand Line Adventures e "Personalizado". Os jogos e funções novos entram na mesma lista do LFG.
- **Repetir toda semana** (raid fixa), com a escalação da semana anterior como ponto de partida.
- **"Chamar quem falta"**: avisa quem joga aquele jogo (biblioteca da Steam, perfil do LFG ou "Jogando…") quando faltar uma função perto da hora.
- Na hora do evento, **Entrar na sala** já leva cada time para a sua sala de voz.

### Diagnóstico: hierarquia de cargos (`server/index.js`)
Os cargos têm `position`, mas ela **não é usada em nenhuma checagem**. Só o dono é protegido. Consequências:
- Quem tem **Expulsar** (`P.KICK`) expulsa qualquer um, inclusive administradores (`DELETE /api/guilds/:id/members/:uid`).
- Quem tem **Banir** bane qualquer um menos o dono, inclusive administradores.
- Quem tem **Moderar** põe qualquer um de castigo, inclusive administradores.
- Quem tem **Gerenciar cargos** pode **dar a si mesmo um cargo de Administrador**, editar as permissões de cargos acima dele e apagá-los (`PATCH /api/guilds/:id/members/:uid` com `roles`, `PATCH`/`DELETE /api/roles/:id`). É escalada de privilégio: "Gerenciar cargos" hoje equivale a Administrador.
- Mudar apelido de outra pessoa também não olha o cargo.
- Não existe **moderação de voz**: mutar ou ensurdecer alguém para a sala, mover para outra sala ou desconectar da chamada.

Regra proposta (como no Discord):
- O "cargo mais alto" de alguém é o maior `position` entre os cargos dele. O dono está acima de todos.
- Expulsar, banir, castigar, mudar apelido, mover, mutar e desconectar: só em quem tem o cargo mais alto **abaixo** do seu.
- Gerenciar cargos: só criar, editar, apagar, dar ou tirar cargos **abaixo** do seu; e nunca dar uma permissão que você mesmo não tem.
- Reordenar cargos (arrastar na lista), também só abaixo do seu.
- O app esconde ou desativa a opção quando não pode (com o motivo: "cargo acima do seu"), e o servidor recusa sempre.
