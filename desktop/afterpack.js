// electron-builder (build.afterPack): tira do pacote o dxcompiler.dll (~26 MB), o compilador de shaders do WebGPU (Dawn
// no Direct3D 12). O Resenha não usa WebGPU e o desliga no main.js (disable-blink-features=WebGPU); o resto da GPU
// (Direct3D 11, ANGLE) não depende dele. Sem a DLL, o Dawn cai no compilador antigo (FXC, d3dcompiler_47.dll, que fica).
const fs = require('node:fs');
const path = require('node:path');
exports.default = async function afterPack(ctx) {
  for (const f of ['dxcompiler.dll']) {
    const p = path.join(ctx.appOutDir, f);
    if (fs.existsSync(p)) { const mb = (fs.statSync(p).size / 1048576).toFixed(1); fs.rmSync(p); console.log(`afterPack: ${f} removido (${mb} MB)`); }
  }
};
