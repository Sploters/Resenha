// Capturas para o crítico visual (ver docs/PROMPTS.md): 6 telas fixas e 4 movimentos, sempre com o mesmo conteúdo,
// e um pacote em trabalho/<rodada>/critico/ só com imagens e o pedido ao crítico (sem código, sem explicação).
//
// Uso:  node scripts/critico-capturas.mjs [rodada]          (rodada padrão: data e hora; ex.: antes, r1, r2, depois)
//       BROWSER=<caminho do Chrome/Chromium>  ESCALA=2 (padrão 1)  SO=telas|movimento (padrão: os dois)
//
// Saída:
//   trabalho/<rodada>/telas/*.png             as 6 telas (1920×1080; a 6ª em 390×844)
//   trabalho/<rodada>/movimento/<roteiro>/    todos os quadros pintados, com tempo (quadros.json)
//   trabalho/<rodada>/critico/                o que o crítico recebe: telas, amostras a cada 100 ms, rajadas de 8
//                                             quadros seguidos, referencia/ (se existir) e PEDIDO.md
//   trabalho/<rodada>/relatorio.json          o que deu certo, o que falhou e os tempos de cada roteiro
//
// Duas rodadas seguidas do mesmo código saem quase iguais: mudam só o horário das mensagens e o antisserrilhado da borda
// de alguns avatares. Para comparar antes e depois, olhe lado a lado; não espere arquivo idêntico.
//
// Os movimentos são gravados pelo screencast do Chromium (quadro a cada pintura, com o tempo da pintura) e depois
// reamostrados em grade fixa. Não é passo fixo de verdade (o relógio da página corre normal): serve para pegar salto
// de layout, piscada, esqueleto sumindo de uma vez e animação engasgando, não para medir tempo de quadro.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RODADA = process.argv[2] || new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
const PORT = 3397, BASE = `http://localhost:${PORT}`, DATA = '.testdata-critico';
const OUT = path.join('trabalho', RODADA), SO = process.env.SO || '';
const ESCALA = +process.env.ESCALA || 1, W = 1920, H = 1080, MW = 390, MH = 844;
const AMOSTRA_MS = 100, RAJADA = 8;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const relatorio = { rodada: RODADA, inicio: new Date().toISOString(), telas: {}, movimentos: {}, erros: [] };

function acharNavegador() {
  if (process.env.BROWSER) return process.env.BROWSER;
  const pw = (() => { try { return fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).sort().reverse().map(d => `/opt/pw-browsers/${d}/chrome-linux64/chrome`); } catch { return []; } })();
  return [...pw, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
}

