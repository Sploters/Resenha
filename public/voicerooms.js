// Salas de voz para gamers, lado do app (servidor: server/voicerooms.js):
// - senha: pergunta antes de entrar (e de novo se o servidor recusar) e guarda na memória desta página (voice.roomPass);
// - limite: "2/5" e cadeado na barra lateral; sala cheia avisa sem montar o microfone;
// - pedir a vez: mão levantada na sala, na ordem em que cada um pediu; quem modera voz baixa a de qualquer um;
// - orador prioritário: "Falar com prioridade" (só com a permissão); enquanto fala, os apps dos outros abaixam as demais vozes;
// - sussurro: escolher pessoas (ou um cargo) da sala; só elas ouvem até parar. Quem recebe vê "X está sussurrando para você".
import { h, icon } from './util.js';
import { S, guild, member, nameOf, can, PERM, toast, modal, channelById } from './state.js';

let voiceRef = null, rerender = () => { };
export function initVoiceRooms(voice, onChange) { voiceRef = voice; rerender = onChange || rerender; }

// ---- senha e limite ----
const bypass = (c) => !!c?.guild_id && (can(c.guild_id, PERM.MANAGE_CHANNELS) || can(c.guild_id, PERM.VOICE_MOD));
export const roomCount = (cid) => { let n = 0; for (const v of S.voice.values()) if (v.channel_id === cid && !v.bot) n++; return n; };
export function roomFull(c) {
  const lim = c?.user_limit | 0;
  return lim > 0 && !bypass(c) && roomCount(c.id) >= lim && S.voice.get(S.me.id)?.channel_id !== c.id;
}
export function askRoomPassword(c, wrong = false) {
  return new Promise((res) => {
    const inp = h('input', { type: 'password', maxLength: 64, autocomplete: 'off', name: 'room-pass' });
    let done = false; const fin = (v) => { if (done) return; done = true; res(v); };
    const m = modal(wrong ? 'Senha errada' : 'Sala com senha', c?.name || '', h('label.f', wrong ? 'Tente de novo' : 'Digite a senha da sala', inp),
      [{ label: 'Cancelar', cls: 'link', fn: () => fin(null) }, { label: 'Entrar', fn: () => fin(inp.value) }]);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value) { fin(inp.value); m.close(); } });
  });
}
// antes de entrar: false = não entra (cancelou a senha ou a sala está cheia)
export async function beforeRoomJoin(c, moved) {
  if (!c || c.type !== 2 || moved) return true;
  if (roomFull(c)) { toast(`A sala está cheia (${roomCount(c.id)}/${c.user_limit})`, true); return false; }
  if (c.voice_locked && !bypass(c) && !voiceRef?.roomPass[c.id]) {
    const pw = await askRoomPassword(c); if (!pw) return false;
    voiceRef.roomPass[c.id] = pw;
  }
  return true;
}
// VOICE_DENIED da sala: true se tratou (senha pedida de novo; sala cheia)
export async function onRoomDenied(d, rejoin) {
  if (d.code === 'full') { toast(d.reason, true); return true; }
  if (d.code !== 'need_password' && d.code !== 'wrong_password') return false;
  const c = channelById(d.channel_id);
  delete voiceRef.roomPass[d.channel_id];
  const pw = await askRoomPassword(c, d.code === 'wrong_password'); if (!pw) return true;
  voiceRef.roomPass[d.channel_id] = pw; rejoin(d.channel_id);
  return true;
}
// barra lateral: cadeado e "2/5"
export function roomBadge(c) {
  if (c?.type !== 2) return null;
  const lim = c.user_limit | 0, n = lim ? roomCount(c.id) : 0;
  return [c.voice_locked ? h('span.vr-lock', { title: 'Sala com senha' }, icon('lock', 12)) : null,
    lim ? h('span.vr-cap' + (n >= lim ? '.full' : ''), { title: n >= lim ? 'Sala cheia' : `Até ${lim} pessoas` }, `${n}/${lim}`) : null].filter(Boolean);
}
// configurações do canal (sala de voz): limite e senha. patch() devolve o que mudou para o PATCH /channels/:id
export function roomSettingsFields(c) {
  const lim = h('input', { type: 'number', min: 0, max: 99, value: c.user_limit | 0, style: { width: '90px' } });
  const pw = h('input', { type: 'password', maxLength: 64, autocomplete: 'new-password', name: 'room-pass-new', placeholder: c.voice_locked ? 'Deixe vazio para manter a senha atual' : 'Sem senha' });
  let clear = false;
  const clearBtn = c.voice_locked && h('button.btn.grey.sm', { type: 'button', onclick: () => { clear = !clear; clearBtn.textContent = clear ? 'A senha sai ao salvar (desfazer)' : 'Tirar a senha'; pw.disabled = clear; } }, 'Tirar a senha');
  const el = h('div', h('label.f', 'Limite de pessoas', h('div.vr-row', lim, h('small.mut', '0 = sem limite. Quem gerencia canais ou modera voz entra mesmo com a sala cheia.'))),
    h('label.f', 'Senha da sala', h('div.vr-row', pw, clearBtn || ''), h('small.mut', 'Quem gerencia canais ou modera voz entra sem senha. Quem já acertou não digita de novo até a senha mudar.')));
  return { el, patch() {
    const out = {}, n = Math.max(0, Math.min(99, Math.round(+lim.value || 0)));
    if (n !== (c.user_limit | 0)) out.user_limit = n;
    if (clear) out.password = ''; else if (pw.value.trim()) out.password = pw.value;
    return out;
  } };
}

