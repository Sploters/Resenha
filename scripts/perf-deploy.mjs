// Abertura do app logo depois de um deploy (a 1ª de cada pessoa a cada atualização da interface): com o cache (navegador
// e service worker) cheio da versão anterior, muda um arquivo da interface, manda SIGHUP (deploy/umbrel.sh faz igual) e
// mede o que a página nova baixa de novo (pedidos e KB pela rede) e o tempo até o app ficar pronto (S.synced), com a
// rede de quem está longe (LAT ms de ida e volta, 20 Mbps). Mediana das rodadas; cada rodada muda um arquivo.
// Uso: node scripts/perf-deploy.mjs   (FILES=chat.js,voice.js,changelog.js,style.css  LAT=40  PORT=3439)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', LAT = +(process.env.LAT ?? 40);
const FILES = (process.env.FILES || 'chat.js,voice.js,changelog.js,style.css').split(',');
const PORT = +(process.env.PORT || 3439), RTC = process.env.RTC_PORT || '41439', DIR = path.resolve('.testdata-perfdeploy'), PUB = path.join(DIR, 'public');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true }); fs.cpSync('public', PUB, { recursive: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, PUBLIC_DIR: PUB, RTC_PORT: RTC, RTC_IPS: '127.0.0.1', HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
const BASE = `http://localhost:${PORT}`;
await until(() => fetch(BASE + '/api/server-info').then(() => true, () => false), 30000);
const metaV = async () => /name="lc-ui" content="(\w+)"/.exec(await (await fetch(BASE + '/')).text())?.[1];
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const r = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
await call(r.token, 'POST', '/guilds', { name: 'Turma' });
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const ctx = await browser.createBrowserContext();
const open = async (measure) => {
  const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const cdp = await p.createCDPSession(); await cdp.send('Network.enable'); await cdp.send('Network.setBypassServiceWorker', { bypass: true }); // o cache do navegador guarda pelo endereço igual ao service worker, e aqui dá para contar o que veio da rede
  if (measure && LAT) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LAT, downloadThroughput: 20e6 / 8, uploadThroughput: 10e6 / 8 });
  const reqs = new Map(); let n = 0, bytes = 0;
  cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, e.response));
  cdp.on('Network.loadingFinished', (e) => { const x = reqs.get(e.requestId); if (!x || x.fromServiceWorker || x.fromDiskCache || x.url.includes('/api/')) return; n++; bytes += e.encodedDataLength; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
  const t0 = Date.now(); await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000, polling: 10 });
  const ms = Date.now() - t0; await sleep(2500); // o service worker guarda o que chegou
  await p.close(); return { ms, pedidos: n, kB: Math.round(bytes / 1024) };
};
const rows = [];
try {
  await open(false); await open(false); // enche o cache (navegador e service worker)
  for (const f of FILES) {
    const v0 = await metaV();
    fs.appendFileSync(path.join(PUB, f), `\n/* deploy de teste ${Date.now()} */\n`); srv.kill('SIGHUP');
    await until(async () => (await metaV()) !== v0);
    rows.push({ arquivo: f, ...(await open(true)) });
  }
  const med = (k) => { const s = rows.map(x => x[k]).sort((a, b) => a - b); return s[s.length >> 1]; };
  console.log(JSON.stringify({ lat: LAT, mediana: { prontoMs: med('ms'), pedidos: med('pedidos'), kB: med('kB') }, rodadas: rows }));
} catch (e) { console.log('ERRO', e.message); }
await browser.close(); srv.kill(); process.exit(0);
