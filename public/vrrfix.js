import { desktop } from './state.js';

// Vídeo piscando no app desktop (transmissões e clipes) que para ao passar o mouse por cima.
// Causa: G-Sync/FreeSync em modo janela. O driver (NVIDIA/AMD) trata o executável do app como um jogo e faz o monitor
// acompanhar a taxa de quadros da janela. Com o vídeo tocando, a janela só desenha quando chega quadro novo (30/60 por
// segundo, irregular), o monitor de 144 Hz fica trocando de frequência e o brilho oscila: a "piscadeira". Com o mouse
// em cima a janela redesenha a cada movimento e a frequência fica estável, por isso parece resolver. Chrome, Edge e
// Discord não têm isso porque os drivers já vêm com eles fora do G-Sync; o app próprio não está nessa lista.
// Correção: enquanto algum vídeo toca, um ponto invisível de 2 px muda um nada de opacidade a cada quadro (animação
// feita na placa, sem custo de página), e a janela entrega quadros na frequência do monitor, como com o mouse em cima.
// Só no app desktop: no navegador o driver já resolve.
let dot = null, anim = null, timer = 0, inited = false;

const playing = () => [...document.querySelectorAll('video')].some(v => v.isConnected && !v.paused && !v.ended && v.readyState >= 2);
// em tela cheia só o elemento em tela cheia é desenhado: o ponto vai junto, senão fica escondido e não gera quadros
const host = () => document.fullscreenElement || document.body;

function start() {
  if (!dot) dot = Object.assign(document.createElement('div'), { className: 'lc-vrr', ariaHidden: 'true' });
  dot.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;background:#000;opacity:.01;pointer-events:none;z-index:2147483647;contain:strict';
  if (dot.parentNode !== host()) { host().append(dot); anim?.cancel(); anim = null; }
  if (!anim || anim.playState !== 'running') anim = dot.animate([{ opacity: .01 }, { opacity: .02 }], { duration: 1000, iterations: Infinity, direction: 'alternate' });
}
function stop() { anim?.cancel(); anim = null; dot?.remove(); }

function check() {
  clearTimeout(timer); timer = 0;
  if (playing()) start(); else stop();
}
const soon = () => { if (!timer) timer = setTimeout(check, 50); };

export function initVrrFix() {
  if (!desktop || inited) return;
  inited = true;
  for (const ev of ['playing', 'play', 'pause', 'ended', 'emptied', 'loadeddata']) document.addEventListener(ev, soon, true);
  document.addEventListener('fullscreenchange', soon);
  // vídeo tirado da tela nem sempre avisa (transmissão que acabou, sala redesenhada): confere de vez em quando
  setInterval(check, 2000);
}
