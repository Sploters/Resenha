// CSS: quanto custa e quanto sobra. Banco do scripts/load/seed.mjs (300 pessoas no mesmo servidor).
// 1) Custo: com a CPU 4x mais lenta e o chat aberto (lista de membros à vista), chegam mensagens (5 por segundo) e gente
//    entra e sai; o trace do Chrome soma o tempo de recálculo de estilo (UpdateLayoutTree) e, com as estatísticas de
//    seletor ligadas, os seletores que mais custaram (tempo, tentativas de casar e quantos casaram).
// 2) Sobra: cobertura de regras (CSS.ruleUsage) numa volta pelo app (chat, perfil, configurações em todas as abas, emojis,
//    Descobrir, conversas diretas) — o que nunca casou nessa volta é candidato a sobra, não prova (estados raros existem).
// Uso: DATA_DIR=./.testdata-css node scripts/load/seed.mjs 300 && node scripts/css-audit.mjs [rótulo]   (OUT=arquivo.json)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3330, BASE = `http://localhost:${PORT}`, DIR = process.env.DATA_DIR || './.testdata-css', LABEL = process.argv[2] || 'atual';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
if (!fs.existsSync(DIR + '/load.json')) { const { execFileSync } = await import('node:child_process'); execFileSync(process.execPath, ['scripts/load/seed.mjs', '300'], { env: { ...process.env, DATA_DIR: DIR }, stdio: 'ignore' }); }
const meta = JSON.parse(fs.readFileSync(DIR + '/load.json', 'utf8'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json()).catch(() => null);
const R = { label: LABEL };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => { localStorage.lc_token = 'load-0'; });
  const cdp = await p.createCDPSession();
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); await cdp.send('CSS.startRuleUsageTracking');
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), meta.guild, meta.channels[0]);
  await p.waitForSelector('#composer textarea', { timeout: 60000 }); await sleep(3000);

  // ---- 1) custo do estilo com o chat recebendo mensagens e a lista de membros mudando ----
  const ws = []; const { default: WebSocket } = await import('ws');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.tracing.start({ categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', ...(process.env.SELECTORS === '0' ? [] : ['disabled-by-default-blink.debug'])] });
  const tEnd = Date.now() + 12000; let k = 0;
  while (Date.now() < tEnd) {
    const i = 1 + (k % 40);
    call('load-' + i, 'POST', `/channels/${meta.channels[0]}/messages`, { content: 'mensagem ' + k + ' chegando agora com um texto de tamanho normal' });
    if (k % 2 === 0) { const w = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=load-' + (100 + (k % 150))); ws.push(w); if (ws.length > 20) ws.shift().close(); } // entra/sai: a lista de membros muda
    k++; await sleep(200);
  }
  await sleep(800);
  const buf = await p.tracing.stop(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  ws.forEach(w => w.close());
  const ev = JSON.parse(Buffer.from(buf).toString("utf8")).traceEvents || [];
  const main = (() => { const c = new Map(); for (const e of ev) if (e.name === 'UpdateLayoutTree' && e.ph === 'X') c.set(e.tid, (c.get(e.tid) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0]; })();
  const dur = (n) => ev.filter(e => e.name === n && e.ph === 'X' && e.tid === main).reduce((a, e) => a + (e.dur || 0), 0) / 1000;
  const n = (nm) => ev.filter(e => e.name === nm && e.ph === 'X' && e.tid === main).length;
  R.custo = { mensagens: k, estilo_ms: Math.round(dur('UpdateLayoutTree')), estilo_vezes: n('UpdateLayoutTree'), layout_ms: Math.round(dur('Layout')), pintura_ms: Math.round(dur('Paint')),
    elementos_recalculados: ev.filter(e => e.name === 'UpdateLayoutTree' && e.tid === main).reduce((a, e) => a + (e.args?.elementCount || 0), 0) };
  // estatísticas de seletor (só com disabled-by-default-blink.debug)
  const sel = new Map();
  for (const e of ev) {
    const st = e.args?.selector_stats?.selector_timings; if (!st) continue;
    for (const s of st) { const o = sel.get(s.selector) || { selector: s.selector, ms: 0, tentativas: 0, casou: 0, rapido_rejeitou: 0 }; o.ms += (s.elapsed || s['elapsed (us)'] || 0) / 1000; o.tentativas += s.match_attempts || 0; o.casou += s.match_count || 0; o.rapido_rejeitou += s.fast_reject_count || 0; sel.set(s.selector, o); }
  }
  R.seletores_mais_caros = [...sel.values()].sort((a, b) => b.ms - a.ms).slice(0, 25).map(o => ({ ...o, ms: +o.ms.toFixed(2) }));
  R.seletores_total_ms = +[...sel.values()].reduce((a, o) => a + o.ms, 0).toFixed(1);

  // ---- 2) cobertura: volta pelo app ----
  const tryStep = async (fn) => { try { await fn(); } catch { } };
  const click = async (sel) => { const el = await p.waitForSelector(sel, { timeout: 8000 }); await el.click(); await sleep(500); };
  await tryStep(async () => { await click('#members .mem'); await sleep(600); await p.keyboard.press('Escape'); });
  await tryStep(async () => { await p.hover('#msgs .msg:last-child'); await sleep(300); });
  await tryStep(async () => { await p.hover('#composer .extras-btn'); await sleep(400); await click('.cx-pop .cx-opt[title="Emoji"]'); await sleep(800); await p.keyboard.press('Escape'); });
  await tryStep(async () => {
    await click('.pb-gear, [title="Configurações do usuário"]'); await sleep(1200);
    const tabs = await p.$$('#settings .nav-item, #settings nav button, #settings .sidebar .item');
    for (const t of tabs) { await t.click().catch(() => { }); await sleep(350); }
    await p.keyboard.press('Escape');
  });
  await tryStep(async () => { await p.evaluate(() => window.__lc.go('@me', 'discover')); await sleep(2500); });
  await tryStep(async () => { await p.evaluate(() => window.__lc.go('@me')); await sleep(1500); });
  await sleep(500);
  const { ruleUsage } = await cdp.send('CSS.stopRuleUsageTracking');
  // o Chrome devolve só as regras que casaram (com o trecho do texto de cada uma); as regras de cada arquivo saem do próprio
  // texto (um leitor simples de chaves, que desce em @media/@supports/@layer). Regra sem nenhum trecho usado = sem uso.
  const sheets = new Map();
  for (const id of new Set(ruleUsage.map(r => r.styleSheetId))) { try { const { text } = await cdp.send('CSS.getStyleSheetText', { styleSheetId: id }); sheets.set(id, text); } catch { } }
  const files = Object.fromEntries(fs.readdirSync('public').filter(f => f.endsWith('.css')).map(f => [f, fs.readFileSync('public/' + f, 'utf8')]));
  const rulesOf = (t) => { // [início, fim, seletor] de cada regra comum
    const out = []; let i = 0, depth = 0; const stack = []; let start = 0;
    while (i < t.length) {
      if (t[i] === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? t.length : e + 2; continue; }
      if (t[i] === '"' || t[i] === "'") { const q = t[i]; i++; while (i < t.length && t[i] !== q) i += t[i] === '\\' ? 2 : 1; i++; continue; }
      if (t[i] === '{') { const sel = t.slice(start, i).trim(); stack.push({ sel, at: start, group: /^@(media|supports|layer|container|document)/.test(sel) }); depth++; start = i + 1; }
      else if (t[i] === '}') { const b = stack.pop(); depth--; if (b && !b.group && !b.sel.startsWith('@') && !stack.some(x => !x.group)) out.push([b.at, i + 1, b.sel.replace(/\s+/g, ' ')]); start = i + 1; }
      else if (t[i] === ';' && (!stack.length || stack[stack.length - 1].group)) start = i + 1;
      i++;
    }
    return out;
  };
  R.cobertura = {};
  for (const [id, text] of sheets) {
    const f = Object.keys(files).find(k => files[k] === text) || Object.keys(files).find(k => files[k].slice(0, 300) === text.slice(0, 300)); if (!f) continue;
    const used = ruleUsage.filter(r => r.styleSheetId === id && r.used !== false).map(r => r.startOffset).sort((a, b) => a - b);
    const rules = rulesOf(text); let unusedBytes = 0; const unused = [];
    for (const [a, b, sel] of rules) { let lo = 0, hi = used.length; while (lo < hi) { const m = (lo + hi) >> 1; if (used[m] < a) lo = m + 1; else hi = m; } if (!(lo < used.length && used[lo] < b)) { unusedBytes += b - a; unused.push(sel.slice(0, 100)); } }
    R.cobertura[f] = { kb: Math.round(text.length / 1024), regras: rules.length, regras_sem_uso: unused.length, kb_sem_uso: Math.round(unusedBytes / 1024), pct_bytes_sem_uso: Math.round(unusedBytes / text.length * 100), exemplos: unused };
  }
  const tot = Object.values(R.cobertura).reduce((a, o) => ({ regras: a.regras + o.regras, sem: a.sem + o.regras_sem_uso }), { regras: 0, sem: 0 });
  R.cobertura_total = { regras: tot.regras, regras_sem_uso: tot.sem };
  console.log(JSON.stringify({ label: R.label, custo: R.custo, seletores_total_ms: R.seletores_total_ms, cobertura_total: R.cobertura_total, por_arquivo: Object.fromEntries(Object.entries(R.cobertura).map(([f, o]) => [f, `${o.kb} KB, ${o.regras_sem_uso}/${o.regras} regras sem uso nesta volta (${o.kb_sem_uso} KB, ${o.pct_bytes_sem_uso}%)`])) }, null, 1));
  console.log('  seletores mais caros:'); for (const s of R.seletores_mais_caros.slice(0, 15)) console.log(`   ${String(s.ms).padStart(7)} ms  ${String(s.tentativas).padStart(7)} tent.  ${String(s.casou).padStart(6)} casou  ${s.selector.slice(0, 110)}`);
  fs.writeFileSync(process.env.OUT || `.testshots/css-audit-${LABEL}.json`, JSON.stringify(R, null, 1));
} catch (e) { console.log('ERRO', e); }
finally { await browser.close(); srv.kill(); setTimeout(() => process.exit(0), 300); }
