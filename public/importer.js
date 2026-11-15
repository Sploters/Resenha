// Importar conversa do Discord (ideia "Import Discord Chat History", Stoat #1355). Lê no aparelho o arquivo exportado
// pelo DiscordChatExporter — JSON (o melhor: tem os ids, então a data é exata), HTML ou TXT — mostra quem falou e quanto,
// deixa escolher quem é você (e, numa conversa direta, quem é a outra pessoa) e manda em lotes para o servidor
// (server/importer.js), que põe cada mensagem na data original. Nada é notificado; dá para desfazer depois.
import { h, icon, avatar } from './util.js';
import { S, api, toast, modal, confirmBox, user, dmPeer } from './state.js';

const SNOW_EPOCH = 1420070400000n;
const snowTs = (id) => { try { return /^\d{15,20}$/.test(String(id)) ? Number((BigInt(id) >> 22n) + SNOW_EPOCH) : NaN; } catch { return NaN; } };
const MONTHS = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11 };

// ---------- leitura dos formatos ----------
function fromJson(text) {
  const j = JSON.parse(text), list = Array.isArray(j?.messages) ? j.messages : Array.isArray(j) ? j : null;
  if (!list) throw new Error('Esse JSON não parece um export do DiscordChatExporter (falta "messages")');
  const byId = new Map(list.map(m => [String(m.id), m]));
  const nameOf = (a) => a?.nickname || a?.globalName || a?.name || 'Desconhecido';
  return list.filter(m => !m.type || m.type === 'Default' || m.type === 'Reply' || m.type === 0 || m.type === 19).map(m => {
    const ref = m.reference?.messageId && byId.get(String(m.reference.messageId));
    const stick = (m.stickers || []).map(s => `[figurinha: ${s.name}]`).join(' ');
    return { ts: Date.parse(m.timestamp) || snowTs(m.id), discord_id: String(m.id || ''), name: nameOf(m.author), content: [m.content || '', stick].filter(Boolean).join(' '),
      files: (m.attachments || []).map(a => a.url).filter(Boolean), reply_name: ref ? nameOf(ref.author) : undefined };
  });
}
function fromHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const nodes = [...doc.querySelectorAll('[data-message-id]')];
  if (!nodes.length) throw new Error('Esse HTML não parece um export do DiscordChatExporter');
  let last = 'Desconhecido';
  return nodes.map(n => {
    const a = n.querySelector('.chatlog__author, .chatlog__author-name') || n.closest('.chatlog__message-group')?.querySelector('.chatlog__author, .chatlog__author-name');
    if (a) last = (a.textContent || '').trim() || a.getAttribute('title') || last;
    const c = n.querySelector('.chatlog__content .chatlog__markdown-preserve, .chatlog__content, .chatlog__markdown');
    const content = c ? (c.innerText ?? c.textContent ?? '').trim() : '';
    const files = [...n.querySelectorAll('.chatlog__attachment a[href], .chatlog__attachment img[src]')].map(x => x.getAttribute('href') || x.getAttribute('src')).filter(u => /^https?:\/\//.test(u || ''));
    const id = n.getAttribute('data-message-id');
    return { ts: snowTs(id), discord_id: id, name: last, content, files: [...new Set(files)] };
  });
}
// datas do TXT: dependem do idioma do PC que exportou. dayFirst decide 05/06 (padrão: dia/mês, como no Brasil)
function parseDate(s, dayFirst) {
  s = s.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?$/.exec(s);
  if (m) {
    let [, a, b, y, hh, mm, ss, ap] = m; a = +a; b = +b; y = +y < 100 ? 2000 + +y : +y; hh = +hh;
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    if (ap) { const pm = /p/i.test(ap); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    return new Date(y, mo - 1, d, hh, +mm, +(ss || 0)).getTime();
  }
  m = /^(\d{1,2})[- ]([A-Za-zç]{3})[a-z]*\.?[- ](\d{2,4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(s);
  if (m) {
    let [, d, mon, y, hh, mm, ss, ap] = m; const mo = MONTHS[mon.toLowerCase()]; if (mo === undefined) return NaN;
    y = +y < 100 ? 2000 + +y : +y; hh = +hh; if (ap) { const pm = /p/i.test(ap); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    return new Date(y, mo, +d, hh, +mm, +(ss || 0)).getTime();
  }
  return Date.parse(s);
}
function fromTxt(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), out = [];
  const HEAD = /^\[([^\]]{6,40})\] (.{1,100})$/;
  // primeiro descobre se as datas são dia/mês ou mês/dia (um número acima de 12 decide)
  let dayFirst = true;
  for (const l of lines) { const m = HEAD.exec(l), d = m && /^(\d{1,2})[/.-](\d{1,2})[/.-]/.exec(m[1]); if (!d) continue; if (+d[1] > 12) { dayFirst = true; break; } if (+d[2] > 12) { dayFirst = false; break; } }
  let cur = null, inFiles = false, seq = 0;
  for (const l of lines) {
    if (/^={10,}/.test(l) || (!cur && /^(Guild|Channel|Topic|Exported|Servidor|Canal):/i.test(l))) continue;
    const m = HEAD.exec(l), ts = m ? parseDate(m[1], dayFirst) : NaN;
    if (m && Number.isFinite(ts)) { cur = { ts: ts + (seq++ % 1000) / 1000, name: m[2].trim(), content: '', files: [] }; out.push(cur); inFiles = false; continue; }
    if (!cur) continue;
    if (/^\{(Attachments|Anexos|Embed|Stickers|Reactions)\}$/i.test(l.trim())) { inFiles = /attach|anexo/i.test(l); continue; }
    if (inFiles && /^https?:\/\//.test(l.trim())) { cur.files.push(l.trim()); continue; }
    cur.content += (cur.content ? '\n' : '') + l;
  }
  for (const m of out) { m.content = m.content.replace(/\n+$/, ''); m.ts = Math.round(m.ts); }
  return { list: out, dayFirst };
}
export function parseExport(name, text) {
  const t = text.trimStart();
  if (/\.json$/i.test(name) || t.startsWith('{') || t.startsWith('[')) return { list: fromJson(text), format: 'JSON' };
  if (/\.html?$/i.test(name) || /^<!doctype|^<html/i.test(t)) return { list: fromHtml(text), format: 'HTML' };
  const r = fromTxt(text); if (!r.list.length) throw new Error('Não encontrei mensagens nesse arquivo. Use o export do DiscordChatExporter (JSON, HTML ou TXT).');
  return { list: r.list, format: 'TXT' + (r.dayFirst ? ' (datas dia/mês)' : ' (datas mês/dia)') };
}

// ---------- tela ----------
const fmtDay = (t) => new Date(t).toLocaleDateString('pt-BR');
export function importModal(ch) {
  const dm = ch.type === 1 && !ch.guild_id, peer = dm && dmPeer(ch), peerU = peer && user(peer.id);
  const inp = h('input', { type: 'file', accept: '.json,.html,.htm,.txt,application/json,text/html,text/plain', style: { display: 'none' } });
  const body = h('div.imp');
  let parsed = null, roles = new Map(), links = true, running = null;
  const intro = () => body.replaceChildren(
    h('p.mut', 'Exporte a conversa do Discord com o ', h('b', 'DiscordChatExporter'), ' (formato JSON é o mais preciso; HTML e TXT também servem) e escolha o arquivo aqui. As mensagens entram com a data original, sem notificar ninguém.'),
    dm && h('p.mut', `A ${peerU?.display_name || 'outra pessoa'} vê as mensagens marcadas como "Discord" e também pode desfazer a importação.`),
    h('button.btn.imp-pick', { type: 'button', onclick: () => inp.click() }, icon('upload', 18), 'Escolher arquivo'), inp);
  inp.onchange = async () => {
    const f = inp.files[0]; inp.value = ''; if (!f) return;
    if (f.size > 200 * 1048576) return toast('Arquivo grande demais (máximo 200 MB)', true);
    body.replaceChildren(h('p.mut', 'Lendo o arquivo…'));
    try {
      const r = parseExport(f.name, await f.text());
      const list = r.list.filter(m => Number.isFinite(m.ts) && (m.content?.trim() || m.files?.length)).sort((a, b) => a.ts - b.ts);
      if (!list.length) throw new Error('Nenhuma mensagem com data encontrada no arquivo');
      if (list.length > 50000) throw new Error(`O arquivo tem ${list.length.toLocaleString('pt-BR')} mensagens; o máximo por importação é 50.000`);
      parsed = { ...r, list, file: f.name };
      // quem é quem: palpite pelo nome
      const names = new Map(); for (const m of list) names.set(m.name, (names.get(m.name) || 0) + 1);
      const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const mine = [S.me.display_name, S.me.username].map(norm), theirs = peerU ? [peerU.display_name, peerU.username].map(norm) : [];
      roles = new Map([...names.keys()].map(n => [n, mine.includes(norm(n)) ? 'me' : theirs.includes(norm(n)) ? 'peer' : 'name']));
      if (dm && names.size === 2 && [...roles.values()].filter(v => v === 'name').length === 1) { const left = [...roles].find(([, v]) => v === 'name'); const other = [...roles.values()].includes('me') ? 'peer' : [...roles.values()].includes('peer') ? 'me' : null; if (other) roles.set(left[0], other); }
      review(names);
    } catch (e) { toast(e.message, true); intro(); }
  };
  const review = (names) => {
    const list = parsed.list, opts = [['me', 'Sou eu'], ...(dm ? [['peer', `É ${peerU?.display_name || 'a outra pessoa'}`]] : []), ['name', 'Manter o nome do Discord']];
    body.replaceChildren(
      h('div.imp-sum', icon('inbox', 20), h('div', h('b', `${list.length.toLocaleString('pt-BR')} mensagens`), h('small.mut', `${parsed.format} · ${fmtDay(list[0].ts)} a ${fmtDay(list[list.length - 1].ts)} · ${parsed.file}`))),
      h('h5', 'Quem é quem'),
      h('div.imp-people', [...names].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([n, c]) => {
        const sel = h('select', { 'aria-label': `Quem é ${n}`, onchange: () => roles.set(n, sel.value) }, opts.map(([v, l]) => h('option', { value: v, selected: roles.get(n) === v }, l)));
        return h('div.imp-person', avatar({ display_name: n, color: '#5865f2' }, 28, { status: false }), h('div', h('b', n), h('small.mut', `${c.toLocaleString('pt-BR')} mensage${c === 1 ? 'm' : 'ns'}`)), sel);
      })),
      names.size > 50 && h('small.mut', `Mais ${names.size - 50} pessoas ficam com o nome do Discord.`),
      h('label.chk', h('input', { type: 'checkbox', checked: links, onchange: (e) => { links = e.target.checked; } }), h('span', 'Incluir os links dos anexos (o Discord pode expirar esses links)')),
      h('small.mut', '"Sou eu" e a outra pessoa aparecem com o perfil daqui; quem fica com o nome do Discord aparece com o nome original. Todas ganham a marca "Discord".'));
  };
  const run = async () => {
    if (!parsed) { toast('Escolha o arquivo primeiro', true); return false; }
    const items = parsed.list.map(m => ({ ts: m.ts, discord_id: m.discord_id, name: m.name, content: m.content, files: links ? m.files : [], reply_name: m.reply_name, as: roles.get(m.name) === 'name' ? null : roles.get(m.name) }));
    const bar = h('i.up-bar', { style: { width: '0%' } }), txt = h('small.mut', 'Começando…');
    body.replaceChildren(h('div.imp-run', h('b', 'Importando…'), h('div.imp-bar', bar), txt));
    running = { stop: false }; let batch = null, sent = 0;
    try {
      for (let i = 0; i < items.length; i += 500) {
        if (running.stop) throw new Error('Importação cancelada');
        const r = await api('POST', `/channels/${ch.id}/import`, { batch, source: 'discord', messages: items.slice(i, i + 500) });
        batch = r.batch; sent = r.total;
        const pct = Math.round(Math.min(1, (i + 500) / items.length) * 100); bar.style.width = pct + '%'; txt.textContent = `${Math.min(items.length, i + 500).toLocaleString('pt-BR')} de ${items.length.toLocaleString('pt-BR')}`;
      }
      const f = await api('POST', `/channels/${ch.id}/import/${batch}/finish`);
      toast(`${f.count.toLocaleString('pt-BR')} mensagens importadas do Discord`);
      if (f.count < items.length) toast(`${(items.length - f.count).toLocaleString('pt-BR')} ficaram de fora (sem texto ou com data inválida)`);
    } catch (e) {
      if (batch) await api('DELETE', `/channels/${ch.id}/imports/${batch}`).catch(() => { }); // não deixa importação pela metade
      toast(e.message + (sent ? ' — o que tinha entrado foi desfeito' : ''), true); running = null; intro(); return false;
    }
    running = null;
  };
  intro();
  modal('Importar conversa do Discord', dm ? `Na conversa com ${peerU?.display_name || 'esta pessoa'}` : `No canal #${ch.name}`, body,
    [{ label: 'Cancelar', cls: 'link', fn: () => { if (running) { running.stop = true; return false; } } }, { label: 'Importar', cls: 'green', fn: run }], { width: '560px', sticky: true });
}

// importações feitas neste canal, com "Desfazer"
export async function undoImportModal(ch) {
  let list; try { list = await api('GET', `/channels/${ch.id}/imports`); } catch (e) { return toast(e.message, true); }
  const box = h('div.imp-list');
  const draw = () => box.replaceChildren(...(list.length ? list.map(i => h('div.imp-row', avatar(i.by, 28, { status: false }), h('div', h('b', `${i.count.toLocaleString('pt-BR')} mensagens`), h('small.mut', `por ${i.by?.display_name || 'alguém'} em ${fmtDay(i.created_at)} · de ${fmtDay(i.first_at)} a ${fmtDay(i.last_at)}`)),
    i.can_undo && h('button.btn.red.sm', { type: 'button', onclick: async () => {
      if (!await confirmBox('Desfazer importação', `Apagar as ${i.count.toLocaleString('pt-BR')} mensagens desta importação? As mensagens escritas aqui não são afetadas.`, 'Desfazer')) return;
      try { const r = await api('DELETE', `/channels/${ch.id}/imports/${i.id}`); toast(`${r.removed} mensagens removidas`); list = list.filter(x => x.id !== i.id); draw(); } catch (e) { toast(e.message, true); }
    } }, 'Desfazer'))) : [h('small.mut', 'Nenhuma importação neste canal.')]));
  draw();
  modal('Importações do Discord', null, box, [{ label: 'Fechar' }], { width: '520px' });
}
