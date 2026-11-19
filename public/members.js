// Lista de membros do servidor (virtualizada em servidores grandes).
import { h, morph, place, icon, avatar, debounce, platformIcons } from './util.js';
import { S, user, guild, channelById, loadMembers, roleColor, roleDot } from './state.js';
import { chName } from './chnames.js';
import { styleName } from './themes.js';
import { activityOf, playingLine, gameIcon, titleEl } from './activity.js';
import { $, deferRender } from './gateway.js';
import { profile, userMenu } from './usermenu.js';
// ---------- lista de membros ----------
// lista de membros: seu cartão fixo no topo (cargo + posição na hierarquia), busca, grupos recolhíveis (salvos por servidor)
const memCol = JSON.parse(localStorage.getItem('lc_memcol') || '{}'); // { gid: { grupo: true (recolhido) | false (aberto) } }
const memQ = { gid: null, q: '' };
export function renderMembers() {
  if (deferRender(renderMembers)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const box = $('#members'); if (!box || S.view.kind !== 'guild') return;
  const g = guild(S.view.gid); if (!g) return;
  if (g.partial) loadMembers(g.id).catch(() => { }); // servidor grande: a lista inteira chega agora (members-loaded redesenha)
  if (memQ.gid !== g.id) { memQ.gid = g.id; memQ.q = ''; }
  const ms = [...g.members.values()].map(m => ({ m, u: user(m.user_id) }));
  // cargo mais alto de cada um calculado uma vez (antes: a cada comparação da ordenação, com 300 pessoas ~2.500 vezes)
  const tops = new Map(), topRole = (m) => { let r = tops.get(m); if (r === undefined) { r = null; for (const x of g.roles) if (m.roles.includes(x.id) && (!r || x.position > r.position)) r = x; tops.set(m, r); } return r || undefined; };
  const nm = (x) => (x.nk ??= x.m.nickname || x.u.display_name);
  const by = (a, b) => collator.compare(nm(a), nm(b));
  // hierarquia: dono primeiro, depois pelo cargo mais alto, depois por nome
  const rank = (x) => (g.owner_id === x.u.id ? 1e9 : (topRole(x.m)?.position ?? -1));
  const hier = [...ms].sort((a, b) => rank(b) - rank(a) || by(a, b));
  const meX = ms.find(x => x.u.id === S.me.id), myPos = hier.findIndex(x => x.u.id === S.me.id) + 1;
  const q = memQ.q.trim().toLowerCase();
  const shown = q ? ms.filter(x => (nm(x) + ' ' + x.u.username + ' ' + (x.u.display_name || '')).toLowerCase().includes(q)) : ms;
  const off = shown.filter(x => x.u.status === 'offline'), on = shown.filter(x => x.u.status !== 'offline');
  const groups = new Map();
  for (const x of on) { const r = topRole(x.m); const k = r ? r.id : 'online'; (groups.get(k) || groups.set(k, []).get(k)).push(x); }
  if (off.length) groups.set('offline', off);
  const order = [...g.roles.filter(r => groups.has(r.id)).map(r => [r.id, r.name, r.color]), ['online', 'Online'], ['offline', 'Offline']].filter(([k]) => groups.has(k));
  const col = (memCol[g.id] ||= {});
  const isCol = (k) => !q && (col[k] ?? (k === 'offline' && ms.length > 30)); // buscando: tudo aberto; offline começa recolhido em servidor grande
  const toggle = (k) => { col[k] = !isCol(k); localStorage.setItem('lc_memcol', JSON.stringify(memCol)); renderMembers(); };
  const inVoice = (uid) => { const v = S.voice.get(uid); return v && channelById(v.channel_id)?.guild_id === g.id ? channelById(v.channel_id) : null; };
  // linha guardada enquanto o que ela mostra não muda (o USER_UPDATE troca o objeto da pessoa; membro, cor, sala e jogo
  // idem): com gente entrando e saindo, só a linha de quem mudou é montada de novo
  // só vale dentro do MESMO painel: cada linha guarda o clique, que segura a renderização em que nasceu (e por ela o painel
  // e a tela antigos, com o chat inteiro). Painel novo (trocou de tela) = cache novo — antes isso vazava ~600 MB/hora.
  if (memRows.gid !== g.id || memRows.box !== box) { memRows.clear(); memRows.gid = g.id; memRows.box = box; }
  const row = (x, offline) => {
    const { m, u } = x, vc = !offline && inVoice(u.id), act = offline ? null : activityOf(u.id), col = roleColor(g.id, u.id), name = nm(x), own = g.owner_id;
    const c = memRows.get(u.id);
    if (c && c.u === u && c.m === m && c.off === offline && c.vc === vc && c.act === act && c.col === col && c.name === name && c.own === own) return c.el;
    const el = buildRow(x, offline, vc);
    memRows.set(u.id, { u, m, off: offline, vc, act, col, name, own, el });
    return el;
  };
  const buildRow = ({ m, u }, offline, vc) => {
    return h('div.mem' + (offline ? '.off' : '') + (u.id === S.me.id ? '.me' : ''), { 'data-uid': u.id, onclick: (e) => profile(e.currentTarget, u.id, g.id), oncontextmenu: (e) => userMenu(e, u.id, g.id) },
      avatar(u, 32, { ring: 'var(--bg-sec)' }),
      h('div', { style: { minWidth: 0, flex: 1 } }, h('div.mn', { style: { color: roleColor(g.id, u.id) || (offline ? '' : 'var(--header)') } }, styleName(h('span.mnn', nm({ m, u })), u.name_style), roleDot(g.id, u.id), g.owner_id === u.id && h('span.crown', { title: 'Dono do servidor', style: { marginLeft: '4px' } }, icon('crown', 12)), !offline && platformIcons(u, 13)), activityOf(u.id) && !offline ? h('div.cs.playing', { title: playingLine(activityOf(u.id)) }, gameIcon(activityOf(u.id), 14), 'Jogando ', titleEl(activityOf(u.id), 'b')) : u.custom_status && h('div.cs', u.custom_status)),
      vc && h('span.mem-vc', { title: 'Em chamada: ' + chName(vc) }, icon('voice', 14)));
  };
  const head = (k, name, color, list) => {
    const c = isCol(k);
    return h('button.mgroup' + (c ? '.col' : ''), { type: 'button', 'aria-expanded': String(!c), title: c ? 'Mostrar' : 'Recolher', onclick: () => toggle(k) },
      icon('caret', 12), color ? h('i.mg-dot', { style: { background: color } }) : null, h('span.mg-name', name), h('span.mg-n', list.length),
      c && h('span.mg-faces', list.slice(0, 4).map(x => avatar(x.u, 18, { ring: 'var(--bg-sec)' }))));
  };
  // seu cartão: sempre visível, independentemente do cargo; clicar leva você até a sua linha na lista
  const r = meX && topRole(meX.m);
  const jumpMe = () => {
    const k = meX.u.status === 'offline' ? 'offline' : (r ? r.id : 'online');
    if (memQ.q) { memQ.q = ''; if (box._q) box._q.value = ''; }
    if (isCol(k)) { col[k] = false; localStorage.setItem('lc_memcol', JSON.stringify(memCol)); }
    memJump = S.me.id; renderMembers(); // a lista é virtual: a sua linha pode nem estar montada; o redesenho rola até ela
  };
  const meCard = meX && h('div.mem-mecard', { title: 'Mostrar você na lista', onclick: jumpMe },
    avatar(meX.u, 36, { ring: 'var(--bg-tert, var(--bg-sec))' }),
    h('div.mm-txt', h('div.mm-name', { style: { color: roleColor(g.id, S.me.id) || '' } }, nm(meX)),
      h('div.mm-role', g.owner_id === S.me.id ? [icon('crown', 12), 'Dono'] : r ? [h('i.mg-dot', { style: { background: r.color || 'var(--text-muted)' } }), r.name] : 'Sem cargo')),
    h('div.mm-pos', { title: `Você é o ${myPos}º de ${ms.length} na hierarquia do servidor` }, h('b', myPos + 'º'), h('small', 'de ' + ms.length)));
  if (!box._q) {
    box._q = h('input.mem-q', { type: 'search', placeholder: 'Buscar membros', 'aria-label': 'Buscar membros', oninput: debounce(() => { memQ.q = box._q.value; renderMembers(); }, 100), onkeydown: (e) => { if (e.key === 'Escape' && box._q.value) { e.stopPropagation(); box._q.value = ''; memQ.q = ''; renderMembers(); } } });
  }
  if (box._q.value !== memQ.q) box._q.value = memQ.q;
  // Lista virtual: a lista inteira vira itens (cabeçalho de grupo ou pessoa) de altura fixa e só os que estão na tela (mais
  // uma folga) ficam na página, entre dois espaçadores com a altura do resto. Antes, um grupo grande aparecia aos pedaços
  // ("Mostrar mais", 200 + 300 linhas) e tudo que já tinha passado continuava montado: rolando os 5.000 offline de um
  // servidor grande eram 5.000 linhas na página (scripts/perf-big.mjs). Rolar só troca as linhas da janela (paintMem).
  const items = [];
  for (const [k, name, color] of order) {
    const l = groups.get(k).sort(by), off = k === 'offline';
    items.push({ make: () => head(k, name, color, l) });
    if (!isCol(k)) for (const x of l) items.push({ uid: x.u.id, make: () => row(x, off) });
  }
  const top = box.querySelector('.mem-top') || h('div.mem-top');
  if (top.firstChild?.lastChild !== box._q) top.replaceChildren(h('label.mem-search', icon('search', 14), box._q));
  // a lista já está na página: atualiza só o que mudou (a rolagem fica onde estava e as fotos não recarregam)
  let list = box.querySelector(':scope > .mem-list');
  const foot = meCard && h('div.mem-foot', meCard), oldFoot = box.querySelector(':scope > .mem-foot');
  if (list && box.firstChild === top) { if (foot && oldFoot) morph(oldFoot, foot); else if (foot) box.append(foot); else oldFoot?.remove(); }
  else { list = h('div.mem-list'); box.replaceChildren(top, list, foot || ''); } // seu cartão fica fixo embaixo, como no design
  if (!list._onScroll) { let raf = 0; list._onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintMem(); }); }; list.addEventListener('scroll', list._onScroll, { passive: true }); }
  memVirt = { list, items, virt: items.length > MEM_VIRT, none: q && !shown.length, off: null };
  paintMem();
  if (memJump) { const uid = memJump; memJump = null; scrollMemTo(uid); }
}
const memRows = new Map();
// a partir de quantos itens a lista fica virtual (abaixo disso monta tudo: rolar não troca nada e a busca do navegador acha)
const MEM_VIRT = 150, MEM_OVER = 12; // folga de linhas acima e abaixo da tela
const memH = { row: 42, head: 38, ok: false }; // alturas medidas na primeira pintura (mudam com o zoom)
let memVirt = null, memJump = null;
// tela trocada: a linha guardada e a lista virtual seguravam o #members antigo (ver releaseOldScreens)
export function releaseMembers() {
  if (memRows.box && !memRows.box.isConnected) { memRows.clear(); memRows.box = null; memRows.gid = null; }
  if (memVirt && !memVirt.list.isConnected) memVirt = null; // lista virtual: guarda a .mem-list e os itens (cada um com o redesenho em que nasceu)
}
function memOffsets(v) {
  if (v.off && v.offFor === memH.row + ',' + memH.head) return v.off;
  const off = new Float64Array(v.items.length + 1);
  for (let i = 0; i < v.items.length; i++) off[i + 1] = off[i] + (v.items[i].uid ? memH.row : memH.head);
  v.offFor = memH.row + ',' + memH.head; return (v.off = off);
}
const firstAfter = (off, y) => { let lo = 0, hi = off.length - 2; while (lo < hi) { const m = (lo + hi) >> 1; if (off[m + 1] <= y) lo = m + 1; else hi = m; } return lo; };
function paintMem() {
  const v = memVirt; if (!v || !v.list.isConnected) return;
  const { list, items } = v, shownIds = new Set();
  const node = (it) => { if (it.uid) { shownIds.add(it.uid); return it.make(); } return (it.node ||= it.make()); }; // linha: cache memRows; cabeçalho: um por redesenho
  let nodes;
  if (!v.virt) nodes = [...items.map(node), v.none && h('div.mem-none', 'Ninguém com esse nome')].filter(Boolean);
  else {
    const off = memOffsets(v), n = items.length;
    const a = firstAfter(off, Math.max(0, list.scrollTop)), b = firstAfter(off, list.scrollTop + list.clientHeight);
    const i0 = Math.max(0, a - MEM_OVER), i1 = Math.min(n - 1, b + MEM_OVER);
    list._sTop ||= h('div.mem-sp', { 'aria-hidden': 'true' }); list._sBot ||= h('div.mem-sp', { 'aria-hidden': 'true' });
    list._sTop.style.height = off[i0] + 'px'; list._sBot.style.height = (off[n] - off[i1 + 1]) + 'px';
    nodes = [list._sTop, ...items.slice(i0, i1 + 1).map(node), list._sBot];
  }
  place(list, nodes);
  for (const id of memRows.keys()) if (!shownIds.has(id)) memRows.delete(id); // fora da janela (ou saiu do servidor): não fica guardada
  // mede as alturas reais uma vez (zoom/fonte mudam a do cabeçalho); se diferirem da estimativa, redesenha a janela
  if (v.virt && !memH.ok) {
    const r = list.querySelector(':scope > .mem'), g = list.querySelector(':scope > .mgroup');
    if (r && g) {
      const full = (el) => { const cs = getComputedStyle(el); return el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom); };
      const rh = full(r), hh = full(g); memH.ok = true;
      if (rh > 0 && hh > 0 && (Math.abs(rh - memH.row) > .5 || Math.abs(hh - memH.head) > .5)) { memH.row = rh; memH.head = hh; paintMem(); }
    }
  }
}
addEventListener('resize', () => { memH.ok = false; if (memVirt?.virt) paintMem(); }); // zoom da página também chega como resize
// rola a lista até a pessoa (que pode não estar montada) e pisca a linha dela
function scrollMemTo(uid) {
  const v = memVirt; if (!v) return;
  const i = v.items.findIndex(it => it.uid === uid); if (i < 0) return;
  if (v.virt) { const off = memOffsets(v); v.list.scrollTop = off[i] - v.list.clientHeight / 2 + memH.row / 2; paintMem(); }
  const el = v.list.querySelector(`:scope > .mem[data-uid="${uid}"]`); if (!el) return;
  if (!v.virt) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
const collator = new Intl.Collator('pt-BR');
