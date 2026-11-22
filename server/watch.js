// Watch Together: uma sessão por sala de voz, com estado autoritativo no servidor.
// - Reprodução: pb = { status, pos, at, rate, seq, by } — `pos` vale no instante `at` (relógio do servidor). Todo
//   comando aceito incrementa `seq`; os clientes descartam o que for mais velho que o último aplicado.
// - Fila compartilhada com as regras de Hosting/Sharing, sem duplicados acidentais, autor de cada item.
// - Fim do vídeo: temporizador pela duração + relatório "ended" de quem está perto do fim → próximo da fila.
// - Anfitrião: quem começou. Se cair, espera HOST_GRACE para ele voltar; senão passa para quem está há mais tempo.
// - Reconexão: quem cai (reason 'drop' ou 'reload' da voz) fica offline na sessão e volta sozinho ao reentrar na sala.
// Os eventos do player nos clientes NUNCA viram comandos (só relatórios): ver docs/WATCH-TOGETHER.md.
// Dependências injetadas (para os testes rodarem sem o resto do servidor): ver createWatch.
import crypto from 'node:crypto';
import { SERVICES, parseLink, itemKey, ERRORS, ytPlaylist } from '../public/watchsvc.js';
import { expectedPos, START_LEAD } from '../public/watchsync.js';

