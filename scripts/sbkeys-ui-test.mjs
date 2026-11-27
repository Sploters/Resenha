// Atalhos do soundboard: o chip de atalho embaixo de cada som (Configurações → Soundboard), o aviso de quem perdeu a tecla,
// o "Adicionar atalho" em Atalhos (escolheu o som, já espera a tecla) e a captura que se cancela ao clicar fora.
// Uso: BROWSER=/caminho/do/chrome node scripts/sbkeys-ui-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3419, BASE = `http://localhost:${PORT}`, DATA = '.testdata-sbkeys';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const r = await (await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'sons', password: 'Teste.senha-12345' }) })).json();
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.evaluate((t) => localStorage.setItem('lc_token', t), r.token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(800);
  await p.evaluate(() => { const P = window.__lc.S.prefs; P.mySounds = [{ id: 's1', name: 'Buzina', url: '/x1.ogg', emoji: '📯' }, { id: 's2', name: 'Risada', url: '/x2.ogg', emoji: '😂' }]; P.sbNumpad = false; window.__lc.savePrefs(); });
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('#toast')].map(t => t.textContent).join(' | '));
  await p.evaluate(() => window.__lc.openSettings('soundboard')); await sleep(600);
  const chips = () => p.evaluate(() => [...document.querySelectorAll('#settings .sbp-key')].map(b => b.textContent));
  ok(JSON.stringify(await chips()) === '["+ Atalho","+ Atalho"]', 'cada som tem o chip "+ Atalho"', await chips());
  // clica no chip e aperta F6
  await p.click('#settings .sbp-key'); await sleep(100);
  ok(await p.evaluate(() => document.querySelector('#settings .sbp-key').classList.contains('capturing')), 'clicou: o chip espera a tecla');
  await p.keyboard.down('Control'); await sleep(50);
  ok(/Ctrl \+ …/.test(await p.evaluate(() => document.querySelector('#settings .sbp-key').textContent)), 'segurando Ctrl: mostra a combinação sendo montada');
  await p.keyboard.up('Control'); await p.keyboard.press('F6'); await sleep(400);
  ok(await p.evaluate(() => window.__lc.S.prefs.sbKeys?.s1) === 'F6', 'F6 vira o atalho da Buzina');
  ok(JSON.stringify(await chips()) === '["F6","+ Atalho"]', 'o chip mostra F6', await chips());
  // a mesma tecla na Risada: a Buzina perde e o aviso diz
  await p.evaluate(() => document.querySelectorAll('#settings .sbp-key')[1].click()); await sleep(100);
  await p.keyboard.press('F6'); await sleep(400);
  ok(await p.evaluate(() => JSON.stringify(window.__lc.S.prefs.sbKeys)) === '{"s2":"F6"}', 'a tecla passa para a Risada (uma tecla, um som)');
  ok(/antes era o som "Buzina"/.test(await toasts()), 'o aviso diz de quem era a tecla', await toasts());
  // clicar fora cancela a captura (antes ficava esperando a próxima tecla em qualquer lugar)
  await p.click('#settings .sbp-key'); await sleep(100);
  await p.mouse.click(700, 60); await sleep(100);
  await p.keyboard.press('F7'); await sleep(300);
  ok(!(await p.evaluate(() => window.__lc.S.prefs.sbKeys?.s1)) && !(await p.evaluate(() => !!document.querySelector('#settings .capturing'))), 'clicar fora cancela: F7 depois não vira atalho');
  // × remove
  await p.evaluate(() => document.querySelector('#settings .sbp-keyrm').click()); await sleep(300);
  ok(await p.evaluate(() => JSON.stringify(window.__lc.S.prefs.sbKeys)) === '{}', '× remove o atalho');
  // Atalhos → Adicionar atalho: escolheu o som, já espera a tecla
  await p.evaluate(() => window.__lc.openSettings('keys')); await sleep(600);
  await p.evaluate(() => { const s = [...document.querySelectorAll('#settings .sbk-sel')].at(-1); s.value = 's1'; s.dispatchEvent(new Event('change')); }); await sleep(150);
  ok(await p.evaluate(() => !!document.querySelector('#settings .capturing')), 'Atalhos: escolheu o som, o botão já espera a tecla (sem segundo clique)');
  await p.keyboard.down('Shift'); await p.keyboard.press('KeyQ'); await p.keyboard.up('Shift'); await sleep(400);
  ok(await p.evaluate(() => window.__lc.S.prefs.sbKeys?.s1) === 'Shift+KeyQ', 'Shift + Q toca a Buzina');
  // aviso de choque com atalho do app
  await p.evaluate(() => { const s = [...document.querySelectorAll('#settings .sbk-sel')].at(-1); s.value = 's2'; s.dispatchEvent(new Event('change')); }); await sleep(150);
  await p.keyboard.press('F8'); await sleep(400);
  ok(/também é o atalho "Salvar clipe"/.test(await toasts()), 'F8 no som: avisa que também salva clipe', await toasts());
  await p.screenshot({ path: '.testshots/sbkeys-atalhos.png' });
  // soundboard aberto: ⌨ no som abre o diálogo já esperando a tecla
  await p.evaluate(() => window.__lc.closeSettings?.() ?? document.querySelector('#settings .close')?.click()); await sleep(300);
  await p.evaluate(async () => { const m = await window.__lc.import('soundboard.js'); const fn = m.openSoundboard || m.soundboardPopup || m.showSoundboard; fn?.(document.body, window.__lc.voice); }); await sleep(500);
  const hasKeyBtn = await p.evaluate(() => !!document.querySelector('.sbov-key'));
  ok(hasKeyBtn, 'soundboard: botão de atalho em cada som (ao passar o mouse)');
  if (hasKeyBtn) {
    await p.evaluate(() => document.querySelector('.sbov-key').click()); await sleep(300);
    ok(await p.evaluate(() => !!document.querySelector('.modal .sbkey-cap.capturing')), 'o diálogo abre já esperando a tecla');
    await p.keyboard.press('F9'); await sleep(300);
    ok(/F9 toca este som/.test(await p.evaluate(() => document.querySelector('.modal .sbkey-info')?.textContent || '')), 'apertou: o diálogo confirma na hora');
    await p.screenshot({ path: '.testshots/sbkeys-dialogo.png' });
  }
  ok(!errors.length, 'sem erros na página', errors);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); await sleep(500); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
