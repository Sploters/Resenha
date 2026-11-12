// Abuso: textos feitos para travar as expressões regulares do chat (markdown, cleanLinks, convites, temas, "só emoji",
// GIF, links de vídeo) e mensagens no tamanho máximo. Cada função recebe textos de 4.000 caracteres (o limite do servidor)
// montados para forçar retrocesso; nenhuma pode passar de LIMIT ms. Depois, uma mensagem gigante de verdade entra no
// chat e o desenho dela também tem limite. Uso: node scripts/abuse-regex-test.mjs
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 3311, BASE = `http://localhost:${PORT}`, D = './.testdata-abuse', LIMIT = +process.env.LIMIT || 50, sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
fs.rmSync(D, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const A = await call('', 'POST', '/register', { username: 'abusa', password: 'senha123' });
const B = await call('', 'POST', '/register', { username: 'vitima', password: 'senha123' });
for (const t of [A.token, B.token]) await call(t, 'PATCH', '/me', {});
const g = await call(A.token, 'POST', '/guilds', { name: 'Abuso' });
const inv = await call(A.token, 'POST', `/guilds/${g.id}/invites`, {});
await call(B.token, 'POST', `/invites/${inv.code}`, {});
const br = await puppeteer.launch({ executablePath: process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: 'new', protocolTimeout: 60000, args: ['--no-sandbox'] });
const p = await br.newPage(); await p.setViewport({ width: 1440, height: 900 });
await p.evaluateOnNewDocument(t => { localStorage.lc_token = t; }, A.token);
await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 90000 });
await p.waitForFunction((gid) => window.__lc.S.guilds.get(gid), {}, g.id);
const { chId: chid, bId } = await p.evaluate((gid) => ({ chId: window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0).id, bId: [...window.__lc.S.users.values()].find(u => u.username === 'vitima')?.id }), g.id);
const ch = { id: chid };

// ---- servidor: tamanhos e campos ----
const big = 'x'.repeat(200000);
let r = await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: big });
ok(r.id && r.content.length === 4000, 'mensagem gigante cortada em 4.000 caracteres', { len: r.content?.length });
r = await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: 'oi', reply_to: big });
ok(!r.id || !r.reply || String(r.reply.id).length <= 32, 'reply_to gigante não é guardado', { status: r.status, len: r.reply?.id?.length });
r = await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: 'oi', attachments: [{ url: '/files/' + 'a'.repeat(24) + '.png/x', name: big, type: big }] });
ok(r.status < 500, 'anexo com nome gigante não derruba', { status: r.status });
const many = Array.from({ length: 900 }, (_, i) => `<@${1e15 + i}>`).join('');
r = await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: many });
ok(!r.mentions || r.mentions.length <= 1, 'menções a contas que não estão no servidor são ignoradas', { mentions: r.mentions?.length });
r = await call(B.token, 'POST', `/channels/${ch.id}/messages`, { content: '@everyone olha isso' });
ok(r.id && (r.mentions || []).length === 2, '@everyone de um membro comum notifica a 1ª vez', { mentions: r.mentions?.length });
let quiet = 0; for (let i = 0; i < 4; i++) { await sleep(900); r = await call(B.token, 'POST', `/channels/${ch.id}/messages`, { content: '@everyone de novo ' + i }); if (r.id && !(r.mentions || []).length) quiet++; }
ok(quiet === 4, 'as seguintes, em menos de 5 min, vão para o chat mas não notificam ninguém', { quiet });
r = await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: '@everyone aviso do dono' });
ok(r.id && (r.mentions || []).includes(bId), '@everyone do dono (modera) notifica sempre', { mentions: r.mentions?.length });
r = await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: 'oi <@' + bId + '>' });
ok(r.id && r.mentions?.length === 1 && r.mentions[0] === bId, 'menção normal a quem está no servidor continua', { mentions: r.mentions });
const orig = r.id; r = await call(B.token, 'POST', `/channels/${ch.id}/messages`, { content: 'resposta', reply_to: orig });
ok(r.reply?.id === orig, 'resposta a uma mensagem do canal continua', { reply: r.reply?.id });

