// Controle remoto no app desktop (processo principal): liga o programa nativo lc-input, diz a ele qual monitor
// está sendo transmitido e mostra um aviso sempre por cima de tudo enquanto alguém controla.
// O renderer (página da Resenha) só chega aqui depois que o dono aceitou o pedido na própria tela.
const { BrowserWindow, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let helper = null, ready = false, armed = false, indicator = null, onEvent = () => { }, shared = null, padOk = false, relOk = false, readyWait = [], padWait = [];
// sessões ativas neste PC: id -> { who, perms, kind ('control' | 'pad'), slot }. A injeção fica armada enquanto houver uma;
// cada uma tem o seu controle virtual (vaga 0 = controle remoto; 1..3 = jogadores 2, 3 e 4 do "jogar junto")
const active = new Map();
// push-to-talk global: o mesmo programa (lc-input) vigia só a tecla/botão escolhido; ver setPtt
let pttCode = null, onPttEvent = () => { }, pttRetry = 0, pttTimer = null, quitting = false, startedAt = 0;
const log = (...a) => console.log('[remote]', ...a);

const helperPath = () => {
  const cands = [path.join(process.resourcesPath || '', 'lc-input.exe'), path.join(__dirname, 'native', 'lc-input.exe')];
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
};

// fonte escolhida para transmitir (vem do setDisplayMediaRequestHandler)
function setShared(src) { shared = src ? { id: src.id, display_id: src.display_id || '' } : null; }

// o que está sendo transmitido, para o lc-input: { rect } (monitor) ou { hwnd } (janela; o id do Electron é "window:<HWND>:0")
function sharedTarget() {
  if (shared?.id.startsWith('window:')) { const h = Number(shared.id.split(':')[1]); return Number.isSafeInteger(h) && h > 0 ? { hwnd: h } : null; }
  const rect = sharedRect(); return rect ? { rect } : null;
}
// retângulo do monitor transmitido em pixels físicos; null se a transmissão é de uma janela
function sharedRect() {
  if (!shared || !shared.id.startsWith('screen:')) return null;
  const all = screen.getAllDisplays();
  const d = all.find(x => String(x.id) === String(shared.display_id)) || (all.length === 1 ? all[0] : null);
  if (!d) return null;
  const r = process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
  return [r.x, r.y, r.width, r.height];
}

// anti-cheats conhecidos rodando agora (nome do processo -> o que mostrar). Só lê a lista de processos do Windows.
const ANTICHEATS = {
  'vgc.exe': 'Riot Vanguard (Valorant, League of Legends)', 'vgtray.exe': 'Riot Vanguard (Valorant, League of Legends)',
  'easyanticheat.exe': 'Easy Anti-Cheat (Fortnite, Apex, Rust…)', 'easyanticheat_eos.exe': 'Easy Anti-Cheat (Fortnite, Apex, Rust…)',
  'beservice.exe': 'BattlEye (PUBG, Rainbow Six, DayZ…)', 'beservice_x64.exe': 'BattlEye (PUBG, Rainbow Six, DayZ…)',
  'faceit.exe': 'FACEIT', 'faceitservice.exe': 'FACEIT', 'faceitclient.exe': 'FACEIT',
  'eaanticheat.gameservice.exe': 'EA Javelin Anti-Cheat (Battlefield, FC…)', 'eaanticheat.gameservicelauncher.exe': 'EA Javelin Anti-Cheat (Battlefield, FC…)',
  'gamemon.des': 'nProtect GameGuard', 'gamemon64.des': 'nProtect GameGuard', 'gameguard.des': 'nProtect GameGuard',
  'ace-guard client.exe': 'ACE (Tencent)', 'sguard64.exe': 'ACE (Tencent)', 'xigncode.exe': 'XIGNCODE3', 'x3.xem': 'XIGNCODE3',
  'pnkbstra.exe': 'PunkBuster', 'mhyprot2.sys': 'mhyprot (HoYoverse)', 'eqguard.exe': 'EQU8', 'zakynthos.exe': 'Ricochet (Call of Duty)',
};
function antiCheats() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((res) => execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 4000, maxBuffer: 4 << 20 }, (err, out) => {
    if (err) return res([]);
    const found = new Set();
    for (const line of String(out).split(/\r?\n/)) { const name = (line.match(/^"([^"]+)"/) || [])[1]; const hit = name && ANTICHEATS[name.toLowerCase()]; if (hit) found.add(hit); }
    res([...found]);
  }));
}

