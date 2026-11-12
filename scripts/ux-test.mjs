// Telemetria de UX (etapa 1): servidor aceita só os eventos conhecidos e guarda contagens sem quem fez; só o administrador
// lê; o app conta Esc/ícone ao sair da conversa, abas de Jogos, ⓘ abertas e buscas sem resultado; desligar para de enviar.
// Uso: node scripts/ux-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const PORT = 3241, BASE = `http://localhost:${PORT}`, DATA = './.testdata-ux';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, LC_ADMIN: '' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const reg = async (name) => (await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'senha123' }) }).then(r => r.json())).token;
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const stats = async (tok) => (await api(tok, 'GET', '/ux')).data.eventos || {};
const n = (ev, e, d) => ev[e]?.detalhes?.[d]?.total || 0;
try {
  const admin = await reg('admin'), eu = await reg('eu'), ana = await reg('ana'); // o primeiro registrado é o administrador

  // ---------- servidor ----------
  let r = await api(eu, 'POST', '/ux', { device: 'mobile', events: [
    { e: 'back_to_friends', d: 'esc', n: 3 }, { e: 'games_tab', d: 'news', n: 1 },
    { e: 'back_to_friends', d: 'outra coisa', n: 1 }, { e: 'evento_inventado', d: '', n: 1 }, { e: 'games_tab', d: 'news', n: 5000 }, { e: 'info_tip', d: 'x'.repeat(200), n: 1 }, { e: 'games_open', d: '', n: 0 }] });
  ok(r.data.kept === 2, 'só eventos conhecidos, com detalhe válido e contagem razoável', r.data);
  ok((await api(eu, 'GET', '/ux')).status === 403, 'quem não é o administrador não lê');
  let ev = await stats(admin);
  ok(n(ev, 'back_to_friends', 'esc') === 3 && ev.back_to_friends.detalhes.esc.mobile === 3 && n(ev, 'games_tab', 'news') === 1, 'administrador vê os totais por evento, detalhe e aparelho', ev);
  await api(ana, 'POST', '/ux', { device: 'desktop', events: [{ e: 'back_to_friends', d: 'esc', n: 2 }] });
  ev = await stats(admin);
  ok(n(ev, 'back_to_friends', 'esc') === 5, 'envios de pessoas diferentes somam no mesmo total');
  { const db = new DatabaseSync(DATA + '/resenha.db', { readOnly: true }); const cols = db.prepare('PRAGMA table_info(ux_daily)').all().map(c => c.name); db.close();
    ok(cols.join() === 'day,device,event,detail,n', 'a tabela não tem coluna de usuário (só dia, aparelho, evento, detalhe, contagem)', cols); }
  ok((await fetch(BASE + '/api/ux', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"events":[]}' })).status === 401, 'sem login não envia');

  // ---------- app ----------
  const ctx = await browser.createBrowserContext(), P = await ctx.newPage(); await P.setViewport({ width: 1400, height: 900 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.goto(BASE); await P.evaluate((t) => localStorage.setItem('lc_token', t), eu); await P.goto(BASE);
  await P.waitForSelector('#rail .rail-wrap', { timeout: 15000 }); await sleep(800);
  const { DatabaseSync: D } = await import('node:sqlite'); const anaId = (() => { const db = new D(DATA + '/resenha.db', { readOnly: true }); const r = db.prepare("SELECT id FROM users WHERE username='ana'").get(); db.close(); return r.id; })();
  const dm = (await api(eu, 'POST', '/dms', { user_id: anaId })).data.id;
  const flush = () => P.evaluate(async () => { await (await window.__lc.import('ux.js')).flushUx(); });
  const before = await stats(admin);
  // sair da conversa: Esc e ícone de Mensagens
  await P.waitForFunction((id) => window.__lc.S.dms.has(id), {}, dm);
  await P.evaluate((id) => window.__lc.go('@me', id), dm); await sleep(700);
  ok(await P.evaluate(() => window.__lc.S.view.kind === 'dm'), 'conversa aberta');
  await P.keyboard.press('Escape'); await sleep(400);
  await P.evaluate((id) => window.__lc.go('@me', id), dm); await sleep(700);
  await P.evaluate(() => document.querySelector('#rail .rail-fly .rail-item').click()); await sleep(400);
  // Jogos: abrir pela barra e trocar para Notícias
  await P.evaluate(() => document.querySelector('#rail .rail-games .rail-item').click()); await sleep(1200);
  await P.evaluate(() => [...document.querySelectorAll('.gtabs .dtab')].find(b => /Notícias/.test(b.textContent)).click()); await sleep(800);
  // Configurações: abrir uma ⓘ duas vezes (conta uma) e buscar algo que não existe
  await P.evaluate(() => window.__lc.openSettings('privacy')); await sleep(900);
  await P.evaluate(() => { const b = [...document.querySelectorAll('#settings .rt .itip')].find(x => /Apagar minhas mensagens/.test(x.parentElement.textContent)); b.click(); b.click(); b.click(); });
  await P.type('#settings .nsearch', 'xyzinexistente'); await sleep(1800);
  ok(await P.evaluate(() => document.querySelector('#settings .nsearch').value) === 'xyzinexistente', 'dá para digitar a palavra inteira na busca das Configurações');
  await flush(); await sleep(300);
  ev = await stats(admin);
  ok(n(ev, 'back_to_friends', 'esc') - n(before, 'back_to_friends', 'esc') === 1, 'Esc na conversa conta como "esc"');
  ok(n(ev, 'back_to_friends', 'rail') === 1, 'ícone de Mensagens na conversa conta como "rail"');
  ok(n(ev, 'games_open', '-') === 1 && n(ev, 'games_tab', 'news') - n(before, 'games_tab', 'news') === 1, 'abrir Jogos e a aba Notícias são contados', ev.games_tab);
  ok(n(ev, 'info_tip', 'Privacidade e segurança › Apagar minhas mensagens') === 1, 'ⓘ aberta conta uma vez, com "Página › opção"', ev.info_tip);
  ok(n(ev, 'settings_search_empty', 'xyzinexistente') === 1, 'busca sem resultado nas Configurações é contada', ev);
  // desligar: nada mais vai
  await P.evaluate(() => { const s = document.querySelector('#settings .nsearch'); s.value = ''; s.dispatchEvent(new Event('input')); });
  await sleep(300);
  const sw = await P.evaluate(() => { const row = [...document.querySelectorAll('#settings .perm')].find(x => /Enviar estatísticas de uso/.test(x.textContent)); const t = row?.querySelector('.toggle, [role=switch], input[type=checkbox], .tg'); t?.click(); return !!t; });
  ok(sw && await P.evaluate(() => window.__lc.S.prefs.uxStats === false), 'chave "Enviar estatísticas de uso anônimas" em Privacidade desliga');
  await P.keyboard.press('Escape'); await sleep(400);
  await P.evaluate((id) => window.__lc.go('@me', id), dm); await sleep(700);
  await P.keyboard.press('Escape'); await sleep(400);
  await flush(); await sleep(300);
  ok(n(await stats(admin), 'back_to_friends', 'esc') === n(ev, 'back_to_friends', 'esc'), 'desligado, o Esc não é mais contado');
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
