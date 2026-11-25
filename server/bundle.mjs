// Processo à parte que monta os pacotes da interface para o server/static.js (esbuild com divisão de código): a abertura
// vira ~10 arquivos em vez de ~130 módulos soltos. Cada pedido pelo túnel até o servidor custa ~25–30 ms de fila, então
// abrir do zero (Ctrl+F5, cache vazio, depois de um deploy) levava ~3 s só para buscar os módulos.
// - entradas: app.js e cada tela aberta sob demanda (import('./x.js')): o que elas dividem vai para pedaços comuns, então
//   o state.js (e qualquer outro módulo) continua tendo UMA instância só na página;
// - entrada extra "lc-mods": aponta para todos os módulos, para o window.__lc.import dos testes pegar a mesma instância
//   que o app usa (só é baixada quando um teste pede);
// - nomes com hash do conteúdo (app.ABCD1234.js, c.WXYZ5678.js): pedaço que não mudou num deploy mantém o nome e sai do
//   cache. Ficam na raiz para new URL('./x-worker.js', import.meta.url) continuar achando os workers.
// Entrada (JSON): { root, entries: ['app.js', ...], mods: ['state.js', ...], minify }. Saída (JSON):
// { files: { nome: texto }, entries: { 'app.js': nome, ... }, boot: [nomes que a abertura baixa], mods: nome }
// ou { error }. Roda e termina, então a memória do esbuild não fica presa no servidor.
import path from 'node:path';
import { build } from 'esbuild';

let input = '';
process.stdin.setEncoding('utf8').on('data', (d) => { input += d; }).on('end', async () => {
  try {
    const { root, entries, mods, minify } = JSON.parse(input);
    const virt = {
      name: 'lc-mods',
      setup(b) {
        b.onResolve({ filter: /^lc-mods$/ }, () => ({ path: 'lc-mods', namespace: 'lc' }));
        // import('/vendor/...'): continua arquivo à parte (external: ['/*'] pegaria também o caminho já resolvido no disco)
        b.onResolve({ filter: /^\// }, (a) => ({ path: a.path, external: true }));
        b.onLoad({ filter: /.*/, namespace: 'lc' }, () => ({
          resolveDir: root, loader: 'js',
          contents: mods.map((f, i) => `import * as m${i} from './${f}';`).join('\n') + `\nexport default { ${mods.map((f, i) => `${JSON.stringify(f)}: m${i}`).join(', ')} };`,
        }));
      },
    };
    const r = await build({
      absWorkingDir: root, entryPoints: [...entries.map(f => ({ in: './' + f, out: f.replace(/\.js$/, '') })), { in: 'lc-mods', out: 'lc-mods' }],
      bundle: true, splitting: true, format: 'esm', outdir: root, write: false, metafile: true, plugins: [virt],
      entryNames: '[name].[hash]', chunkNames: 'c.[hash]',
      minify: !!minify, keepNames: true, target: 'esnext', legalComments: 'inline', charset: 'utf8', logLevel: 'silent',
    });
    const name = (p) => path.relative(root, p).split(path.sep).join('/');
    const files = {}; for (const f of r.outputFiles) files[name(f.path)] = f.text;
    const outs = r.metafile.outputs, byEntry = {};
    // chaves do metafile: relativas a absWorkingDir (= root = outdir), então já são o nome do arquivo
    for (const [o, m] of Object.entries(outs)) if (m.entryPoint) byEntry[m.entryPoint.replace(/^lc:/, '').replace(/^\.\//, '')] = o;
    const app = byEntry['app.js'], boot = new Set();
    const walk = (o) => { if (boot.has(o) || !outs[o]) return; boot.add(o); for (const i of outs[o].imports || []) if (i.kind === 'import-statement' && !i.external) walk(i.path); };
    walk(app);
    process.stdout.write(JSON.stringify({ files, entries: byEntry, boot: [...boot], mods: byEntry['lc-mods'] }));
  } catch (e) { process.stdout.write(JSON.stringify({ error: String(e?.message || e).slice(0, 2000) })); }
});
