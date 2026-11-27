// Mesa de RPG no app: mestre e jogador na mesma chamada. Abre a mesa, cria ficha pela janela, rola dados pelos botões,
// inimigo em vida oculta (o jogador só vê o dano), combate pela aba e o campo da rolagem que não perde o foco.
// Uso: node scripts/rpg-ui-test.mjs   (capturas em .testshots/rpg; BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3271, BASE = `http://localhost:${PORT}`, OUT = '.testshots/rpg', DIR = './.testdata-rpg';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41070', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, name: n }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function page(u) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  p.on('pageerror', e => { errs.push(u.name + ': ' + e.message); console.log('PAGEERR', u.name, e.message); });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 }); return p;
}
const click = (p, sel, re) => p.evaluate((s, r) => { const b = [...document.querySelectorAll(s)].find(x => !r || new RegExp(r).test(x.textContent)); if (!b) return false; b.click(); return true; }, sel, re?.source);
const rpg = (p, d) => p.evaluate((x) => window.__lc.voice.send('RPG', x), d);
const st = (p) => p.evaluate(() => window.__lc.import('rpg.js').then(() => null)).then(() => p.evaluate(() => document.querySelector('.rpgtile')?.innerText || ''));
try {
  const A = await reg('mestra'), B = await reg('beto');
  const g = await call(A.tok, 'POST', '/guilds', { name: 'Taverna' });
  const code = (await call(A.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(B.tok, 'POST', '/invites/' + code);
  const pa = await page(A), pb = await page(B);
  const vch = await pa.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const p of [pa, pb]) {
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(400);
    await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await p.waitForFunction(() => window.__lc.voice?.active, { timeout: 20000 }); await sleep(700);
  }

  // ---------- abrir pela lista de atividades ----------
  const entry = await pa.evaluate(() => window.__lc.import('userbar.js').then(m => m.activityEntries().find(e => e.id === 'rpg')));
  ok(entry?.title === 'Mesa de RPG', 'Mesa de RPG está nas atividades (foguete)', entry);
  await pa.evaluate(() => window.__lc.import('userbar.js').then(m => m.activityEntries().find(e => e.id === 'rpg').fn())); await sleep(900);
  for (const [p, n] of [[pa, 'mestra'], [pb, 'beto']]) ok(await p.$('#stage .spot .rpgtile') !== null, `quadro da mesa abre em destaque no palco (${n})`);
  ok(await pa.$('.rpgtile .rpg-pill.me') !== null && await pb.$('.rpgtile .rpg-pill.me') === null && /mestra/.test(await st(pb)), 'mestre identificado: selo para a mestra, coroa com o nome para o jogador');

  ok(await pa.$eval('.rpg-togrow .rpg-tog:last-child', e => e.offsetParent !== null) && await pb.$eval('.rpg-togrow .rpg-tog:last-child', e => e.offsetParent === null), 'rolagem secreta: botão só para o mestre');

  // ---------- ficha pela janela ----------
  ok(await click(pb, '.rpgtile .rpg-player-h .btn', /Nova ficha/), 'botão "Nova ficha"');
  await sleep(300);
  await pb.evaluate(() => {
    const m = [...document.querySelectorAll('.modal')].at(-1), set = (i, v) => { i.value = v; i.dispatchEvent(new Event('input')); };
    const ins = m.querySelectorAll('.rpg-form input'); set(ins[0], 'Bruk'); set(ins[2], 'Bárbaro');
    const attrs = m.querySelectorAll('.rpg-attr-in input'); set(attrs[0], '4');
    [...m.querySelectorAll('.rpg-field')].find(f => /Vida máxima/.test(f.textContent)).querySelector('input').value = '30';
    [...m.querySelectorAll('.rpg-field')].find(f => /^Tags/.test(f.textContent)).querySelector('input').value = 'meio-orc, faminto';
  });
  await pb.screenshot({ path: `${OUT}/01-nova-ficha.png` });
  await click(pb, '.modal .mf .btn', /^Salvar$/); await sleep(700);
  const sa = await st(pa);
  ok(/Bruk/.test(sa) && /Bárbaro/.test(sa) && /Vida 30\/30/.test(sa) && /faminto/.test(sa), 'mestra vê a ficha nova com vida e tags', sa.slice(0, 300));

  // ---------- dados pelos botões ----------
  await click(pb, '.rpg-dbtn', /^d20$/); await click(pb, '.rpg-dbtn', /^d20$/); await click(pb, '.rpg-mbtn', /\+/); await click(pb, '.rpg-mbtn', /\+/);
  ok(await pb.$eval('.rpg-expr', e => e.value) === '2d20+2', 'clicar no d20 duas vezes e +2 monta 2d20+2');
  await pb.$eval('.rpg-expr', e => { e.value = '1d20+@FOR'; });
  await click(pb, '.rpg-togrow .rpg-tog', /^Vantagem$/);
  await click(pb, '.rpg-go'); await sleep(700);
  const lastA = await pa.evaluate(() => document.querySelector('.rpg-side .rpg-log .rpg-li')?.innerText || '');
  const resA = await pa.evaluate(() => document.querySelector('.rpg-result')?.innerText || '');
  ok(/Bruk/.test(lastA) && /=/.test(lastA), 'a rolagem do jogador aparece para a mestra (com a ficha)', lastA);
  ok(/vantagem|Crítico|Falha/.test(resA), 'resultado em destaque com a vantagem', resA);
  await pb.screenshot({ path: `${OUT}/02-rolagem.png` });

  // ---------- inimigo em vida oculta ----------
  await rpg(pa, { op: 'foe.save', foe: { name: 'Dragão Ancião', boss: true, mode: 'hidden', hp: { max: 300 }, weak: 'gelo' } }); await sleep(400);
  ok(!/Dragão/.test(await st(pb)), 'inimigo preparado não aparece para o jogador');
  await click(pa, '.rpg-tab', /Mestre/); await sleep(300);
  await click(pa, '.rpg-card.foe .ibtn[title^="Pôr em cena"]'); await sleep(500);
  ok(/Dragão Ancião/.test(await st(pb)) && /Chefe/.test(await st(pb)), 'pôr em cena: o jogador vê o chefe');
  await click(pa, '.rpg-card.foe .rpg-bar'); await sleep(300);
  await pa.evaluate(() => { const m = [...document.querySelectorAll('.modal')].at(-1); m.querySelector('input').value = '45'; });
  await click(pa, '.modal .mf .btn', /^Dano$/); await sleep(600);
  const sb = await st(pb);
  ok(/45 de dano causado/.test(sb) && !/255|300/.test(sb) && !/gelo/.test(sb), 'jogador vê só o dano (sem vida nem fraqueza)', sb.slice(0, 400));
  await pa.screenshot({ path: `${OUT}/03-mestre.png` });

  // ---------- combate ----------
  await click(pa, '.rpg-tab', /Combate/); await sleep(200);
  ok(await click(pa, '.rpgtile .btn', /Começar combate/), 'mestra começa o combate pela aba');
  await sleep(500);
  await click(pa, '.rpgtile .btn', /Rolar iniciativas/); await sleep(600);
  await click(pb, '.rpg-tab', /Combate/); await sleep(300);
  const ord = await pb.evaluate(() => [...document.querySelectorAll('.rpg-ord')].map(e => e.innerText.replace(/\s+/g, ' ')));
  ok(ord.length === 2 && ord.every(t => /^\d+/.test(t)), 'jogador vê a ordem com as iniciativas', ord);
  await click(pa, '.rpgtile .btn', /Próximo turno/); await sleep(500);
  ok(await pb.$('.rpg-ord.cur') !== null, 'a vez aparece marcada');
  await pb.screenshot({ path: `${OUT}/04-combate.png` });

  // ---------- foco no campo da rolagem enquanto a mesa muda ----------
  await pb.focus('.rpg-expr'); await pb.$eval('.rpg-expr', e => { e.value = ''; }); await pb.keyboard.type('3d6');
  await rpg(pa, { op: 'combat.next' }); await sleep(600);
  const foc = await pb.evaluate(() => ({ f: document.activeElement?.classList.contains('rpg-expr'), v: document.querySelector('.rpg-expr').value }));
  ok(foc.f && foc.v === '3d6', 'campo da rolagem mantém foco e texto quando a mesa atualiza', foc);

  // ---------- fechar: só o mestre; reabrir traz tudo ----------
  await pb.evaluate(() => window.__lc.voice.send('ROOM_ACT', { act: 'rpg', on: false })); await sleep(500);
  ok(await pb.$('#stage .rpgtile') !== null, 'jogador não fecha a mesa');
  await pa.evaluate(() => window.__lc.voice.send('ROOM_ACT', { act: 'rpg', on: false })); await sleep(600);
  ok(await pb.$('#stage .rpgtile') === null, 'mestra fecha para todos');
  await pa.evaluate(() => window.__lc.voice.send('ROOM_ACT', { act: 'rpg', on: true })); await sleep(800);
  ok(/Bruk/.test(await st(pb)), 'reabrir traz a campanha de volta');
  await pa.screenshot({ path: `${OUT}/05-destaque.png` });
  ok(!errs.length, 'sem erros de página', errs);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
