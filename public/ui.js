// Componentes de interface compartilhados (app + configurações)
import { h, icon } from './util.js';
import { SCREEN_PRESETS, NOISE_MODES } from './voice.js';
import { S } from './state.js';
import { track } from './ux.js';

export const seg = (opts, val, on) => { // opts: objeto ou lista de [valor, rótulo] (para manter a ordem com chaves numéricas)
  const box = h('div.seg'); let cur = val;
  // clicar na opção que já está marcada não faz nada (antes salvava e redesenhava tudo de novo: a tela piscava)
  const draw = (v) => { cur = v; box.replaceChildren(...(Array.isArray(opts) ? opts : Object.entries(opts)).map(([k, l]) => h('button' + (String(k) === String(v) ? '.on' : ''), { onclick: () => { if (String(k) === String(cur)) return; on(isNaN(+k) ? k : +k); draw(k); } }, l))); };
  draw(val); return box;
};
export const toggle = (on, fn) => { const s = h('div.switch' + (on ? '.on' : ''), { role: 'switch', tabIndex: 0, onclick: () => { on = !on; s.classList.toggle('on', on); fn(on); }, onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); s.click(); } } }); return s; };
// "Página › opção" de uma ⓘ: o título ao lado dela e, nas Configurações, o título da página (sem o texto da explicação)
const textOf = (el, skip) => [...(el?.childNodes || [])].filter(n => n !== skip && !n.classList?.contains('itip')).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
function tipKey(b) {
  const label = textOf(b.parentElement, b), pageEl = b.closest('.pane')?.querySelector('h2'), page = pageEl && !pageEl.contains(b) ? textOf(pageEl) : '';
  return (page ? page + ' › ' : '') + (label || '?');
}
// explicação atrás de um ⓘ: aparece ao passar o mouse, focar com o teclado ou tocar (no celular)
export const infoTip = (content) => {
  const b = h('button.itip', { type: 'button', 'aria-label': 'Mais informações', onclick: (e) => { e.preventDefault(); e.stopPropagation(); if (b.classList.toggle('open')) seen(); place(); } }, icon('info', 16), h('span.itip-pop', { role: 'tooltip' }, content));
  const place = () => { const r = b.getBoundingClientRect(); b.classList.toggle('left', r.left > innerWidth - 300); b.classList.toggle('up', r.bottom > innerHeight - 160); };
  // telemetria: explicação lida (clique, ou o mouse parado em cima por 0,7 s) conta uma vez por abertura do app
  let dwell = 0; const seen = () => { clearTimeout(dwell); track('info_tip', tipKey(b), { once: true }); };
  b.addEventListener('mouseenter', () => { place(); dwell = setTimeout(seen, 700); }); b.addEventListener('mouseleave', () => clearTimeout(dwell));
  b.addEventListener('focus', place); b.addEventListener('blur', () => b.classList.remove('open'));
  return b;
};
// linha com um valor à vista (nome de usuário, versão…), não uma explicação
export const vrow = (title, value, ctl) => h('div.perm', h('div', h('div.rt', title), value != null && value !== '' && h('div.rd', value)), ctl);
export const row = (title, desc, ctl) => h('div.perm', h('div', h('div.rt', title, desc && infoTip(desc))), ctl);
// liga/desliga visual: cartões com prévia e uma chave no canto. items: [{ on, label, prev, desc, fn(v) }]
export const toggleCards = (items) => h('div.choices.togs', items.filter(Boolean).map((it) => {
  let on = !!it.on;
  const b = h('button.choice.tog' + (on ? '.on' : ''), { type: 'button', role: 'switch', 'aria-checked': String(on), title: it.desc || null,
    onclick: () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); it.fn(on); } },
    h('div.ch-prev', it.prev), h('span.ch-lbl', h('span.tg-sw'), it.label), it.sub && h('small.tg-sub', it.sub));
  return b;
}));
// escolha visual: cartões com prévia em vez de uma lista de botões. opts: [[valor, rótulo, prévia]]
export const choiceCards = (opts, val, on) => {
  const box = h('div.choices', { role: 'radiogroup' }); let cur = val;
  const draw = (v) => (cur = v, box.replaceChildren(...opts.map(([k, l, prev]) => h('button.choice' + (String(k) === String(v) ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(String(k) === String(v)), onclick: () => { if (String(k) === String(cur)) return; on(k); draw(k); } }, h('div.ch-prev', prev), h('span.ch-lbl', icon('check', 14), l)))));
  draw(val); return box;
};
// redução de ruído em cartões: cada nível mostra a voz (barras) e o ruído (pontinhos amarelos) que sobra
// (configurações e painel do microfone; compact = os quatro numa linha, só o nome)
export const NOISE_INFO = { off: ['Sem filtro', 'Voz crua, com todo o ruído', 1, null], standard: ['Leve', 'Filtro do navegador, quase sem CPU', .55, null], rnnoise: ['Forte', 'IA tira teclado e ventilador', .18, 'IA'], gtcrn: ['Máxima', 'IA mais forte, ~2,5x a CPU da Forte', 0, 'IA+'] };
const VOICE_H = [18, 34, 52, 40, 60, 46, 28, 54, 38, 22], NOISE_H = [10, 6, 12, 8, 5, 11, 7, 9, 6, 12];
export const noisePrev = (k, n = 10) => { const [, , lv, badge] = NOISE_INFO[k]; return h('span.nz-prev', h('span.nz-wave', VOICE_H.slice(0, n).map((v, i) => [h('i.nz-n', { style: { height: NOISE_H[i] + 'px', opacity: lv } }), h('i.nz-v', { style: { height: v + '%' } })])), badge && h('b.nz-badge', badge)); };
export function noiseCards(val, on, { compact = false } = {}) {
  const box = choiceCards(Object.keys(NOISE_MODES).map(k => {
    const [name, hint] = NOISE_INFO[k], prev = noisePrev(k, compact ? 6 : 10);
    if (compact) prev.title = hint; // no painel compacto a explicação fica no passar o mouse
    return [k, compact ? h('span.nz-l', { title: hint }, h('b', k === 'off' ? 'Nenhum' : name)) : h('span.nz-l', h('b', name), h('small', hint)), prev];
  }), val || 'standard', on);
  if (compact) box.classList.add('nz-compact');
  return box;
}
export const section = (t) => h('h3.sec', t);
// explicação visual curta: rótulo à esquerda e chips com ícone. groups: [[rótulo, tom ('ok'|'no'|'info'), [[ícone, texto], …]], …]
export const factChips = (groups) => h('div.fchips', groups.filter(Boolean).map(([lbl, tone, items]) => h('div.fc-row.' + tone,
  lbl && h('span.fc-lbl', lbl), h('div.fc-list', items.map(([ic, t]) => h('span.fchip', icon(ic, 14), t))))));
