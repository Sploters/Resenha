// Voz pelo túnel com TODOS pelo túnel (variação de voztunnel-test.mjs): Alice e Bruno sem caminho direto. Pega o caso
// em que quem troca de caminho (direto -> túnel) mandava o aviso de "saiu a voz antiga" depois de "entrou a nova" e o
// app apagava a nova: um ouvia, o outro não.
// (abaixo, o cabeçalho original)
// Voz pelo túnel, de ponta a ponta (public/voztunnel.js, server/voztunnel.js, server/tunnelproxy.js):
// a Alice conecta a mídia direto; o Bruno não alcança o servidor direto (sem
// caminho: o endereço anunciado pelo servidor é trocado por um inalcançável, como quem está fora da VPN numa rede só IPv4) e, sem conectar em 5 s, a voz dele passa sozinha pela conexão
// do site. As duas pessoas se ouvem; mudo e ensurdecer valem; o popup do sinal mostra "Pelo site (túnel)"; câmera
// avisa que não passa; e sair da sala fecha o microfone do túnel para os outros.
// Uso: node scripts/voztunnel-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3398, BASE = `http://localhost:${PORT}`, DATA = './.testdata-voztunnel-todos';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/voz.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41398', RTC_IPS: '127.0.0.1', EXIT_WITH_PARENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    new MutationObserver(() => { const e = document.getElementById('toast'); if (e && window.__toasts.at(-1) !== e.textContent) window.__toasts.push(e.textContent); }).observe(document, { childList: true, subtree: true });
    if (block) { // o endereço que o servidor de voz anuncia não chega daqui (como fora da VPN, numa rede só IPv4)
      const srd = RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription = function (d, ...a) { return srd.call(this, d?.sdp ? { type: d.type, sdp: d.sdp.replaceAll('127.0.0.1', '192.0.2.1') } : d, ...a); };
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
  const A = await person(ra.token, true), B = await person(rb.token, true);
  const [idA, idB] = await Promise.all([A, B].map(p => p.evaluate(() => window.__lc.S.me.id)));
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await A.evaluate((vc) => window.__lc.voice.join(vc), vc);
  await sleep(1500);
  const t0 = Date.now();
  await B.evaluate((vc) => window.__lc.voice.join(vc), vc);
  ok(await B.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 20000 }).then(() => true, () => false), 'sem caminho direto: a voz do Bruno passou para o túnel', { s: ((Date.now() - t0) / 1000).toFixed(1) });
  ok(await B.evaluate(() => !window.__lc.voice.recovering && !window.__lc.voice.error), 'sem "Reconectando" nem erro na tela');
  ok(await A.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 20000 }).then(() => true, () => false), 'Alice também pelo túnel');

  let a = 0; for (let i = 0; i < 12 && a < 0.01; i++) a = await brunoHears(A, idB);
  ok(a > 0.01, 'a Alice ouve o Bruno (que fala pelo túnel)', a);
  let b = 0; for (let i = 0; i < 12 && b < 0.01; i++) b = await brunoHears(B, idA);
  ok(b > 0.01, 'o Bruno ouve a Alice pelo túnel (som de verdade, decodificado)', b);

} catch (e) { ok(false, 'erro: ' + e.message); console.log(out.slice(-1500)); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
