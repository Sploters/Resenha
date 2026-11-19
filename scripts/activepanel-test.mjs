// Painel "Ativo agora" (lado direito dos Amigos): o que os amigos fazem AGORA no topo e, embaixo, a retrospectiva da semana
// ("A semana da galera": jogo da semana + 2º e 3º; "Clipes da semana": ranking ponderado de server/clipstats.js).
// O histórico é gravado direto no banco (dias anteriores) com o servidor parado; depois o servidor sobe e o painel é conferido.
// Uso: BROWSER=/caminho/do/chrome node scripts/activepanel-test.mjs   (SHOTS=1 salva capturas em .testshots/)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const PORT = 3281, BASE = `http://localhost:${PORT}`, DATA = './.testdata-panel';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
let srv;
const start = async () => { srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', TZ: 'America/Sao_Paulo' }, stdio: 'ignore' }); for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(200); } } };
const stop = () => new Promise(r => { srv.once('exit', r); srv.kill(); });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, n }; };

await start();
const U = {}; for (const n of ['eu', 'ana', 'beto', 'caio', 'zeca']) U[n] = await reg(n);
for (const n of ['ana', 'beto', 'caio']) { await call(U.eu.tok, 'POST', '/relationships', { username: n }); await call(U[n].tok, 'PUT', '/relationships/' + U.eu.id, {}); }
const g = await call(U.eu.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(U.eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const n of ['ana', 'beto', 'caio', 'zeca']) await call(U[n].tok, 'POST', '/invites/' + code);
await call(U.caio.tok, 'PATCH', '/activity/pc', { visibility: 'off' }); // caio esconde o que joga
await stop();

// ---- histórico (dias anteriores) ----
const db = new DatabaseSync(DATA + '/resenha.db'), D = 864e5, H = 3600e3, now = Date.now();
const day = (n, hour = 21) => { const d = new Date(now - n * D); d.setHours(hour, 0, 0, 0); return Math.min(d.getTime(), now - 60e3); };
let nid = 1; const ins = (uid, kind, game, title, at, data, platform = 'pc') => db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)').run('t' + nid++, uid, platform, kind, game, title, data ? JSON.stringify(data) : null, at);
const session = (uid, game, title, at, secs, platform, extra = null) => { ins(uid, 'game_start', game, title, at - secs * 1000, extra, platform); ins(uid, 'game_stop', game, title, at, { seconds: secs, ...extra }, platform); };
session(U.ana.id, 'peak', 'PEAK', now - 20 * D, 3600);                       // histórico antigo (fora da semana)
session(U.ana.id, 'hades', 'Hades', day(2, 23), 4 * 3600 + 20 * 60);          // maratona de uma pessoa só
for (const n of [1, 3, 4, 6]) session(U.beto.id, 'cs2', 'Counter-Strike 2', day(n, 22), 45 * 60, 'pc', { steam: '730' }); // vários dias (jogo da Steam)
for (const n of [2, 3]) session(U.ana.id, 'cs2', 'Counter-Strike 2', day(n, 20), 60 * 60, 'pc', { steam: '730' }); // ana também: CS2 é da galera
session(U.beto.id, 'peak', 'PEAK', day(1, 15), 10 * 60);                       // curtinha: insignificante, fica de fora
session(U.ana.id, 'stardew', 'Stardew Valley', day(1, 18), 70 * 60);            // 4º lugar: fora do top 3
session(U.beto.id, 'stardew', 'Stardew Valley', day(1, 19), 20 * 60);
session(U.caio.id, 'eldenring', 'ELDEN RING', day(1, 20), 9 * 3600);            // caio escondeu: não aparece
session(U.zeca.id, 'dota2', 'Dota 2', day(1, 20), 9 * 3600);                    // não é amigo: não aparece
const ch = db.prepare('SELECT id FROM channels WHERE guild_id=? AND type=0').get(g.id);
const clip = (id, author, streamer, title, at) => db.prepare('INSERT INTO clips(id,guild_id,channel_id,message_id,author_id,streamer_id,title,url,size,secs,has_audio,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(id, g.id, ch.id, null, author, streamer, title, '/files/aaaaaaaaaaaaaaaaaaaaaaaa.webm/x.webm', 1000, 30, 1, at);
// visualização qualificada (assistiu de verdade: server/clipstats.js), com o % do clipe que a pessoa viu
const view = (cid, uid, at = now - H, comp = 0.9) => db.prepare('INSERT INTO clip_views(clip_id,user_id,at,watch_ms,completion,qualified_at) VALUES(?,?,?,?,?,?)').run(cid, uid, at, Math.round(comp * 30000), comp, at);
clip('clip1', U.ana.id, U.beto.id, 'Ace no último round', day(1, 23)); for (const u of ['beto', 'caio', 'zeca']) view('clip1', U[u].id);
for (const u of ['beto', 'caio']) db.prepare('INSERT INTO clip_likes(user_id,clip_id,at) VALUES(?,?,?)').run(U[u].id, 'clip1', now - H); db.prepare('INSERT INTO clip_favs VALUES(?,?)').run(U.beto.id, 'clip1');
clip('clip2', U.beto.id, U.eu.id, 'Clutch do eu', day(2, 21)); for (const u of ['ana', 'caio', 'zeca']) view('clip2', U[u].id, now - 3 * D, 0.6);  // você aparece
clip('clip3', U.caio.id, null, 'Ninguém viu', day(1, 10)); view('clip3', U.ana.id);                                                // sem engajamento: fora
clip('clip4', U.zeca.id, null, 'Clipe antigo', now - 9 * D); for (const u of ['ana', 'beto', 'caio']) view('clip4', U[u].id);   // fora da semana
db.close();
await start();

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
async function page(u, game, w = 1440) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
  await p.evaluateOnNewDocument((t, game) => { localStorage.lc_token = t; if (game) window.lcDesktop = { isDesktop: true, detectGame: async () => game, setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } }; }, u.tok, game);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
