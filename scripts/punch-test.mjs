// Furo no CGNAT de ponta a ponta (server/punch.js + operação 'punch' do SFU + voice.punchFor), com navegador e
// mediasoup de verdade: o Bruno não alcança nenhum candidato direto do servidor (a porta do SFU é trocada por um endereço
// inalcançável); só o candidato do furo sobra. Ele tem de ficar na mídia direta (sem túnel), ouvir e ser ouvido e ver a
// tela da Alice. STUN de mentira local, para não depender de internet.
// Uso: node scripts/punch-test.mjs   (precisa de uma interface de rede com IPv4, além do loopback)
import dgram from 'node:dgram';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3396, BASE = `http://localhost:${PORT}`, DATA = './.testdata-punch';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const LAN = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal && !/^(100\.|26\.|169\.254)/.test(i.address))?.address;
if (!LAN) { console.log('  (pulado: sem rede além do loopback)'); process.exit(0); }
// STUN de mentira. Para o navegador ele diz uma porta diferente (senão o srflx é igual ao endereço local e é descartado);
// o repassador libera pelo IP, como num NAT que filtra só por endereço
async function fakeStun(shift) {
  const s = dgram.createSocket('udp4');
  s.on('message', (q, from) => {
    if (q.length < 20 || q.readUInt16BE(0) !== 1) return;
    const r = Buffer.alloc(32); r.writeUInt16BE(0x0101, 0); r.writeUInt16BE(12, 2); r.writeUInt32BE(0x2112a442, 4); q.copy(r, 8, 8, 20);
    r.writeUInt16BE(0x0020, 20); r.writeUInt16BE(8, 22); r[25] = 1; r.writeUInt16BE(((from.port + shift) & 0xffff) ^ 0x2112, 26);
    r.writeUInt32BE((from.address.split('.').reduce((n, x) => n * 256 + +x, 0) ^ 0x2112a442) >>> 0, 28);
    s.send(r, from.port, from.address);
  });
  await new Promise(res => s.bind(0, LAN, res)); s.unref(); return s.address().port;
}
const stunServer = await fakeStun(0), stunBrowser = await fakeStun(1);
const srv = spawn(process.execPath, ['server/voz.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41396', RTC_IPS: '127.0.0.1', RTC_PUNCH: '1', RTC_PUNCH_PRIVATE: '1', RTC_PUNCH_STUN: `${LAN}:${stunServer}`, EXIT_WITH_PARENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok, blockDirect) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t, block) => {
    localStorage.lc_token = t; window.__toasts = [];
    // o STUN do navegador vira o de mentira (window.__stun), para o endereço descoberto ser o desta rede
    const OPC = window.RTCPeerConnection; window.RTCPeerConnection = class extends OPC { constructor(c, ...r) { super(window.__stun && c?.iceServers?.length ? { ...c, iceServers: [{ urls: window.__stun }] } : c, ...r); } };
    new MutationObserver(() => { const e = document.getElementById('toast'); if (e && window.__toasts.at(-1) !== e.textContent) window.__toasts.push(e.textContent); }).observe(document, { childList: true, subtree: true });
    if (block) { // o endereço que o servidor de voz anuncia não chega daqui (como fora da VPN, numa rede só IPv4)
      const srd = RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription = function (d, ...a) { return srd.call(this, d?.sdp && !window.__direct ? { type: d.type, sdp: d.sdp.replaceAll('127.0.0.1 41396 ', '192.0.2.1 41396 ') } : d, ...a); };
    }
  }, tok, blockDirect);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
// voz que chega à Alice (mídia direta) vinda do microfone de alguém
const aliceHears = (p, ms = 1500) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu; if (!s) { await new Promise(r => setTimeout(r, ms)); return -1; } // refazendo a mídia: espera igual
  const recv = [...s.consumers.values()].filter(e => e.source === 'mic').map(e => e.c.rtpReceiver);
  const snap = async () => { let b = 0; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') b += x.bytesReceived || 0; }); return b; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); return (await snap()) - a;
}, ms);
// som de verdade (energia) no que o Bruno toca de alguém pelo túnel
const brunoHears = (p, uid, ms = 1200) => p.evaluate(async (uid, ms) => {
  const el = window.__lc.voice.peers.get(uid)?.audioEl; if (!el?.srcObject) { await new Promise(r => setTimeout(r, ms)); return -1; }
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(el.srcObject), an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize); let peak = 0;
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
  ctx.close(); return peak;
}, uid, ms);
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'bruno', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }); await api(rb.token, 'POST', '/invites/' + (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code);
  const A = await person(ra.token, false), B = await person(rb.token, true);
  const [idA, idB] = await Promise.all([A, B].map(p => p.evaluate(() => window.__lc.S.me.id)));
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await B.evaluate((u) => { window.__stun = u; }, `stun:${LAN}:${stunBrowser}`);
  await A.evaluate((vc) => window.__lc.voice.join(vc), vc);
  await sleep(1500);
  await B.evaluate((vc) => window.__lc.voice.join(vc), vc);
  let a = 0; for (let i = 0; i < 15 && a < 2000; i++) a = await aliceHears(A, 1000);
  ok(a > 2000, 'a Alice ouve o Bruno', a);
  let b = 0; for (let i = 0; i < 15 && b < 0.01; i++) b = await brunoHears(B, idA);
  ok(b > 0.01, 'o Bruno ouve a Alice', b);
  await sleep(4000); // passa do prazo que mandaria para o túnel
  const via = await B.evaluate(async () => { const v = window.__lc.voice; return { tunnel: !!v.tunnel, host: v.tunnel ? null : await v.mediaHost(), furo: v._punchAddr, send: v.sfu?.send?.connectionState }; });
  const port = await B.evaluate(async () => { const t = window.__lc.voice.sfu?.send; if (!t) return null; const rep = await t.getStats(), by = new Map([...rep.values()].map(r => [r.id, r])); const pair = [...rep.values()].find(r => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded'); return by.get(pair?.remoteCandidateId)?.port ?? null; });
  ok(!via.tunnel && via.send === 'connected', 'sem túnel: o Bruno está na mídia direta', via);
  ok(!!port && port !== 41396 && /\[furo\] ligação direta aberta/.test(out), 'a ligação passa pelo furo', { port });
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  let frames = 0;
  for (let i = 0; i < 20 && !(frames > 20); i++) { await sleep(1000); frames = await B.evaluate(async (idA) => { const v = window.__lc.voice; v.openStream(idA); v.flowVideo(idA, false); const s = await v.streamStats(idA); return s?.fps || 0; }, idA); }
  ok(frames > 20, 'o Bruno recebe a tela da Alice pelo furo (FPS)', frames);
} catch (e) { ok(false, 'erro: ' + e.message); console.log(out.slice(-1500)); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
