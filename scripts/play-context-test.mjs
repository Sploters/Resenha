// Jogos onde se usa: anúncio de "procurando grupo" no topo dos canais do servidor e no Ativo agora (com Pedir/Entrar),
// botão "Jogar juntos" na conversa direta (jogos em comum e anúncios da pessoa) e a barra com um botão principal só.
// Uso: node scripts/play-context-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3419, BASE = `http://localhost:${PORT}`, DATA = './.testdata-playctx';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0', HEALTH_DISK_PCT: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const eu = await reg('eu'), ana = await reg('ana');
await call(eu.tok, 'POST', '/relationships', { username: 'ana' }); await call(ana.tok, 'PUT', '/relationships/' + eu.id, {});
const g = await call(eu.tok, 'POST', '/guilds', { name: 'Turma' }), code = (await call(eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
await call(ana.tok, 'POST', '/invites/' + code);
await call(ana.tok, 'PUT', '/lfg/profile/valorant', { ign: 'ana#BR1' }); await call(eu.tok, 'PUT', '/lfg/profile/valorant', { ign: 'eu#BR1' });
const dm = await call(eu.tok, 'POST', '/dms', { user_id: ana.id });
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await (await browser.createBrowserContext()).newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; localStorage.lc_seen_changelog = '9999'; }, eu.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); await sleep(1200);
  ok(await p.evaluate(() => document.querySelectorAll('#rail > .rail-wrap.rail-fly').length === 2 && !document.querySelector('#rail .rail-games')), 'barra: um botão principal e a busca, sem botão de Jogos');
  // anúncio publicado com o app aberto: chega pelo evento
  const ad = await call(ana.tok, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Competitivo', slots: 2, rank_min: '', rank_max: '', roles: [] });
  ok(!!ad.id, 'ana publica um anúncio', ad);
  await p.evaluate(() => window.__lc.go('@me')); await sleep(1200);
  const an = await p.evaluate(() => ({ cap: document.querySelector('#active-now .an-lfg .an-cap')?.textContent, card: document.querySelector('#active-now .an-lfg .lfgm')?.innerText.replace(/\s+/g, ' ') }));
  ok(/Procurando grupo/.test(an.cap || '') && /Valorant/.test(an.card || '') && /ana procura 2/.test(an.card || ''), 'Ativo agora mostra o anúncio de quem procura grupo', an);
  await p.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(1000);
  const side = await p.evaluate(() => document.querySelector('#side-list .side-lfg')?.innerText.replace(/\s+/g, ' '));
  ok(/Procurando grupo/i.test(side || '') && /Valorant/.test(side || ''), 'servidor: anúncio no topo dos canais', side);
  await p.evaluate(() => document.querySelector('#side-list .side-lfg .lfgm .btn')?.click()); await sleep(1000);
  ok(await p.evaluate(() => /Pedido enviado/.test(document.querySelector('#side-list .side-lfg .lfgm')?.textContent || '')), 'Pedir direto do servidor: o cartão vira "Pedido enviado"');
  const reqs = (await call(ana.tok, 'GET', '/lfg/posts')).find(x => x.id === ad.id)?.requests || [];
  ok(reqs.some(r => r.user.id === eu.id && r.state === 'pending'), 'a ana recebe o pedido', reqs);
  // DM: Jogar juntos
  await p.evaluate((id) => window.__lc.go('@me', id), dm.id); await sleep(900);
  ok(await p.evaluate(() => !!document.querySelector('#topbar .pt-btn')), 'DM tem o botão "Jogar juntos"');
  await p.evaluate(() => document.querySelector('#topbar .pt-btn').click()); await sleep(1500);
  const pt = await p.evaluate(() => ({ games: [...document.querySelectorAll('.pt-games .lchip')].map(x => x.textContent), ads: document.querySelectorAll('.pt-ads .lfgm').length, invite: document.querySelector('.pt-acts .btn.green')?.disabled }));
  ok(pt.games.includes('Valorant'), 'jogos em comum: Valorant (dos perfis de jogador)', pt);
  ok(pt.ads === 1, 'mostra o anúncio aberto da ana', pt);
  ok(pt.invite === true, 'fora de uma sala de voz, "Chamar" fica desligado (com a explicação)', pt);
} finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
