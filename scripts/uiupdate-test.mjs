// Atualização da interface sem reiniciar o servidor e sem tirar ninguém da chamada à toa (server/static.js reload,
// SIGHUP e callActive em server/index.js, public/uiupdate.js, volta para a chamada em public/userbar.js):
// - SIGHUP com public/ mudado: versão nova, UI_VERSION para as páginas abertas e a versão anterior ainda servida;
// - chamada com conversa (2 pessoas falando): a página NÃO recarrega, mesmo com a pessoa longe do aparelho;
// - chamada parada (todos no mudo há mais que CALL_ACTIVE_MS): recarrega sozinha e volta para a chamada, mudo mantido,
//   e quem ficou recebe a saída com reason 'reload' (sem som de sair/entrar);
// - em-chamada.json e /api/voice/quiet com a contagem de chamadas ativas.
// Uso: node scripts/uiupdate-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };

const ACTIVE = 4000, PORT = 3351, DIR = path.resolve('.testdata-uiupdate'), PUB = path.join(DIR, 'public');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
fs.cpSync('public', PUB, { recursive: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, PUBLIC_DIR: PUB, RTC_PORT: '41380', RTC_IPS: '127.0.0.1', CALL_ACTIVE_MS: String(ACTIVE) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (c) => { log += c; }); srv.stderr.on('data', (c) => { log += c; });
process.on('exit', () => { try { srv.kill(); } catch { } });
const BASE = `http://localhost:${PORT}`;
if (!await until(() => fetch(BASE + '/api/server-info').then(() => true, () => false), 30000)) { console.log('servidor não subiu\n' + log); process.exit(1); }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await api('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const metaV = async () => /name="lc-ui" content="(\w+)"/.exec(await (await fetch(BASE + '/')).text())?.[1];
const emChamada = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'em-chamada.json'), 'utf8')); } catch { return null; } };

// microfone falso tocando "fala" sem parar (tom com vibrato, como em speaking-server-test.mjs): o bipe padrão do Chromium
// é filtrado como ruído e o servidor não o ouviria
const WAV = path.join(DIR, 'fala.wav');
{
  const rate = 48000, n = rate * 4, pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate; pcm[i] = Math.round(0.4 * 32767 * Math.sin(2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 5 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'T' }); await api(b.tok, 'POST', '/invites/' + (await api(a.tok, 'POST', `/guilds/${g.id}/invites`)).code);
  const open = async (br, tok) => { const p = await br.newPage(); await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
      const W = window.WebSocket; window.__left = []; window.__ui = [];
      window.WebSocket = function (...x) { const s = new W(...x); s.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.t === 'VOICE_STATE' && m.d && !m.d.channel_id) window.__left.push(m.d); if (m.t === 'UI_VERSION') window.__ui.push(m.d.v); } catch { } }); return s; };
      window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
    }, tok);
    await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; };
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const v0 = await metaV();
  ok(/^\w{10}$/.test(v0 || '') && await A.evaluate(() => document.querySelector('meta[name="lc-ui"]')?.content) === v0, 'a página sabe com qual versão abriu', v0);

  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  ok(await until(() => emChamada()?.inCalls === 2 && emChamada()?.ativas === 1 && emChamada()?.emAtivas === 2, 15000), 'em-chamada.json: 1 chamada ativa com 2 pessoas', emChamada());

  // 1) interface nova (SIGHUP), sem reiniciar
  const oldApp = await (await fetch(`${BASE}/app.js?v=${v0}`)).text();
  fs.appendFileSync(path.join(PUB, 'app.js'), '\n// versão nova (teste)\n');
  srv.kill('SIGHUP');
  ok(await until(async () => (await metaV()) !== v0, 10000), 'SIGHUP: o servidor passa a entregar a versão nova sem reiniciar', await metaV());
  const v1 = await metaV();
  ok(srv.exitCode === null, 'o servidor continua de pé');
  ok(await until(() => A.evaluate((v) => window.__ui.includes(v), v1)), 'a página aberta recebe UI_VERSION');
  const r0 = await fetch(`${BASE}/app.js?v=${v0}`);
  ok(r0.status === 200 && /immutable/.test(r0.headers.get('cache-control') || '') && await r0.text() === oldApp, 'módulo da versão anterior continua servido igual (página velha abrindo tela sob demanda)');
  ok(await A.evaluate(() => window.__lc.voice.channelId) === vch.id, 'ninguém saiu da chamada');
  ok(await until(() => A.evaluate(() => !!document.querySelector('.appupd.uiupd')), 5000), 'pessoa usando o app: aparece o cartão "Versão nova"');

  // 2) Alice longe do aparelho (janela escondida), chamada com conversa: não recarrega
  const hide = (P) => P.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(ACTIVE + 1500); // passou o prazo desde a entrada: o que mantém a chamada ativa agora é a fala
  const q1 = await api(a.tok, 'GET', '/voice/quiet');
  ok(q1.in_call && !q1.quiet, 'microfones abertos (falando): a chamada continua ativa depois do prazo', q1);
  await hide(A); await sleep(2500);
  ok(await A.evaluate((v) => document.querySelector('meta[name="lc-ui"]').content !== v, v1), 'chamada ativa: a página não recarregou');

  // 3) os dois no mudo: depois de CALL_ACTIVE_MS a chamada fica parada, a Alice recarrega e volta sozinha
  await A.evaluate(() => window.__lc.voice.toggleMute()); await B.evaluate(() => window.__lc.voice.toggleMute());
  ok(await until(async () => (await api(a.tok, 'GET', '/voice/quiet')).quiet, ACTIVE + 8000), 'todos no mudo: a chamada fica parada');
  ok(await until(() => emChamada()?.ativas === 0, 15000), 'em-chamada.json: nenhuma chamada ativa (o deploy pode reiniciar)', emChamada());
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => { });
  ok(await until(() => A.evaluate((v) => document.querySelector('meta[name="lc-ui"]')?.content === v, v1).catch(() => false), 40000), 'a Alice recarregou para a versão nova');
  ok(await until(() => A.evaluate((c) => window.__lc.voice?.channelId === c && !!window.__lc.voice?.sfu?.ready, vch.id).catch(() => false), 30000), 'e voltou sozinha para a chamada');
  ok(await A.evaluate(() => window.__lc.voice.muted), 'continua no mudo');
  const left = await B.evaluate((uid) => window.__left.filter(x => x.user_id === uid).map(x => x.reason), a.id);
  ok(left.length === 1 && left[0] === 'reload', 'o Bruno recebeu a saída como recarga (sem som de sair e entrar)', left);
  ok(await B.evaluate((uid, c) => window.__lc.S.voice.get(uid)?.channel_id === c, a.id, vch.id), 'para o Bruno a Alice está de novo na sala');
  ok(!await A.evaluate(() => !!document.querySelector('.appupd.uiupd')), 'na versão nova não sobra cartão');
} catch (e) { console.log('  EXCEÇÃO', e.message); fails++; }
finally { await bA.close(); await bB.close(); srv.kill(); }
if (fails) console.log('\n--- log do servidor ---\n' + log.slice(-3000));
console.log(fails ? `\n${fails} FALHA(S)` : '\nATUALIZAÇÃO DA INTERFACE OK'); process.exit(fails ? 1 : 0);
