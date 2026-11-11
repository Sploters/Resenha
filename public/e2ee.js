// Criptografia de ponta a ponta nas conversas diretas (1:1), feita no aparelho com a WebCrypto do navegador.
// - Cada pessoa tem um par de chaves P-256 (ECDH). A pública vai para o servidor; a privada vai EMBRULHADA com uma frase
//   que só a pessoa sabe (PBKDF2-SHA256 600 mil voltas → AES-GCM). Em cada aparelho a frase é digitada uma vez: a chave
//   aberta fica no IndexedDB deste aparelho como CryptoKey não exportável (nem o próprio app consegue copiá-la).
// - A chave de uma conversa = ECDH(minha privada, pública da outra pessoa) → HKDF-SHA256 (info = id da conversa) → AES-GCM.
//   Mensagem: "e2ee:1:<kid de quem enviou>.<kid de quem recebe>:<iv>:<cifrado>", com o id da conversa e os dois kids
//   amarrados como dados autenticados (mudar qualquer coisa invalida a mensagem).
// - kid = 16 primeiros bytes do SHA-256 da chave pública: o app confere a chave que o servidor entrega contra o kid.
// - Número de segurança: os dois comparam (pessoalmente ou por outro meio) para ter certeza de que o servidor não trocou
//   as chaves no meio do caminho. Se a chave de alguém mudar depois da verificação, a conversa avisa.
// - Arquivos: cifrados no aparelho antes de subir, com uma chave aleatória por arquivo (AES-GCM em pedaços de 4 MB); o
//   servidor recebe "protegido.bin" e a chave, o nome e o tipo de verdade vão dentro da mensagem cifrada.
// - Chamadas: cada quadro de áudio e vídeo é cifrado no worker public/e2ee-worker.js com a chave da chamada (callKey).
// Limites (ditos na tela): não tem sigilo futuro como o Signal (a mesma chave vale até ser trocada), reações e grupos não
// entram, busca e tradução não funcionam nas mensagens protegidas. O servidor ainda vê quem fala com quem, quando e o
// tamanho dos arquivos.
import { h, icon } from './util.js';
import { S, modal, toast, confirmBox, savePrefs, channelById } from './state.js';

const ITER = 600000, SALT_TAG = 'resenha-e2ee-dm-v1', WRAP_TAG = 'resenha-e2ee-wrap|';
const PREFIX = 'e2ee:1:', RE = /^e2ee:1:([0-9a-f]{32})\.([0-9a-f]{32}):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;
export const LOCKED_TEXT = '🔒 Mensagem protegida — desbloqueie a criptografia neste aparelho para ler';
const ERR_TEXT = '🔒 Não foi possível abrir esta mensagem protegida';
const GONE_TEXT = '🔒 Mensagem protegida com uma chave que foi apagada';
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = globalThis.crypto?.subtle;
export const e2eeSupported = () => !!subtle && !!globalThis.indexedDB;

const E = {
  loaded: null,        // promessa do carregamento (minhas chaves no servidor + as abertas neste aparelho)
  mine: [],            // minhas chaves no servidor: [{ kid, pub, wrapped, active, created_at }]
  open: new Map(),     // kid -> CryptoKey privada aberta neste aparelho
  peers: new Map(),    // uid -> Promise<{ kid, pub } | null> (chave ativa)
  kids: new Map(),     // kid -> Promise<{ kid, user_id, pub } | null>
  aes: new Map(),      // `${meu kid}|${kid dela}|${cid}` -> Promise<CryptoKey>
  plain: new Map(),    // texto cifrado -> resultado (para não decifrar de novo a mesma coisa)
};

