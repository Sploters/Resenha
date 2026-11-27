// Mesa de RPG no app: mestre e jogador na mesma chamada. Abre a mesa, cria ficha pela janela, rola dados pelos botões,
// inimigo em vida oculta (o jogador só vê o dano), combate pela aba e o campo da rolagem que não perde o foco.
// Uso: node scripts/rpg-ui-test.mjs   (capturas em .testshots/rpg; BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3271, BASE = `http://localhost:${PORT}`, OUT = '.testshots/rpg', DIR = './.testdata-rpg';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC_PORT: '41070', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, name: n }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function page(u) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  p.on('pageerror', e => { errs.push(u.name + ': ' + e.message); console.log('PAGEERR', u.name, e.message); });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 }); return p;
}
const click = (p, sel, re) => p.evaluate((s, r) => { const b = [...document.querySelectorAll(s)].find(x => !r || new RegExp(r).test(x.textContent)); if (!b) return false; b.click(); return true; }, sel, re?.source);
const rpg = (p, d) => p.evaluate((x) => window.__lc.voice.send('RPG', x), d);
const st = (p) => p.evaluate(() => window.__lc.import('rpg.js').then(() => null)).then(() => p.evaluate(() => document.querySelector('.rpgtile')?.innerText || ''));
try {
  const A = await reg('mestra'), B = await reg('beto');
  const g = await call(A.tok, 'POST', '/guilds', { name: 'Taverna' });
  const code = (await call(A.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(B.tok, 'POST', '/invites/' + code);
  const pa = await page(A), pb = await page(B);
  const vch = await pa.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const p of [pa, pb]) {
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(400);
    await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await p.waitForFunction(() => window.__lc.voice?.active, { timeout: 20000 }); await sleep(700);
  }

  // ---------- abrir pela lista de atividades ----------
  const entry = await pa.evaluate(() => window.__lc.import('userbar.js').then(m => m.activityEntries().find(e => e.id === 'rpg')));
  ok(entry?.title === 'Mesa de RPG', 'Mesa de RPG está nas atividades (foguete)', entry);
  await pa.evaluate(() => window.__lc.import('userbar.js').then(m => m.activityEntries().find(e => e.id === 'rpg').fn())); await sleep(900);
  for (const [p, n] of [[pa, 'mestra'], [pb, 'beto']]) ok(await p.$('#stage .spot .rpgtile') !== null, `quadro da mesa abre em destaque no palco (${n})`);
  ok(/Você é o mestre/.test(await st(pa)) && !/Você é o mestre/.test(await st(pb)) && /mestra/.test(await st(pb)), 'mestre identificado: "Você é o mestre" para a mestra, coroa com o nome para o jogador');
  ok(await pa.$$eval('.rpgtile .rpg-tab', b => b.map(x => x.textContent).join()) === 'Mesa,Diário,Mestre' && await pb.$$eval('.rpgtile .rpg-tab', b => b.map(x => x.textContent).join()) === 'Mesa,Diário', 'aba Mestre só existe para o mestre');
  ok(await pa.$eval('.rpg-togrow .rpg-tog:last-child', e => e.textContent) === 'Secreta' && await pb.$eval('.rpg-togrow .rpg-tog:last-child', e => e.textContent) === 'Privada', 'mestre rola em segredo; jogador rola em privado (só ele e o mestre)');

  // ---------- ficha D&D pela janela ----------
  ok(await click(pb, '.rpgtile .rpg-player-h .btn', /Nova ficha/), 'botão "Nova ficha"');
  await sleep(300);
  const pts0 = await pb.evaluate(() => document.querySelector('.modal .rpg-at-info')?.innerText || '');
  ok(/Pontos: 0 de 27/.test(pts0), 'começa na compra de pontos: tudo 8, 27 pontos para gastar', pts0);
  await pb.evaluate(() => {
    const m = [...document.querySelectorAll('.modal')].at(-1), fld = (re) => [...m.querySelectorAll('.rpg-field')].find(f => re.test(f.firstChild.textContent)).querySelector('input');
    const set = (i, v, ev = 'input') => { i.value = v; i.dispatchEvent(new Event(ev)); };
    set(fld(/^Nome$/), 'Bruk'); set(fld(/^Raça$/), 'Meio-orc', 'change'); set(fld(/^Classe$/), 'Bárbaro');
    set(fld(/^Tags/), 'faminto');
  });
  await sleep(100);
  ok(await click(pb, '.modal .rpg-link', /Distribuir pela classe/), 'botão "Distribuir pela classe" aparece para Bárbaro');
  const row = (k) => pb.evaluate((kk) => { const r = [...document.querySelectorAll('.modal .rpg-at-row')].find(x => x.querySelector('.rpg-at-k')?.textContent === kk); const b = r.querySelectorAll('b'); return { base: r.querySelector('.rpg-at-base input').value, bon: r.querySelector(':scope > input').value, tot: b[0].textContent, mod: b[1].textContent }; }, k);
  const rf = await row('FOR'), rc = await row('CON'), ri = await row('INT');
  ok(rf.base === '15' && rf.bon === '2' && rf.tot === '17' && rf.mod === '+3', 'FOR: 15 do conjunto padrão + 2 do meio-orc = 17, modificador +3 (não +17)', rf);
  ok(rc.tot === '15' && rc.mod === '+2' && ri.tot === '8' && ri.mod === '−1', 'CON 14+1 = 15 (+2); INT 8 (−1)', { rc, ri });
  const info = await pb.evaluate(() => document.querySelector('.modal .rpg-at-info').innerText);
  ok(/d12/.test(info) && /proficiência \+2/.test(info), 'dicas: dado de vida da classe e proficiência do nível', info);
  ok(await click(pb, '.modal .btn', /sugerida/), 'vida sugerida (d12 + CON)');
  await pb.screenshot({ path: `${OUT}/01-nova-ficha.png` });
  await click(pb, '.modal .mf .btn', /^Salvar$/); await sleep(700);
  const sa = await st(pa);
  ok(/Bruk/.test(sa) && /Meio-orc · Bárbaro · nível 1/.test(sa) && /Vida 14 \/ 14/.test(sa) && /faminto/.test(sa), 'mestra vê a ficha: raça, classe, vida 12+2', sa.slice(0, 300));

  // ---------- dados ----------
  await click(pb, '.rpg-dbtn', /^d20$/); await click(pb, '.rpg-dbtn', /^d20$/); await click(pb, '.rpg-mbtn', /\+/); await click(pb, '.rpg-mbtn', /\+/);
  ok(await pb.$eval('.rpg-expr', e => e.value) === '2d20+2', 'clicar no d20 duas vezes e +2 monta 2d20+2');
  await pb.$eval('.rpg-expr', e => { e.value = '1d20+@FOR'; });
  await click(pb, '.rpg-togrow .rpg-tog', /^Vantagem$/);
  await click(pb, '.rpg-go'); await sleep(700);
  const resA = await pa.evaluate(() => document.querySelector('.rpg-result')?.innerText || '');
  ok(/Bruk/.test(resA) && /FOR \+3/.test(resA) && /vantagem|Crítico|Falha/.test(resA), 'rolagem com @FOR usa o modificador (+3) e a mestra vê', resA);
  const li = await pa.evaluate(() => { const x = document.querySelector('.rpg-side .rpg-log .rpg-li.roll'); return { txt: x?.querySelector('.rpg-li-row')?.innerText, det: x && getComputedStyle(x.querySelector('.rpg-li-det')).display }; });
  ok(/Bruk/.test(li.txt) && li.det === 'none', 'histórico compacto: uma linha (os dados só ao clicar)', li);
  await pb.screenshot({ path: `${OUT}/02-rolagem.png` });

  // ---------- inimigo em vida oculta ----------
  await rpg(pa, { op: 'foe.save', foe: { name: 'Dragão Ancião', boss: true, mode: 'hidden', hp: { max: 300 }, weak: 'gelo', ini: 2 } }); await sleep(400);
  ok(!/Dragão/.test(await st(pb)), 'inimigo preparado não aparece para o jogador');
  await click(pa, '.rpg-tab', /Mestre/); await sleep(300);
  await click(pa, '.rpg-card.foe .ibtn[title^="Pôr em cena"]'); await sleep(500);
  ok(/Dragão Ancião/.test(await st(pb)) && /Chefe/.test(await st(pb)), 'pôr em cena: o jogador vê o chefe');
  await pa.screenshot({ path: `${OUT}/03-mestre.png` });

  // ---------- combate na própria aba Mesa ----------
  await click(pa, '.rpg-tab', /^Mesa/); await sleep(200);
  ok(await click(pa, '.rpgtile .btn', /Começar combate/), 'mestra começa o combate na aba Mesa');
  await sleep(600);
  const tk = await pb.evaluate(() => [...document.querySelectorAll('.rpg-tk')].map(e => e.querySelector('.rpg-tk-init').textContent));
  ok(tk.length === 2 && tk.every(t => /^-?\d+$/.test(t)), 'faixa de turnos com a iniciativa de todos já rolada', tk);
  await click(pa, '.rpg-tk', /Dragão/); await sleep(200);
  await pa.evaluate(() => { const i = document.querySelector('.rpg-focus .rpg-amt'); i.value = '45'; });
  await click(pa, '.rpg-focus .btn', /^Dano$/); await sleep(500);
  await click(pa, '.rpg-focus .rpg-chip.tog', /^Envenenado/); await sleep(500);
  await click(pb, '.rpg-tk', /Dragão/); await sleep(200); // a iniciativa é aleatória: o jogador olha o dragão
  const sb = await st(pb);
  ok(/45 de dano/.test(sb) && !/255|300/.test(sb) && !/gelo/.test(sb), 'dano pelo painel; jogador vê só o dano (sem vida nem fraqueza)', sb.slice(0, 400));
  await click(pb, '.rpg-tk', /Dragão/); await sleep(200);
  ok(/Envenenado/.test(await pb.evaluate(() => document.querySelector('.rpg-focus')?.innerText || '')), 'condição marcada com um clique aparece para o jogador');
  const cur0 = await pa.evaluate(() => document.querySelector('.rpg-tk.cur')?.textContent);
  await click(pa, '.rpg-next'); await sleep(500);
  const cur1 = await pb.evaluate(() => document.querySelector('.rpg-tk.cur')?.textContent);
  ok(cur0 && cur1 && cur0 !== cur1, 'próximo turno muda a vez para todos', { cur0, cur1 });
  await pa.screenshot({ path: `${OUT}/04-combate-mestre.png` });
  await pb.screenshot({ path: `${OUT}/05-combate-jogador.png` });

  // ---------- teste pedido pelo mestre (CD escondida) ----------
  const modalSet = (p, pairs) => p.evaluate((pp) => { const m = [...document.querySelectorAll('.modal')].at(-1);
    for (const [re, v, ev] of pp) { const f = [...m.querySelectorAll('.rpg-field, .rpg-check')].find(x => new RegExp(re).test(x.textContent)); const i = f.querySelector('input,select,textarea');
      if (i.type === 'checkbox') i.checked = v; else i.value = v; i.dispatchEvent(new Event(ev || 'input')); } }, pairs);
  await click(pa, '.rpg-tab', /Mestre/); await sleep(200);
  ok(await click(pa, '.rpg-action', /Pedir teste/), 'mestre: "Pedir teste" no painel');
  await sleep(200);
  await modalSet(pa, [['^Perícia ou atributo', 'Furtividade', 'change'], ['^Dificuldade', '12'], ['Esconder a CD', true], ['^Se falhar', 'Os guardas ouvem.']]);
  await click(pa, '.modal .mf .btn', /^Pedir$/); await sleep(500);
  const pr = await pb.evaluate(() => document.querySelector('.rpg-prompt')?.innerText || '');
  ok(/Teste de Furtividade/.test(pr) && /CD escondida/.test(pr) && !/12/.test(pr) && !/guardas/.test(pr), 'jogador recebe o aviso do teste, sem a CD nem a consequência', pr);
  ok(await click(pb, '.rpg-prompt .btn', /Rolar Furtividade/), 'jogador rola o teste pelo aviso');
  await sleep(500);
  ok(/Bruk \d+ [✓✗]/.test(await pa.evaluate(() => document.querySelector('.rpg-prompt')?.innerText || '')), 'mestre vê o resultado (sucesso ou falha)');
  await pb.screenshot({ path: `${OUT}/06-teste-pedido.png` });
  await click(pa, '.rpg-prompt .btn', /Encerrar teste/); await sleep(500);
  ok(/Furtividade CD 12: Bruk \d+/.test(await pb.evaluate(() => document.querySelector('.rpg-side .rpg-log .rpg-li.note')?.innerText || '')) && !(await pb.$('.rpg-prompt')), 'encerrado: resultado e CD no histórico, aviso some');

  // ---------- inspiração e ficha completa ----------
  await click(pa, '.rpg-tab', /^Mesa/); await sleep(200);
  await click(pa, '.rpg-tk', /Bruk/); await sleep(200);
  ok(await click(pa, '.rpg-focus .btn', /Dar inspiração/), 'mestre dá inspiração pelo painel do combate');
  await sleep(400);
  await click(pb, '.rpg-tk', /Bruk/); await sleep(200);
  await click(pb, '.rpg-focus .rpg-open'); await sleep(400);
  const sh = await pb.evaluate(() => document.querySelector('.rpg-sheet')?.innerText || '');
  ok(/Inspiração 1\/4/.test(sh) && /Atletismo/.test(sh) && /Furtividade/.test(sh), 'ficha completa abre com inspiração e perícias', sh.slice(0, 200));
  await click(pb, '.rpg-sheet .rpg-link', /vantagem/); await sleep(400);
  ok(/vantagem guardada/.test(await pb.evaluate(() => document.querySelector('.rpg-sheet').innerText)), 'gastar inspiração: vantagem guardada (a ficha atualiza ao vivo)');
  await click(pb, '.rpg-sheet .rpg-prof'); await sleep(300);
  await click(pb, '.rpg-sheet .rpg-skill', /Acrobacia/); await sleep(600);
  const rs = await pa.evaluate(() => document.querySelector('.rpg-result')?.innerText || '');
  ok(/Acrobacia/.test(rs) && /Inspiração/.test(rs) && /vantagem|20 natural|1 natural/.test(rs) && /PROF \+2/.test(rs), 'teste de perícia pela ficha: treinada (+2) e com a vantagem da inspiração', rs);
  await pb.screenshot({ path: `${OUT}/07-ficha.png` });
  // inventário
  await click(pb, '.rpg-sheet .rpg-seg button', /Inventário/); await sleep(200);
  await click(pb, '.rpg-sheet .btn', /Adicionar item/); await sleep(200);
  await modalSet(pb, [['^Nome', 'Poção de cura'], ['^Tipo', 'pocao', 'change']]);
  await click(pb, '.modal .mf .btn', /^Salvar$/); await sleep(500);
  ok(/Poção de cura/.test(await pb.evaluate(() => document.querySelector('.rpg-sheet').innerText)), 'item entra no inventário');
  await click(pb, '.rpg-sheet .btn', /^Usar$/); await sleep(500);
  ok(/Bruk usou Poção de cura/.test(await pa.evaluate(() => [...document.querySelectorAll('.rpg-side .rpg-log .rpg-li.note')].map(x => x.innerText).join('|'))) && !/Poção de cura/.test(await pb.evaluate(() => document.querySelector('.rpg-sheet .rpg-sheet-body').innerText)), 'usar a poção: some do inventário e todos veem');
  await pb.keyboard.press('Escape'); await sleep(300);

  // ---------- reação oferecida ----------
  await click(pa, '.rpg-tk', /Bruk/); await sleep(200);
  await click(pa, '.rpg-focus .btn', /Oferecer reação/); await sleep(200);
  await click(pa, '.menu .it', /Proteger aliado/); await sleep(500);
  ok(/Reação: Proteger aliado/.test(await pb.evaluate(() => document.querySelector('.rpg-prompt')?.innerText || '')), 'jogador vê a reação disponível');
  await click(pb, '.rpg-prompt .btn', /^Reagir$/); await sleep(500);
  ok(/Bruk reagiu: Proteger aliado/.test(await pa.evaluate(() => [...document.querySelectorAll('.rpg-side .rpg-log .rpg-li')].map(x => x.innerText).join('|'))), 'aceitou: registrado no histórico');

  // ---------- momento decisivo ----------
  await click(pa, '.rpg-tab', /Mestre/); await sleep(200);
  await click(pa, '.rpg-action', /Momento decisivo/); await sleep(200);
  await modalSet(pa, [['^Título', 'A ponte está caindo'], ['^Opções', 'Correr\nSegurar a corda']]);
  await click(pa, '.modal .mf .btn', /^Apresentar$/); await sleep(500);
  ok(await click(pb, '.rpg-opt', /Segurar a corda/), 'jogador vota numa opção');
  await sleep(400);
  await click(pa, '.rpg-prompt .btn', /^Decidir$/); await sleep(200);
  await modalSet(pa, [['^Consequência', 'Todos atravessam, mas a corda se rompe.']]);
  await click(pa, '.modal .mf .btn', /^Decidir$/); await sleep(500);
  await click(pb, '.rpg-tab', /Diário/); await sleep(300);
  const jr = await pb.evaluate(() => document.querySelector('.rpg-body').innerText);
  ok(/A ponte está caindo/.test(jr) && /Decisão: Segurar a corda/.test(jr) && /corda se rompe/.test(jr), 'decisão e consequência vão para o diário', jr.slice(0, 300));
  // diário: o jogador anota uma pista
  await click(pb, '.rpg-body .btn', /Escrever/); await sleep(200);
  const kinds = await pb.evaluate(() => [...document.querySelectorAll('.modal select option')].map(o => o.textContent).join());
  ok(kinds === 'Pista,NPC,Local,Anotação', 'jogador escreve pistas, NPCs, locais e anotações (missões são do mestre)', kinds);
  await modalSet(pb, [['^Tipo', 'pista', 'change'], ['^Título', 'Pegadas de lobo'], ['^Texto', 'Vão para o norte.']]);
  await click(pb, '.modal .mf .btn', /^Salvar$/); await sleep(400);
  await click(pa, '.rpg-tab', /Diário/); await sleep(300);
  ok(/Pegadas de lobo/.test(await pa.evaluate(() => document.querySelector('.rpg-body').innerText)), 'a pista aparece para o mestre');
  await pb.screenshot({ path: `${OUT}/08-diario.png` });
  await click(pa, '.rpg-tab', /Mestre/); await sleep(200);
  await pa.screenshot({ path: `${OUT}/09-painel-mestre.png` });
  await click(pa, '.rpg-tab', /^Mesa/); await click(pb, '.rpg-tab', /^Mesa/); await sleep(200);

  // ---------- foco no campo da rolagem enquanto a mesa muda ----------
  await pb.focus('.rpg-expr'); await pb.$eval('.rpg-expr', e => { e.value = ''; }); await pb.keyboard.type('3d6');
  await rpg(pa, { op: 'combat.next' }); await sleep(600);
  const foc = await pb.evaluate(() => ({ f: document.activeElement?.classList.contains('rpg-expr'), v: document.querySelector('.rpg-expr').value }));
  ok(foc.f && foc.v === '3d6', 'campo da rolagem mantém foco e texto quando a mesa atualiza', foc);

  // ---------- fechar: só o mestre; reabrir traz tudo ----------
  await pb.evaluate(() => window.__lc.voice.send('ROOM_ACT', { act: 'rpg', on: false })); await sleep(500);
  ok(await pb.$('#stage .rpgtile') !== null, 'jogador não fecha a mesa');
  await pa.evaluate(() => window.__lc.voice.send('ROOM_ACT', { act: 'rpg', on: false })); await sleep(600);
  ok(await pb.$('#stage .rpgtile') === null, 'mestra fecha para todos');
  await pa.evaluate(() => window.__lc.voice.send('ROOM_ACT', { act: 'rpg', on: true })); await sleep(800);
  ok(/Bruk/.test(await st(pb)), 'reabrir traz a campanha de volta');
  
  ok(!errs.length, 'sem erros de página', errs);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
