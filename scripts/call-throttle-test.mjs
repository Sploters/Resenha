// Chamada com a página desacelerada (modo leve no app desktop: setBackgroundThrottling(true) também em chamada).
// O Electron liga a mesma desaceleração do Chromium que uma aba em segundo plano tem; aqui o bruno entra na call e a aba
// dele vai para trás (outra aba na frente), em duas rodadas: com a desaceleração (Chromium padrão) e sem ela (as flags que
// equivalem a backgroundThrottling: false, como o app fica fora do modo leve). Mede, nos 20 s escondido: tempo de CPU
// da thread principal do bruno, quantas vezes o laço de 100 ms da voz rodou, a voz chegando e saindo, mensagem do chat
// chegando pelo gateway; e, ao voltar, o "falando" e a tela se atualizando. QUIET=1: todos mudos (a página não toca som).
// Uso: xvfb-run -a node scripts/call-throttle-test.mjs   (precisa de janela de verdade: headless não esconde a aba)
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const BASE = await ownServer('throttle', 3337, 41280);
const HID = +(process.env.HIDDEN_MS || 20000);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const [ra, rb] = await Promise.all(['alice', 'bruno'].map(n => api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })));
const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code;
await api(rb.token, 'POST', '/invites/' + inv);
const NO_THROTTLE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
// kbps de voz recebida (inbound) e enviada (outbound) numa página
const rtp = (p, ms = 3000) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu;
  const snap = async () => { let i = 0, o = 0;
    for (const e of s.consumers.values()) if (e.source === 'mic') (await e.c.rtpReceiver.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') i += x.bytesReceived || 0; });
    const mp = s.producers.mic; if (mp) (await mp.rtpSender.getStats()).forEach(x => { if (x.type === 'outbound-rtp') o += x.bytesSent || 0; });
    return [i, o]; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); const b = await snap();
  return { in: Math.round((b[0] - a[0]) * 8 / ms), out: Math.round((b[1] - a[1]) * 8 / ms) };
}, ms);
async function run(throttle) {
  console.log(`\n== ${throttle ? 'COM desaceleração (modo leve, nova regra)' : 'SEM desaceleração (como era em chamada)'} ==`);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: false, protocolTimeout: 90000, ignoreDefaultArgs: NO_THROTTLE, // o puppeteer desliga a desaceleração por padrão
    defaultViewport: { width: 1200, height: 760 },
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1200,800', ...(throttle ? [] : NO_THROTTLE)] });
  const R = {};
  try {
    const person = async (ctx, tok) => {
      const p = await ctx.newPage();
      p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
      await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
      await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
      return p;
    };
    const A = await person(await browser.createBrowserContext(), ra.token), bctx = browser.defaultBrowserContext(), B = await person(bctx, rb.token);
    const { vc, tc } = await A.evaluate((gid) => { const ch = window.__lc.S.guilds.get(gid).channels; return { vc: ch.find(x => x.type === 2).id, tc: ch.find(x => x.type === 0).id }; }, g.id);
    await B.evaluate((gid, tc) => window.__lc.go(gid, tc), g.id, tc);
    for (const p of [A, B]) await p.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
    await sleep(3000);
    if (throttle) { // a regra do app: modo leve desacelera também em chamada, menos transmitindo
      const w = await B.evaluate(async () => { const L = await window.__lc.import('lite.js'), S = window.__lc.S, was = S.prefs.lightMode; S.prefs.lightMode = true;
        const r = { call: L.throttleWanted({ active: true }), screen: L.throttleWanted({ active: true, screen: {} }), native: L.throttleWanted({ active: true, native: {} }), out: L.throttleWanted(null) };
        S.prefs.lightMode = was; r.off = L.throttleWanted({ active: true }); return r; });
      ok(w.call && w.out && !w.screen && !w.native && !w.off, 'modo leve: desacelera em chamada e fora dela; não transmitindo nem sem o modo leve', w);
    }
    const vis0 = await rtp(B);
    if (process.env.QUIET) { for (const p of [A, B]) await p.evaluate(() => window.__lc.voice.toggleMute()); await sleep(1000); } // ninguém fala: a página não está "tocando som"
    ok(vis0.in > 10 && vis0.out > 10, 'à vista: a voz chega e sai (kbps)', vis0);
    // conta as voltas do laço de 100 ms da voz e o que a página processa do gateway
    await B.evaluate(() => { const v = window.__lc.voice, f = v.poll.bind(v); window.__polls = 0; v.poll = () => { window.__polls++; f(); }; clearInterval(v.timer); v.timer = setInterval(() => v.poll(), 100); });
    const cdp = await B.createCDPSession(); await cdp.send('Performance.enable');
    const front = await bctx.newPage(); await front.goto('about:blank'); await front.bringToFront(); await sleep(1500);
    const vis = await B.evaluate(() => document.visibilityState);
    ok(vis === 'hidden', 'aba do bruno escondida', vis);
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const p0 = await B.evaluate(() => window.__polls), t0 = Date.now();
    await sleep(HID / 2);
    const hid = await rtp(B); // escondida: a voz continua chegando e saindo
    const sent = 'oi do meio-tempo ' + throttle; await api(ra.token, 'POST', `/channels/${tc}/messages`, { content: sent });
    await sleep(HID / 2 - 3000);
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const polls = await B.evaluate(() => window.__polls) - p0, secs = (Date.now() - t0) / 1000;
    const got = await B.evaluate((t) => (window.__lc.S.messages?.get?.(window.__lc.S.view.cid) || []).some?.(m => m.content === t) || document.body.innerText.includes(t), sent);
    R.cpu = +((m1.TaskDuration - m0.TaskDuration) * 1000 / secs).toFixed(1); R.script = +((m1.ScriptDuration - m0.ScriptDuration) * 1000 / secs).toFixed(1);
    R.layout = +(((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) * 1000 / secs).toFixed(1);
    R.polls = +(polls / secs).toFixed(1); R.kbps = hid;
    console.log(`  escondida ${secs.toFixed(0)} s: thread principal ${R.cpu} ms/s (script ${R.script}, estilo+layout ${R.layout}), laço da voz ${R.polls}x/s, voz ${JSON.stringify(hid)} kbps`);
    if (!process.env.QUIET) ok(hid.in > 10 && hid.out > 10, 'escondida: a voz continua chegando e saindo (kbps)', hid);
    else { await A.evaluate(() => window.__lc.voice.toggleMute()); await sleep(2500); const k = await rtp(B, 2000); R.unmute = k; ok(k.in > 10, 'escondida e desacelerada: a alice desmuta e a voz chega na hora (kbps)', k); }
    ok(got, 'mensagem enviada com a aba escondida chegou pelo gateway');
    ok(await B.evaluate(() => window.__lc.voice.active && window.__lc.voice.sfu?.ready), 'continua na sala');
    // volta: em até 1,5 s a tela mostra a mensagem e o "falando" volta a ser medido 10x/s
    await B.bringToFront(); await sleep(1500);
    const back = await B.evaluate((t) => ({ vis: document.visibilityState, msg: document.body.innerText.includes(t), p: window.__polls }), sent);
    await sleep(1000); const p2 = await B.evaluate(() => window.__polls) - back.p;
    ok(back.vis === 'visible' && back.msg, 'de volta: a mensagem do meio-tempo está na tela', back);
    ok(p2 >= 7, 'de volta: o laço da voz voltou a 10x/s', p2);
    await front.close();
  } catch (e) { console.log('ERRO', e); fails++; }
  finally { await browser.close(); }
  return R;
}
const off = await run(false), on = await run(true);
if (off.cpu != null && on.cpu != null) {
  console.log(`\nResumo (bruno em call, aba escondida): thread principal ${off.cpu} → ${on.cpu} ms/s, laço da voz ${off.polls} → ${on.polls}x/s, estilo+layout ${off.layout} → ${on.layout} ms/s`);
  // Achado da medição: com o microfone capturando, o Chromium não desacelera a página escondida (os timers seguem a 10x/s
  // mesmo com todos mudos), então ligar a desaceleração em chamada quase não muda nada — e a página escondida em chamada já
  // gasta ~2–3 ms/s, porque pausa vídeo, "falando" e desenho sozinha. O teste garante que a voz e o gateway seguem bem.
  ok(on.cpu < 10 && off.cpu < 10, 'escondida em chamada a thread principal gasta pouco (ms/s)', { antes: off.cpu, depois: on.cpu });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300);
