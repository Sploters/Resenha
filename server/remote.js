// Controle remoto (mouse, teclado e controle de videogame). O servidor é o porteiro:
// - a sessão nasce de um PEDIDO de quem assiste e só vale depois do CONSENTIMENTO do dono da tela (no cliente dele);
// - permissões separadas (mouse, teclado, controle de videogame), escolhidas pelo dono;
// - cada evento é validado (formato, faixa, tamanho) e só passa se vier do controlador daquela sessão, com taxa limitada;
// - acaba na hora quando qualquer um para, sai da sala, desconecta ou o dono para de transmitir.
// A injeção em si acontece só no app desktop do dono (programa nativo), nunca no navegador.

export const REMOTE_PENDING_MS = 30 * 1000, INVITE_MS = 60 * 1000;
// Participação ("Pedir para jogar", kind 'play'): quem assiste entra como Player 2, 3 ou 4 (o dono é o Player 1; no máximo
// 4 no total). Permissões independentes (controle, teclado, mouse), escolhidas e alteráveis a qualquer momento pelo dono;
// só um jogador com o mouse por vez (o cursor é um só). Pedido de quem assiste ou convite do dono.
// Tipos antigos, ainda aceitos de páginas abertas antes da atualização: 'control' (uma pessoa, mouse/teclado/controle, sem
// vaga) e 'pad' (vaga 2-4, só controle). 'pad' e 'play' dividem as vagas.
export const MAX_PLAYERS = 3, PLAYER_SLOTS = [2, 3, 4];
const MAX_EVENTS_PER_MSG = 64;
const RATE = 400, BURST = 800; // eventos por segundo (movimento já chega agrupado ~60/s)
import { cleanEvent } from '../public/remoteclean.js';
export { cleanEvent };