// ---------- utilidades ----------
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function kidOf(pubB64) { return hex(await subtle.digest('SHA-256', unb64(pubB64))).slice(0, 32); }
async function raw(method, path, body) { // chamada direta (sem passar pelo api() de state.js, que chama este módulo)
  const r = await fetch('/api' + path, { method, headers: { Authorization: 'Bearer ' + (S.token || ''), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || 'Erro ' + r.status); e.status = r.status; throw e; } return d;
}

// ---------- IndexedDB: chaves abertas neste aparelho ----------
function idb() {
  return new Promise((res, rej) => { const q = indexedDB.open('resenha-e2ee', 1); q.onupgradeneeded = () => q.result.createObjectStore('keys'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try { return await new Promise((res, rej) => { const tx = db.transaction('keys', mode), st = tx.objectStore('keys'); const r = fn(st); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); } finally { db.close(); }
}
const idbAll = () => idbDo('readonly', st => st.getAll()).catch(() => []);
const idbPut = (k, v) => idbDo('readwrite', st => st.put(v, k));
const idbClear = (uid) => idbDo('readwrite', st => { const c = st.openCursor(); c.onsuccess = () => { const x = c.result; if (!x) return; if (x.value?.uid === uid) x.delete(); x.continue(); }; return c; }).catch(() => { });

// ---------- carregar ----------
export function e2eeLoad(force) {
  if (!S.me || !e2eeSupported()) return Promise.resolve();
  if (E.loaded && !force) return E.loaded;
  E.loaded = (async () => {
    const r = await raw('GET', '/e2ee/me').catch(() => null);
    E.mine = r?.keys || [];
    const have = new Set(E.mine.map(k => k.kid)); E.open.clear();
    for (const x of await idbAll()) if (x?.uid === S.me.id && have.has(x.kid) && x.priv) E.open.set(x.kid, x.priv);
    document.dispatchEvent(new Event('e2ee-changed'));
  })();
  return E.loaded;
}
const myActive = () => E.mine.find(k => k.active) || null;
// 'unsupported' | 'off' (nunca ativou) | 'paused' | 'locked' (ativa mas fechada neste aparelho) | 'on'
export function e2eeState() {
  if (!e2eeSupported()) return 'unsupported';
  if (!E.mine.length) return 'off';
  if (E.mine.some(k => !E.open.has(k.kid))) return 'locked';
  return myActive() ? 'on' : 'paused';
}
export const myFingerprintKey = () => myActive();

// ---------- frase ----------
async function passKey(pass, salt, iter) {
  const base = await subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrapPkcs8(pkcs8, kid, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await passKey(pass, salt, ITER);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(WRAP_TAG + kid) }, k, pkcs8);
  return { v: 1, salt: b64(salt), iter: ITER, iv: b64(iv), ct: b64(ct) };
}
async function unwrapPkcs8(w, kid, pass) {
  const k = await passKey(pass, unb64(w.salt), w.iter);
  return subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv), additionalData: enc.encode(WRAP_TAG + kid) }, k, unb64(w.ct));
}
const importPriv = (pkcs8) => subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
const importPub = (pubB64) => subtle.importKey('raw', unb64(pubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
async function keepOpen(kid, priv) { E.open.set(kid, priv); await idbPut(S.me.id + ':' + kid, { uid: S.me.id, kid, priv }).catch(() => { }); }

// frase gerada: 6 grupos de 4 letras/números sem os que confundem (0/O, 1/l/I)
export function randomPassphrase() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(24));
  return [...r].map(x => A[x % A.length]).join('').match(/.{4}/g).join('-');
}
const resetCaches = () => { E.aes.clear(); E.plain.clear(); };

// cria uma chave nova (primeira vez, ou "trocar de chave") e a deixa aberta neste aparelho
export async function createKey(pass) {
  if (E.mine.length && e2eeState() === 'locked') throw new Error('Desbloqueie primeiro: a chave nova usa a mesma frase das antigas');
  if (E.mine.length) { // conferir a frase contra uma chave existente (todas usam a mesma)
    const k = E.mine[0]; try { await unwrapPkcs8(k.wrapped, k.kid, pass); } catch { throw new Error('Frase incorreta'); }
  }
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = b64(await subtle.exportKey('raw', pair.publicKey)), kid = await kidOf(pub);
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  await raw('POST', '/e2ee/me', { kid, pub, wrapped: await wrapPkcs8(pkcs8, kid, pass) });
  await keepOpen(kid, await importPriv(pkcs8));
  resetCaches(); await e2eeLoad(true);
}
// abre neste aparelho todas as minhas chaves com a frase
export async function unlock(pass) {
  await e2eeLoad();
  const opened = [];
  for (const k of E.mine) {
    let pk; try { pk = await unwrapPkcs8(k.wrapped, k.kid, pass); } catch { throw new Error('Frase incorreta'); }
    opened.push([k.kid, await importPriv(pk)]);
  }
  for (const [kid, priv] of opened) await keepOpen(kid, priv);
  resetCaches(); document.dispatchEvent(new Event('e2ee-changed'));
}
export async function changePass(oldPass, newPass) {
  await e2eeLoad();
  const keys = [];
  for (const k of E.mine) {
    let pk; try { pk = await unwrapPkcs8(k.wrapped, k.kid, oldPass); } catch { throw new Error('Frase atual incorreta'); }
    keys.push({ kid: k.kid, wrapped: await wrapPkcs8(pk, k.kid, newPass) });
  }
  await raw('PUT', '/e2ee/me/wrap', { keys }); await e2eeLoad(true);
}
export async function lockHere() { await idbClear(S.me.id); E.open.clear(); resetCaches(); document.dispatchEvent(new Event('e2ee-changed')); }
export async function setPaused(paused) { await raw('PUT', '/e2ee/me/active', { on: !paused }); await e2eeLoad(true); }
export async function resetAll() { await raw('DELETE', '/e2ee/me'); await idbClear(S.me.id); E.open.clear(); resetCaches(); await e2eeLoad(true); }

// ---------- chaves das outras pessoas ----------
async function checked(k) { return k && k.pub && (await kidOf(k.pub)) === k.kid ? k : null; } // o servidor não consegue entregar outra chave com o mesmo kid
export function peerKey(uid, fresh) {
  if (fresh || !E.peers.has(uid)) E.peers.set(uid, raw('GET', `/e2ee/users/${uid}`).then(r => checked(r.active)).catch(() => null));
  return E.peers.get(uid);
}
function keyByKid(kid) {
  if (!E.kids.has(kid)) E.kids.set(kid, raw('GET', `/e2ee/keys/${kid}`).then(checked).catch(() => null));
  return E.kids.get(kid);
}
// a chave de alguém mudou (evento E2EE_KEY do servidor)
export function onE2eeKey(d) {
  if (d.user_id === S.me?.id) { e2eeLoad(true); return; }
  E.peers.set(d.user_id, checked(d.active).catch(() => null));
  document.dispatchEvent(new Event('e2ee-changed'));
}
function aesFor(myKid, otherKid, otherPub, cid, label = '') {
  const id = `${myKid}|${otherKid}|${label}${cid}`;
  if (!E.aes.has(id)) E.aes.set(id, (async () => {
    const bits = await subtle.deriveBits({ name: 'ECDH', public: await importPub(otherPub) }, E.open.get(myKid), 256);
    const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT_TAG), info: enc.encode(label + String(cid)) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  })());
  const p = E.aes.get(id); p.catch(() => E.aes.delete(id)); return p;
}

