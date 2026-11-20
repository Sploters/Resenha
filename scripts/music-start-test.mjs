// Tempo até a música começar quando o pedido é uma playlist (server/music.js resolveQuery/handle). O yt-dlp aqui é um
// falso que responde depois de 2 s a cada chamada (como o de verdade, que leva segundos): antes a lista inteira vinha,
// depois o bot entrava na sala e só então o áudio da 1ª faixa era procurado (2 chamadas em sequência). Agora a lista,
// o áudio da 1ª e a entrada do bot correm juntos.
// Uso: node scripts/music-start-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
const PORT = 3412, BASE = `http://localhost:${PORT}`, DATA = './.testdata-musicstart', MEDIA = path.resolve('./.testmedia-musicstart');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(MEDIA, { recursive: true, force: true }); fs.mkdirSync(MEDIA, { recursive: true });
for (const [n, hz] of [['a.webm', 440], ['b.webm', 660]]) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=30`, '-ac', '2', '-c:a', 'libopus', '-b:a', '64k', path.join(MEDIA, n)]);
const media = http.createServer((req, res) => { const f = path.join(MEDIA, path.basename(decodeURIComponent(req.url))); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'audio/webm' }); fs.createReadStream(f).pipe(res); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const M = (n) => `http://127.0.0.1:${media.address().port}/${n}`;
// yt-dlp falso: 2 s por chamada; anota cada chamada
const LOG = path.join(MEDIA, 'chamadas.log'), FAKE = path.join(MEDIA, 'yt-dlp');
fs.writeFileSync(FAKE, `#!/usr/bin/env node
import fs from 'node:fs';
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('falso'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(LOG)}, a.filter(x => x.startsWith('--') && !['--ignore-config','--no-warnings','--js-runtimes'].includes(x)).join(' ') + '\\n');
const A = ${JSON.stringify(M('a.webm'))}, B = ${JSON.stringify(M('b.webm'))};
const e = (u, t, full) => ({ id: t, title: t, webpage_url: u, duration: 30, ...(full ? { url: u, http_headers: {} } : {}) });
setTimeout(() => {
  if (a.includes('--flat-playlist')) console.log(JSON.stringify({ entries: [e(A, 'Faixa A'), e(B, 'Faixa B')] }));
  else if (a.includes('--playlist-items')) console.log(JSON.stringify({ entries: [e(A, 'Faixa A', true)] }));
  else { const k = a[a.length - 1]; console.log(JSON.stringify(e(k, 'Faixa', true))); }
}, 2000);
`); fs.chmodSync(FAKE, 0o755);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41390', RTC_IPS: '127.0.0.1', MUSIC_ALLOW_ANY: '1', YTDLP_REMOTE_EJS: '0', MUSIC_LYRICS: '0', YTDLP_PATH: FAKE, HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
try {
  const tok = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token;
  const g = await call(tok, 'POST', '/guilds', { name: 'Som' });
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), msgs = [];
  ws.on('message', (raw) => msgs.push({ at: Date.now(), m: JSON.parse(raw) }));
  await new Promise(r => ws.on('open', r));
  const wait = async (f, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const x = msgs.find(f); if (x) return x; await sleep(50); } return null; };
  const ready = await wait(x => x.m.t === 'READY'), vch = ready.m.d.guilds.find(x => x.id === g.id).channels.find(c => c.type === 2);
  ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: vch.id } })); await wait(x => x.m.t === 'VOICE_JOINED'); await sleep(300);
  fs.writeFileSync(LOG, '');
  const t0 = Date.now();
  ws.send(JSON.stringify({ t: 'MUSIC', d: { op: 'play', query: M('lista'), rid: 1 } }));
  const res = await wait(x => x.m.t === 'MUSIC_RES' && x.m.d.rid === 1);
  const started = await wait(x => x.m.t === 'MUSIC_STATE' && x.m.d.current && !x.m.d.loading && x.at >= t0);
  const ms = started ? started.at - t0 : null, calls = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`  (tocou em ${ms} ms; chamadas ao yt-dlp: ${calls.length} — ${calls.join(' | ')})`);
  ok(res && !res.m.d.error && res.m.d.data?.added === 2, 'a playlist entrou na fila (2 faixas)', res?.m.d);
  ok(started && started.m.d.current.title === 'Faixa A', 'a 1ª faixa começou a tocar', started?.m.d.current?.title);
  ok(ms !== null && ms < 3500, 'com o yt-dlp levando 2 s por chamada, começa em menos de 3,5 s (lista e 1ª faixa juntas)', ms);
  ws.close();
} catch (e) { console.log('  FAIL', e.message); fails++; }
media.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
