// Formatação das mensagens (md() de public/util.js) sem navegador: o HTML que sai precisa ser sempre válido e seguro.
// Cobre: escape de HTML, links que não são estragados pelo negrito/itálico/spoiler de depois, menções, emojis e código.
// Uso: node scripts/md-unit-test.mjs
// util.js é do navegador: o mínimo de DOM para o módulo carregar (md() em si não usa o DOM)
globalThis.Element = class { }; globalThis.DocumentFragment = class { };
globalThis.window = globalThis; globalThis.localStorage = { getItem() { return null; }, setItem() { } };
globalThis.document = { documentElement: { classList: { add() { }, toggle() { }, remove() { } }, dataset: {} }, addEventListener() { }, querySelectorAll: () => [], createElement: () => ({ style: {} }) };
globalThis.matchMedia = () => ({ matches: false, addEventListener() { } });
const { md } = await import('../public/util.js');

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const ctx = { userName: (id) => (id === '1' ? 'Ana <b>' : null), roleOf: () => ({ name: 'Mod', color: '#ff0000' }), emojiUrl: () => '/files/e/pepe_1_.png' };
const r = (s) => md(s, ctx);
// confere se o HTML é bem formado: toda tag aberta fecha na ordem, e nenhum atributo tem < ou > dentro
const wellFormed = (html) => {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[\w-]+(?:="[^"<>]*")?)*)\s*>|<|>/gi)) {
    if (m[0] === '<' || m[0] === '>') return false;
    const [, close, tag] = m; if (['img', 'br'].includes(tag)) continue;
    if (close) { if (stack.pop() !== tag) return false; } else stack.push(tag);
  }
  return !stack.length;
};
const href = (html) => [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);

console.log('— escape');
{
  const h = r('<img src=x onerror=alert(1)> "aspas" & \'apóstrofo\'');
  ok(!h.includes('<img') && h.includes('&lt;img') && h.includes('&quot;') && h.includes('&#39;'), 'HTML do texto vira texto', h);
  ok(r('<@1>').includes('@Ana &lt;b&gt;'), 'nome na menção também é escapado');
}
console.log('— links');
{
  let h = r('https://site.com/_x_ e _y_');
  ok(href(h)[0] === 'https://site.com/_x_' && h.includes('<i>y</i>') && wellFormed(h), 'itálico não entra no link (https://site.com/_x_)', h);
  h = r('||https://a.com/||x||/onmouseover=alert(1)// ||');
  ok(wellFormed(h) && !/\son\w+=/.test(h), 'spoiler dentro do link não quebra o atributo', h);
  h = r('**negrito https://a.com/a_b_c**');
  ok(h.startsWith('<b>') && href(h)[0] === 'https://a.com/a_b_c' && wellFormed(h), 'link dentro de negrito: o ** não entra no link', h);
  h = r('veja (https://a.com/x).');
  ok(href(h)[0] === 'https://a.com/x', 'pontuação do fim fica fora do link', h);
  h = r('https://a.com/?q="><script>');
  ok(wellFormed(h) && !h.includes('<script'), 'aspas e < num link não escapam do href', h);
  ok(href(r('javascript:alert(1)')).length === 0, 'javascript: não vira link');
}
console.log('— menções, emojis e código');
{
  const h = r('oi <@1> <@&2> <@9> :smile: <:pepe:5> @everyone');
  ok(h.includes('data-uid="1"') && h.includes('--rc:#ff0000') && h.includes('@desconhecido') && h.includes('😄') && h.includes('class="cemoji"') && wellFormed(h), 'menções, emoji de atalho e emoji do servidor', h);
  ok(/src="\/files\/e\/pepe_1_\.png"/.test(h), 'itálico não mexe no endereço do emoji (pepe_1_)', h);
  const c = r('`**não** https://a.com` e ```\n<b>x</b>\n```');
  ok(c.includes('<span class="md-code">**não** https://a.com</span>') && c.includes('&lt;b&gt;x&lt;/b&gt;') && wellFormed(c), 'código fica cru (sem negrito, link ou HTML)', c);
  const t = r('# Título https://x.com\n> citação _it_');
  ok(t.includes('class="md h1"') && t.includes('class="md-quote"') && t.includes('<i>it</i>') && wellFormed(t), 'título, citação e itálico', t);
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