const MAX_QUEUE = 200, MAX_HISTORY = 30;
const PLAY_LEAD = 350;       // ms: play marcado um pouco no futuro (o comando chega a todos antes)
const COUNTDOWN = 3000;      // ms: na sincronização assistida o play vem com contagem regressiva
const END_GRACE = 1500;      // ms depois da duração para considerar o vídeo terminado
const RATE_MS = 120;         // ms mínimos entre comandos de reprodução da mesma pessoa
const ADD_WINDOW = 10_000, ADD_MAX = 15;
const nid = () => crypto.randomBytes(6).toString('base64url');
const clampPos = (p, dur) => Math.max(0, Math.min(dur > 0 ? dur : 1e7, Number.isFinite(+p) ? +p : 0));
const cleanStr = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export function createWatch({
  inRoom, roomMembers, sendTo, userPub = (id) => ({ id }), guildOf = () => null, now = () => Date.now(),
  search = async () => [], meta = async () => ({}), playlist = async () => ({ items: [] }), remember = () => { }, recent = () => [], origin = null,
  hostGraceMs = +process.env.WATCH_HOST_GRACE_MS || 30_000, emptyGraceMs = +process.env.WATCH_EMPTY_GRACE_MS || 120_000,
  fatalSkipMs = 2500, log = () => { }, onChange = () => { },
}) {
  const sessions = new Map(); // cid -> sessão
  const fail = (msg, code) => { const e = new Error(msg); if (code) e.code = code; throw e; };

  // ---------- estado público ----------
  const pubItem = (it) => it && ({ id: it.id, service: it.service, ref: it.ref, url: it.url, title: it.title, channel: it.channel, thumb: it.thumb, duration: it.duration, by: it.by, at: it.at, start: it.start || 0, error: it.error || null, episode: !!it.episode, embed_ok: !!it.embedOk });
  const pub = (s, extra = {}) => ({
    cid: s.cid, id: s.id, host: s.host, mode: s.mode, controllers: [...s.controllers], service: s.service, started_by: s.startedBy, created_at: s.created,
    members: [...s.members].map(([id, m]) => ({ id, online: m.online, joined_at: m.joinedAt })),
    queue: s.queue.map(pubItem), current: pubItem(s.current), pb: { ...s.pb }, history: s.history.slice(-10).map(pubItem), now: now(), ...extra,
  });
  const toRoom = (s, type, d) => { for (const uid of roomMembers(s.cid)) sendTo(uid, type, d); };
  const toMembers = (s, type, d) => { for (const [uid, m] of s.members) if (m.online) sendTo(uid, type, d); };
  // onChange(cid): quem está assistindo mudou (ou pode ter mudado) — o servidor atualiza o indicador na lista da sala
  const changed = (cid) => { try { onChange(cid); } catch { } };
  const broadcast = (s, extra) => { toRoom(s, 'WATCH_STATE', pub(s, extra)); changed(s.cid); };
  const syncOut = (s) => toMembers(s, 'WATCH_SYNC', { cid: s.cid, id: s.id, pb: { ...s.pb }, current_id: s.current?.id || null, now: now() });
  let repTimer = new Map();
  const reportsOut = (s) => { // relatórios de cada participante: no máx. 1 envio a cada 700 ms por sessão
    if (repTimer.has(s.cid)) return;
    repTimer.set(s.cid, setTimeout(() => {
      repTimer.delete(s.cid); if (sessions.get(s.cid) !== s) return;
      const reports = {}; for (const [uid, m] of s.members) reports[uid] = m.report ? { ...m.report, online: m.online } : { online: m.online };
      toMembers(s, 'WATCH_MEMBERS', { cid: s.cid, id: s.id, reports, now: now() });
    }, 700));
  };

  // ---------- permissões ----------
  const isHost = (s, uid) => s.host === uid;
  const canControl = (s, uid) => s.mode === 'sharing' || isHost(s, uid) || s.controllers.has(uid);
  const canRemove = (s, uid, it) => canControl(s, uid) || it.by === uid;
  const needControl = (s, uid) => { if (!canControl(s, uid)) fail('Só o anfitrião controla a reprodução no modo Hosting', 'forbidden'); };

  // ---------- reprodução ----------
  const levelOf = (it) => SERVICES[it?.service]?.level || 'embedded';
  const bump = (s, patch, by) => { s.pb = { ...s.pb, ...patch, seq: s.pb.seq + 1, by: by || null }; armEnd(s); };
  function armEnd(s) {
    clearTimeout(s.endTimer); s.endTimer = null;
    const d = s.current?.duration; if (!(d > 0) || s.pb.status !== 'playing') return;
    const left = (d - expectedPos(s.pb, now(), d)) * 1000 / (s.pb.rate || 1) + Math.max(0, s.pb.at - now());
    const seq = s.pb.seq;
    s.endTimer = setTimeout(() => { if (sessions.get(s.cid) === s && s.pb.seq === seq) advance(s, 'ended'); }, Math.max(0, left) + END_GRACE);
  }
  function startItem(s, it, by) {
    s.current = it; it.error = null;
    for (const m of s.members.values()) if (m.report) m.report = { ...m.report, error: null, item_id: null, ready: false };
    const embedded = levelOf(it) === 'embedded';
    // integrado: começa sozinho (um pouco no futuro, para todos carregarem); assistido: começa pausado esperando a
    // turma abrir o título na própria conta e o anfitrião dar o play (com contagem)
    bump(s, { status: embedded ? 'playing' : 'paused', pos: clampPos(it.start || 0, it.duration), at: now() + (embedded ? START_LEAD : 0), rate: 1 }, by);
    try { remember(s.gid, it, s.cid); } catch { }
  }
  function advance(s, reason, by) {
    clearTimeout(s.fatalTimer); s.fatalTimer = null;
    if (s.current) { s.history.push(s.current); if (s.history.length > MAX_HISTORY) s.history.shift(); }
    const next = s.queue.shift();
    if (next) startItem(s, next, by);
    else { s.current = null; bump(s, { status: 'idle', pos: 0, at: now() }, by); }
    broadcast(s, { reason });
  }

  // ---------- sessão ----------
  function create(cid, uid, service) {
    const s = { id: nid(), cid, gid: guildOf(cid), host: uid, startedBy: uid, created: now(), mode: 'hosting', controllers: new Set(),
      service: SERVICES[service] ? service : 'youtube', members: new Map(), queue: [], current: null, history: [],
      pb: { status: 'idle', pos: 0, at: now(), rate: 1, seq: 0, by: null }, adds: new Map() };
    sessions.set(cid, s); log('watch start', cid, uid);
    return s;
  }
  function end(s, reason) {
    clearTimeout(s.endTimer); clearTimeout(s.hostTimer); clearTimeout(s.emptyTimer); clearTimeout(s.fatalTimer);
    if (sessions.get(s.cid) !== s) return;
    sessions.delete(s.cid);
    toRoom(s, 'WATCH_END', { cid: s.cid, id: s.id, reason });
    changed(s.cid);
    for (const [uid, m] of s.members) if (!roomMembers(s.cid).includes(uid) && m.online) sendTo(uid, 'WATCH_END', { cid: s.cid, id: s.id, reason });
  }
  const online = (s) => [...s.members].filter(([, m]) => m.online);
  function pickHost(s, except) {
    const c = online(s).filter(([id]) => id !== except).sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
    return c ? c[0] : null;
  }
  function transferHost(s, to, why) {
    if (!to || to === s.host) return;
    const old = s.host; s.host = to; s.controllers.delete(to);
    broadcast(s, { notice: why === 'left' ? `${userPub(old)?.display_name || 'O anfitrião'} saiu. ${userPub(to)?.display_name || 'Alguém'} agora é o anfitrião.` : `${userPub(to)?.display_name || 'Alguém'} agora é o anfitrião.`, host_changed: { from: old, to, why } });
  }
  function join(s, uid) {
    const m = s.members.get(uid);
    if (m) { m.online = true; m.leftAt = null; }
    else s.members.set(uid, { joinedAt: now(), online: true, report: null, last: 0 });
    clearTimeout(s.emptyTimer); s.emptyTimer = null;
    if (s.host === uid) { clearTimeout(s.hostTimer); s.hostTimer = null; }
    if (!s.members.get(s.host)?.online && !s.hostTimer) transferHost(s, uid, 'left'); // anfitrião já tinha ido embora
  }
  function removeMember(s, uid, why) {
    if (!s.members.delete(uid)) return;
    s.controllers.delete(uid);
    if (!online(s).length) { if (!s.members.size) return end(s, 'empty'); armEmpty(s); }
    if (s.host === uid) transferHost(s, pickHost(s, uid), 'left');
    broadcast(s, { left: uid, why });
  }
  function armEmpty(s) {
    clearTimeout(s.emptyTimer);
    s.emptyTimer = setTimeout(() => { if (sessions.get(s.cid) === s && !online(s).length) end(s, 'empty'); }, emptyGraceMs);
  }
  function maybeFatal(s) { // todos os que estão online relataram erro fatal no item atual: pula sozinho
    const cur = s.current; if (!cur || s.fatalTimer) return;
    const on = online(s); if (!on.length) return;
    const errs = on.map(([, m]) => m.report?.item_id === cur.id && m.report?.error).filter(Boolean);
    if (errs.length < on.length || !errs.every(e => ERRORS[e]?.fatal)) return;
    cur.error = errs[0];
    broadcast(s, { notice: `"${cur.title}" não pode tocar aqui: ${ERRORS[errs[0]].title}. Indo para o próximo…` });
    s.fatalTimer = setTimeout(() => { s.fatalTimer = null; if (sessions.get(s.cid) === s && s.current === cur) advance(s, 'error'); }, fatalSkipMs);
  }

  // ---------- fila ----------
  async function add(s, uid, d) {
    const t = now(), list = (s.adds.get(uid) || []).filter(x => t - x < ADD_WINDOW);
    if (list.length >= ADD_MAX) fail('Muitos vídeos em pouco tempo; espere um pouco', 'rate');
    if (s.queue.length >= MAX_QUEUE) fail('A fila está cheia', 'full');
    let it = null;
    if (d.item && typeof d.item === 'object' && SERVICES[d.item.service]) { // escolhido nos resultados da busca
      const p = SERVICES[d.item.service].parse(d.item.url || '', { origin });
      if (!p) fail('Item inválido');
      it = { ...p, title: cleanStr(d.item.title, 160) || p.title, channel: cleanStr(d.item.channel, 80), thumb: /^https:\/\//.test(d.item.thumb || '') ? String(d.item.thumb).slice(0, 400) : p.thumb, duration: Math.max(0, Math.round(+d.item.duration || 0)) };
    } else {
      const p = parseLink(d.url, { service: d.service, origin });
      if (!p) fail(SERVICES[d.service] ? `Link não reconhecido. ${SERVICES[d.service].hint}.` : 'Link não reconhecido', 'bad_link');
      it = { ...p, title: cleanStr(d.title, 160) || p.title || '', channel: '', duration: 0 };
    }
    const key = itemKey(it);
    if (!d.force && (s.current && itemKey(s.current) === key || s.queue.some(q => itemKey(q) === key))) fail('Esse vídeo já está na fila', 'duplicate');
    if (it.service === 'youtube' && (!it.title || !it.duration)) { // título/miniatura pelo oEmbed oficial (também diz se incorporar é proibido)
      const m = await meta(it).catch(() => ({}));
      if (m.embeddable === false) fail(ERRORS.embed_blocked.title + ': ' + ERRORS.embed_blocked.text, 'embed_blocked');
      if (m.notFound) fail(ERRORS.not_found.title + '. ' + ERRORS.not_found.text, 'not_found');
      if (m.title) it.embedOk = true; // o oEmbed respondeu: a incorporação está liberada pelo dono
      it.title = it.title || m.title || ''; it.channel = it.channel || m.channel || ''; it.thumb = it.thumb || m.thumb; it.duration = it.duration || m.duration || 0;
    }
    if (sessions.get(s.cid) !== s) fail('A sessão terminou');
    // de novo depois do await: dois pedidos iguais ao mesmo tempo
    if (!d.force && (s.current && itemKey(s.current) === key || s.queue.some(q => itemKey(q) === key))) fail('Esse vídeo já está na fila', 'duplicate');
    if (!it.title) it.title = SERVICES[it.service].name + (it.episode ? ' — episódio' : ' — título');
    const item = { ...it, id: nid(), by: uid, at: now() };
    s.adds.set(uid, [...list, t]);
    if (d.next && canControl(s, uid)) s.queue.unshift(item); else s.queue.push(item);
    if (!s.current) advance(s, 'add', uid);
    else broadcast(s, { added: item.id });
    return { item: pubItem(item) };
  }
  // playlist do YouTube: todos os vídeos entram na fila de uma vez (conta como uma adição só para o limite de ritmo).
  // Os que já estão na fila, os privados/apagados e os que proíbem incorporação ficam de fora
  async function addPlaylist(s, uid, d) {
    const pl = ytPlaylist(d.url); if (!pl) fail('Link de playlist do YouTube não reconhecido', 'bad_link');
    const t = now(), list = (s.adds.get(uid) || []).filter(x => t - x < ADD_WINDOW);
    if (list.length >= ADD_MAX) fail('Muitos vídeos em pouco tempo; espere um pouco', 'rate');
    const room = MAX_QUEUE - s.queue.length; if (room <= 0) fail('A fila está cheia', 'full');
    s.adds.set(uid, [...list, t]);
    const r = await playlist(pl, Math.min(100, room + 20));
    if (sessions.get(s.cid) !== s) fail('A sessão terminou');
    const have = new Set([...(s.current ? [itemKey(s.current)] : []), ...s.queue.map(itemKey)]);
    let dup = 0, blocked = 0; const items = [];
    for (const x of r?.items || []) {
      const p = SERVICES.youtube.parse(x.url || ''); if (!p) continue;
      const key = itemKey(p);
      if (have.has(key)) { dup++; continue; }
      if (x.embeddable === false) { blocked++; continue; }
      have.add(key);
      items.push({ ...p, title: cleanStr(x.title, 160) || 'YouTube — vídeo', channel: cleanStr(x.channel, 80), thumb: /^https:\/\//.test(x.thumb || '') ? String(x.thumb).slice(0, 400) : p.thumb, duration: Math.max(0, Math.round(+x.duration || 0)), embedOk: x.embeddable === true, id: nid(), by: uid, at: now() });
    }
    const add = items.slice(0, MAX_QUEUE - s.queue.length);
    if (!add.length) fail(dup ? 'Todos os vídeos dessa playlist já estão na fila' : 'Nenhum vídeo dessa playlist pode tocar aqui', 'empty_playlist');
    // "começar por este": o vídeo do link (aberto dentro da playlist) vai na frente
    const first = pl.video ? add.findIndex(x => x.ref === pl.video) : -1;
    if (first > 0) add.unshift(...add.splice(first, 1));
    if (d.next && canControl(s, uid)) s.queue.unshift(...add); else s.queue.push(...add);
    if (!s.current) advance(s, 'add', uid);
    else broadcast(s, { added: add[0].id });
    return { added: add.length, skipped: dup + blocked + (items.length - add.length), title: cleanStr(r?.title, 140), first: pubItem(add[0]) };
  }

  // ---------- comandos ----------
  async function handle(uid, cid, d) {
    const op = String(d?.op || '');
    if (op === 'clock') return { t: now() };
    if (!inRoom(uid, cid)) fail('Entre na chamada para usar o Watch Together', 'not_in_room');
    let s = sessions.get(cid);
    if (op === 'start') {
      if (!s) s = create(cid, uid, d.service);
      join(s, uid); broadcast(s, { joined: uid });
      return pub(s);
    }
    if (op === 'state') return s ? pub(s) : { none: true };
    if (!s) fail('Nenhum Watch Together nesta chamada', 'no_session');
    if (op === 'join') { join(s, uid); broadcast(s, { joined: uid }); return pub(s); }
    if (!s.members.has(uid)) fail('Entre no Watch Together primeiro', 'not_member');
    const me = s.members.get(uid);
    if (!me.online) join(s, uid);
    const ratedOps = ['play', 'pause', 'seek', 'skip', 'play_item', 'prev'];
    if (ratedOps.includes(op) && canControl(s, uid)) { const t = now(); if (t - me.last < RATE_MS) fail('Calma: muitos comandos seguidos', 'rate'); me.last = t; }
    const cur = s.current, dur = cur?.duration || 0;
    switch (op) {
      case 'leave': removeMember(s, uid, 'leave'); return { left: true };
      case 'end': if (!isHost(s, uid)) fail('Só o anfitrião encerra para todos', 'forbidden'); end(s, 'host_ended'); return { ended: true };
      case 'search': {
        const q = cleanStr(d.q, 200); if (!q) return { results: [] };
        const p = parseLink(q, { origin }); if (p) return { results: [], link: p };
        return { results: (await search(q)).slice(0, 12) };
      }
      case 'suggest': return { results: recent(s.gid).filter(r => !(s.current && itemKey(s.current) === itemKey(r)) && !s.queue.some(q => itemKey(q) === itemKey(r))).slice(0, 12) };
      case 'add': return add(s, uid, d);
      case 'add_playlist': return addPlaylist(s, uid, d);
      case 'remove': {
        const id = String(d.id || '');
        if (cur?.id === id) { if (!canRemove(s, uid, cur)) fail('No modo Hosting você só remove os vídeos que você adicionou', 'forbidden'); advance(s, 'removed', uid); return {}; }
        const i = s.queue.findIndex(q => q.id === id); if (i < 0) fail('Item não está mais na fila', 'gone');
        if (!canRemove(s, uid, s.queue[i])) fail('No modo Hosting você só remove os vídeos que você adicionou', 'forbidden');
        s.queue.splice(i, 1); broadcast(s); return {};
      }
      case 'move': {
        needControl(s, uid);
        const i = s.queue.findIndex(q => q.id === String(d.id)); if (i < 0) fail('Item não está mais na fila', 'gone');
        const [it] = s.queue.splice(i, 1); s.queue.splice(Math.max(0, Math.min(s.queue.length, Math.floor(+d.to || 0))), 0, it);
        broadcast(s); return {};
      }
      case 'play_item': {
        needControl(s, uid);
        const i = s.queue.findIndex(q => q.id === String(d.id)); if (i < 0) fail('Item não está mais na fila', 'gone');
        const [it] = s.queue.splice(i, 1); s.queue.unshift(it); advance(s, 'jump', uid); return {};
      }
      case 'skip': needControl(s, uid); if (d.item_id && d.item_id !== cur?.id) return { stale: true }; advance(s, 'skip', uid); return {};
      case 'prev': {
        needControl(s, uid);
        const last = s.history.pop(); if (!last) { if (cur) { bump(s, { pos: 0, at: now() + PLAY_LEAD }, uid); syncOut(s); } return {}; }
        if (cur) s.queue.unshift(cur);
        s.current = null; startItem(s, last, uid); broadcast(s); return {};
      }
      case 'play': {
        needControl(s, uid); if (!cur) fail('A fila está vazia', 'empty');
        if (s.pb.status === 'playing' && d.pos === undefined) return { seq: s.pb.seq };
        const pos = d.pos !== undefined ? clampPos(d.pos, dur) : s.pb.status === 'ended' ? 0 : expectedPos(s.pb, now(), dur);
        bump(s, { status: 'playing', pos, at: now() + (levelOf(cur) === 'embedded' ? PLAY_LEAD : COUNTDOWN) }, uid); syncOut(s); return { seq: s.pb.seq };
      }
      case 'pause': {
        needControl(s, uid); if (!cur) return {};
        const pos = d.pos !== undefined ? clampPos(d.pos, dur) : expectedPos(s.pb, now(), dur);
        bump(s, { status: 'paused', pos, at: now() }, uid); syncOut(s); return { seq: s.pb.seq };
      }
      case 'seek': {
        needControl(s, uid); if (!cur) return {};
        const pos = clampPos(d.pos, dur), playing = s.pb.status === 'playing';
        bump(s, { pos, at: now() + (playing ? PLAY_LEAD : 0) }, uid); syncOut(s); return { seq: s.pb.seq };
      }
      case 'mode': {
        if (!isHost(s, uid)) fail('Só o anfitrião muda o modo', 'forbidden');
        s.mode = d.mode === 'sharing' ? 'sharing' : 'hosting';
        broadcast(s, { notice: s.mode === 'sharing' ? 'Modo Sharing: todos controlam o vídeo e a fila' : 'Modo Hosting: só o anfitrião controla o vídeo' }); return {};
      }
      case 'host': {
        if (!isHost(s, uid)) fail('Só o anfitrião passa o controle', 'forbidden');
        const to = String(d.uid || ''); if (!s.members.get(to)?.online) fail('Essa pessoa não está no Watch Together');
        transferHost(s, to, 'given'); return {};
      }
      case 'grant': {
        if (!isHost(s, uid)) fail('Só o anfitrião autoriza', 'forbidden');
        const to = String(d.uid || ''); if (!s.members.has(to)) fail('Essa pessoa não está no Watch Together');
        if (d.on) s.controllers.add(to); else s.controllers.delete(to);
        broadcast(s); return {};
      }
      case 'ask': { // "Pedir para controlar" (modo Hosting): o anfitrião recebe o pedido com os botões para liberar
        if (canControl(s, uid)) return { already: true };
        const t = now(); if (t - (me.askedAt || 0) < 20_000) fail('Você já pediu: espere o anfitrião responder', 'rate');
        me.askedAt = t; sendTo(s.host, 'WATCH_ASK', { cid: s.cid, id: s.id, uid }); return {};
      }
      case 'service': if (SERVICES[d.id]) { s.service = d.id; broadcast(s); } return {};
      case 'report': { // estado do player desta pessoa (nunca vira comando)
        const r = { state: ['playing', 'paused', 'ended', 'idle', 'loading'].includes(d.state) ? d.state : 'unknown', pos: Math.max(0, +d.pos || 0), at: now(),
          buffering: !!d.buffering, error: ERRORS[d.error] ? d.error : null, item_id: d.item_id ? String(d.item_id) : null, ready: !!d.ready, external: !!d.external, level: cleanStr(d.level, 16) || null, q: /^[a-z0-9]{2,8}$/.test(String(d.q || '')) ? String(d.q) : null, qd: Math.max(0, Math.min(9, d.qd | 0)) };
        me.report = r; reportsOut(s);
        if (r.error && cur && r.item_id === cur.id) maybeFatal(s);
        return null; // sem resposta (relatório frequente)
      }
      case 'meta': { // duração descoberta pelo player (o oEmbed não traz). Quem controla também corrige uma duração
        // errada (ex.: a do vídeo anterior, gravada por engano em versões antigas e trazida pelos "assistidos recentemente")
        const nd = Math.round(+d.duration || 0);
        if (cur && String(d.item_id) === cur.id && nd > 0 && (!(cur.duration > 0) || (canControl(s, uid) && Math.abs(nd - cur.duration) > 3))) { cur.duration = nd; armEnd(s); broadcast(s); }
        return null;
      }
      case 'ended': { // um player chegou ao fim: só vale se o servidor também acha que está no fim
        if (!cur || String(d.item_id) !== cur.id || s.pb.status !== 'playing') return { stale: true };
        const exp = expectedPos(s.pb, now(), dur), pd = +d.dur > 0 ? +d.dur : 0; // pd: duração no player de quem relatou
        if (dur > 0 ? exp >= dur - 5 || (pd > 0 && exp >= pd - 3 && canControl(s, uid)) : canControl(s, uid) || (pd > 0 && exp >= pd - 3)) { advance(s, 'ended'); return {}; }
        return { stale: true };
      }
      default: fail('comando desconhecido');
    }
  }

  // ---------- ganchos da voz ----------
  function onVoiceJoin(uid, cid) {
    const s = sessions.get(cid); if (!s) return;
    const m = s.members.get(uid);
    if (m && !m.online) { join(s, uid); broadcast(s, { rejoined: uid }); return; }
    sendTo(uid, 'WATCH_STATE', pub(s));
  }
  function onVoiceLeave(uid, cid, reason) {
    const s = sessions.get(cid); if (!s || !s.members.has(uid)) return;
    if (reason !== 'drop' && reason !== 'reload') return removeMember(s, uid, 'voice_leave'); // 'reload': página recarregando para a versão nova (volta sozinha)
    const m = s.members.get(uid); m.online = false; m.leftAt = now(); // continua autorizado (controllers) ao voltar
    if (s.host === uid) {
      clearTimeout(s.hostTimer);
      s.hostTimer = setTimeout(() => { s.hostTimer = null; if (sessions.get(cid) === s && !s.members.get(uid)?.online) transferHost(s, pickHost(s, uid), 'left'); }, hostGraceMs);
    }
    if (!online(s).length) armEmpty(s);
    broadcast(s, { dropped: uid });
  }
  const summary = (cid) => { const s = sessions.get(cid); return s && { id: s.id, host: s.host, title: s.current?.title || null, service: s.current?.service || s.service, members: online(s).map(([id]) => id) }; };
  const stopAll = () => { for (const s of [...sessions.values()]) end(s, 'shutdown'); };
  return { handle, onVoiceJoin, onVoiceLeave, summary, stopAll, _sessions: sessions };
}