// ---------- enviar ----------
const dmPeerId = (ch) => ch?.type === 1 ? (ch.recipients || []).find(r => r.id !== S.me?.id)?.id : null;
// situação de uma conversa direta: { mode: 'on' | 'plain' | 'locked' | 'peer-off' | 'off', peer }
export async function convoState(ch) {
  const pid = dmPeerId(ch); if (!pid || !e2eeSupported()) return { mode: 'none' };
  await e2eeLoad();
  const peer = await peerKey(pid), st = e2eeState(), act = myActive();
  if (st === 'off' || st === 'paused' || !act) return { mode: 'off', peer };
  if (!E.open.has(act.kid)) return { mode: 'locked', peer };
  if (!peer) return { mode: 'peer-off', peer };
  return { mode: 'on', peer, mine: act };
}
// corpo de POST/PATCH de mensagem: cifra o texto quando a conversa é protegida
export async function e2eeOutgoing(cid, body) {
  if (!body) return body;
  const atts = Array.isArray(body.attachments) ? body.attachments : [], files = atts.map(a => a?._e2ee || null), anyFile = files.some(Boolean);
  const strip = () => ({ ...body, attachments: atts.map(({ _e2ee, ...a }) => a) });
  const text = typeof body.content === 'string' ? body.content : '';
  if ((!text && !anyFile) || text.startsWith(PREFIX)) return anyFile ? strip() : body;
  const ch = channelById(cid); if (ch?.type !== 1) return anyFile ? strip() : body;
  const st = await convoState(ch);
  if (st.mode === 'locked' && st.peer) throw new Error('Esta conversa é protegida: desbloqueie a criptografia neste aparelho (Configurações → Privacidade e segurança) para enviar.');
  if (st.mode !== 'on') { if (anyFile) throw new Error('A proteção desta conversa mudou enquanto o arquivo subia: tire o arquivo e envie de novo.'); return body; }
  const iv = crypto.getRandomValues(new Uint8Array(12)), ad = `${cid}|${st.mine.kid}|${st.peer.kid}`;
  const key = await aesFor(st.mine.kid, st.peer.kid, st.peer.pub, cid);
  const payload = anyFile ? { t: text, f: files } : { t: text };
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(ad) }, key, enc.encode(JSON.stringify(payload)));
  const out = `${PREFIX}${st.mine.kid}.${st.peer.kid}:${b64(iv)}:${b64(ct)}`;
  E.plain.set(out, { text, files: anyFile ? files : null, ok: true });
  // anexo cifrado: o servidor só vê "protegido.bin" (nem a forma de onda nem a duração da mensagem de voz)
  const outAtts = atts.map(({ _e2ee, ...a }) => (_e2ee ? { url: a.url, name: 'protegido.bin', size: a.size, type: 'application/octet-stream', enc: true } : a));
  return { ...body, content: out, attachments: outAtts };
}

