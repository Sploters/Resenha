// Chamada recebida, jogo aberto no PC (atividade "Jogando"), migrações de preferências e atalhos globais do app desktop.
import { h, avatar } from './util.js';
import { S, user, notify, desktop, savePrefs, alertAllowed } from './state.js';
import { playSound } from './sounds.js';
import { handleKey as sbKey, syncSoundKeys, playSoundById } from './soundboard.js';
import { gameChanged, liteAutoOn } from './lite.js';
import { setupPtt } from './ptt.js';
import { comboFromEvent, comboToAccel, hotkey, desktopHotkeys } from './ui.js';
import { ws, voice, gwSend } from './gateway.js';
import { attention } from './unread.js';
import { go } from './nav.js';
import { fxHotkey, joinVoice, voiceToggle } from './userbar.js';
import { clipHotkey } from './stage.js';
import { shareKey, shareHotkey, offerGameShare } from './share.js';
export function incomingCall(dm, uid) {
  if (!alertAllowed('dm')) return; // não perturbe: sem toque (o cartão da chamada continua na conversa)
  const u = user(uid); document.getElementById('call-banner')?.remove();
  let n = 0; const t = setInterval(() => { if (!document.getElementById('call-banner') || ++n > 6) return clearInterval(t); playSound('ring'); }, 2600);
  const el = h('div#call-banner', avatar(u, 48, { status: false }), h('div', { style: { flex: 1 } }, h('b', u.display_name), h('div', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'está te ligando…')),
    h('button.btn.green', { onclick: () => { el.remove(); go('@me', dm.id); joinVoice(dm.id); } }, 'Atender'), h('button.btn.red', { onclick: () => el.remove() }, 'Recusar'));
  document.body.append(el); playSound('ring');
  notify(`${u.display_name} está te ligando`, 'Chamada de voz', () => { go('@me', dm.id); }); attention(`${u.display_name} está ligando`);
  setTimeout(() => el.remove(), 30000);
}

// ---------- jogo aberto no PC -> atividade "Jogando X" (app desktop) ----------
// usa a mesma detecção da transmissão (pasta de loja/jogos, executável conhecido, janela em tela cheia). Repete a cada 20 s
// enquanto há jogo (o servidor esquece em 90 s sem notícia: app fechado/travado não deixa "Jogando" preso). O app avisa
// na hora quando um jogo abre ou fecha (onGameChanged: eventos do Windows), sem esperar os 20 s.
export let gameTimer = null, sentGame, gameTick = null; // undefined = nada enviado nesta conexão
export function startGameDetect() {
  sentGame = undefined; // (re)conectou: manda o estado de novo
  if (!desktop?.detectGame || gameTimer) return;
  const tick = gameTick = async () => {
    const share = ws?.readyState === 1; // em "Ninguém" também: o servidor só mostra para a própria pessoa, mas as horas em call contam na semana
    if (!share && !liteAutoOn() && !voice?.active) return;
    const g = await desktop.detectGame().catch(() => null), id = g?.id || null;
    gameChanged(g, voice); // modo leve automático enquanto o jogo está aberto (lite.js)
    offerGameShare(g); // na chamada e sem transmitir: "Jogando X? Transmitir" 
    if (!share) return;
    // o ícone (PNG ~10 KB) só vai quando o jogo muda ou a conexão é nova; nas outras vezes o servidor usa o que já tem
    if (g || sentGame !== null) gwSend('ACTIVITY_LOCAL', { game: g ? { id: g.id, title: g.title, steam: g.steam || null, ...(id !== sentGame && g.icon ? { icon: g.icon } : {}) } : null });
    sentGame = id;
  };
  setTimeout(tick, 3000); gameTimer = setInterval(tick, 20000);
  desktop.onGameChanged?.(() => gameTick?.());
}

// ---------- atalhos / desktop ----------
// clipe: o atalho padrão passou de Ctrl+Alt+C para F8 (tecla única, dá para apertar no meio do jogo). Quem estava no
// padrão antigo muda junto; quem escolheu outro atalho fica com o seu.
// qualidade da voz: automático passa a valer para todos (uma vez; depois cada um pode escolher outra de novo)
function migrateAbrAuto() {
  if (S.prefs.abrAutoV === 1) return;
  S.prefs.voiceBitrate = 'auto'; S.prefs.abrAutoV = 1; savePrefs(); voice?.active && voice.retuneAudio();
}
export function migrateClipKey() {
  migrateAbrAuto(); migrateAgc();
  if (S.prefs.keyClipV === 2) return;
  if (!S.prefs.keyClip || S.prefs.keyClip === 'Ctrl+Alt+KeyC') S.prefs.keyClip = 'F8';
  S.prefs.keyClipV = 2; savePrefs();
  desktop?.setSettings?.({ hotkeyClip: comboToAccel(hotkey('keyClip')) });
}
// ganho automático do navegador: agora desligado por padrão. Ele aumentava o microfone nas pausas (o ruído e a voz de
// quem está ao fundo subiam junto) e confundia a proteção por voz. Desliga uma vez para todos; depois vale a escolha.
function migrateAgc() {
  if (S.prefs.agcV === 2) return;
  S.prefs.agc = false; S.prefs.agcV = 2; savePrefs();
  if (voice?.active) voice.rebuildMic?.();
}
export function setupDesktop() {
  if (setupDesktop.done) return; setupDesktop.done = true;
  const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable;
  addEventListener('keydown', (e) => {
    if (!(typing(e.target) && !e.ctrlKey && !e.altKey) && sbKey(e, voice)) return;
    const c = comboFromEvent(e);
    if (c && c === hotkey('keyMute')) { e.preventDefault(); voiceToggle('mute'); }
    if (c && c === hotkey('keyDeafen')) { e.preventDefault(); voiceToggle('deaf'); }
    if (c && c === hotkey('keyClip')) { e.preventDefault(); clipHotkey(); }
    if (c && c === hotkey('keyFx')) { e.preventDefault(); fxHotkey(); }
    if (c && c === shareKey() && !e.repeat) { e.preventDefault(); shareHotkey(); }
  });
  setupPtt(() => voice);
  desktop?.setSettings?.(desktopHotkeys());
  // soundboard no Windows: atalhos registrados só enquanto está numa chamada (confere a cada 2 s; só reenvia se mudar)
  setInterval(() => syncSoundKeys(voice), 2000); document.addEventListener('sb-changed', () => syncSoundKeys(voice));
  desktop?.onHotkey?.((k) => { if (typeof k === 'string' && k.startsWith('sb:')) return playSoundById(k.slice(3), voice); if (k === 'mute') voiceToggle('mute'); if (k === 'deafen') voiceToggle('deaf'); if (k === 'clip') clipHotkey(); if (k === 'share') shareHotkey(); });
}
