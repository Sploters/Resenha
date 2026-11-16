// Autoteste da transmissão (Windows 10 e 11), feito para quem não entende de computador: dois cliques, ~30 s sem mexer em
// nada, e um arquivo na Área de Trabalho para mandar. NÃO é o app da Resenha: é um programa à parte (build próprio,
// desktop/build-autoteste.sh, com "main" trocado para este arquivo); o instalador da Resenha não inclui nada daqui.
//
// O que faz, sozinho:
// 1. abre o "Jogo de Teste (Resenha)" (lc-stream-poc.exe --jogo-teste): janela do tamanho da tela com Direct3D e
//    animação calma, em TELA CHEIA exclusiva e depois em JANELA SEM BORDAS;
// 2. captura pelo mesmo motor de captura do app (Chromium do Electron, com as mesmas opções do desktop/main.js):
//    a janela do jogo na frente, a tela inteira, a janela MINIMIZADA (o Alt+Tab do jogo em tela cheia: o caso do
//    "Could not start video source") e a janela depois de voltar (o que a correção faz: espera o jogo voltar);
// 3. mede quadros por segundo, imagem preta/parada, e grava tudo em Resenha-teste-<PC>.json na Área de Trabalho.
// Não injeta nada em jogo nenhum e não transmite nada pela internet.
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

app.setName('Resenha Autoteste'); // pasta de dados própria: não mexe nas configurações da Resenha instalada
// mesmas opções de captura do app (desktop/main.js): no Windows 10 a tela inteira vai pelo DXGI (sem a borda amarela)
const winBuild = process.platform === 'win32' ? +os.release().split('.')[2] || 0 : 0;
const off = ['CalculateNativeWinOcclusion']; if (process.platform === 'win32' && winBuild < 20348) off.push('AllowWgcScreenCapturer');
app.commandLine.appendSwitch('disable-features', off.join(','));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force_high_performance_gpu');

const res = (f) => [path.join(process.resourcesPath || '', f), path.join(__dirname, 'native', f)].find(p => fs.existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAME = 'Jogo de Teste (Resenha)';
let win;

function probe() {
  const exe = res('lc-stream.exe'); if (!exe) return Promise.resolve(null);
  return new Promise((r) => execFile(exe, ['--probe'], { windowsHide: true, timeout: 15000 }, (_e, out) => {
    const l = String(out || '').split('\n').find(x => x.trim().startsWith('{')); try { r(JSON.parse(l)); } catch { r(null); }
  }));
}

async function findGame(ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }).catch(() => [])).find(x => x.name === GAME);
    if (s) return s.id;
    await sleep(300);
  }
  return null;
}
async function primaryScreenId() {
  const ss = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
  const p = screen.getPrimaryDisplay();
  return (ss.find(s => String(s.display_id) === String(p.id)) || ss[0])?.id || null;
}
const capture = (id, secs) => win.webContents.executeJavaScript(`capture(${JSON.stringify(id)}, ${secs})`).catch(e => ({ ok: false, error: 'teste: ' + e.message }));
const step = (txt, pct) => win.webContents.executeJavaScript(`step(${JSON.stringify(txt)}, ${pct})`).catch(() => { });

