// Pastas de servidores: criar pela barra (clique direito → Mover para pasta → Nova pasta), pasta dentro de pasta, o
// quadrado na barra, o painel à direita (grade, caminho, busca), mover e desfazer. Uso: BROWSER=... node scripts/gfolders-ui-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3421, BASE = `http://localhost:${PORT}`, DATA = '.testdata-gfolders';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const r = await (await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'pastas', password: 'Teste.senha-12345' }) })).json();
const api = (m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: r.token }, body: b && JSON.stringify(b) }).then(x => x.json());
const names = ['Valorant BR', 'CS da Firma', 'Minecraft SMP', 'Lolzinho', 'Estudos', 'Trampo'];
const gs = []; for (const n of names) gs.push(await api('POST', '/guilds', { name: n }));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.evaluate((t) => localStorage.setItem('lc_token', t), r.token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(800);
  const railIds = () => p.evaluate(() => [...document.querySelectorAll('#rail .rail-wrap.railg')].map(w => w.dataset.id));
  ok((await railIds()).length === 6, 'seis servidores soltos na barra', await railIds());
  // clique direito no Valorant → Mover para pasta → Nova pasta… "Jogos"
  const rclick = async (sel) => { const b = await (await p.$(sel)).boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await sleep(250); };
  const pick = async (re) => { const ok2 = await p.evaluate((s) => { const it = [...document.querySelectorAll('.menu .it')].reverse().find(x => new RegExp(s).test(x.textContent)); if (!it) return false; it.dispatchEvent(new MouseEvent('mouseenter')); it.click(); return true; }, re.source); await sleep(250); return ok2; };
  const prompt = async (v) => { await p.waitForSelector('.modal input', { timeout: 3000 }); await p.$eval('.modal input', (i, v) => { i.value = v; }, v); await p.evaluate(() => [...document.querySelectorAll('.modal .mf .btn')].at(-1).click()); await sleep(400); };
  await rclick(`#rail [data-gid="${gs[0].id}"]`);
  ok(await pick(/Mover para pasta/) && await pick(/Nova pasta/), 'clique direito no servidor: "Mover para pasta" → "Nova pasta…"');
  await prompt('Jogos');
  let ids = await railIds();
  ok(ids.length === 6 && ids[0].startsWith('f:') && !ids.includes(gs[0].id), 'pasta "Jogos" entra na barra no lugar do servidor', ids);
  const fid = ids[0];
  // mais três servidores para dentro de Jogos
  for (const g of gs.slice(1, 4)) { await rclick(`#rail [data-gid="${g.id}"]`); await pick(/Mover para pasta/); await pick(/^Jogos$/); }
  ids = await railIds();
  ok(ids.length === 3 && ids[0] === fid, 'quatro servidores dentro de Jogos: na barra sobram a pasta e dois servidores', ids);
  ok(await p.evaluate(() => document.querySelectorAll('#rail .railfolder .gf-mini').length) === 4, 'o quadrado da pasta mostra 4 miniaturas');
  // abre o painel à direita
  await p.click('#rail .railfolder .gf-item'); await sleep(300);
  const pan = () => p.evaluate(() => { const el = document.querySelector('.gf-panel'); if (!el) return null; const r = el.getBoundingClientRect(), rail = document.querySelector('#rail').getBoundingClientRect(); return { right: r.left >= rail.right, w: Math.round(r.width), h: Math.round(r.height), title: el.querySelector('.gf-crumbs').innerText.replace(/\s+/g, ' '), tiles: [...el.querySelectorAll('.gf-tile:not(.add) .gf-n')].map(x => x.textContent) }; });
  let s = await pan();
  ok(s && s.right && s.tiles.length === 4, 'clicar na pasta abre o painel à direita da barra com a grade de servidores', s);
  // subpasta "FPS" com Valorant e CS (clique direito no servidor dentro do painel)
  await p.click('.gf-tile.add'); await prompt('FPS'); await sleep(200);
  s = await pan(); ok(s.tiles[0] === 'FPS', 'nova subpasta "FPS" aparece primeiro na grade', s.tiles);
  for (const n of ['Valorant BR', 'CS da Firma']) {
    const h = await p.evaluateHandle((n) => [...document.querySelectorAll('.gf-panel .gf-tile')].find(t => t.querySelector('.gf-n')?.textContent === n), n);
    const b = await h.asElement().boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await sleep(250);
    await pick(/Mover para pasta/); await pick(/Jogos › FPS/);
  }
  s = await pan(); ok(JSON.stringify(s.tiles) === '["FPS","Minecraft SMP","Lolzinho"]', 'Valorant e CS foram para Jogos › FPS', s.tiles);
  await p.evaluate(() => [...document.querySelectorAll('.gf-panel .gf-tile.sub')][0].click()); await sleep(250);
  s = await pan(); ok(s.title === 'Jogos FPS' && s.tiles.length === 2, 'abrir a subpasta: caminho "Jogos › FPS" e os dois servidores', s);
  await p.screenshot({ path: '.testshots/gfolders-sub.png' });
  await p.evaluate(() => document.querySelector('.gf-crumb').click()); await sleep(250);
  s = await pan(); ok(s.title === 'Jogos', 'clicar em "Jogos" no caminho volta', s.title);
  // busca procura em toda a pasta (inclusive subpastas)
  await p.type('.gf-q', 'cs'); await sleep(200);
  s = await pan(); ok(JSON.stringify(s.tiles) === '["CS da Firma"]', 'busca acha o servidor dentro da subpasta', s.tiles);
  await p.screenshot({ path: '.testshots/gfolders-busca.png' });
  await p.evaluate(() => { const i = document.querySelector('.gf-q'); i.value = ''; i.dispatchEvent(new Event('input')); }); await sleep(150);
  await p.screenshot({ path: '.testshots/gfolders-painel.png' });
  // clicar num servidor entra nele e fecha o painel
  await p.evaluate(() => [...document.querySelectorAll('.gf-panel .gf-tile')].find(t => t.querySelector('.gf-n')?.textContent === 'Lolzinho').click()); await sleep(500);
  ok(await p.evaluate((gid) => window.__lc.S.view.gid === gid && !document.querySelector('.gf-panel'), gs[3].id), 'clicar num servidor entra nele e fecha o painel');
  ok(await p.evaluate(() => document.querySelector('#rail .railfolder').classList.contains('active')), 'a pasta fica marcada na barra enquanto você está num servidor dela');
  // desfazer a pasta Jogos: tudo volta para a barra (a FPS vira pasta solta)
  await rclick('#rail .railfolder .gf-item'); await pick(/Desfazer pasta/);
  await p.evaluate(() => [...document.querySelectorAll('.modal .mf .btn')].at(-1).click()); await sleep(400);
  ids = await railIds();
  ok(ids.filter(x => x.startsWith('f:')).length === 1 && ids.length === 5, 'desfazer: Minecraft e Lol voltam soltos, FPS continua como pasta', ids);
  ok(await p.evaluate(() => window.__lc.S.prefs.gfolders.length) === 1, 'preferências: sobra só a FPS');
  // recarregar mantém (fica na conta)
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(1200);
  ok(JSON.stringify(await railIds()) === JSON.stringify(ids), 'depois de recarregar, a barra continua igual');
  ok(!errors.length, 'sem erros na página', errors);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); await sleep(500); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