async function capable() {
  if (process.platform !== 'win32') return { ok: false, reason: 'O controle remoto só funciona no app para Windows.' };
  if (!helperPath()) return { ok: false, reason: 'Componente de controle remoto não encontrado. Atualize o app.' };
  const target = sharedTarget();
  if (!target) return { ok: false, reason: 'Não consegui identificar o que você está transmitindo. Pare e transmita de novo.' };
  // controle de videogame: precisa do driver ViGEmBus no PC (o lc-input conta ao iniciar se conseguiu falar com ele)
  const pad = ensureHelper() && await whenReady(2500) && padOk;
  return { ok: true, antiCheats: await antiCheats(), window: !!target.hwnd, pad, rel: relOk }; // rel: o lc-input aceita o mouse relativo (jogos 3D)
}

function ensureHelper() {
  if (helper) return true;
  const exe = helperPath(); if (!exe) return false;
  helper = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); startedAt = Date.now();
  let buf = '';
  helper.stdout.on('data', (d) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'ready') { ready = true; padOk = !!m.pad; relOk = !!m.rel; readyWait.splice(0).forEach(f => f(true)); }
      if (m.t === 'pad') { padOk = !!m.ok; padWait.splice(0).forEach(f => f(padOk)); }
      if (m.t === 'ptt') onPttEvent(!!m.down);
      if (m.t === 'panic') { armed = false; active.clear(); closeIndicator(); onEvent('panic'); }
      if (m.t === 'err' && ['blocked', 'covered', 'nopad'].includes(m.msg)) onEvent(m.msg);
      else if (m.t === 'err') log('helper:', m.msg);
    }
  });
  helper.on('exit', (code) => {
    log('helper saiu', code); const was = armed; helper = null; ready = false; armed = false; active.clear(); closeIndicator(); if (was) onEvent('panic');
    onPttEvent(false); // nunca deixa o microfone aberto se o programa cair com a tecla apertada
    if (Date.now() - startedAt > 30000) pttRetry = 0; // ficou de pé um tempo: a próxima queda recomeça a contagem
    // o PTT global precisa do programa rodando: tenta religar (até 5 vezes seguidas, com espera crescente)
    if (pttCode && !quitting && pttRetry < 5 && !pttTimer) pttTimer = setTimeout(() => { pttTimer = null; pttRetry++; if (pttCode && ensureHelper()) write({ t: 'ptt', code: pttCode }); }, 1000 * 2 ** pttRetry);
  });
  helper.stdin.on('error', () => { });
  // não abriu (antivírus, permissão): sem ouvinte o 'error' derrubava o processo principal; sem pid não vem 'exit'
  const h = helper; h.on('error', (e) => { log('helper:', e.message); if (helper === h && !h.pid) { helper = null; ready = false; readyWait.splice(0).forEach(f => f(false)); } });
  return true;
}
const whenReady = (ms) => (ready ? Promise.resolve(true) : new Promise(res => { readyWait.push(res); setTimeout(() => res(ready), ms); }));
const write = (o) => { try { helper?.stdin.write(JSON.stringify(o) + '\n'); } catch { } };

