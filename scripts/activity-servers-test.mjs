// "Ativo agora" → "Nos seus servidores": quem divide servidor com você (sem ser amigo) e está jogando ou em chamada, e
// "Talvez você conheça" para quem joga o mesmo que você/um amigo ou está na mesma sala, com Adicionar e "não sugerir".
// Uso: BROWSER=/caminho/do/chrome node scripts/activity-servers-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3422, BASE = `http://localhost:${PORT}`, DATA = '.testdata-actsrv';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41161', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const mk = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-12345' }); return { n, tok: r.token }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const open = async (u) => {
  const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1500, height: 1000 });
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 20000 }); u.id = await p.evaluate(() => window.__lc.S.me.id); u.p = p; return p;
};
try {
  const all = await Promise.all(['ana', 'beto', 'caio', 'duda', 'eva', 'gil'].map(mk)); const [ana, beto, caio, duda, eva, gil] = all;
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Galera' }); const code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of all) await open(u);
  for (const u of [beto, caio, duda, eva]) await call(u.tok, 'POST', '/invites/' + code); // gil não está no servidor
  await call(ana.tok, 'POST', '/relationships', { username: 'beto' }); await call(beto.tok, 'PUT', '/relationships/' + ana.id, {});
  await call(eva.tok, 'PATCH', '/activity/pc', { visibility: 'friends' }); // eva só mostra o jogo para amigos
  await sleep(800);
  const vc = await duda.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  const game = (u, id, title) => u.p.evaluate((id, title) => window.__lc.voice.send('ACTIVITY_LOCAL', { game: id ? { id, title } : null }), id, title);
  await game(beto, 'valorant', 'VALORANT'); await game(caio, 'valorant', 'VALORANT'); await game(eva, 'lol', 'League of Legends'); await game(gil, 'valorant', 'VALORANT');
  await duda.p.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc);
  await sleep(2500);
  await ana.p.evaluate(() => window.__lc.go('@me')); await sleep(1500);
  const view = () => ana.p.evaluate(() => {
    const t = (e, s) => e?.querySelector(s)?.textContent.trim();
    return {
      caps: [...document.querySelectorAll('#actfeed .an-now .an-cap')].map(e => e.textContent.trim()),
      sugs: [...document.querySelectorAll('#actfeed .an-sug')].map(e => ({ name: t(e, '.an-who b'), why: t(e, '.an-who > small'), btn: t(e, '.an-addbtn, .an-sent') })),
      rows: [...document.querySelectorAll('#actfeed .an-row.an-srv')].map(e => ({ name: t(e, '.an-who b'), sub: t(e, '.an-sub > span:last-child'), add: !!e.querySelector('.ibtn-add'), sent: !!e.querySelector('.an-sent') })),
    };
  });
  let v = await view();
  ok(v.caps.some(c => /^Nos seus servidores — 2$/.test(c)), 'seção "Nos seus servidores" com caio (jogando) e duda (em chamada)', v.caps);
  ok(v.sugs.length === 1 && v.sugs[0].name === 'caio' && /VALORANT, como beto/.test(v.sugs[0].why), 'caio joga VALORANT como o amigo beto: "Talvez você conheça"', v.sugs);
  ok(v.rows.length === 1 && v.rows[0].name === 'duda' && /Geral · Galera/.test(v.rows[0].sub) && v.rows[0].add, 'duda em chamada aparece na lista, com botão de adicionar', v.rows);
  ok(![...v.sugs, ...v.rows].some(x => x.name === 'eva' || x.name === 'gil' || x.name === 'beto'), 'eva (jogo só para amigos), gil (outro servidor) e beto (amigo, já em cima) não aparecem aqui');
  if (process.env.SHOTS) { fs.mkdirSync('.testshots', { recursive: true }); await (await ana.p.$('#active-now')).screenshot({ path: '.testshots/activity-servers-sug.png' }); }
  // Adicionar
  await ana.p.evaluate(() => document.querySelector('#actfeed .an-sug .an-addbtn').click()); await sleep(1200);
  v = await view();
  const c = v.rows.find(x => x.name === 'caio');
  ok(!v.sugs.length && c?.sent && !c.add && c.sub === 'Jogando VALORANT', 'Adicionar: caio sai das sugestões e fica na lista com "pedido enviado"', v);
  ok(await caio.p.evaluate((id) => window.__lc.S.rels.get(id)?.type, ana.id) === 3, 'caio recebeu o pedido de amizade');
  // não sugerir duda (vira sugestão quando ana entra na mesma sala)
  await ana.p.evaluate((gid, cid) => window.__lc.voice.join(cid), g.id, vc); await sleep(2000);
  await ana.p.evaluate(() => window.__lc.go('@me')); await sleep(1000);
  v = await view();
  const d = v.sugs.find(x => x.name === 'duda');
  ok(d && d.why === 'Na mesma chamada que você', 'ana entrou na sala da duda: duda vira sugestão', v.sugs);
  await ana.p.evaluate(() => [...document.querySelectorAll('#actfeed .an-sug')].find(e => e.querySelector('.an-who b').textContent === 'duda').querySelector('.an-sugx').click()); await sleep(400);
  v = await view();
  ok(!v.sugs.some(x => x.name === 'duda') && v.rows.some(x => x.name === 'duda'), '× tira duda das sugestões (continua na lista)', v);
  ok(await ana.p.evaluate((id) => !!window.__lc.S.prefs.anSugHide?.[id], duda.id), '"não sugerir" fica salvo na conta');
  // recolher a seção
  await ana.p.evaluate(() => document.querySelector('#actfeed .an-capbtn').click()); await sleep(300);
  v = await view();
  ok(!v.rows.length && !v.sugs.length && v.caps.some(c => /Nos seus servidores/.test(c)), 'seção recolhe e fica só o título', v);
  await ana.p.evaluate(() => document.querySelector('#actfeed .an-capbtn').click()); await sleep(300);
  if (process.env.SHOTS) { fs.mkdirSync('.testshots', { recursive: true }); const b = await ana.p.$('#active-now'); await b.screenshot({ path: '.testshots/activity-servers.png' }); }
  const errs = all.flatMap(u => u.p.errors);
  ok(!errs.length, 'sem erros na página', errs);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
