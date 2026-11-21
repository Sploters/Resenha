// Latência do controle remoto / jogar junto, de ponta a ponta, com a mídia e o gateway de verdade (servidor + SFU).
// Dois navegadores separados no mesmo PC (mesmo relógio): alice transmite pelo "app desktop" (ponte lcDesktop simulada) e
// bob assiste e controla. Mede, na mesma rodada:
//  - comando (ida): clique do bob (pointerdown) -> chegada na ponte do app da alice (o que iria ao lc-input);
//  - comando -> tela ("motion-to-photon"): clique do bob -> o 1º quadro exibido no bob em que a "tela" da alice já reagiu
//    (a ponte pinta um quadrado branco no próximo quadro, como um jogo que reage à entrada);
//  - captura -> exibição: cada quadro da alice leva o horário em blocos pretos/brancos; o bob lê no requestVideoFrameCallback
//    (expectedDisplayTime) e compara. Também guarda processingDuration (decodificação) e receiveTime do rVFC.
// Rede: NET=lan (direto) ou NET=wan:<ms ida>:<variação ms>:<perda %> (ex.: wan:25:5:0.5) só para o bob: UDP da mídia por
// um relé com atraso/variação/perda e o gateway (TCP) por um proxy com o mesmo atraso. O tc/netem não existe no container.
// Uso: node scripts/remote-latency.mjs [rótulo]   (CLICKS=20, NET=lan|wan:..). Resultado em .testshots/remote-latency-<rótulo>.json
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import fs from 'node:fs';
const LABEL = process.argv[2] || 'atual', CLICKS = +(process.env.CLICKS || 20), NET = process.env.NET || 'lan';
const PORT = 3431, PROXY = 3432, RTC = 41430, DATA = './.testdata-rlat', BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('.testshots', { recursive: true });
const [, dMs = 0, jMs = 0, lossPct = 0] = NET.startsWith('wan') ? NET.split(':').map(Number) : [];
const delay = () => Math.max(0, dMs + (jMs ? (Math.random() * 2 - 1) * jMs : 0));

