// Gerenciador de armazenamento: seus envios por conversa/tipo, apagar mídias antigas em massa (fixadas e clipes ficam),
// expiração automática do servidor, permissões, órfãos do administrador, limpar o cache do aparelho sem sair da conta e
// a mensagem com "arquivo expirado". Uso: node scripts/storage-test.mjs (BROWSER=<caminho do Chrome/Edge>)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const PORT = 3293, BASE = `http://localhost:${PORT}`, DATA = './.testdata-storage';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = (u) => fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'Teste.senha-123' }) }).then(x => x.json());
const up = (tok, name, type, kb) => fetch(BASE + '/api/upload?name=' + encodeURIComponent(name), { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': type }, body: Buffer.alloc(kb * 1024, 7) }).then(r => r.json());
const onDisk = (url) => fs.existsSync(`${DATA}/uploads/${url.split('/')[2]}`);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' });
  const code = (await call(a.token, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.token, 'POST', '/invites/' + code);
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((tk) => { localStorage.lc_token = tk; }, a.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  const tch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);

  const vOld = await up(a.token, 'velho.mp4', 'video/mp4', 300), iOld = await up(a.token, 'foto.png', 'image/png', 120), vNew = await up(a.token, 'novo.webm', 'video/webm', 200);
  const vPin = await up(a.token, 'fixado.mp4', 'video/mp4', 100), bOld = await up(b.token, 'do-bruno.mp4', 'video/mp4', 250);
  const m1 = await call(a.token, 'POST', `/channels/${tch.id}/messages`, { content: 'antigo', attachments: [vOld, iOld] });
  await call(a.token, 'POST', `/channels/${tch.id}/messages`, { content: 'novo', attachments: [vNew] });
  const mp = await call(a.token, 'POST', `/channels/${tch.id}/messages`, { content: 'fixado', attachments: [vPin] });
  const mb = await call(b.token, 'POST', `/channels/${tch.id}/messages`, { content: 'bruno', attachments: [bOld] });
  await call(a.token, 'PUT', `/channels/${tch.id}/pins/${mp.id}`);
  // envelhece as mensagens "antigas" (60 dias)
  const db = new DatabaseSync(`${DATA}/resenha.db`); const old = Date.now() - 60 * 864e5;
  for (const id of [m1.id, mp.id, mb.id]) db.prepare('UPDATE messages SET created_at=? WHERE id=?').run(old, id);

  // --- seus envios ---
  let me = await call(a.token, 'GET', '/storage/me');
  ok(me.count === 4 && me.total === (300 + 120 + 200 + 100) * 1024, 'meus envios: 4 arquivos, total certo', { count: me.count, total: me.total });
  ok(me.kinds.video === 600 * 1024 && me.kinds.image === 120 * 1024, 'separado por tipo', me.kinds);
  ok(me.places.length === 1 && me.places[0].guild === 'Turma' && me.places[0].channel.startsWith('#'), 'por conversa', me.places[0]);
  ok(me.files[0].name === 'velho.mp4', 'maiores primeiro', me.files.map(f => f.name));

  let r = await call(a.token, 'POST', '/storage/me/delete', { olderThanDays: 30, kinds: ['video'] });
  ok(r.count === 1 && r.bytes === 300 * 1024, 'apagar vídeos +30 dias: só o velho (fixado fica, foto fica, novo fica)', r);
  ok(!onDisk(vOld.url) && onDisk(iOld.url) && onDisk(vPin.url) && onDisk(vNew.url) && onDisk(bOld.url), 'só o arquivo certo saiu do disco');
  const msg = db.prepare('SELECT attachments FROM messages WHERE id=?').get(m1.id);
  const atts = JSON.parse(msg.attachments);
  ok(atts[0].expired && !atts[0].url && atts[0].name === 'velho.mp4' && atts[1].url === iOld.url, 'mensagem fica com "arquivo expirado"', atts);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id); await sleep(800);
  ok(await p.$eval('#msgs', el => !!el.querySelector('.file.expired') && el.textContent.includes('Arquivo expirado')), 'chat mostra o arquivo expirado');
  ok((await call(b.token, 'POST', '/storage/me/delete', { items: [{ mid: m1.id, url: iOld.url }] })).count === 0, 'ninguém apaga arquivo dos outros pelos "meus envios"');

  // --- servidor ---
  ok((await call(b.token, 'GET', `/guilds/${g.id}/storage`)).status === 403, 'membro comum não vê o armazenamento do servidor');
  let gs = await call(a.token, 'GET', `/guilds/${g.id}/storage`);
  ok(gs.count === 4 && gs.members.length === 2, 'servidor: arquivos vivos e quem mais envia', { count: gs.count, members: gs.members });
  ok((await call(a.token, 'PUT', `/guilds/${g.id}/storage`, { mediaDays: 3 })).status === 400, 'expiração mínima de 7 dias');
  r = await call(a.token, 'PUT', `/guilds/${g.id}/storage`, { mediaDays: 30 });
  ok(r.mediaDays === 30 && r.count === 2, 'ativar 30 dias expira na hora a foto velha e o vídeo do bruno (fixado fica)', r);
  ok(!onDisk(bOld.url) && !onDisk(iOld.url) && onDisk(vPin.url) && onDisk(vNew.url), 'disco confere');
  gs = await call(a.token, 'GET', `/guilds/${g.id}/storage`);
  ok(gs.mediaDays === 30 && gs.count === 2, 'configuração gravada', { mediaDays: gs.mediaDays, count: gs.count });

  // --- administrador ---
  fs.writeFileSync(`${DATA}/uploads/0123456789abcdef01234567.bin`, Buffer.alloc(5000)); const t = new Date(Date.now() - 2 * 3600e3);
  fs.utimesSync(`${DATA}/uploads/0123456789abcdef01234567.bin`, t, t);
  ok((await call(b.token, 'GET', '/storage/instance')).status === 403, 'instalação: só o administrador');
  const inst = await call(a.token, 'GET', '/storage/instance');
  ok(inst.orphans.files === 1 && inst.orphans.bytes === 5000 && inst.guilds[0]?.name === 'Turma' && inst.disk?.free > 0, 'instalação: disco, servidores e 1 órfão', { orphans: inst.orphans, guilds: inst.guilds });
  r = await call(a.token, 'POST', '/storage/instance/orphans');
  ok(r.count === 1 && !fs.existsSync(`${DATA}/uploads/0123456789abcdef01234567.bin`) && onDisk(vNew.url), 'apagar órfãos não toca nos arquivos em uso', r);

  // --- aparelho ---
  const cs = await fetch(BASE + '/api/storage/clear-site-cache', { method: 'POST' });
  ok(cs.headers.get('clear-site-data') === '"cache"', 'limpar mídias do aparelho: Clear-Site-Data só do cache (login fica)');

  // --- tela ---
  await p.evaluate(() => window.__lc.openSettings('storage')); await sleep(1500);
  const txt = await p.$eval('#settings .stgpage', el => el.textContent);
  ok(txt.includes('Neste aparelho') && txt.includes('Seus envios no servidor') && txt.includes('Servidores que você gerencia') && txt.includes('Instalação (administrador)'), 'página Armazenamento com todas as partes');
  ok(await p.$$eval('#settings .stg-file', els => els.length) === 2, 'lista os 2 arquivos que sobraram');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: false });
  await p.evaluate(() => { localStorage.lc_test_marker = '1'; });
  await p.evaluate(() => [...document.querySelectorAll('#settings .btn')].find(b => b.textContent.includes('Limpar')).click()); await sleep(800);
  ok(await p.evaluate(() => !!localStorage.lc_token && localStorage.lc_test_marker === '1'), 'limpar no aparelho não desloga');
  await p.evaluate(() => document.querySelector('#settings .stg-files input').click()); await sleep(200);
  await p.evaluate(() => [...document.querySelectorAll('#settings .btn.red')].find(b => /escolhido/.test(b.textContent)).click()); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('.backdrop .btn')].find(b => b.textContent === 'Apagar').click()); await sleep(1200);
  ok(await p.$$eval('#settings .stg-file', els => els.length) === 1, 'apagar um arquivo escolhido pela lista');
} finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
