// Configurações → Armazenamento: o que ocupa espaço e como liberar, sem sair da conta.
// - Neste aparelho: cache de mídias (imagens, vídeos, miniaturas) do app desktop ou do navegador, com teto e "limpar".
// - Seus envios no servidor: por conversa e por tipo, maiores arquivos e "apagar mídias com mais de N dias".
// - Servidores que você gerencia e a instalação inteira (administrador): ver Configurações do servidor → Armazenamento.
// O servidor faz as contas (server/storage.js). Anexo apagado vira "arquivo expirado" na conversa.
import { h, icon } from './util.js';
import { S, api, tryApi, toast, confirmBox, desktop, guild, can, PERM } from './state.js';
import { seg, row, section, vrow } from './ui.js';

export const size = (n) => { n = +n || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(2).replace('.', ',') + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; };
const KIND = { image: ['Imagens', 'image'], video: ['Vídeos', 'video'], audio: ['Áudios', 'vol'], other: ['Outros arquivos', 'file'] };
const AGES = [[0, 'Todas'], [7, '+7 dias'], [30, '+30 dias'], [90, '+90 dias'], [365, '+1 ano']];
const card = (...k) => h('div.card2', ...k);
const note = (t) => h('div.hintline.keep', t);
const date = (t) => t ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// barra empilhada por tipo + legenda
function kindBar(kinds, total) {
  const parts = Object.entries(kinds).filter(([, b]) => b > 0);
  return h('div.stg-kinds',
    h('div.stg-bar', parts.map(([k, b]) => h('i.k-' + k, { style: { width: Math.max(1, (b / (total || 1)) * 100) + '%' }, title: `${KIND[k][0]}: ${size(b)}` }))),
    h('div.stg-legend', parts.length ? parts.map(([k, b]) => h('span', h('i.k-' + k), KIND[k][0], h('b', size(b)))) : h('span', 'Nada por aqui')));
}
// lista de lugares com barra proporcional (clique = filtra)
function placeList(places, max, sel, onPick) {
  return h('div.stg-places', places.slice(0, 12).map(p => h('button.stg-place' + (sel.has(p.channel_id) ? '.on' : ''), { type: 'button', onclick: () => onPick(p.channel_id) },
    h('div.stg-pn', p.guild ? h('small', p.guild) : h('small', 'Mensagem direta'), h('span', p.channel)),
    h('div.stg-pbar', h('i', { style: { width: Math.max(2, (p.bytes / (max || 1)) * 100) + '%' } })),
    h('div.stg-pv', size(p.bytes), h('small', `${p.files} arquivo${p.files === 1 ? '' : 's'}`)))));
}

// ---------- neste aparelho ----------
function devicePart() {
  const box = card(h('div.stg-load', 'Calculando…'));
  const draw = async () => {
    const rows = [];
    if (desktop?.cacheInfo) {
      const ci = await desktop.cacheInfo().catch(() => null);
      rows.push(vrow('Cache de mídias do app', ci ? size(ci.http) + (ci.limitMB ? ` de até ${size(ci.limitMB * 1048576)}` : '') : '—', null));
      if (ci) rows.push(row('Tamanho máximo do cache', 'Ao passar disso, o app apaga sozinho as mídias vistas há mais tempo (elas baixam de novo se você voltar nelas). Vale depois de reiniciar o app.',
        seg([[256, '256 MB'], [512, '512 MB'], [1024, '1 GB'], [2048, '2 GB'], [0, 'Sem limite']], ci.limitMB, async (v) => { await desktop.setSettings({ cacheLimitMB: v }); toast('Vale ao reiniciar o app'); })));
    } else if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate().catch(() => null);
      if (e) rows.push(vrow('Dados guardados pelo navegador', `${size(e.usage)} (o navegador libera sozinho quando falta espaço)`, null));
    }
    rows.push(row('Limpar mídias deste aparelho', 'Apaga imagens, vídeos e miniaturas guardados aqui. Você continua conectado e as configurações ficam; as mídias baixam de novo quando você abrir as conversas.',
      h('button.btn.grey', { onclick: async (ev) => { ev.currentTarget.disabled = true; await clearDevice(); toast('Mídias deste aparelho apagadas'); draw(); } }, icon('trash', 16), 'Limpar')));
    box.replaceChildren(...rows);
  };
  draw(); return box;
}
export async function clearDevice() {
  if (desktop?.clearCache) { await desktop.clearCache().catch(() => { }); return; }
  try { await fetch('/api/storage/clear-site-cache', { method: 'POST' }); } catch { } // Clear-Site-Data: "cache" (o login fica)
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { } // cache do app instalável: baixa de novo
}

