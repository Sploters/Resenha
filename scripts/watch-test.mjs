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
  const voiceOk = (P) => P.evaluate(() => !!window.__lc.voice.active && window.__lc.voice.channelId != null);

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
  await A.click('.wt-tab:nth-child(2)'); // Adicionar
  await A.type('.wt-search', 'gatos'); await A.keyboard.press('Enter');
  await A.waitForSelector('.wt-res .wt-add', { timeout: 8000 }).catch(async (e) => { await shot(A, 'falha-busca'); throw e; });
  ok(await A.$$eval('.wt-res', r => r.length) === 3, 'busca mostra os resultados (YouTube Data API)');
  await shot(A, '04-busca');
  await A.click('.wt-res .wt-add');
  w = await until(async () => { const x = await W(A); return x.sess?.current && x.playerState === 'playing' && x; }, 12000);
  ok(w?.sess.current.ref === IDS.long && w.sess.current.title.startsWith('Gatos'), 'resultado adicionado e tocando sozinho', w?.sess?.current?.title);
  const tb = await until(async () => { const t = await ptime(B); return t > 1 && t; }, 10000);
  ok(tb > 1, 'o vídeo começou também para o Beto');
  // adicionar por link (Beto) e link duplicado
  ok(!(await cmd(B, 'add', { url: `https://youtu.be/${IDS.two}` })).error, 'Beto adiciona por link (todos podem adicionar no Hosting)');
  ok((await cmd(C, 'add', { url: `https://www.youtube.com/watch?v=${IDS.two}` })).code === 'duplicate', 'duplicado recusado');
  ok((await cmd(C, 'add', { url: `https://www.youtube.com/watch?v=BLOCKEDvid9` })).code === 'embed_blocked', 'vídeo que proíbe incorporação recusado na hora de adicionar');
  ok(!(await cmd(C, 'add', { url: `https://youtu.be/${IDS.four}` })).error, 'Caio adiciona outro');
  await sleep(1500);
  // sincronia entre navegadores
  const spread = async () => { const t = await Promise.all([A, B, C].map(ptime)); return Math.max(...t) - Math.min(...t); };
  let sp = await spread();
  ok(sp < 0.8, 'tocando sincronizado nos 3 navegadores (diferença < 0,8 s)', +sp.toFixed(2));
  await A.click('.wt-tab:nth-child(1)'); await sleep(300);
  await shot(A, '05-tocando-fila');
  await B.click('.wt-tab:nth-child(3)'); await sleep(900);
  await shot(B, '06-pessoas');

  // ---------- Hosting ----------
  console.log('— Hosting e Sharing');
  const seqB = (await W(A)).lastSeq;
  await B.click('.wt-pp'); await sleep(600);
  ok((await W(A)).lastSeq === seqB && (await W(A)).sess.pb.status === 'playing', 'Hosting: o play/pause do Beto não muda nada para a sala');
  ok((await cmd(B, 'pause')).code === 'forbidden', 'Hosting: servidor recusa o pause do Beto');
  ok(await B.$('.wt-locked') !== null, 'cadeado aparece para quem não controla');
  const caioItem = (await W(A)).sess.queue.find(q => q.ref === IDS.four);
  ok((await cmd(B, 'remove', { id: caioItem.id })).code === 'forbidden', 'Hosting: Beto não remove o item do Caio');
  await A.click('.wt-pp'); // Ana pausa pela interface
  await until(async () => (await W(C)).playerState === 'paused', 5000);
  await sleep(500);
  const pa = await Promise.all([A, B, C].map(ptime));
  ok((await W(C)).sess.pb.status === 'paused' && Math.max(...pa) - Math.min(...pa) < 0.3, 'anfitriã pausa: todos pausam no mesmo ponto', pa.map(x => +x.toFixed(2)));
  await shot(A, '07-pausado');
  await cmd(A, 'seek', { pos: 30 }); await sleep(1200);
  const ps = await Promise.all([A, B, C].map(ptime));
  ok(ps.every(t => Math.abs(t - 30) < 0.4), 'posição (30 s) aplicada a todos', ps.map(x => +x.toFixed(2)));
  await cmd(A, 'play'); await sleep(2500);
  sp = await spread(); ok(sp < 0.8, 'play: voltam a tocar juntos', +sp.toFixed(2));
  // Sharing
  await A.click('.wt-mode'); await until(async () => (await W(B)).sess.mode === 'sharing', 4000);
  ok((await W(B)).sess.mode === 'sharing', 'anfitriã liga o Sharing pelo botão');
  await B.click('.wt-pp');
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
  ok(await until(async () => (await W(A)).error === 'embed_blocked', 6000), 'player relata incorporação bloqueada');
  await A.waitForSelector('.wt-err'); await shot(A, '08-erro-incorporacao');
  ok(await A.$eval('.wt-err', e => /fora do YouTube/.test(e.textContent) && /Abrir no YouTube/.test(e.textContent)), 'tela de erro explica e oferece ação');
  ok(await until(async () => (await W(A)).sess.current?.ref !== IDS.rt, 8000), 'todos com erro fatal: pula sozinho para o próximo');

  // ---------- minimizar sem sair da chamada ----------
  console.log('— minimizar');
  await cmd(A, 'add', { url: `https://youtu.be/${IDS.long}` });
  await A.click('.wt-hbtn[aria-label="Minimizar"]'); await sleep(500);
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
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vc); await sleep(500);
  await A.click('.tile.wttile button'); await sleep(500);
  ok(await A.$eval('#wt', e => !e.classList.contains('mini')), 'abrir de novo pelo quadro');

  // ---------- reconexão: Beto recarrega a página ----------
  console.log('— reconexão');
  await B.reload(); await B.waitForSelector('#rail .rail-wrap');
  await enter(B);
  ok(await until(async () => (await W(B)).joined && (await W(B)).playerState === 'playing', 12000), 'Beto recarregou e voltou sozinho para o Watch Together');
  await sleep(2500);
  sp = Math.abs((await ptime(A)) - (await ptime(B)));
  ok(sp < 0.8, 'reconectado já na posição da sala', +sp.toFixed(2));

  // ---------- convite para assistir junto ----------
  console.log('— convite');
  const D = await open('duda');
  await A.click('.wt-hbtn[title^="Convidar"]'); await A.waitForSelector('.wt-invpop .wt-invrow');
  await shot(A, '11-convidar');
  await A.evaluate(() => [...document.querySelectorAll('.wt-invrow')].find(r => /duda/i.test(r.textContent)).querySelector('button').click());
  await D.waitForSelector('#call-banner', { timeout: 8000 });
  ok(await D.$eval('#call-banner', e => /assistir junto/.test(e.textContent)), 'Duda recebe "chamou você para assistir junto"');
  await shot(D, '12-convite-recebido');
  await D.click('#call-banner .btn.green');
  ok(await until(async () => (await W(D)).joined && (await W(D)).playerState === 'playing', 15000), 'aceitar: entra na chamada e no Watch Together já tocando');
  await sleep(2000);
  ok(Math.abs((await ptime(A)) - (await ptime(D))) < 0.8, 'quem chegou depois está sincronizado');

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
  await B.click('.wt-ready'); await sleep(1200);
  await shot(B, '14-netflix-assistido');
  await cmd(HP, 'play');
  await B.waitForSelector('.wt-ext .wt-count', { timeout: 3000 });
  await shot(B, '15-netflix-contagem');
  ok(await until(async () => B.$eval('.wt-ext', e => /Dê play agora/.test(e.textContent)), 6000), 'contagem 3-2-1 e "dê play agora" para todos');

  // ---------- voz intacta ----------
  ok(await voiceOk(B) && await voiceOk(C) && await voiceOk(D), 'todos continuam na chamada de voz o tempo todo');
  ok(errs.length === 0, 'sem erros de JavaScript nas páginas', errs);
  void H;
} catch (e) { console.log('  EXCEÇÃO', e.stack); fails++; }
finally { await browser?.close().catch(() => { }); srv.kill(); media.close(); }
if (/Error|TypeError/.test(srvErr)) console.log('stderr do servidor:\n' + srvErr.slice(-2000));
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
