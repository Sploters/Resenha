// Servidor grande funcionando certo (banco do scripts/load/seed-big.mjs): READY só com quem está online (o resto chega ao
// abrir o servidor), apelido e cor de cargo de quem estava fora do READY, lista de membros aos pedaços (rolar traz mais) e
// categorias da lateral montadas quando chegam perto da tela.
// Uso: DATA_DIR=./.testdata-big node scripts/load/seed-big.mjs && node scripts/big-data-test.mjs
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs'; import WebSocket from 'ws';
const PORT = 3316, BASE = `http://localhost:${PORT}`, D = process.env.DATA_DIR || './.testdata-big', sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const meta = JSON.parse(fs.readFileSync(D + '/big.json', 'utf8'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const conns = []; for (let i = 1; i <= 30; i++) conns.push(new WebSocket(`ws://localhost:${PORT}/gateway?token=big-${i * 100}`));
await sleep(1500);
const ready = (tok) => new Promise((res) => { const ws = new WebSocket(`ws://localhost:${PORT}/gateway?token=${tok}`); ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') { ws.close(); res(m.d); } }); });
const R = await ready('big-7'), G = R.guilds.find(g => g.id === meta.guild);
ok(G.partial === true && G.member_count === meta.n && G.members.length <= 33 && G.members.some(m => m.user_id === meta.users[7]), 'READY do servidor grande: só quem está online, a própria pessoa e o dono', { partial: G.partial, membros: G.members.length, total: G.member_count });
{ const R0 = await ready('big-0'); ok(R0.guilds.filter(g => g.id !== meta.guild).length === 3 && R0.guilds.filter(g => g.id !== meta.guild).every(g => !g.partial && g.members.length === 200), 'servidores pequenos continuam completos no READY'); }
const r = await fetch(BASE + `/api/guilds/${meta.guild}/members`, { headers: { authorization: 'Bearer big-7', 'accept-encoding': 'gzip' } });
const full = await r.json();
ok(full.members.length === meta.n && full.users.length === meta.n && r.headers.get('content-encoding') === 'gzip', 'lista inteira sob demanda, comprimida', { membros: full.members.length, perfis: full.users.length, enc: r.headers.get('content-encoding') });
ok((await fetch(BASE + `/api/guilds/${meta.guild}/members`, { headers: { authorization: 'Bearer nada' } })).status === 401, 'sem login não lê a lista');

const br = await puppeteer.launch({ executablePath: process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox'] });
const p = await br.newPage(); await p.setViewport({ width: 1440, height: 900 });
p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
await p.evaluateOnNewDocument(() => { localStorage.lc_token = 'big-7'; localStorage.lc_last = '{}'; });
await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.guilds?.size >= 1, { timeout: 120000 });
ok(await p.evaluate((g) => window.__lc.S.guilds.get(g).partial === true, meta.guild), 'no app, o servidor grande começa parcial');
// apelido de alguém fora do READY: a mensagem dele (canal movimentado) mostra o apelido depois que a lista chega
await p.evaluate((g, c) => window.__lc.go(g, c), meta.guild, meta.busy[0]);
await p.waitForFunction((g) => window.__lc.S.guilds.get(g).partial === false && document.querySelector('#members .mem'), { timeout: 30000 }, meta.guild);
const st = await p.evaluate((g) => ({ n: window.__lc.S.guilds.get(g).members.size, users: window.__lc.S.users.size }), meta.guild);
ok(st.n === meta.n, 'ao abrir, a lista inteira chega', st);
const nick = await p.evaluate(() => [...document.querySelectorAll('#msgs .msg .author')].map(e => e.textContent).filter(t => t.startsWith('Apelido')).length);
ok(nick > 0, 'mensagens de quem não estava no READY mostram o apelido do servidor', { com_apelido: nick });
// lista de membros aos pedaços
await p.evaluate(() => [...document.querySelectorAll('#members .mgroup.col')].forEach(b => b.click())); await sleep(500);
const before = await p.evaluate(() => document.querySelectorAll('#members .mem').length);
ok(before < 1200 && (await p.evaluate(() => !!document.querySelector('#members .mem-more'))), 'grupos grandes começam com 200 linhas e um "Mostrar mais"', { linhas: before });
for (let i = 0; i < 12; i++) { await p.evaluate(() => { const m = document.querySelector('#members .mem-list') || document.querySelector('#members'); for (const el of [m, document.querySelector('#members')]) if (el) el.scrollTop = el.scrollHeight; }); await sleep(250); }
const after = await p.evaluate(() => document.querySelectorAll('#members .mem').length);
ok(after > before + 250, 'rolando até o fim, mais membros entram', { antes: before, depois: after });
await p.evaluate(() => { const q = document.querySelector('#members .mem-q'); q.value = 'Pessoa Grande 4999'; q.dispatchEvent(new Event('input')); }); await sleep(500);
ok(await p.evaluate(() => [...document.querySelectorAll('#members .mem')].some(e => e.textContent.includes('Pessoa Grande 4999'))), 'buscar acha quem está além do pedaço montado');
await p.evaluate(() => { const q = document.querySelector('#members .mem-q'); q.value = ''; q.dispatchEvent(new Event('input')); }); await sleep(300);
// lateral: categorias de baixo montadas só perto da tela
const lazy = await p.evaluate(() => ({ lazy: document.querySelectorAll('#side-list .cat-lazy').length, ch: document.querySelectorAll('#side-list .ch').length }));
ok(lazy.lazy > 20 && lazy.ch < 400, 'lateral: só as categorias perto da tela estão montadas', lazy);
const last = 'canal-49-18';
for (let i = 0; i < 30 && !(await p.evaluate((n) => [...document.querySelectorAll('#side-list .ch .name')].some(e => e.textContent.includes(n)), last)); i++) { await p.evaluate(() => { const l = document.querySelector('#side-list'); l.scrollTop += 1500; }); await sleep(150); }
ok(await p.evaluate((n) => [...document.querySelectorAll('#side-list .ch .name')].some(e => e.textContent.includes(n)), last), 'rolando a lateral, a última categoria aparece', last);
// canal lá de baixo aberto por link: a categoria dele já vem montada
const deep = await p.evaluate((g) => window.__lc.S.guilds.get(g).channels.find(c => c.name === 'canal-45-3')?.id, meta.guild);
await p.evaluate((g) => window.__lc.go('@me'), meta.guild); await sleep(400);
await p.evaluate((g, c) => window.__lc.go(g, c), meta.guild, deep); await sleep(800);
ok(await p.evaluate(() => !!document.querySelector('#side-list .ch.active')), 'canal aberto numa categoria lá de baixo aparece marcado na lateral');
await br.close(); for (const c of conns) c.terminate(); srv.kill();
console.log(fails ? fails + ' falha(s)' : 'tudo certo'); process.exit(fails ? 1 : 0);
