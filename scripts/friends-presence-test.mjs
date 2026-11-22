// Presença dos amigos na lista de Amigos e o aviso "também está jogando" (public/home.js, public/activity.js).
// alice (eu) + bruno (em chamada, jogando VALORANT), carla (jogando Minecraft fora de chamada), dani (online, parada).
// 1) lista de Amigos: cada amigo mostra o que joga e a sala em que está, com "Entrar" (como no Discord: "Jogando X")
// 2) alice abre o VALORANT: aviso "bruno já está jogando VALORANT · Geral · Turma" com Entrar na sala
// 3) alice na sala; dani abre o VALORANT: aviso "dani começou a jogar VALORANT" com Chamar para a call (convite)
// 4) o mesmo amigo no mesmo jogo não avisa de novo; "Não avisar" desliga (S.prefs.sameGameAlert = false)
// Uso: BROWSER=/caminho/do/chrome node scripts/friends-presence-test.mjs   (SHOTS=pasta salva as capturas em 2x)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3366), RTC_PORT = +(process.env.RTC_PORT || 41366), DATA = process.env.DATA_DIR || './.testdata-fpres', BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', SHOTS = process.env.SHOTS || '';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; };
fs.rmSync(DATA, { recursive: true, force: true }); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT, RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name, display) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', { display_name: display }); return { tok: r.token, id: me.id, name }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const GAMES = { val: { id: 'valorant-win64-shipping', title: 'VALORANT' }, mc: { id: 'minecraft', title: 'Minecraft' } };
async function page(u, game, vp = { width: 1440, height: 860 }) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ ...vp, deviceScaleFactor: SHOTS ? 2 : 1 });
  p.on('pageerror', e => { console.log('  PAGEERROR', u.name, e.message); fails++; });
  await p.evaluateOnNewDocument((t, g) => {
    localStorage.lc_token = t; window.__game = g; window.__gc = [];
    // app desktop simulado: o jogo aberto é window.__game; window.__setGame(g) troca e avisa na hora (onGameChanged)
    window.lcDesktop = { isDesktop: true, detectGame: async () => window.__game, onGameChanged: (f) => window.__gc.push(f), setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } };
    window.__setGame = (x) => { window.__game = x; for (const f of window.__gc) f(); };
  }, u.tok, game || null);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const shot = async (P, name) => { await sleep(600); if (SHOTS) await P.screenshot({ path: `${SHOTS}/${name.replace('TAG', process.env.SHOT_TAG || 'depois')}.png` }); };
