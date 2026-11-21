// Jogar junto pela interface, 4 navegadores: alice transmite pelo "app desktop" (ponte lcDesktop simulada que registra o
// que iria ao lc-input), bob, carol e dave na sala. Botão único "Pedir para jogar", janela Jogadores (pedido com só o
// Controle por padrão, Aceitar, permissões alteráveis, mouse para um só, convite, Revogar tudo, Tirar), aviso do jogador,
// isolamento (o que cada um manda só chega com a permissão), reconexão e a ponte do app atual (entrada 'pad' por vaga e
// 'control' à parte para mouse/teclado). Uso: node scripts/remote-play-ui-test.mjs   (capturas em .testshots/play-*.png)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3433, BASE = `http://localhost:${PORT}`, SHOTS = '.testshots', DATA = './.testdata-playui';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true }); fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41433', RTC_IPS: '127.0.0.1', HEALTH_DISK_PCT: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 860 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((tok, desk) => {
    localStorage.lc_token = tok;
    window.__sockets = []; const W = window.WebSocket; window.WebSocket = function (...a) { const s = new W(...a); window.__sockets.push(s); return s; }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33); return c.captureStream(30); };
    // controle de videogame falso (Gamepad API) e janela sempre "em foco" (o app solta tudo sem foco)
    window.__pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0], mapping: 'standard', connected: true, id: 'Xbox falso' };
    navigator.getGamepads = () => [window.__pad]; document.hasFocus = () => true;
    if (desk) {
      window.__bridge = { starts: [], stops: [], inputs: [] };
      const fns = { isDesktop: true, getSettings: async () => ({}), getUpdate: async () => null, setThrottle: () => { },
        getSources: async () => [{ id: 'screen:1:0', name: 'Tela 1', type: 'screen', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
        remoteCapable: async () => ({ ok: true, antiCheats: [], pad: true, window: false }),
        remoteStart: async (o) => { window.__bridge.starts.push(o); return { ok: true }; },
        remoteInput: (ev, id) => window.__bridge.inputs.push(...ev.map(e => ({ ...e, _id: id }))),
        remoteStop: (id) => window.__bridge.stops.push(id), onRemoteEvent: (cb) => { window.__remoteCb = cb; } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const toastOf = (p, re, ms = 5000) => p.waitForFunction((re) => new RegExp(re).test(document.getElementById('toast')?.textContent || ''), { timeout: ms }, re).then(() => true, () => false);
const chip = (P) => P.evaluate(() => document.getElementById('remote-chip')?.innerText.replace(/\s+/g, ' ').trim() || '');
const dlgRows = (P) => P.evaluate(() => [...document.querySelectorAll('.playersdlg .pl-row')].map(r => ({ cls: r.className, text: r.innerText.replace(/\s+/g, ' ').trim(), on: [...r.querySelectorAll('.pl-perm.on span')].map(s => s.textContent) })));
const rowOf = async (P, name) => (await dlgRows(P)).find(r => r.text.includes(name));
const togglePerm = (P, name, label) => P.evaluate((name, label) => { const r = [...document.querySelectorAll('.playersdlg .pl-row')].find(r => r.innerText.includes(name)); [...r.querySelectorAll('.pl-perm')].find(b => b.textContent.includes(label)).click(); }, name, label);
const rowBtn = (P, name, label) => P.evaluate((name, label) => { const r = [...document.querySelectorAll('.playersdlg .pl-row')].find(r => r.innerText.includes(name)); [...r.querySelectorAll('.btn')].find(b => b.textContent === label).click(); }, name, label);
const bridge = (A) => A.evaluate(() => JSON.parse(JSON.stringify(window.__bridge)));
const pressPad = async (P, on) => { await P.evaluate((on) => { window.__pad.buttons[0] = { pressed: on, value: on ? 1 : 0 }; }, on); await sleep(120); };
try {
  const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogo' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c, d]) await call(u.tok, 'POST', '/invites/' + code);
  const A = await page(a.tok, true), B = await page(b.tok), C = await page(c.tok), D = await page(d.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B, C, D]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  }
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /Transmitir/.test(x.textContent)).click());
  for (const P of [B, C]) {
    await P.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, a.id);
    await P.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
    await P.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"] video`)?.videoWidth > 0, { timeout: 15000 }, a.id);
    await P.evaluate((uid) => { window.__lc.S.focus = 's:' + uid; window.__lc.renderVoiceUI?.(); }, a.id);
  }
  await sleep(500);
  // ---------- um botão só ----------
  const menuItems = await B.evaluate(() => { document.querySelector('.sctl button[title="Mais opções"]')?.click(); const l = [...document.querySelectorAll('.menu .it')].map(x => x.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return l; });
  ok(menuItems.some(x => /Pedir para jogar/.test(x)) && !menuItems.some(x => /Pedir controle|Entrar como jogador/.test(x)), 'quem assiste tem um botão só: "Pedir para jogar"', menuItems.filter(x => /jogar|controle|jogador/i.test(x)));
  await sleep(300);
  // ---------- pedido ----------
  const askPlay = async (P) => { await P.evaluate(() => document.querySelector('.sctl button[aria-label="Pedir para jogar"]').click()); await sleep(300); await P.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Pedir para jogar')?.click()); };
  await askPlay(B);
  await A.waitForSelector('.playersdlg .pl-row.ask', { timeout: 5000 }).catch(() => { });
  const ask = await rowOf(A, 'bob');
  ok(ask && /ask/.test(ask.cls) && ask.on.join() === 'Controle', 'pedido abre a janela Jogadores no dono, já com só o Controle marcado', ask);
  const hostRow = (await dlgRows(A))[0];
  ok(/alice/.test(hostRow.text) && /P1/.test(hostRow.text) && /1\/4/.test(await A.evaluate(() => document.querySelector('.playersdlg h4')?.innerText || '')), 'o dono aparece como Player 1 (1/4)', hostRow.text);
  await A.screenshot({ path: `${SHOTS}/play-pedido.png` });
  await rowBtn(A, 'bob', 'Aceitar');
  await B.waitForFunction(() => /Player 2/.test(document.getElementById('remote-chip')?.innerText || ''), { timeout: 5000 }).catch(() => { });
  ok(/Player 2/.test(await chip(B)) && /Sair do jogo/.test(await chip(B)), 'bob vê "Player 2" e "Sair do jogo"', await chip(B));
  ok(await B.evaluate(() => [...document.querySelectorAll('#remote-chip .rperm')].map(i => i.classList.contains('on')).join()) === 'true,false,false', 'aviso do bob: Controle aceso, Teclado e Mouse apagados');
  const fps = () => A.evaluate(() => window.__lc.voice.screenOpts?.fps);
  await A.waitForFunction(() => window.__lc.voice.screenOpts?.fps === 60, { timeout: 5000 }).catch(() => { });
  ok(await fps() === 60, 'perfil de jogo: com o 1º jogador, a transmissão passa de 30 para 60 FPS', await fps());
  let br = await bridge(A);
  ok(br.starts.length === 1 && br.starts[0].kind === 'pad' && br.starts[0].slot === 2, 'app da alice liga só o controle virtual da vaga 2 (sem mouse/teclado)', br.starts);
  const bid = br.starts[0].id;
  // ---------- controle e isolamento ----------
  await pressPad(B, true); await pressPad(B, false);
  br = await bridge(A);
  ok(br.inputs.some(e => e.k === 'g' && e.b === 1 && e._id === bid), 'o controle do bob chega ao controle virtual dele', br.inputs.filter(e => e.k === 'g').length);
  const box = await B.evaluate((uid) => { const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`), r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, a.id);
  await B.mouse.click(box.x, box.y); await B.keyboard.press('KeyW'); await sleep(300);
  br = await bridge(A);
  ok(!br.inputs.some(e => e.k !== 'g'), 'sem permissão: clique e tecla do bob não chegam');
  // ---------- liberar teclado e mouse ----------
  await togglePerm(A, 'bob', 'Teclado'); await sleep(300); await togglePerm(A, 'bob', 'Mouse');
  ok(await toastOf(B, 'mudou suas permissões'), 'bob é avisado da mudança');
  await B.waitForFunction((uid) => document.querySelector(`.tile.screen[data-sid="${uid}"]`)?.classList.contains('controlling'), { timeout: 5000 }, a.id).catch(() => { });
  await sleep(400);
  br = await bridge(A);
  ok(br.starts.some(s => s.id === bid + ':kb' && s.kind === 'control' && s.perms.mouse && s.perms.keyboard), 'app da alice liga mouse e teclado numa entrada à parte', br.starts.at(-1));
  Object.assign(box, await B.evaluate((uid) => { const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`), r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, a.id)); // o quadro muda de lugar ao virar "controlando"
  await B.mouse.click(box.x, box.y); await B.keyboard.press('KeyW'); await sleep(400);
  br = await bridge(A);
  ok(br.inputs.some(e => e.k === 'd' && e._id === bid + ':kb') && br.inputs.some(e => e.k === 'kd' && e.c === 'KeyW' && e._id === bid + ':kb'), 'liberados: clique e tecla do bob chegam', br.inputs.filter(e => e.k !== 'g').map(e => e.k + (e._id === bid + ':kb' ? '@kb' : '@' + e._id)));
  await B.screenshot({ path: `${SHOTS}/play-jogador.png` });
  // ---------- painel Desempenho (os dois lados) ----------
  const openPerf = (P) => P.evaluate(() => { document.querySelector('.sctl button[title="Mais opções"]')?.click(); [...document.querySelectorAll('.menu .it')].find(x => /Desempenho/.test(x.textContent))?.click(); });
  await openPerf(B); await openPerf(A); await sleep(4500);
  const pv = (P) => P.evaluate(() => Object.fromEntries([...document.querySelectorAll('#perfpanel .pf-row')].map(r => [r.querySelector('.pf-l').textContent, [r.querySelector('.pf-v').textContent, r.querySelector('.pf-t').textContent]])));
  const pB = await pv(B), pA = await pv(A);
  ok(/ms/.test(pB['Ida e volta']?.[0] || '') && pB['Ida e volta'][1] === 'medido' && pB['Ida (até quem transmite)']?.[1] === 'estimado', 'painel de quem joga: ida e volta do comando (medido) e ida (estimado)', pB['Ida e volta']);
  ok(+pB['FPS exibidos']?.[0] > 0 && pB['Transporte']?.[0] && pB['Codificação']?.[1] === 'anfitrião', 'painel de quem joga: FPS exibidos, transporte e os números de quem transmite marcados como "anfitrião"', { fps: pB['FPS exibidos'], via: pB['Transporte'], enc: pB['Codificação'] });
  ok(/ms/.test(pA['P2 bob · comando']?.[0] || '') && pA['Caminho']?.[0] === 'Chromium' && +pA['FPS enviados']?.[0] > 0, 'painel de quem transmite: caminho, FPS enviados e o comando do Player 2', { cmd: pA['P2 bob · comando'], fps: pA['FPS enviados'] });
  ok(Object.values(pB).every(([v, t]) => v === '—' || ['medido', 'estimado', 'anfitrião'].includes(t)), 'todo número do painel diz a origem; sem dado, "—"');
  await B.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); [...document.querySelectorAll('#perfpanel .btn')].find(b => b.textContent === 'Copiar').click(); });
  await sleep(200);
  ok(/Resenha · Desempenho/.test(await B.evaluate(() => window.__copied || '')) && /Comando, ida e volta/.test(await B.evaluate(() => window.__copied || '')), 'Copiar: texto com as médias e o p95');
  const exp = await B.evaluate(() => new Promise((res) => { const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = o; fetch(this.href).then(r => r.json()).then(j => res({ name: this.download, n: j.amostras.length, resumo: Object.keys(j.resumo) })); }; [...document.querySelectorAll('#perfpanel .btn')].find(b => b.textContent === 'Exportar').click(); }));
  ok(/^resenha-desempenho-.*\.json$/.test(exp.name) && exp.n >= 3 && exp.resumo.includes('fpsShown'), 'Exportar: JSON com as amostras e o resumo', exp);
  await B.screenshot({ path: `${SHOTS}/play-painel-jogador.png` }); await A.screenshot({ path: `${SHOTS}/play-painel-anfitriao.png` });
  for (const P of [A, B]) await P.evaluate(() => document.querySelector('#perfpanel .pf-head button')?.click());
  // ---------- segundo jogador e o mouse para um só ----------
  await askPlay(C);
  await A.waitForFunction(() => [...document.querySelectorAll('.playersdlg .pl-row.ask')].some(r => /carol/.test(r.innerText)), { timeout: 5000 }).catch(() => { });
  await rowBtn(A, 'carol', 'Aceitar');
  await C.waitForFunction(() => /Player 3/.test(document.getElementById('remote-chip')?.innerText || ''), { timeout: 5000 }).catch(() => { });
  ok(/Player 3/.test(await chip(C)), 'carol entra como Player 3', await chip(C));
  await sleep(300); await togglePerm(A, 'carol', 'Mouse');
  ok(await toastOf(B, 'passou o mouse para outro jogador'), 'dar o mouse à carol tira do bob (e avisa)');
  await sleep(500);
  const rows = await dlgRows(A);
  ok((await rowOf(A, 'bob')).on.join() === 'Controle,Teclado' && (await rowOf(A, 'carol')).on.join() === 'Controle,Mouse', 'janela: bob com Controle e Teclado, carol com Controle e Mouse', rows.map(r => r.on));
  const n0 = (await bridge(A)).inputs.length;
  await B.mouse.click(box.x, box.y); await sleep(300);
  const cbox = await C.evaluate((uid) => { const v = document.querySelector(`.tile.screen[data-sid="${uid}"] video`), r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, a.id);
  await C.mouse.click(cbox.x, cbox.y); await sleep(400);
  br = await bridge(A); const after = br.inputs.slice(n0);
  const cid = br.starts.find(s => s.kind === 'pad' && s.slot === 3)?.id;
  ok(!after.some(e => e.k === 'd' && e._id === bid + ':kb') && after.some(e => e.k === 'd' && e._id === cid + ':kb'), 'só a carol clica agora', after.map(e => e.k + '@' + (e._id === cid + ':kb' ? 'carol' : 'bob')));
  // ---------- convite ----------
  await A.evaluate(() => { const r = [...document.querySelectorAll('.playersdlg .pl-row.watch')].find(r => /dave/.test(r.innerText)); [...r.querySelectorAll('.btn')].find(b => b.textContent === 'Convidar').click(); });
  await D.waitForFunction(() => /convidou você para jogar/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 5000 }).catch(() => { });
  ok(/alice convidou você para jogar/.test(await D.evaluate(() => document.querySelector('.modal')?.textContent || '')), 'dave recebe o convite');
  await D.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Jogar').click());
  await D.waitForFunction(() => /Player 4/.test(document.getElementById('remote-chip')?.innerText || ''), { timeout: 5000 }).catch(() => { });
  ok(/Player 4/.test(await chip(D)), 'dave aceita e entra como Player 4', await chip(D));
  await sleep(400);
  ok(/4\/4/.test(await A.evaluate(() => document.querySelector('.playersdlg h4')?.innerText || '')), 'janela mostra 4/4');
  await A.screenshot({ path: `${SHOTS}/play-janela.png` });
  // ---------- reconexão ----------
  await D.evaluate(() => window.__sockets.filter(s => s.readyState === 1).forEach(s => s.close()));
  await sleep(4000);
  await D.waitForFunction(() => /Player 4/.test(document.getElementById('remote-chip')?.innerText || ''), { timeout: 15000 }).catch(() => { });
  ok(/Player 4/.test(await chip(D)), 'dave cai a conexão e volta: continua Player 4', await chip(D));
  ok(!!(await rowOf(A, 'dave')), 'alice continua vendo o dave na janela');
  // ---------- revogar tudo ----------
  await A.evaluate(() => [...document.querySelectorAll('.playersdlg .btn')].find(b => b.textContent === 'Revogar tudo').click());
  await sleep(600);
  ok((await dlgRows(A)).slice(1).every(r => !r.on.length), 'Revogar tudo: ninguém com permissão (continuam na sessão)', (await dlgRows(A)).map(r => r.on));
  const n1 = (await bridge(A)).inputs.length; await pressPad(B, true); await pressPad(B, false); await B.keyboard.press('KeyW'); await sleep(300);
  ok((await bridge(A)).inputs.length === n1, 'depois de revogar, nada do bob chega');
  br = await bridge(A);
  ok([bid, bid + ':kb'].every(id => br.stops.includes(id)), 'o app da alice desliga o controle virtual e o mouse/teclado do bob', br.stops);
  // ---------- tirar e sair ----------
  await rowBtn(A, 'carol', 'Tirar');
  ok(await toastOf(C, 'tirou você do jogo'), 'carol é tirada e avisada');
  await B.evaluate(() => [...document.querySelectorAll('#remote-chip .btn')].find(b => b.textContent === 'Sair do jogo').click());
  ok(await toastOf(B, 'Você saiu do jogo'), 'bob sai pelo "Sair do jogo"');
  await sleep(500);
  ok((await dlgRows(A)).filter(r => /P\d/.test(r.text)).length === 2, 'na janela ficam a alice e o dave', (await dlgRows(A)).map(r => r.text.slice(0, 20)));
  ok(await fps() === 60, 'com um jogador ainda na sessão, continua a 60 FPS');
  await rowBtn(A, 'dave', 'Tirar');
  await A.waitForFunction(() => window.__lc.voice.screenOpts?.fps === 30, { timeout: 5000 }).catch(() => { });
  ok(await fps() === 30, 'o último saiu: a transmissão volta aos 30 FPS de antes', await fps());
  // ---------- parar de transmitir com alguém jogando ----------
  await A.evaluate(() => [...document.querySelectorAll('.playersdlg .pl-row.watch')].find(r => /dave/.test(r.innerText))?.querySelector('.btn')?.click());
  await D.waitForFunction(() => /convidou você/.test(document.querySelector('.modal')?.textContent || ''), { timeout: 5000 }).catch(() => { });
  await D.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Jogar')?.click());
  await D.waitForFunction(() => /Player/.test(document.getElementById('remote-chip')?.innerText || ''), { timeout: 5000 }).catch(() => { });
  await A.evaluate(() => window.__lc.voice.stopLocal?.('screen'));
  ok(await toastOf(D, 'parou de transmitir', 8000), 'alice para de transmitir: dave sai do jogo');
} catch (e) { console.log('  FAIL', e.stack || e.message); fails++; }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
