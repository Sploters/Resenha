// Bot de música na sala de voz: linha na lista da sala, quadro no palco e menu (não é uma pessoa: sem perfil nem amizade).
import { h, icon, avatar } from './util.js';
import { S, user, toast, menu } from './state.js';
import { openMusic, musicState, musicCmd } from './music.js';
import { volumeControl } from './quick.js';
import { voice } from './gateway.js';
// ---------- bot de música (não é uma pessoa: sem perfil, amizade, cargos, banir...) ----------
export const musicOn = () => !!(musicState()?.active && musicState()?.current && !musicState()?.paused); // bot tocando nesta sala: botão aceso
const botPlaying = (uid) => { const m = musicState(); return m?.active && m.bot_id === uid && m.current ? m : null; };
export function openBot(anchor, uid) {
  const v = S.voice.get(uid);
  if (!v) return;
  if (voice?.channelId !== v.channel_id) return toast('Entre na sala de voz para controlar a música');
  openMusic(anchor, voice);
}
export function botMenu(e, uid) {
  const v = S.voice.get(uid), here = v && voice?.channelId === v.channel_id;
  const m = botPlaying(uid), run = (op) => musicCmd(op).catch(err => toast(err.message, true));
  menu(e, [
    // controles rápidos: no 1º teste o clique direito no bot (cartão, nome, música tocando) era aberto e fechado sem uso
    here && m && { ux: 'pausar', icon: m.paused ? 'play' : 'pause', label: m.paused ? 'Continuar' : 'Pausar', fn: () => run(m.paused ? 'resume' : 'pause') },
    here && m && { ux: 'pular', icon: 'skip', label: 'Pular música', fn: () => run('skip') },
    { ux: 'painel', label: 'Abrir o painel de música', fn: () => openBot(e.target, uid) },
    here && voice.peers.has(uid) && { node: volumeControl(voice, uid, 'mic', 'Volume da música (só para você)') },
    here && '-',
    here && { label: 'Tirar o bot da sala', danger: true, fn: () => musicCmd('disconnect').catch(err => toast(err.message, true)) },
  ]);
}
const eqBars = (on) => h('span.boteq' + (on ? '.on' : ''), { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
export function botRow(v) {
  const m = botPlaying(v.user_id), b = v.bot || {};
  return h('div.vuser.vbot', { 'data-uid': v.user_id, title: m ? `${m.current.title}${m.current.artist ? ' — ' + m.current.artist : ''}` : 'Bot de música', onclick: (e) => openBot(e.currentTarget, v.user_id), oncontextmenu: (e) => botMenu(e, v.user_id) },
    avatar(user(v.user_id), 24),
    h('span.nm', h('span.botnm', b.name || 'Música'), h('span.bottag', 'BOT'), m && h('small.botnow', m.current.title)),
    eqBars(m && !m.paused));
}
export function botTile(v, gid) {
  const uid = v.user_id, m = botPlaying(uid), c = m?.current, b = v.bot || {};
  return h('div.tile.bottile' + (m && !m.paused ? '.playing' : ''), { 'data-uid': uid, 'data-key': 'c:' + uid, onclick: (e) => openBot(e.currentTarget.querySelector('.botcard') || e.currentTarget, uid), oncontextmenu: (e) => botMenu(e, uid) },
    c?.thumb && h('div.botbg', { style: { backgroundImage: `url("${String(c.thumb).replace(/["\\\n]/g, encodeURIComponent)}")` } }),
    h('div.botcard',
      c?.thumb ? h('img.botart', { src: c.thumb, alt: '', referrerPolicy: 'no-referrer' }) : h('div.botart.ph', icon('musicbot', 40)),
      h('div.botinfo', h('b', c ? c.title : 'Nada tocando'), h('small', c ? (m.paused ? 'Pausado' : c.artist || 'Tocando agora') : 'Clique para escolher uma música'))),
    h('div.label', eqBars(m && !m.paused), h('span', b.name || 'Música'), h('span.bottag', 'BOT')));
}