const rowsText = (P) => P.evaluate(() => [...document.querySelectorAll('#home .pane .frow')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
const rowOf = (P, name) => P.evaluate((n) => { const r = [...document.querySelectorAll('#home .pane .frow')].find(x => x.querySelector('.fn-top b')?.textContent === n); return r ? r.innerText.replace(/\s+/g, ' ').trim() : null; }, name);
const banner = (P) => P.evaluate(() => { const b = document.getElementById('samegame-banner'); return b ? b.innerText.replace(/\s+/g, ' ').trim() : null; });
const clickIn = (P, sel, label) => P.evaluate((s, l) => { const b = [...document.querySelectorAll(s + ' button')].find(x => x.textContent.trim() === l); if (b) b.click(); return !!b; }, sel, label);

try {
  const alice = await reg('alice', 'Alice'), bruno = await reg('bruno', 'Bruno'), carla = await reg('carla', 'Carla'), dani = await reg('dani', 'Beatriz');
  for (const o of [bruno, carla, dani]) { await call(alice.tok, 'POST', '/relationships', { username: o.name }); await call(o.tok, 'PUT', '/relationships/' + alice.id, {}); }
  const g = await call(alice.tok, 'POST', '/guilds', { name: 'Turma' }), code = (await call(alice.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const o of [bruno, carla, dani]) await call(o.tok, 'POST', '/invites/' + code);
  const B = await page(bruno, GAMES.val), C = await page(carla, GAMES.mc), D = await page(dani);
  const vch = await B.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
  await B.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.joinVoice(cid); }, g.id, vch.id);
  ok(await waitFor(() => B.evaluate(() => !!window.__lc.voice.active), 10000), 'bruno entra na sala de voz');
  const A = await page(alice, null, { width: 1180, height: 760 }); // janela média: o "Ativo agora" vira gaveta e a lista é o que se vê
  await A.evaluate(() => window.__lc.go('@me')); await sleep(800);
  ok(await waitFor(() => A.evaluate((b, c) => { const s = window.__lc.S, has = (id) => [...s.activities.values()].some(a => a.user_id === id); return has(b) && has(c) && s.voice.has(b); }, bruno.id, carla.id), 8000), 'alice recebe a atividade e a sala dos amigos');
  await sleep(1500);

  // ---- 1) lista de Amigos com presença ----
  ok(await waitFor(async () => /Jogando VALORANT/.test(await rowOf(A, 'Bruno') || '')), 'linha do Bruno: "Jogando VALORANT"', await rowOf(A, 'Bruno'));
  ok(/Geral · Turma/.test(await rowOf(A, 'Bruno') || '') && /Entrar/.test(await rowOf(A, 'Bruno') || ''), 'linha do Bruno: a sala (Geral · Turma) e o botão Entrar', await rowOf(A, 'Bruno'));
  ok(/Jogando Minecraft/.test(await rowOf(A, 'Carla') || '') && !/Entrar/.test(await rowOf(A, 'Carla') || ''), 'linha da Carla: "Jogando Minecraft", sem Entrar (não está em chamada)', await rowOf(A, 'Carla'));
  ok(/Online/.test(await rowOf(A, 'Beatriz') || ''), 'linha da Beatriz: só o status', await rowOf(A, 'Beatriz'));
  const order = (await rowsText(A)).map(t => t.split(' ')[0]);
  ok(order.indexOf('Bruno') < order.indexOf('Beatriz') && order.indexOf('Carla') < order.indexOf('Beatriz'), 'quem está jogando/em chamada vem antes de quem está parado', order);
  await shot(A, '01-TAG-lista-amigos');

  // ---- 2) alice abre o VALORANT: Bruno já está nele, numa sala ----
  await A.evaluate((g) => window.__setGame(g), GAMES.val);
  ok(await waitFor(async () => /Bruno/.test(await banner(A) || ''), 25000), 'aviso: Bruno também está jogando VALORANT', await banner(A));
  const b1 = await banner(A) || '';
  ok(/VALORANT/.test(b1) && /Geral · Turma/.test(b1) && /Entrar na sala/.test(b1), 'aviso mostra a sala e "Entrar na sala"', b1);
  ok(!/Carla/.test(b1), 'quem joga outro jogo (Carla, Minecraft) não entra no aviso', b1);
  await shot(A, '02-TAG-aviso-ja-jogando');
  const bB = await B.evaluate(() => document.getElementById('samegame-banner')?.innerText.replace(/\s+/g, ' ') || null);
  ok(/Alice começou a jogar VALORANT/.test(bB || '') && /Chamar para a call/.test(bB || ''), 'do outro lado, o Bruno (na sala) é avisado e pode chamar a Alice', bB);
  ok(await clickIn(A, '#samegame-banner', 'Entrar na sala'), 'alice clica em Entrar na sala');
  ok(await waitFor(() => A.evaluate((cid) => window.__lc.voice.active && window.__lc.voice.channelId === cid, vch.id), 10000), 'alice entra na sala do Bruno');
  ok(!(await banner(A)), 'o aviso some ao entrar');

  // ---- 3) alice na sala; dani abre o VALORANT ----
  await D.evaluate((g) => window.__setGame(g), GAMES.val);
  ok(await waitFor(async () => /Beatriz/.test(await banner(A) || ''), 25000), 'aviso: Beatriz começou a jogar VALORANT', await banner(A));
  const b2 = await banner(A) || '';
  ok(/começou a jogar VALORANT/.test(b2) && /Chamar para a call/.test(b2), 'aviso oferece "Chamar para a call" (alice está numa sala, Beatriz não)', b2);
  await shot(A, '03-TAG-aviso-comecou');
  ok(await clickIn(A, '#samegame-banner', 'Chamar para a call'), 'alice chama a Beatriz');
  ok(await waitFor(() => D.evaluate(() => !!document.getElementById('call-banner'))), 'Beatriz recebe o convite para a chamada');

  // ---- 4) sem repetição; "Não avisar" desliga ----
  const sees = (uid) => A.evaluate((id) => [...window.__lc.S.activities.values()].some(a => a.user_id === id), uid);
  await A.evaluate(() => document.getElementById('samegame-banner')?.remove());
  await sleep(3200); await D.evaluate(() => window.__setGame(null));
  ok(await waitFor(async () => !(await sees(dani.id)), 25000), 'Beatriz fecha o jogo');
  await sleep(3200); await D.evaluate((g) => window.__setGame(g), GAMES.val);
  ok(await waitFor(() => sees(dani.id), 25000), 'e abre de novo'); await sleep(800);
  ok(!/Beatriz/.test(await banner(A) || ''), 'Beatriz fecha e abre o jogo: não avisa de novo (uma vez a cada 3 h por amigo e jogo)', await banner(A));
  await C.evaluate((g) => window.__setGame(g), GAMES.val);
  ok(await waitFor(async () => /Carla/.test(await banner(A) || ''), 25000), 'Carla troca para VALORANT: avisa', await banner(A));
  ok(await clickIn(A, '#samegame-banner', 'Não avisar'), '"Não avisar" no aviso');
  ok(await A.evaluate(() => window.__lc.S.prefs.sameGameAlert === false && !document.getElementById('samegame-banner')), 'desliga o aviso (fica na conta) e fecha');
  // o Bruno foi avisado de que a Alice abriu o VALORANT; ela entrou na sala dele, então o aviso dele já não tem razão de ser
  ok(!(await B.evaluate(() => /Alice/.test(document.getElementById('samegame-banner')?.innerText || ''))), 'o aviso do Bruno sobre a Alice some quando ela entra na sala dele');
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo'); process.exit(fails ? 1 : 0);
