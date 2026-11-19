// Mover arrastando: quem pode Moderar voz (ou o dono) arrasta alguém da lista de voz e solta em outra sala da barra
// lateral; a pessoa movida ouve o aviso e, se estava mutada, vê o botão de desmutar. E os atalhos do Soundboard:
// escolher o som de cada Alt + teclado numérico e criar atalhos com qualquer tecla.
// Servidor de verdade + navegador para a Ana (dona) e o Beto (membro). Uso: node scripts/voice-drag-test.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
import { DatabaseSync } from 'node:sqlite';
const BASE = await ownServer('voicedrag', 3405, 41600);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { n, tok: r.token, id: me.id }; };
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
fs.mkdirSync('.testshots', { recursive: true });
try {
  const [ana, beto] = await Promise.all(['ana', 'beto'].map(reg));
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Sala' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`, {})).code;
  await call(beto.tok, 'POST', '/invites/' + code);
  const v1 = new DatabaseSync('./.testdata-voicedrag/resenha.db').prepare('SELECT id FROM channels WHERE guild_id=? AND type=2').get(g.id).id;
  const v2 = (await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Sala 2', type: 2 })).id;
  const open = async (u) => {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
    await p.setViewport({ width: 1280, height: 800 });
    await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, u.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, v1);
    return p;
  };
  const A = await open(ana), B = await open(beto);

  // Beto entra na Sala 1 e se muta
  await B.evaluate((cid) => window.__lc.joinVoice(cid), v1);
  await B.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  await B.evaluate(() => window.__lc.voiceToggle('mute')); await sleep(400);
  ok(await until(() => A.$(`.vuser[data-uid="${beto.id}"]`)), 'Ana vê o Beto na Sala 1');
  ok(await A.$eval(`.vuser[data-uid="${beto.id}"]`, el => el.draggable && el.classList.contains('vdraggable')), 'para a dona, a linha do Beto pode ser arrastada');
  ok(!(await B.$eval(`.vuser[data-uid="${beto.id}"]`, el => el.draggable)), 'o próprio Beto (sem cargo) não arrasta ninguém');

  // arrastar o Beto até a Sala 2 (eventos de arrastar do navegador, com DataTransfer)
  const drag = (page, uid, target, drop = true) => page.evaluate((uid, target, drop) => {
    const src = document.querySelector(`.vuser[data-uid="${uid}"]`), dst = document.querySelector(`[data-vroom="${target}"] .ch`);
    const dt = new DataTransfer(), ev = (el, t) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev(src, 'dragstart');
    const highlighted = document.querySelector(`[data-vroom="${target}"]`).classList.contains('vdrop-ok');
    ev(dst, 'dragenter'); const accepted = !ev(dst, 'dragover'); // preventDefault = aceita soltar aqui
    const over = document.querySelector(`[data-vroom="${target}"]`).classList.contains('vdrop-over');
    if (drop) ev(dst, 'drop');
    ev(src, 'dragend');
    return { highlighted, accepted, over };
  }, uid, target, drop);
  const same = await drag(A, beto.id, v1, false);
  ok(!same.accepted, 'soltar na mesma sala não é aceito', same);
  const r = await drag(A, beto.id, v2);
  ok(r.highlighted && r.accepted && r.over, 'durante o arrasto a Sala 2 fica destacada e aceita soltar', r);
  ok(await until(() => B.evaluate((cid) => window.__lc.voice?.channelId === cid, v2), 10000), 'Beto foi movido para a Sala 2');
  ok(await until(() => B.$('#vmoved.muted')), 'Beto vê o aviso de que foi movido (está mutado)');
  ok(await B.$eval('#vmoved', el => /ana moveu você para Sala 2/i.test(el.textContent) && /mutado/.test(el.textContent)), 'aviso diz quem moveu e lembra que está mutado', await B.$eval('#vmoved', el => el.textContent).catch(() => null));
  await B.screenshot({ path: '.testshots/voice-moved-notice.png', clip: { x: 340, y: 0, width: 600, height: 90 } });
  await B.evaluate(() => document.querySelector('#vmoved .btn').click()); await sleep(400);
  ok(await B.evaluate(() => !window.__lc.voice.muted && !document.getElementById('vmoved')), '"Desmutar" no aviso desmuta e fecha o aviso');
  ok(await until(() => A.$(`[data-vroom="${v2}"] .vuser[data-uid="${beto.id}"]`)), 'para a Ana, o Beto aparece na Sala 2');

  // ---- atalhos do Soundboard ----
  const sb = 'soundboard.js';
  await A.evaluate(() => { window.__lc.S.prefs.mySounds = [{ id: 's1', name: 'Um', url: '/x1.ogg' }, { id: 's2', name: 'Dois', url: '/x2.ogg' }, { id: 's3', name: 'Tres', url: '/x3.ogg' }]; window.__lc.S.prefs.sbKeys = {}; delete window.__lc.S.prefs.sbSlots; });
  const keys = () => A.evaluate(async (f) => Object.fromEntries((await window.__lc.import(f)).soundKeys(null)), sb);
  let k = await keys();
  ok(k['Alt+Numpad1'] === 's1' && k['Alt+Numpad2'] === 's2' && k['Alt+Numpad3'] === 's3', 'automático: Alt + Num 1–3 tocam os primeiros sons', k);
  await A.evaluate(async (f) => { const m = await window.__lc.import(f); m.setSlot(0, 's3'); m.setSlot(1, ''); }, sb);
  k = await keys();
  ok(k['Alt+Numpad1'] === 's3' && !k['Alt+Numpad2'] && k['Alt+Numpad3'] === 's1', 'Num 1 escolhido (Tres), Num 2 vazio, o resto continua automático', k);
  await A.evaluate(async (f) => { const m = await window.__lc.import(f); m.setSoundKey('s2', 'F6'); m.setSoundKey('s1', 'Ctrl+KeyQ'); }, sb);
  k = await keys();
  ok(k.F6 === 's2' && k['Ctrl+KeyQ'] === 's1', 'atalhos com outras teclas (F6, Ctrl + Q)', k);
  await A.evaluate(async (f) => (await window.__lc.import(f)).setSoundKey('s3', 'F6'), sb);
  k = await keys();
  ok(k.F6 === 's3' && !(await A.evaluate(() => window.__lc.S.prefs.sbKeys.s2)), 'a mesma tecla em outro som: passa para o novo', k);
  // tela de Atalhos
  await A.evaluate(() => window.__lc.openSettings('keys')); await sleep(800);
  const ui = await A.evaluate(() => ({ slots: document.querySelectorAll('.sbk-slots select').length, first: document.querySelector('.sbk-slots select')?.value, custom: [...document.querySelectorAll('.card2 .perm .rt')].map(e => e.textContent).filter(t => /Tres|Um/.test(t)) }));
  ok(ui.slots === 9 && ui.first === 's3', 'Atalhos: as 9 teclas do teclado numérico com o som escolhido', ui);
  ok(ui.custom.length >= 2, 'Atalhos: a lista de outros atalhos mostra os sons com tecla', ui);
  await A.evaluate(() => { const s = document.querySelectorAll('.sbk-slots select')[0]; s.value = '*'; s.dispatchEvent(new Event('change')); }); await sleep(200);
  ok(await A.evaluate(() => window.__lc.S.prefs.sbSlots[0] === null), 'voltar a tecla para "Automático" pela tela');
  await A.evaluate(() => document.querySelector('.sbk-slots').scrollIntoView({ block: 'start' })); await sleep(300);
  await A.screenshot({ path: '.testshots/sb-keys-settings.png' });
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
