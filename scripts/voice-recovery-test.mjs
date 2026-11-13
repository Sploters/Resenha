// Recuperação automática da voz, sem reiniciar o app nem sair da sala (public/voice.js → watchMedia/iceRestart/
// mediaReconnect; server/sfu.js → recriar worker morto):
// 1) conexão de mídia "caiu" (transporte em failed): reinício do ICE com credenciais novas do servidor, a voz continua
// 2) mídia refeita do zero (SFU_REJOIN): a voz volta, mudo continua, e os outros não veem a pessoa sair/entrar
// 3) o processo do mediasoup (worker) morre: o servidor recria sozinho, avisa a sala e todos voltam a se ouvir
// Uso: node scripts/voice-recovery-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3329, BASE = `http://localhost:${PORT}`, DATA = './.testdata-voicerecovery';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41220', RTC_IPS: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const workerPid = () => { try { return execFileSync('pgrep', ['-P', String(srv.pid), '-f', 'mediasoup-worker']).toString().trim().split('\n').filter(Boolean)[0] || null; } catch { return null; } };
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t; window.__leaves = 0; window.__toasts = [];
    new MutationObserver(() => { const e = document.getElementById('toast'); if (e && window.__toasts.at(-1) !== e.textContent) window.__toasts.push(e.textContent); }).observe(document, { childList: true, subtree: true });
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
// a voz volta a chegar em até `ms`
const hearsAgain = async (p, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await audioIn(p, 1000) > 1000) return Date.now() - t0; await sleep(300); } return null; };
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'bruno', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }); await api(rb.token, 'POST', '/invites/' + (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code);
  const [A, B] = [await person(ra.token), await person(rb.token)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await sleep(2500);
  ok(await audioIn(B) > 2000 && await audioIn(A) > 2000, 'antes: as duas se ouvem');
  const idA = await A.evaluate(() => window.__lc.S.me.id);
  // o bruno conta quantas vezes a alice "saiu" da sala (VOICE_STATE sem canal): não pode acontecer
  await B.evaluate((idA) => { const S = window.__lc.S, orig = S.voice.delete.bind(S.voice); S.voice.delete = (k) => { if (k === idA) window.__leaves++; return orig(k); }; }, idA);

  // ---- 1) reinício do ICE ----
  const ice = await A.evaluate(async () => {
    const v = window.__lc.voice, s = v.sfu, t = s.recv; let asked = 0; const orig = v.sfuReq.bind(v);
    v.sfuReq = (op, d) => { if (op === 'restart_ice') asked++; return orig(op, d); };
    // como se a conexão tivesse caído: o transporte diz "failed" até o reinício do ICE ser pedido
    Object.defineProperty(t, 'connectionState', { get: () => 'failed', configurable: true });
    v.watchMedia(t, s, 'failed'); delete t.connectionState; // a verificação do estado é feita na hora da chamada
    await new Promise(r => setTimeout(r, 9000)); v.sfuReq = orig; // o reinício termina e a verificação de 8 s vê que voltou
    return { asked, same: v.sfu === s, state: t.connectionState, send: s.send.connectionState, recovering: v.recovering, tries: s.iceTries, ready: s.ready };
  });
  ok(ice.asked === 1 && ice.same && ice.state === 'connected' && !ice.recovering, 'conexão caiu: pediu credenciais ICE novas ao servidor e reiniciou sem refazer tudo', ice);
  ok(await hearsAgain(A, 10000) != null, 'depois do reinício do ICE a alice continua ouvindo');

  // ---- 2) mídia refeita do zero (SFU_REJOIN) ----
  await A.evaluate(() => { const v = window.__lc.voice; if (!v.muted) v.toggleMute(); });
  await B.evaluate(() => { window.__lc.voice.sfu.iceTries = 0; });
  const t1 = Date.now();
  await A.evaluate(() => { const v = window.__lc.voice; v._oldSfu = v.sfu; v.mediaReconnect('teste'); });
  await A.waitForFunction(() => { const v = window.__lc.voice; return v.sfu && v.sfu !== v._oldSfu && v.sfu.ready && !v.recovering; }, { timeout: 20000, polling: 100 }).catch(() => { });
  const r2 = await A.evaluate(() => { const v = window.__lc.voice; return { nova: !!v.sfu && v.sfu !== v._oldSfu, pronta: !!v.sfu?.ready, recuperando: v.recovering, mudo: v.muted, sala: v.channelId, toast: window.__toasts.includes('Voz reconectada') }; });
  ok(r2.nova && r2.pronta && !r2.recuperando, `mídia refeita do zero em ${Date.now() - t1} ms`, r2);
  ok(r2.mudo === true && r2.sala === vc, 'continua na mesma sala e mutada');
  ok(r2.toast, 'aviso "Voz reconectada"');
  await A.evaluate(() => { const v = window.__lc.voice; if (v.muted) v.toggleMute(); });
  ok(await hearsAgain(B, 15000) != null, 'o bruno volta a ouvir a alice');
  ok(await hearsAgain(A, 15000) != null, 'a alice volta a ouvir o bruno');
  ok(await B.evaluate(() => window.__leaves) === 0, 'o bruno não viu a alice sair e entrar');

  // ---- 3) o worker do mediasoup morre ----
  const pid1 = workerPid(); ok(!!pid1, 'worker do mediasoup rodando', pid1);
  const t2 = Date.now(); process.kill(+pid1, 'SIGKILL');
  const back = await Promise.all([A, B].map(p => hearsAgain(p, 30000)));
  ok(back.every(x => x != null), `worker morto: as duas voltam a se ouvir sozinhas (${Date.now() - t2} ms)`, back);
  await sleep(1500);
  const pid2 = workerPid(); ok(!!pid2 && pid2 !== pid1, 'servidor recriou o worker', { antes: pid1, depois: pid2 });
  ok(/worker do mediasoup da porta 41220 morreu/.test(out) && /recriado/.test(out), 'servidor registrou a morte e a recriação');
  const st = await Promise.all([A, B].map(p => p.evaluate((vc) => ({ sala: window.__lc.voice.channelId === vc, sfu: !!window.__lc.voice.sfu?.ready, rec: window.__lc.voice.recovering }), vc)));
  ok(st.every(x => x.sala && x.sfu && !x.rec), 'as duas continuam na sala, conectadas', st);
  ok(await B.evaluate(() => window.__leaves) === 0, 'ninguém apareceu saindo da sala');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); try { srv.kill('SIGKILL'); } catch { } console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
