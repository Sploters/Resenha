// Seção Jogos: uma tela só com abas no topo. "Jogadores" é o mural de Procurar jogadores (lfg.js), "Conquistas" é a
// achievements.js; as outras são o Descobrir (discover.js). Cada módulo desenha a própria barra de cima, mas as abas são estas, iguais nos dois.
// Com a lista lateral aberta (#side), as áreas ficam nela (gamesNav, desenhada pelo app.js) e o topo mostra só o título;
// com a lista fechada (ou no celular), as abas voltam para o topo.
import { h, icon } from './util.js';
import { track } from './ux.js';

export const GAME_TABS = [['lfg', 'Procurar jogadores', 'gamepad'], ['trophies', 'Conquistas', 'medal'], ['home', 'Início', 'compass'], ['news', 'Notícias', 'news'], ['tournaments', 'Torneios', 'trophy']];
const SUB = { lfg: 'Monte um grupo agora', trophies: 'Platinas e conquistas dos seus jogos', home: 'Para você, promoções e lançamentos', news: 'O que saiu nos seus jogos', tournaments: 'Campeonatos com inscrição aberta' };
const PENDING = 'lc_disc_tab'; // aba do Descobrir pedida a partir do mural (lida quando o Descobrir abre)
export const takeDiscoverTab = () => { try { const t = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); return t; } catch { return null; } };
const cur = { active: null, onDiscover: null }; // aba aberta agora (a lista lateral acompanha)
const pick = (k) => {
  const { active, onDiscover } = cur;
  if (k === active) return;
  track('games_tab', k);
  if (k === 'lfg' || k === 'trophies') { location.hash = '#/@me/' + k; return; }
  if (active && active !== 'lfg' && active !== 'trophies' && onDiscover) return onDiscover(k);
  try { localStorage.setItem(PENDING, k); } catch { }
  location.hash = '#/@me/discover';
};
const syncNav = () => {
  for (const el of document.querySelectorAll('#side-list .gnav')) { const on = el.dataset.k === cur.active; el.classList.toggle('active', on); el.setAttribute('aria-current', on ? 'page' : 'false'); }
  const acts = document.querySelector('#side-list .gnav-acts'); if (acts) acts.hidden = cur.active === 'lfg';
};
// active: 'lfg' ou a aba do Descobrir; onDiscover(k): troca de aba quando já está no Descobrir
export function gamesTabs(active, onDiscover) {
  Object.assign(cur, { active, onDiscover }); syncNav();
  const [, label, ic] = GAME_TABS.find(t => t[0] === active) || GAME_TABS[0];
  return [h('span.hash', icon(ic, 24)), h('span.gtitle', label),
    h('div.dtabs.gtabs', { role: 'tablist' }, GAME_TABS.map(([k, l, i]) => h('button.dtab' + (active === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(active === k), onclick: () => pick(k) }, icon(i, 16), h('span', l))))];
}
// lista lateral da seção Jogos: as áreas (com o que tem em cada uma) e atalhos do mural
// acts: { create(), intent(), profile() }
export function gamesNav(acts = {}) {
  const act = (ic, label, fn, cls = '') => h('button.gact' + cls, { type: 'button', onclick: fn }, h('span.gact-ic', icon(ic, 18)), h('span.name', label));
  const el = h('div#side-list.gnav-list',
    h('div.gnav-cap', 'Explorar'),
    GAME_TABS.map(([k, l, ic]) => h('button.ch.gnav.gnav-' + k + (cur.active === k ? '.active' : ''), { type: 'button', 'data-k': k, 'aria-current': cur.active === k ? 'page' : 'false', onclick: () => pick(k) },
      h('span.gnav-ic', icon(ic, 20)), h('span.gnav-t', h('span.name', l), h('small', SUB[k])))),
    // atalhos: escondidos em Procurar jogadores, que já tem os mesmos três botões no topo (syncNav)
    h('div.gnav-acts', { hidden: cur.active === 'lfg' },
      h('div.gnav-cap', 'Atalhos'),
      act('plus', 'Criar anúncio', () => { if (cur.active !== 'lfg') location.hash = '#/@me/lfg'; setTimeout(() => acts.create?.(), cur.active === 'lfg' ? 0 : 120); }, '.green'),
      act('gamepad', 'A fim de jogar', () => acts.intent?.()),
      act('edit', 'Meu perfil de jogador', () => acts.profile?.())));
  return el;
}
