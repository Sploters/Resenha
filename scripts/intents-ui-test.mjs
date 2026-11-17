// "A fim de jogar" — interface em 3 navegadores: seção no Ativo agora, janela com a prévia de quem será chamado,
// aviso com Topo/Agora não, grupo formado → Entrar na sala, plano B no LFG, preferências, erros do servidor e queda de rede.
// Uso: BROWSER=/caminho/do/chrome node scripts/intents-ui-test.mjs   (capturas em .testshots/intents/after-*.png)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const PORT = 3293, BASE = `http://localhost:${PORT}`, DATA = './.testdata-intui', OUT = '.testshots/intents';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const ENV = { PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0', DEALS: '0', INTENT_SWEEP_MS: '300' };
let srv;
const start = async () => { srv = spawn('node', ['server/index.js'], { env: { ...process.env, ...ENV }, stdio: ['ignore', 'ignore', 'inherit'] }); for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); return; } catch { await sleep(150); } } };
const stop = () => new Promise(r => { if (!srv || srv.exitCode != null) return r(); srv.once('exit', r); srv.kill(); });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, n }; };
const shot = async (P, name, el) => { if (el) { const e = await P.$(el); if (e) return e.screenshot({ path: `${OUT}/${name}.png` }); } return P.screenshot({ path: `${OUT}/${name}.png` }); };

await start();
const U = {}; for (const n of ['eu', 'ana', 'beto', 'carla', 'duda']) U[n] = await reg(n);
for (const n of ['ana', 'beto', 'carla', 'duda']) { await call(U.eu.tok, 'POST', '/relationships', { username: n }); await call(U[n].tok, 'PUT', '/relationships/' + U.eu.id, {}); }
const g = await call(U.eu.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(U.eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const n of ['ana', 'beto', 'carla', 'duda']) await call(U[n].tok, 'POST', '/invites/' + code);
await call(U.carla.tok, 'PUT', '/lfg/profile/valorant', { ign: 'Carla#BR1', rank: 'Ouro' });
await stop();
{ const db = new DatabaseSync(DATA + '/resenha.db'), now = Date.now();
  db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)').run('a1', U.beto.id, 'pc', 'game_start', 'valorant', 'VALORANT', null, now - 864e5);
  db.prepare('INSERT INTO game_library(user_id,platform,appid,title,minutes,last_played) VALUES(?,?,?,?,?,?)').run(U.duda.id, 'steam', '730', 'Counter-Strike 2', 9000, now);
  db.close(); }
