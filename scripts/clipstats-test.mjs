// Clipes: engajamento, ranking semanal e recomendações de ponta a ponta, com servidor de verdade, vídeo de verdade (canvas
// gravado no navegador) e o player tocando de verdade. Confere as proteções (abrir e fechar, script mandando "assisti tudo",
// autor assistindo/curtindo o próprio clipe, repetição, limite de sessões), o ranking ponderado, as categorias, os
// recomendados, o cenário com pouca gente e a interface (painel "Ativo agora", player e galeria).
// Uso: node scripts/clipstats-test.mjs   (SHOTS=1 salva capturas em .testshots/clipstats)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3287, BASE = `http://localhost:${PORT}`, DATA = './.testdata-clipstats', OUT = '.testshots/clipstats';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', TZ: 'America/Sao_Paulo' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined })
  .then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, n }; };
const friends = async (a, b) => { await call(a.tok, 'POST', '/relationships', { username: b.n }); await call(b.tok, 'PUT', '/relationships/' + a.id, {}); };
const SECS = 8; // duração declarada dos clipes (8 s: qualifica com 3,2 s assistidos)
// assiste de verdade pela API: abre a sessão, espera o relógio andar e manda a batida com o quanto viu
const watch = async (u, cid, frac, waitMs = 3400) => {
  const v = await call(u.tok, 'POST', `/clips/${cid}/view`); await sleep(waitMs);
  const ms = Math.round(frac * SECS * 1000);
  return { session: v.session, ...(await call(u.tok, 'POST', `/clips/${cid}/watch`, { session: v.session, watched_ms: ms, covered_ms: ms })) };
};
const stats = async (u, cid) => (await call(u.tok, 'GET', `/clips/${cid}`)).stats;

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(u, w = 1440) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: w, height: 1000 });
  p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t; window.__clipStats = 0; // conta os avisos CLIP_STATS que chegam pelo WebSocket
    const WS = window.WebSocket; window.WebSocket = class extends WS { constructor(...a) { super(...a); this.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.includes('"CLIP_STATS"')) window.__clipStats++; }); } };
  }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