// ---- pedir a vez ----
export const handsOf = (cid) => [...S.voice.values()].filter(v => v.channel_id === cid && v.hand).sort((a, b) => a.hand - b.hand);
export function toggleHand() {
  if (!voiceRef?.channelId) return;
  voiceRef.hand = !voiceRef.hand; voiceRef.sendState(); rerender();
  if (voiceRef.hand) toast('Mão levantada: quem conduz a call vê que você quer falar');
}
export const lowerHand = (uid) => voiceRef?.send('VOICE_HAND', { user_id: uid });
export function handBadge(v) {
  if (!v?.hand) return null;
  const pos = handsOf(v.channel_id).findIndex(x => x.user_id === v.user_id) + 1;
  return h('span.vr-hand', { title: `Pediu a vez (${pos}º da fila)` }, icon('hand', 13), pos > 1 ? h('small', String(pos)) : null);
}

// ---- orador prioritário ----
export const canPriority = () => { const c = channelById(voiceRef?.channelId); return !!c && (!c.guild_id || can(c.guild_id, PERM.PRIORITY)); };
export function togglePriority() {
  if (!canPriority()) return toast('Você não tem a permissão "Orador prioritário" neste servidor', true);
  voiceRef.prio = !voiceRef.prio; voiceRef.sendState(); rerender();
  toast(voiceRef.prio ? 'Falando com prioridade: enquanto você fala, as outras vozes ficam mais baixas para todos' : 'Prioridade desligada');
}

