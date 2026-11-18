// Porta de ruído guiada por voz (lógica pura, sem Web Audio: o worklet public/vadgate-worklet.js a usa e os testes em Node
// também). A cada quadro de 10 ms recebe a probabilidade de voz do RNNoise, o nível do áudio e duas pistas de frequência,
// e decide se o áudio passa inteiro ou bem atenuado.
// - Abre com voz provável E nível acima do ruído de fundo; fica aberta enquanto a voz seguir provável e acima do fundo
//   (histerese: abrir pede mais que manter) e ainda segura um tempo depois (não come o fim das palavras nem as pausas).
// - Começo de palavra sem voz ("s", "f", "ch", respiração): o detector de voz do RNNoise só reconhece a parte com voz
//   (vogais), 50-100 ms depois. Uma subida de nível sustentada e com agudos abre a porta em caráter provisório; se a voz
//   não se confirmar em onsetMs, fecha (e só tenta de novo depois que o som cair).
// - Fechada não é mudo: atenua (floorDb), e a passagem é gradual (attack/release no worklet).
// - Ruído de fundo: o menor nível dos últimos floorWinMs (estatística de mínimo). Som contínuo (ventilador, zumbido,
//   motor parado) vira fundo sozinho; a fala tem pausas entre sílabas, então não "vira ruído".
// - Graves dominando (motor, escapamento) só pedem mais certeza do detector de voz para ABRIR; nunca bloqueiam sozinhos.
export const RATE = 48000, FRAME = 480, FRAME_MS = 10;

// sensibilidade 0-100 (Configurações): mais alta = abre mais fácil (protege voz baixa), mais baixa = corta mais ruído
export function gateParams(sens = 50, over = {}) {
  const s = Math.max(0, Math.min(100, Number.isFinite(+sens) ? +sens : 50)) / 100, lerp = (a, b) => a + (b - a) * s;
  return {
    vadOpen: lerp(0.85, 0.45),   // probabilidade de voz para abrir
    vadClose: lerp(0.45, 0.2),   // ...e para continuar aberta (histerese)
    marginDb: lerp(9, 3),        // nível mínimo acima do ruído de fundo para abrir
    keepDb: 2,                   // ...e para continuar aberta
    absMinDb: -70,               // abaixo disso (dBFS) nunca abre: é silêncio
    holdMs: lerp(250, 400),      // segura aberta depois da última voz provável
    floorDb: lerp(-45, -32),     // atenuação quando fechada (não é mudo)
    attackMs: 5, releaseMs: 150, // abrir rápido; fechar devagar
    lookahead: 0,                // quadros a mais de antecedência (modo RNNoise). 0 basta: o RNNoise já atrasa o áudio
                                 // limpo em relação à probabilidade de voz que devolve (medido: começos de fala iguais com 1)
    floorWinMs: 1500,            // janela da estatística de mínimo do ruído de fundo
    floorBiasDb: 2,              // ...e o quanto a média de um ruído fica acima do mínimo dele
    onsetDb: lerp(18, 10),       // abertura provisória: subida acima do fundo...
    onsetHf: 0.35,               // ...com essa fração de energia acima de ~2,5 kHz...
    onsetMs: 150,                // ...por no máximo esse tempo esperando a voz se confirmar
    onsetSoftDb: lerp(-22, -8),  // subida sem agudos (vogal suave que o detector demora a reconhecer, mas também latido):
                                 // abre só até aqui, provisoriamente (null = não abre). Medido: -12 salva mais começos de
                                 // fala, mas deixa o começo de cada latido passar mais; -15 (sensibilidade 50) é o meio
    voiceCtxMs: 800,             // depois de voz confirmada há menos que isso, continua aberta só pelo nível...
    ctxDb: 6,                    // ...se estiver tanto acima do fundo (o detector vacila com ruído alto por cima da fala)
    stuckMs: 300,                // detector dizendo "voz" com o nível no fundo por tanto tempo = enganado (zumbido, tom)...
    stuckFrames: 3,              // ...e então abrir pede nível alto sustentado por N quadros (um clique de tecla não basta)
    lowRatioMax: 0.8,            // fração de energia abaixo de ~300 Hz (antes da limpeza) a partir da qual parece motor
    lowBoost: 0.1,               // ...e quanto mais certeza de voz se pede para abrir nesse caso
    // Trava na voz de quem está no microfone (filtro Forte/Máxima): a porta aprende o volume típico da SUA fala e a altura
    // (tom) dela, e só abre para voz perto desse volume e desse tom. Voz de fundo (mãe, namorada, TV em outro cômodo) chega
    // bem mais baixa e, muitas vezes, com outro tom (voz feminina ~200 Hz x masculina ~110 Hz); latido tem tom alto e
    // irregular; motor não tem tom de voz. Gritar/rir alto (tom muda, mas o volume é o seu) continua passando.
    lock: true,
    nearDb: lerp(7, 13),         // voz até tanto abaixo do seu volume típico ainda abre (mais longe = voz de fundo)
    keepNearDb: lerp(12, 20),    // ...e até tanto mantém aberta no meio da fala (fim de palavra é mais baixo)
    pitchSt: lerp(5, 8),         // tom a mais de N semitons do seu = outra pessoa (ou latido)...
    pitchLoudDb: 4,              // ...a não ser que esteja tão alto quanto você (até N dB abaixo), bem periódico (grito, risada)...
    shoutSt: 13,                 // ...e a até N semitons do seu tom (pouco mais de uma oitava)
    pitchHarm: 0.55,             // periodicidade mínima para o tom contar
    ownNearDb: lerp(10, 18),     // ...com o SEU tom, pode estar até tanto abaixo (frase dita baixinho)...
    ownHarm: 0.85,               // ...se for bem periódica (voz de perto; a de outro cômodo chega com eco)
    lockOnsetDb: lerp(32, 46),   // começo de palavra até tanto abaixo do seu volume abre provisório...
    lockOnsetMs: 60,             // ...por no máximo esse tempo, esperando chegar perto do seu volume
    learnFrames: 120,            // quadros de fala para aprender o volume (e o dobro para o tom)
    unlockMs: 1000,              // sua voz (no seu tom) bloqueada por ser baixa por tanto tempo: o volume típico desce
                                 // (afastou do microfone, passou a falar mais baixo). Era 3 s + 2 s e 5 dB/s: perto do
                                 // microfone, falar uns 14 dB mais baixo que o começo da conversa cortava 80% da fala
    unlockDb: 0.25,              // ...tanto por quadro (25 dB/s)
    ...over,
  };
}

