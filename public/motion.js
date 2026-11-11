// Movimento da interface: peças pequenas usadas no app inteiro. Tudo respeita "Animações" / "Reduzir animações" (classe
// html.anim) e o "reduzir movimento" do sistema; sem animação, cada função faz o resultado final na hora.
// Regras (ver o bloco "Sistema de movimento" no fim de features.css):
// - entrar com ease-out; mover com ease-in-out; sair com ease-in e 20% mais curto que a entrada
// - menus 150 ms, popups 200 ms, começando em 95% do tamanho e crescendo a partir de onde foram abertos (e voltando para lá)
// - listas entram em cascata (30 ms entre linhas); confirmação com um pulso; ícone trocado com fade + desfoque
// - sem quique no dia a dia; troca de tela com as duas versões sobrepostas (View Transitions)
export const animOn = () => document.documentElement.classList.contains('anim');

// transform-origin no ponto de onde o elemento foi aberto (clique, botão): ele cresce dali e volta para lá ao fechar
export function originAt(el, x, y) {
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const ox = Math.max(0, Math.min(r.width, x - r.left)), oy = Math.max(0, Math.min(r.height, y - r.top));
  el.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
}
// o centro do botão/elemento que abriu
export function originFrom(el, trigger) { const t = trigger?.getBoundingClientRect?.(); if (t) originAt(el, t.left + t.width / 2, t.top + t.height / 2); }

// sai animando e só então remove (classe .leaving: some, encolhe para a origem, não recebe cliques)
export function leave(el, ms = 120) {
  if (!el || !el.isConnected || el.classList.contains('leaving')) return;
  if (!animOn()) return el.remove();
  el.classList.add('leaving');
  const done = () => el.remove();
  el.addEventListener('animationend', (e) => { if (e.target === el) done(); }); // só a animação de saída dele (não a de um filho)
  setTimeout(done, ms + 80); // garantia (aba em segundo plano não dispara animationend)
}

// linhas de uma lista em cascata (30 ms entre uma e outra; só as primeiras 12, o resto já aparece)
export function stagger(container, step = 30, max = 12) {
  if (!container || !animOn()) return;
  [...container.children].slice(0, max).forEach((c, i) => c.style.setProperty('--i', i));
  container.style.setProperty('--step', step + 'ms');
  container.classList.remove('stagger'); void container.offsetWidth; container.classList.add('stagger');
  setTimeout(() => container.classList.remove('stagger'), max * step + 400);
}

// confirmação: um pulso verde curto em volta do elemento (copiou, salvou, aceitou)
export function pulse(el) {
  if (!el || !animOn()) return;
  el.classList.remove('ok-pulse'); void el.offsetWidth; el.classList.add('ok-pulse');
  setTimeout(() => el.classList.remove('ok-pulse'), 600);
}

// ícone que muda de estado (mutar/desmutar): o novo entra com fade + desfoque. key = identificador estável do botão;
// state = o estado atual; só anima quando o estado de fato mudou desde o último desenho
const lastState = new Map();
export function swapIcon(btn, key, state) {
  const prev = lastState.get(key); lastState.set(key, state);
  if (prev === undefined || prev === state || !animOn() || !btn) return btn;
  btn.classList.add('icon-swap'); setTimeout(() => btn.classList.remove('icon-swap'), 260);
  return btn;
}

// troca de tela com as duas versões sobrepostas (a velha some enquanto a nova aparece). Sem suporte, com animações
// desligadas ou com vídeo na tela (transmissões: a captura do quadro pesa e pisca), só troca.
export function viewTransition(fn) {
  if (!animOn() || !document.startViewTransition || document.querySelector('#stage video, .livepip video, .fsbox')) return fn();
  // trocar de canal rápido pula a transição anterior: o aviso "Transition was skipped" não é erro (antes virava promessa rejeitada sem tratamento)
  try { const t = document.startViewTransition(fn); t.ready?.catch(() => { }); t.finished?.catch(() => { }); } catch { fn(); }
}
