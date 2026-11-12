// "Ver o que é enviado" (Configurações → Privacidade e segurança): mostra, de verdade, o que a telemetria deste aparelho
// tem na fila e o que já mandou nesta abertura do app, em linguagem de gente, mais o que o servidor conta sozinho.
// Transparência: nada aqui é exemplo, é a lista real (public/ux.js guarda as últimas 30 remessas só na memória).
import { h, icon } from './util.js';
import { modal, S } from './state.js';
import { uxPending, uxSent, uxOn, flushUx, UX_VERSION } from './ux.js';

export const EVENT_NAMES = {
  back_to_friends: 'Voltou para Amigos', games_open: 'Abriu a seção Jogos', games_tab: 'Trocou de aba em Jogos', info_tip: 'Abriu uma explicação ⓘ',
  settings_search_empty: 'Busca sem resultado nas Configurações', flow: 'Começou/terminou uma tarefa', rage_click: 'Vários cliques rápidos no mesmo lugar',
  dead_click: 'Clique que não fez nada', js_error: 'Erro do app', error_shown: 'Aviso de erro na tela', timing: 'Tempo de carregamento',
  voice_fail: 'Falha ao entrar na voz', ws_reconnect: 'Conexão caiu e voltou', u_turn: 'Foi e voltou rápido', quick_exit: 'Saiu logo de uma página',
  menu_open: 'Abriu um menu', menu_abandoned: 'Fechou um menu sem escolher', call_rating: 'Avaliação da chamada', call_issue: 'Problema na chamada',
  call_quality: 'Qualidade da rede na chamada', call_net: 'Medida da chamada (faixa)', call_qcause: 'O que pesou na chamada', call_rating_q: 'Avaliação × rede medida',
};
const DEV = { desktop: 'computador', mobile: 'celular', app: 'app desktop' };
const rows = (list) => list.length
  ? h('div.uxv-list', list.map(x => h('div.uxv-row', h('span.uxv-e', EVENT_NAMES[x.e] || x.e), h('code.uxv-d', x.d || '—'), h('b.uxv-n', '×' + x.n))))
  : h('p.uxv-empty', 'Nada.');

export function openUxView() {
  const body = h('div.uxv');
  const draw = () => {
    const pend = uxPending(), sent = uxSent();
    body.replaceChildren(...[
      !uxOn() && h('p.uxv-off', icon('shield', 14), ' Está desligado: nada é juntado nem enviado.'),
      h('p.uxv-intro', `Cada remessa leva só isto, mais a versão do app (${UX_VERSION.slice(0, 7)}) e o tipo de aparelho. Nunca leva seu nome, suas mensagens ou com quem você fala.`),
      h('h4', 'Na fila (vai na próxima remessa)'), rows(pend),
      pend.length > 0 && uxOn() && h('button.btn.grey.sm', { onclick: async () => { await flushUx(); draw(); } }, 'Enviar agora'),
      h('h4', `Já enviado nesta abertura do app (${sent.length})`),
      ...(sent.length ? sent.map(r => h('details.uxv-batch', h('summary', `${new Date(r.at).toLocaleTimeString('pt-BR')} · ${DEV[r.device] || r.device} · ${r.events.length} ${r.events.length === 1 ? 'item' : 'itens'}`), rows(r.events))) : [h('p.uxv-empty', 'Nada ainda.')]),
      h('h4', 'O que o servidor conta sozinho'),
      h('ul.uxv-srv',
        h('li', 'Que você abriu o app hoje, como um código embaralhado (não dá para voltar do código para você). Serve para saber quantas pessoas usam por dia.'),
        h('li', 'Se a sua conta é nova: o dia do cadastro e se você já pôs foto, fez amigo, mandou a 1ª mensagem e entrou na voz (só sim ou não, com o mesmo código).'),
        h('li', 'Tudo some depois de 60 dias. Desligando a opção, o servidor também para de contar você.'))].filter(Boolean));
  };
  draw();
  modal('O que é enviado', null, body, [{ label: 'Fechar', cls: 'grey' }], { width: '560px' });
}
