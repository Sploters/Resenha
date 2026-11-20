// O SFU que o app usa: no processo da voz (server/voz.js, IPC: server/sfuproxy.js) quando o app roda como filho dele,
// ou no mesmo processo (server/sfu.js) com `node server/index.js` sozinho (desenvolvimento e testes).
const split = process.env.LC_VOZ_IPC === '1' && typeof process.send === 'function';
const impl = split ? await import('./sfuproxy.js') : await import('./sfu.js');
const none = () => null;
export const sfuSplit = split;
export const { startSfu, sfuEnabled, sfuJoin, sfuLeave, sfuModerate, sfuDropVideo, sfuRequest, sfuAttachRtp, sfuAttachNative, sfuLoad, sfuWorkers, sfuEvents, onSfuEvent, sfuLastVoice } = impl;
// só no modo separado (no mesmo processo não há o que retomar: reiniciar o app derruba as chamadas, como antes)
export const sfuRestore = impl.sfuRestore || (async () => null);
export const sfuAdopt = impl.sfuAdopt || none;
export const sfuSnapshot = impl.sfuSnapshot || (async () => null);
