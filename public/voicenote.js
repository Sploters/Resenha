// Aviso pequeno em cima do botão do microfone (barra do usuário), para o que acontece com o SEU microfone na chamada:
//   mutedtalk  você está falando com o mudo ligado (public/micwatch.js talkMutedStep): "Você está mutado" + Desmutar
//   micfix     a captura caiu (dispositivo reiniciado/desconectado, filtro travou) e o vigia está religando
//   micok      religou e o som voltou
//   micdead    o vigia desistiu (várias tentativas sem som): Tentar de novo / Verificar problemas
// Um aviso por vez; o mais grave não é trocado por um mais leve. voice.js chama voiceNote (import sob demanda).
import { h, icon } from './util.js';
import { nameOf } from './state.js';
import { hotkey, comboLabel } from './ui.js';
import { openVoiceHelp } from './voicehelp.js';

const RANK = { micok: 0, mutedtalk: 1, micfix: 2, micdead: 3 };
let cur = null; // { kind, el, until, iv }

const close = () => { if (!cur) return; clearInterval(cur.iv); const el = cur.el; cur = null; el.removeAttribute('id'); el.classList.add('out'); setTimeout(() => el.remove(), 160); };
// em cima do botão do microfone (centralizado nele, sem sair da tela); sem a barra (tela cheia, palco): canto de baixo
function place(el) {
  const b = document.querySelector('.pb-mic'), r = b?.getBoundingClientRect();
  if (!r || !r.width) { el.style.left = '16px'; el.style.bottom = '16px'; el.style.removeProperty('--vn-arrow'); el.classList.add('free'); return; }
  el.classList.remove('free');
  const w = el.offsetWidth || 300, x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  el.style.left = x + 'px'; el.style.bottom = (innerHeight - r.top + 10) + 'px';
  el.style.setProperty('--vn-arrow', (r.left + r.width / 2 - x) + 'px');
}

export function voiceNote(voice, kind) {
  if (kind === 'close') { close(); document.querySelectorAll('.vnote').forEach(e => e.remove()); return; }
  if (!voice?.channelId || !(kind in RANK)) return;
  if (cur && cur.el.isConnected && RANK[cur.kind] > RANK[kind] && kind !== 'micok') return; // não esconde um aviso mais grave
  if (kind === 'micok' && cur && cur.kind !== 'micfix' && cur.el.isConnected) return;
  if (cur) { clearInterval(cur.iv); cur.el.remove(); cur = null; }
  const done = (fn) => () => { close(); fn?.(); };
  const key = hotkey('keyMute');
  const C = {
    mutedtalk: { ic: 'micoff', t: 'Você está mutado', d: 'Ninguém está ouvindo você.' + (key ? ` Atalho: ${comboLabel(key).replace(/ \+ /g, '+')}` : ''), ms: 7000,
      btns: [h('button.btn.green', { type: 'button', onclick: done(() => { if (voice.muted) voice.toggleMute(); }) }, 'Desmutar')] },
    micfix: { spin: true, t: 'Seu microfone parou de responder', d: 'Religando sem sair da sala…', ms: 20000 },
    micok: { ic: 'mic', t: 'Microfone de volta', d: 'Ele parou por um instante e voltou sozinho.', ms: 4500 },
    micdead: { ic: 'warn', t: 'Seu microfone não está mandando som', d: 'Tentamos religar e não voltou. Veja se ele está conectado e se outro programa não pegou o microfone.', ms: 60000,
      btns: [h('button.btn.green', { type: 'button', onclick: done(() => voice.rebuildMic()) }, 'Tentar de novo'),
        h('button.btn.grey', { type: 'button', onclick: done(() => openVoiceHelp(voice, { nameOf })) }, 'Verificar problemas')] },
  }[kind];
  const el = h('div#vnote.vnote.' + kind, { role: kind === 'mutedtalk' ? 'status' : 'alert', 'aria-live': 'polite' },
    C.spin ? h('span.vn-spin', { 'aria-hidden': 'true' }) : h('span.vn-ic', icon(C.ic, 20)),
    h('div.vn-t', h('b', C.t), h('small', C.d), C.btns && h('div.vn-b', C.btns)),
    h('button.vn-x', { type: 'button', title: 'Fechar', 'aria-label': 'Fechar', onclick: close }, icon('x', 14)));
  document.body.append(el); place(el);
  const me = cur = { kind, el, until: performance.now() + C.ms };
  // some sozinho: no tempo, ao sair da sala ou quando já não vale (desmutou; o microfone voltou durante "religando")
  me.iv = setInterval(() => {
    if (cur !== me) return clearInterval(me.iv);
    if (performance.now() > me.until || !voice.channelId || (kind === 'mutedtalk' && !voice.muted)) return close();
    place(el);
  }, 400);
}
