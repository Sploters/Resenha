// Config do electron-builder para o AUTOTESTE da transmissão (desktop/autoteste.js). Usado só por build-autoteste.sh.
// Parte do "build" do package.json, mas: entrada autoteste.js, só os arquivos dele, o "Jogo de Teste" junto e um .exe
// portátil com outro nome. O instalador da Resenha não muda.
const base = require('./package.json').build;
module.exports = {
  ...base,
  appId: 'br.resenha.autoteste',
  productName: 'Resenha Autoteste',
  extraMetadata: { main: 'autoteste.js', name: 'resenha-autoteste' },
  files: ['autoteste.js', 'autoteste.html', 'build/icon.ico', 'build/icon.png'],
  extraResources: [
    { from: 'native/lc-stream.exe', to: 'lc-stream.exe' },
    { from: '../native/lc-stream/target-poc/x86_64-pc-windows-gnu/release/lc-stream.exe', to: 'lc-stream-poc.exe' },
  ],
  win: { ...base.win, target: ['portable'], signExecutable: false },
  portable: { ...base.portable, artifactName: 'Teste-Transmissao-Resenha.${ext}' },
  directories: { output: 'dist-autoteste' },
};
