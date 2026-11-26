// Atualização por diferença do app desktop (desktop/overlay.js, updatekey.js verifyAsar), sem Electron: um par de chaves
// de teste assina um app.asar falso e pick() decide, como o boot.js, se abre a versão da pasta de dados ou a embutida.
// Uso: node scripts/overlay-unit-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ov = require('../desktop/overlay.js'), uk = require('../desktop/updatekey.js');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-')), data = path.join(tmp, 'data'), res = path.join(tmp, 'res');
fs.mkdirSync(path.join(data, 'app-updates'), { recursive: true }); fs.mkdirSync(res);
for (const n of ov.NATIVES) fs.writeFileSync(path.join(res, n), 'binário ' + n);
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
// o verify do app, com a chave de teste no lugar da embutida (mesma mensagem e mesmas regras)
const verify = (s, e) => {
  const base = uk.verifyAsar(s, e); if (base && base !== 'assinatura inválida') return base;
  return crypto.verify(null, Buffer.from(uk.asarMessage(s)), publicKey, Buffer.from(s.sig, 'base64')) ? null : 'assinatura inválida';
};
const ELECTRON = '45.1.0';
function makeOverlay(version, { electron = ELECTRON, natives = ov.nativesHash(res), body = 'conteúdo do app.asar ' + version } = {}) {
  const name = `Resenha-app-${version}.asar`, file = path.join(data, 'app-updates', name);
  fs.writeFileSync(file, body);
  const fields = { name, version, size: fs.statSync(file).size, sha256: ov.sha256File(file), electron, natives };
  const signature = { v: 1, ...fields, sig: crypto.sign(null, Buffer.from(uk.asarMessage(fields)), privateKey).toString('base64') };
  return { version, file, sha256: fields.sha256, signature, electron, tries: 0 };
}
const pick = (cfg, builtin = '1.0.60') => ov.pick({ cfg, builtinVersion: builtin, electron: ELECTRON, resDir: res, dataDir: data, verify });

let cfg = { overlay: makeOverlay('1.0.61') };
let p = pick(cfg);
ok(p?.version === '1.0.61' && p.asar.endsWith('Resenha-app-1.0.61.asar'), 'versão nova, mesmo Electron e nativos: abre a da pasta de dados');
ok(cfg.overlay.tries === 1, 'conta a tentativa (main.js zera quando a janela carrega)');
pick(cfg);
ok(!pick(cfg) && !cfg.overlay && cfg.overlayBad === '1.0.61', 'não abriu em 2 tentativas: volta ao embutido e marca a versão (próxima vez, instalador completo)');
cfg = { overlay: makeOverlay('1.0.61') };
ok(!pick(cfg, '1.0.61') && !cfg.overlay, 'instalação já na mesma versão (instalador completo entrou): descarta');
cfg = { overlay: makeOverlay('1.0.62', { electron: '46.0.0' }) }; cfg.overlay.electron = '46.0.0';
ok(!pick(cfg) && !cfg.overlay, 'feita para outro Electron: descarta');
cfg = { overlay: makeOverlay('1.0.62', { natives: 'f'.repeat(64) }) };
ok(!pick(cfg) && !cfg.overlay, 'feita para outros programas nativos: descarta');
cfg = { overlay: makeOverlay('1.0.62') }; fs.appendFileSync(cfg.overlay.file, 'alterado');
ok(!pick(cfg) && !cfg.overlay, 'arquivo mexido depois de conferido: descarta');
cfg = { overlay: makeOverlay('1.0.62') }; cfg.overlay.signature = { ...cfg.overlay.signature, sig: Buffer.alloc(64).toString('base64') };
ok(!pick(cfg) && !cfg.overlay, 'assinatura que não é da chave: descarta');
cfg = { overlay: { ...makeOverlay('1.0.62'), file: path.join(tmp, 'outro.asar') } };
ok(!pick(cfg) && !cfg.overlay, 'caminho fora da pasta de atualizações: descarta');
// verifyAsar com a chave EMBUTIDA: nada assinado por outra chave passa
const o = makeOverlay('1.0.63'), e = { name: o.signature.name, version: '1.0.63', size: o.signature.size, sha256: o.sha256, electron: ELECTRON, natives: ov.nativesHash(res) };
ok(uk.verifyAsar(o.signature, e) === 'assinatura inválida', 'a chave embutida no app recusa o que outra chave assinou');
ok(uk.verifyAsar({ ...o.signature, name: 'Resenha-Setup-1.0.63.exe' }, { ...e, name: 'Resenha-Setup-1.0.63.exe' }) === 'assinatura malformada', 'nome que não é de app.asar é recusado');
ok(uk.verifyAsar(o.signature, { ...e, electron: '46.0.0' }) === 'feita para outro Electron', 'Electron diferente é recusado antes da assinatura');
// assinatura de instalador não serve como assinatura de app.asar (mensagens diferentes)
const inst = crypto.sign(null, Buffer.from(uk.message({ name: o.signature.name, version: '1.0.63', size: o.signature.size, sha256: o.sha256 })), privateKey).toString('base64');
ok(verify({ ...o.signature, sig: inst }, e) === 'assinatura inválida', 'assinatura de instalador não vale para app.asar');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
