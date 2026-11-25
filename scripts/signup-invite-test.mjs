// Cadastro por código de convite (server/signup.js): modos aberto / só com convite / fechado, código com limite de usos,
// revogação, servidor em que a pessoa entra, permissões do painel e o link /convite/<código> na tela de criar conta.
// Uso: BROWSER=... node scripts/signup-invite-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3299, BASE = `http://localhost:${PORT}`, DATA = './.testdata-signup';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const reg = (n, code) => call('', 'POST', '/register', { username: n, password: 'Teste.senha-123', ...(code !== undefined ? { code } : {}) });
let fails = 0; const ok = (c, msg, x) => { console.log((c ? '✓ ' : '✗ ') + msg + (c || x === undefined ? '' : '  ' + JSON.stringify(x))); if (!c) fails++; };
let browser;
try {
  const admin = await reg('dono'); ok(admin.token, 'primeira conta cria sem código (vira administradora)');
  const info0 = await call('', 'GET', '/server-info'); ok(info0.registration === true && info0.registration_mode === 'open', 'padrão: cadastro aberto (instalações atuais não mudam)', info0);
  const b = await reg('amiga'); ok(b.token, 'modo aberto: cria conta sem código');
  ok((await call(b.token, 'GET', '/admin/signup')).status === 403, 'quem não é administrador não vê o painel de convites');
  ok((await call(b.token, 'POST', '/admin/signup/mode', { mode: 'open' })).status === 403, 'quem não é administrador não muda o modo');
  ok((await call(b.token, 'POST', '/admin/signup/codes', {})).status === 403, 'quem não é administrador não gera código');
  ok((await call(admin.token, 'POST', '/admin/signup/mode', { mode: 'invite' })).mode === 'invite', 'administrador liga "só com convite"');
  const info1 = await call('', 'GET', '/server-info'); ok(info1.registration_mode === 'invite', 'server-info informa o modo convite');
  const r1 = await reg('semcodigo'); ok(r1.status === 403 && /código de convite/i.test(r1.error), 'sem código: recusado com explicação', r1);
  const r2 = await reg('codigoerrado', 'NAOEXISTE1'); ok(r2.status === 403, 'código inexistente: recusado');
  const g = await call(admin.token, 'POST', '/guilds', { name: 'Turma' });
  const c1 = await call(admin.token, 'POST', '/admin/signup/codes', { max_uses: 1, days: 7, note: 'pro João', guild_id: g.id });
  ok(/^[A-Z2-9]{10}$/.test(c1.code || ''), 'código gerado (10 caracteres sem 0/O/1/I/L)', c1);
  const chk = await call('', 'GET', '/signup/' + c1.code); ok(chk.ok && chk.guild === 'Turma', 'checagem pública do código diz o servidor', chk);
  // digitado à mão, minúsculo e com traço
  const typed = c1.code.toLowerCase().slice(0, 5) + '-' + c1.code.toLowerCase().slice(5);
  const j = await reg('joao', typed); ok(j.token, 'com o código (minúsculo, com traço): cria a conta', j);
  const jg = await call(j.token, 'GET', '/users/@me/guilds').catch(() => null);
  const me = await call(j.token, 'PATCH', '/me', {});
  const inGuild = (await call(admin.token, 'GET', '/admin/guilds')).guilds?.find(x => x.id === g.id)?.members;
  ok(inGuild === 2, 'o convite já colocou a pessoa no servidor escolhido', { inGuild, me: me.id, jg: jg?.status });
  const r3 = await reg('segundo', c1.code); ok(r3.status === 403, 'código de 1 uso não vale de novo');
  ok((await call('', 'GET', '/signup/' + c1.code)).ok === false, 'checagem mostra o código esgotado');
  const c2 = await call(admin.token, 'POST', '/admin/signup/codes', { max_uses: 0, days: 0 });
  ok((await call(admin.token, 'POST', `/admin/signup/codes/${c2.code}/revoke`)).status === 200, 'revogar código');
  ok((await reg('revogado', c2.code)).status === 403, 'código revogado não vale');
  // dois cadastros ao mesmo tempo com o último uso: só um passa
  const c3 = await call(admin.token, 'POST', '/admin/signup/codes', { max_uses: 1 });
  const race = await Promise.all([reg('corrida1', c3.code), reg('corrida2', c3.code)]);
  ok(race.filter(x => x.token).length === 1, 'último uso disputado: só uma conta é criada', race.map(x => x.status));
  const list = await call(admin.token, 'GET', '/admin/signup');
  const row = list.codes.find(c => c.code === c1.code);
  ok(row?.state === 'used' && row.users.map(u => u.username).join() === 'joao' && row.note === 'pro João', 'painel lista o código, o estado e quem criou conta', row);
  ok(list.codes.find(c => c.code === c2.code)?.state === 'revoked', 'painel mostra o revogado');
  await call(admin.token, 'POST', '/admin/signup/mode', { mode: 'closed' });
  const c4 = await call(admin.token, 'POST', '/admin/signup/codes', { max_uses: 1 });
  ok((await reg('fechado', c4.code)).status === 403, 'modo fechado: nem com código');
  ok((await call('', 'GET', '/server-info')).registration === false, 'server-info: cadastro fechado');
  ok((await call(admin.token, 'POST', '/login', { username: 'amiga', password: 'Teste.senha-123' })).token, 'quem já tem conta continua entrando com o cadastro fechado');
  await call(admin.token, 'POST', '/admin/signup/mode', { mode: 'invite' });
  const log = await call(admin.token, 'GET', '/admin/log');
  ok(log.entries.some(e => e.action === 'signup_mode') && log.entries.some(e => e.action === 'signup_code') && log.entries.some(e => e.action === 'signup_revoke'), 'ações ficam no histórico do administrador');

  // ---- endereço oficial (server/siteurl.js) ----
  ok((await call(b.token, 'POST', '/admin/site', { public_url: 'https://x.com' })).status === 403, 'quem não é administrador não muda o endereço oficial');
  ok((await call(admin.token, 'POST', '/admin/site', { public_url: 'ftp://resenha.exemplo.com' })).status === 400, 'endereço que não é https: recusado');
  ok((await call(admin.token, 'POST', '/admin/site', { public_url: 'http://resenha.exemplo.com' })).status === 400, 'http fora de teste: recusado (microfone e câmera exigem https)');
  const su = await call(admin.token, 'POST', '/admin/site', { public_url: 'resenha.exemplo.com.br/qualquer/coisa' });
  ok(su.public_url === 'https://resenha.exemplo.com.br', 'sem https e com caminho: guarda só o domínio, em https', su);
  ok((await call('', 'GET', '/server-info')).public_url === 'https://resenha.exemplo.com.br', 'server-info informa o endereço oficial');
  // ---- IP de verdade atrás do Cloudflare Tunnel (server/clientip.js) ----
  const tryLogin = (ip, u, pw) => fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ username: u, password: pw }) }).then(r => r.status);
  for (let i = 0; i < 31; i++) await tryLogin('203.0.113.7', 'naoexiste' + i, 'errada-123');
  ok(await tryLogin('203.0.113.7', 'amiga', 'Teste.senha-123') === 429, 'quem errou a senha 30 vezes fica bloqueado (pelo IP dele)');
  ok(await tryLogin('198.51.100.9', 'amiga', 'Teste.senha-123') === 200, 'os outros, pelo mesmo túnel, continuam entrando');

  // ---- tela: link /convite/<código> ----
  browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
  const c5 = await call(admin.token, 'POST', '/admin/signup/codes', { max_uses: 1, guild_id: g.id });
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/convite/${c5.code}`); await p.waitForSelector('#auth .auth-code');
  await p.waitForFunction(() => /válido/.test(document.querySelector('#auth .auth-code')?.parentElement?.textContent || ''), { timeout: 5000 }).catch(() => null);
  const st = await p.evaluate(() => ({ val: document.querySelector('#auth .auth-code').value, vis: !document.querySelector('#auth .auth-code').closest('label').classList.contains('hidden'), msg: document.querySelector('#auth .auth-code').parentElement.textContent, path: location.pathname }));
  ok(st.val === c5.code && st.vis, 'link abre "Criar conta" com o código preenchido', st);
  ok(/Turma/.test(st.msg), 'mostra que o convite é válido e o servidor', st.msg);
  ok(st.path === '/', 'o endereço volta ao normal (recarregar não fica preso no link)');
  const inputs = await p.$$('#auth form input');
  // ordem: código, usuário, nome de exibição, senha, confirmar
  await inputs[1].type('pelo_link'); await inputs[3].type('Teste.senha-123'); await inputs[4].type('Teste.senha-123');
  await p.click('#auth .auth-go');
  const inApp = await p.waitForSelector('#rail .rail-wrap', { timeout: 10000 }).then(() => true, () => false);
  ok(inApp, 'cria a conta pelo link e entra no app');
  if (inApp) { await sleep(800); ok(await p.evaluate((gid) => window.__lc.S.guilds.has(gid), g.id), 'já aparece no servidor do convite'); }
  // tela sem código no modo convite: campo visível e obrigatório
  const p2 = await (await browser.createBrowserContext()).newPage(); await p2.goto(BASE);
  await p2.waitForSelector('#auth .auth-link'); await p2.evaluate(() => [...document.querySelectorAll('#auth .auth-switch .auth-link')].pop().click());
  await p2.waitForFunction(() => document.querySelector('#auth .auth-code') && !document.querySelector('#auth .auth-code').closest('label').classList.contains('hidden'), { timeout: 5000 }).then(() => ok(true, 'modo convite: "Registre-se" mostra o campo do código'), () => ok(false, 'modo convite: "Registre-se" mostra o campo do código'));
  const ins2 = await p2.$$('#auth form input'); await ins2[1].type('semconvite'); await ins2[3].type('Teste.senha-123'); await ins2[4].type('Teste.senha-123'); await p2.click('#auth .auth-go'); await sleep(300);
  ok(/código de convite/i.test(await p2.$eval('#auth .err', e => e.textContent)), 'sem código, a tela pede o código antes de enviar');
  // painel do administrador
  const pa = await (await browser.createBrowserContext()).newPage(); await pa.setViewport({ width: 1280, height: 800 });
  await pa.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, admin.token); await pa.goto(BASE); await pa.waitForSelector('#rail .rail-wrap');
  await pa.evaluate(() => window.__lc.openSettings('signup'));
  const panel = await pa.waitForSelector('.au-mode.on', { timeout: 8000 }).then(() => pa.evaluate(() => ({ on: document.querySelector('.au-mode.on b').textContent, rows: document.querySelectorAll('.adminusers .au-list .au-row').length })), () => null);
  ok(panel?.on === 'Só com convite' && panel.rows >= 5, 'painel "Convites de cadastro" abre com o modo e a lista', panel);
  await pa.evaluate(() => [...document.querySelectorAll('.au-new .btn')].pop().click());
  const made = await pa.waitForSelector('.au-pw code.au-link', { timeout: 5000 }).then(() => pa.$eval('.au-pw code.au-link', e => e.textContent), () => '');
  ok(/^https:\/\/resenha\.exemplo\.com\.br\/convite\/[A-Z2-9]{10}$/.test(made), 'o link do convite sai com o endereço oficial (não o da página)', made);
} catch (e) { fails++; console.log('ERRO', e); }
finally { await browser?.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
