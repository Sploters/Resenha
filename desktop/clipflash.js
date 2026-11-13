// Aviso de "clipe capturado" por cima de tudo (inclusive do jogo), só na tela de quem apertou o atalho.
// - não rouba o foco (showInactive + focusable:false): roubar o foco minimizaria um jogo em tela cheia
// - não recebe cliques (o mouse continua indo para o jogo)
// - fica FORA da captura de tela (setContentProtection -> WDA_EXCLUDEFROMCAPTURE no Windows 10 2004+): não aparece
//   na transmissão nem no próprio clipe
// - janela pequena no canto (não cobre a tela); a página é só HTML/CSS (sem JavaScript); some sozinha
// Primeiro tenta o aviso nativo (programa lc-audio que já fica aberto, ver native/lc-audio/src/toast.rs): mesma pílula, sem
// criar um processo de página do Chromium no meio do jogo a cada F8. Se ele não estiver disponível ou falhar, usa a
// BrowserWindow abaixo. O tempo até aparecer vai para o main.log nos dois casos (para comparar).
const { BrowserWindow, screen } = require('electron');
const log = (...a) => console.log('[clipflash]', ...a);
let nativeFails = 0;

let win = null, timer = null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// discreto, como o Medal / ShadowPlay: uma pílula pequena no canto de cima à direita, sem piscar a tela
const W = 250, H = 56, M = 22; // tamanho da janela e distância da borda da tela
function html({ ok, title, sub, kind }) {
  const c = ok ? (kind === 'share' ? '#5865f2' : '#23a55a') : '#f23f43';
  const ic = ok && kind === 'share' // atalho da transmissão: ícone de tela
    ? '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="#fff" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>'
    : ok
    ? '<svg viewBox="0 0 32 32" width="15" height="15"><path fill="#fff" d="M20.9867 7.65337C20.9364 7.76371 20.9172 7.88566 20.9311 8.00611C20.945 8.12656 20.9915 8.24094 21.0655 8.33694C21.1396 8.43294 21.2384 8.50693 21.3514 8.55094C21.4644 8.59495 21.5872 8.60731 21.7067 8.5867L28.3867 7.41337C28.5597 7.38096 28.7128 7.28147 28.8127 7.1366C28.9126 6.99173 28.9512 6.81323 28.92 6.64004L28.5734 4.68004C28.4006 3.69809 27.8673 2.81607 27.078 2.20685C26.2887 1.59764 25.3004 1.30515 24.3067 1.3867C24.2016 1.39711 24.1009 1.43449 24.0145 1.49523C23.9281 1.55596 23.8588 1.63799 23.8134 1.73337L20.9867 7.65337ZM20.1734 3.16004C20.2226 3.05083 20.2415 2.93038 20.2281 2.81134C20.2147 2.6923 20.1694 2.57907 20.0971 2.48356C20.0248 2.38806 19.9281 2.3138 19.8172 2.2686C19.7062 2.2234 19.5852 2.20893 19.4667 2.2267L13.8 3.21337C13.6938 3.2311 13.5934 3.27433 13.5074 3.33935C13.4215 3.40436 13.3526 3.48924 13.3067 3.5867L10.4934 9.5067C10.4441 9.61591 10.4252 9.73636 10.4386 9.8554C10.452 9.97444 10.4973 10.0877 10.5696 10.1832C10.6419 10.2787 10.7386 10.3529 10.8496 10.3981C10.9605 10.4433 11.0816 10.4578 11.2 10.44L16.8667 9.45337C16.973 9.43564 17.0734 9.39242 17.1593 9.3274C17.2452 9.26238 17.3141 9.1775 17.36 9.08004L20.1734 3.16004ZM8.96003 4.0667L5.56003 4.6667C5.04252 4.75842 4.54816 4.95122 4.1052 5.2341C3.66224 5.51697 3.27937 5.88436 2.97847 6.31527C2.67758 6.74619 2.46455 7.23218 2.35157 7.74547C2.23859 8.25875 2.22787 8.78927 2.32003 9.3067L2.66669 11.28C2.73336 11.64 3.06669 11.88 3.44003 11.8134L6.37336 11.2934C6.47594 11.2751 6.57279 11.2329 6.65615 11.1704C6.73951 11.1079 6.80705 11.0267 6.85336 10.9334L9.68003 5.01337C9.73029 4.90303 9.74951 4.78108 9.73562 4.66063C9.72173 4.54018 9.67526 4.4258 9.6012 4.3298C9.52714 4.2338 9.4283 4.15981 9.31533 4.1158C9.20235 4.07179 9.07951 4.05943 8.96003 4.08004V4.0667Z"/><path fill="#fff" fill-rule="evenodd" d="M2.66669 13.9999C2.66669 13.6266 2.96002 13.3333 3.33335 13.3333H28.6667C29.04 13.3333 29.3334 13.6266 29.3334 13.9999V25.3333C29.3334 26.3941 28.9119 27.4115 28.1618 28.1617C27.4116 28.9118 26.3942 29.3333 25.3334 29.3333H6.66669C5.60582 29.3333 4.58841 28.9118 3.83826 28.1617C3.08811 27.4115 2.66669 26.3941 2.66669 25.3333V13.9999ZM6.66669 18.6666C6.66669 18.313 6.80716 17.9738 7.05721 17.7238C7.30726 17.4737 7.6464 17.3333 8.00002 17.3333H20C20.3536 17.3333 20.6928 17.4737 20.9428 17.7238C21.1929 17.9738 21.3334 18.313 21.3334 18.6666C21.3334 19.0202 21.1929 19.3593 20.9428 19.6094C20.6928 19.8594 20.3536 19.9999 20 19.9999H8.00002C7.6464 19.9999 7.30726 19.8594 7.05721 19.6094C6.80716 19.3593 6.66669 19.0202 6.66669 18.6666ZM8.00002 22.6666C7.6464 22.6666 7.30726 22.8071 7.05721 23.0571C6.80716 23.3072 6.66669 23.6463 6.66669 23.9999C6.66669 24.3535 6.80716 24.6927 7.05721 24.9427C7.30726 25.1928 7.6464 25.3333 8.00002 25.3333H13.3334C13.687 25.3333 14.0261 25.1928 14.2762 24.9427C14.5262 24.6927 14.6667 24.3535 14.6667 23.9999C14.6667 23.6463 14.5262 23.3072 14.2762 23.0571C14.0261 22.8071 13.687 22.6666 13.3334 22.6666H8.00002Z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="#fff" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z"/></svg>';
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;user-select:none;font:13px "Segoe UI",system-ui,sans-serif}
.t{position:absolute;top:6px;right:6px;display:flex;align-items:center;gap:9px;max-width:${W - 12}px;box-sizing:border-box;padding:7px 14px 7px 8px;border-radius:999px;
  background:rgba(17,18,20,.86);color:#f2f3f5;border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 14px rgba(0,0,0,.35);
  opacity:0;transform:translateX(24px);animation:in .22s ease-out forwards,out .25s ease-in 1.75s forwards}
