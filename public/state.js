import { h, icon, EMOJIS, setHour12, plainTs, setPlatformIcons, whenGone } from './util.js';
import { originAt, originFrom, leave } from './motion.js';
import { backCloses } from './backclose.js';
import { themeDef, paintTheme, SOLID_THEMES } from './themes.js';
import { openViewer } from './viewer.js';
import { e2eeOutgoing, decryptDeep } from './e2ee.js';

export const PERM = { ADMIN: 1, MANAGE_GUILD: 2, MANAGE_CHANNELS: 4, MANAGE_MESSAGES: 8, KICK: 16, CREATE_INVITE: 32, MANAGE_ROLES: 64, BAN: 128, MODERATE: 256 };
export const PERM_LABELS = [
  [PERM.ADMIN, 'Administrador', 'Todas as permissões; ignora qualquer restrição.'],
  [PERM.MANAGE_GUILD, 'Gerenciar servidor', 'Alterar nome e ícone do servidor.'],
  [PERM.MANAGE_CHANNELS, 'Gerenciar canais', 'Criar, editar e excluir canais.'],
  [PERM.MANAGE_MESSAGES, 'Gerenciar mensagens', 'Excluir mensagens de outros e fixar mensagens.'],
  [PERM.KICK, 'Expulsar membros', 'Remover membros do servidor.'],
  [PERM.CREATE_INVITE, 'Criar convite', 'Gerar links de convite.'],
  [PERM.MANAGE_ROLES, 'Gerenciar cargos', 'Criar cargos e atribuí-los a membros.'],
  [PERM.BAN, 'Banir membros', 'Banir e desbanir membros do servidor.'],
  [PERM.MODERATE, 'Castigar membros', 'Impedir temporariamente que alguém fale, reaja ou entre em voz.'],
];

