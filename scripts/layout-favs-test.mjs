// Ajustes de layout pedidos nas críticas (servidor real + navegador):
// - Buscar em tudo é um painel próprio: fica aberto ao trocar de servidor e de canal, com a lista de canais à vista
// - Canais favoritos: canais de servidores diferentes juntos, em grupos seus, com a estrela na barra dos servidores
// - Lista oculta + microfone desligado: ícone de microfone riscado no avatar (clicável), não uma bolinha
// - Modo leve → Consumo: pico de processador/memória desde que o app abriu (app desktop simulado)
// Uso: BROWSER=/caminho/do/chrome node scripts/layout-favs-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3287, BASE = `http://localhost:${PORT}`, DATA = './.testdata-lf';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
let browser;
try {
  const r = await call('', 'POST', '/register', { username: 'mestre', password: 'senha123' }), tok = r.token;
  const g1 = await call(tok, 'POST', '/guilds', { name: 'Campanha' }), g2 = await call(tok, 'POST', '/guilds', { name: 'Artes' });
  const c1 = await call(tok, 'POST', `/guilds/${g1.id}/channels`, { name: 'resumos', type: 0 });
  const c2 = await call(tok, 'POST', `/guilds/${g2.id}/channels`, { name: 'personagens', type: 0 });
  await call(tok, 'POST', `/channels/${c1.id}/messages`, { content: 'Sessão 12: Thalia enfrenta o dragão' });
  await call(tok, 'POST', `/channels/${c2.id}/messages`, { content: 'Arte da Thalia com a armadura nova' });

  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.createBrowserContext(), P = await ctx.newPage();
  await P.setViewport({ width: 1440, height: 900 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    // app desktop simulado só com as métricas (pico de consumo)
    let n = 0;
    window.lcDesktop = { isDesktop: true, appMetrics: async () => { n++; const spike = n === 2; return [{ type: 'Browser', cpu: 4, mem: 90e6 }, { type: 'Tab', cpu: spike ? 160 : 12, mem: spike ? 600e6 : 250e6 }, { type: 'GPU', cpu: 3, mem: 120e6 }]; },
      setSettings: async () => true, getSettings: async () => ({}), setBadge: () => { }, setThrottle: () => { }, onHotkey: () => { }, getSources: async () => [] };
  }, tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g1.id, c1.id); await sleep(500);

  // ---- busca em painel próprio ----
  await P.evaluate(() => document.querySelector('#rail [data-fly="gs"]').click()); await sleep(300);
  await P.type('#gs-q', 'Thalia'); await sleep(1200);
  const s1 = await P.evaluate(() => ({ gs: !document.querySelector('#gsearch').classList.contains('hidden'), groups: document.querySelectorAll('#gsearch .gs-group').length, side: [...document.querySelectorAll('#side-list .ch .name')].map(x => x.textContent) }));
  ok(s1.gs && s1.groups === 2 && s1.side.includes('resumos'), 'busca aberta e a lista de canais continua à vista ao lado', s1);
  await P.evaluate((gid) => [...document.querySelectorAll('#rail .rail-wrap')].find(w => w.dataset.tip === 'Artes').querySelector('.rail-item').click(), g2.id); await sleep(600);
  const s2 = await P.evaluate(() => ({ gs: !document.querySelector('#gsearch').classList.contains('hidden'), q: document.querySelector('#gs-q')?.value, groups: document.querySelectorAll('#gsearch .gs-group').length, side: [...document.querySelectorAll('#side-list .ch .name')].map(x => x.textContent) }));
  ok(s2.gs && s2.q === 'Thalia' && s2.groups === 2 && s2.side.includes('personagens'), 'trocar de servidor não fecha a busca nem perde o resultado', s2);
  // abre um resultado: vai para a mensagem e a busca continua aberta (comparar)
  await P.evaluate(() => [...document.querySelectorAll('#gsearch .gs-group')].find(b => b.textContent.includes('Campanha')).click()); await sleep(900);
  await P.evaluate(() => document.querySelector('#gsearch .gs-msg').click()); await sleep(1200);
  const s3 = await P.evaluate((cid) => ({ gs: !document.querySelector('#gsearch').classList.contains('hidden'), view: window.__lc.S.view.cid === cid }), c1.id);
  ok(s3.gs && s3.view, 'abrir um resultado leva ao canal e a busca segue aberta', s3);
  await P.screenshot({ path: '.testshots/search-side.png' });
  await P.evaluate(() => document.querySelector('#gsearch .gs-head .sh-btn').click()); await sleep(200);
  ok(await P.evaluate(() => document.querySelector('#gsearch').classList.contains('hidden')), 'o X fecha o painel de busca');

  // ---- favoritos ----
  const fav = async (gid, cid) => { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), gid, cid); await sleep(400);
    await P.evaluate((cid) => { const row = [...document.querySelectorAll('#side-list .ch')].find(r => r.classList.contains('active')); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 })); }, cid); await sleep(150);
    await P.evaluate(() => [...document.querySelectorAll('.menu .it')].find(i => i.textContent === 'Adicionar aos favoritos').click()); await sleep(200); };
  await fav(g1.id, c1.id); await fav(g2.id, c2.id);
  ok(await P.evaluate(() => !!document.querySelector('#rail .fav-btn')), 'estrela de favoritos aparece na barra dos servidores');
  await P.evaluate(() => document.querySelector('#rail .fav-btn').click()); await sleep(500);
  const f1 = await P.evaluate(() => ({ head: document.querySelector('#side-head')?.textContent, rows: [...document.querySelectorAll('.favlist .favrow')].map(r => r.querySelector('.fn').textContent + '@' + r.querySelector('small').textContent) }));
  ok(/Favoritos/.test(f1.head) && f1.rows.join() === 'resumos@Campanha,personagens@Artes', 'Favoritos: canais de servidores diferentes juntos', f1);
  // grupo próprio + ordem
  await P.evaluate((a, b) => { window.__lc.moveFav(b, 'Thalia'); window.__lc.moveFav(a, 'Thalia', b); }, c1.id, c2.id); await sleep(300);
  const f2 = await P.evaluate(() => ({ cats: [...document.querySelectorAll('.favlist .fav-cat')].map(c => c.textContent), rows: [...document.querySelectorAll('.favlist .favrow .fn')].map(x => x.textContent), favs: window.__lc.S.prefs.favs }));
  ok(f2.cats.join() === 'Thalia' && f2.rows.join() === 'resumos,personagens' && f2.favs.every(f => f.g === 'Thalia'), 'grupo próprio com a ordem escolhida (fica na conta)', f2);
  // clicar num favorito de outro servidor mantém a lista de favoritos
  await P.evaluate(() => [...document.querySelectorAll('.favlist .favrow')][1].click()); await sleep(500);
  const f3 = await P.evaluate((cid) => ({ fav: window.__lc.S.favMode, cid: window.__lc.S.view.cid === cid, rows: document.querySelectorAll('.favlist .favrow').length, railActive: !!document.querySelector('#rail .rail-wrap.active .fav-btn') }), c2.id);
  ok(f3.fav && f3.cid && f3.rows === 2 && f3.railActive, 'abrir um favorito de outro servidor mantém a lista de favoritos', f3);
  await P.screenshot({ path: '.testshots/favorites.png' });
  // clicar no ícone do servidor volta para a lista normal dele
  await P.evaluate(() => [...document.querySelectorAll('#rail .rail-wrap')].find(w => w.dataset.tip === 'Campanha').querySelector('.rail-item').click()); await sleep(400);
  ok(await P.evaluate(() => !window.__lc.S.favMode && !document.querySelector('.favlist') && !!document.querySelector('#side-list .favmark')), 'ícone do servidor volta à lista do servidor (favoritos com estrelinha)');

  // ---- microfone desligado com a lista oculta ----
  await P.evaluate(async (cid) => { (await window.__lc.import('plugins.js')); document.getElementById('app').classList.add('hide-side'); }, c1.id);
  const vc = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2)?.id, g1.id);
  await P.evaluate((cid) => window.__lc.voice.join(cid), vc); await sleep(1500);
  await P.evaluate(() => window.__lc.voiceToggle('mute')); await sleep(400);
  const m1 = await P.evaluate(() => { const b = document.querySelector('.pb-av .pb-off'); return b && { svg: !!b.querySelector('svg'), w: b.getBoundingClientRect().width, visible: b.getBoundingClientRect().width > 0, title: b.title }; });
  ok(m1 && m1.svg && m1.visible && m1.w >= 20 && /Microfone desligado/.test(m1.title), 'lista oculta: microfone riscado no avatar (não uma bolinha)', m1);
  await P.screenshot({ path: '.testshots/mute-badge.png', clip: { x: 0, y: 800, width: 200, height: 100 } });
  await P.evaluate(() => document.querySelector('.pb-av .pb-off').click()); await sleep(400);
  ok(await P.evaluate(() => !window.__lc.voice.muted && !document.querySelector('.pb-av .pb-off')), 'clicar no ícone religa o microfone');
  await P.evaluate(() => window.__lc.voice.leave?.()); await sleep(300);

  // ---- pico de consumo ----
  await P.evaluate(() => window.__lc.openSettings('lite')); await P.waitForSelector('.usage .us-peak', { timeout: 8000 }); await sleep(2500);
  const u = await P.evaluate(() => ({ peak: [...document.querySelectorAll('.usage .us-pkt b')].map(b => b.textContent), when: document.querySelector('.usage .us-pkt small')?.textContent, rows: [...document.querySelectorAll('.usage .us-row:not(.us-hd) .us-pkc')].map(x => x.textContent), spark: !!document.querySelector('.usage .us-spark') }));
  const cores = await P.evaluate(() => navigator.hardwareConcurrency || 1);
  ok(u.peak[0] === (167 / cores).toFixed(1).replace('.', ',') + '%' && u.peak[1] === Math.round(810e6 / 1048576) + ' MB', 'pico de processador e de memória (o salto que já passou)', u.peak);
  ok(/^às \d\d:\d\d/.test(u.when || '') && u.rows.includes(Math.round(600e6 / 1048576) + ' MB') && u.spark, 'hora do pico, pico por parte do app e gráfico dos últimos minutos', u);
  await P.screenshot({ path: '.testshots/usage-peak.png' });
} catch (e) { console.log('ERRO', e); fails++; }
await browser?.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
