// Áudio da transmissão só do jogo + lista de janelas (inclusive minimizadas), pelo programa nativo lc-audio (ver
// native/lc-audio). É o que o Discord faz no Windows: o loopback do PC inteiro pegava música, navegador e até a voz dos
// amigos na call; o loopback por processo (Windows 10 2004+) pega só o programa escolhido (e os filhos dele).
const { app, nativeImage } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const { createHelper } = require('./helper');

const log = (...a) => console.log('[appaudio]', ...a);
const helperPath = () => {
  const cands = [path.join(process.resourcesPath || '', 'lc-audio.exe'), path.join(__dirname, 'native', 'lc-audio.exe')];
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
};

// ---------- programa nativo aberto o tempo todo (desktop/helper.js) ----------
// lista de janelas, ícone, vigia da janela da frente e aviso do clipe passam por ele; sem ele, um processo por pergunta
let helper = null;
function getHelper() {
  if (helper) return helper;
  if (process.platform !== 'win32') return null;
  const exe = helperPath(); if (!exe) return null;
  helper = createHelper({ exe, log: (...a) => console.log('[lc-audio]', ...a) });
  return helper;
}
// quantos processos foram abertos (para o main.log: o objetivo é ficar perto de 1 por sessão)
const oneShot = { windows: 0, icon: 0 };
let lastStats = { spawns: 0, calls: 0, events: 0 };
setInterval(() => {
  const h = helper?.stats() || { spawns: 0, calls: 0, events: 0 }, d = (k) => (h[k] || 0) - (lastStats[k] || 0);
  if (oneShot.windows || oneShot.icon || d('calls') || d('events')) log('na última hora: programa nativo aberto ' + d('spawns') + 'x, ' + d('calls') + ' pedidos, ' + d('events') + ' avisos; processos avulsos: ' + oneShot.windows + ' listas, ' + oneShot.icon + ' ícones');
  oneShot.windows = oneShot.icon = 0; lastStats = h;
}, 60 * 60 * 1000).unref?.();

let probed = null;
function capable() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'Só no app para Windows.' });
  const exe = helperPath(); if (!exe) return Promise.resolve({ ok: false, reason: 'Componente de áudio não encontrado. Atualize o app.' });
  if (probed) return probed;
  probed = new Promise((res) => execFile(exe, ['--probe'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    let j = null; try { j = JSON.parse(String(out).trim()); } catch { }
    if (!j) { probed = null; return res({ ok: false, reason: 'Não consegui testar o áudio do Windows' + (err ? ': ' + err.message : '') }); }
    res(j.ok ? { ok: true } : { ok: false, reason: 'Precisa do Windows 10 versão 2004 ou mais novo (este é o build ' + j.build + ').' });
  }));
  return probed;
}

// ---------- janelas ----------
// jogo: pasta de loja/jogos, executável conhecido ou janela do tamanho do monitor; nunca navegador/chat/launcher
const NOT_GAME = /\\(explorer|chrome|msedge|firefox|opera|opera_gx|brave|vivaldi|code|cursor|discord|resenha|electron|obs64|obs32|spotify|ms-teams|teams|slack|whatsapp|telegram|applicationframehost|systemsettings|textinputhost|shellexperiencehost|searchhost|steamwebhelper|steamservice|steam|epicgameslauncher|epicwebhelper|epiconlineservices\w*|riot client|riotclient\w*|battle\.net|battle\.net launcher|agent|eadesktop|eabackgroundservice|ealauncher|origin|originwebhelperservice|ubisoftconnect|upc|uplay\w*|ubisoftgamelauncher\w*|galaxyclient|galaxyclient helper|rockstarlauncher|launcher|socialclubhelper|playgtav|xboxpcapp|xboxapp|gamingservices|gamebar\w*|amazongames|amazon games ui|itch|playnite\.\w+|overwolf|curseforge|minecraftlauncher|hoyoplay|bsglauncher|heroic|nvidia app|nvidia share|nvcontainer|vlc|mpc-hc64|wmplayer|notepad|notepad\+\+|winword|excel|powerpnt|acrobat|photoshop|devenv|idea64|taskmgr|mstsc|parsecd|anydesk)\.exe$/i;
const KNOWN_GAME = /\\(valorant-win64-shipping|league of legends|cs2|csgo|javaw|minecraft(\.windows)?|peak|repo|fortniteclient-win64-shipping|gta5|gta5_enhanced|rocketleague|r5apex|r5apex_dx12|overwatch|dota2|eldenring|tslgame|cod|modernwarfare|bf2042|fc2\d|eafc2\d|robloxplayerbeta|deadbydaylight-win64-shipping|rainbowsix|rainbowsix_be|lethal company|phasmophobia|among us|stardew valley|terraria|hollow knight)\.exe$/i;
const GAME_DIR = /\\(steamapps\\common|epic games|riot games|gog galaxy\\games|gog games|ubisoft game launcher\\games|ea games|origin games|xboxgames|battle\.net\\.+\\|rockstar games|games)\\/i;
// lojas/launchers pelo título da janela (o executável pode mudar de nome a cada versão; o servidor também barra: server/launchers.js)
const LAUNCHER_TITLE = /^(riot client|steam|epic games( launcher)?|(blizzard )?battle\.net|ea( app)?|origin|ubisoft connect|uplay|gog galaxy|rockstar games launcher|xbox|amazon games|itch|playnite|overwolf|curseforge|minecraft launcher|hoyoplay|battlestate games launcher|heroic games launcher|nvidia app|geforce experience)$/i;
const isGame = (w) => !!w.exe && !NOT_GAME.test(w.exe) && !LAUNCHER_TITLE.test(String(w.title || '').trim()) && (KNOWN_GAME.test(w.exe) || GAME_DIR.test(w.exe) || w.fullscreen);

