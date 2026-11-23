// Memória do grupo na Home (public/activity.js): "Nos últimos dias" (feed.events de verdade, por pessoa e jogo) e a faixa
// "Desde a última vez" (GET /api/activity/since, POST /api/activity/seen), mais o interruptor de privacidade
// "Guardar minhas sessões no histórico do grupo" (public/settings.js).
// As partidas são reais: Ana joga Valheim duas vezes numa sala de voz (as horas só contam em call) e Beto joga Hades fora
// de call, pelo app desktop simulado (window.lcDesktop.detectGame, como no pcactivity-test). As rotas da memória são
// interceptadas no navegador com respostas no formato do contrato (o servidor delas é feito à parte): sumido 5 h
// (aparece), sumido 1 h (não aparece) e servidor antigo (404: nada aparece e nada quebra).
// Uso: BROWSER=/caminho/do/chrome PORT=3720 RTC_PORT=41720 DATA_DIR=./.testdata-memhome node scripts/memory-home-test.mjs
//      (SHOTS=pasta salva capturas em 2x da Home larga e estreita)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3720), RTC_PORT = +(process.env.RTC_PORT || 41720), DATA = process.env.DATA_DIR || './.testdata-memhome', BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium');
const SHOTS = process.env.SHOTS || '';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; };
fs.rmSync(DATA, { recursive: true, force: true }); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT, RTC_IPS: '127.0.0.1', HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name, display) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', { display_name: display }); return { tok: r.token, id: me.id, name }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const GAMES = { valheim: { id: 'valheim', title: 'Valheim' }, hades: { id: 'hades', title: 'Hades' } };
async function page(u, vp = { width: 1440, height: 860 }) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ ...vp, deviceScaleFactor: SHOTS ? 2 : 1 });
  p.errs = []; p.on('pageerror', e => { console.log('  PAGEERROR', u.name, e.message); p.errs.push(e.message); });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t; window.__game = null; window.__gc = [];
    // app desktop simulado: o jogo aberto é window.__game; window.__setGame(g) troca e avisa na hora (onGameChanged)
    window.lcDesktop = { isDesktop: true, detectGame: async () => window.__game, onGameChanged: (f) => window.__gc.push(f), setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } };
    window.__setGame = (x) => { window.__game = x; for (const f of window.__gc) f(); };
  }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const shot = async (P, name) => { if (!SHOTS) return; await sleep(700); await P.screenshot({ path: `${SHOTS}/${name}.png` }); };
const texts = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
const playingIn = (P, uid) => P.evaluate((id) => [...window.__lc.S.activities.values()].some(a => a.user_id === id), uid);

// ---- "Desde a última vez" simulado (formato do contrato §4) ----
const H = 3600e3, dayAt = (offset, hh, mm = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hh, mm, 0, 0); return d.getTime(); };
let mode = 'full', sinceGets = 0; const seenPosts = [];
const sinceBody = (ctx) => ({
  since: Date.now() - (mode === 'short' ? 1 : 5) * H, away_ms: (mode === 'short' ? 1 : 5) * H,
  items: [
    { type: 'session', id: 's1', guild_id: ctx.gid, guild_name: 'Turma', channel_id: ctx.cid, channel_name: ctx.cname, channel_exists: true,
      started_at: dayAt(-1, 19, 50), ended_at: dayAt(-1, 22, 0), secs: 7800, members: [ctx.ana, ctx.beto], hidden: 1,
      games: [{ title: 'Counter-Strike 2', mins: 95, people: 3 }], clips: 2, event_id: null, intent_id: null },
    { type: 'event', id: 'e1', guild_id: ctx.gid, guild_name: 'Turma', title: 'Campeonato de CS', starts_at: dayAt(2, 21), created_at: Date.now() - 2 * H, game: 'Counter-Strike 2' },
    { type: 'clip', id: 'c1', guild_id: ctx.gid, channel_id: ctx.cid, author_id: ctx.ana, title: 'Ace no último round', url: '/files/x.mp4', created_at: Date.now() - 3 * H, views: 12 },
  ],
  users: [],
});
async function intercept(P, ctx) {
  await P.setRequestInterception(true);
  P.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (path === '/api/activity/since' || path === '/api/activity/seen') {
      if (mode === '404') return req.respond({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Não encontrado' }) });
      if (path === '/api/activity/since') { sinceGets++; return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(sinceBody(ctx)) }); }
      seenPosts.push(req.method()); return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ seen_at: Date.now() }) });
    }
    req.continue();
  });
}
const home = async (P) => { await P.evaluate(() => window.__lc.go('@me')); await P.waitForSelector('#active-now #actfeed'); };

