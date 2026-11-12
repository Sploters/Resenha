// Avaliação depois de uma chamada: um cartãozinho no canto ("Teve algum problema na chamada?"). Quem teve problema diz o
// motivo em um toque; quem não teve quase sempre só fecha (por isso o painel mede "problema relatado / perguntadas").
// Para não incomodar: só depois de chamada com outra pessoa e de pelo menos 30 s, em ~5% das chamadas, no máximo uma vez
// por semana por aparelho, nunca com as estatísticas desligadas. Não rouba o foco, não bloqueia nada e some sozinho em 15 s.
// Conta (public/ux.js): call_rating shown/good/bad/ignored, call_issue <motivo> e call_rating_q <resposta>:<nota da rede>
// (a nota que public/callqual.js mediu na mesma chamada: separa problema de rede de problema no aparelho ou no app).
import { h, icon } from './util.js';
import { S } from './state.js';
import { track, uxOn } from './ux.js';

const RATE = 0.05, WEEK = 7 * 86400e3, KEY = 'lc_callrate_at';
export const ISSUES = [['audio_cut', 'Áudio cortando'], ['echo', 'Eco ou chiado'], ['lag', 'Atraso'], ['video', 'Vídeo ou tela travando'], ['cant_hear', 'Não ouvia as pessoas'], ['not_heard', 'Não me ouviam'], ['other', 'Outro']];
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { } };

// deve perguntar? (lc_callrate_force=1 no localStorage força, para testar)
export function shouldAsk({ ms, others }) {
  if (!uxOn() || ms < 30e3 || others < 1) return false;
  if (get('lc_callrate_force') === '1') return true;
  if (Date.now() - (+get(KEY) || 0) < WEEK) return false;
  return Math.random() < RATE;
}

export function showCallRating(grade = null) {
  document.getElementById('callrate')?.remove();
  set(KEY, String(Date.now()));
  track('call_rating', 'shown');
  let answered = false, timer = 0;
  const cross = (ans) => { if (/^(good|fair|poor)$/.test(grade || '')) track('call_rating_q', ans + ':' + grade, { bg: true }); };
  const close = (why) => { clearTimeout(timer); if (!answered && why === 'ignored') { track('call_rating', 'ignored'); cross('ignored'); } box.classList.add('leaving'); setTimeout(() => box.remove(), 180); };
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => close('ignored'), ms); };
  const thanks = () => { box.replaceChildren(h('div.cr-row', icon('check', 18), h('b', 'Obrigado!'))); setTimeout(() => close('done'), 1500); };
  const reasons = () => {
    arm(20e3);
    box.replaceChildren(h('div.cr-head', h('b', 'O que deu errado?'), h('button.cr-x', { type: 'button', 'aria-label': 'Fechar', onclick: () => close('done') }, icon('x', 16))),
      h('div.cr-chips', ISSUES.map(([k, l]) => h('button.cr-chip', { type: 'button', onclick: () => { track('call_issue', k); thanks(); } }, l))));
  };
  const pick = (good) => { answered = true; track('call_rating', good ? 'good' : 'bad'); cross(good ? 'good' : 'bad'); good ? thanks() : reasons(); };
  const box = h('div#callrate', { role: 'dialog', 'aria-label': 'Avaliar a chamada', onmouseenter: () => clearTimeout(timer), onmouseleave: () => !answered && arm(8e3) },
    h('div.cr-head', h('b', 'Teve algum problema na chamada?'), h('button.cr-x', { type: 'button', 'aria-label': 'Fechar', onclick: () => close('ignored') }, icon('x', 16))),
    h('div.cr-row',
      h('button.cr-btn.bad', { type: 'button', onclick: () => pick(false) }, '👎', h('span', 'Tive problema')),
      h('button.cr-btn', { type: 'button', onclick: () => pick(true) }, '👍', h('span', 'Foi tudo bem'))),
    h('small.cr-hint', 'Sem problema? Pode só fechar.'));
  document.body.append(box); arm(15e3);
  return box;
}

// liga no app: quando a chamada acaba (voice.js dispara 'call-ended'), conta quem mais estava na sala e decide
export function initCallRating() {
  document.addEventListener('call-ended', (e) => {
    const { channelId, ms, silent, quality } = e.detail || {}; if (silent) return; // troca de sala/reconexão não conta
    const others = [...(S.voice?.values() || [])].filter(v => v.channel_id === channelId && v.user_id !== S.me?.id).length;
    if (shouldAsk({ ms, others })) setTimeout(() => showCallRating(quality?.grade), 800); // depois do som de saída
  });
}
