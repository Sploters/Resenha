// Procurar jogadores: regras (quem vê, validação, pedidos, vagas, perfil) e o fluxo em 3 navegadores
// (perfil, criar anúncio, avisos, "Pedir para entrar" → aceitar → convite para a chamada, copiar, encerrar) e o que veio do
// canal LFG do Discord: plataforma, entrada direta, sair do grupo, conversa do anúncio e "Jogando agora" ao vivo.
// Uso: node scripts/lfg-test.mjs   (SHOTS=1 salva capturas em .testshots/lfg)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3231, BASE = `http://localhost:${PORT}`, OUT = '.testshots/lfg';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata12', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata12' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s) => { window.__copied.push(s); } } }); }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const toastHas = (P, re) => P.waitForFunction((re) => new RegExp(re).test(document.getElementById('toast')?.textContent || ''), { timeout: 5000 }, re).then(() => true, () => false);
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla'), d = await reg('davi'), e = await reg('eva');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogatina' }); const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, e]) await call(u.tok, 'POST', '/invites/' + code);
  await call(a.tok, 'POST', '/relationships', { username: 'carla' }); await call(c.tok, 'PUT', `/relationships/${a.id}`, {});
  await call(e.tok, 'PUT', `/relationships/${a.id}`, { type: 2 }); // eva bloqueou a alice
  const gfull = (await call(a.tok, 'GET', `/guilds/${g.id}`)); void gfull;

  // ---------- API ----------
  const meta = await call(a.tok, 'GET', '/lfg/meta');
  ok(meta.games?.some(x => x.id === 'valorant') && meta.games.some(x => x.id === 'lol' && x.modes.includes('Clash')) && meta.games.some(x => x.id === 'repo'), 'catálogo com Valorant, LoL (Clash), CS2 e party games');
  const P = (tok, body) => call(tok, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Competitivo', slots: 2, ...body });
  ok((await P(a.tok, { game: 'xyz' })).status === 400, 'jogo inválido é recusado');
  ok((await P(a.tok, { mode: 'Deathmatch maluco' })).status === 400, 'modo que não existe no jogo é recusado');
  ok((await P(a.tok, { slots: 0 })).status === 400 && (await P(a.tok, { slots: 10 })).status === 400, 'vagas fora de 1–9 são recusadas');
  ok((await P(a.tok, { rank_min: 'Diamante', rank_max: 'Ouro' })).status === 400, 'elo mínimo maior que o máximo é recusado');
  ok((await P(a.tok, { rank_min: 'Challenger' })).status === 400, 'elo de outro jogo é recusado');
  ok((await P(a.tok, { when_at: Date.now() - 3600e3 })).status === 400, 'horário no passado é recusado');
  ok((await P(a.tok, { game: 'other', game_name: '', mode: 'Casual' })).status === 400, '"Outro jogo" exige o nome');
  const p1 = await P(a.tok, { rank_min: 'Ouro', rank_max: 'Platina', roles: ['Controlador', 'Topo'], mic: true, note: 'call tranquila' });
  ok(p1.status === 200 && p1.slots === 2 && JSON.stringify(p1.roles) === '["Controlador"]' && p1.mic, 'anúncio criado (função de outro jogo descartada)', p1.roles);
  const seen = async (u) => (await call(u.tok, 'GET', '/lfg/posts')).some(x => x.id === p1.id);
  ok(await seen(b), 'membro do mesmo servidor vê o anúncio');
  ok(await seen(c), 'amigo (fora do servidor) vê o anúncio');
  ok(!(await seen(d)), 'desconhecido não vê');
  ok(!(await seen(e)), 'quem bloqueou não vê');
  ok((await call(d.tok, 'POST', `/lfg/posts/${p1.id}/request`, {})).status === 404, 'desconhecido não consegue pedir para entrar');
  ok((await call(a.tok, 'POST', `/lfg/posts/${p1.id}/request`, {})).status === 400, 'o autor não pede para entrar no próprio anúncio');
  await P(a.tok, { game: 'lol', mode: 'Clash', slots: 3 }); await P(a.tok, { game: 'cs2', mode: 'Premier', slots: 1 });
  ok((await P(a.tok, { game: 'repo', mode: 'Casual', slots: 1 })).status === 400, 'no máximo 3 anúncios abertos por pessoa');
  const mine = await call(a.tok, 'GET', '/lfg/posts'); for (const x of mine) if (x.id !== p1.id) await call(a.tok, 'POST', `/lfg/posts/${x.id}/close`);
  ok((await call(b.tok, 'POST', `/lfg/posts/${p1.id}/close`)).status === 403, 'só o autor encerra');
  ok((await call(a.tok, 'PUT', '/lfg/profile/valorant', { ign: 'Alice#BR1', rank: 'Mestre' })).status === 400, 'perfil: elo de outro jogo é recusado');
  ok((await call(a.tok, 'PUT', '/lfg/profile/valorant', { ign: 'Alice#BR1', rank: 'Platina', roles: ['Controlador', 'Flex'] })).ign === 'Alice#BR1', 'perfil de jogador salvo');
  ok((await call(d.tok, 'GET', `/lfg/profile/${a.id}`)).status === 404 && (await call(b.tok, 'GET', `/lfg/profile/${a.id}`))[0]?.rank === 'Platina', 'perfil visível só para quem divide servidor ou é amigo');

  // ---------- navegador ----------
  const A = await page(a.tok), B = await page(b.tok), C = await page(c.tok);
  for (const X of [A, B, C]) await X.evaluate(() => window.__lc.go('@me', 'lfg')); // seção Jogos, aba Procurar jogadores
  await B.waitForSelector('#lfgview .lfgcard', { timeout: 5000 }).catch(() => { });
  const cardB = await B.evaluate(() => { const c = document.querySelector('#lfgview .lfgcard'); return c && { t: c.textContent, stat: c.querySelector('.lfgwho .lfgstat')?.href }; });
  ok(/Precisa de 2/.test(cardB?.t) && /Ouro – Platina/.test(cardB.t) && /Alice#BR1 · Platina/.test(cardB.t) && /Agora/.test(cardB.t) && /call tranquila/.test(cardB.t), 'cartão: vagas, faixa de elo, perfil do autor, agora e recado', cardB?.t?.slice(0, 160));
  ok(cardB?.stat === 'https://tracker.gg/valorant/profile/riot/Alice%23BR1/overview', 'link para o Tracker a partir do Riot ID', cardB?.stat);
  // atalhos externos ao filtrar Valorant + aviso
  await B.evaluate(() => [...document.querySelectorAll('#lfgview .lchip')].find(x => x.textContent === 'Valorant').click()); await sleep(200);
  ok(await B.evaluate(() => [...document.querySelectorAll('.lfglinks a')].map(x => x.href).join() === 'https://duo.op.gg/pt/valorant/,https://spikr.com.br/'), 'atalhos para DUO.OP.GG e Spikr no filtro Valorant');
  await B.evaluate(() => document.querySelector('.lfgalert .switch').click()); await sleep(300);
  ok(await B.evaluate(() => window.__lc.S.prefs.lfgAlerts?.valorant === true), 'aviso de novos anúncios de Valorant ligado');
  await A.evaluate(() => [...document.querySelectorAll('#lfgview .lchip')].find(x => x.textContent === 'Valorant').click()); await sleep(200);
  await A.evaluate(() => document.querySelector('.lfgalert .switch').click()); await sleep(300);
  if (process.env.SHOTS) { await sleep(400); await B.screenshot({ path: `${OUT}/01-mural.png` }); }
  // carla (amiga) cria um anúncio pelo formulário → bruno é avisado
  await C.evaluate(() => [...document.querySelectorAll('#lfgview .lfg-hero .btn')].find(x => /Criar anúncio/.test(x.textContent)).click()); await sleep(400);
  await C.evaluate(() => [...document.querySelectorAll('.lfgform .lchip')].find(x => x.textContent === 'Valorant').click()); await sleep(150);
  await C.evaluate(() => { const s = [...document.querySelectorAll('.lfgform label.f')].find(l => l.textContent.startsWith('Modo')).querySelector('select'); s.value = 'Premier'; s.dispatchEvent(new Event('change')); });
  await C.evaluate(() => { const s = [...document.querySelectorAll('.lfgform label.f')].find(l => l.textContent.startsWith('Vagas')).querySelector('select'); s.value = '1'; s.dispatchEvent(new Event('change')); });
  await C.evaluate(() => [...document.querySelectorAll('.lfgform .lfgroles button')].find(x => x.textContent === 'Sentinela').click());
  await C.type('.lfgform input[placeholder^="Ex.: sem rage"]', 'time fechado, falta 1');
  if (process.env.SHOTS) { await sleep(300); await C.screenshot({ path: `${OUT}/02-criar.png` }); }
  await C.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === 'Publicar').click());
  ok(await toastHas(A, 'carla procura 1 pessoa para Valorant \\(Premier\\)'), 'alice (amiga da carla, aviso de Valorant ligado) é avisada do anúncio novo');
  ok(await A.waitForFunction(() => document.querySelectorAll('#lfgview .lfgcard').length === 2, { timeout: 4000 }).then(() => true, () => false), 'o anúncio novo aparece na hora no mural da alice');
  await sleep(500);
  ok(await B.evaluate(() => document.querySelectorAll('#lfgview .lfgcard').length) === 1, 'bruno (sem relação com a carla) não vê o anúncio dela');
  // alice entra na sala de voz; bruno pede para entrar; alice aceita → convite para a chamada
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
  await A.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
  await A.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  await A.evaluate(() => window.__lc.go('@me', 'lfg')); await sleep(800);
  await B.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => x.textContent === 'Pedir para entrar').click(), p1.id);
  ok(await toastHas(A, 'bruno quer entrar no seu grupo de Valorant'), 'alice é avisada do pedido');
  ok(await A.waitForFunction((id) => !!document.querySelector(`.lfgcard[data-id="${id}"] .lfgreq`), { timeout: 4000 }, p1.id).then(() => true, () => false), 'pedido aparece no cartão da alice com Aceitar/Recusar');
  ok(await B.evaluate((id) => /Pedido enviado/.test(document.querySelector(`.lfgcard[data-id="${id}"]`).textContent), p1.id), 'bruno vê "Pedido enviado"');
  if (process.env.SHOTS) { await sleep(300); await A.screenshot({ path: `${OUT}/03-pedido.png` }); }
  await A.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"] .lfgreq`).querySelectorAll('.btn')].find(x => x.textContent === 'Aceitar').click(), p1.id);
  ok(await B.waitForSelector('#call-banner.callinv', { timeout: 5000 }).then(() => true, () => false), 'aceito: bruno recebe o convite para a chamada da alice');
  const after = await A.evaluate((id) => document.querySelector(`.lfgcard[data-id="${id}"]`).textContent, p1.id);
  ok(/Precisa de 1/.test(after) && /No grupo:/.test(after), 'vaga ocupada e bruno no grupo', after.slice(0, 80));
  ok(await B.evaluate((id) => /Você está no grupo/.test(document.querySelector(`.lfgcard[data-id="${id}"]`)?.textContent || ''), p1.id), 'bruno vê "Você está no grupo"');
  // copiar anúncio
  await C.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => /Copiar anúncio/.test(x.textContent)).click(), p1.id);
  const txt = await C.evaluate(() => window.__copied.at(-1) || '');
  ok(/^🎮 LFG — Valorant · Competitivo/.test(txt) && /Precisa de 1 · Ouro – Platina/.test(txt) && /Funções: Controlador · 🎙️ Com microfone/.test(txt) && /Riot ID: Alice#BR1 \(Platina\)/.test(txt), 'texto do anúncio pronto para colar', txt);
  // carla pede, alice aceita a última vaga → completo, sai do mural dos outros
  await C.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => x.textContent === 'Pedir para entrar').click(), p1.id); await sleep(500);
  await call(a.tok, 'POST', `/lfg/posts/${p1.id}/answer`, { user_id: c.id, accept: true });
  ok(await B.waitForFunction((id) => !document.querySelector(`#lfgview .lfgcard[data-id="${id}"]`), { timeout: 4000 }, p1.id).then(() => true, () => false), 'grupo completo: anúncio sai do mural');
  ok(await A.waitForFunction((id) => /Completo/.test(document.querySelector(`.lfgcard[data-id="${id}"]`)?.textContent || ''), { timeout: 4000 }, p1.id).then(() => true, () => false), 'autor vê o anúncio como "Completo" em encerrados');
  ok((await call(d.tok, 'POST', `/lfg/posts/${p1.id}/request`, {})).status === 404 && (await call(e.tok, 'GET', '/lfg/posts')).every(x => x.author.id !== a.id), 'bloqueio continua valendo');
  // perfil de jogador pelo formulário
  await B.evaluate(() => [...document.querySelectorAll('#lfgview #topbar .btn')].find(x => /Meu perfil/.test(x.textContent)).click()); await sleep(400);
  await B.evaluate(() => [...document.querySelectorAll('.lfgform .lchip')].find(x => x.textContent === 'League of Legends').click()); await sleep(150);
  await B.type('.lfgform label.f input', 'Bruno#BR1');
  await B.evaluate(() => { const s = [...document.querySelectorAll('.lfgform label.f')].find(l => l.textContent.startsWith('Elo')).querySelector('select'); s.value = 'Esmeralda'; });
  await B.evaluate(() => [...document.querySelectorAll('.lfgform .lfgroles button')].find(x => x.textContent === 'Selva').click());
  if (process.env.SHOTS) { await sleep(300); await B.screenshot({ path: `${OUT}/04-perfil.png` }); }
  await B.evaluate(() => document.querySelector('.lfgform .lfgsave .btn').click()); await sleep(500);
  const pb = (await call(a.tok, 'GET', `/lfg/profile/${b.id}`)).find(x => x.game === 'lol');
  ok((await call(c.tok, 'GET', `/lfg/profile/${b.id}`)).status === 404, 'carla (sem relação com o bruno) não vê o perfil dele');
  ok(pb?.ign === 'Bruno#BR1' && pb.rank === 'Esmeralda' && pb.roles.join() === 'Selva', 'perfil de LoL salvo pelo formulário', pb);

  // ---------- plataforma, entrada direta, sair do grupo ----------
  ok((await call(b.tok, 'POST', '/lfg/posts', { game: 'repo', mode: 'Casual', slots: 1, platform: 'nintendo64' })).platform === 'pc', 'plataforma desconhecida vira PC');
  await call(b.tok, 'GET', '/lfg/posts').then(r => Promise.all(r.filter(x => x.author.id === b.id).map(x => call(b.tok, 'POST', `/lfg/posts/${x.id}/close`))));
  const p3 = await call(b.tok, 'POST', '/lfg/posts', { game: 'valorant', mode: 'Sem ranque', slots: 2, platform: 'cross', join_mode: 'open' });
  ok(p3.platform === 'cross' && p3.join_mode === 'open' && p3.msg_count === 0, 'anúncio com crossplay e entrada direta', { platform: p3.platform, join_mode: p3.join_mode });
  ok(await A.waitForFunction((id) => !!document.querySelector(`.lfgcard[data-id="${id}"]`), { timeout: 4000 }, p3.id).then(() => true, () => false), 'anúncio do bruno aparece para a alice');
  const c3 = await A.evaluate((id) => document.querySelector(`.lfgcard[data-id="${id}"]`).textContent, p3.id);
  ok(/Crossplay/.test(c3) && /Entrada direta/.test(c3) && /Entrar/.test(c3), 'cartão mostra plataforma e "Entrada direta"', c3.slice(0, 120));
  await A.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => x.textContent === 'Entrar').click(), p3.id);
  ok(await toastHas(A, 'Você entrou no grupo de bruno'), 'alice entra direto, sem esperar aprovação');
  ok(await toastHas(B, 'alice entrou no seu grupo de Valorant'), 'bruno é avisado de quem entrou');
  ok((await call(b.tok, 'GET', '/lfg/posts')).find(x => x.id === p3.id)?.slots === 1, 'a vaga foi ocupada');
  await A.waitForFunction((id) => [...(document.querySelector(`.lfgcard[data-id="${id}"]`)?.querySelectorAll('.btn') || [])].some(x => x.textContent === 'Sair'), { timeout: 4000 }, p3.id).catch(() => { });
  await A.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => x.textContent === 'Sair').click(), p3.id);
  ok(await toastHas(B, 'alice saiu do seu grupo de Valorant'), 'sair do grupo avisa o autor');
  ok((await call(b.tok, 'GET', '/lfg/posts')).find(x => x.id === p3.id)?.slots === 2, 'a vaga volta para o anúncio');
  // ---------- conversa do anúncio ----------
  ok((await call(d.tok, 'GET', `/lfg/posts/${p3.id}/messages`)).status === 404 && (await call(d.tok, 'POST', `/lfg/posts/${p3.id}/messages`, { content: 'oi' })).status === 404, 'desconhecido não lê nem escreve na conversa');
  ok((await call(a.tok, 'POST', `/lfg/posts/${p3.id}/messages`, { content: '   ' })).status === 400, 'mensagem vazia é recusada');
  await A.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => /^Conversa/.test(x.textContent)).click(), p3.id);
  await A.waitForSelector('.lfgchat input'); await A.type('.lfgchat input', 'tenho mic, jogo de sentinela'); await A.keyboard.press('Enter');
  ok(await A.waitForFunction(() => /tenho mic, jogo de sentinela/.test(document.querySelector('.lfgmsgs')?.textContent || ''), { timeout: 4000 }).then(() => true, () => false), 'mensagem aparece na conversa da alice');
  ok(await toastHas(B, 'alice escreveu no seu anúncio de Valorant'), 'autor é avisado da mensagem na conversa');
  ok(await B.waitForFunction((id) => document.querySelector(`.lfgcard[data-id="${id}"] .lfg-n`)?.textContent === '1', { timeout: 4000 }, p3.id).then(() => true, () => false), 'contador da conversa atualiza no cartão');
  await B.evaluate((id) => [...document.querySelector(`.lfgcard[data-id="${id}"]`).querySelectorAll('.btn')].find(x => /^Conversa/.test(x.textContent)).click(), p3.id);
  await B.waitForFunction(() => /tenho mic/.test(document.querySelector('.lfgmsgs')?.textContent || ''), { timeout: 4000 }).catch(() => { });
  await B.type('.lfgchat input', 'fechou, cola'); await B.keyboard.press('Enter');
  ok(await A.waitForFunction(() => /fechou, cola/.test(document.querySelector('.lfgmsgs')?.textContent || '') && /autor/.test(document.querySelector('.lfgmsgs')?.textContent || ''), { timeout: 4000 }).then(() => true, () => false), 'resposta do autor chega ao vivo, com a marca "autor"');
  if (process.env.SHOTS) { await sleep(300); await A.screenshot({ path: `${OUT}/05-conversa.png` }); }
  for (const X of [A, B]) await X.keyboard.press('Escape').then(() => X.evaluate(() => document.querySelectorAll('.backdrop').forEach(x => x.remove())));
  // ---------- "Jogando agora" ao vivo (pode abrir o jogo depois de publicar) ----------
  ok(!(await A.evaluate((id) => !!document.querySelector(`.lfgcard[data-id="${id}"] .lfglive`), p3.id)), 'sem jogo aberto: sem "Jogando agora"');
  await B.evaluate(() => window.__lc.voice.send('ACTIVITY_LOCAL', { game: { id: 'valorant', title: 'VALORANT' } }));
  ok(await A.waitForFunction((id) => /Jogando agora.*VALORANT.*2 vagas abertas/.test(document.querySelector(`.lfgcard[data-id="${id}"] .lfglive`)?.textContent || ''), { timeout: 5000 }, p3.id).then(() => true, () => false), 'bruno abriu o jogo depois de publicar: cartão mostra "Jogando agora" e as vagas');
  if (process.env.SHOTS) { await sleep(300); await (await A.$(`.lfgcard[data-id="${p3.id}"]`)).screenshot({ path: `${OUT}/06-ao-vivo.png` }); }
  await sleep(3200); // o servidor aceita uma atualização de jogo a cada 3 s por conexão
  await B.evaluate(() => window.__lc.voice.send('ACTIVITY_LOCAL', { game: { id: 'lol', title: 'League of Legends' } }));
  ok(await A.waitForFunction((id) => !document.querySelector(`.lfgcard[data-id="${id}"] .lfglive`), { timeout: 5000 }, p3.id).then(() => true, () => false), 'trocou de jogo: "Jogando agora" some (é outro jogo)');
  // ---------- filtro por servidor ----------
  // alice vê o anúncio do bruno (servidor Jogatina) e o da carla (amiga, sem servidor em comum)
  const pc = await call(c.tok, 'GET', '/lfg/posts').then(r => r.find(x => x.author.id === c.id && !x.closed));
  const vis = () => A.evaluate(() => [...document.querySelectorAll('#lfgview .lfggrid:not(.done) .lfgcard')].map(x => x.dataset.id));
  await A.evaluate(() => { const b = [...document.querySelectorAll('#lfgview .lchip')].find(x => x.textContent === 'Todos'); b?.click(); }); await sleep(200);
  let v = await vis();
  ok(v.includes(p3.id) && v.includes(pc?.id), 'sem filtro: anúncios do servidor e da amiga', v.length);
  ok((await call(a.tok, 'GET', '/lfg/posts')).find(x => x.id === p3.id)?.guilds?.includes(g.id), 'API diz o servidor em comum com o autor');
  await A.evaluate((gid) => { const s = document.querySelector('.lfgguild select'); s.value = gid; s.dispatchEvent(new Event('change')); }, g.id); await sleep(200);
  v = await vis();
  ok(v.includes(p3.id) && !v.includes(pc?.id), 'filtro "Jogatina": só o anúncio de quem está no servidor', v);
  if (process.env.SHOTS) { await sleep(200); await A.screenshot({ path: `${OUT}/07-filtro-servidor.png` }); }
  await A.reload(); await A.waitForSelector('#rail .rail-wrap'); await A.evaluate(() => window.__lc.go('@me', 'lfg')); await sleep(1200);
  ok(await A.evaluate((gid) => document.querySelector('.lfgguild select')?.value === gid, g.id), 'o filtro continua escolhido depois de recarregar');
  await A.evaluate(() => { const s = document.querySelector('.lfgguild select'); s.value = ''; s.dispatchEvent(new Event('change')); }); await sleep(200);
  ok((await vis()).includes(pc?.id), 'voltar para "Todos" mostra de novo o anúncio da amiga');
} catch (err) { console.log('  ERRO', err); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
