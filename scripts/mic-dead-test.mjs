// Captura do microfone morrendo no meio da chamada (Windows/driver reiniciou o dispositivo, outro programa pegou o
// microfone): a voz tem que voltar sozinha, sem sair e entrar na sala (vigia em public/micwatch.js + voice.js micWatch).
// Alice e Bob na mesma sala; Bob confere se a voz da Alice chega (nível do pacote recebido). Mata a captura da Alice de
// dois jeitos: a trilha termina, e a captura fica viva entregando zero absoluto. Uso: node scripts/mic-dead-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3323, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata41', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata41', RTC_PORT: '41191', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'];
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
try {
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const b = await call('', 'POST', '/register', { username: 'bob', password: 'Teste.senha-123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' });
  const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`); await call(b.token, 'POST', `/invites/${inv.code}`);
  const open = async (tok) => {
    const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
    const vch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
    await p.evaluate((cid) => window.__lc.voice.join(cid), vch.id);
    await p.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
    return p;
  };
  const pa = await open(a.token), pb = await open(b.token);
  const aid = await pa.evaluate(() => window.__lc.S.me.id);
  // Bob: a voz da Alice está chegando? (nível do último pacote recebido, como o medidor de "falando")
  const hears = () => pb.evaluate((id) => { const x = window.__lc.voice.analysers.get(id); const s = x?.rx?.getSynchronizationSources()[0]; return !!s && performance.timeOrigin + performance.now() - s.timestamp < 500 && s.audioLevel > 0.001; }, aid);
  const waitHear = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await hears()) return (Date.now() - t0) / 1000; await sleep(250); } return null; };
  ok(await waitHear(10000) != null, 'Bob ouve a Alice');

  // 1) a trilha do microfone termina (dispositivo reiniciado/desconectado)
  const id0 = await pa.evaluate(() => { const g = window.__lc.voice.micGraph; g.rawTrack.stop(); return g.id; });
  await sleep(1500);
  const t1 = await waitHear(15000);
  if (t1 == null) console.log('   dbg1', await pa.evaluate((id) => { const v = window.__lc.voice, g = v.micGraph; return JSON.stringify({ id: g?.id, id0: id, mw: v._mw, err: v.error, rb: !!v._rb, tr: g?.rawTrack.readyState, pk: g?.rawPeak(), en: v.mic?.getAudioTracks()[0]?.enabled, prod: v.sfu?.producers?.mic?.track?.id === v.mic?.getAudioTracks()[0]?.id, ps: v.sfu?.producers?.mic?.paused }); }, id0));
  ok(t1 != null && await pa.evaluate((id) => window.__lc.voice.micGraph?.id !== id, id0), 'trilha terminada: microfone remontado e Bob volta a ouvir', t1);

  // 2) captura viva mas entregando zero absoluto (o caso que só sair e entrar resolvia)
  const id1 = await pa.evaluate(() => { const g = window.__lc.voice.micGraph; g.nodes[0].disconnect(); return g.id; });
  await sleep(2000);
  ok(!(await hears()), 'captura zerada: Bob para de ouvir (simulação certa)');
  const t2 = await waitHear(25000);
  ok(t2 != null && await pa.evaluate((id) => window.__lc.voice.micGraph?.id !== id, id1), 'zero absoluto por alguns segundos: microfone remontado sozinho e Bob volta a ouvir', t2);
  ok(await pa.evaluate(() => !!window.__lc.voice.channelId), 'Alice continua na sala o tempo todo');

  // 3) silêncio normal não remonta: o microfone falso tem som o tempo todo, então 20 s sem mexer = sem remontagem
  const id2 = await pa.evaluate(() => window.__lc.voice.micGraph.id); await sleep(20000);
  ok(await pa.evaluate((id) => window.__lc.voice.micGraph.id === id, id2), 'microfone com som: nenhuma remontagem à toa');

  // 4) mutado: continua vigiando a captura (desmutar já sai com a voz)
  await pa.evaluate(() => window.__lc.voice.toggleMute()); const id3 = await pa.evaluate(() => { const g = window.__lc.voice.micGraph; g.nodes[0].disconnect(); return g.id; });
  await sleep(12000); await pa.evaluate(() => window.__lc.voice.toggleMute());
  ok(await pa.evaluate((id) => window.__lc.voice.micGraph.id !== id, id3), 'mutado: captura morta também é remontada');
  ok(await waitHear(6000) != null, 'desmutou: Bob ouve na hora');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); fs.rmSync('.testdata41', { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