// ---------- arquivos ----------
const CHUNK = 4 * 1024 * 1024;
const chunkIv = (prefix, i) => { const iv = new Uint8Array(12); iv.set(prefix); new DataView(iv.buffer).setUint32(8, i); return iv; };
// a conversa aberta é protegida? (decide se o arquivo vai cifrado antes de subir)
export async function protectFiles(cid) {
  const ch = channelById(cid); if (ch?.type !== 1) return false;
  const st = await convoState(ch);
  if (st.mode === 'locked' && st.peer) throw new Error('esta conversa é protegida: desbloqueie a criptografia neste aparelho para enviar arquivos');
  return st.mode === 'on';
}
// cifra o arquivo com uma chave só dele; extra = campos que só vão dentro da mensagem cifrada (ex.: forma de onda da voz)
export async function encryptFile(file, extra = {}) {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const prefix = crypto.getRandomValues(new Uint8Array(8)), n = Math.max(1, Math.ceil(file.size / CHUNK)), parts = [];
  for (let i = 0; i < n; i++) {
    const plain = await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer();
    parts.push(await subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(prefix, i), additionalData: enc.encode(`${i}|${i === n - 1 ? 1 : 0}`) }, key, plain));
  }
  const meta = { k: b64(await subtle.exportKey('raw', key)), iv: b64(prefix), c: CHUNK, name: file.name || 'arquivo', type: file.type || '', size: file.size, ...extra };
  return { file: new File(parts, 'protegido.bin', { type: 'application/octet-stream' }), meta };
}
const opened = new Map(); // url cifrada -> Promise<blob: url>
export const openedFileUrl = (a) => a?.e2ee && opened.get(a.e2ee.url)?.done || null;
export function openFile(a) {
  const m = a.e2ee; if (!m) return Promise.resolve(a.url);
  if (!opened.has(m.url)) {
    const p = (async () => {
      const r = await fetch(m.url); if (!r.ok) throw new Error('arquivo indisponível');
      const data = new Uint8Array(await r.arrayBuffer()), key = await subtle.importKey('raw', unb64(m.k), 'AES-GCM', false, ['decrypt']);
      const step = m.c + 16, n = Math.max(1, Math.ceil(data.length / step)), parts = [];
      for (let i = 0; i < n; i++) parts.push(await subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(unb64(m.iv), i), additionalData: enc.encode(`${i}|${i === n - 1 ? 1 : 0}`) }, key, data.subarray(i * step, (i + 1) * step)));
      const u = URL.createObjectURL(new Blob(parts, { type: m.type || 'application/octet-stream' }));
      p.done = u; return u;
    })();
    p.catch(() => opened.delete(m.url));
    opened.set(m.url, p);
  }
  return opened.get(m.url);
}

