// Queda de rede de 15 s de quem está transmitindo (troca de Wi-Fi, VPN reconectando), com a tolerância padrão do
// servidor (VOICE_GRACE_MS) e a espera entre tentativas de verdade do app (public/gateway.js, public/backoff.js):
// a conexão em tempo real cai e, durante 15 s, nenhuma tentativa de reconectar consegue (vão para uma porta fechada).
// Antes: as tentativas iam se espaçando até 10 s (±50%), a rede voltava aos 15 s e a próxima tentativa vinha tarde
// demais; o servidor tirava a pessoa da sala (os outros viam sair) e a transmissão parava.
// Também: a conferência da sessão (GET /users/0) pendurada não atrasa mais a reconexão.
// Uso: node scripts/voice-outage-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const OUT_MS = +(process.env.OUT_MS || 15000);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('voiceoutage', 3355, 41400);
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await api('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'T' }); await api(b.tok, 'POST', '/invites/' + (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code);
  const open = async (br, tok) => { const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
      navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
      // sem rede: as tentativas de reconectar vão para uma porta fechada; a conferência da sessão fica pendurada
      const W = window.WebSocket; window.__ws = []; window.__left = []; window.__off = false;
      window.WebSocket = function (url, ...x) { const s = new W(window.__off ? url.replace(/^ws(s?):\/\/[^/]+/, 'ws$1://127.0.0.1:9') : url, ...x); window.__ws.push(s);
        s.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.t === 'VOICE_STATE' && m.d && !m.d.channel_id) window.__left.push({ uid: m.d.user_id, at: Date.now() }); } catch { } }); return s; };
      window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
      const F = window.fetch; window.fetch = (u, ...x) => window.__off && /\/api\/users\/0$/.test(String(u)) ? new Promise(() => { }) : F(u, ...x);
    }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; };
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const P of [A, B]) { await P.evaluate(async (vc) => { await window.__lc.voice.join(vc); }, vch); await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await B.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'screen'), { timeout: 15000 }, a.id);
  await B.evaluate((uid) => window.__lc.voice.openStream(uid), a.id);
  const frames = () => B.evaluate(async (uid) => { let n = 0; for (const e of window.__lc.voice.sfu?.consumers.values() || []) if (e.uid === uid && e.source === 'screen') (await e.c.rtpReceiver.getStats()).forEach(x => { if (x.type === 'inbound-rtp') n += x.framesDecoded || 0; }); return n; }, a.id);
  await sleep(3000);

  // queda: fecha a conexão e nenhuma tentativa consegue por OUT_MS
  const f0 = await frames(), t0 = Date.now();
  await A.evaluate(() => { window.__off = true; window.__ws.at(-1).close(); });
  await sleep(OUT_MS / 2); const fMid = await frames();
  await sleep(OUT_MS / 2);
  await A.evaluate(() => { window.__off = false; });
  await A.waitForFunction(() => window.__ws.at(-1).readyState === 1, { timeout: 15000 }).catch(() => { });
  const back = Date.now() - t0 - OUT_MS;
  await sleep(4000);
  const st = await A.evaluate(() => ({ cid: window.__lc.voice.channelId, ready: !!window.__lc.voice.sfu?.ready, screen: !!window.__lc.voice.screen }));
  const left = await B.evaluate((uid) => window.__left.filter(x => x.uid === uid).length, a.id);
  const f1 = await frames(); await sleep(2000); const f2 = await frames();
  console.log(`  queda de ${OUT_MS / 1000} s: reconectou ${(back / 1000).toFixed(1)} s depois de a rede voltar`);
  ok(back < 4000, 'reconecta em até ~3 s depois de a rede voltar (espera entre tentativas limitada em chamada)', back);
  ok(left === 0, 'o Bruno não viu a Alice sair', left);
  ok(st.cid === vch && st.ready && st.screen, 'a Alice continua na sala e transmitindo', st);
  ok(fMid > f0, 'durante a queda a transmissão continua chegando ao Bruno (vai direto ao SFU)', { antes: f0, meio: fMid });
  ok(f2 > f1, 'depois da queda a transmissão continua chegando', { f1, f2 });
  ok(await B.evaluate((uid) => window.__lc.S.voice.get(uid)?.channel_id, a.id) === vch, 'para o Bruno a Alice segue na sala');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await bA.close(); await bB.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nQUEDA DE REDE OK'); process.exit(fails ? 1 : 0);
