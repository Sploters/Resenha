// "Falando" pelo servidor (AudioLevelObserver do mediasoup, server/sfu.js levelsFor): quem está ensurdecido não recebe
// mais as vozes (pausadas no servidor mesmo com a janela aberta) e continua vendo quem fala. Três pessoas na sala; a alice
// fala (microfone falso tocando um arquivo: 0,9 s de "fala" e 0,8 s de silêncio, do volume alto ao baixo), o bruno ensurdece e a carla ouve normal. Compara, a cada 50 ms,
// o "falando" da alice no bruno (servidor) com o da carla (medidor local) e mede a voz que chega ao bruno.
// Uso: node scripts/speaking-server-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const BASE = await ownServer('speaking', 3333, 41240, process.env.SFU_SPEAK_DB ? { SFU_SPEAK_DB: process.env.SFU_SPEAK_DB } : {});
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
// microfone falso tocando um arquivo conhecido: trechos de "fala" (tom com vibrato, volumes de alto a baixo) e silêncio
const WAV = './.testdata-speaking.wav';
{
  const rate = 48000, segs = []; // [segundos, amplitude]
  for (const amp of [0.5, 0.25, 0.12, 0.06, 0.03]) segs.push([0.9, amp], [0.8, 0]);
  const n = Math.round(segs.reduce((a, [d]) => a + d, 0) * rate), pcm = new Int16Array(n); let i = 0;
  for (const [d, amp] of segs) for (let k = 0; k < d * rate; k++, i++) { const t = i / rate; pcm[i] = Math.round(amp * 32767 * Math.sin(2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 5 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  (await import('node:fs')).writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
const audioIn = (p, ms = 2000) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu, recv = [...s.consumers.values()].filter(e => e.source === 'mic').map(e => e.c.rtpReceiver);
  const snap = async () => { let b = 0; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') b += x.bytesReceived || 0; }); return b; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); return Math.round(((await snap()) - a) * 8 / ms); // kbps
}, ms);
// linha do tempo do "falando" de uid durante ms (amostra a cada 50 ms, no relógio da página)
const timeline = (p, uid, ms) => p.evaluate(async (uid, ms) => { const out = []; const t0 = Date.now(); while (Date.now() - t0 < ms) { out.push([Date.now(), window.__lc.voice.speaking.has(uid) ? 1 : 0]); await new Promise(r => setTimeout(r, 50)); } return out; }, uid, ms);
try {
  const [ra, rb, rc] = await Promise.all(['alice', 'bruno', 'carla'].map(n => api('', 'POST', '/register', { username: n, password: 'senha123' })));
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const r of [rb, rc]) await api(r.token, 'POST', '/invites/' + inv);
  const [A, B, C] = [await person(ra.token), await person(rb.token), await person(rc.token)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B, C]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  const aid = await A.evaluate(() => window.__lc.S.me.id);
  for (const p of [B, C]) await p.evaluate(() => window.__lc.voice.toggleMute()); // só a alice fala
  await sleep(3000);
  const before = await audioIn(B);
  ok(before > 10, 'antes: o bruno recebe a voz da alice (kbps)', before);
  await B.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(2500);
  const deaf = await audioIn(B);
  ok(deaf < 2, 'ensurdecido com a janela aberta: a voz da alice não chega mais (kbps)', deaf);
  // o "falando" no bruno (servidor) e na carla (medidor local), ao mesmo tempo
  const [tb, tc] = await Promise.all([timeline(B, aid, 17000), timeline(C, aid, 17000)]);
  const at = (tl, t) => { let v = 0; for (const [x, y] of tl) { if (x > t) break; v = y; } return v; };
  let same = 0, n = 0, onB = 0, onC = 0, flipsB = 0, flipsC = 0;
  for (let k = 1; k < tc.length; k++) { const t = tc[k][0], b = at(tb, t), c = tc[k][1]; n++; if (b === c) same++; onB += b; onC += c; if (tc[k][1] !== tc[k - 1][1]) flipsC++; }
  for (let k = 1; k < tb.length; k++) if (tb[k][1] !== tb[k - 1][1]) flipsB++;
  const agree = Math.round(same / n * 100);
  // atraso entre os dois: o deslocamento (até ±1,5 s) em que mais batem
  let best = [0, 0]; for (let lag = -1500; lag <= 1500; lag += 50) { let m = 0; for (let k = 1; k < tc.length; k++) if (at(tb, tc[k][0] + lag) === tc[k][1]) m++; if (m > best[1]) best = [lag, m]; }
  console.log(`  melhor deslocamento: servidor ${best[0] > 0 ? 'atrasado' : 'adiantado'} ${Math.abs(best[0])} ms -> iguais ${Math.round(best[1] / n * 100)}%`);
  if (process.env.DEBUG) { const str = (tl) => tl.map(([, v]) => v ? '#' : '.').join(''); console.log('  servidor ' + str(tb).slice(0, 340) + '\n  local    ' + str(tc).slice(0, 340)); }
  console.log(`  falando: servidor ${Math.round(onB / n * 100)}% do tempo (${flipsB} trocas), medidor local ${Math.round(onC / n * 100)}% (${flipsC} trocas), iguais ${agree}% das amostras`);
  ok(flipsB >= 4 && onB > 0, 'ensurdecido, o bruno vê a alice começar e parar de falar', { trocas: flipsB });
  // descontando o atraso do servidor (ele mede o nível do áudio a cada intervalo: 100–150 ms atrás do medidor local). Sem
  // descontar, a coincidência ficava em 77% num PC rápido e 73% na máquina do GitHub, colada no limite
  const agreeLag = Math.round(best[1] / n * 100);
  ok(agreeLag >= 75 && Math.abs(best[0]) <= 500, 'o "falando" do servidor bate com o medidor local na maior parte do tempo (% com o atraso descontado, atraso em ms)', { iguais: agreeLag, atraso: best[0], sem_descontar: agree });
  // mudo de quem fala: some do "falando"
  await A.evaluate(() => window.__lc.voice.toggleMute()); await sleep(1500);
  const quiet = await timeline(B, aid, 2000);
  ok(quiet.every(([, v]) => !v), 'alice mutada: o bruno não a vê mais falando');
  await A.evaluate(() => window.__lc.voice.toggleMute()); await sleep(1000);
  // tirou o ensurdecer: a voz volta
  await B.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(2500);
  const after = await audioIn(B);
  ok(after > 10, 'tirou o ensurdecer: a voz volta a chegar (kbps)', after);
  const tb2 = await timeline(B, aid, 4000);
  ok(tb2.some(([, v]) => v), 'e o "falando" volta a ser medido pelo app', tb2.filter(([, v]) => v).length);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
