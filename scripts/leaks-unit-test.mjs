// Memória em sessões longas, sem servidor nem navegador: contadores por pessoa (server/limits.js pruneHits) saem quando
// ficam velhos, e os canais guardados fora da tela (public/chat.js pruneCachedChannels) não crescem sem parar.
// Uso: node scripts/leaks-unit-test.mjs
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

// pruneHits: relógio falso via setInterval capturado
const realSI = globalThis.setInterval; let tick = null;
globalThis.setInterval = (fn) => { tick = fn; return { unref() { } }; };
const { pruneHits } = await import('../server/limits.js');
const m = new Map(), now = Date.now();
for (let i = 0; i < 1000; i++) m.set('u' + i, [now - 120e3]); // pediram há 2 min
m.set('recente', [now - 1000]); m.set('vazio', []);
pruneHits(m, 60e3); tick();
ok(m.size === 1 && m.has('recente'), 'pruneHits tira quem não pediu nada dentro da janela', [...m.keys()].slice(0, 5));
globalThis.setInterval = (fn, ms) => { const t = realSI(fn, ms); t.unref?.(); return t; }; // os do app não seguram o processo

// pruneCachedChannels: carrega chat.js com o mínimo do navegador; S e detached vêm dos módulos de verdade
globalThis.Element = class { }; globalThis.DocumentFragment = class { }; globalThis.HTMLElement = class { };
globalThis.window = globalThis; globalThis.localStorage = { getItem() { return null; }, setItem() { }, removeItem() { } };
globalThis.sessionStorage = { getItem() { return null; }, setItem() { } };
const stubEl = () => ({ style: {}, classList: { add() { }, toggle() { }, remove() { }, contains() { return false; } }, dataset: {}, append() { }, appendChild() { }, setAttribute() { }, addEventListener() { }, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { documentElement: stubEl(), body: stubEl(), head: stubEl(), addEventListener() { }, removeEventListener() { }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: stubEl, createElementNS: stubEl, hasFocus: () => true, visibilityState: 'visible' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() { } });
globalThis.addEventListener = () => { }; globalThis.removeEventListener = () => { };
globalThis.MutationObserver = globalThis.ResizeObserver = globalThis.IntersectionObserver = class { observe() { } disconnect() { } unobserve() { } };
globalThis.requestAnimationFrame = (f) => setTimeout(f, 16); globalThis.location = { href: 'http://x/', origin: 'http://x', pathname: '/', search: '', hash: '', protocol: 'http:', host: 'x' };
globalThis.history = { replaceState() { }, pushState() { }, state: null }; globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
let chat; try { chat = await import('../public/chat.js'); } catch (e) { ok(false, 'chat.js carrega com o DOM mínimo', e.message.split('\n')[0]); }
if (chat) {
  const { S } = await import('../public/state.js');
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: String(1e6 + i) }));
  S.view = { cid: 'c0' }; S.messages.clear(); S.loaded.clear();
  for (let i = 0; i < 60; i++) { S.messages.set('c' + i, msgs(i === 59 ? 900 : 10)); S.loaded.set('c' + i, true); }
  S.messages.set('c0', msgs(900));
  chat.pruneCachedChannels();
  ok(S.messages.size === 40 && S.messages.has('c0'), 'no máximo 40 canais guardados (o da tela fica)', S.messages.size);
  ok(S.messages.get('c0').length === 900, 'o canal na tela não é cortado aqui (trimChat cuida dele)');
  ok(S.messages.get('c59').length === 50 && S.loaded.get('c59') === false, 'canal grande fora da tela volta às 50 mais novas', S.messages.get('c59')?.length);
  ok(S.messages.get('c59')?.at(-1).id === String(1e6 + 899), 'ficam as mais novas');
  ok(!S.messages.has('c1') && S.messages.has('c59'), 'saem os abertos há mais tempo');
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
