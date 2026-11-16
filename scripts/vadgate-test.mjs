// Lógica da porta guiada por voz (public/vadgate-core.js), quadro a quadro, sem navegador: abre com voz, histerese, segura
// o fim das palavras, atenua em vez de emudecer, acompanha o ruído de fundo, não se deixa enganar por zumbido + cliques,
// abertura provisória do começo de palavra sem voz, graves nunca bloqueiam sozinhos, contexto de fala com ruído alto.
// Uso: node scripts/vadgate-test.mjs
import { createGate, gateParams, createBand, ST, FRAME, RATE } from '../public/vadgate-core.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const P = gateParams(50), FLOOR = 10 ** (P.floorDb / 20);
const run = (g, n, f) => { let t; for (let i = 0; i < n; i++) t = g.step(typeof f === 'function' ? f(i) : f); return t; };
const quiet = { vad: 0, lvl: -80 };

{ // silêncio: fechada, mas atenuando (não é mudo)
  const g = createGate(P); const t = run(g, 100, quiet);
  ok(g.state === ST.CLOSED && t === FLOOR && t > 0, 'silêncio: fechada, ganho = atenuação (não zero)', { t });
}
{ // voz abre na hora; histerese: oscilar entre vadClose e vadOpen não fecha
  const g = createGate(P); run(g, 100, quiet);
  ok(g.step({ vad: 0.95, lvl: -30 }) === 1, 'voz provável e nível acima do fundo: abre no mesmo quadro');
  const t = run(g, 50, (i) => ({ vad: i % 2 ? P.vadClose + 0.05 : P.vadOpen - 0.05, lvl: -32 }));
  ok(t === 1 && g.state === ST.OPEN, 'histerese: oscilando entre os limites continua aberta');
}
{ // fim da fala: segura holdMs e só então atenua
  const g = createGate({ ...P, voiceCtxMs: 0 }); run(g, 100, quiet); run(g, 30, { vad: 0.99, lvl: -28 });
  const hold = Math.round(P.holdMs / 10); let openFor = 0;
  for (let i = 0; i < hold + 20; i++) if (g.step(quiet) === 1) openFor++;
  ok(Math.abs(openFor - hold) <= 1, `fim da fala: segura ~${P.holdMs} ms antes de fechar`, { openFor, hold });
}
{ // não abre com voz no nível do fundo; abre com nível acima
  const g = createGate(P); run(g, 200, { vad: 0, lvl: -50 });
  ok(Math.abs(g.noiseDb - (-50 + P.floorBiasDb)) < 1, 'ruído de fundo acompanhado (estatística de mínimo + viés)', { noise: g.noiseDb });
  ok(g.step({ vad: 0.95, lvl: -49 }) < 1, 'voz provável mas no nível do fundo: não abre');
  ok(g.step({ vad: 0.95, lvl: -38 }) === 1, 'voz provável acima do fundo + margem: abre');
}
{ // ruído contínuo vira fundo: depois da janela, o mesmo nível não conta como "alto"
  const g = createGate(P); run(g, 100, quiet); run(g, Math.round(P.floorWinMs / 10) + 20, { vad: 0, lvl: -35 });
  ok(g.noiseDb > -40, 'som contínuo vira fundo em ~floorWinMs', { noise: g.noiseDb });
}
{ // zumbido que engana o detector + cliques curtos: não abre; fala de verdade (nível sustentado) abre
  const g = createGate(P); run(g, 200, { vad: 0.95, lvl: -55 }); // tom constante: detector diz "voz" o tempo todo
  let opened = 0; for (let i = 0; i < 300; i++) if (g.step(i % 15 === 0 ? { vad: 0.95, lvl: -35 } : { vad: 0.95, lvl: -55 }) === 1) opened++;
  ok(opened === 0, 'zumbido que engana o detector + cliques de 10 ms: não abre', { opened });
  ok(run(g, 4, { vad: 0.95, lvl: -30 }) === 1, '...mas nível alto sustentado (fala) abre');
}
{ // graves dominando só pedem mais certeza: nunca bloqueiam sozinhos
  const g = createGate(P); run(g, 100, quiet);
  ok(g.step({ vad: P.vadOpen + 0.02, lvl: -30, low: 0.95 }) < 1, 'graves dominando + voz no limite: ainda não abre');
  ok(g.step({ vad: 0.99, lvl: -30, low: 0.95 }) === 1, 'graves dominando + voz muito provável: abre (graves não bloqueiam sozinhos)');
}
{ // começo de palavra sem voz ("s"): subida sustentada com agudos abre provisoriamente; sem voz em onsetMs, fecha
  const g = createGate(P); run(g, 200, quiet);
  const s = { vad: 0.02, lvl: -45, hf: 0.6 };
  g.step(s); ok(g.state === ST.CLOSED, 'consoante: 1 quadro só ainda não abre (clique)');
  ok(g.step(s) === 1 && g.state === ST.ONSET, 'consoante: 2 quadros seguidos com agudos abrem provisoriamente');
  ok(run(g, 3, { vad: 0.97, lvl: -28 }) === 1 && g.state === ST.OPEN, '...e a vogal confirma a voz');
  const h = createGate(P); run(h, 200, quiet); let open = 0;
  for (let i = 0; i < 60; i++) if (h.step(s) === 1) open++;
  ok(open > 0 && open <= P.onsetMs / 10 + 1 && h.state === ST.CLOSED, `sem voz: fecha depois de ${P.onsetMs} ms e não reabre com o mesmo som`, { open });
  run(h, 30, quiet); h.step(s); ok(h.step(s) === 1, 'som caiu e voltou: pode abrir provisoriamente de novo');
  const k = createGate(P); run(k, 200, quiet);
  const soft = run(k, 2, { vad: 0.02, lvl: -45, hf: 0.1 });
  ok(Math.abs(20 * Math.log10(soft) - P.onsetSoftDb) < 0.01, `subida sem agudos (vogal suave, mas também latido): abre só até ${P.onsetSoftDb} dB`, { db: 20 * Math.log10(soft) });
  ok(run(k, 20, { vad: 0.02, lvl: -45, hf: 0.1 }) === FLOOR, '...e sem voz confirmada volta a atenuar');
  const n = createGate({ ...P, onsetSoftDb: null }); run(n, 200, quiet);
  ok(run(n, 2, { vad: 0.02, lvl: -45, hf: 0.1 }) === FLOOR, 'onsetSoftDb: null desliga a abertura parcial');
}
{ // ruído alto por cima da fala: o detector vacila, mas a porta segue aberta pelo nível por voiceCtxMs
  const g = createGate(P); run(g, 100, quiet); run(g, 50, { vad: 0.99, lvl: -25 });
  const t = run(g, Math.round(P.voiceCtxMs / 10) - 5, { vad: 0.02, lvl: -25 });
  ok(t === 1, 'detector vacilando no meio da fala com nível alto: continua aberta');
  const t2 = run(g, Math.round(P.holdMs / 10) + 30, { vad: 0.02, lvl: -25 });
  ok(t2 < 1, '...mas não para sempre: sem voz confirmada por voiceCtxMs + hold, fecha', { t2 });
}
{ // sensibilidade: mais alta = abre mais fácil
  const a = gateParams(0), b = gateParams(100);
  ok(a.vadOpen > b.vadOpen && a.marginDb > b.marginDb && a.holdMs < b.holdMs && a.vadClose > b.vadClose, 'sensibilidade 0→100 abre mais fácil e segura mais');
  ok(gateParams('x').vadOpen === gateParams(50).vadOpen, 'sensibilidade inválida = 50');
}
{ // pistas de frequência
  const lo = createBand('low', 300), hi = createBand('high', 2500), tone = (f) => Float32Array.from({ length: FRAME }, (_, i) => Math.sin(2 * Math.PI * f * i / RATE));
  for (let i = 0; i < 5; i++) { lo(tone(100)); hi(tone(6000)); }
  ok(lo(tone(100)) > 0.8 && lo(tone(3000)) < 0.05, 'graves: 100 Hz quase tudo, 3 kHz quase nada');
  ok(hi(tone(6000)) > 0.8 && hi(tone(200)) < 0.05, 'agudos: 6 kHz quase tudo, 200 Hz quase nada');
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nVADGATE OK'); process.exit(fails ? 1 : 0);
