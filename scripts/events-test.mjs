// Eventos do servidor (server/events.js + public/events.js): marcar pela tela Eventos, anúncio no canal com o cartão,
// Vou / Talvez / Não vou em tempo real, vagas esgotadas, quem não é do servidor, arquivo de agenda (.ics), anúncio que
// não se edita, lembrete 15 min antes e na hora (com "Entrar na sala" que entra mesmo), editar, cancelar e permissões.
// Uso: node scripts/events-test.mjs  (prints em .testshots/events)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const OUT = '.testshots/events', PORT = 3315, MOCK = 4595, BASE = `http://localhost:${PORT}`, M = `http://127.0.0.1:${MOCK}`, DATA = './.testdata-events';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const waitFor = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b4cff"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="460" height="215" fill="url(#g)"/><text x="24" y="120" font-size="36" font-weight="700" font-family="sans-serif" fill="#fff">Estrela Cadente</text></svg>`;
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, M); r.setHeader('content-type', 'application/json');
  if (u.pathname.startsWith('/sapi/IStoreBrowseService/GetItems')) return r.end(JSON.stringify({ response: { store_items: JSON.parse(u.searchParams.get('input_json')).ids.map(x => x.appid === 7001
    ? { success: 1, appid: 7001, name: 'Estrela Cadente', tagids: [], assets: { asset_url_format: 'img/7001/${FILENAME}', header: 'h.svg' }, best_purchase_option: { formatted_final_price: 'R$ 39,99', discount_pct: 0 } } : { success: 0, appid: x.appid }) } }));
  if (u.pathname.startsWith('/sapi/IStoreService/GetTagList')) return r.end(JSON.stringify({ response: { tags: [] } }));
  if (u.pathname.startsWith('/img/')) { r.setHeader('content-type', 'image/svg+xml'); return r.end(svg); }
  r.statusCode = 404; r.end('{}');
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ steamApi: M + '/sapi', steamAssets: M + '/', news: [], epic: false, tournaments: false }));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41099', RTC_IPS: '127.0.0.1', GAMES_SYNC: '0', DEALS: '0', EVENTS_TICK_MS: '700' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined })
  .then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? j : { status: r.status, ...j }; });
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return { tok: r.token, id: (await call(r.token, 'PATCH', '/me', {})).id, name: n }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const ana = await reg('ana'), beto = await reg('beto'), carla = await reg('carla'), davi = await reg('davi');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Resenha' }); const inv = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const U of [beto, carla]) await call(U.tok, 'POST', '/invites/' + inv);
  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (t && window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent); }).observe(document, { childList: true, subtree: true }); }, ana.tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const { text, room } = await P.evaluate((gid) => { const cs = window.__lc.S.guilds.get(gid).channels; return { text: cs.find(c => c.type === 0).id, room: cs.find(c => c.type === 2).id }; }, g.id);
  await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text); await sleep(500);

  // marcar pela tela Eventos
  ok(await P.evaluate(() => { const r = document.querySelector('#side-list .evrow'), f = document.querySelector('#side-list .wishrow'); return !!r && getComputedStyle(r).display === getComputedStyle(f).display && Math.abs(r.querySelector('.name').getBoundingClientRect().left - f.querySelector('.name').getBoundingClientRect().left) < 2; }), 'entrada "Eventos" na lista de canais, alinhada com as outras');
  await P.evaluate(() => document.querySelector('#side-list .evrow').click()); await P.waitForSelector('#eventsview .cempty');
  ok(await P.evaluate(() => /Nenhum evento marcado/.test(document.querySelector('#eventsview').innerText)), 'tela Eventos vazia explica como funciona');
  await P.evaluate(() => [...document.querySelectorAll('#eventsview .btn')].find(b => /Marcar evento/.test(b.textContent)).click());
  await P.waitForSelector('.evform');
  const startAt = Date.now() + 2 * 864e5;
  await P.evaluate((t) => {
    const f = document.querySelector('.evform'), [title, game, when, slots] = [...f.querySelectorAll('input')], set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const d = new Date(t), p = (n) => String(n).padStart(2, '0');
    set(title, 'Sexta de CS2'); set(game, 'https://store.steampowered.com/app/7001/Estrela_Cadente/'); set(when, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T21:00`); set(slots, '2');
    f.querySelectorAll('select')[0].value = '60'; f.querySelector('textarea').value = 'Modo competitivo. Tragam o microfone!';
  }, startAt);
  await P.evaluate(() => [...document.querySelectorAll('.modal .mf .btn')].find(b => /Marcar evento/.test(b.textContent)).click());
  await P.waitForSelector('#eventsview .evcard'); await sleep(600);
  const evs = await call(ana.tok, 'GET', `/guilds/${g.id}/events`), ev = evs.events[0];
  ok(evs.events.length === 1 && ev.title === 'Sexta de CS2' && ev.game === 'Estrela Cadente' && ev.appid === '7001' && ev.duration_min === 60 && ev.slots === 2 && ev.channel_id === room && ev.yes.join() === ana.id && new Date(ev.starts_at).getHours() === 21,
    'evento criado: link da Steam vira o nome do jogo, 21h no fuso de quem marcou, sala, vagas e quem marcou já vai', ev);
  const msgs = await call(ana.tok, 'GET', `/channels/${text}/messages?limit=5`), ann = msgs.find(m => m.event);
  ok(ann && ann.event.id === ev.id && ann.content === '📅 Sexta de CS2', 'anunciado no canal de texto (mensagem com o evento)');
  ok((await call(ana.tok, 'PATCH', `/channels/${text}/messages/${ann.id}`, { content: 'mudei' })).status === 400, 'o anúncio não se edita como mensagem');

  // respostas
  ok((await call(beto.tok, 'PUT', `/events/${ev.id}/rsvp`, { state: 'yes' })).yes?.length === 2, 'beto: Vou');
  const full = await call(carla.tok, 'PUT', `/events/${ev.id}/rsvp`, { state: 'yes' });
  ok(full.status === 400 && /esgotadas/.test(full.error), 'vagas esgotadas: carla não consegue "Vou"', full.error);
  ok((await call(carla.tok, 'PUT', `/events/${ev.id}/rsvp`, { state: 'maybe' })).maybe?.join() === carla.id, 'carla: Talvez');
  ok((await call(davi.tok, 'PUT', `/events/${ev.id}/rsvp`, { state: 'yes' })).status === 404 && (await call(davi.tok, 'GET', `/guilds/${g.id}/events`)).status === 403, 'quem não é do servidor não vê nem responde');
  ok((await call(beto.tok, 'DELETE', `/events/${ev.id}`)).status === 403, 'beto (não marcou, sem Gerenciar servidor) não cancela');
  ok(await waitFor(() => P.evaluate(() => /2\/2 vagas/.test(document.querySelector('#eventsview .evcard')?.innerText || '') && /2 vão · 1 talvez/.test(document.querySelector('#eventsview .evcard').innerText))), 'cartão atualiza ao vivo: 2/2 vagas, "2 vão · 1 talvez"');
  // .ics
  const ics = await fetch(`${BASE}/api/events/${ev.id}.ics`, { headers: { authorization: 'Bearer ' + beto.tok } }).then(r => r.text());
  ok(/BEGIN:VEVENT/.test(ics) && /SUMMARY:Sexta de CS2/.test(ics) && /TRIGGER:-PT15M/.test(ics) && new RegExp('DTSTART:' + new Date(ev.starts_at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')).test(ics), 'arquivo de agenda (.ics) com o horário e lembrete de 15 min');

  // anúncio no chat
  await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, text);
  await P.waitForSelector('#msgs .evcard'); await sleep(800);
  const card = await P.evaluate(() => { const c = document.querySelector('#msgs .evcard'); return { txt: c.innerText.replace(/\n+/g, ' | '), art: c.classList.contains('has-art'), yes: c.querySelector('.ev-btn.on.yes')?.textContent, msgText: c.closest('.msg, .message')?.querySelector('.body')?.firstChild?.textContent }; });
  ok(/Sexta de CS2/.test(card.txt) && /Estrela Cadente/.test(card.txt) && /21:00 – 22:00/.test(card.txt) && /Geral/.test(card.txt) && /Modo competitivo/.test(card.txt) && card.art && card.yes === 'Vou', 'cartão no chat: data, 21:00 – 22:00, sala, jogo com a arte, descrição e "Vou" marcado', card);
  await (await P.$('#msgs .evcard')).screenshot({ path: OUT + '/01-anuncio.png' });
  await P.evaluate(() => [...document.querySelectorAll('#msgs .evcard .ev-btn')].find(b => b.textContent === 'Talvez').click());
  ok(await waitFor(async () => (await call(ana.tok, 'GET', `/guilds/${g.id}/events`)).events[0].maybe.includes(ana.id)), 'trocar a resposta pelo cartão (ana: Talvez)');
  await P.waitForFunction(() => document.querySelector('#msgs .evcard .ev-btn.on')?.textContent === 'Talvez'); // o cartão mostra a resposta nova antes do próximo clique
  await P.evaluate(() => [...document.querySelectorAll('#msgs .evcard .ev-btn')].find(b => b.textContent === 'Vou').click());
  ok(await waitFor(async () => (await call(ana.tok, 'GET', `/guilds/${g.id}/events`)).events[0].yes.includes(ana.id)), 'e de volta para Vou (a vaga dela continua garantida)');

  // lembretes: muda a hora para daqui a pouco
  await call(ana.tok, 'PATCH', `/events/${ev.id}`, { starts_at: Date.now() + 15 * 60e3 - 20e3 });
  ok(await waitFor(() => P.evaluate(() => window.__toasts.some(t => /Sexta de CS2 começa em 15 min na sala Geral/.test(t)))), 'aviso 15 min antes (para quem vai)', await P.evaluate(() => window.__toasts.slice(-3)));
  await call(ana.tok, 'PATCH', `/events/${ev.id}`, { starts_at: Date.now() + 3000 });
  ok(await waitFor(() => P.evaluate(() => window.__toasts.some(t => /Sexta de CS2 começou na sala Geral/.test(t)))), 'aviso quando começa');
  ok(await waitFor(() => P.evaluate(() => /Acontecendo agora/i.test(document.querySelector('#msgs .evcard')?.innerText || '') && !!document.querySelector('#msgs .evcard .ev-join'))), 'cartão: "Acontecendo agora" com "Entrar na sala"');
  await (await P.$('#msgs .evcard')).screenshot({ path: OUT + '/02-acontecendo.png' });
  await P.evaluate(() => document.querySelector('#msgs .evcard .ev-join').click());
  ok(await waitFor(() => P.evaluate((r) => window.__lc.voice?.channelId === r, room)), '"Entrar na sala" entra na sala de voz do evento');

  // outro evento, cancelado pela janela de edição
  const ev2 = await call(beto.tok, 'POST', `/guilds/${g.id}/events`, { title: 'Domingo de Minecraft', starts_at: Date.now() + 3 * 864e5, duration_min: 180, channel_id: room });
  ok(ev2.id && !ev2.message_id, 'evento sem anúncio no canal (só na tela Eventos)');
  ok((await call(ana.tok, 'PATCH', `/events/${ev2.id}`, { title: 'Domingão' })).title === 'Domingão', 'dono do servidor pode editar o evento dos outros');
  await P.evaluate((gid) => window.__lc.go(gid, 'events'), g.id);
  await P.waitForFunction(() => document.querySelectorAll('#eventsview .evcard').length === 2); await sleep(500);
  const secs = await P.evaluate(() => [...document.querySelectorAll('#eventsview .ev-sec')].map(s => s.textContent));
  ok(secs.join() === 'Acontecendo agora,Próximos', 'tela Eventos: acontecendo agora e próximos', secs);
  await P.screenshot({ path: OUT + '/03-tela-eventos.png' });
  await P.evaluate(() => [...document.querySelectorAll('#eventsview .evcard')].find(c => /Domingão/.test(c.innerText)).querySelector('.ev-more').click());
  await P.waitForSelector('.evform');
  ok(await P.evaluate(() => document.querySelector('.evform input').value === 'Domingão'), 'editar abre com os dados do evento');
  await P.evaluate(() => [...document.querySelectorAll('.modal .mf .btn')].find(b => /Cancelar evento/.test(b.textContent)).click()); await sleep(300);
  await P.evaluate(() => [...document.querySelectorAll('.modal .mf .btn.red')].at(-1).click());
  ok(await waitFor(async () => (await call(beto.tok, 'GET', `/guilds/${g.id}/events?past=1`)).events.find(e => e.id === ev2.id)?.status === 'cancelled'), 'cancelar pela janela (com confirmação)');
  ok(await waitFor(() => P.evaluate(() => document.querySelectorAll('#eventsview .evcard').length === 1)), 'cancelado sai da lista de próximos');
  ok((await call(carla.tok, 'PUT', `/events/${ev2.id}/rsvp`, { state: 'yes' })).status === 400, 'não dá para responder a um evento cancelado');
  ok((await call(ana.tok, 'POST', `/guilds/${g.id}/events`, { title: 'Ontem', starts_at: Date.now() - 864e5 })).status === 400, 'horário no passado é recusado');
  // celular
  await P.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await sleep(500);
  ok(await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no celular a tela Eventos cabe sem rolar para o lado');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); mock.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
