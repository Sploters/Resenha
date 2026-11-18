// Verificação MANUAL do Watch Together com o YouTube de verdade (IFrame Player API oficial + oEmbed oficial).
// Não roda na verificação automática (depende da internet e do YouTube). Dois navegadores na mesma sala:
// adicionar por link, título pelo oEmbed, tocar sincronizado, pausar, mudar a posição e conferir a diferença.
// Uso: BROWSER=/caminho/do/chrome node scripts/watch-youtube-real.mjs [idDoVideo]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
fs.mkdirSync('.testshots', { recursive: true });
const PORT = 3299, BASE = `http://localhost:${PORT}`, VID = process.argv[2] || 'aqz-KE-bpKQ'; // Big Buck Bunny (Blender, incorporação liberada)
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; };
fs.rmSync('./.testdata-ytreal', { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-ytreal', RTC_PORT: '41099', RTC_IPS: '127.0.0.1', NODE_USE_ENV_PROXY: '1' }, stdio: 'ignore' }); // NODE_USE_ENV_PROXY: rede com proxy (o oEmbed sai do servidor)
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => (await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })).token;
let browser;
try {
  const ta = await reg('ana'), tb = await reg('beto');
  const g = await call(ta, 'POST', '/guilds', { name: 'YouTube real' }); await call(tb, 'POST', '/invites/' + (await call(ta, 'POST', `/guilds/${g.id}/invites`)).code);
  browser = await puppeteer.launch({ executablePath: process.env.BROWSER, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (t, dsf = 1) => { const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: dsf }); await p.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, t); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p; };
  const A = await open(ta, 2), B = await open(tb);
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  for (const P of [A, B]) await P.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc);
  await sleep(2500);
  // fecha o chat da sala para o Watch Together ocupar o palco inteiro
  await A.evaluate(() => document.querySelector('.vchead button[title="Fechar chat"]')?.click());
  const W = (P) => P.evaluate(async () => JSON.parse(JSON.stringify((await window.__lc.import('watch.js')).watchState())));
  const cmd = (P, op, x) => P.evaluate(async (op, x) => { try { return await (await window.__lc.import('watch.js')).watchCmd(op, x); } catch (e) { return { error: e.message, code: e.code }; } }, op, x);
  await cmd(A, 'start'); await cmd(B, 'join');
  const r = await cmd(A, 'add', { url: `https://www.youtube.com/watch?v=${VID}` });
  ok(!r.error && r.item?.title && !/YouTube —/.test(r.item.title), 'título real pelo oEmbed do YouTube', r.item?.title || r.error);
  const playing = await until(async () => { const a = await W(A); if (a.error || a.sess?.history?.at(-1)?.error) return null; return a.playerState === 'playing' && (await W(B)).playerState === 'playing' && a.playerTime > 2; }, 30000);
  const why = (await W(A)).error || (await W(A)).sess?.history?.at(-1)?.error;
  if (why) { await sleep(1500); await A.screenshot({ path: '.testshots/watch-youtube-real-recusado.png' }); console.log(`  ℹ  o YouTube não liberou a reprodução daqui (erro mostrado na tela: ${why}). Em datacenter/robôs o YouTube costuma responder 150 até na página mínima do player.`); console.log('  📸 .testshots/watch-youtube-real-recusado.png'); throw new Error('reprodução recusada pelo YouTube neste ambiente: o resto não dá para conferir aqui'); }
  ok(!!playing, 'IFrame Player API oficial carregou e tocou nos dois navegadores', await W(A).then(w => ({ err: w.error, st: w.playerState, t: w.playerTime })));
  await sleep(4000);
  const d1 = Math.abs((await W(A)).playerTime - (await W(B)).playerTime);
  ok(d1 < 0.8, 'sincronizados', +d1.toFixed(2));
  await A.screenshot({ path: '.testshots/watch-youtube-real.png' }); console.log('  📸 .testshots/watch-youtube-real.png');
  await cmd(A, 'pause'); await sleep(1500);
  ok((await W(B)).playerState === 'paused', 'pause chega ao outro navegador');
  await cmd(A, 'seek', { pos: 60 }); await cmd(A, 'play'); await sleep(4000);
  const [a, b] = [(await W(A)).playerTime, (await W(B)).playerTime];
  ok(Math.abs(a - b) < 0.8 && a > 60, 'posição 1:00 + play: juntos', [+a.toFixed(2), +b.toFixed(2)]);
  ok((await W(A)).sess.current.duration > 0, 'duração lida do player real', (await W(A)).sess.current.duration);
} catch (e) { console.log('  EXCEÇÃO', e.stack); fails++; }
finally { await browser?.close().catch(() => { }); srv.kill(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
