// Voz pelo TURN (server/turn.js + docs/TURN.md): o navegador é obrigado a usar só o TURN (iceTransportPolicy 'relay'),
// como quem está fora da VPN e não alcança a porta da voz. Com a credencial temporária do READY (TURN_SECRET), as duas
// pessoas se ouvem passando pelo coturn; com segredo errado no coturn, não conecta.
// Precisa do coturn (turnserver); sem ele o teste é pulado. Uso: node scripts/turn-voice-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
try { execFileSync('which', ['turnserver'], { stdio: 'ignore' }); } catch { console.log('  (sem turnserver: teste pulado; apt install coturn)'); process.exit(0); }
const PORT = 3393, BASE = `http://localhost:${PORT}`, DATA = './.testdata-turnvoice', TPORT = 34780, SECRET = 'segredo-do-teste';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const procs = [];
process.on('exit', () => { for (const p of procs) try { p.kill('SIGKILL'); } catch { } });
// coturn como no docs/TURN.md: só repassa para o IP do SFU (aqui 127.0.0.1); allow-loopback-peers só porque é tudo local
const turn = (secret) => { const p = spawn('turnserver', ['-n', '--listening-ip=127.0.0.1', '--relay-ip=127.0.0.1', `--listening-port=${TPORT}`, '--use-auth-secret', `--static-auth-secret=${secret}`, '--realm=resenha', '--fingerprint', '--no-cli', '--no-tls', '--no-dtls', '--allow-loopback-peers', '--denied-peer-ip=0.0.0.0-255.255.255.255', '--allowed-peer-ip=127.0.0.1', '--min-port=49160', '--max-port=49200', '--log-file=stdout'], { stdio: 'ignore' }); procs.push(p); return p; };
let tp = turn(SECRET);
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41393', RTC_IPS: '127.0.0.1', TURN_URL: `turn:127.0.0.1:${TPORT}?transport=udp,turn:127.0.0.1:${TPORT}?transport=tcp`, TURN_SECRET: SECRET }, stdio: 'ignore' });
procs.push(srv);
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    const PC = window.RTCPeerConnection; // só TURN: como quem não alcança a porta 40000
    window.RTCPeerConnection = function (cfg, ...a) { return new PC({ ...(cfg || {}), iceTransportPolicy: 'relay' }, ...a); };
    window.RTCPeerConnection.prototype = PC.prototype; Object.setPrototypeOf(window.RTCPeerConnection, PC);
  }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
const audioIn = (p, ms = 2000) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu; if (!s) return -1;
  const recv = [...s.consumers.values()].filter(e => e.source === 'mic').map(e => e.c.rtpReceiver);
  const snap = async () => { let b = 0; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') b += x.bytesReceived || 0; }); return b; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); return (await snap()) - a;
}, ms);
const route = (p) => p.evaluate(async () => {
  const t = window.__lc.voice.sfu?.send; if (!t) return null;
  const rep = await t.getStats(), by = new Map([...rep.values()].map(r => [r.id, r]));
  for (const r of rep.values()) if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') return by.get(r.localCandidateId)?.candidateType;
  return null;
});
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'bruno', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }); await api(rb.token, 'POST', '/invites/' + (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code);
  const A = await person(ra.token), B = await person(rb.token);
  const ice = await A.evaluate(() => window.__lc.S.ice);
  ok(ice.some(x => /^\d+:\d+$/.test(x.username || '') && x.credential), 'READY traz o TURN com credencial temporária', ice.map(x => x.urls));
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B]) await p.evaluate((vc) => window.__lc.voice.join(vc), vc);
  let ra2 = 0, rb2 = 0;
  for (let i = 0; i < 20 && !(ra2 > 1000 && rb2 > 1000); i++) { await sleep(500); [ra2, rb2] = [await audioIn(A, 1000), await audioIn(B, 1000)]; }
  ok(ra2 > 1000 && rb2 > 1000, 'só pelo TURN: as duas se ouvem', { alice: ra2, bruno: rb2 });
  ok(await route(A) === 'relay', 'caminho escolhido é o relay do TURN', await route(A));
  ok(await A.evaluate(() => !window.__lc.voice.recovering), 'sem "Reconectando a voz…"');

  // segredo do coturn diferente do servidor: a credencial não vale e a voz não conecta (mostra que o TURN foi mesmo usado)
  for (const p of [A, B]) await p.evaluate(() => window.__lc.voice.leave());
  tp.kill('SIGKILL'); await sleep(500); tp = turn('outro-segredo'); await sleep(800);
  await A.evaluate((vc) => window.__lc.voice.join(vc), vc);
  await sleep(12000);
  ok(await route(A) == null, 'com segredo errado no coturn não conecta', { recuperando: await A.evaluate(() => window.__lc.voice.recovering) });
} catch (e) { ok(false, 'erro: ' + e.message); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
