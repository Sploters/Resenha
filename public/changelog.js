// Novidades: o que mudou no mês, mostrado uma vez para cada pessoa (fica gravado na conta, vale em todos os aparelhos) e
// guardado em Configurações -> Novidades.
// UMA EDIÇÃO POR MÊS (id 'AAAA-MM'). Não abre sozinha: fica em Configurações → Novidades e no menu do perfil. Durante o mês, acrescente na
// edição do mês só o que a pessoa nota e usa (recurso novo, mudança de comportamento, algo de privacidade), em poucas
// palavras; correções, ajustes de desempenho e detalhes NÃO entram. Mire em 8-12 itens por mês, agrupados por "sec".
// "try" liga o botão "Experimentar" a uma ação registrada pelo app (setNewsActions, public/userbar.js newsActions).
import { h, icon } from './util.js';
import { S, modal, savePrefs } from './state.js';

export const NEWS = [
  {
    id: '2026-11', title: 'Novembro de 2026',
    items: [
      { sec: 'Visual', i: 'palette', t: 'Resenha 2.0', d: 'Grafite com azul elétrico e a fonte Geist. Prefere como era? Aparência → Layout → Visual clássico.', try: 'appearance' },
      { sec: 'Jogar com a turma', i: 'megaphone', t: 'Bora?', d: 'Chame a turma do servidor para jogar ou só resenhar, agora ou mais tarde, com o contador de quem topou ao vivo. Fica no "+" da barra dos servidores.', try: 'bora' },
      { sec: 'Jogar com a turma', i: 'gamepad', t: 'Seção Jogos', d: 'Procurar jogadores com conversa em cada anúncio, "A fim de jogar" que forma o grupo sozinho e as suas Conquistas.', try: 'lfg' },
      { sec: 'Jogar com a turma', i: 'users', t: 'Ativo agora', d: 'O que cada amigo está jogando, quem está em chamada e o que você perdeu. Se adapta a você: quem está chegando vê os primeiros passos; quem já usa, só o que está rolando (dá para escolher no ⋯).' },
      { sec: 'Jogar com a turma', i: 'eye', t: 'Seu jogo do PC aparece para a turma', d: 'O jogo que você abre no PC aparece para seus amigos e para quem está nos seus servidores, inclusive no Ativo agora. A opção de esconder saiu; para não aparecer, use o status Invisível.' },
      { sec: 'Jogar com a turma', i: 'screen', t: 'Jogar junto', d: 'Na sua transmissão, até 3 amigos entram como jogador 2, 3 e 4, com controle, teclado ou mouse que você libera.' },
      { sec: 'Transmissão e clipes', i: 'screen', t: 'Transmissão de jogos', d: 'Pela placa de vídeo até 120 FPS, só a janela e o áudio do jogo. O Modo leve deixa mais folga para o jogo.', try: 'stream' },
      { sec: 'Transmissão e clipes', i: 'clip', t: 'Clipes', d: 'F8 salva os últimos segundos (até 2 min, 60 ou 120 FPS), no seu aparelho. Corte, mande para o servidor e veja os Clipes da semana.', try: 'clipsettings' },
      { sec: 'Transmissão e clipes', i: 'play', t: 'Watch Together e música', d: 'Vídeos do YouTube em Full HD, sincronizados, com playlists. E um bot de música na sala de voz.' },
      { sec: 'Servidores', i: 'sparkle', t: 'Central de boas-vindas', d: 'Quem entra vê a apresentação, as regras e perguntas que já dão os cargos certos. Configure em Configurações do servidor → Boas-vindas.' },
      { sec: 'Servidores', i: 'calendar', t: 'Mais coisas no servidor', d: 'Eventos com aviso antes da hora, Wishlist da turma, aba Arquivos, canais de galeria e documento e permissões por categoria.' },
      { sec: 'A turma', i: 'star', t: 'A semana, o Rewind e A Noite', d: 'O que a turma jogou na semana, a retrospectiva do mês e do ano e as noites que viraram história.' },
      { sec: 'Voz e privacidade', i: 'mic', t: 'Voz', d: 'Filtro "Só a minha voz", efeitos de voz, push-to-talk com o jogo em foco e o microfone que volta sozinho se cair.', try: 'voice' },
      { sec: 'Voz e privacidade', i: 'lock', t: 'Privacidade', d: 'Conversas diretas protegidas de ponta a ponta, e você escolhe quem pode te ligar e quem vê seu status.', try: 'privacy' },
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

// itens agrupados pelo tema (sec): um título pequeno quando o tema muda
const list = (items, close) => h('div.newslist', items.flatMap((it, i) => [it.sec && it.sec !== items[i - 1]?.sec && h('h4.newssec', it.sec), card(it, close)]).filter(Boolean));

// janela de novidades de uma atualização (a mais nova, por padrão)
export function openNews(id = latest()) {
  const n = NEWS.find(x => x.id === id) || NEWS[0]; if (!n) return;
  markSeen();
  let m;
  const close = () => m?.close();
  const body = h('div.newsbody', h('p.newsintro', `O que chegou em ${n.title.toLowerCase()}:`), list(n.items, close));
  m = modal(`Novidades — ${n.title}`, null, body, [{ label: 'Ver todas as novidades', cls: 'link', fn: () => { setTimeout(() => actions.settings?.(), 50); } }, { label: 'Legal!', cls: 'green' }], { width: '620px' });
}
export function markSeen() { if (S.prefs.newsSeen !== latest()) { S.prefs.newsSeen = latest(); savePrefs(); } }

// chamado depois que as preferências da conta chegam: as Novidades não abrem mais sozinhas (ficam em Configurações →
// Novidades e no menu do perfil)
export function maybeShowNews() { }

// página em Configurações
export function newsPage() {
  markSeen();
  return h('div.newspage', h('h2', 'Novidades'),
    ...NEWS.map(n => h('div.newsrel', h('h3', n.title), list(n.items, () => document.querySelector('#settings .close')?.click()))));
}
