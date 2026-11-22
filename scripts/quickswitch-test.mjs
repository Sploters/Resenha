// Busca rápida (Ctrl+K) com setas, filtros (# ! @ *), sem acento e não lidas primeiro; início do canal com e sem mensagens;
// campo de mensagem: contador perto do limite e texto colado maior que 4000 caracteres vira anexo mensagem.txt
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3487), BASE = `http://localhost:${PORT}`, DATA = process.env.DATA_DIR || './.testdata-qs';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: process.env.RTC_PORT || '43487' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const tA = (await api(null, 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' })).token;
  const tB = (await api(null, 'POST', '/register', { username: 'bob', password: 'Teste.senha-123' })).token;
  const g = await api(tA, 'POST', '/guilds', { name: 'Servidor Teste' });
  await api(tB, 'POST', '/invites/' + (await api(tA, 'POST', `/guilds/${g.id}/invites`)).code);
  const memes = await api(tA, 'POST', `/guilds/${g.id}/channels`, { name: 'memes', type: 0 });
  await api(tA, 'POST', `/guilds/${g.id}/channels`, { name: 'clipes-da-galera', type: 0 });
  await api(tA, 'POST', `/guilds/${g.id}/channels`, { name: 'Jogatina', type: 2 });
  const avisos = await api(tA, 'POST', `/guilds/${g.id}/channels`, { name: 'avisos', type: 0 });
  await api(tA, 'POST', '/guilds', { name: 'Família' });
  const ctx = browser.defaultBrowserContext(); await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await page.goto(BASE); await page.evaluate(t => localStorage.lc_token = t, tA); await page.goto(BASE);
  await page.waitForSelector('#rail .rail-wrap'); await sleep(800);
  await page.evaluate((g, c) => window.__lc.go(g, c), g.id, avisos.id); await sleep(800);
  ok(/Manda aí/.test(await page.$eval('#msgs .welcome p', e => e.textContent)), 'canal vazio: "Primeira mensagem do canal. Manda aí."');
  await page.type('#composer textarea', 'oi'); await page.keyboard.press('Enter'); await sleep(700);
  ok(await page.$eval('#msgs .welcome p', e => e.textContent) === 'Este é o começo do canal #avisos.', 'depois da 1ª mensagem: "Este é o começo do canal #avisos."');
  await api(tB, 'POST', `/channels/${memes.id}/messages`, { content: 'kkkk' }); await sleep(600);

  const ctrlK = async () => { await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(300); };
  const rows = () => page.$$eval('.qs-it', els => els.map(e => ({ name: e.querySelector('.qs-name').textContent, sel: e.classList.contains('sel'), unread: !!e.querySelector('.qs-dot, .pill') })));
  await ctrlK();
  let r = await rows();
  ok(r[0]?.unread && r[0].sel && r.slice(0, 2).some(x => x.name === 'memes' && x.unread), 'sem texto: canais com não lida primeiro, o 1º já escolhido ' + JSON.stringify(r.slice(0, 2)));
  ok(!r.some(x => x.name === 'avisos'), 'canal aberto agora fica de fora da lista sem texto');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  r = await rows(); ok(r.findIndex(x => x.sel) === 1, 'setas mudam a escolha');
  await page.keyboard.type('!'); await sleep(150); r = await rows();
  ok(r.length && r.every(x => ['Geral', 'Jogatina'].includes(x.name)), '"!" mostra só salas de voz: ' + r.map(x => x.name).join(', '));
  await page.$eval('.qs-in', i => { i.value = ''; }); await page.keyboard.type('*familia'); await sleep(150); r = await rows();
  ok(r.length === 1 && r[0].name === 'Família', '"*familia" acha o servidor Família (sem acento)');
  await page.$eval('.qs-in', i => { i.value = ''; }); await page.keyboard.type('cdg'); await sleep(150); r = await rows();
  ok(r[0]?.name === 'clipes-da-galera', '"cdg" acha clipes-da-galera pelas letras na ordem');
  await page.keyboard.press('Enter'); await sleep(800);
  ok(await page.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.id === window.__lc.S.view.cid)?.name, g.id) === 'clipes-da-galera' && !(await page.$('.qs-bd:not(.leaving)')), 'Enter abre o escolhido e fecha a busca');
  await ctrlK(); await page.keyboard.type('nada-disso'); await sleep(150);
  ok(/Nada encontrado/.test(await page.$eval('.qs-list', e => e.textContent)), 'sem resultado: avisa');
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await page.$('.qs-bd:not(.leaving)')), 'Esc fecha');

  await page.evaluate(() => { const ta = document.querySelector('#composer textarea'); ta.focus(); ta.value = 'a'.repeat(3700); ta.dispatchEvent(new Event('input')); });
  ok(await page.$eval('.msg-count', e => !e.classList.contains('hidden') && e.textContent === '300'), 'contador mostra quanto falta perto do limite (300)');
  await page.evaluate(async () => { const ta = document.querySelector('#composer textarea'); ta.value = ''; ta.dispatchEvent(new Event('input')); ta.focus(); await navigator.clipboard.writeText('linha de log '.repeat(600)); });
  await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control'); await sleep(1500);
  const pasted = await page.evaluate(() => ({ len: document.querySelector('#composer textarea').value.length, att: document.querySelector('#attach-prev')?.innerText || '' }));
  ok(pasted.len === 0 && /mensagem\.txt/.test(pasted.att), 'colar 7800 caracteres: vai como mensagem.txt em vez de cortar calado ' + JSON.stringify(pasted));
  await page.evaluate(async () => { await navigator.clipboard.writeText('curto'); });
  await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control'); await sleep(200);
  ok(await page.$eval('#composer textarea', e => e.value) === 'curto', 'texto curto colado entra normal');
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
