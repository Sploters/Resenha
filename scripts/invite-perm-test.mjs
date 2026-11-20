// Quem pode convidar (server/routes/invites.js canInvite; opção do servidor "Membros sem cargo podem convidar",
// guilds.invite_all): ligada (o padrão, como sempre foi) qualquer membro cria convite; desligada, só o cargo com
// "Criar convite", o dono e os administradores. A chave muda na hora para todos (GUILD_UPDATE) e o botão "Convidar
// pessoas" some para quem não pode. Quem não tem "Gerenciar servidor" não muda a opção.
// Uso: node scripts/invite-perm-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('inviteperm', 3279, 41143);
const raw = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined });
const api = (tok, m, p, b) => raw(tok, m, p, b).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const [dono, bia, caio] = [await reg('dono'), await reg('bia'), await reg('caio')];
  const g = await api(dono.tok, 'POST', '/guilds', { name: 'Turma' });
  const inv = (await api(dono.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [bia, caio]) await api(u.tok, 'POST', '/invites/' + inv);
  const role = await api(dono.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Convidadores', perms: 32 });
  await raw(dono.tok, 'PATCH', `/guilds/${g.id}/members/${caio.id}`, { roles: [role.id] });
  const status = async (u) => (await raw(u.tok, 'POST', `/guilds/${g.id}/invites`, { new: true })).status;

  ok(await status(bia) === 200 && await status(caio) === 200, 'padrão (como antes): qualquer membro cria convite');
  ok((await raw(bia.tok, 'PATCH', `/guilds/${g.id}`, { invite_all: false })).status === 403, 'quem não gerencia o servidor não muda a opção');

  // a bia está com o app aberto: o botão de convidar está lá e some quando o dono desliga
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, bia.tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  await p.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(800);
  const btn = () => p.evaluate(() => !!document.querySelector('#side-head .sh-btn[title="Convidar pessoas"]'));
  ok(await btn(), 'bia vê o botão "Convidar pessoas"');

  ok((await raw(dono.tok, 'PATCH', `/guilds/${g.id}`, { invite_all: false })).status === 200, 'dono desliga "Membros sem cargo podem convidar"');
  await sleep(800);
  ok(await status(bia) === 403, 'desligado: membro sem cargo não cria convite');
  ok(await status(caio) === 200, 'desligado: cargo com "Criar convite" cria');
  ok(await status(dono) === 200, 'desligado: o dono cria');
  ok((await p.evaluate((gid) => window.__lc.S.guilds.get(gid).invite_all, g.id)) === 0 && !(await btn()), 'na hora, para a bia: opção desligada e o botão some', { botão: await btn() });

  // o dono na página Convites: a chave reflete e religa
  const d = await browser.newPage(); await d.setViewport({ width: 1280, height: 800 });
  await d.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, dono.tok);
  await d.goto(BASE); await d.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  await d.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(600);
  await d.evaluate(() => window.__lc.openSettings('server')); await sleep(1200); // configurações do servidor da tela (S.view.gid)
  await d.evaluate(() => [...document.querySelectorAll('#settings .ni')].find(x => x.textContent.trim() === 'Convites')?.click()); await sleep(1500);
  const sw = await d.evaluate(() => { const r = [...document.querySelectorAll('#settings .perm')].find(e => /Membros sem cargo podem convidar/.test(e.textContent)); const s = r?.querySelector('[role=switch]'); return s ? String(s.classList.contains('on')) : null; });
  ok(sw === 'false', 'página Convites mostra a chave desligada', sw);
  await d.evaluate(() => [...document.querySelectorAll('#settings .perm')].find(e => /Membros sem cargo podem convidar/.test(e.textContent)).querySelector('[role=switch]').click());
  await sleep(1000);
  await p.bringToFront(); await sleep(800); // a aba da bia ficou atrás da do dono: o app redesenha ao voltar à frente
  { const st = await status(bia), b = await btn(), on = await d.evaluate((gid) => window.__lc.S.guilds.get(gid).invite_all, g.id), biaVê = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).invite_all, g.id);
    ok(st === 200 && b, 'religada pela chave: a bia volta a convidar e o botão volta', { st, botão: b, donoVê: on, biaVê }); }
} catch (e) { console.log('  EXCEÇÃO', e.stack || e.message); fails++; }
finally { await browser.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nPERMISSÃO DE CONVITE OK'); process.exit(fails ? 1 : 0);
