// Não lidas e menções: título da aba, ícone (favicon), selo do app e piscar a janela; marcar como lido.
import { S, api, channelById, closeNotifs, channelMuted, channelUnmuted, serverMuted, desktop } from './state.js';
import { renderRail } from './rail.js';
import { renderSide } from './side.js';
import { inboxBadge } from './inbox.js';
// número no ícone (ideia "notification settings", Stoat #1254): título da aba, ícone da aba (favicon), ícone do app
// instalado (PWA) e barra de tarefas do app desktop. Notificações → "Ícone e barra de tarefas": só menções (padrão),
// menções + ponto para mensagens não lidas, ou nada.
const unreadCounts = () => Object.keys(S.unread).some(cid => { if (!S.unread[cid]) return false; const ch = channelById(cid); if (!ch || channelMuted(cid)) return false; return !ch.guild_id || !serverMuted(ch.guild_id) || channelUnmuted(ch); });
const favLink = document.querySelector('link[rel="icon"]'), favBase = favLink?.getAttribute('href');
let favKey = '';
function setFavicon(n, dot) {
  const key = n ? 'n' + Math.min(n, 10) : dot ? 'dot' : ''; if (!favLink || key === favKey) return; favKey = key;
  if (!key) { favLink.setAttribute('href', favBase); return; }
  const img = new Image();
  img.onload = () => {
    if (favKey !== key) return;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 64);
    x.fillStyle = '#f23f43'; x.beginPath(); x.arc(46, 18, n ? 18 : 12, 0, Math.PI * 2); x.fill();
    if (n) { x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n > 9 ? '9+' : String(n), 46, 20); }
    favLink.setAttribute('href', c.toDataURL('image/png'));
  };
  img.src = favBase;
}
// menção ou mensagem direta com a janela em segundo plano: o ícone pisca na barra de tarefas (app desktop) ou o título da
// aba alterna com "Nova menção" (navegador) até voltar para a Resenha
let blinkTimer = 0;
export function attention(who) {
  if (S.prefs.taskbarFlash === false || document.hasFocus()) return;
  if (desktop?.flashFrame) return desktop.flashFrame();
  if (blinkTimer || S.prefs.titleBlink === false) return;
  let on = false;
  blinkTimer = setInterval(() => { if (document.hasFocus()) { clearInterval(blinkTimer); blinkTimer = 0; return updateTitle(); } on = !on; document.title = on ? `🔔 ${who || 'Nova menção'}` : baseTitle(); }, 1200);
}
const mentionTotal = () => Object.values(S.mentions).reduce((a, b) => a + b, 0);
const baseTitle = () => { const mode = S.prefs.badgeMode || 'mentions', n = mentionTotal(); return mode === 'off' ? 'Resenha' : (n ? `(${n}) ` : mode === 'unread' && unreadCounts() ? '• ' : '') + 'Resenha'; };
export function updateTitle() {
  const mode = S.prefs.badgeMode || 'mentions', n = mode === 'off' ? 0 : mentionTotal(), dot = mode === 'unread' && !n && unreadCounts();
  if (!blinkTimer) document.title = baseTitle();
  desktop?.setBadge?.(n || (dot ? -1 : 0));
  setFavicon(n, dot);
  try { if (n || dot) navigator.setAppBadge?.(n || undefined)?.catch?.(() => { }); else navigator.clearAppBadge?.()?.catch?.(() => { }); } catch { }
  for (const btn of document.querySelectorAll('.inbox-btn')) { btn.querySelector('.ibadge')?.remove(); const b = inboxBadge(); if (b) btn.append(b); }
}
export function ack(cid) {
  closeNotifs(cid);
  if (!S.unread[cid] && !S.mentions[cid]) return;
  delete S.unread[cid]; delete S.mentions[cid]; api('POST', `/channels/${cid}/ack`).catch(() => { });
  renderRail(); renderSide(); updateTitle();
}
