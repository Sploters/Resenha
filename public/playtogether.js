// "Jogar juntos" (botão no topo da conversa direta): o que dá para jogar com essa pessoa, sem sair da conversa.
// - Jogos em comum: os seus (jogando agora, jogados nos últimos dias, biblioteca) cruzados com o que a pessoa já mostra
//   para você (jogo aberto agora e perfil de jogador). Só usa o que você já poderia ver: nada de biblioteca alheia.
// - Chamar para a sala (convite com toque; precisa estar numa sala de voz de servidor), "A fim de jogar" e anúncio.
// - Anúncios abertos dela, com Entrar.
import { h, icon } from './util.js';
import { S, api, modal, user } from './state.js';
import { activityOf, gameTitle } from './activity.js';
import { canCallInvite, sendCallInvite } from './callinvite.js';
import { openIntentModal } from './intents.js';
import { openLfgCreate, openPosts, lfgMini, ensureLfgPosts } from './lfg.js';
import { track } from './ux.js';

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

export async function openPlayTogether(uid) {
  track('play_together', 'open');
  const u = S.users.get(uid) || user(uid), body = h('div.pt', h('p.pt-load', 'Procurando o que vocês jogam…'));
  const m = modal('Jogar juntos', `Com ${u.display_name}`, body, [{ label: 'Fechar', cls: 'grey' }], { width: '520px' });
  const [games, myProf, prof] = await Promise.all([api('GET', '/intents/games').catch(() => []), api('GET', '/lfg/profile/@me').catch(() => []), api('GET', `/lfg/profile/${uid}`).catch(() => []), ensureLfgPosts()]);
  // meus jogos: os que o Resenha conhece de mim (fora o catálogo, igual para todos) e os do meu perfil de jogador
  const lfgName = (id) => games?.find(g => g.lfg === id)?.name || id;
  const mine = [...(games || []).filter(g => g.source !== 'catalog'), ...(myProf || []).map(p => ({ name: lfgName(p.game), lfg: p.game, source: 'profile' }))];
  if (!body.isConnected) return;
  const now = activityOf(uid), theirs = new Map();
  if (now) theirs.set(norm(gameTitle(now)), { name: gameTitle(now), playing: true });
  for (const p of prof || []) if (p?.game) theirs.set(norm(lfgName(p.game)), { name: lfgName(p.game), lfg: p.game, rank: p.rank });
  const ownedLfg = new Set((prof || []).map(p => p.game));
  // em comum: do que ela mostra, o que também está entre os seus (fora o catálogo, que é igual para todo mundo)
  const seen = new Set(), common = mine.filter(g => (theirs.has(norm(g.name)) || (g.lfg && ownedLfg.has(g.lfg))) && !seen.has(g.lfg || norm(g.name)) && seen.add(g.lfg || norm(g.name)))
    .map(g => ({ ...g, ...(theirs.get(norm(g.name)) || {}), name: g.name, lfg: g.lfg || theirs.get(norm(g.name))?.lfg }));
  let pick = common[0] || (now ? { name: gameTitle(now) } : null);
  const ads = openPosts().filter(p => p.author.id === uid);
  const draw = () => {
    const inCall = canCallInvite(uid);
    body.replaceChildren(
      now && h('div.pt-now', icon('gamepad', 16), h('span', h('b', u.display_name), ' está jogando ', h('b', gameTitle(now)), ' agora')),
      h('div.pt-cap', 'Jogos em comum'),
      common.length ? h('div.lfgchips.pick.pt-games', common.map(g => h('button.lchip' + (pick?.name === g.name ? '.on' : ''), { type: 'button', onclick: () => { pick = g; draw(); } }, g.playing ? icon('live', 12) : h('i'), g.name)))
        : h('p.pt-hint', `Nenhum jogo em comum à vista. Aparecem aqui os jogos que você joga e que ${u.display_name} está jogando ou pôs no perfil de jogador.`),
      h('div.pt-acts',
        h('button.btn.green', { type: 'button', disabled: !inCall, title: inCall ? 'Ela recebe um aviso com toque; aceitar entra na sua sala' : 'Entre numa sala de voz de um servidor para chamar', onclick: async () => { track('play_together', 'invite'); if (await sendCallInvite(uid, { activity: 'play', game: pick?.name || undefined })) m.close(); } },
          icon('voice', 16), h('span', pick ? `Chamar para jogar ${pick.name}` : 'Chamar para a sala')),
        h('button.btn.grey', { type: 'button', title: 'Avisa quem tem o jogo (inclusive essa pessoa) que você está a fim de jogar', onclick: () => { track('play_together', 'intent'); m.close(); openIntentModal(pick ? { game: { name: pick.name, appid: pick.appid, lfg: pick.lfg } } : {}); } }, icon('gamepad', 16), h('span', 'A fim de jogar')),
        h('button.btn.grey', { type: 'button', title: 'Monta um grupo em Procurar jogadores', onclick: () => { track('play_together', 'ad'); m.close(); openLfgCreate(pick?.lfg ? { game: pick.lfg } : undefined); } }, icon('plus', 16), h('span', 'Criar anúncio'))),
      !inCall && h('p.pt-hint', 'Para chamar direto, entre numa sala de voz de um servidor.'),
      ads.length > 0 && h('div.pt-ads', { onclick: (e) => { if (!e.target.closest('button')) m.close(); } }, h('div.pt-cap', `Grupos de ${u.display_name} procurando gente`), ...ads.map(lfgMini)));
  };
  draw();
}
export const playTogetherBtn = (peer) => h('button.btn.sm.pt-btn', { type: 'button', title: 'Jogos em comum, chamar para jogar e anúncios', onclick: () => openPlayTogether(peer.id) }, icon('gamepad', 16), h('span', 'Jogar juntos'));
