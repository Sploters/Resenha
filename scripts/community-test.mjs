// Pedidos da comunidade, no app (servidor real + navegador):
// - modo foco: mensagem de servidor (até com @menção) não avisa; mensagem direta avisa
// - não perturbe: nada avisa
// - volume das notificações: entra no som das mensagens (e o aviso do sistema vai sem o som dele)
// - configurações não se perdem: mudança que não chegou à conta (app fechou/atualizou antes) vale ao abrir de novo
// - microfone salvo com id que mudou: reencontrado pelo nome
// - telas de Privacidade (ligações / quem vê o status) e Notificações (volume e modo foco)
// Uso: BROWSER=/caminho/do/chrome node scripts/community-test.mjs   (SHOTS=1 salva capturas em .testshots/community)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3292, BASE = `http://localhost:${PORT}`, DATA = './.testdata-comm', OUT = '.testshots/community';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41092', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
// avisos do sistema e sons registrados (sem tocar nada de verdade)
const spy = () => {
  window.__n = [];
  class N { constructor(t, o) { window.__n.push({ t, ...o }); } close() { } static permission = 'granted'; static requestPermission = async () => 'granted'; }
  window.Notification = N;
  Object.defineProperty(document, 'hasFocus', { value: () => false }); // app em segundo plano: os avisos aparecem
};
try {
  const a = await reg('ana'), b = await reg('bia');
  await call(a.tok, 'POST', '/relationships', { username: 'bia' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});
  const g = await call(b.tok, 'POST', '/guilds', { name: 'Servidor da Bia' });
  const code = (await call(b.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(a.tok, 'POST', '/invites/' + code);
  const dm = await call(b.tok, 'POST', '/dms', { user_id: a.id });
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument(spy);
  await p.goto(BASE); await p.evaluate((t) => { localStorage.lc_token = t; }, a.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 });
  const chId = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 0).id, g.id);
  await p.evaluate(() => { window.__lc.S.prefs.desktopNotif = true; });

  // ---------- modo foco ----------
  await p.evaluate(async () => { (await window.__lc.import('state.js')).setFocus(true); });
  ok(await p.evaluate(() => !!document.querySelector('.pb-fbadge') && /Modo foco/.test(document.querySelector('#userbar .un')?.textContent || '')), 'modo foco: selo no avatar e "Modo foco" na barra do perfil');
  await call(b.tok, 'POST', `/channels/${chId}/messages`, { content: `<@${a.id}> olha isso` }); await sleep(600);
  ok(await p.evaluate(() => window.__n.length === 0), 'modo foco: @menção num servidor não mostra aviso', await p.evaluate(() => window.__n));
  ok(await p.evaluate((c) => (window.__lc.S.mentions[c] || 0) === 1, chId), '…mas continua contando como menção não lida');
  await call(b.tok, 'POST', `/channels/${dm.id}/messages`, { content: 'oi, tá aí?' }); await sleep(600);
  const n1 = await p.evaluate(() => window.__n);
  ok(n1.length === 1 && /bia/.test(n1[0].t) && n1[0].silent === true, 'modo foco: mensagem direta avisa (e o aviso do sistema vai sem o som dele)', n1);
  // não perturbe: nada avisa
  await call(a.tok, 'PATCH', '/me', { status: 'dnd' }); await sleep(500);
  await call(b.tok, 'POST', `/channels/${dm.id}/messages`, { content: 'e agora?' }); await sleep(600);
  ok(await p.evaluate(() => window.__n.length === 1), 'não perturbe: nem a mensagem direta avisa');
  await call(a.tok, 'PATCH', '/me', { status: 'online' });
  await p.evaluate(async () => { (await window.__lc.import('state.js')).setFocus(Date.now() - 1); window.__n = []; });
  await call(b.tok, 'POST', `/channels/${chId}/messages`, { content: `<@${a.id}> e agora?` }); await sleep(600);
  ok(await p.evaluate(() => window.__n.length === 1), 'modo foco com horário vencido: servidores voltam a avisar');

  // ---------- volume das notificações ----------
  const vol = await p.evaluate(async () => {
    const S = window.__lc.S; const { playSound } = await window.__lc.import('sounds.js');
    const seen = []; const G = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () { const n = G.call(this); const set = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value').set; const gp = n.gain; Object.defineProperty(gp, 'value', { set(v) { seen.push(v); set.call(gp, v); }, get() { return 0; } }); return n; };
    S.prefs.soundVolume = 100; S.prefs.notifVolume = 50; S.prefs.voiceSoundVolume = 100; seen.length = 0; playSound('mention', { force: true }); const note = seen[0];
    seen.length = 0; playSound('join', { force: true }); const voiceS = seen[0];
    AudioContext.prototype.createGain = G; return { note, voiceS };
  });
  ok(Math.abs(vol.note - vol.voiceS / 2) < 1e-6 && vol.note > 0, 'volume das notificações em 50%: o som de menção sai na metade; os sons da chamada não mudam', vol);

  // ---------- configurações não se perdem ----------
  // mudou algo e o app fechou antes de mandar para a conta (atualização): ao abrir, vale o que estava aqui
  await call(a.tok, 'PUT', '/me/settings', { settings: { gate: false, gateDb: -45, soundVolume: 80 } }); await sleep(500); // o que a conta tinha
  await p.evaluate(() => { const S = window.__lc.S; S.prefs.gate = true; S.prefs.gateDb = -38; localStorage.setItem('lc_prefs', JSON.stringify(S.prefs)); localStorage.setItem('lc_prefs_dirty', '1'); });
  await p.reload(); await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 }); await sleep(800);
  ok(await p.evaluate(() => window.__lc.S.prefs.gate === true && window.__lc.S.prefs.gateDb === -38), 'ao abrir de novo, a mudança feita antes de fechar continua (não volta ao que estava na conta)');
  const srvS = (await call(a.tok, 'GET', '/me/settings')).settings;
  ok(srvS.gate === true && srvS.gateDb === -38, '…e vai para a conta (os outros aparelhos recebem)', { gate: srvS.gate, gateDb: srvS.gateDb });
  // a marca só some quando não sobra nada por enviar (o app ainda grava ajustes logo depois de abrir: espera o envio seguinte)
  ok(await p.waitForFunction(() => !localStorage.getItem('lc_prefs_dirty'), { timeout: 5000 }).then(() => true, () => false), 'enviada: a marca de "pendente" some');
  // fechar a página logo depois de mudar: o envio sai mesmo assim (pedido que sobrevive ao fechamento)
  await p.evaluate(async () => { const st = await window.__lc.import('state.js'); window.__lc.S.prefs.gateDb = -30; st.savePrefs(); });
  await p.goto('about:blank'); await sleep(800);
  ok((await call(a.tok, 'GET', '/me/settings')).settings.gateDb === -30, 'mudou e fechou em seguida: a mudança chega à conta');
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 10000 });

  // ---------- microfone reencontrado pelo nome ----------
  const dev = await p.evaluate(async () => {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
    const ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && !/^(default|communications)$/.test(d.deviceId));
    const S = window.__lc.S, st = await window.__lc.import('state.js');
    S.prefs.inputId = 'id-antigo-que-nao-existe-mais'; S.prefs.inputLabel = ins[0]?.label;
    await st.resolveDevices();
    return { got: S.prefs.inputId, want: ins[0]?.deviceId, label: ins[0]?.label };
  });
  ok(!!dev.want && dev.got === dev.want, 'microfone com id novo: reencontrado pelo nome, sem voltar ao padrão', dev);
  ok(await p.evaluate(async () => { const S = window.__lc.S; S.prefs.inputId = 'desconectado'; S.prefs.inputLabel = 'Headset que não está ligado'; await (await window.__lc.import('state.js')).resolveDevices(); return S.prefs.inputId === 'desconectado'; }),
    'aparelho desconectado agora: a escolha fica guardada (volta quando religar)');
  await p.evaluate(() => { const S = window.__lc.S; S.prefs.inputId = ''; delete S.prefs.inputLabel; });

  // ---------- telas ----------
  await p.evaluate(() => window.__lc.openSettings('privacy')); await p.waitForSelector('#settings'); await sleep(500);
  const pv = await p.evaluate(() => ({ calls: /Ligações/i.test(document.querySelector('#settings').innerText), pres: /Quem vê seu status/i.test(document.querySelector('#settings').innerText) }));
  ok(pv.calls && pv.pres, 'Privacidade: seções "Ligações" e "Quem vê seu status e sua atividade"', pv);
  // desliga "Todo mundo" nas ligações pela tela
  await p.evaluate(() => { const rows = [...document.querySelectorAll('#settings .perm')]; rows.find(r => /Todo mundo/.test(r.textContent))?.querySelector('.switch')?.click(); }); await sleep(700);
  ok((await call(a.tok, 'GET', '/me/settings')).privacy.calls.everyone === false, 'Privacidade: desligar "Todo mundo" salva na conta');
  ok(await p.evaluate(() => /Amigos de amigos/.test(document.querySelector('#settings').innerText)), '…e aparecem as opções Amigos / Amigos de amigos / Membros dos servidores');
  // só quem eu escolher
  await p.evaluate(() => [...document.querySelectorAll('#settings .choice')].find(c => /Só quem eu escolher/.test(c.textContent))?.click()); await sleep(600);
  await p.evaluate(() => [...document.querySelectorAll('#settings .pv-add')][0]?.click()); await sleep(400);
  await p.evaluate(() => { const l = [...document.querySelectorAll('.pv-pi')].find(x => /bia/.test(x.textContent)); l?.querySelector('input')?.click(); });
  if (process.env.SHOTS) await p.screenshot({ path: OUT + '/privacy-pick.png' });
  await p.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Salvar/.test(b.textContent))?.click()); await sleep(700);
  const pr = (await call(a.tok, 'GET', '/me/settings')).privacy.presence;
  ok(pr.mode === 'chosen' && pr.allow.includes(b.id), '"Só quem eu escolher" + escolheu a Bia: salvo na conta', pr);
  ok(await p.evaluate(() => [...document.querySelectorAll('.pv-chip')].some(c => /bia/.test(c.textContent))), 'a Bia aparece na lista de quem pode ver');
  if (process.env.SHOTS) { await p.evaluate(() => document.querySelector('#settings .pv-sub')?.scrollIntoView({ block: 'center' })); await sleep(200); await p.screenshot({ path: OUT + '/privacy.png' }); }
  await p.evaluate(() => document.querySelector('#settings .ni[data-k="notifications"]')?.click()); await sleep(500);
  const nt = await p.evaluate(() => document.querySelector('#settings').innerText);
  ok(/Volume das notificações/i.test(nt) && /Modo foco/i.test(nt), 'Notificações: "Volume das notificações" e "Modo foco"');
  if (process.env.SHOTS) await p.screenshot({ path: OUT + '/notifications.png' });
  await p.evaluate(() => document.querySelector('#settings .ni[data-k="sounds"]')?.click()); await sleep(500);
  ok(await p.evaluate(() => document.querySelectorAll('#settings .snd-gvol').length === 3), 'Sons: um volume para cada grupo (notificações, chamada, transmissão)');
  if (process.env.SHOTS) await p.screenshot({ path: OUT + '/sounds.png' });
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
