const remote = require('./remote');
const native = require('./native');
const clipFlash = require('./clipflash');
const appAudio = require('./appaudio');
const { createFrontWatch } = require('./frontwatch');
let frontWatch = null; // janela coberta por um jogo em tela cheia (desktop/frontwatch.js)
const updSplash = require('./updsplash');
const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, session, shell, globalShortcut, nativeImage, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { verifyUpdate } = require('./updatekey');

// O app se chamava LocalCord: na primeira abertura depois da troca de nome, a pasta de dados antiga (servidor salvo,
// login, configurações) passa a se chamar Resenha. Se não der para renomear agora (arquivo em uso), usa a antiga e tenta
// de novo na próxima abertura.
const OLD_ID = 'br.local.localcord';
{
  const base = app.getPath('appData'), dir = path.join(base, 'Resenha'), old = path.join(base, 'LocalCord');
  let use = dir;
  // uma pasta Resenha sem config.json nunca foi usada de verdade (o app guarda o servidor ali ao conectar): dá lugar à antiga
  if (fs.existsSync(old) && !fs.existsSync(path.join(dir, 'config.json'))) {
    try { fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(old, dir); } catch { use = old; }
  }
  app.setPath('userData', use);
}
app.setAppUserModelId('br.resenha.app');
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const defaults = { server: '', autoStart: false, startMinimized: false, closeToTray: true, globalHotkeys: true, hotkeyMute: 'CommandOrControl+Shift+M', hotkeyDeafen: 'CommandOrControl+Shift+D', hotkeyClip: 'F8', hotkeyShare: 'CommandOrControl+Shift+S', hardwareAcceleration: true, gpuCompat: 'auto', cacheLimitMB: 1024, bounds: { width: 1360, height: 860 } };
let cfg = { ...defaults };
try { cfg = { ...defaults, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch { /* primeira execução */ }
const saveCfg = () => { try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); } };
const ms = () => Math.round(process.uptime() * 1000); // tempo desde que o programa abriu (diagnóstico da abertura no main.log)

// Abertura rápida: o endereço do servidor (ex.: "umbrel", nome sem domínio) é guardado depois da 1ª resolução e usado
// direto nas próximas aberturas. No Windows, resolver um nome curto passa por DNS/LLMNR/NetBIOS e podia levar vários
// segundos antes de a página começar a carregar. Se o endereço guardado falhar, ele é esquecido e o app reabre.
const srvHost = (() => { try { return new URL(cfg.server).hostname; } catch { return ''; } })();
const isIp = (h) => /^[\d.]+$/.test(h) || h.includes(':');
const pinnedIp = srvHost && !isIp(srvHost) && cfg.serverIp && cfg.serverIp.host === srvHost ? cfg.serverIp.ip : null;
if (pinnedIp) app.commandLine.appendSwitch('host-resolver-rules', `MAP ${srvHost} ${pinnedIp}`);