export const slider = (min, max, value, step, onInput, fmt = (v) => v, onChange) => { // onChange: ao soltar (ex.: tocar uma prévia do volume)
  const out = h('span.sval', fmt(value)), r = h('input', { type: 'range', min, max, step, value, oninput: () => { out.textContent = fmt(+r.value); onInput(+r.value); }, onchange: () => onChange?.(+r.value) });
  return h('div.sl', r, out);
};

export const SHARE_PRESETS = [
  ['720p • 30 fps', { res: 720, fps: 30, hint: 'motion' }],
  ['1080p • 30 fps', { res: 1080, fps: 30, hint: 'motion' }],
  ['1080p • 60 fps', { res: 1080, fps: 60, hint: 'motion' }],
  ['1440p • 60 fps', { res: 1440, fps: 60, hint: 'motion' }],
  ['Apresentação (1080p • 15 fps, nítido)', { res: 1080, fps: 15, hint: 'detail' }],
  ['1080p • 120 fps', { res: 1080, fps: 120, hint: 'motion' }],
  ['Original • 60 fps', { res: 'source', fps: 60, hint: 'motion' }],
];
export const qualityLabel = (o) => `${o.res === 'source' ? 'Original' : o.res + 'p'} • ${o.fps} fps • ${o.hint === 'detail' ? 'nitidez' : 'movimento'}${o.audio ? ' • com áudio' : ''}`;
export const estMbps = (o) => (+o.bitrate > 0 ? (+o.bitrate).toFixed(1) : (({ 720: 2.2, 1080: 4.5, 1440: 8, source: 9 })[o.res] * (o.fps >= 120 ? 2.4 : o.fps >= 60 ? 1.6 : o.fps <= 15 ? .6 : 1)).toFixed(1));