export const ST = { CLOSED: 0, OPEN: 1, HOLD: 2, ONSET: 3 };
const HIGH_ST = 12 * Math.log2(160 / 55); // 160 Hz em semitons acima de 55 Hz

export function createGate(p) {
  let state = ST.CLOSED, hold = 0, onsetLeft = 0, armed = true, prevOnset = false, sm = null;
  let since = 1e9, fooled = 0, soft = false, stuck = false, calm = 0, loudRun = 0; // quadros desde a última voz, voz seguida, detector enganado
  const win = new Float32Array(Math.max(1, Math.round(p.floorWinMs / FRAME_MS))).fill(-90); let wi = 0, noise = -90, filled = 0;
  // trava na voz: volume típico da fala (~percentil 75 dos quadros de voz), histograma do tom (meio semitom por casa)
  let spk = null, spkN = 0, fScore = 0, segRun = 0, segGap = 0, quietRun = 0, lockArmed = true, blocked = 0, unblocked = 0, sinceNear = 1e9, takeover = 0;
  const hist = new Float32Array(96); let histW = 0, med = null, medAge = 0;
  const pitchMed = () => { if (histW < p.learnFrames * 2 * 0.5) return null; let acc = 0; for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= histW / 2) return i / 2; } return null; };
  const g = {
    p,
    get state() { return state; }, get noiseDb() { return noise; }, get speechDb() { return spkN >= p.learnFrames ? spk : null; }, get pitch() { return med; },
    setParams(np) { p = g.p = np; },
    // f = { vad 0-1, lvl dBFS do quadro, low 0-1 (graves), hf 0-1 (agudos) } → ganho alvo (1 = passa, floor = atenuado)
    step({ vad, lvl, low = 0, hf = 0, st = null, harm = 0 }) {
      // ruído de fundo: mínimo do nível suavizado na janela (enquanto a janela não encheu, só o que já se viu)
      // (o mínimo de um ruído que oscila fica abaixo da média dele: suaviza ~60 ms antes e soma um viés, como no método
      // clássico de estatística de mínimo — senão o próprio ruído parece "acima do fundo")
      sm = sm == null ? lvl : sm + (lvl - sm) * 0.15;
      win[wi] = Math.max(-90, sm); wi = (wi + 1) % win.length; filled = Math.min(win.length, filled + 1);
      let m = Infinity; for (let i = 0; i < filled; i++) if (win[i] < m) m = win[i];
      noise = Math.min(-20, m + p.floorBiasDb);
      const need = Math.min(0.97, p.vadOpen + (low > p.lowRatioMax ? p.lowBoost : 0));
      let loud = lvl >= Math.max(p.absMinDb, noise + p.marginDb);
      // ---- trava na voz de quem está no microfone ----
      const lvOn = p.lock && spkN >= p.learnFrames, ptOn = p.lock && med != null;
      const voiced = st != null && harm >= p.pitchHarm && lvl >= Math.max(p.absMinDb, noise + 6); // tom de som de verdade (não do silêncio)
      // voz aguda (aprendida acima de ~160 Hz): uma oitava acima também é você (começo de frase subindo, erro de oitava).
      // Em voz grave não: uma oitava acima é justamente a voz feminina de fundo.
      const up = ptOn ? st - med : 0;
      const own = voiced && (!ptOn || Math.abs(up) <= p.pitchSt || (med >= HIGH_ST && up >= 10 && up <= 14));
      // grito/risada: tom mais alto, mas no seu volume, limpo e a menos de uma oitava do seu (latido é mais agudo que isso
      // para voz masculina e vem com o tom "sujo")
      const shout = lvl >= spk - p.pitchLoudDb && harm >= 0.6 && Math.abs(st - med) <= p.shoutSt;
      const foreign = ptOn && voiced && !own && !shout;
      // no SEU tom e com som de voz de perto, abre bem mais abaixo do volume aprendido (antes isso só valia para manter
      // aberta: a sua própria fala um pouco mais baixa ficava atenuada, abrindo só em pedaços — voz "robótica")
      const ownOpen = lvOn && ptOn && own && harm >= 0.7 && lvl >= spk - p.ownNearDb;
      const near = !lvOn || lvl >= spk - p.nearDb || ownOpen, keepNear = !lvOn || lvl >= spk - p.keepNearDb;
      // voz de outra pessoa SEGUIDA (vários quadros): um quadro solto com tom errado (erro de oitava na sua própria fala) não conta
      fScore = foreign ? fScore * 0.8 + 1 : own ? fScore * 0.5 : fScore * 0.9;
      const otherTalking = fScore >= 1.7; // ~2 quadros seguidos
      const ownNear = own && ptOn && harm >= p.ownHarm && lvl >= spk - p.ownNearDb; // baixa, mas no SEU tom e limpa (voz de longe tem eco: menos periódica)
      // a voz MAIS ALTA (a de quem está no microfone) falando seguido com outro tom: a porta tinha aprendido a voz de fundo
      // (ex.: a mãe falava antes de você entrar). Esquece o tom e reaprende. Só conta fala contínua de 150 ms ou mais:
      // latido é rajada curta e não derruba o que foi aprendido.
      if (vad >= p.vadClose && (!lvOn || lvl >= spk - p.keepNearDb)) { segRun++; segGap = 0; } else if (++segGap > 3) segRun = 0;
      if (ptOn && segRun >= 15 && voiced && lvl >= spk - 3) {
        if (!own) { if (++takeover >= 25) { hist.fill(0); histW = 0; med = null; takeover = 0; } } else takeover = Math.max(0, takeover - 2);
      }
      const lockOk = !p.lock || (near && fScore < 1.5); // pode ABRIR (um quadro solto com tom errado, comum no começo da palavra, não impede)
      const lockKeep = !p.lock || ((keepNear || ownNear) && (!otherTalking || (lvl >= spk - p.pitchLoudDb && !foreign))); // pode MANTER aberta
      if (near && vad >= need && loud) sinceNear = 0; else sinceNear++;
      // sua voz ficou bem mais baixa de vez (outro microfone, afastou): depois de unlockMs, o volume típico desce aos poucos
      // (a contagem só zera depois de 1 s sem bloqueio: as sílabas que ainda passam no meio não recomeçam a espera)
      if (lvOn && !near && own && vad >= need && loud) { unblocked = 0; if (++blocked * FRAME_MS > p.unlockMs) spk -= p.unlockDb; } else if (++unblocked > 100) blocked = 0;
      // começo de palavra: o volume ainda está subindo (os primeiros 30-60 ms ficam bem abaixo do seu volume típico).
      // Abre provisório, como a consoante; se não chegar perto do seu volume em lockOnsetMs, fecha (voz de fundo não chega)
      // depois de uma abertura provisória que não se confirmou, só tenta de novo após silêncio de verdade (150 ms): senão a
      // voz de fundo, que sobe e desce, abriria 80 ms a cada sílaba
      if (lvl < noise + 6) { if (++quietRun >= 15) lockArmed = true; } else quietRun = 0;
      const provOk = lvOn && lockArmed && fScore < 1.5 && lvl >= spk - p.lockOnsetDb;
      const lockRise = p.lock && !lockOk && loud && vad >= need && provOk;
      loud = loud && lockOk;
      loudRun = loud ? loudRun + 1 : 0;
      // detector enganado: "voz" por stuckMs com o nível parado no fundo (só zumbido); volta ao normal quando ele relaxa
      if (vad >= p.vadClose && lvl < noise + p.keepDb) { if (++fooled * FRAME_MS >= p.stuckMs) stuck = true; } else fooled = 0;
      if (vad < p.vadClose) { if (++calm >= 5) stuck = false; } else calm = 0;
      const open = vad >= need && loud && (!stuck || loudRun >= p.stuckFrames);
      if (open) since = 0; else since++;
      const inUse = state !== ST.CLOSED && state !== ST.ONSET;
      const keep = inUse && lockKeep && ((vad >= p.vadClose && !stuck && lvl >= Math.max(p.absMinDb, noise + p.keepDb))
        || (since * FRAME_MS <= p.voiceCtxMs && lvl >= Math.max(p.absMinDb, noise + p.ctxDb)));
      // subida sustentada (2 quadros) com agudos: talvez uma consoante antes da vogal (longe demais = voz de fundo: não)
      const rise = p.onsetMs > 0 && (lockOk || provOk) && lvl >= Math.max(-60, noise + p.onsetDb) && (hf >= p.onsetHf || p.onsetSoftDb != null);
      if (!armed && lvl < noise + p.onsetDb - 6) armed = true; // o som caiu: pode tentar de novo
      // outra pessoa começou a falar logo depois de você: não segura a porta aberta para ela
      if (otherTalking && state === ST.HOLD) hold = 0;
      if (p.lock && fScore >= 1.5 && state === ST.ONSET) state = ST.CLOSED; // começo provisório com o tom de outra pessoa: fecha já
      if (open || keep) { state = ST.OPEN; hold = Math.round(p.holdMs / FRAME_MS); if (open) lockArmed = true; }
      else if (state === ST.OPEN || state === ST.HOLD) { if (hold > 0) { state = ST.HOLD; hold--; } else state = ST.CLOSED; }
      else if (state === ST.ONSET) { if (--onsetLeft <= 0) state = ST.CLOSED; }
      else if (lockRise && state === ST.CLOSED) { state = ST.ONSET; onsetLeft = Math.round(p.lockOnsetMs / FRAME_MS); soft = false; lockArmed = false; }
      else if (rise && prevOnset && armed) { state = ST.ONSET; onsetLeft = Math.round(p.onsetMs / FRAME_MS); armed = false; if (p.lock && !lockOk) lockArmed = false; soft = hf < p.onsetHf; }
      if (state === ST.ONSET && hf >= p.onsetHf) soft = false; // a consoante apareceu: abre inteira
      prevOnset = rise;
      // aprende com a fala que passou pela porta (aberta pela voz, não pelo começo provisório)
      if (p.lock && open && vad >= 0.8 && lvl >= noise + 10) {
        // só os quadros perto do topo ensinam o volume (depois de aprendido): a voz de fundo que passou não puxa para baixo
        // a sua própria fala (seu tom, som de perto) também ensina para baixo: o volume aprendido acompanha você quando
        // passa a falar mais baixo, em vez de ficar preso no trecho mais alto da conversa
        if (spk == null) spk = lvl; else if (!lvOn || lvl >= spk - 6 || ownOpen) spk += (lvl - spk) * (lvl > spk ? 0.05 : 0.0167);
        spkN++;
        // o tom só aprende com fala contínua (latido é rajada curta: não ensina)
        if (voiced && harm >= 0.7 && segRun >= 20 && (!lvOn || lvl >= spk - 8)) {
          const b = Math.max(0, Math.min(hist.length - 1, Math.round(st * 2)));
          if (histW > 600) { const k = 600 / histW; for (let i = 0; i < hist.length; i++) hist[i] *= k; histW = 600; } // memória de ~6 s de vogais
          hist[b]++; histW++;
          if (++medAge >= 10) { medAge = 0; med = pitchMed(); }
        }
      }
      return state === ST.CLOSED ? 10 ** (p.floorDb / 20) : state === ST.ONSET && soft ? 10 ** (p.onsetSoftDb / 20) : 1;
    },
  };
  return g;
}

