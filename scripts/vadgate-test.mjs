// Lógica da porta guiada por voz (public/vadgate-core.js), quadro a quadro, sem navegador: abre com voz, histerese, segura
// o fim das palavras, atenua em vez de emudecer, acompanha o ruído de fundo, não se deixa enganar por zumbido + cliques,
// abertura provisória do começo de palavra sem voz, graves nunca bloqueiam sozinhos, contexto de fala com ruído alto.
// Uso: node scripts/vadgate-test.mjs
import { createGate, gateParams, createBand, createPitch, ST, FRAME, RATE } from '../public/vadgate-core.js';
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
{ // tom da voz: frequência fundamental e periodicidade
  const pt = createPitch(), st2hz = (st) => 55 * 2 ** (st / 12);
  for (const f of [90, 120, 210, 300]) {
    let o; for (let k = 0; k < 8; k++) o = pt(Float32Array.from({ length: FRAME }, (_, i) => { const t = (k * FRAME + i) / RATE; return 0.3 * Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(4 * Math.PI * f * t); }));
    ok(o.st != null && Math.abs(st2hz(o.st) - f) < f * 0.02 && o.harm > 0.9, `tom: ${f} Hz reconhecido`, { hz: o.st != null && Math.round(st2hz(o.st)), harm: +o.harm.toFixed(2) });
  }
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  let o; for (let k = 0; k < 8; k++) o = pt(Float32Array.from({ length: FRAME }, () => 0.2 * rnd()));
  ok(o.st == null || o.harm < 0.55, 'chiado: sem tom de voz', o);
}
{ // trava na voz: aprende o volume e o tom de quem fala no microfone e abafa vozes de fundo
  const st = (hz) => 12 * Math.log2(hz / 55), me = (lvl = -24, hz = 110) => ({ vad: 0.99, lvl, st: st(hz), harm: 0.95 });
  const L = gateParams(50), teach = (g) => { run(g, 100, quiet); for (let i = 0; i < 6; i++) { run(g, 60, (k) => me(-24 + (k % 3), 108 + (k % 5))); run(g, 40, quiet); } };
  const g = createGate(L); teach(g);
  ok(Math.abs(g.speechDb - -23) < 2 && Math.abs(55 * 2 ** (g.pitch / 12) - 110) < 8, 'aprende o volume e o tom da sua voz', { spk: g.speechDb, hz: g.pitch && Math.round(55 * 2 ** (g.pitch / 12)) });
  run(g, 60, quiet);
  let open = 0; for (let i = 0; i < 100; i++) if (g.step(me(-38, 210)) === 1) open++;
  ok(open <= 2, 'voz feminina mais baixa (outro cômodo): não abre (no máximo 1-2 quadros até reconhecer o tom)', { open });
  run(g, 60, quiet); open = 0; for (let i = 0; i < 100; i++) if (g.step(me(-30, 210)) === 1) open++;
  ok(open <= 2, 'voz feminina 6 dB abaixo da sua (mesmo cômodo): não abre (no máximo 1-2 quadros)', { open });
  run(g, 60, quiet); open = 0; for (let i = 0; i < 100; i++) if (g.step(me(-42, 110)) === 1) open++;
  ok(open <= L.lockOnsetMs / 10 + 1, `voz no seu tom, mas bem longe: só o começo provisório (${L.lockOnsetMs} ms) e fecha`, { open, depois: g.state });
  // no seu tom e falando sem parar: depois de ~1 s a porta entende que é você que se afastou/baixou a voz e reabre (antes
  // levava 5 s, e a sua própria fala mais baixa ficava cortada em pedaços). Voz de fundo no mesmo tom é o limite conhecido
  let back = 0; for (let i = 0; i < 150; i++) if (g.step(me(-42, 110)) === 1) back++;
  ok(back > 50, '...e se continuar no seu tom, em ~1 s volta a passar (você se afastou do microfone)', { back });
  run(g, 60, quiet); ok(run(g, 3, me(-26, 112)) === 1, 'sua voz abre na hora');
  run(g, 60, quiet); ok(run(g, 3, me(-30, 105)) === 1, 'sua voz mais baixinha (no seu tom): abre');
  run(g, 60, quiet); ok(run(g, 3, me(-22, 190)) === 1, 'grito/risada (tom mais alto, no seu volume, limpo): abre');
  run(g, 60, quiet); open = 0; for (let i = 0; i < 30; i++) if (g.step({ vad: 0.97, lvl: -20, st: st(265), harm: 0.75 }) === 1) open++;
  ok(open <= 3, 'latido alto (tom acima de uma oitava da sua voz, irregular): não abre', { open });
  // você falando e alguém começa a falar logo em seguida: a porta não segura aberta para ela
  run(g, 60, quiet); run(g, 50, me(-24, 110)); let tail = 0; for (let i = 0; i < 60; i++) if (g.step(me(-34, 215)) === 1) tail++;
  ok(tail <= 8, 'voz de fundo logo depois da sua: fecha em poucos quadros', { tail });
  // aprendeu a pessoa errada (a voz de fundo falou primeiro): sua voz, mais alta, assume
  const w = createGate(L); run(w, 100, quiet); for (let i = 0; i < 5; i++) { run(w, 60, () => me(-36, 215)); run(w, 30, quiet); }
  for (let i = 0; i < 6; i++) { run(w, 80, (k) => me(-24 + (k % 3), 110)); run(w, 30, quiet); }
  ok(Math.abs(55 * 2 ** (w.pitch / 12) - 110) < 10 && w.speechDb > -27, 'aprendeu a voz de fundo primeiro: a sua (mais alta) assume', { spk: w.speechDb, hz: w.pitch && Math.round(55 * 2 ** (w.pitch / 12)) });
  open = 0; for (let i = 0; i < 100; i++) if (w.step(me(-36, 215)) === 1) open++;
  ok(open <= 5, '...e a voz de fundo volta a ser abafada', { open });
  // lock: false volta ao comportamento antigo
  const n = createGate({ ...L, lock: false }); teach(n); run(n, 60, quiet);
  ok(run(n, 3, me(-38, 210)) === 1, 'trava desligada: abre para qualquer voz acima do fundo');
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
