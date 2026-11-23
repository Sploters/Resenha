// Abas do topo da tela inicial (botão principal da barra): Amigos | Jogar | Descobrir. A lista ao lado fica só com as
// conversas; as áreas de Jogos não ocupam a barra nem a lista. Jogar = Procurar jogadores e Radar; Descobrir = Para você,
// Conquistas, Notícias e Torneios. "Procurar jogadores" é o mural (lfg.js), "Conquistas" é achievements.js, "Radar" é
// radar.js; Para você, Notícias e Torneios são o Descobrir (discover.js). Cada módulo desenha a própria barra de cima com
// estas abas (gamesTabs); a tela de Amigos usa as de cima (homeTabs).
import { h, icon } from './util.js';
import { track } from './ux.js';

export const GAME_TABS = [['lfg', 'Procurar jogadores', 'gamepad'], ['radar', 'Radar', 'radar'], ['home', 'Para você', 'compass'], ['trophies', 'Conquistas', 'medal'], ['news', 'Notícias', 'news'], ['tournaments', 'Torneios', 'trophy']];
export const GROUPS = { play: ['lfg', 'radar'], discover: ['home', 'trophies', 'news', 'tournaments'] };
const groupOf = (k) => (GROUPS.play.includes(k) ? 'play' : 'discover');
const OWN = new Set(['lfg', 'trophies', 'radar']); // têm rota própria; as outras são abas do Descobrir
const PENDING = 'lc_disc_tab'; // aba do Descobrir pedida de fora dele (lida quando o Descobrir abre)
const LAST = { play: 'lc_tab_play', discover: 'lc_tab_disc' }; // última área aberta em cada aba de cima
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
export const takeDiscoverTab = () => { try { const t = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); return t; } catch { return null; } };
const cur = { active: null, onDiscover: null }; // área aberta agora

// abre uma área de Jogos de qualquer tela
export function openGameTab(k) {
  const { active, onDiscover } = cur;
  if (k === active && location.hash.startsWith('#/@me/')) return;
  track('games_tab', k); ls.set(LAST[groupOf(k)], k);
  if (OWN.has(k)) { location.hash = '#/@me/' + k; return; }
  if (active && !OWN.has(active) && onDiscover && location.hash === '#/@me/discover') return onDiscover(k);
  ls.set(PENDING, k);
  location.hash = '#/@me/discover';
}
const openGroup = (g) => { const last = ls.get(LAST[g]); openGameTab(GROUPS[g].includes(last) ? last : GROUPS[g][0]); };

// abas de cima: main = 'friends' | 'play' | 'discover'
export function topTabs(main, goFriends) {
  const t = (k, label, ic, fn) => h('button.mtab' + (main === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(main === k), onclick: () => { if (main === k) { if (k === 'friends') fn(); return; } track('home_tab', k); if (main === 'friends') track('games_open'); fn(); } }, icon(ic, 18), h('span', label));
  return h('div.mtabs', { role: 'tablist' },
    t('friends', 'Amigos', 'users', goFriends || (() => { location.hash = '#/@me'; })),
    t('play', 'Jogar', 'gamepad', () => openGroup('play')),
    t('discover', 'Descobrir', 'compass', () => openGroup('discover')));
}
// barra de cima das telas de Jogos: as abas principais e, ao lado, as áreas da aba aberta
// active: a área aberta; onDiscover(k): troca de aba quando já está no Descobrir
export function gamesTabs(active, onDiscover) {
  Object.assign(cur, { active, onDiscover });
  const g = groupOf(active);
  return [topTabs(g), h('div.mtab-sep'),
    h('div.dtabs.gtabs', { role: 'tablist' }, GROUPS[g].map(k => GAME_TABS.find(t => t[0] === k)).map(([k, l, i]) => h('button.dtab' + (active === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(active === k), onclick: () => openGameTab(k) }, icon(i, 16), h('span', l))))];
}
