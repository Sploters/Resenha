// Fluxo de foto no chat, com internet lenta simulada (como 4G fraco):
// - a prévia aparece na hora (blob: local), antes do envio terminar;
// - o progresso do envio aparece em porcentagem também para arquivo pequeno (até 8 MB);
// - cancelar no X interrompe o envio;
// - depois de enviada, o chat pede uma miniatura do tamanho mostrado (não a original nem 1600 px) e o servidor já a
//   preparou (versões 480/960 geradas logo após o envio);
// - o visualizador abre com a miniatura e troca pela original.
// Uso: BROWSER=... node scripts/image-flow-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const PORT = 3298, BASE = `http://localhost:${PORT}`, DATA = './.testdata-imgflow';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
let fails = 0; const ok = (c, msg) => { console.log((c ? '✓ ' : '✗ ') + msg); if (!c) fails++; };
try {
  const a = await reg('fotografo'), b = await reg('amigo');
  await call(a.tok, 'POST', '/relationships', { username: 'amigo' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});
  const dm = await call(a.tok, 'POST', '/dms', { user_id: b.id });
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  await p.evaluate((c) => window.__lc.go('@me', c), dm.id); await p.waitForSelector('#composer textarea');
  // foto "de celular": 3000x2000 com ruído (não comprime para quase nada); ~1-3 MB depois de virar WebP
  const mk = (w, hh, type) => p.evaluate(async ([w, hh, type]) => {
    const c = new OffscreenCanvas(w, hh), x = c.getContext('2d'), d = x.createImageData(w, hh);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 7) % 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = (i / 4) % 200; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); const blob = await c.convertToBlob({ type, quality: 0.95 });
    window.__f = new File([blob], 'foto.' + (type === 'image/png' ? 'png' : 'jpg'), { type }); return blob.size;
  }, [w, hh, type]);
  const size = await mk(3000, 2000, 'image/jpeg'); console.log('  foto de teste:', (size / 1048576).toFixed(1), 'MB');
  // internet lenta: 1,5 Mbit/s de subida
  const cdp = await p.createCDPSession(); await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 4e6 / 8, uploadThroughput: 1.5e6 / 8 });
  const t0 = Date.now();
  await p.evaluate(async () => { const m = await window.__lc.import('composer.js'); window.__done = m.addFile(window.__f); });
  await p.waitForSelector('#attach-prev .prev-item img', { timeout: 3000 }).catch(() => null);
  const prev = await p.evaluate(() => document.querySelector('#attach-prev .prev-item img')?.getAttribute('src') || '');
  ok(prev.startsWith('blob:') && Date.now() - t0 < 1500, `prévia local imediata (${Date.now() - t0} ms, ${prev.slice(0, 10)}…)`);
  // porcentagem aparecendo durante o envio
  let seen = new Set(), sameImg = true; const img0 = await p.$('#attach-prev .prev-item img');
  for (let i = 0; i < 80; i++) {
    const st = await p.evaluate((im) => ({ t: document.querySelector('#attach-prev .up-st')?.textContent || '', same: document.querySelector('#attach-prev .prev-item img') === im }), img0);
    if (!st.same) sameImg = false; const m = /Enviando… (\d+)%/.exec(st.t); if (m) seen.add(+m[1]);
    if (!st.t) break; await sleep(150);
  }
  ok(seen.size >= 2, `progresso em % durante o envio (${[...seen].slice(0, 8).join(', ')}${seen.size > 8 ? '…' : ''})`);
  ok(sameImg, 'a imagem da prévia não é recriada a cada atualização do progresso');
  await p.evaluate(() => window.__done);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const pend = await p.evaluate(() => window.__lc.S.pending.map(x => ({ state: x.state, url: x.url, name: x.name, size: x.size })));
  ok(pend.length === 1 && pend[0].state === 'ok' && /^\/files\//.test(pend[0].url), `envio concluído (${pend[0]?.name}, ${((pend[0]?.size || 0) / 1048576).toFixed(2)} MB após comprimir)`);
  // miniaturas preparadas logo depois do envio (warm)
  const fname = /^\/files\/([^/]+)\//.exec(pend[0].url)[1];
  let warm = false; for (let i = 0; i < 40 && !warm; i++) { warm = fs.existsSync(path.join(DATA, 'uploads', fname + '.w960.webp')) || fs.readdirSync(DATA, { recursive: true }).some(f => String(f).endsWith(fname + '.w960.webp')); if (!warm) await sleep(150); }
  ok(warm, 'miniatura 960 gerada no servidor logo após o envio');
  // envia a mensagem
  await p.focus('#composer textarea'); await p.keyboard.press('Enter');
  await p.waitForSelector('#msgs .msg:not(.sending) .mgrid img', { timeout: 5000 });
  const src = await p.evaluate(() => document.querySelector('#msgs .msg:not(.sending) .mgrid img').getAttribute('src'));
  const s = +(/[?&]s=(\d+)/.exec(src)?.[1] || 0);
  ok(/^\/thumbs\//.test(src) && s > 0 && s <= 960, `chat pede miniatura do tamanho mostrado (${src})`);
  const r = await fetch(BASE + src); const ct = r.headers.get('content-type'); const len = (await r.arrayBuffer()).byteLength;
  ok(r.ok && /webp/.test(ct), `miniatura servida em WebP (${(len / 1024).toFixed(0)} KB, original ${((pend[0].size) / 1024).toFixed(0)} KB)`);
  await p.waitForFunction(() => { const im = document.querySelector('#msgs .msg:not(.sending) .mgrid img'); return im && im.complete && im.naturalWidth > 0; }, { timeout: 5000 });
  // visualizador: abre com a miniatura (já carregada) e troca pela original
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 2e6 / 8, uploadThroughput: -1 });
  await p.click('#msgs .msg:not(.sending) .mgrid img'); await sleep(150);
  const first = await p.evaluate(() => document.querySelector('#lightbox img:not(.lens)')?.getAttribute('src') || document.querySelector('#lightbox .vimg img')?.getAttribute('src') || '');
  ok(first.includes('/thumbs/'), `visualizador abre na hora com a miniatura (${first.slice(0, 40)})`);
  let final = ''; for (let i = 0; i < 100; i++) { final = await p.evaluate(() => document.querySelector('#lightbox .vimg img')?.src || ''); if (final.includes('/files/')) break; await sleep(150); }
  ok(final.includes('/files/'), 'visualizador troca para a original quando ela chega');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await p.keyboard.press('Escape'); await sleep(200);
  // cancelar no meio: X na prévia interrompe o envio (arquivo pequeno, que antes não dava para cancelar)
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: -1, uploadThroughput: 300e3 / 8 });
  await mk(1800, 1200, 'image/png');
  await p.evaluate(async () => { const m = await window.__lc.import('composer.js'); window.__done = m.addFile(window.__f).catch(() => { }); });
  await p.waitForFunction(() => /Enviando… \d+%/.test(document.querySelector('#attach-prev .up-st')?.textContent || ''), { timeout: 15000 }).catch(() => null);
  const blobUrl = await p.evaluate(() => document.querySelector('#attach-prev .prev-item img')?.src);
  await p.click('#attach-prev .prev-item .x'); await p.evaluate(() => window.__done);
  const after = await p.evaluate(async (u) => ({ n: window.__lc.S.pending.length, revoked: await fetch(u).then(() => false, () => true) }), blobUrl);
  ok(after.n === 0, 'cancelar remove o anexo');
  ok(after.revoked, 'a prévia (blob:) é liberada da memória ao cancelar');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(800); // o servidor apaga o pedaço recebido do envio cancelado sem esperar
  const parts = fs.readdirSync(DATA, { recursive: true }).filter(f => /\.(png|webp)$/.test(String(f)) && !/\.w\d+\.webp$/.test(String(f)) && !/avatars/.test(String(f)));
  console.log('  arquivos de foto no servidor:', parts.join(', '), '(1 enviada; o envio cancelado não deve ficar)');
  ok(parts.length === 1, 'envio cancelado não deixa arquivo no servidor');
} catch (e) { fails++; console.log('ERRO', e); }
finally { await browser.close(); srv.kill(); if (!process.env.KEEP) fs.rmSync(DATA, { recursive: true, force: true }); console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
