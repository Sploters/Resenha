// Controle remoto (mouse, teclado e controle de videogame). O servidor é o porteiro:
// - a sessão nasce de um PEDIDO de quem assiste e só vale depois do CONSENTIMENTO do dono da tela (no cliente dele);
// - permissões separadas (mouse, teclado, controle de videogame), escolhidas pelo dono;
// - cada evento é validado (formato, faixa, tamanho) e só passa se vier do controlador daquela sessão, com taxa limitada;
// - acaba na hora quando qualquer um para, sai da sala, desconecta ou o dono para de transmitir.
// A injeção em si acontece só no app desktop do dono (programa nativo), nunca no navegador.

export const REMOTE_PENDING_MS = 30 * 1000;
// "Jogar junto" (kind 'pad'): quem assiste entra como jogador 2, 3 ou 4 só com o próprio controle de videogame (sem mouse
// nem teclado); várias ao mesmo tempo, ao lado de uma sessão de controle remoto normal (kind 'control')
export const MAX_PLAYERS = 3, PLAYER_SLOTS = [2, 3, 4];
const MAX_EVENTS_PER_MSG = 64;
const RATE = 400, BURST = 800; // eventos por segundo (movimento já chega agrupado ~60/s)
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/; // KeyboardEvent.code (ex.: KeyA, Digit1, ArrowLeft, F5)

// valida e normaliza um evento; null = descartado
export function cleanEvent(e, perms) {
  if (!e || typeof e !== 'object') return null;
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  switch (e.k) {
    case 'm': { if (!perms.mouse) return null; const x = num(e.x, 0, 1), y = num(e.y, 0, 1); return x === null || y === null ? null : { k: 'm', x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5 }; }
    case 'd': case 'u': { if (!perms.mouse) return null; const b = num(e.b, 0, 2); return b === null || !Number.isInteger(b) ? null : { k: e.k, b }; }
    case 'w': { if (!perms.mouse) return null; const dx = num(e.dx ?? 0, -2400, 2400), dy = num(e.dy ?? 0, -2400, 2400); return dx === null || dy === null || (!dx && !dy) ? null : { k: 'w', dx: Math.round(dx), dy: Math.round(dy) }; }
    case 'kd': case 'ku': { if (!perms.keyboard) return null; return typeof e.c === 'string' && KEY_RE.test(e.c) ? { k: e.k, c: e.c } : null; }
    // controle de videogame: o estado inteiro (botões no "standard mapping" do navegador, 17 bits; 4 eixos -1..1; gatilhos 0..1)
    case 'g': {
      if (!perms.gamepad) return null;
      const b = num(e.b, 0, 0x1ffff), lt = num(e.lt ?? 0, 0, 1), rt = num(e.rt ?? 0, 0, 1);
      if (b === null || !Number.isInteger(b) || lt === null || rt === null || !Array.isArray(e.ax) || e.ax.length !== 4) return null;
      const ax = e.ax.map(v => num(v, -1, 1)); if (ax.includes(null)) return null;
      const r = (v) => Math.round(v * 1e3) / 1e3;
      return { k: 'g', b, ax: ax.map(r), lt: r(lt), rt: r(rt) };
    }
    default: return null;
  }
}