// ---- navegador: cada função com textos ruins ----
const N = 4000, rep = (x) => x.repeat(Math.ceil(N / x.length)).slice(0, N);
const inputs = {
  'só a': 'a'.repeat(N), 'espaços': ' '.repeat(N), 'quebras': '\n'.repeat(N),
  'link sem fim': 'http://' + 'a'.repeat(N - 7), 'link de pontos': 'http://' + '.'.repeat(N - 7), 'links colados': rep('http://'), 'links e pontos': rep('http://a.'),
  'query enorme': 'https://x.com/?' + rep('utm_a=1&'), 'pontos no fim': 'https://a.com/' + rep('a.'), 'amazon ref': 'https://amazon.com/' + rep('ref=/'),
  'asteriscos': '*'.repeat(N), 'asterisco-a': rep('*a'), 'três asteriscos': rep('***a'), 'sublinhados': rep('_a'), 'duplo sublinhado': rep('__a'),
  'til': rep('~~a'), 'barras': rep('||a'), 'dois pontos': rep(':a'), 'dois pontos longos': rep(':aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  'crases': '`'.repeat(N), 'crase-a': rep('`a'), 'blocos de código': rep('```a'), 'menções': rep('<@1'), 'menções abertas': rep('&lt;@'), 'emoji custom': rep('<:a:1'),
  'horários': rep('<t:1'), 'títulos': rep('# a\n'), 'citações': rep('> a\n'), 'convites': rep('/invite/'), 'convites com host': rep('http://a/invite/aaaa'),
  'chamadas': rep('📞 /call/'), 'clipes': rep('/#/clip/1'), 'tema': 'resenha-theme:' + 'A'.repeat(N - 14), 'temas colados': rep('resenha-theme:AAAAAAA'),
  'emojis e x': '😀 '.repeat(27) + ' x', 'emojis e espaços': rep('😀  ') + 'x', 'emojis com tom de pele': '👍🏽 '.repeat(27) + 'x', 'tons de pele soltos': '🏽'.repeat(27) + 'x',
  'emojis grudados e x': '😀'.repeat(27) + 'x', 'gif sem fim': 'https://' + 'a'.repeat(N - 12) + '.gif?', 'gif de pontos': 'https://' + rep('a.gif') + ' ', 'everyone': rep('@everyone'),
};
// cada função num worker: se uma expressão travar, o worker é morto e o caso conta como falha (em vez de travar o teste)
const { Worker } = await import('node:worker_threads');
const spawnW = () => new Promise((res) => { const w = new Worker(new URL('./abuse-regex-worker.mjs', import.meta.url)); w.once('message', (m) => res({ w, fns: m.ready })); });
let W = await spawnW();
const runOne = (fn, s) => new Promise((res) => {
  const t = setTimeout(async () => { W.w.terminate(); W = await spawnW(); res(Infinity); }, 3000);
  W.w.once('message', (m) => { clearTimeout(t); res(m.ms); }); W.w.postMessage({ fn, s });
});
const worst = {};
for (const fn of W.fns) for (const [name, s] of Object.entries(inputs)) {
  const ms = await runOne(fn, s);
  if (!worst[fn] || ms > worst[fn].raw) worst[fn] = { raw: ms, ms: ms === Infinity ? '> 3000' : +ms.toFixed(1), name, bad: !(ms < LIMIT) };
}
W.w.terminate();
for (const [fn, w] of Object.entries(worst)) ok(!w.bad, `${fn}: pior caso ${w.ms} ms (${w.name})`);
// ---- mensagem gigante e ruim no chat de verdade ----
const nasty = ['😀 '.repeat(27) + ' x', '*a'.repeat(2000), 'http://' + '.'.repeat(3993), ':a'.repeat(2000), '<@1'.repeat(1333)];
let sent = 0; for (const s of nasty) { await sleep(900); if ((await call(A.token, 'POST', `/channels/${ch.id}/messages`, { content: s })).id) sent++; }
ok(sent === nasty.length, 'as mensagens ruins foram aceitas pelo servidor', { sent });
await p.evaluate(() => window.__lc.go('@me')); await sleep(500);
const t = await p.evaluate(async (g, c) => {
  let worst = 0; const po = new PerformanceObserver(l => { for (const e of l.getEntries()) worst = Math.max(worst, e.duration); }); po.observe({ entryTypes: ['longtask'] });
  const t0 = performance.now(); window.__lc.go(g, c);
  while (!document.body.innerText.includes('😀 😀 😀') && performance.now() - t0 < 20000) await new Promise(r => setTimeout(r, 20));
  const ms = performance.now() - t0; await new Promise(r => setTimeout(r, 300)); po.disconnect(); return { abrir_ms: Math.round(ms), maior_tarefa_ms: Math.round(worst) };
}, g.id, ch.id);
ok(t.abrir_ms < 3000 && t.maior_tarefa_ms < 400, 'chat com as mensagens ruins abre sem travar', t);
await br.close(); srv.kill(); fs.rmSync(D, { recursive: true, force: true });
console.log(fails ? fails + ' falha(s)' : 'tudo certo'); process.exit(fails ? 1 : 0);
