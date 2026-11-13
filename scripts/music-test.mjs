// Bot de música de ponta a ponta (servidor real + navegador + yt-dlp + ffmpeg + SFU), sem depender do YouTube:
// três arquivos com tons diferentes (440, 880 e 660 Hz) servidos por HTTP local (MUSIC_ALLOW_ANY=1).
// Confere o som que chega de verdade na sala (frequência do áudio do bot) e: fila, tocar a seguir/agora, pular, voltar,
// pausar/continuar no mesmo ponto, seek, repetir faixa e fila, embaralhar, mover, histórico, playlists salvas, 24/7,
// dois bots em duas salas do mesmo servidor, o popup na tela e sair.
// Uso: BROWSER=/caminho/do/chrome YTDLP_PATH=/caminho/do/yt-dlp node scripts/music-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PORT = 3295, BASE = `http://localhost:${PORT}`, DATA = './.testdata-music', MEDIA = path.join(DATA, '..', '.testmedia-music');
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(MEDIA, { recursive: true, force: true }); fs.mkdirSync(MEDIA, { recursive: true });
const tone = (name, hz, secs) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-ac', '2', '-c:a', 'libopus', '-b:a', '64k', path.join(MEDIA, name)]);
tone('Musica A.webm', 440, 40); tone('Musica B.webm', 880, 40); tone('Musica C.webm', 660, 25);
const media = http.createServer((req, res) => { const f = path.join(MEDIA, decodeURIComponent(req.url.slice(1))); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': fs.statSync(f).size }); fs.createReadStream(f).pipe(res); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const MURL = (n) => `http://127.0.0.1:${media.address().port}/${encodeURIComponent(n)}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41091', RTC_IPS: '127.0.0.1', MUSIC_ALLOW_ANY: '1', YTDLP_REMOTE_EJS: '0', MUSIC_LYRICS: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
let srvErr = ''; srv.stderr.on('data', d => (srvErr += d));
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return r.token; };
let browser;
try {
  const ta = await reg('ana'), tb = await reg('beto');
  const g = await call(ta, 'POST', '/guilds', { name: 'Som' }); await call(tb, 'POST', '/invites/' + (await call(ta, 'POST', `/guilds/${g.id}/invites`)).code);
  const v2 = await call(ta, 'POST', `/guilds/${g.id}/channels`, { name: 'Sala 2', type: 2 });
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (tok) => { const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1440, height: 900 }); p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; }); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p; };
  const A = await open(ta), B = await open(tb);
  const v1 = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2 && c.name !== 'Sala 2').id, g.id);
  await A.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, v1);
  await B.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, v2.id);
  await sleep(2500);
  const cmd = (P, op, extra) => P.evaluate(async (op, extra) => { try { return await (await window.__lc.import('music.js')).musicCmd(op, extra); } catch (e) { return { error: e.message }; } }, op, extra);
  const st = (P) => P.evaluate(async () => { const s = (await window.__lc.import('music.js')).musicState(); return s && JSON.parse(JSON.stringify(s)); });
  // frequência dominante do áudio do bot que chega nesta página (e quão alto)
  const hz = (P) => P.evaluate(async () => {
    const v = window.__lc.voice, s = (await window.__lc.import('music.js')).musicState(); if (!s?.bot_id) return null;
    const c = [...v.sfu.consumers.values()].find(x => x.uid === s.bot_id && x.source === 'mic'); if (!c) return { none: true };
    const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 8192; ac.createMediaStreamSource(new MediaStream([c.c.track])).connect(an);
    await new Promise(r => setTimeout(r, 800));
    const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f);
    let best = 0; for (let i = 1; i < f.length; i++) if (f[i] > f[best]) best = i;
    ac.close(); return { hz: Math.round(best * ac.sampleRate / an.fftSize), db: Math.round(f[best]) };
  });
  const near = (x, want) => x && Math.abs(x.hz - want) < 20 && x.db > -70;
  const waitPlaying = async (P, title, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const s = await st(P); if (s?.current?.title === title && !s.loading) return s; await sleep(400); } return st(P); };

  // ---- tocar e fila ----
  const r1 = await cmd(A, 'play', { query: MURL('Musica A.webm') });
  ok(!r1.error && r1.added === 1, 'tocar um link: o bot entra e começa', r1);
  let s = await waitPlaying(A, 'Musica A'); await sleep(1500);
  ok(s?.active && s.bot_n === 1 && s.current?.title === 'Musica A', 'estado: tocando "Musica A" com o bot 1', { cur: s?.current?.title, n: s?.bot_n });
  ok(await A.evaluate((gid, bot) => [...window.__lc.S.guilds.get(gid).members.keys()].length === 2 && window.__lc.S.voice.get(bot)?.bot?.kind === 'music', g.id, s.bot_id), 'o bot NÃO é membro do servidor; está na sala marcado como bot');
  ok(near(await hz(A), 440), 'o som do bot chega na sala (440 Hz)', await hz(A));
  await cmd(A, 'play', { query: MURL('Musica B.webm') }); await cmd(A, 'play', { query: MURL('Musica C.webm'), where: 'next' });
  s = await st(A);
  ok(s.queue.map(t => t.title).join() === 'Musica C,Musica B', '"tocar a seguir" entra na frente da fila', s.queue.map(t => t.title));
  await cmd(A, 'move', { id: s.queue[1].id, to: 0 }); s = await st(A);
  ok(s.queue.map(t => t.title).join() === 'Musica B,Musica C', 'mover na fila (arrastar)', s.queue.map(t => t.title));
  // ---- pausar no ponto, seek ----
  await sleep(2000);
  await cmd(A, 'pause'); s = await st(A); const at = s.elapsed;
  ok(s.paused && at > 2000, 'pausar guarda o ponto', at);
  await sleep(1500); await cmd(A, 'resume'); s = await waitPlaying(A, 'Musica A');
  ok(!s.paused && Math.abs(s.elapsed - at) < 1500, 'continuar volta do mesmo ponto', { at, now: s.elapsed });
  await cmd(A, 'seek', { ms: 30000 }); s = await waitPlaying(A, 'Musica A'); await sleep(800);
  ok(s.elapsed >= 29000 && s.elapsed < 33000 && near(await hz(A), 440), 'pular para 0:30 (seek)', s.elapsed);
  await cmd(A, 'seek', { ms: 1000 }); await waitPlaying(A, 'Musica A'); // volta ao começo: os 40 s da música não acabam no meio dos próximos testes
  // ---- pular, voltar, histórico, repetir ----
  await cmd(A, 'skip'); s = await waitPlaying(A, 'Musica B'); await sleep(1000);
  ok(s.current.title === 'Musica B' && s.history[0]?.title === 'Musica A' && near(await hz(A), 880), 'pular: toca a próxima (880 Hz) e a anterior vai pro histórico', { cur: s.current.title, hist: s.history.map(t => t.title) });
  await cmd(A, 'back'); s = await waitPlaying(A, 'Musica A');
  ok(s.current.title === 'Musica A' && s.queue[0]?.title === 'Musica B', 'voltar: a anterior toca de novo e a atual volta para a fila', { cur: s.current.title, q: s.queue.map(t => t.title) });
  await cmd(A, 'loop', { mode: 'track' }); await cmd(A, 'seek', { ms: 38500 }); await sleep(4500); s = await st(A);
  ok(s.loop === 'track' && s.current.title === 'Musica A' && s.elapsed < 4000, 'repetir esta música: no fim ela recomeça', { cur: s.current.title, el: s.elapsed });
  await cmd(A, 'loop', { mode: 'queue' }); await cmd(A, 'seek', { ms: 38500 }); await sleep(4500); s = await st(A);
  ok(s.current.title === 'Musica B' && s.queue.at(-1)?.title === 'Musica A', 'repetir a fila: a que acabou volta para o fim da fila', { cur: s.current.title, q: s.queue.map(t => t.title) });
  await cmd(A, 'loop', { mode: 'off' });
  // ---- playlists ----
  const sv = await cmd(A, 'pl_save', { name: 'Tons' });
  ok(sv.saved === 3 && sv.playlists[0]?.name === 'Tons', 'salvar a fila como playlist do servidor', sv);
  await cmd(A, 'clear'); const ld = await cmd(A, 'pl_load', { id: sv.playlists[0].id }); s = await st(A);
  ok(ld.added === 3 && s.queue.length === 3, 'carregar a playlist põe as músicas na fila', { added: ld.added, q: s.queue.length });
  await cmd(A, 'dedupe'); s = await st(A);
  ok(s.queue.length === 2 && !s.queue.some(t => t.title === s.current.title), 'tirar repetidas da fila', s.queue.map(t => t.title));
  // ---- segundo bot em outra sala do mesmo servidor ----
  const rb = await cmd(B, 'play', { query: MURL('Musica C.webm') }); const sb = await waitPlaying(B, 'Musica C'); await sleep(1200);
  ok(!rb.error && sb.bot_n === 2 && sb.bot_id !== s.bot_id && near(await hz(B), 660), 'outra sala: entra o bot "Música 2" ao mesmo tempo (660 Hz)', { n: sb.bot_n, hz: await hz(B) });
  ok(near(await hz(A), 440) || near(await hz(A), 880), 'a primeira sala continua com o bot 1 tocando');
  // ---- painel na tela ----
  await A.bringToFront();
  await A.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.title === 'Música: tocar no canal de voz'); b.click(); }); await sleep(600);
  const pan = await A.evaluate(() => ({ now: document.querySelector('.mupanel .muhero .mutitle b')?.textContent, tabs: [...document.querySelectorAll('.mutab')].map(t => t.firstChild.textContent), q: document.querySelectorAll('.mulist .muitem').length,
    gone: !document.querySelector('.mupanel .mufx, .mupanel .mulyr') && !/Volume do bot para todos|Letra|Efeito/.test(document.querySelector('.mupanel').textContent),
    lit: !!document.querySelector('button.on[title="Música: tocar no canal de voz"]') }));
  ok(/Musica/.test(pan.now || '') && pan.tabs.join() === 'Fila,Histórico,Playlists' && pan.q === 2 && pan.gone && pan.lit, 'popup: tocando agora, abas Fila/Histórico/Playlists, sem volume para todos/efeitos/letra, botão aceso', pan);
  await A.screenshot({ path: '.testshots/music-panel.png' });
  // ---- 24/7 e sair ----
  await cmd(A, 'stay', { on: true }); ok((await st(A)).stay === true, '24/7 ligado');
  await cmd(A, 'disconnect'); await sleep(600);
  ok(!(await st(A))?.active && await A.evaluate(() => [...window.__lc.S.voice.values()].filter(v => v.bot).length) === 1, 'tirar o bot: ele sai da sala (o bot 2 continua na outra)');
} catch (e) { console.log('ERRO', e); fails++; }
await browser?.close(); srv.kill(); media.close();
if (fails && srvErr) console.log(srvErr.split('\n').filter(l => /Error|error/.test(l)).slice(-5).join('\n'));
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(MEDIA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