// biquad de 2ª ordem (RBJ) que devolve a fração da energia do quadro que passa pelo filtro — pistas de frequência
export function createBand(type, fc, rate = RATE) {
  const w = 2 * Math.PI * fc / rate, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const lp = type === 'low', b0 = (lp ? (1 - c) / 2 : (1 + c) / 2) / a0, b1 = (lp ? 1 - c : -(1 + c)) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (buf) => {
    let band = 0, all = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; band += y * y; all += x * x;
    }
    if (Math.abs(y1) < 1e-20 && Math.abs(y2) < 1e-20) { y1 = 0; y2 = 0; } // evita números desnormalizados no silêncio
    return all > 1e-12 ? Math.min(1, band / all) : 0;
  };
}

export const levelDb = (buf) => { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return 10 * Math.log10(s / buf.length + 1e-12); };

// Altura da voz (frequência fundamental), quadro a quadro: passa-baixa em ~1 kHz, reduz para 8 kHz e procura o atraso de
// maior autocorrelação normalizada numa janela de 40 ms (60-450 Hz). Devolve { st, harm }: st = semitons acima de 55 Hz
// (null sem período claro) e harm = 0-1, o quanto o som é periódico (vogal limpa ~0,8-0,95; latido, motor e chiado
// ficam mais baixos). Custa ~25 mil multiplicações por quadro de 10 ms.
export const PITCH_MIN = 60, PITCH_MAX = 450;
export function createPitch(rate = RATE) {
  const dec = Math.max(1, Math.round(rate / 8000)), fs = rate / dec, W = Math.round(fs * 0.04);
  const lmin = Math.floor(fs / PITCH_MAX), lmax = Math.ceil(fs / PITCH_MIN), N = W - lmax;
  // passa-baixa de 2ª ordem (RBJ) em 900 Hz, duas vezes (4ª ordem) antes de reduzir a taxa
  const w = 2 * Math.PI * 900 / rate, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  const st = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const lp = (x) => { for (const s of st) { const y = b0 * x + b1 * s[0] + b0 * s[1] - a1 * s[2] - a2 * s[3]; s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y; x = y; } return x; };
  const buf = new Float32Array(W); let phase = 0;
  const r = new Float32Array(lmax + 2);
  return (frame) => {
    for (let i = 0; i < frame.length; i++) { const y = lp(frame[i]); if (++phase >= dec) { phase = 0; buf.copyWithin(0, 1); buf[W - 1] = y; } }
    for (const s of st) for (let k = 0; k < 4; k++) if (Math.abs(s[k]) < 1e-20) s[k] = 0;
    let e0 = 0; for (let n = 0; n < N; n++) e0 += buf[n] * buf[n];
    if (e0 < 1e-10) return { st: null, harm: 0 };
    let el = 0; for (let n = lmin; n < lmin + N; n++) el += buf[n] * buf[n];
    let best = 0;
    for (let L = lmin; L <= lmax; L++) {
      let s = 0; for (let n = 0; n < N; n++) s += buf[n] * buf[n + L];
      r[L] = s > 0 ? s / Math.sqrt(e0 * el + 1e-20) : 0; if (r[L] > best) best = r[L];
      el += buf[L + N] * buf[L + N] - buf[L] * buf[L]; if (el < 0) el = 0;
    }
    if (best < 0.3) return { st: null, harm: Math.max(0, best) };
    // o menor atraso com pico perto do melhor (evita cair uma oitava abaixo)
    let L = lmin;
    for (let k = lmin + 1; k < lmax; k++) if (r[k] >= 0.88 * best && r[k] >= r[k - 1] && r[k] >= r[k + 1]) { L = k; break; }
    if (L === lmin) for (let k = lmin; k <= lmax; k++) if (r[k] === best) { L = k; break; }
    if (L <= lmin || L >= lmax) return { st: null, harm: best }; // pico na borda da faixa: não é voz (motor, chiado agudo)
    // interpolação parabólica do pico
    const y0 = r[L - 1] ?? r[L], y2 = r[L + 1] ?? r[L], den = y0 - 2 * r[L] + y2, d = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
    return { st: 12 * Math.log2(fs / (L + d) / 55), harm: r[L] };
  };
}
