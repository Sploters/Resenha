// ESLint (npm run lint): pega erro de verdade que o `node --check` não pega — variável não declarada, nome duplicado,
// código inalcançável, comparação sempre falsa etc. Não mexe em estilo (o projeto tem o seu, com linhas compridas).
// Erros reprovam a verificação do GitHub (.github/workflows/testes.yml); avisos só aparecem.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/target/**', 'public/vendor/**', 'spikes/**', '.claude/**', '.test*/**', 'data/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }], // catch { } vazio é proposital no projeto todo
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-control-regex': 'off', // regex com \u0000 etc. de propósito (md(), limpeza de texto)
      'no-cond-assign': ['error', 'except-parens'],
      'no-async-promise-executor': 'warn',
      'no-misleading-character-class': 'warn',
      'no-useless-escape': 'off',
    },
  },
  { files: ['server/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', '*.js', '*.mjs', 'desktop/**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  // páginas do navegador: app, workers e worklets de áudio
  { files: ['public/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['public/*-worker.js', 'public/sw.js'], languageOptions: { globals: { ...globals.worker, ...globals.serviceworker } } },
  { files: ['public/*worklet*.js', 'public/fx-*.js'], languageOptions: { globals: { ...globals.audioWorklet, sampleRate: 'readonly', currentTime: 'readonly', registerProcessor: 'readonly', AudioWorkletProcessor: 'readonly' } } },
  // app desktop (Electron): CommonJS no processo principal e no preload; as páginas locais rodam no navegador
  { files: ['desktop/**/*.js'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } } },
  // testes: o código passado ao navegador (page.evaluate) usa window/document dentro de arquivos Node
  { files: ['scripts/**/*.{js,mjs}'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['scripts/load/k6-*.js'], languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } } },
];