export const S = {
  token: localStorage.getItem('lc_token'), me: null, ice: [],
  users: new Map(), guilds: new Map(), dms: new Map(), rels: new Map(),
  unread: {}, mentions: {}, voice: new Map(), // userId -> voice state
  messages: new Map(), loaded: new Map(), typing: new Map(),
  view: { kind: 'home', gid: null, cid: null, tab: 'online' },
  collapsed: new Set(JSON.parse(localStorage.getItem('lc_collapsed') || '[]')),
  lastChannel: JSON.parse(localStorage.getItem('lc_last') || '{}'),
  prefs: Object.assign({ volume: 100, echo: true, agc: true, noiseMode: 'rnnoise', gate: false, gateDb: -45, inputVolume: 100, inputMode: 'vad', pttKey: 'KeyV',
    zoom: 100, compact: false, desktopNotif: true, sounds: true, callSounds: true, inputId: '', outputId: '', videoId: '', theme: 'dark', accent: '#5865f2', reduceMotion: false,
    screen: { res: 1080, fps: 30, audio: true, hint: 'motion' },
    soundVolume: 80, fontFamily: 'default', msgGap: 17, radius: 8, hour12: false, highContrast: false, saturation: 100, underlineLinks: false, embedLinks: true, roleColors: true,
    confirmLinks: false, devMode: false, notifPreview: true, voiceBitrate: 'auto', camRes: 720, camFps: 30, keyMute: 'Ctrl+Shift+KeyM', keyDeafen: 'Ctrl+Shift+KeyD', keyClip: 'F8', keyFx: 'Ctrl+Shift+KeyE' },
    JSON.parse(localStorage.getItem('lc_prefs') || '{}')),
  replyTo: null, editing: null, pending: [], membersOpen: true, viewers: new Map(), watching: new Set(),
};
const DEVICE_KEYS = ['inputId', 'outputId', 'videoId', 'inputLabel', 'outputLabel', 'videoLabel', 'clipsOn', 'lightMode', 'lightPrev', 'liteAuto', 'liteAutoGame']; // específicos de cada máquina: não sincronizam
export const DEVICE_PREF_KEYS = DEVICE_KEYS;
// armazenamento do navegador começou vazio (app reinstalado, pasta de dados nova, outro endereço do servidor):
// o app desktop guarda uma cópia dos ajustes desta máquina e devolve (ver restoreDevicePrefs)
export const freshStorage = !localStorage.getItem('lc_prefs');
let syncTimer;
// mudança ainda não enviada à conta: marcada no aparelho, para não se perder se o app fechar/atualizar antes do envio
// (antes, ao abrir de novo, o que estava na conta passava por cima e a mudança sumia)
const DIRTY = 'lc_prefs_dirty';
export const prefsDirty = () => { try { return !!localStorage.getItem(DIRTY); } catch { return false; } };
const syncBody = () => { const p = { ...S.prefs }; DEVICE_KEYS.forEach(k => delete p[k]); unlite(p); return { settings: p }; };
// Duas abas/aparelhos mudando ajustes ao mesmo tempo: cada um manda só o que mudou desde a última versão da conta que
// conhece (`base`, guardada no aparelho para valer depois de recarregar) e o servidor junta. Ao receber a versão de
// outro aparelho, o que ainda não foi enviado daqui fica (antes era sobrescrito e depois enviado de volta com o valor velho).
const BASE = 'lc_prefs_base';
let baseRaw = (() => { try { return JSON.parse(localStorage.getItem(BASE) || 'null'); } catch { return null; } })();
// vale só para a conta que a gravou (outra conta no mesmo navegador começa sem base: a conta dela manda, como antes)
const baseOf = () => (baseRaw && S.me?.id && baseRaw.u === S.me.id ? baseRaw.s : null);
export const prefsBase = () => baseOf();
export const setPrefsBase = (settings) => { baseRaw = settings && typeof settings === 'object' && S.me?.id ? { u: S.me.id, s: { ...settings } } : null; try { localStorage.setItem(BASE, JSON.stringify(baseRaw)); } catch { } };
// o que mudou aqui e a conta ainda não tem: { patch: {chave: valor}, removed: [chaves] } (null sem base conhecida)
export function prefsDiff() {
  const base = baseOf(); if (!base) return null;
  const cur = syncBody().settings, patch = {}, removed = [];
  for (const k in cur) if (!same(cur[k], base[k])) patch[k] = cur[k];
  for (const k in base) if (!(k in cur)) removed.push(k);
  return { patch, removed };
}
// junta a versão da conta (`remote`) com a deste aparelho, em 3 vias contra a `base`: o que mudou lá e não mudou aqui é
// adotado; o que mudou aqui e ainda não foi enviado fica. Devolve true se algo mudou aqui.
export function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object') return false;
  const old = baseOf(), cur = syncBody().settings, local = { ...S.prefs }, took = {};
  for (const k of new Set([...Object.keys(remote), ...Object.keys(old || {})])) {
    if (DEVICE_KEYS.includes(k)) continue;
    const pending = old ? !same(cur[k], old[k]) : false; // sem base conhecida: vale a conta (como antes)
    if (pending || same(cur[k], remote[k])) continue;
    if (k in remote) { S.prefs[k] = remote[k]; took[k] = remote[k]; } else if (old && k in old) { delete S.prefs[k]; took[k] = undefined; }
  }
  setPrefsBase(remote);
  relite(took, local);
  const changed = Object.keys(took).length > 0;
  if (changed) try { localStorage.setItem('lc_prefs', JSON.stringify(S.prefs)); } catch { }
  return changed;
}
const pushPrefs = () => {
  const d = prefsDiff();
  if (d && !Object.keys(d.patch).length && !d.removed.length) { try { localStorage.removeItem(DIRTY); } catch { } return Promise.resolve(); }
  return api('PUT', '/me/settings', d || syncBody()).then((r) => { if (r?.settings && mergeRemote(r.settings)) S.onPrefsMerged?.(); const left = prefsDiff(); if (!left || (!Object.keys(left.patch).length && !left.removed.length)) try { localStorage.removeItem(DIRTY); } catch { } }).catch(() => { });
};
export const pushPrefsNow = () => { clearTimeout(syncTimer); syncTimer = null; return pushPrefs(); };
// fechando (atualização, reinício, F5) com envio pendente: manda já, num pedido que sobrevive ao fechamento da página
addEventListener('pagehide', () => {
  if (!syncTimer || !S.token) return;
  clearTimeout(syncTimer); syncTimer = null;
  try { fetch('/api/me/settings', { method: 'PUT', keepalive: true, headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': 'application/json' }, body: JSON.stringify(prefsDiff() || syncBody()) }).then(r => r.ok && localStorage.removeItem(DIRTY)).catch(() => { }); } catch { }
});
let lastDev = '';
const backupDevicePrefs = () => { // cópia no app desktop (fora do navegador): sobrevive mesmo se o armazenamento da página for apagado
  if (!desktop?.setSettings) return;
  const d = {}; for (const k of DEVICE_KEYS) if (S.prefs[k] !== undefined) d[k] = S.prefs[k];
  const j = JSON.stringify(d); if (j === lastDev) return; lastDev = j;
  desktop.setSettings({ devicePrefs: d }).catch?.(() => { });
};
// várias abas/janelas do app no mesmo navegador dividem o localStorage: quando uma muda um ajuste deste aparelho (modo
// leve, dispositivos de áudio…), as outras adotam os mesmos valores — senão a próxima gravação de uma aba desfazia o que a
// outra acabou de ligar (ex.: modo leve voltava desligado ao recarregar)
window.addEventListener('storage', (e) => {
  if (e.key === BASE) { try { baseRaw = JSON.parse(e.newValue || 'null'); } catch { } return; } // a outra aba recebeu a versão da conta
  if (e.key !== 'lc_prefs' || !e.newValue) return;
  let p; try { p = JSON.parse(e.newValue); } catch { return; }
  // mesma conta no mesmo aparelho: vale o que a outra aba gravou (inclusive o que o modo leve aplicou)
  if (JSON.stringify(S.prefs) === e.newValue) return;
  for (const k of Object.keys(S.prefs)) if (!(k in p)) delete S.prefs[k];
  Object.assign(S.prefs, p);
  document.dispatchEvent(new Event('prefs-changed-elsewhere'));
});
export const savePrefs = () => {
  localStorage.setItem('lc_prefs', JSON.stringify(S.prefs));
  backupDevicePrefs();
  clearTimeout(syncTimer); syncTimer = null;
  if (S.token && S.synced) { try { localStorage.setItem(DIRTY, '1'); } catch { } syncTimer = setTimeout(() => { syncTimer = null; pushPrefs(); }, 1200); }
};
// armazenamento vazio no app desktop: devolve dispositivos de áudio/vídeo e outros ajustes desta máquina guardados no app
export async function restoreDevicePrefs() {
  if (!freshStorage || !desktop?.getSettings) return false;
  const d = (await desktop.getSettings().catch(() => null))?.devicePrefs;
  if (!d || typeof d !== 'object') return false;
  for (const k of DEVICE_KEYS) if (d[k] !== undefined && (S.prefs[k] === undefined || S.prefs[k] === '')) S.prefs[k] = d[k];
  localStorage.setItem('lc_prefs', JSON.stringify(S.prefs)); return true;
}
// dispositivo salvo pelo id; se o id mudou (driver atualizado, outra porta USB, atualização do app/Windows), acha o mesmo
// aparelho pelo nome em vez de cair no padrão do sistema. Desconectado agora: mantém o escolhido (volta quando religar).
const DEVS = [['inputId', 'inputLabel', 'audioinput'], ['outputId', 'outputLabel', 'audiooutput'], ['videoId', 'videoLabel', 'videoinput']];
export async function resolveDevices() {
  const ds = await navigator.mediaDevices?.enumerateDevices?.().catch(() => null); if (!ds) return false;
  let changed = false;
  for (const [key, lab, kind] of DEVS) {
    const id = S.prefs[key], list = ds.filter(d => d.kind === kind); if (!id) continue;
    const hit = list.find(d => d.deviceId === id);
    if (hit) { if (hit.label && S.prefs[lab] !== hit.label) { S.prefs[lab] = hit.label; changed = true; } continue; }
    if (!list.some(d => d.label)) continue; // sem permissão ainda: os nomes vêm vazios, não dá para conferir
    const same = S.prefs[lab] && list.find(d => d.label === S.prefs[lab] && !/^(default|communications)$/.test(d.deviceId));
    if (same) { S.prefs[key] = same.deviceId; changed = true; }
  }
  if (changed) savePrefs();
  return changed;
}
// escolheu um dispositivo: guarda o id e o nome (o nome é o que permite reencontrá-lo se o id mudar)
export function setDevice(key, deviceId, label) {
  const lab = DEVS.find(d => d[0] === key)?.[1];
  S.prefs[key] = deviceId || '';
  if (lab) { if (deviceId && label) S.prefs[lab] = label; else delete S.prefs[lab]; }
  savePrefs();
}
// modo leve é só desta máquina: a conta guarda os valores de antes, e o que vem da conta vira o novo "antes"
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function unlite(p) { const lp = S.prefs.lightPrev; if (lp) for (const k in lp.applied) if (same(p[k], lp.applied[k])) { if (lp.prev[k] === null) delete p[k]; else p[k] = lp.prev[k]; } }
// `local`: valores desta máquina antes de puxar a conta. Item mudado à mão aqui deixa de ser do modo leve (vale o que a pessoa escolheu)
export function relite(remote, local) {
  const lp = S.prefs.lightPrev; if (!lp) return;
  for (const k in lp.applied) {
    if (!(k in remote)) continue;
    if (same(local[k], lp.applied[k])) { lp.prev[k] = remote[k]; S.prefs[k] = lp.applied[k]; } else { delete lp.prev[k]; delete lp.applied[k]; }
  }
}
export const desktop = window.lcDesktop || null; // ponte do app Electron (preload)
// App desktop: a janela roda sem desaceleração (backgroundThrottling: false, para voz, atalhos e clipes não atrasarem) e, com
// isso, o Electron nunca marca a página como escondida: minimizada ou na bandeja ela seguia "visível" — baixando o vídeo da
// transmissão assistida, medindo ping 1x/s, desenhando quem fala. O app (desde a 1.0.25) avisa o estado real da janela e
// aqui document.hidden/visibilityState passam a refletir isso; todo o resto do app já reage a 'visibilitychange'.
if (desktop?.onWindowState) {
  const H = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'), V = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  let winHidden = false;
  if (H?.get && V?.get) {
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return winHidden || H.get.call(this); } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return winHidden ? 'hidden' : V.get.call(this); } });
    desktop.onWindowState((st) => { const h = !!st?.hidden; if (h === winHidden) return; winHidden = h; document.dispatchEvent(new Event('visibilitychange')); });
  }
}
export function applyTheme() {
  const r = document.documentElement;
  const grad = themeDef(S.prefs.theme, S.prefs.customThemes);
  r.dataset.theme = grad ? grad.base : (SOLID_THEMES[S.prefs.theme] ? S.prefs.theme : 'dark'); paintTheme(r, grad); r.style.fontSize = S.prefs.zoom + '%';
  const a = S.prefs.accent || '#5865f2';
  r.style.setProperty('--brand', a); r.style.setProperty('--brand-hover', `color-mix(in srgb, ${a} 80%, black)`);
  r.classList.toggle('reduce-motion', !!S.prefs.reduceMotion); r.classList.toggle('anim', S.prefs.animations !== false && !S.prefs.reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches); // também o "reduzir movimento" do sistema
  r.classList.toggle('high-contrast', !!S.prefs.highContrast); r.classList.toggle('underline-links', !!S.prefs.underlineLinks);
  const fonts = { default: '"gg sans", "Noto Sans", "Segoe UI", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'Consolas, "Cascadia Mono", "Courier New", monospace', rounded: '"Trebuchet MS", "Segoe UI", sans-serif', dyslexia: '"Comic Sans MS", "Comic Neue", "Segoe UI", sans-serif' };
  r.style.setProperty('--font', fonts[S.prefs.fontFamily] || fonts.default);
  r.style.setProperty('--msg-gap', (S.prefs.msgGap ?? 17) + 'px'); r.style.setProperty('--radius', (S.prefs.radius ?? 8) + 'px');
  r.style.setProperty('--sat', (S.prefs.saturation ?? 100) + '%'); r.classList.toggle('sat-on', (S.prefs.saturation ?? 100) != 100); setHour12(S.prefs.hour12); setPlatformIcons(S.prefs.platformIcons);
}
// emojis personalizados de todos os servidores
export const allEmojis = () => [...S.guilds.values()].flatMap(g => (g.emojis || []).map(e => ({ ...e, guild: g.name, gid: g.id })));
export const emojiUrl = (id) => allEmojis().find(e => e.id === id)?.url;

// Chamadas à API.
// - GET igual em andamento: quem pede de novo recebe a mesma resposta (uma ida ao servidor só; cada um ganha a sua cópia).
// - Perfis (/users/:id) ficam guardados por 10 s (passar o mouse em vários lugares não repete o pedido); qualquer
//   alteração (POST/PUT/PATCH/DELETE) limpa o guardado.
// - O tempo de cada chamada fica em S.apiSlow (as lentas) para o relatório de velocidade (rum.js).
const inflight = new Map(), short = new Map(), SHORT_MS = 10e3, SHORT = /^\/users\/\d+$/;
S.apiSlow = [];
export async function api(method, path, body) {
  if (method === 'GET') {
    const hit = short.get(path); if (hit && Date.now() - hit.at < SHORT_MS) return structuredClone(hit.data);
    if (inflight.has(path)) return structuredClone(await inflight.get(path));
    const p = request(method, path, body).finally(() => inflight.delete(path));
    inflight.set(path, p);
    const data = await p; if (SHORT.test(path)) short.set(path, { at: Date.now(), data: structuredClone(data) });
    return data;
  }
  short.clear();
  return request(method, path, body);
}
// id desta aba/janela (sobrevive ao F5): o servidor reconhece a conexão antiga da mesma aba (sai da sala de voz na hora)
// e manda os avisos de "lido"/configurações só para os OUTROS aparelhos saberem de onde veio a mudança
export const tabId = (() => { try { let t = sessionStorage.getItem('lc_tab'); if (!t) sessionStorage.setItem('lc_tab', t = Math.random().toString(36).slice(2, 12)); return t; } catch { return Math.random().toString(36).slice(2, 12); } })();
const MSG_PATH = /^\/channels\/(\d+)\/messages(?:\/\d+)?$/;
async function request(method, path, body) {
  // conversa direta protegida: o texto sai daqui já cifrado (public/e2ee.js); o que volta cifrado é aberto antes de usar
  const mp = (method === 'POST' || method === 'PATCH') && body && !(body instanceof Blob) && MSG_PATH.exec(path);
  if (mp) body = await e2eeOutgoing(mp[1], body);
  const opt = { method, headers: { Authorization: 'Bearer ' + (S.token || ''), 'X-LC-Tab': tabId } };
  if (body instanceof Blob) { opt.body = body; opt.headers['Content-Type'] = body.type || 'application/octet-stream'; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const t0 = performance.now();
  const r = await fetch('/api' + path, opt);
  const txt = await r.text().catch(() => '');
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = {}; }
  if (r.ok && txt.includes('"e2ee:1:')) await decryptDeep(data).catch(() => { });
  const ms = performance.now() - t0; if (ms > 300 && S.apiSlow.length < 40) S.apiSlow.push({ r: method + ' /api' + path, ms: Math.round(ms) });
  if (!r.ok) { const e = new Error(data.error || 'Erro ' + r.status); e.status = r.status; e.data = data; throw e; }
  return data;
}
export const tryApi = async (...a) => { try { return await api(...a); } catch (e) { toast(e.message, true); return null; } };

// ---------- consultas ----------
// bot de música: não é uma pessoa nem membro do servidor; o estado de voz dele traz { kind, n, name }
export const botOf = (id) => S.voice.get(id)?.bot || null;
export const user = (id) => { const b = botOf(id); if (b) return { id, username: 'bot', display_name: b.name || 'Música', bot: b, status: 'online' };
  return S.users.get(id) || { id, username: 'desconhecido', display_name: 'Usuário desconhecido', status: 'offline' }; };
export const guild = (id) => S.guilds.get(id);
export function channelById(id) {
  if (S.dms.has(id)) return S.dms.get(id);
  if (S.posts?.has(id)) return S.posts.get(id); // post de fórum (public/forum.js): não vem no READY
  for (const g of S.guilds.values()) { const c = g.channels.find(c => c.id === id); if (c) return c; }
  return null;
}
export const member = (gid, uid) => S.guilds.get(gid)?.members.get(uid);
// servidor grande: o READY traz só quem estava online (g.partial); a lista inteira chega aqui, uma vez, ao abrir o servidor
// (ou as configurações dele). Membros que já chegaram por evento enquanto carregava ficam como estão (são mais novos).
const memberLoads = new Map();
export function loadMembers(gid) {
  const g = S.guilds.get(gid); if (!g?.partial) return Promise.resolve(g);
  if (memberLoads.has(gid)) return memberLoads.get(gid);
  const p = api('GET', `/guilds/${gid}/members`).then((r) => {
    if (S.guilds.get(gid) !== g) return loadMembers(gid); // reconectou no meio (READY novo): pede de novo para o servidor novo
    for (const u of r.users) { const old = S.users.get(u.id); S.users.set(u.id, old ? { ...old, ...u } : u); }
    for (const m of r.members) if (!g.members.has(m.user_id)) g.members.set(m.user_id, m);
    g.partial = false; document.dispatchEvent(new CustomEvent('members-loaded', { detail: gid }));
    return g;
  }).finally(() => memberLoads.delete(gid));
  memberLoads.set(gid, p); return p;
}
export function nameOf(uid, gid) { return member(gid, uid)?.nickname || user(uid).display_name || user(uid).username; }
export function roleColor(gid, uid) {
  if (S.prefs.roleColors === false) return '';
  const g = guild(gid), m = g?.members.get(uid); if (!g || !m) return '';
  const rs = g.roles.filter(r => m.roles.includes(r.id) && r.color && r.color !== '#99aab5').sort((a, b) => b.position - a.position);
  return rs[0]?.color || '';
}
export function perms(gid) {
  const g = guild(gid); if (!g) return 0;
  if (g.owner_id === S.me.id) return 0xffffff;
  let p = 0; const m = g.members.get(S.me.id);
  for (const r of g.roles) if (m?.roles.includes(r.id)) p |= r.perms;
  return p & PERM.ADMIN ? 0xffffff : p;
}
export const can = (gid, bit) => (perms(gid) & bit) !== 0;
export const dmPeer = (dm) => dm.recipients.find(r => r.id !== S.me.id) || dm.recipients[0];
export function relType(uid) { return S.rels.get(uid)?.type || 0; }
// política de notificação por servidor/canal (salva nas preferências)
// canal silenciado: true = até reativar, número = até esse horário (ms)
export function channelMuted(cid) { const v = (S.prefs.notifyCfg?.channels || {})[cid]; return v === true || (typeof v === 'number' && v > Date.now()); }
// servidor silenciado, mas este canal (ou a categoria dele) reativado: avisa normalmente, o resto do servidor continua quieto
export const channelUnmuted = (ch) => { const u = S.prefs.notifyCfg?.chUnmute || {}; return !!(ch && (u[ch.id] || (ch.parent_id && u[ch.parent_id]))); };
export const serverMuted = (gid) => !!(gid && S.prefs.notifyCfg?.[gid]?.muted);
export function setChannelUnmuted(cid, on) { const c = (S.prefs.notifyCfg ||= {}), u = (c.chUnmute ||= {}); if (on) u[cid] = true; else delete u[cid]; savePrefs(); }
export function notifPolicy(ch) {
  const c = S.prefs.notifyCfg || {}, g = ch?.guild_id ? (c[ch.guild_id] || {}) : {};
  return { level: (c.chLevel || {})[ch?.id] || g.level || 'all', muted: !!((g.muted && !channelUnmuted(ch)) || channelMuted(ch?.id)), noEveryone: !!g.noEveryone };
}

// ---------- UI utilitários ----------
const layer = () => document.getElementById('layer');
export const toastHooks = []; // telemetria (public/ux.js): conta os avisos de erro mostrados
export function toast(msg, err) {
  for (const f of toastHooks) { try { f(msg, err); } catch { } }
  document.getElementById('toast')?.remove();
  const t = h('div#toast' + (err ? '.err' : ''), msg); document.body.append(t);
  setTimeout(() => leave(t, 160), 3500);
}
export function modal(title, sub, body, buttons = [], opts = {}) {
  // a janela encolhe e some (mais rápido que a entrada); voltar do navegador/celular também fecha
  const close = (how) => { if (how !== 'back') unBack(); if (bd.isConnected && !bd.classList.contains('leaving')) leave(bd, 160); };
  const bd = h('div.backdrop', { onmousedown: (e) => { if (e.target === bd && !opts.sticky) close(); } },
    h('div.modal', opts.width ? { style: { width: opts.width } } : null,
      h('div.mh', h('h2', title), sub && h('p', sub)),
      h('div.mb', body),
      h('div.mf', buttons.map(b => h('button.btn' + (b.cls ? '.' + b.cls : ''), { onclick: async () => { if (b.fn) { const r = await b.fn(); if (r === false) return; } if (!b.keep) close(); } }, b.label)))));
  layer().append(bd); bd.querySelector('input,textarea')?.focus();
  const unBack = backCloses(() => close('back')); whenGone(bd, () => unBack()); // tirada da tela por outro caminho: sai do histórico também
  return { close: () => close(), el: bd };
}
export function confirmBox(title, text, label = 'Confirmar') {
  return new Promise(res => modal(title, text, h('div'), [{ label: 'Cancelar', cls: 'link', fn: () => res(false) }, { label, cls: 'red', fn: () => res(true) }]));
}
export function promptBox(title, label, value = '', okLabel = 'Salvar') {
  return new Promise(res => {
    const inp = h('input', { value, maxLength: 100 });
    const m = modal(title, '', h('label.f', label, inp), [{ label: 'Cancelar', cls: 'link', fn: () => res(null) }, { label: okLabel, fn: () => res(inp.value.trim()) }]);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { res(inp.value.trim()); m.close(); } });
    inp.select();
  });
}
export function closeFloating() { layer().querySelectorAll('.menu:not(.leaving),.popout:not(.static):not(.leaving),.emoji-picker:not(.leaving)').forEach(e => leave(e, e.classList.contains('menu') ? 120 : 160)); } // voltam para onde foram abertos
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu,.popout:not(.static),.emoji-picker,[data-keepfloat]')) closeFloating(); }, true); // prévias (.static) não seguram menus abertos; [data-keepfloat]: botão que abre o próprio painel ao passar o mouse (o clique nele decide)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFloating(); }); // o visualizador de imagens trata o próprio Esc
// (sem fechar no blur: o menu continua aberto ao dar alt+tab)

