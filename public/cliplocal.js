// Clipes guardados SÓ neste aparelho (como no Discord): o vídeo fica no IndexedDB do app/navegador e nada sobe para o
// servidor até a pessoa escolher compartilhar (+ do campo de mensagem → Compartilhar um clipe). Sem imports de UI.
const DB = 'resenha-clips', ST = 'clips';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(ST, { keyPath: 'id' }); s.createIndex('created', 'created'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { dbp = null; no(r.error); };
  });
  // pede para o navegador não apagar os clipes sozinho quando o disco aperta (no app desktop já é persistente)
  navigator.storage?.persist?.().catch(() => { });
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction(ST, mode), s = t.objectStore(ST); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => ok(out); t.onerror = () => no(t.error); t.onabort = () => no(t.error || new Error('Sem espaço para guardar o clipe'));
  });
};
const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const listeners = new Set();
export const onLocalClips = (f) => (listeners.add(f), () => listeners.delete(f));
const changed = () => listeners.forEach(f => { try { f(); } catch { } });

// miniatura: um quadro do começo do vídeo, 320×180 em JPEG (a lista não precisa abrir o vídeo para mostrar)
export async function makeThumb(blob) {
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; setTimeout(no, 6000); });
    v.currentTime = Math.min(1, (v.duration || 2) / 2); await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 1500); });
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'), w = v.videoWidth || 16, hh = v.videoHeight || 9, k = Math.min(320 / w, 180 / hh);
    g.fillStyle = '#000'; g.fillRect(0, 0, 320, 180); g.drawImage(v, (320 - w * k) / 2, (180 - hh * k) / 2, w * k, hh * k);
    return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.75));
  } catch { return null; } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// clip: { blob, title, secs, streamerId, who, game, hasAudio, guildId, channelId }
export async function addLocalClip(clip) {
  const rec = { id: newId(), created: Date.now(), ...clip, size: clip.blob.size, thumb: null };
  await tx('readwrite', (s) => s.put(rec));
  changed();
  makeThumb(clip.blob).then((thumb) => thumb && updateLocalClip(rec.id, { thumb })).catch(() => { });
  return rec.id;
}
export const getLocalClip = (id) => tx('readonly', (s) => req(s.get(id)));
// a lista vem sem os vídeos na memória: o IndexedDB entrega o Blob como referência ao arquivo em disco
export const listLocalClips = async () => (await tx('readonly', (s) => req(s.getAll()))).sort((a, b) => b.created - a.created);
export async function updateLocalClip(id, patch) {
  await tx('readwrite', async (s) => { const cur = await req(s.get(id)); if (cur) s.put({ ...cur, ...patch, ...(patch.blob ? { size: patch.blob.size } : {}) }); });
  changed();
}
export async function deleteLocalClip(id) { await tx('readwrite', (s) => s.delete(id)); changed(); }
export async function clearLocalClips() { await tx('readwrite', (s) => s.clear()); changed(); }
export async function localClipsUsage() { const l = await listLocalClips().catch(() => []); return { count: l.length, bytes: l.reduce((n, c) => n + (c.size || 0), 0) }; }
