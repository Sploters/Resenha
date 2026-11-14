// Qualidade do vídeo numa chamada de verdade (SFU, dois navegadores): alice transmite a tela (canvas no lugar do
// getDisplayMedia) e bruno assiste. Confere que:
//  - as travadas e o tempo assistido caem na TRANSMISSÃO (não na câmera) para quem assiste;
//  - tela parada (o canvas para de mudar e o navegador quase não manda quadros) não derruba a nota da chamada;
//  - quem transmite mede o que limitou o envio e os quadros enviados/capturados;
//  - "entrar na voz" é medido por etapa (microfone, servidor, mídia) e vai para a fila da telemetria.
// Uso: node scripts/callqual-video-test.mjs     (SECS=20 por fase)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3333, BASE = `http://localhost:${PORT}`, DATA = './.testdata-callqv', SECS = +(process.env.SECS || 20);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 120000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    // tela "transmitida": canvas que muda a cada quadro até window.__still = true (aí fica parado, como uma tela sem movimento)
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0;
      const draw = () => { if (window.__still) return; n++; x.fillStyle = `hsl(${n * 3 % 360} 60% 40%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; for (let i = 0; i < 20; i++) x.fillRect((n * 9 + i * 70) % 1200, (i * 37) % 650, 60, 60); };
      draw(); setInterval(draw, 1000 / 30); return c.captureStream(30);
    };
  }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
const uxQueue = (p) => p.evaluate(async () => { const u = performance.getEntriesByType('resource').map(e => e.name).find(x => /\/ux\.js(\?|$)/.test(x)); return (await import(u)).uxPending(); });
let A, B;
try {
  const [ra, rb] = await Promise.all(['alice', 'bruno'].map(n => api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })));
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code;
  await api(rb.token, 'POST', '/invites/' + inv);
  [A, B] = [await person(ra.token), await person(rb.token)];
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  for (const p of [A, B]) await p.evaluate(async (vc) => {
    window.__q = undefined; document.addEventListener('call-ended', (e) => { window.__q = e.detail.quality; }, { once: true });
    window.__lc.joinVoice(vc); for (let i = 0; i < 150 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100));
  }, vc);
  await sleep(1500);
  const qB0 = await uxQueue(B), stage = (q, m) => q.some(x => x.e === 'timing' && x.d.startsWith(m + ':'));
  ok(['voice_mic', 'voice_server', 'voice_media', 'voice_connect'].every(m => stage(qB0, m)), 'entrar na voz medido por etapa (microfone, servidor, mídia) e no total', qB0.filter(x => x.e === 'timing'));
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }).then(() => true));
  // bruno abre a transmissão (a mídia só vem para quem assiste)
  const aid = await A.evaluate(() => window.__lc.S.me.id);
  await B.waitForFunction((aid) => !!window.__lc.voice.peers.get(aid)?.streams?.screen, { timeout: 30000 }, aid).catch(() => { });
  await B.evaluate((aid) => { window.__lc.voice.openStream(aid); }, aid); await sleep(1500); // bruno clica para assistir
  const kinds = await B.evaluate(() => [...window.__lc.voice.videoKinds().values()]);
  ok(kinds.includes('screen'), 'quem assiste reconhece o vídeo recebido como transmissão', kinds);
  await sleep(SECS * 1000);
  await A.evaluate(() => { window.__still = true; }); // tela parada
  await sleep(SECS * 1000);
  await A.evaluate(() => { window.__still = false; }); await sleep(8000); // volta a mexer: o 1º quadro depois da pausa
  await B.evaluate(() => window.__lc.voice.leave()); await A.evaluate(() => window.__lc.voice.leave());
  await sleep(500);
  const qa = await A.evaluate(() => window.__q), qb = await B.evaluate(() => window.__q);
  const scrFreezes = qb?.video?.screen?.freezes;
  console.log('  travadas contadas na transmissão depois de', SECS, 's de tela parada:', scrFreezes);
  console.log('  quem assiste:', JSON.stringify(qb?.video), qb?.grade, JSON.stringify(qb?.net));
  console.log('  quem transmite:', JSON.stringify(qa?.video?.sent), JSON.stringify(qa?.net));
  ok(qb && qb.video.screen.watchMs >= SECS * 1000 * 0.6 && qb.video.cam.watchMs === 0, 'tempo assistido contado na transmissão, nada na câmera', qb?.video);
  ok(qb && qb.video.screen.fps > 5, 'quadros por segundo da transmissão recebida medidos', qb?.video?.screen);
  ok(qb && qb.grade === 'good', 'rede limpa com a tela parada metade do tempo: nota boa (travadas da tela não pesam)', { grade: qb?.grade, cause: qb?.cause, screen: qb?.video?.screen });
  ok(qb && qb.net.some(d => d.startsWith('freeze_scr:')) && qb.net.some(d => d.startsWith('scr_fps:')), 'travadas e fps da transmissão vão para a telemetria', qb?.net);
  ok(qa && qa.video.sent.ms >= SECS * 1000 && qa.video.sent.captured != null && qa.net.some(d => /^slim:(none|cpu|bandwidth|other)$/.test(d)), 'quem transmite mede o que limitou o envio e os quadros capturados', qa?.video?.sent);
  const qBq = await uxQueue(B);
  ok(qBq.some(x => x.e === 'call_net' && x.d.startsWith('freeze_scr:')), 'a fila de quem assiste leva freeze_scr', qBq.filter(x => x.e === 'call_net'));
  // o servidor aceita as medidas novas (as que ele não conhece seriam descartadas em silêncio)
  const tok = await B.evaluate(() => window.__lc.S.token ?? localStorage.lc_token);
  const r = await api(tok, 'POST', '/ux', { version: 'test', device: 'app', events: [{ e: 'call_net', d: 'freeze_scr:2', n: 1 }, { e: 'call_net', d: 'scr_fps:1', n: 1 }, { e: 'call_net', d: 'slim:cpu', n: 1 }, { e: 'timing', d: 'voice_mic:3', n: 1 }, { e: 'slow_switch', d: 'espera:chamada+assistindo', n: 1 }, { e: 'menu_pick', d: 'chamada › Mais opções › desenhar', n: 1 }, { e: 'slow_switch', d: 'qualquer coisa', n: 1 }] });
  ok(r.kept === 6, 'servidor aceita as medidas novas e recusa detalhe fora do formato', r);
} finally {
  await browser.close().catch(() => { }); srv.kill('SIGKILL'); fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
