// Voz pelo túnel, de ponta a ponta (public/voztunnel.js, server/voztunnel.js, server/tunnelproxy.js):
// a Alice conecta a mídia direto; o Bruno não alcança o servidor direto (sem
// caminho: o endereço anunciado pelo servidor é trocado por um inalcançável, como quem está fora da VPN numa rede só IPv4) e, sem conectar em 5 s, a voz dele passa sozinha pela conexão
// do site. As duas pessoas se ouvem; mudo e ensurdecer valem; o popup do sinal mostra "Pelo site (túnel)"; câmera
// avisa que não passa; e sair da sala fecha o microfone do túnel para os outros.
// Uso: node scripts/voztunnel-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3397, BASE = `http://localhost:${PORT}`, DATA = './.testdata-voztunnel';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/voz.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41397', RTC_IPS: '127.0.0.1', EXIT_WITH_PARENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const A = await person(ra.token, false), B = await person(rb.token, true);
  const [idA, idB] = await Promise.all([A, B].map(p => p.evaluate(() => window.__lc.S.me.id)));
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await A.evaluate((vc) => window.__lc.voice.join(vc), vc);
  await sleep(1500);
  const t0 = Date.now();
  await B.evaluate((vc) => window.__lc.voice.join(vc), vc);
  ok(await B.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 20000 }).then(() => true, () => false), 'sem caminho direto: a voz do Bruno passou para o túnel', { s: ((Date.now() - t0) / 1000).toFixed(1) });
  ok(await B.evaluate(() => !window.__lc.voice.recovering && !window.__lc.voice.error), 'sem "Reconectando" nem erro na tela');
  ok(await A.evaluate(() => !window.__lc.voice.tunnel && !!window.__lc.voice.sfu?.ready), 'a Alice continua pela mídia direta');

  let a = 0; for (let i = 0; i < 12 && a < 2000; i++) a = await aliceHears(A, 1000);
  ok(a > 2000, 'a Alice ouve o Bruno (que fala pelo túnel)', a);
  let b = 0; for (let i = 0; i < 12 && b < 0.01; i++) b = await brunoHears(B, idA);
  ok(b > 0.01, 'o Bruno ouve a Alice pelo túnel (som de verdade, decodificado)', b);

  // mudo: nada sai do Bruno
  await B.evaluate(() => window.__lc.voice.toggleMute()); await sleep(800);
  a = await aliceHears(A, 1500);
  ok(a < 300, 'Bruno mudo: a Alice não recebe voz dele', a);
  await B.evaluate(() => window.__lc.voice.toggleMute()); await sleep(500);
  a = 0; for (let i = 0; i < 8 && a < 2000; i++) a = await aliceHears(A, 1000);
  ok(a > 2000, 'desmutou: a voz volta', a);

  // ensurdecido: a voz da Alice para de chegar pelo túnel
  await B.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(800);
  const fr = () => B.evaluate(() => window.__lc.voice.tunnel?.stats?.frames ?? -1);
  const f0 = await fr(); await sleep(1200); const f1 = await fr();
  ok(f1 >= 0 && f1 - f0 < 5, 'Bruno ensurdecido: as vozes param de chegar', f1 - f0);
  await B.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(1500);
  const f2 = await fr(); await sleep(1000);
  ok(await fr() - f2 > 20, 'desensurdeceu: voltam a chegar');

  // popup do sinal
  await B.click('#vp-ping'); await sleep(1500);
  const pop = await B.evaluate(() => document.querySelector('.pingpop')?.innerText || '');
  ok(/Pelo site \(túnel\)/.test(pop) && /conexão do site/.test(pop), 'popup do sinal: "Pelo site (túnel)" e a explicação', pop.slice(0, 200));
  await B.keyboard.press('Escape');

  // câmera pelo túnel: avisa que não passa
  await B.evaluate(() => window.__lc.voice.toggleCam?.() ?? window.__lc.voice.setCam?.(true)).catch(() => { });
  ok(await B.waitForFunction(() => window.__toasts.some(t => /câmera e transmissão de tela não chegam/.test(t)), { timeout: 8000 }).then(() => true, () => false), 'ligou a câmera: aviso de que não passa pelo túnel');

  // deploy que reinicia só o app (SIGUSR2): a conexão do túnel passa pelo app e cai; volta sozinha e a voz continua
  srv.kill('SIGUSR2');
  ok(await B.waitForFunction(() => !window.__lc.voice.tunnel?.ready, { timeout: 10000 }).then(() => true, () => false), 'app reiniciou: o túnel caiu');
  ok(await B.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 30000 }).then(() => true, () => false), 'túnel voltou sozinho');
  a = 0; for (let i = 0; i < 15 && a < 2000; i++) a = await aliceHears(A, 1000);
  ok(a > 2000, 'depois do reinício: a Alice ouve o Bruno', a);
  b = 0; for (let i = 0; i < 15 && b < 0.01; i++) b = await brunoHears(B, idA);
  ok(b > 0.01, 'depois do reinício: o Bruno ouve a Alice', b);

  // o processo do mediasoup morre: o servidor refaz a sala; a Alice refaz a mídia e o Bruno entra de novo pelo túnel
  const { execFileSync } = await import('node:child_process');
  const pids = execFileSync('pgrep', ['-f', 'mediasoup-worker']).toString().trim().split('\n').filter(Boolean);
  const mine = pids.filter(pid => { try { return execFileSync('ps', ['-o', 'ppid=', '-p', pid]).toString().trim() === String(srv.pid); } catch { return false; } });
  ok(mine.length === 1, 'achou o worker do mediasoup', mine);
  process.kill(+mine[0], 'SIGKILL');
  ok(await B.waitForFunction(() => !window.__lc.voice.tunnel?.ready, { timeout: 10000 }).then(() => true, () => false), 'worker morreu: o túnel saiu da sala');
  ok(await B.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 30000 }).then(() => true, () => false), 'entrou de novo pelo túnel');
  a = 0; for (let i = 0; i < 20 && a < 2000; i++) a = await aliceHears(A, 1000);
  ok(a > 2000, 'depois do worker refeito: a Alice ouve o Bruno', a);
  b = 0; for (let i = 0; i < 15 && b < 0.01; i++) b = await brunoHears(B, idA);
  ok(b > 0.01, 'depois do worker refeito: o Bruno ouve a Alice', b);

  // saiu: o microfone do túnel fecha para a Alice
  await B.evaluate(() => window.__lc.voice.leave());
  ok(await A.waitForFunction((idB) => !window.__lc.voice.peers.get(idB)?.audioEl, { timeout: 8000 }, idB).then(() => true, () => false), 'o Bruno saiu: a Alice não tem mais a voz dele');
} catch (e) { ok(false, 'erro: ' + e.message); console.log(out.slice(-1500)); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