// texto do aviso: quem controla o quê e os jogadores (Ana, jogador 2…)
function indicatorText() {
  const ctl = [...active.values()].find(x => x.kind !== 'pad'), pads = [...active.values()].filter(x => x.kind === 'pad').sort((a, b) => a.slot - b.slot);
  const parts = [];
  if (ctl) parts.push(`${ctl.who} está controlando seu ${permsText(ctl.perms)}`);
  if (pads.length) parts.push(`${pads.length > 1 ? 'Jogadores' : 'Jogador'}: ${pads.map(x => `${x.who} (${x.slot})`).join(', ')}`);
  return parts.join(' · ');
}
function showIndicator(text) {
  closeIndicator();
  const d = screen.getAllDisplays().find(x => String(x.id) === String(shared?.display_id)) || screen.getPrimaryDisplay();
  const w = 560, h = 46, b = d.workArea || d.bounds;
  indicator = new BrowserWindow({
    width: w, height: h, x: Math.round(b.x + (b.width - w) / 2), y: b.y + 8, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, backgroundColor: '#1e1f22', hasShadow: true,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  indicator.setAlwaysOnTop(true, 'screen-saver'); // por cima de janelas sem borda e da barra de tarefas
  indicator.setVisibleOnAllWorkspaces(true);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#1e1f22;color:#f2f3f5;font:13px "Segoe UI",sans-serif;user-select:none;-webkit-app-region:drag}
    body{display:flex;align-items:center;gap:10px;padding:0 8px 0 12px;border:2px solid #f23f43;box-sizing:border-box;border-radius:8px}
    i{width:10px;height:10px;border-radius:50%;background:#f23f43;flex:none}b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}small{color:#b5bac1;white-space:nowrap}span{flex:1}
    a{-webkit-app-region:no-drag;background:#da373c;color:#fff;text-decoration:none;padding:6px 14px;border-radius:4px;font-weight:600}</style>
    <i></i><b>${esc(text)}</b><span></span><small>Ctrl+Alt+Shift+Q</small><a href="lc-stop:">Parar</a>`;
  // a página não roda JS: o botão é um link que o processo principal intercepta
  indicator.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (url.startsWith('lc-stop:')) { stop(); onEvent('panic'); } });
  indicator.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const me = indicator; // recriado quando um jogador entra ou sai: esse fechamento (quiet) não é "parar"
  indicator.on('closed', () => { if (me.quiet) return; indicator = null; if (armed) { stop(); onEvent('panic'); } }); // fechar o aviso = parar
  indicator.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  indicator.once('ready-to-show', () => indicator?.showInactive());
}
function closeIndicator() { const w = indicator; indicator = null; if (w && !w.isDestroyed()) { w.quiet = true; w.destroy(); } }

// "mouse e teclado", "mouse, teclado e controle", "controle"…
function permsText(p) { const l = [p.mouse && 'mouse', p.keyboard && 'teclado', p.gamepad && 'controle'].filter(Boolean); return l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l.at(-1) : l[0] || 'nada'; }

// id: a sessão (sem id = a de controle remoto, como antes); kind 'pad' + slot 2..4 = jogador do "jogar junto"
async function start({ id = 'ctl', who, perms, kind = 'control', slot } = {}) {
  const c = await capable(); if (!c.ok) return c;
  if (kind === 'pad' && !c.pad) return { ok: false, reason: 'O controle de videogame precisa do driver ViGEmBus neste PC.' };
  if (!ensureHelper()) return { ok: false, reason: 'Não foi possível iniciar o componente de controle remoto.' };
  const pad = kind === 'pad';
  if (pad && !(slot >= 2 && slot <= 4)) return { ok: false, reason: 'Vaga de jogador inválida.' };
  active.set(String(id), { who: String(who || 'Alguém').slice(0, 40), kind: pad ? 'pad' : 'control', slot: pad ? slot : 0,
    perms: pad ? { gamepad: true } : { mouse: !!perms?.mouse, keyboard: !!perms?.keyboard, gamepad: !!perms?.gamepad } });
  if (!armed) { write({ t: 'arm', ...sharedTarget() }); armed = true; }
  showIndicator(indicatorText());
  return { ok: true };
}
// eventos de uma sessão: o controle de videogame vai para o controle virtual dela (p = vaga); jogador só manda controle
function input(ev, id = 'ctl') {
  const a = active.get(String(id)); if (!armed || !a || !Array.isArray(ev) || ev.length > 64) return;
  const p = a.kind === 'pad' ? a.slot - 1 : 0, out = [];
  for (const e of ev) { if (e?.k === 'g') out.push({ ...e, p }); else if (a.kind !== 'pad') out.push(e); }
  if (out.length) write({ t: 'ev', ev: out });
}
// sem id: para tudo (atalho de emergência, aviso fechado). Com id: só aquela sessão; sem nenhuma, desarma
function stop(id) {
  if (id != null) {
    const a = active.get(String(id)); if (!a) return; active.delete(String(id));
    if (armed) write({ t: 'padoff', p: a.kind === 'pad' ? a.slot - 1 : 0 });
    if (active.size) { showIndicator(indicatorText()); return; }
  }
  active.clear(); if (armed) write({ t: 'disarm' }); armed = false; closeIndicator();
}
// confere o driver de novo (depois de instalar) sem reiniciar o app
const padCheck = (ms = 3000) => (!ensureHelper() ? Promise.resolve(false) : new Promise(res => { padWait.push(res); write({ t: 'padcheck' }); setTimeout(() => res(padOk), ms); }));

// ---------- driver do controle virtual (ViGEmBus) ----------
// Instalador oficial (projeto arquivado em 2023; última versão): conferido pelo hash E pela assinatura digital do autor
// antes de abrir. O Windows pede permissão de administrador (UAC); o app espera o driver responder.
const VIGEM = { url: 'https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe',
  sha256: '89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a', size: 6278576, signer: 'Nefarius Software Solutions e.U.' };
let installing = null;
function installPadDriver({ download, tmpDir, openPath }) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'Só no app para Windows.' });
  if (installing) return installing;
  return (installing = (async () => {
    if (await padCheck()) return { ok: true, already: true };
    const file = path.join(tmpDir, 'ViGEmBus_1.22.0_setup.exe');
    try { fs.rmSync(file, { force: true }); } catch { }
    await download(VIGEM.url, file);
    const buf = fs.readFileSync(file), sha = require('crypto').createHash('sha256').update(buf).digest('hex');
    if (buf.length !== VIGEM.size || sha !== VIGEM.sha256) { fs.rmSync(file, { force: true }); log('ViGEmBus recusado: hash', sha); return { ok: false, reason: 'O instalador baixado não confere (arquivo diferente do oficial). Nada foi instalado.' }; }
    const sig = await signerOf(file);
    if (!sig.valid || !sig.subject.includes(VIGEM.signer)) { fs.rmSync(file, { force: true }); log('ViGEmBus recusado: assinatura', sig); return { ok: false, reason: 'A assinatura digital do instalador não confere. Nada foi instalado.' }; }
    const err = await openPath(file); // abre pelo Windows (ShellExecute): o UAC aparece
    if (err) return { ok: false, reason: 'Não consegui abrir o instalador: ' + err };
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 3000)); if (await padCheck()) return { ok: true }; } // até 3 min para a pessoa terminar o instalador
    return { ok: false, reason: 'O driver ainda não respondeu. Se o instalador terminou, reinicie o app.' };
  })().finally(() => { installing = null; }));
}
// assinatura Authenticode pelo próprio Windows (PowerShell): válida e de quem
function signerOf(file) {
  return new Promise((res) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)`],
  { windowsHide: true, timeout: 20000 }, (e, out) => { const [st, subject = ''] = String(out || '').trim().split('|'); res({ valid: !e && st === 'Valid', subject }); }));
}
// fim da entrada encerra o lc-input; se não sair (travado), mata antes do app fechar de vez (sem processo órfão)
function shutdown() { quitting = true; clearTimeout(pttTimer); stop(); const h = helper; try { h?.stdin.end(); } catch { } if (h) setTimeout(() => { try { if (h.exitCode === null) h.kill(); } catch { } }, 1000).unref?.(); }

// code = KeyboardEvent.code (ex.: KeyV, F13) ou Mouse3/Mouse4/Mouse5; null desliga. Só Windows.
function setPtt(code) {
  code = typeof code === 'string' && /^(Mouse[345]|[A-Za-z0-9]{1,24})$/.test(code) ? code : null;
  if (code === pttCode) return { ok: !!helper || !code };
  pttCode = code; pttRetry = 0;
  if (!code) { write({ t: 'ptt', code: null }); onPttEvent(false); return { ok: true }; }
  if (process.platform !== 'win32') return { ok: false, reason: 'Só no app para Windows.' };
  if (!ensureHelper()) return { ok: false, reason: 'Componente de teclado não encontrado. Atualize o app.' };
  write({ t: 'ptt', code });
  return { ok: true };
}

module.exports = { setShared, capable, start, input, stop, shutdown, setPtt, padCheck, installPadDriver, onRemoteEvent: (cb) => { onEvent = cb; }, onPtt: (cb) => { onPttEvent = cb; } };
