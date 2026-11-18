// Transmissão a 120 FPS (processo principal): liga o programa nativo lc-stream, que captura a tela/janela sem o limite
// de ~48 fps do Chromium, comprime em H.264 na placa de vídeo e envia por SRTP direto ao servidor.
// O renderer pede a sessão ao servidor (chaves, porta) e passa para cá; o áudio e a prévia local continuam no Chromium.
const { screen, desktopCapturer } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let proc = null, onEvent = () => { }, probed = null;
// clipes da própria transmissão (native/lc-stream/src/replay.rs): o programa guarda os quadros que já comprimiu e grava
// os últimos segundos num arquivo quando a página pede. keepMs vale também para o próximo programa aberto (reinício).
let keepMs = 0, clipSeq = 0;
const clipWait = new Map(); // id -> { resolve, timer }
const log = (...a) => console.log('[native]', ...a);
const helperPath = () => {
  const cands = [path.join(process.resourcesPath || '', 'lc-stream.exe'), path.join(__dirname, 'native', 'lc-stream.exe')];
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
};

// Há codificador H.264 de hardware e captura WGC? (resultado guardado: o programa só lista, não captura nada)
// mode: método de captura escolhido nas configurações ('auto' | 'wgc' | 'dxgi'); sem ele = caminho clássico (só WGC,
// e no Windows 10 fica no Chromium por causa da borda amarela). Com o DXGI o Windows 10 também transmite pelo nativo.
const MODES = ['auto', 'wgc', 'dxgi'];
function capable(mode) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, code: 'web', reason: 'Só no app para Windows.' });
  const exe = helperPath(); if (!exe) return Promise.resolve({ ok: false, code: 'noexe', reason: 'Componente de transmissão nativa não encontrado. Atualize o app.' });
  const m = MODES.includes(mode) ? mode : null;
  if (!hasMediaFoundation()) return Promise.resolve({ ok: false, code: 'nomf', reason: NOMF_MSG, modes: MODES, os: winBuild });
  if (!m && winBuild && winBuild < 20348) return Promise.resolve({ ok: false, code: 'win10', reason: BORDER_MSG, modes: MODES, os: winBuild });
  if (!probed) probed = new Promise((res) => execFile(exe, ['--probe'], { windowsHide: true, timeout: 10000 }, (err, out) => {
    let j = null; try { j = JSON.parse(String(out).trim().split(/\r?\n/).pop()); } catch { }
    // 0xC0000135 (DLL não encontrada): o programa nem abriu, falta o mfplat.dll (Windows "N" sem o pacote de mídia)
    if (!j && err && (err.code === 3221225781 || err.code === -1073741515)) { probed = null; return res({ ok: false, code: 'nomf', reason: NOMF_MSG }); }
    if (!j) { probed = null; return res({ ok: false, code: 'other', reason: 'Não consegui testar a placa de vídeo' + (err ? ': ' + err.message : '') }); }
    res(j);
  }));
  return probed.then((j) => {
    if (j.ok === false && j.code) return j; // falha do próprio teste
    const enc = Array.isArray(j.encoders) && j.encoders.length > 0;
    if (!enc) return { ok: false, code: 'nohw', reason: j.error || 'Nenhum codificador de vídeo de hardware (NVIDIA, AMD ou Intel) encontrado.', modes: MODES, os: winBuild };
    // o DXGI não depende do WGC: sem WGC, só "wgc" e o clássico ficam de fora
    if (j.wgc === false && (!m || m === 'wgc')) return { ok: false, code: 'nocap', reason: 'Este Windows não tem a captura de tela necessária (Windows 10 1903 ou mais novo).', modes: MODES, os: winBuild };
    const note = m === 'wgc' && winBuild && winBuild < 22000 ? 'WGC forçado no Windows 10: aparece uma borda amarela em volta da captura.' : null;
    return { ok: true, encoders: j.encoders, modes: MODES, os: winBuild, note };
  });
}

// Media Foundation (mfplat.dll): é por ela que o programa nativo e o Chromium chegam ao codificador H.264 da placa de
// vídeo (NVENC/AMF/QuickSync). As edições "N"/"KN" do Windows vêm sem ela até instalar o Pacote de Recursos de Mídia
// (Configurações > Aplicativos > Recursos opcionais); sem ela o lc-stream.exe nem abre e a transmissão sai em VP8 pela CPU.
const sys32 = () => path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32');
let mfCache;
function hasMediaFoundation() {
  if (process.platform !== 'win32') return true;
  if (mfCache === undefined) mfCache = ['mfplat.dll', 'mf.dll'].every(f => { try { return fs.statSync(path.join(sys32(), f)).isFile(); } catch { return false; } });
  return mfCache;
}
const NOMF_MSG = 'Este Windows está sem os recursos de mídia (edição "N"). Instale o Pacote de Recursos de Mídia em Configurações > Aplicativos > Recursos opcionais e reinicie o PC.';
// o que o painel de codecs mostra (Configurações > Transmissão)
const codecEnv = () => ({ platform: process.platform, build: winBuild || null, mediaFoundation: hasMediaFoundation() });

// Windows 10: a captura do programa nativo (WGC) sempre desenha uma borda amarela em volta da tela/janela, e só o Windows
// 11 deixa tirar. Lá a transmissão fica no caminho normal (até 60 FPS), que captura sem a borda.
const winBuild = process.platform === 'win32' ? +require('os').release().split('.')[2] || 0 : 0;
const BORDER_MSG = 'No Windows 10 a captura a 120 FPS mostra uma borda amarela em volta da tela (limitação do Windows; no Windows 11 não acontece). Transmitindo a 60 FPS, sem a borda.';

