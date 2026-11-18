// Watch Together de ponta a ponta: servidor real + 4 navegadores numa sala de voz (SFU), YouTube simulado
// (IFrame API falsa em scripts/watch-ytmock.js tocando vídeos locais; busca e oEmbed por uma API local no formato da
// YouTube Data API v3). Nada depende do YouTube de verdade. Capturas em .testshots/watch-*.png.
// Cobre: iniciar pelo lançador, entrar pelo quadro do palco, buscar/adicionar/link, sincronia de play/pause/posição
// entre navegadores, correção automática de deriva, Hosting x Sharing, permissões da fila, volume local, próximo
// automático, erro de incorporação com pulo automático, minimizar sem sair da chamada, recarregar a página
// (reconexão), anfitrião que sai, convite para assistir junto, Netflix com sincronização assistida e a voz intacta.
// Uso: BROWSER=/caminho/do/chrome node scripts/watch-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync('.testshots', { recursive: true });
const PORT = 3297, BASE = `http://localhost:${PORT}`, DATA = './.testdata-watch', MEDIA = './.testmedia-watch';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000, step = 200) => { const t = Date.now(); let v; while (Date.now() - t < ms) { try { v = await fn(); if (v) return v; } catch { } await sleep(step); } return v; };

// vídeos de teste (contador na imagem, tom no áudio)
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(path.join(MEDIA, 'v'), { recursive: true });
const vid = (id, secs, hz) => { const f = path.join(MEDIA, 'v', id + '.webm'); if (fs.existsSync(f)) return; execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=25:duration=${secs}`, '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-c:v', 'libvpx', '-b:v', '400k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libvorbis', '-shortest', f]); };
const IDS = { long: 'LONGvideo01', two: 'SECONDvid02', short: 'SHORTclip03', four: 'FOURTHvid04', rt: 'EMBEDOFFrt5' };
vid(IDS.long, 120, 440); vid(IDS.two, 90, 660); vid(IDS.short, 4, 880); vid(IDS.four, 60, 550);
const TITLES = { [IDS.long]: 'Gatos fazendo coisas (2 min)', [IDS.two]: 'Melhores lances da rodada', [IDS.short]: 'Clipe curtinho', [IDS.four]: 'Trailer do filme', [IDS.rt]: 'Vídeo que bloqueia incorporação', BLOCKEDvid9: 'Bloqueado pelo dono' };
// API local: ytmock.js, vídeos, YouTube Data API v3 (search/videos) e oEmbed
const media = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/ytmock.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); return res.end(fs.readFileSync('scripts/watch-ytmock.js')); }
  if (u.pathname.startsWith('/v/')) {
    const f = path.join(MEDIA, u.pathname); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(f).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) { const a = +m[1], b = m[2] ? +m[2] : size - 1; res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1, 'access-control-allow-origin': '*' }); return fs.createReadStream(f, { start: a, end: b }).pipe(res); }
    res.writeHead(200, { 'content-type': 'video/webm', 'content-length': size, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' }); return fs.createReadStream(f).pipe(res);
  }
  const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/yt/search') return json({ items: [IDS.long, IDS.two, IDS.four].map(id => ({ id: { videoId: id }, snippet: { title: TITLES[id] + ' — ' + u.searchParams.get('q'), channelTitle: 'Canal Teste', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } } })) });
  if (u.pathname === '/yt/videos') { const id = u.searchParams.get('id'); if (!TITLES[id]) return json({ items: [] }); return json({ items: [{ id, snippet: { title: TITLES[id], channelTitle: 'Canal Teste', thumbnails: {} }, contentDetails: { duration: id === IDS.short ? 'PT4S' : 'PT0S' }, status: { embeddable: id !== 'BLOCKEDvid9' } }] }); }
  res.writeHead(404); res.end();
});
await new Promise(r => media.listen(0, '127.0.0.1', r));
const MB = `http://127.0.0.1:${media.address().port}`;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41095', RTC_IPS: '127.0.0.1', YOUTUBE_API_KEY: 'teste', WATCH_YT_API: MB + '/yt', WATCH_HOST_GRACE_MS: '4000', WATCH_EMPTY_GRACE_MS: '30000' }, stdio: ['ignore', 'ignore', 'pipe'] });
let srvErr = ''; srv.stderr.on('data', d => (srvErr += d));
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => (await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })).token;
let browser;
const shot = async (P, name) => { await P.screenshot({ path: `.testshots/watch-${name}.png` }); console.log(`  📸 .testshots/watch-${name}.png`); };
try {
  const tok = { ana: await reg('ana'), beto: await reg('beto'), caio: await reg('caio'), duda: await reg('duda') };
  const g = await call(tok.ana, 'POST', '/guilds', { name: 'Resenha da Galera' });
  const code = (await call(tok.ana, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of ['beto', 'caio', 'duda']) await call(tok[u], 'POST', '/invites/' + code);
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const errs = [];
  const open = async (who, dsf = 1) => {
    const c = await browser.createBrowserContext(), p = await c.newPage();
    await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: dsf });
    p.on('pageerror', e => { errs.push(who + ': ' + e.message); console.log('  PAGEERROR', who, e.message); });
    await p.evaluateOnNewDocument((t, mb) => { localStorage.lc_token = t; window.__wtYtApi = mb + '/ytmock.js'; }, tok[who], MB);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); p.who = who; return p;
  };
  const A = await open('ana', 2), B = await open('beto'), C = await open('caio');
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  const enter = (P) => P.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc);
  for (const P of [A, B, C]) await enter(P);
  await sleep(1500);
  const W = (P) => P.evaluate(async () => { const s = (await window.__lc.import('watch.js')).watchState(); return JSON.parse(JSON.stringify(s)); });
  const cmd = (P, op, extra) => P.evaluate(async (op, extra) => { try { return await (await window.__lc.import('watch.js')).watchCmd(op, extra); } catch (e) { return { error: e.message, code: e.code }; } }, op, extra);
  const ptime = async (P) => (await W(P)).playerTime;
  // clique pela própria página: os controles são redesenhados a cada mudança de estado (o clique do puppeteer acha o
  // botão e, quando vai clicar, ele já foi trocado por outro)
  const tap = (P, sel) => P.$eval(sel, e => e.click());
  const voiceOk = (P) => P.evaluate(() => !!window.__lc.voice.active && window.__lc.voice.channelId != null);

  await A.evaluate(() => document.querySelector('.vchead button[title="Fechar chat"]')?.click()); await sleep(500); // Ana: palco largo (Beto fica com o chat aberto: layout estreito)
  // ---------- iniciar pelo lançador de atividades ----------
  console.log('— iniciar');
  for (let i = 0; i < 4 && !(await A.$('.actpop .act-card')); i++) { await A.click('.roundbtn.actbtn'); await A.waitForSelector('.actpop .act-card', { timeout: 2000 }).catch(() => { }); }
  if (!(await A.$('.actpop .act-card'))) await shot(A, 'falha-lancador');
  ok(await A.$$eval('.actpop .act-card b', els => els.map(e => e.textContent)).then(t => t[0].startsWith('Watch Together') && t.some(x => /Lousa/.test(x))), 'lançador de atividades lista Watch Together, lousa, código…');
  await shot(A, '01-lancador');
  await A.click('.actpop .act-card');
  await A.waitForSelector('#wt:not(.hidden) .wt-empty'); await sleep(400);
  let w = await W(A);
  ok(w.joined && w.sess.host === (await A.evaluate(() => window.__lc.S.me.id)) && w.sess.mode === 'hosting', 'Watch Together aberto: Ana é a anfitriã, modo Hosting');
  ok(await A.$eval('#stage', s => s.classList.contains('wt-cover')) && await A.$eval('#stage > .bar', b => getComputedStyle(b).visibility === 'visible'), 'cobre o palco e mantém a barra da chamada visível');
  await shot(A, '02-vazio');
  // Beto vê o quadro da atividade no palco e entra
  await B.waitForSelector('.tile.wttile button', { timeout: 8000 });
  await shot(B, '03-quadro-entrar');
  await B.click('.tile.wttile button');
  await B.waitForSelector('#wt:not(.hidden)');
  ok((await W(B)).joined, 'Beto entrou pelo quadro do palco');
  ok((await cmd(C, 'join')).members?.length === 3, 'Caio entrou (3 participantes)');

  // ---------- buscar e adicionar pela interface ----------
  console.log('— fila e busca');
  await tap(A, '.wt-tab:nth-child(2)'); // Adicionar
  await A.type('.wt-search', 'gatos', { delay: 60 });
  ok(await A.$eval('.wt-search', i => i.value === 'gatos' && document.activeElement === i), 'digitar na busca não perde o foco quando a lateral é redesenhada');
  await A.keyboard.press('Enter');
  await A.waitForSelector('.wt-res .wt-add', { timeout: 8000 }).catch(async (e) => { await shot(A, 'falha-busca'); throw e; });
  ok(await A.$$eval('.wt-res', r => r.length) === 3, 'busca mostra os resultados (YouTube Data API)');
  await shot(A, '04-busca');
  await tap(A, '.wt-res .wt-add');
  w = await until(async () => { const x = await W(A); return x.sess?.current && x.playerState === 'playing' && x; }, 12000);
  ok(w?.sess.current.ref === IDS.long && w.sess.current.title.startsWith('Gatos'), 'resultado adicionado e tocando sozinho', w?.sess?.current?.title);
  const tb = await until(async () => { const t = await ptime(B); return t > 1 && t; }, 10000);
  ok(tb > 1, 'o vídeo começou também para o Beto');
  // começa com som: antes o player ficava "não iniciado" e, depois de 5 s, a proteção tocava sem som
  await sleep(6000);
  const snd = await Promise.all([A, B].map(P => P.evaluate(() => { const p = window.__ytmock.players.at(-1); return { muted: p.isMuted(), playing: p.getPlayerState() === 1 }; })));
  ok(snd.every(x => !x.muted && x.playing) && !(await W(A)).autoplayBlocked && !(await W(B)).autoplayBlocked, 'o vídeo começa com som para todos (sem precisar mexer no volume)', snd);
  ok(await A.evaluate(() => window.__ytmock.players.at(-1).cc.on === false), 'legendas automáticas da conta ficam desligadas por padrão');
  await tap(A, '.wt-ccbtn');
  ok(await until(() => A.evaluate(() => { const c = window.__ytmock.players.at(-1).cc; return c.on && c.track === 'pt'; }), 3000), 'botão CC liga as legendas no idioma do aparelho');
  ok(await B.evaluate(() => window.__ytmock.players.at(-1).cc.on === false), 'legendas são só para quem ligou');
  await tap(A, '.wt-ccbtn');
  ok(await until(() => A.evaluate(() => window.__ytmock.players.at(-1).cc.on === false), 3000), 'botão CC desliga as legendas');
  // adicionar por link (Beto) e link duplicado
  ok(!(await cmd(B, 'add', { url: `https://youtu.be/${IDS.two}` })).error, 'Beto adiciona por link (todos podem adicionar no Hosting)');
  ok((await cmd(C, 'add', { url: `https://www.youtube.com/watch?v=${IDS.two}` })).code === 'duplicate', 'duplicado recusado');
  ok((await cmd(C, 'add', { url: `https://www.youtube.com/watch?v=BLOCKEDvid9` })).code === 'embed_blocked', 'vídeo que proíbe incorporação recusado na hora de adicionar');
  ok(!(await cmd(C, 'add', { url: `https://youtu.be/${IDS.four}` })).error, 'Caio adiciona outro');
  await sleep(1500);
  // sincronia entre navegadores
  // diferença de cada um para a posição da sala, medida dentro da própria página (no mesmo instante do relógio comum)
  const errs3 = async (Ps = [A, B, C]) => Promise.all(Ps.map(async P => (await W(P)).syncErr));
  const spread = async (Ps) => { const e = await errs3(Ps); return Math.max(...e.map(Math.abs)); };
  await until(async () => (await spread()) < 0.1, 8000, 300);
  let sp = await spread();
  ok(sp < 0.15, 'tocando sincronizado nos 3 navegadores (cada um a menos de 150 ms da sala)', +sp.toFixed(3));
  // 3 s seguidos sem sair da faixa (não basta encostar uma vez)
  let worst = 0; for (let i = 0; i < 10; i++) { worst = Math.max(worst, await spread()); await sleep(300); }
  ok(worst < 0.15, 'continua a menos de 150 ms por 3 s', +worst.toFixed(3));
  // diferença pequena (0,4 s) corrige pela velocidade, sem pular
  const f0 = (await W(C)).fixes, n0 = (await W(C)).nudges;
  await C.evaluate(() => { const v = document.querySelector('#wt video'); v.currentTime += 0.4; });
  ok(await until(async () => (await W(C)).nudges > n0, 4000), 'adiantado 0,4 s: ajusta a velocidade', (await W(C)).rate);
  ok(await until(async () => Math.abs((await W(C)).syncErr) < 0.1 && (await W(C)).rate === 1, 10000, 300) && (await W(C)).fixes === f0, 'alcançou a sala sem pular e voltou à velocidade normal', { err: (await W(C)).syncErr, fixes: (await W(C)).fixes - f0 });
  await tap(A, '.wt-tab:nth-child(1)'); await sleep(300);
  await shot(A, '05-tocando-fila');
  await tap(B, '.wt-tab:nth-child(3)'); await sleep(900);
  await shot(B, '06-pessoas');

  // ---------- Hosting ----------
  console.log('— Hosting e Sharing');
  const seqB = (await W(A)).lastSeq;
  await tap(B, '.wt-pp'); await sleep(600);
  ok((await W(A)).lastSeq === seqB && (await W(A)).sess.pb.status === 'playing', 'Hosting: o play/pause do Beto não muda nada para a sala');
  ok((await cmd(B, 'pause')).code === 'forbidden', 'Hosting: servidor recusa o pause do Beto');
  ok(await B.$('.wt-askbtn') !== null, '"Pedir controle" aparece para quem não controla');
  // pedir controle: a anfitriã recebe o pedido no topo e libera com um clique
  const betoId = await B.evaluate(() => window.__lc.S.me.id);
  await tap(B, '.wt-askbtn');
  ok(await until(() => A.$('.wt-askbar .wt-ask'), 4000), 'pedido de controle do Beto aparece para a anfitriã');
  await shot(A, '06b-pedido-controle');
  await A.evaluate(() => document.querySelector('.wt-askbar .wt-ask .btn').click());
  ok(await until(async () => (await W(B)).sess.controllers.includes(betoId) && !(await B.$('.wt-askbtn')), 4000) && !(await A.$('.wt-askbar .wt-ask')), '"Liberar": Beto passa a controlar e o pedido some');
  await tap(A, '.wt-tab:nth-child(3)'); await sleep(400);
  ok(await A.$('.wt-sw.on') !== null, 'em Pessoas, a chave "pode controlar" do Beto aparece ligada');
  await shot(A, '06c-pessoas-anfitria');
  await tap(A, '.wt-sw.on');
  ok(await until(async () => !(await W(B)).sess.controllers.includes(betoId), 4000), 'desligar a chave tira o controle do Beto');
  await tap(A, '.wt-tab:nth-child(1)'); await sleep(200);
  const caioItem = (await W(A)).sess.queue.find(q => q.ref === IDS.four);
  ok((await cmd(B, 'remove', { id: caioItem.id })).code === 'forbidden', 'Hosting: Beto não remove o item do Caio');
  await tap(A, '.wt-pp'); // Ana pausa pela interface
  await until(async () => (await W(C)).playerState === 'paused', 5000);
  await sleep(500);
  const pa = await Promise.all([A, B, C].map(ptime));
  ok((await W(C)).sess.pb.status === 'paused' && Math.max(...pa) - Math.min(...pa) < 0.08, 'anfitriã pausa: todos pausam no mesmo ponto (menos de 80 ms)', pa.map(x => +x.toFixed(3)));
  await shot(A, '07-pausado');
  await cmd(A, 'seek', { pos: 30 }); await sleep(1200);
  const ps = await Promise.all([A, B, C].map(ptime));
  ok(ps.every(t => Math.abs(t - 30) < 0.4), 'posição (30 s) aplicada a todos', ps.map(x => +x.toFixed(2)));
  await cmd(A, 'play'); await sleep(2500);
  await until(async () => (await spread()) < 0.1, 5000, 300);
  sp = await spread(); ok(sp < 0.15, 'play: voltam a tocar juntos (menos de 150 ms)', +sp.toFixed(3));
  // Sharing
  await A.evaluate(() => [...document.querySelectorAll('.wt-ctlsw button')].find(b => b.textContent === 'Todos').click()); await until(async () => (await W(B)).sess.mode === 'sharing', 4000);
  ok((await W(B)).sess.mode === 'sharing', 'anfitriã liga o Sharing pelo botão');
  await tap(B, '.wt-pp');
  ok(await until(async () => (await W(A)).sess.pb.status === 'paused' && (await W(A)).sess.pb.by === (await B.evaluate(() => window.__lc.S.me.id)), 5000), 'Sharing: Beto pausa para todos');
  await cmd(C, 'play'); await sleep(1800);
  ok((await W(A)).sess.pb.status === 'playing', 'Sharing: Caio dá play para todos');
  const its = (await W(A)).sess.queue;
  ok(!(await cmd(B, 'move', { id: its[1].id, to: 0 })).error && (await until(async () => (await W(C)).sess.queue[0].id === its[1].id, 3000)), 'Sharing: Beto reordena a fila');

  // ---------- deriva: o player do Caio sai de sincronia e é corrigido ----------
  console.log('— correção automática');
  await sleep(1000);
  const fix0 = (await W(C)).fixes;
  await C.evaluate(() => { const v = document.querySelector('#wt video'); v.currentTime = v.currentTime + 6; });
  const fixed = await until(async () => { const t = await Promise.all([A, C].map(ptime)); return Math.abs(t[0] - t[1]) < 0.6 && (await W(C)).fixes > fix0; }, 8000);
  ok(fixed, 'player adiantado 6 s volta sozinho para a posição da sala');
  await C.evaluate(() => { const v = document.querySelector('#wt video'); v.pause(); }); // pausa "por fora" (não é comando)
  await sleep(1500);
  ok((await W(A)).sess.pb.status === 'playing' && (await W(C)).playerState === 'playing', 'pause que não veio da interface não vira comando (sem eco) e o player volta a tocar');

  // ---------- arrastar o volume: o controle não fecha nem é recriado no meio do arraste ----------
  const vb = await A.$('.wt-volbox > .wt-cb'); const vbr = await vb.boundingBox();
  await A.mouse.move(vbr.x + vbr.width / 2, vbr.y + vbr.height / 2); await sleep(300);
  const vh = await A.$('.wt-vol'), vr = await vh.boundingBox();
  await A.mouse.move(vr.x + vr.width * 0.8, vr.y + vr.height / 2); await A.mouse.down();
  await cmd(A, 'seek', { pos: 12 }); // um comando da sala no meio do arraste redesenha os controles
  await A.mouse.move(vr.x + vr.width * 0.5, vr.y + vr.height / 2 + 40, { steps: 6 }); // e o mouse sai de cima do volume
  await sleep(500);
  const mid = await A.evaluate((el) => ({ alive: el.isConnected, open: el.parentElement.getBoundingClientRect().width > 40 }), vh);
  await A.mouse.move(vr.x + vr.width * 0.2, vr.y + vr.height / 2 + 40, { steps: 4 }); await A.mouse.up(); await sleep(300);
  const vEnd = (await W(A)).vol;
  ok(mid.alive && mid.open && vEnd < 40, 'arrastar o volume: o controle continua aberto e o mesmo durante o arraste', { ...mid, vol: vEnd });
  await A.evaluate(() => { const r = document.querySelector('.wt-vol'); r.value = 80; r.dispatchEvent(new Event('input', { bubbles: true })); });

  // ---------- player que não aceita velocidade fracionada: cai para pulos pequenos ----------
  await B.evaluate(() => { window.__ytmockRoundRates = true; });
  const fb0 = (await W(B)).fixes;
  await B.evaluate(() => { const v = document.querySelector('#wt video'); v.currentTime += 0.6; });
  ok(await until(async () => (await W(B)).fixes > fb0 && Math.abs((await W(B)).syncErr) < 0.25, 10000, 300), 'sem velocidade fracionada (YouTube arredondando): corrige pulando', { err: (await W(B)).syncErr });
  ok(await B.evaluate(() => document.querySelector('#wt video').playbackRate === 1), 'e volta para a velocidade normal');

  // ---------- tela cheia: vídeo no monitor inteiro, controles por cima ----------
  await A.evaluate(() => document.querySelector('.wt-cb[aria-label="Tela cheia"]').click()); await sleep(800);
  const fs1 = await A.evaluate(() => { const m = document.fullscreenElement, sb = document.querySelector('#wt .wt-stagebox').getBoundingClientRect(); return { fs: m?.classList.contains('wt-main'), h: sb.height, H: innerHeight, w: sb.width, W: innerWidth }; });
  ok(fs1.fs && Math.abs(fs1.h - fs1.H) < 2 && Math.abs(fs1.w - fs1.W) < 2, 'tela cheia: o vídeo ocupa a tela inteira (controles não tiram espaço)', fs1);
  await A.mouse.move(400, 300); await sleep(300);
  const vis = await A.evaluate(() => getComputedStyle(document.querySelector('#wt .wt-ctl')).opacity);
  await A.mouse.move(700, 200); await sleep(100); await sleep(3200);
  const hid = await A.evaluate(() => getComputedStyle(document.querySelector('#wt .wt-ctl')).opacity);
  ok(+vis > 0.5 && +hid === 0, 'controles aparecem com o mouse e somem parado', { vis, hid });
  await shot(A, '07b-tela-cheia');
  await A.evaluate(() => document.exitFullscreen()); await sleep(500);

  // ---------- volume local ----------
  await B.evaluate(() => { const r = document.querySelector('.wt-vol'); r.value = 10; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(300);
  const vols = await Promise.all([A, B].map(P => P.evaluate(() => document.querySelector('#wt video')?.volume)));
  ok(Math.abs(vols[1] - 0.1) < 0.01 && Math.abs(vols[0] - 0.8) < 0.01, 'volume é só local (Beto 10%, Ana continua 80%)', vols);

  // ---------- pular, próximo automático ----------
  console.log('— troca de conteúdo');
  await cmd(A, 'skip', { item_id: (await W(A)).sess.current.id });
  w = await until(async () => { const x = await W(B); return x.sess.current?.ref === IDS.four && x.playerState === 'playing' && x; }, 8000);
  ok(!!w, 'pular: próximo da fila toca para todos');
  ok(!(await cmd(A, 'add', { url: `https://youtu.be/${IDS.short}`, next: true })).error, 'adiciona um clipe curto como próximo');
  await cmd(A, 'skip', { item_id: (await W(A)).sess.current.id });
  ok(await until(async () => (await W(C)).sess.current?.ref === IDS.short, 6000), 'clipe curto tocando');
  ok(await until(async () => (await W(C)).sess.current?.ref === IDS.two, 12000), 'no fim do vídeo, o próximo da fila começa sozinho');

  // ---------- erro com pulo automático ----------
  console.log('— erros');
  await cmd(A, 'add', { url: `https://youtu.be/${IDS.rt}`, next: true });
  await cmd(A, 'skip', { item_id: (await W(A)).sess.current.id });
  ok(await until(async () => (await W(A)).error === 'yt_refused', 6000), 'player recusa (erro 150) um vídeo que o YouTube disse ser incorporável: mostra a causa certa');
  await A.waitForSelector('.wt-err'); await shot(A, '08-erro-incorporacao');
  ok(await A.$eval('.wt-err', e => /recusou tocar/.test(e.textContent) && /Abrir no YouTube/.test(e.textContent)), 'tela de erro explica e oferece ação');
  ok(await until(async () => (await W(A)).sess.current?.ref !== IDS.rt, 8000), 'todos com erro fatal: pula sozinho para o próximo');

  // ---------- minimizar sem sair da chamada ----------
  console.log('— minimizar');
  await cmd(A, 'add', { url: `https://youtu.be/${IDS.long}` });
  await A.evaluate(() => document.querySelector('.wt-hbtn[aria-label="Minimizar"]').click()); await sleep(500);
  ok(await A.$eval('#wt', e => e.classList.contains('mini')) && await voiceOk(A), 'minimizado: mini player e continua na chamada');
  ok(await A.$('.tile.wttile') !== null, 'palco volta a mostrar a chamada com o quadro "Abrir"');
  await shot(A, '09-minimizado');
  await until(async () => (await W(A)).playerState === 'playing' && (await ptime(A)) > 0.5, 8000);
  const tMini = await ptime(A); await sleep(1500);
  ok((await ptime(A)) > tMini + 1, 'vídeo continua tocando minimizado');
  // ir para outro canal (texto): o mini player continua
  const txt = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 0).id, g.id);
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, txt); await sleep(800);
  ok(await A.$eval('#wt', e => !e.classList.contains('hidden') && e.classList.contains('mini')) && await voiceOk(A), 'em outro canal: mini player e voz continuam');
  await shot(A, '10-mini-outro-canal');
  // arrastar o mini player pelo cabeçalho
  const r0 = await A.$eval('#wt', e => e.getBoundingClientRect().toJSON());
  await A.mouse.move(r0.x + 60, r0.y + 15); await A.mouse.down(); await A.mouse.move(r0.x - 300, r0.y - 200, { steps: 8 }); await A.mouse.up();
  const r1 = await A.$eval('#wt', e => e.getBoundingClientRect().toJSON());
  ok(Math.abs(r1.x - (r0.x - 360)) < 4 && Math.abs(r1.y - (r0.y - 215)) < 4, 'mini player arrastável pelo cabeçalho', { de: [r0.x, r0.y], para: [r1.x, r1.y] });
  await tap(A, '#wt .wt-expbtn'); await sleep(800); // expandir pelo próprio mini player: volta para a tela da chamada
  ok(await A.$eval('#wt', e => !e.classList.contains('mini')) && await A.evaluate((cid) => window.__lc.S.view.cid === cid, vc), 'expandir pelo mini player volta para a chamada com o Watch Together aberto');

  // ---------- reconexão: Beto recarrega a página ----------
  console.log('— reconexão');
  await B.reload(); await B.waitForSelector('#rail .rail-wrap');
  await enter(B);
  ok(await until(async () => (await W(B)).joined && (await W(B)).playerState === 'playing', 12000), 'Beto recarregou e voltou sozinho para o Watch Together');
  await sleep(2500);
  sp = Math.abs((await ptime(A)) - (await ptime(B)));
  await until(async () => (await spread([A, B])) < 0.1, 6000, 300); sp = await spread([A, B]);
  ok(sp < 0.15, 'reconectado já na posição da sala (menos de 150 ms)', +sp.toFixed(3));

  // ---------- convite para assistir junto ----------
  console.log('— convite');
  const D = await open('duda');
  await tap(A, '.wt-hbtn[title^="Convidar"]'); await A.waitForSelector('.wt-invpop .wt-invrow');
  await shot(A, '11-convidar');
  await A.evaluate(() => [...document.querySelectorAll('.wt-invrow')].find(r => /duda/i.test(r.textContent)).querySelector('button').click());
  await D.waitForSelector('#call-banner', { timeout: 8000 });
  ok(await D.$eval('#call-banner', e => /assistir junto/.test(e.textContent)), 'Duda recebe "chamou você para assistir junto"');
  await shot(D, '12-convite-recebido');
  await D.click('#call-banner .btn.green');
  ok(await until(async () => (await W(D)).joined && (await W(D)).playerState === 'playing', 15000), 'aceitar: entra na chamada e no Watch Together já tocando');
  await sleep(2000);
  await until(async () => (await spread([A, D])) < 0.1, 6000, 300);
  ok((await spread([A, D])) < 0.15, 'quem chegou depois está sincronizado (menos de 150 ms)', +(await spread([A, D])).toFixed(3));

  // ---------- anfitrião sai (fecha o app) ----------
  console.log('— anfitrião sai');
  const ids = Object.fromEntries(await Promise.all([['ana', A], ['beto', B]].map(async ([n, P]) => [n, await P.evaluate(() => window.__lc.S.me.id)])));
  await A.close(); // queda: espera o prazo para voltar
  ok(await until(async () => (await W(B)).sess.host !== ids.ana, 12000), 'anfitriã fechou o app: depois do prazo outra pessoa vira anfitriã');
  ok(await until(async () => (await W(B)).sess.members.find(m => m.id === ids.ana)?.online === false || !(await W(B)).sess.members.find(m => m.id === ids.ana), 3000), 'Ana aparece como desconectada');
  await shot(B, '13-novo-anfitriao');

  // ---------- Netflix: sincronização assistida ----------
  console.log('— serviço com DRM');
  const H = [B, C, D].find(async () => true);
  const host = (await W(B)).sess.host, HP = { [ids.beto]: B }[host] || (host === (await C.evaluate(() => window.__lc.S.me.id)) ? C : D);
  await cmd(HP, 'add', { url: 'https://www.netflix.com/watch/80100172', title: 'Stranger Things — T1:E1', next: true });
  await cmd(HP, 'skip', { item_id: (await W(HP)).sess.current.id });
  await B.waitForSelector('.wt-ext', { timeout: 8000 });
  ok(await B.$eval('.wt-ext', e => /Sincronização assistida/.test(e.textContent) && /própria conta/.test(e.textContent)), 'Netflix: painel de sincronização assistida, sem player integrado');
  ok((await W(B)).sess.pb.status === 'paused', 'começa pausado esperando a turma abrir na própria conta');
  await tap(B, '.wt-ready'); await sleep(1200);
  await shot(B, '14-netflix-assistido');
  await cmd(HP, 'play');
  await B.waitForSelector('.wt-ext .wt-count', { timeout: 3000 });
  await shot(B, '15-netflix-contagem');
  ok(await until(async () => B.$eval('.wt-ext', e => /Dê play agora/.test(e.textContent)), 6000), 'contagem 3-2-1 e "dê play agora" para todos');

  // ---------- link de vídeo (player HTML5) ----------
  console.log('— link de vídeo');
  ok(!(await cmd(HP, 'add', { url: MB + '/v/' + IDS.two + '.webm', service: 'file', next: true })).error, 'adiciona um link direto .webm');
  await cmd(HP, 'skip', { item_id: (await W(HP)).sess.current.id });
  ok(await until(async () => (await W(B)).sess.current?.service === 'file' && (await W(B)).playerState === 'playing' && (await W(C)).playerState === 'playing', 10000), 'link de vídeo toca integrado para todos');
  await sleep(2500);
  const fsp = Math.abs((await ptime(B)) - (await ptime(C)));
  await until(async () => (await spread([B, C])) < 0.1, 6000, 300);
  ok((await spread([B, C])) < 0.15, 'link de vídeo sincronizado (menos de 150 ms)', +(await spread([B, C])).toFixed(3));
  await shot(B, '16-link-de-video');

  // ---------- remover o vídeo atual com a fila vazia: o player sai da tela ----------
  console.log('— fila acabou');
  for (const q of (await W(HP)).sess.queue) await cmd(HP, 'remove', { id: q.id });
  await cmd(HP, 'remove', { id: (await W(HP)).sess.current.id });
  ok(await until(async () => !(await W(B)).sess.current && await B.$('.wt-empty') !== null, 5000), 'removeu o atual com a fila vazia: "A fila acabou"');
  ok(await B.evaluate(() => !document.querySelector('#wt .wt-player').children.length && !document.querySelector('#wt video, #wt iframe')), 'nenhum vídeo continua por trás da tela "A fila acabou"');
  await shot(B, '17-fila-acabou');

  // ---------- voz intacta ----------
  ok(await voiceOk(B) && await voiceOk(C) && await voiceOk(D), 'todos continuam na chamada de voz o tempo todo');
  ok(errs.length === 0, 'sem erros de JavaScript nas páginas', errs);
  void H;
} catch (e) { console.log('  EXCEÇÃO', e.stack); fails++; }
finally { await browser?.close().catch(() => { }); srv.kill(); media.close(); }
if (/Error|TypeError/.test(srvErr)) console.log('stderr do servidor:\n' + srvErr.slice(-2000));
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
