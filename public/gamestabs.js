// Seção Jogos: uma tela só com abas no topo. "Jogadores" é o mural de Procurar jogadores (lfg.js); as outras são o
// Descobrir (discover.js). Cada módulo desenha a própria barra de cima, mas as abas são estas, iguais nos dois.
import { h, icon } from './util.js';
import { track } from './ux.js';

export const GAME_TABS = [['lfg', 'Procurar jogadores', 'gamepad'], ['home', 'Início', 'compass'], ['news', 'Notícias', 'news'], ['tournaments', 'Torneios', 'trophy']];
const PENDING = 'lc_disc_tab'; // aba do Descobrir pedida a partir do mural (lida quando o Descobrir abre)
export const takeDiscoverTab = () => { try { const t = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); return t; } catch { return null; } };
// active: 'lfg' ou a aba do Descobrir; onDiscover(k): troca de aba quando já está no Descobrir
export function gamesTabs(active, onDiscover) {
  const pick = (k) => {
    if (k === active) return;
    track('games_tab', k);
    if (k === 'lfg') { location.hash = '#/@me/lfg'; return; }
    if (active !== 'lfg' && onDiscover) return onDiscover(k);
    try { localStorage.setItem(PENDING, k); } catch { }
    location.hash = '#/@me/discover';
  };
  return [h('span.hash', icon('gamepad', 24)), h('span.gtitle', 'Jogos'),
    h('div.dtabs.gtabs', { role: 'tablist' }, GAME_TABS.map(([k, l, ic]) => h('button.dtab' + (active === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(active === k), onclick: () => pick(k) }, icon(ic, 16), h('span', l))))];
}
