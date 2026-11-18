// Watch Together no app desktop: janela do serviço (Netflix, Prime Video, Crunchyroll) para cada participante assistir
// na PRÓPRIA conta, com sessão guardada por serviço (partition persist:watch-<serviço>: cookies e login ficam só nesta
// janela, separados do Resenha). A ponte (desktop/watchbridge.js, preload desta janela) acha o <video> da página,
// relata posição/estado e aplica play, pause e posição pedidos pela sala.
//
// O que NÃO faz (e não deve fazer): nada de contornar DRM, extrair o fluxo, capturar a tela do vídeo ou transmiti-lo
// para outra pessoa. Sem o módulo Widevine (o Electron padrão não tem; só builds com CDM, como o da castLabs, e com
// assinatura VMP para alguns serviços), os serviços se recusam a tocar: a ponte detecta isso e relata { drm: false }
// e a interface cai para a sincronização assistida (abrir no navegador de cada um).
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('node:path');

// domínios em que cada janela pode navegar (login incluso); o resto abre no navegador do sistema
const HOSTS = {
  netflix: ['netflix.com'],
  prime: ['primevideo.com', 'amazon.com', 'amazon.com.br', 'amazon.co.uk', 'amazon.de', 'amazon.co.jp', 'media-amazon.com', 'ssl-images-amazon.com'],
  crunchyroll: ['crunchyroll.com', 'sso.crunchyroll.com', 'vrv.co', 'ellation.com'],
};
const TITLES = { netflix: 'Netflix', prime: 'Prime Video', crunchyroll: 'Crunchyroll' };
// testes: hosts locais extras (páginas simuladas com <video>)
const EXTRA = (process.env.RESENHA_WATCH_TEST_HOSTS || '').split(',').filter(Boolean);
const hostOk = (svc, url) => {
  try {
    const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    return [...(HOSTS[svc] || []), ...EXTRA].some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
};

function createWatchWindows({ sendToApp, parent = () => null, log = () => { } }) {
  const wins = new Map(); // serviço -> BrowserWindow
  const svcOf = (wc) => { for (const [s, w] of wins) if (!w.isDestroyed() && w.webContents === wc) return s; return null; };

  function open({ service, url, show = true } = {}) {
    if (!HOSTS[service]) return { ok: false, error: 'serviço desconhecido' };
    if (!hostOk(service, url)) return { ok: false, error: 'endereço fora do serviço' };
    let w = wins.get(service);
    if (w && !w.isDestroyed()) { if (w.webContents.getURL() !== url) w.loadURL(url); if (show) { w.show(); w.focus(); } return { ok: true, reused: true }; }
    const part = 'persist:watch-' + service, ses = session.fromPartition(part);
    // o identificador "Electron/x" no navegador faz alguns sites mostrarem "navegador não suportado"; aqui ele vira o do
    // Chromium em que o app se baseia (não muda nada de DRM: sem Widevine o vídeo protegido continua sem tocar)
    const appTok = String(app.getName()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ses.setUserAgent(ses.getUserAgent().replace(new RegExp(`\\s*(Electron|${appTok})\\/[\\d.]+`, 'gi'), ''));
    w = new BrowserWindow({
      width: 1280, height: 760, minWidth: 640, minHeight: 400, title: `Resenha · ${TITLES[service]}`, backgroundColor: '#000000', autoHideMenuBar: true, show,
      webPreferences: { partition: part, preload: path.join(__dirname, 'watchbridge.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, additionalArguments: ['--resenha-watch=' + service] },
    });
    w.removeMenu?.();
    wins.set(service, w);
    w.webContents.setWindowOpenHandler(({ url: u }) => { if (hostOk(service, u)) { w.loadURL(u); } else if (/^https?:/i.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, u) => { if (!hostOk(service, u)) { e.preventDefault(); if (/^https?:/i.test(u)) shell.openExternal(u); } });
    w.webContents.on('did-fail-load', (_e, code, desc, u, main) => { if (main && code !== -3) sendToApp({ service, t: 'error', code: 'service_down', detail: desc }); });
    w.webContents.on('render-process-gone', () => sendToApp({ service, t: 'error', code: 'html5', detail: 'janela travou' }));
    w.on('closed', () => { wins.delete(service); sendToApp({ service, t: 'closed' }); });
    w.loadURL(url);
    log('watch: janela', service);
    return { ok: true };
  }
  // Netflix: mudar currentTime direto no <video> derruba o player deles (erro M7375); a busca vai pela API do próprio
  // player na página, quando existe. Experimental: não validado com conta real (ver docs/WATCH-TOGETHER.md).
  const NETFLIX_SEEK = (ms) => `(()=>{try{const v=netflix.appContext.state.playerApp.getAPI().videoPlayer;const id=v.getAllPlayerSessionIds().find(s=>s.startsWith('watch'))||v.getAllPlayerSessionIds()[0];v.getVideoPlayerBySessionId(id).seek(${Math.max(0, Math.round(ms))});return true}catch(e){return false}})()`;
  async function cmd(service, c) {
    const w = wins.get(service); if (!w || w.isDestroyed() || !c) return false;
    if (c.t === 'navigate') { if (hostOk(service, c.url)) w.loadURL(c.url); return true; }
    if (c.t === 'show') { w.show(); w.focus(); return true; }
    if (c.t === 'seek' && service === 'netflix') {
      const okApi = await w.webContents.executeJavaScript(NETFLIX_SEEK(c.pos * 1000)).catch(() => false);
      if (okApi) return true;
      sendToApp({ service, t: 'seek_unsupported' }); return false; // não arrisca o currentTime na Netflix
    }
    w.webContents.send('watch-cmd', c); return true;
  }
  function close(service) { const w = wins.get(service); if (w && !w.isDestroyed()) w.close(); }
  function closeAll() { for (const s of [...wins.keys()]) close(s); }

  // mensagens da ponte (só aceitas das janelas de serviço)
  ipcMain.on('watch-bridge', (e, m) => { const s = svcOf(e.sender); if (!s || !m || typeof m !== 'object') return; sendToApp({ ...m, service: s }); });
  ipcMain.handle('watch-open', (_e, o) => open(o || {}));
  ipcMain.handle('watch-cmd', (_e, service, c) => cmd(String(service), c));
  ipcMain.on('watch-close', (_e, service) => (service ? close(String(service)) : closeAll()));
  return { open, cmd, close, closeAll, hostOk, wins };
}
module.exports = { createWatchWindows, hostOk, HOSTS };
