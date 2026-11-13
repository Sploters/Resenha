// Segurança do atualizador do app desktop (Electron de verdade + servidor HTTPS falso com certificado autoassinado):
// 1) instalador com assinatura válida → fica pronto para instalar
// 2) instalador adulterado (1 byte diferente) → recusado
// 3) sem assinatura → recusado
// 4) endereço de download http:// → recusado
// 5) o certificado do servidor muda → a página não carrega e a tela de conexão avisa
// Precisa da chave privada das atualizações (DESKTOP_UPDATE_KEY, ou o arquivo em UPDATE_KEY_FILE); sem ela o teste é pulado.
// Uso: node scripts/update-security-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electronPath = require('../desktop/node_modules/electron');
const { message } = require('../desktop/updatekey.js');
const pem = process.env.DESKTOP_UPDATE_KEY || (process.env.UPDATE_KEY_FILE && fs.readFileSync(process.env.UPDATE_KEY_FILE, 'utf8'));
if (!pem) { console.log('sem DESKTOP_UPDATE_KEY: teste pulado'); process.exit(0); }
const key = crypto.createPrivateKey(pem);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const dir = '.testdata-upd'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir + '/appdata', { recursive: true });
const cert = (n) => { execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k${n}.pem`, '-out', `${dir}/c${n}.pem`, '-days', '2', '-subj', '/CN=Resenha', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' }); return { key: fs.readFileSync(`${dir}/k${n}.pem`), cert: fs.readFileSync(`${dir}/c${n}.pem`) }; };
const tls1 = cert(1), tls2 = cert(2);

const V = '9.9.9', NAME = `Resenha-Setup-${V}.exe`, body = crypto.randomBytes(200000);
const sign = (buf, o = {}) => { const s = { v: 1, name: NAME, version: V, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...o }; s.sig = crypto.sign(null, Buffer.from(message(s)), key).toString('base64'); return s; };
let mode = 'good';
const handler = (req, res) => {
  if (req.url === '/api/server-info') return res.end(JSON.stringify({ name: 'Teste' }));
  if (req.url === '/api/desktop/update') {
    res.setHeader('Content-Type', 'application/json');
    const url = mode === 'http' ? `http://127.0.0.1:3299/${NAME}` : `/desktop/download/${NAME}`;
    return res.end(JSON.stringify({ version: V, name: NAME, size: body.length, url, signature: mode === 'nosig' ? null : sign(body) }));
  }
  if (req.url.startsWith('/desktop/download/')) { const b = Buffer.from(body); if (mode === 'tamper') b[100] ^= 1; return res.end(b); }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Resenha</title><h1 id=ok>servidor</h1>');
};
let srv = https.createServer(tls1, handler).listen(3298);
const plain = http.createServer(handler).listen(3299);

