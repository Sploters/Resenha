// Assinatura dos instaladores do app desktop (Ed25519).
// O GitHub Actions assina cada instalador com a chave PRIVADA (segredo DESKTOP_UPDATE_KEY do repositório) e publica a
// assinatura ao lado dele (Resenha-Setup-X.exe.sig). O app só instala o que confere com a chave PÚBLICA embutida nele
// (desktop/updatekey.js): servidor invadido, GitHub comprometido ou alguém no meio da rede não conseguem fazer o app
// rodar um instalador alterado, porque não têm a chave privada.
//   node scripts/update-sign.mjs keygen                 -> cria um par de chaves (privada: segredo do GitHub; pública: desktop/updatekey.js)
//   node scripts/update-sign.mjs sign <instalador> <versão>   (chave em DESKTOP_UPDATE_KEY) -> <instalador>.sig
//   node scripts/update-sign.mjs verify <instalador> [<.sig>]  -> confere com a chave pública do app
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { message, PUBLIC_KEY } = require('../desktop/updatekey.js');
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'keygen') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  console.log('# chave PRIVADA (segredo DESKTOP_UPDATE_KEY no GitHub; nunca no repositório):\n' + privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('# chave PÚBLICA (desktop/updatekey.js):\n' + publicKey.export({ type: 'spki', format: 'pem' }));
} else if (cmd === 'sign') {
  const pem = (process.env.DESKTOP_UPDATE_KEY || '').trim();
  if (!pem) { console.error('DESKTOP_UPDATE_KEY vazio: crie o segredo no GitHub (Settings → Secrets and variables → Actions). Sem ele os apps recusam a atualização.'); process.exit(1); }
  const key = crypto.createPrivateKey(pem);
  // confere que a chave privada é o par da pública embutida no app (senão todos os apps recusariam esta versão)
  if (crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).trim() !== PUBLIC_KEY.trim()) { console.error('DESKTOP_UPDATE_KEY não é o par da chave pública de desktop/updatekey.js'); process.exit(1); }
  const name = path.basename(a), size = fs.statSync(a).size, sha256 = sha256File(a);
  const sig = crypto.sign(null, Buffer.from(message({ name, version: b, size, sha256 })), key).toString('base64');
  fs.writeFileSync(a + '.sig', JSON.stringify({ v: 1, name, version: b, size, sha256, sig }) + '\n');
  console.log('assinado', name, b, size, sha256);
} else if (cmd === 'verify') {
  const s = JSON.parse(fs.readFileSync(b || a + '.sig', 'utf8'));
  const okHash = s.size === fs.statSync(a).size && s.sha256 === sha256File(a);
  const okSig = crypto.verify(null, Buffer.from(message(s)), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(s.sig, 'base64'));
  console.log(okHash && okSig ? 'OK' : 'NÃO CONFERE', { arquivo: okHash, assinatura: okSig });
  process.exit(okHash && okSig ? 0 : 1);
} else {
  console.log('uso: node scripts/update-sign.mjs keygen | sign <instalador> <versão> | verify <instalador> [<.sig>]');
}