const EDGE = 12; // margem de segurança: menu nunca encosta nem sai da borda da janela
function place(el, x, y) {
  el.style.maxHeight = `calc(100vh - ${EDGE * 2}px)`; el.style.maxWidth = `calc(100vw - ${EDGE * 2}px)`; el.style.overflowY = 'auto'; // menu maior que a tela rola por dentro
  layer().append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(EDGE, Math.min(x, innerWidth - r.width - EDGE)) + 'px';
  el.style.top = Math.max(EDGE, Math.min(y, innerHeight - r.height - EDGE)) + 'px';
  originAt(el, x, y); // cresce a partir do clique
}
export const menuHooks = []; // telemetria (public/ux.js): menu aberto / fechado sem escolher nada
export function menu(e, items) {
  e.preventDefault(); closeFloating();
  let picked = false;
  // item: { label, fn, danger, icon (nome do ícone, à esquerda), checked (caixa marcável), sub: [itens] (submenu ao passar o mouse) }
  const build = (list, depth) => h('div.menu', { 'data-depth': depth }, list.filter(Boolean).map(i => {
    if (i === '-') return h('div.sp');
    // controle dentro do menu (ex.: volume): mexer nele conta como usar o menu, não como "fechou sem escolher"
    if (i.node) return h('div.mnode', { oninput: () => { picked = true; }, onchange: () => { picked = true; } }, i.node);
    const cbx = i.checked !== undefined ? h('span.cbx' + (i.checked ? '.on' : ''), i.checked && icon('check', 16)) : null;
    const row = h('div.it' + (i.danger ? '.danger' : '') + (i.icon ? '.hasic' : ''), i.icon && h('span.mic', icon(i.icon, 18)), i.hint ? h('div.itl', h('span', i.label), h('small', i.hint)) : i.icon ? h('span.mlab', i.label) : i.label, cbx, i.radio !== undefined && h('span.radio' + (i.radio ? '.on' : '')), i.sub && h('span', { style: { marginLeft: 'auto', opacity: .7 } }, '›'));
    const closeDeeper = () => layer().querySelectorAll('.menu:not(.leaving)').forEach(m => { if (+m.dataset.depth > depth) leave(m, 100); });
    if (i.sub) {
      const open = () => { closeDeeper(); const r = row.getBoundingClientRect(), sub = build(i.sub, depth + 1); place(sub, r.right + 2, r.top - 6); const w = sub.getBoundingClientRect(); if (w.right > innerWidth - EDGE) sub.style.left = Math.max(EDGE, r.left - w.width - 2) + 'px'; };
      row.onmouseenter = open; row.onclick = open;
    } else { row.onmouseenter = closeDeeper; row.onclick = () => {
        picked = true;
        if (i.ux) menuHooks.forEach(f => { try { f('pick', e, i.ux); } catch { } }); // telemetria: qual item (rótulo fixo, ex.: 'desenhar')
        if (!cbx) { closeFloating(); i.fn?.(); return; }
        i.checked = !i.checked; i.fn?.(); cbx.classList.toggle('on', i.checked); cbx.replaceChildren(...(i.checked ? [icon('check', 16)] : [])); // caixa de seleção: o menu fica aberto
      }; }
    return row;
  }));
  const root = build(items, 0); place(root, e.clientX, e.clientY);
  if (menuHooks.length) { menuHooks.forEach(f => { try { f('open', e); } catch { } }); whenGone(root, () => { if (!picked) menuHooks.forEach(f => { try { f('abandoned', e); } catch { } }); }); }
}
export function popout(anchor, node, side = 'right') {
  closeFloating();
  const r = anchor.getBoundingClientRect(), el = h('div.popout', node);
  layer().append(el); const w = el.getBoundingClientRect();
  const x = side === 'left' ? r.left - w.width - 8 : r.right + 8;
  el.style.left = Math.max(8, Math.min(x, innerWidth - w.width - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(r.top, innerHeight - w.height - 8)) + 'px';
  originFrom(el, anchor); // cresce a partir do botão que abriu
  return el;
}
// Emojis do painel em blocos de 5 linhas com content-visibility: só o que aparece é diagramado e desenhado. Antes,
// abrir montava e media o painel inteiro de uma vez: 144 ms de layout + 118 ms desenhando as letras coloridas no 1º
// clique (INP 280–330 ms no trace). EMOJI_COLS: 336 px úteis ÷ 40 px por emoji.
const EMOJI_COLS = 8, EMOJI_CHUNK = EMOJI_COLS * 5;
function emojiChunks(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i += EMOJI_CHUNK) {
    const part = nodes.slice(i, i + EMOJI_CHUNK);
    out.push(h('div.emoji-chunk', { style: { containIntrinsicSize: `auto ${Math.ceil(part.length / EMOJI_COLS) * 40}px` } }, ...part));
  }
  return out;
}
export function emojiPicker(anchor, onPick, opts = {}) {
  closeFloating();
  const grid = h('div.emoji-grid'), q = h('input', { placeholder: 'Pesquisar emoji ou categoria' });
  const draw = () => {
    grid.replaceChildren(); const f = q.value.toLowerCase();
    if (!opts.noCustom) {
      const byGuild = new Map();
      for (const e of allEmojis()) if (!f || e.name.toLowerCase().includes(f)) (byGuild.get(e.guild) || byGuild.set(e.guild, []).get(e.guild)).push(e);
      for (const [g, list] of byGuild) grid.append(h('div.cap', g), ...emojiChunks(list.map(e => h('span', { title: ':' + e.name + ':', onclick: () => { onPick(`<:${e.name}:${e.id}>`, e); closeFloating(); } }, h('img', { src: e.url, loading: 'lazy', decoding: 'async', style: { width: '32px', height: '32px', objectFit: 'contain' } })))));
    }
    for (const [cat, list] of Object.entries(EMOJIS)) {
      if (f && !cat.toLowerCase().includes(f)) continue;
      grid.append(h('div.cap', cat), ...emojiChunks(list.map(e => h('span', { onclick: () => { onPick(e); closeFloating(); } }, e))));
    }
  };
  q.oninput = draw; draw();
  const el = h('div.emoji-picker', q, grid), r = anchor.getBoundingClientRect();
  place(el, r.right - 352, r.top - 348); if (parseFloat(el.style.top) < 8) el.style.top = (r.bottom + 8) + 'px';
}
// Com a aba parada, diagrama os emojis do painel escondido, aos poucos: a 1ª busca da fonte colorida de cada emoji
// (cara no Windows) sai do clique que abre o painel. Uma vez por sessão; sem efeito na tela.
// Trace real (2026-11-11): 24 emojis por vez custavam 15–30 ms de layout cada e os 10 lotes caíam logo na abertura do app
// (~150 ms entre 0,3 e 0,5 s, com a thread principal 70% ocupada). Agora começa 4 s depois de chamado, lotes de 6 e só
// quando o navegador dá uma folga de pelo menos 12 ms (senão espera a próxima); sem prazo, para não furar a fila.
let emojiWarm = false;
export function warmEmojis() {
  if (emojiWarm) return; emojiWarm = true;
  const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f) : (f) => setTimeout(() => f({ timeRemaining: () => 50 }), 300);
  const all = Object.values(EMOJIS).flat(); let i = 0;
  const box = h('div.emoji-grid', { 'aria-hidden': 'true', style: { position: 'fixed', left: '0', top: '0', width: '336px', visibility: 'hidden', pointerEvents: 'none', contain: 'layout style size', height: '0', overflow: 'hidden' } });
  const step = (dl) => {
    if (i >= all.length) return box.remove();
    if (document.hidden) return setTimeout(() => idle(step), 2000); // aba escondida: a fonte não muda, espera voltar
    while (i < all.length && dl.timeRemaining() > 12) {
      box.replaceChildren(...all.slice(i, i += 6).map(e => h('span', e)));
      if (!box.isConnected) document.body.append(box);
      void box.firstChild.getBoundingClientRect(); // diagrama agora, nesta folga
    }
    idle(step);
  };
  setTimeout(() => idle(step), 4000);
}
export const lightbox = (src, opts) => openViewer(src, opts);