try {
  const U = {}; for (const n of ['eu', 'ana', 'beto', 'caio', 'duda', 'f1', 'f2', 'f3', 'f4', 'f5']) U[n] = await reg(n);
  for (const n of ['beto', 'caio', 'duda']) await friends(U.eu, U[n]);
  const g = await call(U.ana.tok, 'POST', '/guilds', { name: 'Resenha dos clipes' }); const code = (await call(U.ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const n of Object.keys(U)) if (n !== 'ana') await call(U[n].tok, 'POST', '/invites/' + code);
  const ch2 = await call(U.ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'memes', type: 0 });
  const ana = await page(U.ana);
  const ch = await ana.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0 && x.name === 'geral'), g.id);
  // um vídeo de verdade (8 s de canvas gravado) enviado pela rota de upload; os clipes da semana usam esse arquivo
  const up = await ana.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0;
    const iv = setInterval(() => { x.fillStyle = `hsl(${(200 + n * 3) % 360},60%,35%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.font = 'bold 48px sans-serif'; x.fillText('Jogada ' + n++, 30, 90); }, 33);
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    rec.start(); await new Promise(r => setTimeout(r, 8000)); rec.stop(); await new Promise(r => (rec.onstop = r)); clearInterval(iv);
    return (await fetch('/api/upload?name=clipe.webm', { method: 'POST', headers: { authorization: 'Bearer ' + localStorage.lc_token, 'content-type': 'video/webm' }, body: new Blob(parts, { type: 'video/webm' }) })).json();
  });
  ok(/^\/files\//.test(up.url || ''), 'vídeo real enviado', up);
  const mk = async (u, title, streamer = null) => (await call(u.tok, 'POST', `/channels/${ch.id}/clips`, { url: up.url, name: up.name, size: up.size, secs: SECS, streamer_id: streamer, has_audio: false, title })).clip;
  const C = {
    joia: await mk(U.duda, 'Clutch 1v4 absurdo'), viral: await mk(U.ana, 'Todo mundo viu esse'), meh: await mk(U.beto, 'Round normal'),
    quatro: await mk(U.f1, 'Quarto lugar'), tiny: await mk(U.caio, 'Quase ninguém viu'), rec: await mk(U.beto, 'Clipe que você não viu', U.caio.id),
    trap: await mk(U.f2, 'Teste de trapaça'),
  };
  ok(Object.values(C).every(c => c && c.id && c.stats && c.stats.views === 0), 'clipes criados com métricas zeradas', Object.values(C).map(c => c?.stats));

  console.log('métricas e proteções');
  // abrir e fechar: abriu o player mas não assistiu
  const o = await call(U.f3.tok, 'POST', `/clips/${C.trap.id}/view`);
  ok(typeof o.session === 'string', 'abrir o player cria uma sessão', o);
  ok((await stats(U.ana, C.trap.id)).views === 0, 'só abrir não conta visualização');
  // script mandando "assisti tudo" logo depois de abrir
  await sleep(950); const cheat = await call(U.f3.tok, 'POST', `/clips/${C.trap.id}/watch`, { session: o.session, watched_ms: 999999, covered_ms: 8000 });
  ok(cheat.ok && cheat.clamped.includes('rate') && cheat.completion < 0.5 && !cheat.qualified, 'tempo acima do relógio é cortado e não qualifica', cheat);
  const forged = await call(U.f3.tok, 'POST', `/clips/${C.trap.id}/watch`, { session: 'inventada', watched_ms: 8000, covered_ms: 8000 });
  ok(!forged.ok && forged.why === 'session', 'sessão inventada é recusada', forged);
  const other = await call(U.f4.tok, 'POST', `/clips/${C.trap.id}/watch`, { session: o.session, watched_ms: 8000, covered_ms: 8000 });
  ok(!other.ok, 'sessão de outra pessoa é recusada', other);
  // autor assistindo o próprio clipe
  const own = await watch(U.f2, C.trap.id, 1);
  ok(own.ok && !own.qualified && (await stats(U.ana, C.trap.id)).views === 0, 'autor assistindo o próprio clipe não conta', own);
  // repetir não soma
  await watch(U.f4, C.trap.id, 1); await watch(U.f4, C.trap.id, 1);
  ok((await stats(U.ana, C.trap.id)).views === 1, 'a mesma pessoa assistindo 2 vezes conta 1 visualização', await stats(U.ana, C.trap.id));
  // limite de sessões por pessoa e clipe (20 por dia): passou disso o vídeo toca mas não conta
  let last; for (let i = 0; i < 21; i++) last = await call(U.f5.tok, 'POST', `/clips/${C.trap.id}/view`);
  ok(last.session === null, 'abrir o mesmo clipe sem parar: passa do limite e para de contar', last);
  // curtidas
  ok((await call(U.f2.tok, 'PUT', `/clips/${C.trap.id}/like`)).status === 400, 'autor não curte o próprio clipe');
  await call(U.f3.tok, 'PUT', `/clips/${C.trap.id}/like`); const lk = await call(U.f3.tok, 'PUT', `/clips/${C.trap.id}/like`);
  ok(lk.liked && lk.stats.likes === 1, 'curtir duas vezes conta uma', lk.stats);
  const ul = await call(U.f3.tok, 'DELETE', `/clips/${C.trap.id}/like`);
  ok(!ul.liked && ul.stats.likes === 0, 'descurtir tira a curtida', ul.stats);
  // compartilhamentos: mandar o link em 2 canais conta 1 pessoa; o autor compartilhando não conta
  const link = (c) => `olha isso ${BASE}/#/clip/${c.id}`;
  await call(U.f4.tok, 'POST', `/channels/${ch.id}/messages`, { content: link(C.trap) }); await call(U.f4.tok, 'POST', `/channels/${ch2.id}/messages`, { content: link(C.trap) });
  await call(U.f2.tok, 'POST', `/channels/${ch.id}/messages`, { content: link(C.trap) });
  ok((await stats(U.ana, C.trap.id)).shares === 1, 'compartilhar o mesmo clipe em 2 canais conta uma vez; autor não conta', await stats(U.ana, C.trap.id));
  const ret = await stats(U.ana, C.trap.id);
  ok(ret.retention === 100 && ret.avg_watch_s === 8, 'retenção: % concluído e tempo médio assistido (loop não passa de uma volta)', ret);
  await call(U.ana.tok, 'DELETE', `/clips/${C.trap.id}`); // fora do ranking a partir daqui

  console.log('ranking da semana');
  // joia: 4 pessoas viram inteiro, 4 curtiram, 2 compartilharam. viral: 9 viram ~45%, 1 curtiu. meh: 4 viram metade.
  // quatro: 3 viram 60%. tiny: só 2 (abaixo do mínimo). rec: amigos do "eu" assistiram e curtiram, o "eu" não viu
  const jobs = [];
  for (const n of ['ana', 'beto', 'caio', 'f1']) jobs.push(watch(U[n], C.joia.id, 1));
  for (const n of ['beto', 'caio', 'duda', 'f1', 'f2', 'f3', 'f4', 'f5', 'eu']) jobs.push(watch(U[n], C.viral.id, 0.45));
  for (const n of ['ana', 'caio', 'f2', 'f3']) jobs.push(watch(U[n], C.meh.id, 0.5));
  for (const n of ['ana', 'f2', 'f3']) jobs.push(watch(U[n], C.quatro.id, 0.6));
  for (const n of ['ana', 'f1']) jobs.push(watch(U[n], C.tiny.id, 1));
  for (const n of ['caio', 'duda']) jobs.push(watch(U[n], C.rec.id, 0.9)); // 2 views: fora do ranking, ainda recomendável
  await Promise.all(jobs);
  for (const n of ['ana', 'beto', 'caio', 'f1']) await call(U[n].tok, 'PUT', `/clips/${C.joia.id}/like`);
  await call(U.f2.tok, 'PUT', `/clips/${C.viral.id}/like`);
  for (const n of ['caio', 'duda']) await call(U[n].tok, 'PUT', `/clips/${C.rec.id}/like`);
  await call(U.caio.tok, 'POST', `/channels/${ch.id}/messages`, { content: link(C.joia) }); await call(U.f1.tok, 'POST', `/channels/${ch2.id}/messages`, { content: link(C.joia) });
  const feed = await call(U.eu.tok, 'GET', '/activity/feed'), wk = feed.week;
  const ids = wk.clips.map(c => c.id), name = (id) => Object.entries(C).find(([, c]) => c.id === id)?.[0];
  ok(ids[0] === C.joia.id, 'o clipe que prende quem assiste vence o mais visto (retenção 35% + curtidas 25% + compart. 25%)', ids.map(name));
  ok(ids.includes(C.viral.id) && ids.includes(C.meh.id) && ids.includes(C.quatro.id), 'os clipes com 3+ visualizações entram', ids.map(name));
  ok(!ids.includes(C.tiny.id), 'clipe com só 2 visualizações fica fora (mínimo de dados)', ids.map(name));
  const j = wk.clips[0];
  ok(j.metrics.views === 4 && j.metrics.likes === 4 && j.metrics.shares === 2 && j.metrics.retention === 100, 'métricas do 1º: 4 views, 4 curtidas, 2 compartilhamentos, 100% assistido', j.metrics);
  ok(wk.clips.every((c, i, a) => i === 0 || a[i - 1].score >= c.score), 'ordem pela nota', wk.clips.map(c => c.score));
  const cat = Object.fromEntries(wk.clip_categories.map(x => [x.kind, name(x.clip.id)]));
  ok(cat.popular === 'viral' && cat.crowd === 'joia', 'categorias vão para quem de fato se destaca (Mais popular = mais visto; Favorito da galera = mais curtido)', cat);
  ok(new Set(wk.clip_categories.map(x => x.clip.id)).size === wk.clip_categories.length, 'um clipe por categoria');
  ok(wk.clips.find(c => c.id === C.viral.id)?.tag === 'popular', 'selo da categoria no cartão do ranking', wk.clips.map(c => [name(c.id), c.tag]));
  const rec = wk.clip_recs.find(c => c.id === C.rec.id);
  ok(rec && rec.reason && /amigos? (curtiu|curtiram)|Você aparece|amigo/.test(rec.reason.text), 'recomendado: clipe que os amigos curtiram e você não viu, com o motivo', wk.clip_recs.map(c => [name(c.id), c.reason]));
  ok(!wk.clip_recs.some(c => c.id === C.viral.id), 'não recomenda o que você já assistiu', wk.clip_recs.map(c => name(c.id)));
  const caioRecs = (await call(U.caio.tok, 'GET', '/activity/feed')).week.clip_recs;
  ok(!caioRecs.some(c => c.id === C.tiny.id), 'não recomenda o próprio clipe', caioRecs.map(c => name(c.id)));

  console.log('pouca gente e poucos clipes');
  const solo = await reg('solo'), par = await reg('par'); await friends(solo, par);
  const g2 = await call(solo.tok, 'POST', '/guilds', { name: 'Só nós dois' }); await call(par.tok, 'POST', '/invites/' + (await call(solo.tok, 'POST', `/guilds/${g2.id}/invites`)).code);
  await ana.close(); const sp = await page(solo); const ch3 = await sp.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g2.id); await sp.close();
  const sc = (await call(solo.tok, 'POST', `/channels/${ch3.id}/clips`, { url: up.url, name: up.name, size: up.size, secs: SECS, has_audio: false, title: 'Só um clipe' })).clip;
  let sf = (await call(solo.tok, 'GET', '/activity/feed')).week;
  ok(sf.clips.length === 0 && sf.clip_quiet && Array.isArray(sf.clip_recs), 'servidor de 2 pessoas, ninguém assistiu: sem ranking, sem erro', sf);
  await watch(par, sc.id, 1);
  sf = (await call(solo.tok, 'GET', '/activity/feed')).week;
  ok(sf.clips.length === 0, 'um único espectador não basta (mínimo de 2 mesmo em grupo pequeno)', sf.clips);
  const pf = (await call(par.tok, 'GET', '/activity/feed')).week;
  ok(pf.clips.length === 0 && !pf.clip_recs.some(c => c.id === sc.id), 'quem já assistiu não recebe o clipe como recomendação', pf.clip_recs);
  const fresh = await reg('novato'); await call(fresh.tok, 'POST', '/invites/' + code);
  const nf = (await call(fresh.tok, 'GET', '/activity/feed')).week;
  ok(nf.clips[0]?.id === C.joia.id && nf.clip_recs.length > 0 && nf.clip_recs.every(c => c.reason), 'conta nova sem histórico: vê o ranking e recebe recomendações explicadas', nf.clip_recs.map(c => [name(c.id), c.reason?.text]));

  console.log('interface');
  const me = await page(U.eu); await me.evaluate(() => window.__lc.go('@me')); await sleep(2500);
  const P = await me.evaluate(() => {
    const b = document.querySelector('#active-now'), t = (e) => e?.innerText.replace(/\s+/g, ' ').trim();
    return { heads: [...b.querySelectorAll('.wk-h h4')].map(e => e.textContent), clips: [...b.querySelectorAll('.wk-clips .wk-clip')].map(t), more: t(b.querySelector('.wk-more')),
      recs: [...b.querySelectorAll('.wk-recs .wk-clip')].map(t), reason: t(b.querySelector('.wk-reason')), cats: [...b.querySelectorAll('.wk-cats .wk-clip')].map(t) };
  });
  ok(P.heads.includes('Clipes da semana') && P.heads.includes('Recomendados pra você'), 'painel: Clipes da semana e Recomendados pra você', P.heads);
  ok(P.clips.length === 3 && /Clutch 1v4 absurdo/.test(P.clips[0]) && /Clipe da semana/.test(P.clips[0]), 'Top 3 com o campeão em destaque', P.clips);
  ok(/4 4 2 100%/.test(P.clips[0]), 'métricas visíveis: visualizações, curtidas, compartilhamentos e retenção', P.clips[0]);
  ok(/Ver top 4/.test(P.more || ''), 'botão para expandir o ranking', P.more);
  ok(P.recs.some(r => /Clipe que você não viu/.test(r)) && !!P.reason, 'recomendado com o motivo à vista', { recs: P.recs, reason: P.reason });
  if (process.env.SHOTS) { const el = await me.$('#active-now'); await me.evaluate(() => { const b = document.querySelector('#active-now'); b.scrollTop = b.querySelector('.wk-clips').offsetTop - 10; }); await sleep(400); await el.screenshot({ path: OUT + '/painel-top3.png' }); }
  await me.evaluate(() => document.querySelector('#active-now .wk-more').click()); await sleep(300);
  ok(await me.evaluate(() => document.querySelectorAll('#active-now .wk-clips .wk-clip').length) === 4, 'expandido: mostra o top inteiro (até 5)');
  const dup = await me.evaluate(() => { const ids = [...document.querySelectorAll('#active-now [data-clip]')].map(e => e.dataset.clip); return ids.length - new Set(ids).size; });
  ok(dup === 0, 'nenhum clipe aparece duas vezes no painel (expandido)', dup);
  if (process.env.SHOTS) { const el = await me.$('#active-now'); await me.evaluate(() => { const b = document.querySelector('#active-now'); b.scrollTop = b.querySelector('.wk-clips').offsetTop - 10; }); await sleep(300); await el.screenshot({ path: OUT + '/painel-top5.png' });
    await me.evaluate(() => { const b = document.querySelector('#active-now'); b.scrollTop = b.scrollHeight; }); await sleep(300); await el.screenshot({ path: OUT + '/painel-recomendados.png' }); }
  // abrir o recomendado, assistir de verdade e curtir pelo player
  await me.evaluate((id) => document.querySelector(`#active-now .wk-recs [data-clip="${id}"]`).click(), C.rec.id); await sleep(1200);
  const pl = await me.evaluate(() => { const m = document.querySelector('.modal.clipmodal'); return m && { title: m.querySelector('.pttl')?.textContent, stats: m.querySelector('.pstatrow')?.innerText.replace(/\s+/g, ' '), like: m.querySelector('.plike')?.textContent, hidden: m.querySelector('.plike')?.hidden }; });
  ok(pl?.title === 'Clipe que você não viu' && /^2 2 0/.test(pl.stats || '') && pl.like === 'Curtir' && !pl.hidden, 'player: métricas e botão Curtir', pl);
  await me.evaluate(() => document.querySelector('.modal.clipmodal .plike').click()); await sleep(600);
  ok(await me.evaluate(() => document.querySelector('.modal.clipmodal .plike').textContent) === 'Curtido', 'curtir pelo player');
  const playing = await me.evaluate(async () => { const v = document.querySelector('.modal.clipmodal video'); await v.play().catch(() => { }); return !v.paused; });
  ok(playing, 'o vídeo está tocando no player');
  await sleep(6000); // deixa tocar: ~6 s assistidos de verdade (qualifica com 3,2 s)
  if (process.env.SHOTS) await me.screenshot({ path: OUT + '/player.png' });
  await me.evaluate(() => document.querySelector('.modal.clipmodal .inv-x').click()); await sleep(1200);
  const after = await stats(U.eu, C.rec.id);
  ok(after.views === 3 && after.likes === 3, 'assistir pelo player conta a visualização qualificada; a curtida entra', after);
  const wk2 = (await call(U.eu.tok, 'GET', '/activity/feed')).week;
  ok(!wk2.clip_recs.some(c => c.id === C.rec.id), 'depois de assistido, sai dos recomendados', wk2.clip_recs.map(c => name(c.id)));
  // abrir e fechar na hora pelo player não conta
  const gal = await page(U.f5); await gal.evaluate((gid) => window.__lc.go(gid, 'clips'), g.id); await sleep(2500);
  const G = await gal.evaluate(() => [...document.querySelectorAll('.clipcard')].map(c => ({ t: c.querySelector('.ctitle')?.textContent, s: c.querySelector('.cstats')?.innerText.replace(/\s+/g, ' '), like: !!c.querySelector('.clike') })));
  const gj = G.find(x => x.t === 'Clutch 1v4 absurdo');
  ok(gj && /^4 4 2$/.test(gj.s) && gj.like, 'galeria: métricas e botão de curtir em cada clipe', G);
  await gal.evaluate(() => [...document.querySelectorAll('.clipcard')].find(c => /Quase ninguém/.test(c.textContent)).querySelector('.cthumb').click()); await sleep(800);
  await gal.evaluate(() => document.querySelector('.modal.clipmodal .inv-x').click()); await sleep(800);
  ok((await stats(U.ana, C.tiny.id)).views === 2, 'abrir e fechar o player na hora não conta', await stats(U.ana, C.tiny.id));
  if (process.env.SHOTS) await gal.screenshot({ path: OUT + '/galeria.png' });
  // o autor não vê "Curtir" no próprio clipe
  await gal.close(); const dd = await page(U.duda); await dd.evaluate((gid) => window.__lc.go(gid, 'clips'), g.id); await sleep(2500);
  ok(await dd.evaluate(() => { const c = [...document.querySelectorAll('.clipcard')].find(c => /Clutch 1v4/.test(c.textContent)); return c && !c.querySelector('.clike'); }), 'autor não vê botão de curtir no próprio clipe');

  console.log('tempo real');
  // a galeria aberta (f4), o painel (eu) e um player aberto recebem as mudanças feitas por outras pessoas, sem recarregar
  const rt = await page(U.f4); await rt.evaluate((gid) => window.__lc.go(gid, 'clips'), g.id); await sleep(2500);
  const card = (P, t) => P.evaluate((t) => [...document.querySelectorAll('.clipcard')].find(c => c.querySelector('.ctitle')?.textContent === t)?.querySelector('.cstats')?.innerText.replace(/\s+/g, ' '), t);
  const panelOf = (id) => me.evaluate((id) => document.querySelector(`#active-now .wk-clips [data-clip="${id}"] .wk-met`)?.innerText.replace(/\s+/g, ' '), id);
  ok(await card(rt, 'Clutch 1v4 absurdo') === '4 4 2' && /^4 4 2/.test(await panelOf(C.joia.id) || ''), 'antes: 4 views, 4 curtidas, 2 compartilhamentos', [await card(rt, 'Clutch 1v4 absurdo'), await panelOf(C.joia.id)]);
  await rt.evaluate(() => { window.__rtVid = document.querySelector('.clipcard video'); }); // a grade não pode ser redesenhada
  await call(U.f3.tok, 'PUT', `/clips/${C.joia.id}/like`); await sleep(1800);
  ok(await card(rt, 'Clutch 1v4 absurdo') === '4 5 2', 'curtida de outra pessoa aparece na galeria aberta', await card(rt, 'Clutch 1v4 absurdo'));
  ok(await rt.evaluate(() => window.__rtVid === document.querySelector('.clipcard video')), 'só a linha de números muda (a grade não é redesenhada)');
  ok(/^4 5 2/.test(await panelOf(C.joia.id) || ''), '…e no painel "Ativo agora"', await panelOf(C.joia.id));
  await call(U.f3.tok, 'DELETE', `/clips/${C.joia.id}/like`); await sleep(1800);
  ok(await card(rt, 'Clutch 1v4 absurdo') === '4 4 2', 'descurtir também atualiza', await card(rt, 'Clutch 1v4 absurdo'));
  // visualização qualificada nova chega em tempo real; abrir e fechar não gera aviso
  await call(U.f5.tok, 'POST', `/clips/${C.quatro.id}/view`); await sleep(1500);
  ok(await card(rt, 'Quarto lugar') === '3 0 0', 'só abrir não muda os números', await card(rt, 'Quarto lugar'));
  await watch(U.duda, C.quatro.id, 1); await sleep(1800);
  ok(await card(rt, 'Quarto lugar') === '4 0 0', 'visualização qualificada de outra pessoa aparece na hora', await card(rt, 'Quarto lugar'));
  // compartilhamento novo e apagar a mensagem que compartilhou
  const sh = await call(U.duda.tok, 'POST', `/channels/${ch2.id}/messages`, { content: link(C.quatro) }); await sleep(1800);
  ok(await card(rt, 'Quarto lugar') === '4 0 1', 'compartilhamento aparece na hora', await card(rt, 'Quarto lugar'));
  await call(U.duda.tok, 'DELETE', `/channels/${ch2.id}/messages/${sh.id}`); await sleep(1800);
  ok(await card(rt, 'Quarto lugar') === '4 0 0', 'apagou a mensagem com o link: o compartilhamento sai', await card(rt, 'Quarto lugar'));
  // player aberto tocando: os números mudam sem reiniciar o vídeo
  await rt.evaluate(() => [...document.querySelectorAll('.clipcard')].find(c => /Round normal/.test(c.textContent)).querySelector('.cthumb').click()); await sleep(1500);
  const t0 = await rt.evaluate(() => { const v = document.querySelector('.modal.clipmodal video'); v.play(); return v.currentTime; });
  await call(U.ana.tok, 'PUT', `/clips/${C.meh.id}/like`); await sleep(1800);
  const pv = await rt.evaluate(() => { const m = document.querySelector('.modal.clipmodal'), v = m.querySelector('video'); return { s: m.querySelector('.pstatrow')?.innerText.replace(/\s+/g, ' '), t: v.currentTime, paused: v.paused }; });
  ok(/^4 1 0/.test(pv.s || '') && pv.t > t0 && !pv.paused, 'player aberto: curtida aparece e o vídeo continua tocando', { ...pv, t0 });
  if (process.env.SHOTS) await rt.screenshot({ path: OUT + '/tempo-real-player.png' });
  // rajada de curtidas: chega um aviso só (agrupado) e o número final certo
  await rt.evaluate(() => { window.__clipStats = 0; });
  for (const n of ['beto', 'caio', 'f1', 'f2']) await call(U[n].tok, 'PUT', `/clips/${C.meh.id}/like`);
  await sleep(1800);
  const nEv = await rt.evaluate(() => window.__clipStats);
  ok(nEv >= 1 && nEv <= 2, '4 curtidas seguidas viram 1 aviso (agrupado por segundo)', nEv);
  ok(/^4 4 0/.test(await rt.evaluate(() => document.querySelector('.modal.clipmodal .pstatrow')?.innerText.replace(/\s+/g, ' ')) || ''), 'várias curtidas seguidas: número final certo (a do beto, autor, não entra)', await rt.evaluate(() => document.querySelector('.modal.clipmodal .pstatrow')?.innerText));
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
