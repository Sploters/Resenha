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
    floorDb: -35,                // atenuação quando fechada (não é mudo)
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
    ...over,
  };
}

export const ST = { CLOSED: 0, OPEN: 1, HOLD: 2, ONSET: 3 };

export function createGate(p) {
  let state = ST.CLOSED, hold = 0, onsetLeft = 0, armed = true, prevOnset = false, sm = null;
  let since = 1e9, fooled = 0, soft = false, stuck = false, calm = 0, loudRun = 0; // quadros desde a última voz, voz seguida, detector enganado
  const win = new Float32Array(Math.max(1, Math.round(p.floorWinMs / FRAME_MS))).fill(-90); let wi = 0, noise = -90, filled = 0;
  const g = {
    p,
    get state() { return state; }, get noiseDb() { return noise; },
    setParams(np) { p = g.p = np; },
    // f = { vad 0-1, lvl dBFS do quadro, low 0-1 (graves), hf 0-1 (agudos) } → ganho alvo (1 = passa, floor = atenuado)
    step({ vad, lvl, low = 0, hf = 0 }) {
      // ruído de fundo: mínimo do nível suavizado na janela (enquanto a janela não encheu, só o que já se viu)
      // (o mínimo de um ruído que oscila fica abaixo da média dele: suaviza ~60 ms antes e soma um viés, como no método
      // clássico de estatística de mínimo — senão o próprio ruído parece "acima do fundo")
      sm = sm == null ? lvl : sm + (lvl - sm) * 0.15;
      win[wi] = Math.max(-90, sm); wi = (wi + 1) % win.length; filled = Math.min(win.length, filled + 1);
      let m = Infinity; for (let i = 0; i < filled; i++) if (win[i] < m) m = win[i];
      noise = Math.min(-20, m + p.floorBiasDb);
      const need = Math.min(0.97, p.vadOpen + (low > p.lowRatioMax ? p.lowBoost : 0));
      const loud = lvl >= Math.max(p.absMinDb, noise + p.marginDb);
      loudRun = loud ? loudRun + 1 : 0;
      // detector enganado: "voz" por stuckMs com o nível parado no fundo (só zumbido); volta ao normal quando ele relaxa
      if (vad >= p.vadClose && lvl < noise + p.keepDb) { if (++fooled * FRAME_MS >= p.stuckMs) stuck = true; } else fooled = 0;
      if (vad < p.vadClose) { if (++calm >= 5) stuck = false; } else calm = 0;
      const open = vad >= need && loud && (!stuck || loudRun >= p.stuckFrames);
      if (open) since = 0; else since++;
      const inUse = state !== ST.CLOSED && state !== ST.ONSET;
      const keep = inUse && ((vad >= p.vadClose && !stuck && lvl >= Math.max(p.absMinDb, noise + p.keepDb))
        || (since * FRAME_MS <= p.voiceCtxMs && lvl >= Math.max(p.absMinDb, noise + p.ctxDb)));
      // subida sustentada (2 quadros) com agudos: talvez uma consoante antes da vogal
      const rise = p.onsetMs > 0 && lvl >= Math.max(-60, noise + p.onsetDb) && (hf >= p.onsetHf || p.onsetSoftDb != null);
      if (!armed && lvl < noise + p.onsetDb - 6) armed = true; // o som caiu: pode tentar de novo
      if (open || keep) { state = ST.OPEN; hold = Math.round(p.holdMs / FRAME_MS); }
      else if (state === ST.OPEN || state === ST.HOLD) { if (hold > 0) { state = ST.HOLD; hold--; } else state = ST.CLOSED; }
      else if (state === ST.ONSET) { if (--onsetLeft <= 0) state = ST.CLOSED; }
      else if (rise && prevOnset && armed) { state = ST.ONSET; onsetLeft = Math.round(p.onsetMs / FRAME_MS); armed = false; soft = hf < p.onsetHf; }
      if (state === ST.ONSET && hf >= p.onsetHf) soft = false; // a consoante apareceu: abre inteira
      prevOnset = rise;
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
