// Ideias da comunidade (lote 4), servidor real + navegador:
// - criptografia de ponta a ponta nas DMs: o servidor só guarda texto cifrado; os dois lados leem; edição e resposta
//   continuam cifradas; aparelho novo vê "trancada" e não envia até desbloquear; frase errada; número de segurança
//   igual nos dois lados; chave trocada depois de verificar avisa; adulterada não abre; pausar volta ao texto comum;
//   servidor recusa cifrado em canal de servidor e formato inválido
// - CSS personalizado: prévia ao vivo, salvar na conta, modo seguro (?semcss e Ctrl+Shift+Alt+S)
// Uso: BROWSER=/caminho/do/chrome node scripts/e2ee-test.mjs   (SHOTS=1 salva capturas em .testshots/e2ee)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3301, BASE = `http://localhost:${PORT}`, DATA = './.testdata-e2ee';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = '.testshots/e2ee', shot = async (p, n) => { if (process.env.SHOTS) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: `${OUT}/${n}.png` }); } };
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', TRANSLATE: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const PASS_A = 'frase da ana 2026', PASS_B = 'bia-segredo-forte';
try {
  const ana = await reg('ana'), bia = await reg('bia');
  const dm = await call(ana.tok, 'POST', '/dms', { user_id: bia.id });
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }), gch = (await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'geral2', type: 0 }));
  const page = async (tok) => { const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 }); p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; }); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 }); return p; };
  const openDm = async (p) => { await p.evaluate((cid) => window.__lc.go('@me', cid), dm.id); await p.waitForSelector('#e2-btn'); await sleep(400); };
  const lastMsgs = () => call(ana.tok, 'GET', `/channels/${dm.id}/messages?limit=50`);
  const send = async (p, text) => { await p.focus('#composer textarea'); await p.keyboard.type(text); await p.keyboard.press('Enter'); await sleep(700); };
  const bodyOf = (p, id) => p.evaluate((id) => document.querySelector(`[data-mid="${id}"] .body`)?.textContent || '', id);
  const modalBtn = (p, label) => p.evaluate((l) => { const b = [...document.querySelectorAll('.modal .mf .btn')].find(x => x.textContent === l); b?.click(); return !!b; }, label);

  // ---------- ativar ----------
  const A = await page(ana.tok), B = await page(bia.tok);
  await openDm(A);
  ok(await A.$eval('#e2-btn', b => b.classList.contains('e2-off')), 'sem chave: cadeado apagado (clique ativa)');
  await A.evaluate(async (p) => { const e = await window.__lc.import('e2ee.js'); await e.createKey(p); }, PASS_A);
  // Bia ativa pela tela (frase curta é recusada; depois a certa)
  await B.evaluate(async () => (await window.__lc.import('e2ee.js')).setupModal()); await B.waitForSelector('.e2-form');
  await B.type('.e2-form input[type=password]', 'curta'); await B.evaluate(() => document.querySelectorAll('.e2-form input[type=password]')[1].value = 'curta');
  await modalBtn(B, 'Ativar'); await sleep(200);
  ok(/10 caracteres/.test(await B.$eval('.e2-err', e => e.textContent)), 'frase curta é recusada');
  await B.evaluate((p) => { const [a, b] = document.querySelectorAll('.e2-form input[type=password], .e2-form input[placeholder="Repita a frase"]'); a.value = p; document.querySelector('.e2-form input[placeholder="Repita a frase"]').value = p; }, PASS_B);
  await modalBtn(B, 'Ativar'); await B.waitForFunction(() => !document.querySelector('.e2-form'), { timeout: 15000 });
  await A.waitForFunction(() => document.querySelector('#e2-btn')?.classList.contains('e2-on'), { timeout: 5000 }).catch(() => { });
  ok(await A.$eval('#e2-btn', b => b.classList.contains('e2-on')), 'a outra pessoa ativou: a conversa fica protegida sozinha (evento E2EE_KEY)');
  ok(/protegida para @/.test(await A.$eval('#composer textarea', t => t.placeholder)), 'compositor avisa que a mensagem vai protegida');

  // ---------- enviar e ler ----------
  await openDm(B);
  await send(A, 'segredo: a senha do wifi é 1234 <@' + bia.id + '>');
  let list = await lastMsgs(), m1 = list[list.length - 1];
  const raw1 = await call(ana.tok, 'GET', `/channels/${dm.id}/messages?limit=1`); // node não decifra: vê o que o servidor guarda
  ok(/^e2ee:1:[0-9a-f]{32}\.[0-9a-f]{32}:/.test(raw1[0].content) && !raw1[0].content.includes('wifi'), 'servidor guarda só o texto cifrado', raw1[0].content.slice(0, 30));
  await B.waitForSelector(`[data-mid="${m1.id}"]`);
  ok((await bodyOf(B, m1.id)).includes('senha do wifi'), 'Bia lê o texto', await bodyOf(B, m1.id));
  ok((await bodyOf(A, m1.id)).includes('senha do wifi'), 'Ana também lê o que mandou');
  ok(await B.$(`[data-mid="${m1.id}"] .e2-ic`) !== null, 'mensagem protegida ganha o cadeado ao lado da hora');
  ok(await B.evaluate((id) => !!document.querySelector(`[data-mid="${id}"] .mention`), m1.id), 'menção dentro da mensagem protegida continua virando menção');
  // edição
  await A.evaluate(async (cid, id) => { const { api } = await window.__lc.import('state.js'); await api('PATCH', `/channels/${cid}/messages/${id}`, { content: 'senha trocada: 9876' }); }, dm.id, m1.id); await sleep(600);
  const raw2 = (await call(ana.tok, 'GET', `/channels/${dm.id}/messages?limit=1`))[0];
  ok(raw2.content.startsWith('e2ee:1:') && !raw2.content.includes('9876'), 'edição também vai cifrada');
  ok((await bodyOf(B, m1.id)).includes('senha trocada'), 'Bia vê a edição na hora');
  // resposta: o trecho citado chega inteiro (não cortado) e abre
  await B.evaluate(async (cid, id) => { const { api } = await window.__lc.import('state.js'); await api('POST', `/channels/${cid}/messages`, { content: 'anotado! ' + 'x'.repeat(200), reply_to: id }); }, dm.id, m1.id); await sleep(700);
  list = await lastMsgs(); const m2 = list[list.length - 1];
  await A.waitForSelector(`[data-mid="${m2.id}"] .reply-ref`);
  ok((await A.$eval(`[data-mid="${m2.id}"] .reply-ref`, e => e.textContent)).includes('senha trocada'), 'citação da resposta abre (texto cifrado não é cortado no servidor)');
  // número de segurança
  const nums = async (p) => { await p.click('#e2-btn'); await p.waitForSelector('.e2-nums'); const t = await p.$eval('.e2-nums', e => e.textContent); return t; };
  const na = await nums(A), nb = await nums(B);
  await shot(A, '1-numero-de-seguranca');
  ok(na === nb && /^\d{60}$/.test(na), 'número de segurança igual nos dois aparelhos (60 dígitos)', na.slice(0, 15));
  await modalBtn(A, 'Fechar'); await modalBtn(B, 'Os números são iguais'); await sleep(300);
  ok(await B.$eval('#e2-btn', b => b.classList.contains('e2-ok')), 'verificada: cadeado marcado');
  // tradução bloqueada na protegida
  const tr = await B.evaluate(async () => { const t = await window.__lc.import('translate.js'); try { await t.translateText('oi', 'en'); return 'traduziu'; } catch (e) { return e.message; } });
  ok(/protegida/.test(tr), 'traduzir numa conversa protegida é recusado (mandaria o texto ao servidor)', tr);

  // ---------- aparelho novo da Ana ----------
  const C = await page(ana.tok); await openDm(C);
  await C.waitForSelector(`[data-mid="${m1.id}"] .e2-locked`);
  await shot(C, '2-aparelho-novo-trancado');
  ok((await bodyOf(C, m1.id)).includes('desbloqueie'), 'aparelho novo: mensagem aparece trancada');
  ok(await C.$eval('#e2-bar', e => !e.classList.contains('hidden') && /Desbloqueie/.test(e.textContent)), 'faixa de desbloquear acima das mensagens');
  const before = (await lastMsgs()).length;
  await send(C, 'isto não pode sair sem cifra'); await sleep(300);
  ok((await lastMsgs()).length === before, 'trancado: não envia em texto comum numa conversa protegida');
  await C.evaluate(async () => (await window.__lc.import('e2ee.js')).unlockModal()); await C.waitForSelector('.e2-form input');
  await C.type('.e2-form input', 'frase errada'); await modalBtn(C, 'Desbloquear'); await sleep(2500);
  ok(/incorreta/.test(await C.$eval('.e2-err', e => e.textContent)), 'frase errada é recusada');
  await C.$eval('.e2-form input', i => { i.value = ''; }); await C.type('.e2-form input', PASS_A); await modalBtn(C, 'Desbloquear');
  await C.waitForFunction((id) => document.querySelector(`[data-mid="${id}"] .body`)?.textContent.includes('senha trocada'), { timeout: 15000 }, m1.id).catch(() => { });
  ok((await bodyOf(C, m1.id)).includes('senha trocada'), 'desbloqueou: o histórico abre sem recarregar', await bodyOf(C, m1.id));
  ok(await C.evaluate(async () => { const r = await new Promise(res => { const q = indexedDB.open('resenha-e2ee', 1); q.onsuccess = () => res(q.result); }); const all = await new Promise(res => { const g = r.transaction('keys').objectStore('keys').getAll(); g.onsuccess = () => res(g.result); }); try { await crypto.subtle.exportKey('pkcs8', all[0].priv); return false; } catch { return true; } }), 'chave aberta no aparelho não pode ser exportada (CryptoKey não extraível)');

  // ---------- adulterada ----------
  const ctBad = raw2.content.replace(/.(?=.{6}$)/, (c) => (c === 'A' ? 'B' : 'A'));
  const t1 = await call(ana.tok, 'POST', `/channels/${dm.id}/messages`, { content: ctBad });
  await B.waitForSelector(`[data-mid="${t1.id}"]`); await sleep(200);
  ok((await bodyOf(B, t1.id)).includes('Não foi possível abrir'), 'mensagem adulterada não abre');

  // ---------- servidor recusa ----------
  ok((await call(ana.tok, 'POST', `/channels/${gch.id}/messages`, { content: raw2.content })).status === 400, 'cifrado em canal de servidor é recusado');
  ok((await call(ana.tok, 'POST', `/channels/${dm.id}/messages`, { content: 'e2ee:1:lixo' })).status === 400, 'formato inválido é recusado');
  ok((await call(ana.tok, 'POST', '/e2ee/me', { pub: 'AAAA', wrapped: {} })).status === 400, 'chave pública inválida é recusada');

  // ---------- chave nova depois de verificar ----------
  await A.evaluate(async (p) => { const e = await window.__lc.import('e2ee.js'); await e.createKey(p); }, PASS_A);
  await B.waitForFunction(() => document.querySelector('#e2-btn')?.classList.contains('e2-changed'), { timeout: 5000 }).catch(() => { });
  ok(await B.$eval('#e2-btn', b => b.classList.contains('e2-changed')), 'chave da Ana mudou depois da verificação: aviso');
  await shot(B, '3-chave-mudou');
  ok(/mudou/.test(await B.$eval('#e2-bar', e => e.textContent)), 'faixa "a chave mudou"');
  await send(A, 'mensagem com a chave nova');
  list = await lastMsgs(); const m3 = list[list.length - 1];
  await B.waitForSelector(`[data-mid="${m3.id}"]`);
  ok((await bodyOf(B, m3.id)).includes('chave nova') && (await bodyOf(B, m1.id)).includes('senha trocada'), 'mensagens novas e antigas continuam abrindo');

  // ---------- pausar ----------
  await B.evaluate(async () => { const e = await window.__lc.import('e2ee.js'); await e.setPaused(true); }); await sleep(500);
  ok(await A.$eval('#e2-btn', b => b.classList.contains('e2-peer-off')), 'Bia pausou: Ana vê que a conversa não é protegida');
  await send(A, 'agora sem cifra');
  ok((await call(ana.tok, 'GET', `/channels/${dm.id}/messages?limit=1`))[0].content === 'agora sem cifra', 'pausado: vai em texto comum');

  await A.evaluate(() => window.__lc.openSettings('privacy')); await A.waitForSelector('.e2-kid'); await A.evaluate(() => [...document.querySelectorAll('#settings h3, #settings .section, #settings h5')].find(x => /ponta a ponta/i.test(x.textContent))?.scrollIntoView()); await sleep(300); await shot(A, '5-privacidade'); await A.keyboard.press('Escape'); await sleep(300);
  // ---------- CSS personalizado ----------
  await A.evaluate(() => window.__lc.openSettings('appearance')); await A.waitForSelector('.css-actions');
  await A.evaluate(() => [...document.querySelectorAll('.css-actions .btn')][0].click()); await A.waitForSelector('#tedit.cssedit textarea');
  await A.type('#tedit.cssedit textarea', '#rail { outline: 3px solid rgb(1, 2, 3); }'); await sleep(400);
  await A.evaluate(() => [...document.querySelectorAll('#tedit.cssedit .btn')].find(b => /Refer/.test(b.textContent)).click()); await shot(A, '4-editor-css');
  ok(await A.$eval('#rail', e => getComputedStyle(e).outlineColor) === 'rgb(1, 2, 3)', 'prévia ao vivo enquanto digita');
  await A.evaluate(() => [...document.querySelectorAll('#tedit.cssedit .btn')].find(b => b.textContent === 'Cancelar').click()); await sleep(200);
  ok(await A.$eval('#rail', e => getComputedStyle(e).outlineColor) !== 'rgb(1, 2, 3)', 'cancelar desfaz a prévia');
  await A.evaluate(() => [...document.querySelectorAll('.css-actions .btn')][0].click()); await A.waitForSelector('#tedit.cssedit textarea');
  await A.type('#tedit.cssedit textarea', '#rail { outline: 3px solid rgb(1, 2, 3); }'); await A.keyboard.down('Control'); await A.keyboard.press('s'); await A.keyboard.up('Control'); await sleep(1800);
  ok(await A.evaluate(() => document.head.lastElementChild.id === 'custom-css' && window.__lc.S.prefs.customCss.includes('rgb(1, 2, 3)')), 'Ctrl+S salva: CSS na conta e por último no <head>');
  await A.keyboard.down('Control'); await A.keyboard.down('Shift'); await A.keyboard.down('Alt'); await A.keyboard.press('KeyS'); await A.keyboard.up('Alt'); await A.keyboard.up('Shift'); await A.keyboard.up('Control'); await sleep(200);
  ok(!(await A.$('#custom-css')), 'Ctrl+Shift+Alt+S desliga o CSS (modo seguro)');
  const D = await page(ana.tok); await sleep(500);
  ok(await D.$eval('#rail', e => getComputedStyle(e).outlineColor) === 'rgb(1, 2, 3)', 'outro aparelho da conta já abre com o CSS');
  await D.goto(BASE + '/?semcss'); await D.waitForSelector('#rail .rail-wrap'); await sleep(500);
  ok(!(await D.$('#custom-css')), '?semcss abre sem o CSS');
} finally {
  await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); process.exit(fails ? 1 : 0);
