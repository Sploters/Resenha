// Apagar minhas mensagens: ferramenta oficial para apagar as próprias mensagens em massa (sem script, sem risco).
// Filtros (onde, período, texto, tipo, fixadas) -> prévia com a contagem por conversa (dá para desmarcar conversas)
// -> baixar uma cópia (opcional) -> apagar em lotes com progresso. O servidor faz tudo: server/mymessages.js.
// Abre por Configurações → Privacidade e segurança, clique direito num canal, no servidor ou numa conversa.
import { h, icon } from './util.js';
import { api, toast, confirmBox, modal } from './state.js';
import { seg, toggle, row } from './ui.js';

const DAY = 86400e3;
const fmt = (t) => t ? new Date(+t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const plural = (n, a, b) => `${n.toLocaleString('pt-BR')} ${n === 1 ? a : b}`;
const PERIODS = [['any', 'Qualquer data'], ['24h', 'Últimas 24 h'], ['7d', 'Últimos 7 dias'], ['old30', 'Mais de 30 dias'], ['old365', 'Mais de 1 ano'], ['range', 'Entre datas']];
const ONLY = [['all', 'Todas'], ['text', 'Só texto'], ['files', 'Com arquivos'], ['links', 'Com links']];

// preset: { places: [id], title } (uma conversa/canal) | { guild_id, title } (um servidor) | {} (tudo)
export function openMyMessages(preset = {}) {
  const f = { scope: 'all', period: 'any', from: '', to: '', contains: '', only: 'all', keepPinned: true };
  let scan = null, off = new Set(), seq = 0;
  const fixed = !!(preset.places?.length || preset.guild_id);
  const out = h('div.mm-out'), from = h('input', { type: 'date', onchange: () => { f.from = from.value; refresh(); } }), to = h('input', { type: 'date', onchange: () => { f.to = to.value; refresh(); } });
  const range = h('div.mm-range', { hidden: true }, h('label.f', 'De', from), h('label.f', 'Até', to));
  const text = h('input', { placeholder: 'Só as que contêm… (opcional)', maxLength: 200, oninput: () => { clearTimeout(text._t); text._t = setTimeout(() => { f.contains = text.value.trim(); refresh(); }, 400); } });

  const body = () => {
    const b = { scope: f.scope, only: f.only, keepPinned: f.keepPinned, contains: f.contains || undefined };
    if (preset.places?.length) b.places = preset.places; if (preset.guild_id) b.guild_id = preset.guild_id;
    const now = Date.now();
    if (f.period === '24h') b.after = now - DAY; else if (f.period === '7d') b.after = now - 7 * DAY;
    else if (f.period === 'old30') b.olderThanDays = 30; else if (f.period === 'old365') b.olderThanDays = 365;
    else if (f.period === 'range') { if (f.from) b.after = new Date(f.from + 'T00:00').getTime(); if (f.to) b.before = new Date(f.to + 'T00:00').getTime() + DAY; }
    return b;
  };
  // o que vai de fato: os filtros + as conversas que continuam marcadas + o corte da prévia
  const final = () => { const b = { ...body(), until: scan.until }; if (off.size) b.places = scan.places.filter(p => !off.has(p.channel_id)).map(p => p.channel_id); return b; };
  const chosen = () => scan ? scan.places.filter(p => !off.has(p.channel_id)).reduce((t, p) => t + p.count, 0) : 0;

  async function refresh() {
    const my = ++seq; out.replaceChildren(h('div.mm-wait', 'Contando suas mensagens…'));
    try { const r = await api('POST', '/me/messages/scan', body()); if (my !== seq) return; scan = r; off = new Set(); draw(); }
    catch (e) { if (my === seq) out.replaceChildren(h('div.mm-wait', e.message)); }
  }
  function draw() {
    const n = chosen();
    goBtn.disabled = !n; goBtn.textContent = n ? `Apagar ${plural(n, 'mensagem', 'mensagens')}` : 'Nada para apagar';
    dlBtn.disabled = !n;
    if (!scan.total) return out.replaceChildren(h('div.mm-wait', 'Nenhuma mensagem sua com esses filtros.'));
    out.replaceChildren(
      h('div.mm-total', h('b', plural(n, 'mensagem', 'mensagens')), ` em ${plural(scan.places.filter(p => !off.has(p.channel_id)).length, 'conversa', 'conversas')}`,
        scan.pinnedKept > 0 && h('small', ` · ${plural(scan.pinnedKept, 'fixada fica', 'fixadas ficam')}`)),
      scan.places.length > 1 && h('div.mm-hint', 'Desmarque as conversas que você quer manter.'),
      h('div.mm-places', scan.places.slice(0, 200).map(p => h('label.mm-place' + (off.has(p.channel_id) ? '.off' : ''),
        h('input', { type: 'checkbox', checked: !off.has(p.channel_id), onchange: (e) => { e.target.checked ? off.delete(p.channel_id) : off.add(p.channel_id); draw(); } }),
        h('span.mm-pn', h('small', p.guild || 'Mensagem direta'), h('span', p.channel), p.left && h('i.mm-left', p.guild ? 'você saiu do servidor' : 'conversa fora da sua lista')),
        h('span.mm-pc', h('b', p.count.toLocaleString('pt-BR')), h('small', `${fmt(p.first)} – ${fmt(p.last)}`))))),
      scan.sample.length > 0 && h('div.mm-sample', h('small', 'As mais recentes que entram:'), scan.sample.map(m => h('div.mm-msg', h('time', fmt(m.created_at)), h('span', m.content || (m.files ? `📎 ${plural(m.files, 'arquivo', 'arquivos')}` : '…'))))));
  }

  async function download() {
    try {
      const r = await api('POST', '/me/messages/export', final());
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })), download: `minhas-mensagens-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`Cópia baixada (${plural(r.total, 'mensagem', 'mensagens')})`);
    } catch (e) { toast(e.message, true); }
  }
  async function run() {
    const n = chosen(); if (!n) return false;
    if (!(await confirmBox('Apagar de vez?', `${plural(n, 'mensagem sua será apagada', 'mensagens suas serão apagadas')} para todo mundo, com os arquivos anexados. Não dá para desfazer.`, `Apagar ${n.toLocaleString('pt-BR')}`))) return false;
    const b = final(), bar = h('i'), lbl = h('span', 'Apagando…');
    out.replaceChildren(h('div.mm-prog', h('div.mm-bar', bar), lbl)); goBtn.disabled = dlBtn.disabled = true;
    let done = 0;
    try {
      for (let guard = 0; guard < 1000; guard++) {
        const r = await api('POST', '/me/messages/delete', b); done += r.deleted;
        bar.style.width = Math.min(100, (done / Math.max(n, 1)) * 100) + '%'; lbl.textContent = `${done.toLocaleString('pt-BR')} de ${n.toLocaleString('pt-BR')} apagadas`;
        if (!r.left || !r.deleted) break;
      }
      toast(`${plural(done, 'mensagem apagada', 'mensagens apagadas')}`);
      await refresh();
    } catch (e) { toast(e.message, true); lbl.textContent = `Parou em ${done.toLocaleString('pt-BR')}: ${e.message}`; goBtn.disabled = false; }
    return false;
  }

  const goBtn = h('button.btn.red', { onclick: run, disabled: true }, 'Apagar');
  const dlBtn = h('button.btn.grey.mm-dl', { onclick: download, disabled: true, title: 'Arquivo JSON com o texto, a data e o lugar de cada mensagem' }, icon('dl', 16), 'Baixar uma cópia');
  const filters = h('div.mm-filters',
    !fixed && h('label.f', 'Onde', seg([['all', 'Em todo lugar'], ['dms', 'Só mensagens diretas'], ['guilds', 'Só servidores']], f.scope, v => { f.scope = v; refresh(); })),
    h('label.f', 'Quando', seg(PERIODS, f.period, v => { f.period = v; range.hidden = v !== 'range'; refresh(); })), range,
    h('label.f', 'Quais', seg(ONLY, f.only, v => { f.only = v; refresh(); })),
    h('label.f', 'Texto', text),
    row('Manter as mensagens fixadas', 'Fixadas costumam ser regras, links e avisos que os outros ainda usam.', toggle(true, v => { f.keepPinned = v; refresh(); })));
  const m = modal(preset.title ? `Apagar minhas mensagens · ${preset.title}` : 'Apagar minhas mensagens',
    'Só as mensagens que você mesmo enviou, inclusive em servidores de que você já saiu. Nada é apagado antes de você confirmar.',
    h('div.mm', filters, out), [{ label: 'Fechar', cls: 'link' }], { width: '640px' });
  m.el.querySelector('.mf').append(dlBtn, goBtn);
  refresh();
  return m;
}