const icons = new Map(); // exe -> dataURL
async function iconOf(exe) {
  if (!exe) return null;
  if (!icons.has(exe)) icons.set(exe, app.getFileIcon(exe, { size: 'large' }).then(i => (i.isEmpty() ? null : i.toDataURL())).catch(() => null));
  return icons.get(exe);
}
async function annotate(list) {
  if (!Array.isArray(list)) list = [];
  const me = process.pid;
  list = list.filter(w => w && w.hwnd && w.title && w.pid !== me).map(w => ({ ...w }));
  for (const w of list) { w.game = isGame(w); w.icon = await iconOf(w.exe); }
  return list;
}
function listOnce(exe) { // jeito antigo: um processo só para esta lista
  oneShot.windows++;
  return new Promise((res) => execFile(exe, ['--windows'], { windowsHide: true, timeout: 4000, maxBuffer: 8 << 20 }, (err, out) => {
    let list = []; try { list = JSON.parse(String(out).trim()); } catch { if (err) log('--windows', err.message); }
    res(list);
  }));
}
// lista mantida pelos avisos do programa (watchWindows): com ela, perguntar não custa nada
let winCache = null; const winListeners = new Set();
// [{ hwnd, pid, title, exe, minimized, fullscreen, game, icon }]; [] se o programa não existir
// o.cached: aceita a lista dos avisos (vigias periódicos); sem isso pergunta agora (seletor, atalho da transmissão)
async function listWindows(o = {}) {
  const exe = helperPath(); if (!exe || process.platform !== 'win32') return [];
  if (o.cached && winCache) return winCache;
  const h = getHelper();
  let raw = null;
  if (h) raw = await h.call('windows').catch(() => null);
  if (!raw) raw = await listOnce(exe);
  return annotate(raw);
}
// liga os avisos de mudança na lista de janelas; fn(list) a cada mudança. Sem o programa (ou versão sem eventos): não avisa
function watchWindows(fn) {
  if (fn) winListeners.add(fn);
  const h = getHelper(); if (!h || h._watching) return;
  h._watching = true;
  h.on('windows', async (ev) => {
    const list = await annotate(ev.list);
    winCache = list;
    for (const f of winListeners) { try { f(list); } catch (e) { log('aviso de janelas:', e.message); } }
  });
  h.on('down', () => { winCache = null; });
  h.keep('watch', { on: true });
}

// ---------- jogo aberto agora (atividade "Jogando X") ----------
// nome que aparece para os amigos: conhecido pelo executável; senão o título da janela, sem versão/subtítulo
const FRIENDLY = { 'valorant-win64-shipping': 'VALORANT', 'league of legends': 'League of Legends', cs2: 'Counter-Strike 2', csgo: 'Counter-Strike: Global Offensive',
  'fortniteclient-win64-shipping': 'Fortnite', gta5: 'Grand Theft Auto V', gta5_enhanced: 'Grand Theft Auto V', rocketleague: 'Rocket League', r5apex: 'Apex Legends', r5apex_dx12: 'Apex Legends',
  dota2: 'Dota 2', eldenring: 'ELDEN RING', tslgame: 'PUBG: BATTLEGROUNDS', robloxplayerbeta: 'Roblox', 'deadbydaylight-win64-shipping': 'Dead by Daylight', rainbowsix: 'Rainbow Six Siege',
  rainbowsix_be: 'Rainbow Six Siege', peak: 'PEAK', repo: 'R.E.P.O.', 'minecraft.windows': 'Minecraft', 'lethal company': 'Lethal Company', phasmophobia: 'Phasmophobia', overwatch: 'Overwatch 2' };
