// Chave PÚBLICA das atualizações do app (Ed25519). Só instaladores assinados com a chave privada correspondente
// (segredo DESKTOP_UPDATE_KEY do GitHub; ver scripts/update-sign.mjs) são instalados.
// Trocar esta chave: os apps já instalados continuam exigindo a antiga até receberem uma versão assinada com ela.
const crypto = require('node:crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAj1LHb/OitMJrzTai02k16KjkLTjQ9fZ+tvVoSXGlTAY=
-----END PUBLIC KEY-----`;

// o que é assinado: nome do arquivo, versão, tamanho e SHA-256. A versão entra na assinatura para ninguém conseguir
// apresentar um instalador antigo (assinado de verdade, mas com falha conhecida) como se fosse o novo.
const message = ({ name, version, size, sha256 }) => `Resenha-update-v1\n${name}\n${version}\n${size}\n${String(sha256).toLowerCase()}`;

// confere a assinatura s ({ name, version, size, sha256, sig }) contra o que se espera e o arquivo baixado (size, sha256)
function verifyUpdate(s, expect) {
  if (!s || typeof s !== 'object' || typeof s.sig !== 'string') return 'atualização sem assinatura';
  if (s.name !== expect.name || s.version !== expect.version) return 'assinatura de outro arquivo ou versão';
  if (!/^\d+\.\d+\.\d+$/.test(String(s.version)) || !(+s.size > 0) || !/^[0-9a-f]{64}$/i.test(String(s.sha256))) return 'assinatura malformada';
  if (+s.size !== expect.size || String(s.sha256).toLowerCase() !== expect.sha256) return 'arquivo baixado não confere com a assinatura';
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(message(s)), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(s.sig, 'base64')); } catch { ok = false; }
  return ok ? null : 'assinatura inválida';
}

// atualização por diferença (só o app.asar: desktop/overlay.js). Assina também a versão do Electron e a impressão dos
// programas nativos com que ela foi montada: só serve para uma instalação com os mesmos
const asarMessage = ({ name, version, size, sha256, electron, natives }) => `Resenha-asar-v1\n${name}\n${version}\n${size}\n${String(sha256).toLowerCase()}\n${electron}\n${String(natives).toLowerCase()}`;
function verifyAsar(s, expect) {
  if (!s || typeof s !== 'object' || typeof s.sig !== 'string') return 'atualização sem assinatura';
  if (s.name !== expect.name || s.version !== expect.version) return 'assinatura de outro arquivo ou versão';
  if (!/^Resenha-app-\d+\.\d+\.\d+\.asar$/.test(String(s.name)) || !/^\d+\.\d+\.\d+$/.test(String(s.version)) || !(+s.size > 0) || !/^[0-9a-f]{64}$/i.test(String(s.sha256)) || !/^[0-9a-f]{64}$/i.test(String(s.natives)) || typeof s.electron !== 'string') return 'assinatura malformada';
  if (s.electron !== expect.electron) return 'feita para outro Electron';
  if (String(s.natives).toLowerCase() !== String(expect.natives).toLowerCase()) return 'feita para outros programas nativos';
  if (+s.size !== expect.size || String(s.sha256).toLowerCase() !== expect.sha256) return 'arquivo baixado não confere com a assinatura';
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(asarMessage(s)), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(s.sig, 'base64')); } catch { ok = false; }
  return ok ? null : 'assinatura inválida';
}

module.exports = { PUBLIC_KEY, message, verifyUpdate, asarMessage, verifyAsar };
