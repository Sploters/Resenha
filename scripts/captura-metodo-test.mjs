// Escolha do método de captura (WGC x DXGI x Chromium) de ponta a ponta, sem Windows: app desktop simulado + o programa
// nativo de verdade (native/lc-stream compilado para Linux: ffmpeg no lugar da captura, e o SELETOR de verdade
// (src/select.rs) sobre fontes WGC/DXGI simuladas por LC_SIM) + servidor com SFU de verdade.
// Confere: o método pedido chega ao programa; troca automática com motivo e latência no painel; quem assiste continua
// vendo depois da troca (sem reiniciar sessão); nenhum método funciona -> Chromium sem laço de reinícios; Forçar Chromium;
// Clássico (sem "capture", o caminho anterior); app antigo; troca de método durante a transmissão.
// Uso: node scripts/captura-metodo-test.mjs   (SHOTS=pasta salva capturas)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3247, BASE = `http://localhost:${PORT}`, DATA = './.testdata-capmet';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 600) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execFileSync('cargo', ['build', '--release', '--quiet'], { cwd: 'native/lc-stream', stdio: 'inherit' });
const BIN = 'native/lc-stream/target/release/lc-stream';
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41070', RTC_IPS: '127.0.0.1', RTC_NATIVE_PORTS: '41071-41079' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const helpers = []; let SIM = '', OSB = 26200;
async function page(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  if (desk) {
    // o que desktop/native.js faz: passa "capture" e "osBuild" quando há método; o resto vai como veio
    await p.exposeFunction('__natStart', (o) => new Promise((resolve) => {
      const cfg = { ...o, sourceId: undefined, window: 1234, ...(o.capture ? { osBuild: OSB } : {}) };
      const h = { cfg, srcId: o.sourceId || null, sim: SIM, proc: spawn(BIN, ['--stdin'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, LC_SIM: SIM } }), events: [] }; helpers.push(h);
      let buf = '', done = false;
      h.proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let ev; try { ev = JSON.parse(l); } catch { continue; } h.events.push(ev);
        if (!done && (ev.t === 'started' || ev.t === 'error')) { done = true; resolve(ev.t === 'started' ? { ok: true, ...ev } : { ok: false, error: ev.error }); }
        p.evaluate((ev) => window.__natCb?.(ev), ev).catch(() => { }); } });
      h.proc.on('exit', (code) => { if (!done) { done = true; resolve({ ok: false, error: 'saiu ' + code }); } if (!h.stopped) p.evaluate((code) => window.__natCb?.({ t: 'exit', code }), code).catch(() => { }); });
      h.proc.stdin.write(JSON.stringify(cfg) + '\n');
    }));
    await p.exposeFunction('__natStop', () => { for (const h of helpers) if (!h.stopped) { h.stopped = true; try { h.proc.stdin.write('stop\n'); h.proc.stdin.end(); } catch { } } });
  }
  await p.evaluateOnNewDocument((tok, desk) => {
    localStorage.lc_token = tok;
    navigator.mediaDevices.getDisplayMedia = async () => { const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const x = cv.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33); return cv.captureStream(30); };
    if (desk) {
      window.__natCalls = [];
      window.__sel = [];
      const fns = { isDesktop: true, getSettings: async () => ({}), getUpdate: async () => null, setThrottle: () => { }, selectSource: async (id) => { window.__sel.push(id); return true; },
        getSources: async () => [{ id: 'screen:0:0', name: 'Tela', type: 'screen' }, ...(window.__twoScreens ? [{ id: 'screen:1:0', name: 'Tela 2', type: 'screen' }] : []), { id: 'window:4242:0', name: 'VALORANT', type: 'window', game: true }],
        // __oldApp: app desktop anterior (sem escolha de método)
        nativeCapable: async (mode) => { window.__natCalls.push(mode ?? null); return window.__oldApp ? { ok: true, encoders: ['teste'] } : { ok: true, encoders: ['teste'], modes: ['auto', 'wgc', 'dxgi'], os: window.__os || 26200 }; },
        nativeStart: (o) => window.__natStart(o), nativeStop: () => window.__natStop(), onNativeEvent: (cb) => { window.__natCb = cb; } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const info = (A) => A.evaluate(async () => (await window.__lc.voice.captureInfo())?.capture || null);
const state = (A) => A.evaluate(() => { const v = window.__lc.voice; return { native: !!v.native, pending: !!v.native?.pending, chromiumVideo: !!v.sfu?.producers?.screen, restarts: v.natRestartCount || 0, why: v._natWhy || null }; });
const viewerFrames = (B, uid) => B.evaluate(async (uid) => {
  const v = window.__lc.voice, find = () => [...v.sfu.consumers.values()].filter(x => x.uid === uid && x.source === 'screen' && !x.c.closed).at(-1);
  const rd = async (e) => { let s; (await e.c.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') s = r; }); return s; };
  let e, a; for (let i = 0; i < 40 && !(e = find(), a = e && await rd(e)); i++) await new Promise(r => setTimeout(r, 250));
  if (!a) return -1; await new Promise(r => setTimeout(r, 3000)); const b = await rd(e); return (b?.framesDecoded || 0) - (a.framesDecoded || 0);
}, uid);
async function share(A, sim, mode, extra = {}) {
  SIM = sim; helpers.length = 0;
  await A.evaluate((m) => { const S = window.__lc.S; if (m) S.prefs.captureMethod = m; else delete S.prefs.captureMethod; }, mode);
  await A.evaluate((x) => window.__lc.voice.toggleScreen({ res: 720, fps: 120, audio: false, hint: 'motion', ...x }), extra);
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending || window.__lc.voice.sfu?.producers?.screen, { timeout: 15000 }).catch(() => { });
}
// quem assiste clica para assistir a cada transmissão nova
const watch = async (B, uid) => { await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"] video`), { timeout: 15000 }, uid).catch(() => { }); await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), uid); };
const unshare = async (A) => { await A.evaluate(() => window.__lc.voice.screen && window.__lc.voice.toggleScreen()); await sleep(1500); };
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Captura' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  const A = await page(a.tok, true), B = await page(b.tok, false);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  }

  // 1) Automático no Windows 11, janela: WGC começa; fica preto em 2 s -> DXGI testado ao lado e assume; quem assiste segue vendo
  console.log('-- 1. automático: WGC preto -> DXGI');
  await share(A, 'wgc=black@2', null);
  ok(helpers[0]?.cfg.capture === 'auto' && helpers[0]?.cfg.osBuild === 26200, 'padrão = Automático: o programa recebe capture=auto e o build do Windows', helpers[0]?.cfg && { capture: helpers[0].cfg.capture, osBuild: helpers[0].cfg.osBuild });
  let c = await info(A);
  ok(c?.active === 'wgc' && /Windows 11/.test(c.plan || ''), 'começa no WGC e o painel diz por quê', { active: c?.active, plan: c?.plan });
  await watch(B, a.id);
  ok(await viewerFrames(B, a.id) > 30, 'quem assiste recebe a transmissão (antes da troca)');
  await A.waitForFunction(() => window.__lc.voice.native?.method === 'dxgi', { timeout: 15000 }).catch(() => { });
  c = await info(A);
  const sw = c?.history?.find(e => e.kind === 'method' && e.from === 'wgc' && e.m === 'dxgi');
  ok(c?.active === 'dxgi' && sw && /preta/.test(sw.why) && sw.ms != null && sw.testMs > 0, 'trocou para DXGI com motivo, latência e tempo de comparação no histórico', sw);
  ok(c?.history?.some(e => e.kind === 'note' && /testando DXGI ao lado/.test(e.msg)), 'a decisão de testar o outro método aparece no histórico');
  ok(c?.overlap === true, 'janela por DXGI: o painel sabe que janelas por cima aparecem');
  const prodBefore = await A.evaluate(() => window.__lc.voice.native?.producerId);
  ok(await viewerFrames(B, a.id) > 30, 'depois da troca quem assiste continua recebendo (mesma sessão)');
  ok(helpers.length === 1 && (await A.evaluate(() => window.__lc.voice.native?.producerId)) === prodBefore, 'a troca não reiniciou o programa nem a sessão no servidor', { programas: helpers.length });
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    // menu da própria transmissão (clique direito no quadro) > Ajustes da transmissão
    await A.evaluate(() => { const t = [...document.querySelectorAll('.tile')].find(x => /— tela/.test(x.textContent)); t?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 200 })); }); await sleep(500);
    await A.evaluate(() => [...document.querySelectorAll('.menu *, [role=menu] *')].find(x => x.textContent.trim().startsWith('Ajustes da transmissão'))?.click()); await sleep(1200);
    await A.evaluate(() => document.querySelector('.modal details.capdiag')?.setAttribute('open', '')); await sleep(1500);
    await A.screenshot({ path: process.env.SHOTS + '/captura-diagnostico.png', fullPage: false });
    await A.evaluate(() => { const d = document.querySelector('.modal details.capdiag'); d?.scrollIntoView({ block: 'end' }); for (const el of document.querySelectorAll('.modal *')) if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight; }); await sleep(400);
    await A.screenshot({ path: process.env.SHOTS + '/captura-historico.png', fullPage: false });
    await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Pronto/.test(x.textContent))?.click());
  }
  const panel = await A.evaluate(async () => (await window.__lc.voice.captureInfo()).capture.history.length);
  ok(panel >= 3, 'histórico guardado', panel);
  await unshare(A);

  // 2) nada funciona: WGC dá erro e o DXGI não abre -> Chromium direto, sem ficar reiniciando o programa
  console.log('-- 2. nenhum método nativo -> Chromium');
  await share(A, 'wgc=fail@1,dxgi=nostart', 'auto');
  await A.waitForFunction(() => !window.__lc.voice.native && window.__lc.voice.sfu?.producers?.screen, { timeout: 15000 }).catch(() => { });
  let s = await state(A); c = await info(A);
  ok(!s.native && s.chromiumVideo && s.restarts === 0, 'voltou ao Chromium sem reinícios inúteis do programa', s);
  ok(c?.history?.some(e => e.kind === 'method' && e.m === 'chromium' && /nenhum metodo/.test(e.why)), 'o motivo (WGC e DXGI falharam) está no histórico', c?.history?.at(-1));
  ok(helpers.length === 1, 'o programa nativo foi iniciado uma vez só (sem laço)', helpers.length);
  await watch(B, a.id);
  ok(await viewerFrames(B, a.id) > 20, 'quem assiste vê pelo Chromium');
  await unshare(A);

  // 3) Forçar Chromium: nem pergunta ao programa nativo
  console.log('-- 3. forçar Chromium');
  await share(A, '', 'chromium');
  s = await state(A);
  await watch(B, a.id);
  ok(!s.native && s.chromiumVideo && s.why === 'forced' && helpers.length === 0, 'Forçar Chromium: vídeo pelo Chromium, motivo "forced", programa não iniciado', s);
  // 4) durante a transmissão: troca para Forçar DXGI -> liga o nativo só com DXGI, sem parar a transmissão
  console.log('-- 4. troca para Forçar DXGI ao vivo');
  await A.evaluate(() => { window.__lc.S.prefs.captureMethod = 'dxgi'; return window.__lc.voice.applyCaptureMode(); });
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending, { timeout: 15000 }).catch(() => { });
  c = await info(A); s = await state(A);
  ok(helpers[0]?.cfg.capture === 'dxgi' && c?.active === 'dxgi' && !s.chromiumVideo, 'Forçar DXGI: o programa recebe capture=dxgi e o vídeo sai dele', { cfg: helpers[0]?.cfg.capture, active: c?.active });
  ok(await viewerFrames(B, a.id) > 20, 'quem assiste segue vendo depois da troca de método');
  await unshare(A);

  // 5) forçado: o método forçado fica preto -> não troca (só anota)
  console.log('-- 5. forçado não troca');
  await share(A, 'wgc=black@1', 'wgc');
  await sleep(7000);
  c = await info(A);
  ok(c?.active === 'wgc' && !c.history.some(e => e.kind === 'method' && e.from) && c.history.some(e => e.kind === 'note' && /forçado/.test(e.msg)), 'Forçar WGC com tela preta: continua no WGC e explica por que não trocou', c?.history?.map(e => e.why || e.msg));
  await unshare(A);

  // 6) Clássico: sem "capture" (o lc-stream usa o caminho da versão anterior)
  console.log('-- 6. clássico');
  await share(A, '', 'classic');
  ok(helpers[0] && !('capture' in helpers[0].cfg) && !('osBuild' in helpers[0].cfg), 'Clássico: configuração igual à da versão anterior (sem capture)', helpers[0] && Object.keys(helpers[0].cfg));
  c = await info(A);
  ok(c?.applied === 'classic', 'painel mostra o clássico em uso');
  await unshare(A);

  // 7) app antigo (sem escolha de método): segue no clássico e o painel avisa
  console.log('-- 7. app antigo');
  await A.evaluate(() => { window.__oldApp = true; window.__lc.voice._natCap = null; });
  await share(A, '', 'auto');
  ok(helpers[0] && !('capture' in helpers[0].cfg), 'app sem suporte: não manda capture', helpers[0] && helpers[0].cfg.capture);
  const txt = await A.evaluate(async () => { const x = await window.__lc.voice.captureInfo(); return x.capture.applied; });
  ok(txt === 'classic', 'painel sabe que o app está no clássico', txt);
  await unshare(A);
  await A.evaluate(() => { window.__oldApp = false; window.__lc.voice._natCap = null; });

  // 8) Windows 10: DXGI primeiro; tela cheia exclusiva congela o DXGI simulado? Não: aqui o DXGI falha de vez -> WGC assume
  console.log('-- 8. Windows 10: DXGI primeiro, falha -> WGC');
  OSB = 19045;
  await share(A, 'dxgi=fail@2', 'auto');
  await A.waitForFunction(() => window.__lc.voice.native?.method === 'wgc', { timeout: 15000 }).catch(() => { });
  c = await info(A);
  ok(c?.order?.[0] === 'dxgi' && /Windows 10/.test(c.plan) && c.active === 'wgc' && c.history.some(e => e.kind === 'method' && e.from === 'dxgi' && /falhou/.test(e.why)), 'Windows 10 começa no DXGI; erro -> WGC, com o motivo', { order: c?.order, active: c?.active });
  await unshare(A);

  // 9) 30 FPS (o padrão): jogo no Windows 10 vai pelo nativo (DXGI pega a tela cheia exclusiva; o Chromium congelava);
  //    no Windows 11, ou sem ser jogo, continua no Chromium como antes
  console.log('-- 9. 30 FPS: jogo no Windows 10 -> nativo; Windows 11 ou tela -> Chromium');
  const game = { type: 'window', game: true, fullscreen: true };
  await A.evaluate(() => { window.__os = 19045; window.__lc.voice._natCap = null; });
  await share(A, '', 'auto', { fps: 30, srcInfo: game });
  s = await state(A);
  ok(s.native && !s.chromiumVideo && helpers[0]?.cfg.capture === 'auto' && helpers[0]?.cfg.fps === 30, 'Windows 10, jogo a 30 FPS: sai pelo programa nativo (capture=auto, 30 fps)', { s, fps: helpers[0]?.cfg.fps });
  await watch(B, a.id);
  ok(await viewerFrames(B, a.id) > 20, 'quem assiste vê a transmissão nativa de 30 FPS');
  await unshare(A);
  await share(A, '', 'auto', { fps: 30, srcInfo: { type: 'screen' } });
  s = await state(A);
  ok(!s.native && s.chromiumVideo && s.why === 'lowfps' && helpers.length === 0, 'Windows 10, tela inteira a 30 FPS: Chromium como antes', s);
  await unshare(A);
  await A.evaluate(() => { window.__os = 26200; window.__lc.voice._natCap = null; });
  await share(A, '', 'auto', { fps: 30, srcInfo: game });
  s = await state(A);
  ok(!s.native && s.chromiumVideo && s.why === 'lowfps' && helpers.length === 0, 'Windows 11, jogo a 30 FPS: Chromium como antes', s);
  await unshare(A);
  // 11) Windows 10, jogo pelo nativo: o Chromium (prévia/reserva) fica na TELA (a captura de janela dele some com o cursor
  //     do jogo) e o nativo recebe a janela pelo id; se o nativo falhar, volta para a JANELA antes de mandar pelo Chromium
  console.log('-- 11. Windows 10: Chromium na tela, nativo na janela; falha -> Chromium na janela');
  const valo = { id: 'window:4242:0', name: 'VALORANT', type: 'window', game: true, fullscreen: true };
  await A.evaluate(() => { window.__os = 19045; window.__lc.voice._natCap = null; window.__sel.length = 0; });
  await share(A, '', 'auto', { fps: 60, srcInfo: valo });
  let sel = await A.evaluate(() => [...window.__sel]); s = await state(A);
  ok(s.native && sel.at(-1) === 'screen:0:0' && helpers[0]?.srcId === 'window:4242:0', 'Chromium capturando a tela e o nativo a janela do jogo', { sel, srcId: helpers[0]?.srcId, s });
  await unshare(A);
  await A.evaluate(() => { window.__sel.length = 0; window.__twoScreens = true; });
  await share(A, '', 'auto', { fps: 60, srcInfo: valo });
  sel = await A.evaluate(() => [...window.__sel]);
  ok(!sel.length && !helpers[0]?.srcId, 'dois monitores e app antigo (sem screenId): sem trocar a fonte', { sel, srcId: helpers[0]?.srcId });
  await unshare(A);
  await A.evaluate(() => { window.__sel.length = 0; });
  await share(A, '', 'auto', { fps: 60, srcInfo: { ...valo, screenId: 'screen:1:0' } });
  sel = await A.evaluate(() => [...window.__sel]); s = await state(A);
  ok(s.native && sel.at(-1) === 'screen:1:0' && helpers[0]?.srcId === 'window:4242:0', 'dois monitores com o app novo: o Chromium captura a tela do monitor do jogo', { sel, srcId: helpers[0]?.srcId });
  await unshare(A);
  await A.evaluate(() => { window.__sel.length = 0; window.__twoScreens = false; });
  await share(A, 'wgc=fail@1,dxgi=nostart', 'auto', { fps: 60, srcInfo: valo });
  await A.waitForFunction(() => !window.__lc.voice.native && window.__lc.voice.sfu?.producers?.screen, { timeout: 15000 }).catch(() => { });
  sel = await A.evaluate(() => [...window.__sel]); s = await state(A);
  ok(!s.native && s.chromiumVideo && sel.at(-1) === 'window:4242:0', 'nativo falhou: o Chromium volta para a janela do jogo antes de transmitir (nunca a tela inteira)', { sel, s });
  await watch(B, a.id);
  ok(await viewerFrames(B, a.id) > 20, 'quem assiste vê pelo Chromium');
  await unshare(A);
  await A.evaluate(() => { window.__os = 26200; window.__lc.voice._natCap = null; });
  await share(A, '', 'auto', { fps: 30, srcInfo: game });
  // 10) tela cheia exclusiva confirmada com a transmissão no ar (Chromium congelado): passa sozinho para o nativo
  console.log('-- 10. tela cheia congelou o Chromium -> nativo');
  await A.evaluate(() => { const v = window.__lc.voice; v._fseNative = true; return v.switchToNative(); });
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending, { timeout: 15000 }).catch(() => { });
  s = await state(A);
  ok(s.native && !s.chromiumVideo && helpers.length === 1, 'troca ao vivo do Chromium para o nativo', s);
  await watch(B, a.id);
  ok(await viewerFrames(B, a.id) > 20, 'quem assiste segue vendo depois da troca');
  await unshare(A);
} catch (e) { console.log('  ERRO', e.stack); fails++; }
finally {
  for (const h of helpers) try { h.proc.kill(); } catch { }
  await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
