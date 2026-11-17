// Capturas da evolução "A fim de jogar": as mesmas telas antes e depois (Ativo agora, Jogos → Procurar jogadores e
// Configurações → Notificações). PREFIX=before|after escolhe o nome dos arquivos em .testshots/intents/.
// Uso: BROWSER=/caminho/do/chrome PREFIX=before node scripts/intents-shots.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3291, BASE = `http://localhost:${PORT}`, DATA = './.testdata-intshots', OUT = '.testshots/intents', PREFIX = process.env.PREFIX || 'before';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, n }; };
const U = {}; for (const n of ['eu', 'ana', 'beto', 'carla']) U[n] = await reg(n);
for (const n of ['ana', 'beto', 'carla']) { await call(U.eu.tok, 'POST', '/relationships', { username: n }); await call(U[n].tok, 'PUT', '/relationships/' + U.eu.id, {}); }
const g = await call(U.eu.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(U.eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const n of ['ana', 'beto', 'carla']) await call(U[n].tok, 'POST', '/invites/' + code);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(u, game) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument((t, game) => { localStorage.lc_token = t; localStorage.lc_seen_changelog = '9999'; if (game) window.lcDesktop = { isDesktop: true, detectGame: async () => game, setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } }; }, u.tok, game);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
try {
  await page(U.ana, { id: 'valorant-win64-shipping', title: 'VALORANT' }); await sleep(3500);
  const me = await page(U.eu);
  await me.evaluate(() => window.__lc.go('@me')); await sleep(2500);
  await me.screenshot({ path: `${OUT}/${PREFIX}-1-ativo-agora.png` });
  await me.evaluate(() => window.__lc.go('@me', 'lfg')); await sleep(1500);
  await me.screenshot({ path: `${OUT}/${PREFIX}-2-lfg.png` });
  await me.evaluate(() => window.__lc.openSettings?.('notifications')); await sleep(1200);
  await me.screenshot({ path: `${OUT}/${PREFIX}-3-notificacoes.png` });
  console.log('capturas em', OUT);
} finally { await browser.close(); srv.kill(); }
