// Novidades: o que mudou em cada atualização, mostrado uma vez para cada pessoa (fica gravado na conta, vale em todos os
// aparelhos) e guardado em Configurações -> Novidades. Para uma atualização nova: acrescente uma entrada NO TOPO de NEWS
// com um id novo (data). "try" liga o botão "Experimentar" a uma ação registrada pelo app (setNewsActions).
import { h, icon } from './util.js';
import { S, modal, savePrefs } from './state.js';

export const NEWS = [
  {
    id: '2026-11-19-3', title: 'Mover arrastando e atalhos do Soundboard do seu jeito',
    items: [
      { i: 'voice', t: 'Mover alguém de sala arrastando', d: 'Quem pode Moderar voz (e o dono do servidor) agora arrasta a pessoa da lista da sala e solta em outra sala de voz. Quem foi movido ouve um toque e vê quem o moveu; se estava mutado, aparece o botão "Desmutar" ali mesmo. Bom para chamar quem esqueceu o microfone desligado.' },
      { i: 'soundboard', t: 'Escolha os sons dos atalhos', d: 'Em Configurações → Atalhos você escolhe o som de cada Alt + teclado numérico 1 a 9 (ou deixa no automático) e cria atalhos com qualquer outra tecla, como F6 ou Ctrl + Q.' },
    ],
  },
  {
    id: '2026-11-19-2', title: 'Transmissão com áudio e vídeo juntos e atalhos no Soundboard',
    items: [
      { i: 'screen', t: 'Áudio e vídeo da transmissão sincronizados', d: 'O áudio do jogo podia chegar atrasado ou adiantado em relação ao vídeo, cada espectador de um jeito. Agora quem assiste alinha o vídeo da tela com o áudio dela, e o áudio do jogo sai com atraso pequeno e constante.' },
      { i: 'soundboard', t: 'Atalhos do Soundboard', d: 'Alt + teclado numérico 1 a 9 tocam os 9 primeiros sons (favoritos primeiro). No app para computador funcionam também com o jogo em foco, enquanto você está numa chamada. Dá para desligar em Configurações → Atalhos.', try: 'keys' },
      { i: 'tv', t: 'Watch Together com mais espaço', d: 'Expandido, a barra da chamada sai e o vídeo ocupa o palco todo. Os botões continuam no painel de voz à esquerda.' },
      { i: 'skip', t: 'Pular mais fácil', d: 'O botão "Próximo" mostra o título do que vem depois, e Shift + N pula. Quem não controla vê como pedir o controle.' },
      { i: 'vol', t: 'Volume pela rodinha do mouse', d: 'Com o mouse em cima do vídeo do Watch Together, role para aumentar ou diminuir o volume (só para você). As setas ↑ ↓ também funcionam.' },
    ],
  },
  {
    id: '2026-11-19-1', title: 'Watch Together em Full HD e sem legenda sozinha',
    items: [
      { i: 'tv', t: 'Vídeos em Full HD', d: 'O Watch Together pede 1080p para os vídeos do YouTube (ou a maior qualidade que o vídeo tiver, se não chegar a isso).' },
      { i: 'bolt', t: 'Sem travar quando a internet aperta', d: 'Se o vídeo trava para você, só a sua resolução baixa um pouco, e volta a subir quando a conexão firma. Assim ninguém fica para trás nem precisa pular. Em Pessoas aparece a qualidade de cada um.' },
      { i: 'chat', t: 'Legendas ficam desligadas', d: 'Começam sempre desligadas e não voltam mais sozinhas ao dar play ou ao minimizar e voltar. Ligue no botão CC (ou tecla C).' },
      { i: 'voice', t: 'Quem está assistindo, na lista da sala', d: 'Um ícone de TV aparece ao lado do nome de quem está no Watch Together, na lista da sala de voz.' },
    ],
  },
  {
    id: '2026-11-18-5', title: 'Voz sem cortes e Watch Together junto com as transmissões',
    items: [
      { i: 'screen', t: 'Assistir uma transmissão com o Watch Together aberto', d: 'Quando alguém da sala transmite, aparece "AO VIVO" no topo do Watch Together. Um clique abre a transmissão e o vídeo continua tocando no mini player. Abrir uma transmissão por qualquer outro lugar também minimiza o player.' },
      { i: 'tv', t: 'Barra da chamada no lugar', d: 'Os botões da chamada não aparecem mais por cima do player: a barra fica parada embaixo dele, e o mini player nasce acima dela.' },
      { i: 'mic', t: 'Sua voz não baixa mais sozinha', d: '"Só a minha voz" aprendia o seu volume pelos trechos mais altos da conversa. Quem fala perto do microfone e depois baixava um pouco a voz era tratado como "voz de fundo": a voz ia sumindo e ficava cortada, robótica. Agora ele vem desligado (ligue em Voz e vídeo se tiver gente falando perto de você) e, ligado, acompanha você quando fala mais baixo.' },
      { i: 'mic', t: 'Cancelamento de eco sem cortar a sua voz', d: 'O filtro usava como referência todo som do app, inclusive o vídeo do Watch Together, e cortava a sua voz enquanto ele tocava. Agora tira só a voz e as transmissões da chamada. O modo antigo fica em Voz e vídeo → "Cancelar também o som do app".' },
    ],
  },
  {
    id: '2026-11-18-4', title: 'Watch Together mais caprichado e câmera espelhada',
    items: [
      { i: 'video', t: 'Inverter a imagem da câmera', d: 'Clique direito no botão da câmera → Inverter a imagem (ou em Configurações → Voz e vídeo). A imagem fica espelhada para todos na chamada, e a sua prévia mostra o mesmo que os outros veem.', try: 'voice' },
      { i: 'tv', t: 'Watch Together com o visual do app', d: 'Cores e superfícies iguais às do resto do Resenha. O volume virou só o alto-falante, e o controle abre ao passar o mouse, separado da barra do vídeo.' },
      { i: 'users', t: 'Quem controla, à vista', d: 'O anfitrião escolhe "Só eu" ou "Todos" no topo, e em Pessoas tem uma chave para liberar o controle para cada um. Quem não controla tem o botão "Pedir controle", e o pedido aparece para o anfitrião com "Liberar".' },
      { i: 'bolt', t: 'Vídeo sem piscar no app', d: 'O vídeo do YouTube no Watch Together piscava no app para computador, como acontecia com transmissões e clipes. Agora recebe as mesmas correções.' },
      { i: 'refresh', t: 'Sincronia bem mais precisa', d: 'Todo mundo fica a menos de 0,15 s um do outro. Diferenças pequenas são corrigidas acelerando ou freando o vídeo um pouquinho, sem pulos, e o play e a pausa acontecem no mesmo instante para todos.' },
      { i: 'vol', t: 'Começa com som', d: 'O vídeo do YouTube às vezes começava mudo e só voltava mexendo no volume. Agora toca com som desde o começo, e o volume dá para arrastar sem fechar.' },
      { i: 'chat', t: 'Legendas do YouTube', d: 'As legendas vêm desligadas, e o botão CC (ou a tecla C) liga e desliga só para você.' },
      { i: 'expand', t: 'Tela cheia de verdade', d: 'O vídeo ocupa o monitor inteiro, e os controles aparecem por cima quando você mexe o mouse.' },
      { i: 'check', t: 'Fila vazia sem vídeo por trás', d: 'Remover o vídeo que estava tocando com a fila vazia deixava o vídeo de fundo atrás do "A fila acabou", e dava para pausar e continuar. Agora o player sai da tela.' },
    ],
  },
  {
    id: '2026-11-18-3', title: 'Conquistas, jogos do servidor e sala de voz em espera',
    items: [
      { i: 'medal', t: 'Aba Conquistas', d: 'Em Jogos → Conquistas: seus jogos 100% da Steam, as conquistas mais raras e as recentes, e o progresso de cada jogo. PlayStation, Xbox e Epic não deixam outros apps lerem os troféus, então dá para registrar suas platinas de lá (aparecem como "informado"). Suas conquistas também ficam numa aba do seu perfil.' },
      { i: 'gamepad', t: 'Jogos que a galera mais joga', d: 'O topo da lista de canais e o cartão de convite mostram os jogos que mais gente do servidor jogou nos últimos 30 dias, com uma chama quando o jogo está bombando na semana.' },
      { i: 'pause', t: 'Em espera na chamada', d: 'Precisa sair um pouco? O botão de pausa no painel de voz desliga seu microfone e seu áudio sem sair da sala, e os outros veem "Em espera". Voltar deixa tudo como estava.' },
      { i: 'users', t: 'Sala de voz separada por jogos', d: 'Clique direito numa sala de voz → Separar por jogos: quem está jogando a mesma coisa fica junto, e quem está em espera vai para o fim.' },
      { i: 'clock', t: 'Registro de auditoria por 45 dias', d: 'O registro de auditoria do servidor guarda cada ação por 45 dias, como no Discord.' },
    ],
  },
  {
    id: '2026-11-18-2', title: 'Mais leve com a janela de lado e em servidores grandes',
    items: [
      { i: 'pause', t: 'GIFs e vídeos param fora de foco', d: 'Com a janela minimizada ou atrás de outra (jogando, por exemplo), os GIFs do chat, os avatares animados e os vídeos tocando sem som param, e voltam de onde estavam quando você volta. Vídeo com som continua. Dá para desligar em Configurações → Aparência.' },
      { i: 'users', t: 'Lista de membros sem travar', d: 'Em servidores com milhares de pessoas, a lista mostra todo mundo de uma vez (sem "Mostrar mais"), mas só monta as linhas que estão na tela: rolar até o fim continua leve.' },
      { i: 'image', t: 'Fotos em formatos novos', d: 'Fotos .jxl (JPEG XL) e .heic que o seu aparelho consegue abrir são convertidas antes de enviar, para todos conseguirem ver. Fotos .avif ganham versões menores no chat, como as outras.' },
    ],
  },
  {
    id: '2026-11-18-1', title: 'Transmissão de jogos no Windows 10: sem borda amarela, sem atraso no mouse',
    items: [
      { i: 'screen', t: 'Jogo em tela cheia sem a janela de baixo', d: 'No Windows 10 a transmissão de jogo (ex.: Valorant) às vezes trocava sozinha para a captura de janela do Windows depois de alguns segundos: aparecia a borda amarela e quem assistia via a janela que estava atrás do jogo. Agora, no Windows 10, a janela do jogo vai só pela captura da tela (DXGI) e, se ela falhar, a transmissão continua pela tela do monitor do jogo.' },
      { i: 'gamepad', t: 'Mouse sem atraso enquanto transmite', d: 'A transmissão pedia prioridade máxima na placa de vídeo e passava na frente do jogo a cada quadro, e quem jogava sentia o mouse atrasado. Agora o jogo vem primeiro.' },
    ],
  },
  {
    id: '2026-11-17-7', title: 'Microfone: só a sua voz, sem ganho automático; tela sem vazar o outro monitor',
    items: [
      { i: 'mic', t: 'Só a minha voz', d: 'Com a redução Forte ou Máxima, a proteção por voz aprende nos primeiros segundos o volume e o tom da SUA voz e abafa as outras: alguém conversando ao fundo (principalmente voz feminina quando você é homem, e vice-versa), latido e moto. Gritar ou rir alto continua passando. Desliga em Voz e vídeo → "Só a minha voz".', try: 'voice' },
      { i: 'mic', t: 'Ganho automático desligado', d: 'Ele aumentava o microfone nas suas pausas, e o ruído e as vozes ao fundo subiam junto. Agora vem desligado (e foi desligado uma vez para todos). Dá para ligar de novo em Voz e vídeo.', try: 'voice' },
      { i: 'screen', t: 'Tela inteira sem o som do outro monitor', d: 'Com "Só desta tela", um programa aberto nas duas telas (o mesmo navegador com vídeo no outro monitor), com janela minimizada lá, ou que abriu algo que está lá, fica de fora. Antes o som dele vazava para a transmissão.' },
    ],
  },
  {
    id: '2026-11-17-6', title: 'Clipes: corte exato e enviar ao servidor; transmissões corrigidas',
    items: [
      { i: 'upload', t: 'Enviar clipe ao servidor', d: 'Em Meus clipes, "Enviar ao servidor" escolhe o canal (a sala onde o clipe foi gravado aparece primeiro): o clipe vai para o chat do canal e para a galeria de clipes do servidor.' },
      { i: 'edit', t: 'Corte no ponto certo', d: 'O clipe cortado começa e termina exatamente onde você marcou. A prévia pausa e continua de onde parou, para no fim do trecho e tem controle de volume (M silencia).' },
      { i: 'screen', t: 'Assistir fecha as outras', d: '"Assistir" fica só com a transmissão escolhida; para ver várias ao mesmo tempo, use o botão do olho.' },
      { i: 'screen', t: 'Jogo minimizado não transmite minúsculo', d: 'Começar a transmitir um jogo que estava minimizado (Alt+Tab) deixava a imagem em 146x28 pixels. Agora a transmissão usa o tamanho do jogo e se ajusta quando a janela cresce.' },
    ],
  },
  {
    id: '2026-11-17-5', title: 'Anúncios levam direto para a sala, Esc fecha popups e jogos com nome certo',
    items: [
      { i: 'voice', t: 'Aceito? Já está na sala', d: 'Quando o anúncio tem sala de voz, quem é aceito (ou entra direto) já entra no servidor dela e recebe o convite para a chamada. O botão "Ir para a sala" leva para lá na hora do jogo. A conversa do anúncio mostra o anúncio inteiro no topo.' },
      { i: 'x', t: 'Esc fecha', d: 'Clipes, o popup do jogo e as outras janelas fecham com a tecla Esc.' },
      { i: 'gamepad', t: 'Jogos com nome e imagem certos', d: 'O ícone vem da Steam (o mesmo da biblioteca; sem ele, o do programa, nunca o do anticheat ou do Java) e o banner da arte oficial e o nome vem da loja em vez da janela: Helldivers 2 e Dead as Disco aparecem certos. Valorant, LoL, Minecraft e Grand Line Adventures ganharam ícone, banner e links oficiais.' },
      { i: 'gamepad', t: 'Jogos da EA app e da Battle.net', d: 'The Sims 4, Apex, Battlefield, EA FC, Overwatch 2, Diablo, World of Warcraft, Hearthstone e outros são reconhecidos, com o nome e o banner certos.' },
    ],
  },
  {
    id: '2026-11-17-4', title: 'Visual novo: Jogos, Eventos e Contas vinculadas',
    items: [
      { i: 'gamepad', t: 'Jogos com menu ao lado', d: 'Procurar jogadores, Início, Notícias e Torneios agora ficam na lista ao lado, cada um com o que tem dentro, e com atalhos para Criar anúncio, A fim de jogar e Meu perfil de jogador.', try: 'lfg' },
      { i: 'calendar', t: 'Eventos como agenda', d: 'A tela Eventos do servidor agrupa por dia (Hoje, Amanhã…), mostra a capa do jogo em cada evento e tem uma aba com os da última semana.' },
      { i: 'link', t: 'Contas vinculadas mais claras', d: 'Jogo aberto no PC e Steam viraram cartões com o que cada um faz, se está ativo e quem pode ver.' },
    ],
  },
  {
    id: '2026-11-17-3', title: 'A fim de jogar: o Resenha chama quem tem o jogo',
    items: [
      { i: 'gamepad', t: 'Diga o jogo, até quando e com quantos', d: 'No topo do Ativo agora (ou em Procurar jogadores), "A fim de jogar?". O Resenha mostra quem do seu círculo tem, está jogando ou jogou esse jogo, e por quê. Você escolhe quem chamar.', try: 'intent' },
      { i: 'users', t: 'O grupo se forma sozinho', d: 'Quando o mínimo topa, o Resenha escolhe a sala (a sua, uma vazia ou uma temporária) e manda o convite para a chamada. Ninguém é colocado na sala à força: cada um entra quando quiser.' },
      { i: 'bell', t: 'Sem virar barulho', d: 'Só quem tem o jogo recebe; no máximo 3 convites com som por hora; em "não perturbe" ou offline chega em silêncio. Dá para silenciar um jogo por hoje ou escolher quem pode te chamar em Notificações.', try: 'notifications' },
    ],
  },
  {
    id: '2026-11-17-2', title: 'Procurar jogadores: conversa, entrada direta e "Jogando agora"',
    items: [
      { i: 'forum', t: 'Conversa em cada anúncio', d: 'Cada anúncio tem a própria conversa: combine estilo de jogo, microfone e horário antes de entrar. Quem criou o anúncio é avisado quando alguém escreve.', try: 'lfg' },
      { i: 'gamepad', t: '"Jogando agora" ao vivo', d: 'Com o jogo aberto (app do Resenha no PC ou Steam vinculada), o anúncio mostra que você está jogando e quantas vagas faltam. Pode abrir o jogo depois de publicar: aparece e some sozinho.' },
      { i: 'users', t: 'Entrada direta e sair do grupo', d: 'Ao criar o anúncio, escolha "Entrada direta": quem clicar em Entrar já está no grupo, sem esperar você aceitar. Quem entrou pode sair e a vaga volta para o anúncio.' },
      { i: 'grid4', t: 'Filtro por servidor', d: 'No topo do mural, escolha um servidor para ver só os anúncios de quem está nele com você. Atalho: clique direito no servidor → Procurar jogadores neste servidor.' },
      { i: 'layout', t: 'Plataforma do grupo', d: 'O anúncio diz onde o grupo joga (PC, PlayStation, Xbox, Switch, celular ou crossplay), para ninguém tentar entrar pela plataforma errada.' },
    ],
  },
  {
    id: '2026-11-17-1', title: 'Clipes ficam no seu aparelho',
    items: [
      { i: 'clip', t: 'Você escolhe o que compartilhar', d: 'Apertar o atalho do clipe (F8) agora guarda o clipe só neste aparelho, com um som de confirmação. Para mandar num canal ou DM: + do campo de mensagem → Compartilhar um clipe. Lá dá para editar o trecho e o título antes. Prefere o jeito antigo? Configurações → Clipes → Postar no chat da sala.', try: 'clipsettings' },
      { i: 'screen', t: 'Clipes em 60 e 120 FPS', d: 'Clipes agora saem em 60 FPS por padrão, inclusive o da sua própria transmissão (antes ficava em 30). Em Configurações → Clipes dá para escolher 30, 60 ou igual à transmissão (até 120), com mais qualidade por quadro.', try: 'clipsettings' },
      { i: 'clock', t: 'Clipes de até 2 minutos', d: 'Em Configurações → Clipes: 15 s, 30 s, 1 min ou 2 min, além do atalho, da codificação pela placa de vídeo e de quanto espaço os clipes ocupam.', try: 'clipsettings' },
    ],
  },
  {
    id: '2026-11-15-2', title: 'Galeria, documento, mídia favorita e importar do Discord',
    items: [
      { i: 'image', t: 'Novos tipos de canal', d: 'Ao criar um canal: Anúncios (só a moderação escreve), Galeria (fotos e vídeos em grade, com comentários) e Documento (uma página para regras e listas de tarefas com caixinhas).' },
      { i: 'star', t: 'Mídia favorita com categorias', d: 'Passe o mouse numa foto, vídeo ou arquivo e clique na estrela. No botão de GIF/emoji do campo, "Mídia favorita" tem abas (GIFs, Imagens, Vídeos, Áudios, Emojis, Outros) e categorias com o nome que você quiser.' },
      { i: 'eye', t: 'Spoiler no anexo e GIFs parados', d: 'Clique no olho da prévia do anexo para mandar como spoiler. Em Acessibilidade: esconder imagens e vídeos até clicar e deixar GIFs parados até passar o mouse.', try: 'accessibility' },
      { i: 'inbox', t: 'Importar conversa do Discord', d: 'Exporte a conversa com o DiscordChatExporter e importe pelo + do campo de mensagem: as mensagens entram com a data original. A outra pessoa da conversa pode desfazer.' },
      { i: 'bell', t: 'Número no ícone e barra de tarefas piscando', d: 'Em Notificações → Ícone e barra de tarefas: número de menções, ponto para não lidas ou nada; e o ícone pisca quando chamam você.', try: 'notifications' },
    ],
  },
  {
    id: '2026-11-15-1', title: 'Permissões por categoria, encaminhar e mais',
    items: [
      { i: 'lock', t: 'Permissões por categoria e por canal', d: 'Clique direito numa categoria → Editar categoria: escolha, por cargo, quem pode enviar mensagens, arquivos, reagir e entrar nas salas de voz. Os canais da categoria seguem junto (sincronizados); um canal pode ter as próprias e voltar a seguir a categoria quando quiser. A categoria também ganhou descrição.' },
      { i: 'arrowr', t: 'Encaminhar mensagens', d: 'Clique direito numa mensagem → Encaminhar: escolha até 5 conversas ou canais e, se quiser, um recado. A mensagem chega marcada "Encaminhada", com o link para a original.' },
      { i: 'users', t: 'Marcar um cargo com @', d: 'Digite @ e o nome de um cargo para avisar todo mundo que tem aquele cargo (Tab completa).' },
      { i: 'star', t: 'Emojis favoritos', d: 'No seletor de emoji, clique com o botão direito para favoritar. Favoritos e usados recentemente ficam no topo, em todos os aparelhos.' },
      { i: 'file', t: 'Duplicar canal', d: 'Clique direito num canal → Duplicar canal: mesma categoria, tópico e permissões.' },
      { i: 'eye', t: 'Status com forma, não só cor', d: 'Ausente é uma lua, Não perturbe tem um traço e Offline/Invisível é um anel vazio: dá para distinguir sem depender das cores.' },
      { i: 'voice', t: 'Botão de entrar menor', d: 'As salas de voz têm um "Entrar" pequeno no topo, ao lado do nome. O botão grande do palco pode ficar compacto em Configurações → Voz e vídeo.', try: 'voice' },
    ],
  },
  {
    id: '2026-11-14-1', title: 'Transmissão mais clara e eventos com capa',
    items: [
      { i: 'live', t: '"Ao vivo" sempre à vista', d: 'Enquanto você transmite, o painel de voz mostra uma faixa AO VIVO com o tempo, quantas pessoas estão assistindo e o botão Parar, em qualquer tela do app. No palco, o botão virou um selo "AO VIVO · Parar transmissão", com outra cor e mais longe do "Sair da chamada".' },
      { i: 'vol', t: 'Tela cheia sem o som do outro monitor', d: 'No app para Windows, ao transmitir uma tela inteira, o áudio "Só desta tela" leva só o som dos programas abertos nela. O vídeo ou o jogo do segundo monitor não vazam mais para a transmissão.', try: 'stream' },
      { i: 'image', t: 'Capa para qualquer jogo nos eventos', d: 'Além da Steam: escolha Valorant, LoL, Overwatch, Fortnite e outros da lista, cole o link da Epic, da Battle.net ou do site do jogo, ou envie uma imagem sua.' },
      { i: 'bell', t: 'Aviso 30 min antes, com som', d: 'Quem marcou Vou ou Talvez recebe o aviso 30 minutos antes do evento, com um som próprio (dá para trocar em Configurações → Sons).', try: 'sounds' },
      { i: 'file', t: 'Clipes com o nome certo em Arquivos', d: 'Clipe renomeado na galeria aparece (e baixa) com o nome novo na aba Arquivos do servidor e da DM.' },
      { i: 'dm', t: 'Ativo agora abre a conversa', d: 'Clicar em quem está no "Ativo agora" abre a DM com a pessoa. Para ver o perfil, clique na foto.' },
    ],
  },
  {
    id: '2026-11-13-4', title: 'Push-to-talk no jogo',
    items: [
      { i: 'mic', t: 'Push-to-talk com o jogo em foco', d: 'No app para Windows, a tecla de push-to-talk funciona com o jogo na frente, não só com a Resenha em foco. Só vale enquanto você está numa chamada em modo push-to-talk, e o app só vê a tecla escolhida. Se o jogo roda como administrador, abra a Resenha como administrador também.', try: 'voice' },
      { i: 'keyboard', t: 'Botão do mouse e F13–F24', d: 'O push-to-talk aceita o botão do meio e os laterais do mouse (Mouse 4/5), além das teclas F13 a F24 de teclados e mouses gamer.', try: 'voice' },
    ],
  },
  {
    id: '2026-11-13-3', title: 'App mais leve com o jogo aberto',
    items: [
      { i: 'bolt', t: 'Menos programas abrindo e fechando', d: 'No app do computador, o ajudante que lista as janelas (para o "Jogando…" e para a transmissão) agora fica aberto o tempo todo, em vez de abrir e fechar centenas de vezes por hora. Menos trabalho para o PC e para o antivírus. Precisa do app atualizado.' },
      { i: 'gamepad', t: '"Jogando…" aparece na hora', d: 'O app percebe quando um jogo abre ou fecha pelo próprio Windows: o "Jogando X" aparece em um ou dois segundos (antes podia levar até 20). Se a janela que você está transmitindo for minimizada ou fechada, quem assiste fica sabendo na hora.' },
      { i: 'clip', t: 'Aviso do clipe mais leve', d: 'O aviso de "Clipe salvo" por cima do jogo agora é desenhado direto pelo app, sem abrir uma página nova a cada F8. Continua fora da transmissão e do clipe, sem tirar o foco do jogo.' },
    ],
  },
  {
    id: '2026-11-13-2', title: 'Transmissão a 60 FPS de verdade',
    items: [
      { i: 'screen', t: '60 FPS pela placa de vídeo', d: 'No app do computador (Windows 11), transmitir a 60 FPS agora também usa a captura e a compressão pela placa de vídeo, como já acontecia a 120 FPS. Antes, pedindo 60, o navegador entregava uns 48. Em conversa protegida e em PCs sem codificador de vídeo na placa, continua pelo modo normal. Precisa do app atualizado.' },
      { i: 'bolt', t: 'Transmissão firme com o jogo pesado', d: 'Os programas de transmissão e de áudio do jogo agora pedem prioridade ao Windows (sem o modo de economia de energia e com a captura de áudio no agendador de multimídia), para perder menos quadros e picotar menos quando o jogo puxa o PC.' },
      { i: 'screen', t: 'Sem tela preta se a porta estiver fechada', d: 'Se o servidor não receber o vídeo da placa (porta UDP fechada no roteador ou no firewall), a transmissão volta sozinha ao modo normal em poucos segundos, em vez de deixar quem assiste vendo tela preta. A opção "mostrar o cursor" também passa a valer nesse modo.' },
    ],
  },
  {
    id: '2026-11-13-1', title: 'Mais seguro e a voz se recupera sozinha',
    items: [
      { i: 'mic', t: 'A voz volta sozinha', d: 'Se a internet oscilar (troca de Wi-Fi, 4G) ou o servidor de voz tiver um problema, a chamada se reconecta sozinha em segundos, sem precisar sair da sala nem fechar o app. Enquanto isso, o painel de voz mostra "Reconectando a voz…".' },
      { i: 'shield', t: 'Senhas e sessões mais protegidas', d: 'Senhas novas precisam ter pelo menos 8 caracteres e não podem ser das mais usadas. Ao trocar a senha, os outros aparelhos saem da conta. Aparelho sem uso há 30 dias precisa entrar de novo, e muitas tentativas erradas de senha fazem o login esperar um pouco.' },
      { i: 'dl', t: 'Atualizações do app conferidas', d: 'O app do computador só instala atualizações assinadas pela Resenha e baixadas por conexão segura. Ele também passa a reconhecer o certificado do seu servidor e avisa se ele mudar.' },
    ],
  },
  {
    id: '2026-11-12-1', title: 'Mensagens e Amigos juntos',
    items: [
      { i: 'users', t: 'Uma lista de amigos só', d: 'Online e Todos viraram uma lista única, separada em Pedidos, Online e Offline. Clique no nome do grupo para recolher ou expandir, como na lista de membros dos servidores; a escolha fica salva.' },
      { i: 'dm', t: 'Mensagens e Amigos na mesma tela', d: 'Não há mais as abas Mensagens | Amigos: a lista da esquerda mostra só as suas conversas, e o meio mostra os amigos e o "Ativo agora". Para voltar aos amigos, aperte Esc dentro da conversa (como no WhatsApp Web) ou use o ícone de Mensagens na barra dos servidores.', try: 'messages' },
      { i: 'shield', t: 'Estatísticas de uso anônimas', d: 'Para saber o que funciona e o que confunde, o app conta alguns cliques (por exemplo, quantas vezes o Esc é usado para voltar aos Amigos), sem dizer quem fez e nunca mensagens. Dá para desligar em Privacidade e segurança.' },
      { i: 'gamepad', t: 'Seção Jogos', d: 'Procurar jogadores e Descobrir viraram uma tela só, com abas no topo (Procurar jogadores, Início, Notícias, Torneios). Fica no ícone de controle da barra dos servidores, logo abaixo de "Adicionar um servidor".', try: 'lfg' },
    ],
  },
  {
    id: '2026-11-11-5', title: 'Mais leve na chamada e em segundo plano',
    items: [
      { i: 'bolt', t: 'Tela da chamada bem mais leve', d: 'O anel verde de quem fala não fica mais piscando a cada sílaba nem repintando a tela: em PCs mais simples, só deixar a chamada aberta gastava até metade do processador.' },
      { i: 'mic', t: 'Mutado gasta menos', d: 'Com o microfone mutado, a redução de ruído por IA para de trabalhar. Ensurdecido com a janela minimizada, o servidor nem manda a voz dos outros (volta na hora ao abrir a janela).' },
      { i: 'screen', t: 'App minimizado de verdade', d: 'Com o app do computador minimizado ou na bandeja, o vídeo da transmissão que você assiste pausa (o áudio continua) e o app para de desenhar o que ninguém está vendo. Precisa do app 1.0.25.' },
      { i: 'video', t: 'Clique duplo sem câmera extra', d: 'Clicar duas vezes na câmera ou na transmissão não abre mais uma câmera escondida que ficava ligada, e clicar em várias salas de voz seguidas sempre termina na última.' },
    ],
  },
  {
    id: '2026-11-11-4', title: 'Ideias que vieram dos mods',
    items: [
      { i: 'link', t: 'Links sem rastreio', d: 'Ao enviar ou editar, os links do YouTube, Spotify, Instagram, TikTok, X, Amazon, Mercado Livre, Shopee e outros perdem o que só serve para rastrear quem compartilhou (utm_, fbclid, si=…). O link abre a mesma coisa e o tempo do vídeo continua. Dá para desligar em Recursos extras.', try: 'extras' },
      { i: 'clock', t: 'Horário que cada um vê no seu fuso', d: 'No + do campo de mensagem → Inserir horário: escolha o dia e a hora e o formato ("em 2 horas", "21:30", "quarta-feira, 11 de novembro…"). Cada pessoa vê no próprio horário e formato, e o relativo vai se atualizando sozinho.' },
      { i: 'reply', t: 'Responder e editar mais rápido', d: 'Duplo clique na sua mensagem abre a edição; na de outra pessoa, começa a resposta. No campo, Ctrl + ↑ e Ctrl + ↓ escolhem a mensagem que você vai responder sem tirar a mão do teclado.' },
      { i: 'globe', t: 'De onde cada um está', d: 'Ícones ao lado do nome mostram se a pessoa está no app do computador, no celular ou no navegador, na lista de membros, nas conversas e no perfil. Quem está invisível ou esconde a presença de você não mostra nada.' },
      { i: 'users', t: 'Aviso de amizade desfeita', d: 'Quando alguém desfaz a amizade com você, aparece um aviso, mesmo que tenha sido com o app fechado. Os avisos ficam 30 dias na caixa de entrada → Pedidos, com o botão para mandar o pedido de novo. E ser removido de um servidor agora sempre avisa qual foi.', try: 'requests' },
    ],
  },
  {
    id: '2026-11-11-3', title: 'Conversas protegidas de ponta a ponta',
    items: [
      { i: 'lock', t: 'Criptografia de ponta a ponta nas conversas diretas', d: 'Ative em Privacidade e segurança com uma frase que só você sabe. Quando a outra pessoa também ativar, a conversa fica protegida: o que vocês mandam é cifrado no seu aparelho e só abre no seu e no dela, e o servidor guarda só dados embaralhados. O cadeado no topo da conversa mostra o número de segurança para vocês compararem e avisa se a chave da pessoa mudar.', try: 'privacy' },
      { i: 'file', t: 'Arquivos e mensagens de voz também', d: 'Fotos, vídeos, documentos e mensagens de voz enviados numa conversa protegida são cifrados antes de sair do aparelho: o servidor não sabe nem o nome nem o tipo do arquivo.' },
      { i: 'phone', t: 'Chamadas protegidas', d: 'Ligações de voz e vídeo e transmissões de tela numa conversa protegida são cifradas quadro a quadro no aparelho: o servidor repassa sem conseguir ouvir nem ver.' },
    ],
  },
  {
    id: '2026-11-11-1', title: 'Apagar suas mensagens de uma vez',
    items: [
      { i: 'trash', t: 'Apagar minhas mensagens', d: 'Em Privacidade e segurança → Suas mensagens, apague de uma vez o que você enviou: em todo lugar, só nas conversas diretas ou num servidor, por período (últimas 24 h, mais de 30 dias, entre datas…), por texto ou só as com arquivos ou links. Antes de apagar você vê quantas são e onde, desmarca as conversas que quer manter e pode baixar uma cópia. Vale até para servidores de que você já saiu, e as fixadas ficam se você quiser.', try: 'mymessages' },
      { i: 'dm', t: 'Direto do menu', d: 'Clique direito num canal, num servidor ou numa conversa → "Apagar minhas mensagens aqui" abre a mesma ferramenta já filtrada naquele lugar.' },
      { i: 'image', t: 'Escolha de onde vêm os GIFs', d: 'Quando o servidor tem KLIPY e GIPHY, o rodapé do seletor de GIFs deixa trocar a fonte, e a escolha fica na conta. Se o serviço escolhido cair, o outro responde no lugar e o seletor avisa. (O Tenor não volta: o Google encerrou a API dele.)' },
    ],
  },
  {
    id: '2026-11-10-6', title: 'Spoilers, pedidos e silêncio com exceção',
    items: [
      { i: 'eye', t: 'Spoiler em qualquer mensagem', d: 'Clique direito numa mensagem → "Marcar como spoiler só para mim" esconde texto e anexos só para você (ótimo em conversas diretas). Moderadores podem marcar a mensagem de outra pessoa como spoiler para o servidor todo, sem apagar e pedir para postar de novo; fica no registro de auditoria.' },
      { i: 'users', t: 'Pedidos de amizade na caixa de entrada', d: 'A caixa de entrada ganhou a aba Pedidos: os pedidos recebidos do mais novo ao mais antigo, com a data e a hora de cada um e os servidores em comum, para aceitar, ignorar ou responder. Os que você enviou e ainda esperam resposta ficam no fim.', try: 'requests' },
      { i: 'bell', t: 'Servidor silenciado, canal reativado', d: 'Silenciou um servidor cheio de canais? Clique direito no canal (ou na categoria) que importa, como o de anúncios → "Reativar este canal". Só ele volta a avisar; o resto continua quieto, e os canais silenciados ficam mais apagados na lista.', try: 'notifications' },
      { i: 'users', t: 'Amigos neste servidor', d: 'Embaixo do nome do servidor aparece quem dos seus amigos está nele; clique para ver a lista e mandar mensagem. O cartão de convite também mostra quais amigos já estão no servidor antes de você entrar.', try: 'servers' },
    ],
  },
  {
    id: '2026-11-10-5', title: 'Pedidos da comunidade',
    items: [
      { i: 'dm', t: 'Modo foco', d: 'Só mensagens diretas e chamadas para você tocam som e mostram aviso; os servidores continuam marcando não lidas, em silêncio. Seu status não muda: os amigos continuam te vendo online. Ligue pelo seu avatar → Modo foco (por 1 h, 3 h, 8 h, até amanhã ou até desligar) ou em Notificações.', try: 'notifications' },
      { i: 'phone', t: 'Quem pode te ligar', d: 'Em Privacidade → Ligações, escolha se todo mundo pode te ligar ou só amigos, amigos de amigos e membros dos seus servidores. Quem não pode recebe "não está aceitando ligações" e só manda mensagem. Vale também para convites para a sala.', try: 'privacy' },
      { i: 'eye', t: 'Quem vê seu status e sua atividade', d: 'Todo mundo, só amigos ou só quem você escolher veem quando você está online e o que está jogando ou ouvindo. Dá também para esconder de pessoas específicas (colegas de trabalho, por exemplo). Para elas você aparece offline e sem atividade.', try: 'privacy' },
      { i: 'vol', t: 'Volume das notificações', d: 'Um volume só para as notificações (mensagens, menções, chamadas recebidas, pedidos de amizade), separado dos sons da chamada e da transmissão. O aviso do sistema não toca mais um som próprio por cima.', try: 'sounds' },
      { i: 'gear', t: 'Configurações que não somem', d: 'Atualizar ou reiniciar o app não desfaz mais o que você mudou: o que não deu tempo de ir para a conta vai na próxima abertura. Microfone, fone e câmera escolhidos são reencontrados pelo nome se o Windows ou o driver mudarem o aparelho de lugar, e o app desktop guarda uma cópia dos ajustes deste computador.' },
    ],
  },
  {
    id: '2026-11-10-4', title: 'Transmitir com um atalho',
    items: [
      { i: 'screen', t: 'Atalho da transmissão', d: 'Ctrl+Shift+S inicia ou encerra a transmissão, inclusive com o jogo aberto (app desktop). Com um jogo aberto, transmite o jogo direto, com a qualidade e o áudio da última vez. Dá para trocar a tecla em Configurações → Atalhos.' },
      { i: 'gamepad', t: 'Jogando? Transmita', d: 'Abriu um jogo durante a chamada? A Resenha pergunta se você quer transmitir, com um botão que já transmite o jogo. Se não quiser, clique no X para não perguntar mais.' },
      { i: 'music', t: 'Painel de música mais firme', d: 'O painel não pula mais para o canto da tela ao tocar ou pausar, mostra "pausado" na hora, fecha com Esc e clicando de novo no botão, e fecha sozinho ao tirar o bot ou sair da sala.' },
    ],
  },
  {
    id: '2026-11-10-3', title: 'Música mais leve',
    items: [
      { i: 'music', t: 'Tempo da música à vista', d: 'A barra do painel de música agora anda junto com a música, então dá para ver em que ponto ela está e pular para qualquer parte.' },
      { i: 'bolt', t: 'Pausar e continuar na hora', d: 'Continuar depois de pausar é instantâneo, sem recarregar a música, e pular para um ponto leva uma fração de segundo. A primeira música da busca já começa a carregar enquanto você escolhe, e a próxima da fila fica pronta antes de a atual acabar.' },
      { i: 'sparkle', t: 'O bot não é uma pessoa', d: 'O bot de música saiu da lista de membros: não tem perfil, não dá para adicionar, expulsar nem banir. Na sala ele aparece com um visual próprio, a etiqueta BOT e a música que está tocando. Clique nele para abrir o painel.' },
    ],
  },
  {
    id: '2026-11-10-2', title: 'Bot de música',
    items: [
      { i: 'music', t: 'Música na sala de voz', d: 'O botão de música do painel de voz voltou: busque pelo nome (e escolha o resultado) ou cole um link do YouTube, Spotify, SoundCloud… O bot entra na sala e toca para todos, com fila, tocar a seguir, voltar, repetir, embaralhar e uma barra para pular para qualquer ponto.' },
      { i: 'sparkle', t: 'Como os bots do Discord', d: 'Reprodução automática de músicas parecidas quando a fila acaba, histórico, playlists salvas no servidor, modo 24/7 e até 4 bots tocando em salas diferentes.' },
    ],
  },
  {
    id: '2026-11-10', title: 'Favoritos e busca ao lado',
    items: [
      { i: 'star', t: 'Canais favoritos', d: 'Clique direito num canal → Adicionar aos favoritos. A estrela na barra dos servidores junta canais de servidores diferentes num lugar só; arraste para ordenar e crie grupos seus (clique direito → Mover para o grupo).' },
      { i: 'search', t: 'Busca ao lado dos canais', d: 'Buscar em tudo abre num painel próprio e continua aberto enquanto você troca de servidor e de canal, para comparar o resultado com o que está nos canais. Arraste a borda para mudar a largura.' },
      { i: 'mic', t: 'Mudo sempre à vista', d: 'Com a lista de canais oculta, o avatar mostra o microfone (ou o fone) riscado em vez de uma bolinha vermelha. Clique nele para ativar de novo.' },
      { i: 'bolt', t: 'Pico de consumo', d: 'Configurações → Modo leve mostra o maior uso de processador e de memória desde que o app abriu, a hora e o que estava acontecendo (chamada, transmissão, jogo), com um gráfico dos últimos minutos.' },
    ],
  },
  {
    id: '2026-11-09-2', title: 'Arquivos, aparelhos e comunidade',
    items: [
      { i: 'file', t: 'Aba Arquivos', d: 'Cada servidor tem a entrada "Arquivos" (abaixo de Clipes) e cada canal ou DM tem o botão de arquivo no topo: fotos, vídeos, áudios, documentos, outros arquivos e links numa grade por mês, com filtros de quem enviou, período, canal e nome. O limite por arquivo subiu para 500 MB.' },
      { i: 'phone', t: 'PC e celular em sincronia', d: 'Leu no PC? A conversa deixa de aparecer como não lida no celular e a notificação some na hora. Enquanto você usa um aparelho, os outros ficam em silêncio. Configurações e buscas recentes passam de um aparelho para o outro sem recarregar.' },
      { i: 'shield', t: 'Proteção da comunidade', d: 'Clique direito numa mensagem → "Marcar como spam" ou "Denunciar como ofensiva" (ela some para você). Se várias pessoas marcarem alguém em poucos minutos, o envio dela fica limitado até a moderação analisar, sem banir ninguém por robô. Moderadores: menu do servidor → Reputação.' },
    ],
  },
  {
    id: '2026-11-09', title: 'Vídeos e espaço',
    items: [
      { i: 'play', t: 'Player com gestos no celular', d: 'Dois toques no lado direito ou esquerdo do vídeo avançam ou voltam 10 s (cada toque a mais soma 10 s). Dois toques no meio abrem a tela cheia, e segurar o dedo acelera para 2× enquanto segurar.' },
      { i: 'video', t: 'Vídeos que começam na hora', d: 'Vídeos enviados agora tocam sem esperar baixar tudo, e os .mov do iPhone tocam direto no chat.' },
      { i: 'bolt', t: 'Modo leve automático no jogo', d: 'No app desktop, o modo leve liga sozinho quando um jogo abre e desliga quando ele fecha. A redução de ruído e a qualidade da transmissão não mudam. Em Modo leve também aparece quanto a Resenha está usando de processador e memória agora, e o que está pesando.', try: 'lite' },
      { i: 'screen', t: 'Transmissão que se cuida sozinha', d: 'Se o jogo fechar e abrir de novo (launcher, atualização), o áudio dele volta sozinho para a transmissão. Quem transmite vê um selo com fps, de onde vem o áudio e o que está atrapalhando. Se a janela transmitida for minimizada ou fechada, quem assiste vê o aviso em vez de uma imagem congelada.', try: 'stream' },
      { i: 'file', t: 'Armazenamento', d: 'Configurações → Armazenamento mostra quanto suas mídias ocupam neste aparelho e no servidor, por conversa e por tipo. Dá para limpar o cache sem sair da conta, pôr um limite de tamanho no app desktop e apagar de uma vez as mídias com mais de 30 dias. Quem gerencia um servidor pode fazer as mídias antigas expirarem sozinhas.', try: 'storage' },
      { i: 'upload', t: 'Vídeos grandes do celular', d: 'Vídeo maior que o limite do servidor é comprimido no próprio aparelho antes de enviar, em vez do aviso de "arquivo muito grande". Arquivos grandes sobem em partes: se a internet cair no meio, o envio continua de onde parou quando ela voltar.' },
      { i: 'expand', t: 'Shorts, TikTok e Reels no chat', d: 'Links do YouTube (inclusive Shorts), TikTok e Instagram tocam ali mesmo. Os vídeos em pé ganham o botão "Tela vertical": abre em tela cheia e é só deslizar (ou ↑ ↓) para o próximo.' },
    ],
  },
  {
    id: '2026-11-08', title: 'Navegação nova',
    items: [
      { i: 'dm', t: 'Mensagens e Amigos', d: 'Um ícone só na barra da esquerda, com as abas Mensagens | Amigos no topo da lista. Mensagens é uma lista limpa, com ordenar, buscar e nova mensagem; as conversas fixadas também ficam como atalho na barra.', try: 'messages' },
      { i: 'search', t: 'Busca em tudo', d: 'A lupa no topo da barra (ou Ctrl+Shift+F) procura em todas as DMs e servidores de uma vez, com ordem Novas/Antigas/Relevantes e resultados agrupados por servidor e conversa.' },
      { i: 'pin', t: 'Barra de perfil com alfinete', d: 'Seu avatar fica no pé da barra, com o status e um ponto vermelho quando o microfone ou o som está desligado. A barra com microfone, fone e configurações sai dele: com o alfinete azul fica sempre aberta; solta, abre ao passar o mouse. Clique direito no microfone ou no fone troca os dispositivos.' },
      { i: 'bell', t: 'Notificações num cartão', d: 'O sino do canal e o do servidor abrem um cartão com Todas / Só @menções / Nada, @everyone e @here, silenciar e avisos na área de trabalho.' },
      { i: 'users', t: 'Servidor e membros', d: 'Atalhos embaixo do nome do servidor (notificações, convidar, marcar como lido, buscar, configurações). Na lista de membros, os cargos recolhem, dá para buscar e seu cartão fica fixo embaixo com sua posição no servidor.' },
      { i: 'gear', t: 'Configurações mais limpas', d: 'As explicações foram para um ⓘ ao lado de cada opção, o menu ganhou ícones e grupos, e fonte, mensagens, hora e modo de entrada viraram cartões com prévia.', try: 'appearance' },
    ],
  },
  {
    id: '2026-11-06', title: 'Transmissão de jogos e clipes',
    items: [
      { i: 'gamepad', t: 'Transmitir o jogo, não a tela toda', d: 'Jogo em tela cheia aparece em "Janelas" mesmo minimizado depois do alt+tab, já vem escolhido e com o selo JOGO. Antes a transmissão caía para a tela inteira.', try: 'stream' },
      { i: 'vol', t: 'Áudio só do jogo', d: 'No app desktop (Windows 10 2004+), a transmissão leva só o som do jogo: música, navegador e a voz da call não vão junto. Dá para escolher "Tudo do PC, menos a Resenha".', try: 'stream' },
      { i: 'rec', t: 'Clipe com F8', d: 'O atalho do clipe agora é F8 (funciona com o jogo aberto). Aparece um aviso de "Clipe capturado" só para você, por cima do jogo, sem entrar na transmissão.' },
      { i: 'live', t: 'Painel "Ativo agora"', d: 'A aba Atividade virou o painel à direita dos Amigos: no topo, em destaque, quem está jogando, em chamada ou online agora; embaixo, os destaques da semana — maratonas, jogos novos, sequências de dias e clipes dos seus amigos.' },
      { i: 'gamepad', t: '"Jogando…" sem vincular conta', d: 'O app desktop reconhece o jogo aberto no PC (do mesmo jeito que a transmissão) e mostra "Jogando VALORANT" com o ícone do jogo — e a arte oficial quando é jogo da Steam — na lista de membros, no perfil e no painel "Ativo agora". Quem vê: Configurações → Contas vinculadas.' },
      { i: 'mic', t: 'Sua voz nos clipes', d: 'O clipe grava o jogo junto com a voz de quem está transmitindo. Na transmissão ao vivo a voz continua indo separada, como na call.' },
    ],
  },
  {
    id: '2026-11-04', title: 'Novembro de 2026',
    items: [
      { i: 'mask', t: 'Efeitos de voz', d: 'Robô, voz grossa, esquilo, monstro, rádio, eco e mais, no botão de máscara do painel de voz (atalho Ctrl+Shift+E). Quem ouve pode desligar os efeitos dos outros para si.', try: 'fx' },
      { i: 'image', t: 'GIFs no chat', d: 'Botão GIF ao lado do emoji: busca, em alta, favoritos (estrela) e os GIFs que já rolaram no grupo.', try: 'gifs' },
      { i: 'scissors', t: 'Cortar clipe', d: '"Salvar e cortar…" no menu de clipes da transmissão, ou "Cortar" na galeria: escolhe o trecho numa linha do tempo, sem perder qualidade.', try: 'clips' },
      { i: 'gamepad', t: 'Procurar jogadores', d: 'Anuncie que falta gente para o squad (jogo, modo, elo, função) e receba pedidos para entrar. Fica em "Procurar jogadores", abaixo de Amigos.', try: 'lfg' },
      { i: 'bolt', t: 'Transmissão a 120 FPS', d: 'No app desktop para Windows, escolha 120 fps ao transmitir: a imagem é comprimida pela placa de vídeo. Quem tem internet mais fraca recebe uma versão leve automaticamente.', try: 'stream' },
      { i: 'poll', t: 'Enquetes', d: 'No + do campo de mensagem → "Criar enquete": uma ou várias respostas, prazo, resultado ao vivo.', try: 'poll' },
      { i: 'phone', t: 'Convidar para a chamada', d: 'Clique direito num amigo → "Convidar para a chamada", mesmo que ele não esteja no servidor.' },
      { i: 'pointer', t: 'Controle remoto', d: 'Quem assiste sua transmissão pode pedir para controlar mouse e teclado (app desktop). Você aceita e para quando quiser.' },
      { i: 'clip', t: 'Clipes mais leves no chat', d: 'Os clipes antigos foram para a galeria do servidor. No chat da sala cada clipe virou um cartão com miniatura: o vídeo só baixa quando você clica para assistir (antes o chat baixava todos ao abrir).', try: 'clips' },
      { i: 'wifi', t: 'Voz mais leve e estável', d: 'A voz usa até 80% menos internet (sem perder qualidade), o que ajuda muito quem está longe do servidor. Clique no ícone de sinal do painel de voz para ver o diagnóstico da sua conexão e dicas para baixar o ping.', try: 'ping' },
      { i: 'rocket', t: 'App mais leve e rápido', d: 'Abre até 3x mais rápido, sem vazamentos de memória, e trocar o filtro de ruído não deixa mais a voz atrasada.' },
    ],
  },
];

