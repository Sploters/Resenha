// Bot de música depois que o worker do mediasoup morre (server/music.js sfuReset): a sala some do SFU com o produtor do
// bot. Antes o bot ficava na sala, mudo para sempre (o notify dele ignorava o SFU_RESET); agora ele entra de novo no
// worker recriado e quem refaz a mídia volta a receber a música. yt-dlp falso (respostas na hora) e áudio de 30 s.
// Uso: node scripts/music-worker-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
const PORT = 3414, BASE = `http://localhost:${PORT}`, DATA = './.testdata-musicworker', MEDIA = path.resolve('./.testmedia-musicworker');
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
}, 50);
`); fs.chmodSync(FAKE, 0o755);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41396', RTC_IPS: '127.0.0.1', MUSIC_ALLOW_ANY: '1', YTDLP_REMOTE_EJS: '0', MUSIC_LYRICS: '0', YTDLP_PATH: FAKE, HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
try {
  const tok = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token; // 1ª conta = administradora (vê /api/health)
  const g = await call(tok, 'POST', '/guilds', { name: 'Som' }), myId = (await call(tok, 'PATCH', '/me', {})).id;
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), msgs = [];
  ws.on('message', (raw) => msgs.push({ at: Date.now(), m: JSON.parse(raw) }));
  await new Promise(r => ws.on('open', r));
  const wait = async (f, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const x = msgs.find(f); if (x) return x; await sleep(50); } return null; };
  let rid = 100; const sfu = async (op, d = {}) => { const id = ++rid; ws.send(JSON.stringify({ t: 'SFU', d: { op, rid: id, ...d } })); return (await wait(x => x.m.t === 'SFU_RES' && x.m.d.rid === id, 8000))?.m.d; };
  const ready = await wait(x => x.m.t === 'READY'), vch = ready.m.d.guilds.find(x => x.id === g.id).channels.find(c => c.type === 2);
  ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: vch.id } })); await wait(x => x.m.t === 'VOICE_JOINED'); await sleep(300);
  ws.send(JSON.stringify({ t: 'MUSIC', d: { op: 'play', query: M('a.webm'), rid: 1 } }));
  const started = await wait(x => x.m.t === 'MUSIC_STATE' && x.m.d.current && !x.m.d.loading);
  ok(!!started, 'a música começou', started?.m.d.current?.title);
  const botMic = async () => (await sfu('producers'))?.data?.producers?.find(p => p.source === 'mic' && p.user_id !== myId);
  ok(!!(await botMic()), 'antes: o produtor de áudio do bot está na sala');
  const before = (await call(tok, 'GET', '/health')).now?.workers || [];
  const w = before.find(x => x.alive && x.peers > 0) || before[0];
  ok(!!w?.pid, 'achei o worker da sala', before.map(x => ({ port: x.port, pid: x.pid, peers: x.peers })));
  const t0 = Date.now(); process.kill(w.pid, 'SIGKILL');
  const reset = await wait(x => x.m.t === 'SFU_RESET' && x.at >= t0, 10000);
  ok(!!reset, 'quem está na sala recebe SFU_RESET', reset?.m.d);
  // o app refaz a mídia (igual ao public/voice.js): SFU_REJOIN até conseguir (o worker volta em ~1 s)
  let back = null;
  for (let i = 0; i < 20 && !back; i++) {
    const t1 = Date.now(); ws.send(JSON.stringify({ t: 'SFU_REJOIN', d: { channel_id: vch.id } }));
    const r = await wait(x => x.at >= t1 && ((x.m.t === 'VOICE_JOINED' && x.m.d.rejoin) || x.m.t === 'SFU_RESET'), 5000);
    if (r?.m.t === 'VOICE_JOINED') back = r; else await sleep(1000);
  }
  ok(!!back, 'quem ouve volta ao SFU', back && Date.now() - t0);
  let mic = null; for (let i = 0; i < 40 && !mic; i++) { mic = await botMic(); if (!mic) await sleep(500); }
  ok(!!mic, 'o bot volta com o produtor de áudio (a música chega de novo a quem refez a mídia)', mic ? { segundos: (Date.now() - t0) / 1000 } : (await sfu('producers'))?.data);
  ok(/bot da sala .* voltou ao SFU/.test(log), 'log do servidor: "[música] bot ... voltou ao SFU"');
  const ended = msgs.find(x => x.m.t === 'MUSIC_STATE' && x.at >= t0 && x.m.d.active === false);
  ok(!ended, 'a sessão de música não foi encerrada pela queda', ended?.m.d);
  ws.close();
} catch (e) { console.log('  FAIL', e.message); fails++; }
media.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
