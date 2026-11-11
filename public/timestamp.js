// Inserir horário: escolhe data/hora e formato e coloca <t:SEGUNDOS:FORMATO> no campo de mensagem.
// Quem lê vê no próprio fuso e no próprio formato de hora (12/24h); o relativo ("em 2 horas") anda sozinho.
import { h, TS_FORMATS, tsText } from './util.js';
import { modal } from './state.js';

const pad = (n) => String(n).padStart(2, '0');
const localValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
let lastFmt = 'R';

export function timestampModal(ta) {
  const start = new Date(); start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0); // próxima meia hora
  const when = h('input', { type: 'datetime-local', value: localValue(start) });
  const code = h('code.ts-code');
  const list = h('div.ts-fmts');
  let fmt = lastFmt;
  const sec = () => { const t = new Date(when.value).getTime(); return isFinite(t) ? Math.floor(t / 1000) : null; };
  const draw = () => {
    const s = sec();
    list.replaceChildren(...TS_FORMATS.map(([f, label]) => h('button.ts-fmt' + (f === fmt ? '.on' : ''), { type: 'button', onclick: () => { fmt = f; draw(); } },
      h('small', label), h('b', s == null ? '—' : tsText(s, f)))));
    code.textContent = s == null ? '' : `<t:${s}:${fmt}>`;
  };
  when.addEventListener('input', draw);
  const quick = h('div.ts-quick', [['Agora', 0], ['+1 h', 60], ['Hoje 21h', 'h21'], ['Amanhã 20h', 'a20']].map(([l, v]) => h('button.btn.grey.sm', { type: 'button', onclick: () => {
    const d = new Date();
    if (v === 'h21') d.setHours(21, 0, 0, 0); else if (v === 'a20') { d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0); } else d.setMinutes(d.getMinutes() + v, 0, 0);
    when.value = localValue(d); draw();
  } }, l)));
  draw();
  const insert = () => {
    const s = sec(); if (s == null) return false;
    lastFmt = fmt;
    const txt = `<t:${s}:${fmt}>`, pre = ta.value.slice(0, ta.selectionStart);
    ta.setRangeText((pre && !/\s$/.test(pre) ? ' ' : '') + txt + ' ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input')); ta.focus();
  };
  modal('Inserir horário', 'Cada pessoa vê este horário no próprio fuso e formato de hora.', h('div.ts-modal',
    h('label.f', 'Data e hora (no seu horário)', when), quick,
    h('label.f', 'Como aparece'), list,
    h('div.ts-foot', 'Vai no texto como ', code)),
  [{ label: 'Cancelar', cls: 'link' }, { label: 'Inserir', fn: insert }], { width: '460px' });
}