// ---------- modo foco / não perturbe ----------
// Modo foco: só mensagens diretas (e chamadas para você) tocam som e mostram aviso; servidores continuam contando como
// não lidas, em silêncio. Independe do status: dá para ficar Online (os amigos veem verde e mandam mensagem) e em foco.
// S.prefs.focusUntil: true = até desligar, número = até esse horário (ms). Não perturbe silencia tudo.
export const focusOn = () => { const f = S.prefs.focusUntil; return f === true || (typeof f === 'number' && f > Date.now()); };
// kind: 'dm' (mensagem direta, chamada, pedido de amizade) | 'server' (canais, procura de grupo, convites de servidor)
export const alertAllowed = (kind) => S.me?.status !== 'dnd' && !(kind === 'server' && focusOn());
// mesmo valor de antes (clicou na opção que já estava): nada muda, então nada é salvo nem redesenhado (a lateral piscava)
export function setFocus(until) { if ((until || undefined) === S.prefs.focusUntil) return; if (until) S.prefs.focusUntil = until; else delete S.prefs.focusUntil; savePrefs(); document.dispatchEvent(new Event('focus-mode')); }
// ---------- som / notificação ----------
let actx;
export function beep() {
  if (!S.prefs.sounds || S.prefs.soundsMuted) return;
  const vol = (S.prefs.soundVolume ?? 80) / 100 * (S.prefs.notifVolume ?? 100) / 100; if (vol <= 0) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; o.type = 'sine'; g.gain.setValueAtTime(.12 * vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .25);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .25);
    clearTimeout(actx._nap); actx._nap = setTimeout(() => { if (actx.state === 'running') actx.suspend().catch(() => { }); }, 3000); // dorme sem som tocando
  } catch { }
}
// ---------- aparelhos da conta (sincronização entre PC e celular) ----------
// `S.devices`: as OUTRAS conexões da conta em uso agora (vem do servidor, evento DEVICES). Com outro aparelho em uso e
// este parado, as notificações e sons daqui ficam em silêncio (as não lidas continuam contando) — quem está lendo no PC
// não leva o celular vibrando junto. Desliga em Notificações → "Silenciar quando estiver em outro aparelho".
export const elsewhere = () => (S.devices || []).some(d => d.tab !== tabId);
export const quietHere = () => S.prefs.quietElsewhere !== false && elsewhere() && !(document.hasFocus() && !document.hidden);
// notificações abertas por conversa: lida em qualquer aparelho (READ_STATE), as daqui fecham na hora
const openNotifs = new Map(); // tag (id do canal) -> Set<Notification>
export function notify(title, body, onclick, tag) {
  if (!S.prefs.desktopNotif || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (quietHere()) return;
  // silent: o som do aviso é o do app (com o volume das notificações), não o do sistema por cima
  const n = new Notification(title, { body: plainTs(body).slice(0, 140), silent: true, ...(tag ? { tag: 'lc-' + tag } : {}) });
  n.onclick = () => { window.focus(); onclick?.(); n.close(); };
  if (tag) { const set = openNotifs.get(tag) || openNotifs.set(tag, new Set()).get(tag); set.add(n); n.onclose = () => { set.delete(n); if (!set.size) openNotifs.delete(tag); }; }
  return n;
}
export function closeNotifs(tag) {
  for (const n of openNotifs.get(tag) || []) { try { n.close(); } catch { } }
  openNotifs.delete(tag);
  navigator.serviceWorker?.getRegistration?.().then(r => r?.getNotifications?.({ tag: 'lc-' + tag })).then(l => l?.forEach(n => n.close())).catch(() => { });
}
export { h, icon };

// "Fantasma" de popup no app desktop: em alguns PCs (placa de vídeo/driver), quando um popup, menu ou janela flutuante
// fecha, o Windows só atualiza o pedaço que o Chromium disse que mudou e a sombra arredondada do popup fica desenhada
// até um Alt+Tab ou passar o mouse por cima. Ao fechar qualquer coisa flutuante, cobre a janela por 2 quadros com uma
// camada quase transparente (imperceptível): a tela inteira é redesenhada e o resto do popup some.
if (window.lcDesktop) {
  let pending = false;
  const repaint = () => {
    if (pending) return; pending = true;
    requestAnimationFrame(() => {
      const v = document.createElement('div'); v.className = 'lc-repaint'; document.body.append(v);
      requestAnimationFrame(() => requestAnimationFrame(() => { v.remove(); pending = false; }));
    });
  };
  const watch = (el) => el && new MutationObserver((ms) => { if (ms.some(m => [...m.removedNodes].some(n => n.nodeType === 1 && n.className !== 'lc-repaint'))) repaint(); }).observe(el, { childList: true });
  const start = () => { watch(document.getElementById('layer')); watch(document.body); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
