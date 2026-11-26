// Primeiro arquivo do app desktop (package.json "main"). Decide se abre o app embutido (main.js) ou a versão mais nova
// recebida por diferença (só o app.asar, guardado na pasta de dados: desktop/overlay.js). Qualquer erro aqui: o embutido.
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

function dataDir() { // a mesma pasta que o main.js usa (Resenha; LocalCord para quem ainda não migrou o nome)
  const base = app.getPath('appData'), dir = path.join(base, 'Resenha'), old = path.join(base, 'LocalCord');
  return !fs.existsSync(path.join(dir, 'config.json')) && fs.existsSync(path.join(old, 'config.json')) ? old : dir;
}
let picked = null;
if (!process.env.PORTABLE_EXECUTABLE_DIR && app.isPackaged) {
  try {
    const dir = dataDir(), file = path.join(dir, 'config.json'), cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cfg.overlay) {
      const log = (...a) => { try { fs.appendFileSync(path.join(dir, 'main.log'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { } };
      picked = require('./overlay').pick({ cfg, builtinVersion: app.getVersion(), electron: process.versions.electron, resDir: process.resourcesPath, dataDir: dir, verify: require('./updatekey').verifyAsar, log });
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
      if (picked) log('abrindo a versão', picked.version, 'recebida por diferença (instalada:', app.getVersion() + ')');
    }
  } catch { picked = null; }
}
if (picked) {
  global.__resenhaOverlay = picked;
  try { require(path.join(picked.asar, 'main.js')); } catch (e) {
    // não carregou: a próxima abertura conta a tentativa e acaba voltando ao embutido; nesta, abre o embutido já
    global.__resenhaOverlay = null;
    try { fs.appendFileSync(path.join(dataDir(), 'main.log'), `${new Date().toISOString()} versão por diferença falhou ao carregar: ${e.message}\n`); } catch { }
    require('./main.js');
  }
} else require('./main.js');
