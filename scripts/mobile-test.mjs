// Auditoria de responsividade: abre as telas principais em várias larguras (320 a desktop), tira capturas e lista
// tudo o que passa da largura da tela (rolagem horizontal indevida). Também confere se o campo de mensagem continua
// visível com o "teclado" aberto (janela mais baixa, como o visualViewport do celular).
// Uso: OUT=pasta node scripts/mobile-test.mjs   (BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3297, BASE = `http://localhost:${PORT}`, OUT = process.env.OUT || '.testshots/mobile';
const WIDTHS = (process.env.WIDTHS || '320,360,375,390,414,768,1024,1440').split(',').map(Number);
const SHOTS = process.env.SHOTS !== '0';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-mobile', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-mobile', RTC_PORT: '41060', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
let problems = 0;
// elementos visíveis que passam da borda direita da tela (ignora o que está fora de propósito: gavetas fechadas, menus escondidos)
const overflow = () => {
  const W = innerWidth, out = [], se = document.scrollingElement;
  if (se.scrollWidth > W + 1) out.push(`página rola na horizontal (${se.scrollWidth} > ${W})`);
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.right <= W + 1 || r.left >= W) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    // dentro de algo que rola na horizontal de propósito ou que corta (overflow) antes da borda: não aparece
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) { const s = getComputedStyle(p); const pr = p.getBoundingClientRect(); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && pr.right <= W + 1) { clipped = true; break; } if (s.transform !== 'none' && pr.right <= 0) { clipped = true; break; } p = p.parentElement; }
    if (clipped) continue;
    // fora da tela por transform (gaveta fechada)
    if (r.left < 0 && r.right <= 0) continue;
    const id = el.id ? '#' + el.id : '', cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    out.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(r.right)}`);
    if (out.length > 12) break;
  }
  return out;
};
async function check(p, label) {
  const o = await p.evaluate(overflow);
  if (o.length) { problems++; console.log(`  ✗ ${label}:`, o.join(' | ')); } else console.log(`  ✓ ${label}`);
}
try {
  const a = await reg('sploters'), b = await reg('amigo_com_nome_comprido');
  await call(a.tok, 'POST', '/relationships', { username: 'amigo_com_nome_comprido' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});
  const dm = await call(a.tok, 'POST', '/dms', { user_id: b.id });
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma da resenha com nome grande' });
  const code = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.tok, 'POST', '/invites/' + code);
  const cid = dm.id, gid = '@me';
  const msgs = [[b, 'opa, bora jogar hoje?'], [a, 'link enorme: https://exemplo.com/' + 'caminho/'.repeat(30)], [b, 'palavraenormesemespaconenhum'.repeat(8)],
    [a, '```\nconst codigo = "uma linha de código bem comprida que não quebra sozinha e precisa rolar dentro do bloco, não a página";\n```'], [b, 'mensagem normal de tamanho médio pra ver o espaçamento entre as linhas no celular']];
  for (const [u, t] of msgs) { await call(u.tok, 'POST', `/channels/${cid}/messages`, { content: t }); await sleep(20); }
  // foto anexada (PNG gerado aqui)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(BASE + '/api/upload?name=foto.png', { method: 'POST', headers: { authorization: 'Bearer ' + a.tok, 'content-type': 'image/png' }, body: png }).then(r => r.json());
  if (up.url) await call(a.tok, 'POST', `/channels/${cid}/messages`, { content: 'foto', attachments: [up] });
  for (const w of WIDTHS) {
    console.log(`\n== ${w}px`);
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    const vp = (hh) => p.setViewport({ width: w, height: hh, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 1024 });
    await vp(w < 700 ? 740 : 800);
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.tok); p.on('pageerror', e => console.log('  PAGEERROR', e.message));
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); await sleep(600);
    const shot = (n) => SHOTS && p.screenshot({ path: `${OUT}/${w}-${n}.png` });
    await check(p, 'início'); await shot('inicio');
    await p.evaluate(([g, c]) => window.__lc.go(g, c), [gid, cid]); await sleep(900);
    await check(p, 'chat'); await shot('chat');
    // campo de mensagem visível e dentro da tela
    const comp = await p.evaluate(() => { const c = document.querySelector('#composer'); if (!c) return 'sem compositor'; const r = c.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0 ? null : `compositor fora da tela (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, tela ${innerHeight})`; });
    if (comp) { problems++; console.log('  ✗', comp); }
    if (w < 700) {
      // "teclado aberto": a janela visível encolhe; o campo tem que continuar à vista
      await vp(400); await sleep(400);
      const kb = await p.evaluate(() => { const c = document.querySelector('#composer'); const r = c.getBoundingClientRect(); return r.bottom <= innerHeight + 1 ? null : `compositor escondido com teclado (bottom ${Math.round(r.bottom)} > ${innerHeight})`; });
      if (kb) { problems++; console.log('  ✗', kb); } else console.log('  ✓ compositor com teclado');
      await shot('chat-teclado'); await vp(740); await sleep(300);
      await p.evaluate(() => document.querySelector('#topbar .menu-btn')?.click()); await sleep(400);
      await check(p, 'gaveta aberta'); await shot('gaveta');
      // toque fora da gaveta fecha
      const closed = await p.evaluate(async () => { const app = document.getElementById('app'); const x = innerWidth - 8, y = innerHeight / 2; const el = document.elementFromPoint(x, y); el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })); el?.click(); await new Promise(r => setTimeout(r, 300)); return !app.classList.contains('nav-open'); });
      if (!closed) { problems++; console.log('  ✗ tocar fora não fecha a gaveta'); } else console.log('  ✓ tocar fora fecha a gaveta');
      await p.evaluate(() => document.getElementById('app').classList.remove('nav-open')); await sleep(300);
    }
    // canal de texto e sala de voz do servidor (os canais vêm no READY)
    const gch = await p.evaluate((g) => { const l = window.__lc.S.guilds.get(g)?.channels || []; return { t: l.find(c => c.type === 0)?.id, v: l.find(c => c.type === 2)?.id }; }, g.id);
    if (gch.t) { await p.evaluate(([g, c]) => window.__lc.go(g, c), [g.id, gch.t]); await sleep(800); await check(p, 'canal do servidor'); await shot('canal'); }
    if (gch.v) {
      await p.evaluate(([g, c]) => window.__lc.go(g, c), [g.id, gch.v]); await sleep(800); await check(p, 'sala de voz'); await shot('sala-voz');
      // dentro da chamada: participantes e controles cabem na tela e os botões principais estão à vista
      await p.evaluate((c) => window.__lc.joinVoice(c), gch.v);
      const joined = await p.waitForFunction(() => window.__lc.voice?.channelId && document.querySelector('#stage .tile'), { timeout: 15000 }).then(() => true, () => false);
      if (!joined) { problems++; console.log('  ✗ não entrou na chamada'); }
      else {
        await sleep(1200); await check(p, 'em chamada'); await shot('em-chamada');
        const ctl = await p.evaluate(() => { const out = []; for (const b of document.querySelectorAll('#app button')) { const t = (b.title || b.getAttribute('aria-label') || '').toLowerCase(); if (!/microfone|silenciar|desligar|sair da chamada|desconectar|ensurdecer|áudio/.test(t)) continue; const r = b.getBoundingClientRect(); if (r.width && r.height) out.push({ t, vis: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, w: Math.round(r.width) }); } return out; });
        const vis = ctl.filter(x => x.vis);
        if (!vis.some(x => /microfone|silenciar/.test(x.t)) || !vis.some(x => /desligar|sair|desconectar/.test(x.t))) { problems++; console.log('  ✗ controles da chamada fora da tela:', JSON.stringify(ctl)); } else console.log('  ✓ microfone e desligar à vista');
        await p.evaluate(() => window.__lc.voice.leave()); await sleep(600);
      }
    }
    // janela (modal) genérica com dois botões
    await p.evaluate(async () => { const st = await window.__lc.import('state.js'); const u = await window.__lc.import('util.js'); st.modal('Criar servidor', 'Um lugar para você e a turma conversarem', u.h('label.f', 'Nome', u.h('input', { value: 'Servidor de teste' })), [{ label: 'Cancelar', cls: 'grey' }, { label: 'Criar' }]); });
    await sleep(500); await check(p, 'janela'); await shot('janela');
    await p.keyboard.press('Escape'); await sleep(300);
    await p.evaluate(([g, c]) => window.__lc.go(g, c), [gid, cid]); await sleep(600);
    await p.evaluate(() => window.__lc.openSettings('profile')); await sleep(700);
    await check(p, 'configurações'); await shot('config');
    await p.keyboard.press('Escape'); await sleep(400);
    await p.evaluate((c) => { location.hash = `#/@me/${c}/files`; }, cid); await sleep(1000);
    await check(p, 'arquivos'); await shot('arquivos');
    await p.evaluate(([g, c]) => window.__lc.go(g, c), [gid, cid]); await sleep(700);
    // perfil (clique no nome do autor)
    await p.evaluate(() => document.querySelector('#msgs .msg .author')?.click()); await sleep(600);
    await check(p, 'perfil'); await shot('perfil');
    await p.keyboard.press('Escape'); await sleep(300);
    // visualizador de imagem
    const im = await p.$('#msgs .mgrid img'); if (im) { await im.click(); await sleep(700); await check(p, 'visualizador'); await shot('visualizador'); await p.keyboard.press('Escape'); await sleep(300); }
    await ctx.close();
  }
} catch (e) { problems++; console.log('ERRO', e); }
finally { await browser.close(); srv.kill(); console.log(`\n${problems} problema(s)`); setTimeout(() => process.exit(problems ? 1 : 0), 300); }