// painel de qualidade da transmissão (antes e durante)
export function qualityPanel(o, onChange, { live = false } = {}) { // live: durante a transmissão, só resolução, FPS e taxa de dados
  const box = h('div.qpanel');
  const draw = () => box.replaceChildren(
    h('label.f', 'Resolução', seg(SCREEN_PRESETS.res, o.res, v => { o.res = v; draw(); onChange?.(o); })),
    h('label.f', 'Taxa de quadros (FPS)', seg(SCREEN_PRESETS.fps, o.fps, v => { o.fps = v; draw(); onChange?.(o); })),
    !live && h('label.f', 'Otimizar para'), !live && choiceCards([
      ['motion', 'Movimento (jogos/vídeo)', h('span.opt-motion', h('i.om-ball'), h('i.om-trail'), h('i.om-trail.t2'), h('i.om-trail.t3'))],
      ['detail', 'Nitidez (texto/apresentação)', h('span.opt-detail', h('b', 'Aa'), h('span.od-lines', h('i'), h('i'), h('i')))]], o.hint || 'motion', v => { o.hint = v; draw(); onChange?.(o); }),
    h('label.f', 'Taxa de dados (bitrate)', seg({ 0: 'Automática', 8: '8 Mbps', 16: '16 Mbps', 24: '24 Mbps', 32: '32 Mbps', 50: '50 Mbps' }, +o.bitrate || 0, v => { o.bitrate = +v; draw(); onChange?.(o); })),
    +o.fps > 60 && (S.nativeOk ? h('div.qinfo.ok', 'Acima de 60 FPS a imagem é capturada e comprimida pelo próprio app (placa de vídeo), sem o limite de ~48 FPS do navegador. O áudio e a prévia continuam como sempre. Quem tem internet mais fraca recebe automaticamente uma versão leve (540p a 60 FPS).')
      : h('div.qinfo.warn', (S.nativeWhy ? `Modo 120 FPS indisponível: ${S.nativeWhy} ` : 'Pelo navegador, ') + 'o capturador de tela do Chromium não passa de ~48 FPS, mesmo pedindo mais. Durante a transmissão o painel mostra os FPS realmente capturados.')),
    h('div.qinfo', `Taxa de dados ${+o.bitrate > 0 ? 'fixa' : 'estimada'}: ~${estMbps(o)} Mbps por espectador${+o.bitrate >= 24 ? ' — exige upload e placa de vídeo fortes; quem assiste precisa de banda parecida' : ''}`));
  draw(); return box;
}

// ---- atalhos de teclado ----
export function comboFromEvent(e) {
  if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null; // só modificador
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');
}
export const comboLabel = (c) => !c ? '—' : c.split('+').map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Seta ').replace('Backquote', '`').replace('Space', 'Espaço')).join(' + ');
// nome da tecla (e.code) -> nome que o Electron aceita nos atalhos globais (pontuação vira o próprio caractere;
// "Backslash" e companhia davam "atalho inválido" e o atalho nunca funcionava)
const ACCEL_KEYS = { Backslash: '\\', IntlBackslash: '\\', Slash: '/', IntlRo: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Enter' };
export function comboToAccel(c) {
  if (!c) return '';
  return c.split('+').map(p => p === 'Ctrl' ? 'CommandOrControl' : ACCEL_KEYS[p] || p.replace(/^Numpad(\d)$/, 'num$1').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '')).join('+');
}
export function captureKey(button, current, onSet, { combo = true, label = '' } = {}) {
  const paint = (c) => (button.textContent = `${label}${comboLabel(c)}`);
  paint(current);
  button.onclick = () => {
    button.textContent = 'Pressione as teclas… (Esc cancela)'; button.classList.add('capturing');
    const on = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { button.classList.remove('capturing'); paint(current); return removeEventListener('keydown', on, true); }
      const c = combo ? comboFromEvent(e) : e.code; if (!c) return;
      current = c; onSet(c); button.classList.remove('capturing'); paint(c); removeEventListener('keydown', on, true);
    };
    addEventListener('keydown', on, true);
  };
  return button;
}