async function gameRound(modo, dir, out, pct0) {
  const exe = res('lc-stream-poc.exe');
  const r = { modo, testes: {} };
  if (!exe) { r.erro = 'lc-stream-poc.exe não encontrado'; return r; }
  const json = path.join(dir, `jogo-teste-${modo}.json`); try { fs.rmSync(json); } catch { }
  const p = spawn(exe, ['--poc-captura', '--jogo-teste', '--modo', modo, '--secs', '90', '--comandos'], { cwd: dir, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  const cmd = (c) => { try { p.stdin.write(c + '\n'); } catch { } };
  let exited = false; p.on('exit', () => { exited = true; });
  try {
    const id = await findGame(8000);
    if (!id) { r.erro = 'a janela do jogo de teste não apareceu'; return r; }
    r.janela = id;
    cmd('frente'); await sleep(modo === 'tela-cheia' ? 2500 : 1200); // tempo para a troca de modo de vídeo
    step(modo === 'tela-cheia' ? 'Jogo em tela cheia: capturando a janela' : 'Jogo sem bordas: capturando a janela', pct0 + 4);
    r.testes.janela = await capture(id, 3);
    step('Capturando a tela inteira', pct0 + 10);
    const sid = await primaryScreenId();
    r.testes.tela_inteira = sid ? await capture(sid, 3) : { ok: false, error: 'sem tela' };
    if (modo === 'tela-cheia') {
      // Alt+Tab: o jogo sai da tela cheia e minimiza. É aqui que aparecia "Could not start video source"
      step('Simulando Alt+Tab (jogo minimizado)', pct0 + 16);
      cmd('minimizar'); await sleep(1200);
      r.testes.janela_minimizada = await capture(id, 2);
      // o que a correção faz: espera o jogo voltar e então começa
      step('Voltando para o jogo', pct0 + 22);
      cmd('frente'); await sleep(2500);
      r.testes.janela_depois_de_voltar = await capture(id, 3);
    }
  } finally {
    cmd('sair');
    for (let i = 0; i < 30 && !exited; i++) await sleep(100);
    if (!exited) try { p.kill(); } catch { }
    await sleep(300);
    try { r.jogo = JSON.parse(fs.readFileSync(json, 'utf8')); } catch { }
  }
  return r;
}

async function run() {
  const out = { kit: 'autoteste-transmissao-v1', data: new Date().toISOString(), pc: os.hostname(), app: app.getVersion(), electron: process.versions.electron,
    windows: { release: os.release(), build: winBuild, nome: winBuild >= 22000 ? 'Windows 11' : winBuild ? 'Windows 10' : process.platform },
    cpu: os.cpus()[0]?.model, memoriaGB: Math.round(os.totalmem() / 2 ** 30),
    telas: screen.getAllDisplays().map(d => ({ w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor), hz: d.displayFrequency, escala: d.scaleFactor, principal: d.id === screen.getPrimaryDisplay().id })),
    rodadas: [] };
  const dir = path.join(app.getPath('temp'), 'resenha-autoteste'); fs.mkdirSync(dir, { recursive: true });
  try {
    step('Lendo a placa de vídeo', 2);
    out.placa = await app.getGPUInfo('basic').then(g => (g.gpuDevice || []).map(d => ({ vendor: d.vendorId, device: d.deviceId, ativa: d.active, driver: d.driverVersion }))).catch(() => null);
    out.codificador = await probe();
    out.rodadas.push(await gameRound('tela-cheia', dir, out, 8));
    out.rodadas.push(await gameRound('sem-bordas', dir, out, 60));
  } catch (e) { out.erro = String(e?.stack || e); }
  out.duracaoSegundos = Math.round((Date.now() - Date.parse(out.data)) / 1000);
  // Área de Trabalho (fácil de achar); se não der, ao lado do programa
  const name = `Resenha-teste-${os.hostname().replace(/[^\w-]/g, '')}.json`;
  let file = null;
  for (const d of [app.getPath('desktop'), process.env.PORTABLE_EXECUTABLE_DIR, app.getPath('documents')].filter(Boolean)) {
    try { file = path.join(d, name); fs.writeFileSync(file, JSON.stringify(out, null, 1)); break; } catch { file = null; }
  }
  win.show(); win.setAlwaysOnTop(true); win.focus(); setTimeout(() => { try { win.setAlwaysOnTop(false); } catch { } }, 1500);
  await win.webContents.executeJavaScript(`done(${JSON.stringify({ out, file })})`).catch(() => { });
  if (file) shell.showItemInFolder(file);
}

ipcMain.on('abrir', (_e, f) => { if (f) shell.showItemInFolder(f); });
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  win = new BrowserWindow({ width: 560, height: 460, resizable: false, title: 'Teste da transmissão — Resenha', autoHideMenuBar: true, backgroundColor: '#1e1f22',
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  win.loadFile(path.join(__dirname, 'autoteste.html'));
  win.webContents.once('did-finish-load', () => setTimeout(run, 1500)); // dá tempo de ler o "não mexa em nada"
});
app.on('window-all-closed', () => app.quit());
