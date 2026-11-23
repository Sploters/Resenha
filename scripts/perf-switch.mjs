// Troca de canal DURANTE uma chamada assistindo transmissão (o caso "espera:chamada+assistindo" da telemetria) e o tempo
// de entrar na voz (microfone pronto), com a CPU desacelerada (CPU=4 = PC fraco). Mostra o tempo de cada troca (do clique
// até as mensagens na tela, igual à telemetria channel_switch) e, com PROFILE=1, as funções que mais gastaram.
// Uso: node scripts/perf-switch.mjs   CPU=4 N=12 LAT=80 PROFILE=1 JSON=saida.json
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const CPU = +(process.env.CPU || 4), N = +(process.env.N || 12), PROFILE = !!process.env.PROFILE;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('perfswitch', 3367, 41370);
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args, protocolTimeout: 120000 }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
async function open(browser, tok) { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false }); }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; }
const R = { cpu: CPU };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'T' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.tok, 'POST', '/invites/' + inv);
  const t2 = await call(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'outro', type: 0 });
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const chans = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.map(x => ({ id: x.id, type: x.type })), g.id);
  const vch = chans.find(x => x.type === 2), texts = chans.filter(x => x.type === 0).map(x => x.id);
  if (!texts.includes(t2.id)) texts.push(t2.id);
  // mensagens de várias pessoas (uma só mandando 40 seguidas cai no limite anti-spam)
  const posters = [a, b, await reg('carla'), await reg('davi')];
  for (const p of posters.slice(2)) await call(p.tok, 'POST', '/invites/' + inv);
  for (const cid of texts) for (let i = 0; i < 24; i++) { const r = await call(posters[i % 4].tok, 'POST', `/channels/${cid}/messages`, { content: `mensagem ${i} com um texto de tamanho normal para preencher a lista` }); if (!r.id) { await sleep(1500); i--; } }
  const cdp = await A.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // LAT=80: latência de internet até o servidor (o app fala com um servidor de casa, não com localhost)
  if (+process.env.LAT) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: +process.env.LAT, downloadThroughput: -1, uploadThroughput: -1 }); }
  // entrar na voz: duas vezes (a 1ª carrega filtro de ruído e modelos; a 2ª já tem tudo)
  const joinMs = async (P) => P.evaluate(async (gid, cid) => { window.__lc.go(gid, cid); const t = performance.now(); await window.__lc.joinVoice(cid); await new Promise(r => { const k = () => window.__lc.voice?.mic ? r() : setTimeout(k, 5); k(); }); return Math.round(performance.now() - t); }, g.id, vch.id);
  console.log("  (entrando na voz)"); R.join1 = await joinMs(A); await A.evaluate(() => window.__lc.voice.leave()); await sleep(2500); R.join2 = await joinMs(A);
  console.log(`  entrar na voz (microfone pronto): 1ª ${R.join1} ms, 2ª ${R.join2} ms`);
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
  await B.evaluate(async (cid) => { await window.__lc.joinVoice(cid); }, vch.id);
  await B.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 30000 });
  await A.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 30000 });
  await B.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await A.waitForFunction((bid) => !!window.__lc.voice.peers.get(bid)?.streams?.screen, { timeout: 30000 }, b.id).catch(() => { });
  await A.evaluate((bid) => window.__lc.voice.openStream(bid), b.id);
  await A.waitForFunction(() => [...document.querySelectorAll('#stage video')].some(v => v.videoWidth > 0), { timeout: 30000 }).catch(() => console.log('  (sem vídeo da transmissão na tela de A)'));
  await sleep(3000);
  if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  // troca: canal de texto ↔ outro texto ↔ volta para a sala (palco com a transmissão)
  const seq = []; for (let i = 0; i < N; i++) seq.push(i % 3 === 2 ? vch.id : texts[i % 2]);
  const times = { text: [], voice: [] };
  for (const cid of seq) {
    const ms = await A.evaluate((gid, cid, vid) => new Promise((res) => {
      const t = performance.now(); window.__lc.go(gid, cid);
      const done = () => requestAnimationFrame(() => res(Math.round(performance.now() - t)));
      const stop = performance.now() + 15000;
      const k = () => performance.now() > stop ? res(-1) : (cid === vid ? document.querySelector('#stage .tile') : (window.__lc.S.messages.has(cid) && document.querySelector('#msgs .msg') && !document.querySelector('#msgs .skeleton'))) && window.__lc.S.view.cid === cid ? done() : setTimeout(k, 2); k();
    }), g.id, cid, vch.id);
    if (ms < 0) console.log('  troca não terminou:', JSON.stringify(await A.evaluate((cid) => ({ cid, view: window.__lc.S.view, msgs: window.__lc.S.messages.get(cid)?.length, box: document.querySelector('#msgs')?.className, html: (document.querySelector('#main')?.innerHTML || '').slice(0, 300) }), cid)));
    times[cid === vch.id ? 'voice' : 'text'].push(ms); await sleep(700);
  }
  R.switch = { text: times.text, voice: times.voice, textMed: med(times.text), voiceMed: med(times.voice) };
  console.log(`  troca para canal de texto: mediana ${R.switch.textMed} ms  ${JSON.stringify(times.text)}`);
  console.log(`  troca para a sala (palco): mediana ${R.switch.voiceMed} ms  ${JSON.stringify(times.voice)}`);
  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop'), self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map(n => [n.id, n]));
    const cnt = new Map(); profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)));
    for (const [id, us] of cnt) { const f = byId.get(id).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + us); }
    R.top = [...self].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, us]) => [k, Math.round(us / 1000)]);
    console.log('  mais gasto (ms, próprio):'); for (const [k, ms] of R.top) console.log('    ', String(ms).padStart(6), k);
    // inclusivo: cada amostra conta para a função e para todas as que a chamaram
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const inc = new Map();
    for (const [id, us] of cnt) { const seen = new Set(); for (let x = id; x != null; x = parent.get(x)) { const f = byId.get(x).callFrame; if (!f.url) continue; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}:${f.columnNumber + 1}`; if (seen.has(k)) continue; seen.add(k); inc.set(k, (inc.get(k) || 0) + us); } }
    R.inclusive = [...inc].filter(([k]) => !/pptr:/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 30).map(([k, us]) => [k, Math.round(us / 1000)]);
    console.log('  mais gasto (ms, inclusivo):'); for (const [k, ms] of R.inclusive) console.log('    ', String(ms).padStart(6), k);
  }
} catch (e) { R.error = String(e.stack || e); console.log(R.error); }
finally { if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(R, null, 1)); await bA.close(); await bB.close(); setTimeout(() => process.exit(0), 300); }
