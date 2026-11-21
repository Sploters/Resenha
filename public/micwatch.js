// Vigia do microfone durante a chamada: percebe quando a captura morre sem aviso e pede para montar o microfone de novo,
// sem sair da sala (antes só sair e entrar na chamada fazia a voz voltar).
//
// Como a captura morre: o Windows ou o driver reinicia o dispositivo (outro programa ou jogo abre o microfone em modo
// exclusivo ou muda o formato dele, o USB economiza energia, o fone Bluetooth troca de perfil). O navegador às vezes
// encerra a trilha ('ended'), às vezes a deixa "muda" ('mute') e às vezes a deixa viva entregando zero absoluto para
// sempre. Microfone de verdade nunca dá zero absoluto (sempre tem o chiado de fundo, mesmo baixinho), então zero puro
// por vários segundos depois de já ter tido som = captura morta.
//
// Microfone que dá zero de propósito (alguns USB com porta de ruído embutida, NVIDIA Broadcast, cabos virtuais):
// a primeira remontagem acontece no silêncio (não corta nada), e se a captura NOVA também começar em zero absoluto
// o vigia entende que é o jeito do dispositivo e para de remontar por silêncio até o fim da chamada.
//
// Lógica pura (sem navegador) para o teste scripts/micwatch-unit-test.mjs; voice.js chama micWatchStep a cada segundo.

export const MICWATCH = {
  ZERO_S: 6, // segundos de zero absoluto (depois de ter tido som) para considerar a captura morta
  FRESH_S: 3, // captura recém-montada pelo vigia: zero nestes primeiros segundos = o dispositivo dá zero de propósito
  MUTE_S: 4, // trilha "muda" pelo sistema por tanto tempo
  CTX_S: 3, // motor de áudio parado (suspenso/interrompido) por tanto tempo, mesmo pedindo para voltar
  GAP_S: 15, // intervalo mínimo entre duas remontagens automáticas
  MAX: 6, // remontagens seguidas sem o som voltar (não fica em laço se o dispositivo morreu de vez)
};
// nível abaixo de meio bit de 24 bits: zero de verdade (a captura morta entrega 0.0 exato)
export const ZERO_PEAK = 3e-8;

export const newMicWatch = () => ({ t: 0, graph: 0, heard: false, zero: 0, mute: 0, ctxOff: 0, lastFix: -Infinity, fixes: 0, fresh: false, zeroOk: false });

// Um passo (1 s). s = { graph: id da captura atual, ended, muted, ctxRunning, peak (maior amostra do último trecho, ou
// null sem leitura) }. Devolve null (tudo certo), 'resume' (pedir para o motor de áudio voltar) ou { rebuild: motivo }.
export function micWatchStep(w, s) {
  w.t++;
  if (s.graph !== w.graph) { // captura nova (vigia, troca de microfone, filtro): começa a contar do zero
    w.graph = s.graph; w.heard = false; w.zero = 0; w.mute = 0; w.ctxOff = 0; w.age = 0;
  }
  w.age = (w.age || 0) + 1;
  const canFix = () => w.fixes < MICWATCH.MAX && w.t - w.lastFix >= MICWATCH.GAP_S;
  const fix = (why) => { if (!canFix()) return null; w.fixes++; w.lastFix = w.t; w.fresh = why === 'silence'; return { rebuild: why }; };

  if (s.ended) return fix('ended');
  if (!s.ctxRunning) { // sem o motor de áudio rodando a leitura do nível não vale
    w.ctxOff++;
    return w.ctxOff >= MICWATCH.CTX_S ? fix('ctx') || 'resume' : 'resume';
  }
  w.ctxOff = 0;
  if (s.muted) { w.mute++; if (w.mute >= MICWATCH.MUTE_S) { w.mute = 0; return fix('muted'); } return null; }
  w.mute = 0;
  if (s.peak == null) return null;
  if (s.peak > ZERO_PEAK) { w.heard = true; w.zero = 0; w.fresh = false; w.fixes = 0; return null; } // voltou o som: a conta de remontagens zera
  // zero absoluto
  if (w.fresh && !w.heard && w.age >= MICWATCH.FRESH_S) { w.zeroOk = true; w.fresh = false; } // remontou e continua zero: é o dispositivo
  if (!w.heard || w.zeroOk) return null;
  if (++w.zero >= MICWATCH.ZERO_S) { w.zero = 0; return fix('silence'); }
  return null;
}
