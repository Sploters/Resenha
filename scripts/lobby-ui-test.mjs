// "Times e fila" e "Retomar de onde parou" no app: 3 pessoas na call (lobby de 2 vagas, a 3ª fica na fila, a vez chega
// quando alguém passa), sorteio de times com mapa, e a barra que leva à 1ª mensagem não lida depois de 80 mensagens.
// Uso: node scripts/lobby-ui-test.mjs   (capturas em .testshots/lobby; BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3263, BASE = `http://localhost:${PORT}`, OUT = '.testshots/lobby', DIR = './.testdata-lobby';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41060', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, name: n }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
async function page(u) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERR', u.name, e.message));
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 }); await watchToasts(p); return p;
}
// avisos (toast) que apareceram na tela: um só fica visível por vez, então guarda cada um
const watchToasts = (p) => p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.dataset.seen) { el.dataset.seen = '1'; window.__toasts.push(el.textContent); } }).observe(document.body, { childList: true }); });
const toasts = (p) => p.evaluate(() => window.__toasts || []);
try {
  const A = await reg('ana'), B = await reg('beto'), C = await reg('caio');
  const g = await call(A.tok, 'POST', '/guilds', { name: 'Turma do CS' });
  const code = (await call(A.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [B, C]) await call(u.tok, 'POST', '/invites/' + code);
  const full = await call(A.tok, 'GET', `/guilds/${g.id}`).catch(() => null);
  const pa = await page(A), pb = await page(B), pc = await page(C);
  const vch = await pa.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  const txt = await pa.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  void full;

  // ---------- Retomar de onde parou ----------
  await pa.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, txt.id); await sleep(800);
  await call(A.tok, 'POST', `/channels/${txt.id}/messages`, { content: 'última que a Ana viu' });
  await pa.evaluate(() => window.__lc.go('@me')); await sleep(500);
  { // 80 mensagens do Beto direto no banco (pela API o limite de envio segura em 5)
    const { DatabaseSync } = await import('node:sqlite'), db = new DatabaseSync(DIR + '/resenha.db');
    const last = db.prepare('SELECT MAX(id) m FROM messages WHERE channel_id=?').get(txt.id).m, t0 = Date.now() - 3600e3;
    const ins = db.prepare("INSERT INTO messages(id, channel_id, author_id, content, created_at, attachments) VALUES(?,?,?,?,?, '[]')");
    for (let i = 1; i <= 80; i++) ins.run(String(BigInt(last) + BigInt(i * 1000)), txt.id, B.id, `mensagem ${i}`, t0 + i * 1000);
    db.close();
  }
  await sleep(600);
  await pa.reload(); await pa.waitForSelector('#rail .rail-wrap'); await watchToasts(pa); await sleep(800); // como quem volta dias depois: vem do READY
  const un = await pa.evaluate((cid) => window.__lc.S.unread[cid], txt.id);
  ok(un?.count === 80 && !!un.first_id && !!un.first_at, 'READY traz a 1ª não lida e a hora dela', un);
  await pa.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, txt.id); await sleep(1200);
  const bar = await pa.$eval('#resume-bar', e => e.textContent).catch(() => null);
  ok(/80 mensagens novas desde hoje às/.test(bar || ''), 'barra "Retomar de onde parou" aparece', bar);
  await pa.screenshot({ path: `${OUT}/01-retomar-barra.png` });
  await pa.evaluate(() => [...document.querySelectorAll('#resume-bar button')].find(b => /Retomar/.test(b.textContent)).click()); await sleep(1200);
  const at = await pa.evaluate(() => { const box = document.querySelector('#msgs'), sep = box.querySelector('.newsep'), next = sep?.nextElementSibling; const r = sep?.getBoundingClientRect(), br = box.getBoundingClientRect(); return { sep: !!sep, first: next?.textContent.includes('mensagem 1') && !next?.textContent.includes('mensagem 10'), visible: !!r && r.top >= br.top && r.bottom <= br.bottom, bar: !!document.querySelector('#resume-bar') }; });
  ok(at.sep && at.first && at.visible && !at.bar, 'pulou para a linha "Novas", antes da "mensagem 1"', at);
  await pa.screenshot({ path: `${OUT}/02-retomar-novas.png` });

  // ---------- Times e fila ----------
  for (const p of [pa, pb, pc]) {
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(400);
    await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await p.waitForFunction(() => window.__lc.voice?.active, { timeout: 20000 }); await sleep(700);
  }
  const lobbyMod = await pa.evaluate(() => window.__lc.import('lobby.js').then(m => !!m.openLobby));
  ok(lobbyMod, 'módulo do lobby carrega');
  await pa.evaluate(() => window.__lc.import('lobby.js').then(m => m.openLobby())); await sleep(500);
  await pa.evaluate(() => { const i = document.querySelector('.lobby-box .lb-game'); i.value = 'Counter-Strike 2'; i.dispatchEvent(new Event('input')); });
  await pa.evaluate(() => document.querySelector('.lb-slots button[title="Menos vagas"]').click()); // 5 → 4
  for (let i = 0; i < 2; i++) await pa.evaluate(() => document.querySelector('.lb-slots button[title="Menos vagas"]').click()); // → 2
  await pa.screenshot({ path: `${OUT}/03-abrir.png` });
  await pa.evaluate(() => [...document.querySelectorAll('.lobby-box .btn')].find(b => /Abrir lobby/.test(b.textContent)).click()); await sleep(800);
  const l1 = await pc.evaluate(() => window.__lc.S.room?.lobby);
  ok(l1?.slots === 2 && l1.playing.length === 2 && l1.queue.length === 1, 'lobby de 2 vagas: 2 jogando, 1 na fila (todo mundo vê)', l1);
  const third = l1.queue[0], p3 = [pa, pb, pc][[A.id, B.id, C.id].indexOf(third)], passer = l1.playing.find(x => x !== A.id) || l1.playing[0];
  const pPass = [pa, pb, pc][[A.id, B.id, C.id].indexOf(passer)];
  await pa.screenshot({ path: `${OUT}/04-lobby.png` });
  await pPass.evaluate(() => window.__lc.import('lobby.js').then(m => m.openLobby())); await sleep(400);
  await pPass.evaluate(() => [...document.querySelectorAll('.lobby-box .btn')].find(b => /Passar a vez/.test(b.textContent)).click()); await sleep(900);
  const l2 = await pa.evaluate(() => window.__lc.S.room?.lobby), t3 = await toasts(p3);
  ok(l2.playing.includes(third) && l2.queue[0] === passer, 'passar a vez: o da fila entra e quem passou vai para a fila', l2);
  ok(t3.some(t => /Sua vez/.test(t)), 'quem estava na fila recebe "Sua vez!"', t3);
  ok((await toasts(pPass)).some(t => /próximo da fila/.test(t)), 'quem passou vê "Você é o próximo"');
  await pa.screenshot({ path: `${OUT}/05-depois-de-passar.png` });
  // sorteio de times com a call toda (3 pessoas) e mapa do CS2
  await pa.evaluate(() => [...document.querySelectorAll('.lb-opts .seg button')].find(b => /call toda/.test(b.textContent)).click());
  await pa.evaluate(() => [...document.querySelectorAll('.lb-opts .btn')].find(b => /Sortear times/.test(b.textContent)).click()); await sleep(900);
  const T = await pb.evaluate(() => window.__lc.S.room?.lobby?.teams);
  ok(T && T.a.length + T.b.length === 3 && !!T.map, 'times sorteados com mapa', T && { a: T.a.length, b: T.b.length, map: T.map });
  ok((await toasts(pb)).some(t => /sorteou os times/.test(t)) || (await toasts(pc)).some(t => /sorteou os times/.test(t)), 'os outros recebem o aviso dos times');
  await pa.evaluate(() => [...document.querySelectorAll('.lb-teams .btn')].find(b => /Time A venceu/.test(b.textContent)).click()); await sleep(700);
  const T2 = await pa.evaluate(() => window.__lc.S.room?.lobby);
  ok(T2.teams.result === 'a' && Object.values(T2.stats).some(s => s.g === 1), 'resultado marcado e contado', T2.stats);
  await pa.screenshot({ path: `${OUT}/06-times.png` });
  // quem sai da call: a fila anda
  const before = await pa.evaluate(() => window.__lc.S.room?.lobby);
  const leaver = before.playing.find(x => x !== A.id); const pl = [pa, pb, pc][[A.id, B.id, C.id].indexOf(leaver)];
  await pl.evaluate(() => window.__lc.voice.leave()); await sleep(1200);
  const l3 = await pa.evaluate(() => window.__lc.S.room?.lobby);
  ok(!l3.playing.includes(leaver) && l3.playing.length === 2 && l3.queue.length === 0, 'saiu da call: o próximo da fila sobe', l3);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
