// Histórico em janela (app.js HIST_MAX/dropNewest/keepAnchor): rolar para cima num canal com 1.000 mensagens não acumula
// todas no chat. Sobe 16 páginas (800 mensagens), confere quantas ficam na tela, que a ordem não tem buraco nem repetição
// (comparando com a lista do servidor), que aparece o "vendo mensagens antigas"; desce de volta até o presente; e mede o
// tempo de cada página carregada no topo (com a CPU 4x mais lenta).
// Uso: DATA_DIR=./.testdata-css node scripts/load/seed.mjs 300 && node scripts/history-window-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3334, BASE = `http://localhost:${PORT}`, DIR = process.env.DATA_DIR || './.testdata-css';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
if (!fs.existsSync(DIR + '/load.json')) execFileSync(process.execPath, ['scripts/load/seed.mjs', '300'], { env: { ...process.env, DATA_DIR: DIR }, stdio: 'ignore' });
const meta = JSON.parse(fs.readFileSync(DIR + '/load.json', 'utf8')), CID = meta.channels[3];
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
// a lista inteira do canal, do servidor (para conferir ordem e buracos)
const all = []; for (let before = ''; ;) { const r = await fetch(`${BASE}/api/channels/${CID}/messages?limit=100${before ? '&before=' + before : ''}`, { headers: { authorization: 'Bearer load-0' } }).then(r => r.json()); if (!r.length) break; all.unshift(...r); before = r[0].id; if (r.length < 100) break; }
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument(() => { localStorage.lc_token = 'load-0'; });
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), meta.guild, CID);
  await p.waitForFunction(() => document.querySelectorAll('#msgs .msg').length >= 50, { timeout: 60000 }); await sleep(1500);
  const cdp = await p.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const ids = () => p.evaluate(() => [...document.querySelectorAll('#msgs > [data-mid]')].map(e => e.dataset.mid));
  const contiguous = (list) => { const i = all.findIndex(m => m.id === list[0]); return i >= 0 && list.every((id, k) => all[i + k]?.id === id); };
  // sobe: cada página espera o "carregando" terminar e mede a tarefa do topo
  const times = [];
  for (let pg = 0; pg < 16; pg++) {
    const n0 = (await ids())[0];
    const t = await p.evaluate(async () => { const b = document.querySelector('#msgs'); const t0 = performance.now(); b.scrollTop = 0; b.dispatchEvent(new Event('scroll')); for (let i = 0; i < 200 && !b.dataset.loading; i++) await new Promise(r => setTimeout(r, 10)); while (b.dataset.loading) await new Promise(r => setTimeout(r, 10)); await new Promise(r => requestAnimationFrame(() => setTimeout(r))); return performance.now() - t0; });
    times.push(Math.round(t)); await sleep(200);
    if ((await ids())[0] === n0) break;
  }
  const up = await ids();
  const st = await p.evaluate(() => ({ bar: document.querySelector('#detached-bar')?.textContent || null, els: document.querySelectorAll('#msgs *').length }));
  console.log(`  subindo: ${times.length} páginas, ${up.length} mensagens na tela, ${st.els} elementos; página no topo ${times.slice(0, 3).join('/')} … ${times.slice(-3).join('/')} ms`);
  ok(up.length <= 300, 'depois de 800 mensagens para cima, o chat guarda no máximo 300', up.length);
  ok(contiguous(up), 'as que ficaram estão em ordem, sem buraco nem repetição');
  ok(all.findIndex(m => m.id === up[0]) <= all.length - 800, 'e chegaram de fato 800 mensagens para trás', all.length - all.findIndex(m => m.id === up[0]));
  ok(!!st.bar && /antigas/.test(st.bar), 'aparece o aviso de mensagens antigas com o botão para o presente', st.bar);
  ok(Math.max(...times.slice(-4)) < Math.max(...times.slice(0, 4)) * 3, 'carregar no topo não fica mais lento conforme sobe', times);
  // desce de volta até o presente
  let guard = 0;
  while (guard++ < 40) {
    const done = await p.evaluate(async () => { const b = document.querySelector('#msgs'); b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 30)); while (b.dataset.loading) await new Promise(r => setTimeout(r, 10)); await new Promise(r => setTimeout(r, 120)); return !document.querySelector('#detached-bar'); });
    const cur = await ids(); if (!contiguous(cur)) { ok(false, 'descendo: ordem sem buraco', cur.length); break; }
    if (cur.length > 360) { ok(false, 'descendo: o chat continua limitado', cur.length); break; }
    if (done) break;
  }
  const down = await ids();
  ok(down.at(-1) === all.at(-1).id, 'descendo chega à mensagem mais nova', { ultima: down.at(-1) === all.at(-1).id, voltas: guard });
  ok(contiguous(down) && down.length <= 360, 'e o chat termina em ordem e limitado', down.length);
  // mensagem nova chegando no presente aparece
  await fetch(`${BASE}/api/channels/${CID}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer load-1' }, body: JSON.stringify({ content: 'chegou agora' }) });
  await sleep(1500);
  ok(await p.evaluate(() => document.querySelector('#msgs .msg:last-child .body')?.textContent?.trim()) === 'chegou agora', 'no presente, a mensagem nova aparece no fim');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
