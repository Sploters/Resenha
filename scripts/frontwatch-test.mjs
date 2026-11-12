// Teste do vigia da janela da frente (desktop/frontwatch.js) com o lc-audio de verdade: fora do Windows o --front lê o
// estado do arquivo em LC_FRONT_TEST. Confere: coberta/descoberta chegam em ~1 leitura, foco descobre na hora, o
// programa que cai é reaberto, programa velho (sem --front, sai na hora) faz desistir sem ficar reabrindo, e stop encerra.
// Uso: (cd native/lc-audio && cargo build --release) && node scripts/frontwatch-test.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createFrontWatch } = require('../desktop/frontwatch.js');
const exe = path.resolve('native/lc-audio/target/release/lc-audio');
if (!fs.existsSync(exe)) { console.error('falta', exe, '(cargo build --release em native/lc-audio)'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-')), file = path.join(dir, 'state');
fs.writeFileSync(file, '0');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (cond, msg) => { console.log((cond ? 'ok  ' : 'FALHOU ') + msg); if (!cond) ok = false; };

const procs = [];
const spawnFn = (cmd, args, o) => { const p = spawn(cmd, args, { ...o, env: { ...process.env, LC_FRONT_TEST: file } }); procs.push(p); return p; };
const events = [];
const w = createFrontWatch({ exe, hwnd: '1234', ms: 200, retryMs: 300, spawnFn, onChange: (c, i) => events.push({ c, i, t: Date.now() }) });
w.start();
await sleep(500);
check(!w.covered && events.length === 0, 'começa descoberta, sem aviso');
let t = Date.now(); fs.writeFileSync(file, '1'); await sleep(450);
check(w.covered && events.at(-1)?.c === true, `jogo na frente vira coberta (${events.at(-1) ? events.at(-1).t - t : '-'} ms)`);
check(/teste\.exe/.test(w.info?.exe || ''), 'informa o programa da frente');
w.focused();
check(!w.covered && events.at(-1)?.c === false, 'foco na Resenha descobre na hora');
fs.writeFileSync(file, '0'); await sleep(450); fs.writeFileSync(file, '1'); await sleep(450);
check(w.covered, 'coberta de novo depois do foco sair');
// programa caiu: volta sozinho e reavisa
procs.at(-1).kill('SIGKILL'); await sleep(100);
check(!w.covered, 'programa caiu: deixa de estar coberta (não fica presa escondida)');
await sleep(900);
check(w.covered && procs.length === 2, 'reaberto e coberta de novo');
w.stop(); await sleep(300);
check(procs.every(p => p.exitCode !== null || p.signalCode), 'stop encerra o programa');
check(!w.covered, 'parado: descoberta');

// programa velho (sem --front: sai na hora com código 2) — desiste depois de 3 vezes
const old = []; const w2 = createFrontWatch({ exe: process.execPath, hwnd: '1', retryMs: 50, spawnFn: (c, a, o) => { const p = spawn(process.execPath, ['-e', 'process.exit(2)'], o); old.push(p); return p; } });
w2.start(); await sleep(1200);
check(old.length === 3 && !w2.covered, `programa sem --front: desiste depois de ${old.length} tentativas`);
w2.stop();
// sem programa/janela: nem tenta
const w3 = createFrontWatch({ exe: null, hwnd: '1' }); w3.start(); check(!w3.covered, 'sem o programa: nunca coberta');
fs.rmSync(dir, { recursive: true, force: true });
console.log(ok ? '\nTUDO OK' : '\nFALHAS'); process.exit(ok ? 0 : 1);
