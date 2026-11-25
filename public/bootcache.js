// Abertura instantânea: guarda neste aparelho (IndexedDB) a última mensagem READY do servidor e, na próxima abertura, o
// app monta a tela com ela na hora, enquanto a conexão de verdade (WebSocket) ainda está sendo aberta. Pelo túnel até o
// servidor essa conexão levava de 0,3 s a 1,3 s (trace real, 2026-11-25) e a tela ficava no esqueleto esperando.
// Quando o READY de verdade chega, ele substitui tudo (public/gateway.js). O que depende da conexão (entrar em chamada,
// voltar para a chamada, aviso de versão nova) espera o READY de verdade.
// - vale só para a mesma conta: a cópia é guardada com o hash do token (outra conta ou token novo: ignora);
// - tem validade (7 dias) e sai ao sair da conta ou quando a sessão é recusada;
// - sem IndexedDB ou sem crypto.subtle (página sem HTTPS fora do localhost): não guarda nada, abre como antes.
const DB = 'resenha-boot', STORE = 'snap', KEY = 'ready', MAX_AGE = 7 * 864e5;

function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
const tx = async (mode, fn) => {
  const db = await idb();
  try { return await new Promise((res, rej) => { const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); } finally { db.close(); }
};
async function hashOf(token) {
  if (!token || !globalThis.crypto?.subtle) return null;
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lc-boot:' + token));
  return [...new Uint8Array(b).slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// READY guardado desta conta, já sem o que não pode ser repetido (ver strip), ou null
export async function loadSnap(token) {
  try {
    const k = await hashOf(token); if (!k) return null;
    const s = await tx('readonly', (st) => st.get(KEY));
    if (!s || s.k !== k || Date.now() - s.at > MAX_AGE || typeof s.text !== 'string') return null;
    return strip(JSON.parse(s.text).d);
  } catch { return null; }
}
// o que é só desta conexão ou já foi mostrado: a versão da interface (a guardada é de antes de uma atualização e pediria
// para recarregar), a hora do servidor, os servidores de voz (TURN) e os avisos de amizade desfeita
function strip(d) {
  if (!d || typeof d !== 'object' || !d.user || !Array.isArray(d.guilds)) return null;
  delete d.ui; delete d.now; delete d.ice; d.friend_losses = []; // ice: credencial do TURN é temporária; entrar em chamada já espera o READY de verdade
  return d;
}
// texto cru do READY (e.data do WebSocket): guardado quando o navegador estiver de folga, para não pesar a abertura
let pending = null;
export function saveSnap(token, text) {
  if (!token || typeof text !== 'string' || text.includes('"e2ee:1:')) return; // conteúdo protegido não fica guardado
  const first = !pending; pending = { token, text };
  if (!first) return;
  const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 10000 }) : (f) => setTimeout(f, 2000);
  idle(async () => {
    const p = pending; pending = null;
    try { const k = await hashOf(p.token); if (k) await tx('readwrite', (st) => st.put({ k, at: Date.now(), text: p.text }, KEY)); } catch { }
  });
}
export async function clearSnap() { pending = null; try { await tx('readwrite', (st) => st.delete(KEY)); } catch { } }
