// Gera public/vendor/ns/vadgate/rnnoise.js: o carregador do RNNoise do @sapphi-red/web-noise-suppressor (o mesmo wasm de
// public/vendor/ns/rnnoise*.wasm) exportado como módulo, sem o processador dele. O worklet da porta por voz
// (public/vadgate-worklet.js) precisa do valor que rnnoise_process_frame devolve (a probabilidade de voz), que o
// processador original descarta. Rodado por npm run build:vendor.
import fs from 'node:fs';
const SRC = 'node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js';
const OUT = 'public/vendor/ns/vadgate/rnnoise.js';
const src = fs.readFileSync(SRC, 'utf8');
const cut = src.indexOf('const u=e=>{for(let[t,n]of e.entries())e[t]=n*32767}'); // começo do processador (helpers de escala)
if (cut < 0 || !/s=class e\{constructor\(e\)\{i\(this,`rnnoiseModule`/.test(src)) throw new Error('formato do pacote mudou: revise o corte em ' + SRC);
fs.mkdirSync('public/vendor/ns/vadgate', { recursive: true });
fs.writeFileSync(OUT, '/*! RNNoise (Xiph, BSD) + @sapphi-red/web-noise-suppressor (MIT): ver ../LICENSE. Gerado por scripts/vendor-rnnoise-vad.mjs. */\n'
  + src.slice(0, cut) + '\nexport { s as Rnnoise };\n');
console.log('ok', OUT, fs.statSync(OUT).size, 'bytes');
