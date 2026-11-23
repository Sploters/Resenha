// Arrastar canais: quem pode Gerenciar canais arrasta um canal para cima/baixo de outro, para dentro de outra categoria
// (logo abaixo do título), para fora das categorias (acima da primeira) e troca categorias de lugar. Os outros veem a
// ordem nova na hora e ela fica guardada. Quem não pode não arrasta (nem pela API).
// Servidor de verdade + navegador para a Ana (dona) e o Beto (membro). Uso: node scripts/channel-drag-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('chdrag', 3414, 41620);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { n, tok: r.token, id: me.id }; };
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const [ana, beto] = await Promise.all(['ana', 'beto'].map(reg));
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`, {})).code;
  await call(beto.tok, 'POST', '/invites/' + code);
  const open = async (u) => {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
    await p.setViewport({ width: 1280, height: 800 });
    await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, u.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
    await p.evaluate((gid) => window.__lc.go(gid), g.id); await p.waitForSelector('#side-list .catblk');
    return p;
  };
  const A = await open(ana);
  const chs = () => A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.map(c => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id || null })), g.id);
  const list = await chs();
  const cat1 = list.find(c => c.type === 4 && /texto/i.test(c.name)).id, cat2 = list.find(c => c.type === 4 && /voz/i.test(c.name)).id;
  const geral = list.find(c => c.name === 'geral').id;
  await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'aaa', type: 0, parent_id: cat1 });
  const a = (await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'a', type: 0, parent_id: cat1 })).id;
  const b = (await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'b', type: 0, parent_id: cat1 })).id;
  const B = await open(beto);
  // a barra como cada um vê: [categoria|null, [nomes dos canais]]
  const side = (p) => p.evaluate(() => {
    const out = [['-', []]];
    for (const el of document.querySelectorAll('#side-list > .ch, #side-list > div > .ch, #side-list .catblk > .cat, #side-list .catblk > div > .ch, #side-list .catblk > .ch')) {
      if (el.classList.contains('cat')) out.push([el.textContent.trim(), []]); else out[out.length - 1][1].push(el.querySelector('.name').textContent);
    }
    return out.filter(([n, k]) => n !== '-' || k.length);
  });
  await until(async () => JSON.stringify(await side(B)).includes('"b"'));
  ok(JSON.stringify(await side(A)) === JSON.stringify([['Canais de texto', ['geral', 'aaa', 'a', 'b']], ['Canais de voz', ['Geral']]]), 'barra começa na ordem de criação', await side(A));

  // arrasta (eventos de arrastar do navegador) o canal/categoria src até a metade de cima ou de baixo de dst
  const drag = (page, src, dst, half) => page.evaluate((src, dst, half) => {
    const el = (id) => document.querySelector(`#side-list [data-cid="${id}"]`);
    const s = el(src), d = el(dst);
    const dt = new DataTransfer(), r = d.getBoundingClientRect(), y = half === 'top' ? r.top + 2 : r.bottom - 2;
    const ev = (e, t) => e.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: y }));
    const draggable = s.draggable;
    ev(s, 'dragstart'); ev(d, 'dragenter'); const accepted = !ev(d, 'dragover');
    const line = d.classList.contains(half === 'top' ? 'cdrop-before' : 'cdrop-after');
    if (accepted) ev(d, 'drop');
    ev(s, 'dragend');
    return { draggable, accepted, line };
  }, src, dst, half);
  // marca cada linha com o id do canal (a barra não põe o id no DOM): pelo nome, que aqui é único
  const tag = (p) => p.evaluate((gid) => {
    const g = window.__lc.S.guilds.get(gid);
    for (const e of document.querySelectorAll('#side-list .ch, #side-list .cat')) {
      const n = e.classList.contains('cat') ? e.textContent.trim().toLowerCase() : e.querySelector('.name')?.textContent;
      const c = g.channels.find(c => (c.type === 4 ? c.name.toLowerCase() : c.name) === n); if (c) e.dataset.cid = c.id;
    }
  }, g.id);
  const step = async (src, dst, half, want, msg) => {
    await tag(A); const r = await drag(A, src, dst, half);
    ok(r.draggable && r.accepted && r.line, msg + ': arrasta, aceita e mostra a linha', r);
    ok(await until(async () => JSON.stringify(await side(A)) === JSON.stringify(want)), msg + ' (Ana)', await side(A));
    ok(await until(async () => JSON.stringify(await side(B)) === JSON.stringify(want)), msg + ' (Beto vê na hora)', await side(B));
  };

  await tag(B);
  ok(!(await B.$eval(`[data-cid="${geral}"]`, e => e.draggable)), 'Beto (sem Gerenciar canais) não arrasta canais');
  await tag(A);
  const self = await drag(A, geral, geral, 'top');
  ok(!self.accepted, 'soltar o canal em cima dele mesmo não vale', self);

  await step(b, geral, 'top', [['Canais de texto', ['b', 'geral', 'aaa', 'a']], ['Canais de voz', ['Geral']]], 'b acima de geral');
  await step(a, cat2, 'bottom', [['Canais de texto', ['b', 'geral', 'aaa']], ['Canais de voz', ['a', 'Geral']]], 'a para o começo de Canais de voz');
  await step(b, cat2, 'top', [['Canais de texto', ['geral', 'aaa', 'b']], ['Canais de voz', ['a', 'Geral']]], 'b no fim da categoria anterior (metade de cima do título)');
  await step(geral, cat1, 'top', [['-', ['geral']], ['Canais de texto', ['aaa', 'b']], ['Canais de voz', ['a', 'Geral']]], 'geral para fora das categorias');
  await step(cat2, cat1, 'top', [['-', ['geral']], ['Canais de voz', ['a', 'Geral']], ['Canais de texto', ['aaa', 'b']]], 'categoria de voz acima da de texto');
  await tag(A);
  const catOnCh = await drag(A, cat1, geral, 'top');
  ok(!catOnCh.accepted, 'categoria não cai em cima de um canal', catOnCh);

  // guardado no servidor: abrir de novo mostra a mesma ordem; o canal movido segue a categoria nova
  await A.reload(); await A.waitForSelector('#rail .rail-wrap'); await A.evaluate((gid) => window.__lc.go(gid), g.id); await A.waitForSelector('#side-list .catblk');
  ok(JSON.stringify(await side(A)) === JSON.stringify([['-', ['geral']], ['Canais de voz', ['a', 'Geral']], ['Canais de texto', ['aaa', 'b']]]), 'ordem continua depois de recarregar', await side(A));

  // API: sem permissão, lista incompleta e categoria dentro de categoria
  const now = await chs(), order = now.map(c => ({ id: c.id, parent_id: c.parent_id }));
  ok((await call(beto.tok, 'PUT', `/guilds/${g.id}/channels/order`, { order })).status === 403, 'Beto não muda a ordem pela API');
  ok((await call(ana.tok, 'PUT', `/guilds/${g.id}/channels/order`, { order: order.slice(1) })).status === 409, 'lista desatualizada (faltando canal) volta 409');
  ok((await call(ana.tok, 'PUT', `/guilds/${g.id}/channels/order`, { order: [...order, order[0]] })).status === 409, 'canal repetido volta 409');
  const r = await call(ana.tok, 'PUT', `/guilds/${g.id}/channels/order`, { order: order.map(o => o.id === cat1 ? { id: cat1, parent_id: cat2 } : o.id === geral ? { id: geral, parent_id: 'nada' } : o) });
  ok(r.status === 200, 'pedido com categoria dentro de categoria é aceito, mas corrigido', r);
  ok(await until(async () => { const l = await chs(); return l.find(c => c.id === cat1).parent_id === null && l.find(c => c.id === geral).parent_id === null; }), 'categoria fica sem pai e pai inválido vira "fora das categorias"');
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
