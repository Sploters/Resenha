// Tela que saiu não pode ficar presa na memória. Heap de uma sessão real (2026-11-11) mostrou: o cache de linhas da lista
// de membros segurava o #members antigo — e, por ele, o chat antigo inteiro —; o Descobrir segurava a própria tela depois
// de sair. Aqui: abre o chat com a lista de membros e o Descobrir, troca de tela, força a coleta de lixo e confere (WeakRef)
// que as telas antigas foram soltas. Uso: node scripts/screen-release-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const BASE = await ownServer('release', 3325, 41160);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await call('', 'POST', '/register', { username: 'ana', password: 'senha123' }), b = await call('', 'POST', '/register', { username: 'beto', password: 'senha123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await call(a.token, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.token, 'POST', '/invites/' + inv);
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const cdp = await p.createCDPSession(); await cdp.send('HeapProfiler.enable');
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 });
  const ch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 0), g.id);
  for (let i = 0; i < 30; i++) await call([a, b][i % 2].token, 'POST', `/channels/${ch.id}/messages`, { content: 'mensagem ' + i });
  const gc = async () => { for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(100); } };
  // 1) chat com a lista de membros -> Descobrir
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id);
  await p.waitForFunction(() => document.querySelectorAll('#msgs .msg').length > 10 && !!document.querySelector('#members .mem'), { timeout: 15000 });
  await p.evaluate(() => { window.__old = { members: new WeakRef(document.querySelector('#members')), chat: new WeakRef(document.querySelector('#msgs')) }; });
  await p.evaluate(() => window.__lc.go('@me', 'discover')); await p.waitForFunction(() => !!document.querySelector('#discoverview'), { timeout: 15000 }); await sleep(1500);
  await gc();
  const r1 = await p.evaluate(() => ({ members: !!window.__old.members.deref(), chat: !!window.__old.chat.deref() }));
  if (process.env.SNAP) { const fs = await import('node:fs'); const out = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => out.push(e.chunk)); await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); fs.writeFileSync(process.env.SNAP, out.join('')); }
  ok(!r1.members && !r1.chat, 'saiu do chat: a lista de membros e o chat antigos são soltos', r1);
  // 2) Descobrir -> chat
  await p.evaluate(() => { window.__old.disc = new WeakRef(document.querySelector('#discoverview')); });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id); await p.waitForFunction(() => !!document.querySelector('#msgs .msg'), { timeout: 15000 }); await sleep(800);
  await gc();
  ok(!(await p.evaluate(() => !!window.__old.disc.deref())), 'saiu do Descobrir: a tela antiga é solta');
  // 3) voltar ao Descobrir continua funcionando (dados guardados)
  await p.evaluate(() => window.__lc.go('@me', 'discover')); await p.waitForFunction(() => !!document.querySelector('#discoverview .dhsec'), { timeout: 15000 });
  ok(await p.evaluate(() => document.querySelectorAll('#discoverview .dhsec').length >= 5), 'voltar ao Descobrir mostra as seções de novo');
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id); await p.waitForFunction(() => !!document.querySelector('#members .mem'), { timeout: 15000 });
  ok(await p.evaluate(() => document.querySelectorAll('#members .mem').length) >= 2, 'lista de membros volta com as pessoas');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
