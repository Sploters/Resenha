// Configurações → Atalhos: remover um atalho (×), voltar um ao padrão (↺), "Restaurar padrão" e "Remover todos".
// Confere também que a tecla removida deixa de funcionar e que o app desktop recebe os atalhos novos (simulado).
// Uso: BROWSER=/caminho/do/chrome node scripts/keys-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3417, BASE = `http://localhost:${PORT}`, DATA = '.testdata-keys';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const r = await (await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'teclas', password: 'Teste.senha-12345' }) })).json();
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  // app desktop simulado: guarda o que a página manda registrar como atalho global
  await p.evaluateOnNewDocument(() => { window.__hk = []; window.lcDesktop = { isDesktop: true, setSettings: async (s) => { if ('hotkeyMute' in s) window.__hk.push(s); return true; }, getSettings: async () => ({}), onHotkey: () => { } }; });
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.evaluate((t) => localStorage.setItem('lc_token', t), r.token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(800);
  await p.evaluate(() => window.__lc.openSettings('keys')); await sleep(600);
  const rowsOf = () => p.evaluate(() => [...document.querySelectorAll('#settings .keyctl')].map(k => ({ key: k.querySelector('.btn').textContent, def: !!k.querySelector('.key-def'), rm: !!k.querySelector('.key-rm') })));
  let rows = await rowsOf();
  ok(rows.length === 6 && rows.every(x => x.rm && !x.def), 'seis atalhos, todos no padrão, cada um com ×', rows.map(x => x.key));
  const btn = (t) => p.evaluate((t) => { const b = [...document.querySelectorAll('#settings button')].find(x => x.textContent.trim() === t); return b ? !b.disabled : null; }, t);
  ok(await btn('Restaurar padrão') === false, '"Restaurar padrão" desabilitado com tudo no padrão');

  // × no atalho de silenciar (o primeiro)
  await p.evaluate(() => document.querySelectorAll('#settings .keyctl')[0].querySelector('.key-rm').click()); await sleep(300);
  rows = await rowsOf();
  ok(rows[0].key === 'Nenhum atalho' && !rows[0].rm && rows[0].def, 'silenciar: removido, mostra "Nenhum atalho" e o ↺', rows[0]);
  ok(await p.evaluate(() => window.__lc.S.prefs.keyMute) === '', 'preferência salva vazia (não volta ao padrão sozinha)');
  ok(await p.evaluate(() => window.__hk.at(-1)?.hotkeyMute) === '', 'app desktop: o atalho global de silenciar foi tirado', await p.evaluate(() => window.__hk.at(-1)));
  // Ctrl+Shift+M não silencia mais (o de ensurdecer continua)
  await p.evaluate(() => window.__lc.closeSettings?.() ?? document.querySelector('#settings .close')?.click()); await sleep(300);
  const fire = (code, key) => p.evaluate((code, key) => dispatchEvent(new KeyboardEvent('keydown', { code, key, ctrlKey: true, shiftKey: true, bubbles: true })), code, key);
  await p.evaluate(() => { const v = window.__lc.voice; window.__tog = []; v.toggleMute = () => window.__tog.push('mute'); v.toggleDeaf = () => window.__tog.push('deaf'); });
  await fire('KeyM', 'M'); await fire('KeyD', 'D'); await sleep(200);
  const tog = await p.evaluate(() => window.__tog);
  ok(tog.join() === 'deaf', 'Ctrl+Shift+M não silencia mais; Ctrl+Shift+D continua ensurdecendo', tog);

  await p.evaluate(() => window.__lc.openSettings('keys')); await sleep(500);
  ok(await btn('Restaurar padrão') === true, '"Restaurar padrão" habilitado com um atalho mudado');
  // ↺ volta só ele
  await p.evaluate(() => document.querySelectorAll('#settings .keyctl')[0].querySelector('.key-def').click()); await sleep(300);
  rows = await rowsOf();
  ok(rows[0].key === 'Ctrl + Shift + M' && rows[0].rm && !rows[0].def, '↺ volta o atalho de silenciar ao padrão', rows[0]);

  // Remover todos (confirma)
  await p.evaluate(() => [...document.querySelectorAll('#settings button')].find(x => x.textContent.trim() === 'Remover todos').click()); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent.trim() === 'Remover todos').click()); await sleep(400);
  rows = await rowsOf();
  ok(rows.every(x => x.key === 'Nenhum atalho' && !x.rm), 'Remover todos: nenhum atalho sobra', rows.map(x => x.key));
  const hk = await p.evaluate(() => window.__hk.at(-1));
  ok(hk && Object.values(hk).every(v => v === ''), 'app desktop: nenhum atalho global registrado', hk);
  ok(await p.evaluate(() => window.__lc.S.prefs.pttKey) === '', 'push-to-talk também sem tecla');

  // Restaurar padrão (confirma)
  await p.evaluate(() => [...document.querySelectorAll('#settings button')].find(x => x.textContent.trim() === 'Restaurar padrão').click()); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent.trim() === 'Restaurar').click()); await sleep(400);
  rows = await rowsOf();
  ok(rows.map(x => x.key).join('|') === 'Ctrl + Shift + M|Ctrl + Shift + D|F8|Ctrl + Shift + S|Ctrl + Shift + E|V', 'Restaurar padrão: todos de volta', rows.map(x => x.key));
  ok(JSON.stringify(await p.evaluate(() => window.__hk.at(-1))) === JSON.stringify({ hotkeyMute: 'CommandOrControl+Shift+M', hotkeyDeafen: 'CommandOrControl+Shift+D', hotkeyClip: 'F8', hotkeyShare: 'CommandOrControl+Shift+S' }), 'app desktop: atalhos globais padrão de volta', await p.evaluate(() => window.__hk.at(-1)));
  // persistência: recarrega e continua no padrão; remove um e recarrega
  await p.evaluate(() => document.querySelectorAll('#settings .keyctl')[2].querySelector('.key-rm').click()); await sleep(1500);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(1200);
  ok(await p.evaluate(() => window.__lc.S.prefs.keyClip) === '', 'clipe removido continua removido depois de recarregar');
  if (process.env.SHOTS) { await p.evaluate(() => window.__lc.openSettings('keys')); await sleep(600); fs.mkdirSync('.testshots', { recursive: true }); await p.screenshot({ path: '.testshots/keys.png' }); }
  ok(!errors.length, 'sem erros na página', errors);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
