// Servidor grande funcionando certo (banco do scripts/load/seed-big.mjs): READY só com quem está online (o resto chega ao
// abrir o servidor), apelido e cor de cargo de quem estava fora do READY, lista de membros virtual (só as linhas perto da tela ficam montadas) e
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
// lista de membros virtual: só as linhas perto da tela ficam montadas, em qualquer ponto da rolagem
await p.evaluate(() => [...document.querySelectorAll('#members .mgroup.col')].forEach(b => b.click())); await sleep(500);
const mlist = () => p.evaluate(() => { const l = document.querySelector('#members .mem-list'), r = [...l.querySelectorAll(':scope > .mem')], top = l.getBoundingClientRect();
  const vis = r.filter(e => { const b = e.getBoundingClientRect(); return b.bottom > top.top && b.top < top.bottom; });
  return { linhas: r.length, h: l.scrollHeight, first: vis[0]?.textContent.slice(0, 30), last: r.at(-1)?.textContent.slice(0, 30), vis: vis.length }; });
const before = await mlist();
ok(before.linhas < 120 && before.vis > 5 && before.h > 5000 * 40, 'com tudo aberto, poucas linhas montadas e a rolagem do tamanho da lista inteira', before);
const steps = [];
for (let i = 1; i <= 6; i++) { await p.evaluate((i) => { const l = document.querySelector('#members .mem-list'); l.scrollTop = (l.scrollHeight - l.clientHeight) * i / 6; }, i); await sleep(200); steps.push(await mlist()); }
ok(steps.every(s => s.linhas < 120 && s.vis > 5), 'rolando até o fim, a janela acompanha (sempre há linhas na tela, nunca muitas montadas)', steps.map(s => [s.linhas, s.vis]));
ok(new Set(steps.map(s => s.first)).size === steps.length, 'cada ponto da rolagem mostra pessoas diferentes', steps.map(s => s.first));
const total = await p.evaluate(() => [...window.__lc.S.guilds.values()].find(g => g.members.size > 1000).members.size);
const gap = await p.evaluate(() => { const l = document.querySelector('#members .mem-list'), last = [...l.querySelectorAll(':scope > .mem')].at(-1); return Math.round(l.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom); });
ok(gap >= 0 && gap < 60, 'no fim da rolagem a última pessoa encosta no fim da lista (alturas certas)', { gap, total });
// seu cartão: rola até você (que pode não estar montado) e pisca a linha
await p.evaluate(() => { document.querySelector('#members .mem-list').scrollTop = 0; }); await sleep(200);
await p.evaluate(() => document.querySelector('#members .mem-mecard')?.click()); await sleep(400);
ok(await p.evaluate(() => { const el = document.querySelector('#members .mem.me'), l = document.querySelector('#members .mem-list'); if (!el) return false; const b = el.getBoundingClientRect(), t = l.getBoundingClientRect(); return b.top >= t.top && b.bottom <= t.bottom; }), '"Mostrar você na lista" rola até a sua linha');
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
