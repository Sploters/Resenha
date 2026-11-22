// "Desde a última vez" de ponta a ponta com dados REAIS, sem interceptar nada: duas sessões de voz de verdade (ana e beto;
// depois ana, beto e dani, que fica invisível e vira "+1") e a Home de caio, que não estava. Confere a faixa na tela larga e
// na gaveta da tela estreita (com o ponto no botão), sem "Tudo quieto por aqui…" junto, dispensar com 1 POST /seen e a
// faixa não voltar ao recarregar. Pega a corrida em que o painel montado 2 vezes perdia a resposta de /activity/since.
// Uso: node scripts/memory-real-test.mjs   (PORT, RTC_PORT, DATA_DIR mudam as portas e a pasta; SHOTS=pasta salva capturas)
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3730), RTC_PORT = +(process.env.RTC_PORT || 41730), DATA = process.env.DATA_DIR || './.testdata-memreal', BASE = `http://localhost:${PORT}`, OUT = process.env.SHOTS || '';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); if (OUT) fs.mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: String(RTC_PORT), RTC_IPS: '127.0.0.1', HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101', VOICE_SESSION_MIN_MS: '2000', VOICE_SESSION_GRACE_MS: '1000' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const reg = async (n, d) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', { display_name: d }); return { tok: r.token, id: me.id, n }; };
const connect = (u) => new Promise((res) => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + u.tok); ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') { ws.ready = m.d; res(ws); } }); });
const ana = await reg('ana', 'Ana'), beto = await reg('beto', 'Beto'), caio = await reg('caio', 'Caio'), dani = await reg('dani', 'Dani');
const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const o of [beto, caio, dani]) await call(o.tok, 'POST', '/invites/' + code);
const wsA = await connect(ana), wsB = await connect(beto), wsD = await connect(dani);
const vch = wsA.ready.guilds.find(x => x.id === g.id).channels.find(c => c.type === 2);
const join = (ws) => ws.send(JSON.stringify({ t: 'VOICE_JOIN', d: { channel_id: vch.id } })), leave = (ws) => ws.send(JSON.stringify({ t: 'VOICE_LEAVE', d: {} }));
// sessão 1: ana e beto; sessão 2: ana, beto e dani (dani fica invisível depois: vira "+1")
join(wsA); await sleep(200); join(wsB); await sleep(3500); leave(wsB); leave(wsA); await sleep(2000);
join(wsA); await sleep(200); join(wsB); join(wsD); await sleep(3500); leave(wsD); leave(wsB); leave(wsA); await sleep(2000);
await call(dani.tok, 'PATCH', '/me', { status: 'invisible' });
const api = await call(caio.tok, 'GET', '/activity/since');
ok(api.items?.filter(x => x.type === 'session').length === 2 && api.items[0].hidden === 1, 'API: 2 sessões, a mais recente com +1 (dani invisível)', api.items?.map(x => [x.type, x.members?.length, x.hidden]));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const res = {};
for (const [name, vp] of [['estreita', { width: 700, height: 860 }], ['larga', { width: 1440, height: 860 }]]) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ ...vp, deviceScaleFactor: OUT ? 2 : 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); const posts = []; p.on('request', r => { if (r.url().includes('/activity/seen')) posts.push(r.method()); });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, caio.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  if (name === 'estreita') { await sleep(1500); res.dot = await p.evaluate(() => !!document.querySelector('#home .an-toggle.an-new')); await p.click('#home .an-toggle'); }
  await p.waitForSelector('.an-since', { timeout: 10000 }).catch(() => { });
  await sleep(900);
  res[name] = await p.evaluate(() => [...document.querySelectorAll('.an-since .an-si')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  if (OUT) await p.screenshot({ path: `${OUT}/real-${name}.png` });
  res['quiet_' + name] = await p.evaluate(() => !!document.querySelector('.an-empty'));
  if (name === 'larga') {
    if (await p.$('.an-sincex')) await p.click('.an-sincex'); await sleep(800);
    res.dismiss = { posts, gone: await p.evaluate(() => !document.querySelector('.an-since')) };
    await p.reload(); await p.waitForSelector('#rail .rail-wrap'); await sleep(2500);
    res.afterReload = await p.evaluate(() => !!document.querySelector('.an-since'));
  }
  res['errs_' + name] = errs; await ctx.close();
}
await browser.close();
const sess = (l) => (l || []).filter(t => /ficaram .* na Geral/.test(t));
ok(sess(res.larga).length === 2 && /^Ana, Beto e \+1 ficaram/.test(res.larga[0]) && /^Ana e Beto ficaram/.test(res.larga[1]), 'tela larga: faixa com as 2 sessões reais (sem interceptar)', res.larga);
ok(res.larga?.every(t => t.includes('Entrar na sala')), 'cada sessão com "Entrar na sala"');
ok(sess(res.estreita).length === 2 && res.dot === true, 'tela estreita: faixa na gaveta e ponto no botão', { dot: res.dot, n: res.estreita?.length });
ok(!res.quiet_larga && !res.quiet_estreita, 'sem "Tudo quieto por aqui…" junto com a faixa');
ok(res.dismiss?.posts.length === 1 && res.dismiss.gone, 'dispensar: 1 POST /activity/seen e a faixa some', res.dismiss);
ok(res.afterReload === false, 'recarregar: a faixa não volta (visto vale no servidor)');
ok(!res.errs_larga.length && !res.errs_estreita.length, 'nenhum erro de JS', [...res.errs_larga, ...res.errs_estreita]);
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} FALHA(S)` : '\nMEMÓRIA REAL OK'); process.exit(fails ? 1 : 0);
