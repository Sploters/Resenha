// Watch Together no app desktop (desktop/watchwin.js + desktop/watchbridge.js) com Electron de verdade e páginas
// simuladas no lugar da Netflix/Prime/Crunchyroll (um <video> local; a "Netflix" simulada tem a API do player que a
// busca usa). O que isto NÃO prova: que os serviços reais deixam tocar e controlar — isso exige Widevine (o Electron
// padrão não tem) e validação manual com contas reais (ver docs/WATCH-TOGETHER.md).
// Uso: node scripts/watch-desktop-test.mjs (no Linux sem tela: xvfb-run -a node scripts/watch-desktop-test.mjs)
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const electron = require('../desktop/node_modules/electron');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const DIR = './.testmedia-watch-desktop'; fs.mkdirSync(DIR, { recursive: true });
const V = path.join(DIR, 'v.webm');
if (!fs.existsSync(V)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=60', '-c:v', 'libvpx', '-b:v', '200k', '-deadline', 'realtime', V]);
const page = (extra = '') => `<!doctype html><title>Simulado</title><body style="margin:0;background:#000"><video src="/v.webm" style="width:100%;height:100vh" muted playsinline></video>${extra}</body>`;
const NF_API = `<script>window.__seekCalls=0;window.netflix={appContext:{state:{playerApp:{getAPI:()=>({videoPlayer:{getAllPlayerSessionIds:()=>['watch-1'],getVideoPlayerBySessionId:()=>({seek:(ms)=>{window.__seekCalls++;document.querySelector('video').currentTime=ms/1000}})}})}}}};</script>`;
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/v.webm') { const size = fs.statSync(V).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); if (m) { const a = +m[1], b = m[2] ? +m[2] : size - 1; res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 }); return fs.createReadStream(V, { start: a, end: b }).pipe(res); } res.writeHead(200, { 'content-type': 'video/webm', 'content-length': size, 'accept-ranges': 'bytes' }); return fs.createReadStream(V).pipe(res); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(u === '/netflix.html' ? page(NF_API) : u === '/login' ? '<!doctype html><title>Login</title><form><input name=email></form>' : page());
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${srv.address().port}`;
// O resultado vem por arquivo, e a espera é pelo fim do processo principal ('exit'), não pelo fechamento da saída
// ('close'): no GitHub Actions um processo auxiliar do Electron às vezes continuava vivo segurando a saída, e o teste
// esperava para sempre (estourava os 300 s do executor sem imprimir nada). No limite mata o grupo todo.
const RES = path.resolve('.testdata-watch-desktop.result.json'), LOG = path.resolve('.testdata-watch-desktop.log');
fs.rmSync(RES, { force: true });
const logFd = fs.openSync(LOG, 'w');
const exitInfo = await new Promise((resolve) => {
  const p = spawn(electron, [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), 'scripts/watch-desktop-app', '--user-data-dir=' + path.resolve('.testdata-watch-desktop')], { env: { ...process.env, MOCK, RESULT_FILE: RES, RESENHA_WATCH_TEST_HOSTS: '127.0.0.1', ELECTRON_ENABLE_LOGGING: '0' }, stdio: ['ignore', logFd, logFd], detached: process.platform !== 'win32' });
  const killAll = () => { try { process.platform !== 'win32' ? process.kill(-p.pid, 'SIGKILL') : p.kill('SIGKILL'); } catch { } };
  const t = setTimeout(() => { killAll(); resolve({ timeout: true }); }, 90_000);
  p.on('exit', (code, sig) => { clearTimeout(t); setTimeout(killAll, 200); resolve({ code, sig }); });
  p.on('error', (e) => { clearTimeout(t); resolve({ error: e.message }); });
});
fs.closeSync(logFd); srv.close(); srv.closeAllConnections?.();
let R = null; try { R = JSON.parse(fs.readFileSync(RES, 'utf8')); } catch { }
if (!R) { console.log(fs.readFileSync(LOG, 'utf8').slice(-3000)); ok(false, 'o app de teste não terminou', exitInfo); process.exit(1); }
if (R.timeout) console.log('  app de teste parou no passo: ' + R.step);
if (R.exception) console.log(R.exception);
ok(R.hostOk.netflix && !R.hostOk.evil && R.hostOk.prime, 'só endereços do próprio serviço abrem na janela', R.hostOk);
ok(R.outside?.ok === false, 'abrir endereço fora do serviço é recusado', R.outside);
ok(R.open?.ok, 'janela do serviço abre');
ok(R.widevine === false, 'DRM detectado corretamente: o Electron padrão NÃO tem Widevine (serviços reais não tocam aqui)', R.widevine);
ok(R.video, 'a ponte encontra o <video> da página');
ok(R.playing, 'play pela sala toca o vídeo da janela');
ok(R.paused, 'pause pela sala');
ok(Math.abs((R.seekPos || 0) - 20) < 0.6, 'posição pela sala (seek 20 s)', R.seekPos);
ok(Math.abs(R.volume - 0.3) < 0.01, 'volume local aplicado na janela');
ok(R.pageCantSeeBridge, 'a página do serviço não enxerga a ponte (mundo isolado)');
ok(R.stayed, 'navegar para fora do serviço é barrado');
ok(R.nfSeek === true && R.nfApiCalled === 1, 'Netflix: posição pela API do player da página (sem mexer no currentTime)', { r: R.nfSeek, calls: R.nfApiCalled });
ok(R.nfNoApi === false && R.nfUnsupportedEvent, 'Netflix sem a API: não força o currentTime e avisa a interface');
ok(R.login, 'tela de login do serviço é reconhecida (pede para entrar na conta)');
ok(R.partition.prime === 1 && R.partition.app === 0 && R.partition.netflix === 0 && R.partition.persistent, 'login guardado numa sessão própria e persistente por serviço, separada do Resenha', R.partition);
ok(!/Electron\/|resenha-watch-desktop-test/.test(R.ua), 'identificador do navegador sem "Electron/"', R.ua);
ok(R.closed, 'fechar as janelas avisa a interface');
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
