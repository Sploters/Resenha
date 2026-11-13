// Push-to-talk: tecla e botão do mouse na página, e o PTT global do app desktop (ponte lcDesktop simulada).
// Sobe o próprio servidor. Uso: BROWSER=/caminho/do/chrome node scripts/ptt-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3237, BASE = `http://localhost:${PORT}`, DATA = './.testdata-ptt';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  // app desktop simulado: guarda as chamadas de pttSet e deixa o teste disparar o evento do programa nativo
  await page.evaluateOnNewDocument(() => {
    let cb = null; window.__pttCalls = []; window.__focus = true;
    document.hasFocus = () => window.__focus;
    window.lcDesktop = {
      isDesktop: true, pttSet: async (code) => { window.__pttCalls.push(code); return { ok: true, global: true }; },
      onPtt: (f) => { cb = f; }, onHotkey() { }, setSettings: async () => ({}), getSettings: async () => ({}), setBadge() { }, setThrottle() { },
      nativeCapable: async () => ({ ok: false }), detectGame: async () => null,
    };
    window.__firePtt = (d) => cb?.(d);
  });
  await page.goto(BASE); await page.waitForSelector('#auth .auth-card');
  await page.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click());
  await sleep(200);
  const ins = await page.$$('#auth input');
  await ins[0].type('ana'); await ins[2].type('Teste.senha-123'); await ins[3].type('Teste.senha-123');
  await page.click('#auth .btn'); await page.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
  const tok = await page.evaluate(() => localStorage.lc_token);
  const g = await fetch(BASE + '/api/guilds', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ name: 'PTT' }) }).then(r => r.json());
  await sleep(600);
  const ch = await page.evaluate((gid) => window.__lc.S.guilds.get(gid).channels, g.id);
  const text = ch.find(c => c.type === 0), vch = ch.find(c => c.type === 2);

  await page.evaluate(() => { window.__lc.S.prefs.inputMode = 'ptt'; window.__lc.S.prefs.pttKey = 'KeyV'; });
  await page.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  await sleep(600);
  await page.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent)).click());
  await sleep(2500);
  const mic = () => page.evaluate(() => window.__lc.voice.micEnabled());
  const calls = () => page.evaluate(() => window.__pttCalls.slice());
  ok(await page.evaluate(() => window.__lc.voice.active), 'entrou na voz');
  ok((await calls()).at(-1) === 'KeyV', 'ao entrar em modo PTT a página liga o PTT global com a tecla (' + JSON.stringify(await calls()) + ')');
  ok(!(await mic()), 'microfone fechado sem apertar');

  // fora de foco (jogo na frente): o evento do programa nativo abre e fecha o microfone
  await page.evaluate(() => { window.__focus = false; });
  await page.evaluate(() => window.__firePtt(true)); await sleep(50);
  ok(await mic(), 'PTT global (fora de foco): apertou → microfone aberto');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(50);
  ok(await mic(), 'perder o foco com a tecla apertada não fecha (o app avisa a soltura)');
  await page.evaluate(() => window.__firePtt(false)); await sleep(50);
  ok(!(await mic()), 'PTT global: soltou → microfone fechado');

  // em foco: a página cuida da tecla; o aviso do programa para "apertou" é ignorado (não abre ao digitar no chat)
  await page.evaluate(() => { window.__focus = true; });
  await page.evaluate(() => window.__firePtt(true)); await sleep(50);
  ok(!(await mic()), 'em foco, o "apertou" do programa nativo é ignorado');
  await page.evaluate(() => window.__firePtt(false));
  ok(await page.evaluate(() => !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)), 'a sala de voz não abre com o chat em foco');
  await page.keyboard.down('v'); await sleep(50);
  ok(await mic(), 'tecla V na página abre o microfone');
  await page.keyboard.up('v'); await sleep(50);
  ok(!(await mic()), 'soltar V fecha');

  // digitando no chat da sala/canal: V não abre
  await page.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text.id); await sleep(500);
  await page.focus('#composer textarea');
  await page.keyboard.down('v'); await sleep(50);
  ok(!(await mic()), 'digitando "v" no chat não abre o microfone');
  await page.keyboard.up('v');
  await page.evaluate(() => { document.querySelector('#composer textarea').value = ''; document.activeElement.blur(); });

  // botão lateral do mouse (Mouse4): na página e pelo programa nativo, e o app recebe o novo código
  await page.evaluate(async () => { window.__lc.S.prefs.pttKey = 'Mouse4'; (await window.__lc.import('ptt.js')).syncGlobalPtt(); });
  await sleep(50);
  ok((await calls()).at(-1) === 'Mouse4', 'trocar a tecla avisa o app (Mouse4)');
  const hashBefore = await page.evaluate(() => location.hash);
  await page.evaluate(() => document.querySelector('#app').dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true }))); await sleep(50);
  ok(await mic(), 'Mouse4 na página abre o microfone');
  await page.evaluate(() => document.querySelector('#app').dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true }))); await sleep(50);
  ok(!(await mic()), 'soltar Mouse4 fecha');
  ok(await page.evaluate(() => location.hash) === hashBefore, 'botão lateral não navegou');
  await page.evaluate(() => window.__firePtt(true)); await sleep(50);
  ok(await mic(), 'botão do mouse pelo programa nativo vale mesmo em foco');
  await page.evaluate(() => window.__firePtt(false)); await sleep(50);

  // captura do atalho nas configurações aceita botão do mouse
  await page.evaluate(() => window.__lc.openSettings('keys')); await sleep(500);
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Mouse 4|Botão do meio|Mouse 5/.test(b.textContent)));
  ok(!!(await btn.asElement()), 'Atalhos mostra o PTT como "Mouse 4 (lateral)"');
  await btn.asElement()?.click(); await sleep(100);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { button: 4, bubbles: true }))); await sleep(100);
  ok(await page.evaluate(() => window.__lc.S.prefs.pttKey) === 'Mouse5', 'capturou Mouse5 nas configurações');
  ok((await calls()).at(-1) === 'Mouse5', 'app desktop recebeu Mouse5');
  await page.keyboard.press('Escape'); await sleep(300);

  // voltar para detecção de voz e sair da chamada desligam o PTT global
  await page.evaluate(() => window.__lc.voice.leave()); await sleep(200);
  ok((await calls()).at(-1) === null, 'sair da chamada desliga o PTT global');
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