// ---------- apagar em massa (seus envios / servidor) ----------
function bulkPart({ load, purge, scopeLabel, canPick = true }) {
  const box = h('div'), sel = new Set(), picked = new Set(); let data = null, age = 30, kinds = new Set(['video', 'image']);
  const draw = () => {
    if (!data) { box.replaceChildren(card(h('div.stg-load', 'Calculando…'))); return; }
    const kindsSeg = h('div.seg.multi', Object.keys(KIND).map(k => h('button' + (kinds.has(k) ? '.on' : ''), { onclick: () => { kinds.has(k) ? kinds.delete(k) : kinds.add(k); if (!kinds.size) kinds.add(k); draw(); } }, icon(KIND[k][1], 14), KIND[k][0])));
    const cut = age ? Date.now() - age * 864e5 : Infinity;
    const match = data.files.filter(f => f.created_at < cut && kinds.has(f.kind) && (!sel.size || sel.has(f.channel_id)) && !f.pinned);
    const go = h('button.btn.red', { onclick: async () => {
      const where = sel.size ? `${sel.size} conversa${sel.size === 1 ? '' : 's'} escolhida${sel.size === 1 ? '' : 's'}` : scopeLabel;
      const what = [...kinds].map(k => KIND[k][0].toLowerCase()).join(', ');
      if (!await confirmBox('Apagar mídias', `Apagar ${what} ${age ? `com mais de ${age} dias` : 'de qualquer data'} em ${where}? As mensagens ficam, com o aviso "arquivo expirado". Fixadas e clipes da galeria não são apagados. Não dá para desfazer.`, 'Apagar')) return;
      const r = await tryApi('POST', purge, { olderThanDays: age, kinds: [...kinds], places: [...sel] });
      if (r) { toast(r.count ? `${r.count} arquivo${r.count === 1 ? '' : 's'} apagado${r.count === 1 ? '' : 's'} • ${size(r.bytes)} liberados` : 'Nada para apagar com esse filtro'); refresh(); }
    } }, icon('trash', 16), 'Apagar mídias');
    const delPicked = picked.size && h('button.btn.red', { onclick: async () => {
      if (!await confirmBox('Apagar arquivos', `Apagar ${picked.size} arquivo${picked.size === 1 ? '' : 's'} escolhido${picked.size === 1 ? '' : 's'}? Não dá para desfazer.`, 'Apagar')) return;
      const items = data.files.filter(f => picked.has(f.mid + '|' + f.url)).map(f => ({ mid: f.mid, url: f.url }));
      const r = await tryApi('POST', purge, { items }); picked.clear();
      if (r) { toast(`${size(r.bytes)} liberados`); refresh(); }
    } }, `Apagar ${picked.size} escolhido${picked.size === 1 ? '' : 's'}`);
    const maxP = data.places[0]?.bytes || 1;
    box.replaceChildren(...[
      card(h('div.stg-total', h('b', size(data.total)), h('span', `${data.count} arquivo${data.count === 1 ? '' : 's'}${data.oldest ? ` • desde ${date(data.oldest)}` : ''}`)), kindBar(data.kinds, data.total)),
      data.places.length > 1 && canPick && [section('Onde está o espaço'), card(placeList(data.places, maxP, sel, (id) => { sel.has(id) ? sel.delete(id) : sel.add(id); draw(); }), note(sel.size ? 'Só as conversas marcadas entram no "Apagar mídias". Clique de novo para desmarcar.' : 'Clique numa conversa para apagar só dela.'))],
      section('Apagar em massa'),
      card(row('Idade', null, seg(AGES, age, (v) => { age = v; draw(); })), row('Tipo', null, kindsSeg),
        h('div.stg-go', h('span', match.length ? `Entre os maiores arquivos, ${match.length} entram nesse filtro (${size(match.reduce((s, f) => s + f.size, 0))}).` : 'Nenhum dos maiores arquivos entra nesse filtro (pode haver outros menores).'), go)),
      data.files.length > 0 && [section('Maiores arquivos'), card(h('div.stg-files', data.files.map(f => {
        const k = f.mid + '|' + f.url;
        return h('label.stg-file' + (picked.has(k) ? '.on' : ''),
          h('input', { type: 'checkbox', checked: picked.has(k), onchange: (e) => { e.target.checked ? picked.add(k) : picked.delete(k); draw(); } }),
          icon(KIND[f.kind][1], 18), h('div.stg-fn', h('a', { href: f.url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, f.name), h('small', `${f.place} • ${date(f.created_at)}${f.pinned ? ' • fixada' : ''}`)), h('b', size(f.size)));
      })), delPicked && h('div.stg-go', h('span'), delPicked))]].flat(2).filter(Boolean));
  };
  const refresh = async () => { data = null; draw(); data = await load(); draw(); };
  refresh(); return box;
}

export function storagePage() {
  const managed = [...S.guilds.values()].filter(g => can(g.id, PERM.MANAGE_GUILD));
  return h('div.stgpage', h('h2', 'Armazenamento'),
    section('Neste aparelho'), devicePart(),
    section('Seus envios no servidor'),
    note('Arquivos que você mandou em servidores e mensagens diretas. Apagar libera espaço no servidor; a mensagem fica com o aviso "arquivo expirado".'),
    bulkPart({ load: () => api('GET', '/storage/me').catch(() => ({ total: 0, count: 0, kinds: {}, places: [], files: [] })), purge: '/storage/me/delete', scopeLabel: 'todas as suas conversas' }),
    managed.length > 0 && [section('Servidores que você gerencia'), card(managed.map(g => row(g.name, null, h('button.btn.grey', { onclick: () => import('./settings.js').then(m => m.openSettings('server', { gid: g.id, page: 'storage' })) }, 'Abrir'))))],
    instancePart());
}

// ---------- servidor (Configurações do servidor → Armazenamento) ----------
export function serverStoragePage(gid) {
  const g = guild(gid), keep = h('div');
  let st = null;
  const drawKeep = () => keep.replaceChildren(card(
    row('Apagar mídias antigas automaticamente', 'Imagens, vídeos, áudios e arquivos com mais tempo que isso somem sozinhos (verificado de hora em hora). Mensagens fixadas e clipes da galeria ficam. As mensagens continuam, com o aviso "arquivo expirado".',
      seg([[0, 'Nunca'], [30, '30 dias'], [90, '90 dias'], [180, '6 meses'], [365, '1 ano']], st?.mediaDays || 0, async (v) => {
        if (v && !await confirmBox('Expirar mídias', `Mídias com mais de ${v} dias deste servidor serão apagadas agora e daqui em diante. Não dá para desfazer.`, 'Ativar')) { drawKeep(); return; }
        const r = await tryApi('PUT', `/guilds/${gid}/storage`, { mediaDays: v });
        if (r) { st.mediaDays = r.mediaDays; toast(r.count ? `${r.count} arquivo${r.count === 1 ? '' : 's'} expirado${r.count === 1 ? '' : 's'} • ${size(r.bytes)} liberados` : v ? 'Ativado' : 'Desativado'); drawKeep(); }
      }))));
  const members = h('div');
  const load = async () => {
    st = await api('GET', `/guilds/${gid}/storage`).catch(() => ({ total: 0, count: 0, kinds: {}, places: [], files: [], members: [], mediaDays: 0 }));
    drawKeep();
    members.replaceChildren(...(st.members?.length ? [section('Quem mais envia'), card(h('div.stg-places', st.members.map(m => h('div.stg-place', h('div.stg-pn', h('span', m.name)), h('div.stg-pbar', h('i', { style: { width: Math.max(2, m.bytes / (st.members[0].bytes || 1) * 100) + '%' } })), h('div.stg-pv', size(m.bytes))))))] : []));
    return st;
  };
  return h('div.stgpage', h('h2', 'Armazenamento'), note(`Espaço que os anexos de ${g?.name || 'este servidor'} ocupam no servidor.`),
    bulkPart({ load, purge: `/guilds/${gid}/storage/purge`, scopeLabel: 'todo o servidor' }),
    section('Expiração automática'), keep, members);
}

// ---------- instalação inteira (só o administrador vê) ----------
function instancePart() {
  const box = h('div');
  api('GET', '/storage/instance').then(r => {
    const used = r.disk ? r.disk.total - r.disk.free : 0;
    box.replaceChildren(section('Instalação (administrador)'), card(
      r.disk && h('div.stg-disk', h('div.stg-bar', h('i.k-video', { style: { width: Math.min(100, (r.uploads.bytes / r.disk.total) * 100) + '%' }, title: 'Anexos' }), h('i.k-other', { style: { width: Math.max(0, Math.min(100, ((used - r.uploads.bytes) / r.disk.total) * 100)) + '%' }, title: 'Resto do disco' })),
        h('div.stg-legend', h('span', h('i.k-video'), 'Anexos', h('b', size(r.uploads.bytes))), h('span', h('i.k-other'), 'Resto do disco', h('b', size(Math.max(0, used - r.uploads.bytes)))), h('span', h('i'), 'Livre', h('b', size(r.disk.free))))),
      vrow('Miniaturas e versões menores', size(r.derived) + ' (refeitas sozinhas se apagadas)', null),
      vrow('Mensagens diretas', size(r.dms), null),
      ...r.guilds.map(g => vrow(g.name, size(g.bytes) + (g.mediaDays ? ` • expira em ${g.mediaDays} dias` : ''), null)),
      row('Arquivos órfãos', 'Arquivos no disco que nada mais usa (envios cancelados, mensagens apagadas em versões antigas). Podem ser apagados sem efeito nas conversas.',
        r.orphans.files ? h('button.btn.grey', { onclick: async () => { const x = await tryApi('POST', '/storage/instance/orphans'); if (x) { toast(`${x.count} arquivo${x.count === 1 ? '' : 's'} • ${size(x.bytes)} liberados`); box.replaceWith(instancePart()); } } }, `Apagar ${r.orphans.files} (${size(r.orphans.bytes)})`) : h('span.stg-ok', icon('check', 16), 'Nenhum'))));
  }, () => { }); // não é administrador: nada aparece
  return box;
}
