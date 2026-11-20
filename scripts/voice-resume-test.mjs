// Queda da conexão em tempo real no meio da chamada (server/index.js holdVoice + VOICE_RESUME, public/voice.js resume):
// voz e transmissão seguem pelo SFU, então ninguém deve ver a pessoa sair e entrar, e a transmissão continua.
// Também: sem voltar a tempo, sai como antes; fechar a página (pagehide, código 4000) tira da sala na hora.
// Uso: node scripts/voice-resume-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GRACE = 4000;
const BASE = await ownServer('voiceresume', 3348, 41365, { VOICE_GRACE_MS: String(GRACE) });
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
      // guarda as conexões e os avisos de voz que chegam
      const W = window.WebSocket; window.__ws = []; window.__left = [];
      window.WebSocket = function (...x) { const s = new W(...x); window.__ws.push(s); s.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.t === 'VOICE_STATE' && m.d && !m.d.channel_id) window.__left.push({ uid: m.d.user_id, at: Date.now() }); } catch { } }); return s; };
      window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
    }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; };
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  const bSees = () => B.evaluate((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].filter(e => e.uid === uid).map(e => e.source).sort().join(','), a.id);
  await B.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'screen'), { timeout: 15000 }, a.id).catch(() => { });
  const bSeesOf = (P, uid) => P.evaluate((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].filter(e => e.uid === uid).map(e => e.source).sort().join(','), uid);
  const before = await bSees();
  ok(/mic/.test(before) && /screen/.test(before), 'antes: o Bruno recebe a voz e a transmissão da Alice', before);

  // 1) a conexão da Alice cai (rede): reconecta sozinha e retoma
  const t0 = Date.now();
  await A.evaluate(() => window.__ws.at(-1).close());
  await A.waitForFunction((n) => window.__ws.length > n && window.__ws.at(-1).readyState === 1, { timeout: 20000 }, 1).catch(() => { });
  await A.waitForFunction(() => (window.__lc.voice.capHist || []).some(e => /retomada/.test(e.msg || '')), { timeout: 10000 }).catch(() => { });
  const back = Date.now() - t0;
  await sleep(GRACE + 2000); // passa da tolerância: se não tivesse retomado, o servidor já teria tirado da sala
  const st = await A.evaluate(() => ({ cid: window.__lc.voice.channelId, screen: !!window.__lc.voice.screen, hist: (window.__lc.voice.capHist || []).map(e => e.msg).filter(Boolean) }));
  ok(st.cid === vch.id && st.screen, 'a Alice continua na sala e transmitindo', { voltouEm: back, ...st });
  ok(st.hist.some(m => /retomada/.test(m)) && st.hist.some(m => /caiu por/.test(m)), 'o diagnóstico da captura registra a queda (com o motivo) e a retomada', st.hist);
  const left1 = await B.evaluate((uid) => window.__left.filter(x => x.uid === uid).length, a.id);
  ok(left1 === 0, 'o Bruno não viu a Alice sair', left1);
  const after = await bSees();
  ok(after === before, 'o Bruno continua com a voz e a transmissão da Alice', after);
  ok(await B.evaluate((uid) => window.__lc.S.voice.get(uid)?.channel_id, a.id) === vch.id, 'para o Bruno a Alice segue na sala');
  // avisos do SFU depois da retomada vão para a conexão NOVA da Alice (antes iam para a da entrada, já morta)
  await B.evaluate(() => window.__lc.voice.toggleCam());
  await A.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'cam'), { timeout: 15000 }, b.id).catch(() => { });
  ok(await A.evaluate((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'cam'), b.id), 'depois da retomada, a câmera que o Bruno ligou chega à Alice', { aliceVe: await bSeesOf(A, b.id), brunoCam: await B.evaluate(() => !!window.__lc.voice.cam), err: await B.evaluate(() => window.__lc.voice.error) });

  // 2) fechar a página (app fechado): sai na hora, sem esperar a tolerância
  const t1 = Date.now();
  await A.close({ runBeforeUnload: false });
  await B.waitForFunction((uid) => window.__left.some(x => x.uid === uid), { timeout: GRACE + 5000 }, a.id).catch(() => { });
  const leftAt = await B.evaluate((uid) => window.__left.find(x => x.uid === uid)?.at, a.id);
  ok(leftAt && leftAt - t1 < GRACE - 1000, 'fechou a página: a Alice sai na hora para o Bruno', leftAt ? leftAt - t1 : null);
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await bA.close(); await bB.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nRETOMADA DA VOZ OK'); process.exit(fails ? 1 : 0);