const cleanTitle = (t) => {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (/^minecraft\b/i.test(t)) return 'Minecraft';
  const cut = t.split(/ [-–|•] /)[0].replace(/\s*\(?v?\d+(\.\d+){1,3}\)?\s*$/i, '').trim(); // "Jogo - Capítulo 2" / "Jogo 1.2.3"
  return (cut.length >= 2 ? cut : t).slice(0, 60);
};
// ícone do jogo para a atividade: o ícone GRANDE do executável (o programa nativo pega o de 256 px, o Electron só dá 32),
// reduzido para 96 px em PNG (~10 KB). Guardado por executável.
const bigIcons = new Map();
function gameIcon(exe) {
  if (!exe) return Promise.resolve(null);
  if (!bigIcons.has(exe)) bigIcons.set(exe, new Promise((res) => {
    const bin = helperPath(); if (!bin) return res(null);
    const done = (j) => {
      if (!j?.png) return res(null);
      try {
        let img = nativeImage.createFromBuffer(Buffer.from(j.png, 'base64'));
        if (img.isEmpty()) return res(null);
        if (img.getSize().width > 96) img = img.resize({ width: 96, height: 96, quality: 'best' });
        res(img.toPNG().toString('base64'));
      } catch { res(null); }
    };
    const once = () => { oneShot.icon++; execFile(bin, ['--icon', exe], { windowsHide: true, timeout: 5000, maxBuffer: 4 << 20 }, (err, out) => { let j = null; try { j = JSON.parse(String(out).trim()); } catch { } done(j); }); };
    const h = getHelper();
    if (h) h.call('icon', { exe }, 6000).then(done, once); else once();
  }));
  return bigIcons.get(exe);
}
// jogo instalado pela Steam: o número dele na loja (para a arte oficial). Lê os appmanifest_*.acf da biblioteca:
// ...\steamapps\common\<pasta>\...exe  ->  ...\steamapps\appmanifest_<appid>.acf com "installdir" "<pasta>"
const appIds = new Map();
function steamAppId(exe) {
  const m = /^(.*\\steamapps)\\common\\([^\\]+)\\/i.exec(String(exe || '')); if (!m) return null;
  const key = (m[1] + '|' + m[2]).toLowerCase();
  if (!appIds.has(key)) {
    let id = null;
    try {
      for (const f of fs.readdirSync(m[1])) {
        if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
        const t = fs.readFileSync(path.join(m[1], f), 'utf8');
        const dir = /"installdir"\s+"([^"]*)"/i.exec(t)?.[1];
        if (dir && dir.toLowerCase() === m[2].toLowerCase()) { id = /"appid"\s+"(\d+)"/i.exec(t)?.[1] || null; break; }
      }
    } catch { /* biblioteca sem permissão de leitura */ }
    appIds.set(key, id);
  }
  return appIds.get(key);
}
async function detectGame(o = { cached: true }) {
  const list = (await listWindows(o)).filter(w => w.game);
  if (!list.length) return null;
  const score = (w) => (KNOWN_GAME.test(w.exe) ? 4 : 0) + (GAME_DIR.test(w.exe) ? 2 : 0) + (w.fullscreen ? 1 : 0) + (w.minimized ? 0 : 0.5);
  const w = list.sort((a, b) => score(b) - score(a))[0];
  const base = path.win32.basename(w.exe).replace(/\.exe$/i, '').toLowerCase();
  if (base === 'javaw' && !/minecraft/i.test(w.title)) return null; // Java qualquer não é jogo
  return { id: base, title: FRIENDLY[base] || cleanTitle(w.title) || base, icon: await gameIcon(w.exe), steam: steamAppId(w.exe) };
}