let actions = {};
export const setNewsActions = (a) => { actions = a; };
const latest = () => NEWS[0]?.id;

function card(it, close) {
  const go = it.try && actions[it.try];
  return h('div.newsitem', h('span.newse', it.i ? icon(it.i, 22) : it.e), h('div.newst', h('b', it.t), h('p', it.d)),
    go && h('button.btn.sm', { onclick: () => { close?.(); setTimeout(() => go(), 50); } }, 'Experimentar'));
}

// janela de novidades de uma atualização (a mais nova, por padrão)
export function openNews(id = latest()) {
  const n = NEWS.find(x => x.id === id) || NEWS[0]; if (!n) return;
  markSeen();
  let m;
  const close = () => m?.close();
  const body = h('div.newsbody', h('p.newsintro', 'O que chegou desde a última vez que você abriu a Resenha:'), h('div.newslist', n.items.map(it => card(it, close))));
  m = modal(`Novidades — ${n.title}`, null, body, [{ label: 'Ver todas as novidades', cls: 'link', fn: () => { setTimeout(() => actions.settings?.(), 50); } }, { label: 'Legal!', cls: 'green' }], { width: '620px' });
}
export function markSeen() { if (S.prefs.newsSeen !== latest()) { S.prefs.newsSeen = latest(); savePrefs(); } }

// chamado depois que as preferências da conta chegam: mostra uma vez se há novidade que a pessoa ainda não viu
export function maybeShowNews() {
  const last = latest(); if (!last || S.prefs.newsSeen === last) return;
  setTimeout(() => { if (S.prefs.newsSeen !== last && !document.querySelector('.backdrop:not(.leaving)')) openNews(last); }, 1200); // depois de a tela montar
}

// página em Configurações
export function newsPage() {
  markSeen();
  return h('div.newspage', h('h2', 'Novidades'),
    ...NEWS.map(n => h('div.newsrel', h('h3', n.title), h('div.newslist', n.items.map(it => card(it, () => document.querySelector('#settings .close')?.click()))))));
}
