// Gerenciamento de usuários pelo administrador da instalação (server/admin.js + public/adminusers.js): só o admin
// acessa; suspender tira de todos os aparelhos e bloqueia o login; reativar devolve; senha temporária funciona e
// derruba as sessões; excluir pede o nome de usuário e apaga junto os servidores de que a pessoa é dona; o admin não
// age na própria conta; tudo fica no histórico; a página aparece em Configurações → Administração.
// Uso: node scripts/admin-users-test.mjs   (SHOTS=1 salva capturas em .testshots/admin)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('admin', 3414, 41414, { RTC: '0' });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const PW = 'Teste.senha-123';
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: PW }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, name }; };
const login = (name, password = PW) => call('', 'POST', '/login', { username: name, password });
let browser;
try {
  const adm = await reg('sploters'), bob = await reg('bob'), carl = await reg('carl');
  ok((await call(bob.tok, 'GET', '/admin/users')).status === 403, 'quem não é o administrador não acessa');
  const list = await call(adm.tok, 'GET', '/admin/users');
  ok(list.users?.length === 3 && list.users.find(u => u.username === 'sploters')?.admin === true, 'admin lista as contas (e se vê como Admin)', list);
  ok((await call(adm.tok, 'GET', '/admin/users?q=car')).users?.map(u => u.username).join() === 'carl', 'busca por nome');
  ok((await call(adm.tok, 'POST', `/admin/users/${adm.id}/ban`, {})).status === 400, 'não suspende a própria conta');
  // suspender
  const ban = await call(adm.tok, 'POST', `/admin/users/${bob.id}/ban`, { reason: 'spam' });
  ok(ban.status === 200 && ban.ended >= 1, 'suspender encerra as sessões', ban);
  ok((await call(bob.tok, 'GET', '/users/0')).status === 401, 'o token antigo de quem foi suspenso não vale mais');
  const bl = await login('bob');
  ok(bl.status === 403 && /suspensa/.test(bl.error || ''), 'conta suspensa não entra (aviso claro)', bl);
  ok((await call(adm.tok, 'GET', '/admin/users?q=bob')).users[0]?.banned_reason === 'spam', 'a lista mostra suspensa e o motivo');
  await call(adm.tok, 'POST', `/admin/users/${bob.id}/unban`);
  const bl2 = await login('bob');
  ok(bl2.status === 200 && bl2.token, 'reativada: entra de novo');
  // senha temporária
  const pw = await call(adm.tok, 'POST', `/admin/users/${bob.id}/password`);
  ok(pw.status === 200 && /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(pw.password || ''), 'redefinir senha gera uma temporária legível', pw);
  ok((await call(bl2.token, 'GET', '/users/0')).status === 401, 'e derruba as sessões abertas');
  ok((await login('bob')).status === 401 && (await login('bob', pw.password)).status === 200, 'a senha antiga para de funcionar e a temporária entra');
  // excluir: dono de servidor
  const g = await call(carl.tok, 'POST', '/guilds', { name: 'Do Carl' });
  ok((await call(adm.tok, 'POST', `/admin/users/${carl.id}/delete`, { confirm: 'errado' })).status === 400, 'excluir sem digitar o nome certo: nada acontece');
  const del = await call(adm.tok, 'POST', `/admin/users/${carl.id}/delete`, { confirm: 'carl' });
  ok(del.status === 200 && (await login('carl')).status === 401, 'excluir apaga a conta', del);
  ok((await call(adm.tok, 'GET', `/guilds/${g.id}/onboarding`)).status === 403, 'o servidor de que era dono some junto');
  const log = await call(adm.tok, 'GET', '/admin/log');
  ok(log.entries?.map(e => e.action).join() === 'delete,password,unban,ban' && log.entries[0].target_name === 'carl' && log.entries[0].actor_name === 'sploters', 'tudo fica no histórico (quem, o quê, em quem)', log.entries?.map(e => e.action));

  // ---- no app ----
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const P = await (await browser.createBrowserContext()).newPage();
  await P.setViewport({ width: 1280, height: 800, deviceScaleFactor: process.env.SHOTS ? 2 : 1 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, adm.tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  await P.evaluate(() => window.__lc.openSettings('users'));
  const shown = await P.waitForSelector('.adminusers .au-row', { timeout: 6000 }).then(() => true, () => false);
  ok(shown && await P.evaluate(() => document.querySelectorAll('.adminusers .au-row').length === 2), 'Configurações → Usuários lista as contas');
  ok(await P.evaluate(() => [...document.querySelectorAll('#settings .ni')].some(n => /Usuários/.test(n.textContent))), 'item "Usuários" na seção Administração');
  ok(await P.evaluate(() => document.querySelectorAll('.adminusers .au-logrow').length === 4), 'o histórico aparece na página');
  if (process.env.SHOTS) { fs.mkdirSync('.testshots/admin', { recursive: true }); await P.screenshot({ path: '.testshots/admin/1-usuarios.png' }); }
  // menu de ações de outra conta
  await P.evaluate(() => document.querySelector('.adminusers .au-more').click()); await sleep(300);
  ok(await P.evaluate(() => ['Suspender conta', 'Redefinir senha', 'Encerrar sessões', 'Excluir conta'].every(l => [...document.querySelectorAll('.menu .it')].some(i => i.textContent.includes(l)))), 'menu de ações com suspender, senha, sessões e excluir');
  // quem não é admin não vê o item
  const B = await (await browser.createBrowserContext()).newPage();
  B.on('pageerror', e => { console.log('  PAGEERROR (bob)', e.message); fails++; });
  const bt = (await login('bob', pw.password)).token;
  await B.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, bt);
  await B.goto(BASE); await B.waitForSelector('#rail .rail-wrap');
  await B.evaluate(() => window.__lc.openSettings('account')); await sleep(1200);
  ok(await B.evaluate(() => ![...document.querySelectorAll('#settings .ni')].some(n => /Usuários/.test(n.textContent))), 'quem não é admin não vê "Usuários"');
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser?.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
