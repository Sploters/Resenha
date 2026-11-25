// Fumaça do servidor, sem navegador (~3 s): sobe numa pasta de dados vazia e confere o básico que tem que estar sempre de pé.
// - a página sai com a CSP (server/security.js) e o hash dela bate com o script inline do index.html;
// - cada módulo avisado na página (modulepreload) responde 200, sem a CSP de página (não é página);
// - a API sem login responde 401, e um caminho de fora da pasta public não sai.
// Uso: node scripts/smoke-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = await freePort(), RTC = await freePort(), BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'resenha-smoke-'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC), RTC_IPS: '127.0.0.1', CSP: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
let err = ''; srv.stderr.on('data', (d) => { err += d; });
const end = (code) => { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(code); };
for (let i = 0; ; i++) {
  try { await fetch(BASE + '/'); break; } catch { if (i > 150 || srv.exitCode !== null) { console.log('servidor não subiu\n' + err.slice(-2000)); end(1); } await new Promise(r => setTimeout(r, 100)); }
}

console.log('— página');
const r = await fetch(BASE + '/'), html = await r.text(), csp = r.headers.get('content-security-policy') || '';
ok(r.status === 200 && html.includes('<script type="module"'), 'página abre');
ok(/script-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /frame-ancestors 'self'/.test(csp), 'CSP na página', csp);
ok(!/script-src[^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'unsafe-eval'/.test(csp), 'CSP sem script inline/eval liberado');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
ok(inline.length > 0 && inline.every(h => csp.includes(h)), 'hash do script inline da página está na CSP', inline);
ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'SAMEORIGIN', 'nosniff e X-Frame-Options');
const deep = await fetch(BASE + '/channels/1/2');
ok(deep.status === 200 && !!deep.headers.get('content-security-policy'), 'rota da interface (sem extensão) também leva a CSP');

console.log('— módulos');
const mods = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]);
ok(mods.length >= 3, `modulepreload na página (${mods.length})`);
const bad = [];
for (const m of mods) { const x = await fetch(BASE + m); await x.arrayBuffer(); if (x.status !== 200 || x.headers.get('content-security-policy')) bad.push(m + ' ' + x.status); }
ok(!bad.length, 'todos os módulos respondem 200, sem CSP de página', bad);

console.log('— API');
const me = await fetch(BASE + '/api/users/@me');
ok(me.status === 401, 'API sem login: 401', me.status);
const trav = await fetch(BASE + '/..%2fpackage.json');
ok(trav.status !== 200 || !(await trav.text()).includes('"mediasoup"'), 'não sai arquivo de fora de public/');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
end(fails ? 1 : 0);
