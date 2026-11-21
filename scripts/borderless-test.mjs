// Dois relatos do app desktop (nov/2026):
// 1) Jogo em "janela sem bordas" (Valorant) transmitido como JANELA mostrava a janela de baixo do jogo. Agora, com o jogo
//    cobrindo o monitor (tela cheia, ou nearFull: alguns pixels a menos), o Chromium captura a TELA do monitor do jogo,
//    mesmo sem a captura nativa, e o vídeo só sai com o jogo na frente (vigia 'over' do app). Confere: a fonte trocada
//    para a tela certa, nenhum quadro sai antes do 1º aviso nem com outra janela na frente, sai com o jogo na frente; e
//    que nada muda sem o vigia no app, sem SFU ou com uma janela de jogo que não cobre o monitor.
// 2) Vídeo do YouTube enviado no chat piscando preto no app: o player é um iframe e as correções de piscada (filtro que
//    tira da sobreposição da placa e ponto anti-VRR) só valiam para <video> da página. Confere o filtro no iframe, o ponto
//    ligado enquanto o player está aberto (também com o iframe em tela cheia, na camada do topo) e desligado ao fechar.
// O app desktop é de mentira (window.lcDesktop). Uso: node scripts/borderless-test.mjs
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];

// ---------------------------------------------------------------- 2) cartão do YouTube no app (página só com os módulos)
{
  const PUB = path.resolve('public');
  const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
  const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/features.css"><body>
<script>window.lcDesktop = {};</script>
<script type="module">
import { initVrrFix } from '/vrrfix.js';
import { socialCard } from '/media.js';
initVrrFix();
window.__card = socialCard('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
document.body.append(window.__card);
window.__ready = true;
</script>`;
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/' || u === '/t.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page); }
    if (u === '/fake-yt') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><body style="margin:0;background:#200"><button id=fs>tela cheia</button></body>'); }
    const f = path.join(PUB, path.normalize(u));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const br = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
  try {
    const p = await br.newPage();
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    // nada sai para o YouTube: o player vira uma página local
    await p.setRequestInterception(true);
    p.on('request', (r) => { const u = r.url(); if (/youtube-nocookie\.com|ytimg\.com/.test(u)) return r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#200"></body>' }); r.continue(); });
    await p.goto(base + '/t.html'); await p.waitForFunction(() => window.__ready, { timeout: 15000 });
    const st = () => p.evaluate(() => { const d = document.querySelector('.lc-vrr'); return { dot: !!d && d.isConnected, top: !!d && d.matches(':popover-open'), anim: !!d && d.getAnimations().some(a => a.playState === 'running') }; });
    ok(await p.evaluate(() => document.documentElement.classList.contains('lc-desk')), 'app desktop: html.lc-desk');
    await sleep(2300);
    ok(!(await st()).dot, 'cartão parado: sem ponto anti-VRR', await st());
    await p.evaluate(() => window.__card.querySelector('.se-play').click()); await sleep(300);
    const filt = await p.evaluate(() => { const f = window.__card.querySelector('iframe'); return f && getComputedStyle(f).filter; });
    ok(/opacity\(0\.999\)/.test(filt || ''), 'player aberto: o iframe é desenhado pela página (filter: opacity(.999))', filt);
    ok((await st()).dot && (await st()).anim, 'player aberto: ponto anti-VRR animando', await st());
    // tela cheia pelo botão do player: o elemento em tela cheia é o próprio iframe (não desenha filhos) -> camada do topo
    await p.evaluate(() => window.__card.querySelector('iframe').requestFullscreen().catch(e => (window.__fsErr = e.message))); await sleep(400);
    const fs1 = await p.evaluate(() => ({ el: document.fullscreenElement?.tagName || null, err: window.__fsErr || null }));
    if (fs1.el === 'IFRAME') {
      const s = await st();
      ok(s.dot && s.top && s.anim, 'iframe em tela cheia: o ponto sobe para a camada do topo (por cima do vídeo)', s);
      const inIframe = await p.evaluate(() => document.querySelector('.lc-vrr')?.parentElement?.tagName);
      ok(inIframe === 'BODY', 'o ponto não fica dentro do iframe (lá não seria desenhado)', inIframe);
      await p.evaluate(() => document.exitFullscreen()); await sleep(400);
      ok((await st()).dot && !(await st()).top, 'saiu da tela cheia: ponto volta ao normal', await st());
    } else ok(false, 'tela cheia do iframe não abriu neste navegador', fs1);
    await p.evaluate(() => { window.__card.remove(); }); await sleep(2300);
    ok(!(await st()).dot, 'player fechado: ponto anti-VRR desligado', await st());
  } catch (e) { console.log('  EXCEÇÃO (cartão)', e.message); fails++; }
  finally { await br.close(); srv.close(); }
}

// ---------------------------------------------------------------- 1) jogo em janela sem bordas
const BASE = await ownServer('borderless', 3413, 41605);
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await api('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'T' }); await api(b.tok, 'POST', '/invites/' + (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code);
  const open = async (br, tok) => { const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
      // a captura: a fonte escolhida vira a cor do vídeo (tela = verde, janela = vermelho), para saber o que foi capturado
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); const scr = /^screen:/.test(window.__picked || '');
        let n = 0; setInterval(() => { x.fillStyle = scr ? '#0a0' : '#a00'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.fillRect(n++ % 600, 10, 30, 30); }, 33);
        return c.captureStream(30);
      };
    }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; };
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  // app de mentira: lista de fontes, escolha da fonte e o vigia do jogo; sem a captura nativa (nativeCapable ausente)
  const fake = (withOver) => A.evaluate((withOver) => {
    window.__picked = null; window.__over = { asked: [], cb: null };
    window.lcDesktop = {
      getSources: async () => [{ id: 'screen:0:0', name: 'Tela 1', type: 'screen' }, { id: 'screen:1:0', name: 'Tela 2', type: 'screen' }],
      selectSource: async (id) => { window.__picked = id; return true; },
      ...(withOver ? { watchSourceOver: async (id) => { window.__over.asked.push(id); return !!id; }, onSourceOver: (f) => { window.__over.cb = f; } } : {}),
    };
    window.__fire = (covered, why = 'front') => window.__over.cb?.({ covered, why });
  }, withOver);
  const VALORANT = { id: 'window:77:0', name: 'VALORANT', type: 'window', game: true, fullscreen: false, nearFull: true, minimized: false, screenId: 'screen:1:0' };
  const start = (si) => A.evaluate(async (si) => { await window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion', srcInfo: si }); return { picked: window.__picked, why: window.__lc.voice._swapWhy }; }, si);
  const stop = async () => { await A.evaluate(() => window.__lc.voice.screen && window.__lc.voice.toggleScreen()); await sleep(600); };
  const watch = async () => {
    await B.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'screen' && !e.c.closed), { timeout: 15000 }, a.id).catch(() => { });
    await B.evaluate((uid) => window.__lc.voice.openStream(uid), a.id);
  };
  const recv = (ms = 2000) => B.evaluate(async (uid, ms) => {
    const cs = [...window.__lc.voice.sfu.consumers.values()].filter(e => e.uid === uid && e.source === 'screen' && !e.c.closed);
    const snap = async () => { const o = { video: 0, frames: 0 }; for (const e of cs) (await e.c.rtpReceiver.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') { o.video += x.bytesReceived || 0; o.frames += x.framesDecoded || 0; } }); return o; };
    const s0 = await snap(); await new Promise(r => setTimeout(r, ms)); const s1 = await snap();
    return { video: s1.video - s0.video, frames: s1.frames - s0.frames };
  }, a.id, ms);
  const note = () => B.evaluate((uid) => window.__lc.S.voice.get(uid)?.screen_note || null, a.id);
  // cor do quadro que chega ao Bruno (verde = tela do monitor, vermelho = janela)
  const color = () => B.evaluate(async (uid) => {
    const e = [...window.__lc.voice.sfu.consumers.values()].find(e => e.uid === uid && e.source === 'screen' && !e.c.closed); if (!e) return null;
    const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([e.c.track]); await v.play().catch(() => { });
    for (let i = 0; i < 40 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 50)); if (!v.videoWidth) return null; const c = document.createElement('canvas'); c.width = 8; c.height = 8; const x = c.getContext('2d'); x.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, 8, 8);
    const d = x.getImageData(4, 6, 1, 1).data; return d[1] > d[0] ? 'tela' : 'janela';
  }, a.id);

  // a) Valorant em janela sem bordas, sem a captura nativa, com o vigia: tela do monitor do jogo, pausada até o jogo aparecer
  await fake(true);
  const s1 = await start(VALORANT);
  ok(s1.picked === 'screen:1:0', 'janela sem bordas: o Chromium captura a tela do monitor do jogo (não a janela)', s1);
  ok((await A.evaluate(() => window.__over.asked.at(-1))) === 'window:77:0', 'o app vigia a janela do jogo');
  await watch(); await sleep(1200);
  const r1 = await recv();
  ok(r1.frames === 0 && r1.video < 3000, 'antes do 1º aviso (Resenha na frente ao começar): nenhum quadro da tela sai', r1);
  ok((await note()) === 'away', 'quem assiste vê "o jogo não está na tela"', await note());
  await A.evaluate(() => window.__fire(false)); await sleep(1500);
  const r2 = await recv();
  ok(r2.frames > 20, 'jogo na frente: a transmissão chega', r2);
  ok((await color()) === 'tela', 'e é a imagem do monitor', await color());
  ok((await note()) === null, 'sem aviso com o jogo na frente', await note());
  await A.evaluate(() => window.__fire(true)); await sleep(800);
  const r3 = await recv();
  ok(r3.frames === 0 && r3.video < 3000, 'Alt+Tab (jogo continua aberto atrás): nada sai', r3);
  await A.evaluate(() => window.__fire(false)); await sleep(1500);
  ok((await recv()).frames > 20, 'jogo de volta: transmissão volta');
  await stop();
  ok((await A.evaluate(() => window.__over.asked.at(-1))) === null, 'parar a transmissão para o vigia');

  // b) mesmo jogo, começando com ele na frente (atalho de teclado no jogo): aviso logo no começo, a transmissão sai
  await fake(true);
  await A.evaluate(() => { const orig = window.lcDesktop.watchSourceOver; window.lcDesktop.watchSourceOver = async (id) => { const r = await orig(id); setTimeout(() => window.__fire(false), 30); return r; }; });
  await start(VALORANT); await watch(); await sleep(1500);
  const r4 = await recv();
  ok(r4.frames > 20 && (await note()) === null, 'começando com o jogo na frente: sai direto', { ...r4, note: await note() });
  await stop();

  // c) app sem o vigia: não troca (sem ele o Alt+Tab mostraria a tela)
  await fake(false);
  const s5 = await start(VALORANT);
  ok(s5.picked === null && /aviso de jogo fora da tela/.test(s5.why || ''), 'app sem o vigia: continua na janela', s5);
  await stop();

  // d) janela de jogo que não cobre o monitor: continua na janela
  await fake(true);
  const s6 = await start({ ...VALORANT, nearFull: false });
  ok(s6.picked === null, 'jogo em janela comum (não cobre o monitor): continua na janela', s6);
  await stop();

  // e) programa que não é jogo, mesmo cobrindo o monitor (navegador maximizado sem bordas): continua na janela
  const s7 = await start({ ...VALORANT, name: 'Navegador', game: false });
  ok(s7.picked === null, 'janela que não é jogo: continua na janela', s7);
  await stop();

  // f) tela cheia de verdade (fullscreen), sem nearFull (app antigo): também vai pela tela
  await fake(true);
  const s8 = await start({ ...VALORANT, nearFull: undefined, fullscreen: true });
  ok(s8.picked === 'screen:1:0', 'tela cheia (app que ainda não manda nearFull): tela do monitor', s8);
  await stop();

  // g) dois monitores e o app não diz em qual está o jogo: não arrisca a tela errada
  await fake(true);
  const s9 = await start({ ...VALORANT, screenId: null });
  ok(s9.picked === null && /monitores/.test(s9.why || ''), 'sem saber o monitor do jogo: continua na janela', s9);
  await stop();
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await bA.close(); await bB.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nJANELA SEM BORDAS E YOUTUBE OK'); process.exit(fails ? 1 : 0);
