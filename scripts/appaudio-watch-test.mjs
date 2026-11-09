// Vigia do áudio do jogo (desktop/appaudio.js), sem Windows: um lc-audio falso (script Node) lista janelas de um arquivo
// e "captura" mandando bytes. Confere: jogo reinicia com outro processo → religa no novo e avisa 'reattached'; jogo fecha →
// avisa 'waiting' uma vez; programa de áudio cai com o jogo vivo → reabre; stop() encerra o vigia; estado da janela
// (minimizada / fechada). Uso: node scripts/appaudio-watch-test.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const require = createRequire(import.meta.url);
const root = path.resolve('desktop/appaudio.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcaudio-'));
const winsFile = path.join(dir, 'wins.json'), capLog = path.join(dir, 'caps.log');
fs.writeFileSync(path.join(dir, 'lc-audio.exe'), `#!${process.execPath}
const fs = require('fs'), a = process.argv[2];
if (a === '--windows') { process.stdout.write(fs.readFileSync(${JSON.stringify(winsFile)}, 'utf8')); process.exit(0); }
if (a === '--capture') {
  let buf = ''; process.stdin.on('data', d => { buf += d; const l = buf.split('\\n'); buf = l.pop();
    for (const x of l) { if (x === 'stop') process.exit(0); const o = JSON.parse(x); fs.appendFileSync(${JSON.stringify(capLog)}, o.pid + '\\n'); process.stderr.write(JSON.stringify({ t: 'started' }) + '\\n'); setInterval(() => process.stdout.write(Buffer.alloc(64)), 50); } });
}
`, { mode: 0o755 });
const game = () => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
const setWins = (list) => fs.writeFileSync(winsFile, JSON.stringify(list));

// electron de mentira e "Windows"
const Module = require('node:module'), load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: { getFileIcon: async () => ({ isEmpty: () => true }) }, nativeImage: {} } : load.call(this, req, ...rest); };
Object.defineProperty(process, 'platform', { value: 'win32' });
process.resourcesPath = dir; // helperPath() procura primeiro em resourcesPath/lc-audio.exe
const A = require(root);
const events = []; A.setEventSink((e) => events.push(e));
let bytes = 0; const onData = (b) => { bytes += b.length; };
const caps = () => (fs.existsSync(capLog) ? fs.readFileSync(capLog, 'utf8').trim().split('\n').filter(Boolean).map(Number) : []);

try {
  const g1 = game(); await sleep(200);
  const exe = 'C:\\\\Jogos\\\\Peak\\\\PEAK.exe';
  setWins([{ hwnd: 111, pid: g1.pid, title: 'PEAK', exe, minimized: false }]);
  const r = await A.start({ pid: g1.pid, mode: 'include' }, onData);
  ok(r.ok, 'captura começou', r); await sleep(400);
  ok(bytes > 0, 'áudio chegando');
  ok(A._state()?.exe === exe, 'vigia sabe o executável do jogo', A._state()?.exe);

  // jogo reinicia: processo novo, mesmo executável
  g1.kill(); await sleep(200);
  const g2 = game(); await sleep(200);
  setWins([{ hwnd: 222, pid: g2.pid, title: 'PEAK', exe, minimized: false }]);
  await A._tick(); await sleep(300);
  ok(A._state()?.pid === g2.pid && caps().at(-1) === g2.pid, 'jogo reiniciou: captura religada no processo novo', { pid: A._state()?.pid, caps: caps() });
  ok(events.at(-1)?.t === 'reattached' && events.at(-1)?.name === 'PEAK', 'página avisada: reconectado', events.at(-1));

  // jogo fecha e não volta: avisa uma vez
  g2.kill(); await sleep(200); setWins([]);
  await A._tick(); await A._tick();
  ok(events.filter(e => e.t === 'waiting').length === 1, 'jogo fechado: avisa "esperando" uma vez', events);
  // volta
  const g3 = game(); await sleep(200);
  setWins([{ hwnd: 333, pid: g3.pid, title: 'PEAK', exe: exe.toUpperCase(), minimized: true }]);
  await A._tick(); await sleep(300);
  ok(A._state()?.pid === g3.pid && events.at(-1)?.t === 'reattached', 'jogo abriu de novo: religa (nome do executável sem diferenciar maiúsculas)');

  // programa de áudio cai com o jogo vivo: reabre no mesmo processo
  const before = caps().length;
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('pkill', ['-f', 'lc-audio.exe --capture']); } catch { } await sleep(300);
  await A._tick(); await sleep(300);
  ok(caps().length === before + 1 && caps().at(-1) === g3.pid, 'programa de áudio caiu: reaberto no mesmo jogo', caps());

  // estado da janela transmitida
  setWins([{ hwnd: 333, pid: g3.pid, title: 'PEAK', exe, minimized: true }]);
  ok((await A.sourceState('window:333:0')).minimized === true, 'janela minimizada detectada');
  setWins([]);
  ok((await A.sourceState('window:333:0')).exists === false, 'janela fechada detectada');
  ok((await A.sourceState('screen:0:0')).kind === 'screen', 'tela inteira: nada a vigiar');

  A.stop(); const n = caps().length; await A._tick(); await sleep(200);
  ok(!A._state() && caps().length === n, 'parar a transmissão encerra o vigia');
  g3.kill();
} finally { A.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 1700);
