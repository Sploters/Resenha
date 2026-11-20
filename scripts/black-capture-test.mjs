// Testa o aviso de captura preta: um stream 100% preto dispara o aviso; um stream com imagem o desliga. Sem tela real nem Electron.
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
fs.rmSync('.testdata-black', { recursive: true, force: true });
const PORT = 3225, BASE = `http://localhost:${PORT}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', RTC: '0', DATA_DIR: './.testdata-black' }, stdio: 'ignore' });
// o servidor morre junto com o teste, mesmo se ele cair no meio (antes ficava vivo na porta e o próximo teste falhava)
const killSrv = () => { try { if (process.platform === 'win32') execSync(`taskkill /pid ${srv.pid} /T /F`, { stdio: 'ignore' }); else srv.kill('SIGKILL'); } catch { } };
process.on('exit', killSrv);
await sleep(1800);
const b = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const p = await b.newPage(); await p.goto(BASE);
  await p.waitForSelector('#auth .auth-card'); await p.evaluate(() => [...document.querySelectorAll('#auth a')].find(a => a.textContent.includes('Registre')).click()); await sleep(200);
  await p.evaluate(() => { const i = document.querySelectorAll('#auth input'); i[0].value = 'tester'; i[2].value = 'Teste.senha-123'; i[3].value = 'Teste.senha-123'; });
  await p.click('#auth .btn'); await p.waitForSelector('#rail .rail-wrap', { timeout: 8000 });
  // streams de teste por canvas (redesenhados continuamente para o vídeo ter quadros)
  await p.evaluate(() => {
    const mk = (paint) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); setInterval(() => paint(x), 50); paint(x); return c.captureStream(20); };
    window.__black = mk(x => { x.fillStyle = '#000'; x.fillRect(0, 0, 320, 180); });
    window.__dark = mk(x => { x.fillStyle = '#000'; x.fillRect(0, 0, 320, 180); x.fillStyle = '#303030'; x.fillRect(100, 60, 120, 60); }); // quase preto, mas com conteúdo
    window.__color = mk(x => { x.fillStyle = '#3a7'; x.fillRect(0, 0, 320, 180); });
    window.__events = []; window.__lc.voice.onBlackCapture = (v) => window.__events.push(v);
  });
  const st = () => p.evaluate(() => ({ black: window.__lc.voice.captureBlack, ev: window.__events.slice() }));
  await p.evaluate(() => { const v = window.__lc.voice; v.screen = window.__black; v.meterBlack(); });
  await sleep(4500); ok(!(await st()).black, 'não avisa antes de ~6 s de preto');
  await sleep(4000); let s = await st(); ok(s.black === true, 'aviso ligado após ~6 s de preto absoluto'); ok(s.ev.join() === 'true', 'callback onBlackCapture(true) chamado uma vez');
  await p.evaluate(() => { window.__lc.voice.screen = window.__color; });
  await sleep(4600); s = await st(); ok(s.black === false, 'aviso desligado quando volta a ter imagem'); ok(s.ev.join() === 'true,false', 'callback onBlackCapture(false) chamado');
  await p.evaluate(() => { const v = window.__lc.voice; v.screen = window.__dark; v.meterBlack(); });
  await sleep(9000); s = await st(); ok(s.black === false, 'cena escura com conteúdo (cinza #303030) NÃO dispara o aviso');
  await p.evaluate(() => { window.__lc.voice.screen = null; }); await sleep(2600);
  ok((await st()).black === false, 'sem transmissão, aviso desligado');
  // a leitura do quadro (voice.js frameMax) nos formatos que a captura entrega: preto, cinza escuro e azul escuro (luma de
  // quase preto, mas não é preto) em YUV (faixa limitada, I420 e NV12) e RGB
  const fm = await p.evaluate(async () => {
    const { frameMax } = await import('/voice.js'), W = 64, H = 36;
    const yuv = (fmt, Y, U, V) => { const n = W * H, c = (W / 2) * (H / 2), d = new Uint8Array(n + 2 * c); d.fill(Y, 0, n);
      if (fmt === 'NV12') for (let i = 0; i < c; i++) { d[n + 2 * i] = U; d[n + 2 * i + 1] = V; } else { d.fill(U, n, n + c); d.fill(V, n + c); }
      return new VideoFrame(d, { format: fmt, codedWidth: W, codedHeight: H, timestamp: 0, colorSpace: { fullRange: false, matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' } }); };
    const rgba = (r, g, b) => { const d = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) d.set([r, g, b, 255], i * 4); return new VideoFrame(d, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: 0 }); };
    const read = async (f) => { const b = new Uint8Array(f.allocationSize()), l = await f.copyTo(b), m = frameMax(f, b, l); f.close(); return m; };
    const out = {};
    for (const fmt of ['I420', 'NV12']) { out[fmt + ' preto'] = await read(yuv(fmt, 16, 128, 128)); out[fmt + ' cinza'] = await read(yuv(fmt, 60, 128, 128)); out[fmt + ' azul escuro'] = await read(yuv(fmt, 20, 146, 125)); }
    out['RGBA preto'] = await read(rgba(0, 0, 0)); out['RGBA azul escuro'] = await read(rgba(0, 0, 40));
    return out;
  });
  ok(fm['I420 preto'] <= 6 && fm['NV12 preto'] <= 6 && fm['RGBA preto'] <= 6, 'leitura do quadro: preto é preto (YUV e RGB) ' + JSON.stringify(fm));
  ok(fm['I420 cinza'] > 40 && fm['NV12 cinza'] > 40 && fm['I420 azul escuro'] > 30 && fm['NV12 azul escuro'] > 30 && fm['RGBA azul escuro'] === 40, 'leitura do quadro: cinza e azul escuros não são preto');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
console.log(fails ? `\n${fails} FALHA(S)` : '\nCAPTURA PRETA OK');
await b.close(); killSrv();
process.exit(fails ? 1 : 0);