// chave da chamada de voz/vídeo da conversa (mesma troca de chaves, outro rótulo): os dois lados chegam à mesma chave
export async function callKey(ch) {
  const st = await convoState(ch);
  if (st.mode !== 'on') return { mode: st.mode, peer: st.peer };
  return { mode: 'on', key: await aesFor(st.mine.kid, st.peer.kid, st.peer.pub, ch.id, 'call|') };
}

// ---------- receber ----------
async function decryptOne(s, cid, author) {
  const hit = E.plain.get(s); if (hit) return hit;
  const m = RE.exec(s); if (!m) return { text: ERR_TEXT, state: 'error' };
  const [, sk, rk, iv, ct] = m;
  await e2eeLoad();
  const myKid = E.open.has(rk) ? rk : E.open.has(sk) ? sk : null;
  if (!myKid) { const known = E.mine.some(k => k.kid === rk || k.kid === sk); return { text: known ? LOCKED_TEXT : GONE_TEXT, state: known ? 'locked' : 'gone', keep: false }; }
  const otherKid = myKid === rk ? sk : rk, other = await keyByKid(otherKid);
  if (!other) return { text: ERR_TEXT, state: 'error' };
  // quem assina: a chave de quem enviou tem que ser de quem aparece como autor
  const senderUid = sk === myKid ? S.me.id : other.user_id;
  if (author && senderUid !== author) return { text: ERR_TEXT, state: 'error' };
  try {
    const key = await aesFor(myKid, otherKid, other.pub, cid);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(`${cid}|${sk}|${rk}`) }, key, unb64(ct));
    const j = JSON.parse(dec.decode(pt)), r = { text: String(j.t ?? ''), files: Array.isArray(j.f) ? j.f : null, ok: true }; E.plain.set(s, r); return r;
  } catch { return { text: ERR_TEXT, state: 'error' }; }
}
// percorre a resposta da API ou o evento e troca cada "content" cifrado pelo texto (m.e2ee = true, ou o motivo de não abrir)
export async function decryptDeep(data, cid = null, depth = 0) {
  if (!e2eeSupported() || !data || typeof data !== 'object' || depth > 6) return data;
  if (Array.isArray(data)) { await Promise.all(data.map(x => decryptDeep(x, cid, depth + 1))); return data; }
  const here = data.channel_id || cid;
  if (typeof data.content === 'string' && data.content.startsWith(PREFIX)) {
    const r = await decryptOne(data.content, here, data.author_id || data.author?.id);
    data.content = r.text; data.e2ee = r.ok ? true : r.state;
    // anexos cifrados: nome, tipo e chave de verdade (o arquivo só é baixado e aberto quando aparece na tela)
    if (r.files && Array.isArray(data.attachments)) data.attachments.forEach((a, i) => {
      const f = r.files[i]; if (!f || !a || a.expired || typeof f.k !== 'string') return;
      Object.assign(a, { name: String(f.name || 'arquivo'), type: String(f.type || ''), size: +f.size || a.size, e2ee: { url: a.url, k: f.k, iv: f.iv, c: +f.c || CHUNK } });
      if (f.voice) Object.assign(a, { voice: true, duration: +f.duration || 0, waveform: String(f.waveform || '') });
    });
  }
  const kids = [];
  for (const k in data) { const v = data[k]; if (v && typeof v === 'object') kids.push(decryptDeep(v, here, depth + 1)); }
  await Promise.all(kids);
  return data;
}

