// Modo reserva do Windows 10 (public/voice.js watchOver/applyOver): o Chromium transmite o MONITOR do jogo e o jogo some
// dele (Alt+Tab, minimizado). O app desktop avisa (lc-audio 'over'); aqui o app é de mentira (window.lcDesktop com só o
// vigia) e o modo reserva é simulado com _natWinId. Confere que nenhum quadro sai enquanto o jogo está fora (quem assiste
// não vê a janela da frente), que quem assiste recebe o aviso, que a voz e a prévia de quem transmite seguem (sem quadro
// preto) e que tudo volta quando o jogo volta. Fora do modo reserva o aviso não muda nada.
// Uso: node scripts/screen-over-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('screenover', 3349, 41395);
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await api('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'T' }); await api(b.tok, 'POST', '/invites/' + (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code);
  const open = async (br, tok) => { const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
      navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false }); }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; };
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await B.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'screen'), { timeout: 15000 }, a.id);
  await B.evaluate((uid) => window.__lc.voice.openStream(uid), a.id); await sleep(1500); // o Bruno clica para assistir
  // app de mentira: só o vigia do jogo (o resto do app desktop continua ausente). fire(c) = o que o lc-audio avisaria
  await A.evaluate(() => {
    window.__over = { asked: [], cb: null };
    window.lcDesktop = { watchSourceOver: async (id) => { window.__over.asked.push(id); return !!id; }, onSourceOver: (f) => { window.__over.cb = f; } };
    window.__fire = (covered, why = 'front') => window.__over.cb?.({ covered, why });
  });
  // vídeo e voz que chegam ao Bruno em `ms`, e quadros decodificados
  const recv = (ms = 2000) => B.evaluate(async (uid, ms) => {
    const cs = [...window.__lc.voice.sfu.consumers.values()].filter(e => e.uid === uid);
    const snap = async () => { const o = { video: 0, frames: 0, mic: 0 }; for (const e of cs) (await e.c.rtpReceiver.getStats()).forEach(x => { if (x.type !== 'inbound-rtp') return; if (e.source === 'screen' && x.kind === 'video') { o.video += x.bytesReceived || 0; o.frames += x.framesDecoded || 0; } if (e.source === 'mic') o.mic += x.bytesReceived || 0; }); return o; };
    const s0 = await snap(); await new Promise(r => setTimeout(r, ms)); const s1 = await snap();
    return { video: s1.video - s0.video, frames: s1.frames - s0.frames, mic: s1.mic - s0.mic };
  }, a.id, ms);
  const note = () => B.evaluate((uid) => window.__lc.S.voice.get(uid)?.screen_note || null, a.id);
  const local = () => A.evaluate(() => { const v = window.__lc.voice, t = v.screen?.getVideoTracks()[0]; return { live: t?.readyState === 'live', enabled: !!t?.enabled, black: !!v.captureBlack, note: v.screenNote, sender: !!v.sfu?.producers.screen?.rtpSender?.track }; });

  const r0 = await recv();
  ok(r0.video > 20000 && r0.frames > 20, 'antes: o Bruno recebe a transmissão', r0);

  // 1) fora do modo reserva (a Alice manda a janela, não o monitor): o aviso não muda nada
  await A.evaluate(() => { window.__lc.voice.watchOver(); window.__fire(true); }); await sleep(800);
  const r1 = await recv();
  ok(r1.frames > 20 && (await note()) === null, 'sem o modo reserva, o aviso do app não pausa nada', { ...r1, note: await note() });
  await A.evaluate(() => window.__fire(false));

  // 2) modo reserva: o jogo sai da tela
  await A.evaluate(() => { const v = window.__lc.voice; v._natWinId = 'window:55:0'; v.watchOver(); });
  ok((await A.evaluate(() => window.__over.asked.at(-1))) === 'window:55:0', 'o app é avisado de qual janela vigiar (a do jogo)');
  await A.evaluate(() => window.__fire(true)); await sleep(1500); // deixa passar o que já estava no caminho
  const r2 = await recv(3000), n2 = await note(), l2 = await local();
  ok(r2.video < 2000 && r2.frames === 0, 'jogo fora da tela: nenhum quadro chega a quem assiste (não vê a janela da frente)', r2);
  ok(r2.mic > 1000, 'a voz da Alice continua chegando', r2.mic);
  ok(n2 === 'away', 'quem assiste recebe o aviso "o jogo não está na tela"', n2);
  ok(l2.live && l2.enabled && !l2.sender, 'quem transmite: a trilha segue viva e ligada (prévia), só sai do envio', l2);
  const shown = await B.evaluate(() => [...document.querySelectorAll('.snote b')].map(x => x.textContent));
  ok(shown.includes('O jogo não está na tela'), 'o aviso aparece na tela de quem assiste', shown);
  await sleep(6500); // o detector de tela preta lê a cada 2 s e precisa de ~6 s de preto para avisar
  ok(!(await local()).black, 'a pausa não vira "transmissão preta" para quem transmite');

  // 3) o jogo volta
  await A.evaluate(() => window.__fire(false)); await sleep(1200);
  const r3 = await recv(), n3 = await note(), l3 = await local();
  ok(r3.video > 20000 && r3.frames > 20, 'jogo de volta: a transmissão volta para quem assiste', r3);
  ok(n3 === null && l3.sender, 'o aviso some e a trilha volta ao envio', { n3, sender: l3.sender });
  const hist = await A.evaluate(() => (window.__lc.voice.capHist || []).map(e => e.msg).filter(m => /monitor capturado|de volta na tela/.test(m || '')));
  ok(hist.length === 2, 'o diagnóstico da captura registra a pausa e a volta', hist);

  // 4) parar a transmissão com o jogo fora: para o vigia e não deixa nada pausado para a próxima
  await A.evaluate(() => window.__fire(true)); await sleep(300);
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(500);
  ok((await A.evaluate(() => window.__over.asked.at(-1))) === null, 'parar a transmissão para o vigia do app');
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await B.waitForFunction((uid) => [...(window.__lc.voice.sfu?.consumers.values() || [])].some(e => e.uid === uid && e.source === 'screen' && !e.c.closed), { timeout: 15000 }, a.id).catch(() => { });
  await B.evaluate((uid) => window.__lc.voice.openStream(uid), a.id); await sleep(1500);
  const r4 = await recv();
  ok(r4.frames > 20 && (await note()) === null, 'a transmissão seguinte sai normal', { ...r4, note: await note() });
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await bA.close(); await bB.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nJOGO FORA DA TELA OK'); process.exit(fails ? 1 : 0);
