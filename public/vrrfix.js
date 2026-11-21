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

// players que não são <video> desta página (o YouTube do Watch Together roda num iframe de outro site): avisam por aqui
const sources = new Set();
export function vrrSource(fn) { sources.add(fn); return () => sources.delete(fn); }
export const vrrPoke = () => { if (inited) soon(); };
const playing = () => [...document.querySelectorAll('video')].some(v => v.isConnected && !v.paused && !v.ended && v.readyState >= 2) || [...sources].some(f => { try { return f(); } catch { return false; } });
// em tela cheia só o elemento em tela cheia é desenhado: o ponto vai junto, senão fica escondido e não gera quadros.
// Elemento que não desenha filhos (o iframe do YouTube em tela cheia pelo botão do próprio player, um <video>): o ponto
// fica no body e sobe para a camada do topo (popover), por cima do que está em tela cheia.
const fsEl = () => document.fullscreenElement;
const host = () => { const f = fsEl(); return f && !/^(IFRAME|VIDEO|IMG|CANVAS)$/.test(f.tagName) ? f : document.body; };
const topLayer = () => { const f = fsEl(); return !!f && host() === document.body; };

function start() {
  if (!dot) dot = Object.assign(document.createElement('div'), { className: 'lc-vrr', ariaHidden: 'true' });
  dot.style.cssText = 'position:fixed;left:0;bottom:0;top:auto;right:auto;margin:0;padding:0;border:0;overflow:hidden;width:2px;height:2px;background:#000;opacity:.01;pointer-events:none;z-index:2147483647;contain:strict';
  if (dot.parentNode !== host()) { unTop(); host().append(dot); anim?.cancel(); anim = null; }
  if (topLayer()) { if (!dot.popover) dot.popover = 'manual'; try { if (!dot.matches(':popover-open')) dot.showPopover(); } catch { /* sem popover */ } }
  else unTop();
  if (!anim || anim.playState !== 'running') anim = dot.animate([{ opacity: .01 }, { opacity: .02 }], { duration: 1000, iterations: Infinity, direction: 'alternate' });
}
function unTop() { try { if (dot?.popover && dot.matches(':popover-open')) dot.hidePopover(); } catch { } if (dot) dot.popover = null; }
function stop() { anim?.cancel(); anim = null; unTop(); dot?.remove(); }

function check() {
  clearTimeout(timer); timer = 0;
  if (playing()) start(); else stop();
}
const soon = () => { if (!timer) timer = setTimeout(check, 50); };

export function initVrrFix() {
  if (!desktop || inited) return;
  inited = true;
  document.documentElement.classList.add('lc-desk'); // ux.css: vídeo sempre desenhado junto com a página
  for (const ev of ['playing', 'play', 'pause', 'ended', 'emptied', 'loadeddata']) document.addEventListener(ev, soon, true);
  document.addEventListener('fullscreenchange', soon);
  // vídeo tirado da tela nem sempre avisa (transmissão que acabou, sala redesenhada): confere de vez em quando
  setInterval(check, 2000);
}
