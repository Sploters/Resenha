// Voltar do navegador (ou o botão/gesto de voltar do celular) fecha o que está aberto por cima — configurações, imagem
// ampliada, janelas — em vez de trocar a tela de baixo e deixar o painel aberto. Cada camada aberta põe uma entrada no
// histórico com o mesmo endereço (lcOver = profundidade); voltar tira as camadas acima da entrada que ficou.
// Fechar pelo X/Esc chama a função devolvida, que tira a entrada do histórico também.
const stack = [];
let skip = 0; // voltas que nós mesmos pedimos (fechou pelo X): o popstate delas não fecha mais nada
export function backCloses(close) {
  const depth = stack.length + 1, e = { close, depth, done: false };
  stack.push(e);
  // a entrada já existe quando uma camada troca por outra do mesmo nível (abrir as configurações de novo): reaproveita
  if (history.state?.lcOver !== depth) history.pushState({ ...(history.state || {}), lcOver: depth }, '');
  return (keepHistory) => {
    if (e.done) return; e.done = true;
    const i = stack.indexOf(e); if (i >= 0) stack.splice(i, 1);
    if (!keepHistory && history.state?.lcOver === depth) { skip++; history.back(); }
  };
}
addEventListener('popstate', () => {
  if (skip) { skip--; return; }
  const d = history.state?.lcOver || 0;
  while (stack.length && stack[stack.length - 1].depth > d) { const e = stack.pop(); if (!e.done) { e.done = true; try { e.close(); } catch (err) { console.error(err); } } }
});