// ---- relé UDP da mídia: 127.0.0.1:RTC (o que os navegadores veem) <-> 127.0.0.2:RTC (o SFU). Só as portas que aparecem
// depois de "slowFrom" (as do bob, que entra depois da alice) passam pela rede ruim. Atraso por pacote mantendo a ordem
// (como um enlace: a variação não reordena)
let slowFrom = Infinity; const slow = new Map(); // porta do navegador -> lenta?
const front = dgram.createSocket('udp4'), back = new Map(), lastOut = new Map();
// linha de atraso: uma fila por sentido, despachada em ordem (dois setTimeout para o mesmo instante podem trocar de ordem)
const lines = new Map();
function later(key, fn) {
  if (!dMs && !jMs) return fn();
  let L = lines.get(key); if (!L) lines.set(key, L = { q: [], last: 0, timer: null });
  const at = Math.max(Date.now() + delay(), L.last); L.last = at; L.q.push([at, fn]);
  const pump = () => { L.timer = null; const t = Date.now(); while (L.q.length && L.q[0][0] <= t) L.q.shift()[1](); if (L.q.length) L.timer = setTimeout(pump, L.q[0][0] - t); };
  if (!L.timer) L.timer = setTimeout(pump, Math.max(0, at - Date.now()));
}
front.on('message', (msg, from) => {
  const k = from.address + ':' + from.port; let b = back.get(k);
  if (!slow.has(from.port)) slow.set(from.port, Date.now() >= slowFrom);
  const isSlow = slow.get(from.port);
  if (!b) { b = dgram.createSocket('udp4'); back.set(k, b); b.on('message', (m) => { if (isSlow && Math.random() * 100 < lossPct) return; const go = () => front.send(m, from.port, from.address); isSlow ? later('d' + k, go) : go(); }); }
  if (isSlow && Math.random() * 100 < lossPct) return;
  const go = () => b.send(msg, RTC, '127.0.0.2'); isSlow ? later('u' + k, go) : go();
});
await new Promise(r => front.bind(RTC, '127.0.0.1', r));
// ---- proxy TCP do gateway e do site para o bob (atraso nos dois sentidos, ordem mantida) ----
const proxy = net.createServer((c) => {
  const s = net.connect(PORT, '127.0.0.1'), id = Math.random(); c.setNoDelay(true); s.setNoDelay(true); // como o servidor (ws) e o navegador: sem Nagle
  const pipe = (from, to, side) => from.on('data', (d) => later(id + ':' + side, () => { if (!to.destroyed) to.write(d); }));
  pipe(c, s, 1); pipe(s, c, 0); const end = () => { c.destroy(); s.destroy(); }; c.on('error', end); s.on('error', end); c.on('close', end); s.on('close', end);
}).listen(PROXY, '127.0.0.1');

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC), RTC_ANNOUNCED_IP: '127.0.0.1', RTC_LISTEN_IP: '127.0.0.2', HEALTH_DISK_PCT: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(100); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const browsers = [];
async function open(tok, owner, base) {
  const br = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 120000, args }); browsers.push(br);
  const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await p.evaluateOnNewDocument((tok, owner) => {
    localStorage.lc_token = tok;
    const now = () => performance.timeOrigin + performance.now();
    if (owner) {
      // "tela": 1280x720 a 60 FPS. Faixa de cima: horário do quadro em 32 blocos (bit 1 = branco) e a mesma faixa invertida
      // embaixo dela (confere a leitura). Quadrado à esquerda: branco enquanto um botão do mouse do controlador está apertado.
      window.__react = 0; window.__arrive = [];
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d');
        const draw = () => {
          const t = Math.floor(now()) >>> 0;
          x.fillStyle = '#404040'; x.fillRect(0, 0, 1280, 720);
          for (let i = 0; i < 32; i++) { const bit = (t >>> (31 - i)) & 1; x.fillStyle = bit ? '#fff' : '#000'; x.fillRect(i * 40, 0, 40, 40); x.fillStyle = bit ? '#000' : '#fff'; x.fillRect(i * 40, 40, 40, 40); }
          x.fillStyle = window.__react ? '#fff' : '#000'; x.fillRect(40, 200, 240, 240);
          x.fillStyle = `hsl(${(t / 8) % 360},60%,45%)`; x.fillRect(400, 200, 800, 400); // movimento (o codificador não fica parado)
        };
        draw(); setInterval(draw, 1000 / 60);
        return c.captureStream(60);
      };
      const fns = { isDesktop: true, getSettings: async () => ({}), getUpdate: async () => null, setThrottle: () => { },
        getSources: async () => [{ id: 'screen:1:0', name: 'Tela 1', type: 'screen', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
        remoteCapable: async () => ({ ok: true, antiCheats: [], pad: true, window: false }), remoteStart: async () => ({ ok: true }),
        // a "injeção": registra a chegada e o jogo reage no próximo quadro
        remoteInput: (ev) => { const t = now(); for (const e of ev) { if (e.k === 'd') { window.__react = 1; window.__arrive.push(t); } if (e.k === 'u') window.__react = 0; } },
        remoteStop: () => { }, onRemoteEvent: () => { } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    } else {
      window.__down = []; window.__frames = []; window.__seen = []; window.__wsOut = [];
      // instante em que o clique sai pelo WebSocket (separa a espera no app de quem joga do resto do caminho)
      const os = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { if (typeof d === 'string' && d.includes('REMOTE_INPUT') && /"k":"d"/.test(d)) window.__wsOut.push(performance.timeOrigin + performance.now()); return os.call(this, d); };
      addEventListener('pointerdown', (e) => { if (e.target.closest?.('.tile.screen')) window.__down.push(performance.timeOrigin + e.timeStamp); }, true);
    }
  }, tok, owner);
  await p.goto(base); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
  return p;
}
const R = { label: LABEL, net: NET, clicks: CLICKS, at: new Date().toISOString() };
try {
  const a = await reg('alice'), b = await reg('bob');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'Jogo' }); const code = (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await api(b.tok, 'POST', '/invites/' + code);
  const A = await open(a.tok, true, BASE);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  const join = async (P) => { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300); await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click()); await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); };
  await join(A);
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Transmitir/.test(x.textContent)).click());
  await A.waitForFunction(() => window.__lc.voice?.sfu?.producers?.screen, { timeout: 20000 });
  await sleep(1500);
  slowFrom = Date.now(); // daqui em diante: portas novas = bob
  const B = await open(b.tok, false, NET === 'lan' ? BASE : `http://localhost:${PROXY}`);
  await join(B);
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 20000 }, a.id);
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"] video`)?.videoWidth > 0, { timeout: 20000 }, a.id);
  await B.evaluate((uid) => { window.__lc.S.focus = 's:' + uid; window.__lc.renderVoiceUI?.(); }, a.id); await sleep(1500);
  // leitor de quadros no bob: horário de cada quadro exibido e o estado do quadrado
  await B.evaluate((uid) => {
    const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`), c = new OffscreenCanvas(320, 180), x = c.getContext('2d', { willReadFrequently: true });
    const cb = (_, m) => {
      x.drawImage(v, 0, 0, 320, 180); const d = x.getImageData(0, 0, 320, 120).data, px = (X, Y) => d[(Y * 320 + X) * 4];
      let t = 0, okBits = 0; for (let i = 0; i < 32; i++) { const hi = px(i * 10 + 5, 5) > 128, lo = px(i * 10 + 5, 15) > 128; if (hi !== lo) okBits++; t = (t * 2 + (hi ? 1 : 0)) >>> 0; }
      const white = px(40, 80) > 128, shown = performance.timeOrigin + m.expectedDisplayTime;
      if (okBits === 32) window.__frames.push({ cap: t, shown, rx: m.receiveTime != null ? performance.timeOrigin + m.receiveTime : null, capMeta: m.captureTime != null ? performance.timeOrigin + m.captureTime : null, proc: m.processingDuration != null ? m.processingDuration * 1000 : null, white });
      else window.__frames.push({ bad: true, shown, white });
      v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }, a.id);
  // pedir o controle e liberar o mouse
  await B.evaluate(() => { window.__lc.S.prefs.remoteIntroSeen = true; });
  await B.evaluate(() => { const b = document.querySelector('.sctl button[title="Mais opções"]'); b?.click(); });
  await sleep(200);
  await B.evaluate(() => [...document.querySelectorAll('.menu .it')].find(x => /Pedir controle|Pedir para jogar/.test(x.textContent))?.click());
  await A.waitForFunction(() => /quer controlar seu PC|quer jogar/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 10000 });
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Permitir|Deixar jogar|Aceitar/.test(x.textContent)).click());
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.classList.contains('controlling'), { timeout: 10000 }, a.id);
  const box = await B.evaluate((uid) => { const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`), r = v.getBoundingClientRect(), s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight), w = v.videoWidth * s, hh = v.videoHeight * s; return { x: r.left + (r.width - w) / 2 + w * .6, y: r.top + (r.height - hh) / 2 + hh * .6 }; }, a.id);
  await B.mouse.move(box.x, box.y); await B.mouse.down(); await sleep(150); await B.mouse.up(); await sleep(800); // 1º clique liga a captura
  await B.evaluate(() => { window.__down.length = 0; }); await A.evaluate(() => { window.__arrive.length = 0; });
  const frames0 = await B.evaluate(() => window.__frames.length);
  for (let i = 0; i < CLICKS; i++) { await B.mouse.down(); await sleep(300); await B.mouse.up(); await sleep(400 + Math.random() * 200); }
  await sleep(1000);
  const wsOut = await B.evaluate((n) => window.__wsOut.slice(-n), CLICKS);
  const down = await B.evaluate(() => window.__down.slice()), arrive = await A.evaluate(() => window.__arrive.slice());
  const frames = (await B.evaluate(() => window.__frames.slice())).slice(frames0);
  // comando -> tela: para cada clique, o 1º quadro exibido depois do clique com o quadrado branco
  const m2p = down.map(t => { const f = frames.find(f => f.shown >= t && f.white && !f.bad); return f ? f.shown - t : null; });
  const ida = down.map((t, i) => arrive[i] != null ? arrive[i] - t : null);
  const good = frames.filter(f => !f.bad), lo32 = (t) => Math.floor(t) % 4294967296, g2g = good.map(f => { let d = lo32(f.shown) - f.cap; if (d < -2147483648) d += 4294967296; return d + (f.shown % 1); });
  const stat = (a) => { const v = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const q = (p) => +v[Math.min(v.length - 1, Math.floor(p * v.length))].toFixed(1); return { n: v.length, media: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1), p50: q(.5), p95: q(.95), max: +v.at(-1).toFixed(1) }; };
  const span = good.length > 1 ? (good.at(-1).shown - good[0].shown) / 1000 : 0;
  const st = await B.evaluate(async (uid) => { const v = window.__lc.voice, p = v.peers.get(uid); let o = {}; for (const [id, src] of p.consumers) if (src === 'screen') { const c = v.sfu.consumers.get(id)?.c; for (const r of (await c.getStats()).values()) if (r.type === 'inbound-rtp' && r.kind === 'video') o = { jbMs: r.jitterBufferEmittedCount ? +(r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000).toFixed(1) : null, jbTargetMs: r.jitterBufferEmittedCount && r.jitterBufferTargetDelay != null ? +(r.jitterBufferTargetDelay / r.jitterBufferEmittedCount * 1000).toFixed(1) : null, decodeMs: r.framesDecoded ? +(r.totalDecodeTime / r.framesDecoded * 1000).toFixed(1) : null, procMs: r.framesDecoded && r.totalProcessingDelay != null ? +(r.totalProcessingDelay / r.framesDecoded * 1000).toFixed(1) : null, decoder: r.decoderImplementation, codec: r.codecId, fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, lost: r.packetsLost, jitterMs: r.jitter != null ? +(r.jitter * 1000).toFixed(1) : null }; } return o; }, a.id);
  Object.assign(R, {
    comandoIda: stat(ida), comandoEsperaNoApp: stat(down.map((t, i) => wsOut[i] != null ? wsOut[i] - t : null)), comandoRedeEServidor: stat(arrive.map((t, i) => wsOut[i] != null ? t - wsOut[i] : null)), comandoParaTela: stat(m2p), capturaParaExibicao: stat(g2g),
    rvfcProcessamentoMs: stat(good.map(f => f.proc)), recebidoParaExibicao: stat(good.map(f => f.rx != null ? f.shown - f.rx : null)),
    captureTimeMeta: good.some(f => f.capMeta != null), quadrosLidos: good.length, quadrosIlegiveis: frames.length - good.length, fpsExibidos: span ? +(good.length / span).toFixed(1) : null,
    cliquesSemReacao: m2p.filter(x => x == null).length, inbound: st,
  });
  const f = (s) => s ? `média ${s.media} · p50 ${s.p50} · p95 ${s.p95} · máx ${s.max} ms (n=${s.n})` : '—';
  console.log(`\n[${LABEL}] rede ${NET}`);
  console.log('  comando (clique -> app de quem transmite): ' + f(R.comandoIda));
  console.log('    espera no app de quem joga (clique -> WebSocket): ' + f(R.comandoEsperaNoApp));
  console.log('    WebSocket -> servidor -> app de quem transmite:   ' + f(R.comandoRedeEServidor));
  console.log('  comando -> tela (clique -> reação exibida):  ' + f(R.comandoParaTela));
  console.log('  captura -> exibição (por quadro):           ' + f(R.capturaParaExibicao));
  console.log('  recebido -> exibição (rVFC):                ' + f(R.recebidoParaExibicao));
  console.log('  decodificação (rVFC processingDuration):    ' + f(R.rvfcProcessamentoMs));
  console.log(`  quadros: ${R.quadrosLidos} lidos (${R.fpsExibidos} FPS exibidos), ${R.quadrosIlegiveis} ilegíveis; cliques sem reação: ${R.cliquesSemReacao}`);
  console.log('  getStats:', JSON.stringify(st));
  fs.writeFileSync(`.testshots/remote-latency-${LABEL}.json`, JSON.stringify(R, null, 1));
} catch (e) { console.log('  ERRO', e.stack || e.message); R.erro = e.message; }
for (const br of browsers) await br.close().catch(() => { });
proxy.close(); front.close();
process.exit(R.erro ? 1 : 0);