// later: agenda a expiração do pedido (nos testes, um relógio falso chama sweep() direto)
const defaultLater = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
export function createRemote({ voiceOf, sendUser, now = () => Date.now(), newId, later = defaultLater }) {
  const sessions = new Map(); // id -> { id, owner, controller, cid, perms, state, created, bucket, last }
  const pub = (s, reason) => ({ id: s.id, kind: s.kind, owner: s.owner, controller: s.controller, channel_id: s.cid, perms: s.perms, state: s.state, ...(s.slot ? { slot: s.slot } : {}), ...(reason ? { reason } : {}) });
  const tell = (s, reason) => { const p = pub(s, reason); sendUser(s.owner, 'REMOTE_STATE', p); sendUser(s.controller, 'REMOTE_STATE', p); };
  const live = (s) => s.state === 'pending' ? now() - s.created < REMOTE_PENDING_MS : s.state === 'active';
  const of = (uid) => [...sessions.values()].filter(s => live(s) && (s.owner === uid || s.controller === uid));
  const end = (s, reason) => { if (s.state === 'ended') return; s.state = 'ended'; sessions.delete(s.id); tell(s, reason); };

  // pedido sem resposta passou do prazo: encerra AVISANDO os dois lados. Antes só era apagado em silêncio no próximo pedido,
  // e quem pediu ficava com a sessão "pendente" na tela até reconectar ("Já existe uma sessão de controle remoto")
  function sweep() { for (const s of [...sessions.values()]) if (!live(s)) { if (s.state === 'pending') end(s, 'expired'); else sessions.delete(s.id); } }

  function request(from, to, kind = 'control') {
    sweep();
    kind = kind === 'pad' ? 'pad' : 'control';
    const a = voiceOf(from), b = voiceOf(to);
    if (!to || to === from) return { error: 'Pedido inválido' };
    if (!a || !b || a.cid !== b.cid) return { error: 'Vocês precisam estar na mesma sala de voz' };
    if (!b.screen) return { error: 'A pessoa precisa estar transmitindo a tela' };
    if (of(from).length) return { error: of(from).some(x => x.kind === 'pad' && x.controller === from) ? 'Você já está jogando (ou pediu para jogar) numa transmissão' : 'Você já está numa sessão de controle remoto' };
    const owned = of(to).filter(x => x.owner === to);
    if (kind === 'control' && (owned.some(x => x.kind === 'control') || of(to).some(x => x.controller === to))) return { error: 'Essa pessoa já está numa sessão de controle remoto' };
    if (kind === 'pad' && owned.filter(x => x.kind === 'pad').length >= MAX_PLAYERS) return { error: 'Essa transmissão já tem 4 jogadores' };
    const s = { id: newId(), kind, owner: to, controller: from, cid: a.cid, perms: { mouse: false, keyboard: false, gamepad: false }, state: 'pending', created: now(), bucket: BURST, last: now() };
    sessions.set(s.id, s);
    sendUser(to, 'REMOTE_REQUEST', pub(s));
    sendUser(from, 'REMOTE_STATE', pub(s));
    later(sweep, REMOTE_PENDING_MS + 100);
    return { session: pub(s) };
  }

  // resposta do dono (no cliente dele). Sem o programa nativo (navegador comum), o cliente responde capable:false.
  function answer(uid, id, { accept, mouse, keyboard, gamepad, capable }) {
    const s = sessions.get(String(id));
    if (s && s.state === 'pending' && !live(s)) end(s, 'expired');
    if (!s || s.owner !== uid || s.state !== 'pending' || !live(s)) return { error: 'Pedido não encontrado ou expirado' };
    if (!accept) { end(s, capable === false ? 'unsupported' : 'declined'); return {}; }
    // jogador: só o controle, nunca mouse nem teclado (mesmo que o cliente mande)
    const perms = s.kind === 'pad' ? { mouse: false, keyboard: false, gamepad: true } : { mouse: !!mouse, keyboard: !!keyboard, gamepad: !!gamepad };
    if (!perms.mouse && !perms.keyboard && !perms.gamepad) { end(s, 'declined'); return {}; }
    const v = voiceOf(uid);
    if (!v || v.cid !== s.cid || !v.screen) { end(s, 'stream_ended'); return {}; }
    if (s.kind === 'pad') { // vaga: o menor número livre (quem sai libera a dele)
      const used = new Set([...sessions.values()].filter(x => x !== s && x.kind === 'pad' && x.owner === uid && x.state === 'active').map(x => x.slot));
      s.slot = PLAYER_SLOTS.find(n => !used.has(n)); if (!s.slot) { end(s, 'full'); return {}; }
    }
    s.perms = perms; s.state = 'active'; s.bucket = BURST; s.last = now();
    tell(s);
    return { session: pub(s) };
  }

  // eventos do controlador -> dono; o que não passa é descartado em silêncio (o retorno conta, para testes)
  function input(uid, id, events) {
    const s = sessions.get(String(id));
    if (!s || s.state !== 'active' || s.controller !== uid) return { dropped: Array.isArray(events) ? events.length : 0, sent: 0 };
    if (!Array.isArray(events)) return { dropped: 1, sent: 0 };
    const t = now(); s.bucket = Math.min(BURST, s.bucket + (t - s.last) / 1000 * RATE); s.last = t;
    const out = [];
    for (const e of events.slice(0, MAX_EVENTS_PER_MSG)) {
      if (s.bucket < 1) break;
      const c = cleanEvent(e, s.perms); if (!c) continue;
      s.bucket -= 1; out.push(c);
    }
    if (out.length) sendUser(s.owner, 'REMOTE_INPUT', { id: s.id, ev: out });
    return { sent: out.length, dropped: events.length - out.length };
  }

  function stop(uid, id, reason = 'stopped') {
    const s = sessions.get(String(id));
    if (!s || (s.owner !== uid && s.controller !== uid)) return { error: 'Sessão não encontrada' };
    end(s, uid === s.owner && reason === 'panic' ? 'panic' : s.state === 'pending' && uid === s.controller ? 'cancelled' : 'stopped'); return {}; // "panic" = atalho de emergência no PC do dono
  }
  // saiu da sala, desconectou ou parou de transmitir: encerra o que envolver a pessoa
  function onLeave(uid) { sweep(); for (const s of of(uid)) end(s, 'left'); }
  function onScreenOff(uid) { for (const s of of(uid)) if (s.owner === uid) end(s, 'stream_ended'); }

  return { request, answer, input, stop, onLeave, onScreenOff, sweep, _sessions: sessions };
}