// Vídeo: por padrão o app desenha igual ao Chrome/Edge (mesmas opções de GPU). Antes ele desligava a sobreposição de
// vídeo da placa e os recursos de vídeo dos drivers para todo mundo, e justo no PC em que isso devia ajudar o vídeo
// ficava escuro e piscando no app, enquanto no navegador (sem essas mudanças) ficava normal. Esses desligamentos agora
// só entram com "Compatibilidade de vídeo" ligada (abaixo).
// recursos do Chromium desligados (junta tudo numa opção só: a última --disable-features apagaria as anteriores)
const offFeatures = new Set();
// bug do Chromium no Windows: a janela deixa de repintar até trocar de programa
offFeatures.add('CalculateNativeWinOcclusion');
// borda amarela em volta da tela ao transmitir: é a moldura que o Windows desenha na captura moderna (WGC). No Windows 11
// o Chromium tira a moldura; no Windows 10 não dá para tirar, então lá a tela inteira é capturada pelo método antigo
// (DXGI, sem moldura e igualmente rápido). Ver também desktop/native.js (120 FPS).
const winBuild = process.platform === 'win32' ? +require('node:os').release().split('.')[2] || 0 : 0;
const wgcBorder = process.platform === 'win32' && winBuild < 20348;
if (wgcBorder) offFeatures.add('AllowWgcScreenCapturer');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// teto do cache de disco (imagens, vídeos, miniaturas): o Chromium apaga os mais antigos sozinho ao passar disso.
// Configurações → Armazenamento (0 = sem teto, o padrão do Chromium)
if (+cfg.cacheLimitMB > 0) app.commandLine.appendSwitch('disk-cache-size', String(Math.round(+cfg.cacheLimitMB * 1048576)));
// PC com duas placas (vídeo integrado do processador + placa dedicada): usa a dedicada. Se o app rodasse na integrada
// com o monitor ligado na dedicada, cada quadro teria que passar de uma placa para a outra (piscadas, cores erradas)
app.commandLine.appendSwitch('force_high_performance_gpu');
if (cfg.hardwareAcceleration === false) app.disableHardwareAcceleration();
// letras borradas por alguns segundos: o Chromium pinta primeiro uma versão em baixa resolução e só depois a nítida
app.commandLine.appendSwitch('disable-low-res-tiling');
// compatibilidade de vídeo (placas/drivers antigos: texto borrado, tela cheia com defeito): rasterização na CPU e
// sem texturas compartilhadas de vídeo. "auto" liga sozinho em placas Intel antigas (detectado na execução anterior).
const gpuCompat = cfg.gpuCompat === 'on' || (cfg.gpuCompat !== 'off' && cfg.gpuOld === true);
if (gpuCompat && cfg.hardwareAcceleration !== false) {
  // interface desenhada pela CPU: só nas placas antigas (letras borradas). Ligado numa placa moderna (RTX 3080), a
  // janela parava de se redesenhar sozinha: transmissão nova só aparecia ao passar o mouse e "Assistir" não abria
  if (cfg.gpuOld === true) app.commandLine.appendSwitch('disable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-zero-copy'); // quadros de vídeo copiados (sem isso o vídeo voltava a piscar ao repetir/voltar)
  app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
  app.commandLine.appendSwitch('disable-accelerated-video-decode'); // clipes e transmissões decodificados pela CPU
  app.commandLine.appendSwitch('force-color-profile', 'srgb'); // sem conversão de cor do monitor/HDR
  // vídeo desenhado junto com a página: sem sobreposição de hardware nem realce/HDR automático do driver
  for (const f of ['DirectCompositionVideoOverlays', 'DirectCompositionVideoOverlaySupport', 'DirectCompositionVideoSwapChainForFullscreen', 'NvidiaVpSuperResolution', 'NvidiaVpTrueHDR', 'IntelVpSuperResolution', 'DirectCompositionLetterboxVideoOptimization']) offFeatures.add(f);
  app.commandLine.appendSwitch('disable-direct-composition-video-overlays');
}
app.commandLine.appendSwitch('disable-features', [...offFeatures].join(','));
const log = (...a) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { /* sem log */ } };
let win, tray, quitting = false, pickedSource = null, pickedName = '', badge = 0;
const serverHost = () => { try { return new URL(cfg.server).hostname; } catch { return ''; } };
const trustedHosts = new Set();
// ---------- certificado do servidor (TLS) ----------
// O servidor Resenha costuma usar certificado autoassinado. Antes o app aceitava QUALQUER certificado para o endereço do
// servidor (alguém no meio da rede podia se passar por ele). Agora: certificado válido de verdade (Let's Encrypt etc.)
// passa normalmente; autoassinado só passa se for O MESMO visto quando a pessoa confirmou o servidor na tela de conexão
// (impressão digital SHA-256 guardada em cfg.certPins). Instalações antigas, sem nada guardado, guardam o da 1ª conexão.
// Certificado diferente: a página não carrega e a tela de conexão explica; confirmar o servidor de novo aceita o novo.
const fpOfDer = (der) => crypto.createHash('sha256').update(der).digest('base64');
const fpOfPem = (pem) => fpOfDer(Buffer.from(String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'));
let certMismatch = '';
function pinOk(host, fp) {
  if (!host || !fp) return false;
  const pins = cfg.certPins ||= {};
  if (!pins[host]) { pins[host] = fp; saveCfg(); log('certificado do servidor guardado', host, fp); return true; }
  if (pins[host] === fp) return true;
  if (certMismatch !== host) log('CERTIFICADO DO SERVIDOR MUDOU', host, 'esperado', pins[host], 'recebido', fp);
  certMismatch = host; return false;
}
// para os pedidos feitos pelo Node (atualizador): mesma regra, conferida assim que a conexão segura abre (antes de enviar o pedido)
function guardTls(req, host) {
  req.on('socket', (s) => s.once('secureConnect', () => {
    if (s.authorized) return; // cadeia válida e nome certo
    let fp = ''; try { fp = fpOfDer(s.getPeerCertificate().raw); } catch { }
    if (!trustedHosts.has(host) || !pinOk(host, fp)) s.destroy(new Error('certificado do servidor não confere'));
  }));
  return req;
}
// no Windows a barra de tarefas usa o .ico com vários tamanhos (16–256); só o PNG deixava o ícone em branco em alguns PCs
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
const OVERLAY = { color: '#1e1f22', symbolColor: '#b5bac1', height: 28 };

// ---------- teste/normalização do endereço do servidor ----------
const probed = new Map(); // origem -> { host, fp } do último teste (o certificado que a pessoa está confirmando)
function probe(url) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { return resolve(null); }
    const lib = u.protocol === 'https:' ? https : http;
    // aqui aceita o certificado que vier: é a pessoa confirmando o servidor; ele fica guardado ao salvar (save-server)
    const req = lib.get({ hostname: u.hostname, port: u.port || undefined, path: '/api/server-info', rejectUnauthorized: false, timeout: 4000 }, (res) => {
      let fp = null, valid = true;
      if (u.protocol === 'https:') { try { valid = !!res.socket.authorized; fp = valid ? null : fpOfDer(res.socket.getPeerCertificate().raw); } catch { } }
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => { try { const j = JSON.parse(b); if (!j.name) return resolve(null);
        probed.set(u.origin, { host: u.hostname, fp });
        const pin = cfg.certPins?.[u.hostname];
        resolve({ url: u.origin, name: j.name, ...(fp && pin && pin !== fp ? { certChanged: true } : {}) }); } catch { resolve(null); } });
    });
    req.on('error', (e) => { log('probe err', url, e.code, e.message); resolve(null); }); req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
async function resolveServer(input) {
  input = String(input || '').trim().replace(/\/+$/, '');
  if (!input) return null;
  const cands = /^https?:\/\//i.test(input) ? [input] : [`https://${input}:3443`, `https://${input}`, `http://${input}:3000`, `http://${input}`];
  if (/^[^/]+:\d+$/.test(input)) cands.splice(0, cands.length, `https://${input}`, `http://${input}`);
  for (const c of cands) { const r = await probe(c); log('probe', c, JSON.stringify(r)); if (r) return r; }
  return null;
}

// ---------- janela ----------
function showConnect(error) {
  if (!win) createWindow(true);
  win.loadFile(path.join(__dirname, 'connect.html'), { query: { current: cfg.server, error: error || '' } });
}
function loadServer() {
  if (!cfg.server) return showConnect();
  trustedHosts.add(serverHost());
  log('abertura', ms(), 'ms: carregando', cfg.server, pinnedIp ? `(endereço guardado ${pinnedIp})` : '');
  win.loadURL(cfg.server).catch(() => { });
}
// guarda (ou atualiza) o endereço do servidor para a próxima abertura; roda depois que a página já carregou
function rememberServerIp() {
  if (!srvHost || isIp(srvHost)) return;
  const t = ms();
  require('node:dns').lookup(srvHost, (err, ip) => {
    log('abertura: nome', srvHost, err ? 'não resolveu (' + err.code + ')' : '-> ' + ip, 'em', ms() - t, 'ms');
    if (!err && ip && cfg.serverIp?.ip !== ip) { cfg.serverIp = { host: srvHost, ip }; saveCfg(); }
  });
}
function createWindow(forceShow) {
  win = new BrowserWindow({
    ...cfg.bounds, minWidth: 940, minHeight: 600, show: !(process.argv.includes('--hidden') || cfg.startMinimized) || !!forceShow, titleBarStyle: 'hidden', titleBarOverlay: OVERLAY, backgroundColor: '#1e1f22', title: 'Resenha', icon: icon(), autoHideMenuBar: true,
    webPreferences: { devTools: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu(); Menu.setApplicationMenu(null);
  // a página recarregou, navegou ou travou: a sessão no servidor já acabou, então o controle remoto desarma aqui também
  for (const ev of ['did-navigate', 'render-process-gone', 'unresponsive']) win.webContents.on(ev, () => { remote.stop(); if (ev !== 'unresponsive') native.stop(); });
  const CSS = 'html.lc-fs #lc-titlebar{display:none} html.lc-desk .fsbox video{will-change:auto;transform:none} :fullscreen{margin:0!important;border:0!important;border-radius:0!important;transform:none!important;animation:none!important} html.lc-desk #app{margin-top:28px;height:calc(100vh - 28px)} html.lc-desk #settings{top:28px} html.lc-desk #settings .close{top:40px} body.lc-connect{padding-top:28px} #lc-titlebar{position:fixed;top:0;left:0;right:0;height:28px;z-index:2147483000;-webkit-app-region:drag;background:#1e1f22;display:flex;align-items:center;padding-left:12px;font:600 12px "Segoe UI",sans-serif;color:#b5bac1;user-select:none}#lc-upd{display:none;-webkit-app-region:no-drag;margin-left:auto;margin-right:150px;width:28px;height:20px;padding:0;border:0;border-radius:4px;background:#248046;color:#fff;cursor:pointer;align-items:center;justify-content:center}#lc-upd:hover{background:#1a6334}#lc-upd.on{display:flex}#lc-upd svg{width:14px;height:14px;fill:currentColor}';
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(CSS).catch(() => { });
    win.webContents.executeJavaScript("document.documentElement.classList.add('lc-desk');if(location.protocol==='file:')document.body.classList.add('lc-connect');if(!document.getElementById('lc-titlebar')){const t=document.createElement('div');t.id='lc-titlebar';t.textContent='Resenha';document.documentElement.appendChild(t)}").catch(() => { });
    // ícone de download na barra do topo quando há versão nova
    win.webContents.executeJavaScript(`(()=>{const t=document.getElementById('lc-titlebar');if(!t||document.getElementById('lc-upd')||!window.lcDesktop)return;const b=document.createElement('button');b.id='lc-upd';b.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2ZM19 9h-4V3H9v6H5l7 7 7-7Z"/></svg>';let busy=false;b.onclick=async()=>{if(busy)return;busy=true;b.style.opacity='.6';const ok=await lcDesktop.installUpdate();if(!ok){busy=false;b.style.opacity=''}};t.appendChild(b);const on=v=>{b.title='Atualizar para a versão '+v.version;b.classList.add('on')};lcDesktop.onUpdate(on);lcDesktop.getUpdate().then(v=>v&&on(v))})()`).catch(() => { });
  });
  // força o repaint (evita artefatos e texto borrado que só somem ao trocar de janela ou esperar):
  // ao trocar de tela, entrar/sair da tela cheia, restaurar, maximizar, mover entre monitores ou mudar a escala
  const repaint = () => [0, 60, 300, 1000].forEach(t => setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.invalidate(); }, t));
  win.webContents.on('did-navigate-in-page', repaint);
  win.webContents.on('media-started-playing', repaint); // vídeo/transmissão começou: garante que a janela redesenha (no PC com redesenho atrasado só aparecia ao mexer o mouse)
  for (const ev of ['show', 'restore', 'maximize', 'unmaximize', 'moved', 'focus']) win.on(ev, repaint);
  // estado real da janela para a página (ver public/state.js): minimizada ou na bandeja = escondida
  // e, no Windows, com outro programa em tela cheia por cima no mesmo monitor (jogo; ver desktop/frontwatch.js)
  let lastHidden = null;
  const winState = (force) => {
    if (!win || win.isDestroyed()) return;
    const hidden = !win.isVisible() || win.isMinimized() || !!front?.covered;
    if (hidden === lastHidden && force !== true) return; lastHidden = hidden;
    win.webContents.send('win-state', { hidden, covered: !!front?.covered });
  };
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, winState);
  win.on('focus', () => { front?.focused(); winState(); }); // a Resenha veio para a frente: não espera a próxima leitura
  win.webContents.on('did-finish-load', () => winState(true));
  const helper = process.platform === 'win32' ? appAudio.helperPath() : null;
  frontWatch?.stop(); frontWatch = null;
  let front = null;
  if (helper) {
    let hwnd = ''; try { const b = win.getNativeWindowHandle(); hwnd = String(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)); } catch { }
    front = createFrontWatch({ exe: helper, helper: appAudio.getHelper(), hwnd, onChange: (c, i) => { log(c ? 'coberta por ' + (i?.exe || 'outro programa') + ' em tela cheia' : 'à vista de novo'); winState(); } });
    front.start(); frontWatch = front;
    win.on('closed', () => front.stop());
  }
  screen.on('display-metrics-changed', repaint);
  // tela cheia de vídeo/transmissão/clipe: os botões nativos da barra de título (sobrepostos) ficavam desenhados por cima
  // e a página repintava com defeito; esconde a barra durante a tela cheia e repinta ao entrar e ao sair
  win.on('enter-html-full-screen', () => { try { win.setTitleBarOverlay({ color: '#000000', symbolColor: '#000000', height: 28 }); } catch { } win.webContents.executeJavaScript("document.documentElement.classList.add('lc-fs')").catch(() => { }); repaint(); });
  win.on('leave-html-full-screen', () => { try { win.setTitleBarOverlay(OVERLAY); } catch { } win.webContents.executeJavaScript("document.documentElement.classList.remove('lc-fs')").catch(() => { }); repaint(); });
  win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  win.webContents.on('before-input-event', (e, i) => {
    const k = String(i.key).toLowerCase();
    if (k === 'alt' || k === 'f12' || k === 'f11' || (i.control && i.shift && ['i', 'j', 'c'].includes(k))) e.preventDefault();
  });
  win.on('show', closeSplash);
  win.once('ready-to-show', () => { win.setIcon(icon()); // reaplica o ícone (janela criada escondida às vezes ficava sem ícone na barra de tarefas)
    if (!(process.argv.includes('--hidden') || cfg.startMinimized) || forceShow) win.show(); });
  win.on('close', (e) => {
    cfg.bounds = win.isMaximized() ? cfg.bounds : win.getBounds(); saveCfg();
    if (!quitting && cfg.closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  const sameServer = (url) => { try { return new URL(url).origin === new URL(cfg.server).origin; } catch { return false; } };
  win.webContents.on('will-navigate', (e, url) => { if (!sameServer(url) && !url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3 || url.startsWith('file:')) return;
    if (pinnedIp) { log('endereço guardado falhou', pinnedIp, desc, '- reabrindo sem ele'); delete cfg.serverIp; saveCfg(); app.relaunch(); app.exit(0); return; }
    if (certMismatch && certMismatch === serverHost()) { certMismatch = ''; return showConnect(`O certificado de segurança de ${cfg.server} mudou. Se o servidor foi reinstalado ou o certificado foi trocado, confirme o endereço de novo; se não, alguém pode estar se passando pelo servidor.`); }
    showConnect(`Não foi possível carregar ${cfg.server} (${desc}).`);
  });
  // tempos da abertura (main.log): rede (DNS, conexão, 1º byte) e quando a página ficou pronta
  win.webContents.once('dom-ready', () => log('abertura', ms(), 'ms: página montada'));
  win.webContents.once('did-finish-load', () => {
    log('abertura', ms(), 'ms: página carregada');
    win.webContents.executeJavaScript("(()=>{const n=performance.getEntriesByType('navigation')[0];return n?JSON.stringify({dns:Math.round(n.domainLookupEnd-n.domainLookupStart),conexao:Math.round(n.connectEnd-n.connectStart),primeiroByte:Math.round(n.responseStart-n.requestStart),pronta:Math.round(n.domContentLoadedEventEnd)}):''})()").then(r => r && log('abertura: rede', r)).catch(() => { });
    setTimeout(rememberServerIp, 1500);
  });
  win.on('page-title-updated', (e, t) => { win.setTitle(t); });
}
// (a janelinha "Iniciando…" saiu: a janela principal já abre na hora)
let splash = null;
function closeSplash() { if (splash && !splash.isDestroyed()) splash.destroy(); splash = null; }
function showWin() { if (!win) return; win.show(); win.focus(); }

// ---------- bandeja / badge / atalhos ----------
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')));
  tray.setToolTip('Resenha');
  const send = (k) => win?.webContents.send('hotkey', k);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir a Resenha', click: showWin },
    { label: 'Silenciar / ativar microfone', click: () => send('mute') },
    { label: 'Ensurdecer / ativar áudio', click: () => send('deafen') },
    { label: 'Iniciar / encerrar transmissão', click: () => send('share') },
    { type: 'separator' },
    { label: 'Trocar servidor…', click: () => { showWin(); showConnect(); } },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => (win?.isVisible() ? win.focus() : showWin()));
}
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!cfg.globalHotkeys) return;
  const send = (k) => win?.webContents.send('hotkey', k);
  // atalhos salvos por versões antigas com o nome da tecla (ex.: CommandOrControl+Backslash): troca pelo caractere
  const KEYS = { Backslash: '\\', IntlBackslash: '\\', Slash: '/', IntlRo: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' };
  const fix = (acc) => String(acc || '').split('+').map(p => KEYS[p] || p).join('+');
  const reg = (acc, k) => { acc = fix(acc); try { if (acc && !globalShortcut.register(acc, () => send(k))) log('atalho em uso por outro app:', acc); } catch (e) { log('atalho inválido', acc, e.message); } };
  reg(cfg.hotkeyMute, 'mute'); reg(cfg.hotkeyDeafen, 'deafen'); reg(cfg.hotkeyClip, 'clip'); reg(cfg.hotkeyShare, 'share');
}
function setBadge(n) {
  badge = n | 0;
  tray?.setToolTip(badge ? `Resenha — ${badge} não lida(s)` : 'Resenha');
  if (process.platform === 'win32' && win) {
    if (!badge) return win.setOverlayIcon(null, '');
    // ponto vermelho 16x16 desenhado em memória (BGRA)
    const s = 16, buf = Buffer.alloc(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const d = (x - 7.5) ** 2 + (y - 7.5) ** 2, i = (y * s + x) * 4; if (d <= 49) { buf[i] = 67; buf[i + 1] = 63; buf[i + 2] = 242; buf[i + 3] = 255; } }
    win.setOverlayIcon(nativeImage.createFromBitmap(buf, { width: s, height: s }), `${badge} não lida(s)`);
  }
}