.ic{width:26px;height:26px;border-radius:50%;background:${c};display:grid;place-items:center;flex:none}
b{font-weight:600;white-space:nowrap}small{color:#b5bac1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes in{to{opacity:1;transform:none}}@keyframes out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(24px)}}
</style><div class="t"><div class="ic">${ic}</div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function hide() { clearTimeout(timer); timer = null; const w = win; win = null; if (w && !w.isDestroyed()) w.destroy(); }

// o: { ok: boolean, title: string, sub?: string, kind?: 'share' }; helper: programa nativo (desktop/helper.js) ou null
function show(o = {}, helper = null) {
  if (helper?.up && helper.info?.toast && nativeFails < 3) {
    const t0 = Date.now();
    hide();
    helper.call('toast', { ok: o.ok !== false, kind: o.kind || '', title: o.title || '', sub: o.sub || '' }, 1500)
      .then((r) => { nativeFails = 0; log('nativo: na tela em ' + Math.round(r?.ms ?? 0) + ' ms (' + (Date.now() - t0) + ' ms com o pedido)'); })
      .catch((e) => { nativeFails++; log('nativo falhou (' + e.message + '): usando a janela do Chromium'); showWindow(o); });
    return;
  }
  showWindow(o);
}
function showWindow(o) {
  hide();
  const t0 = Date.now();
  // tela onde está o mouse = normalmente a do jogo
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), b = d.workArea;
  win = new BrowserWindow({
    x: b.x + b.width - W - M, y: b.y + M, width: W, height: H, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, backgroundThrottling: false },
  });
  const w = win;
  w.setAlwaysOnTop(true, 'screen-saver'); // por cima de jogos em janela sem borda e da barra de tarefas
  w.setVisibleOnAllWorkspaces(true);
  w.setIgnoreMouseEvents(true);
  w.setContentProtection(true); // fora da captura: não entra na transmissão nem no clipe
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.once('ready-to-show', () => { if (win === w && !w.isDestroyed()) { w.showInactive(); log('janela do Chromium: na tela em ' + (Date.now() - t0) + ' ms'); } });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html(o))).catch(() => { });
  timer = setTimeout(hide, 2200);
}

module.exports = { show, hide, html };
