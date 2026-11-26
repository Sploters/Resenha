// Atualização por diferença do app desktop: só o app.asar (~200 KB) em vez do instalador inteiro (~113 MB), quando a
// versão nova usa o MESMO Electron e os MESMOS programas nativos (lc-input, lc-stream, lc-audio) da instalação.
//
// Nada da instalação é trocado. O app.asar novo, assinado (desktop/updatekey.js verifyAsar), fica na pasta de dados
// (app-updates/Resenha-app-<versão>.asar) e cfg.overlay anota o que foi conferido. Na abertura, boot.js chama pick():
// se a anotação ainda confere (arquivo igual ao assinado, versão mais nova que a instalada, mesmo Electron e mesmos
// nativos), carrega o main.js de dentro desse app.asar no lugar do embutido.
// Proteção contra uma versão que não abre: cada abertura soma uma tentativa (tries) e a janela carregada zera
// (main.js healthy). Passou de MAX_TRIES sem abrir: a anotação é apagada, a versão fica marcada (cfg.overlayBad) e o
// app volta ao embutido; a próxima busca de atualização usa o instalador completo, como antes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_TRIES = 2;
const NATIVES = ['lc-input.exe', 'lc-stream.exe', 'lc-audio.exe'];
const NAME_RE = /^Resenha-app-(\d+\.\d+\.\d+)\.asar$/;

function sha256File(file) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
// impressão dos programas nativos da instalação (ou da pasta do build, na hora de assinar): nome e SHA-256 de cada um
function nativesHash(dir) {
  const lines = NATIVES.map(n => { const f = path.join(dir, n); let s = '-'; try { s = sha256File(f); } catch { } return n + ':' + s; });
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}
const newerVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// o que boot.js carrega: { asar, version } ou null (usa o embutido). Mexe em cfg (tentativas, anotação apagada): quem
// chama grava o cfg. verify = updatekey.verifyAsar
function pick({ cfg, builtinVersion, electron, resDir, dataDir, verify, log = () => { } }) {
  const o = cfg?.overlay; if (!o) return null;
  const drop = (why) => { log('atualização por diferença descartada: ' + why, o.version); delete cfg.overlay; return null; };
  if (typeof o.version !== 'string' || !newerVer(o.version, builtinVersion)) return drop('a instalação já é igual ou mais nova');
  if ((o.tries || 0) >= MAX_TRIES) { cfg.overlayBad = o.version; return drop('não abriu nas últimas tentativas (volta ao instalador completo)'); }
  if (o.electron !== electron) return drop('Electron diferente');
  // a anotação vem do config.json: só o arquivo com o nome certo, dentro da pasta de atualizações
  const want = path.join(dataDir, 'app-updates', `Resenha-app-${o.version}.asar`);
  if (typeof o.file !== 'string' || path.resolve(o.file) !== path.resolve(want) || !NAME_RE.test(path.basename(want))) return drop('caminho inesperado');
  let size; try { size = fs.statSync(want).size; } catch { return drop('arquivo sumiu'); }
  const sha256 = sha256File(want);
  const bad = verify(o.signature, { name: path.basename(want), version: o.version, size, sha256, electron, natives: nativesHash(resDir) });
  if (bad) return drop(bad);
  o.tries = (o.tries || 0) + 1;
  return { asar: want, version: o.version };
}

module.exports = { MAX_TRIES, NATIVES, NAME_RE, sha256File, nativesHash, newerVer, pick };
