// O SFU visto do app quando ele roda como filho do processo da voz (server/voz.js): a mesma API do server/sfu.js, só que
// cada operação vira um pedido por IPC. As consultas síncronas (sfuEnabled, sfuWorkers, sfuEvents, sfuLastVoice) leem o
// estado que o processo da voz manda a cada 2 s. Os eventos do SFU para uma pessoa (notify) chegam por aqui e vão para a
// função registrada no sfuJoin (ou no sfuAdopt, para quem já estava na sala quando o app reiniciou).
import { EventEmitter } from 'node:events';

let seq = 0, info = { enabled: false, workers: [], events: [], lastVoice: {} }, onEvt = () => { };
const pend = new Map(), notifies = new Map(), natives = new Map(); // natives: h -> producer (proxy)
const key = (cid, uid) => cid + '|' + uid;

process.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.re) { const p = pend.get(m.re); if (!p) return; pend.delete(m.re); clearTimeout(p.t); if (m.error) p.rej(new Error(m.error)); else p.res(m.data); return; }
  if (m.ev === 'notify') { try { notifies.get(key(m.cid, m.uid))?.(m.t, m.d); } catch (e) { console.error('sfu notify', e); } }
  else if (m.ev === 'info') info = m.info;
  else if (m.ev === 'sfu_event') { try { onEvt(m.kind, m.text); } catch { } }
  else if (m.ev === 'native_closed') { const p = natives.get(m.h); if (p) { natives.delete(m.h); p.closed = true; p.observer.emit('close'); } }
});
// o processo da voz sumiu (não deveria: ele é o pai): sem ele não há chamada nenhuma, então o app sai junto
process.on('disconnect', () => { console.error('  processo da voz desconectou: encerrando o app'); process.exit(1); });

function call(name, ...args) {
  return new Promise((res, rej) => {
    const id = ++seq;
    const t = setTimeout(() => { pend.delete(id); rej(new Error('o processo da voz não respondeu')); }, 20e3);
    pend.set(id, { res, rej, t });
    try { process.send({ id, call: name, args }); } catch (e) { clearTimeout(t); pend.delete(id); rej(e); }
  });
}
const quiet = (p) => { p.catch(() => { }); };

export const sfuSplit = true;
export async function startSfu() { const r = await call('hello'); info = r.info; return info.enabled; }
export const sfuEnabled = () => info.enabled;
export const sfuWorkers = () => info.workers;
export const sfuEvents = () => info.events;
export const onSfuEvent = (fn) => { onEvt = fn; };
export const sfuLastVoice = (cid) => info.lastVoice?.[cid] || 0;
export const sfuLoad = () => call('load');
export function sfuJoin(cid, uid, notify) { notifies.set(key(cid, uid), notify); return call('join', cid, uid); }
export function sfuLeave(cid, uid) { notifies.delete(key(cid, uid)); quiet(call('leave', cid, uid)); }
export function sfuModerate(cid, uid, o) { quiet(call('moderate', cid, uid, o)); }
export function sfuDropVideo(cid, uid) { quiet(call('dropVideo', cid, uid)); }
export const sfuRequest = (cid, uid, op, d) => call('request', cid, uid, op, d);
export async function sfuAttachRtp(cid, uid) {
  const r = await call('attachRtp', cid, uid);
  return { ...r, close: () => quiet(call('detach', r.h)) };
}
// transmissão nativa: o "producer" daqui é uma sombra do de lá (id, closed, getStats e o aviso de fechado)
function nativeHandle(r) {
  const producer = { id: r.producer_id, closed: false, observer: new EventEmitter(), getStats: () => call('pstats', r.h) };
  natives.set(r.h, producer);
  return { ...r, producer, close: () => { natives.delete(r.h); producer.closed = true; quiet(call('detach', r.h)); } };
}
export async function sfuAttachNative(cid, uid, layers) { return nativeHandle(await call('attachNative', cid, uid, layers)); }

// ---- reinício do app sem derrubar as chamadas (server/index.js restoreVoice) ----
// quem está em cada sala no processo da voz, o último retrato que este app mandou e as transmissões nativas vivas
export async function sfuRestore() {
  const s = await call('state');
  return { ...s, natives: (s.natives || []).map(nativeHandle) };
}
// quem já estava na sala: os eventos do SFU para essa pessoa voltam a ter para onde ir
export function sfuAdopt(cid, uid, notify) { notifies.set(key(cid, uid), notify); }
export const sfuSnapshot = (data) => call('snapshot', data);