fs.rmSync(DATA, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['telas', 'movimento', 'critico/telas', 'critico/movimento']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// alertas de saúde desligados: dependem da máquina que captura (ex.: disco quase cheio no container) e entravam na tela
// como um aviso que muda de uma rodada para outra
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, HEALTH_DISK_PCT: '0', HEALTH_MEM_PCT: '0', HEALTH_CPU_PCT: '101' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = async (tok, m, p, b) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${d.error || ''}`); return d;
};

const exe = acharNavegador();
if (!exe) { console.log('Nenhum navegador encontrado: defina BROWSER'); srv.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars=false', '--font-render-hinting=none',
  // janela do tamanho da tela emulada: sem isto o screencast dos movimentos saía só com o canto de cima à esquerda (780×493)
  `--window-size=${W * ESCALA},${H * ESCALA}`] });

// tela compartilhada falsa e sempre igual (mesmo desenho a cada rodada)
const telaFalsa = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); let n = 0;
    setInterval(() => {
      n++; const g = x.createLinearGradient(0, 0, 1920, 1080); g.addColorStop(0, '#1d3557'); g.addColorStop(1, '#457b9d');
      x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
      for (let i = 0; i < 12; i++) { x.fillStyle = `hsl(${i * 30} 70% 55%)`; x.fillRect(120 + i * 140, 700 - ((i * 53 + n * 4) % 400), 100, 100); }
      x.fillStyle = '#fff'; x.font = 'bold 72px sans-serif'; x.fillText('Partida de teste', 640, 300);
    }, 33);
    return c.captureStream(30);
  };
};

// avatar fixo por pessoa (o servidor sorteia um no cadastro): a mesma tela sai igual a cada rodada
const AVATARES = fs.readdirSync('public/avatars').filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const pessoas = {};
async function registrar(nome) {
  const r = await call('', 'POST', '/register', { username: nome, password: 'Teste.senha-12345' });
  const n = Object.keys(pessoas).length, avatar = AVATARES.length ? '/avatars/' + AVATARES[(n * 7) % AVATARES.length] : undefined;
  const me = await call(r.token, 'PATCH', '/me', avatar ? { avatar } : {}); return (pessoas[nome] = { nome, tok: r.token, id: me.id });
}
async function abrir(p, w = W, h = H, { esperar = true } = {}) {
  const ctx = await browser.createBrowserContext(), pg = await ctx.newPage();
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: ESCALA });
  pg.on('pageerror', e => relatorio.erros.push(`${p.nome}: erro na página: ${e.message}`));
  await pg.evaluateOnNewDocument((t) => { try { localStorage.lc_token = t; } catch { } }, p.tok);
  await pg.evaluateOnNewDocument(telaFalsa);
  if (esperar) { await pg.goto(BASE, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#rail .rail-wrap', { timeout: 30000 }); }
  return pg;
}
// espera a página parar de mudar (sem pintura nova por 600 ms, ou 5 s no máximo): a mesma tela sai igual a cada rodada
async function assentar(pg) {
  await pg.evaluate(() => new Promise(res => {
    let ult = performance.now(); const fim = ult + 5000;
    const mo = new MutationObserver(() => { ult = performance.now(); }); mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const ver = () => { const t = performance.now(); if (t - ult > 600 || t > fim) { mo.disconnect(); res(); } else requestAnimationFrame(ver); }; ver();
  }));
  await pg.evaluate(() => document.fonts?.ready);
}
async function tela(pg, nome) {
  try { await assentar(pg); await pg.mouse.move(1, 1); await pg.evaluate(() => document.activeElement?.blur?.()); await sleep(300); await pg.screenshot({ path: path.join(OUT, 'telas', nome + '.png') }); relatorio.telas[nome] = 'ok'; console.log('  tela', nome); }
  catch (e) { relatorio.telas[nome] = 'falhou: ' + e.message; relatorio.erros.push(`tela ${nome}: ${e.message}`); console.log('  tela', nome, 'FALHOU', e.message); }
}
const clicarTexto = (pg, sel, re) => pg.evaluate((s, r) => { const el = [...document.querySelectorAll(s)].find(b => new RegExp(r).test(b.textContent.trim())); el?.click(); return !!el; }, sel, re.source);

// grava um roteiro: screencast enquanto `acao` roda, quadros com o tempo da pintura
async function movimento(pg, nome, acao, { depoisMs = 1200 } = {}) {
  const dir = path.join(OUT, 'movimento', nome); fs.mkdirSync(dir, { recursive: true });
  const cdp = await pg.createCDPSession(), quadros = []; let t0 = null;
  cdp.on('Page.screencastFrame', async (f) => {
    const t = f.metadata.timestamp * 1000; if (t0 === null) t0 = t;
    const arq = `q${String(quadros.length).padStart(4, '0')}.png`; fs.writeFileSync(path.join(dir, arq), Buffer.from(f.data, 'base64'));
    quadros.push({ arq, ms: Math.round(t - t0) }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => { });
  });
  try {
    // janela no tamanho da tela antes de gravar (depois da tela cheia da etapa 3 ela voltava menor: quadros de 1920×993)
    try {
      const bs = await browser.target().createCDPSession(), { windowId } = await bs.send('Browser.getWindowForTarget', { targetId: pg.target()._targetId });
      await bs.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); await bs.send('Browser.setWindowBounds', { windowId, bounds: { width: W * ESCALA, height: H * ESCALA } });
      await pg.setViewport({ width: pg.viewport().width, height: pg.viewport().height, deviceScaleFactor: ESCALA }); await bs.detach();
    } catch (e) { relatorio.erros.push(`janela de ${nome}: ${e.message}`); }
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W * ESCALA, maxHeight: H * ESCALA });
    await sleep(300); const ini = Date.now(); await acao(); const dur = Date.now() - ini; await sleep(depoisMs);
    await cdp.send('Page.stopScreencast'); await sleep(200);
    fs.writeFileSync(path.join(dir, 'quadros.json'), JSON.stringify(quadros, null, 1));
    // amostras em grade fixa (o último quadro pintado até cada instante) e a rajada: 8 quadros seguidos no trecho que mais mudou
    const fimMs = quadros.at(-1)?.ms || 0, amostras = [];
    for (let t = 0, i = 0; t <= fimMs; t += AMOSTRA_MS) { while (i + 1 < quadros.length && quadros[i + 1].ms <= t) i++; amostras.push(quadros[i]); }
    let melhor = 0, ini8 = 0;
    for (let i = 0; i + RAJADA <= quadros.length; i++) { const dens = RAJADA / Math.max(1, quadros[i + RAJADA - 1].ms - quadros[i].ms); if (dens > melhor) { melhor = dens; ini8 = i; } }
    const dc = path.join(OUT, 'critico', 'movimento', nome); fs.mkdirSync(dc, { recursive: true });
    amostras.forEach((q, k) => fs.copyFileSync(path.join(dir, q.arq), path.join(dc, `amostra-${String(k * AMOSTRA_MS).padStart(5, '0')}ms.png`)));
    quadros.slice(ini8, ini8 + RAJADA).forEach((q, k) => fs.copyFileSync(path.join(dir, q.arq), path.join(dc, `rajada-${k + 1}-${q.ms}ms.png`)));
    relatorio.movimentos[nome] = { quadros: quadros.length, duracaoAcaoMs: dur, gravadoMs: fimMs, amostras: amostras.length, rajadaDesdeMs: quadros[ini8]?.ms ?? null };
    console.log(`  movimento ${nome}: ${quadros.length} quadros em ${fimMs} ms`);
  } catch (e) { relatorio.movimentos[nome] = 'falhou: ' + e.message; relatorio.erros.push(`movimento ${nome}: ${e.message}`); console.log('  movimento', nome, 'FALHOU', e.message); }
  finally { await cdp.detach().catch(() => { }); }
}

// imagem de anexo feita aqui mesmo (sem arquivo no repositório): sempre a mesma
async function imagemAnexo(tok) {
  const ctx = await browser.createBrowserContext(), pg = await ctx.newPage(); await pg.setViewport({ width: 1200, height: 675 });
  await pg.setContent('<body style="margin:0;width:1200px;height:675px;background:linear-gradient(135deg,#ff7e5f,#2b5876);display:grid;place-items:center;font:bold 64px sans-serif;color:#fff">Print da partida</body>');
  const png = await pg.screenshot({ type: 'png' }); await ctx.close();
  const r = await fetch(`${BASE}/api/upload?name=partida.png`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/png' }, body: png });
  return r.json();
}

try {
  // ---------- conteúdo fixo ----------
  console.log('Conteúdo de teste…');
  const voce = await registrar('voce'), outros = [];
  for (const n of ['ana', 'bruno', 'carla', 'diego', 'elisa']) outros.push(await registrar(n));
  for (const o of outros) { await call(voce.tok, 'POST', '/relationships', { username: o.nome }); await call(o.tok, 'PUT', '/relationships/' + voce.id, {}); }
  const g = await call(voce.tok, 'POST', '/guilds', { name: 'Resenha da Galera' });
  const inv = await call(voce.tok, 'POST', `/guilds/${g.id}/invites`);
  for (const o of outros) await call(o.tok, 'POST', `/invites/${inv.code}`);
  for (const [name, color] of [['Moderação', '#e67e22'], ['Veteranos', '#3498db'], ['Convidados', '#95a5a6']]) { try { await call(voce.tok, 'POST', `/guilds/${g.id}/roles`, { name, color }); } catch (e) { relatorio.erros.push('cargo: ' + e.message); } }
  try { await call(voce.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'clipes', type: 0 }); await call(voce.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'jogatina', type: 2 }); } catch (e) { relatorio.erros.push('canais: ' + e.message); }
  const pg = await abrir(voce);
  const canais = await pg.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.map(c => ({ id: c.id, type: c.type, name: c.name })), g.id);
  const texto = canais.find(c => c.type === 0), voz = canais.find(c => c.type === 2);
  const [ana, bruno, carla, diego] = outros, msg = (p, content, extra = {}) => call(p.tok, 'POST', `/channels/${texto.id}/messages`, { content, ...extra });
  await msg(ana, 'Bom dia, galera! Hoje tem **campeonato** às 21h 🏆');
  const m2 = await msg(bruno, 'Quem topa? Preciso de mais 2 pra fechar o time');
  await msg(carla, 'Eu topo! Só não me coloca de suporte de novo 😅', { reply_to: m2.id });
  await msg(diego, `<@${voce.id}> você vem? Trouxe a lista:\n- Mapa: *Dust*\n- Regra: \`sem awp\`\n- Prêmio: pizza\n> quem perder paga a próxima`);
  await msg(ana, 'Olha o print de ontem:', { attachments: [await imagemAnexo(ana.tok)].map(a => ({ url: a.url, name: 'partida.png', size: a.size, type: 'image/png' })) });
  await msg(bruno, 'Esse link é o da tabela: https://example.com/tabela-do-campeonato');
  await msg(carla, '```js\nconst time = ["ana", "bruno", "carla", "voce", "diego"];\n```');
  try { await call(diego.tok, 'POST', `/channels/${texto.id}/polls`, { question: 'Que horas começa?', options: ['20h', '21h', '22h'], duration_h: 24 }); } catch (e) { relatorio.erros.push('enquete: ' + e.message); }
  const ult = await msg(ana, 'Fechado então, 21h! Bora que hoje é nosso 🔥');
  for (const [p, e] of [[bruno, '🔥'], [carla, '🔥'], [voce, '👍'], [diego, '🔥']]) { try { await call(p.tok, 'PUT', `/channels/${texto.id}/messages/${ult.id}/reactions/${encodeURIComponent(e)}`); } catch (er) { relatorio.erros.push('reação: ' + er.message); } }
  const dm = await call(voce.tok, 'POST', '/dms', { user_id: ana.id });
  for (const [p, t] of [[ana, 'ei, vai no campeonato?'], [voce, 'vou sim, levo o headset novo'], [ana, 'boa! te chamo na voz às 20h50']]) await call(p.tok, 'POST', `/channels/${dm.id}/messages`, { content: t });

  // os outros 4 ficam conectados até o fim (antes saíam antes dos movimentos e iam ficando offline durante a gravação:
  // a lista de amigos e a de membros trocavam de estado no meio do roteiro)
  const naChamada = [];
  if (SO !== 'movimento') {
    console.log('Telas…');
    // os outros 4 abertos antes (aparecem online na lista de membros)
    for (const p of [ana, bruno, carla, diego]) naChamada.push(await abrir(p, 1280, 720));
    // 1. chat com histórico rico
    await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texto.id); await tela(pg, '1-chat');
    // 2. chamada com 5 pessoas, uma transmitindo e uma com câmera
    for (const q of naChamada) { await q.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, voz.id); await sleep(300); await clicarTexto(q, '#stage .btn', /Entrar/); await sleep(1200); }
    await naChamada[0].evaluate(() => window.__lc.voice.toggleScreen({ res: 1080, fps: 30, audio: false, hint: 'motion' })).catch(e => relatorio.erros.push('transmitir: ' + e.message));
    await naChamada[1].evaluate(() => window.__lc.voice.toggleCam()).catch(e => relatorio.erros.push('câmera: ' + e.message));
    await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, voz.id); await sleep(300); await clicarTexto(pg, '#stage .btn', /Entrar/); await sleep(3000);
    await tela(pg, '2-chamada');
    // 3. assistindo a transmissão em tela cheia, controles visíveis
    await pg.evaluate((a) => window.__lc.voice.openStream(a), ana.id).catch(e => relatorio.erros.push('assistir: ' + e.message)); await sleep(5000); // o codificador por software do container leva uns segundos para limpar os rastros do vídeo
    await pg.evaluate(() => { const v = document.querySelector('#stage .tile.screen video') || document.querySelector('#stage video'); const alvo = v?.closest('.tile, .vtile, [class*=tile]') || v?.parentElement; return alvo?.requestFullscreen?.(); }).catch(() => { });
    await sleep(1200); await pg.mouse.move(W / 2, H - 60); await sleep(400);
    try { await pg.screenshot({ path: path.join(OUT, 'telas', '3-assistindo.png') }); relatorio.telas['3-assistindo'] = 'ok'; console.log('  tela 3-assistindo'); } catch (e) { relatorio.telas['3-assistindo'] = 'falhou: ' + e.message; }
    await pg.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => { }); await sleep(500);
    await pg.evaluate(() => window.__lc.voice?.leave?.()).catch(() => { }); await clicarTexto(pg, 'button', /^Desconectar$|^Sair da chamada$/);
    // 4. DMs: amigos e "Ativo agora"
    await pg.evaluate(() => window.__lc.go('@me')); await sleep(800); await tela(pg, '4-amigos');
    // 5. configurações do servidor, cargos
    await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texto.id); await sleep(500);
    await pg.evaluate(() => window.__lc.openSettings('server')); await sleep(800);
    await clicarTexto(pg, '.settings nav *, .sidebar *, [class*=nav] *', /^Cargos$/); await sleep(800); await tela(pg, '5-cargos');
    await pg.keyboard.press('Escape'); await sleep(400);
    // 6. chat no celular
    const cel = await abrir(voce, MW, MH); await cel.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texto.id); await tela(cel, '6-chat-celular');
    await cel.browserContext().close();
  }

  if (SO !== 'telas') {
    console.log('Movimento…');
    if (!naChamada.length) for (const p of [ana, bruno, carla, diego]) naChamada.push(await abrir(p, 1280, 720));
    // abrir o app: do primeiro pixel até o chat assentado (página nova, sem esperar o carregamento antes de gravar)
    const nova = await abrir(voce, W, H, { esperar: false });
    // a página vazia antes do app imita a janela do app desktop (backgroundColor #1e1f22 em desktop/main.js): sem isso os
    // primeiros quadros saíam brancos, do about:blank do navegador de teste, e pareciam um clarão do app
    await nova.setContent('<html style="background:#1e1f22"><body></body></html>').catch(() => { }); await sleep(100);
    // abre direto no #geral (o link do canal, como quem reabre o app onde estava). Antes abria em Amigos e o roteiro mandava
    // para o #geral logo depois, e a gravação mostrava as duas telas
    await movimento(nova, 'abrir-app', async () => { await nova.goto(`${BASE}/#/${g.id}/${texto.id}`, { waitUntil: 'domcontentloaded' }); await nova.waitForSelector('#rail .rail-wrap', { timeout: 30000 }); }, { depoisMs: 2500 });
    await nova.browserContext().close();
    await pg.evaluate(() => window.__lc.go('@me', null)); await sleep(800);
    await movimento(pg, 'trocar-canal', async () => { await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texto.id); await sleep(600); await pg.evaluate((c) => window.__lc.go('@me', c), dm.id); await sleep(600); await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texto.id); });
    await movimento(pg, 'entrar-chamada', async () => { await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, voz.id); await sleep(300); await clicarTexto(pg, '#stage .btn', /Entrar/); await sleep(1500); }, { depoisMs: 1500 });
    await pg.evaluate(() => window.__lc.voice?.leave?.()).catch(() => { });
    await pg.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texto.id); await sleep(600);
    await movimento(pg, 'abrir-fechar-modal', async () => { await pg.evaluate(() => window.__lc.openSettings('account')); await sleep(900); await pg.keyboard.press('Escape'); await sleep(600);
      // Esc não fechou: guarda no relatório o que estava aberto (o fechamento das configurações ignora o Esc com menu/janela aberta)
      const preso = await pg.evaluate(() => document.getElementById('settings') && [...document.querySelectorAll('.backdrop:not(.leaving),.popout,.menu,.emoji-picker,#tedit')].map(e => e.id || e.className).join(' | '));
      if (preso) relatorio.erros.push('abrir-fechar-modal: Esc não fechou as configurações; aberto: ' + preso); });
  }
} catch (e) { relatorio.erros.push('geral: ' + (e.stack || e.message)); console.log('ERRO', e); }
finally {
  // pacote do crítico: telas, referências e o pedido. Nada de código nem de explicação do que é de propósito.
  for (const f of fs.existsSync(path.join(OUT, 'telas')) ? fs.readdirSync(path.join(OUT, 'telas')) : []) fs.copyFileSync(path.join(OUT, 'telas', f), path.join(OUT, 'critico', 'telas', f));
  if (fs.existsSync('referencia')) fs.cpSync('referencia', path.join(OUT, 'critico', 'referencia'), { recursive: true, filter: (s) => fs.statSync(s).isDirectory() || /\.(png|jpe?g|webp)$/i.test(s) });
  const lista = (d) => { const r = []; const walk = (x) => { for (const f of fs.readdirSync(x).sort()) { const p = path.join(x, f); fs.statSync(p).isDirectory() ? walk(p) : r.push(path.relative(path.join(OUT, 'critico'), p)); } }; walk(d); return r; };
  const arquivos = lista(path.join(OUT, 'critico')).filter(f => f !== 'PEDIDO.md');
  fs.writeFileSync(path.join(OUT, 'critico', 'PEDIDO.md'), `# Revisão visual

Você vai ver capturas de um aplicativo de chat, voz e transmissão de tela. Compare com o patamar das imagens de
\`referencia/\` (se houver) e com o que se espera de um app de comunicação de ponta de 2026.

- \`telas/\`: 6 telas fixas (1 a 5 em 1920×1080, a 6 em 390×844).
- \`movimento/<roteiro>/amostra-*.png\`: um quadro a cada ${AMOSTRA_MS} ms de cada roteiro (abrir o app, trocar de canal,
  entrar na chamada, abrir e fechar um modal).
- \`movimento/<roteiro>/rajada-*.png\`: ${RAJADA} quadros pintados seguidos, no trecho que mais mudou. Procure piscada,
  salto de layout, elemento surgindo do nada, esqueleto sumindo de uma vez e texto mudando de lugar.

Escala:
- **grave**: qualquer pessoa nota em 1 segundo como app amador ou quebrado.
- **médio**: se nota olhando com atenção.
- **menor**: só aparece na comparação lado a lado com a referência.

Devolva uma lista em ordem de prioridade. Cada item com: severidade, arquivo(s), região da tela e o que está errado,
de forma concreta (medida, cor, alinhamento, o que aparece e o que deveria aparecer). Não sugira código.

Arquivos:
${arquivos.map(f => '- ' + f).join('\n')}
`);
  relatorio.fim = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify(relatorio, null, 1));
  console.log(`\nPronto: ${OUT}/critico (${arquivos.length} imagens). Erros: ${relatorio.erros.length}`);
  for (const e of relatorio.erros) console.log('  -', e);
  await browser.close().catch(() => { }); srv.kill(); setTimeout(() => process.exit(0), 300);
}