// configuração já apontando para o servidor (instalação antiga, sem certificado guardado: guarda o da 1ª conexão)
const appData = dir + '/appdata', cfgDir = appData + '/Resenha';
fs.mkdirSync(cfgDir, { recursive: true });
fs.writeFileSync(cfgDir + '/config.json', JSON.stringify({ server: 'https://localhost:3298' }));
const env = { ...process.env, XDG_CONFIG_HOME: process.cwd() + '/' + appData, APPDATA: process.cwd() + '/' + appData };
const start = () => spawn(electronPath, ['desktop', '--no-sandbox', '--remote-debugging-port=9334', '--user-data-dir=' + process.cwd() + '/' + dir + '/ud'], { stdio: 'ignore', env });
const connect = async () => { for (let i = 0; i < 40; i++) { await sleep(500); try { return await puppeteer.connect({ browserURL: 'http://127.0.0.1:9334', defaultViewport: null }); } catch { } } return null; };
const findPage = async (b, f) => { for (let i = 0; i < 30; i++) { const p = (await b.pages()).find(x => f(x.url())); if (p) return p; await sleep(300); } return null; };
const mainLog = () => { try { return fs.readFileSync(cfgDir + '/main.log', 'utf8'); } catch { return ''; } };
let app = start(), browser;
try {
  browser = await connect(); ok(!!browser, 'Electron iniciou');
  const page = await findPage(browser, u => u.startsWith('https://localhost:3298'));
  ok(!!page && await page.$('#ok').then(Boolean), 'carregou o servidor com certificado autoassinado (1ª conexão guarda o certificado)');
  const pins = JSON.parse(fs.readFileSync(cfgDir + '/config.json', 'utf8')).certPins || {};
  ok(!!pins.localhost, 'impressão digital do certificado guardada');
  const check = async () => page.evaluate(() => window.lcDesktop.checkUpdate());
  // para cada caso o app precisa achar a versão de novo: reinicia o estado do atualizador recarregando a configuração? não:
  // a mesma versão já encontrada não é procurada de novo, então começa pelos casos que devem FALHAR (não guardam arquivo)
  mode = 'nosig'; let r = await check();
  ok(r && !r.ready, 'sem assinatura: recusado'); ok(/sem assinatura/.test(mainLog()), 'log diz "sem assinatura"');
  // o app só procura de novo uma versão diferente: os casos seguintes reiniciam o app
  app.kill(); await browser.disconnect().catch(() => { }); await sleep(1500);
  mode = 'tamper'; app = start(); browser = await connect();
  let p2 = await findPage(browser, u => u.startsWith('https://localhost:3298'));
  r = await p2.evaluate(() => window.lcDesktop.checkUpdate());
  ok(r && !r.ready, 'instalador adulterado: recusado'); ok(/ATUALIZAÇÃO RECUSADA .*não confere/.test(mainLog()), 'log diz que o arquivo não confere');
  app.kill(); await browser.disconnect().catch(() => { }); await sleep(1500);
  mode = 'http'; app = start(); browser = await connect();
  p2 = await findPage(browser, u => u.startsWith('https://localhost:3298'));
  r = await p2.evaluate(() => window.lcDesktop.checkUpdate());
  ok(r && !r.ready, 'download por http://: recusado'); ok(/só por HTTPS/.test(mainLog()), 'log diz "só por HTTPS"');
  app.kill(); await browser.disconnect().catch(() => { }); await sleep(1500);
  mode = 'good'; app = start(); browser = await connect();
  p2 = await findPage(browser, u => u.startsWith('https://localhost:3298'));
  r = await p2.evaluate(() => window.lcDesktop.checkUpdate());
  ok(r && r.ready === true, 'assinatura válida: instalador pronto'); ok(/assinatura conferida/.test(mainLog()), 'log diz "assinatura conferida"');
  // troca o certificado do servidor: o app não pode aceitar
  app.kill(); await browser.disconnect().catch(() => { }); await sleep(1500);
  await new Promise(r => srv.close(r)); srv = https.createServer(tls2, handler).listen(3298);
  app = start(); browser = await connect();
  const cp = await findPage(browser, u => u.includes('connect.html'));
  ok(!!cp, 'certificado diferente: voltou para a tela de conexão');
  const msg = cp ? await cp.$eval('#msg', e => e.textContent).catch(() => '') : '';
  ok(/certificado de segurança .* mudou/.test(msg), 'aviso de certificado mudado: ' + msg.slice(0, 80));
  ok(/CERTIFICADO DO SERVIDOR MUDOU/.test(mainLog()), 'log registra a troca de certificado');
  // a pessoa confirma o servidor de novo: aceita o certificado novo
  if (cp) {
    await cp.$eval('#addr', e => { e.value = 'https://localhost:3298'; }); await cp.click('#go'); await sleep(1500);
    ok(/diferente do que estava guardado/.test(await cp.$eval('#msg', e => e.textContent)), 'tela de conexão pede um 2º clique para confiar no certificado novo');
    await cp.click('#go'); await sleep(2500); // o app reabre com o certificado novo
    await browser.disconnect().catch(() => { }); browser = await connect();
  }
  const p3 = await findPage(browser, u => u.startsWith('https://localhost:3298'));
  ok(!!p3 && await p3.waitForSelector('#ok', { timeout: 8000 }).then(Boolean, () => false), 'confirmando o servidor de novo, o certificado novo passa a valer');
} catch (e) { console.log('  EXCEÇÃO', e.stack); fails++; }
try { await browser?.disconnect(); } catch { }
app.kill(); srv.close(); plain.close(); try { execFileSync('pkill', ['-f', 'remote-debugging-port=9334']); } catch { } await sleep(500);
console.log(fails ? `\n${fails} FALHA(S)` : '\nATUALIZADOR OK');
process.exit(fails ? 1 : 0);