// ---------- sessão (certificado, permissões, captura de tela) ----------
const certRefused = new Set(); // servidores cujo certificado foi recusado nesta abertura
function setVerifyProc() {
  const ses = session.defaultSession;
  ses.setCertificateVerifyProc((req, cb) => {
    if (req.errorCode === 0 || !trustedHosts.has(req.hostname)) return cb(-3);
    let fp = ''; try { fp = fpOfPem(req.certificate.data); } catch { }
    const good = pinOk(req.hostname, fp); if (!good) certRefused.add(req.hostname);
    cb(good ? 0 : -2);
  });
}
function setupSession() {
  const ses = session.defaultSession;
  // -3 = vale a verificação normal do Chromium; 0 = aceita; -2 = recusa (ver pinOk acima)
  setVerifyProc();
  app.on('certificate-error', (e, _wc, url, _err, cert, cb) => {
    try { const h = new URL(url).hostname; if (trustedHosts.has(h) && pinOk(h, fpOfPem(cert.data))) { e.preventDefault(); return cb(true); } } catch { }
    cb(false);
  });
  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'audioCapture', 'videoCapture']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => allowed.has(perm));
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      // janela minimizada (jogo em tela cheia depois do alt+tab) não aparece na lista do Chromium, mas dá para capturá-la pelo
      // id mesmo assim: enquanto está minimizada não chega imagem, e quando a pessoa volta para o jogo a transmissão mostra o jogo.
      // Antes caía para a TELA INTEIRA (e com ela o áudio e tudo mais que estivesse aberto) — é o que o Discord evita.
      const picked = /^(window|screen):\d+:\d+$/.test(pickedSource || '') ? pickedSource : null;
      const s = sources.find(x => x.id === picked) || (picked?.startsWith('window:') ? { id: picked, name: pickedName || 'Janela' } : null)
        || sources.find(x => x.id.startsWith('screen:')) || sources[0];
      if (!s) return callback({});
      remote.setShared(s); // o controle remoto precisa saber qual monitor está sendo transmitido
      // áudio = loopback do sistema todo (o Windows não isola uma janela), tanto de tela quanto de janela; o renderer pede restrictOwnAudio para excluir a própria Resenha
      callback(request.audioRequested ? { video: s, audio: 'loopback' } : { video: s });
    } catch (e) { console.error(e); callback({}); }
  }, { useSystemPicker: false });
}

