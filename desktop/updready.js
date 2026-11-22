// Atualização baixada e com a assinatura conferida, esperando a próxima abertura do app (desktop/main.js).
// O app baixa a versão nova em segundo plano enquanto é usado e anota o instalador (cfg.readyUpdate). Ao abrir de novo,
// antes de mostrar a janela, confere outra vez que o arquivo é o mesmo que foi assinado e instala em silêncio: o app já
// reabre na versão nova. Se a instalação não entrar MAX_TRIES vezes, para de tentar na abertura (sem laço de
// reinstalações) e fica o caminho de antes ("Reiniciar agora" e a instalação ao sair).
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const MAX_TRIES = 2;

function sha256File(file) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

// o instalador anotado ainda é o que foi conferido? Devolve o caminho dele, ou null (apagado, trocado ou assinatura
// inválida). verify = updatekey.verifyUpdate (devolve o motivo da recusa, ou null se confere)
function checkReady(r, verify) {
  if (!r || !r.file || !r.version || !r.name || !r.signature || !r.sha256) return null;
  // a anotação vem do config.json (fora do app): só o arquivo com o nome assinado, nunca outro caminho qualquer
  if (typeof r.file !== 'string' || path.basename(r.file) !== r.name || !/^Resenha-Setup-\d+\.\d+\.\d+\.exe$/i.test(r.name)) return null;
  let size; try { size = fs.statSync(r.file).size; } catch { return null; }
  const sha256 = sha256File(r.file);
  if (sha256 !== r.sha256) return null;
  return verify(r.signature, { name: r.name, version: r.version, size, sha256 }) ? null : r.file;
}

// o que fazer na abertura: 'install' | 'drop' (a anotação não serve mais: versão já instalada) | 'skip' (tentou demais)
// | 'none' (nada anotado, ou versão portátil, que não instala em silêncio)
function startupAction(r, appVersion, newer, portable) {
  if (!r || portable) return 'none';
  if (!r.version || !newer(r.version, appVersion)) return 'drop';
  if ((r.tries || 0) >= MAX_TRIES) return 'skip';
  return 'install';
}

// Abriu escondido (iniciar com o Windows, --hidden) e foi instalar a versão baixada: o instalador reabre o app SEM o
// --hidden (--force-run, ou a janelinha de acompanhamento), e ele aparecia na tela logo depois do login. Antes de fechar
// para instalar, o app anota a hora (markHidden); a próxima abertura até HIDDEN_MS depois continua escondida (takeHidden,
// que apaga a anotação: vale uma vez só).
const HIDDEN_MS = 5 * 60e3;
function markHidden(cfg, now) { cfg.hiddenRelaunch = now; }
function takeHidden(cfg, now) {
  const t = cfg.hiddenRelaunch; if (t == null) return false;
  delete cfg.hiddenRelaunch;
  return typeof t === 'number' && now >= t && now - t < HIDDEN_MS;
}

module.exports = { MAX_TRIES, HIDDEN_MS, sha256File, checkReady, startupAction, markHidden, takeHidden };
