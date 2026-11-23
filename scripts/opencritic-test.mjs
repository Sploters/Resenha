// Nota da crítica (OpenCritic) no popup do jogo (server/opencritic.js + gameModal em public/activity.js) com um OpenCritic
// FALSO local: sem chave fica desligado; com chave acha o jogo pelo nome, guarda no banco (o 2º pedido não vai ao
// OpenCritic, nem depois de reiniciar), respeita a cota do dia, não confunde com outro jogo e o popup mostra a nota.
// Uso: node scripts/opencritic-test.mjs  (print em .testshots/opencritic)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
import { pickMatch, slimGame, nameKey } from '../server/opencritic.js';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const OUT = '.testshots/opencritic', PORT = 3461, MOCK = 4661, BASE = `http://localhost:${PORT}`, DATA = './.testdata-opencritic';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

// ---------- funções puras ----------
ok(nameKey('The Witcher® 3: Wild Hunt') === nameKey('the witcher 3 wild hunt'), 'nome normalizado ignora ®, pontuação e maiúsculas');
ok(pickMatch('Elden Ring', [{ id: 2, name: 'Elden Ring: Shadow of the Erdtree', dist: 0.3 }, { id: 1, name: 'ELDEN RING', dist: 0 }])?.id === 1, 'busca: escolhe o de nome igual');
ok(pickMatch('Hades', [{ id: 9, name: 'Hades II', dist: 0.2 }]) === null, 'busca: outro jogo (Hades II para Hades) não vale');
ok(slimGame({ id: 5, name: 'X', topCriticScore: -1 }) === null, 'jogo ainda sem nota (-1) não aparece');
ok(slimGame({ id: 5, name: 'X', topCriticScore: 90.6, percentRecommended: 97.2, tier: 'Mighty', numReviews: 120, url: 'https://evil.example/x' }).url === 'https://opencritic.com/', 'link só para o opencritic.com');

// ---------- OpenCritic falso ----------
const hits = []; let lastKey = null;
const GAMES = { 101: { id: 101, name: 'Estrela Cadente', topCriticScore: 91.4, percentRecommended: 96.5, tier: 'Mighty', numReviews: 143, url: 'https://opencritic.com/game/101/estrela-cadente' },
  102: { id: 102, name: 'Fazendinha Tranquila 2', topCriticScore: -1, tier: null, numReviews: 0 } };
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'); hits.push(u.pathname + u.search); lastKey = q.headers['x-rapidapi-key']; r.setHeader('content-type', 'application/json');
  if (u.pathname === '/game/search') { const c = (u.searchParams.get('criteria') || '').toLowerCase(); return r.end(JSON.stringify(Object.values(GAMES).filter(g => g.name.toLowerCase().includes(c.split(' ')[0])).map(g => ({ id: g.id, name: g.name, dist: g.name.toLowerCase() === c ? 0 : 0.4 })))); }
  const m = /^\/game\/(\d+)$/.exec(u.pathname); if (m && GAMES[m[1]]) return r.end(JSON.stringify(GAMES[m[1]]));
  r.statusCode = 404; r.end('{}');
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
let srv = null;
async function start(extra) {
  srv?.kill(); if (srv) await sleep(500);
  srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0', DISCOVER_OFF: '1', OPENCRITIC_API: `http://127.0.0.1:${MOCK}`, ...extra }, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(200); } }
}
const call = (tok, p) => fetch(BASE + '/api' + p, { headers: { authorization: 'Bearer ' + tok } }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  await start({ OPENCRITIC_KEY: '' });
  const tok = (await (await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ana', password: 'Teste.senha-123' }) })).json()).token;
  ok((await call('', '/critic?title=Estrela%20Cadente')).status === 401, 'precisa estar logado');
  const off = await call(tok, '/critic?title=Estrela%20Cadente');
  ok(off.status === 200 && off.score === undefined && hits.length === 0, 'sem OPENCRITIC_KEY: desligado, nada vai ao OpenCritic');

  await start({ OPENCRITIC_KEY: 'CHAVE-DE-TESTE', OPENCRITIC_DAILY: '5' });
  const c1 = await call(tok, '/critic?title=Estrela%20Cadente%E2%84%A2');
  ok(c1.score === 91 && c1.tier === 'Poderoso' && c1.pct === 97 && c1.reviews === 143 && c1.url === 'https://opencritic.com/game/101/estrela-cadente', 'acha o jogo pelo nome (sem o ™) com nota, selo, % e link', c1);
  ok(lastKey === 'CHAVE-DE-TESTE' && hits.length === 2, 'busca + jogo, com a chave no cabeçalho', hits);
  await call(tok, '/critic?title=estrela%20cadente');
  ok(hits.length === 2, 'mesmo jogo de novo: vem do banco, sem pedir ao OpenCritic');
  const none = await call(tok, '/critic?title=Fazendinha%20Tranquila%202');
  ok(none.score === undefined, 'jogo sem nota ainda: resposta vazia');
  const other = await call(tok, '/critic?title=Estrela');
  ok(other.score === undefined, 'nome que não é o do jogo: não mostra a nota de outro');
  const before = hits.length; await call(tok, '/critic?title=Jogo%20Qualquer%20Novo');
  ok(hits.length === before, 'cota do dia gasta (5): não pede mais ao OpenCritic', { before, now: hits.length });

  await start({ OPENCRITIC_KEY: 'CHAVE-DE-TESTE' });
  const n = hits.length, c2 = await call(tok, '/critic?title=Estrela%20Cadente');
  ok(c2.score === 91 && hits.length === n, 'depois de reiniciar o servidor continua guardado (sem novo pedido)');

  // ---------- popup do jogo ----------
  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1100, height: 800, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  await P.evaluate(async () => (await window.__lc.import('activity.js')).gameModal({ game: { title: 'Estrela Cadente' }, platform: 'pc', since: Date.now() }));
  ok(await P.waitForSelector('.gamemodal .gm-oc', { timeout: 6000 }).then(() => true, () => false), 'popup do jogo mostra a nota do OpenCritic');
  const chip = await P.evaluate(() => { const a = document.querySelector('.gamemodal .gm-oc'); return { t: a.innerText.replace(/\n+/g, ' | '), href: a.href, cls: a.className }; });
  ok(/91/.test(chip.t) && /OpenCritic · Poderoso/.test(chip.t) && /97% dos críticos recomendam/.test(chip.t) && chip.href === 'https://opencritic.com/game/101/estrela-cadente' && /oc-mighty/.test(chip.cls), 'nota, selo, % e link para o OpenCritic', chip);
  await (await P.$('.gamemodal')).screenshot({ path: OUT + '/01-popup-opencritic.png' });
  await P.keyboard.press('Escape'); await sleep(200);
  await P.evaluate(async () => (await window.__lc.import('activity.js')).gameModal({ game: { title: 'Fazendinha Tranquila 2' }, platform: 'pc', since: Date.now() }));
  await sleep(1200);
  ok(await P.evaluate(() => !!document.querySelector('.gamemodal') && !document.querySelector('.gamemodal .gm-oc')), 'jogo sem nota: o popup abre sem o bloco');
} finally {
  await browser.close(); srv?.kill(); mock.close(); await sleep(300); fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo'); process.exit(fails ? 1 : 0);
