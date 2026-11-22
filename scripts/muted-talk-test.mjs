// Avisos do seu microfone na chamada (public/voicenote.js): falar mutado mostra "Você está mutado" com Desmutar (que
// desmuta de verdade: Bob volta a ouvir); desligado nas Configurações, ensurdecido ou desmutado não avisa; a captura
// caindo mostra "religando" e depois "de volta"; esgotadas as remontagens, "não está mandando som".
// Alice e Bob na mesma sala. O microfone falso padrão do Chrome é um bipe curto a cada ~2,5 s (para o detector, um clique:
// não é fala), então o teste gera um WAV parecido com fala (vogais de 150 Hz com harmônicos em sílabas de ~4 por segundo
// e pausas) e usa --use-file-for-fake-audio-capture.
// Uso: node scripts/muted-talk-test.mjs   (PORT, RTC_PORT e SHOTS=pasta para salvar capturas são opcionais)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +process.env.PORT || 3441, BASE = `http://localhost:${PORT}`, DATA = `./.testdata-mt${PORT}`, SHOTS = process.env.SHOTS;
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: process.env.RTC_PORT || '41441', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
fs.mkdirSync(DATA, { recursive: true });
const WAV = `${DATA}/fala.wav`; {
  const SR = 48000, N = SR * 8, d = Buffer.alloc(44 + N * 2);
  d.write('RIFF', 0); d.writeUInt32LE(36 + N * 2, 4); d.write('WAVEfmt ', 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22);
  d.writeUInt32LE(SR, 24); d.writeUInt32LE(SR * 2, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write('data', 36); d.writeUInt32LE(N * 2, 40);
  for (let i = 0; i < N; i++) {
    const t = i / SR, ph = t % 2, syl = (t * 4) % 1; // 1,6 s de fala e 0,4 s de pausa; sílabas de 180 ms
    const env = ph < 1.6 && syl < 0.72 ? Math.sin(Math.PI * syl / 0.72) : 0, f0 = 150 + 20 * Math.sin(t * 3);
    let v = 0; for (let k = 1; k <= 6; k++) v += Math.sin(2 * Math.PI * f0 * k * t) / k;
    d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.25 * env * v)) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(WAV, d);
}
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--no-sandbox', '--autoplay-policy=no-user-gesture-required'];
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const shot = async (p, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: 0, y: 420, width: 640, height: 380 } }); };
try {
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const b = await call('', 'POST', '/register', { username: 'bob', password: 'Teste.senha-123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' });
  const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`); await call(b.token, 'POST', `/invites/${inv.code}`);
  const open = async (tok) => {
    const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
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
  // Bob ouve a Alice? (amostra dentro da página por 500 ms: o bipe falso é curto, como em mic-dead-test)
  const hears = () => pb.evaluate(async (id) => {
    const t0 = performance.now();
    do { const s = window.__lc.voice.analysers.get(id)?.rx?.getSynchronizationSources()[0]; if (s && performance.timeOrigin + performance.now() - s.timestamp < 500 && s.audioLevel > 0.001) return true; await new Promise(r => setTimeout(r, 10)); } while (performance.now() - t0 < 500);
    return false;
  }, aid);
  const waitHear = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await hears()) return (Date.now() - t0) / 1000; await sleep(250); } return null; };
  const note = () => pa.evaluate(() => { const e = document.getElementById('vnote'); return e ? e.className.replace('vnote', '').trim() : null; });
  const waitNote = async (kind, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const n = await note(); if (n?.split(' ').includes(kind)) return (Date.now() - t0) / 1000; await sleep(100); } return null; };
  ok(await waitHear(10000) != null, 'Bob ouve a Alice');
  await sleep(1500);

  // 1) desmutado e falando: nada
  ok(await waitNote('mutedtalk', 3000) == null, 'desmutada falando: sem aviso');
  // 2) mutou e continua falando: aviso em cima do botão do microfone
  await pa.evaluate(() => window.__lc.voice.toggleMute());
  const t = await waitNote('mutedtalk', 6000);
  const lv = await pa.evaluate(async () => { const out = []; for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 250)); out.push(+(window.__lc.voice.micGraph.rawRms || 0).toFixed(3)); } return out; });
  ok(t != null && t < 4, 'mutada falando: "Você está mutado" em poucos segundos', { t, rms: lv });
  const pos = await pa.evaluate(() => { const n = document.getElementById('vnote').getBoundingClientRect(), m = document.querySelector('.pb-mic').getBoundingClientRect(); return { above: n.bottom <= m.top, over: n.left <= m.left + m.width / 2 && n.right >= m.left + m.width / 2, txt: document.getElementById('vnote').innerText }; });
  ok(pos.above && pos.over && /Você está mutado/.test(pos.txt) && /Desmutar/.test(pos.txt), 'aviso logo acima do botão do microfone, com Desmutar', pos);
  await sleep(400); await shot(pa, '01-depois-falando-mutado');
  ok(!(await hears()), 'o aviso não abre o microfone: Bob continua sem ouvir');
  await pa.click('#vnote .btn.green');
  ok(await pa.evaluate(() => !window.__lc.voice.muted), 'Desmutar desmuta');
  ok(await waitHear(6000) != null, 'Bob volta a ouvir a Alice');
  await sleep(300); ok(await note() == null, 'desmutou: o aviso some');

  // 3) desligado nas Configurações / ensurdecida: não avisa
  await pa.evaluate(() => { const v = window.__lc.voice; v.prefs.mutedTalkWarn = false; v.toggleMute(); });
  ok(await waitNote('mutedtalk', 4000) == null, 'opção desligada: sem aviso');
  await pa.evaluate(() => { const v = window.__lc.voice; v.prefs.mutedTalkWarn = true; v._tm = null; v.toggleDeaf(); });
  ok(await waitNote('mutedtalk', 4000) == null, 'ensurdecida: sem aviso');
  await pa.evaluate(() => { const v = window.__lc.voice; v.toggleDeaf(); if (v.muted) v.toggleMute(); });
  await sleep(1000);

  // 4) a captura cai: "religando" e depois "de volta"
  const id0 = await pa.evaluate(() => { const g = window.__lc.voice.micGraph; g.rawTrack.stop(); return g.id; });
  const tf = await waitNote('micfix', 3000); if (tf != null && SHOTS) { await sleep(250); await shot(pa, '02-depois-microfone-religando'); }
  ok(tf != null, 'captura terminou: "Seu microfone parou de responder — religando"', tf);
  const to = await waitNote('micok', 15000); if (to != null && SHOTS) { await sleep(300); await shot(pa, '03-depois-microfone-voltou'); }
  ok(to != null && await pa.evaluate((id) => window.__lc.voice.micGraph.id !== id, id0), 'remontou com som: "Microfone de volta"', to);
  ok(await waitHear(6000) != null, 'e Bob ouve de novo');

  // 5) esgotou as remontagens (simula o vigia já no limite) e a captura continua zerada: "não está mandando som"
  await sleep(3000);
  await pa.evaluate(() => window.__lc.voice.micGraph.nodes[0].disconnect()); await sleep(1500); // o último trecho ainda com som zera a conta: espera passar
  await pa.evaluate(() => { const w = window.__lc.voice._mw; w.fixes = 99; w.lastFix = w.t; });
  const td = await waitNote('micdead', 12000); if (td != null) { await sleep(300); await shot(pa, '04-depois-microfone-sem-som'); }
  ok(td != null && /Tentar de novo/.test(await pa.evaluate(() => document.getElementById('vnote').innerText)), 'sem som depois das tentativas: aviso com Tentar de novo / Verificar problemas', td);
  const id1 = await pa.evaluate(() => window.__lc.voice.micGraph.id);
  await pa.click('#vnote .btn.green');
  ok(await waitHear(8000) != null && await pa.evaluate((id) => window.__lc.voice.micGraph.id !== id, id1), 'Tentar de novo remonta e Bob volta a ouvir');
  // sair da sala tira o aviso
  await pa.evaluate(() => { window.__lc.voice.note('micdead'); }); await waitNote('micdead', 2000);
  await pa.evaluate(() => window.__lc.voice.leave()); await sleep(300);
  const left = await pa.evaluate(() => [...document.querySelectorAll('.vnote')].map(e => e.className + '|' + e.innerText.slice(0, 30)).join(';') || null); ok(left == null, 'saiu da sala: aviso some', left);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
