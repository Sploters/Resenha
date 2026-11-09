// Novidades: o que mudou em cada atualização, mostrado uma vez para cada pessoa (fica gravado na conta, vale em todos os
// aparelhos) e guardado em Configurações -> Novidades. Para uma atualização nova: acrescente uma entrada NO TOPO de NEWS
// com um id novo (data). "try" liga o botão "Experimentar" a uma ação registrada pelo app (setNewsActions).
import { h, icon } from './util.js';
import { S, modal, savePrefs } from './state.js';

export const NEWS = [
  {
    id: '2026-11-09', title: 'Vídeos e espaço',
    items: [
      { i: 'play', t: 'Player com gestos no celular', d: 'Dois toques no lado direito ou esquerdo do vídeo avançam ou voltam 10 s (cada toque a mais soma 10 s). Dois toques no meio abrem a tela cheia, e segurar o dedo acelera para 2× enquanto segurar.' },
      { i: 'video', t: 'Vídeos que começam na hora', d: 'Vídeos enviados agora tocam sem esperar baixar tudo, e os .mov do iPhone tocam direto no chat.' },
      { i: 'bolt', t: 'Modo leve automático no jogo', d: 'No app desktop, o modo leve liga sozinho quando um jogo abre e desliga quando ele fecha. A redução de ruído e a qualidade da transmissão não mudam. Em Modo leve também aparece quanto a Resenha está usando de processador e memória agora, e o que está pesando.', try: 'lite' },
      { i: 'screen', t: 'Transmissão que se cuida sozinha', d: 'Se o jogo fechar e abrir de novo (launcher, atualização), o áudio dele volta sozinho para a transmissão. Quem transmite vê um selo com fps, de onde vem o áudio e o que está atrapalhando. Se a janela transmitida for minimizada ou fechada, quem assiste vê o aviso em vez de uma imagem congelada.', try: 'stream' },
      { i: 'file', t: 'Armazenamento', d: 'Configurações → Armazenamento mostra quanto suas mídias ocupam neste aparelho e no servidor, por conversa e por tipo. Dá para limpar o cache sem sair da conta, pôr um limite de tamanho no app desktop e apagar de uma vez as mídias com mais de 30 dias. Quem gerencia um servidor pode fazer as mídias antigas expirarem sozinhas.', try: 'storage' },
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
