// Copia o Mediabunny (conversão de vídeo no navegador por WebCodecs, MPL-2.0) para public/vendor, com o aviso de licença.
// Carregado só quando um vídeo precisa ser comprimido antes do envio (public/compress.js). Parte de npm run build:vendor.
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('node_modules/mediabunny/package.json', 'utf8'));
const src = fs.readFileSync('node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', 'utf8');
fs.mkdirSync('public/vendor/mediabunny', { recursive: true });
fs.writeFileSync('public/vendor/mediabunny/mediabunny.js', `/*! Mediabunny ${pkg.version} — Copyright (c) Vanilagy — Mozilla Public License 2.0 (https://github.com/Vanilagy/mediabunny, https://mozilla.org/MPL/2.0/). Código-fonte sem modificações: https://www.npmjs.com/package/mediabunny/v/${pkg.version}. Gerado por npm run build:vendor. */\n` + src);
fs.copyFileSync('node_modules/mediabunny/LICENSE', 'public/vendor/mediabunny/LICENSE');
console.log('mediabunny', pkg.version, '-> public/vendor/mediabunny/');
