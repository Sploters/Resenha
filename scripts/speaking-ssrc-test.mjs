// "Quem fala" dos outros pelo nível que vem em cada pacote de voz (public/voice.js watch/poll, getSynchronizationSources),
// em vez de um Analyser por pessoa no AudioContext. A alice "fala" um arquivo conhecido (trechos do mais alto ao mais
// baixo, com silêncio entre eles); no bruno, o medidor antigo (Analyser, limiar 0,04 e 300 ms, montado aqui pelo teste)
// e o novo rodam ao mesmo tempo sobre a mesma voz: confere que concordam, que acendem juntos, que não piscam mais, que
// apaga quando a alice muta, que segue com a alice mutada só para o bruno e que não há medidor remoto no AudioContext.
// Uso: node scripts/speaking-ssrc-test.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('speakssrc', 3276, 41140);
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
// o mesmo arquivo do speaking-server-test: "fala" (tom com vibrato) em 5 volumes, de 0,5 a 0,03, com silêncio entre eles
const WAV = './.testdata-speakssrc.wav';
{
  const rate = 48000, segs = [];
  for (const amp of [0.5, 0.25, 0.12, 0.06, 0.03]) segs.push([0.9, amp], [0.8, 0]);
  const n = Math.round(segs.reduce((a, [d]) => a + d, 0) * rate), pcm = new Int16Array(n); let i = 0;
  for (const [d, amp] of segs) for (let k = 0; k < d * rate; k++, i++) { const t = i / rate; pcm[i] = Math.round(amp * 32767 * Math.sin(2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 5 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
try {
  const [ra, rb] = await Promise.all(['alice', 'bruno'].map(n => api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })));
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }); await api(rb.token, 'POST', '/invites/' + (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code);
  const [A, B] = [await person(ra.token), await person(rb.token)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  const aid = await A.evaluate(() => window.__lc.S.me.id);
  await B.evaluate(() => window.__lc.voice.toggleMute()); // só a alice fala
  await sleep(3000);
  const meter = await B.evaluate((uid) => { const a = window.__lc.voice.analysers.get(uid); return { rx: !!a?.rx, analyser: !!a?.an }; }, aid);
  ok(meter.rx && !meter.analyser, 'o bruno mede a alice pelo nível dos pacotes, sem Analyser no AudioContext', meter);

  // os dois medidores ao mesmo tempo, a cada 50 ms, por 17 s (2 voltas do arquivo)
  const tl = await B.evaluate(async (uid) => {
    const v = window.__lc.voice, raw = v.peers.get(uid).audioEl.raw, ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(raw).connect(an); const buf = new Uint8Array(512); let at = 0;
    const out = []; const t0 = performance.now();
    while (performance.now() - t0 < 17000) {
      an.getByteTimeDomainData(buf); let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
      const now = performance.now(); if (peak / 128 > .04) at = now;
      out.push([at > 0 && now - at < 300 ? 1 : 0, v.speaking.has(uid) ? 1 : 0]);
      await new Promise(r => setTimeout(r, 50));
    }
    ctx.close(); return out;
  }, aid);
  let same = 0, onOld = 0, onNew = 0, flipsOld = 0, flipsNew = 0; const onsets = [];
  for (let k = 0; k < tl.length; k++) {
    const [o, n] = tl[k]; if (o === n) same++; onOld += o; onNew += n;
    if (k && tl[k - 1][0] !== o) flipsOld++; if (k && tl[k - 1][1] !== n) flipsNew++;
    if (k && o && !tl[k - 1][0]) { let d = null; for (let j = Math.max(0, k - 8); j <= Math.min(tl.length - 1, k + 8); j++) if (tl[j][1] && !(j && tl[j - 1][1])) { if (d == null || Math.abs(j - k) < Math.abs(d)) d = j - k; } onsets.push(d == null ? null : d * 50); }
  }
  const agree = Math.round(same / tl.length * 100), r = { concordancia: agree + '%', ligado: { antigo: Math.round(onOld / tl.length * 100) + '%', novo: Math.round(onNew / tl.length * 100) + '%' }, trocas: { antigo: flipsOld, novo: flipsNew }, acender_ms: onsets };
  console.log('  ', JSON.stringify(r));
  // O medidor antigo é só referência: ele mesmo varia entre rodadas iguais (51-60% "falando"), porque olha 10 ms a cada
  // 50-100 ms e o trecho mais baixo do arquivo (tom puro de 0,03: o pico não passa do 0,04 dele) ora passa, ora não. O
  // novo é conferido contra o arquivo: fala em 53% do tempo; com a folga de 400 ms, de ~61% (4 trechos) a ~82% (os 5).
  // Com voz de verdade (pico 3-4x a média) os dois limiares se equivalem: 92 x 90 amostras "falando" em 100 (MS-SNSD clnsp1.wav)
  ok(agree >= 75, 'o novo concorda com o medidor antigo em 75%+ do tempo', r.concordancia);
  // negativo = o novo acendeu antes (o trecho mais baixo, que o antigo pega atrasado ou nem pega)
  ok(onsets.length >= 8 && onsets.every(d => d != null && d <= 200 && d >= -500), 'cada trecho de fala acende no novo, no máximo 200 ms depois do antigo', onsets);
  const pctNew = onNew / tl.length * 100;
  ok(pctNew >= 55 && pctNew <= 82, 'tempo "falando" do novo bate com o arquivo (53% de fala + folga: 55-82%)', r.ligado.novo);
  ok(flipsNew <= 26, 'o novo não pisca (10 trechos de fala em 17 s = 20 trocas; até 26)', r.trocas);

  // a alice muta: apaga em menos de 1 s e fica apagado
  await A.evaluate(() => window.__lc.voice.toggleMute());
  const t0 = Date.now(); await B.waitForFunction((uid) => !window.__lc.voice.speaking.has(uid), { timeout: 3000, polling: 50 }, aid).catch(() => { });
  const off = Date.now() - t0; await sleep(1500);
  const still = await B.evaluate((uid) => window.__lc.voice.speaking.has(uid), aid);
  ok(off < 1000 && !still, 'a alice mutou: apaga em menos de 1 s e não volta', { ms: off, aceso: still });
  await A.evaluate(() => window.__lc.voice.toggleMute());

  // o bruno silencia a alice só para ele (menu do usuário): continua vendo quando ela fala
  await B.evaluate((uid) => { const v = window.__lc.voice; (v.prefs.mutedUsers ||= {})[uid] = true; v.applyVolume(uid); }, aid);
  const seen = await B.evaluate(async (uid) => { let n = 0; for (let i = 0; i < 40; i++) { if (window.__lc.voice.speaking.has(uid)) n++; await new Promise(r => setTimeout(r, 100)); } return n; }, aid);
  ok(seen >= 8, 'alice silenciada só para o bruno: o "falando" dela continua aparecendo para ele', seen);
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await browser.close(); fs.rmSync(WAV, { force: true }); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nQUEM FALA PELO NÍVEL DOS PACOTES OK'); process.exit(fails ? 1 : 0);
