// Ideias do Stoat, lote 3 (aba Discussões do GitHub do Stoat), servidor real + navegador:
// - #1254 notificações: número/ponto no ícone (título, favicon), piscar a barra de tarefas, som com o aviso
// - #1027 tipos de canal: anúncios (só a moderação escreve), galeria (post = foto/vídeo, grade) e documento (markdown com tarefas)
// - #1231 mídia favorita: qualquer arquivo, abas e categorias com nome; arquivo favoritado não some do disco
// - #1374 spoiler no anexo, "Esconder mídia até clicar" e "GIFs parados"
// - #1355 importar conversa do Discord (JSON/HTML/TXT do DiscordChatExporter) com data original e desfazer
// Uso: BROWSER=/caminho/do/chrome node scripts/stoat3-test.mjs   (SHOTS=1 salva capturas em .testshots/stoat3)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3297, BASE = `http://localhost:${PORT}`, DATA = './.testdata-stoat3', OUT = '.testshots/stoat3';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = (p, n) => process.env.SHOTS && p.screenshot({ path: `${OUT}/${n}.png` });
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', TRANSLATE: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const befriend = async (x, y, yname) => { await call(x.tok, 'POST', '/relationships', { username: yname }); await call(y.tok, 'PUT', `/relationships/${x.id}`, {}); };
// PNG 1x1 e GIF 1x1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const upload = (tok, name, buf) => fetch(`${BASE}/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/octet-stream' }, body: buf }).then(r => r.json());

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio');
  await befriend(ana, bia, 'bia');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' });
  const inv = await call(ana.tok, 'POST', `/guilds/${g.id}/invites`, {});
  await call(bia.tok, 'POST', `/invites/${inv.code}`, {}); await call(caio.tok, 'POST', `/invites/${inv.code}`, {});
  const dm = await call(ana.tok, 'POST', '/dms', { user_id: bia.id });

  // ---------- #1027 tipos de canal ----------
  const ann = await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Avisos Gerais', type: 5 });
  const gal = await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Fotos', type: 16 });
  const doc = await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Regras', type: 17 });
  ok(ann.id && gal.id && doc.id, 'cria canais de anúncios, galeria e documento');
  ok((await call(bia.tok, 'POST', `/channels/${ann.id}/messages`, { content: 'oi' })).status === 403, 'anúncios: membro comum não escreve');
  ok((await call(ana.tok, 'POST', `/channels/${ann.id}/messages`, { content: 'Aviso importante' })).id, 'anúncios: a dona escreve');
  ok(await call(bia.tok, 'GET', `/channels/${ann.id}/messages`).then(l => l.length === 1), 'anúncios: membro comum lê');
  ok((await call(bia.tok, 'POST', `/channels/${gal.id}/messages`, { content: 'só texto' })).status === 400, 'galeria: post sem foto/vídeo é recusado');
  const up1 = await upload(bia.tok, 'praia.png', PNG);
  const post = await call(bia.tok, 'POST', `/channels/${gal.id}/messages`, { content: 'Praia!', attachments: [{ ...up1, spoiler: true }] });
  ok(post.id && post.attachments?.[0]?.spoiler === true, 'galeria: post com foto e spoiler no anexo', post.attachments?.[0]);
  ok((await call(caio.tok, 'POST', `/channels/${gal.id}/messages`, { content: 'que lindo', reply_to: post.id })).id, 'galeria: comentário (resposta) só com texto');
  ok((await call(ana.tok, 'POST', `/channels/${doc.id}/messages`, { content: 'x' })).status === 400, 'documento não recebe mensagens');
  let d = await call(bia.tok, 'GET', `/channels/${doc.id}/doc`);
  ok(d.content === '' && d.v === 0 && d.can_edit === false, 'documento: começa vazio; membro comum só lê', d);
  ok((await call(bia.tok, 'PUT', `/channels/${doc.id}/doc`, { content: 'hack', v: 0 })).status === 403, 'documento: membro comum não edita');
  d = await call(ana.tok, 'PUT', `/channels/${doc.id}/doc`, { content: '# Regras\n\n- [ ] Ler as regras\n- [ ] Dar oi', v: 0 });
  ok(d.v === 1, 'documento: dona salva (versão 1)');
  const stale = await call(ana.tok, 'PUT', `/channels/${doc.id}/doc`, { content: 'outra', v: 0 });
  ok(stale.status === 409 && stale.doc?.v === 1, 'documento: salvar em cima de versão velha devolve 409 com a atual');
  const ready = await call(bia.tok, 'GET', `/guilds/${g.id}`);
  const docCh = (ready.channels || []).find(c => c.id === doc.id);
  ok(!docCh || docCh.doc === undefined, 'texto do documento não vai junto com a lista de canais');

  // ---------- #1231 mídia favorita ----------
  const up2 = await upload(ana.tok, 'meme.png', PNG), up3 = await upload(ana.tok, 'dança.gif', GIF);
  const m2 = await call(ana.tok, 'POST', `/channels/${dm.id}/messages`, { content: '', attachments: [up2, up3] });
  ok((await call(bia.tok, 'PUT', '/media-favs', { url: up2.url, name: up2.name, type: up2.type, size: up2.size })).kind === 'image', 'favorita uma imagem (aba Imagens)');
  ok((await call(bia.tok, 'PUT', '/media-favs', { url: up3.url, name: up3.name, type: up3.type })).kind === 'gif', 'GIF enviado como arquivo vai para a aba GIFs');
  ok((await call(bia.tok, 'POST', '/media-favs/cats', { kind: 'image', name: 'Reações' })).status === 200, 'cria categoria "Reações"');
  ok((await call(bia.tok, 'PUT', '/media-favs', { url: up2.url, cat: 'Reações' })).status === 200, 'põe a imagem na categoria');
  ok((await call(bia.tok, 'PUT', '/media-favs', { url: up2.url, cat: 'Não existe' })).status === 400, 'categoria inexistente é recusada');
  await call(bia.tok, 'POST', '/media-favs/cats', { kind: 'image', name: 'Reações', to: 'Memes' });
  let mf = await call(bia.tok, 'GET', '/media-favs');
  ok(mf.favs.find(f => f.url === up2.url)?.cat === 'Memes' && mf.cats.some(c => c.name === 'Memes'), 'renomear a categoria leva a mídia junto', mf.favs.map(f => f.cat));
  await call(ana.tok, 'DELETE', `/channels/${dm.id}/messages/${m2.id}`); await sleep(200);
  ok((await fetch(BASE + up2.url)).status === 200, 'mensagem apagada: o arquivo favoritado continua no servidor');
  ok((await fetch(BASE + up3.url)).status === 200, 'o GIF favoritado também');
  const resent = await call(bia.tok, 'POST', `/channels/${dm.id}/messages`, { content: '', attachments: [{ url: up2.url, name: up2.name, size: up2.size, type: up2.type }] });
  ok(resent.attachments?.[0]?.url === up2.url, 'manda a mídia favorita de novo sem subir outra vez');
  await call(bia.tok, 'DELETE', `/channels/${dm.id}/messages/${resent.id}`);
  await call(bia.tok, 'DELETE', '/media-favs', { url: up3.url }); await sleep(300);
  ok((await fetch(BASE + up3.url)).status === 404, 'tirou dos favoritos e ninguém mais usa: o arquivo é apagado');

  // ---------- #1355 importar do Discord ----------
  const t0 = Date.UTC(2023, 4, 10, 15, 0, 0), snow = (t) => ((BigInt(t) - 1420070400000n) << 22n).toString();
  const msgs = [
    { discord_id: snow(t0), name: 'ana_discord', content: 'oi bia, tudo bem? <@123456789012345678>', as: 'me' },
    { discord_id: snow(t0 + 60000), name: 'biazinha', content: 'tudo e vc', as: 'peer' },
    { ts: t0 + 120000, name: 'Robô do Discord', content: 'mensagem de bot', files: ['https://cdn.discordapp.com/attachments/1/2/foto.png'] },
    { ts: Date.now() + 86400e3, name: 'x', content: 'do futuro (fica de fora)' },
  ];
  ok((await call(caio.tok, 'POST', `/channels/${gal.id}/import`, { messages: msgs })).status === 403, 'importar num servidor exige gerenciar canais');
  const imp = await call(ana.tok, 'POST', `/channels/${dm.id}/import`, { source: 'discord', messages: msgs });
  ok(imp.added === 3 && imp.batch, 'importa 3 mensagens (a com data inválida fica de fora)', imp);
  const fin = await call(ana.tok, 'POST', `/channels/${dm.id}/import/${imp.batch}/finish`);
  ok(fin.count === 3, 'termina a importação');
  const hist = await call(bia.tok, 'GET', `/channels/${dm.id}/messages?limit=50`);
  const im = hist.filter(m => m.imported);
  ok(im.length === 3 && im[0].created_at === t0 && im[0].author_id === ana.id && im[1].author_id === bia.id, 'mensagens com a data original e o autor escolhido', im.map(m => [m.created_at, m.author_id === ana.id ? 'ana' : m.author_id === bia.id ? 'bia' : '?']));
  ok(im[2].imported.n === 'Robô do Discord' && im[2].content.includes('cdn.discordapp.com'), 'quem não é daqui fica com o nome do Discord e o link do anexo');
  ok(!im[0].content.includes('<@'), 'menção do Discord vira texto', im[0].content);
  ok(hist.indexOf(im[0]) < hist.findIndex(m => !m.imported), 'importadas entram antes das mensagens de agora');
  ok(hist.some(m => m.type === 1 && /importou 3 mensagens do Discord/.test(m.content)), 'aviso de resumo na conversa');
  const list = await call(bia.tok, 'GET', `/channels/${dm.id}/imports`);
  ok(list.length === 1 && list[0].can_undo, 'a outra pessoa da conversa vê e pode desfazer');

  // ---------- navegador ----------
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.goto(BASE); await p.evaluate((t) => { localStorage.lc_token = t; }, bia.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 }); await sleep(400);

  // galeria em grade
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, gal.id);
  await p.waitForSelector('.gal-card', { timeout: 5000 }).catch(() => { });
  ok(await p.$$eval('.gal-card', l => l.length) === 1, 'galeria mostra 1 post em grade (o comentário não vira card)');
  ok(await p.$('.gal-card .mcover.spoil') != null, 'post com spoiler aparece coberto');
  await shot(p, '1-galeria');
  // a troca de tela tem animação (View Transition, ~280 ms): durante ela o clique cai na camada da transição, não na
  // galeria. Espera a capa receber clique de verdade (antes o teste clicava no meio da animação e falhava sempre)
  await p.waitForFunction(() => { const c = document.querySelector('.gal-card .mcover'); if (!c) return false; const r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, { timeout: 5000, polling: 50 }).catch(() => { });
  await p.click('.gal-card .mcover'); await sleep(150);
  ok(await p.$('.gal-card .mcover') == null && !(await p.$('.gal-modal')), 'primeiro clique no spoiler só revela a foto');
  await p.click('.gal-card'); await p.waitForSelector('.gal-modal .gal-comment', { timeout: 4000 }).catch(() => { });
  ok((await p.$$eval('.gal-modal .gal-comment', l => l.length)) === 1, 'post aberto mostra o comentário');
  await shot(p, '2-post');
  await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.backdrop').forEach(b => b.remove()));

  // documento: bia só lê; ana marca a tarefa ao vivo
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, doc.id);
  await p.waitForSelector('.doc-task', { timeout: 5000 }).catch(() => { });
  ok(await p.$$eval('.doc-task input', l => l.length === 2 && l.every(i => i.disabled)), 'documento: tarefas em caixinhas, travadas para quem só lê');
  const cur = await call(ana.tok, 'GET', `/channels/${doc.id}/doc`);
  await call(ana.tok, 'PUT', `/channels/${doc.id}/doc`, { content: cur.content.replace('- [ ] Ler', '- [x] Ler'), v: cur.v });
  await p.waitForSelector('.doc-task.done', { timeout: 4000 }).catch(() => { });
  ok(await p.$('.doc-task.done') != null, 'documento atualiza ao vivo quando a moderação marca uma tarefa');
  await shot(p, '3-documento');

  // anúncios: ícone e campo travado
  ok(await p.evaluate((cid) => !!document.querySelector(`.ch[data-cid="${cid}"], .ch`)?.isConnected, ann.id), 'canais na lateral');
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ann.id); await sleep(500);
  ok(await p.evaluate(() => !document.querySelector('#composer textarea') || document.querySelector('#composer textarea').disabled || !!document.querySelector('.noperm, .composer-noperm, [class*="noperm"]')), 'anúncios: campo de mensagem travado para membro comum');

  // importadas na DM com marca "Discord" e nome original
  await p.evaluate((cid) => window.__lc.go('@me', cid), dm.id);
  await p.waitForSelector('.imp-tag', { timeout: 5000 }).catch(() => { });
  ok(await p.$$eval('.imp-tag', l => l.length) >= 2, 'mensagens importadas com a marca "Discord"');
  ok(await p.$$eval('.imp-author', l => l.some(x => x.textContent === 'Robô do Discord')), 'nome original de quem não é daqui');
  await shot(p, '4-importadas');

  // leitura dos formatos do DiscordChatExporter (no aparelho)
  const parsed = await p.evaluate(async () => {
    const { parseExport } = await window.__lc.import('importer.js');
    const json = JSON.stringify({ messages: [{ id: '1105850470474297344', type: 'Default', timestamp: '2023-05-10T15:00:00+00:00', content: 'oi', author: { name: 'ana', nickname: 'Ana' }, attachments: [{ url: 'https://cdn.discordapp.com/a.png' }] },
      { id: '1105850722094796800', type: 'Reply', timestamp: '2023-05-10T15:01:00+00:00', content: 'olá', author: { name: 'bia' }, reference: { messageId: '1105850470474297344' }, attachments: [] },
      { id: '1105850722094796801', type: 'ChannelPinnedMessage', timestamp: '2023-05-10T15:01:00+00:00', content: '', author: { name: 'bia' } }] });
    const html = `<!DOCTYPE html><html><body><div class="chatlog__message-group"><div class="chatlog__message-container" data-message-id="1105850470474297344"><div class="chatlog__message"><span class="chatlog__author" title="ana">Ana</span><div class="chatlog__content chatlog__markdown"><span class="chatlog__markdown-preserve">oi do html</span></div></div></div>
      <div class="chatlog__message-container" data-message-id="1105850722094796800"><div class="chatlog__content chatlog__markdown"><span class="chatlog__markdown-preserve">segunda</span></div><div class="chatlog__attachment"><a href="https://cdn.discordapp.com/b.png">b</a></div></div></div></body></html>`;
    const txt = '==============================================================\nGuild: Direct Messages\nChannel: Private / bia\n==============================================================\n\n[15/11/2023 13:05] Ana\noi do txt\nsegunda linha\n\n{Attachments}\nhttps://cdn.discordapp.com/c.png\n\n[15/11/2023 13:06] bia\nresposta\n\n';
    const j = parseExport('c.json', json), hh = parseExport('c.html', html), t = parseExport('c.txt', txt);
    return { j: j.list.map(m => [m.name, m.content, m.files.length, m.reply_name || '']), jts: j.list[0].ts, h: hh.list.map(m => [m.name, m.content, m.files.length, m.ts]), t: t.list.map(m => [m.name, m.content, m.files.length, new Date(m.ts).getDate(), new Date(m.ts).getMonth() + 1]) };
  });
  ok(JSON.stringify(parsed.j) === JSON.stringify([['Ana', 'oi', 1, ''], ['bia', 'olá', 0, 'Ana']]) && parsed.jts === Date.UTC(2023, 4, 10, 15), 'lê o JSON (apelido, anexos, resposta; ignora aviso de fixar)', parsed.j);
  ok(parsed.h.length === 2 && parsed.h[0][0] === 'Ana' && parsed.h[1][0] === 'Ana' && parsed.h[1][2] === 1 && parsed.h[0][3] > 1.6e12, 'lê o HTML (autor do grupo, data pelo id, anexo)', parsed.h);
  ok(JSON.stringify(parsed.t) === JSON.stringify([['Ana', 'oi do txt\nsegunda linha', 1, 15, 11], ['bia', 'resposta', 0, 15, 11]]), 'lê o TXT (várias linhas, anexos, data dia/mês)', parsed.t);

  // #1374: esconder mídia até clicar e GIFs parados
  await call(ana.tok, 'POST', `/channels/${dm.id}/messages`, { content: '', attachments: [up2] });
  await p.evaluate(() => { window.__lc.S.prefs.mediaHide = 'all'; window.__lc.savePrefs(); window.__lc.renderMessages(true); }); await sleep(500);
  const covered = await p.$$eval('#msgs .mcover:not(.spoil)', l => l.length);
  ok(covered >= 1, 'Esconder em todo lugar: a foto vem coberta', covered);
  ok(await p.$$eval('#msgs .mcover:not(.spoil) .mc-under', l => l.every(u => !u.querySelector('img'))), 'mídia escondida não carrega nada por baixo');
  await p.click('#msgs .mcover:not(.spoil)'); await sleep(200);
  ok(await p.$$eval('#msgs .mcover:not(.spoil)', l => l.length) === covered - 1, 'clicar mostra a mídia');
  await p.evaluate(() => { window.__lc.S.prefs.mediaHide = 'off'; window.__lc.S.prefs.gifFreeze = true; window.__lc.savePrefs(); });
  const gifUp = await upload(ana.tok, 'pula.gif', GIF);
  await call(ana.tok, 'POST', `/channels/${dm.id}/messages`, { content: '', attachments: [gifUp] });
  await p.waitForFunction(() => document.querySelector('#msgs .giftile.paused img')?.src?.startsWith('data:'), { timeout: 5000 }).catch(() => { });
  ok(await p.evaluate(() => !!document.querySelector('#msgs .giftile.paused img')?.src?.startsWith('data:')), 'GIFs parados: GIF enviado mostra o quadro parado');
  await p.hover('#msgs .giftile img'); await sleep(150);
  ok(await p.evaluate(() => /\/files\//.test(document.querySelector('#msgs .giftile img').src)), 'com o mouse em cima o GIF anima');
  await shot(p, '5-gif-parado');

  // #1231 seletor de mídia favorita
  await p.evaluate(() => document.querySelector('.extras-btn').click()); await sleep(200);
  await p.evaluate(() => document.querySelector('.cx-opt[aria-label="Mídia favorita"]').click());
  await p.waitForSelector('.mfpicker', { timeout: 4000 }).catch(() => { });
  await p.evaluate(() => [...document.querySelectorAll('.mf-tabs button')].find(b => b.title === 'Imagens')?.click()); await sleep(200);
  ok(await p.$$eval('.mfpicker .mf-chip', l => l.some(c => c.textContent === 'Memes')), 'seletor: aba Imagens com a categoria "Memes"');
  ok(await p.$$eval('.mfpicker .mf-sech b', l => l[0]?.textContent === 'Memes'), 'categoria aparece primeiro, com a mídia dentro');
  await shot(p, '6-midia-favorita');
  const before = (await call(bia.tok, 'GET', `/channels/${dm.id}/messages?limit=5`)).length;
  await p.click('.mfpicker .mf-item'); await sleep(600);
  const after = await call(bia.tok, 'GET', `/channels/${dm.id}/messages?limit=1`);
  ok(after[0]?.attachments?.[0]?.url === up2.url, 'clicar manda a mídia favorita', before);

  // #1254 número no ícone
  await p.evaluate((cid) => { const S = window.__lc.S; S.mentions[cid] = 2; window.__lc.updateTitle(); }, gal.id); await sleep(200);
  ok(await p.evaluate(() => document.title.startsWith('(2)') && document.querySelector('link[rel="icon"]').href.startsWith('data:image/png')), 'menções: número no título e no ícone da aba');
  await p.evaluate((cid) => { const S = window.__lc.S; S.mentions = {}; S.unread[cid] = true; S.prefs.badgeMode = 'unread'; window.__lc.updateTitle(); }, gal.id); await sleep(200);
  ok(await p.evaluate(() => document.title.startsWith('• ')), 'modo "ponto para não lidas": título com ponto', await p.title());
  await p.evaluate(() => { window.__lc.S.prefs.badgeMode = 'off'; window.__lc.updateTitle(); });
  ok(await p.title() === 'Resenha', 'modo "nada": título limpo');
  await p.evaluate(() => window.__lc.openSettings('notifications')); await p.waitForSelector('.np-badge', { timeout: 4000 }).catch(() => { });
  ok(await p.$('.np-badge .choices') != null, 'Configurações → Notificações → Ícone e barra de tarefas');
  await shot(p, '7-notificacoes');

  // desfazer a importação pela outra pessoa
  const undo = await call(bia.tok, 'DELETE', `/channels/${dm.id}/imports/${imp.batch}`);
  ok(undo.removed === 3, 'a outra pessoa desfaz a importação');
  ok(!(await call(ana.tok, 'GET', `/channels/${dm.id}/messages?limit=50`)).some(m => m.imported), 'as importadas somem');
} catch (e) { console.log('  ERRO', e.stack || e); fails++; }
finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