// ---- sussurro ----
const incoming = new Map(); // quem está sussurrando para mim: uid -> true
export function whisperTo(uids) { if (!voiceRef?.channelId) return; voiceRef.send('VOICE_WHISPER', { to: uids?.length ? uids : null }); }
export const stopWhisper = () => whisperTo(null);
export function onWhisperEvent(t, d) {
  if (t === 'VOICE_WHISPER_OK') { const had = !!voiceRef.whisperTo?.length; voiceRef.whisperTo = d.to?.length ? d.to : null; if (!had && voiceRef.whisperTo) toast('Sussurrando: só ' + voiceRef.whisperTo.map(id => nameOf(id, guildOfRoom())).join(', ') + ' ouve você'); }
  else if (t === 'VOICE_WHISPER_ERR') toast(d.reason, true);
  else if (t === 'VOICE_WHISPER') { if (d.on) incoming.set(d.from, true); else incoming.delete(d.from); }
  else if (t === 'VOICE_HAND_LOWERED') voiceRef.hand = false, toast(`${nameOf(d.by, guildOfRoom())} baixou a sua mão`);
  drawWhisperBar(); rerender();
}
const guildOfRoom = () => channelById(voiceRef?.channelId)?.guild_id;
export function whisperPicker(preset) {
  const cid = voiceRef?.channelId; if (!cid) return;
  const gid = guildOfRoom(), g = guild(gid);
  const people = [...S.voice.values()].filter(v => v.channel_id === cid && !v.bot && v.user_id !== S.me.id);
  if (!people.length) return toast('Não há mais ninguém na sala', true);
  const sel = new Set(preset ? [preset] : voiceRef.whisperTo || []);
  const list = h('div.vr-wlist');
  const roleIds = new Set(people.flatMap(v => member(gid, v.user_id)?.roles || []));
  const roles = (g?.roles || []).filter(r => roleIds.has(r.id) && r.name !== '@everyone');
  const draw = () => list.replaceChildren(...people.map(v => h('label.vr-wp', h('input', { type: 'checkbox', checked: sel.has(v.user_id), onchange: (e) => { e.target.checked ? sel.add(v.user_id) : sel.delete(v.user_id); } }), h('span', nameOf(v.user_id, gid)))));
  draw();
  const roleRow = roles.length && h('div.vr-roles', h('small.mut', 'Cargo:'), roles.map(r => h('button.btn.grey.sm', { type: 'button', style: { borderLeft: `3px solid ${r.color || 'transparent'}` }, onclick: () => { for (const v of people) if (member(gid, v.user_id)?.roles?.includes(r.id)) sel.add(v.user_id); draw(); } }, r.name)));
  modal('Sussurrar', 'Só quem você escolher ouve a sua voz, até você parar. Os outros da sala não ouvem nada.', h('div', roleRow || '', list), [
    voiceRef.whisperTo && { label: 'Parar de sussurrar', cls: 'red', fn: () => stopWhisper() },
    { label: 'Cancelar', cls: 'link' },
    { label: 'Sussurrar', fn: () => { if (!sel.size) { toast('Escolha pelo menos uma pessoa', true); return false; } whisperTo([...sel]); } },
  ].filter(Boolean));
}
// faixa no topo: "Sussurrando para…" (eu) e "X está sussurrando para você" (quem recebe)
export function drawWhisperBar() {
  let bar = document.getElementById('vr-wbar');
  const gid = guildOfRoom(), out = voiceRef?.whisperTo, inc = [...incoming.keys()];
  if (!voiceRef?.channelId || (!out && !inc.length)) { bar?.remove(); if (!voiceRef?.channelId) incoming.clear(); return; }
  if (!bar) { bar = h('div#vr-wbar.vr-wbar', { role: 'status' }); document.body.append(bar); }
  bar.replaceChildren(
    out && h('div.vr-wout', icon('voice', 16), h('span', 'Sussurrando para ', h('b', out.map(id => nameOf(id, gid)).join(', '))), h('button.btn.sm', { type: 'button', onclick: () => whisperPicker() }, 'Trocar'), h('button.btn.red.sm', { type: 'button', onclick: stopWhisper }, 'Parar')),
    ...inc.map(id => h('div.vr-win', icon('voice', 16), h('span', h('b', nameOf(id, gid)), ' está sussurrando para você'))));
}
export function clearWhisperState() { incoming.clear(); drawWhisperBar(); }
// itens do clique direito em alguém da minha sala
export function roomUserItems(uid) {
  const vs = S.voice.get(uid), cid = voiceRef?.channelId;
  if (!cid || !vs || vs.channel_id !== cid || vs.bot || uid === S.me.id) return [];
  const c = channelById(cid), out = [];
  if (c?.guild_id) out.push({ label: voiceRef.whisperTo?.includes(uid) ? 'Parar de sussurrar' : 'Sussurrar para ' + nameOf(uid, c.guild_id), fn: () => voiceRef.whisperTo?.includes(uid) ? stopWhisper() : whisperTo([...(voiceRef.whisperTo || []), uid]) });
  if (vs.hand && c?.guild_id && can(c.guild_id, PERM.VOICE_MOD)) out.push({ label: 'Baixar a mão', fn: () => lowerHand(uid) });
  return out;
}
