// Processo à parte que minifica a interface para o server/static.js: recebe [{ ext, code }] em JSON pela entrada e
// devolve a lista de códigos minificados (null onde não deu). Roda e termina, então a memória do esbuild (~30 MB) não
// fica presa no servidor.
import { transformSync } from 'esbuild';
let input = '';
process.stdin.setEncoding('utf8').on('data', (d) => { input += d; }).on('end', () => {
  const out = JSON.parse(input).map(({ ext, code }) => {
    try { return transformSync(code, { loader: ext === '.css' ? 'css' : 'js', minify: true, keepNames: true, target: 'esnext', legalComments: 'inline', charset: 'utf8' }).code; }
    catch { return null; }
  });
  process.stdout.write(JSON.stringify(out));
});
