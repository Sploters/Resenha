// Watch Together: bugs relatados (regressão), com atraso de rede e o atraso do YouTube real simulados
// (window.__ytmockLag no scripts/watch-ytmock.js; mensagens do gateway atrasadas 60 ms).
//  - clicar na barra: o vídeo e a barra voltavam para a posição antiga antes de ir para o ponto clicado
//  - troca de vídeo no mesmo iframe: a duração (e a posição) do anterior eram usadas para o próximo
//  - fim do vídeo com a duração da sala maior que a real: voltava ao início sem parar
//  - sair do Watch Together: o quadro "Entrar" sumia do palco até sair e entrar de novo na chamada
// Uso: BROWSER=/caminho/do/chrome node scripts/watch-regress-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync('.testshots', { recursive: true });
const PORT = 3296, BASE = `http://localhost:${PORT}`, DATA = './.testdata-watchreg', MEDIA = './.testmedia-watch';
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
  if (u.pathname === '/yt/playlistItems') return u.searchParams.get('playlistId') !== 'PLtesteplaylist01' ? json({ error: {} }, 404)
    : json({ items: [IDS.four, IDS.long, IDS.two].map(id => ({ snippet: { title: TITLES[id], videoOwnerChannelTitle: 'Canal Teste', resourceId: { videoId: id }, thumbnails: {} }, status: { privacyStatus: 'public' } })) });
  if (u.pathname === '/yt/playlists') return json({ items: [{ snippet: { title: 'Playlist de teste' } }] });
  if (u.pathname === '/yt/videos') { const id = u.searchParams.get('id'); if (!TITLES[id]) return json({ items: [] }); return json({ items: [{ id, snippet: { title: TITLES[id], channelTitle: 'Canal Teste', thumbnails: {} }, contentDetails: { duration: id === IDS.short ? 'PT4S' : 'PT0S' }, status: { embeddable: id !== 'BLOCKEDvid9' } }] }); }
  res.writeHead(404); res.end();
});
await new Promise(r => media.listen(0, '127.0.0.1', r));
const MB = `http://127.0.0.1:${media.address().port}`;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '40995', RTC_IPS: '127.0.0.1', YOUTUBE_API_KEY: 'teste', WATCH_YT_API: MB + '/yt', CSP_EXTRA: MB, WATCH_HOST_GRACE_MS: '4000', WATCH_EMPTY_GRACE_MS: '30000' }, stdio: ['ignore', 'ignore', 'pipe'] });
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
    await p.evaluateOnNewDocument((t, mb) => { localStorage.lc_token = t; window.__wtYtApi = mb + '/ytmock.js'; window.__ytmockLag = 400; const snd = WebSocket.prototype.send; WebSocket.prototype.send = function (x) { setTimeout(() => snd.call(this, x), 60); }; }, tok[who], MB);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); p.who = who; return p;
  };
  const A = await open('ana', 2), B = await open('beto'), C = await open('caio');
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  const enter = (P) => P.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc);
  for (const P of [A, B]) await enter(P);
  await sleep(1500);
  const W = (P) => P.evaluate(async () => { const s = (await window.__lc.import('watch.js')).watchState(); return JSON.parse(JSON.stringify(s)); });
  const cmd = (P, op, extra) => P.evaluate(async (op, extra) => { try { return await (await window.__lc.import('watch.js')).watchCmd(op, extra); } catch (e) { return { error: e.message, code: e.code }; } }, op, extra);
  const ptime = async (P) => (await W(P)).playerTime;
  // clique pela própria página: os controles são redesenhados a cada mudança de estado (o clique do puppeteer acha o
  // botão e, quando vai clicar, ele já foi trocado por outro)
  const tap = (P, sel) => P.$eval(sel, e => e.click());
  await cmd(A, 'start', { service: 'youtube' }); await cmd(B, 'join');
  await cmd(A, 'add', { url: `https://youtu.be/${IDS.long}` });
  await cmd(A, 'add', { item: { service: 'youtube', url: `https://www.youtube.com/watch?v=${IDS.two}`, title: 'dois' } }); // sem duração: o player descobre
  await until(async () => (await ptime(A)) > 3, 15000);
  // sair do Watch Together: o quadro continua no palco (a sessão segue para os outros)
  const vis = (P) => P.evaluate(() => ({ wt: !document.querySelector('#wt')?.classList.contains('hidden'), tile: document.querySelector('.tile.wttile button')?.textContent || null }));
  await B.evaluate(() => document.querySelector('.wt-leave').click()); await sleep(1500);
  let v = await vis(B), wb = await W(B);
  ok(!v.wt && /Entrar no Watch Together/.test(v.tile || '') && wb.sess && !wb.joined, 'sair do Watch Together: o quadro "Entrar" continua no palco', { v, sess: !!wb.sess });
  await tap(B, '.tile.wttile button'); await sleep(1500); v = await vis(B);
  ok(v.wt && (await W(B)).joined, 'e dá para entrar de novo pelo quadro sem sair da chamada', v);
  // quem chega na sala depois vê o quadro e abre pelo lançador
  await enter(C); await sleep(2500);
  ok(/Entrar no Watch Together/.test((await vis(C)).tile || ''), 'quem entra na chamada depois vê o quadro do Watch Together');
  await C.click('.roundbtn.actbtn'); await C.waitForSelector('.actpop .act-tile'); await C.click('.actpop .act-tile'); await sleep(1500);
  ok((await vis(C)).wt && (await W(C)).joined, 'abrir pelo lançador entra e mostra o Watch Together');
  // 1) barra: clicar em 60 s
  const samples = await A.evaluate(async () => {
    const bar = document.querySelector('.wt-seek'); const d = 120; const out = [];
    bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    bar.value = 500; bar.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); bar.dispatchEvent(new Event('change', { bubbles: true }));
    const m = await window.__lc.import('watch.js');
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 50)); const b = document.querySelector('.wt-seek'); out.push([Math.round(+b.value / 1000 * d * 10) / 10, Math.round((m.watchState().playerTime || 0) * 10) / 10]); }
    return out;
  });
  const back = samples.filter(([b, p]) => b < 50 || p < 50);
  ok(!back.length, 'barra: depois do clique em 60 s nem a barra nem o vídeo voltam para trás', samples.map(x => x.join('/')).join(' '));
  await sleep(1500);
  const tb2 = await ptime(B); ok(tb2 > 59 && tb2 < 66, 'o pulo chegou ao Beto', tb2);
  // 2) próximo vídeo no mesmo iframe: duração não mistura
  await cmd(A, 'skip', { item_id: (await W(A)).sess.current.id });
  await until(async () => (await W(A)).sess.current?.ref === IDS.two && (await ptime(A)) > 1, 15000);
  await sleep(1500);
  const s2 = (await W(A)).sess.current;
  ok(Math.abs(s2.duration - 90) < 2, 'duração do 2º vídeo é a dele (90 s), não a do anterior (120 s)', s2.duration);
  const t2 = await ptime(A); ok(t2 < 10, 'o 2º vídeo começa do início (sem a posição do anterior)', t2);
  // 3) fim: sala acha que o vídeo é mais longo que o real (duração errada); não pode ficar voltando ao início
  await cmd(A, 'add', { item: { service: 'youtube', url: `https://www.youtube.com/watch?v=${IDS.short}`, title: 'curto', duration: 30 }, next: true });
  await A.evaluate(() => { window.__restarts = 0; window.__ytmock.players.forEach(p => { if (p.__h) return; p.__h = 1; let ended = false; p.v.addEventListener('ended', () => { ended = true; }); p.v.addEventListener('playing', () => { if (ended && p.v.currentTime < 1) window.__restarts++; ended = false; }); }); });
  await cmd(A, 'skip', { item_id: (await W(A)).sess.current.id });
  await until(async () => (await W(A)).sess.current?.ref === IDS.short, 8000);
  const adv = await until(async () => (await W(A)).sess.current?.ref !== IDS.short, 15000);
  const rs = await A.evaluate(() => window.__restarts);
  ok(adv && rs === 0, 'fim do vídeo: passa para o próximo sem voltar ao começo', { adv, rs, cur: (await W(A)).sess.current?.ref });
  // playlist do YouTube pela busca: link de um vídeo dentro da playlist → pergunta → playlist inteira, começando por ele
  await sleep(500); const q0 = (await W(A)).sess.queue.length;
  await tap(A, '.wt-tab:nth-child(2)');
  await A.$eval('.wt-search', (i, u) => { i.value = u; }, `https://www.youtube.com/watch?v=${IDS.two}&list=PLtesteplaylist01`);
  await A.$eval('.wt-search', i => i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await A.waitForSelector('.modal .mf button', { timeout: 5000 });
  ok(await A.$eval('.modal', m => /playlist/i.test(m.textContent) && /Só este vídeo/.test(m.textContent)), 'link de vídeo numa playlist: pergunta se é só o vídeo ou a playlist');
  await A.evaluate(() => [...document.querySelectorAll('.modal .mf button')].find(b => /Playlist inteira/.test(b.textContent)).click());
  const cur0 = (await W(A)).sess.current?.id || null;
  const qp = await until(async () => { const x = (await W(A)).sess; return (x.current?.id !== cur0 || x.queue.length > q0) && x.queue.length >= q0 + 2 && x; }, 10000);
  // fila vazia antes: o 1º da playlist já começa a tocar
  const added = qp ? [...(qp.current?.id !== cur0 ? [qp.current.ref] : []), ...qp.queue.slice(q0).map(x => x.ref)] : [];
  ok(added[0] === IDS.two && added.includes(IDS.four) && added.includes(IDS.long), 'playlist inteira na fila, começando pelo vídeo do link', added);
  if (errs.length) ok(false, 'erros na página', errs);
} catch (e) { console.log('ERRO', e); fails++; } finally { await browser?.close(); srv.kill(); media.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
