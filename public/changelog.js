// Novidades: o que mudou em cada atualização, mostrado uma vez para cada pessoa (fica gravado na conta, vale em todos os
// aparelhos) e guardado em Configurações -> Novidades. Para uma atualização nova: acrescente uma entrada NO TOPO de NEWS
// com um id novo (data). "try" liga o botão "Experimentar" a uma ação registrada pelo app (setNewsActions).
import { h, icon } from './util.js';
import { S, modal, savePrefs } from './state.js';

export const NEWS = [
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