// ---------- IPC ----------
// janelas já vistas ficam na lista por alguns minutos: jogo em tela cheia some do Windows ao dar alt+tab (minimiza)
const seenWindows = new Map();
ipcMain.handle('get-sources', async () => {
  // janelas pelo programa nativo (em paralelo): inclui as MINIMIZADAS, com o processo (para o áudio só do jogo) e se é jogo
  const [list, wins] = await Promise.all([desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true }), appAudio.listWindows().catch(() => [])]);
  const byHwnd = new Map(wins.map(w => [String(w.hwnd), w]));
  const extra = (w) => (w ? { pid: w.pid, exe: w.exe, game: !!w.game, minimized: !!w.minimized, fullscreen: !!w.fullscreen } : {});
  const now = Date.now(), out = [];
  for (const s of list) {
    if (s.name === 'Resenha' || /NVIDIA GeForce Overlay/i.test(s.name)) continue; // o overlay da NVIDIA só aparece preto
    const type = s.id.startsWith('screen') ? 'screen' : 'window', w = type === 'window' ? byHwnd.get(s.id.split(':')[1]) : null;
    if (w) byHwnd.delete(String(w.hwnd));
    const item = { id: s.id, name: s.name, type, thumbnail: s.thumbnail.toDataURL(), appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : w?.icon || null, ...extra(w) };
    out.push(item);
    if (type === 'window') seenWindows.set(s.id, { item, at: now });
  }
  // o que o Chromium não lista (janela minimizada: jogo em tela cheia depois do alt+tab) — sem miniatura, com o ícone do programa
  for (const w of byHwnd.values()) {
    if (!w.minimized || /^(Resenha|Program Manager)$/.test(w.title)) continue;
    const item = { id: `window:${w.hwnd}:0`, name: w.title, type: 'window', thumbnail: null, appIcon: w.icon || null, ...extra(w) };
    out.push(item); seenWindows.set(item.id, { item, at: now });
  }
  const live = new Set(out.map(o => o.id));
  for (const [id, v] of seenWindows) {
    if (now - v.at > 10 * 60 * 1000) seenWindows.delete(id);
    else if (!live.has(id)) out.push({ ...v.item, name: v.item.name + ' (minimizado)' });
  }
  return out;
});
// atalho da transmissão: o que está em primeiro plano agora (janela, jogo em janela ou em tela cheia), sem abrir o seletor.
// O programa nativo lista as janelas na ordem do Windows (a da frente primeiro); a da Resenha já fica de fora (mesmo processo).
// Sem a lista (fora do Windows / componente ausente) ou com a área de trabalho na frente: a tela onde está o mouse.
const NOT_FRONT = /^(NVIDIA GeForce Overlay|Resenha)$/i; // sobreposições que ficam sempre por cima (não são "a janela atual")
ipcMain.handle('foreground-source', async () => {
  const wins = await appAudio.listWindows().catch(() => []);
  const w = wins.find(x => !x.minimized && !NOT_FRONT.test(String(x.title || '').trim()));
  if (w && !/^Program Manager$/i.test(w.title)) { // "Program Manager" = a área de trabalho na frente: vai a tela
    return { id: `window:${w.hwnd}:0`, name: w.game ? appAudio.cleanTitle(w.title) : w.title, type: 'window', pid: w.pid, exe: w.exe, game: !!w.game, fullscreen: !!w.fullscreen };
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const ss = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
  const s = ss.find(x => String(x.display_id) === String(d.id)) || ss[0];
  return s ? { id: s.id, name: s.name, type: 'screen' } : null;
});
ipcMain.handle('select-source', (_e, id, name) => { pickedSource = String(id || ''); pickedName = String(name || '').slice(0, 200); return true; });
// áudio só do jogo (desktop/appaudio.js): o PCM vai direto para a página, que monta a trilha de áudio da transmissão
ipcMain.handle('app-audio-capable', () => appAudio.capable());
ipcMain.handle('app-audio-start', (e, o) => appAudio.start({ pid: +o?.pid || 0, mode: o?.mode === 'exclude' ? 'exclude' : 'include' },
  (buf) => { if (!e.sender.isDestroyed()) e.sender.send('app-audio-data', buf); }));
ipcMain.on('app-audio-stop', () => appAudio.stop());
// vigia do áudio do jogo (reconectou / jogo fechou, esperando) e estado da janela transmitida (minimizada / fechada)
appAudio.setEventSink((ev) => { if (win && !win.isDestroyed()) win.webContents.send('app-audio-event', ev); });
ipcMain.handle('source-state', () => appAudio.sourceState(pickedSource).catch(() => ({ kind: 'unknown' })));
// jogo aberto agora (mesma detecção da transmissão): vira a atividade "Jogando X" para os amigos
ipcMain.handle('detect-game', () => appAudio.detectGame().catch(() => null));
// avisos do programa nativo quando a lista de janelas muda (eventos do Windows): o "Jogando X" aparece em 1 a 2 s em vez
// de esperar a próxima consulta de 20 s, e a janela transmitida minimizada/fechada avisa na hora (antes, até 3 s)
let lastGameId, lastSrcState = '';
if (process.platform === 'win32') appAudio.watchWindows(async (list) => {
  if (!win || win.isDestroyed()) return;
  const g = await appAudio.detectGame({ cached: true }).catch(() => null);
  if ((g?.id || null) !== lastGameId) { lastGameId = g?.id || null; win.webContents.send('game-changed', g ? { id: g.id, title: g.title } : null); }
  if (!/^window:/.test(pickedSource)) return;
  const st = await appAudio.sourceState(pickedSource, list).catch(() => null), k = JSON.stringify(st);
  if (st && k !== lastSrcState) { lastSrcState = k; win.webContents.send('source-state', st); }
});
ipcMain.on('set-badge', (_e, n) => setBadge(n));
// aviso de clipe capturado por cima do jogo (desktop/clipflash.js)
ipcMain.on('clip-flash', (_e, o) => { if (o && typeof o === 'object') clipFlash.show({ ok: o.ok !== false, title: String(o.title || '').slice(0, 80), sub: String(o.sub || '').slice(0, 120), kind: o.kind === 'share' ? 'share' : undefined }, appAudio.getHelper()); });
// controle remoto (desktop/remote.js): o renderer só chama start depois que o dono aceitou
ipcMain.handle('remote-capable', () => remote.capable());
ipcMain.handle('remote-start', (_e, o) => remote.start(o || {}));
ipcMain.on('remote-input', (_e, ev) => remote.input(ev));
ipcMain.on('remote-stop', () => remote.stop());
remote.onRemoteEvent((k) => { if (win && !win.isDestroyed()) win.webContents.send('remote-event', k); });
// push-to-talk global: a página diz a tecla enquanto está numa chamada em modo PTT; segue "Atalhos globais"
let pttWanted = null;
const applyPtt = () => remote.setPtt(cfg.globalHotkeys ? pttWanted : null);
ipcMain.handle('ptt-set', (_e, code) => { pttWanted = code || null; const r = applyPtt(); return { ...r, global: !!cfg.globalHotkeys }; });
remote.onPtt((down) => { if (win && !win.isDestroyed()) win.webContents.send('ptt', down); });
app.on('before-quit', () => { frontWatch?.stop(); remote.shutdown(); native.shutdown(); clipFlash.hide(); appAudio.shutdown(); });
// transmissão a 120 FPS (desktop/native.js): o renderer pede a sessão ao servidor e passa as chaves para cá
ipcMain.handle('native-capable', () => native.capable());
ipcMain.handle('native-start', (_e, o) => native.start({ ...(o || {}), sourceId: (o && o.sourceId) || pickedSource }));
ipcMain.on('native-stop', () => native.stop());
native.onNativeEvent((ev) => { if (win && !win.isDestroyed()) win.webContents.send('native-event', ev); });
// modo leve: deixa o Chromium desacelerar a página escondida (o renderer só liga fora de chamada)
ipcMain.on('set-throttle', (_e, on) => { if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(!!on); });
ipcMain.handle('get-settings', () => ({ ...cfg, version: app.getVersion(), gpuCompatActive: gpuCompat, gpuName: gpuName, updateFailed }));
ipcMain.handle('set-settings', (_e, patch) => {
  for (const k of ['autoStart', 'startMinimized', 'closeToTray', 'globalHotkeys']) if (k in patch) cfg[k] = !!patch[k];
  for (const k of ['hotkeyMute', 'hotkeyDeafen', 'hotkeyClip', 'hotkeyShare']) if (typeof patch[k] === 'string') cfg[k] = patch[k];
  if ('hardwareAcceleration' in patch) cfg.hardwareAcceleration = !!patch.hardwareAcceleration;
  if (['auto', 'on', 'off'].includes(patch.gpuCompat)) cfg.gpuCompat = patch.gpuCompat;
  // ajustes desta máquina (microfone, fone, câmera, modo leve…) guardados fora do navegador: voltam se o armazenamento da página for apagado
  if (patch.devicePrefs && typeof patch.devicePrefs === 'object' && JSON.stringify(patch.devicePrefs).length < 20000) cfg.devicePrefs = patch.devicePrefs;
  if ('cacheLimitMB' in patch) cfg.cacheLimitMB = Math.max(0, Math.min(65536, Math.round(+patch.cacheLimitMB || 0)));
  if ('hotkeyMute' in patch || 'hotkeyDeafen' in patch || 'hotkeyClip' in patch || 'hotkeyShare' in patch) registerHotkeys();
  if ('autoStart' in patch) app.setLoginItemSettings({ openAtLogin: cfg.autoStart, args: ['--hidden'] });
  if ('globalHotkeys' in patch) { registerHotkeys(); applyPtt(); }
  saveCfg(); return true;
});
// limpa o que é só cache (mídias, scripts compilados, shaders, cache do app instalável); login e configurações ficam
ipcMain.handle('clear-cache', async () => {
  const ses = session.defaultSession;
  await ses.clearCache();
  await ses.clearStorageData({ storages: ['cachestorage', 'shadercache'] }).catch(() => { });
  await ses.clearCodeCaches?.({}).catch(() => { });
  return true;
});
// consumo agora (Configurações → Modo leve): CPU e memória de cada processo do app, agrupados pelo que fazem
ipcMain.handle('app-metrics', () => app.getAppMetrics().map(m => ({ type: m.type, service: m.serviceName || m.name || '', cpu: m.cpu?.percentCPUUsage || 0, mem: (m.memory?.workingSetSize || 0) * 1024 })));
ipcMain.handle('cache-info', async () => ({ http: await session.defaultSession.getCacheSize(), limitMB: +cfg.cacheLimitMB || 0 }));
ipcMain.handle('relaunch', () => {
  quitting = true;
  if (update?.file && !updating && !portable) { updating = true; runInstaller(update.file, true); app.exit(0); return true; } // reabre já atualizado
  app.relaunch(); app.exit(0); return true;
});
ipcMain.handle('change-server', () => { showConnect(); return true; });
ipcMain.handle('test-server', async (_e, input) => { const r = await resolveServer(input); return r; });
ipcMain.handle('save-server', async (_e, url) => {
  cfg.server = url;
  // guarda o certificado que a pessoa acabou de confirmar (autoassinado); válido de verdade não precisa
  const p = probed.get((() => { try { return new URL(url).origin; } catch { return ''; } })());
  if (p) {
    cfg.certPins ||= {};
    const changed = (cfg.certPins[p.host] || null) !== p.fp;
    if (p.fp) cfg.certPins[p.host] = p.fp; else delete cfg.certPins[p.host];
    certMismatch = '';
    // o Chromium guarda o "recusado" do certificado anterior até fechar: reabre o app (troca de certificado é rara)
    if (changed && certRefused.has(p.host)) { cfg.server = url; saveCfg(); log('certificado novo aceito; reabrindo'); app.relaunch(); app.exit(0); return true; }
  }
  saveCfg(); trustedHosts.add(serverHost()); loadServer(); return true;
});

// ---------- atualização (GitHub Releases) ----------
const REPO = 'Sploters/Resenha';
let update = null, updating = false;
// pedidos do atualizador: ao servidor Resenha ou ao GitHub, SÓ por HTTPS. Certificado: válido de verdade, ou (só para o
// servidor Resenha) o mesmo guardado ao confirmar o servidor (guardTls). Mesmo assim o instalador só roda se a
// assinatura conferir com a chave pública do app (desktop/updatekey.js): quem controla o servidor ou a rede não consegue
// fazer o app instalar outra coisa.
function newerVer(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; }
const fromServer = (url) => { try { return new URL(url).hostname === serverHost(); } catch { return false; } };
const isHttps = (url) => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };
const reqOpts = (url, accept) => ({ headers: { 'User-Agent': 'Resenha', Accept: accept }, timeout: 8000, ...(fromServer(url) ? { rejectUnauthorized: false } : {}) });
// pedido HTTPS (http:// é recusado); com o servidor Resenha, o certificado é conferido por guardTls antes de mandar o pedido
function httpsGet(url, opts, onRes) {
  if (!isHttps(url)) throw new Error('recusado: atualização só por HTTPS (' + String(url).slice(0, 80) + ')');
  const req = https.get(url, opts, onRes);
  return fromServer(url) ? guardTls(req, serverHost()) : req;
}
const getJson = (url) => new Promise((resolve) => {
  try {
    httpsGet(url, reqOpts(url, 'application/json'), (res) => {
      let b = ''; res.on('data', d => { b += d; if (b.length > 1e6) res.destroy(); }); res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(b) : null); } catch { resolve(null); } });
    }).on('error', (e) => { log('atualização: pedido falhou', String(url).slice(0, 120), e.message); resolve(null); }).on('timeout', function () { this.destroy(); });
  } catch (e) { log('atualização:', e.message); resolve(null); }
});
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
// 1º o servidor Resenha (funciona com o repositório privado: o servidor consulta o GitHub com a chave dele);
// se o servidor ainda não tiver a rota ou a chave, tenta o GitHub direto (repositório público)
// uma consulta por vez: a página também pode pedir (botão "Reiniciar agora" antes da busca automática terminar)
let checking = null;
function checkUpdate() { return (checking ||= doCheckUpdate().finally(() => { checking = null; })); }
async function doCheckUpdate() {
  let found = null;
  // servidor só por HTTPS: num servidor http:// o app procura direto no GitHub
  if (cfg.server && isHttps(cfg.server)) {
    const r = await getJson(new URL('/api/desktop/update', cfg.server).href);
    if (r?.version && r.url) found = { version: String(r.version), url: new URL(r.url, cfg.server).href, name: r.name || `Resenha-Setup-${r.version}.exe`, signature: r.signature || null };
  } else if (cfg.server) log('atualização: o servidor não é HTTPS; procurando direto no GitHub');
  if (!found) {
    const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = rel?.assets?.find(a => /^Resenha-Setup-.*\.exe$/i.test(a.name)), sig = asset && rel.assets.find(a => a.name === asset.name + '.sig');
    if (rel?.tag_name && asset) found = { version: String(rel.tag_name).replace(/^v/i, ''), url: asset.browser_download_url, name: asset.name, sigUrl: sig?.browser_download_url || null };
  }
  if (found && !/^\d+\.\d+\.\d+$/.test(found.version)) return;
  // o nome do arquivo vem de fora: só o formato esperado (vai para a pasta temporária e é executado)
  if (found && !/^Resenha-Setup-[\d.]+\.exe$/i.test(found.name)) { log('atualização: nome de arquivo inesperado', found.name); return; }
  if (!found || !newer(found.version, app.getVersion())) return;
  if (update?.version === found.version) return; // já encontrada (e baixada ou baixando)
  update = found;
  log('atualização disponível', found.version, found.url);
  // baixa em segundo plano e só então avisa: "Reiniciar agora" instala em segundos, sem abrir instalador
  await prepareUpdate().catch((e) => log('download da atualização falhou', e.message));
  if (update === found) win?.webContents.send('update-available', { version: found.version, ready: !!found.file });
}
// instalador da versão nova, baixado uma vez para a pasta temporária
function prepareUpdate() {
  const u = update; if (!u) return Promise.reject(new Error('sem atualização'));
  return (u.downloading ||= (async () => {
    const file = path.join(app.getPath('temp'), u.name), part = file + '.part';
    // progresso para a tela "Atualizando" da página (desde a 1.0.29)
    let last = -1;
    const signature = u.signature || (u.sigUrl ? await getJson(u.sigUrl) : null);
    if (!signature) throw new Error('atualização sem assinatura: recusada');
    await download(u.url, part, 5, (got, size) => { const pct = size ? Math.floor(got * 100 / size) : -1; if (pct !== last) { last = pct; win?.webContents.send('update-progress', { version: u.version, pct, got, size }); } });
    // só vira "instalador pronto" se a assinatura conferir (nome, versão, tamanho e SHA-256 do que foi baixado)
    const sha256 = await new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(part).on('data', c => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', no); });
    const bad = verifyUpdate(signature, { name: u.name, version: u.version, size: fs.statSync(part).size, sha256 });
    if (bad) { fs.rmSync(part, { force: true }); log('ATUALIZAÇÃO RECUSADA', u.version, bad); throw new Error(bad); }
    fs.renameSync(part, file); u.file = file; log('atualização baixada e assinatura conferida', u.version, sha256);
    return file;
  })().catch((e) => { u.downloading = null; throw e; }));
}
// versão portátil (um .exe solto, sem instalação): o instalador silencioso criaria uma instalação, então abre o
// instalador normal como antes
const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
// instalação silenciosa (sem janelas): /S = silencioso, --updated = atualização da instalação que já existe (mesmo
// lugar, atalhos e dados), --force-run = abre o app de novo quando termina
// Instala a versão nova: o app abre o instalador DIRETO (o jeito que sempre funcionou) e só então fecha.
// reopen (o usuário pediu "Reiniciar agora"): também abre a janelinha "Atualizando…" (desktop/updsplash.js), que só
// acompanha o instalador e reabre o app se ele não voltar sozinho; se a janela falhar, a instalação segue igual.
// Sem reopen (fechou o app com a atualização baixada): instala quieto.
// A versão pedida fica anotada (cfg.pendingUpdate): se o app abrir de novo na versão velha, a página avisa que não deu.
function runInstaller(file, reopen) {
  const args = portable ? [] : ['/S', '--updated', ...(reopen ? ['--force-run'] : [])];
  log('instalando atualização', update?.version, args.join(' '), file);
  if (!portable && update?.version) { cfg.pendingUpdate = { version: update.version, at: Date.now() }; saveCfg(); }
  let p;
  try { p = require('node:child_process').spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }); }
  catch (e) { log('instalador não abriu', e.message); return false; }
  p.on('error', (e) => log('instalador não abriu', e.message)); p.unref();
  if (reopen && !portable && p.pid) {
    // o ícone está dentro do app.asar (o PowerShell não lê): copia para a pasta temporária
    const dir = app.getPath('userData');
    let icon = ''; try { icon = path.join(app.getPath('temp'), 'resenha-update.ico'); fs.writeFileSync(icon, fs.readFileSync(path.join(__dirname, 'build', 'icon.ico'))); } catch { icon = ''; }
    updSplash.watchInstall({ pid: p.pid, exe: process.execPath, version: update?.version, icon, dir }, log);
  }
  return !!p.pid;
}
// abriu: a atualização anotada entrou? (versão igual ou maior = sim; senão o instalador não rodou ou falhou)
let updateFailed = null;
if (cfg.pendingUpdate) {
  const pu = cfg.pendingUpdate; delete cfg.pendingUpdate; saveCfg();
  const ok = !newerVer(pu.version, app.getVersion());
  let tail = ''; try { tail = fs.readFileSync(path.join(app.getPath('userData'), 'update.log'), 'utf8').trim().split(/\r?\n/).slice(-4).join(' | '); } catch { }
  log(ok ? 'atualização instalada' : 'ATUALIZAÇÃO NÃO INSTALOU', 'pedida', pu.version, 'aberta', app.getVersion(), tail ? '| ' + tail : '');
  if (!ok && Date.now() - pu.at < 3 * 3600e3) updateFailed = { version: pu.version };
}
function download(url, dest, redirects = 5, onProgress) {
  return new Promise((resolve, reject) => {
    httpsGet(url, { ...reqOpts(url, 'application/octet-stream'), timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1, onProgress)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      // download interrompido não pode virar "instalador pronto": confere o tamanho anunciado
      const size = +res.headers['content-length'] || 0;
      const f = fs.createWriteStream(dest); res.pipe(f); f.on('error', reject);
      if (onProgress) { let got = 0; res.on('data', (c) => { got += c.length; onProgress(got, size); }); }
      // conexão caiu no meio: sem isso o download nunca terminava nem falhava
      res.on('aborted', () => reject(new Error('download interrompido'))); res.on('error', reject);
      f.on('finish', () => f.close(() => { const got = fs.statSync(dest).size; if (size && got !== size) reject(new Error(`download incompleto (${got} de ${size} bytes)`)); else resolve(); }));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('tempo esgotado')); });
  });
}
ipcMain.handle('get-update', () => update && { version: update.version, ready: !!update.file });
// a página pede para procurar já (e baixar): devolve a versão nova e se ela está pronta para instalar (desde a 1.0.28)
ipcMain.handle('check-update', async () => { await checkUpdate().catch(() => { }); if (update && !update.file) await prepareUpdate().catch(() => { }); return update && { version: update.version, ready: !!update.file }; });
// diagnóstico para o relatório de problema: fim do main.log, placas de vídeo, aceleração e versões (sem senhas/chaves)
ipcMain.handle('get-diagnostics', async () => {
  let logTail = ''; try { logTail = fs.readFileSync(path.join(app.getPath('userData'), 'main.log'), 'utf8').split('\n').slice(-150).join('\n'); } catch { }
  let gpus = []; try { const g = await app.getGPUInfo('basic'); gpus = (g.gpuDevice || []).map(d => ({ nome: d.deviceString || `${d.vendorId.toString(16)}:${d.deviceId.toString(16)}`, driver: d.driverVersion, ativa: !!d.active })); } catch { }
  const os = require('node:os'), d = screen.getPrimaryDisplay();
  return {
    app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    sistema: `${os.type()} ${os.release()} ${os.arch()}`, memoriaGB: Math.round(os.totalmem() / 2 ** 30), cpu: os.cpus()[0]?.model, nucleos: os.cpus().length,
    tela: { largura: d.size.width, altura: d.size.height, escala: d.scaleFactor, hz: d.displayFrequency },
    gpus, aceleracao: app.getGPUFeatureStatus(), compatibilidadeVideo: { escolha: cfg.gpuCompat, ativa: gpuCompat }, aceleracaoHardware: cfg.hardwareAcceleration !== false,
    servidor: cfg.server, enderecoGuardado: pinnedIp || null, abertoHaMin: Math.round(process.uptime() / 60), log: logTail,
  };
});
// "Reiniciar agora": instala sem janelas e o app reabre sozinho já na versão nova
// Nunca abre o instalador com janelas: se o app ainda não achou a versão nova (a página viu primeiro), procura e baixa
// agora; se não der, devolve false e a página só avisa para tentar de novo.
ipcMain.handle('install-update', async () => {
  if (updating) return true; // já está instalando
  if (!update) await checkUpdate().catch(() => { });
  if (!update || updating) return !!updating;
  updating = true;
  try {
    const file = update.file || await prepareUpdate();
    if (!runInstaller(file, true)) { updating = false; return false; } // instalador não abriu: o app continua aberto
    // a página mostra "Instalando…" por um instante; o instalador já está rodando e fecha o app se ele demorar
    quitting = true; setTimeout(() => app.quit(), 500); return true;
  } catch (e) { log('update err', e.message); updating = false; return false; }
});

