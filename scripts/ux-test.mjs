// Telemetria de UX (etapas 1 a 3): servidor aceita só os eventos conhecidos e guarda contagens sem quem fez; só o administrador
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
    ok(cols.join() === 'day,version,device,event,detail,n', 'a tabela não tem coluna de usuário (só dia, versão, aparelho, evento, detalhe, contagem)', cols); }
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
  ok(ev.settings_search_empty?.total === 1 && !n(ev, 'settings_search_empty', 'xyzinexistente') && Object.keys(ev.settings_search_empty.detalhes).some(k => /^\(outros: 1 com menos de 5/.test(k)), 'busca sem resultado é contada, mas o termo único fica escondido em "outros" (grupo pequeno)', ev.settings_search_empty);
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

  // ---------- etapa 2 ----------
  r = await api(eu, 'POST', '/ux', { device: 'desktop', events: [{ e: 'flow', d: 'e2ee:start', n: 4 }, { e: 'flow', d: 'e2ee:done', n: 3 }, { e: 'flow', d: 'inventado:start', n: 1 }, { e: 'flow', d: 'e2ee:meio', n: 1 }] });
  ok(r.data.kept === 2, 'fluxo: só fluxos conhecidos com passo start/done', r.data);
  let full = (await api(admin, 'GET', '/ux')).data;
  ok(full.funis?.e2ee?.comecaram === 4 && full.funis.e2ee.terminaram === 3 && full.funis.e2ee.taxa === 75, 'funil calculado (4 começaram, 3 terminaram = 75%)', full.funis?.e2ee);
  ok((await api(admin, 'GET', '/ux/access')).data.admin === true && (await api(eu, 'GET', '/ux/access')).data.admin === false, '/ux/access diz quem é o administrador');
  await P.evaluate(() => { window.__lc.S.prefs.uxStats = true; });
  // fluxo pelo app: abrir "Adicionar um servidor" e criar
  await P.evaluate(() => document.querySelector('#rail .rail-item.add').click()); await sleep(500);
  await P.evaluate(() => [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Criar').click()); await sleep(1200);
  // com raiva: 3 cliques rápidos num botão de teste; sem efeito: um clique num "botão" que não faz nada
  await P.evaluate(() => {
    const mk = (t) => { const b = document.createElement('button'); b.setAttribute('aria-label', t); b.style.cssText = 'cursor:pointer;position:fixed;left:700px;top:' + (t === 'Teste raiva' ? 300 : 400) + 'px;width:80px;height:30px;z-index:99999'; document.querySelector('#topbar').append(b); return b; };
    mk('Teste raiva'); mk('Teste morto');
  });
  await P.mouse.click(740, 315); await sleep(120); await P.mouse.click(740, 315); await sleep(120); await P.mouse.click(740, 315); await sleep(1300);
  await P.mouse.click(740, 415); await sleep(1400);
  await flush(); await sleep(300);
  full = (await api(admin, 'GET', '/ux')).data; ev = full.eventos;
  ok(full.funis.add_server.comecaram === 1 && full.funis.add_server.terminaram === 1, 'criar servidor: fluxo começou e terminou', full.funis.add_server);
  ok(n(ev, 'rage_click', 'barra de cima › Teste raiva') === 1, '3 cliques rápidos contam um clique com raiva, com "área › botão"', ev.rage_click);
  ok(n(ev, 'dead_click', 'barra de cima › Teste morto') === 1, 'clique que não muda nada conta como sem efeito', ev.dead_click);
  ok(!Object.keys(ev.dead_click?.detalhes || {}).some(k => /Teste raiva/.test(k)), 'a rajada conta só como "com raiva", não também como sem efeito', ev.dead_click);
  // painel: só o administrador vê a seção Administração
  await P.evaluate(() => window.__lc.openSettings('privacy')); await sleep(1200);
  ok(!(await P.evaluate(() => [...document.querySelectorAll('#settings h6')].some(x => x.textContent === 'Administração'))), 'quem não é administrador não vê "Administração"');
  await P.keyboard.press('Escape'); await sleep(300);
  const ctxA = await browser.createBrowserContext(), A = await ctxA.newPage(); await A.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
  A.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await A.goto(BASE); await A.evaluate((t) => localStorage.setItem('lc_token', t), admin); await A.goto(BASE); await A.waitForSelector('#rail .rail-wrap', { timeout: 15000 }); await sleep(600);
  await A.evaluate(() => window.__lc.openSettings('account')); await sleep(1200);
  ok(await A.evaluate(() => [...document.querySelectorAll('#settings h6')].some(x => x.textContent === 'Administração')), 'administrador vê "Administração" nas Configurações');
  await A.evaluate(() => [...document.querySelectorAll('#settings .ni')].find(x => /Estatísticas de uso/.test(x.textContent)).click()); await sleep(1500);
  const panel = await A.evaluate(() => ({ tiles: document.querySelectorAll('.ux-tile').length, cards: [...document.querySelectorAll('.ux-card h3')].map(x => x.textContent), cols: document.querySelectorAll('.ux-col').length, split: document.querySelectorAll('.ux-split i').length, fun: document.querySelectorAll('.ux-fun').length }));
  ok(panel.tiles === 8 && panel.cards.length >= 16 && panel.cols >= 60 && panel.split === 2 && panel.fun >= 2, 'painel: 8 números, todos os quadros, colunas por dia (eventos e pessoas), Esc × ícone e funis', panel);
  if (process.env.SHOTS) await A.screenshot({ path: process.env.SHOTS + '/ux-painel.png', fullPage: false });
  await A.evaluate(() => [...document.querySelectorAll('.uxstats .seg button, .uxstats .seg *')].find(x => x.textContent.trim() === '7 dias')?.click()); await sleep(900);
  ok(await A.evaluate(() => document.querySelectorAll('.ux-daily')[1]?.querySelectorAll('.ux-col').length === 7), 'trocar para 7 dias redesenha com 7 colunas');

  // ---------- etapa 3: versão, grupos pequenos, erros, tempos, pessoas, navegação, custo ----------
  await api(eu, 'POST', '/ux', { version: 'vteste', device: 'desktop', events: [{ e: 'games_open', d: '', n: 2 }, { e: 'timing', d: 'channel_switch:9', n: 1 }, { e: 'voice_fail', d: 'ice_failed', n: 1 }] });
  full = (await api(admin, 'GET', '/ux?version=vteste')).data;
  ok(full.eventos.games_open?.total === 2 && Object.keys(full.eventos).join() === 'games_open,voice_fail' && full.versoes.some(v => v.version === 'vteste'), 'filtro por versão mostra só o que veio daquela versão (faixa inválida descartada)', { ev: Object.keys(full.eventos), versoes: full.versoes });
  // retenção: duas contas de 3 dias atrás, uma voltou no dia seguinte (escritas direto no banco, como se fossem antigas)
  { const db = new DatabaseSync(DATA + '/resenha.db'); const d = (k) => new Date(Date.now() - k * 86400e3).toISOString().slice(0, 10);
    db.prepare('INSERT INTO ux_user(h,cohort) VALUES(?,?),(?,?)').run('teste1', d(3), 'teste2', d(3));
    db.prepare('INSERT INTO ux_seen(day,h) VALUES(?,?),(?,?),(?,?)').run(d(3), 'teste1', d(3), 'teste2', d(2), 'teste1'); db.close(); }
  // ana (estatísticas ligadas) vira amiga de eu (que desligou): só a ana conta o passo "fez um amigo"
  const euId = await P.evaluate(() => window.__lc.S.me.id);
  await api(eu, 'POST', '/relationships', { username: 'ana' }); await api(ana, 'PUT', '/relationships/' + euId, {});
  await api(eu, 'POST', `/channels/${dm}/messages`, { content: 'oi (eu desligou as estatísticas)' });
  const Q = await (await browser.createBrowserContext()).newPage(); await Q.setViewport({ width: 1400, height: 900 });
  await Q.goto(BASE); await Q.evaluate((t) => localStorage.setItem('lc_token', t), ana); await Q.goto(BASE); await Q.waitForSelector('#rail .rail-wrap', { timeout: 15000 }); await sleep(800);
  const qflush = () => Q.evaluate(async () => { await (await window.__lc.import('ux.js')).flushUx(); });
  // troca de canal medida + mensagem enviada pelo campo (tempo de envio e 1ª mensagem)
  await Q.evaluate((id) => window.__lc.go('@me', id), dm); await Q.waitForSelector('#composer textarea'); await sleep(600);
  await Q.type('#composer textarea', 'oi eu'); await Q.keyboard.press('Enter'); await sleep(800);
  // ida e volta rápida: Amigos → conversa → Amigos em menos de 3 s
  await Q.evaluate(() => window.__lc.go('@me')); await sleep(300); await Q.evaluate((id) => window.__lc.go('@me', id), dm); await sleep(500); await Q.evaluate(() => window.__lc.go('@me')); await sleep(400);
  // menu aberto e fechado sem escolher (botão direito numa conversa da lista, depois Esc)
  await Q.click('#side-list .dmrow', { button: 'right' }).catch(() => { }); await sleep(300); await Q.keyboard.press('Escape'); await sleep(400);
  // Configurações: entrar em Aparência e sair em menos de 2 s
  await Q.evaluate(() => window.__lc.openSettings('account')); await sleep(900);
  const nav = (rx) => Q.evaluate((rx) => { const el = [...document.querySelectorAll('#settings .ni')].find(x => new RegExp(rx).test(x.textContent)); const r = el.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; }, rx);
  let [x, y] = await nav('^Aparência'); await Q.mouse.click(x, y); await sleep(500); [x, y] = await nav('^Sons'); await Q.mouse.click(x, y); await sleep(600);
  await Q.keyboard.press('Escape'); await sleep(300);
  // erro de JavaScript e aviso de erro na tela (agrupados sem números nem nomes)
  await Q.addScriptTag({ content: `setTimeout(() => { throw new Error('Falha 123 ao abrir "fulano"'); });` }); // script da própria página (o de fora vira "Script error.")
  await Q.evaluate(async () => (await window.__lc.import('state.js')).toast('Falhou 42 vezes', true)); await sleep(400);
  const cost = await Q.evaluate(async () => { const c = (await window.__lc.import('ux.js')).uxCost; return { n: c.n, avg: c.total / Math.max(1, c.n), max: c.max }; });
  const qver = await Q.evaluate(async () => (await window.__lc.import('ux.js')).UX_VERSION);
  await qflush(); await sleep(400);
  full = (await api(admin, 'GET', '/ux')).data; ev = full.eventos;
  ok(cost.n >= 2 && cost.avg < 1, 'telemetria custa menos de 1 ms por clique (média)', cost);
  { const db = new DatabaseSync(DATA + '/resenha.db', { readOnly: true }); const vs = db.prepare("SELECT DISTINCT version FROM ux_daily WHERE version <> ''").all().map(r => r.version); db.close();
    ok(qver && qver !== 'dev' && vs.includes(qver), 'cada envio leva a versão do app (a do endereço dos módulos)', { qver, vs }); }
  ok(Object.keys(ev.js_error?.detalhes || {}).some(k => /Falha # ao abrir "…"/.test(k)) && !Object.keys(ev.js_error?.detalhes || {}).some(k => /fulano|123|Script error/.test(k)), 'erro de JavaScript agrupado sem números nem nomes', ev.js_error);
  ok(ev.error_shown?.total >= 1, 'aviso de erro mostrado é contado (texto escondido enquanto o grupo for pequeno)', ev.error_shown);
  ok(full.tempos?.channel_switch?.geral?.n >= 1 && full.tempos?.msg_send?.geral?.n >= 1, 'tempo de troca de canal e de envio medidos (mediana e 95%)', full.tempos);
  ok(n(ev, 'u_turn', 'Amigos → Conversa direta') >= 1, 'ida e volta rápida Amigos → conversa → Amigos', ev.u_turn);
  ok(ev.menu_open?.total >= 1 && ev.menu_abandoned?.total >= 1, 'menu fechado sem escolher é contado', { open: ev.menu_open, ab: ev.menu_abandoned });
  ok(n(ev, 'quick_exit', 'configurações › Aparência') === 1, 'página das Configurações deixada em menos de 2 s', ev.quick_exit);
  const P2 = full.pessoas;
  ok(P2.ativos.hoje === 3 && P2.ativos.d7 === 5, 'ativos hoje e em 7 dias (pessoas diferentes, sem repetir)', P2.ativos);
  ok(P2.retencao.d1.elegiveis === 2 && P2.retencao.d1.voltaram === 1 && P2.retencao.d1.taxa === 50, 'retenção no dia seguinte: 1 de 2 = 50%', P2.retencao);
  const step = (k) => P2.funil_novos.find(s => s.passo === k)?.n;
  ok(P2.novos === 5 && step('friend') === 1 && step('message') === 1 && step('returned') === 1, 'funil do usuário novo: amigo e 1ª mensagem só de quem deixou ligado; voltou outro dia', P2);
  { const db = new DatabaseSync(DATA + '/resenha.db', { readOnly: true }); const t = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('ux_seen','ux_user','ux_first')").all().length;
    const cols = ['ux_seen', 'ux_user', 'ux_first'].flatMap(n => db.prepare(`PRAGMA table_info(${n})`).all().map(c => c.name)); const ids = db.prepare('SELECT id FROM users').all().map(r => r.id);
    const leak = db.prepare('SELECT h FROM ux_seen UNION SELECT h FROM ux_user').all().some(r => ids.includes(r.h)); db.close();
    ok(t === 3 && !cols.some(c => /user|uid|name/.test(c)) && !leak, 'tabelas de pessoas guardam só um código embaralhado (nem id, nem nome)', cols); }
  if (process.env.SHOTS) { // print do painel inteiro com os dados da etapa 3
    await A.evaluate(() => [...document.querySelectorAll('.uxstats .seg *')].find(x => x.textContent.trim() === '30 dias')?.click()); await sleep(1200);
    const hgt = await A.evaluate(() => document.querySelector('.uxstats').scrollHeight + 120);
    await A.setViewport({ width: 1400, height: Math.min(6000, hgt), deviceScaleFactor: 1 }); await sleep(600);
    await A.screenshot({ path: process.env.SHOTS + '/ux-painel-full.png' });
  }
  // chave geral no servidor: UX_TELEMETRY=0
  { const P3 = 3243, B3 = `http://localhost:${P3}`, D3 = './.testdata-ux-off'; fs.rmSync(D3, { recursive: true, force: true });
    const s3 = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: P3, HTTPS: '0', DATA_DIR: D3, UX_TELEMETRY: '0' }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await fetch(B3 + '/api/server-info'); break; } catch { await sleep(200); } }
    const t3 = (await fetch(B3 + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'zeca', password: 'senha123' }) }).then(r => r.json())).token;
    const post = await fetch(B3 + '/api/ux', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t3 }, body: JSON.stringify({ events: [{ e: 'games_open', d: '', n: 1 }] }) }).then(r => r.json());
    const acc = await fetch(B3 + '/api/ux/access', { headers: { authorization: 'Bearer ' + t3 } }).then(r => r.json());
    const g = await fetch(B3 + '/api/ux', { headers: { authorization: 'Bearer ' + t3 } }).then(r => r.json());
    s3.kill(); await sleep(300); fs.rmSync(D3, { recursive: true, force: true });
    ok(post.disabled === true && acc.enabled === false && !g.eventos.games_open && g.pessoas.ativos.hoje === 0, 'UX_TELEMETRY=0 desliga tudo (eventos e contagem de pessoas)', { post, acc, ativos: g.pessoas?.ativos }); }
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
