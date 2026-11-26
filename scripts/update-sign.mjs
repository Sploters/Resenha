// Assinatura dos instaladores do app desktop (Ed25519).
// O GitHub Actions assina cada instalador com a chave PRIVADA (segredo DESKTOP_UPDATE_KEY do repositório) e publica a
// assinatura ao lado dele (Resenha-Setup-X.exe.sig). O app só instala o que confere com a chave PÚBLICA embutida nele
// (desktop/updatekey.js): servidor invadido, GitHub comprometido ou alguém no meio da rede não conseguem fazer o app
// rodar um instalador alterado, porque não têm a chave privada.
//   node scripts/update-sign.mjs keygen                 -> cria um par de chaves (privada: segredo do GitHub; pública: desktop/updatekey.js)
//   node scripts/update-sign.mjs sign <instalador> <versão>   (chave em DESKTOP_UPDATE_KEY) -> <instalador>.sig
//   node scripts/update-sign.mjs verify <instalador> [<.sig>]  -> confere com a chave pública do app
//   node scripts/update-sign.mjs sign-asar <Resenha-app-X.asar> <versão> <pasta dos nativos> [<electron>]
//        -> <asar>.sig da atualização por diferença (desktop/overlay.js): assina também o Electron (o de desktop/node_modules
//           se não vier) e a impressão dos programas nativos da pasta (os mesmos que vão no instalador)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { message, asarMessage, PUBLIC_KEY } = require('../desktop/updatekey.js');
const { nativesHash } = require('../desktop/overlay.js');
// O segredo colado no GitHub costuma chegar estragado: quebras de linha viradas em espaços ou em "\n" literal, só o miolo
// sem as linhas BEGIN/END, a linha de comentário do keygen junto. O OpenSSL só diz "DECODER routines::unsupported".
// Aqui o texto é remontado como PEM; o que não dá para consertar vira uma explicação. Nunca imprime a chave. A segurança
// não muda: a chave remontada ainda precisa ser o par da pública embutida no app (conferido logo depois).
export function readPrivateKey(raw) {
  let t = String(raw || '').replace(/\\n/g, '\n').replace(/\r/g, '').split('\n').filter(l => !l.trim().startsWith('#')).join('\n').trim();
  if (/-----BEGIN (RSA |EC )?PUBLIC KEY-----/.test(t)) throw new Error('o segredo tem a chave PÚBLICA; ele precisa da PRIVADA (a que começa com -----BEGIN PRIVATE KEY-----)');
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]*?)(-----END PRIVATE KEY-----|$)/.exec(t);
  if (m && !m[2]) throw new Error('a chave está cortada: falta a linha -----END PRIVATE KEY----- no fim do segredo');
  const body = (m ? m[1] : t).replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error(`o segredo não parece uma chave PEM (${t.length} caracteres, ${t.split('\n').length} linha(s), BEGIN: ${/-----BEGIN/.test(t) ? 'sim' : 'não'}, END: ${/-----END/.test(t) ? 'sim' : 'não'})`);
  const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  try { return crypto.createPrivateKey(pem); } catch (e) { throw new Error(`o conteúdo da chave não é válido (${body.length} caracteres de base64; uma chave Ed25519 tem 64). Copie de novo a chave inteira gerada pelo keygen. [${e.code || e.message}]`); }
}
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'keygen') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  console.log('# chave PRIVADA (segredo DESKTOP_UPDATE_KEY no GitHub; nunca no repositório):\n' + privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('# chave PÚBLICA (desktop/updatekey.js):\n' + publicKey.export({ type: 'spki', format: 'pem' }));
} else if (cmd === 'sign' || cmd === 'sign-asar') {
  const pem = (process.env.DESKTOP_UPDATE_KEY || '').trim();
  if (!pem) { console.error('DESKTOP_UPDATE_KEY vazio: crie o segredo no GitHub (Settings → Secrets and variables → Actions). Sem ele os apps recusam a atualização.'); process.exit(1); }
  let key; try { key = readPrivateKey(pem); } catch (e) { console.error('DESKTOP_UPDATE_KEY com problema: ' + e.message); process.exit(1); }
  // confere que a chave privada é o par da pública embutida no app (senão todos os apps recusariam esta versão)
  if (crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).trim() !== PUBLIC_KEY.trim()) {
    // mostra só a pública que sai do segredo (pública não é segredo) para dar para ver de qual par ele é
    const got = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).trim().split('\n')[1];
    const want = PUBLIC_KEY.trim().split('\n')[1];
    console.error(`DESKTOP_UPDATE_KEY não é o par da chave pública de desktop/updatekey.js\n  pública do segredo:  ${got}\n  pública do app:      ${want}\n` +
      'O keygen cria um par novo a cada vez: a privada do segredo e a pública do app precisam sair da MESMA execução.');
    process.exit(1);
  }
  const name = path.basename(a), size = fs.statSync(a).size, sha256 = sha256File(a);
  if (cmd === 'sign-asar') {
    const [, , , , natDir, el] = process.argv;
    if (name !== `Resenha-app-${b}.asar`) { console.error(`nome esperado: Resenha-app-${b}.asar`); process.exit(1); }
    if (!natDir || !fs.existsSync(natDir)) { console.error('pasta dos programas nativos não encontrada: ' + natDir); process.exit(1); }
    const electron = el || require('../desktop/node_modules/electron/package.json').version, natives = nativesHash(natDir);
    const fields = { name, version: b, size, sha256, electron, natives };
    const sig = crypto.sign(null, Buffer.from(asarMessage(fields)), key).toString('base64');
    fs.writeFileSync(a + '.sig', JSON.stringify({ v: 1, ...fields, sig }) + '\n');
    console.log('assinado (por diferença)', name, b, size, sha256, 'electron', electron, 'nativos', natives);
  } else {
    const sig = crypto.sign(null, Buffer.from(message({ name, version: b, size, sha256 })), key).toString('base64');
    fs.writeFileSync(a + '.sig', JSON.stringify({ v: 1, name, version: b, size, sha256, sig }) + '\n');
    console.log('assinado', name, b, size, sha256);
  }
} else if (cmd === 'verify') {
  const s = JSON.parse(fs.readFileSync(b || a + '.sig', 'utf8'));
  const okHash = s.size === fs.statSync(a).size && s.sha256 === sha256File(a);
  const okSig = crypto.verify(null, Buffer.from(message(s)), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(s.sig, 'base64'));
  console.log(okHash && okSig ? 'OK' : 'NÃO CONFERE', { arquivo: okHash, assinatura: okSig });
  process.exit(okHash && okSig ? 0 : 1);
} else {
  console.log('uso: node scripts/update-sign.mjs keygen | sign <instalador> <versão> | sign-asar <Resenha-app-X.asar> <versão> <pasta dos nativos> [<electron>] | verify <instalador> [<.sig>]');
}