// ---------- captura ----------
// Vigia: jogos e launchers costumam fechar o processo e abrir outro (launcher → jogo, reinício depois de atualizar, troca de
// modo). O loopback era do processo antigo e a transmissão ficava muda até a pessoa reiniciar a live. Agora, a cada 4 s:
// processo do jogo morreu → procura uma janela do MESMO executável e religa a captura no processo novo; programa de áudio
// caiu com o jogo vivo → reabre. Avisa a página (onEvent): 'waiting' (jogo fechado, esperando voltar) e 'reattached'.
let proc = null, cur = null, watch = null, busy = false, emit = () => { };
const setEventSink = (fn) => { emit = typeof fn === 'function' ? fn : () => { }; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// abre o programa de captura para pid; resolve {ok} / {ok:false,error}
function spawnCap(pid, mode, onData) {
  const exe = helperPath(); if (!exe) return Promise.resolve({ ok: false, error: 'componente de áudio não encontrado' });
  const p = spawn(exe, ['--capture'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc = p;
  return new Promise((resolve) => {
    let done = false, err = '';
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const t = setTimeout(() => { finish({ ok: false, error: 'o programa de áudio não respondeu' }); if (proc === p) kill(); }, 6000);
    p.stdout.on('data', (d) => { if (proc === p) onData(d); });
    p.stderr.on('data', (d) => {
      err += d; let i;
      while ((i = err.indexOf('\n')) >= 0) {
        const line = err.slice(0, i).trim(); err = err.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { if (line) log(line); continue; }
        if (ev.t === 'started') { clearTimeout(t); finish({ ok: true }); }
        if (ev.t === 'error') { clearTimeout(t); finish({ ok: false, error: ev.error }); }
      }
    });
    p.on('error', (e) => { clearTimeout(t); finish({ ok: false, error: e.message }); });
    p.on('exit', (code) => { clearTimeout(t); finish({ ok: false, error: 'o programa de áudio fechou (código ' + code + ')' }); if (proc === p) proc = null; });
    p.stdin.write(JSON.stringify({ pid, mode }) + '\n');
  });
}
function kill() {
  const p = proc; if (!p) return;
  proc = null;
  try { p.stdin.write('stop\n'); p.stdin.end(); } catch { }
  setTimeout(() => { try { p.kill(); } catch { } }, 1500);
}
async function tick() {
  if (!cur || busy) return;
  busy = true;
  try {
    const c = cur;
    if (c.mode === 'exclude') { if (!proc) { const r = await spawnCap(process.pid, 'exclude', c.onData); if (cur === c && r.ok) emit({ t: 'reattached' }); } return; }
    if (alive(c.pid)) { if (!proc) await spawnCap(c.pid, 'include', c.onData); return; } // jogo vivo: só reabre o programa de áudio se ele caiu
    if (!c.exe) return; // não sei o executável: não dá para achar o processo novo
    const w = (await listWindows({ cached: true })).find(x => x.exe && x.exe.toLowerCase() === c.exe.toLowerCase() && alive(x.pid));
    if (cur !== c) return;
    if (!w) { if (!c.waiting) { c.waiting = true; kill(); emit({ t: 'waiting', name: c.name }); } return; }
    kill();
    const r = await spawnCap(w.pid, 'include', c.onData);
    if (cur !== c) { kill(); return; }
    if (r.ok) { log('reconectado ao processo', w.pid, 'de', c.exe); c.pid = w.pid; c.waiting = false; emit({ t: 'reattached', name: c.name }); }
  } catch (e) { log('vigia', e.message); } finally { busy = false; }
}
// o: { pid, mode: 'include' | 'exclude' }; onData(Buffer) recebe PCM float32 48 kHz estéreo. Resolve com {ok} ou {ok:false,error}.
async function start(o, onData) {
  stop();
  const mode = o.mode === 'exclude' ? 'exclude' : 'include';
  const pid = mode === 'exclude' ? process.pid : o.pid >>> 0; // "tudo menos a Resenha": o próprio app e os processos filhos dele
  if (!pid) return { ok: false, error: 'programa inválido' };
  const c = { pid, mode, onData, exe: null, name: '', waiting: false }; cur = c;
  const r = await spawnCap(pid, mode, onData);
  if (cur !== c) { kill(); return { ok: false, error: 'cancelado' }; }
  if (!r.ok) { cur = null; return r; }
  if (mode === 'include') listWindows().then(ws => { const w = ws.find(x => x.pid === pid); if (w && cur === c) { c.exe = w.exe; c.name = FRIENDLY[path.win32.basename(w.exe || '').replace(/\.exe$/i, '').toLowerCase()] || cleanTitle(w.title); } }).catch(() => { });
  clearInterval(watch); watch = setInterval(tick, 4000);
  return r;
}
function stop() { cur = null; clearInterval(watch); watch = null; kill(); }

// ---------- estado da janela transmitida ----------
// janela minimizada: o Windows para de entregar quadros e quem assiste vê a imagem parada; janela fechada: nada mais vem.
// sourceId "window:<hwnd>:0" -> { kind, exists, minimized, title }
// list: lista já em mãos (aviso de mudança); sem ela usa a dos avisos ou pergunta
async function sourceState(sourceId, list) {
  const m = /^window:(\d+):/.exec(String(sourceId || ''));
  if (!m) return { kind: /^screen:/.test(String(sourceId || '')) ? 'screen' : 'unknown' };
  if (process.platform !== 'win32' || !helperPath()) return { kind: 'window', exists: true, minimized: false };
  const w = (list || await listWindows({ cached: true })).find(x => String(x.hwnd) === m[1]);
  return { kind: 'window', exists: !!w, minimized: !!w?.minimized, title: w?.title || '' };
}

function shutdown() { stop(); helper?.stop(); helper = null; winCache = null; }

module.exports = { helperPath, getHelper, capable, listWindows, watchWindows, detectGame, start, stop, shutdown, isGame, cleanTitle, steamAppId, gameIcon, setEventSink, sourceState, _tick: tick, _state: () => cur };
