// Vigia do bot de música (server/music.js pace): o servidor de áudio entrega o começo e para de mandar sem fechar a
// conexão. Antes a faixa ficava parada para sempre com o ffmpeg vivo; agora, sem dados por MUSIC_STALL_MS, o ffmpeg é
// encerrado (com o grupo de processos), a faixa é retomada do ponto (até 3 vezes) e depois segue a fila. Sem processo sobrando.
// Uso: node scripts/music-stall-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
const PORT = 3416, BASE = `http://localhost:${PORT}`, DATA = './.testdata-musicstall', MEDIA = path.resolve('./.testmedia-musicstall');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(MEDIA, { recursive: true, force: true }); fs.mkdirSync(MEDIA, { recursive: true });
for (const [n, hz] of [['a.webm', 440], ['b.webm', 660]]) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=30`, '-ac', '2', '-c:a', 'libopus', '-b:a', '64k', path.join(MEDIA, n)]);
// "trava": manda só o começo do arquivo e segura a conexão aberta, sem mandar mais nada
const media = http.createServer((req, res) => { const f = path.join(MEDIA, 'a.webm'); const all = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': all.length }); res.write(all.subarray(0, Math.floor(all.length * 0.15))); });
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
}, 50);
`); fs.chmodSync(FAKE, 0o755);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41398', MUSIC_STALL_MS: '3000', RTC_IPS: '127.0.0.1', MUSIC_ALLOW_ANY: '1', YTDLP_REMOTE_EJS: '0', MUSIC_LYRICS: '0', YTDLP_PATH: FAKE, HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const ffLeft = () => { try { return execFileSync('pgrep', ['-f', `127.0.0.1:${media.address().port}`]).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
try {
  const tok = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token;
  const g = await call(tok, 'POST', '/guilds', { name: 'Som' });
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), msgs = [];
  ws.on('message', (raw) => msgs.push({ at: Date.now(), m: JSON.parse(raw) }));
  await new Promise(r => ws.on('open', r));
  const wait = async (f, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const x = msgs.find(f); if (x) return x; await sleep(50); } return null; };
  const ready = await wait(x => x.m.t === 'READY'), vch = ready.m.d.guilds.find(x => x.id === g.id).channels.find(c => c.type === 2);
  ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: vch.id } })); await wait(x => x.m.t === 'VOICE_JOINED'); await sleep(300);
  ws.send(JSON.stringify({ t: 'MUSIC', d: { op: 'play', query: M('trava.webm'), rid: 1 } }));
  const started = await wait(x => x.m.t === 'MUSIC_STATE' && x.m.d.current && !x.m.d.loading);
  ok(!!started, 'a música começou (o começo chegou)', started?.m.d.current?.title);
  for (let i = 0; i < 300 && !/nada do ffmpeg/.test(log); i++) await sleep(100);
  ok(/nada do ffmpeg há \d+ s/.test(log), 'vigia percebe o áudio parado e encerra o ffmpeg', log.split('\n').filter(l => /música/.test(l)));
  const t0 = Date.now(), end = await wait(x => x.at >= t0 && x.m.t === 'MUSIC_STATE' && x.m.d.active !== false && !x.m.d.current && !x.m.d.loading, 90000);
  ok(!!end, 'depois das retomadas a fila segue (não fica parada para sempre)');
  const tries = (log.match(/nada do ffmpeg/g) || []).length;
  ok(tries >= 2, 'retomou do ponto antes de desistir', { vezes: tries });
  ws.send(JSON.stringify({ t: 'MUSIC', d: { op: 'stop', rid: 2 } })); await sleep(800); // a próxima da fila (B, também travada) já tocava
  ok(ffLeft() === 0, 'parar não deixa ffmpeg sobrando', ffLeft() && execFileSync('ps', ['-eo', 'pid,ppid,stat,args']).toString().split('\n').filter(l => l.includes(String(media.address().port))));
  ws.close();
} catch (e) { console.log('  FAIL', e.message); fails++; }
media.closeAllConnections?.(); media.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
