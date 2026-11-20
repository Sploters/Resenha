// Sair e entrar de novo na MESMA sala logo em seguida (rejoin() da recuperação, cliques rápidos), 30 vezes seguidas,
// com mais 2 pessoas na sala. Antes, metade das vezes a pessoa terminava fora da sala ou "conectando" para sempre:
// - o aviso atrasado da própria saída ("saiu de <sala>") chegava depois da entrada nova e o app saía de novo
//   (public/gateway.js, ownLeaveEcho em public/voice.js);
// - passando do limite de entradas por segundo, o servidor ignorava o VOICE_JOIN sem responder nada (agora guarda e
//   aplica quando sobra ficha: WS_KEEP em server/index.js);
// - a mídia da entrada que acabou de sair falhava ("queue stopped") e virava erro e "falha ao conectar" na entrada nova.
// Uso: node scripts/voice-join-race-test.mjs     (N=30 ciclos)
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', N = +(process.env.N || 30);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const BASE = await ownServer('joinrace', 3356, 41405);
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const browsers = [];
const open = async (tok) => { const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }); browsers.push(b); const p = await b.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 }); return p; };
try {
  const r = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const g = await api(r.token, 'POST', '/guilds', { name: 'T' }), inv = (await api(r.token, 'POST', `/guilds/${g.id}/invites`)).code;
  const A = await open(r.token);
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const n of ['bruno', 'carla']) { const u = await api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); await api(u.token, 'POST', '/invites/' + inv); const q = await open(u.token); await q.evaluate(async (vc) => { await window.__lc.voice.join(vc); }, vc); }
  await A.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  // telemetria de falha da voz durante os ciclos
  await A.evaluate(() => { window.__fails = []; const v = window.__lc.voice, o = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(v), 'error'); void o; let err = null; Object.defineProperty(v, 'error', { get: () => err, set: (x) => { err = x; if (x) window.__fails.push(x); }, configurable: true }); });
  const res = await A.evaluate(async (vc, N) => {
    const v = window.__lc.voice, out = { bad: 0, ms: [] };
    for (let i = 0; i < N; i++) {
      const t0 = performance.now(); v.leave({ silent: true }); await v.join(vc);
      for (let k = 0; k < 100 && !v.sfu?.ready; k++) await new Promise(r => setTimeout(r, 50));
      if (!v.sfu?.ready || v.channelId !== vc) out.bad++; else out.ms.push(Math.round(performance.now() - t0));
    }
    await new Promise(r => setTimeout(r, 1500));
    out.fim = { naSala: v.channelId === vc, pronto: !!v.sfu?.ready, mic: !!v.sfu?.producers?.mic && !v.sfu.producers.mic.closed, servidor: window.__lc.S.voice.get(window.__lc.S.me.id)?.channel_id === vc };
    return out;
  }, vc, N);
  const sorted = [...res.ms].sort((a, b) => a - b);
  console.log(`  ${N} ciclos: mediana ${sorted[sorted.length >> 1]} ms, máximo ${sorted.at(-1)} ms`);
  ok(res.bad === 0, `todos os ${N} ciclos terminam na sala com a voz conectada`, res.bad);
  ok(res.fim.naSala && res.fim.pronto && res.fim.mic && res.fim.servidor, 'no fim: na sala, voz pronta, microfone no ar e o servidor de acordo', res.fim);
  const fl = await A.evaluate(() => window.__fails);
  ok(fl.length === 0, 'nenhum erro de voz na tela durante os ciclos', fl.slice(0, 3));
  const seen = await (await browsers[1].pages()).at(-1).evaluate((uid) => window.__lc.S.voice.get(uid)?.channel_id, await A.evaluate(() => window.__lc.S.me.id));
  ok(seen === vc, 'para os outros a Alice está na sala', seen);
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { for (const b of browsers) await b.close().catch(() => { }); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nSAIR E ENTRAR OK'); process.exit(fails ? 1 : 0);
