// Novidades: não abrem sozinhas (nem para quem já usava, nem para conta nova); ficam em Configurações -> Novidades e no
// menu do perfil, e "Experimentar" leva ao recurso.
// Uso: node scripts/news-test.mjs  (SHOTS=1 salva capturas em .testshots/news)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3269), BASE = `http://localhost:${PORT}`, OUT = '.testshots/news';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(process.env.DATA_DIR || '.testdata23', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: process.env.DATA_DIR || './.testdata23', RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
const newsOpen = (p) => p.waitForFunction(() => /Novidades/.test(document.querySelector('.modal .mh h2')?.textContent || ''), { timeout: 5000 }).then(() => true, () => false);
try {
  // quem já usava (tem preferências na conta, sem ter visto as novidades)
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  await call(a.token, 'PUT', '/me/settings', { settings: { theme: 'dark', noiseMode: 'standard' } });
  const A = await page(a.token);
  ok(!(await newsOpen(A)), 'as Novidades não abrem sozinhas, nem para quem já usava');
  // conta nova: sem a janela
  const b = await call('', 'POST', '/register', { username: 'bruno', password: 'Teste.senha-123' });
  const B = await page(b.token);
  ok(!(await newsOpen(B)), 'conta nova não recebe a lista do que mudou');
  // Configurações -> Novidades e menu do perfil
  await B.evaluate(() => window.__lc.openSettings('news')); await sleep(400);
  ok(await B.evaluate(() => document.querySelectorAll('#settings .newsitem').length) >= 8 && await B.evaluate(() => [...document.querySelectorAll('#settings .ni')].some(n => n.textContent === 'Novidades')), 'Configurações → Novidades mostra o histórico');
  if (process.env.SHOTS) await B.screenshot({ path: `${OUT}/02-configuracoes.png` });
  await B.keyboard.press('Escape'); await sleep(300);
  await B.evaluate(() => document.querySelector('#userbar .me')?.click()); await sleep(400);
  const hasItem = await B.evaluate(() => [...document.querySelectorAll('.meitem')].some(i => /Novidades/.test(i.textContent)));
  ok(hasItem, 'menu do perfil tem "Novidades"');
  if (hasItem) { await B.evaluate(() => [...document.querySelectorAll('.meitem')].find(i => /Novidades/.test(i.textContent)).click()); ok(await newsOpen(B), 'e abre a janela'); }
  // jogo do PC: quem tinha escolhido algo mais restrito antes de a opção sair (migração pc-always-on-1) recebe uma
  // mensagem uma vez; quem não tinha, nada
  const { DatabaseSync } = await import('node:sqlite');
  const dbx = new DatabaseSync((process.env.DATA_DIR || './.testdata23') + '/resenha.db');
  dbx.prepare("UPDATE users SET pc_notice_at=? WHERE username='alice'").run(Date.now()); dbx.close();
  const pcMsg = (p) => p.waitForFunction(() => /jogo do PC agora aparece/.test(document.querySelector('.modal .mh h2')?.textContent || ''), { timeout: 5000 }).then(() => true, () => false);
  const A3 = await page(a.token);
  ok(await pcMsg(A3), 'quem tinha escondido o jogo do PC recebe a mensagem ao abrir');
  await sleep(1500);
  const A4 = await page(a.token);
  ok(!(await pcMsg(A4)), 'a mensagem aparece uma vez só (nem em outro aparelho)');
  ok(!(await pcMsg(await page(b.token))), 'quem não tinha escondido não recebe nada');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