try {
  const vito = await reg('vito', 'Vito'), ana = await reg('ana', 'Ana'), beto = await reg('beto', 'Beto');
  for (const o of [ana, beto]) { await call(vito.tok, 'POST', '/relationships', { username: o.name }); await call(o.tok, 'PUT', '/relationships/' + vito.id, {}); }
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const o of [vito, beto]) await call(o.tok, 'POST', '/invites/' + code);
  const A = await page(ana), B = await page(beto);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);

  // ---- partidas de verdade: Ana joga Valheim duas vezes em call; Beto joga Hades sem call ----
  await A.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.joinVoice(cid); }, g.id, vch.id);
  ok(await waitFor(() => A.evaluate(() => !!window.__lc.voice.active), 10000), 'Ana entra na sala de voz');
  // o servidor aceita um aviso de jogo a cada 3 s e ignora o que vier antes: o teste espera 3,4 s entre um aviso e outro e,
  // se a abertura caiu nessa janela (a primeira rodada da detecção é 3 s depois de conectar), avisa de novo
  const play = async (P, u, game, secs) => {
    let sent = 0;
    for (let i = 0; i < 4 && !(await playingIn(P, u.id)); i++) {
      await sleep(3400); await P.evaluate((x) => window.__setGame(x), game); sent = Date.now();
      await waitFor(() => playingIn(P, u.id), 3000);
    }
    ok(await playingIn(P, u.id), `${u.name} abre ${game.title}`);
    await sleep(Math.max(secs * 1000, 3400 - (Date.now() - sent))); await P.evaluate(() => window.__setGame(null));
    ok(await waitFor(async () => !(await playingIn(P, u.id)), 15000), `${u.name} fecha ${game.title}`);
  };
  await play(A, ana, GAMES.valheim, 4); await play(A, ana, GAMES.valheim, 4);
  await A.evaluate(() => window.__lc.voice.leave()); await sleep(500);
  await play(B, beto, GAMES.hades, 1);
  const feed = await call(vito.tok, 'GET', '/activity/feed');
  const stops = (uid, title) => feed.events.filter(e => e.kind === 'game_stop' && e.user_id === uid && e.game.title === title);
  const anaSecs = stops(ana.id, 'Valheim').reduce((s, e) => s + (e.seconds || 0), 0);
  ok(stops(ana.id, 'Valheim').length === 2 && anaSecs > 0, 'feed.events do servidor: 2 partidas de Valheim da Ana, com tempo em call', { n: stops(ana.id, 'Valheim').length, anaSecs });
  ok(stops(beto.id, 'Hades').length === 1, 'feed.events do servidor: 1 partida de Hades do Beto');

  // ---- Vito volta depois de 5 h ----
  const V = await page(vito, { width: 1440, height: 900 });
  const ctx = { gid: g.id, cid: vch.id, cname: vch.name, ana: ana.id, beto: beto.id };
  await intercept(V, ctx); await V.reload(); await V.waitForSelector('#rail .rail-wrap'); await home(V);
  ok(await waitFor(async () => (await texts(V, '#active-now .an-past')).length === 2), '"Nos últimos dias": uma linha por pessoa e jogo (2 partidas da Ana viram 1 linha)', await texts(V, '#active-now .an-past'));
  const past = await V.evaluate(() => [...document.querySelectorAll('#active-now .an-past')].map(r => ({ uid: r.dataset.uid, secs: +r.dataset.secs, t: r.innerText.replace(/\s+/g, ' ').trim() })));
  const pa = past.find(x => x.uid === ana.id), pb = past.find(x => x.uid === beto.id);
  ok(pa && pa.secs === anaSecs && /Ana/.test(pa.t) && /Jogou Valheim/.test(pa.t) && /hoje/.test(pa.t), 'linha da Ana soma o tempo das duas partidas e diz quando', { pa, anaSecs });
  ok(pb && /Beto/.test(pb.t) && /Jogou Hades/.test(pb.t), 'linha do Beto: Hades', pb);
  ok(await V.evaluate(() => !!document.querySelector('#actfeed .ansec[data-k="recent"] .an-past')), 'seção "Nos últimos dias" dentro do "Ativo agora"');
  ok(await V.evaluate(() => !!document.querySelector('#active-now .an-past .gicon') && !!document.querySelector('#active-now .an-past .an-av')), 'cada linha tem a foto da pessoa e o ícone do jogo');

  ok(await waitFor(() => V.evaluate(() => !!document.querySelector('#active-now .an-since'))), 'sumido 5 h: a faixa "Desde a última vez" aparece');
  // quem está online fazendo algo vem primeiro; a faixa "Desde a última vez" é uma seção do painel
  ok(await V.evaluate(() => !!document.querySelector('#actfeed .ansec[data-k="since"] .an-since')), 'a faixa "Desde a última vez" aparece no "Ativo agora"');
  const si = await texts(V, '#active-now .an-si');
  ok(si.length === 3, 'três itens: sessão, evento e clipe', si);
  ok(new RegExp(`Ana, Beto e \\+1 ficaram 2h10 na ${vch.name} jogando Counter-Strike 2 · 2 clipes`).test(si[0] || ''), 'sessão: "Ana, Beto e +1 ficaram 2h10 na sala jogando CS2 · 2 clipes"', si[0]);
  ok(/ontem 22h · Turma/.test(si[0] || '') && /Entrar na sala/.test(si[0] || ''), 'sessão: quando, servidor e "Entrar na sala"', si[0]);
  ok(/^Evento \S+ 21h: Campeonato de CS/.test(si[1] || '') && /Ver evento/.test(si[1] || ''), 'evento: dia, hora e "Ver evento"', si[1]);
  ok(/^Clipe mais visto: Ace no último round/.test(si[2] || '') && /de Ana · 12 visualizações/.test(si[2] || '') && /Ver clipe/.test(si[2] || ''), 'clipe: "Clipe mais visto" com autor, visualizações e "Ver clipe"', si[2]);
  ok(!(await V.evaluate(() => document.querySelector('#active-now .an-since').getAnimations({ subtree: true }).length)), 'a faixa aparece seca, sem animação');
  await shot(V, 'home-larga-faixa-e-ultimos-dias');

  // ---- tela estreita: o "Ativo agora" é gaveta; a faixa vai junto e o botão avisa ----
  await V.setViewport({ width: 700, height: 900, deviceScaleFactor: SHOTS ? 2 : 1 }); await sleep(400);
  ok(await V.evaluate(() => { const b = document.querySelector('#home .an-toggle'); return !!b && getComputedStyle(b).display !== 'none' && b.classList.contains('an-new'); }), 'estreita: o botão do "Ativo agora" aparece com o ponto de novidade');
  await V.click('#home .an-toggle'); await sleep(500);
  ok(await V.evaluate(() => { const s = document.querySelector('#home.an-open #active-now .an-since'); if (!s) return false; const r = s.getBoundingClientRect(); return r.width > 200 && r.left >= 0 && r.right <= innerWidth + 1 && r.top < innerHeight; }), 'estreita: a faixa aparece na gaveta, dentro da tela');
  await shot(V, 'home-estreita-gaveta-faixa');
  await V.evaluate(() => document.querySelector('#home .an-scrim')?.click());
  await V.setViewport({ width: 1440, height: 900, deviceScaleFactor: SHOTS ? 2 : 1 }); await sleep(400);

  // ---- Entrar na sala (a mesma entrada de voz do resto do app) ----
  ok(await V.evaluate(() => { const b = [...document.querySelectorAll('#active-now .an-si button')].find(x => x.textContent.trim() === 'Entrar na sala'); b?.click(); return !!b; }), 'clica em "Entrar na sala"');
  ok(await waitFor(() => V.evaluate((cid) => window.__lc.voice?.active && window.__lc.voice.channelId === cid, vch.id), 10000), 'entra na sala de voz da sessão');
  ok(await waitFor(async () => !/Entrar na sala/.test((await texts(V, '#active-now .an-si'))[0] || '')), 'já na sala: o botão some do item');
  await V.evaluate(() => window.__lc.voice.leave()); await sleep(500); await home(V);

  // ---- dispensar ----
  ok(await V.evaluate(() => { const b = document.querySelector('#active-now .an-sincex'); b?.click(); return !!b; }), 'clica em dispensar (X)');
  ok(await waitFor(() => V.evaluate(() => !document.querySelector('#active-now .an-since'))), 'a faixa some na hora');
  ok(await waitFor(async () => seenPosts.length === 1 && seenPosts[0] === 'POST'), 'dispensar chama POST /api/activity/seen uma vez', seenPosts);
  ok(await V.evaluate(() => !document.querySelector('#home .an-toggle')?.classList.contains('an-new')), 'e o ponto de novidade sai do botão da gaveta');

  // ---- sumido só 1 h: não aparece ----
  mode = 'short'; const g0 = sinceGets;
  await V.reload(); await V.waitForSelector('#rail .rail-wrap'); await home(V);
  ok(await waitFor(async () => sinceGets > g0 && (await texts(V, '#active-now .an-past')).length === 2), 'recarregou: o painel pediu /since e desenhou "Nos últimos dias"');
  await sleep(500);
  ok(await V.evaluate(() => !document.querySelector('#active-now .an-since')), 'sumido 1 h: a faixa NÃO aparece (precisa de 2 h)');

  // ---- servidor antigo (404): nada aparece e nada quebra ----
  mode = '404';
  await V.reload(); await V.waitForSelector('#rail .rail-wrap'); await home(V);
  ok(await waitFor(async () => (await texts(V, '#active-now .an-past')).length === 2), '404: "Nos últimos dias" continua');
  await sleep(500);
  ok(await V.evaluate(() => !document.querySelector('#active-now .an-since') && !document.querySelector('.toast.err, .toast.error')), '404: sem faixa e sem aviso de erro');
  mode = 'full';

  // ---- quem está jogando agora não se repete em "Nos últimos dias" ----
  await sleep(3300); await B.evaluate((x) => window.__setGame(x), GAMES.hades);
  ok(await waitFor(() => V.evaluate((id) => [...document.querySelectorAll('#active-now .an-play')].some(c => /Hades/.test(c.innerText)) && ![...document.querySelectorAll('#active-now .an-past')].some(r => r.dataset.uid === id), beto.id), 15000), 'Beto abre Hades de novo: aparece em "Jogando" e sai de "Nos últimos dias"');
  await sleep(3400); await B.evaluate(() => window.__setGame(null)); await sleep(400);

  // ---- todo mundo offline: "Nos últimos dias" no lugar do "Tudo quieto por aqui…" ----
  await A.browserContext().close(); await B.browserContext().close();
  mode = 'full'; await V.reload(); await V.waitForSelector('#rail .rail-wrap'); await home(V);
  ok(await waitFor(async () => (await texts(V, '#active-now .an-past')).length >= 2 && !(await V.evaluate(() => document.querySelector('#active-now .an-play')))), 'amigos offline: só "Nos últimos dias"', await texts(V, '#active-now .an-now'));
  ok(await V.evaluate(() => !/Tudo quieto/.test(document.querySelector('#active-now').innerText)), 'com algo dos últimos dias, o "Tudo quieto por aqui…" não aparece');
  await shot(V, 'home-larga-tudo-offline');
  await V.setViewport({ width: 700, height: 900, deviceScaleFactor: SHOTS ? 2 : 1 }); await sleep(300);
  await V.click('#home .an-toggle'); await sleep(500);
  await shot(V, 'home-estreita-gaveta-offline');
  await V.evaluate(() => document.querySelector('#home .an-scrim')?.click());
  await V.setViewport({ width: 1440, height: 900, deviceScaleFactor: SHOTS ? 2 : 1 });

  // ---- Configurações > Privacidade: "Guardar minhas sessões no histórico do grupo" ----
  const puts = []; V.on('request', (r) => { if (r.url().endsWith('/api/me/settings') && r.method() === 'PUT') puts.push(JSON.parse(r.postData() || '{}')); });
  await V.evaluate(() => window.__lc.openSettings('privacy')); await sleep(800);
  const sw = await V.evaluate(() => { const p = [...document.querySelectorAll('.perm')].find(x => /Guardar minhas sessões no histórico do grupo/.test(x.textContent)); return p ? { on: p.querySelector('.switch')?.classList.contains('on'), sub: p.innerText } : null; });
  ok(sw?.on === true, 'interruptor existe e vem ligado (padrão)', sw);
  ok(/quando e por quanto tempo/.test(sw?.sub || '') && /nunca entram/.test(sw?.sub || ''), 'subtítulo explica o que é guardado e que DMs ficam de fora', sw?.sub);
  if (SHOTS) { await V.evaluate(() => [...document.querySelectorAll('.perm')].find(x => /Guardar minhas sessões/.test(x.textContent))?.scrollIntoView({ block: 'center' })); await shot(V, 'config-privacidade-historico'); }
  await V.evaluate(() => [...document.querySelectorAll('.perm')].find(x => /Guardar minhas sessões/.test(x.textContent)).querySelector('.switch').click());
  ok(await waitFor(() => puts.some(b => b.privacy?.memory?.sessions === false)), 'desligar manda { privacy: { memory: { sessions: false } } }', puts);
  await sleep(300);
  const st = await call(vito.tok, 'GET', '/me/settings');
  if (st.privacy?.memory) ok(st.privacy.memory.sessions === false, 'GET das configurações: memory.sessions = false', st.privacy);
  else console.log('  nota  servidor desta branch ainda não guarda privacy.memory (é do agente servidor); conferido só o pedido. GET:', JSON.stringify(st.privacy));
  await V.keyboard.press('Escape');
  ok(V.errs.length === 0, 'nenhum erro de JavaScript na página do Vito', V.errs);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo'); process.exit(fails ? 1 : 0);
