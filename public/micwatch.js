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
  // esgotou as tentativas e a captura continua morta: avisa a pessoa uma vez (w.deadNew, lido por voice.js) em vez de calar
  const fix = (why) => { if (!canFix()) { if (w.fixes >= MICWATCH.MAX && !w.dead) w.dead = w.deadNew = true; return null; } w.fixes++; w.lastFix = w.t; w.fresh = why === 'silence'; return { rebuild: why }; };

  if (s.ended) return fix('ended');
  if (!s.ctxRunning) { // sem o motor de áudio rodando a leitura do nível não vale
    w.ctxOff++;
    return w.ctxOff >= MICWATCH.CTX_S ? fix('ctx') || 'resume' : 'resume';
  }
  w.ctxOff = 0;
  if (s.muted) { w.mute++; if (w.mute >= MICWATCH.MUTE_S) { w.mute = 0; return fix('muted'); } return null; }
  w.mute = 0;
  if (s.peak == null) return null;
  if (s.peak > ZERO_PEAK) { w.heard = true; w.zero = 0; w.fresh = false; w.fixes = 0; w.dead = false; return null; } // voltou o som: a conta de remontagens zera
  // zero absoluto
  if (w.fresh && !w.heard && w.age >= MICWATCH.FRESH_S) { w.zeroOk = true; w.fresh = false; } // remontou e continua zero: é o dispositivo
  if (!w.heard || w.zeroOk) return null;
  if (++w.zero >= MICWATCH.ZERO_S) { w.zero = 0; return fix('silence'); }
  return null;
}

// Falando mutado: com o mudo ligado a captura continua aberta (o vigia acima lê o nível cru, antes do mudo), então dá para
// perceber quem fala sem lembrar que está mutado e avisar "Você está mutado" com o botão de desmutar. Nada sai para a sala:
// é só a leitura local. Fala = trecho de 250 ms com energia (RMS) bem acima do ruído de fundo em pelo menos HIT dos últimos
// WIN trechos (~1,2 s de fala em 2 s): tecla, clique, tosse e porta batendo são curtos e não contam. O ruído de fundo desce
// na hora e sobe devagar (ventilador ou ar-condicionado ligado não vira "fala" depois de alguns segundos).
export const TALKMUTED = {
  WIN: 8, HIT: 5, // janela e trechos com fala (de 250 ms)
  MIN_RMS: 0.006, // ~-44 dBFS: abaixo disso é chiado, mesmo num microfone baixo
  FLOOR_X: 3.5, // fala = ~11 dB acima do ruído de fundo
  ARM_S: 1.5, // acabou de mutar: o fim da frase que estava falando não conta
  COOL_S: 25, // intervalo mínimo entre dois avisos
};
export const newTalkMuted = () => ({ t: 0, hist: [], floor: null, mutedFor: 0, last: -Infinity });
// Um passo (250 ms). s = { muted: mudo escolhido pela pessoa (e nada além dele fechando o microfone), rms: nível cru do
// trecho ou null }. true = mostrar o aviso agora.
export function talkMutedStep(w, s) {
  const T = TALKMUTED; w.t += 0.25;
  if (!s.muted) { w.hist.length = 0; w.mutedFor = 0; }
  if (s.rms == null) return false;
  const r = s.rms;
  w.floor = w.floor == null || r < w.floor ? r : w.floor + (r - w.floor) * 0.02;
  if (!s.muted) return false;
  w.mutedFor += 0.25;
  w.hist.push(r > Math.max(T.MIN_RMS, w.floor * T.FLOOR_X)); if (w.hist.length > T.WIN) w.hist.shift();
  if (w.mutedFor < T.ARM_S || w.t - w.last < T.COOL_S || w.hist.filter(Boolean).length < T.HIT) return false;
  w.last = w.t; w.hist.length = 0; return true;
}
