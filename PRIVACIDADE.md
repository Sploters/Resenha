# Privacidade na Resenha

A Resenha roda no servidor de quem montou o grupo (um PC, um Umbrel, uma VPS). Não existe uma empresa nem um servidor central no meio: **os dados ficam na máquina de quem hospeda**, e quem hospeda é responsável por eles. Este texto explica o que esse servidor guarda, quem vê e o que sai dele. O dono de cada instalação pode editar este arquivo para refletir as regras do grupo.

**O que nunca acontece:** a Resenha não vende dados, não mostra anúncios, não tem rastreadores de terceiros (Google Analytics e afins) e **não usa suas mensagens, arquivos ou voz para treinar IA**. Nada aqui é analisado por IA no servidor. A redução de ruído por IA da voz roda no seu aparelho.

## O que o servidor guarda
| O quê | Detalhe | Quem vê |
|---|---|---|
| Conta | Nome de usuário, nome de exibição, avatar, bio, status. Senha só como hash (scrypt + sal). | Quem divide servidor ou é amigo (perfil); a senha, ninguém |
| Sessões | Hash do token de login, aparelho (user-agent) e quando foi usada. | Você, em Privacidade e segurança → Sessões |
| Mensagens e arquivos | Texto, anexos, reações, enquetes, eventos, posts, clipes. | Quem tem acesso ao canal ou à DM |
| DMs protegidas (E2EE) | Só o texto e os arquivos **cifrados**; a chave privada fica trancada com a sua frase. | Só os dois da conversa |
| Servidores | Membros, cargos, canais, convites, banimentos, registro de auditoria. | Membros (auditoria: quem gerencia o servidor) |
| Contas vinculadas | Steam: ID, nome, biblioteca (jogos e horas) e wishlist. | Amigos e quem divide servidor (padrão), só amigos ou ninguém — você escolhe |
| "Jogando…" e histórico | Jogo aberto detectado pelo app desktop e o histórico da semana. As horas só contam enquanto você está numa call. No modo invisível ou com "Ninguém" em Contas vinculadas, só você vê o jogo ao vivo, mas as horas em call continuam somando, **sem o seu nome**, em "A semana da galera" dos seus amigos. Para um jogo não contar, esconda o jogo. | Ao vivo: conforme a sua configuração de presença. Na semana: só o total, sem identificar quem está em "Ninguém"/invisível |
| Sessões de voz (memória do grupo) | Nas salas de voz de **servidor**, cada encontro com 2 ou mais pessoas: sala (e o nome dela na época), começo, fim, pico de pessoas, quem participou e por quanto tempo cada um ficou, e um resumo sem nomes (jogos jogados durante a sessão, quantos clipes, vídeos do Assistir junto, evento ou "A fim de jogar" ligados à sala). **Não guarda** o que foi dito, quem falou mais nem o conteúdo da tela. Encontros de menos de 3 minutos são descartados. Fica guardado para sempre (inclusive se a sala for apagada), até alguém apagar. **Chamadas nas DMs nunca entram.** Também guarda quando você viu o "Desde a última vez" pela última vez. | Membros do servidor que podem ver a sala. Quem escondeu a presença de quem lê, ou está invisível, aparece só como "+1 pessoa", sem nome. Jogos sem nome nem partidas privadas/escondidas |
| A Noite: GG e pérolas | **GG** que cada pessoa deu numa noite (quem e quando). **Pérolas**: qual mensagem de canal de servidor foi guardada, por quem e quando (o texto continua sendo o da mensagem; apagar a mensagem apaga a pérola). A página da noite junta, na hora de abrir, o que já é guardado: participantes, jogos, clipes da sala, pérolas e conquistas destravadas durante a noite. | Membros do servidor que podem ver a sala ou o canal, com as mesmas regras de nome das sessões de voz |
| Resumo diário de jogos | Por pessoa, jogo e dia: segundos em call e quantas partidas, para sempre (o histórico detalhado some em 30 dias). Partidas no modo invisível ou em "Ninguém" e jogos escondidos não entram. | Ainda não aparece para ninguém; quando aparecer, segue as mesmas regras do "Jogando…" |
| Estatísticas de uso | Contagens por dia, **sem identificar ninguém**, apagadas em 60 dias. Inclui o formato (codec) dos vídeos enviados e se os vídeos do chat tocaram no seu aparelho, nunca o conteúdo. Desliga em Privacidade e segurança. | Só o administrador da instalação |
| Qualidade das chamadas | Faixas (ex.: "atraso 100–200 ms") e a nota, sem conteúdo. | Só o administrador da instalação |

**Endereço IP:** o servidor usa o IP só na memória, para limitar tentativas de login e de criação de contas; ele **não fica gravado** no banco e **não aparece para moderadores**.

**Metadados:** mesmo nas DMs protegidas, o servidor sabe quem fala com quem, quando e o tamanho dos arquivos. Isso vale para qualquer serviço de chat, inclusive os com E2EE.

## O que sai do servidor (terceiros)
Cada item só acontece quando o recurso é usado, e a maioria pode ser desligada por quem hospeda.

| Serviço | Quando | O que vai | Como desligar |
|---|---|---|---|
| KLIPY ou GIPHY | Busca de GIFs | O termo buscado (pelo servidor) | Sem a chave (`KLIPY_API_KEY`/`GIPHY_API_KEY`), a busca some |
| Google Tradutor (ou LibreTranslate) | Clique em Traduzir | O texto a traduzir | `TRANSLATE=0`, ou `LIBRETRANSLATE_URL` para uma instância própria |
| Steam (loja e API) | Cartões de link, biblioteca, wishlist, promoções | IDs de jogos e o seu Steam ID vinculado | Não vincular a Steam; desligar prévias de links |
| YouTube (yt-dlp) | Bot de música | O que foi pedido para tocar | Não usar o bot |
| YouTube, TikTok, Instagram, Spotify | Cartões de vídeo e música no chat | O seu aparelho carrega o player do site **só ao apertar play** | Desligar "Mostrar prévias de links" |
| Sites de jogos e notícias | Descobrir, capas de eventos | Nada sobre você: o servidor busca páginas públicas | Não usar essas seções |
| GitHub | Atualização do app desktop | Pedido da versão mais nova | — |
| ntfy (ou outro webhook) | Alertas para o administrador | Avisos de saúde do servidor | Não definir `ALERT_WEBHOOK` |

## Seus controles
- **Apagar minhas mensagens** em massa (Privacidade e segurança → Suas mensagens), com cópia em JSON antes.
- **Excluir a conta** (Conta).
- **Criptografia de ponta a ponta** nas DMs.
- **Modo invisível**, presença e atividade escondidas, quem pode ligar para você.
- **Ver o que é enviado** nas estatísticas de uso, e desligá-las.
- Desvincular a Steam apaga o que veio dela.
- **Guardar minhas sessões no histórico do grupo** (Privacidade e segurança, ligado por padrão): desligado, você não entra como participante das sessões de voz guardadas dali em diante (conta só no número de pessoas, sem nome). Não apaga o passado sozinho.
- **Tirar a sua participação** de uma sessão guardada (Configurações → Privacidade, ou na página da noite) (você some dela para todos); quem tem "Gerenciar servidor" pode apagar uma sessão inteira. Excluir a conta apaga as suas participações.

## Mudanças
Qualquer mudança neste texto aparece em "Novidades" na próxima atualização. Nada muda em silêncio.
