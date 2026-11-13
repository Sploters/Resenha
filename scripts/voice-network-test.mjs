// Rede instável na voz: um relé UDP entre os navegadores e o SFU (o SFU escuta em 127.0.0.2 e anuncia 127.0.0.1, onde o
// relé escuta) perde, atrasa e embaralha pacotes nos dois sentidos. Duas pessoas na sala (microfone falso do Chromium:
// um bipe contínuo); mede no bruno o áudio que chega da alice em cada cenário: pacotes perdidos, pedaços inventados para
// tapar buraco (concealed), buffer de oscilação (jitter buffer) e pacotes de correção (FEC) recebidos.
// (Usado para medir o NACK de áudio — o SFU reenviando a voz perdida —, que foi descartado: ver docs/PLANO-DESEMPENHO.md.)
// Uso: node scripts/voice-network-test.mjs     (SECS=8 por cenário)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
const PORT = 3329, BASE = `http://localhost:${PORT}`, DATA = './.testdata-voicenet', RTC = 41220, SECS = +(process.env.SECS || 8);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- relé: 127.0.0.1:RTC (o que o navegador vê) <-> 127.0.0.2:RTC (o SFU) ----
const net = { loss: 0, delay: 0, jitter: 0, burst: 0, only: null }; // only: 'down' = só do SFU para quem ouve // burst: chance de começar uma rajada de 5 perdas seguidas
const front = dgram.createSocket('udp4'), back = new Map(); let lost = 0, passed = 0;
const drop = (st) => { if (st.burst > 0) { st.burst--; return true; } if (net.burst && Math.random() < net.burst) { st.burst = 4; return true; } return Math.random() < net.loss; };
// só perde mídia (RTP/RTCP: 1º byte 128–191); STUN e DTLS passam, senão a conexão nem abre
const isRtp = (m) => m[0] >= 128 && m[0] <= 191;
const later = (fn) => { const d = net.delay + (net.jitter ? (Math.random() * 2 - 1) * net.jitter : 0); if (d <= 0) fn(); else setTimeout(fn, d); };
front.on('message', (msg, from) => {
  const k = from.address + ':' + from.port; let b = back.get(k);
  if (!b) {
    b = { s: dgram.createSocket('udp4'), up: { burst: 0 }, down: { burst: 0 } }; back.set(k, b);
    b.s.on('message', (m) => { if (isRtp(m) && drop(b.down)) { lost++; return; } passed++; later(() => front.send(m, from.port, from.address)); });
  }
  if (isRtp(msg) && net.only !== 'down' && drop(b.up)) { lost++; return; } passed++;
  later(() => b.s.send(msg, RTC, '127.0.0.2'));
});
await new Promise(r => front.bind(RTC, '127.0.0.1', r));

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC), RTC_ANNOUNCED_IP: '127.0.0.1', RTC_LISTEN_IP: '127.0.0.2' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
// áudio da alice chegando ao bruno durante `ms`: diferença dos contadores do inbound-rtp
const listen = (p, ms) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu, recv = [...s.consumers.values()].filter(e => e.source === 'mic').map(e => e.c.rtpReceiver);
  const snap = async () => { const o = { rec: 0, lost: 0, conc: 0, samples: 0, jbd: 0, jbn: 0, fec: 0, nack: 0 }; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') { o.rec += x.packetsReceived || 0; o.lost += x.packetsLost || 0; o.conc += x.concealedSamples || 0; o.samples += x.totalSamplesReceived || 0; o.jbd += x.jitterBufferDelay || 0; o.jbn += x.jitterBufferEmittedCount || 0; o.fec += x.fecPacketsReceived || 0; o.nack += x.nackCount || 0; } }); return o; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); const z = await snap();
  const d = (k) => z[k] - a[k], tot = d('rec') + d('lost');
  return { perdidos_pct: tot ? +(d('lost') / tot * 100).toFixed(1) : null, tapado_pct: d('samples') ? +(d('conc') / d('samples') * 100).toFixed(1) : null,
    buffer_ms: d('jbn') ? Math.round(d('jbd') / d('jbn') * 1000) : null, fec: d('fec'), nack: d('nack'), pacotes: d('rec'), perdidos: d('lost') };
}, ms);
const out = {};
try {
  const [ra, rb] = await Promise.all(['alice', 'bruno'].map(n => api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })));
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code;
  await api(rb.token, 'POST', '/invites/' + inv);
  // alice fala; bruno ouve, mutado
  const [A, B] = [await person(ra.token), await person(rb.token)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await B.evaluate(() => window.__lc.voice.toggleMute());
  await sleep(3000);
  ok(back.size >= 2, 'as conexões de voz passam pelo relé', back.size);
  const cases = [['limpa', {}], ['5% de perda', { loss: 0.05 }], ['15% de perda', { loss: 0.15 }],
    ['5% só na descida', { loss: 0.05, only: 'down' }], ['15% só na descida', { loss: 0.15, only: 'down' }], ['rajadas (5 seguidas, ~5%)', { burst: 0.01 }],
    ['atraso 80 ± 40 ms', { delay: 80, jitter: 40 }], ['10% de perda + 60 ± 40 ms', { loss: 0.10, delay: 60, jitter: 40 }]];
  for (const [name, c] of cases) {
    Object.assign(net, { loss: 0, delay: 0, jitter: 0, burst: 0, only: null }, c);
    await sleep(3000); // a correção (FEC) e o buffer se ajustam
    const l0 = lost, b = out[name] = await listen(B, SECS * 1000); b.rele_perdeu = lost - l0;
    console.log(`  ${name.padEnd(28)} perdidos ${String(b.perdidos_pct).padStart(5)}%   tapado ${String(b.tapado_pct).padStart(5)}%   buffer ${String(b.buffer_ms).padStart(4)} ms   FEC ${b.fec}`);
  }
  Object.assign(net, { loss: 0, delay: 0, jitter: 0, burst: 0, only: null });
  await sleep(3000); const rec = await listen(B, 3000);
  ok(rec.perdidos_pct < 1 && rec.pacotes > 100, 'rede volta ao normal: a voz volta limpa', rec);
  ok(out['15% de perda'].pacotes > 100, 'com 15% de perda a voz continua chegando', out['15% de perda'].pacotes);
  ok(out['atraso 80 ± 40 ms'].tapado_pct < 2, 'com atraso oscilando o buffer absorve (quase nada inventado)', out['atraso 80 ± 40 ms'].tapado_pct);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); try { srv.kill('SIGKILL'); } catch { } front.close(); console.log(`  relé: ${passed} pacotes passaram, ${lost} perdidos de propósito`); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
