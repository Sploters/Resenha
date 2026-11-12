// Aba "Arquivos" (estilo Drive) de um servidor ou de uma DM: tudo o que foi enviado numa grade organizada por tipo
// (imagens, vídeos, áudios, documentos, outros arquivos e links), agrupada por mês, com filtros de quem enviou, período,
// canal e nome. Achar o PDF de três meses atrás sem rolar o chat. Dados: GET /api/media (server/media.js).
import { h, icon, avatar, imgUrl, thumbUrl, bytes, skeleton, fsVideo } from './util.js';
import { S, tryApi, toast, guild, user, nameOf, channelById, dmPeer, lightbox, modal, menu } from './state.js';

let ctx = {}; // injetado por app.js: go(gid, cid), jumpTo(mid)
export const initFiles = (c) => { ctx = c; };

const TABS = [['all', 'Tudo', 'grid4'], ['image', 'Imagens', 'image'], ['video', 'Vídeos', 'video'], ['audio', 'Áudios', 'music'], ['doc', 'Documentos', 'file'], ['file', 'Outros', 'dl'], ['link', 'Links', 'link']];
const PERIODS = [['', 'Qualquer data'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 3 meses'], ['365', 'Último ano'], ['custom', 'Escolher datas…']];
const st = { key: null, gid: null, dm: null, kind: 'all', author: '', channel: '', period: '', from: '', to: '', q: '', items: [], next: null, counts: null, loading: false, seq: 0, root: null, max: 0 };
// abrir já filtrado (ex.: botão "Arquivos" no topo de um canal abre só aquele canal)
export function filesPreset(p = {}) { st.preset = p; }
// saiu da tela: não segura os elementos antigos (os filtros e a lista ficam para a volta)
export function releaseFiles() { if (st.root && !st.root.isConnected) st.root = null; }

const ext = (n) => (String(n).split('?')[0].match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toUpperCase();
const monthOf = (t) => new Date(t).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const when = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const who = (id) => nameOf(id, st.gid) || user(id)?.display_name || 'alguém';
const range = () => {
  if (st.period === 'custom') return { since: st.from ? +new Date(st.from + 'T00:00') : 0, until: st.to ? +new Date(st.to + 'T23:59:59') : 0 };
  return st.period ? { since: Date.now() - +st.period * 864e5, until: 0 } : { since: 0, until: 0 };
};

async function load(reset) {
  const seq = reset ? ++st.seq : st.seq;
  if (st.loading && !reset) return;
  st.loading = true; if (reset) { st.items = []; st.next = null; draw(); }
  const { since, until } = range();
  const qs = new URLSearchParams({ kind: st.kind, ...(st.gid ? { guild: st.gid } : { channel: st.dm }), ...(st.channel ? { channel: st.channel } : {}),
    ...(st.author ? { author: st.author } : {}), ...(since ? { since } : {}), ...(until ? { until } : {}), ...(st.q ? { q: st.q } : {}),
    ...(!reset && st.next ? { before: st.next } : {}), ...(reset ? { counts: 1 } : {}) });
  const r = await tryApi('GET', '/media?' + qs);
  if (seq !== st.seq) return; // filtro mudou no meio
  st.loading = false; if (!r) return draw();
  st.items = reset ? r.items : [...st.items, ...r.items]; st.next = r.next; st.max = r.max_upload || st.max;
  if (r.counts) st.counts = r.counts;
  draw();
}

// ---------- itens ----------
const jump = (it) => { ctx.go?.(channelById(it.channel_id)?.guild_id || '@me', it.channel_id); setTimeout(() => ctx.jumpTo?.(it.message_id), 600); };
const dl = (it) => { const a = h('a', { href: it.url + '?download=1', download: it.name }); document.body.append(a); a.click(); a.remove(); };
function itemMenu(e, it) {
  e.preventDefault(); e.stopPropagation();
  menu(e, [
    { label: 'Ir para a mensagem', fn: () => jump(it) },
    it.url && it.kind !== 'link' && { label: 'Baixar', fn: () => dl(it) },
    it.url && { label: 'Copiar link', fn: () => navigator.clipboard?.writeText(it.kind === 'link' ? it.url : new URL(it.url, location.href).href).then(() => toast('Link copiado')) },
    it.url && { label: 'Abrir em outra aba', fn: () => window.open(it.url, '_blank', 'noopener') },
  ]);
}
function open(it) {
  if (it.expired || !it.url) return toast('Este arquivo expirou e foi apagado do servidor.', true);
  if (it.kind === 'image') return lightbox(it.url, { list: st.items.filter(x => x.kind === 'image' && x.url).map(x => ({ src: x.url, name: x.name, size: x.size })) });
  if (it.kind === 'video') { const poster = thumbUrl(it.url); return modal(it.name, `${who(it.author_id)} · ${when(it.created_at)}`, h('div.fv-video', fsVideo({ src: it.url, autoplay: true, ...(poster ? { poster } : {}) })), [{ label: 'Ir para a mensagem', cls: 'grey', fn: () => jump(it) }, { label: 'Fechar' }], { width: '880px' }); }
  if (it.kind === 'audio') return modal(it.name, `${who(it.author_id)} · ${when(it.created_at)}`, h('audio', { src: it.url, controls: true, autoplay: true, style: { width: '100%' } }), [{ label: 'Ir para a mensagem', cls: 'grey', fn: () => jump(it) }, { label: 'Fechar' }]);
  if (it.kind === 'link') return window.open(it.url, '_blank', 'noopener');
  if (/\.pdf$/i.test(it.name) || it.type === 'application/pdf') return window.open(it.url, '_blank', 'noopener'); // o navegador abre o PDF
  dl(it);
}
const meta = (it) => h('small.fv-meta', h('span', who(it.author_id)), ' · ', h('span', when(it.created_at)), it.size ? ' · ' + bytes(it.size) : '');
function tile(it) {
  const common = { type: 'button', title: `${it.name} — ${who(it.author_id)}, ${new Date(it.created_at).toLocaleString('pt-BR')}`, onclick: () => open(it), oncontextmenu: (e) => itemMenu(e, it) };
  if ((it.kind === 'image' || it.kind === 'video') && !it.expired) {
    const src = it.kind === 'image' ? imgUrl(it.url, 240) : thumbUrl(it.url);
    return h('button.fv-tile.media', common,
      src ? h('img', { src, alt: it.name, loading: 'lazy', onerror: (e) => e.target.replaceWith(icon(it.kind, 32)) }) : icon(it.kind, 32),
      it.kind === 'video' && h('span.fv-play', icon('play', 18)),
      h('span.fv-cap', h('b', it.name), meta(it)));
  }
  const ic = it.kind === 'link' ? 'link' : it.kind === 'audio' ? 'music' : it.kind === 'video' ? 'video' : it.kind === 'image' ? 'image' : 'file';
  return h('button.fv-tile.doc' + (it.expired ? '.expired' : '') + '.k-' + it.kind, common,
    h('span.fv-ic', icon(ic, 26), it.kind !== 'link' && ext(it.name) && h('i', ext(it.name))),
    h('span.fv-t', h('b', it.kind === 'link' ? it.host || it.name : it.name), it.kind === 'link' && h('small.fv-url', it.url), it.expired ? h('small.fv-meta', 'Arquivo expirado') : meta(it)),
    h('span.fv-more', { role: 'button', title: 'Mais opções', onclick: (e) => itemMenu(e, it) }, icon('more', 18)));
}

// ---------- tela ----------
function draw() {
  const root = st.root; if (!root || !document.body.contains(root)) return;
  const g = st.gid && guild(st.gid), dm = st.dm && S.dms.get(st.dm), peer = dm && user(dmPeer(dm)?.id);
  const scroller = root.querySelector('.fv-body'), top = scroller?.scrollTop || 0;
  const focused = document.activeElement?.classList?.contains('fv-q');
  const tabs = h('div.fv-tabs', { role: 'tablist' }, TABS.map(([k, l, ic]) => {
    const n = k === 'all' ? null : st.counts?.[k];
    return h('button.fv-tab' + (st.kind === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(st.kind === k), onclick: () => { if (st.kind !== k) { st.kind = k; load(true); } } },
      icon(ic, 16), h('span', l), n ? h('small', n > 999 ? '999+' : String(n)) : null);
  }));
  // pessoas: membros do servidor ou as duas pessoas da DM
  const people = g ? [...g.members.keys()] : dm ? [S.me.id, ...dm.recipients.map(r => r.id)] : [];
  const sel = (val, opts, on, label) => h('select.fv-sel', { 'aria-label': label, onchange: (e) => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const authorSel = sel(st.author, [['', 'De: qualquer pessoa'], ...people.map(id => [id, who(id)]).sort((a, b) => a[1].localeCompare(b[1]))], (v) => { st.author = v; load(true); }, 'Quem enviou');
  const chanSel = g && sel(st.channel, [['', 'Em: todos os canais'], ...g.channels.filter(c => c.type === 0 || c.type === 2).map(c => [c.id, (c.type === 2 ? '🔊 ' : '#') + c.name])], (v) => { st.channel = v; load(true); }, 'Canal');
  const periodSel = sel(st.period, PERIODS, (v) => { st.period = v; if (v !== 'custom') load(true); else draw(); }, 'Período');
  const dates = st.period === 'custom' && h('span.fv-dates',
    h('input', { type: 'date', value: st.from, 'aria-label': 'De', onchange: (e) => { st.from = e.target.value; load(true); } }), h('span', 'até'),
    h('input', { type: 'date', value: st.to, 'aria-label': 'Até', onchange: (e) => { st.to = e.target.value; load(true); } }));
  const search = h('input.fv-q', { type: 'search', placeholder: 'Buscar por nome do arquivo ou link', value: st.q, 'aria-label': 'Buscar arquivos',
    oninput: (e) => { clearTimeout(st.t); st.t = setTimeout(() => { st.q = e.target.value.trim(); load(true); }, 300); } });
  const filtered = st.author || st.channel || st.period || st.q;
  const clear = filtered && h('button.btn.link.sm', { onclick: () => { Object.assign(st, { author: '', channel: '', period: '', from: '', to: '', q: '' }); load(true); } }, 'Limpar filtros');
  // agrupa por mês
  const groups = []; for (const it of st.items) { const m = monthOf(it.created_at); const last = groups.at(-1); if (last?.m === m) last.list.push(it); else groups.push({ m, list: [it] }); }
  const grid = (list) => h('div.fv-grid' + (st.kind === 'image' || st.kind === 'video' ? '.dense' : ''), list.map(tile));
  const empty = !st.items.length && !st.loading && h('div.cempty', h('div.ceart', icon(TABS.find(t => t[0] === st.kind)[2], 40)),
    h('b', filtered ? 'Nada com esses filtros' : 'Nada enviado aqui ainda'),
    h('p', filtered ? 'Tente outro período, pessoa ou nome.' : 'Fotos, vídeos, áudios, documentos e links enviados nesta conversa aparecem aqui, organizados.'));
  const more = st.next && h('div.fv-more-row', st.loading ? skeleton('cards', 3) : h('button.btn.grey', { onclick: () => load(false) }, 'Carregar mais'));
  const title = g ? `em ${g.name}` : peer ? `com ${peer.display_name}` : '';
  root.replaceChildren(
    h('div#topbar', h('button.ibtn.menu-btn', { onclick: () => document.getElementById('app')?.classList.toggle('nav-open') }, icon('more')), h('span.hash', icon('file', 24)), h('span', 'Arquivos'), h('span.topic', `Mídias, documentos e links ${title}`),
      st.dm && h('button.btn.grey.sm.fv-back', { onclick: () => ctx.go?.('@me', st.dm) }, 'Voltar para a conversa')),
    h('div.fv-body',
      h('div.fv-tool', tabs, h('div.fv-filters', search, authorSel, chanSel, periodSel, dates, clear)),
      st.loading && !st.items.length ? skeleton('cards', 8) : groups.map(gr => h('section.fv-month', h('h3', gr.m), grid(gr.list))),
      empty || null, more || null,
      st.max ? h('p.fv-limit', icon('upload', 14), ` Limite por arquivo neste servidor: ${Math.round(st.max / 1048576)} MB (vídeos maiores são comprimidos no seu aparelho antes de enviar).`) : null));
  const sc = root.querySelector('.fv-body'); if (top) sc.scrollTop = top;
  if (focused) { const s = root.querySelector('.fv-q'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  // rolagem infinita: o botão "Carregar mais" entrando na tela carrega a próxima página
  const btn = root.querySelector('.fv-more-row button');
  if (btn && 'IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some(x => x.isIntersecting)) { io.disconnect(); load(false); } }, { root: sc, rootMargin: '400px' }); io.observe(btn); }
}

// gid: servidor (aba do servidor inteiro) ou null com dm: id da DM
export function renderFiles(main, { gid = null, dm = null } = {}) {
  const key = gid ? 'g:' + gid : 'd:' + dm;
  if (st.key !== key) Object.assign(st, { key, gid, dm, kind: 'all', author: '', channel: '', period: '', from: '', to: '', q: '', items: [], next: null, counts: null });
  if (st.preset) { Object.assign(st, { kind: 'all', author: '', period: '', q: '', channel: '', ...st.preset }); st.preset = null; }
  st.root = h('div#filesview'); main.replaceChildren(st.root);
  load(true);
}
// mensagem nova com anexo/link na conversa aberta na aba: recarrega a primeira página (barato) para aparecer na hora
export function onFilesMessage(m) {
  if (!st.root || !document.body.contains(st.root)) return;
  if (!(m.attachments?.length || /https?:\/\//.test(m.content || ''))) return;
  if (st.gid ? m.guild_id !== st.gid : m.channel_id !== st.dm) return;
  clearTimeout(st.rt); st.rt = setTimeout(() => load(true), 800);
}
