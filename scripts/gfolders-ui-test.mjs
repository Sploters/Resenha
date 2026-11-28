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
  // com um servidor só, a miniatura continua quadrada (a grade 2x2 não estica) e os servidores são quadrados sem o mouse em cima
  const shape = await p.evaluate(() => { const m = document.querySelector('#rail .fold-mini').getBoundingClientRect(); return { w: m.width, h: m.height, radius: getComputedStyle(document.querySelector('#rail [data-gid]')).borderRadius }; });
  ok(Math.abs(shape.w - shape.h) < 1, 'pasta com um servidor: miniatura quadrada', shape);
  ok(shape.radius === '14px', 'servidor na barra é um quadrado arredondado', shape.radius);
  await p.screenshot({ path: '.testshots/gfolders-um.png', clip: { x: 0, y: 0, width: 300, height: 500 } });
  // mais três servidores para dentro de Jogos
  for (const g of gs.slice(1, 4)) { await rclick(`#rail [data-gid="${g.id}"]`); await pick(/Mover para pasta/); await pick(/^Jogos$/); }
  ids = await railIds();
  ok(ids.length === 3 && ids[0] === fid, 'quatro servidores dentro de Jogos: na barra sobram a pasta e dois servidores', ids);
  ok(await p.evaluate(() => document.querySelectorAll('#rail .railfolder .fold-mini').length) === 4, 'o quadrado da pasta mostra 4 miniaturas');
  // abre o painel à direita
  await p.click('#rail .railfolder .fold-item'); await sleep(300);
  const pan = () => p.evaluate(() => { const el = document.querySelector('.fold-panel'); if (!el) return null; const r = el.getBoundingClientRect(), rail = document.querySelector('#rail').getBoundingClientRect(); return { right: r.left >= rail.right, w: Math.round(r.width), h: Math.round(r.height), title: el.querySelector('.fold-crumbs').innerText.replace(/\s+/g, ' '), tiles: [...el.querySelectorAll('.fold-tile:not(.add) .fold-n')].map(x => x.textContent) }; });
  let s = await pan();
  ok(s && s.right && s.tiles.length === 4, 'clicar na pasta abre o painel à direita da barra com a grade de servidores', s);
  // o menu "…" do painel abre por cima dele
  await p.click('.fold-head .ibtn[title="Opções da pasta"]'); await sleep(350);
  ok(await p.evaluate(() => { const m = document.querySelector('.menu'), r = m.getBoundingClientRect(); return [...m.querySelectorAll('.it')].every(it => { const b = it.getBoundingClientRect(); return m.contains(document.elementFromPoint(b.x + 10, b.y + b.height / 2)); }); }), 'o menu "…" fica por cima do painel');
  await p.screenshot({ path: '.testshots/gfolders-menu.png' });
  await p.keyboard.press('Escape'); await sleep(300);
  if (!await p.$('.fold-panel')) { await p.click('#rail .railfolder .fold-item'); await sleep(300); }
  // subpasta "FPS" com Valorant e CS (clique direito no servidor dentro do painel)
  await p.click('.fold-tile.add'); await prompt('FPS'); await sleep(200);
  s = await pan(); ok(s.tiles[0] === 'FPS', 'nova subpasta "FPS" aparece primeiro na grade', s.tiles);
  for (const n of ['Valorant BR', 'CS da Firma']) {
    const h = await p.evaluateHandle((n) => [...document.querySelectorAll('.fold-panel .fold-tile')].find(t => t.querySelector('.fold-n')?.textContent === n), n);
    const b = await h.asElement().boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await sleep(250);
    await pick(/Mover para pasta/); await pick(/Jogos › FPS/);
  }
  s = await pan(); ok(JSON.stringify(s.tiles) === '["FPS","Minecraft SMP","Lolzinho"]', 'Valorant e CS foram para Jogos › FPS', s.tiles);
  await p.evaluate(() => [...document.querySelectorAll('.fold-panel .fold-tile.sub')][0].click()); await sleep(250);
  s = await pan(); ok(s.title === 'Jogos FPS' && s.tiles.length === 2, 'abrir a subpasta: caminho "Jogos › FPS" e os dois servidores', s);
  await p.screenshot({ path: '.testshots/gfolders-sub.png' });
  await p.evaluate(() => document.querySelector('.fold-crumb').click()); await sleep(250);
  s = await pan(); ok(s.title === 'Jogos', 'clicar em "Jogos" no caminho volta', s.title);
  // busca procura em toda a pasta (inclusive subpastas)
  await p.type('.fold-q', 'cs'); await sleep(200);
  s = await pan(); ok(JSON.stringify(s.tiles) === '["CS da Firma"]', 'busca acha o servidor dentro da subpasta', s.tiles);
  await p.screenshot({ path: '.testshots/gfolders-busca.png' });
  await p.evaluate(() => { const i = document.querySelector('.fold-q'); i.value = ''; i.dispatchEvent(new Event('input')); }); await sleep(150);
  await p.screenshot({ path: '.testshots/gfolders-painel.png' });
  // clicar num servidor entra nele e fecha o painel
  await p.evaluate(() => [...document.querySelectorAll('.fold-panel .fold-tile')].find(t => t.querySelector('.fold-n')?.textContent === 'Lolzinho').click()); await sleep(500);
  ok(await p.evaluate((gid) => window.__lc.S.view.gid === gid && !document.querySelector('.fold-panel'), gs[3].id), 'clicar num servidor entra nele e fecha o painel');
  ok(await p.evaluate(() => document.querySelector('#rail .railfolder').classList.contains('active')), 'a pasta fica marcada na barra enquanto você está num servidor dela');
  // desfazer a pasta Jogos: tudo volta para a barra (a FPS vira pasta solta)
  await rclick('#rail .railfolder .fold-item'); await pick(/Desfazer pasta/);
  await p.evaluate(() => [...document.querySelectorAll('.modal .mf .btn')].at(-1).click()); await sleep(400);
  ids = await railIds();
  ok(ids.filter(x => x.startsWith('f:')).length === 1 && ids.length === 5, 'desfazer: Minecraft e Lol voltam soltos, FPS continua como pasta', ids);
  ok(await p.evaluate(() => window.__lc.S.prefs.gfolders.length) === 1, 'preferências: sobra só a FPS');
  // recarregar mantém (fica na conta)
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(1200);
  ok(JSON.stringify(await railIds()) === JSON.stringify(ids), 'depois de recarregar, a barra continua igual');
  // ---------- arrastar ----------
  const box = async (sel) => (await p.$(sel)).boundingBox();
  const rail = (id) => `#rail .rail-wrap[data-id="${id}"]`;
  const tileSel = (key) => `.fold-panel .fold-tile[data-key="${key}"]`;
  // arrasta o centro de um item até um alvo (fy = fração da altura do alvo) ou até um ponto { x, y }
  const drag = async (from, to, fy = .5, shot) => {
    const a = await box(from), b = typeof to === 'string' ? await box(to) : null;
    const x = b ? b.x + b.width / 2 : to.x, y = b ? b.y + b.height * fy : to.y;
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
    await p.mouse.move(x, y, { steps: 12 }); await sleep(200);
    if (shot) await p.screenshot({ path: `.testshots/${shot}.png` });
    await p.mouse.up(); await sleep(500);
  };
  const prefs = () => p.evaluate(() => window.__lc.S.prefs.gfolders.map(f => ({ id: f.id, name: f.name, parent: f.parent, items: f.items })));
  const openF = async (key) => { if (!await p.$('.fold-panel')) { await p.click(rail(key) + ' .fold-item'); await sleep(300); } };
  const [a, b, c, d] = (await railIds()).filter(x => !x.startsWith('f:'));
  await drag(rail(a), rail(b), .5, 'gfolders-arrastando');
  ids = await railIds();
  let made = (await prefs()).find(f => f.items.includes('g:' + a));
  ok(made && made.items.includes('g:' + b) && ids.includes('f:' + made.id) && !ids.includes(a) && !ids.includes(b), 'arrastar um servidor para o meio de outro cria uma pasta com os dois', { ids, made });
  const nova = 'f:' + made?.id, mine = async () => (await prefs()).find(f => 'f:' + f.id === nova);
  await drag(rail(c), rail(nova));
  made = await mine();
  ok(made.items.includes('g:' + c) && !(await railIds()).includes(c), 'arrastar um servidor para o meio de uma pasta põe ele dentro', made);
  const before = await railIds(), nf = (await prefs()).length;
  await drag(rail(d), rail(before[0]), .08);
  ids = await railIds();
  ok(ids[0] === d && ids.length === before.length && (await prefs()).length === nf, 'soltar na borda só muda a ordem (não cria pasta)', ids);
  // do painel para a barra, na posição em que soltar
  await openF(nova);
  await drag(tileSel('g:' + c), rail(d), .08);
  ids = await railIds(); made = await mine();
  ok(ids[0] === c && !made.items.includes('g:' + c), 'arrastar do painel para a barra tira da pasta e entra onde soltou', { ids, made });
  await openF(nova);
  const pb = await box('.fold-panel'), same = JSON.stringify(await prefs());
  await drag(tileSel('g:' + a), { x: pb.x + pb.width - 12, y: pb.y + pb.height - 8 });
  ok(JSON.stringify(await prefs()) === same && !!await p.$('.fold-panel'), 'soltar no vazio dentro do painel não muda nada');
  const order0 = (await mine()).items, t1 = await box(tileSel(order0[0]));
  await drag(tileSel(order0[1]), { x: t1.x + 4, y: t1.y + t1.height / 2 });
  made = await mine();
  ok(JSON.stringify(made.items) === JSON.stringify([order0[1], order0[0]]), 'arrastar para a borda de outro item reordena dentro da pasta', made.items);
  await drag(tileSel('g:' + a), { x: 900, y: 600 }, .5);
  ids = await railIds(); made = await mine();
  ok(made && !made.items.includes('g:' + a) && ids[ids.indexOf(nova) + 1] === a, 'soltar fora do painel tira da pasta (fica logo abaixo dela)', { ids, made });
  await openF(nova);
  await drag(tileSel('g:' + b), { x: 900, y: 600 });
  ids = await railIds();
  ok(ids.includes(b) && !ids.includes(nova) && !await mine() && !await p.$('.fold-panel'), 'tirar o último servidor apaga a pasta vazia e fecha o painel', ids);
  // dentro do painel, juntar dois servidores cria uma subpasta
  await drag(rail(a), rail(b));
  const root = (await prefs()).find(f => f.items.includes('g:' + a)), rk = 'f:' + root.id;
  await drag(rail(c), rail(rk));
  await openF(rk);
  await drag(tileSel('g:' + c), tileSel('g:' + a));
  const all = await prefs(), subf = all.find(f => f.parent === root.id);
  ok(subf && subf.items.includes('g:' + a) && subf.items.includes('g:' + c) && !!await p.$(tileSel('f:' + subf.id)), 'juntar dois servidores dentro do painel cria uma subpasta', all);
  await sleep(1500); const saved = JSON.stringify(await prefs()), savedRail = JSON.stringify(await railIds());
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rail', { timeout: 20000 }); await sleep(1200);
  ok(JSON.stringify(await prefs()) === saved && JSON.stringify(await railIds()) === savedRail, 'o que foi arrastado fica salvo depois de recarregar');
  ok(!errors.length, 'sem erros na página', errors);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); await sleep(500); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
