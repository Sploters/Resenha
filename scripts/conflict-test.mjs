// Conflitos: a mesma conta em dois aparelhos (dois perfis do navegador) e em duas abas do mesmo navegador, mudando as
// coisas ao mesmo tempo. Preferências: cada um muda uma coisa diferente antes do envio do outro (antes o último a enviar
// desfazia o do outro), mudança pendente quando chega a do outro aparelho, recarregar com envio pendente, app antigo que
// manda tudo. Lido: abrir o canal num aparelho tira a não lida no outro. Mensagens enviadas juntas da mesma conta.
// Uso: node scripts/conflict-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const BASE = await ownServer('conflict', 3324, 41150);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const errs = [];
async function device(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument((t) => { if (!localStorage.lc_token) localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 });
  return { ctx, p };
}
const set = (d, k, v) => (d.p || d).evaluate((k, v) => { window.__lc.S.prefs[k] = v; window.__lc.savePrefs(); }, k, v);
const pref = (d, k) => (d.p || d).evaluate((k) => window.__lc.S.prefs[k], k);
const account = async (tok) => (await call(tok, 'GET', '/me/settings')).settings;
try {
  const a = await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' }), b = await call('', 'POST', '/register', { username: 'beto', password: 'Teste.senha-123' });
  const A = await device(a.token), B = await device(a.token);
  await set(A, 'zoom', 100); await sleep(2500); // a conta passa a ter algo; os dois conhecem a mesma versão
  // 1) cada aparelho muda uma coisa, um logo depois do outro (antes do envio do primeiro, que espera 1,2 s)
  await set(A, 'theme', 'light'); await sleep(200); await set(B, 'dmSort', 'name');
  await sleep(4000);
  const s1 = { A: [await pref(A, 'theme'), await pref(A, 'dmSort')], B: [await pref(B, 'theme'), await pref(B, 'dmSort')], conta: await account(a.token) }; const c1 = s1.conta; delete s1.conta;
  ok(c1.theme === 'light' && c1.dmSort === 'name', 'mudanças quase juntas em dois aparelhos: a conta fica com as duas', { theme: c1.theme, dmSort: c1.dmSort });
  ok(s1.A.join() === 'light,name' && s1.B.join() === 'light,name', 'os dois aparelhos terminam iguais, com as duas mudanças', s1);
  // 2) mesma chave nos dois: vale a última enviada, e os dois concordam
  await set(A, 'zoom', 110); await sleep(1600); await set(B, 'zoom', 90); await sleep(3500);
  const z = [await pref(A, 'zoom'), await pref(B, 'zoom'), (await account(a.token)).zoom];
  ok(z.every(v => v === 90), 'mesma preferência mudada nos dois: vale a última e todos concordam', z);
  // 3) mudança pendente em B quando chega a de A: B não perde a sua
  await set(B, 'dmSort', 'unread'); await sleep(100); await set(A, 'theme', 'dark'); await sleep(4000);
  const s3 = { A: [await pref(A, 'theme'), await pref(A, 'dmSort')], B: [await pref(B, 'theme'), await pref(B, 'dmSort')] };
  ok(s3.A.join() === 'dark,unread' && s3.B.join() === 'dark,unread', 'mudança ainda não enviada não é desfeita pela que chega do outro aparelho', s3);
  // 4) recarregar com envio pendente (pagehide manda na hora) enquanto o outro aparelho mudou outra coisa
  await set(A, 'zoom', 120); await sleep(1600);
  await set(B, 'dmSort', 'recent'); await B.p.reload(); await B.p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 }); await sleep(3000);
  const s4 = { B: [await pref(B, 'zoom'), await pref(B, 'dmSort')], A: [await pref(A, 'zoom'), await pref(A, 'dmSort')], conta: await account(a.token) }; s4.conta = [s4.conta.zoom, s4.conta.dmSort];
  ok(s4.B.join() === '120,recent' && s4.A.join() === '120,recent' && s4.conta.join() === '120,recent', 'recarregar com mudança pendente: ela chega à conta e a do outro aparelho continua', s4);
  // 5) app antigo (manda as preferências inteiras) continua funcionando
  const full = await account(a.token); full.theme = 'light';
  await call(a.token, 'PUT', '/me/settings', { settings: full }); await sleep(1500);
  ok(await pref(A, 'theme') === 'light' && await pref(B, 'theme') === 'light', 'app antigo mandando tudo: os aparelhos aplicam');
  // 6) duas abas do mesmo navegador: mudança numa vale na outra e na conta
  const A2 = await A.ctx.newPage(); A2.on('pageerror', e => errs.push(e.message)); await A2.goto(BASE); await A2.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 });
  await set(A2, 'dmSort', 'name'); await sleep(150); await set(A, 'zoom', 100); await sleep(4000);
  const s6 = { A: [await pref(A, 'zoom'), await pref(A, 'dmSort')], A2: [await pref(A2, 'zoom'), await pref(A2, 'dmSort')], B: [await pref(B, 'zoom'), await pref(B, 'dmSort')] };
  ok([s6.A, s6.A2, s6.B].every(x => x.join() === '100,name'), 'duas abas do mesmo navegador mudando juntas: todas terminam iguais', s6);
  // 7) lido num aparelho tira a não lida no outro; mensagens enviadas juntas pelos dois aparelhos chegam todas, em ordem
  const g = await call(b.token, 'POST', '/guilds', { name: 'Turma' }), inv = (await call(b.token, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(a.token, 'POST', '/invites/' + inv); await sleep(800);
  const ch = g.channels?.find(c => c.type === 0) || await A.p.evaluate((gid) => window.__lc.S.guilds.get(gid)?.channels.find(c => c.type === 0), g.id);
  await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'oi ana' }); await sleep(800);
  const un0 = [await A.p.evaluate((c) => !!window.__lc.S.unread[c], ch.id), await B.p.evaluate((c) => !!window.__lc.S.unread[c], ch.id)];
  await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id); await sleep(2000);
  const un1 = await B.p.evaluate((c) => !!window.__lc.S.unread[c], ch.id);
  ok(un0[0] && un0[1] && !un1, 'mensagem nova: não lida nos dois; lida num, some no outro', { antes: un0, depois_no_outro: un1 });
  await B.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id); await sleep(1000);
  // os dois aparelhos mandam ao mesmo tempo (o limite por pessoa pode recusar parte: conta só as aceitas)
  const sent = (await Promise.all([...Array(6)].map((_, i) => call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: (i % 2 ? 'aparelho B ' : 'aparelho A ') + i })))).filter(m => m?.id).map(m => m.id);
  await sleep(1500);
  const seen = await Promise.all([A, B].map(d => d.p.evaluate((c) => (window.__lc.S.messages.get(c) || []).map(m => m.id), ch.id)));
  const good = (ids) => sent.every(id => ids.includes(id)) && ids.every((id, i) => !i || BigInt(id) > BigInt(ids[i - 1])) && new Set(ids).size === ids.length;
  ok(sent.length >= 3 && seen.every(good), 'mensagens enviadas juntas da mesma conta: chegam nos dois aparelhos, em ordem e sem repetir', { aceitas: sent.length, A: seen[0].length, B: seen[1].length });
  ok(!errs.length, 'sem erros na página', errs);
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
