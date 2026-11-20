// Voz num processo próprio (server/voz.js): reiniciar o app (deploy: SIGUSR2) ou ele cair (kill -9) NÃO derruba a chamada.
// - a voz continua chegando durante o reinício (o áudio vai direto ao SFU, que não reiniciou);
// - ninguém vê ninguém sair da sala; a transmissão de tela continua;
// - depois do reinício, câmera ligada por um chega ao outro (os avisos do SFU vão para a conexão nova);
// - em-chamada.json volta com as pessoas da chamada; SIGTERM encerra tudo.
// Uso: node scripts/voz-processo-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await Promise.resolve().then(fn).catch(() => false)) return true; await sleep(200); } return false; };

const PORT = 3362, DIR = path.resolve('.testdata-vozprocesso');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
// microfone falso com "fala" contínua (o bipe padrão é filtrado como ruído)
const WAV = path.join(DIR, 'fala.wav');
{
  const rate = 48000, n = rate * 4, pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate; pcm[i] = Math.round(0.4 * 32767 * Math.sin(2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 5 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const voz = spawn(process.execPath, ['server/voz.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41410', RTC_IPS: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; voz.stdout.on('data', (c) => { log += c; }); voz.stderr.on('data', (c) => { log += c; });
process.on('exit', () => { try { voz.kill('SIGKILL'); } catch { } });
const BASE = `http://localhost:${PORT}`;
const up = () => fetch(BASE + '/api/server-info').then(r => r.ok, () => false);
const appPid = () => { try { return +execFileSync('pgrep', ['-P', String(voz.pid), '-f', 'server/index.js']).toString().trim().split('\n')[0] || 0; } catch { return 0; } };
if (!await until(up, 30000)) { console.log('servidor não subiu\n' + log); process.exit(1); }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await api('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const emChamada = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'em-chamada.json'), 'utf8')); } catch { return null; } };

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'T' }); await api(b.tok, 'POST', '/invites/' + (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code);
  const open = async (br, tok) => { const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
      navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
      const W = window.WebSocket; window.__left = []; window.__ws = 0;
      window.WebSocket = function (...x) { const s = new W(...x); window.__ws++; s.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.t === 'VOICE_STATE' && m.d && !m.d.channel_id) window.__left.push(m.d); } catch { } }); return s; };
      window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
      const P = window.RTCPeerConnection; window.__pcs = [];
      window.RTCPeerConnection = function (...x) { const pc = new P(...x); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = P.prototype;
    }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; };
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  const sees = (P, uid) => P.evaluate((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].filter(e => e.uid === uid).map(e => e.source).sort().join(','), uid);
  ok(await until(async () => /mic/.test(await sees(B, a.id)) && /screen/.test(await sees(B, a.id))), 'antes: o Bruno recebe a voz e a transmissão da Alice', await sees(B, a.id));

  // áudio que chega ao Bruno, amostrado a cada 100 ms durante o reinício
  const audioBytes = () => B.evaluate(async () => { let n = 0; for (const pc of window.__pcs) { if (pc.connectionState === 'closed') continue; (await pc.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') n += x.bytesReceived || 0; }); } return n; });
  async function restartAndWatch(label, doIt) {
    const samples = []; let stop = false;
    const sampler = (async () => { while (!stop) { samples.push([Date.now(), await audioBytes().catch(() => null)]); await sleep(100); } })();
    const wsA = await A.evaluate(() => window.__ws), pid0 = appPid();
    await sleep(500); doIt(pid0);
    const back = await until(async () => appPid() && appPid() !== pid0 && await up(), 30000);
    ok(back, `${label}: o app voltou`);
    // os dois apps reconectam e retomam a sessão
    await until(() => A.evaluate((n) => window.__ws > n && (window.__lc.voice.capHist || []).some(e => /retomada/.test(e.msg || '')), wsA), 30000);
    await sleep(2500); stop = true; await sampler;
    let gap = 0, last = null;
    for (const [t, n] of samples) { if (n == null) continue; if (last && n > last[1]) { gap = Math.max(gap, t - last[0]); last = [t, n]; } else if (!last) last = [t, n]; }
    ok(gap < 1500, `${label}: a voz da Alice não parou de chegar ao Bruno (maior intervalo sem áudio, ms)`, gap);
    const st = await A.evaluate(() => ({ cid: window.__lc.voice.channelId, screen: !!window.__lc.voice.screen }));
    ok(st.cid === vch.id && st.screen, `${label}: a Alice continua na sala e transmitindo`, st);
    const left = await B.evaluate(() => window.__left.length) + await A.evaluate(() => window.__left.length);
    ok(left === 0, `${label}: ninguém viu ninguém sair da sala`, left);
    ok(/screen/.test(await sees(B, a.id)), `${label}: o Bruno continua vendo a transmissão`);
  }

  // 1) deploy: SIGUSR2 reinicia só o app
  await restartAndWatch('reinício pelo deploy (SIGUSR2)', () => voz.kill('SIGUSR2'));
  // depois do reinício, eventos novos do SFU chegam: o Bruno liga a câmera e a Alice passa a receber
  await B.evaluate(() => window.__lc.voice.toggleCam?.() ?? window.__lc.voiceToggle('cam'));
  ok(await until(async () => /cam/.test(await sees(A, b.id)), 15000), 'depois do reinício: a câmera que o Bruno ligou chega à Alice', await sees(A, b.id));
  ok(await until(() => emChamada()?.inCalls === 2, 15000), 'em-chamada.json volta com as 2 pessoas', emChamada());

  // 2) o app cai (kill -9): o processo da voz o traz de volta e a chamada segue
  await restartAndWatch('queda do app (kill -9)', (pid) => process.kill(pid, 'SIGKILL'));

  // 3) SIGTERM encerra tudo
  voz.kill('SIGTERM');
  ok(await until(async () => voz.exitCode !== null, 10000), 'SIGTERM encerra a voz e o app', voz.exitCode);
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await bA.close(); await bB.close(); try { voz.kill('SIGKILL'); } catch { } }
if (fails) console.log('\n--- log ---\n' + log.slice(-4000));
console.log(fails ? `\n${fails} FALHA(S)` : '\nVOZ EM PROCESSO PRÓPRIO OK'); process.exit(fails ? 1 : 0);
