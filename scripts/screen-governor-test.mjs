// Controle da transmissão pelo Chromium quando o codificador não dá conta (public/voice.js govTick/govApply, M2 + M3).
// Determinístico: as leituras do codificador (fps, resolução, limite) são simuladas na página de quem transmite, então o
// teste não depende de quanto processador a máquina tem. O vídeo de verdade continua indo para quem assiste.
// (Medição com carga real de processador: scripts/screen-cpu-bench.mjs.)
// Uso: node scripts/screen-governor-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3343, BASE = `http://localhost:${PORT}`, DATA = './.testdata-screengov';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41350', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function session(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; x.fillStyle = `hsl(${n * 5 % 360} 60% 40%)`; x.fillRect(0, 0, 1920, 1080); }, 33); return c.captureStream(30); };
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
// estado do controle e dos parâmetros do codificador de quem transmite
const state = (A) => A.evaluate(() => {
  const v = window.__lc.voice, g = v.gov, prm = v.sfu.producers.screen?.rtpSender?.getParameters();
  return g && prm && { level: g.level, lv: g.ladder[g.level], off: g.layersOff, upWait: g.upWait, note: g.note, deg: prm.degradationPreference,
    enc: prm.encodings.map(e => ({ active: e.active, scale: +(e.scaleResolutionDownBy || 1).toFixed(2), fps: e.maxFramerate })) };
});
const until = async (A, fn, arg, ms = 30000) => { try { await A.waitForFunction(fn, { timeout: ms, polling: 250 }, arg); return true; } catch { return false; } };
try {
  const ra = await api('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'beto', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Live' }); const inv = await api(ra.token, 'POST', `/guilds/${g.id}/invites`); await api(rb.token, 'POST', `/invites/${inv.code}`);
  const A = await session(ra.token), B = await session(rb.token);
  const aid = await A.evaluate(() => window.__lc.S.me.id);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  for (const p of [A, B]) { await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500); await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click()); }
  await sleep(3000);

  // degraus: só os que custam menos (pixels x fps), nunca abaixo de 720p
  const ladders = await A.evaluate(() => { const v = window.__lc.voice, keep = v.screenOpts; const out = {};
    for (const [res, fps] of [[1080, 60], [1080, 30], [720, 60], [1440, 120]]) { v.screenOpts = { res, fps }; out[res + 'p' + fps] = v.govLadder().map(x => x.h + '@' + x.f).join(' '); }
    v.screenOpts = keep; return out; });
  ok(ladders['1080p60'] === '1080@60 1080@48 1080@40 900@48 720@60 720@40', 'degraus de 1080p60: fps primeiro, depois resolução, até 720p', ladders);
  ok(ladders['1080p30'] === '1080@30 900@30 720@30' && ladders['720p60'] === '720@60 720@48 720@40' && /^1440@120 1440@60 /.test(ladders['1440p120']), 'degraus de 1080p30, 720p60 e 1440p120', ladders);

  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 1080, fps: 60, audio: false, hint: 'motion' }));
  await B.waitForFunction((aid) => !!window.__lc.voice.peers.get(aid)?.streams?.screen, { timeout: 30000 }, aid).catch(() => { });
  await B.evaluate((aid) => { window.__lc.voice.openStream(aid); window.__lc.voice.setLayerPref(aid, 0); }, aid); // beto pediu a camada "Baixa"
  await sleep(2500);
  // leituras simuladas do codificador: fps/limite controlados pelo teste; a resolução segue a escala que o controle aplicou
  await A.evaluate(() => {
    const v = window.__lc.voice, s = v.sfu.producers.screen.rtpSender; clearInterval(v._cm); v.captureFps = 60;
    window.__fake = { fps: 60, lim: 'none' };
    s.getStats = async () => { const prm = s.getParameters(), top = prm.encodings.at(-1), f = window.__fake;
      return new Map([['o', { type: 'outbound-rtp', kind: 'video', frameHeight: Math.round(1080 / (top.scaleResolutionDownBy || 1)), framesPerSecond: Math.min(f.fps, top.maxFramerate || 60), qualityLimitationReason: f.lim }]]); };
    // troca de parâmetros lenta (200 ms por chamada), como numa máquina ocupada: o teste tem de esperar o controle terminar
    // de aplicar (gov.applying) antes de conferir. No GitHub o teste lia no meio das duas etapas e via 'balanced'
    // (o atraso vem DEPOIS de chamar: o Chromium só aceita setParameters na mesma volta do getParameters)
    const setP = s.setParameters.bind(s); s.setParameters = async (prm) => { const r = await setP(prm); await new Promise(r => setTimeout(r, 200)); return r; };
    const orig = v.sfuReq.bind(v); window.__weak = null;
    v.sfuReq = (op, d) => op === 'screen_viewers' && window.__weak ? Promise.resolve({ viewers: window.__weak }) : orig(op, d);
  });
  const real = await A.evaluate(() => window.__lc.voice.sfuReq('screen_viewers'));
  ok(real.viewers?.length === 1 && Number.isFinite(real.viewers[0].avail), 'servidor responde os espectadores da transmissão (banda estimada de cada um)', real);
  let s = await state(A);
  ok(s && s.level === 0 && !s.off && s.deg === 'maintain-framerate' && s.enc.every(e => e.active !== false), 'sem sobrecarga: nada muda (3 camadas, preferência de sempre)', s);

  // 1) sobrecarga: primeiro desliga as camadas leves (ninguém com banda fraca)
  await A.evaluate(() => { window.__fake = { fps: 35, lim: 'cpu' }; });
  ok(await until(A, () => window.__lc.voice.gov?.layersOff && !window.__lc.voice.gov.applying, null, 15000), 'processador no limite por 6 s: camadas leves desligadas');
  s = await state(A);
  ok(s.level === 0 && s.enc[0].active === false && s.enc[1].active === false && s.enc[2].active !== false && s.enc[2].scale === 1 && s.deg === 'maintain-resolution', 'só a camada cheia, em 1080p, mantendo a resolução', s);
  const fr = await B.evaluate(async (aid) => { const v = window.__lc.voice; const e = [...v.sfu.consumers.values()].find(x => x.uid === aid && x.source === 'screen'); const rd = async () => { let o; (await e.c.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') o = r; }); return o; }; const a = await rd(); await new Promise(r => setTimeout(r, 3000)); const b = await rd(); return { fps: Math.round((b.framesDecoded - a.framesDecoded) / 3), h: b.frameHeight }; }, aid);
  ok(fr.fps > 10 && fr.h >= 1000, 'quem pediu a camada "Baixa" continua recebendo vídeo (a cheia)', fr);

  // 2) segue sobrecarregado: desce o fps antes da resolução
  ok(await until(A, () => window.__lc.voice.gov?.level === 1 && !window.__lc.voice.gov.applying, null, 15000), 'ainda no limite: desce um degrau');
  s = await state(A);
  ok(s.lv.h === 1080 && s.lv.f === 48 && s.enc.every(e => e.fps === 48) && s.enc[2].scale === 1, '1080p mantido, fps 60 -> 48', s);

  // 3) espectador com internet fraca aparece: camadas leves voltam, mesmo custando processador
  await A.evaluate(() => { window.__weak = [{ avail: 1_500_000, score: 10 }]; });
  ok(await until(A, () => window.__lc.voice.gov && !window.__lc.voice.gov.layersOff && !window.__lc.voice.gov.applying, null, 20000), 'espectador com banda fraca: camadas leves religadas');
  s = await state(A);
  ok(s.enc.every(e => e.active !== false) && s.enc[1].scale === 2 && s.enc[0].scale === 4, 'as 3 camadas ativas de novo, nas escalas certas', s);
  await A.evaluate(() => { window.__weak = [{ avail: 30_000_000, score: 10 }]; });

  // 4) folga: sobe um degrau depois de ~15 s
  await A.evaluate(() => { window.__fake = { fps: 60, lim: 'none' }; });
  ok(await until(A, () => window.__lc.voice.gov?.level === 0 && !window.__lc.voice.gov.applying, null, 30000), 'com folga, volta ao degrau de cima');
  s = await state(A);
  ok(s.enc.every(e => e.fps === 60) && s.deg === 'maintain-framerate', 'fps de volta a 60 e a preferência de sempre', s);
  // 5) subiu e não aguentou: desce de novo e espera o dobro antes da próxima subida
  await A.evaluate(() => { window.__fake = { fps: 35, lim: 'cpu' }; });
  ok(await until(A, () => (window.__lc.voice.gov?.level === 1 || window.__lc.voice.gov?.layersOff) && !window.__lc.voice.gov.applying, null, 15000), 'sobrecarga logo depois de subir: desce de novo');
  s = await state(A);
  ok(s.upWait === 30, 'e a próxima subida espera o dobro (15 s -> 30 s)', s.upWait);

  // 6) nunca abaixo de 720p: do penúltimo degrau, com sobrecarga, para no último
  await A.evaluate(() => { const g = window.__lc.voice.gov; g.layersOff = true; g.level = g.ladder.length - 2; });
  ok(await until(A, () => { const g = window.__lc.voice.gov; return g?.level === g?.ladder.length - 1 && !g.applying; }, null, 15000), 'chega ao último degrau');
  await sleep(9000);
  s = await state(A);
  ok(s.lv.h === 720 && s.lv.f === 40 && s.enc[2].scale === 1.5 && s.deg === 'maintain-resolution', 'e para em 720p a 40 fps (não encolhe mais por conta própria)', s);

  // 7) nova qualidade escolhida: o controle recomeça do topo
  await A.evaluate(() => { window.__fake = { fps: 30, lim: 'none' }; }); // processador folgado: o controle novo não tem por que agir
  await A.evaluate(() => window.__lc.voice.changeScreenQuality({ fps: 30 }));
  await until(A, () => { const v = window.__lc.voice, g = v.gov, prm = v.sfu.producers.screen.rtpSender.getParameters(); return g && g.ladder[0].f === 30 && !g.applying && prm.degradationPreference === 'maintain-framerate' && prm.encodings.every(e => e.active !== false && e.maxFramerate === 30); }, null, 8000);
  s = await state(A);
  ok(s && s.level === 0 && !s.off && s.lv.f === 30 && s.enc.every(e => e.active !== false && e.fps === 30), 'trocar a qualidade recomeça o controle (1080p30, 3 camadas)', s);

  // 7b) modo leve: o controle já começa sem as camadas pequenas (menos codificação no processador)
  await A.evaluate(() => { window.__lc.voice.prefs.lightMode = true; window.__lc.voice.govStart(); });
  ok(await until(A, () => { const v = window.__lc.voice, g = v.gov, e = v.sfu.producers.screen.rtpSender.getParameters().encodings; return g?.layersOff && !g.applying && e[0].active === false && e[1].active === false && e[2].active !== false; }, null, 8000), 'modo leve: começa só com a camada cheia');
  await A.evaluate(() => { window.__lc.voice.prefs.lightMode = false; });

  // 8) "qualidade automática" ligada (modo antigo, que muda a captura): o controle não roda
  await A.evaluate(() => { window.__lc.voice.prefs.autoQuality = true; window.__lc.voice.govStart(); });
  ok(await A.evaluate(() => window.__lc.voice.gov === null), 'com a qualidade automática antiga ligada, o controle fica desligado');
  await A.evaluate(() => { window.__lc.voice.prefs.autoQuality = false; window.__lc.voice.toggleScreen(); }); await sleep(500);
  ok(await A.evaluate(() => window.__lc.voice.gov === null && !window.__lc.voice.screen), 'parar a transmissão desliga o controle');
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
