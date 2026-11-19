// Versões do app desktop na chamada: selo de "desatualizado" e avisos.
import { h, icon } from './util.js';
import { S, nameOf, toast, modal } from './state.js';
import { installAppUpdate, myDesktopVersion, isOlder } from './appupdate.js';
import { voice } from './gateway.js';
// =============== Versões do app desktop na call ===============
// referência: a versão mais nova publicada (ou a minha, se for mais nova que a que o servidor conhece)
const refVersion = () => { const mine = myDesktopVersion(), l = S.desktopLatest; return isOlder(l, mine) ? mine : l || mine; };
const appOutdated = (v) => !!v?.app && isOlder(v.app, refVersion());
// selinho ao lado do nome de quem está com o app desatualizado (na lista da sala e no quadro da call)
export const appBadge = (v) => appOutdated(v) ? h('span.appold', { title: `App desktop ${v.app} — desatualizado (a mais nova é ${refVersion()}). Se a tela ou a voz dessa pessoa não aparecer para você, peça para atualizar.` }, icon('dl', 12), v.app) : null;
const warnedApp = new Set();
export function warnOutdated(v) {
  if (v.user_id === S.me?.id || !appOutdated(v) || warnedApp.has(v.user_id + v.app)) return;
  warnedApp.add(v.user_id + v.app);
  toast(`${nameOf(v.user_id, S.view.gid) || 'Alguém'} está com o app numa versão antiga (${v.app}). Se a tela dele não aparecer, peça para atualizar.`);
}
// avisa de todos na minha sala (a versão mais nova pode chegar depois de as pessoas entrarem)
export const scanOutdated = () => { if (voice?.channelId) for (const v of S.voice.values()) if (v.channel_id === voice.channelId) warnOutdated(v); };
export function outdatedModal(d) {
  modal('Atualize o app para entrar na call', d.reason, h('div'), [
    { label: 'Agora não', cls: 'link' },
    { label: 'Atualizar agora', cls: 'green', fn: () => { toast('Baixando a atualização…'); installAppUpdate(); } }]);
}
