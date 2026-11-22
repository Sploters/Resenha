// Vigia do programa nativo aberto (desktop/helper.js): programa que responde ao "hello" e depois trava (vivo, mas mudo)
// é encerrado depois de 3 pedidos sem resposta e reaberto (os pedidos fixos voltam). Sem Rust: um programa falso em Node.
// Uso: node scripts/helper-hang-unit-test.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { createHelper } = require('../desktop/helper.js');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 1ª vez: responde só ao hello (trava depois). Da 2ª em diante: responde a tudo
const FAKE = "const mute=process.env.MUTE==='1';require('readline').createInterface({input:process.stdin}).on('line',l=>{const j=JSON.parse(l);if(j.op==='hello'||!mute)console.log(JSON.stringify({id:j.id,r:{op:j.op}}));}).on('close',()=>process.exit(0));";
let spawns = 0; const procs = [];
const h = createHelper({ exe: 'fake', helloMs: 2000, retryMs: 200, log: () => { },
  spawnFn: (_, args, o) => { const p = spawn(process.execPath, ['-e', FAKE], { ...o, env: { ...process.env, MUTE: spawns++ === 0 ? '1' : '0' } }); procs.push(p); return p; } });
try {
  ok(!!(await h.open()), 'abriu');
  h.keep('watch', {}); // pedido fixo: com ele o programa reabre sozinho
  for (let i = 0; i < 3; i++) await h.call('list', {}, 300).then(() => ok(false, 'travado não devia responder'), () => { });
  await sleep(300);
  ok(procs[0].exitCode !== null || procs[0].signalCode !== null, 'programa travado encerrado depois de 3 pedidos sem resposta');
  for (let i = 0; i < 30 && !h.up; i++) await sleep(100);
  ok(h.up && spawns === 2, 'reaberto sozinho', { spawns });
  ok((await h.call('list', {}, 1000).catch(() => null))?.op === 'list', 'o novo responde');
} catch (e) { ok(false, 'erro: ' + e.message); }
h.stop(); await sleep(200);
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
