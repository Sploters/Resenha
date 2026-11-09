// Três melhorias (servidor real + 2 navegadores):
// 1) Aba Arquivos: anexos e links de um servidor/DM por tipo, com filtros de pessoa, período, canal e nome; paginação;
//    grade na tela com abas e contagens; limite de upload padrão de 500 MB.
// 2) Sincronização entre aparelhos: "lido" num aparelho chega na hora no outro (READ_STATE), a não lida some, a
//    notificação daquela conversa fecha; com outro aparelho em uso, este fica em silêncio; configurações (buscas
//    recentes) aparecem no outro aparelho sem recarregar.
// 3) Reputação: 3 pessoas diferentes marcam mensagens de um troll em 10 min → soft-mute (1 mensagem a cada 2 min) até a
//    moderação analisar; contas novas e o próprio autor não contam; moderador vê o caso e libera (falso alarme).
// Uso: BROWSER=/caminho/do/chrome node scripts/sync-rep-files-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const PORT = 3283, BASE = `http://localhost:${PORT}`, DATA = './.testdata-srf';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', MAX_UPLOAD_MB: '' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const raw = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined });
const call = (tok, m, p, b) => raw(tok, m, p, b).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const up = (tok, name, type, kb = 2) => fetch(BASE + '/api/upload?name=' + encodeURIComponent(name), { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': type }, body: Buffer.alloc(kb * 1024, 7) }).then(r => r.json());
const send = (tok, cid, content, atts = []) => call(tok, 'POST', `/channels/${cid}/messages`, { content, attachments: atts });

let browser;
try {
  const info = await call('', 'GET', '/server-info');
  ok(info.max_upload === 500 * 1048576, 'limite de upload padrão agora é 500 MB', info.max_upload / 1048576);

  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla'), d = await reg('davi'), t = await reg('troll'), n = await reg('novato');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Estudos' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c, d, t, n]) await call(u.tok, 'POST', '/invites/' + code);
  const text = (() => { const x = new DatabaseSync(DATA + '/resenha.db'); try { return x.prepare('SELECT id FROM channels WHERE guild_id=? AND type=0 ORDER BY position LIMIT 1').get(g.id).id; } finally { x.close(); } })();
  const softOf = (uid) => { const x = new DatabaseSync(DATA + '/resenha.db'); try { return x.prepare('SELECT softmute_until t FROM members WHERE guild_id=? AND user_id=?').get(g.id, uid)?.t || null; } finally { x.close(); } };
  const ch2 = await call(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'materiais', type: 0 });

  // ---------------- 1) Arquivos ----------------
  const pdf = await up(b.tok, 'Apostila de Cálculo.pdf', 'application/pdf'), png = await up(c.tok, 'quadro.png', 'image/png'), mp3 = await up(b.tok, 'aula.mp3', 'audio/mpeg'), zip = await up(c.tok, 'projeto.zip', 'application/zip');
  await send(b.tok, ch2.id, 'segue a apostila', [{ ...pdf, name: 'Apostila de Cálculo.pdf', type: 'application/pdf' }]);
  await send(c.tok, text, 'foto do quadro e o vídeo https://www.youtube.com/watch?v=abc123 (link)', [{ ...png, name: 'quadro.png', type: 'image/png' }]);
  await send(b.tok, text, 'gravação', [{ ...mp3, name: 'aula.mp3', type: 'audio/mpeg' }, { ...zip, name: 'projeto.zip', type: 'application/zip' }]);
  for (let i = 0; i < 7; i++) { await send(d.tok, text, 'links: ' + Array.from({ length: 10 }, (_, k) => `https://exemplo.com/p/${i * 10 + k}`).join(' ')); await sleep(900); } // 10 links por mensagem (o limite de rajada é 5 mensagens)
  const all1 = await call(a.tok, 'GET', `/media?guild=${g.id}&counts=1`);
  ok(all1.items.length === 60 && all1.next, 'primeira página: 60 itens e cursor para a próxima', { n: all1.items.length, next: !!all1.next });
  ok(all1.counts && all1.counts.image === 1 && all1.counts.doc === 1 && all1.counts.audio === 1 && all1.counts.file === 1 && all1.counts.link === 71, 'contagem por tipo', all1.counts);
  const p2 = await call(a.tok, 'GET', `/media?guild=${g.id}&before=${all1.next}`);
  ok(p2.items.length === 15 && !p2.next, 'segunda página traz o resto (75 no total)', { n: p2.items.length, next: p2.next });
  const docs = await call(a.tok, 'GET', `/media?guild=${g.id}&kind=doc`);
  ok(docs.items.length === 1 && docs.items[0].name === 'Apostila de Cálculo.pdf' && docs.items[0].channel_id === ch2.id, 'filtro Documentos acha o PDF de outro canal', docs.items.map(x => x.name));
  const byB = await call(a.tok, 'GET', `/media?guild=${g.id}&author=${b.id}`);
  ok(byB.items.length === 3 && byB.items.every(x => x.author_id === b.id), 'filtro de quem enviou', byB.items.map(x => x.name));
  const q = await call(a.tok, 'GET', `/media?guild=${g.id}&q=apostila`);
  ok(q.items.length === 1, 'busca pelo nome do arquivo', q.items.map(x => x.name));
  const yt = await call(a.tok, 'GET', `/media?guild=${g.id}&kind=link&q=youtube`);
  ok(yt.items.length === 1 && yt.items[0].url === 'https://www.youtube.com/watch?v=abc123' && yt.items[0].host === 'youtube.com', 'links: tira a pontuação do fim e mostra o site', yt.items[0]);
  const fut = await call(a.tok, 'GET', `/media?guild=${g.id}&since=${Date.now() + 60e3}`);
  ok(fut.items.length === 0, 'filtro de período');
  const onlyCh = await call(a.tok, 'GET', `/media?guild=${g.id}&channel=${ch2.id}`);
  ok(onlyCh.items.length === 1, 'filtro de canal', onlyCh.items.length);
  const out = await reg('fora'); const denied = await raw(out.tok, 'GET', `/media?guild=${g.id}`);
  ok(denied.status === 404, 'quem não é do servidor não vê os arquivos', denied.status);
  const dm = await call(a.tok, 'POST', '/dms', { user_id: b.id });
  await send(b.tok, dm.id, 'resumo', [{ ...pdf, name: 'resumo.pdf', type: 'application/pdf' }]);
  const dmm = await call(a.tok, 'GET', `/media?channel=${dm.id}`);
  ok(dmm.items.length === 1 && dmm.items[0].name === 'resumo.pdf', 'aba Arquivos da DM', dmm.items.map(x => x.name));
  ok((await raw(c.tok, 'GET', `/media?channel=${dm.id}`)).status === 404, 'DM de outros: sem acesso');

  // ---------------- 3) Reputação (API) ----------------
  // "novato" acabou de entrar: não conta. Os demais entraram "há 1 hora" (ajusta no banco do teste).
  const db = new DatabaseSync(DATA + '/resenha.db');
  db.prepare('UPDATE members SET joined_at=? WHERE guild_id=? AND user_id<>?').run(Date.now() - 3600e3, g.id, n.id);
  db.close();
  const tm = [];
  for (let i = 0; i < 3; i++) tm.push(await send(t.tok, text, `SPAM SPAM compre já ${i}`));
  const fl = (u, m, kind = 'spam') => call(u.tok, 'POST', `/channels/${text}/messages/${m.id}/flag`, { kind });
  ok((await fl(t, tm[0])).error, 'não dá para marcar a própria mensagem');
  await fl(b, tm[0]); await fl(b, tm[1]); // a mesma pessoa duas vezes = 1 voto
  await fl(n, tm[0]); // conta nova: não conta
  let mem = { softmute_until: softOf(t.id) };
  ok(!mem.softmute_until, 'um voto repetido + uma conta nova ainda não limitam', mem.softmute_until);
  await fl(c, tm[1], 'toxic');
  const r3 = await fl(d, tm[2]);
  ok(!!r3.case_id, 'terceira pessoa diferente: abre o caso', r3);
  mem = { softmute_until: softOf(t.id) };
  ok(mem.softmute_until > Date.now(), 'troll limitado (soft-mute), não banido', mem.softmute_until);
  const s1 = await raw(t.tok, 'POST', `/channels/${text}/messages`, { content: 'mais spam' }), j1 = await s1.json();
  ok(s1.status === 429 && j1.softmute && j1.retry_after > 60, 'logo depois: envio barrado com o tempo de espera', { status: s1.status, ...j1 });
  const am = await raw(a.tok, 'POST', `/channels/${text}/messages`, { content: 'oi pessoal' });
  ok(am.status === 200, 'os outros continuam falando normal');
  // moderador (dono) vê o caso com as mensagens marcadas
  const cases = await call(a.tok, 'GET', `/guilds/${g.id}/reputation`);
  ok(cases.open.length === 1 && cases.open[0].user_id === t.id && cases.open[0].flaggers === 3 && cases.open[0].messages.length === 3, 'fila da moderação: caso aberto com 3 pessoas e as mensagens', { open: cases.open.length, f: cases.open[0]?.flaggers, msgs: cases.open[0]?.messages?.length });
  ok((await raw(b.tok, 'GET', `/guilds/${g.id}/reputation`)).status === 403, 'membro comum não vê a fila');
  const audit = await call(a.tok, 'GET', `/guilds/${g.id}/audit`);
  ok(audit.entries.some(e => e.action === 'member_softmute' && e.target_id === t.id && !e.actor_id), 'registro de auditoria: limite automático', audit.entries.map(e => e.action));
  // ---------------- 2) + 3) nos navegadores ----------------
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  async function page(tok, ua) {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => {
      localStorage.lc_token = t;
      // notificações do sistema: registra o que foi mostrado/fechado
      window.__notifs = [];
      window.Notification = class { constructor(title, o) { this.title = title; this.tag = o?.tag; this.closed = false; window.__notifs.push(this); } close() { this.closed = true; this.onclose?.(); } static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
    }, tok);
    await ctx.overridePermissions(BASE, ['notifications']);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
    return p;
  }
  const PC = await page(a.tok), PHONE = await page(a.tok);
  await sleep(800);
  // o celular está parado: sem foco
  await PHONE.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  // PC em uso (foco + mexendo)
  await PC.bringToFront(); await PC.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
  await PC.mouse.click(700, 450); await sleep(600);
  const devs = await PHONE.evaluate(() => window.__lc.S.devices);
  ok(devs.length === 1 && devs[0].kind === 'web', 'o celular sabe que o PC está em uso', devs);
  // menção para alice: no PC (em uso) conta; no celular fica em silêncio
  await send(b.tok, dm.id, `<@${a.id}> viu o resumo?`); await sleep(600);
  const ph1 = await PHONE.evaluate((cid) => ({ unread: !!window.__lc.S.unread[cid], notifs: window.__notifs.length }), dm.id);
  ok(ph1.unread && ph1.notifs === 0, 'PC em uso: no celular a mensagem conta como não lida, sem notificação', ph1);
  // PC sai do foco: agora o celular avisa
  await PC.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); }); await sleep(600);
  await send(b.tok, dm.id, `<@${a.id}> e aí?`); await sleep(600);
  const ph2 = await PHONE.evaluate(() => window.__notifs.map(n => ({ t: n.title, tag: n.tag, closed: n.closed })));
  ok(ph2.length === 1 && !ph2[0].closed && ph2[0].tag === 'lc-' + dm.id, 'ninguém usando o PC: o celular mostra a notificação', ph2);
  // lê no PC: o celular tira a não lida e fecha a notificação na hora
  await PC.bringToFront(); await PC.evaluate((cid) => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); window.__lc.go('@me', cid); }, dm.id);
  await sleep(900);
  const ph3 = await PHONE.evaluate((cid) => ({ unread: !!window.__lc.S.unread[cid], mention: !!window.__lc.S.mentions[cid], closed: window.__notifs.every(n => n.closed), title: document.title }), dm.id);
  ok(!ph3.unread && !ph3.mention && ph3.closed && !/^\(/.test(ph3.title), 'lido no PC: no celular some a não lida, o número e a notificação (sem fantasma)', ph3);
  // configurações: busca feita no PC aparece como recente no celular sem recarregar
  await PC.evaluate(async () => { const m = await window.__lc.import('state.js'); window.__lc.S.prefs.recentSearches = ['apostila cálculo']; m.savePrefs(); });
  await sleep(2200);
  ok(await PHONE.evaluate(() => (window.__lc.S.prefs.recentSearches || [])[0]) === 'apostila cálculo', 'busca recente do PC chega no celular na hora (configurações sincronizadas)');

  // ---- aba Arquivos na tela ----
  await PC.evaluate((gid) => window.__lc.go(gid, 'files'), g.id);
  await PC.waitForSelector('#filesview .fv-tile', { timeout: 8000 });
  const ui = await PC.evaluate(() => ({ tabs: [...document.querySelectorAll('#filesview .fv-tab')].map(t => t.textContent), tiles: document.querySelectorAll('#filesview .fv-tile').length, row: !!document.querySelector('#side-list .filesrow.active'), limit: document.querySelector('#filesview .fv-limit')?.textContent }));
  ok(ui.row && ui.tiles >= 60 && ui.tabs.some(t => /^Documentos1$/.test(t)) && ui.tabs.some(t => /^Links71$/.test(t)), 'tela Arquivos: item na lista de canais, abas com contagem e grade', ui);
  ok(/500 MB/.test(ui.limit || ''), 'mostra o limite por arquivo', ui.limit);
  await PC.evaluate(() => [...document.querySelectorAll('#filesview .fv-tab')].find(t => t.textContent.startsWith('Documentos')).click());
  await PC.waitForFunction(() => document.querySelectorAll('#filesview .fv-tile').length === 1, { timeout: 5000 }).catch(() => { });
  ok(await PC.evaluate(() => document.querySelector('#filesview .fv-tile b')?.textContent) === 'Apostila de Cálculo.pdf', 'aba Documentos mostra o PDF');
  await PC.evaluate(() => [...document.querySelectorAll('#filesview .fv-tab')].find(t => t.textContent.startsWith('Tudo')).click()); await sleep(800);
  await PC.screenshot({ path: '.testshots/files-tab.png' });

  // ---- reputação na tela: troll vê o aviso; moderador libera ----
  const TR = await page(t.tok);
  await TR.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text); await sleep(800);
  const bar = await TR.evaluate(() => { const b = document.querySelector('#softmute-bar'); return b && !b.classList.contains('hidden') ? b.textContent : null; });
  ok(/Envio limitado pela comunidade/.test(bar || ''), 'quem foi limitado vê o aviso acima do campo de mensagem', bar);
  await TR.screenshot({ path: '.testshots/softmute-bar.png' });
  // bruno marca pela tela: a mensagem some para ele
  const BR = await page(b.tok);
  await BR.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text); await sleep(900);
  const extra = await send(a.tok, text, 'mensagem qualquer da alice'); await sleep(400);
  await BR.evaluate((mid) => { const el = document.querySelector(`[data-mid="${mid}"]`); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 400 })); }, extra.id);
  await sleep(200);
  await BR.evaluate(() => [...document.querySelectorAll('.menu .it')].find(i => i.textContent === 'Marcar como spam').click()); await sleep(600);
  ok(await BR.evaluate((mid) => !!document.querySelector(`.msg.flagged[data-mid="${mid}"]`), extra.id), 'marcar como spam esconde a mensagem para quem marcou');
  // dono resolve como falso alarme
  await PC.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(300);
  const r = await call(a.tok, 'POST', `/guilds/${g.id}/reputation/${t.id}/resolve`, { action: 'clear' });
  ok(r && !r.error, 'moderador libera (falso alarme)', r); await sleep(500);
  ok(await TR.evaluate(() => document.querySelector('#softmute-bar')?.classList.contains('hidden')), 'o aviso some na hora para quem estava limitado');
  ok((await raw(t.tok, 'POST', `/channels/${text}/messages`, { content: 'desculpa' })).status === 200, 'depois de liberado, envia normalmente');
  const after = await call(a.tok, 'GET', `/guilds/${g.id}/reputation`);
  ok(after.open.length === 0 && after.closed[0]?.state === 'cleared', 'caso fica no histórico como falso alarme', after.closed[0]?.state);
  // os mesmos votos não limitam de novo depois de liberado
  await fl(c, tm[2]);
  mem = { softmute_until: softOf(t.id) };
  ok(!mem.softmute_until, 'votos de antes da liberação não voltam a limitar');
} catch (e) { console.log('ERRO', e); fails++; }
await browser?.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
