// Push-to-talk: tecla do teclado (e.code) ou botão do mouse (Mouse3 = meio, Mouse4/Mouse5 = laterais).
// Na página, funciona com a janela em foco. No app desktop para Windows, o programa nativo lc-input também avisa
// quando a tecla desce/sobe com o jogo em foco (PTT global). Ele só fica ligado enquanto você está numa chamada em
// modo push-to-talk, e só reporta a tecla escolhida — nenhuma outra tecla sai do programa.
import { S, desktop } from './state.js';

let voiceRef = null, sent = null, status = null;

export const MOUSE_PTT = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }; // MouseEvent.button -> código
export const globalPttSupported = () => !!desktop?.pttSet;
// null = ainda não sabe; { ok, reason?, global } = resposta do app desktop
export const globalPttStatus = () => status;
const globalOn = () => !!sent && !!status?.ok && !!status?.global;

// chamada a cada atualização da voz e quando o modo/tecla mudam; só fala com o app quando algo muda
export function syncGlobalPtt(voice) {
  if (voice) voiceRef = voice;
  if (!desktop?.pttSet) return;
  const want = voiceRef?.active && S.prefs.inputMode === 'ptt' ? (S.prefs.pttKey || null) : null;
  if (want === sent) return;
  sent = want;
  desktop.pttSet(want).then((r) => { if (sent === want) status = r || null; }).catch(() => { status = { ok: false }; });
}

export function setupPtt(getVoice) {
  const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable;
  const isPtt = () => S.prefs.inputMode === 'ptt';
  addEventListener('keydown', (e) => {
    // letra/número/espaço digitados num campo de texto não abrem o microfone
    if (isPtt() && e.code === S.prefs.pttKey && !e.repeat && (!typing(e.target) || !/^(Key|Digit|Space|Numpad)/.test(e.code))) getVoice()?.setPtt(true);
  });
  addEventListener('keyup', (e) => { if (e.code === S.prefs.pttKey) getVoice()?.setPtt(false); });
  addEventListener('mousedown', (e) => { if (isPtt() && MOUSE_PTT[e.button] === S.prefs.pttKey) { e.preventDefault(); getVoice()?.setPtt(true); } }, true);
  addEventListener('mouseup', (e) => { if (MOUSE_PTT[e.button] === S.prefs.pttKey) { e.preventDefault(); getVoice()?.setPtt(false); } }, true);
  // botões laterais do mouse são "voltar/avançar" no Chromium: não navegam quando são o PTT
  addEventListener('auxclick', (e) => { if (MOUSE_PTT[e.button] === S.prefs.pttKey && e.button !== 1) e.preventDefault(); }, true);
  // perder o foco soltava o PTT (a página não vê o keyup lá fora); com o PTT global o app desktop avisa a soltura
  addEventListener('blur', () => { if (!globalOn()) getVoice()?.setPtt(false); });
  desktop?.onPtt?.((down) => {
    if (!sent) return;
    // em foco, a página já cuida da tecla (e respeita a digitação no chat); o botão do mouse vale sempre
    if (down && document.hasFocus() && !/^Mouse/.test(sent)) return;
    getVoice()?.setPtt(down);
  });
}
