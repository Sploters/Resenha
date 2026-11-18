// Sala de voz: "Em espera" (pausa na chamada: microfone e áudio desligados, os outros veem) e "Separar por jogos"
// (quem está na sala em grupos pelo jogo, depois quem só conversa e, no fim, quem está em espera).
// Servidor de verdade + navegador para a Ana; beto, caio e duda entram pelo WebSocket. Uso: node scripts/voice-hold-test.mjs
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
import { DatabaseSync } from 'node:sqlite';
const BASE = await ownServer('voicehold', 3403, 41560);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { n, tok: r.token, id: me.id, ev: [] }; };
const gw = (u) => new Promise((res) => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + u.tok); u.ws = ws; ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'READY') res(); else u.ev.push(m); }); });
const send = (u, t, d) => u.ws.send(JSON.stringify({ t, d }));
const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(80); } return false; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const [ana, beto, caio, duda] = await Promise.all(['ana', 'beto', 'caio', 'duda'].map(reg));
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Sala' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`, {})).code;
  for (const u of [beto, caio, duda]) { await call(u.tok, 'POST', '/invites/' + code); await call(u.tok, 'POST', '/relationships', { username: 'ana' }); await call(ana.tok, 'PUT', '/relationships/' + u.id, {}); }
  const vch = new DatabaseSync('./.testdata-voicehold/resenha.db').prepare('SELECT id FROM channels WHERE guild_id=? AND type=2').get(g.id);
  for (const u of [beto, caio, duda]) await gw(u);

  // ---- servidor: o estado "em espera" vai para todos ----
  send(beto, 'VOICE_JOIN', { channel_id: vch.id }); send(caio, 'VOICE_JOIN', { channel_id: vch.id }); send(duda, 'VOICE_JOIN', { channel_id: vch.id });
  await sleep(500);
  send(beto, 'VOICE_STATE', { mute: true, deaf: true, hold: true });
  ok(await waitFor(() => caio.ev.some(m => m.t === 'VOICE_STATE' && m.d.user_id === beto.id && m.d.hold === true)), 'em espera: quem está na sala recebe hold=true');
  send(caio, 'ACTIVITY_LOCAL', { game: { id: 'valorant.exe', title: 'VALORANT' } });
  send(duda, 'ACTIVITY_LOCAL', { game: { id: 'valorant.exe', title: 'VALORANT' } });

  // ---- navegador da Ana ----
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.setViewport({ width: 1280, height: 800 });
  await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, ana.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(600);
  ok(await p.$eval(`.vuser[data-uid="${beto.id}"]`, el => el.classList.contains('hold') && !!el.querySelector('.vu-hold')).catch(() => false), 'na lista da sala, beto aparece "Em espera"');
  ok(!(await p.$('.vgroup')), 'sem "Separar por jogos", a lista não tem grupos');
  await p.evaluate(() => { window.__lc.S.prefs.voiceByGame = true; window.__lc.savePrefs(); });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  ok(await p.waitForFunction(() => document.querySelectorAll('.vgroup').length >= 2, { timeout: 5000 }).then(() => true, () => false), 'com "Separar por jogos", aparecem os grupos');
  const groups = await p.$$eval('.vusers.bygame > *', els => els.map(e => e.classList.contains('vgroup') ? '#' + e.querySelector('.vg-name').textContent + ':' + e.querySelector('.vg-n').textContent : e.dataset.uid));
  ok(groups[0] === '#VALORANT:2' && groups.slice(1, 3).sort().join() === [caio.id, duda.id].sort().join(), 'grupo do jogo primeiro, com caio e duda', groups);
  fs.mkdirSync('.testshots', { recursive: true }); await p.screenshot({ path: '.testshots/voice-bygame.png', clip: { x: 60, y: 360, width: 300, height: 260 } });
  ok(groups.at(-2) === '#Em espera:1' && groups.at(-1) === beto.id, '"Em espera" no fim, com beto', groups);

  // ---- a Ana entra e fica em espera pelo app ----
  await p.evaluate((cid) => window.__lc.joinVoice(cid), vch.id);
  await p.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 }); await sleep(800);
  caio.ev.length = 0;
  await p.evaluate(() => window.__lc.voice.setHold(true));
  ok(await waitFor(() => caio.ev.some(m => m.t === 'VOICE_STATE' && m.d.user_id === ana.id && m.d.hold && m.d.mute && m.d.deaf)), 'ana em espera: os outros recebem hold, mudo e ensurdecido');
  ok(await p.$eval('#voice-panel .t', el => el.textContent.includes('Em espera')), 'o painel de voz mostra "Em espera"');
  await p.evaluate(() => window.__lc.voice.setHold(false));
  ok(await waitFor(() => caio.ev.some(m => m.t === 'VOICE_STATE' && m.d.user_id === ana.id && !m.d.hold && !m.d.mute && !m.d.deaf)), 'voltando, microfone e áudio voltam como estavam (ligados)');
  await p.evaluate(() => { window.__lc.voiceToggle('mute'); window.__lc.voice.setHold(true); }); await sleep(200);
  await p.evaluate(() => window.__lc.voice.setHold(false)); await sleep(200);
  ok(await p.evaluate(() => window.__lc.voice.muted && !window.__lc.voice.deafened), 'quem estava mudo volta mudo (só o ensurdecer sai)');
  await p.evaluate(() => { window.__lc.voice.setHold(true); window.__lc.voiceToggle('deaf'); }); await sleep(200);
  ok(await p.evaluate(() => !window.__lc.voice.hold && !window.__lc.voice.deafened), 'mexer no áudio durante a espera tira da espera');
  await p.evaluate(() => window.__lc.voice.setHold(true)); await sleep(200);
  await p.evaluate(() => window.__lc.voice.leave()); await sleep(300);
  ok(await p.evaluate(() => !window.__lc.voice.hold), 'sair da sala acaba com a espera');
} finally { await browser.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
