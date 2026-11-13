// Saúde do servidor (server/health.js + public/health.js): números do sistema, pessoas e chamadas, workers do SFU,
// worker morto vira alerta e evento, /healthz público sem números, e o painel do administrador desenhando os gráficos.
// Uso: node scripts/health-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3331, BASE = `http://localhost:${PORT}`, DATA = './.testdata-health', OUT = '.testshots/health';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41240', RTC_IPS: '127.0.0.1', HEALTH_SAMPLE_MS: '1000', HEALTH_UPLINK_MBPS: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const workerPid = () => { try { return execFileSync('pgrep', ['-P', String(srv.pid), '-f', 'mediasoup-worker']).toString().trim().split('\n')[0] || null; } catch { return null; } };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
try {
  const adm = (await api('', 'POST', '/register', { username: 'admin', password: 'Teste.senha-123' })).body.token; await sleep(20);
  const usr = (await api('', 'POST', '/register', { username: 'bia', password: 'Teste.senha-123' })).body.token;
  ok((await api(usr, 'GET', '/health')).status === 403, 'quem não é administrador não vê a saúde do servidor');
  const hz = await fetch(BASE + '/healthz'); const hzj = await hz.json();
  ok(hz.status === 200 && hzj.ok === true && Object.keys(hzj).length === 1, '/healthz público: só "ok", sem números', hzj);
  // alguém na chamada
  const g = (await api(adm, 'POST', '/guilds', { name: 'T' })).body; await api(usr, 'POST', '/invites/' + (await api(adm, 'POST', `/guilds/${g.id}/invites`)).body.code);
  const ctx = await browser.createBrowserContext(), P = await ctx.newPage(); await P.setViewport({ width: 1300, height: 900 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, usr);
  await P.goto(BASE); await P.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  const vc = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await P.evaluate(async (vc) => { await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vc);
  await sleep(2500);
  let h = (await api(adm, 'GET', '/health')).body;
  const n = h.now;
  ok(n.cpu != null && n.memTotalMB > 0 && n.diskTotalGB > 0 && n.procMB > 0, 'CPU, memória, disco e memória do processo medidos', { cpu: n.cpu, mem: n.memUsedPct, disco: n.diskFreeGB });
  ok(n.upMbps != null && n.downMbps != null, 'rede medida (Mbps)', { up: n.upMbps, down: n.downMbps });
  ok(n.online === 1 && n.inCalls === 1 && n.calls === 1, 'pessoas conectadas e em chamada', { online: n.online, emChamada: n.inCalls, chamadas: n.calls });
  ok(n.sfuAlive === 1 && n.workers[0].alive && n.workers[0].peers === 1, 'worker do SFU de pé, com a pessoa', n.workers[0]);
  ok(h.history.length >= 2 && h.limits.uplink === 100, 'histórico e limites', { amostras: h.history.length });
  // worker morre: vira evento, alerta e é recriado
  const pid = workerPid(); process.kill(+pid, 'SIGKILL');
  for (let i = 0; i < 40; i++) { await sleep(500); h = (await api(adm, 'GET', '/health')).body; if (h.sfu_events.some(e => /recriado/.test(e.text)) && h.now.sfuAlive === 1) break; }
  ok(h.sfu_events.some(e => /morreu/.test(e.text)) && h.sfu_events.some(e => /recriado/.test(e.text)), 'morte e recriação do worker aparecem nos eventos', h.sfu_events.map(e => e.text));
  ok(h.alerts.some(a => /worker/.test(a.text)), 'alerta enviado ao administrador', h.alerts.map(a => a.text));
  ok(h.now.workers[0].restarts === 1 && h.now.workers[0].alive, 'worker recriado (1 vez)', h.now.workers[0]);
  // erro do servidor entra na lista e no errors.log
  ok(h.errors.length === 0 || h.errors.every(e => !/ExperimentalWarning/.test(e.text)), 'avisos do Node não contam como erro');
  // painel
  await sleep(1500);
  const A = await (await browser.createBrowserContext()).newPage(); await A.setViewport({ width: 1300, height: 1400 });
  A.on('pageerror', e => { console.log('  PAGEERROR (admin)', e.message); fails++; });
  await A.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, adm);
  await A.goto(BASE); await A.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  await A.evaluate(() => window.__lc.openSettings('health'));
  await A.waitForSelector('.health .hl-checks', { timeout: 15000 });
  await sleep(500);
  const ui = await A.evaluate(() => ({ checks: document.querySelectorAll('.hl-chk').length, charts: document.querySelectorAll('.hl-svg').length, lines: [...document.querySelectorAll('.hl-line')].filter(p => p.getAttribute('d')?.length > 10).length,
    workers: document.querySelectorAll('.hl-tr:not(.hd)').length, events: document.body.innerText.includes('recriado'), nav: [...document.querySelectorAll('#settings *')].some(e => e.textContent === 'Saúde do servidor') }));
  ok(ui.checks === 5 && ui.charts >= 4 && ui.lines >= 3, 'painel: situação, números e gráficos desenhados', ui);
  ok(ui.workers === 1 && ui.events && ui.nav, 'painel: tabela dos workers, eventos e item no menu de Administração', ui);
  // passar o mouse num gráfico mostra o valor
  const box = await A.$eval('.hl-svg', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height / 2 }; });
  await A.mouse.move(box.x, box.y); await sleep(200);
  ok(await A.$eval('.hl-tip', e => !e.hidden && /%/.test(e.textContent)), 'passar o mouse mostra o valor daquele momento');
  await A.screenshot({ path: OUT + '/painel.png', fullPage: false });
  await A.setViewport({ width: 390, height: 900, isMobile: true, hasTouch: true }); await A.reload(); await A.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  await A.evaluate(() => window.__lc.openSettings('health')); await A.waitForSelector('.health .hl-checks', { timeout: 15000 }); await sleep(600);
  const overflow = await A.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 2, 'no celular a página não rola para o lado', overflow);
  await A.screenshot({ path: OUT + '/celular.png' });
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); try { srv.kill('SIGKILL'); } catch { } console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
