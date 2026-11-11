// Pedidos da comunidade, lote 3 (servidor real + navegador):
// - apagar minhas mensagens: só as próprias; filtros de lugar, período, texto, tipo e fixadas; servidor de que a pessoa
//   saiu; corte da prévia (o que chega depois não entra); cópia; lotes; outros clientes recebem MESSAGE_DELETE_BULK;
//   arquivos anexados saem do disco; janela no app (prévia, desmarcar conversa, apagar)
// - GIFs com KLIPY e GIPHY: escolha da fonte e reserva quando uma cai
// Uso: BROWSER=/caminho/do/chrome node scripts/mymessages-test.mjs   (SHOTS=1 salva capturas em .testshots/mymessages)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PORT = 3297, MOCK = 3298, BASE = `http://localhost:${PORT}`, DATA = './.testdata-mymsg', OUT = '.testshots/mymessages';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
// serviços de GIF simulados: KLIPY pode "cair" (klipyDown), GIPHY sempre responde
let klipyDown = false; const hits = [];
const gif = (tag, i) => `http://127.0.0.1:${MOCK}/media/${tag}${i}.gif`;
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/media/')) { res.writeHead(200, { 'content-type': 'image/gif', 'access-control-allow-origin': '*' }); return res.end(Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')); }
  res.setHeader('content-type', 'application/json');
  if (/^\/api\/v1\/[^/]+\/gifs\//.test(u.pathname)) {
    hits.push('klipy'); if (klipyDown) { res.statusCode = 503; return res.end('{}'); }
    return res.end(JSON.stringify({ data: { data: Array.from({ length: 3 }, (_, i) => ({ id: 'k' + i, title: 'klipy ' + i, file: { md: { gif: { url: gif('k', i), width: 100, height: 80 } }, sm: { webp: { url: gif('k', i) + '?w', width: 100, height: 80 } } } })), has_next: false } }));
  }
  if (/^\/v1\/gifs\//.test(u.pathname)) { hits.push('giphy'); return res.end(JSON.stringify({ data: Array.from({ length: 3 }, (_, i) => ({ id: 'g' + i, title: 'giphy ' + i, images: { downsized_medium: { url: gif('g', i), width: 100, height: 80 }, fixed_width: { url: gif('g', i), width: 100, height: 80 } } })), pagination: { total_count: 3, offset: 0, count: 3 } })); }
  res.statusCode = 404; res.end('{}');
}).listen(MOCK);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', KLIPY_API_KEY: 'k', KLIPY_API_BASE: `http://127.0.0.1:${MOCK}`, GIPHY_API_KEY: 'g', GIPHY_API_BASE: `http://127.0.0.1:${MOCK}` }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const upload = async (tok, name, body) => (await fetch(BASE + '/api/upload?name=' + encodeURIComponent(name), { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'text/plain' }, body })).json();
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio');
  const g1 = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }), g2 = await call(bia.tok, 'POST', '/guilds', { name: 'Servidor da Bia' });
  await call(bia.tok, 'POST', '/invites/' + (await call(ana.tok, 'POST', `/guilds/${g1.id}/invites`)).code);
  await call(caio.tok, 'POST', '/invites/' + (await call(ana.tok, 'POST', `/guilds/${g1.id}/invites`)).code);
  await call(ana.tok, 'POST', '/invites/' + (await call(bia.tok, 'POST', `/guilds/${g2.id}/invites`)).code);
  const ch1 = await call(ana.tok, 'POST', `/guilds/${g1.id}/channels`, { name: 'conversa', type: 0 });
  const ch2 = await call(bia.tok, 'POST', `/guilds/${g2.id}/channels`, { name: 'papo', type: 0 });
  const dm = await call(ana.tok, 'POST', '/dms', { user_id: bia.id });
  const send = async (u, c, content, extra = {}) => { for (;;) { const r = await call(u.tok, 'POST', `/channels/${c}/messages`, { content, ...extra }); if (r.status !== 429) return r; await sleep(850); } }; // limite de envio do servidor
  for (let i = 0; i < 5; i++) await send(ana, ch1.id, 'oi turma ' + i);
  const pin = await send(ana, ch1.id, 'regras do servidor');
  await call(ana.tok, 'PUT', `/channels/${ch1.id}/pins/${pin.id}`);
  await send(ana, ch1.id, 'olha https://exemplo.com');
  const up = await upload(ana.tok, 'nota.txt', 'conteudo do anexo');
  const withFile = await send(ana, ch1.id, '', { attachments: [up] });
  for (let i = 0; i < 3; i++) await send(bia, ch1.id, 'msg da bia ' + i);
  for (let i = 0; i < 4; i++) await send(ana, ch2.id, 'no servidor da bia ' + i);
  for (let i = 0; i < 2; i++) await send(ana, dm.id, 'dm ' + i);
  await send(bia, dm.id, 'resposta da bia');
  await call(ana.tok, 'DELETE', `/guilds/${g2.id}/members/me`); // Ana sai do servidor da Bia

  // ---------- prévia ----------
  // 14 = 7 no servidor da Ana (sem a fixada) + 4 no da Bia + o aviso de entrada da Ana no #geral da Bia + 2 na DM
  const all = await call(ana.tok, 'POST', '/me/messages/scan', {});
  ok(all.total === 14 && all.pinnedKept === 1, 'prévia conta só as mensagens da Ana (sem a fixada)', { total: all.total, pinned: all.pinnedKept });
  const left = all.places.find(p => p.channel_id === ch2.id);
  ok(left?.count === 4 && left.left === true && left.guild === 'Servidor da Bia', 'inclui o servidor de que ela saiu, marcado', left);
  ok((await call(ana.tok, 'POST', '/me/messages/scan', { scope: 'dms' })).total === 2, 'só mensagens diretas');
  ok((await call(ana.tok, 'POST', '/me/messages/scan', { guild_id: g1.id })).total === 7, 'um servidor');
  ok((await call(ana.tok, 'POST', '/me/messages/scan', { guild_id: g1.id, keepPinned: false })).total === 8, 'sem manter as fixadas');
  ok((await call(ana.tok, 'POST', '/me/messages/scan', { contains: 'TURMA' })).total === 5, 'texto contido (sem diferenciar maiúsculas)');
  ok((await call(ana.tok, 'POST', '/me/messages/scan', { only: 'links' })).total === 1 && (await call(ana.tok, 'POST', '/me/messages/scan', { only: 'files' })).total === 1, 'só com links / só com arquivos');
  ok((await call(ana.tok, 'POST', '/me/messages/scan', { olderThanDays: 30 })).total === 0 && (await call(ana.tok, 'POST', '/me/messages/scan', { after: Date.now() - 3600e3 })).total === 14, 'período');
  ok((await call(ana.tok, 'POST', '/me/messages/delete', {})).status === 400, 'apagar sem prévia é recusado');
  const ex = await call(ana.tok, 'POST', '/me/messages/export', { scope: 'dms' });
  ok(ex.total === 2 && ex.mensagens[0].texto === 'dm 0' && ex.mensagens[0].lugar, 'cópia com texto e lugar', ex.mensagens?.[0]);

  // ---------- navegador da Bia (vê sumir ao vivo) e da Ana (a janela) ----------
  const page = async (tok) => { const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 }); p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; }); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 }); return p; };
  const B = await page(bia.tok);
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g1.id, ch1.id); await B.waitForSelector(`[data-mid="${withFile.id}"]`);

  // corte: mensagem enviada depois da prévia não entra
  const sc = await call(ana.tok, 'POST', '/me/messages/scan', { guild_id: g1.id });
  const late = await send(ana, ch1.id, 'enviada depois da prévia');
  const file = path.join(DATA, 'uploads', path.basename(up.url.split('/')[2]));
  const had = fs.existsSync(file);
  const del = await call(ana.tok, 'POST', '/me/messages/delete', { guild_id: g1.id, until: sc.until });
  ok(del.deleted === 7 && del.left === 0, 'apaga as 7 do servidor', del);
  const rest = await call(bia.tok, 'GET', `/channels/${ch1.id}/messages?limit=50`);
  ok(rest.some(m => m.id === late.id) && rest.some(m => m.id === pin.id) && rest.filter(m => m.author_id === bia.id).length === 3 && rest.length === 5, 'ficam: a fixada, a enviada depois da prévia e as da Bia', rest.map(m => m.content));
  await sleep(400);
  const bv = await B.evaluate((wid, pid) => ({ gone: !document.querySelector(`[data-mid="${wid}"]`), pin: !!document.querySelector(`[data-mid="${pid}"]`) }), withFile.id, pin.id);
  ok(bv.gone && bv.pin, 'a Bia vê as mensagens sumirem na hora (MESSAGE_DELETE_BULK)', bv);
  ok(had && !fs.existsSync(file), 'o arquivo anexado saiu do disco', { had });
  ok((await call(bia.tok, 'POST', '/me/messages/delete', { places: [ch2.id], until: Date.now() })).deleted === 0 && (await call(bia.tok, 'GET', `/channels/${ch2.id}/messages?limit=50`)).length >= 4, 'ninguém apaga mensagem dos outros (a Bia não apaga as da Ana)');

  const A = await page(ana.tok);
  await A.evaluate(async () => { const m = await import('/mymessages.js'); m.openMyMessages(); });
  await A.waitForFunction(() => /mensagens? em/.test(document.querySelector('.mm-total')?.textContent || ''), { timeout: 8000 });
  const ui = await A.evaluate(() => ({ total: document.querySelector('.mm-total').textContent, places: [...document.querySelectorAll('.mm-place')].map(x => x.textContent), btn: [...document.querySelectorAll('.modal .mf .btn.red')].pop().textContent }));
  ok(/^8 mensagens em 4 conversas/.test(ui.total) && ui.places.some(t => /você saiu do servidor/.test(t)) && /Apagar 8 mensagens/.test(ui.btn), 'janela mostra a contagem, as conversas e o servidor de que saiu', ui);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/01-janela.png` });
  // desmarca a DM e apaga o resto
  await A.evaluate(() => { const row = [...document.querySelectorAll('.mm-place')].find(x => /Mensagem direta/.test(x.textContent)); row.querySelector('input').click(); });
  ok(/Apagar 6 mensagens/.test(await A.evaluate(() => [...document.querySelectorAll('.modal .mf .btn.red')].pop().textContent)), 'desmarcar a conversa tira as mensagens dela da conta');
  await A.evaluate(() => [...document.querySelectorAll('.modal .mf .btn.red')].pop().click()); await sleep(300);
  await A.evaluate(() => [...document.querySelectorAll('.modal .mf .btn.red')].pop().click()); // confirmar
  await A.waitForFunction(() => /^2 mensagens em 1 conversa/.test(document.querySelector('.mm-total')?.textContent || ''), { timeout: 8000 });
  ok((await call(ana.tok, 'POST', '/me/messages/scan', {})).total === 2, 'apagou tudo menos a conversa desmarcada');
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/02-depois.png` });

  // ---------- GIFs: duas fontes ----------
  const meta = await call(ana.tok, 'GET', '/gifs/meta');
  ok(meta.providers?.map(p => p.name).join() === 'klipy,giphy', 'servidor com KLIPY e GIPHY', meta.providers);
  ok((await call(ana.tok, 'GET', '/gifs/trending?src=giphy')).source === 'giphy' && (await call(ana.tok, 'GET', '/gifs/trending')).source === 'klipy', 'cada pessoa escolhe a fonte (padrão KLIPY)');
  klipyDown = true;
  const fb = await call(ana.tok, 'GET', '/gifs/search?q=gato&src=klipy');
  ok(fb.source === 'giphy' && fb.fallback === 'klipy' && fb.gifs.length === 3, 'KLIPY fora do ar: a GIPHY responde e avisa', { source: fb.source, fallback: fb.fallback });
  klipyDown = false;
  await A.keyboard.press('Escape'); await A.evaluate(() => document.querySelectorAll('.backdrop').forEach(b => b.remove()));
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g1.id, ch1.id); await sleep(500);
  await A.click('#composer .extras-btn'); await A.click('.cx-pop .cx-opt[title="GIF"]'); await A.waitForSelector('.gifpicker .gcard img', { timeout: 8000 });
  const src1 = await A.evaluate(() => ({ btns: [...document.querySelectorAll('.gifpicker .gsrc button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), title: document.querySelector('.gifpicker .gcard')?.title }));
  ok(src1.btns.join() === 'KLIPY*,GIPHY' && /klipy/.test(src1.title), 'seletor mostra a troca de fonte', src1);
  await A.evaluate(() => [...document.querySelectorAll('.gifpicker .gsrc button')].find(b => b.textContent === 'GIPHY').click()); await sleep(800);
  const src2 = await A.evaluate((id) => ({ title: document.querySelector('.gifpicker .gcard')?.title, pref: window.__lc.S.prefs.gifSource }));
  ok(/giphy/.test(src2.title) && src2.pref === 'giphy', 'trocar para GIPHY recarrega e fica guardado', src2);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/03-gifs.png` });
} catch (e) { console.log('  ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); mock.close(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); process.exit(fails ? 1 : 0);