// ---------- número de segurança ----------
async function half(uid, pub) {
  const d = new Uint8Array(await subtle.digest('SHA-512', new Uint8Array([...enc.encode(SALT_TAG + '|' + uid + '|'), ...unb64(pub)])));
  const out = []; for (let i = 0; i < 6; i++) { let n = 0; for (let j = 0; j < 5; j++) n = n * 256 + d[i * 5 + j]; out.push(String(n % 100000).padStart(5, '0')); }
  return out;
}
export async function safetyNumber(uidA, pubA, uidB, pubB) {
  const [a, b] = await Promise.all([half(uidA, pubA), half(uidB, pubB)]);
  return (uidA < uidB ? [...a, ...b] : [...b, ...a]);
}
const verified = () => (S.prefs.e2eeVerified ||= {});
export const isVerified = (uid, kid) => verified()[uid] === kid;
// verificada antes e a chave mudou: a conversa avisa
export const keyChangedSinceVerify = (uid, kid) => !!verified()[uid] && verified()[uid] !== kid;

export async function safetyModal(ch, onChange) {
  const pid = dmPeerId(ch); const st = await convoState(ch);
  if (st.mode !== 'on') return;
  const nums = await safetyNumber(S.me.id, st.mine.pub, pid, st.peer.pub);
  const name = (ch.recipients || []).find(r => r.id === pid)?.display_name || 'a outra pessoa';
  const ok = isVerified(pid, st.peer.kid);
  modal('Número de segurança', `Compare com ${name} pessoalmente, por vídeo ou por outro aplicativo. Se os números forem iguais nos dois aparelhos, ninguém no meio do caminho (nem o servidor) consegue ler esta conversa.`,
    h('div.e2-safety', h('div.e2-nums', nums.map(n => h('code', n))),
      h('p.e2-small', 'As mensagens, os arquivos, as mensagens de voz e as chamadas desta conversa são cifrados no seu aparelho e só abrem no aparelho de vocês dois. Reações não entram na proteção.')),
    [{ label: 'Fechar', cls: 'link' },
      ok ? { label: 'Desmarcar verificação', cls: 'grey', fn: () => { delete verified()[pid]; savePrefs(); onChange?.(); } }
        : { label: 'Os números são iguais', cls: 'green', fn: () => { verified()[pid] = st.peer.kid; savePrefs(); onChange?.(); toast('Conversa verificada'); } }]);
}