app.on('second-instance', () => showWin());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (update?.file && !updating && !portable) { updating = true; runInstaller(update.file, false); }
});
app.on('window-all-closed', () => { if (quitting) app.quit(); });

// placa de vídeo: guarda o nome (mostrado nas configurações) e se é uma Intel antiga (até a 4ª geração, ex.: HD 4000),
// em que o modo automático liga a compatibilidade de vídeo a partir da próxima abertura
let gpuName = '';
async function detectGpu() {
  try {
    const info = await app.getGPUInfo('basic'), devs = info.gpuDevice || [], g = devs.find(d => d.active) || devs[0];
    if (!g) return;
    gpuName = g.deviceString || `${g.vendorId.toString(16)}:${g.deviceId.toString(16)}`;
    const old = g.vendorId === 0x8086 && g.deviceId < 0x1600; // Intel antes da Broadwell (IDs 0x01xx, 0x04xx, 0x0Axx, 0x0Dxx)
    log('gpu', gpuName, 'driver', g.driverVersion || '?', 'antiga', old, 'compat ativa', gpuCompat);
    // diagnóstico: todas as placas (qual está ativa) e o que o Chromium está acelerando
    log('gpus', devs.map(d => `${d.deviceString || d.vendorId.toString(16) + ':' + d.deviceId.toString(16)}${d.active ? ' (ativa)' : ''}`).join(' | '));
    log('gpu status', JSON.stringify(app.getGPUFeatureStatus()));
    if (cfg.gpuOld !== old) { cfg.gpuOld = old; saveCfg(); }
  } catch (e) { log('gpu info falhou', e.message); }
}
app.whenReady().then(() => {
  // iniciar com o Windows: a entrada antiga no registro tinha o id antigo; apaga e recria com o novo
  try { app.setLoginItemSettings({ openAtLogin: false, name: OLD_ID }); if (cfg.autoStart) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }); } catch { }
  log('abertura', ms(), 'ms: Electron pronto');
  // a janela principal abre na hora (fundo escuro + barra) e a página começa a carregar já; sem a janelinha
  // "Iniciando…" no meio (era uma janela a mais para criar antes da principal). O resto vem depois.
  setupSession();
  if (cfg.server) trustedHosts.add(serverHost());
  createWindow(); loadServer();
  setTimeout(() => { buildTray(); registerHotkeys(); }, 0);
  setTimeout(checkUpdate, 8000); setInterval(checkUpdate, 3600e3);
  setTimeout(detectGpu, 5000);
  if (process.env.LC_TEST_SERVER && !cfg.server) { cfg.server = process.env.LC_TEST_SERVER; trustedHosts.add(serverHost()); loadServer(); }
});
