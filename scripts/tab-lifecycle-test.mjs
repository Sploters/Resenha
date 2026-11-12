// Aba do navegador: voltar/avançar, aba congelada (o Chrome congela abas em segundo plano; no celular é o normal),
// conexão que cai e volta com mensagens chegando no meio e aba descartada (o navegador recarrega a página ao voltar).
// Uso: node scripts/tab-lifecycle-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
import net from 'node:net';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const BASE = await ownServer('lifecycle', 3331, 41230);
// a página da ana passa por um proxy TCP: cortar = derrubar as conexões dela e recusar novas (o modo offline do Chrome não
// derruba um WebSocket já aberto); o resto (beto, pela API) segue direto no servidor
const PROXY = 3332, PBASE = `http://localhost:${PROXY}`; let cut = false; const socks = new Set();
net.createServer((c) => {
  if (cut) return c.destroy();
  const u = net.connect(3331, '127.0.0.1'); socks.add(c); socks.add(u);
  c.pipe(u); u.pipe(c); const end = () => { c.destroy(); u.destroy(); socks.delete(c); socks.delete(u); }; c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
}).listen(PROXY);
const setCut = (v) => { cut = v; if (v) for (const s of socks) s.destroy(); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 30000 });
try {
  const a = await call('', 'POST', '/register', { username: 'ana', password: 'senha123' }), b = await call('', 'POST', '/register', { username: 'beto', password: 'senha123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await call(a.token, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.token, 'POST', '/invites/' + inv);
  const g2 = await call(a.token, 'POST', '/guilds', { name: 'Outro' });
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.token);
  await p.goto(PBASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 });
  const chans = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.filter(c => c.type === 0).map(c => c.id), g.id);
  let c2 = chans[1]; if (!c2) { c2 = (await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'outro', type: 0 })).id; await sleep(500); }
  const c1 = chans[0];
  await call(b.token, 'POST', `/channels/${c1}/messages`, { content: 'no geral' }); await call(b.token, 'POST', `/channels/${c2}/messages`, { content: 'no outro' });
  const dm = await call(a.token, 'POST', '/dms', { user_id: (await call(b.token, 'PATCH', '/me', {})).id }).catch(() => null);
  const view = () => p.evaluate(() => ({ gid: window.__lc.S.view.gid, cid: window.__lc.S.view.cid, kind: window.__lc.S.view.kind, last: document.querySelector('#msgs .msg:last-child .body')?.textContent?.trim() || null, discover: !!document.querySelector('#discoverview') }));
  const settle = () => sleep(900);

  // ---- 1) voltar/avançar ----
  const steps = [[g.id, c1], [g.id, c2], ['@me', 'discover'], [g2.id, null], ...(dm?.id ? [['@me', dm.id]] : [])];
  for (const [gid, cid] of steps) { await p.evaluate((gid, cid) => window.__lc.go(gid, cid), gid, cid); await settle(); }
  const seen = [];
  for (let i = steps.length - 2; i >= 0; i--) { await p.goBack(); await settle(); seen.push(await view()); }
  ok(seen.every((v, k) => { const [gid, cid] = steps[steps.length - 2 - k]; return v.gid === gid && (cid == null || v.cid === cid); }), 'voltar passa pelas telas na ordem inversa', seen.map(v => v.gid + '/' + v.cid));
  ok(seen[seen.length - 1].last === 'no geral', 'voltar até o 1º canal mostra as mensagens dele', seen[seen.length - 1].last);
  const fwd = []; for (let i = 1; i < steps.length; i++) { await p.goForward(); await settle(); fwd.push(await view()); }
  ok(fwd.every((v, k) => v.gid === steps[k + 1][0] && (steps[k + 1][1] == null || v.cid === steps[k + 1][1])), 'avançar refaz o caminho', fwd.map(v => v.gid + '/' + v.cid));
  ok(fwd[1].discover, 'avançar até o Descobrir mostra o Descobrir');
  // modal aberto + voltar: o modal fecha junto (não fica por cima da tela anterior)
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c1); await settle();
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c2); await settle();
  await p.evaluate(() => document.querySelector('.pb-gear, [title="Configurações do usuário"]')?.click()); await sleep(800);
  const hadSettings = await p.evaluate(() => !!document.querySelector('#settings'));
  await p.goBack(); await settle();
  const afterBack = await p.evaluate(() => ({ settings: !!document.querySelector('#settings'), cid: window.__lc.S.view.cid }));
  ok(hadSettings && !afterBack.settings, 'voltar com as configurações abertas fecha as configurações', { abriu: hadSettings, ...afterBack });
  ok(afterBack.cid === c2, 'e fica no mesmo canal (só fechou o que estava por cima)', afterBack.cid);
  // fechou pelo Esc: o voltar seguinte troca de tela (não fica um voltar "gasto" à toa)
  await p.evaluate(() => document.querySelector('.pb-gear, [title="Configurações do usuário"]')?.click()); await sleep(800);
  await p.keyboard.press('Escape'); await sleep(600);
  await p.goBack(); await settle();
  ok(await p.evaluate(() => window.__lc.S.view.cid) === c1 && !(await p.evaluate(() => !!document.querySelector('#settings'))), 'fechou pelo Esc: voltar vai para o canal anterior', await p.evaluate(() => window.__lc.S.view.cid));
  // janela (modal) aberta: voltar fecha a janela
  await p.goForward(); await settle();

  // ---- 2) aba congelada: mensagens chegam enquanto ela está parada ----
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c1); await settle();
  const cdp = await p.createCDPSession();
  const other = await browser.newPage(); // outra aba na frente: esta fica escondida e o navegador a congela
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  for (let i = 0; i < 3; i++) await call(b.token, 'POST', `/channels/${c1}/messages`, { content: 'enquanto congelada ' + i });
  await sleep(1500);
  const tRes = Date.now(); await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await p.bringToFront(); await other.close();
  const got = await p.waitForFunction(() => document.querySelector('#msgs .msg:last-child .body')?.textContent?.trim() === 'enquanto congelada 2', { timeout: 15000, polling: 100 }).then(() => Date.now() - tRes).catch(() => null);
  ok(got != null, 'aba congelada volta com as mensagens que chegaram (ms depois de voltar)', got ?? (await view()).last);
  if (process.env.DEBUG) console.log(await p.evaluate(() => [...document.querySelectorAll('#msgs .msg .body')].slice(-5).map(e => e.textContent)));

  // ---- 3) conexão cai, chegam mensagens no canal aberto e em outro, volta ----
  setCut(true);
  const dropped = await p.waitForFunction(() => !!document.querySelector('#reconnect'), { timeout: 30000, polling: 200 }).then(() => true).catch(() => false);
  await call(b.token, 'POST', `/channels/${c1}/messages`, { content: 'enquanto sem internet' });
  await call(b.token, 'POST', `/channels/${c2}/messages`, { content: 'no outro, sem internet' });
  await sleep(2500);
  setCut(false);
  const back = await p.waitForFunction(() => !document.querySelector('#reconnect') && window.__lc.S.me, { timeout: 30000, polling: 200 }).then(() => true).catch(() => false);
  await sleep(1500);
  ok(dropped && back, 'a conexão caiu (aviso) e voltou sozinha', { caiu: dropped, voltou: back });
  ok((await view()).last === 'enquanto sem internet', 'o canal aberto mostra a mensagem que chegou sem internet', (await view()).last);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c2); await settle();
  ok((await view()).last === 'no outro, sem internet', 'o outro canal (já visitado) também tem a mensagem nova', (await view()).last);

  // ---- 4) aba descartada: o navegador recarrega; rascunho e tela voltam ----
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c1); await settle();
  await p.click('#composer textarea'); await p.keyboard.type('rascunho que não pode sumir');
  await sleep(1500);
  if (process.env.DEBUG) console.log('  rascunhos guardados:', await p.evaluate(() => [localStorage.lc_drafts, document.querySelector('#composer textarea')?.value, document.activeElement?.tagName, typeof window.__lc]), await p.evaluate(() => document.querySelector('#composer textarea')?.dataset.cid));
  // trocar de canal e voltar: o rascunho de cada canal fica no seu canal
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c2); await settle();
  const otherDraft = await p.evaluate(() => document.querySelector('#composer textarea')?.value);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c1); await settle();
  const mine = await p.evaluate(() => document.querySelector('#composer textarea')?.value);
  ok(otherDraft === '' && mine === 'rascunho que não pode sumir', 'trocar de canal: o rascunho fica no canal dele', { outro: otherDraft, este: mine });
  await p.reload(); await p.waitForFunction(() => window.__lc?.S?.synced && document.querySelector('#composer textarea'), { timeout: 30000 }); await sleep(1500);
  const r = await p.evaluate(() => ({ cid: window.__lc.S.view.cid, draft: document.querySelector('#composer textarea')?.value }));
  ok(r.cid === c1, 'depois de recarregar volta para o mesmo canal', r.cid);
  ok(r.draft === 'rascunho que não pode sumir', 'e o rascunho continua no campo', r.draft);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