// ---------- telas de frase ----------
function passFields(confirm) {
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', maxLength: 200, placeholder: 'Frase' });
  const p2 = confirm && h('input', { type: 'password', autocomplete: 'new-password', maxLength: 200, placeholder: 'Repita a frase' });
  const show = h('label.e2-show', h('input', { type: 'checkbox', onchange: (e) => { p1.type = e.target.checked ? 'text' : 'password'; if (p2) p2.type = p1.type; } }), ' Mostrar');
  return { p1, p2, show };
}
const err = () => h('div.e2-err');
export function setupModal(done) {
  const { p1, p2, show } = passFields(true), e = err();
  const gen = h('button.btn.link.sm', { type: 'button', onclick: () => { const r = randomPassphrase(); p1.value = p2.value = r; p1.type = p2.type = 'text'; show.querySelector('input').checked = true; } }, 'Gerar uma frase para mim');
  modal('Ativar a criptografia de ponta a ponta', 'Escolha uma frase. Ela abre suas conversas protegidas em cada aparelho novo e nunca sai daqui: o servidor guarda só a sua chave trancada com ela.',
    h('div.e2-form', h('label.f', 'Frase (pelo menos 10 caracteres)', p1), h('label.f', 'Confirmar', p2), h('div.e2-row', show, gen),
      h('p.e2-warn', icon('warn', 14), ' Guarde a frase num lugar seguro. Se esquecer, ninguém consegue recuperar: as mensagens protegidas antigas ficam ilegíveis.'), e),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Ativar', cls: 'green', fn: async () => {
      if (p1.value.length < 10) { e.textContent = 'Use pelo menos 10 caracteres.'; return false; }
      if (p1.value !== p2.value) { e.textContent = 'As frases não são iguais.'; return false; }
      e.textContent = 'Criando a chave…';
      try { await createKey(p1.value); toast('Criptografia de ponta a ponta ativada'); done?.(); } catch (x) { e.textContent = x.message; return false; }
    } }], { sticky: true });
}
export function unlockModal(done) {
  const { p1, show } = passFields(false), e = err();
  const go = async () => { e.textContent = 'Abrindo…'; try { await unlock(p1.value); toast('Conversas protegidas abertas neste aparelho'); done?.(); return true; } catch (x) { e.textContent = x.message; return false; } };
  const m = modal('Desbloquear neste aparelho', 'Digite a frase da criptografia de ponta a ponta para ler e enviar mensagens protegidas aqui. Só precisa fazer isso uma vez por aparelho.',
    h('div.e2-form', h('label.f', 'Frase', p1), show, e), [{ label: 'Cancelar', cls: 'link' }, { label: 'Desbloquear', cls: 'green', fn: go }], { sticky: true });
  p1.addEventListener('keydown', async (ev) => { if (ev.key === 'Enter' && await go()) m.close(); });
}
export function changePassModal(done) {
  const a = passFields(false), b = passFields(true), e = err();
  a.p1.placeholder = 'Frase atual'; a.p1.autocomplete = 'current-password';
  modal('Trocar a frase', 'As suas chaves continuam as mesmas (as conversas não mudam); só a frase que as tranca muda. Os outros aparelhos já desbloqueados continuam abertos.',
    h('div.e2-form', h('label.f', 'Frase atual', a.p1), h('label.f', 'Frase nova', b.p1), h('label.f', 'Repita a frase nova', b.p2), e),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Trocar', cls: 'green', fn: async () => {
      if (b.p1.value.length < 10) { e.textContent = 'Use pelo menos 10 caracteres.'; return false; }
      if (b.p1.value !== b.p2.value) { e.textContent = 'As frases novas não são iguais.'; return false; }
      e.textContent = 'Trocando…';
      try { await changePass(a.p1.value, b.p1.value); toast('Frase trocada'); done?.(); } catch (x) { e.textContent = x.message; return false; }
    } }], { sticky: true });
}
export function newKeyModal(done) {
  const { p1, show } = passFields(false), e = err();
  modal('Trocar de chave', 'Cria um par de chaves novo para as próximas mensagens (use se acha que um aparelho seu foi comprometido). As mensagens antigas continuam abrindo. Quem verificou seu número de segurança vai ver o aviso de chave nova, e seus outros aparelhos pedem a frase de novo.',
    h('div.e2-form', h('label.f', 'Sua frase', p1), show, e), [{ label: 'Cancelar', cls: 'link' }, { label: 'Criar chave nova', cls: 'green', fn: async () => {
      e.textContent = 'Criando…'; try { await createKey(p1.value); toast('Chave nova em uso'); done?.(); } catch (x) { e.textContent = x.message; return false; }
    } }], { sticky: true });
}
export async function resetModal(done) {
  if (!await confirmBox('Apagar minhas chaves', 'Use só se esqueceu a frase. Todas as mensagens protegidas que você já mandou e recebeu ficam ilegíveis para sempre, em todos os aparelhos. Depois você pode ativar de novo com uma frase nova.', 'Apagar chaves')) return;
  try { await resetAll(); toast('Chaves apagadas'); done?.(); } catch (x) { toast(x.message, true); }
}
