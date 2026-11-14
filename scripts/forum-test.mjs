// Canal de fórum de ponta a ponta (servidor real + 2 navegadores): criar o fórum, criar post pela tela (título, tag,
// texto e imagem), votar (▲, na hora para a outra pessoa), ordem Em alta / Novos / Top, filtro por tag e busca, abrir o
// post (o post no topo e os comentários embaixo), comentar (o cartão conta), link direto para o post, trancar (só a
// moderação comenta), fixar, editar e apagar. Uso: BROWSER=/caminho/do/chrome node scripts/forum-test.mjs  (SHOTS=1: prints)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer-core';
const PORT = 3423, BASE = `http://localhost:${PORT}`, DATA = '.testdata-forum', OUT = '.testshots/forum';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: ['ignore', 'ignore', 'pipe'] });
let srvErr = ''; srv.stderr.on('data', d => (srvErr += d));
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => (await call('', 'POST', '/register', { username: n, password: 'Teste.senha-12345' })).token;
// imagem de teste: PNG 640×360 com degradê, gerado aqui (sem depender de arquivo nem de ffmpeg)
const pngOf = (w, hgt) => {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 255 - (x * 160 / w) | 0; raw[o + 1] = 70 + (y * 120 / hgt) | 0; raw[o + 2] = 90 + (x * 150 / w) | 0; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const png = pngOf(640, 360);
const imgPath = DATA + '-img.png'; fs.writeFileSync(imgPath, png);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const open = async (tok) => {
  const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 20000 }); return p;
};
const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: `${OUT}/${name}.png` }); };
try {
  const ta = await reg('ana'), tb = await reg('beto');
  const g = await call(ta, 'POST', '/guilds', { name: 'Galera' });
  await call(tb, 'POST', '/invites/' + (await call(ta, 'POST', `/guilds/${g.id}/invites`)).code);
  const A = await open(ta), B = await open(tb);

  // ---- criar o canal de fórum pela tela ----
  for (const P of [A, B]) await P.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(600);
  await A.evaluate(() => document.querySelector('#side-list .cat .add, #side-head')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const created = await call(ta, 'POST', `/guilds/${g.id}/channels`, { name: 'Ideias e Discussões', type: 15 });
  await sleep(500);
  const row = await B.evaluate((id) => { const r = document.querySelector(`#side-list [data-cid="${id}"]`); return r ? { txt: r.textContent.trim(), icon: !!r.querySelector('svg') } : null; }, created.id);
  ok(row && /ideias-e-discussões/.test(row.txt), 'fórum aparece na lista de canais para os outros, na hora', row);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, created.id); }
  await A.waitForSelector('.fo-empty', { timeout: 8000 });
  const empty = await A.evaluate(() => ({ txt: document.querySelector('.fo-empty b')?.textContent, tags: [...document.querySelectorAll('.fo-tools .fo-tag')].map(t => t.textContent.trim()), sorts: [...document.querySelectorAll('.fo-sort')].map(s => s.textContent) }));
  ok(empty.txt === 'Nenhum post ainda' && empty.sorts.join() === 'Em alta,Novos,Top,Atividade' && empty.tags.includes('🎮Jogatina'), 'fórum vazio: convite para o primeiro post, ordens e tags padrão', empty);
  await shot(A, '01-vazio');

  // ---- criar post pela tela (título, tag, texto, imagem) ----
  await A.evaluate(() => document.querySelector('.fo-head .fo-new').click()); await A.waitForSelector('.fo-in-title');
  await A.type('.fo-in-title', 'Qual o melhor mapa do Valorant?');
  await A.evaluate(() => [...document.querySelectorAll('.fo-pick .fo-tag')].find(t => /Dúvida/.test(t.textContent)).click());
  await A.type('.fo-in-body', 'Eu acho que é **Ascent**, mas quero ouvir vocês.\n\nVotem e comentem!');
  const fi = await A.$('.fo-attrow input[type=file]'); await fi.uploadFile(imgPath);
  await A.waitForFunction(() => document.querySelector('.fo-thumb') && !document.querySelector('.fo-thumb .fo-upl'), { timeout: 10000 });
  await A.evaluate(() => [...document.querySelectorAll('.fo-wtabs button')].find(b => b.textContent === 'Prévia').click()); await sleep(200);
  ok(await A.evaluate(() => /<b>Ascent<\/b>/.test(document.querySelector('.fo-prevbox').innerHTML)), 'prévia mostra o texto formatado');
  await shot(A, '02-criar');
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => b.textContent === 'Postar').click());
  await A.waitForSelector('.fo-posthead .fo-title', { timeout: 8000 }); await sleep(500);
  const ph = await A.evaluate(() => ({ title: document.querySelector('.fo-posthead .fo-title')?.textContent, tag: document.querySelector('.fo-posthead .fo-tag')?.textContent, body: document.querySelector('.fo-posthead .fo-full')?.innerHTML, img: !!document.querySelector('.fo-posthead .fo-img'), score: document.querySelector('.fo-posthead .fo-score')?.textContent, voted: !!document.querySelector('.fo-posthead .fo-vote.on'), crumb: document.querySelector('#topbar .fo-crumbt')?.textContent, ph: document.querySelector('#composer textarea')?.placeholder }));
  ok(ph.title === 'Qual o melhor mapa do Valorant?' && /Dúvida/.test(ph.tag) && /<b>Ascent/.test(ph.body) && ph.img, 'post criado e aberto: título, tag, texto formatado e imagem', ph);
  ok(ph.score === '1' && ph.voted && ph.crumb === ph.title && ph.ph === 'Escreva um comentário…', 'quem posta já vota (1), topo mostra o caminho, compositor de comentário', ph);
  const pid = await A.evaluate(() => window.__lc.S.view.cid);

  // ---- a outra pessoa vê o post chegar no feed e vota ----
  await B.waitForSelector(`.fo-post[data-pid="${pid}"]`, { timeout: 8000 });
  const card = await B.evaluate((pid) => { const c = document.querySelector(`.fo-post[data-pid="${pid}"]`); return { title: c.querySelector('.fo-title').textContent, img: !!c.querySelector('.fo-media img'), tag: c.querySelector('.fo-tag')?.textContent, n: c.querySelector('.fo-acts .fo-act').textContent, who: c.querySelector('.fo-who span').textContent }; }, pid);
  ok(card.title === 'Qual o melhor mapa do Valorant?' && card.img && /Dúvida/.test(card.tag) && card.n === '0 comentários' && card.who === 'ana', 'post aparece no feed da outra pessoa na hora (imagem, tag, autor, 0 comentários)', card);
  await B.evaluate((pid) => document.querySelector(`.fo-post[data-pid="${pid}"] .fo-up`).click(), pid); await sleep(800);
  const bv = await B.evaluate((pid) => ({ s: document.querySelector(`.fo-post[data-pid="${pid}"] .fo-score`).textContent, on: !!document.querySelector(`.fo-post[data-pid="${pid}"] .fo-vote.on`) }), pid);
  ok(bv.s === '2' && bv.on, '▲ do beto: 2 votos, seta acesa', bv);
  ok(await A.evaluate(() => document.querySelector('.fo-posthead .fo-score').textContent) === '2', 'quem está com o post aberto vê o voto chegar na hora');

  // ---- mais posts para ordem, tag e busca ----
  const p2 = await call(tb, 'POST', `/forums/${created.id}/posts`, { title: 'Bora jogar sexta?', content: 'Quem topa uma jogatina sexta à noite?', tags: ['t4'] });
  const p3 = await call(ta, 'POST', `/forums/${created.id}/posts`, { title: 'Clipe insano do beto', content: 'olha isso', tags: ['t3'] });
  await call(tb, 'DELETE', `/posts/${p3.id}/vote`); await call(ta, 'DELETE', `/posts/${p3.id}/vote`); // 0 votos
  await sleep(600);
  const order = async (sort) => { await B.evaluate((s) => [...document.querySelectorAll('.fo-sort')].find(b => b.textContent === s).click(), sort); await sleep(700); return B.evaluate(() => [...document.querySelectorAll('.fo-feed .fo-title')].map(t => t.textContent)); };
  const novos = await order('Novos'), top = await order('Top');
  ok(novos[0] === 'Clipe insano do beto' && novos[2] === 'Qual o melhor mapa do Valorant?', 'Novos: o mais recente primeiro', novos);
  ok(top[0] === 'Qual o melhor mapa do Valorant?' && top[2] === 'Clipe insano do beto', 'Top: o mais votado primeiro', top);
  await B.evaluate(() => [...document.querySelectorAll('.fo-tools .fo-tag')].find(t => /Jogatina/.test(t.textContent)).click()); await sleep(700);
  const byTag = await B.evaluate(() => [...document.querySelectorAll('.fo-feed .fo-title')].map(t => t.textContent));
  ok(byTag.join() === 'Bora jogar sexta?', 'filtro por tag (Jogatina)', byTag);
  await B.evaluate(() => [...document.querySelectorAll('.fo-tools .fo-tag')].find(t => /Todas/.test(t.textContent)).click()); await sleep(500);
  await B.type('.fo-search input', 'ascent'); await sleep(1000);
  const found = await B.evaluate(() => [...document.querySelectorAll('.fo-feed .fo-title')].map(t => t.textContent));
  ok(found.join() === 'Qual o melhor mapa do Valorant?', 'busca acha pelo texto do post', found);
  await B.evaluate(() => { const i = document.querySelector('.fo-search input'); i.value = ''; i.dispatchEvent(new Event('input')); }); await sleep(900);
  await B.evaluate(() => [...document.querySelectorAll('.fo-sort')].find(b => b.textContent === 'Em alta').click()); await sleep(700);
  await shot(B, '03-feed');

  // ---- abrir o post e comentar ----
  await B.evaluate((pid) => document.querySelector(`.fo-post[data-pid="${pid}"]`).click(), pid);
  await B.waitForSelector('.fo-posthead', { timeout: 8000 }); await sleep(400);
  await B.setViewport({ width: 1440, height: 640 }); await sleep(300);
  await B.evaluate(() => document.querySelector('#topbar .fo-crumb').click()); await B.waitForSelector('.fo-feed .fo-post'); await sleep(400);
  await B.evaluate((pid) => document.querySelector(`.fo-post[data-pid="${pid}"]`).click(), pid); await B.waitForSelector('.fo-posthead'); await sleep(800);
  const opened = await B.evaluate(() => { const b = document.querySelector('#msgs'); return { top: b.scrollTop, over: b.scrollHeight > b.clientHeight + 50 }; });
  const bvote = await B.evaluate(() => ({ on: !!document.querySelector('.fo-posthead .fo-vote.on'), voted: window.__lc.S.posts.get(window.__lc.S.view.cid)?.post.voted }));
  ok(bvote.on && bvote.voted, 'no post aberto, o meu voto aparece aceso', bvote);
  ok(opened.over && opened.top === 0, 'post abre pelo topo (o post), não pelo último comentário', opened);
  await shot(B, '04a-aberto'); await B.setViewport({ width: 1440, height: 900 }); await sleep(300);
  await B.type('#composer textarea', 'Ascent é bom, mas Haven é melhor!'); await B.keyboard.press('Enter'); await sleep(900);
  const cm = await B.evaluate(() => ({ head: document.querySelector('#msgs > .fo-posthead') === document.querySelector('#msgs').firstElementChild || !!document.querySelector('#msgs .fo-posthead'), msgs: [...document.querySelectorAll('#msgs .msg .body')].map(b => b.textContent), n: document.querySelector('.fo-posthead .fo-act').textContent }));
  ok(cm.head && cm.msgs.includes('Ascent é bom, mas Haven é melhor!') && cm.n === '1 comentário', 'comentário aparece embaixo do post e o contador sobe', cm);
  ok(await A.evaluate(() => document.querySelector('#msgs .msg .body')?.textContent) === 'Ascent é bom, mas Haven é melhor!', 'quem está no post vê o comentário chegar');
  await shot(B, '04-post');
  // o cartão no feed da ana conta o comentário
  await A.evaluate(() => document.querySelector('#topbar .fo-crumb').click()); await A.waitForSelector('.fo-feed .fo-post'); await sleep(600);
  ok(await A.evaluate((pid) => document.querySelector(`.fo-post[data-pid="${pid}"] .fo-acts .fo-act`).textContent, pid) === '1 comentário', 'voltar ao fórum: o cartão conta 1 comentário');

  // ---- link direto (recarregar com o post na URL) ----
  await B.reload(); await B.waitForSelector('.fo-posthead .fo-title', { timeout: 15000 });
  ok(await B.evaluate(() => document.querySelector('.fo-posthead .fo-title').textContent) === 'Qual o melhor mapa do Valorant?', 'link direto do post abre o post depois de recarregar');
  ok(await B.evaluate((fid) => !!document.querySelector(`#side-list [data-cid="${fid}"] .ch.active, #side-list .ch.active[data-cid="${fid}"]`), created.id), 'na lista de canais, o fórum fica marcado com o post aberto');

  // ---- moderação: trancar e fixar (beto não é moderador) ----
  const notMod = await call(tb, 'PATCH', `/posts/${p2.id}`, { pinned: true });
  ok(notMod.status === 403, 'quem não é moderador não fixa', notMod.status);
  await call(ta, 'PATCH', `/posts/${pid}`, { locked: true }); await sleep(700);
  const lockv = await B.evaluate(() => ({ note: document.getElementById('fo-locknote')?.textContent, hidden: document.getElementById('composer')?.classList.contains('fo-lockedcomp'), flag: !!document.querySelector('.fo-posthead .fo-flag.lock') }));
  ok(lockv.note && lockv.hidden && lockv.flag, 'trancado: aviso no lugar do compositor e selo no post, na hora', lockv);
  const blocked = await call(tb, 'POST', `/channels/${pid}/messages`, { content: 'tentando' });
  ok(blocked.status === 403, 'servidor recusa comentário em post trancado', blocked.status);
  ok((await call(ta, 'POST', `/channels/${pid}/messages`, { content: 'Trancado para não virar briga 😄' })).id, 'a moderação ainda comenta no trancado');
  await call(ta, 'PATCH', `/posts/${p3.id}`, { pinned: true }); await sleep(500);
  await A.evaluate(() => [...document.querySelectorAll('.fo-sort')].find(b => b.textContent === 'Novos').click()); await sleep(700);
  const pinned = await A.evaluate(() => { const c = document.querySelector('.fo-feed .fo-post'); return { t: c.querySelector('.fo-title').textContent, pin: c.classList.contains('pinned') }; });
  ok(pinned.t === 'Clipe insano do beto' && pinned.pin, 'fixado fica no topo, em qualquer ordem', pinned);

  // ---- editar e apagar ----
  const ed = await call(tb, 'PATCH', `/posts/${p2.id}`, { title: 'Bora jogar sexta? (20h)' }); await sleep(600);
  ok(ed.title === 'Bora jogar sexta? (20h)' && await A.evaluate((id) => document.querySelector(`.fo-post[data-pid="${id}"] .fo-title`)?.textContent, p2.id) === 'Bora jogar sexta? (20h)', 'autor edita o título; muda no feed dos outros na hora');
  ok((await call(ta, 'PATCH', `/posts/${p2.id}`, { title: 'hackeado' })).status === 200, 'moderação (dona) também edita');
  ok((await call(tb, 'DELETE', `/posts/${p3.id}`)).status === 403, 'quem não é autor nem moderador não apaga');
  await call(ta, 'DELETE', `/posts/${p3.id}`); await sleep(600);
  ok(!(await A.evaluate((id) => !!document.querySelector(`.fo-post[data-pid="${id}"]`), p3.id)), 'post apagado some do feed na hora');
  await shot(A, '05-feed-final');
  // apagar o fórum leva os posts
  await call(ta, 'DELETE', `/channels/${created.id}`); await sleep(500);
  ok((await call(ta, 'GET', `/posts/${pid}`)).status === 404, 'apagar o fórum apaga os posts');
  ok((await call(ta, 'GET', `/channels/${pid}/messages`)).status === 404, 'e os comentários');
  const errs = [...A.errors, ...B.errors];
  ok(!errs.length, 'sem erros na página', errs);
  ok(!/Error|TypeError/.test(srvErr), 'sem erros no servidor', srvErr.slice(0, 400));
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(imgPath, { force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