// id do desktopCapturer -> o que o programa entende: janela (HWND) ou um ponto dentro do monitor (pixels físicos)
async function sourceFor(id) {
  if (!id) return {};
  if (id.startsWith('window:')) { const hwnd = parseInt(id.split(':')[1], 10); return hwnd ? { window: hwnd } : {}; }
  if (id.startsWith('screen:')) {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
    const src = list.find(s => s.id === id), all = screen.getAllDisplays();
    const d = all.find(x => String(x.id) === String(src?.display_id)) || (all.length === 1 ? all[0] : null);
    if (!d) return {};
    const r = process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
    return { monitor: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] };
  }
  return {};
}

const failClips = (error) => { for (const id of [...clipWait.keys()]) clipDone({ id, ok: false, error }); };
function stop() {
  const p = proc; if (!p) return;
  proc = null; failClips('a transmissão nativa parou');
  try { p.stdin.write('stop\n'); p.stdin.end(); } catch { }
  setTimeout(() => { try { p.kill(); } catch { } }, 3000);
}

// o: { host, port, ssrc, pt, key, serverKey, fps, height, kbps, cursor, sourceId, capture }. Resolve com o evento "started" ou "error".
// capture ('auto' | 'wgc' | 'dxgi'): captura com escolha de método (native/lc-stream/src/capture.rs). Sem ele, o caminho clássico.
async function start(o) {
  stop();
  const exe = helperPath(); if (!exe) return { ok: false, error: 'Componente de transmissão nativa não encontrado' };
  const cfg = { host: String(o.host), port: o.port | 0, ssrc: o.ssrc >>> 0, pt: o.pt | 0, key: String(o.key), serverKey: String(o.serverKey),
    fps: Math.max(1, Math.min(240, o.fps | 0)), height: Math.max(144, Math.min(2160, o.height | 0)), kbps: Math.max(500, Math.min(100000, o.kbps | 0)), cursor: o.cursor !== false, ...(await sourceFor(o.sourceId)) };
  if (MODES.includes(o.capture)) { cfg.capture = o.capture; cfg.osBuild = winBuild; }
  if (keepMs > 0) cfg.clipKeepMs = keepMs;
  // camadas do simulcast (da leve para a cheia), cada uma com o próprio ssrc
  if (Array.isArray(o.layers)) cfg.layers = o.layers.slice(0, 3).map(l => ({ ssrc: l.ssrc >>> 0, height: Math.max(144, Math.min(2160, l.height | 0)), fps: Math.max(1, Math.min(240, l.fps | 0)), kbps: Math.max(300, Math.min(100000, l.kbps | 0)) }));
  const p = spawn(exe, ['--stdin'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc = p;
  return new Promise((resolve) => {
    let done = false, buf = '';
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const t = setTimeout(() => { finish({ ok: false, error: 'O programa de transmissão não respondeu' }); if (proc === p) stop(); }, 15000);
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t === 'clip') { clipDone(ev); continue; }
        if (ev.t === 'started') { clearTimeout(t); finish({ ok: true, ...ev }); }
        if (ev.t === 'error') { clearTimeout(t); finish({ ok: false, error: ev.error }); }
        if (proc === p || ev.t !== 'stats') onEvent(ev);
      }
    });
    p.stderr.on('data', (d) => log(String(d).trim()));
    p.on('error', (e) => { clearTimeout(t); finish({ ok: false, error: e.message }); });
    p.on('exit', (code) => { clearTimeout(t); finish({ ok: false, error: 'o programa fechou (código ' + code + ')' }); if (proc === p) { proc = null; failClips('o programa de transmissão fechou'); onEvent({ t: 'exit', code }); } });
    p.stdin.write(JSON.stringify(cfg) + '\n');
  });
}

const send = (o) => { try { proc?.stdin.write(JSON.stringify(o) + '\n'); return !!proc; } catch { return false; } };
// liga (ms > 0) ou desliga (0) o buffer dos clipes; até 10 min
function clipKeep(ms) { keepMs = Math.max(0, Math.min(600000, +ms || 0)); send({ cmd: 'clipKeep', ms: keepMs }); }
// os últimos `secs` segundos: { ok, bytes (Buffer), frames, ms } ou { ok: false, error }. O programa grava um arquivo
// temporário (o vídeo pode ter centenas de MB: pela saída padrão em JSON seria lento) que é lido e apagado aqui.
function clip(secs) {
  if (!proc) return Promise.resolve({ ok: false, error: 'a transmissão nativa não está no ar' });
  const id = ++clipSeq, file = path.join(require('os').tmpdir(), `resenha-clip-${process.pid}-${id}.lcrb`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { clipWait.delete(id); fs.rm(file, { force: true }, () => { }); resolve({ ok: false, error: 'o programa de transmissão não respondeu' }); }, 20000);
    clipWait.set(id, { resolve, timer });
    if (!send({ cmd: 'clip', id, secs: Math.max(1, Math.min(600, +secs || 30)), path: file })) clipDone({ id, ok: false, error: 'o programa de transmissão fechou' });
  });
}
function clipDone(ev) {
  const w = clipWait.get(ev.id); if (!w) return;
  clipWait.delete(ev.id); clearTimeout(w.timer);
  if (!ev.ok) return w.resolve({ ok: false, error: ev.error || 'falhou' });
  fs.readFile(ev.path, (err, bytes) => { fs.rm(ev.path, { force: true }, () => { }); w.resolve(err ? { ok: false, error: err.message } : { ok: true, bytes, frames: ev.frames, ms: ev.ms }); });
}

module.exports = { capable, codecEnv, start, stop, clip, clipKeep, onNativeEvent: (cb) => { onEvent = cb; }, shutdown: stop };
