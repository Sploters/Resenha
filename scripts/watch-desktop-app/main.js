// Aplicativo mínimo de teste para desktop/watchwin.js (usado por scripts/watch-desktop-test.mjs): abre as janelas de
// serviço apontando para páginas simuladas (MOCK), executa o roteiro e imprime "RESULT <json>".
const { app, session } = require('electron');
const path = require('node:path');
const { createWatchWindows, hostOk } = require(path.join(__dirname, '..', '..', 'desktop', 'watchwin.js'));
const MOCK = process.env.MOCK;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.on('window-all-closed', () => { });
// resultado num arquivo (RESULT_FILE), não na saída: ver scripts/watch-desktop-test.mjs
const fs = require('node:fs');
const R = { step: 'início' };
let done = false;
function finish() {
  if (done) return; done = true;
  const s = JSON.stringify(R);
  if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, s); else console.log('RESULT ' + s);
  app.exit(0);
}
// algum passo travou: entrega o que tem e diz onde parou (melhor que ser morto sem saber por quê)
setTimeout(() => { R.timeout = true; finish(); }, 60_000).unref?.();
app.whenReady().then(async () => {
  const ev = [];
  const W = createWatchWindows({ sendToApp: (m) => ev.push({ ...m, _t: Date.now() }) });
  const wait = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const x = ev.filter(fn).pop(); if (x) return x; await sleep(100); } return null; };
  const lastState = (svc) => ev.filter(e => e.service === svc && e.t === 'state').pop();
  try {
    R.hostOk = { netflix: hostOk('netflix', 'https://www.netflix.com/watch/1'), evil: hostOk('netflix', 'https://evil.com/netflix.com'), prime: hostOk('prime', 'https://www.amazon.com.br/gp/video/detail/X') };
    R.outside = W.open({ service: 'netflix', url: 'https://exemplo.com/' });
    R.step = 'abrir a janela do Prime simulado';
    R.open = W.open({ service: 'prime', url: MOCK + '/prime.html', show: true });
    const drm = await wait(e => e.service === 'prime' && e.t === 'drm');
    R.widevine = drm ? drm.widevine : null;
    R.video = !!(await wait(e => e.service === 'prime' && e.t === 'state' && e.video));
    R.step = 'play/pause/posição pela ponte';
    await W.cmd('prime', { t: 'play' }); await sleep(1500);
    const s1 = lastState('prime'); R.playing = s1 && !s1.paused && s1.pos > 0.5;
    await W.cmd('prime', { t: 'pause' }); await sleep(600);
    const s2 = lastState('prime'); R.paused = s2 && s2.paused;
    await W.cmd('prime', { t: 'seek', pos: 20 }); await sleep(800);
    R.seekPos = lastState('prime')?.pos;
    await W.cmd('prime', { t: 'volume', v: 0.3, muted: false }); await sleep(300);
    R.volume = await W.wins.get('prime').webContents.executeJavaScript('document.querySelector("video").volume');
    R.pageCantSeeBridge = await W.wins.get('prime').webContents.executeJavaScript('typeof require === "undefined" && typeof ipcRenderer === "undefined"');
    // navegação para fora do serviço é barrada (abre no navegador do sistema, que aqui não existe)
    R.step = 'navegar para fora do serviço';
    await W.wins.get('prime').webContents.executeJavaScript('location.href = "https://exemplo.com/x"').catch(() => { }); await sleep(800);
    R.stayed = W.wins.get('prime').webContents.getURL().startsWith(MOCK);
    // Netflix: busca pela API do player da página (simulada); sem a API → avisa que não dá
    R.step = 'Netflix simulada';
    W.open({ service: 'netflix', url: MOCK + '/netflix.html' });
    await wait(e => e.service === 'netflix' && e.t === 'state' && e.video);
    R.nfSeek = await W.cmd('netflix', { t: 'seek', pos: 33 }); await sleep(600);
    R.nfApiCalled = await W.wins.get('netflix').webContents.executeJavaScript('window.__seekCalls');
    await W.cmd('netflix', { t: 'navigate', url: MOCK + '/netflix-noapi.html' });
    await wait(e => e.service === 'netflix' && e.t === 'state' && /noapi/.test(e.url));
    R.nfNoApi = await W.cmd('netflix', { t: 'seek', pos: 10 });
    R.nfUnsupportedEvent = !!(await wait(e => e.service === 'netflix' && e.t === 'seek_unsupported', 3000));
    // Crunchyroll: página de login é reconhecida
    R.step = 'tela de login';
    W.open({ service: 'crunchyroll', url: MOCK + '/login' });
    R.login = !!(await wait(e => e.service === 'crunchyroll' && e.t === 'login'));
    // sessão própria e persistente por serviço (login guardado só na janela daquele serviço)
    R.step = 'sessão por serviço';
    await W.wins.get('prime').webContents.executeJavaScript('document.cookie = "conta=prime; max-age=86400"');
    await sleep(300);
    const c1 = await session.fromPartition('persist:watch-prime').cookies.get({ name: 'conta' });
    const c2 = await session.defaultSession.cookies.get({ name: 'conta' });
    const c3 = await session.fromPartition('persist:watch-netflix').cookies.get({ name: 'conta' });
    R.partition = { prime: c1.length, app: c2.length, netflix: c3.length, persistent: !!session.fromPartition('persist:watch-prime').storagePath };
    R.ua = await W.wins.get('prime').webContents.executeJavaScript('navigator.userAgent');
    R.step = 'fechar as janelas';
    W.closeAll(); R.closed = !!(await wait(e => e.t === 'closed', 3000));
    R.step = 'fim';
  } catch (e) { R.exception = e.stack; }
  finish();
});
