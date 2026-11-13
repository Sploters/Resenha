// Programa nativo aberto o tempo todo (desktop/helper.js + lc-audio --serve), com o lc-audio de verdade: fora do Windows a
// lista de janelas vem do arquivo em LC_WINDOWS_TEST, a janela da frente do LC_FRONT_TEST e o aviso do clipe é anotado no
// LC_TOAST_TEST. Confere: um processo só para listas, ícones e avisos; aviso de mudança na lista (e nenhum sem mudança);
// cobertura avisada; programa que cai reabre e repete os pedidos fixos; versão sem --serve não fica reabrindo;
// frontwatch pelos avisos (e de volta ao --front sem o programa); appaudio sem abrir processos avulsos; aviso do clipe
// nativo e a janela do Chromium quando o nativo falha.
// Uso: (cd native/lc-audio && cargo build --release) && node scripts/helper-test.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const exe = path.resolve('native/lc-audio/target/release/lc-audio');
if (!fs.existsSync(exe)) { console.error('falta', exe, '(cargo build --release em native/lc-audio)'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-'));
const F = { wins: path.join(dir, 'wins.json'), front: path.join(dir, 'front'), toast: path.join(dir, 'toast.log') };
const W1 = [{ hwnd: 11, pid: 101, title: 'Bloco de Notas', exe: 'C:\\Windows\\notepad.exe', minimized: false, fullscreen: false }];
const W2 = [...W1, { hwnd: 22, pid: 202, title: 'PEAK', exe: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\PEAK\\PEAK.exe', minimized: false, fullscreen: true }];
const setWins = (l) => fs.writeFileSync(F.wins, JSON.stringify(l));
setWins(W1); fs.writeFileSync(F.front, '0');
const env = { ...process.env, LC_WINDOWS_TEST: F.wins, LC_FRONT_TEST: F.front, LC_TOAST_TEST: F.toast };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const until = async (f, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(20); } return !!f(); };

const procs = [];
const spawnFn = (cmd, args, o) => { const p = spawn(cmd, args, { ...o, env }); procs.push({ args, p }); return p; };
const { createHelper } = require('../desktop/helper.js');

try {
  // ---------- pedidos ----------
  const h = createHelper({ exe, spawnFn, retryMs: 100 });
  const info = await h.open();
  ok(info?.v === 1 && info.toast === true, 'abre e se apresenta', info);
  const l1 = await h.call('windows');
  ok(l1.length === 1 && l1[0].title === 'Bloco de Notas', 'lista as janelas pelo programa aberto');
  const ic = await h.call('icon', { exe: 'C:\\x.exe' });
  ok(typeof ic?.png === 'string' && ic.w === ic.h && ic.w > 0, 'ícone pelo programa aberto', { w: ic?.w });
  await Promise.all(Array.from({ length: 20 }, () => h.call('windows')));
  ok(procs.length === 1, `20 listas seguidas sem abrir outro processo (${procs.length} aberto)`);
  await h.call('nada').then(() => ok(false, 'pedido desconhecido rejeita'), (e) => ok(/desconhecido/.test(e.message), 'pedido desconhecido rejeita'));

  // ---------- aviso de mudança na lista ----------
  const evs = []; h.on('windows', (e) => evs.push(e));
  await h.keep('watch', { on: true });
  ok(await until(() => evs.length === 1), 'liga os avisos e recebe a lista atual');
  await sleep(700);
  ok(evs.length === 1, 'sem mudança, sem aviso', evs.length);
  let t = Date.now(); setWins(W2);
  ok(await until(() => evs.length === 2), `jogo abriu: avisa (${Date.now() - t} ms)`);
  ok(evs.at(-1).list.some(w => w.title === 'PEAK'), 'o aviso traz a lista nova');

  // ---------- janela da frente ----------
  const fr = []; h.on('front', (e) => fr.push(e));
  await h.keep('front', { hwnd: '1234' });
  ok(await until(() => fr.length === 1 && fr[0].covered === false), 'vigia a janela da frente: descoberta');
  t = Date.now(); fs.writeFileSync(F.front, '1');
  ok(await until(() => fr.at(-1)?.covered === true), `jogo na frente: coberta (${Date.now() - t} ms)`);
  ok(/teste\.exe/.test(fr.at(-1).exe || ''), 'informa o programa da frente');

  // ---------- aviso do clipe ----------
  const r = await h.call('toast', { ok: true, title: 'Clipe salvo', sub: '30s' });
  ok(typeof r?.ms === 'number', 'aviso do clipe responde quando aparece');
  ok(/Clipe salvo/.test(fs.readFileSync(F.toast, 'utf8')), 'aviso do clipe pedido ao programa');

  // ---------- caiu: reabre e repete os pedidos fixos ----------
  let downs = 0; h.on('down', () => downs++);
  const before = { ev: evs.length, fr: fr.length };
  procs.at(-1).p.kill('SIGKILL');
  ok(await until(() => downs === 1), 'queda avisada (quem ouve volta ao estado neutro)');
  ok(await until(() => procs.length === 2 && h.up), 'reabriu sozinho');
  ok(await until(() => evs.length > before.ev && fr.length > before.fr), 'repetiu a lista e a janela da frente depois de reabrir');
  fs.writeFileSync(F.front, '0');
  ok(await until(() => fr.at(-1)?.covered === false), 'continua avisando a cobertura depois de reabrir');
  h.stop(); await sleep(300);
  ok(procs.every(x => x.p.exitCode !== null || x.p.signalCode), 'stop encerra o programa');
  await h.call('windows').then(() => ok(false, 'parado: pedidos rejeitam'), () => ok(true, 'parado: pedidos rejeitam'));

  // ---------- versão sem --serve ----------
  const old = [];
  const h2 = createHelper({ exe: process.execPath, retryMs: 50, spawnFn: (c, a, o) => { const p = spawn(process.execPath, ['-e', 'process.exit(2)'], o); old.push(p); return p; } });
  await h2.call('windows').then(() => ok(false, 'sem --serve: rejeita'), () => ok(true, 'sem --serve: rejeita (quem chama usa o jeito antigo)'));
  await h2.keep('front', { hwnd: '1' }); await sleep(400);
  await h2.call('windows').catch(() => { });
  ok(old.length === 1, `sem --serve: não fica reabrindo (${old.length} tentativa)`);
  // cai logo ao abrir (outro motivo): desiste depois de 3
  const crash = [];
  const h3 = createHelper({ exe: process.execPath, retryMs: 30, spawnFn: (c, a, o) => { const p = spawn(process.execPath, ['-e', 'process.exit(1)'], o); crash.push(p); return p; } });
  await h3.keep('front', { hwnd: '1' }); await sleep(800);
  ok(crash.length === 3, `caindo logo ao abrir: desiste depois de ${crash.length} tentativas`);
  h3.stop();

  // ---------- frontwatch pelos avisos ----------
  const { createFrontWatch } = require('../desktop/frontwatch.js');
  procs.length = 0; fs.writeFileSync(F.front, '0');
  const h4 = createHelper({ exe, spawnFn });
  const fe = [];
  const fw = createFrontWatch({ exe, helper: h4, hwnd: '1234', spawnFn, onChange: (c) => fe.push(c) });
  fw.start(); await until(() => fw.mode === 'events');
  ok(fw.mode === 'events' && procs.every(x => x.args[0] === '--serve'), 'frontwatch usa os avisos do programa aberto (sem --front)', fw.mode);
  fs.writeFileSync(F.front, '1');
  ok(await until(() => fw.covered), 'coberta pelos avisos');
  fw.focused(); ok(!fw.covered, 'foco na Resenha descobre na hora');
  fs.writeFileSync(F.front, '0'); await sleep(400); fs.writeFileSync(F.front, '1');
  ok(await until(() => fw.covered), 'coberta de novo');
  fw.stop(); await sleep(100);
  ok(!fw.covered, 'parado: descoberta');
  h4.stop();
  // programa aberto indisponível → --front como antes
  const h5 = createHelper({ exe: process.execPath, spawnFn: (c, a, o) => spawn(process.execPath, ['-e', 'process.exit(2)'], o) });
  procs.length = 0;
  const fw2 = createFrontWatch({ exe, helper: h5, hwnd: '1234', ms: 200, spawnFn, onChange: () => { } });
  fw2.start();
  ok(await until(() => fw2.mode === 'poll'), 'sem o programa aberto: volta ao --front', fw2.mode);
  ok(procs.some(x => x.args[0] === '--front'), 'abriu o --front');
  fw2.stop();

  // ---------- appaudio e clipflash no "Windows" ----------
  const binDir = path.join(dir, 'bin'); fs.mkdirSync(binDir);
  // lc-audio.exe = o programa de verdade com o ambiente de teste (o appaudio abre pelo spawn padrão)
  fs.writeFileSync(path.join(binDir, 'lc-audio.exe'), `#!/bin/sh\nexport LC_WINDOWS_TEST='${F.wins}' LC_FRONT_TEST='${F.front}' LC_TOAST_TEST='${F.toast}'\necho "$@" >> '${path.join(dir, 'spawns.log')}'\nexec '${exe}' "$@"\n`, { mode: 0o755 });
  const Module = require('node:module'), load = Module._load;
  const windowsMade = [];
  class FakeWin { constructor(o) { windowsMade.push(o); this.webContents = { on() { }, setWindowOpenHandler() { } }; } setAlwaysOnTop() { } setVisibleOnAllWorkspaces() { } setIgnoreMouseEvents() { } setContentProtection() { } once() { } loadURL() { return Promise.resolve(); } isDestroyed() { return false; } destroy() { } }
  Module._load = function (req, ...rest) {
    return req === 'electron' ? { app: { getFileIcon: async () => ({ isEmpty: () => true }) }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 40 }), toPNG: () => Buffer.from('png') }) },
      BrowserWindow: FakeWin, screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) } } : load.call(this, req, ...rest);
  };
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.resourcesPath = binDir;
  const A = require('../desktop/appaudio.js');
  setWins(W1);
  const changes = []; A.watchWindows((l) => changes.push(l));
  ok(await until(() => changes.length >= 1), 'appaudio: recebe a lista pelos avisos');
  ok((await A.detectGame()) === null, 'sem jogo aberto: nada');
  t = Date.now(); setWins(W2);
  ok(await until(() => changes.length >= 2), `appaudio: jogo abriu, aviso em ${Date.now() - t} ms`);
  const g = await A.detectGame();
  ok(g?.id === 'peak' && g.title === 'PEAK', 'detecta o jogo pela lista dos avisos', g && { id: g.id, title: g.title });
  ok(!!g?.icon, 'ícone do jogo pelo programa aberto');
  const st = await A.sourceState('window:22:0');
  ok(st.exists && !st.minimized, 'estado da janela transmitida pela lista dos avisos', st);
  setWins(W1); await until(() => changes.length >= 3);
  ok((await A.sourceState('window:22:0')).exists === false, 'janela fechada: aparece na hora');
  for (let i = 0; i < 10; i++) { await A.listWindows(); await A.detectGame(); await A.sourceState('window:11:0'); }
  const spawned = fs.readFileSync(path.join(dir, 'spawns.log'), 'utf8').trim().split('\n');
  ok(spawned.length === 1 && spawned[0] === '--serve', `appaudio: 30 consultas e um processo só (${spawned.join(', ')})`);
  // aviso do clipe
  const clip = require('../desktop/clipflash.js');
  const hh = A.getHelper();
  fs.writeFileSync(F.toast, '');
  clip.show({ ok: true, title: 'Clipe salvo', sub: '30s' }, hh); await sleep(300);
  ok(/Clipe salvo/.test(fs.readFileSync(F.toast, 'utf8')) && windowsMade.length === 0, 'aviso do clipe nativo, sem janela do Chromium');
  clip.show({ ok: false, title: 'Clipe não salvo' }, { up: true, info: { toast: true }, call: () => Promise.reject(new Error('fora da captura: recusado')) }); await sleep(50);
  ok(windowsMade.length === 1, 'nativo falhou: usa a janela do Chromium');
  clip.show({ ok: true, title: 'x' }, null);
  ok(windowsMade.length === 2, 'sem o programa aberto: janela do Chromium');
  A.shutdown(); clip.hide();
} catch (e) { console.error(e); fails++; }
finally {
  await sleep(300);
  for (const x of procs) { try { x.p.kill('SIGKILL'); } catch { } }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