try {
  const ana = await page(U.ana, { id: 'valorant-win64-shipping', title: 'VALORANT' });
  await sleep(3800);
  const me = await page(U.eu); await me.evaluate(() => window.__lc.go('@me')); await sleep(2500);
  const tabs = await me.evaluate(() => [...document.querySelectorAll('#home #topbar .tab')].map(t => t.textContent.trim()));
  ok(!tabs.includes('Atividade'), 'a aba "Atividade" saiu', tabs);
  const P = await me.evaluate(() => {
    const b = document.querySelector('#active-now'), t = (e) => e?.innerText.replace(/\s+/g, ' ').trim();
    return { title: b?.querySelector('h3')?.textContent, caps: [...b.querySelectorAll('.an-cap')].map(e => e.textContent), play: [...b.querySelectorAll('.an-now .an-card.an-play')].map(t),
      heads: [...b.querySelectorAll('.wk-h h4')].map(e => e.textContent), hero: t(b.querySelector('.wk-hero')), bars: b.querySelectorAll('.wk-hero .wk-bar').length, barsOn: b.querySelectorAll('.wk-hero .wk-bar.on').length,
      rows: [...b.querySelectorAll('.wk-row')].map(t), clips: [...b.querySelectorAll('.wk-clips .wk-clip')].map(t), recs: [...b.querySelectorAll('.wk-recs .wk-clip')].map(t), big: !!b.querySelector('.wk-clip.big .wk-thumb'), old: !!b.querySelector('.hl-item') };
  });
  ok(P.title === 'Ativo agora', 'título em português: "Ativo agora"', P.title);
  ok(P.caps[0] === 'Jogando — 1' && /ana/.test(P.play[0] || '') && /VALORANT/.test(P.play[0] || ''), 'no topo, em destaque: quem está jogando agora', P.play);
  ok(P.heads.join('|') === 'A semana da galera|Clipes da semana|Recomendados pra você' && !P.old, 'seções: "A semana da galera", "Clipes da semana" e "Recomendados pra você" (sem o feed de eventos)', P.heads);
  ok(P.recs.some(r => /Ninguém viu/.test(r) && /amigo/.test(r)) && !P.recs.some(r => /Ace no último|Clutch do eu/.test(r)), 'recomendados: o que não está no ranking, com o motivo (sem repetir clipe)', P.recs);
  ok(/Jogo da semana/.test(P.hero) && /Counter-Strike 2/.test(P.hero) && /5h de jogo/.test(P.hero) && /2 pessoas/.test(P.hero) && /4 dias seguidos/.test(P.hero), 'jogo da semana: o de mais gente e horas (CS2), com horas, pessoas e dias seguidos', P.hero);
  ok(P.bars === 7 && P.barsOn === 5, 'a semana em 7 barrinhas (dias com partida acesos)', { bars: P.bars, on: P.barsOn });
  ok(P.rows.length === 2 && /^2 Stardew Valley 1,5h · 2 pessoas/.test(P.rows[0]) && /^3 Hades 4,3h · 1 pessoa/.test(P.rows[1]), '2º e 3º em linhas compactas (jogar junto pesa mais que horas sozinho)', P.rows);
  ok(!P.rows.concat(P.hero).some(x => /PEAK|ELDEN|Dota|VALORANT/.test(x)), 'fora: insignificante (PEAK 10 min), escondido (caio), não amigo (zeca) e o que só começou agora', P.rows);
  ok(P.clips.length === 2 && /Ace no último round/.test(P.clips[0]) && /Clutch do eu/.test(P.clips[1]) && !P.clips.some(c => /Ninguém viu|antigo/.test(c)) && P.big, 'clipes da semana: só os com engajamento, o 1º grande com miniatura', P.clips);
  ok(/Clipe da semana/.test(P.clips[0]) && /ana/.test(P.clips[0]) && / 3 2 0 90%$/.test(P.clips[0]), 'clipe da semana: autor e métricas (3 visualizações, 2 curtidas, 0 compartilhamentos, 90% assistido)', P.clips[0]);
  ok(/Você aparece/.test(P.clips[1]), 'categoria personalizada: "Você aparece" (clipe da sua transmissão)', P.clips[1]);
  if (process.env.SHOTS) { await me.screenshot({ path: '.testshots/activepanel-wide.png' }); const el = await me.$('#active-now'); await el.screenshot({ path: '.testshots/activepanel-panel.png' }); await me.evaluate(() => { const b = document.querySelector('#active-now'); b.scrollTop = b.scrollHeight; }); await sleep(300); await el.screenshot({ path: '.testshots/activepanel-clips.png' }); await me.evaluate(() => { document.querySelector('#active-now').scrollTop = 0; }); }
  // ana parou de jogar: sai do topo na hora
  await ana.close(); await sleep(1200);
  ok(await me.evaluate(() => !document.querySelector('#active-now .an-play')), 'parou de jogar: some do "agora" na hora');
  // clicar no clipe abre o player em popup, sem sair do painel (abrir e fechar não conta visualização; marca como visto)
  await me.evaluate(() => document.querySelector('#active-now .wk-clip.big').click()); await sleep(900);
  const clipPop = await me.evaluate(() => { const m = document.querySelector('.modal.clipmodal'); return m && { title: m.querySelector('.pttl')?.textContent, src: m.querySelector('video')?.getAttribute('src'), btns: [...m.querySelectorAll('.pbtns .btn')].map(b => b.textContent.trim()), view: window.__lc.S.view.kind }; });
  ok(clipPop?.title === 'Ace no último round' && /aaaaaaaa/.test(clipPop.src || '') && clipPop.view !== 'clips', 'clicar no clipe abre o player em popup (continua no painel)', clipPop);
  ok(clipPop?.btns.includes('Ver na galeria') && clipPop.btns.includes('Baixar'), 'popup do clipe: Ver na galeria e Baixar', clipPop?.btns);
  await me.evaluate(() => document.querySelector('.modal.clipmodal .inv-x').click()); await sleep(300);
  const wk = await call(U.eu.tok, 'GET', '/activity/feed');
  ok(wk.week.clips.find(c => c.id === 'clip1')?.metrics.views === 3 && wk.week.clips.find(c => c.id === 'clip1')?.seen, 'abrir e fechar não conta visualização (só assistir de verdade), mas marca como visto', wk.week.clips.map(c => [c.id, c.metrics.views]));
  // clicar no jogo da semana abre o popup do jogo (Steam: botão para a loja; amigos que jogaram)
  await me.evaluate(() => document.querySelector('#active-now .wk-hero').click()); await sleep(900);
  const gp = await me.evaluate(() => { const m = document.querySelector('.modal.gamemodal'); return m && { title: m.querySelector('h2')?.textContent, steam: m.querySelector('a.gm-steam')?.getAttribute('href'), people: [...m.querySelectorAll('.gm-person')].map(p => p.innerText.replace(/\s+/g, ' ')) }; });
  ok(gp?.title === 'Counter-Strike 2' && gp.steam === 'https://store.steampowered.com/app/730/', 'jogo da Steam: popup com o nome e "Ver na Steam" (loja do jogo)', gp);
  ok(gp?.people.some(t => /beto/.test(t) && /3h esta semana/.test(t) && /2 dias seguidos/.test(t)), 'popup do jogo: quais amigos jogaram e quanto na semana', gp?.people);
  if (process.env.SHOTS) await me.screenshot({ path: '.testshots/activepanel-gamepop.png' });
  await me.evaluate(() => document.querySelector('.modal.gamemodal .gm-x').click()); await sleep(300);
  await me.evaluate(() => [...document.querySelectorAll('#active-now .wk-row')].find(r => /Hades/.test(r.textContent)).click()); await sleep(700);
  const gp2 = await me.evaluate(() => { const m = document.querySelector('.modal.gamemodal'); return m && { title: m.querySelector('h2')?.textContent, steam: !!m.querySelector('a.gm-steam'), ph: !!m.querySelector('.gm-ph') }; });
  ok(gp2?.title === 'Hades' && !gp2.steam && gp2.ph, 'jogo fora da Steam: popup sem botão da loja, com o ícone', gp2);
  await me.evaluate(() => document.querySelector('.modal.gamemodal .gm-x').click()); await sleep(300);
  // o autor do clipe abre o perfil (não o player)
  await me.evaluate(() => document.querySelector('#active-now .wk-clip .wk-who').click()); await sleep(600);
  ok(await me.evaluate(() => !!document.querySelector('.pcard') && !document.querySelector('.modal.clipmodal')), 'clicar no autor abre o perfil');
  await me.keyboard.press('Escape'); await sleep(300);
  // janela estreita: o painel vira gaveta
  const narrow = await page(U.eu, null, 980); await narrow.evaluate(() => window.__lc.go('@me')); await sleep(1500);
  const before = await narrow.evaluate(() => { const r = document.querySelector('#active-now').getBoundingClientRect(); return { left: Math.round(r.left), vis: getComputedStyle(document.querySelector('.an-toggle')).display }; });
  await narrow.evaluate(() => document.querySelector('.an-toggle').click()); await sleep(500);
  const after = await narrow.evaluate(() => Math.round(document.querySelector('#active-now').getBoundingClientRect().right));
  ok(before.vis !== 'none' && before.left >= 980 && after <= 981, 'janela estreita: botão abre a gaveta "Ativo agora"', { before, after });
  if (process.env.SHOTS) await narrow.screenshot({ path: '.testshots/activepanel-narrow.png' });
  await narrow.evaluate(() => document.querySelector('.an-scrim').click()); await sleep(400);
  ok(await narrow.evaluate(() => !document.querySelector('#home').classList.contains('an-open')), 'clicar fora fecha a gaveta');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); await stop();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
