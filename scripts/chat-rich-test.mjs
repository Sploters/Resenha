// Chat grande com conteúdo de verdade (scripts/load/seed-rich.mjs): (1) foto enviada ganha largura/altura no servidor e o
// chat reserva o espaço dela antes de carregar; (2) voltar a um chat lido para trás monta só as mais novas; (3) mensagem
// dos outros entra sem animação (cada quadro dela recompunha o chat inteiro) e a própria mantém; (4) o observador dos
// avatares animados só fica ligado fora do modo "Sempre", e continua congelando no "Nunca".
// Uso: DATA_DIR=./.testdata-rich node scripts/load/seed-rich.mjs 3000 && node scripts/chat-rich-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3397, BASE = `http://localhost:${PORT}`, DIR = process.env.DATA_DIR || './.testdata-rich';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const meta = JSON.parse(fs.readFileSync(DIR + '/rich.json', 'utf8'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(100); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument(() => { localStorage.lc_token = 'rich-0'; });
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  const go = async (g, c) => { await p.evaluate((g, c) => window.__lc.go(g, c), g, c); await p.waitForFunction(() => document.querySelectorAll('#msgs > .msg').length > 5); await sleep(800); };
  await go(meta.guild, meta.channel);

  // (1) foto: o servidor lê 1600×1200 do arquivo; a imagem bloqueada (nunca carrega) já ocupa 400×300 no chat
  const uniq = `teste${Date.now()}.png`; fs.copyFileSync(DIR + '/uploads/rich0.png', DIR + '/uploads/' + uniq); // arquivo novo: nada em cache
  await p.setRequestInterception(true); p.on('request', r => (r.url().includes(uniq) ? r.abort() : r.continue()));
  const sent = await api('rich-1', 'POST', `/channels/${meta.channel}/messages`, { content: 'foto', attachments: [{ url: '/files/' + uniq, name: 'foto.png', size: 1000, type: 'image/png' }] });
  ok(sent.attachments?.[0]?.width === 1600 && sent.attachments[0].height === 1200, 'o servidor guarda largura e altura da foto', sent.attachments?.[0] && { w: sent.attachments[0].width, h: sent.attachments[0].height });
  await sleep(800);
  const box = await p.evaluate((id) => { const i = document.querySelector(`[data-mid="${id}"] .mgrid img`); if (!i) return null; const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), sized: i.classList.contains('sized'), loaded: i.complete && i.naturalWidth > 0 }; }, sent.id);
  ok(box && box.sized && !box.loaded && Math.abs(box.w - 400) <= 2 && Math.abs(box.h - 300) <= 2, 'antes de carregar, a foto já ocupa o espaço certo (400×300)', box);

  // (3) a dos outros entra sem animação; a minha com
  const other = await api('rich-2', 'POST', `/channels/${meta.channel}/messages`, { content: 'chegou de outra pessoa' }); await sleep(150);
  const fOther = await p.evaluate((id) => document.querySelector(`[data-mid="${id}"]`)?.classList.contains('fresh'), other.id);
  const mine = await api('rich-0', 'POST', `/channels/${meta.channel}/messages`, { content: 'eu mandei' }); await sleep(150);
  const fMine = await p.evaluate((id) => document.querySelector(`[data-mid="${id}"]`)?.classList.contains('fresh'), mine.id);
  ok(fOther === false && fMine === true, 'mensagem dos outros sem animação de entrada, a minha com', { outros: fOther, minha: fMine });

  // (2) lê 4 páginas para trás, sai e volta: monta só as mais novas
  // 4 páginas: ~253 guardadas, ainda no presente (5 passaria de 300 e cairia no "vendo mensagens antigas", que já recomeçava)
  for (let i = 0; i < 4; i++) { const n0 = await p.evaluate(() => document.querySelectorAll('#msgs > .msg').length); await p.evaluate(() => { const m = document.querySelector('#msgs'); m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); }); await p.waitForFunction((n0) => document.querySelectorAll('#msgs > .msg').length > n0, { timeout: 10000 }, n0).catch(() => { }); await sleep(300); }
  const lido = await p.evaluate((c) => window.__lc.S.messages.get(c).length, meta.channel);
  await go('@me', meta.dm); await go(meta.guild, meta.channel);
  const volta = await p.evaluate(() => { const m = document.querySelector('#msgs'), els = m.querySelectorAll(':scope > .msg'); return { n: els.length, fim: m.scrollHeight - m.scrollTop - m.clientHeight < 30, ultima: els[els.length - 1]?.textContent.includes('eu mandei') }; });
  ok(lido >= 250 && lido <= 300 && volta.n <= 60 && volta.fim && volta.ultima, 'voltando ao chat lido para trás: só as mais novas, no fim', { guardadas_antes: lido, ...volta });
  const nAntes = volta.n; await p.evaluate(() => { const m = document.querySelector('#msgs'); m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); }); await sleep(1500);
  ok(await p.evaluate(() => document.querySelectorAll('#msgs > .msg').length) > nAntes, 'e rolar para cima traz as antigas de novo');

  // (4) avatares animados: no "Nunca" o gif novo congela; no "Sempre" o observador nem roda
  const tryGif = (n) => p.evaluate(async (n) => { const d = document.createElement('div'); d.className = 'avatar'; d.innerHTML = `<img src="/x${n}.gif">`; document.body.append(d); await new Promise(r => setTimeout(r, 300)); const r = d.querySelector('img').hasAttribute('data-orig'); d.remove(); return r; }, n);
  await p.evaluate(() => { window.__lc.S.prefs.animMode = 'never'; }); await (await p.evaluateHandle(() => window.__lc.import('freeze.js'))).dispose();
  await p.evaluate(async () => (await window.__lc.import('freeze.js')).refreshFreeze());
  ok(await tryGif(1), 'no modo "Nunca", avatar animado novo congela');
  await p.evaluate(async () => { window.__lc.S.prefs.animMode = 'always'; (await window.__lc.import('freeze.js')).refreshFreeze(); });
  ok(!(await tryGif(2)), 'no "Sempre", nada é congelado (e a página não é observada)');
} finally { await browser.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
