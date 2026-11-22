// Atualização baixada em segundo plano e instalada na próxima abertura (desktop/updready.js, usado por desktop/main.js):
// confere o instalador anotado (mesmo arquivo que foi assinado), a decisão na abertura e o limite de tentativas.
// Uso: node scripts/updready-test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { MAX_TRIES, HIDDEN_MS, sha256File, checkReady, startupAction, markHidden, takeHidden } = require('../desktop/updready.js');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
// assinatura de mentira com o mesmo contrato de updatekey.verifyUpdate (motivo da recusa, ou null)
const verify = (s, e) => (s?.sig === 'boa' && s.name === e.name && s.version === e.version && s.size === e.size && s.sha256 === e.sha256 ? null : 'assinatura inválida');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updready-')), file = path.join(dir, 'Resenha-Setup-1.0.60.exe');
fs.writeFileSync(file, crypto.randomBytes(3 * (1 << 20) + 123)); // mais de um bloco de leitura
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
ok(sha256File(file) === sha256, 'sha256 por blocos igual ao do arquivo inteiro');
const sig = { sig: 'boa', name: 'Resenha-Setup-1.0.60.exe', version: '1.0.60', size: fs.statSync(file).size, sha256 };
const r = { version: '1.0.60', name: 'Resenha-Setup-1.0.60.exe', file, sha256, signature: sig, tries: 0 };

ok(checkReady(r, verify) === file, 'instalador anotado íntegro: pronto para instalar');
ok(checkReady({ ...r, signature: { ...sig, sig: 'ruim' } }, verify) === null, 'assinatura recusada: não instala');
ok(checkReady({ ...r, file: path.join(dir, 'sumiu.exe') }, verify) === null, 'arquivo apagado (limpeza da pasta temporária): não instala');
ok(checkReady({ ...r, signature: undefined }, verify) === null, 'anotação sem assinatura: não instala');
{ const other = path.join(dir, 'outro.exe'); fs.copyFileSync(file, other); ok(checkReady({ ...r, file: other }, verify) === null, 'anotação apontando para outro arquivo (config.json mexido): não instala'); }
fs.appendFileSync(file, 'x');
ok(checkReady(r, verify) === null, 'arquivo trocado depois de conferido: não instala');
fs.truncateSync(file, sig.size);

ok(startupAction(null, '1.0.53', newer, false) === 'none', 'nada anotado: abre normal');
ok(startupAction(r, '1.0.53', newer, true) === 'none', 'versão portátil: não instala em silêncio');
ok(startupAction(r, '1.0.53', newer, false) === 'install', 'versão nova baixada: instala antes de abrir');
ok(startupAction(r, '1.0.60', newer, false) === 'drop' && startupAction(r, '1.0.61', newer, false) === 'drop', 'já está nessa versão (ou mais nova): descarta a anotação');

// sequência: o instalador não entra (o app continua na 1.0.53) -> tenta MAX_TRIES aberturas e para
const cfg = { readyUpdate: { ...r } }, seen = [];
for (let open = 0; open < MAX_TRIES + 2; open++) {
  const act = startupAction(cfg.readyUpdate, '1.0.53', newer, false); seen.push(act);
  if (act === 'install' && checkReady(cfg.readyUpdate, verify)) cfg.readyUpdate.tries++;
}
ok(seen.join() === [...Array(MAX_TRIES).fill('install'), 'skip', 'skip'].join(), `instalação que não entra: ${MAX_TRIES} tentativas e para (sem laço)`, seen);
// e quando entra: a abertura seguinte já está na versão nova e só descarta
ok(startupAction({ ...r, tries: 1 }, '1.0.60', newer, false) === 'drop', 'instalou: na abertura seguinte só descarta a anotação');

fs.rmSync(dir, { recursive: true, force: true });
// abertura escondida (iniciar com o Windows) que instalou: a reabertura logo depois continua escondida, uma vez só
{ const c = {}; markHidden(c, 1000);
  ok(takeHidden(c, 1000 + 30e3) === true && c.hiddenRelaunch === undefined, 'reabriu 30 s depois de instalar escondido: continua escondido (e a anotação some)');
  ok(takeHidden(c, 1000 + 31e3) === false, 'a abertura seguinte já é normal');
  markHidden(c, 1000); ok(takeHidden(c, 1000 + HIDDEN_MS + 1) === false && c.hiddenRelaunch === undefined, 'anotação velha (mais de 5 min): abre normal e a anotação some');
  ok(takeHidden({}, 5) === false, 'sem anotação: abre normal');
  ok(takeHidden({ hiddenRelaunch: 9000 }, 1000) === false, 'relógio voltou para trás: abre normal'); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nATUALIZAÇÃO NA ABERTURA OK'); process.exit(fails ? 1 : 0);