// later: agenda a expiração do pedido (nos testes, um relógio falso chama sweep() direto)
const defaultLater = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
const NONE = () => ({ mouse: false, keyboard: false, gamepad: false });
const slotted = (k) => k === 'pad' || k === 'play';
export function createRemote({ voiceOf, sendUser, now = () => Date.now(), newId, later = defaultLater }) {
  const sessions = new Map(); // id -> { id, kind, owner, controller, cid, perms, state, created, bucket, last, slot?, invite? }
  const pub = (s, reason) => ({ id: s.id, kind: s.kind, owner: s.owner, controller: s.controller, channel_id: s.cid, perms: s.perms, state: s.state, ...(s.caps?.rel ? { caps: { rel: true } } : {}), ...(s.slot ? { slot: s.slot } : {}), ...(s.invite ? { invite: true } : {}), ...(reason ? { reason } : {}) });
  const tell = (s, reason) => { const p = pub(s, reason); sendUser(s.owner, 'REMOTE_STATE', p); sendUser(s.controller, 'REMOTE_STATE', p); };
  const live = (s) => s.state === 'pending' ? now() - s.created < (s.invite ? INVITE_MS : REMOTE_PENDING_MS) : s.state === 'active';
  const of = (uid) => [...sessions.values()].filter(s => live(s) && (s.owner === uid || s.controller === uid));
  const guests = (owner) => [...sessions.values()].filter(s => live(s) && s.owner === owner && slotted(s.kind));
  const end = (s, reason) => { if (s.state === 'ended') return; s.state = 'ended'; sessions.delete(s.id); tell(s, reason); };

  // pedido sem resposta passou do prazo: encerra AVISANDO os dois lados. Antes só era apagado em silêncio no próximo pedido,
  // e quem pediu ficava com a sessão "pendente" na tela até reconectar ("Já existe uma sessão de controle remoto")
  function sweep() { for (const s of [...sessions.values()]) if (!live(s)) { if (s.state === 'pending') end(s, 'expired'); else sessions.delete(s.id); } }

  // quem pode entrar na transmissão de "to" (pedido ou convite): mesma sala, "to" transmitindo, sem sessão aberta, com vaga
  function canJoin(player, owner, kind) {
    const a = voiceOf(player), b = voiceOf(owner);
    if (!owner || !player || owner === player) return 'Pedido inválido';
    if (!a || !b || a.cid !== b.cid) return 'Vocês precisam estar na mesma sala de voz';
    if (!b.screen) return 'A pessoa precisa estar transmitindo a tela';
    if (of(player).length) return of(player).some(x => slotted(x.kind) && x.controller === player) ? 'Você já está jogando (ou pediu para jogar) numa transmissão' : 'Você já está numa sessão de controle remoto';
    const owned = of(owner).filter(x => x.owner === owner);
    if (kind === 'control' && (owned.some(x => x.kind === 'control') || of(owner).some(x => x.controller === owner))) return 'Essa pessoa já está numa sessão de controle remoto';
    if (slotted(kind) && guests(owner).length >= MAX_PLAYERS) return 'Essa transmissão já tem 4 jogadores';
    return null;
  }
  const freeSlot = (owner, s) => { const used = new Set(guests(owner).filter(x => x !== s && x.state === 'active').map(x => x.slot)); return PLAYER_SLOTS.find(n => !used.has(n)); };
  // só um jogador com o mouse: quem recebe agora tira de quem tinha (o outro é avisado pelo REMOTE_STATE)
  function takeMouse(owner, s) {
    for (const x of of(owner)) if (x !== s && x.owner === owner && x.state === 'active' && x.perms.mouse) { x.perms = { ...x.perms, mouse: false }; tell(x, 'mouse_moved'); }
  }
  function activate(s, perms) {
    const v = voiceOf(s.owner);
    if (!v || v.cid !== s.cid || !v.screen) { end(s, 'stream_ended'); return { error: 'A transmissão acabou' }; }
    if (slotted(s.kind)) { s.slot = freeSlot(s.owner, s); if (!s.slot) { end(s, 'full'); return { error: 'Essa transmissão já tem 4 jogadores' }; } }
    if (perms.mouse) takeMouse(s.owner, s);
    s.perms = perms; s.state = 'active'; s.bucket = BURST; s.last = now(); s.invite = false;
    tell(s);
    return { session: pub(s) };
  }

  function request(from, to, kind = 'control') {
    sweep();
    kind = kind === 'pad' || kind === 'play' ? kind : 'control';
    const err = canJoin(from, to, kind); if (err) return { error: err };
    const s = { id: newId(), kind, owner: to, controller: from, cid: voiceOf(from).cid, perms: NONE(), state: 'pending', created: now(), bucket: BURST, last: now() };
    sessions.set(s.id, s);
    sendUser(to, 'REMOTE_REQUEST', pub(s));
    sendUser(from, 'REMOTE_STATE', pub(s));
    later(sweep, REMOTE_PENDING_MS + 100);
    return { session: pub(s) };
  }
  // convite do dono para quem está na sala: a pessoa aceita (joinInvite) e entra com as permissões que o dono escolheu
  function invite(owner, to, { mouse, keyboard, gamepad = true, rel } = {}) {
    sweep();
    const err = canJoin(to, owner, 'play'); if (err) return { error: err === 'Você já está jogando (ou pediu para jogar) numa transmissão' || err === 'Você já está numa sessão de controle remoto' ? 'Essa pessoa já está jogando ou tem um pedido aberto' : err };
    const s = { id: newId(), kind: 'play', owner, controller: to, cid: voiceOf(owner).cid, perms: { mouse: !!mouse, keyboard: !!keyboard, gamepad: !!gamepad }, caps: { rel: !!rel }, state: 'pending', invite: true, created: now(), bucket: BURST, last: now() };
    sessions.set(s.id, s);
    tell(s);
    later(sweep, INVITE_MS + 100);
    return { session: pub(s) };
  }
  function joinInvite(uid, id, accept) {
    const s = sessions.get(String(id));
    if (s && s.state === 'pending' && !live(s)) end(s, 'expired');
    if (!s || !s.invite || s.controller !== uid || s.state !== 'pending') return { error: 'Convite não encontrado ou expirado' };
    if (!accept) { end(s, 'invite_declined'); return {}; }
    return activate(s, { ...s.perms });
  }

  // resposta do dono (no cliente dele). Sem o programa nativo (navegador comum), o cliente responde capable:false.
  function answer(uid, id, { accept, mouse, keyboard, gamepad, capable, rel }) {
    const s = sessions.get(String(id));
    if (s && s.state === 'pending' && !live(s)) end(s, 'expired');
    if (!s || s.invite || s.owner !== uid || s.state !== 'pending' || !live(s)) return { error: 'Pedido não encontrado ou expirado' };
    if (!accept) { end(s, capable === false ? 'unsupported' : 'declined'); return {}; }
    // 'pad': só o controle, nunca mouse nem teclado (mesmo que o cliente mande)
    const perms = s.kind === 'pad' ? { mouse: false, keyboard: false, gamepad: true } : { mouse: !!mouse, keyboard: !!keyboard, gamepad: !!gamepad };
    if (s.kind === 'control' && !perms.mouse && !perms.keyboard && !perms.gamepad) { end(s, 'declined'); return {}; }
    if (s.kind === 'play') s.caps = { rel: !!rel }; // o app de quem transmite aceita mouse relativo (lc-input novo)
    return activate(s, perms);
  }
  // o dono muda as permissões de um jogador no meio da sessão (tudo desligado = continua na sessão, sem controlar nada)
  function setPerms(uid, id, { mouse, keyboard, gamepad }) {
    const s = sessions.get(String(id));
    if (!s || s.owner !== uid || s.state !== 'active' || s.kind === 'pad') return { error: 'Jogador não encontrado' };
    const perms = { mouse: !!mouse, keyboard: !!keyboard, gamepad: !!gamepad };
    if (perms.mouse && !s.perms.mouse) takeMouse(uid, s);
    s.perms = perms; tell(s, 'perms');
    return { session: pub(s) };
  }
  // reconectou (VOICE_RESUME): o app perdeu o estado; manda de novo o de cada sessão da pessoa
  function resync(uid) { for (const s of of(uid)) sendUser(uid, 'REMOTE_STATE', pub(s)); }

  // eventos do controlador -> dono; o que não passa é descartado em silêncio (o retorno conta, para testes)
  function input(uid, id, events) {
    const s = sessions.get(String(id));
    if (!s || s.state !== 'active' || s.controller !== uid) return { dropped: Array.isArray(events) ? events.length : 0, sent: 0 };
    if (!Array.isArray(events)) return { dropped: 1, sent: 0 };
    const t = now(); s.bucket = Math.min(BURST, s.bucket + (t - s.last) / 1000 * RATE); s.last = t;
    const out = [];
    for (const e of events.slice(0, MAX_EVENTS_PER_MSG)) {
      if (s.bucket < 1) break;
      const c = cleanEvent(e, s.caps?.rel ? { ...s.perms, rel: true } : s.perms); if (!c) continue;
      s.bucket -= 1; out.push(c);
    }
    if (out.length) sendUser(s.owner, 'REMOTE_INPUT', { id: s.id, ev: out });
    return { sent: out.length, dropped: events.length - out.length };
  }

  // eco para medir o caminho dos comandos (painel Desempenho): REMOTE_PING/REMOTE_PONG entre as duas pontas de uma sessão
  // ativa, pelo mesmo caminho do REMOTE_INPUT. t: o relógio de quem mediu (volta igual); h: resumo do anfitrião (números do
  // envio dele, para o painel de quem joga). Nada além disso passa
  function echo(uid, id, kind, d) {
    const s = sessions.get(String(id));
    if (!s || s.state !== 'active' || (s.owner !== uid && s.controller !== uid) || typeof d?.t !== 'number' || !Number.isFinite(d.t)) return { dropped: 1 };
    const h = d.h && typeof d.h === 'object' && !Array.isArray(d.h) && JSON.stringify(d.h).length <= 800 ? d.h : undefined;
    sendUser(uid === s.owner ? s.controller : s.owner, kind === 'pong' ? 'REMOTE_PONG' : 'REMOTE_PING', { id: s.id, t: d.t, ...(h && kind === 'pong' ? { h } : {}) });
    return {};
  }
  // canal direto dos comandos (DataChannel pelo SFU, ver sfu.js produce_data): quem joga avisa que o canal existe (ready) e
  // quem transmite avisa que está recebendo por ele (on) ou que parou (off). Só sinais entre as duas pontas da sessão ativa
  function dc(uid, id, d) {
    const s = sessions.get(String(id));
    if (!s || s.state !== 'active' || (s.owner !== uid && s.controller !== uid)) return { dropped: 1 };
    const out = uid === s.controller ? { ready: d?.ready === true } : { on: d?.on === true };
    sendUser(uid === s.owner ? s.controller : s.owner, 'REMOTE_DC', { id: s.id, ...out });
    return {};
  }
  function stop(uid, id, reason = 'stopped') {
    const s = sessions.get(String(id));
    if (!s || (s.owner !== uid && s.controller !== uid)) return { error: 'Sessão não encontrada' };
    // "panic" = atalho de emergência no PC do dono; cancelar o próprio pedido/convite pendente
    end(s, uid === s.owner && reason === 'panic' ? 'panic' : s.state === 'pending' && uid === (s.invite ? s.owner : s.controller) ? 'cancelled' : 'stopped'); return {};
  }
  // saiu da sala, desconectou ou parou de transmitir: encerra o que envolver a pessoa
  function onLeave(uid) { sweep(); for (const s of of(uid)) end(s, 'left'); }
  function onScreenOff(uid) { for (const s of of(uid)) if (s.owner === uid) end(s, 'stream_ended'); }

  return { request, invite, joinInvite, answer, setPerms, resync, input, echo, dc, stop, onLeave, onScreenOff, sweep, _sessions: sessions };
}
