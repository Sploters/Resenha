// Central de boas-vindas (server/onboarding.js + public/onboarding.js): configuração pelo admin, regras obrigatórias
// segurando o envio de mensagens, cargos dados/tirados pelas respostas, cargo perigoso recusado, e a tela no app
// (abre sozinha ao entrar no servidor, aceitar regras, escolher interesses, canais recomendados).
// Uso: node scripts/onboarding-test.mjs   (SHOTS=1 salva capturas em .testshots/onboarding)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
const SH = '.testshots/onboarding';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('onboarding', 3412, 41412);
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
let browser;
try {
  const ana = await reg('ana'), beto = await reg('beto'), caio = await reg('caio');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' });
  const full = await call(ana.tok, 'GET', '/guilds/' + g.id + '/onboarding');
  ok(full.config && full.config.enabled === false && full.can_edit === true, 'servidor novo: central desligada e o dono pode editar');
  const rFps = (await call(ana.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'FPS' })).id;
  const rRpg = (await call(ana.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'RPG' })).id;
  const rMod = (await call(ana.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', perms: 16 })).id; // expulsar
  const inv = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(beto.tok, 'POST', '/invites/' + inv);
  // o app sabe os canais pelo GUILD_CREATE; aqui um canal novo para recomendar
  const novo = await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'fps-geral', type: 0 });
  const cfg = (roles) => ({ enabled: true, intro: 'Bem-vindo à Turma! Aqui a gente joga toda noite.', rules: ['Respeite todo mundo', 'Sem spam'], require_rules: true, channels: [novo.id],
    questions: [{ id: 'jogos', title: 'Do que você curte jogar?', multi: true, options: [{ id: 'fps', label: 'Tiro', emoji: '🎯', roles: [roles.fps], channels: [novo.id] }, { id: 'rpg', label: 'RPG', roles: [roles.rpg] }] }] });
  const badPut = await call(ana.tok, 'PUT', `/guilds/${g.id}/onboarding`, cfg({ fps: rMod, rpg: rRpg }));
  ok(badPut.status === 400 && /Mod/.test(badPut.error || ''), 'cargo com permissão de moderação é recusado nas opções', badPut);
  const nope = await call(beto.tok, 'PUT', `/guilds/${g.id}/onboarding`, cfg({ fps: rFps, rpg: rRpg }));
  ok(nope.status === 403, 'membro comum não configura', nope.status);
  const put = await call(ana.tok, 'PUT', `/guilds/${g.id}/onboarding`, cfg({ fps: rFps, rpg: rRpg }));
  ok(put.status === 200 && put.config.enabled && put.config.questions[0].options.length === 2, 'admin liga a central com regras, pergunta e canal recomendado', put);
  // regras obrigatórias: beto (já membro) não manda mensagem até aceitar; ana (dona) manda
  const m1 = await call(beto.tok, 'POST', `/channels/${novo.id}/messages`, { content: 'oi' });
  ok(m1.status === 403 && m1.code === 'rules', 'sem aceitar as regras: mensagem recusada com code "rules"', m1);
  const m0 = await call(ana.tok, 'POST', `/channels/${novo.id}/messages`, { content: 'oi, sou a dona' });
  ok(m0.status === 200, 'quem gerencia o servidor não passa pelas regras', m0);
  const noRules = await call(beto.tok, 'POST', `/guilds/${g.id}/onboarding/complete`, { rules: false, answers: { jogos: ['fps'] } });
  ok(noRules.status === 400, 'concluir sem aceitar as regras obrigatórias: recusado', noRules.status);
  const done = await call(beto.tok, 'POST', `/guilds/${g.id}/onboarding/complete`, { rules: true, answers: { jogos: ['fps', 'xyz'] } });
  ok(done.status === 200 && done.added.length === 1 && done.added[0] === rFps && done.me.rules_at && done.me.done_at && JSON.stringify(done.me.answers) === '{"jogos":["fps"]}', 'aceitou e escolheu Tiro: ganha o cargo FPS (opção inválida ignorada)', done);
  const m2 = await call(beto.tok, 'POST', `/channels/${novo.id}/messages`, { content: 'oi' });
  ok(m2.status === 200, 'depois de aceitar, manda mensagem', m2);
  const redo = await call(beto.tok, 'POST', `/guilds/${g.id}/onboarding/complete`, { answers: { jogos: ['rpg'] } });
  ok(redo.status === 200 && redo.added[0] === rRpg && redo.removed[0] === rFps && redo.me.rules_at === done.me.rules_at, 'refazer: troca FPS por RPG e mantém o aceite das regras', redo);
  // sai e volta: começa do zero
  await call(beto.tok, 'DELETE', `/guilds/${g.id}/members/me`);
  await call(beto.tok, 'POST', '/invites/' + inv);
  const back = await call(beto.tok, 'GET', `/guilds/${g.id}/onboarding`);
  ok(back.me && !back.me.rules_at && !back.me.done_at, 'saiu e voltou: central de novo do começo', back.me);

  // ---- no app: caio entra pelo convite e a central abre sozinha ----
  fs.mkdirSync(SH, { recursive: true });
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const ctx = await browser.createBrowserContext(), P = await ctx.newPage();
  await P.setViewport({ width: 1280, height: 800, deviceScaleFactor: process.env.SHOTS ? 2 : 1 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, caio.tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  await P.evaluate((code) => window.__lc.import('rail.js').then(m => m.joinInvite(code)), inv);
  const opened = await P.waitForSelector('.onb', { timeout: 8000 }).then(() => true, () => false);
  ok(opened, 'ao entrar no servidor, a central de boas-vindas abre sozinha');
  ok(await P.evaluate(() => /Bem-vindo à Turma/.test(document.querySelector('.onb')?.textContent || '')), 'mostra a apresentação');
  ok(await P.evaluate(() => document.querySelectorAll('.onb-rule').length === 2), 'mostra as 2 regras');
  if (process.env.SHOTS) await P.screenshot({ path: `${SH}/1-central.png` });
  ok(await P.evaluate(() => document.querySelector('.onb-finish')?.disabled === true), 'Concluir bloqueado até aceitar as regras');
  const y0 = await P.evaluate(() => { const b = document.querySelector('#onbview .cbody'); b.scrollTop = 200; return b.scrollTop; });
  await P.click('.onb-accept input');
  const y1 = await P.evaluate(() => document.querySelector('#onbview .cbody').scrollTop);
  ok(y0 > 0 && y1 === y0, 'marcar "Li e aceito" não desloca a página', { y0, y1 });
  await P.evaluate(() => [...document.querySelectorAll('.onb-opt')].find(b => /Tiro/.test(b.textContent)).click());
  ok(await P.evaluate(() => [...document.querySelectorAll('.onb-opt')].find(b => /Tiro/.test(b.textContent)).getAttribute('aria-pressed') === 'true'), 'escolher uma opção marca o botão');
  ok(await P.evaluate(() => /fps-geral/.test(document.querySelector('.onb-chans')?.textContent || '')), 'canais recomendados aparecem');
  if (process.env.SHOTS) await P.screenshot({ path: `${SH}/2-escolhido.png` });
  if (process.env.DEBUG_LAYOUT) console.log(await P.evaluate(() => ['#main', '#onbview', '#onbview .cbody', '.onb-foot', '.onb-finish'].map(q => { const r = document.querySelector(q)?.getBoundingClientRect(); return q + ' ' + (r ? Math.round(r.top) + '-' + Math.round(r.bottom) : '-'); }).join(' | ') + ' | win ' + innerHeight));
  await P.evaluate(() => document.querySelector('.onb-finish').click());
  await P.waitForFunction(() => document.querySelector('.onb-done'), { timeout: 8000 }).catch(() => { });
  ok(await P.evaluate(() => !!document.querySelector('.onb-done')), 'concluir mostra o resumo final');
  const roles = await P.evaluate((gid, uid) => window.__lc.S.guilds.get(gid).members.get(uid)?.roles || [], g.id, caio.id);
  ok(roles.includes(rFps), 'o app recebe o cargo novo (MEMBER_UPDATE)', roles);
  if (process.env.SHOTS) await P.screenshot({ path: `${SH}/3-pronto.png` });
  // a linha "Boas-vindas" no topo da lista de canais leva de volta à central
  await P.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(400);
  ok(await P.evaluate(() => !!document.querySelector('#side-list .onb-row')), 'linha "Boas-vindas" no topo da lista de canais');
  await P.evaluate(() => document.querySelector('#side-list .onb-row').click());
  ok(await P.waitForSelector('.onb', { timeout: 5000 }).then(() => true, () => false), 'clicar nela abre a central de novo');
  // admin: página "Boas-vindas" nas configurações do servidor
  const A = await (await browser.createBrowserContext()).newPage();
  await A.setViewport({ width: 1280, height: 800, deviceScaleFactor: process.env.SHOTS ? 2 : 1 });
  A.on('pageerror', e => { console.log('  PAGEERROR (ana)', e.message); fails++; });
  await A.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ana.tok);
  await A.goto(BASE); await A.waitForSelector('#rail .rail-wrap');
  await A.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(300);
  await A.evaluate((gid) => window.__lc.import('nav.js').then(m => m.openSettings('server', { gid })), g.id);
  await A.waitForSelector('#settings .ni[data-k="onboarding"]', { timeout: 5000 });
  await A.click('#settings .ni[data-k="onboarding"]');
  await A.waitForSelector('#settings .onbcfg .onbcfg-rule', { timeout: 5000 }).catch(() => { }); // o editor aparece antes de a configuração chegar
  ok(await A.evaluate(() => document.querySelectorAll('#settings .onbcfg-rule input, #settings .onbcfg-rule textarea').length >= 2), 'configurações: as regras salvas aparecem no editor');
  if (process.env.SHOTS) await A.screenshot({ path: `${SH}/4-config.png` });
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser?.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