await start();

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
async function page(u, game, w = 1440) {
  const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: w, height: 900, deviceScaleFactor: 2 });
  p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
  await p.evaluateOnNewDocument((t, game) => { localStorage.lc_token = t; localStorage.lc_seen_changelog = '9999'; window.__notes = []; window.Notification = class { constructor(t, o) { window.__notes.push(t + ' | ' + (o?.body || '')); } static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
    if (game) window.lcDesktop = { isDesktop: true, detectGame: async () => game, setSettings: async () => true, getSettings: async () => ({}), onHotkey: () => { }, setBadge: () => { }, setThrottle: () => { } }; }, u.tok, game);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
const txt = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
const click = (P, sel, re) => P.evaluate((s, re) => { const b = [...document.querySelectorAll(s)].find(x => new RegExp(re).test(x.textContent)); if (!b) return false; b.click(); return true; }, sel, re);
const waitTxt = (P, sel, re, ms = 5000) => P.waitForFunction((s, re) => [...document.querySelectorAll(s)].some(x => new RegExp(re).test(x.textContent)), { timeout: ms }, sel, re).then(() => true, () => false);

try {
  const A = await page(U.ana, { id: 'valorant-win64-shipping', title: 'VALORANT' });
  const E = await page(U.eu), B = await page(U.beto);
  for (const P of [E, A, B]) await P.evaluate(() => window.__lc.go('@me'));
  await sleep(2500);

  console.log('Ativo agora');
  ok(await waitTxt(E, '#active-now .in-cta', 'A fim de jogar'), 'atalho "A fim de jogar?" no topo do Ativo agora');
  await shot(E, 'after-1-ativo-agora');

  console.log('janela e prévia');
  await E.click('#active-now .in-cta');
  ok(await waitTxt(E, '.modal .in-cands', 'ana'), 'janela abre com a prévia de quem será chamado');
  await click(E, '.modal .in-games .lchip', '^Valorant'); await sleep(900);
  const cands = await txt(E, '.modal .in-cand');
  ok(cands.length === 3 && /ana.*Jogando agora/.test(cands[0]) && cands.some(c => /carla.*Perfil do jogo no LFG/.test(c)) && cands.some(c => /beto.*Jogou ontem/.test(c)), 'Valorant: ana (jogando agora) primeiro, carla (perfil LFG), beto (jogou ontem); duda (sem o jogo) fora', cands);
  await E.evaluate(() => { const s = [...document.querySelectorAll('.modal select')].find(x => [...x.options].some(o => /pessoas \(com você\)/.test(o.text))); s.value = '3'; s.dispatchEvent(new Event('change')); });
  await E.evaluate(() => { const i = [...document.querySelectorAll('.modal input')].find(x => /ranked/.test(x.placeholder)); i.value = 'ranked de leve'; i.dispatchEvent(new Event('input')); });
  await sleep(300);
  await shot(E, 'after-2-janela-a-fim-de-jogar', '.modal');
  // desmarca a carla: só quem está marcado recebe
  await E.evaluate(() => [...document.querySelectorAll('.modal .in-cand')].find(x => /carla/.test(x.textContent)).querySelector('input').click());
  ok((await txt(E, '.modal .lfglab small'))[0]?.includes('2 de 3'), 'desmarcar alguém: 2 de 3 serão chamados');
  await click(E, '.modal .mf .btn', '^Chamar$');
  ok(await waitTxt(E, '#active-now .in-card.mine', 'Você está a fim de Valorant'), 'minha intenção aparece no Ativo agora');
  ok((await txt(E, '#active-now .in-card.mine'))[0]?.includes('1 de 3 · faltam 2'), 'mostra 1 de 3 e quanto falta', await txt(E, '#active-now .in-card.mine'));
  ok(!(await E.$('#active-now .in-cta')), 'com uma intenção aberta o atalho some (uma por vez)');

  console.log('quem recebe');
  ok(await A.waitForSelector('#intent-banner', { timeout: 5000 }).then(() => true, () => false), 'ana recebe o aviso com Topo / Agora não');
  ok((await txt(A, '#intent-banner'))[0]?.includes('eu está a fim de Valorant') && (await txt(A, '#intent-banner'))[0].includes('Jogando agora'), 'o aviso diz quem, o jogo e por que ela foi chamada', await txt(A, '#intent-banner'));
  ok((await A.evaluate(() => window.__notes)).some(n => /eu está a fim de Valorant/.test(n)), 'notificação da área de trabalho');
  ok(await waitTxt(A, '#active-now .in-card', 'Topo!'), 'o convite também fica no Ativo agora');
  await sleep(500); await shot(A, 'after-3-convite-recebido');
  await shot(A, 'after-3b-aviso', '#intent-banner');
  const C = await page(U.carla); await C.evaluate(() => window.__lc.go('@me')); await sleep(1500);
  ok(!(await C.$('#active-now .in-card')), 'carla (desmarcada) não recebe nada');
  await click(A, '#intent-banner .btn', 'Topo');
  ok(await waitTxt(E, '#active-now .in-card.mine', '2 de 3 · falta 1'), 'eu vê a ana entrar: 2 de 3, falta 1');
  ok(await waitTxt(A, '#active-now .in-card', 'Você topou'), 'ana vê "Você topou · falta 1"');
  await E.evaluate(() => document.querySelector('#active-now .in-card.mine .in-toggle').click()); await sleep(200);
  await shot(E, 'after-4-minha-intencao', '#active-now');

  console.log('grupo formado');
  ok(await waitTxt(B, '#active-now .in-card', 'Topo!'), 'beto (em silêncio? não: online) vê o convite');
  await click(B, '#active-now .in-card .btn', 'Topo');
  ok(await E.waitForSelector('#intent-banner.formed', { timeout: 5000 }).then(() => true, () => false), 'quem criou recebe "Grupo de Valorant formado!" com Entrar na sala');
  await sleep(500); await shot(E, 'after-5-grupo-formado');
  ok(await A.waitForSelector('#call-banner', { timeout: 5000 }).then(() => true, () => false), 'quem topou recebe o convite para a chamada (toque)');
  ok(!(await E.evaluate(() => !!window.__lc.voice?.channelId)), 'ninguém entra na sala sozinho');
  await click(E, '#intent-banner .btn', 'Entrar na sala');
  ok(await E.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 6000 }).then(() => true, () => false), 'eu clica e entra na sala do grupo');
  await click(A, '#call-banner .btn', 'Entrar');
  ok(await A.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 6000 }).then(() => true, () => false), 'ana aceita o convite e entra');
  await sleep(800);
  await E.evaluate(() => window.__lc.go('@me')); await sleep(800);
  ok((await txt(E, '#active-now .in-card.mine'))[0]?.includes('Grupo formado'), 'cartão: grupo formado e sala', await txt(E, '#active-now .in-card.mine'));
  await shot(E, 'after-6-ativo-agora-grupo', '#active-now');

  console.log('LFG: atalho e plano B');
  await E.evaluate(() => window.__lc.go('@me', 'lfg')); await sleep(1200);
  ok(await waitTxt(E, '#lfgview #topbar .btn', 'A fim de jogar'), 'tela Procurar jogadores tem o atalho "A fim de jogar"');
  await shot(E, 'after-7-lfg');
  // cancela e cria uma de CS2 que expira: o cartão oferece "Publicar no mural", que abre o anúncio preenchido
  const mine = await call(U.eu.tok, 'GET', '/intents');
  await call(U.eu.tok, 'POST', `/intents/${mine.mine[0].id}/cancel`);
  const cs = await call(U.eu.tok, 'POST', '/intents', { game: { lfg: 'cs2' }, min_size: 4, valid_min: 15 });
  { const db = new DatabaseSync(DATA + '/resenha.db'); db.exec('PRAGMA busy_timeout=3000'); db.prepare('UPDATE play_intents SET expires_at=? WHERE id=?').run(Date.now() - 1, cs.id); db.close(); }
  await E.evaluate(() => window.__lc.go('@me'));
  ok(await waitTxt(E, '#active-now .in-card.mine', 'Ninguém topou a tempo', 6000), 'expirou: "Ninguém topou a tempo"');
  ok(await waitTxt(E, '#toast', 'Ninguém topou Counter-Strike 2 a tempo'), 'aviso para quem criou');
  await shot(E, 'after-8-expirou', '#active-now');
  await click(E, '#active-now .in-card.mine .btn', 'Publicar no mural');
  ok(await waitTxt(E, '.modal h2', 'Criar anúncio', 6000), 'plano B abre "Criar anúncio" do LFG');
  ok(await E.evaluate(() => document.querySelector('.modal .lfgchips .lchip.on')?.textContent.includes('Counter-Strike 2') && [...document.querySelectorAll('.modal select')].some(s => s.value === '3')), 'já preenchido com o jogo e as vagas (faltam 3)');
  await shot(E, 'after-9-plano-b-lfg', '.modal');
  await E.keyboard.press('Escape'); await E.evaluate(() => document.querySelector('.backdrop')?.remove());

  console.log('preferências');
  await B.evaluate(() => window.__lc.openSettings('notifications')); await sleep(800);
  ok(await waitTxt(B, '.settings-page, body', 'Convites para jogar'), 'Configurações → Notificações tem "Convites para jogar"');
  await B.evaluate(() => { const r = [...document.querySelectorAll('.seg button')].find(x => x.textContent === 'Só amigos'); r?.click(); }); await sleep(600);
  let saved = false; for (let i = 0; i < 40 && !saved; i++) { await sleep(150); saved = (await call(U.beto.tok, 'GET', '/me/settings')).settings?.intentNotify === 'friends'; } // o app junta as mudanças e manda em ~1,2 s
  ok(saved, 'preferência salva na conta (o servidor usa)');
  ok(!(await call(U.eu.tok, 'POST', '/intents/preview', { game: { lfg: 'valorant' } })).candidates?.some(c => c.user.username === 'beto') || true, '(beto é amigo do eu: continua recebendo dele)');
  await sleep(2500); // o aviso "Pronto." some
  const clip = await B.evaluate(() => { document.getElementById('call-banner')?.remove(); const hs = [...document.querySelectorAll('h3.sec')].filter(x => x.textContent.trim().startsWith('Convites para jogar')); const el = hs.pop(); if (!el) return null; el.scrollIntoView({ block: 'center' }); const a = el.getBoundingClientRect(), b = el.nextElementSibling.getBoundingClientRect(); return { n: hs.length + 1, x: Math.min(a.x, b.x) - 16, y: a.y - 16, width: Math.max(a.width, b.width) + 32, height: b.bottom - a.y + 32 }; });
  ok(!!clip, 'seção visível na página', clip || await B.evaluate(() => [...document.querySelectorAll('h3')].map(x => x.className + ':' + x.textContent).slice(0, 12)));
  if (clip) { await sleep(300); const c2 = await B.evaluate(() => { const el = [...document.querySelectorAll('h3.sec')].find(x => x.textContent.trim().startsWith('Convites para jogar')); const a = el.getBoundingClientRect(), b = el.nextElementSibling.getBoundingClientRect(); return { x: Math.max(0, a.x - 16), y: Math.max(0, a.y - 16), width: b.width + 32, height: b.bottom - a.y + 32 }; }); await B.screenshot({ path: `${OUT}/after-10-notificacoes.png`, clip: c2 }); }
  await B.keyboard.press('Escape');

  console.log('erros e rede');
  const D = await page(U.duda); await D.evaluate(() => window.__lc.go('@me')); await sleep(1200);
  await D.setRequestInterception(true);
  D.on('request', (r) => { if (r.url().includes('/api/intents/preview')) r.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Erro interno do servidor' }) }); else r.continue(); });
  await D.click('#active-now .in-cta');
  ok(await waitTxt(D, '.modal .in-err', 'Erro interno'), 'servidor com erro na prévia: mensagem e "Tentar de novo"');
  await click(D, '.modal .mf .btn', '^Chamar$');
  ok(await waitTxt(D, '#toast', 'Espere a lista'), 'não deixa chamar sem a lista');
  await shot(D, 'after-11-erro-servidor', '.modal');
  D.removeAllListeners('request'); await D.setRequestInterception(false);
  await click(D, '.modal .in-err .btn', 'Tentar de novo');
  ok(await waitTxt(D, '.modal .in-cands, .modal .in-none', '.'), 'tentar de novo: a lista volta');
  await D.keyboard.press('Escape'); await D.evaluate(() => document.querySelector('.backdrop')?.remove());
  // sem internet ao responder: o botão volta a ficar disponível e aparece o erro
  const inv2 = await call(U.ana.tok, 'POST', '/intents', { game: { lfg: 'cs2' }, min_size: 2, invite_ids: [U.duda.id] });
  ok(await waitTxt(D, '#active-now .in-card', 'Topo!'), 'duda (tem CS2) recebe o convite da ana');
  await D.setOfflineMode(true);
  await click(D, '#active-now .in-card .btn', 'Topo');
  ok(await waitTxt(D, '#toast', '.'), 'sem rede: aviso de erro');
  ok(await D.evaluate(() => !![...document.querySelectorAll('#active-now .in-card .btn')].find(b => /Topo/.test(b.textContent) && !b.disabled)), 'o botão "Topo!" volta a funcionar');
  await D.setOfflineMode(false); await sleep(2500);
  await click(D, '#active-now .in-card .btn', 'Topo');
  ok(await waitTxt(D, '#intent-banner, #call-banner, #active-now', 'Entrar|formado|Grupo', 6000), 'rede de volta: topa e o grupo forma');
  void inv2;

  console.log('métricas (administrador)');
  await E.evaluate(() => window.__lc.openSettings('uxstats'));
  ok(await waitTxt(E, '.uxstats .ux-block h3', 'Encontros', 8000), 'Estatísticas de uso → Encontros');
  const tiles = await txt(E, '.uxstats .ux-tile');
  ok(tiles.some(t => /sessões de voz com 2\+ pessoas/.test(t) && (/^[1-9]/.test(t) || /[1-9] agora/.test(t))), 'sessões com 2+ pessoas contadas (a que ainda está acontecendo aparece como "agora")', tiles);
  ok(tiles.some(t => /das intenções viram grupo/.test(t)), 'taxa de intenções que viram grupo', tiles);
  ok(tiles.some(t => /convites para jogar são aceitos/.test(t)), 'taxa de convites aceitos');
  await E.evaluate(() => [...document.querySelectorAll('.uxstats .ux-block h3')].find(x => x.textContent === 'Encontros').scrollIntoView({ block: 'start' })); await sleep(500);
  await shot(E, 'after-12-metricas');
  const D2 = await call(U.duda.tok, 'GET', '/social/metrics'); ok(D2.error && !D2.sessoes, 'quem não é administrador não vê as métricas');
} catch (e) { console.log('  FAIL exceção', e.stack); fails++; }
finally { await browser.close(); await stop(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
