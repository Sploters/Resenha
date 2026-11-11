// Resposta antiga chegando depois e sobrescrevendo a tela (trocar rápido de canal/servidor/aba). As respostas do servidor
// são atrasadas de propósito no navegador para forçar a ordem ruim.
// - A → B → A com o histórico de A demorando: um pedido só, e a mensagem que chegou pelo gateway no meio não some
//   (já funcionava: o api() junta pedidos iguais em andamento; fica como proteção)
// - pular para uma mensagem (jumpTo) e trocar de canal antes da resposta: o canal novo não recebe as mensagens do antigo
// - fixadas: trocar de canal com o pedido no meio não abre o popup do canal antigo
// - galeria de clipes: trocar de aba com "Todos" carregando mostra a aba nova
// Uso: node scripts/stale-response-test.mjs (BROWSER=<caminho do Chrome>)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3296, BASE = `http://localhost:${PORT}`, DATA = './.testdata-stale';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'senha123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await api(b.tok, 'POST', '/invites/' + inv);
  const c2 = await api(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'outro', type: 0 });
  const c3 = await api(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'terceiro', type: 0 });
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.tok);
  // atraso por padrão de endereço (definido pelo teste a cada passo)
  const delays = []; const seen = [];
  await p.setRequestInterception(true);
  p.on('request', async (r) => { const u = r.url(); seen.push(u); const d = delays.find(([re]) => re.test(u)); if (d) await sleep(d[1]); r.continue().catch(() => { }); });
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  const general = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0 && x.name === 'geral').id, g.id);
  // 60 mensagens no #geral (para o pulo precisar buscar no servidor) e 3 no #terceiro
  // (o servidor limita 5 mensagens seguidas por pessoa: várias pessoas escrevem)
  let firstId = null; const writers = [b];
  for (let i = 0; i < 12; i++) { const u = await reg('p' + i); await api(u.tok, 'POST', '/invites/' + inv); writers.push(u); }
  for (let i = 0; i < 60; i++) { const m = await api(writers[Math.floor(i / 5)].tok, 'POST', `/channels/${general}/messages`, { content: 'geral ' + i }); firstId ||= m.id; }
  for (let i = 0; i < 3; i++) await api(writers[12].tok, 'POST', `/channels/${c3.id}/messages`, { content: 'terceiro ' + i });

  // 1) A → B → A com o histórico de A lento; mensagem nova chega no meio
  delays.push([new RegExp(`/channels/${c3.id}/messages\\?limit=50`), 1500]); seen.length = 0;
  await p.evaluate((gid, x) => window.__lc.go(gid, x), g.id, c3.id); await sleep(150);
  await p.evaluate((gid, x) => window.__lc.go(gid, x), g.id, c2.id); await sleep(150);
  await p.evaluate((gid, x) => window.__lc.go(gid, x), g.id, c3.id); await sleep(1700);
  await api(writers[12].tok, 'POST', `/channels/${c3.id}/messages`, { content: 'chegou no meio' }); await sleep(400);
  delays.length = 0; await sleep(1500);
  const reqs = seen.filter(u => u.includes(`/channels/${c3.id}/messages?limit=50`)).length;
  const r1 = await p.evaluate((cid) => ({ list: window.__lc.S.messages.get(cid)?.map(m => m.content), dom: [...document.querySelectorAll('#msgs .msg')].map(e => e.textContent).join('|') }), c3.id);
  ok(reqs === 1, 'A → B → A: um pedido só do histórico de A', reqs);
  ok(r1.list?.includes('chegou no meio') && r1.list.length === 4, 'a mensagem que chegou no meio continua na lista', r1.list);
  ok(r1.dom.includes('chegou no meio') && r1.dom.includes('terceiro 0'), 'e aparece na tela');

  // 2) pular para uma mensagem antiga e trocar de canal antes da resposta
  await p.evaluate((gid, x) => window.__lc.go(gid, x), g.id, general); await sleep(800);
  delays.push([/messages\?around=/, 1200]);
  p.evaluate((mid) => window.__lc.jumpTo(mid), firstId);
  await sleep(150); await p.evaluate((gid, x) => window.__lc.go(gid, x), g.id, c3.id); await sleep(1600); delays.length = 0;
  const r2 = await p.evaluate((cid) => window.__lc.S.messages.get(cid)?.map(m => m.content), c3.id);
  ok(r2 && r2.every(t => !t.startsWith('geral')), 'pulo pendente: o canal novo não recebe as mensagens do antigo', r2?.slice(0, 3));
  const dom2 = await p.evaluate(() => document.querySelector('#msgs')?.textContent || '');
  ok(!dom2.includes('geral 0') && dom2.includes('terceiro 0'), 'e a tela continua mostrando o canal novo');

  // 3) fixadas: pedido lento e troca de canal
  delays.push([/\/pins$/, 1200]);
  await p.click('.pins-btn'); await sleep(150);
  await p.evaluate((gid, x) => window.__lc.go(gid, x), g.id, c2.id); await sleep(1500); delays.length = 0;
  ok(!(await p.$('.pinspop')), 'fixadas do canal antigo não abrem depois de trocar de canal');

  // 4) galeria de clipes: "Todos" demorando, clica em "Meus"
  delays.push([/\/clips\?filter=all/, 1500]);
  await p.evaluate((gid) => window.__lc.go(gid, 'clips'), g.id); await sleep(200);
  seen.length = 0;
  await p.evaluate(() => [...document.querySelectorAll('.ctab')].find(b => b.textContent === 'Meus')?.click()); await sleep(2000); delays.length = 0;
  const mine = seen.some(u => /\/clips\?filter=mine/.test(u));
  ok(mine, 'trocar de aba com "Todos" carregando pede a aba nova', seen.filter(u => u.includes('/clips?')));
  ok(await p.evaluate(() => document.querySelector('.ctab.on')?.textContent === 'Meus'), 'e a aba "Meus" continua marcada');
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); await sleep(300);
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
