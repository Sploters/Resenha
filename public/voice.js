// Voz/vídeo/tela via WebRTC: pelo SFU do servidor (mediasoup) quando disponível; senão em malha (P2P).
// Sinalização pelo gateway.
// Microfone passa por uma cadeia WebAudio: high-pass → denoise (RNNoise/GTCRN) → noise gate → ganho.

import { playSound } from './sounds.js';
import { createFx, loadFx, FX_IDS } from './voicefx.js';
import { track, stopTimer, cancelTimer, timing } from './ux.js';
import { CallQuality, SAMPLE_MS, recordCallQuality } from './callqual.js';
import { attachTap } from './clipbuf.js';
import { newMicWatch, micWatchStep, newTalkMuted, talkMutedStep } from './micwatch.js';

const NS = '/vendor/ns';
const loadedModules = new WeakMap();
let nsLib;
const wasmCache = {}; // modo de ruído -> Promise<ArrayBuffer> do modelo
// pré-carrega, com o app ocioso, o que a 1ª entrada na voz precisaria baixar: a biblioteca do SFU e, se a pessoa usa a IA
// de ruído, a biblioteca e o modelo dela (antes tudo isso entrava no tempo de "entrar na voz")
export function prewarmVoice(prefs) {
  const go = () => {
    import('/vendor/msc/mediasoup-client.js').catch(() => { });
    const mode = prefs?.noiseMode;
    if (mode === 'rnnoise' || mode === 'gtcrn') import(`${NS}/index.js`).then((lib) => {
      nsLib ||= lib;
      loadWasm(mode).catch(() => { });
      if (mode === 'gtcrn' && prefs.vadGate !== false) loadWasm('rnnoise').catch(() => { }); // detector de voz da porta
    }).catch(() => { });
  };
  (window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(go, { timeout: 8000 });
}

export const NOISE_MODES = {
  off: 'Nenhuma',
  standard: 'Padrão (navegador)',
  rnnoise: 'Alta — RNNoise (IA)',
  gtcrn: 'Máxima — GTCRN (IA, mais pesado)',
};
export const SCREEN_PRESETS = {
  res: { 720: '720p', 1080: '1080p', 1440: '1440p', source: 'Fonte (original)' },
  fps: { 15: '15 fps', 30: '30 fps', 60: '60 fps', 120: '120 fps' },
};
// transmissão pelo programa nativo do app desktop (placa de vídeo) a partir deste fps; e quanto esperar o servidor confirmar
// que os pacotes dele estão chegando antes de voltar ao Chromium
export const NATIVE_MIN_FPS = 60, NATIVE_LIVE_MS = 8000;
// chegada dos primeiros pacotes da transmissão nativa no servidor (startNative): o programa já mandando há NATIVE_SENT_MS
// sem nada chegar = UDP bloqueado; o programa vivo mas sem mandar nada (captura/codificador ainda abrindo, processador
// apertado) espera até NATIVE_LIVE_MAX_MS. Bloqueado: tenta outra porta uma vez (NATIVE_UDP_TRIES) antes do Chromium;
// depois não insiste por NATIVE_NOUDP_MS (só NATIVE_NOUDP_SHORT_MS se o nativo já chegou ao servidor nesta sessão)
export const NATIVE_SENT_MS = 6000, NATIVE_LIVE_MAX_MS = 25000, NATIVE_UDP_TRIES = 1, NATIVE_NOUDP_MS = 10 * 60e3, NATIVE_NOUDP_SHORT_MS = 2 * 60e3;
// reinício automático do programa nativo (nativeRestart): até 3 tentativas em 30 s, 1 s depois da falha
// "quem fala" pelo nível dos pacotes (watch): limiar, folga e idade máxima do último pacote
const SSRC_LOUD = .015, SSRC_HOLD_MS = 400, SSRC_FRESH_MS = 250;
export const FSE_TICK = 3000, FSE_CONFIRM_TICKS = 2, FSE_FROZEN_TICKS = 4; // aviso de tela cheia exclusiva: a cada 3 s; 2 leituras com as duas evidências; 12 s sem quadro = "congelada"
export const GOV_TICK = 2000, GOV_BAD = 3, GOV_VIEWERS_MS = 10e3; // controle da transmissão (govTick): leitura a cada 2 s, 6 s ruins para descer
export const NATIVE_RESTARTS = 3, NATIVE_RESTART_WIN = 30e3, NATIVE_RESTART_DELAY = 1000;
// "nenhum metodo de captura nativa": o programa já tentou WGC e DXGI (e recriou cada um) e nenhum serviu: reiniciar não ajuda
const NATIVE_FATAL = /janela transmitida foi fechada|nenhum codificador|não encontrado|desktop sem suporte|nenhum metodo de captura nativa/i;
// método de captura (Configurações > Transmissão): 'auto' escolhe entre WGC e DXGI pelo que a captura entrega de verdade;
// 'wgc'/'dxgi' forçam um; 'chromium' nunca usa o programa nativo; 'classic' = o caminho da versão anterior (só WGC).
export const CAPTURE_METHODS = { auto: 'Automático', wgc: 'Forçar WGC', dxgi: 'Forçar DXGI', chromium: 'Forçar Chromium', classic: 'Clássico (versão anterior)' };
export const captureMode = (prefs) => (CAPTURE_METHODS[prefs?.captureMethod] ? prefs.captureMethod : 'auto');
const CAP_HIST_MAX = 60;
export const VOICE_BITRATES = [['auto', 'Automático'], [32, '32 kbps'], [64, '64 kbps'], [128, '128 kbps'], [256, '256 kbps'], [384, '384 kbps']];
// voz é mono: 48-64 kbps já soam perfeitos. Acima disso só faz sentido para música (e pesa no upload do servidor:
// cada voz é repassada para todos os outros da sala)
export const AUTO_MAX = 64, AUTO_STEPS = [32, 48, 64];
const OPUS_MAX = 384; // teto anunciado no SDP; a taxa real é limitada por encodings[].maxBitrate
// pede Opus em estéreo e até 384 kbps ao outro lado (mono do Opus para em ~256 kbps)
const opusHi = (sdp) => {
  const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1]; if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} (.*)`), (_, f) => `a=fmtp:${pt} ${f.replace(/;?(maxaveragebitrate|stereo|sprop-stereo)=\d+/g, '')};stereo=1;sprop-stereo=1;maxaveragebitrate=${OPUS_MAX * 1000}`);
};
// fps pedido à captura de tela do Chromium. O capturador do Windows entrega quadros numa grade irregular de ~16 ms (até
// ~48 fps, docs/historico/PASSO0-DIAGNOSTICO-FPS.md). Com "max" igual ao pedido, o Chromium descartava todo quadro que chegava um
// nada antes do intervalo (16,1 ms < 16,7 ms; 32,2 ms < 33,3 ms): pedindo 60 saíam ~32 fps e pedindo 30, ~21 (medido).
// Com 25% de folga no teto passam os quadros da grade, e o limite exato fica com o codificador (maxFramerate, sfuTuneScreen).
// motivo (código curto) do "não" do app desktop para o programa nativo; o app novo manda `code`, os antigos só o texto
// jogo que cobre o monitor dele: tela cheia, ou "janela sem bordas" com alguns pixels a menos (nearFull, app novo). Nesse
// caso a tela do monitor é a mesma imagem que a janela, e a captura de JANELA do Chromium falha com jogos: no Windows 10
// borda amarela, mouse atrasado e imagem congelada; com "janela sem bordas" mostra a janela de BAIXO do jogo (relato com
// Valorant). O monitor (DXGI no Windows 10, WGC de monitor no 11) pega o jogo.
const gameCoversMon = (si) => !!si && si.type === 'window' && (!!si.fullscreen || !!(si.game && si.nearFull));
const nativeWhy = (c) => c.code || (/Só no app/.test(c.reason || '') ? 'web' : /Windows 10.*borda|borda amarela/.test(c.reason || '') ? 'win10'
  : /não encontrado/.test(c.reason || '') ? 'noexe' : /captura de tela necessária/.test(c.reason || '') ? 'nocap' : /codificador/.test(c.reason || '') ? 'nohw' : 'other');
export const capFps = (fps) => ({ ideal: +fps, max: Math.ceil(+fps * 1.25) });
// game: jogo com "Vídeo mais fluido" (a tela inteira muda o tempo todo). Com a taxa de tela comum (1080p60 = 7,2 Mbps)
// um jogo de corrida saía muito comprimido (Need for Speed, codificador AMD): +50% a 60 FPS ou mais, +25% abaixo.
// Quem assiste sem banda para isso continua na camada leve; o ajuste automático baixa se a rede não aguentar.
const bitrateFor = (res, fps, mbps, game = false) => {
  if (+mbps > 0) return Math.round(Math.min(+mbps, 64) * 1e6); // taxa escolhida (até 64 Mbps)
  const base = { 720: 2.2, 1080: 4.5, 1440: 8, source: 9 }[res] || 4.5;
  return Math.round(base * (fps >= 120 ? 2.4 : fps >= 60 ? 1.6 : fps <= 15 ? .6 : 1) * (game ? (fps >= 60 ? 1.5 : 1.25) : 1) * 1e6);
};
export const isGameShare = (o) => !!o && o.hint !== 'detail' && !!(o.srcInfo?.game || o.srcInfo?.fullscreen);

// guarda a promessa (não só "carregado"): o aquecimento (warmMic) e a montagem pedem o mesmo módulo ao mesmo tempo, e
// registrar o mesmo processador duas vezes no worklet dá erro
function ensureModule(ctx, name, url = `${NS}/${name}/workletProcessor.js`) {
  let m = loadedModules.get(ctx); if (!m) loadedModules.set(ctx, m = new Map());
  if (!m.has(name)) m.set(name, ctx.audioWorklet.addModule(url).catch((e) => { m.delete(name); throw e; }));
  return m.get(name);
}
const loadNs = () => (nsLib ? Promise.resolve(nsLib) : import(`${NS}/index.js`).then((m) => (nsLib = m)));
// o modelo (.wasm) é baixado uma vez por abertura do app; cada nó recebe uma cópia (o nó pode transferir o buffer)
const loadWasm = (m) => (wasmCache[m] ||= (m === 'rnnoise' ? nsLib.loadRnnoise({ url: `${NS}/rnnoise.wasm`, simdUrl: `${NS}/rnnoise_simd.wasm` }) : nsLib.loadGtcrn({ url: `${NS}/gtcrn.wasm` }))
  .catch((e) => { delete wasmCache[m]; throw e; })).then((b) => b.slice(0));
// filtro de ruído constante (fanfilter-worklet.js): com o RNNoise (Forte), ligado por padrão; prefs.fanFilter === false
// desliga. prefs.fanStrength (0-100, padrão 50) escolhe quanto tira. Medido (scripts/noise-bench.mjs): o RNNoise sozinho
// tirava só ~7 dB de ventilador; com o filtro, o ventilador audível nas pausas cai de 60% para 16% dos quadros. O GTCRN
// (Máxima) já tira ~40 dB de ruído constante: lá o filtro não ajuda e não entra.
export const fanFilterOn = (prefs) => prefs.noiseMode === 'rnnoise' && prefs.fanFilter !== false;
const fanFilterNode = (ctx, prefs) => new AudioWorkletNode(ctx, 'lc-fanfilter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { strength: prefs.fanStrength ?? 50, params: prefs.fanParams } });
// porta guiada por voz (vadgate-worklet.js): ligada por padrão com RNNoise/GTCRN; prefs.vadGate === false desliga
export const vadGateOn = (prefs) => (prefs.noiseMode === 'rnnoise' || prefs.noiseMode === 'gtcrn') && prefs.vadGate !== false;
const vadGateNode = (ctx, opts) => new AudioWorkletNode(ctx, 'lc-vadgate', { numberOfInputs: opts.denoise ? 1 : 2, numberOfOutputs: 1, outputChannelCount: [1],
  channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: opts });

// Cadeia de processamento do microfone, de src até o nó devolvido em `last` (createMic liga o resto). Exportada para o
// banco de testes de ruído (scripts/noise-bench.mjs) medir exatamente o que o app usa.
export async function buildChain(ctx, src, prefs, out = { nodes: [], error: null, processed: false }) {
  const mode = prefs.noiseMode || 'standard', nodes = out.nodes;
  let last = src, first = null;
  // saídas do filtro de ventilador (createMic setIdle desliga e religa no mudo)
  const chain = (n) => { last.connect(n); nodes.push(n); if (last === src) first = n; if (last === out.fanFilter) out.fanOuts.push([n, 0, 0]); last = n; };
  try {
    if (mode === 'rnnoise' || mode === 'gtcrn') {
      await loadNs();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; chain(hp);
      // ruído constante (ventilador, ar-condicionado, ventoinha do PC): tirado antes da IA (public/fanfilter-core.js).
      // Ligado por padrão; prefs.fanFilter === false desliga. Se não carregar, segue sem ele.
      let pre = hp;
      if (fanFilterOn(prefs)) {
        try { await ensureModule(ctx, 'fanfilter', '/fanfilter-worklet.js'); const ff = fanFilterNode(ctx, prefs); out.fanFilter = ff; out.fanOuts = []; chain(ff); pre = ff; }
        catch (e) { console.warn('fanfilter', e); }
      }
      // a porta é um extra: se ela não carregar, segue a redução de ruído de sempre (sem a proteção)
      let smart = vadGateOn(prefs);
      if (smart) await ensureModule(ctx, 'vadgate', '/vadgate-worklet.js').catch((e) => { console.warn('vadgate', e); smart = false; });
      const vg = (denoise, wasmBinary) => { const n = vadGateNode(ctx, { denoise, wasmBinary, sens: prefs.vadSens ?? 50, lock: prefs.voiceLock === true, // "Só a minha voz": desligado por padrão (ligado, cortava a própria voz de quem fala perto do microfone)
      params: prefs.vadParams, debug: !!prefs.vadDebug }); out.vadGate = n; return n; };
      if (mode === 'rnnoise') {
        // com a porta: o próprio nó dela faz o RNNoise (e reaproveita a probabilidade de voz); sem: o nó RNNoise de sempre
        if (smart) chain(vg(true, await loadWasm('rnnoise')));
        else { await ensureModule(ctx, mode); chain(new nsLib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: await loadWasm('rnnoise') })); }
      } else {
        await ensureModule(ctx, mode);
        const [g, r] = await Promise.all([loadWasm('gtcrn'), smart ? loadWasm('rnnoise').catch(() => null) : null]);
        chain(new nsLib.GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary: g }));
        // RNNoise separado, só como detector de voz, analisando o microfone ANTES do GTCRN (entrada 1): a saída do GTCRN
        // confunde o detector, e o atraso do GTCRN vira antecedência para a porta
        if (smart && r) { chain(vg(false, r)); pre.connect(last, 0, 1); if (pre === out.fanFilter) out.fanOuts.push([last, 0, 1]); }
      }
      out.processed = true;
    }
    if (prefs.gate) {
      await loadNs();
      await ensureModule(ctx, 'noiseGate');
      chain(new nsLib.NoiseGateWorkletNode(ctx, { openThreshold: prefs.gateDb ?? -45, closeThreshold: (prefs.gateDb ?? -45) - 6, holdMs: 250, maxChannels: 1 }));
      out.processed = true;
    }
  } catch (e) { // se a IA falhar, segue sem ela (usa o que já está na cadeia)
    console.warn('denoise', e); out.error = `Redução de ruído indisponível: ${e.message || e}`;
  }
  // sensibilidade / liga-desliga da porta por voz ao vivo, sem refazer o microfone
  out.setVadGate = (o) => { try { out.vadGate?.port.postMessage(o); } catch { } };
  out.setFanFilter = (o) => { try { out.fanFilter?.port.postMessage(o); } catch { } };
  return Object.assign(out, { first, last });
}

// Aquecimento do microfone: baixa e registra tudo o que a cadeia (buildChain) vai pedir — biblioteca de ruído, módulos do
// worklet e o modelo .wasm — ao mesmo tempo, e ao mesmo tempo que o getUserMedia abre o microfone. Antes era um depois
// do outro (abrir o microfone → biblioteca → filtro de ventilador → porta por voz → modelo), cada um uma ida ao servidor:
// no app desktop o "preparar o microfone" passava de 1 s em 1/3 das entradas. ctx null: só os downloads (sem contexto
// de áudio ainda). Falha aqui não importa: a montagem tenta de novo e trata o erro.
export function warmMic(prefs, ctx) {
  const mode = prefs.noiseMode || 'standard', ai = mode === 'rnnoise' || mode === 'gtcrn', smart = vadGateOn(prefs);
  if (!ai && !prefs.gate && prefs.agc !== true) return Promise.resolve();
  const job = [], soft = (p) => job.push(Promise.resolve(p).catch(() => { }));
  if (ai || prefs.gate) soft(loadNs().then(() => Promise.all([
    mode === 'rnnoise' || (mode === 'gtcrn' && smart) ? loadWasm('rnnoise') : null,
    mode === 'gtcrn' ? loadWasm('gtcrn') : null])));
  if (ctx) {
    if (fanFilterOn(prefs)) soft(ensureModule(ctx, 'fanfilter', '/fanfilter-worklet.js'));
    if (ai && smart) soft(ensureModule(ctx, 'vadgate', '/vadgate-worklet.js'));
    if (mode === 'gtcrn' || (mode === 'rnnoise' && !smart)) soft(ensureModule(ctx, mode));
    if (prefs.gate) soft(ensureModule(ctx, 'noiseGate'));
    if (prefs.agc === true) soft(ensureModule(ctx, 'agc', '/agc-worklet.js'));
  }
  return Promise.all(job);
}

// Cancelamento de eco: por padrão só o som da CHAMADA (vozes e transmissões, que chegam pelo WebRTC) é tirado do
// microfone ('remote-only'). Com true, o navegador usa como referência todo som que a página toca — o vídeo do Watch
// Together, soundboard, clipes —, e com um vídeo tocando sem parar o filtro passava a cortar a voz de quem fala por
// cima dele, mesmo sem eco nenhum (fone). "Cancelar também o som do app" (prefs.echoAll) volta ao modo antigo.
// Navegador que não conhece 'remote-only' lê o texto como true (o cancelamento de sempre).
export const echoConstraint = (prefs) => (prefs.echo === false ? false : prefs.echoAll === true ? true : 'remote-only');
// Cria o microfone processado. Retorna { raw, stream, analyser, dispose, setLoopback }
// opts.resolve: reencontra o microfone salvo pelo nome (id mudou). Só é chamado se o id salvo não abriu: antes listava os
// dispositivos ANTES de toda entrada (enumerateDevices, lento no Windows com muitos aparelhos)
export async function createMic(prefs, ctx, opts = {}) {
  const mode = prefs.noiseMode || 'standard';
  const warm = warmMic(prefs, ctx); // em paralelo com abrir o microfone
  const want = (id) => ({ audio: { deviceId: id ? { exact: id } : undefined,
    echoCancellation: echoConstraint(prefs), noiseSuppression: mode === 'standard',
    // ganho automático do navegador SEMPRE desligado: ele baixa o volume do microfone no sistema (Windows) e quase nunca
    // sobe de volta. O "Ganho automático" das Configurações agora é o do próprio app (agc-worklet.js, abaixo), só digital
    autoGainControl: false, channelCount: 1, sampleRate: 48000 }, video: false });
  let raw; const tOpen = performance.now();
  try { raw = await navigator.mediaDevices.getUserMedia(want(prefs.inputId)); } catch (e) {
    // microfone escolhido não encontrado (desconectado, id novo): usa o padrão agora, SEM apagar a escolha — volta quando ele voltar
    if (!prefs.inputId || !/Overconstrained|NotFound/.test(e?.name || '')) throw e;
    const before = prefs.inputId;
    if (await opts.resolve?.().catch(() => false) && prefs.inputId && prefs.inputId !== before) raw = await navigator.mediaDevices.getUserMedia(want(prefs.inputId)).catch(() => null);
    raw ||= await navigator.mediaDevices.getUserMedia(want(''));
  }
  const openMs = performance.now() - tOpen; // só o sistema abrindo o microfone (telemetria voice_mic_open)
  await warm;
  const nodes = [], gain = (prefs.inputVolume ?? 100) / 100;
  const out = { raw, nodes, error: null, processed: false, openMs };
  const src = ctx.createMediaStreamSource(raw); nodes.push(src);
  // nível do microfone CRU (antes de filtro, porta e mudo) para o vigia da captura (public/micwatch.js)
  const rawAn = ctx.createAnalyser(); rawAn.fftSize = 16384; src.connect(rawAn); nodes.push(rawAn); // ~340 ms: lido a cada 250 ms, cobre o tempo todo
  const rawBuf = new Float32Array(rawAn.fftSize);
  // rawRms: energia dos últimos 250 ms (aviso de "falando mutado", public/micwatch.js talkMutedStep), na mesma passada
  const RMS_N = Math.min(rawBuf.length, Math.round(ctx.sampleRate / 4));
  out.rawPeak = () => {
    rawAn.getFloatTimeDomainData(rawBuf); let m = 0, q = 0; const n = rawBuf.length, k = n - RMS_N;
    for (let i = 0; i < n; i++) { const v = rawBuf[i], a = v < 0 ? -v : v; if (a > m) m = a; if (i >= k) q += v * v; }
    out.rawRms = Math.sqrt(q / RMS_N); return m;
  };
  out.rawTrack = raw.getAudioTracks()[0];
  const { first: f0 } = await buildChain(ctx, src, prefs, out);
  let last = out.last, first = f0;
  const chain = (n) => { last.connect(n); nodes.push(n); if (last === src) first = n; if (last === out.fanFilter) out.fanOuts.push([n, 0, 0]); last = n; };
  // ganho automático próprio (public/agc-core.js): depois da redução de ruído e da porta, antes do volume do microfone
  if (prefs.agc === true) {
    try { await ensureModule(ctx, 'agc', '/agc-worklet.js'); const a = new AudioWorkletNode(ctx, 'lc-agc', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' }); out.agc = a; chain(a); }
    catch (e) { console.warn('agc', e); }
  }
  const g = ctx.createGain(); g.gain.value = gain;
  // alguns filtros de ruído só preenchem o canal esquerdo: pega o canal 0 e o destino estéreo repete nos dois lados
  g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'discrete'; chain(g);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 512; g.connect(analyser); nodes.push(analyser);
  const dest = ctx.createMediaStreamDestination(); dest.channelCount = 1; dest.channelCountMode = 'explicit'; g.connect(dest); nodes.push(dest); // trilha mono
  out.stream = dest.stream; out.analyser = analyser; out.gain = g;
  // Escuta própria: força mono -> mesmo sinal nos dois canais (alguns nós de redução de ruído só preenchem o esquerdo)
  const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
  const merger = ctx.createChannelMerger(2); mono.connect(merger, 0, 0); mono.connect(merger, 0, 1); nodes.push(mono, merger);
  let looping = false;
  out.setLoopback = (on) => {
    if (on === looping) return; looping = on;
    try { if (on) { g.connect(mono); merger.connect(ctx.destination); } else { g.disconnect(mono); merger.disconnect(ctx.destination); } } catch { }
    if (on) out.setOutput(prefs.outputId);
  };
  // a escuta própria sai pelo dispositivo de saída escolhido (não pelo padrão do sistema), como a voz dos outros
  out.setOutput = (id) => { try { ctx.setSinkId?.(id || '').catch(() => { }); } catch { } };
  // mutado: o microfone sai da cadeia e a IA de ruído (RNNoise/GTCRN, na thread de áudio) para de processar — sem entrada
  // os nós de ruído não fazem nada. O que sai para a sala é silêncio de qualquer jeito (trilha desligada).
  let idle = false;
  // o filtro de ventilador (worklet) segue mandando silêncio mesmo sem entrada: a saída dele também sai da cadeia
  const ff = out.fanFilter, ffOuts = out.fanOuts || [];
  out.setIdle = (on) => {
    if (!first || on === idle) return; idle = on;
    try { on ? src.disconnect(first) : src.connect(first); } catch { }
    if (ff) for (const [n, o, i] of ffOuts) { try { on ? ff.disconnect(n, o, i) : ff.connect(n, o, i); } catch { } }
  };
  out.dispose = () => {
    out.setLoopback(false);
    for (const n of nodes) { try { n.port?.postMessage('destroy'); } catch { } try { n.disconnect(); } catch { } }
    raw.getTracks().forEach(t => t.stop()); out.stream.getTracks().forEach(t => t.stop());
  };
  return out;
}
export const newAudioContext = () => new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });

// Canal de cor mais claro (0–255) de um quadro de vídeo já copiado (VideoFrame.copyTo), olhando uma grade de 32x18 pontos:
// o mesmo critério da captura preta de antes (quadro reduzido a 32x18). RGB direto; YUV convertido para RGB no ponto.
// Formato desconhecido: null.
export function frameMax(f, buf, layout) {
  const W = f.visibleRect?.width || f.codedWidth, H = f.visibleRect?.height || f.codedHeight, fmt = f.format || '';
  if (!W || !H || !layout?.length) return null;
  const full = !!f.colorSpace?.fullRange, yuv = /^(I420A?|I422A?|I444A?|NV12)/.test(fmt), rgb = /^(RGB|BGR)[AX]$/.test(fmt);
  if (!yuv && !rgb) return null;
  const sx = /^(I420|NV12)/.test(fmt) || /^I422/.test(fmt) ? 2 : 1, sy = /^(I420|NV12)/.test(fmt) ? 2 : 1;
  let mx = 0;
  for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) {
    const x = Math.floor((i + 0.5) * W / 32), y = Math.floor((j + 0.5) * H / 18);
    if (rgb) { const o = layout[0].offset + y * layout[0].stride + x * 4; mx = Math.max(mx, buf[o], buf[o + 1], buf[o + 2]); continue; }
    const Y = buf[layout[0].offset + y * layout[0].stride], cx = Math.floor(x / sx), cy = Math.floor(y / sy);
    let U, V;
    if (fmt.startsWith('NV12')) { const o = layout[1].offset + cy * layout[1].stride + cx * 2; U = buf[o]; V = buf[o + 1]; }
    else { U = buf[layout[1].offset + cy * layout[1].stride + cx]; V = buf[layout[2].offset + cy * layout[2].stride + cx]; }
    const l = full ? Y : 1.164 * (Y - 16), u = U - 128, v = V - 128, k = full ? 1 : 1.14;
    mx = Math.max(mx, l + 1.402 * k * v, l - 0.344 * k * u - 0.714 * k * v, l + 1.772 * k * u);
  }
  return Math.max(0, Math.min(255, Math.round(mx)));
}

export class Voice {
  constructor({ send, ice, myId, onUpdate, prefs, serverRoom }) {
    this.send = send; this.ice = ice; this.myId = myId; this.onUpdate = onUpdate; this.prefs = prefs;
    this.serverRoom = serverRoom || (() => null); // sala em que o servidor tem esta pessoa (último VOICE_STATE recebido)
    this.autoKbps = AUTO_MAX; // nível escolhido pelo modo automático (32-64 kbps, voz mono)
    this.channelId = null; this.peers = new Map(); this.micGraph = null; this.mic = null; this.cam = null; this.screen = null;
    this.closedStreams = new Set(); this.muted = false; this.deafened = false; this.ptt = false; this.speaking = new Set(); this.sbActive = new Set();
    this.ctx = null; this.analysers = new Map(); this.timer = null; this.screenOpts = null; this._natLive = new Set();
    document.addEventListener('visibilitychange', () => this.syncVoiceFlow());
    // a internet voltou (Wi-Fi trocou, cabo, 4G): não espera o navegador perceber que a mídia caiu
    // (só os transportes caídos: o de envio de quem está sem microfone fica 'new' e um reinício nele contava tentativa à
    // toa, até refazer a mídia inteira). Refazer a mídia que esperava a vez (até 30 s) também vai na hora.
    window.addEventListener('online', () => {
      const s = this.sfu; if (s?.ready) for (const t of [s.send, s.recv]) if (t && (t.connectionState === 'disconnected' || t.connectionState === 'failed')) this.iceRestart(t, s);
      if (this._mrTimer && !this._linkDown) { clearTimeout(this._mrTimer); this._mrTimer = null; this._mrTries = Math.max(0, (this._mrTries || 0) - 1); this.mediaReconnect(this._mrReason || 'online', true); }
    });
  }
  get active() { return !!this.channelId; }
  getCtx() {
    if (!this.ctx) {
      this.ctx = newAudioContext();
      // o sistema parou o áudio (troca de dispositivo, outro programa, "interrompido"): na chamada, pede para voltar na hora
      this.ctx.addEventListener?.('statechange', () => { const c = this.ctx; if (c && c.state !== 'running' && c.state !== 'closed' && (this.channelId || this._joinTo)) c.resume().catch(() => { }); });
    }
    this.ctx.resume?.(); return this.ctx;
  }
  // mouse em cima de uma sala de voz: deixa filtro de ruído e modelos prontos antes do clique (o contexto fica dormindo)
  prewarm() {
    if (this.channelId || this._joinTo || this._warmed) return;
    this._warmed = true;
    const c = this.getCtx(); warmMic(this.prefs, c); this.sleepCtx();
  }

  async buildMic() {
    const gen = (this._micGen = (this._micGen || 0) + 1);
    this.micGraph?.dispose(); this.micGraph = null; this.analysers.get(this.myId)?.src.disconnect(); this.analysers.delete(this.myId);
    // o id do microfone mudou (atualização, driver, outra porta USB): createMic acha o mesmo pelo nome só se o id salvo
    // não abrir; depois confere os nomes sem segurar a entrada
    const g = await createMic(this.prefs, this.getCtx(), { resolve: this.resolveDevices });
    if (gen === this._micGen) this.resolveDevices?.();
    // outra montagem começou enquanto esta carregava (ex.: trocar o filtro várias vezes): esta já nasce velha e é desligada
    // (antes ficava ligada, com a IA de ruído processando à toa, e o áudio ia acumulando atraso)
    if (gen !== this._micGen) { g.dispose(); return false; }
    this.micGraph = g; this.mic = g.stream; this.updateMonitor?.();
    g.id = gen;
    // a captura terminou (dispositivo desconectado ou reiniciado pelo sistema) ou um filtro travou: monta de novo na hora
    if (g.rawTrack) g.rawTrack.addEventListener('ended', () => { if (this.micGraph === g) this.micRecover('ended'); });
    for (const n of g.nodes) if (n instanceof AudioWorkletNode) n.onprocessorerror = () => { console.warn('filtro do microfone travou', n); if (this.micGraph === g) this.micRecover('worklet'); };
    this.error = g.error;
    this.analysers.set(this.myId, { src: { disconnect() { } }, an: g.analyser, buf: new Uint8Array(g.analyser.fftSize), level: 0 });
    this.applyMute();
  }
  // Vigia (a cada 1 s na chamada; o nível é lido a cada 250 ms para não perder som curto): a captura do microfone morreu sem aviso (zero absoluto, trilha muda, motor de áudio
  // parado)? Monta o microfone de novo sem sair da sala. Regras em public/micwatch.js.
  micWatch() {
    const g = this.micGraph, w = this._mw; if (!g || !w || !this.channelId || this._rb) return;
    const t = g.rawTrack, ctx = this.ctx, ended = t?.readyState === 'ended';
    if (w.g !== g.id) { w.g = g.id; w.pk = null; w.n = 0; }
    try { const v = g.rawPeak?.(); if (v != null) w.pk = Math.max(w.pk ?? 0, v); } catch { }
    // falando com o mudo ligado (só o mudo escolhido pela pessoa: ensurdecido, em espera, moderação, apertar-para-falar e
    // teste de microfone não avisam): "Você está mutado" com o botão de desmutar (public/voicenote.js)
    const tmOn = this.muted && !this.deafened && !this.hold && !this.modMute && !this.modDeaf && !this.testMute && !this.micHold && this.prefs.mutedTalkWarn !== false;
    if (talkMutedStep(this._tm ||= newTalkMuted(), { muted: tmOn, rms: ctx?.state === 'running' && !ended ? g.rawRms ?? null : null })) { track('muted_talk'); this.note('mutedtalk'); }
    if (++w.n < 4 && !ended) return;
    const peak = w.pk; w.pk = null; w.n = 0;
    const r = micWatchStep(w, { graph: g.id, ended, muted: !!t?.muted, ctxRunning: ctx?.state === 'running', peak });
    if (r === 'resume') ctx?.resume?.().catch(() => { });
    else if (r?.rebuild) this.micRecover(r.rebuild);
    // a remontagem automática deu certo (a captura nova tem som) ou desistiu (MAX tentativas): a pessoa fica sabendo
    if (this._mfix != null && g.id !== this._mfix && w.heard) { this._mfix = null; if (performance.now() - this._mfixAt < 30e3) this.note('micok'); } // voltou bem depois: era o jeito do dispositivo, não queda
    if (w.deadNew) { w.deadNew = false; this._mfix = null; track('mic_dead'); this.note('micdead'); }
  }
  // aviso pequeno em cima do botão do microfone (falando mutado, microfone religando/voltou/sem som): public/voicenote.js,
  // carregado só na primeira vez que precisa
  note(kind) { if (typeof document === 'undefined') return; import('./voicenote.js').then(m => m.voiceNote(this, kind)).catch(() => { }); }
  micRecover(why) {
    if (!this.channelId) return;
    console.warn('microfone: captura parou (' + why + '), montando de novo');
    track('mic_recover', why);
    // silêncio: pode ser o jeito do dispositivo (porta de ruído embutida), então só avisa se voltar; os outros motivos são
    // queda de verdade e avisam já ("religando o microfone…")
    this._mfix = this.micGraph?.id ?? null; this._mfixAt = performance.now(); if (why !== 'silence') this.note('micfix');
    this.ctx?.resume?.().catch(() => { });
    return this.rebuildMic();
  }
  // Troca a cadeia de áudio (ex.: mudou o modo de ruído) sem reconectar
  // vários pedidos seguidos viram um só: espera a montagem atual terminar e monta de novo uma vez, com as opções mais novas
  rebuildMic() {
    if (this._rb) { this._rbAgain = true; return this._rb; }
    this._rb = (async () => { do { this._rbAgain = false; await this.rebuildOnce(); } while (this._rbAgain && this.channelId); })().finally(() => { this._rb = null; });
    return this._rb;
  }
  async rebuildOnce() {
    if (!this.channelId) return;
    try {
      const old = this.micGraph; if (await this.buildMic() === false) return;
      const track = this.mic.getAudioTracks()[0];
      if (this.sfu) await this.sfuProduce('mic', track);
      else for (const p of this.peers.values()) { const s = p.senders.micaudio; if (s) await s.replaceTrack(track); else p.senders.micaudio = this.p2pAdd(p.pc, track, this.mic); }
      // o replaceTrack do mediasoup-client liga a trilha (enabled = true) se o produtor não está pausado, e o mudo daqui
      // não pausa o produtor: remontar mutado (vigia do microfone, troca de filtro) deixava a trilha nova ligada. Com o
      // teste de microfone segurando a cadeia (micHold) a voz saía para a sala mesmo mutado. Aplica o mudo de novo.
      this.applyMute();
      void old;
    } catch (e) { this.error = e.message; }
    this.onUpdate();
  }

  // A conexão com o servidor caiu e voltou. Voz, câmera e transmissão não passam por ela (seguiram pelo SFU): pede para
  // continuar a mesma sessão (o servidor segura a sala uns segundos, server/index.js holdVoice) e ninguém vê sair e
  // entrar. Se o servidor já não tem a sessão (reiniciou, demorou demais), entra de novo como antes (rejoin).
  // Só a ÚLTIMA retomada vale: a conexão caiu de novo durante a espera (ou outra retomada começou), esta não responde mais
  // por nada; antes ela esgotava os 4 s e entrava de novo na sala (os outros viam sair e entrar) mesmo com a nova retomada OK.
  async resume() {
    const cid = this.channelId; if (!cid) return;
    const gen = this._resumeGen = (this._resumeGen || 0) + 1, drops = this._drops || 0;
    const ok = await new Promise((res) => { const t = setTimeout(() => res(false), 4000); this._resumeWait = (d) => { clearTimeout(t); res(!!d?.ok && d.channel_id === cid); }; this.send('VOICE_RESUME', { channel_id: cid }); });
    if (gen !== this._resumeGen || this.channelId !== cid) return;
    this._resumeWait = null;
    if (!ok && (this._drops || 0) !== drops) return; // caiu de novo antes da resposta: o próximo READY tenta de novo
    this._linkDown = false;
    if (!ok) { if (this.screen) this.capLog({ t: 'capnote', msg: 'o servidor não tinha mais a sessão de voz: entrando de novo na sala (a transmissão para)' }); return this.rejoin(); }
    if (this.screen) this.capLog({ t: 'capnote', msg: 'sessão de voz retomada: para os outros você não saiu, e a transmissão seguiu' });
    // a resposta da entrada (VOICE_JOINED) foi para a conexão que caiu: sem ela não há mídia nenhuma (nem SFU nem malha), e
    // antes a pessoa ficava na sala muda e sem ouvir ninguém até sair. Entra de novo.
    if (!this._gotJoined) return this.rejoin();
    this.sendStateNow(); // mudo, ensurdecido, câmera e tela como estão agora
    // a mídia caiu junto (rede fora) e refazê-la ficou esperando a conexão, ou a entrada no SFU estava no meio (as respostas
    // foram para a conexão morta): refaz agora, sem esperar os 15 s do pedido sem resposta
    if (this._sfuMode && (!this.sfu?.ready || this._mrDeferred)) { this._mrDeferred = false; clearTimeout(this._mrTimer); clearTimeout(this._mrWait); this._mrTimer = this._mrWait = null; return this.mediaReconnect(this._mrReason || 'resume', true); }
    this.sfuResync().catch(() => { });
  }
  // a conexão com o servidor caiu (public/gateway.js): pedidos ao SFU e SFU_REJOIN esperam a retomada (VOICE_RESUME); um
  // SFU_REJOIN pela conexão nova antes dela era recusado (ainda não é a conexão da sala) e tirava a pessoa da sala
  linkDown() { if (!this.channelId) return; this._linkDown = true; this._drops = (this._drops || 0) + 1; }
  // depois de retomar: o que os outros ligaram ou desligaram durante a queda (os avisos não chegaram)
  async sfuResync() {
    const s = this.sfu; if (!s?.ready) return;
    const r = await this.sfuReq('producers'); if (this.sfu !== s || !r?.producers) return;
    const live = new Set(r.producers.map(p => p.producer_id));
    for (const [id, e] of [...s.consumers]) if (!live.has(e.c.producerId)) this.onSfuConsumerClosed({ consumer_id: id });
    for (const id of [...s.seen]) if (!live.has(id)) s.seen.delete(id);
    for (const p of r.producers) this.onSfuProducer(p);
  }
  // depois de a conexão com o servidor cair: volta para a mesma sala, em silêncio e mantendo mudo/ensurdecido
  rejoin() {
    const cid = this.channelId; if (!cid) return;
    const { muted, deafened, hold, _preHold } = this;
    this.leave({ silent: true }); this.muted = muted; this.deafened = deafened; this.hold = hold; this._preHold = _preHold;
    return this.join(cid, { silent: true });
  }
  // Cliques seguidos em salas diferentes (ou sair enquanto entra): só a ÚLTIMA entrada vale. Antes as entradas corriam
  // juntas — terminava fora de qualquer sala, com o medidor de fala (100 ms) e um microfone a mais ligados à toa.
  join(channelId, opts) {
    if (this._joinTo === channelId) return this._joinP; // mesma sala já entrando: o segundo clique não faz nada
    if (this.channelId === channelId && !this._joinTo) return Promise.resolve();
    if (this.channelId) this.leave();
    const gen = this._joinGen = (this._joinGen || 0) + 1; this._joinTo = channelId;
    const done = () => { if (this._joinGen === gen) this._joinTo = this._joinP = null; };
    return (this._joinP = this.joinNow(channelId, opts || {}, gen).finally(done));
  }
  async joinNow(channelId, { silent = false }, gen) {
    const stale = () => {
      if (gen === this._joinGen) return false;
      // ninguém mais entrando nem na sala: o microfone que esta entrada montou não fica ligado
      if (!this._joinTo && !this.channelId) { this.micGraph?.dispose(); this.micGraph = null; this.mic = null; this.analysers.delete(this.myId); }
      return true;
    };
    this.error = null; this._jt = null;
    const t0 = performance.now(); // telemetria: "entrar na voz" por etapa (microfone → servidor → mídia conectada)
    // conversa direta protegida (public/e2ee.js): a chamada também vai cifrada de ponta a ponta; trancada = não entra
    const pre = await this.beforeJoin?.(channelId).catch((e) => ({ error: e.message }));
    if (stale()) return;
    if (pre?.error) { this.error = pre.error; return; }
    this.e2ee = pre?.key || null;
    // o microfone (permissão, dispositivo, filtro de ruído) é preparado AO MESMO TEMPO que o servidor aceita a entrada e a
    // conexão de mídia abre: antes era um depois do outro, e no app desktop o "entrar na voz" levava ~2,5 s (metade das vezes).
    // A mídia espera o microfone só na hora de enviar a voz (sfuStart / onJoined aguardam this._micReady).
    let micErr = null;
    const micP = this._micReady = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(location.protocol === 'http:' && !isSecureContext
          ? `Microfone indisponível: abra https://${location.hostname}:3443 (aceite o aviso do certificado) ou use o aplicativo desktop.`
          : 'Microfone indisponível neste navegador.');
        await this.buildMic();
      } catch (e) { this.mic = null; micErr = e.message || 'Não foi possível acessar o microfone (entrando como ouvinte).'; }
    })();
    this.channelId = channelId; this.joinedAt = Date.now();
    clearInterval(this.timer); this.timer = setInterval(() => this.poll(), 100);
    this._mw = newMicWatch(); this._tm = newTalkMuted(); this._mfix = null; clearInterval(this._mwT); this._mwT = setInterval(() => this.micWatch(), 250); // vigia da captura do microfone
    this._cq = new CallQuality(); clearInterval(this._cqT); this._cqT = setInterval(() => this.qualitySample(), SAMPLE_MS); // qualidade técnica (public/callqual.js)
    this._jt = { sent: performance.now() }; this.send('VOICE_JOIN', { channel_id: channelId });
    this.sendState(); this.onUpdate(); if (!silent) playSound('selfJoin');
    await micP;
    if (stale() || this.channelId !== channelId) return; // saiu (ou o servidor recusou) enquanto o microfone ficava pronto
    if (micErr) this.error = micErr; else { timing('voice_mic', performance.now() - t0); if (this.micGraph?.openMs != null) timing('voice_mic_open', this.micGraph.openMs); } // o resto (até voice_mic) é filtro de ruído e listar dispositivos
    // malha (sem SFU): quem conectou antes de o microfone ficar pronto recebe a voz agora
    if (this.mic && !this.sfu) { const track = this.mic.getAudioTracks()[0]; for (const p of this.peers.values()) if (!p.senders.micaudio && track) p.senders.micaudio = this.p2pAdd(p.pc, track, this.mic); }
    this.sendState(); this.onUpdate();
  }
  leave({ silent = false } = {}) {
    if (this._joinTo) { this._joinGen = (this._joinGen || 0) + 1; this._joinTo = this._joinP = null; } // cancela uma entrada em andamento
    if (!this.channelId) return;
    this._resumeGen = (this._resumeGen || 0) + 1; this._resumeWait = null; this._linkDown = this._mrDeferred = this._sfuMode = this._gotJoined = false; // retomada em andamento não vale mais
    this._jt = null;
    // qualidade técnica da chamada que acabou: vai para a telemetria em faixas e junto do aviso (a avaliação cruza com ela)
    const ms = Date.now() - (this.joinedAt || Date.now());
    clearInterval(this._cqT); this._cqT = null; let quality = null;
    clearInterval(this._mwT); this._mwT = null; this._mw = null; this._mfix = null; if (this.micGraph) this.note('close'); // sem aviso do microfone fora da sala
    try { quality = this._cq?.summary(ms) || null; recordCallQuality(quality); } catch (e) { console.warn('qualidade da chamada', e); }
    this._cq = null;
    // avisa que a chamada acabou (avaliação da chamada, public/callrate.js): quanto durou, em que sala e como a rede estava
    try { document.dispatchEvent(new CustomEvent('call-ended', { detail: { channelId: this.channelId, ms, silent, quality } })); } catch { }
    if (!silent) playSound('selfLeave');
    if (this.native) { this.native = null; window.lcDesktop?.nativeStop?.(); } // o servidor fecha a sessão ao sair da sala
    this.monitorOn = false; this.updateMonitor();
    // o servidor vai responder com "saiu de <sala>" (VOICE_STATE sem sala). Se a pessoa já entrou de novo na MESMA sala
    // antes de o aviso chegar (rejoin(), sair e entrar rápido), o aviso atrasado não pode tirá-la da entrada nova
    // (ver ownLeaveEcho e public/gateway.js). Só anota se o servidor ainda a tem na sala: senão não vem aviso nenhum.
    if (this.serverRoom() === this.channelId) (this._ownLeaves ||= []).push({ cid: this.channelId, until: Date.now() + 5000 });
    this.send('VOICE_LEAVE', {});
    if (this.hold) { const p = this._preHold || {}; this.hold = false; this._preHold = null; this.muted = !!p.muted; this.deafened = !!p.deafened; } // a espera é só desta chamada
    this.stopRecovery();
    this._sfuTok = null; this.sfuClose();
    for (const uid of [...this.peers.keys()]) this.drop(uid);
    this.e2eeWorker?.terminate(); this.e2eeWorker = null; this.e2eeWorkerStats = null; this.e2ee = null; // chave da chamada protegida some junto
    this.micGraph?.dispose(); this.micGraph = null;
    this.stopAppAudio(); // programa de áudio do jogo também para
    const c = this._clipMe; if (c) { c.src?.disconnect(); c.node?.stop(); c.dest.stream.getTracks().forEach(t => t.stop()); } this._clipSb?.stream.getTracks().forEach(t => t.stop()); this._clipMe = this._clipSb = null; // áudio dos clipes
    for (const s of [this.cam, this.screen]) s?.getTracks().forEach(t => t.stop());
    this.mic = this.cam = this.screen = null; this.channelId = null; this.speaking.clear();
    for (const a of this.analysers.values()) a.src.disconnect(); this.analysers.clear();
    clearInterval(this.timer); this.timer = null; this.sleepCtx(); this.onUpdate();
  }
  // o aviso "saiu da sala" que chegou é a resposta a um VOICE_LEAVE desta página (consome a anotação)
  ownLeaveEcho(cid) {
    const now = Date.now(), l = (this._ownLeaves || []).filter(x => x.until > now), i = l.findIndex(x => x.cid === cid);
    if (i >= 0) l.splice(i, 1); this._ownLeaves = l; return i >= 0;
  }
  // fora da call o contexto de áudio da voz fica suspenso: rodando, ele mantém a thread de áudio e a saída de som
  // processando silêncio o tempo todo (~2-4% de CPU num PC comum). getCtx() acorda de novo quando precisar.
  sleepCtx() { setTimeout(() => { if (!this.channelId && !this._joinTo && this.ctx?.state === 'running') this.ctx.suspend().catch(() => { }); }, 1500); }
  onJoined({ channel_id, peers, sfu, rejoin }) {
    if (channel_id !== this.channelId) return;
    clearTimeout(this._mrWait); this._mrWait = null;
    const jt = this._jt; if (jt?.sent && !jt.joined) { timing('voice_server', performance.now() - jt.sent); jt.joined = performance.now(); if (!sfu) this._jt = null; }
    if (sfu && (rejoin || this.sfu)) this.sfuTeardown(); // resposta de um SFU_REJOIN (ou chegou de novo): começa do zero
    // a falha só conta se esta conexão de mídia ainda for a atual: saiu (ou entrou de novo) no meio do caminho, o
    // envio cancelado ("queue stopped") não é falha de conexão nem vira erro na tela
    const tok = this._sfuTok = {}; this._sfuMode = !!sfu; this._gotJoined = true;
    if (sfu) this.sfuStart(sfu).catch(e => { if (this._sfuTok !== tok || this.channelId !== channel_id) return; console.warn('sfu', e); if (this.recovering || this._linkDown) return this.mediaReconnect('start_failed'); track('voice_fail', 'sfu_error'); cancelTimer('voice_connect'); this.error = 'Falha ao conectar a voz: ' + (e.message || e); this.onUpdate(); });
    else (this._micReady || Promise.resolve()).then(() => { if (channel_id === this.channelId) for (const uid of peers) if (!this.peers.has(uid)) this.connect(uid, true); });
  }
  onPeerLeft({ user_id }) { this.drop(user_id); this.onUpdate(); }

  // ---------- SFU (mediasoup): um envio ao servidor, que repassa a todos ----------
  sfuReq(op, d = {}) {
    const rid = (this.rid = (this.rid || 0) + 1);
    return new Promise((resolve, reject) => {
      (this.pending ||= new Map()).set(rid, { resolve, reject });
      // sem conexão com o servidor agora: falha na hora (antes esperava 15 s por uma resposta que não vinha)
      if (this.send('SFU', { ...d, rid, op }) === false) { this.pending.delete(rid); return reject(new Error('sem conexão com o servidor (' + op + ')')); }
      setTimeout(() => { if (this.pending.delete(rid)) reject(new Error('sem resposta do servidor (' + op + ')')); }, 15000);
    });
  }
  onSfuRes({ rid, data, error }) {
    const p = this.pending?.get(rid); if (!p) return;
    this.pending.delete(rid); error ? p.reject(new Error(error)) : p.resolve(data);
  }
  async sfuStart({ rtpCapabilities }) {
    const { Device } = await import('/vendor/msc/mediasoup-client.js');
    const cid = this.channelId, device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    const sfu = { cid, device, producers: {}, consumers: new Map(), seen: new Set(), ready: false };
    this.sfu = sfu;
    const transport = async (dir) => {
      const info = await this.sfuReq('transport', { dir });
      const t = device[dir === 'send' ? 'createSendTransport' : 'createRecvTransport']({ ...info, iceServers: this.ice, ...(this.e2eeLegacy() ? { additionalSettings: { encodedInsertableStreams: true } } : {}) });
      t.on('connect', ({ dtlsParameters }, ok, fail) => this.sfuReq('connect', { transport_id: t.id, dtlsParameters }).then(ok, fail));
      t.on('connectionstatechange', (st) => {
        if (st === 'disconnected' || st === 'failed') this._cq?.drop();
        if (st === 'failed') track('voice_fail', 'ice_failed');
        if (st === 'connected') { stopTimer('voice_connect', this.channelId); const jt = this._jt; if (jt?.joined) { this._jt = null; timing('voice_media', performance.now() - jt.joined); } }
        this.watchMedia(t, sfu, st); this.onUpdate(true);
      });
      // recebimento protegido: a decifragem entra no evento 'track', durante a negociação de cada consumer (depois dela o
      // Chromium não entrega mais os quadros ao worker)
      if (dir === 'recv' && this.e2ee) t.handler?._pc?.addEventListener('track', (e) => this.e2eeAttach(e.receiver, 'dec'));
      if (dir === 'send') t.on('produce', ({ kind, rtpParameters, appData }, ok, fail) =>
        this.sfuReq('produce', { transport_id: t.id, kind, rtpParameters, source: appData.source }).then(ok, fail));
      return t;
    };
    // os dois canais (envio e recebimento) e a lista do que já está no ar: pedidos ao mesmo tempo (antes, um por vez)
    const [st, rt, pr] = await Promise.all([transport('send'), transport('recv'), this.sfuReq('producers')]);
    sfu.send = st; sfu.recv = rt;
    if (this.sfu !== sfu) return;
    const { producers } = pr;
    sfu.ready = true; this.syncVoiceFlow(); // já entra ensurdecido e escondido: nem começa a receber as vozes
    for (const p of producers) this.onSfuProducer(p);
    // o que já estava ligado antes de conectar
    await this._micReady; if (this.sfu !== sfu) return; // microfone ainda ficando pronto (entrada em paralelo)
    if (this.mic) await this.sfuProduce('mic', this.mic.getAudioTracks()[0]);
    if (this.cam) await this.sfuProduce('cam', this.cam.getVideoTracks()[0]);
    if (this.screen) await this.sfuPublishScreen();
    if (this.screen && this.native && !this.native.pending) { window.lcDesktop?.nativeStop?.(); this.startNative().catch(() => { }); } // sessão anterior morreu com a conexão
    this.onUpdate();
    setTimeout(() => this.checkRecovered(sfu), 1500); // refez a mídia e não há nada para conectar agora: já conta como de volta
  }
  // ---------- recuperação da mídia (sem reiniciar o app nem sair da sala) ----------
  // 1) conexão oscilou ('disconnected' por 3 s) ou caiu ('failed'): reinício do ICE com credenciais novas do servidor;
  //    o áudio volta em ~1-2 s quando a rede volta. 2) Duas tentativas sem voltar (ou o servidor avisou que o worker do
  //    SFU morreu: SFU_RESET): refaz só a conexão de mídia (SFU_REJOIN), com espera crescente entre tentativas. A pessoa
  //    continua na sala o tempo todo (os outros não veem sair/entrar) e microfone, câmera e tela voltam sozinhos.
  watchMedia(t, sfu, st) {
    if (this.sfu !== sfu) return;
    sfu.timers ||= new Map();
    clearTimeout(sfu.timers.get(t.id)); sfu.timers.delete(t.id);
    if (st === 'connected') { sfu.iceTries = 0; return this.checkRecovered(sfu); }
    if (st === 'disconnected') { this.markRecovering('ice'); sfu.timers.set(t.id, setTimeout(() => this.iceRestart(t, sfu), 3000)); }
    else if (st === 'failed') { this.markRecovering('ice'); this.iceRestart(t, sfu); }
  }
  // voltou: todos os transportes conectados (um que nunca precisou conectar, como o de envio de quem está sem microfone, conta)
  checkRecovered(sfu = this.sfu) {
    if (!this.recovering || !sfu?.ready || this.sfu !== sfu) return;
    if (![sfu.send, sfu.recv].every(x => !x || x.connectionState === 'connected' || x.connectionState === 'new')) return;
    if (this.error?.startsWith('Falha ao conectar a voz')) this.error = null; // a mídia voltou: o aviso da falha não vale mais
    this.recovering = false; this._mrTries = 0; track('voice_recovered', this._mrReason || 'ice', { bg: true }); this._mrReason = null;
    if (this.screen) this.capLog({ t: 'capnote', msg: `conexão de mídia de volta em ${((Date.now() - (this._mrAt || Date.now())) / 1000).toFixed(1)} s` });
    this.onRecovered?.(); this.onUpdate();
  }
  markRecovering(reason) { if (!this.recovering) { this.recovering = true; this._mrReason = reason; this._mrAt = Date.now(); if (this.screen) this.capLog({ t: 'capnote', msg: `conexão de mídia caiu (${reason}): reconectando` }); this.onUpdate(); } }
  // um reinício por transporte de cada vez: 'disconnected' (3 s), 'failed' e o 'online' da rede chegam juntos e antes
  // pediam 2-3 reinícios ao mesmo tempo, gastando as tentativas e refazendo a mídia inteira sem precisar
  async iceRestart(t, sfu) {
    if (this.sfu !== sfu || t.closed || (sfu.iceBusy ||= new Set()).has(t.id)) return;
    if (t.connectionState === 'connected' || t.connectionState === 'new') return this.checkRecovered(sfu); // voltou sozinha enquanto esperava (ou nunca precisou conectar)
    if ((sfu.iceTries = (sfu.iceTries || 0) + 1) > 2) return this.mediaReconnect('ice');
    this.markRecovering('ice');
    sfu.iceBusy.add(t.id);
    try {
      const { iceParameters } = await this.sfuReq('restart_ice', { transport_id: t.id });
      if (this.sfu !== sfu || t.closed) return;
      await t.restartIce({ iceParameters });
    } catch (e) { console.warn('restart ice', e); if (this.sfu === sfu) return this.mediaReconnect('ice_error'); } finally { sfu.iceBusy.delete(t.id); }
    // não voltou em 8 s: tenta de novo (na 3ª vez refaz a conexão inteira)
    clearTimeout(sfu.timers?.get(t.id));
    sfu.timers?.set(t.id, setTimeout(() => { if (this.sfu === sfu) this.iceRestart(t, sfu); }, 8000));
  }
  // now: a rede/conexão acabou de voltar (sem a espera crescente, só o sorteio)
  mediaReconnect(reason, now = false) {
    if (!this.channelId || this._mrTimer) return;
    this.markRecovering(reason);
    const n = this._mrTries = (this._mrTries || 0) + 1;
    // 1ª na hora (com um sorteio de até 1,5 s: quando o worker morre, a sala inteira volta ao mesmo tempo), depois 2 s, 5 s, 10 s… até 30 s
    const wait = now ? 0 : [0, 2000, 5000, 10000, 20000][n - 1] ?? 30000, jitter = Math.random() * 1500;
    track('voice_reconnect', reason, { bg: true }); // bg: conta com o app minimizado (jogando, transmitindo)
    this._mrTimer = setTimeout(() => {
      this._mrTimer = null;
      if (!this.channelId) return;
      if (this._linkDown) { this._mrDeferred = true; return; } // sem conexão com o servidor: refaz quando a sessão for retomada (resume)
      this.sfuTeardown();
      this.send('SFU_REJOIN', { channel_id: this.channelId });
      clearTimeout(this._mrWait); this._mrWait = setTimeout(() => { this._mrWait = null; if (this._linkDown) this._mrDeferred = true; else this.mediaReconnect('timeout'); }, 15000); // sem resposta: tenta de novo
    }, wait + jitter);
  }
  // o servidor pediu para refazer a mídia (worker do SFU morreu, ou a entrada no SFU falhou)
  onSfuReset({ channel_id, reason, gone }) {
    if (!this.channelId || (channel_id && channel_id !== this.channelId)) return;
    if (gone) { this.stopRecovery(); return this.rejoin(); } // o servidor não tem mais a pessoa na sala: entra de novo
    clearTimeout(this._mrWait); this._mrWait = null;
    this.mediaReconnect(reason === 'worker' ? 'server' : reason || 'server');
  }
  stopRecovery() {
    clearTimeout(this._mrTimer); clearTimeout(this._mrWait); this._mrTimer = this._mrWait = null;
    this._mrTries = 0; this.recovering = false; this._mrReason = null; this._mrDeferred = false;
  }
  // desmonta a conexão de mídia atual (o que os outros mandam some da tela; o que é meu é republicado no sfuStart)
  sfuTeardown() {
    const s = this.sfu; if (!s) return;
    for (const id of [...s.consumers.keys()]) this.onSfuConsumerClosed({ consumer_id: id });
    this.sfuClose();
  }
  sfuClose() {
    const s = this.sfu; if (!s) return;
    this.sfu = null;
    for (const t of s.timers?.values() || []) clearTimeout(t); // reinícios de ICE agendados (sair da sala também passa aqui)
    s.timers?.clear();
    s.send?.close(); s.recv?.close();
    for (const p of this.pending?.values() || []) p.reject(new Error('saiu da sala'));
    this.pending?.clear();
  }
  sfuEncodings(source, temporal = false) {
    const o = this.screenOpts || {};
    if (source === 'mic') return [{ maxBitrate: this.micKbps() * 1000, priority: 'high', networkPriority: 'high' }];
    if (source === 'cam') return [ // simulcast: o servidor escolhe a camada que cabe na banda de cada um
      { rid: 'r0', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
      { rid: 'r1', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
      { rid: 'r2', scaleResolutionDownBy: 1, maxBitrate: 2_000_000 }];
    if (source === 'screen') {
      const top = bitrateFor(o.res || 1080, o.fps || 30, o.bitrate, isGameShare(o));
      // fps vem da restrição da trilha (prioridade/fps por camada não são aceitos pelo Chromium no simulcast)
      // 3 camadas: quem tem internet fraca recebe a pequena, o resto a cheia; L1T3 deixa o servidor reduzir só os fps antes da resolução
      const t = temporal ? { scalabilityMode: 'L1T3' } : {};
      return [{ rid: 'r0', scaleResolutionDownBy: 4, maxBitrate: Math.round(top * .12), ...t },
        { rid: 'r1', scaleResolutionDownBy: 2, maxBitrate: Math.round(top * .38), ...t },
        { rid: 'r2', scaleResolutionDownBy: 1, maxBitrate: top, ...t }];
    }
    return undefined;
  }
  async sfuProduce(source, track) {
    const s = this.sfu; if (!s?.ready || !track) return;
    const cur = s.producers[source];
    if (cur && !cur.closed) return cur.replaceTrack({ track });
    const opts = { track, appData: { source }, encodings: this.sfuEncodings(source, source === 'screen'), stopTracks: false };
    // microfone é mono: anunciar estéreo fazia o Opus gastar bits com dois canais iguais
    if (source === 'mic') opts.codecOptions = { opusStereo: false, opusDtx: true, opusFec: true, opusMaxAverageBitrate: OPUS_MAX * 1000 };
    if (source === 'screenaudio') opts.codecOptions = { opusStereo: true, opusFec: true, opusMaxAverageBitrate: 128000 };
    if (source === 'screen') {
      // começa já perto do bitrate alvo: com a partida baixa o Chromium só liga as camadas grandes depois de minutos
      opts.codecOptions = { videoGoogleStartBitrate: Math.round(bitrateFor(this.screenOpts?.res || 1080, this.screenOpts?.fps || 30, this.screenOpts?.bitrate, isGameShare(this.screenOpts)) * 0.8 / 1000) };
      // placa de vídeo codifica H.264 sem pesar na CPU (que o jogo está usando); sem hardware fica o VP8 com camadas temporais
      if (!this.e2ee && await this.hwH264()) {
        const c = s.device.rtpCapabilities.codecs.find(x => x.mimeType.toLowerCase() === 'video/h264' && /^64/.test(String(x.parameters?.['profile-level-id']).toLowerCase()));
        if (c) { opts.codec = c; opts.encodings = this.sfuEncodings('screen', false); }
      }
    }
    // clipes da sua transmissão ligados: os quadros já comprimidos saem do enviador para o buffer (ownTap), sem o
    // MediaRecorder comprimir a tela de novo. Entra antes do 1º quadro (depois o encaixe não recebe nada)
    if (source === 'screen' && !this.e2ee && this.prefs?.clipsOn === true) opts.onRtpSender = (sender) => { this._ownTap?.close(); this._ownTap = attachTap(sender, '', { send: true }); };
    if (this.e2ee) { delete opts.codec; opts.onRtpSender = (sender) => this.e2eeAttach(sender, 'enc'); } // protegida: só VP8 (o H.264 não aceita quadro cifrado); a cifra entra antes do primeiro quadro sair
    // jogo mandado pelo monitor (monForGame) e fora da tela agora (Resenha na frente ao começar): nasce sem trilha no
    // envio, nenhum quadro da tela sai; applyOver devolve a trilha quando o jogo voltar para a frente
    const hide = source === 'screen' && !!this._overOn && this.monForGame();
    if (hide) { const prev = opts.onRtpSender; opts.onRtpSender = (snd) => { prev?.(snd); snd.replaceTrack(null).catch(() => { }); }; }
    let p;
    try { p = await s.send.produce(opts); }
    catch (e) { // codec/camadas recusados: tenta de novo no padrão
      if (source !== 'screen') throw e;
      console.warn('produce screen', e); delete opts.codec; opts.encodings = this.sfuEncodings('screen', false); p = await s.send.produce(opts);
    }
    if (this.sfu !== s) return p.close();
    s.producers[source] = p;
    if (source === 'screen' && this._ownTap) { // codec que ficou (H.264 da placa ou VP8): o worker precisa para montar o clipe
      const mt = p.rtpParameters?.codecs?.[0]?.mimeType || '';
      if (/^video\/(vp8|h264)$/i.test(mt)) { this._ownTap.setCodec(mt); this.onUpdate(); } // redesenha: o palco troca o buffer do clipe para os quadros enviados
      else { this._ownTap.close(); this._ownTap = null; }
    }
    if (source === 'screen') { this.sfuTuneScreen(); if (opts.codec) setTimeout(() => this.checkHwEncoder(), 3500); }
    if (hide) { p.lcHidden = true; this.sfuReq('pause_producer', { source: 'screen', paused: true }).catch(() => { }); this.applyOver(); }
  }
  async sfuPublishScreen() {
    const vt = this.screen?.getVideoTracks()[0], at = this.screen?.getAudioTracks()[0];
    if (vt && !this.native) await this.sfuProduce('screen', vt); // 120 FPS: o vídeo vai pelo programa nativo
    if (at) await this.sfuProduce('screenaudio', at);
  }
  sfuStop(source) {
    const s = this.sfu, p = s?.producers[source]; if (!p) return;
    p.close(); delete s.producers[source];
    if (source === 'screen') { this._ownTap?.close(); this._ownTap = null; } // o encaixe era daquele enviador
    this.sfuReq('close_producer', { source }).catch(() => { });
  }
  // alguém na sala não consegue receber o H.264 desta transmissão (o servidor avisa): volta ao VP8, que todos decodificam
  async onCodecFallback({ source }) {
    const p = this.sfu?.producers[source], vt = this.screen?.getVideoTracks()[0];
    if (source !== 'screen' || !p || p.closed || !vt || this.native || !/h264/i.test(p.rtpParameters?.codecs?.[0]?.mimeType || '')) return;
    this._hw = false; console.warn('alguém na sala não recebe H.264, voltando ao VP8');
    this.sfuStop('screen'); await this.sfuProduce('screen', vt);
  }
  // o navegador disse que há hardware, mas se o codificador real for o OpenH264 (CPU), volta para o VP8 com camadas temporais
  async checkHwEncoder() {
    const st = await this.screenStats(), enc = st?.find(l => l.enc)?.enc || '';
    this.screenEncoder = enc;
    if (!/OpenH264/i.test(enc) || !this.screen) return;
    this._hw = false; console.warn('H.264 por software, voltando ao VP8');
    const vt = this.screen.getVideoTracks()[0]; this.sfuStop('screen'); if (vt) await this.sfuProduce('screen', vt);
  }
  async hwH264() {
    if (this._hw !== undefined) return this._hw;
    try {
      const r = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: 'video/H264;profile-level-id=640032;packetization-mode=1', width: 1920, height: 1080, bitrate: 5e6, framerate: +this.screenOpts?.fps || 30 } });
      this._hw = !!(r.supported && r.powerEfficient);
    } catch { this._hw = false; }
    return this._hw;
  }
  // lê os números reais do envio: codificador, limite (CPU/rede), fps e kbps de cada camada
  async screenStats() {
    if (this.native) { const n = this.native.stats; return n ? [{ rid: '0', w: n.w || 0, h: n.h || 0, fps: n.fps || 0, kbps: n.kbps || 0, limit: n.busy > (this.native.busy0 ?? n.busy) ? 'cpu' : 'none', enc: 'Placa de vídeo (nativo' + (this.native.encoder ? ': ' + this.native.encoder : '') + ')' }] : []; }
    const p = this.sfu?.producers.screen; if (!p) return null;
    try {
      const layers = [], now = performance.now(); this._ss ||= new Map();
      for (const r of (await p.getStats()).values()) {
        if (r.type !== 'outbound-rtp' || r.kind !== 'video') continue;
        const k = r.rid || '0', prev = this._ss.get(k); this._ss.set(k, { b: r.bytesSent, t: now });
        layers.push({ rid: k, w: r.frameWidth || 0, h: r.frameHeight || 0, fps: Math.round(r.framesPerSecond || 0), kbps: prev ? Math.round((r.bytesSent - prev.b) * 8 / (now - prev.t)) : 0, limit: r.qualityLimitationReason || 'none', enc: r.encoderImplementation || '' });
      }
      return layers.sort((a, b) => b.w - a.w);
    } catch { return null; }
  }
  // captura PRETA: jogos em tela cheia exclusiva ou protegidos por anti-cheat (ex.: Valorant) entregam quadros totalmente pretos.
  // A cada 2 s olha uma miniatura (32x18) da própria transmissão; preto absoluto por ~6 s = aviso. Não tenta contornar a proteção.
  // ---- tela cheia exclusiva (M12) ----
  // O Windows diz se há um app Direct3D em tela cheia exclusiva (SHQueryUserNotificationState, pelo app desktop). É o mesmo
  // critério do Discord, que admite falso positivo (jogo em "Tela cheia" que o Windows ainda compõe e a captura pega). Por
  // isso o aviso só sai com DUAS evidências: o Windows dizendo isso (com a janela transmitida na frente) E a captura falhando
  // de verdade (imagem preta, ou sem quadro novo por 12 s+ com a janela na frente). Só o Windows dizendo = "suspeita" (fica
  // no painel, sem aviso). Nunca para a transmissão. A captura em si não muda: nada é injetado no jogo.
  watchFse() {
    clearInterval(this._fse); this.fse = null;
    const d = window.lcDesktop; if (!d?.fseState) return;
    let busy = false, conf = 0, frozen = 0;
    const tick = async () => {
      if (!this.screen) return clearInterval(this._fse);
      if (busy) return; busy = true;
      try {
        const st = await d.fseState().catch(() => null); if (!this.screen) return;
        if (!st?.available) { this.fse = { state: null, available: false }; return; }
        const shell = st.state === 'd3d_fullscreen' && (st.kind !== 'window' || st.fgIsSource === true);
        // capturando quase nada: no nativo, quadros novos da WGC (cap); no Chromium, quadros do capturador
        const capNow = this.native ? this.native.stats?.cap : this.captureFps;
        frozen = shell && capNow != null && capNow < 2 && !this.screenNote ? frozen + 1 : 0;
        const bad = this.captureBlack || frozen >= FSE_FROZEN_TICKS;
        conf = shell && bad ? conf + 1 : 0;
        const prev = this.fse?.state, state = conf >= FSE_CONFIRM_TICKS ? 'confirmed' : shell ? 'suspected' : null;
        this.fse = { available: true, state, shell: st.state, fgIsSource: st.fgIsSource, black: !!this.captureBlack, frozenSecs: frozen * FSE_TICK / 1000 };
        if (state !== prev) {
          if (state === 'confirmed') {
            // no Chromium e o jogo em tela cheia exclusiva congelou a captura: passa para o nativo (DXGI) uma vez, sozinho
            if (!this.native && !this._fseNative && captureMode(this.prefs) !== 'chromium') {
              this._fseNative = true; this.capLog({ t: 'capnote', msg: 'tela cheia exclusiva congelou a captura do Chromium: tentando o programa nativo' });
              this.switchToNative().catch(() => { });
            } else this.onFse?.(this.fse);
          }
          this.onUpdate();
        }
      } finally { busy = false; }
    };
    tick(); this._fse = setInterval(tick, FSE_TICK);
  }
  // ---- painel da captura (M13): método atual, quadros por método, fps efetivo, motivo de não estar no nativo ----
  // Só o que já é medido (contadores do capturador do Chromium e do programa nativo, controle da transmissão, aviso de
  // tela cheia); nada disso vai para a telemetria (o resumo da chamada já leva caminho, motivo e codificador).
  async captureInfo() {
    if (!this.screen) return null;
    const n = this.native, o = this.screenOpts || {}, st = await this.screenStats().catch(() => null), top = st?.[0];
    const method = n ? (n.restarting ? 'restarting' : n.pending ? 'starting' : 'native') : 'chromium';
    const cm = n?.method || n?.stats?.m || null; // método da captura nativa em uso (wgc | dxgi): o evento de troca chega antes das estatísticas
    const CAPN = { wgc: 'WGC', dxgi: 'DXGI' };
    const label = { native: `Programa nativo (${CAPN[cm] || 'WGC'} → codificador da placa)`, starting: 'Programa nativo (iniciando)', restarting: 'Programa nativo (reiniciando após falha)', chromium: 'Modo normal (captura e codificação do Chromium)' }[method];
    const st0 = n?.stats || {}, cap = n?.capture || null;
    const cs = this.capStats || { chromium: { frames: 0, secs: 0 }, native: { frames: 0, sent: 0, secs: 0 } }, g = this.gov;
    return {
      method, label, want: { fps: +o.fps || 30, res: o.res || 1080 },
      captureFps: n ? (n.stats?.cap ?? null) : this.captureFps, sentFps: top?.fps ?? null, size: top?.w ? `${top.w}x${top.h}` : null, encoder: top?.enc || this.screenEncoder || '', limit: top?.limit || null,
      frames: [
        { id: 'native', name: 'Programa nativo (WGC/DXGI)', frames: cs.native.frames, secs: cs.native.secs, sent: cs.native.sent },
        { id: 'chromium', name: 'Chromium (capturador do navegador)', frames: cs.chromium.frames, secs: cs.chromium.secs },
      ],
      fallback: method === 'chromium' ? { code: this._natWhy || null, text: this._natWhyText || null } : null,
      restarts: this.natRestartCount || 0, lastError: this.natLastError || null,
      gov: g ? { note: g.note, step: g.ladder[g.level], layersOff: g.layersOff, top: g.ladder[0] } : null,
      fse: this.fse || null, chromiumSource: this._swapWhy || null, nativePrio: this.native?.prio || null, encoderBusy: this.native?.stats?.busy ?? null, nativeKbps: this.native?.stats?.kbps ?? null,
      // escolha do método (captura com WGC/DXGI): o pedido, o que o programa decidiu e por quê, e o histórico de trocas
      capture: {
        mode: captureMode(this.prefs), applied: n ? (cap?.mode || (this._capMode ? null : 'classic')) : null, active: method === 'chromium' ? 'chromium' : cm,
        candidate: st0.cand || null, plan: cap?.plan || null, order: cap?.order || null, os: cap?.os || null, openErrors: cap?.openErrors || [],
        srcSize: st0.srcW ? `${st0.srcW}x${st0.srcH}` : null, outSize: n?.w ? `${n.w}x${n.h}` : null, capFps: n ? (st0.cap ?? null) : this.captureFps, encFps: n ? (st0.fps ?? null) : top?.fps ?? null,
        repeats: st0.repeats ?? null, cpu: st0.cpu ?? null, encMs: st0.encMs ?? null, kbps: st0.kbps ?? null, black: st0.black ?? null, overlap: !!(n?.overlap ?? st0.overlap), errs: st0.errs ?? 0, lastErr: st0.lastErr || null, rebuilds: st0.rebuilds ?? 0,
        fullscreen: st0.fs ?? null, info: st0.info || cap?.info || null, note: this._capNote || null, sim: !!cap?.sim,
        history: (this.capHist || []).slice(-40),
      },
    };
  }
  // Captura saindo preta (tela cheia exclusiva, anti-cheat): a cada 2 s olha UM quadro da trilha numa grade de 32x18
  // pontos; tudo preto 3 vezes seguidas = aviso. Lê os pixels direto do quadro (MediaStreamTrackProcessor + copyTo, num
  // buffer reaproveitado). Antes um <video> fora da página era desenhado num canvas: cada quadro desenhado ia para um
  // cache do Chromium que só esvazia quando falta memória (+~3,7 MB a cada 2 s transmitindo, até centenas de MB), e o
  // <video> decodificava e compunha a transmissão inteira o tempo todo. Sem o processador (navegador antigo): como antes.
  meterBlack() {
    clearInterval(this._bk); this.captureBlack = false; let n = 0, src = null;
    const verdict = (mx) => {
      n = mx <= 6 ? n + 1 : 0;
      const black = n >= 3;
      if (black !== this.captureBlack) { this.captureBlack = black; this.onBlackCapture?.(black); this.onUpdate?.(); }
    };
    if (typeof MediaStreamTrackProcessor === 'function') {
      let track = null, reader = null, buf = null, busy = false;
      const close = () => { try { reader?.cancel(); } catch { } reader = null; track = null; };
      this._bk = setInterval(async () => {
        const st = this.screen; if (!st) { clearInterval(this._bk); close(); return; }
        if (src !== st) { src = st; n = 0; }
        const t = st.getVideoTracks()[0];
        if (t !== track) { close(); if (!t || t.readyState !== 'live') return; track = t; try { reader = new MediaStreamTrackProcessor({ track: t }).readable.getReader(); } catch { reader = null; } }
        if (!reader || busy) return;
        busy = true; let f = null;
        try {
          f = (await reader.read()).value; if (!f || this.screen !== st) return; // sem quadro agora (janela minimizada)
          const size = f.allocationSize(); if (!buf || buf.length < size) buf = new Uint8Array(size);
          const layout = await f.copyTo(buf), mx = frameMax(f, buf, layout);
          if (mx != null) verdict(mx);
        } catch { /* quadro inválido: tenta no próximo */ } finally { f?.close(); busy = false; }
      }, 2000);
      return;
    }
    const v = document.createElement('video'); v.muted = true; v.playsInline = true;
    const c = document.createElement('canvas'); c.width = 32; c.height = 18; const x = c.getContext('2d', { willReadFrequently: true });
    this._bk = setInterval(() => {
      const st = this.screen; if (!st) { clearInterval(this._bk); v.srcObject = null; return; }
      if (src !== st) { src = st; n = 0; v.srcObject = new MediaStream(st.getVideoTracks()); v.play?.().catch(() => { }); }
      if (v.readyState < 2 || !v.videoWidth) return; // ainda sem quadro
      let mx = 0;
      try { x.drawImage(v, 0, 0, 32, 18); const d = x.getImageData(0, 0, 32, 18).data; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); } catch { return; }
      verdict(mx);
    }, 2000);
  }
  // janela transmitida minimizada ou fechada (app desktop): o Windows para de entregar quadros e quem assiste via a imagem
  // congelada sem saber por quê. A cada 3 s pergunta ao app; muda o estado da transmissão (quem assiste vê o aviso) e
  // avisa quem transmite (onScreenNote). Tela inteira não tem esse problema. O app também avisa na hora em que a janela
  // muda (onSourceState: eventos do Windows); a consulta de 3 s fica de garantia (com o programa nativo aberto ela não
  // abre processo nenhum).
  // Modo reserva do Windows 10 (jogo em tela cheia, nativo fora): o Chromium manda o MONITOR do jogo (chromiumOnWindow), e
  // no Alt+Tab quem assiste veria a janela da frente (navegador, conversa...). O app avisa quando o jogo some do monitor
  // (lc-audio 'over': minimizado ou outra janela por cima, a mesma regra do DXGI do lc-stream) e o vídeo da transmissão
  // pausa: nada sai do PC, quem assiste fica com a última imagem do jogo e o aviso "O jogo não está na tela". Volta
  // sozinho com o jogo. Só vale enquanto o Chromium manda o monitor no lugar da janela: com o nativo ou com a captura da
  // janela, nada muda. App ou programa nativo sem 'over': nunca avisa (como antes).
  watchOver() {
    this._overOn = false; this._overHid = false;
    const d = window.lcDesktop, id = this._natWinId;
    if (!d?.watchSourceOver || !id) return;
    // até o 1º aviso chegar (vem logo, o programa reavisa o estado atual) conta como fora da tela: ao começar, a Resenha
    // costuma estar na frente do jogo e o monitor mostraria ela. Sem o aviso nesta versão do app, volta ao normal.
    this._overOn = true; this._overWhy = 'front';
    let got = false;
    d.onSourceOver?.((s) => { got = true; this._overOn = !!s?.covered; this._overWhy = s?.why || null; this.applyOver(); });
    d.watchSourceOver(id).then((ok) => { if (!ok && !got && this._natWinId === id) { this._overOn = false; this.applyOver(); } }, () => { if (!got) { this._overOn = false; this.applyOver(); } });
  }
  // o Chromium está mandando o monitor do jogo (não a janela, nem o nativo)?
  monForGame() { return !!this._natWinId && !this.native && !!this.screen; }
  applyOver() {
    const want = !!this._overOn && this.monForGame(), p = this.sfu?.producers.screen;
    // sem quadros saindo: o rtpSender fica sem trilha (não p.pause(): com disableTrackOnPause ele desliga a trilha, que vira
    // quadros pretos e apaga a prévia de quem transmite). A trilha continua viva; ao voltar, a mesma trilha volta ao envio
    if (p && !p.closed && !!p.lcHidden !== want) {
      p.lcHidden = want;
      p.rtpSender?.replaceTrack(want ? null : (p.track || this.screen?.getVideoTracks()[0] || null)).catch(() => { });
      this.sfuReq('pause_producer', { source: 'screen', paused: want }).catch(() => { }); // servidor antigo: só a pausa daqui
    }
    if (want === this._overHid) return;
    this._overHid = want;
    this.capLog({ t: 'capnote', msg: want ? `jogo fora do monitor capturado (${this._overWhy === 'min' ? 'minimizado' : 'outra janela na frente'}): vídeo pausado, quem assiste vê a última imagem` : 'jogo de volta na tela: vídeo retomado' });
    const keep = this.screenNote === 'min' || this.screenNote === 'closed'; // aviso mais específico fica
    const note = want ? (keep ? this.screenNote : 'away') : (this.screenNote === 'away' ? null : this.screenNote);
    if (note !== this.screenNote) { this.screenNote = note; this.sendState(); this.onScreenNote?.(note); }
    this.onUpdate();
  }
  watchSource() {
    clearInterval(this._src); this.screenNote = null;
    const d = window.lcDesktop; if (!d?.sourceState) return;
    const apply = (st) => {
      if (!this.screen) return;
      let note = st?.kind === 'window' ? (st.exists === false ? 'closed' : st.minimized ? 'min' : null) : null;
      if (!note && this._overHid) note = 'away'; // jogo fora do monitor capturado (applyOver)
      if (note !== this.screenNote) { this.screenNote = note; this.sendState(); this.onScreenNote?.(note); this.onUpdate(); }
    };
    d.onSourceState?.(apply);
    let busy = false;
    this._src = setInterval(async () => {
      if (!this.screen) return clearInterval(this._src);
      if (busy) return; busy = true;
      try { apply(await d.sourceState()); } catch { } finally { busy = false; }
    }, 3000);
  }
  // selo de saúde da transmissão para quem transmite: { level: 'ok' | 'warn' | 'bad', fps, items: [[nível, texto]] }
  async screenHealth() {
    if (!this.screen) return null;
    const o = this.screenOpts || {}, want = +o.fps || 30, items = [];
    const st = await this.screenStats().catch(() => null), top = st?.[0];
    if (!this.screen) return null; // a transmissão parou enquanto lia as estatísticas (this.screen.getAudioTracks quebrava logo abaixo)
    const fps = this.captureFps ?? top?.fps ?? null;
    if (this.screenNote === 'min') items.push(['bad', 'Janela minimizada: quem assiste vê a imagem parada. Restaure a janela (ou transmita a tela inteira).']);
    if (this.screenNote === 'closed') items.push(['bad', 'A janela transmitida foi fechada. Escolha outra fonte.']);
    if (this.screenNote === 'away') items.push(['warn', 'O jogo saiu da tela: quem assiste vê a última imagem do jogo (e não a janela da frente) até você voltar para ele.']);
    if (this.fse?.state === 'confirmed') items.push(['bad', 'O jogo parece estar em tela cheia exclusiva: a captura não recebe a imagem. Mude o jogo para "Janela sem bordas" (a transmissão continua).']);
    else if (this.captureBlack) items.push(['bad', 'A imagem está saindo preta (tela cheia exclusiva ou anti-cheat). Use "Janela sem bordas".']);
    if (this.appAudio?.state === 'waiting') items.push(['bad', `${this.appAudio.name || 'O jogo'} fechou: o áudio volta sozinho quando ele abrir de novo.`]);
    if (fps != null && !this.screenNote && fps < want * 0.6 && fps < 50) items.push(['warn', `${fps} de ${want} fps: ${top?.limit === 'cpu' ? 'o processador está no limite' : top?.limit === 'bandwidth' ? 'a internet está no limite' : 'a fonte está entregando menos quadros (conteúdo parado também conta)'}.`]);
    else if (top?.limit === 'bandwidth') items.push(['warn', 'A internet está limitando a qualidade.']);
    else if (top?.limit === 'cpu') items.push(['warn', 'O processador está limitando a qualidade.']);
    const audio = !o.audio ? 'sem áudio' : this.appAudio ? (this.appAudio.mode === 'exclude' ? 'áudio do PC (menos a Resenha)' : this.appAudio.mode === 'screen' ? 'áudio só desta tela' : `áudio de ${this.appAudio.name || 'jogo'}`) : (this.screen.getAudioTracks().length ? 'áudio do sistema' : 'sem áudio');
    const level = items.some(i => i[0] === 'bad') ? 'bad' : items.length ? 'warn' : 'ok';
    return { level, fps, want, audio, items };
  }
  // fps REAL de captura: quadros que o capturador entregou ao pipeline (media-source.frames do remetente), contados a cada segundo
  // e suavizados em ~3 s. Independe do fps pedido: mostra o que o capturador (Chromium) de fato produz.
  meterCapture() {
    clearInterval(this._cm); this.captureFps = null; const hist = [];
    const read = async () => {
      const p = this.sfu?.producers.screen;
      const rep = p ? await p.getStats() : await this.peers.values().next().value?.senders.screenvideo?.getStats();
      let frames = null; rep?.forEach(r => { if (r.type === 'media-source' && r.kind === 'video') frames = r.frames; });
      return frames;
    };
    this._cm = setInterval(async () => {
      if (!this.screen) return clearInterval(this._cm);
      if (this.native) { this.captureFps = this.native.stats ? this.native.stats.fps : null; hist.length = 0; return; } // quadros que o programa nativo enviou
      let f; try { f = await read(); } catch { return; }
      if (f == null) return;
      const now = performance.now(); hist.push([now, f]); while (hist.length > 1 && now - hist[0][0] > 3500) hist.shift();
      if (hist.length < 2) return; // um intervalo de uma troca de fonte (contador recomeça) é descartado
      const [t0, f0] = hist[0]; if (f < f0) { hist.splice(0, hist.length - 1); return; }
      this.captureFps = Math.round((f - f0) / ((now - t0) / 1000));
      const prev = hist.at(-2)?.[1]; if (this.capStats && prev != null && f >= prev) { this.capStats.chromium.frames += f - prev; this.capStats.chromium.secs++; }
    }, 1000);
  }
  // se o PC ou a internet de quem transmite limitam a imagem por vários segundos, baixa um degrau (nunca sobe sozinho)
  watchScreen() {
    clearInterval(this._sw); let bad = 0, wait = 0;
    if (!this.prefs?.autoQuality) return; // o app não rebaixa fps/resolução sozinho: só se a pessoa ligar a opção
    this._sw = setInterval(async () => {
      if (!this.screen) return clearInterval(this._sw);
      const st = await this.screenStats(); const top = st?.[0]; if (!top || !top.w) return;
      if (wait > 0) { wait--; return; }
      if (top.limit === 'cpu' || top.limit === 'bandwidth') bad++; else bad = Math.max(0, bad - 1);
      if (bad < 6) return;
      bad = 0; wait = 8;
      const o = this.screenOpts || {};
      const next = o.fps > 30 ? { fps: 30 } : o.res === 'source' || o.res >= 1440 ? { res: 1080 } : o.res === 1080 ? { res: 720 } : null;
      if (!next) return;
      this.autoNote = `Seu ${top.limit === 'cpu' ? 'PC' : 'upload'} está limitando a imagem: reduzi para ${next.fps ? next.fps + ' fps' : next.res + 'p'}.`;
      await this.changeScreenQuality(next); this.onAutoAdjust?.(this.autoNote, next);
    }, 2000);
  }
  // ---- controle da qualidade da transmissão pelo Chromium quando o codificador não dá conta (M2 + M3) ----
  // Sem ele, o Chromium (maintain-framerate) encolhia a imagem sozinho: 1080p -> 720p -> 540p com o processador no limite,
  // e o servidor mandava a camada "Alta" já encolhida (960x540 relatado). Agora, com o codificador sobrecarregado por 6 s:
  //  1. desliga as camadas pequenas do simulcast se nenhum espectador precisa delas (medido: 1080p a 52-57 fps em vez de
  //     36-40 com 3 camadas no mesmo processador). Voltam quando alguém com banda fraca aparece (op 'screen_viewers').
  //  2. desce um degrau de custo (pixels x fps), mantendo a resolução enquanto der: 1080p60 -> 1080p48 -> 1080p40 ->
  //     900p48 -> 720p60 -> 720p40. Nunca abaixo de 720p por conta própria (o codificador fica em maintain-resolution).
  //  3. com folga por 30 s, sobe um degrau; se a sobrecarga voltar logo depois, espera o dobro antes de tentar de novo.
  // O ajuste é só no codificador (a captura não muda). Desligado com "qualidade automática" (watchScreen, o modo antigo),
  // no programa nativo e na malha P2P.
  govLadder() {
    const o = this.screenOpts || {}, vt = this.screen?.getVideoTracks()[0];
    const H = o.res === 'source' ? (vt?.getSettings?.().height || 1080) : +o.res || 1080, F = +o.fps || 30;
    const L = [{ h: H, f: F }];
    for (const f of [60, 48, 40]) if (F > f && L.at(-1).f > f) L.push({ h: H, f });
    for (const h of [1080, 900, 720]) if (h < H) L.push({ h, f: h === 720 ? F : Math.min(F, 48) });
    if (H >= 720 && F > 40) L.push({ h: Math.min(H, 720), f: 40 });
    const out = []; for (const x of L) if (!out.length || x.h * x.h * x.f < out.at(-1).h * out.at(-1).h * out.at(-1).f) out.push(x); // só degraus que custam menos (pixels x fps)
    return out;
  }
  govStart() {
    clearInterval(this._gt); this.gov = null;
    if (!this.screen || this.native || !this.sfu?.producers.screen || this.prefs?.autoQuality) return;
    const g = this.gov = { ladder: this.govLadder(), level: 0, layersOff: false, bad: 0, good: 0, upWait: 15, upAt: 0, cool: 0, steps: [], note: '' };
    this._gt = setInterval(() => this.govTick(g).catch(() => { }), GOV_TICK);
    // modo leve: começa sem as camadas pequenas do simulcast (são mais 2 codificações da tela; ~30% a mais de trabalho,
    // tudo no processador quando não há H.264 na placa de vídeo). Sem isso elas só saíam com o codificador já no limite,
    // e num PC com o processador apertado (jogo + aquecimento) quem perdia FPS era o jogo. Voltam sozinhas quando um
    // espectador com internet fraca precisa delas (govTick consulta 'screen_viewers' a cada GOV_VIEWERS_MS)
    if (this.prefs?.lightMode && (this.sfu.producers.screen.rtpSender?.getParameters().encodings?.length || 0) > 1)
      this.govApply(g, { layersOff: true }, 'Modo leve: camadas leves desligadas (menos trabalho para o processador).').catch(() => { });
  }
  async govTick(g) {
    if (this.gov !== g || !this.screen || this.native) { clearInterval(this._gt); return; }
    const p = this.sfu?.producers.screen; if (!p?.rtpSender) return;
    if (g.cool > 0) { g.cool--; return; }
    let top = null;
    (await p.rtpSender.getStats()).forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video' && (r.frameHeight || 0) >= (top?.frameHeight || 0) && r.framesPerSecond) top = r; });
    if (!top || this.gov !== g) return;
    const lv = g.ladder[g.level], cap = this.captureFps || lv.f, want = Math.min(lv.f, cap);
    const shrunk = (top.frameHeight || 0) < Math.min(lv.h, this.screen.getVideoTracks()[0]?.getSettings?.().height || lv.h) * 0.9;
    const slow = (top.framesPerSecond || 0) < want * 0.8;
    const over = top.qualityLimitationReason === 'cpu' || slow || shrunk;
    if (over) { g.bad++; g.good = 0; } else { g.bad = 0; if (top.qualityLimitationReason === 'none') g.good++; }
    // espectador com banda fraca (ou perda) precisando da camada pequena: religa as camadas, mesmo custando processador
    if (g.layersOff && Date.now() - (g.vAt || 0) > GOV_VIEWERS_MS) {
      g.vAt = Date.now();
      const v = await this.sfuReq('screen_viewers').catch(() => null), topBps = bitrateFor(this.screenOpts?.res || 1080, lv.f, this.screenOpts?.bitrate, isGameShare(this.screenOpts));
      if (v?.viewers?.some(x => (x.avail && x.avail < topBps * 1.1) || (x.score != null && x.score < 7))) return this.govApply(g, { layersOff: false }, 'Um espectador com internet fraca: camadas leves religadas.');
    }
    if (g.bad >= GOV_BAD) {
      if (g.upAt && Date.now() - g.upAt < 20e3) g.upWait = Math.min(g.upWait * 2, 150); // subiu e não aguentou: espera mais
      g.upAt = 0;
      if (!g.layersOff && (p.rtpSender.getParameters().encodings?.length || 0) > 1) {
        const v = await this.sfuReq('screen_viewers').catch(() => null), topBps = bitrateFor(this.screenOpts?.res || 1080, lv.f, this.screenOpts?.bitrate, isGameShare(this.screenOpts));
        const need = v?.viewers?.some(x => (x.avail && x.avail < topBps * 1.1) || (x.score != null && x.score < 7));
        if (!need) return this.govApply(g, { layersOff: true }, 'Processador no limite: camadas leves desligadas (ninguém precisava delas).');
      }
      if (g.level < g.ladder.length - 1) { const n = g.ladder[g.level + 1]; return this.govApply(g, { level: g.level + 1 }, `Processador no limite: ${n.h}p a ${n.f} FPS.`); }
      g.bad = 0; return;
    }
    if (g.good >= g.upWait / (GOV_TICK / 1000) && g.level > 0) { const n = g.ladder[g.level - 1]; g.upAt = Date.now(); return this.govApply(g, { level: g.level - 1 }, `Folga no processador: voltando a ${n.h}p a ${n.f} FPS.`); }
  }
  // uma aplicação por vez, na ordem (o controle e a troca de qualidade mexem nos mesmos parâmetros do codificador)
  govApply(g, ch, note) { return (this._govP = Promise.resolve(this._govP).catch(() => { }).then(() => this.govApplyNow(g, ch, note))); }
  async govApplyNow(g, ch, note) {
    const p = this.sfu?.producers.screen; if (!p?.rtpSender || this.gov !== g) return;
    Object.assign(g, ch); g.bad = 0; g.good = 0; g.cool = 2; g.note = note; g.steps.push({ at: Date.now(), note }); if (g.steps.length > 20) g.steps.shift();
    this.capLog({ t: 'capnote', msg: 'controle da transmissão: ' + note }); // cada troca reconfigura o codificador: quem assiste pode ver um corte
    g.applying = true; // os parâmetros mudam em duas etapas (passando por 'balanced'); quem lê o estado espera terminar
    const lv = g.ladder[g.level], capH = this.screen?.getVideoTracks()[0]?.getSettings?.().height || lv.h, s = Math.max(1, capH / lv.h);
    try {
      const prm = p.rtpSender.getParameters(), n = prm.encodings.length;
      prm.encodings.forEach((e, i) => { e.scaleResolutionDownBy = s * 2 ** (n - 1 - i); e.maxFramerate = lv.f; if (i < n - 1) e.active = !g.layersOff; });
      // engajado: a resolução fica com este controle (o codificador derruba quadros, não a imagem)
      // passar por 'balanced' zera as restrições que o próprio WebRTC acumulou (ex.: fps cortado por CPU em 1080p). Sem
      // isso, depois de descer para 720p o fps ficava preso nos ~34 da restrição antiga (medido: 720p fixo desde o
      // início dá 60 fps sem limite no mesmo processador)
      prm.degradationPreference = 'balanced'; await p.rtpSender.setParameters(prm);
      if (this.gov !== g) return; // a qualidade mudou (ou a transmissão parou) no meio: não sobrescreve o que veio depois
      const p2 = p.rtpSender.getParameters();
      p2.degradationPreference = g.level > 0 || g.layersOff || this.screenOpts?.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await p.rtpSender.setParameters(p2);
    } catch (e) { console.warn('controle da transmissão', e); } finally { g.applying = false; }
    this.onUpdate();
  }
  async sfuTuneScreen() {
    const p = this.sfu?.producers.screen; if (!p?.rtpSender) return;
    // qualidade nova: desliga o controle já (uma aplicação dele em andamento desiste) e espera ela soltar os parâmetros
    clearInterval(this._gt); this.gov = null; await Promise.resolve(this._govP).catch(() => { });
    try {
      const prm = p.rtpSender.getParameters(), enc = this.sfuEncodings('screen');
      prm.encodings.forEach((e, i) => { const { scalabilityMode, ...rest } = enc[i] || {}; Object.assign(e, rest); e.active = true; }); // scalabilityMode não muda depois de criado; camadas que o controle desligou voltam
      prm.degradationPreference = this.screenOpts?.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await p.rtpSender.setParameters(prm);
    } catch (e) { console.warn('screen params', e); }
    // teto de fps no codificador (a captura tem 25% de folga, capFps). À parte: se esta versão do Chromium recusar
    // maxFramerate no simulcast, o resto (taxa e preferência) já ficou aplicado acima
    try {
      const fps = +this.screenOpts?.fps || 30, prm = p.rtpSender.getParameters();
      if (prm.encodings?.length && prm.encodings.some(e => e.maxFramerate !== fps)) { prm.encodings.forEach(e => { e.maxFramerate = fps; }); await p.rtpSender.setParameters(prm); }
    } catch { }
    this.govStart(); // qualidade nova escolhida (ou transmissão nova): o controle recomeça do topo
  }
  // ---- chamada protegida: cada envio/recebimento passa pelo worker que cifra/decifra os quadros (e2ee-worker.js) ----
  e2eeLegacy() { return !!this.e2ee && !window.RTCRtpScriptTransform; } // Chromium sem RTCRtpScriptTransform: createEncodedStreams
  e2eeAttach(t, op) {
    if (!this.e2ee || !t || t._e2) return t;
    if (!this.e2eeWorker) {
      this.e2eeWorker = new Worker('/e2ee-worker.js');
      this.e2eeWorker.onmessage = (e) => { if (e.data?.stats) this.e2eeWorkerStats = e.data.stats; };
    }
    t._e2 = true;
    if (window.RTCRtpScriptTransform) t.transform = new RTCRtpScriptTransform(this.e2eeWorker, { op, key: this.e2ee });
    else if (t.createEncodedStreams) { const { readable, writable } = t.createEncodedStreams(); this.e2eeWorker.postMessage({ op, key: this.e2ee, readable, writable }, [readable, writable]); }
    return t;
  }
  // malha P2P: o receptor da mesma linha também precisa da cifra ANTES da negociação (o Chromium ignora a que entra depois)
  p2pAdd(pc, track, stream) {
    const snd = this.e2eeAttach(pc.addTrack(track, stream), 'enc');
    if (this.e2ee) this.e2eeAttach(pc.getTransceivers().find(t => t.sender === snd)?.receiver, 'dec');
    return snd;
  }
  ensurePeer(uid) {
    let p = this.peers.get(uid);
    if (!p) this.peers.set(uid, p = { uid, streams: {}, meta: {}, audioEl: null, screenAudioEl: null, senders: {}, consumers: new Map() });
    return p;
  }
  async onSfuProducer({ producer_id, user_id, source, channel_id }) {
    const s = this.sfu;
    if (!s?.ready || channel_id && channel_id !== s.cid || s.seen.has(producer_id) || user_id === this.myId) return;
    s.seen.add(producer_id);
    try {
      const r = await this.sfuReq('consume', { transport_id: s.recv.id, producer_id, rtpCapabilities: s.device.rtpCapabilities });
      // clipes das transmissões dos outros ligados: o worker que guarda os quadros comprimidos (clipbuf.js attachTap) entra
      // DURANTE a negociação (onRtpReceiver). Colocado logo depois do consume() (como a cifra, logo abaixo, que funciona
      // assim), ele não recebeu nenhum quadro da transmissão de tela no Chromium 153 — causa não esclarecida; pelo
      // onRtpReceiver funciona sempre (scripts/clip-tap-test.mjs). Até um buffer de clipe pedir, só deixa passar (screenTap)
      let tap = null;
      const wantTap = source === 'screen' && !this.e2ee && this.prefs?.clipsOn !== false;
      // sincronia áudio/vídeo: o Chromium só alinha um vídeo com o áudio do mesmo "stream". Sem dizer qual, todos os
      // envios de uma pessoa (microfone, câmera, tela e áudio da tela) caíam no mesmo grupo e o vídeo da tela era
      // alinhado com o MICROFONE; o áudio do jogo ficava solto e cada um via um atraso diferente (para um o áudio
      // atrasado, para outro o vídeo). Agora: tela + áudio da tela juntos; câmera + microfone juntos.
      const streamId = `${user_id}-${source === 'screen' || source === 'screenaudio' ? 'screen' : 'cam'}`;
      const c = await s.recv.consume({ id: r.id, producerId: r.producer_id, kind: r.kind, rtpParameters: r.rtpParameters, streamId, ...(wantTap ? { onRtpReceiver: (rx) => { tap = attachTap(rx, r.rtpParameters?.codecs?.[0]?.mimeType); } } : {}) });
      if (this.sfu !== s) { tap?.close(); return c.close(); }
      this.e2eeAttach(c.rtpReceiver, 'dec');
      if (s.closedEarly?.delete(r.id)) { c.close(); tap?.close(); s.seen.delete(producer_id); return; } // a transmissão acabou enquanto preparava
      const p = this.ensurePeer(user_id), stream = new MediaStream([c.track]);
      s.consumers.set(c.id, { c, uid: user_id, source, tap });
      p.consumers.set(c.id, source); p.layer = undefined;
      if (source === 'mic') this.attachAudio(p, stream, 'mic', c.rtpReceiver);
      else if (source === 'screenaudio') this.attachAudio(p, stream, 'screen');
      else { p.streams[source] = stream; c.track.onmute = c.track.onunmute = () => this.onUpdate(); }
      if (source === 'cam') await this.sfuReq('layers', { consumer_id: c.id, spatial: p.camLayer ?? 1 }).catch(() => { }); // antes do 1º quadro: sem isso chegava a camada cheia
      const held = (source === 'screen' || source === 'screenaudio') && this.closedStreams.has(user_id) // transmissão fechada: nem baixa o vídeo
        || source === 'mic' && s.voiceOff // ensurdecido com a janela escondida (syncVoiceFlow)
        || source === 'cam' && p.camPaused; // quadro da câmera fora de vista (camFlow)
      if (!held) await this.sfuReq('resume', { consumer_id: c.id });
      this.onUpdate();
    } catch (e) { console.warn('consume', e); s.seen.delete(producer_id); }
  }
  // Clipe da transmissão de outra pessoa direto dos quadros comprimidos que chegam (clipbuf.js createTapBuffer): o receptor
  // do vídeo, o codec, o pedido de quadro-chave ao servidor e o atraso entre chegar e aparecer na tela (para alinhar com
  // o áudio, que é gravado já tocando). null: chamada protegida (a cifra ocupa o receptor), malha P2P ou ainda chegando.
  // A sua transmissão pelo Chromium com os clipes ligados: os quadros que o próprio enviador comprimiu (sfuProduce). O
  // áudio é gravado na hora da captura, como o vídeo: sem atraso a compensar. null: sem o encaixe (clipes ligados com a
  // transmissão já no ar, chamada protegida, pelo programa nativo) -> clips.js usa o MediaRecorder, como antes.
  ownTap() {
    const t = this._ownTap; if (!t?.codec || this.native || this.e2ee || this.sfu?.producers.screen?.closed !== false) return null;
    if (t.delayMs) return t; // o mesmo objeto a cada redesenho (clips.js compara)
    return Object.assign(t, { delayMs: async () => 0, size: () => { const st = this.screen?.getVideoTracks()[0]?.getSettings?.() || {}; return { w: st.width, h: st.height }; } });
  }
  screenTap(uid) {
    const s = this.sfu; if (this.e2ee || !s?.ready) return null;
    const e = [...s.consumers.values()].filter(x => x.uid === uid && x.source === 'screen' && !x.c.closed).at(-1); if (!e?.tap) return null;
    const c = e.c;
    if (e.tap.requestKey) return e.tap; // o mesmo objeto a cada redesenho (clips.js compara)
    return Object.assign(e.tap, {
      requestKey: () => this.sfuReq('keyframe', { consumer_id: c.id }).catch(() => { }),
      delayMs: async () => { let d = 0; (await c.rtpReceiver.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video' && r.jitterBufferEmittedCount > 0) d = r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000; }); return d; },
      size: () => { const t = c.track.getSettings?.() || {}; return { w: t.width, h: t.height }; },
    });
  }
  // Assiste um producer qualquer da sala, inclusive o próprio (teste da transmissão nativa: o vídeo faz a volta pelo servidor)
  async watchProducer(producer_id) {
    const s = this.sfu; if (!s?.ready) throw new Error('A voz ainda não conectou ao servidor');
    const r = await this.sfuReq('consume', { transport_id: s.recv.id, producer_id, rtpCapabilities: s.device.rtpCapabilities });
    const c = await s.recv.consume({ id: r.id, producerId: r.producer_id, kind: r.kind, rtpParameters: r.rtpParameters });
    this.e2eeAttach(c.rtpReceiver, 'dec');
    await this.sfuReq('resume', { consumer_id: c.id });
    return { track: c.track, consumer: c, close: () => { try { c.close(); } catch { } } };
  }
  onSfuConsumerClosed({ consumer_id }) {
    const e = this.sfu?.consumers.get(consumer_id);
    if (!e) { if (this.sfu) (this.sfu.closedEarly ||= new Set()).add(consumer_id); return; } // ainda chegando (onSfuProducer)
    this.sfu.consumers.delete(consumer_id); e.c.close(); e.tap?.close();
    const p = this.peers.get(e.uid); if (!p) return;
    p.consumers.delete(consumer_id);
    if (e.source === 'mic') { p.audioEl?.remove(); p.audioEl = null; this.analysers.get(e.uid)?.src.disconnect(); this.analysers.delete(e.uid); this.speaking.delete(e.uid); }
    else if (e.source === 'screenaudio') { p.screenAudioEl?.remove(); p.screenAudioEl = null; }
    else delete p.streams[e.source];
    this.onUpdate();
  }

  connect(uid, initiator) {
    if (this.peers.has(uid)) return this.peers.get(uid);
    const pc = new RTCPeerConnection({ iceServers: this.ice, ...(this.e2eeLegacy() ? { encodedInsertableStreams: true } : {}) });
    const p = { uid, pc, polite: this.myId > uid, making: false, ignore: false, streams: {}, meta: {}, audioEl: null, screenAudioEl: null, senders: {} };
    this.peers.set(uid, p);
    pc.onicecandidate = (e) => e.candidate && this.send('VOICE_SIGNAL', { to: uid, data: { cand: e.candidate } });
    pc.onnegotiationneeded = async () => {
      try { p.making = true; await this.setLocal(pc); this.send('VOICE_SIGNAL', { to: uid, data: { desc: pc.localDescription } }); }
      catch (e) { console.warn('negotiation', e); } finally { p.making = false; }
    };
    pc.ontrack = (e) => {
      this.e2eeAttach(e.receiver, 'dec');
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (e.track.kind === 'audio') this.attachAudio(p, stream, p.meta[stream.id] === 'screen' ? 'screen' : 'mic', e.receiver);
      else {
        const kind = p.meta[stream.id] || 'cam';
        p.streams[kind] = stream;
        e.track.onmute = e.track.onunmute = e.track.onended = () => this.onUpdate();
        stream.onremovetrack = () => { if (!stream.getTracks().length) delete p.streams[kind]; this.onUpdate(); };
      }
      this.onUpdate();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') this._cq?.drop(); if (pc.connectionState === 'failed') pc.restartIce?.(); this.onUpdate(true); };
    this.addLocalTracks(p);
    this.sendMeta(uid);
    return p;
  }
  addLocalTracks(p) {
    const add = (stream, kind) => stream?.getTracks().forEach(t => { p.senders[kind + t.kind] = this.p2pAdd(p.pc, t, stream); });
    add(this.mic, 'mic'); add(this.cam, 'cam'); add(this.screen, 'screen'); this.tuneAudio(p);
    // sem microfone (ouvinte): garante uma linha de áudio só-recepção para a negociação acontecer e a pessoa ouvir os outros
    if (!this.mic && !p.pc.getTransceivers().length) { const tr = p.pc.addTransceiver('audio', { direction: 'recvonly' }); this.e2eeAttach(tr.sender, 'enc'); this.e2eeAttach(tr.receiver, 'dec'); }
    if (this.screen) this.tuneSender(p, 'screenvideo', 'screen'); if (this.cam) this.tuneSender(p, 'camvideo', 'cam');
  }
  async setLocal(pc) {
    const d = pc.signalingState === 'have-remote-offer' ? await pc.createAnswer() : await pc.createOffer();
    await pc.setLocalDescription({ type: d.type, sdp: opusHi(d.sdp) });
  }
  // taxa de bits da voz em kbps: a escolhida ou, no automático, a do último ajuste
  micKbps() { const v = this.prefs.voiceBitrate; return v === 'auto' || v == null ? this.autoKbps : Math.min(+v || 64, OPUS_MAX); }
  tuneAudio(p, delay = 800) { // taxa de bits da voz (kbps) e prioridade
    const s = this.sfu ? this.sfu.producers.mic?.rtpSender : p?.senders.micaudio; if (!s) return;
    setTimeout(async () => { try { const prm = s.getParameters(); if (!prm.encodings?.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = this.micKbps() * 1000; prm.encodings[0].priority = 'high'; await s.setParameters(prm); } catch { } }, delay);
  }
  retuneAudio() { if (this.sfu) this.tuneAudio(null, 0); else this.peers.forEach(p => this.tuneAudio(p, 0)); }
  // modo automático: escolhe 64/128/256/384 kbps pela banda disponível, perda e latência do envio
  async adaptAudio() {
    if (this.prefs.voiceBitrate !== 'auto' && this.prefs.voiceBitrate != null) return;
    const pcs = this.sfu ? [this.sfu.send].filter(Boolean) : [...this.peers.values()].map(p => p.pc);
    let avail = Infinity, loss = 0, rtt = 0, seen = false, sent = 0;
    for (const pc of pcs) {
      try {
        for (const r of (await pc.getStats()).values()) {
          if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded')) {
            seen = true; if (r.availableOutgoingBitrate) avail = Math.min(avail, r.availableOutgoingBitrate); if (r.currentRoundTripTime) rtt = Math.max(rtt, r.currentRoundTripTime * 1000);
          }
          if (r.type === 'remote-inbound-rtp' && r.kind === 'audio' && r.fractionLost != null) loss = Math.max(loss, r.fractionLost);
          if (r.type === 'outbound-rtp' && r.kind === 'audio' && r.bytesSent != null) sent += r.bytesSent;
        }
      } catch { }
    }
    const now = Date.now();
    if (this.lastSent && now > this.lastSent.t) this.sentKbps = Math.max(0, Math.round((sent - this.lastSent.b) * 8 / (now - this.lastSent.t)));
    this.lastSent = { t: now, b: sent };
    if (!seen) { this.adaptFrom = null; return; }
    if (this.adaptFrom == null) { this.adaptFrom = now; this.autoAt = now; } // nova conexão: espera estabilizar antes de subir
    // a voz não deve passar de ~1/4 da banda (vídeo e tela dividem o mesmo link).
    // A estimativa de banda começa baixa e sobe nos primeiros segundos: só vale depois de 10 s e se repetir duas leituras seguidas
    const share = avail === Infinity || now - this.adaptFrom < 10000 ? Infinity : avail / 4000;
    const byBw = [...AUTO_STEPS].reverse().find(k => k <= share) || AUTO_STEPS[0], bwLow = byBw < this.autoKbps && this.bwLowPrev;
    this.bwLowPrev = byBw < this.autoKbps;
    // (no SFU, `loss` é a pior perda entre quem te ouve, de propósito do mediasoup: baixar a taxa e mandar mais correção
    // ajuda o ouvinte com internet ruim; por isso aqui fica o RTCP, e não a perda de verdade do seu envio)
    // perda ou ping alto: menos bits por pacote ajuda a voz a chegar inteira (a correção de erros do Opus usa a folga)
    const want = loss > .08 || rtt > 400 ? 32 : loss > .03 || rtt > 250 ? 48 : bwLow || byBw >= this.autoKbps ? Math.min(byBw, AUTO_MAX) : this.autoKbps;
    // sobe um nível por vez e só depois de estabilizar; desce na hora
    const next = want < this.autoKbps ? want : want > this.autoKbps && now - (this.autoAt || 0) > 10000 ? AUTO_STEPS.find(k => k > this.autoKbps) : this.autoKbps;
    if (next !== this.autoKbps) { this.autoKbps = next; this.autoAt = now; this.retuneAudio(); }
    else if (want <= this.autoKbps) this.autoAt = now;
  }
  sendMeta(uid) {
    const streams = {};
    if (this.cam) streams[this.cam.id] = 'cam';
    if (this.screen) streams[this.screen.id] = 'screen';
    this.send('VOICE_SIGNAL', { to: uid, data: { meta: streams } });
  }
  // limita/ajusta bitrate e fps do vídeo enviado
  tuneSender(p, key, kind) {
    const apply = async () => {
      const s = p.senders[key]; if (!s) return;
      try {
        const prm = s.getParameters(); if (!prm.encodings?.length) prm.encodings = [{}];
        const o = this.screenOpts || {};
        if (kind === 'screen') {
          prm.encodings[0].maxBitrate = bitrateFor(o.res || 1080, o.fps || 30, o.bitrate, isGameShare(o)); prm.encodings[0].maxFramerate = +o.fps || 30;
          prm.degradationPreference = o.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
        } else prm.encodings[0].maxBitrate = 2_000_000;
        prm.encodings[0].networkPriority = 'high';
        await s.setParameters(prm);
      } catch (e) { /* ainda negociando */ }
    };
    [300, 1500, 4000].forEach(ms => setTimeout(apply, ms));
  }
  async onSignal({ from, data }) {
    if (!this.channelId || this.sfu) return;
    const p = this.connect(from, false), pc = p.pc;
    try {
      if (data.meta) {
        Object.assign(p.meta, data.meta);
        for (const [id, kind] of Object.entries(data.meta)) for (const [k, s] of Object.entries(p.streams)) if (s.id === id && k !== kind) { p.streams[kind] = s; delete p.streams[k]; }
        this.onUpdate();
      } else if (data.desc) {
        const collision = data.desc.type === 'offer' && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision;
        if (p.ignore) return;
        await pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') { await this.setLocal(pc); this.send('VOICE_SIGNAL', { to: from, data: { desc: pc.localDescription } }); }
      } else if (data.cand) {
        try { await pc.addIceCandidate(data.cand); } catch (e) { if (!p.ignore) throw e; }
      }
    } catch (e) { console.warn('signal', e); }
  }
  drop(uid) {
    const p = this.peers.get(uid); if (!p) return;
    p.pc?.close(); p.audioEl?.remove(); p.screenAudioEl?.remove(); this.unboost(p, 'audioEl'); this.unboost(p, 'screenAudioEl');
    for (const id of p.consumers?.keys() || []) { const e = this.sfu?.consumers.get(id); e?.c.close(); e?.tap?.close(); this.sfu?.consumers.delete(id); }
    this.analysers.get(uid)?.src.disconnect(); this.analysers.delete(uid); this.speaking.delete(uid);
    this.peers.delete(uid);
  }

  attachAudio(p, stream, kind, rx) {
    const key = kind === 'screen' ? 'screenAudioEl' : 'audioEl';
    p[key]?.remove(); this.unboost(p, key);
    const a = document.createElement('audio'); a.autoplay = true; a.srcObject = stream; a.style.display = 'none'; a.raw = stream;
    if (this.prefs.outputId && a.setSinkId) a.setSinkId(this.prefs.outputId).catch(() => { });
    document.body.append(a); p[key] = a; this.applyVolume(p.uid); a.play?.().catch(() => { });
    if (kind === 'mic') this.watch(p.uid, stream, rx);
  }
  closeStream(uid) { this.autoPaused?.delete(uid); this.closedStreams.add(uid); this.applyVolume(uid); this.flow(uid, true); }
  openStream(uid) { this.autoPaused?.delete(uid); this.closedStreams.delete(uid); this.applyVolume(uid); this.flow(uid, false); }
  // pausa/retoma no servidor o que vem da transmissão de alguém: quem não está assistindo não gasta a banda (nem o servidor)
  flow(uid, paused) {
    const p = this.peers.get(uid); if (!p || !this.sfu?.ready) return;
    for (const [id, src] of p.consumers) if (src === 'screen' || src === 'screenaudio') this.sfuReq('pause', { consumer_id: id, paused }).catch(() => { });
  }
  // pausa só o VÍDEO da transmissão (o áudio dela continua): usado quando o quadro não está à vista
  flowVideo(uid, paused) {
    const p = this.peers.get(uid); if (!p || !this.sfu?.ready) return;
    if (paused) (this.autoPaused ||= new Set()).add(uid); else this.autoPaused?.delete(uid);
    for (const [id, src] of p.consumers) if (src === 'screen') this.sfuReq('pause', { consumer_id: id, paused }).catch(() => { });
  }
  // camada da transmissão pedida ao servidor: 0 = 1/4 da resolução (miniaturas), 2 = completa
  setStreamLayer(uid, spatial) {
    const pref = this.layerPref?.[uid]; if (pref === 0 || pref === 1 || pref === 2) spatial = pref; // escolha manual do painel de qualidade vence a automática
    const p = this.peers.get(uid); if (!p || !this.sfu?.ready || p.layer === spatial) return; p.layer = spatial;
    for (const [id, src] of p.consumers) if (src === 'screen') this.sfuReq('layers', { consumer_id: id, spatial }).catch(() => { });
  }
  // câmera de cada pessoa (SFU): a camada do simulcast que cabe no quadro em que aparece (0 = 1/4, 1 = metade, 2 = cheia)
  // e pausa no servidor quando o quadro não está à vista. Antes toda câmera chegava na camada cheia (~2 Mbps), mesmo numa
  // miniatura ou com a sala fora da tela.
  camFlow(uid, { layer, paused } = {}) {
    const p = this.peers.get(uid); if (!p || !this.sfu?.ready) return;
    const ids = [...p.consumers].filter(([, src]) => src === 'cam').map(([id]) => id);
    if (layer !== undefined && p.camLayer !== layer) { p.camLayer = layer; for (const id of ids) this.sfuReq('layers', { consumer_id: id, spatial: layer }).catch(() => { }); }
    if (paused !== undefined && !!p.camPaused !== paused) { p.camPaused = paused; for (const id of ids) this.sfuReq('pause', { consumer_id: id, paused }).catch(() => { }); }
  }
  // qualidade escolhida para uma transmissão: 'auto' | 0 | 1 | 2 (camada simulcast)
  setLayerPref(uid, v) {
    this.layerPref ||= {};
    if (v === 'auto') delete this.layerPref[uid]; else this.layerPref[uid] = v;
    const p = this.peers.get(uid); if (p) p.layer = undefined;
    this.setStreamLayer(uid, v === 'auto' ? 2 : v); this.onUpdate();
  }
  // estatísticas de RECEPÇÃO de uma transmissão (SFU): resolução/fps/bitrate reais do que chega, perda, codec, áudio
  async streamStats(uid) {
    const p = this.peers.get(uid); if (!p || !this.sfu) return null;
    let vc = null, ac = null;
    for (const [id, src] of p.consumers) { const e = this.sfu.consumers.get(id); if (src === 'screen') vc = e?.c; else if (src === 'screenaudio') ac = e?.c; }
    if (!vc) return null;
    this._rs ||= new Map(); const now = performance.now(), out = { layerPref: this.layerPref?.[uid] ?? 'auto', layer: p.layer, audio: !!ac && !ac.closed && !ac.paused };
    try {
      for (const r of (await vc.getStats()).values()) {
        if (r.type !== 'inbound-rtp' || r.kind !== 'video') continue;
        const prev = this._rs.get(uid); this._rs.set(uid, { t: now, b: r.bytesReceived, f: r.framesDecoded, pl: r.packetsLost, pr: r.packetsReceived });
        Object.assign(out, { w: r.frameWidth || 0, h: r.frameHeight || 0, fps: Math.round(r.framesPerSecond || 0), jitter: r.jitter != null ? Math.round(r.jitter * 1000) : null, freezes: r.freezeCount || 0, decoder: r.decoderImplementation || '' });
        if (prev && now > prev.t) {
          const dt = (now - prev.t) / 1000, dl = r.packetsLost - prev.pl, dr = r.packetsReceived - prev.pr;
          out.kbps = Math.round((r.bytesReceived - prev.b) * 8 / dt / 1000);
          out.fps = Math.round((r.framesDecoded - prev.f) / dt);
          out.loss = dl + dr > 0 ? +(Math.max(0, dl) / (dl + dr) * 100).toFixed(1) : 0;
        }
      }
    } catch { return null; }
    out.quality = out.loss > 8 || out.freezes > 3 ? 'ruim' : out.loss > 2 ? 'média' : 'boa';
    return out;
  }
  applyVolume(uid) {
    const p = this.peers.get(uid); if (!p) return;
    const master = this.testMute ? 0 : (this.prefs.volume ?? 100) / 100;
    this.setLevel(p, 'audioEl', this.prefs.mutedUsers?.[uid] ? 0 : this.volOf(uid) / 100 * master); // "Mute" do menu do usuário
    this.setLevel(p, 'screenAudioEl', (this.streamVolumes[uid] ?? 100) / 100 * master);
  }
  // até 100% usa o volume do elemento; acima disso o áudio passa por um ganho WebAudio (com limitador para não estourar)
  setLevel(p, key, f) {
    const a = p[key]; if (!a) return;
    // ensurdecer silencia as vozes, mas não as transmissões (só ficam mudas se a transmissão foi fechada)
    a.muted = key === 'screenAudioEl' ? this.closedStreams.has(p.uid) : (this.deafened || this.modDeaf);
    const fx = key === 'audioEl' ? this.fxFor(p.uid) : null;
    let b = p[key + 'Boost'];
    if (f <= 1 && !b && !fx) { a.volume = f; return; }
    if (!b) {
      // até 100% sem efeito usa o volume do elemento; acima disso, ou com efeito de voz, o áudio passa pelo WebAudio (limitador no fim: nunca estoura)
      try {
        const ctx = this.getCtx(), src = ctx.createMediaStreamSource(a.raw), gain = ctx.createGain(), lim = ctx.createDynamicsCompressor(), dest = ctx.createMediaStreamDestination();
        lim.threshold.value = -3; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .15;
        src.connect(gain); gain.connect(lim).connect(dest);
        // o Chrome só entrega o áudio remoto ao WebAudio se o fluxo original estiver tocando em algum elemento (mudo)
        const hold = document.createElement('audio'); hold.muted = true; hold.srcObject = a.raw; hold.play?.().catch(() => { });
        b = p[key + 'Boost'] = { src, gain, hold, fx: null, fxNode: null };
        a.srcObject = dest.stream; a.play?.().catch(() => { });
      } catch { a.volume = Math.min(1, f); return; }
    }
    if (b.fx !== fx) this.rewireFx(p, b, fx);
    a.volume = 1; b.gain.gain.value = f;
  }
  // efeito que ESTE app deve aplicar na voz de uid: o que a pessoa escolheu, a menos que eu tenha desligado
  fxFor(uid) {
    const id = this.fxLookup?.(uid); // estado de voz da pessoa (S.voice), mantido pelo app
    if (!id || this.prefs.hearFx === false || this.prefs.noFxUsers?.[uid]) return null;
    return FX_IDS.includes(id) ? id : null;
  }
  rewireFx(p, b, fx) {
    const ctx = this.getCtx();
    b.src.disconnect(); b.fxNode?.stop(); b.fxNode = null; b.fx = fx;
    if (!fx) { b.src.connect(b.gain); return; }
    loadFx(ctx).then(() => {
      if (b.fx !== fx || b.fxNode) return; // mudou enquanto carregava
      b.src.disconnect();
      const n = createFx(ctx, fx); b.fxNode = n; b.src.connect(n.input); n.output.connect(b.gain);
    });
    b.src.connect(b.gain); // até carregar: voz normal
  }
  // efeito escolhido por outra pessoa mudou (VOICE_STATE): refaz o caminho do áudio dela
  setPeerFx(uid) { if (this.peers.has(uid)) this.applyVolume(uid); }
  // meu efeito: todo mundo que deixou os efeitos ligados ouve
  setFx(id) {
    this.fx = FX_IDS.includes(id) ? id : null;
    if (this.fx) this.prefs.lastFx = this.fx;
    this.sendState(); this.updateMonitor(); this.onUpdate();
  }
  // ouvir a própria voz com o efeito (use fone): o microfone que vai para a sala passa pelo mesmo efeito
  setMonitor(on) { this.monitorOn = !!on; this.updateMonitor(); }
  updateMonitor() {
    const m = this._mon; if (m) { m.src.disconnect(); m.node?.stop(); this._mon = null; }
    if (!this.monitorOn || !this.fx || !this.mic) return;
    const ctx = this.getCtx(), fx = this.fx;
    loadFx(ctx).then(() => {
      if (!this.monitorOn || this.fx !== fx || this._mon || !this.mic) return;
      const src = ctx.createMediaStreamSource(this.mic), node = createFx(ctx, fx), g = ctx.createGain(); g.gain.value = .8;
      src.connect(node.input); node.output.connect(g).connect(ctx.destination);
      this._mon = { src, node: { stop: () => { node.stop(); g.disconnect(); } } };
    });
  }
  // ---------- áudio dos clipes: tudo da Resenha (na transmissão ao vivo nada disso vai) ----------
  // minha voz COM o meu efeito (quem ouve aplica o efeito do lado de lá; no clipe tem que sair como a sala ouviu).
  // A trilha devolvida é sempre a mesma: trocar de microfone ou de efeito só religa por dentro, sem reiniciar a gravação.
  clipVoice() {
    if (!this.mic) return null;
    const ctx = this.getCtx(), c = this._clipMe ||= { dest: ctx.createMediaStreamDestination() };
    const fx = this.prefs.hearFx === false ? null : this.fx;
    if (c.mic !== this.mic || c.fx !== fx) {
      c.src?.disconnect(); c.node?.stop(); c.node = null; c.mic = this.mic; c.fx = fx;
      const src = c.src = ctx.createMediaStreamSource(this.mic);
      src.connect(c.dest); // até o efeito carregar: voz normal
      if (fx) loadFx(ctx).then(() => {
        if (c.src !== src || c.fx !== fx || c.node) return; // mudou enquanto carregava
        src.disconnect(); c.node = createFx(ctx, fx); src.connect(c.node.input); c.node.output.connect(c.dest);
      });
    }
    return c.dest.stream;
  }
  // sons do soundboard só para o clipe (tocam aqui por fora, sem sair nos alto-falantes; valem mesmo com o soundboard mudo)
  clipSounds() { const ctx = this.getCtx(); this._clipSb ||= ctx.createMediaStreamDestination(); return this._clipSb.stream; }
  async clipSound(url, volumePct = 100, maxSecs = 15) {
    if (!this._clipSb) return; // nenhum clipe gravando
    try {
      const ctx = this.getCtx(), cache = this._sbBufs ||= new Map();
      let buf = cache.get(url);
      if (!buf) { buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()); if (cache.size > 40) cache.clear(); cache.set(url, buf); }
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = Math.min(2, volumePct / 100);
      s.connect(g).connect(this._clipSb); s.onended = () => g.disconnect(); s.start(); s.stop(ctx.currentTime + maxSecs);
    } catch { /* som inválido: o clipe segue sem ele */ }
  }
  // todas as fontes de áudio da Resenha que entram no clipe: minha voz (com efeito), a voz de cada um na sala
  // (como eu ouço, já com o efeito deles; inclui o bot de música) e o soundboard. O áudio da transmissão entra à parte.
  clipAudio() {
    const out = [this.clipVoice(), this.clipSounds()];
    for (const p of this.peers.values()) if (p.audioEl) out.push(p.audioEl.srcObject || p.audioEl.raw);
    return out.filter(Boolean);
  }
  unboost(p, key) { const b = p[key + 'Boost']; if (!b) return; b.src.disconnect(); b.fxNode?.stop(); b.hold.srcObject = null; delete p[key + 'Boost']; }
  // volumes por usuário ficam nas preferências (salvas e sincronizadas)
  get volumes() { return (this.prefs.userVolumes ||= {}); }
  get streamVolumes() { return (this.prefs.streamVolumes ||= {}); }
  // volume por usuário (0–1000%); 100% apaga o valor salvo
  // bot de música: um volume só para todos ("Música", "Música 2"… são usuários diferentes; com outro bot já tocando em outra
  // sala, o da sua sala era outro id e voltava a 100%). isMusicBot vem do app (estado de voz com bot.kind 'music').
  volOf(uid) { return this.volumes[uid] ?? (this.isMusicBot?.(uid) ? this.prefs.musicVolume : undefined) ?? 100; }
  setVolume(uid, v) {
    if (this.isMusicBot?.(uid)) {
      delete this.volumes[uid];
      if (v === 100) delete this.prefs.musicVolume; else this.prefs.musicVolume = v;
      for (const id of this.peers.keys()) if (this.isMusicBot(id)) this.applyVolume(id);
      return;
    }
    if (v === 100) delete this.volumes[uid]; else this.volumes[uid] = v; this.applyVolume(uid);
  }
  setStreamVolume(uid, v) { if (v === 100) delete this.streamVolumes[uid]; else this.streamVolumes[uid] = v; this.applyVolume(uid); }
  // "Quem fala" dos outros: pelo nível que vem em cada pacote de voz (extensão ssrc-audio-level, calculado por quem fala;
  // getSynchronizationSources, sem custo). Antes era um MediaStreamSource + Analyser por pessoa no AudioContext: ~2,5 pontos
  // de CPU por pessoa na sala (scripts/perf-call-states.mjs). O nível é a média do pacote (não o pico do medidor), por
  // isso limiar e folga próprios (SSRC_LOUD, SSRC_HOLD_MS: ~92% das amostras iguais ao medidor antigo com voz real).
  // Receptor sem isso (navegador antigo): o medidor de antes.
  watch(uid, stream, rx) {
    try {
      this.analysers.get(uid)?.src.disconnect(); // áudio da pessoa religado (reconexão/troca de trilha): o medidor antigo não fica pendurado no grafo
      if (rx && typeof rx.getSynchronizationSources === 'function') { this.analysers.set(uid, { src: { disconnect() { } }, rx, level: 0 }); return; }
      const ctx = this.getCtx(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 512; src.connect(an); this.analysers.set(uid, { src, an, buf: new Uint8Array(an.fftSize), level: 0 });
    } catch { }
  }
  // lista de quem fala, do servidor; some 300 ms depois da última vez na lista (a mesma folga do medidor daqui)
  onSfuSpeaking(d) { const now = performance.now(); this.srvAt ||= new Map(); this.srvNow = new Set(d?.ids || []); for (const id of this.srvNow) this.srvAt.set(id, now); }
  poll() {
    let changed = false;
    let srv = null; // vozes pausadas: quem fala vem do servidor
    if (this.sfu?.voiceOff && this.sfu.srvLevels) { const now = performance.now(); srv = new Set(); for (const [id, t] of this.srvAt || []) if (this.srvNow?.has(id) || now - t < 300) srv.add(id); }
    if (srv) for (const uid of [...this.speaking]) if (uid !== this.myId && !srv.has(uid)) { this.speaking.delete(uid); changed = true; }
    if (srv) for (const uid of srv) if (uid !== this.myId && !this.speaking.has(uid) && this.analysers.has(uid)) { this.speaking.add(uid); changed = true; }
    for (const [uid, a] of this.analysers) {
      if (srv && uid !== this.myId) continue;
      if (a.rx) { // nível do último pacote; sem pacote recente (mutou, saiu, DTX) = silêncio
        const s = a.rx.getSynchronizationSources()[0];
        a.level = s && performance.timeOrigin + performance.now() - s.timestamp < SSRC_FRESH_MS ? s.audioLevel : 0;
      } else {
        a.an.getByteTimeDomainData(a.buf);
        let peak = 0; for (const v of a.buf) peak = Math.max(peak, Math.abs(v - 128));
        a.level = peak / 128;
      }
      const mine = uid === this.myId;
      const loud = a.level > (mine ? .03 : a.rx ? SSRC_LOUD : .04) && !(mine && (this.muted || this.deafened || this.modMute || this.modDeaf || !this.micEnabled()));
      const now = performance.now(); if (loud) a.at = now;
      const on = loud || (a.at > 0 && now - a.at < (a.rx ? SSRC_HOLD_MS : 300) && !(mine && (this.muted || this.deafened)));
      if (on !== this.speaking.has(uid)) { on ? this.speaking.add(uid) : this.speaking.delete(uid); changed = true; }
    }
    if (changed) this.onUpdate(true);
    this.onLevel?.(this.analysers.get(this.myId)?.level || 0);
  }

  micEnabled() { return this.prefs.inputMode !== 'ptt' || this.ptt; }
  applyMute() {
    this.mic?.getAudioTracks().forEach(t => (t.enabled = !this.muted && !this.deafened && !this.modMute && !this.modDeaf && !this.testMute && this.micEnabled()));
    // microfone fechado por qualquer motivo (mudo, ensurdecido, moderação, teste, apertar-para-falar solto): a cadeia
    // para e a IA de ruído não processa nada. O teste de microfone aberto mantém o medidor vivo
    const closed = this.muted || this.deafened || this.modMute || this.modDeaf || this.testMute || !this.micEnabled();
    this.micGraph?.setIdle?.(closed && !this.micHold);
  }
  // teste de microfone das Configurações aberto durante a chamada: microfone e áudio da sala ficam silenciados até o teste acabar
  // (não mexe no mutar/ensurdecer escolhido pela pessoa; ao parar o teste tudo volta como estava)
  setTestMute(on) { if (!!this.testMute === !!on) return; this.testMute = !!on; this.afterAudioChange(); }
  holdMic(on) { this.micHold = Math.max(0, (this.micHold || 0) + (on ? 1 : -1)); this.applyMute(); }
  setPtt(down) { if (this.ptt === down) return; this.ptt = down; this.applyMute(); this.onUpdate(true); }
  // mutado/ensurdecido pela moderação (estado de voz mod_mute/mod_deaf): o servidor já não repassa; aqui o microfone também fecha
  setModeration(mute, deaf) { if (!!this.modMute === !!mute && !!this.modDeaf === !!deaf) return; this.modMute = !!mute; this.modDeaf = !!deaf; this.afterAudioChange(); }
  // "Em espera": saiu um pouco sem sair da sala (atender a porta, pausa no jogo). Microfone e áudio desligam e os outros veem
  // "Em espera" ao lado do nome; voltar devolve o mutar/ensurdecer de antes. Mexer no microfone ou no áudio também tira da espera.
  setHold(on) {
    on = !!on; if (on === !!this.hold || !this.channelId) return;
    if (on) { this._preHold = { muted: this.muted, deafened: this.deafened }; this.hold = true; this.muted = this.deafened = true; playSound('deafen'); }
    else { const p = this._preHold || {}; this.hold = false; this._preHold = null; this.muted = !!p.muted; this.deafened = !!p.deafened; playSound('undeafen'); }
    this.afterAudioChange();
  }
  leaveHold() { if (this.hold) { this.hold = false; this._preHold = null; } }
  toggleMute() { this.leaveHold(); const wasDeaf = this.deafened; this.muted = !this.muted; if (!this.muted && this.deafened) this.deafened = false; playSound(wasDeaf && !this.deafened ? 'undeafen' : this.muted ? 'mute' : 'unmute'); this.afterAudioChange(); }
  toggleDeaf() { this.leaveHold(); this.deafened = !this.deafened; this.muted = this.deafened; playSound(this.deafened ? 'deafen' : 'undeafen'); this.afterAudioChange(); }
  afterAudioChange() { this.applyMute(); for (const uid of this.peers.keys()) this.applyVolume(uid); this.sendState(); this.onUpdate(); }
  // várias mudanças na mesma rodada (mutar + câmera, atalho repetido) viram UMA mensagem ao servidor, com o estado final
  sendState() { if (!this.channelId || this._stQ) return; this._stQ = true; queueMicrotask(() => { this._stQ = false; this.sendStateNow(); }); }
  // Ensurdecido e com a janela escondida/minimizada, ninguém ouve nem vê quem fala: o servidor para de mandar a voz dos outros
  // (~40 kbps e uma decodificação Opus por pessoa falando). Volta na hora ao reabrir a janela ou ao desensurdecer.
  // Transmitindo, não pausa (o clipe com F8 leva a voz da sala).
  // Ensurdecido: as vozes dos outros pausam no servidor (não chegam: menos banda e processador) e quem está falando vem
  // do próprio servidor (SFU_SPEAKING, medido pelo mediasoup). Servidor sem isso ('levels' falha): como antes, só pausa com a
  // janela escondida, porque o medidor daqui precisa do áudio para acender o "falando".
  syncVoiceFlow() {
    const s = this.sfu; if (!s?.ready) return;
    // booleano de verdade: modDeaf começa undefined (só setModeration o define) e "undefined !== false" pedia 'levels' de
    // novo a cada resposta, em laço (~10 pedidos/s por pessoa na chamada, cada um com um 'pause' de paused: undefined)
    const want = !!((this.deafened || this.modDeaf) && !this.screen);
    if (want !== !!s.levelsOn && s.srvLevels !== false) {
      s.levelsOn = want;
      this.sfuReq('levels', { on: want }).then((r) => { s.srvLevels = true; if (s.levelsOn) this.onSfuSpeaking(r); this.syncVoiceFlow(); }, () => { s.srvLevels = false; this.syncVoiceFlow(); });
    }
    const off = want && (document.hidden || s.srvLevels === true);
    if (!!s.voiceOff === off) return; s.voiceOff = off;
    for (const [id, x] of s.consumers) if (x.source === 'mic') this.sfuReq('pause', { consumer_id: id, paused: off }).catch(() => { });
  }
  // nome do que está sendo transmitido, para quem assiste ("Fulano — Counter-Strike 2"): só de janela de JOGO (o título de
  // outras janelas pode ter coisa pessoal: aba do navegador, nome de arquivo). Tela inteira: quem assiste usa o "Jogando X".
  streamTitle() {
    const si = this.screenOpts?.srcInfo; if (!si || si.type !== 'window' || !(si.game || si.fullscreen)) return null;
    const t = String(si.name || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, 80) : null;
  }
  sendStateNow() { if (!this.channelId) return; this.syncVoiceFlow(); this.send('VOICE_STATE', { mute: this.muted || this.deafened || !!this.testMute, deaf: this.deafened || !!this.testMute, video: !!this.cam, screen: !!this.screen, screenNote: (this.screen && this.screenNote) || null, screenTitle: (this.screen && this.streamTitle()) || null, fx: this.fx || null, hold: !!this.hold, mirror: !!this.prefs?.camMirror }); }

  // um pedido de cada vez: clicar de novo enquanto a câmera/tela abre não abre outra (antes cada clique abria uma câmera,
  // só a última ficava no app e as outras continuavam ligadas, com a luz da câmera acesa, até fechar o app)
  // Parar continua imediato; a trava só vale enquanto abre.
  once(key, fn) { if (this[key]) return this[key]; const p = this[key] = fn(); p.finally(() => { if (this[key] === p) this[key] = null; }).catch(() => { }); return p; }
  // permissões Falar/Vídeo da sala (estado de voz no_speak/no_video, vindo do servidor)
  setRoomPerms(noSpeak, noVideo) { this.noSpeak = !!noSpeak; this.noVideo = !!noVideo; if (noVideo) { if (this.cam) this.stopLocal('cam'); if (this.screen) this.stopLocal('screen'); } this.onUpdate(); }
  toggleCam() { if (!this.cam && this.noVideo) return Promise.reject(new Error('Você não tem permissão de vídeo nesta sala: câmera e transmissão de tela estão bloqueadas pela moderação.')); return this.cam ? Promise.resolve(this.stopLocal('cam')) : this.once('_camBusy', () => this.toggleCamNow()); }
  async toggleCamNow() {
    if (this.cam) return this.stopLocal('cam');
    const cid = this.channelId;
    try {
      this.cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: this.prefs.videoId ? { exact: this.prefs.videoId } : undefined, height: { ideal: +(this.prefs.camRes || 720) }, width: { ideal: Math.round(+(this.prefs.camRes || 720) * 16 / 9) }, frameRate: { ideal: +(this.prefs.camFps || 30) } } });
    } catch (e) { throw new Error('Não foi possível acessar a câmera: ' + (e.message || e.name)); }
    if (!this.channelId || this.channelId !== cid) { this.cam?.getTracks().forEach(t => t.stop()); this.cam = null; return; } // saiu da sala enquanto abria
    this.publish('cam', this.cam); playSound('camOn');
  }
  // trocar de câmera durante a chamada (menu de opções da chamada): abre a nova e troca a faixa no lugar, sem desligar o vídeo
  // para quem assiste. Câmera desligada: só a preferência muda (vale na próxima vez que ligar).
  switchCam() { return this.cam ? this.once('_camBusy', () => this.switchCamNow()) : Promise.resolve(); }
  async switchCamNow() {
    const old = this.cam; if (!old) return;
    let next;
    try {
      next = await navigator.mediaDevices.getUserMedia({ video: { deviceId: this.prefs.videoId ? { exact: this.prefs.videoId } : undefined, height: { ideal: +(this.prefs.camRes || 720) }, width: { ideal: Math.round(+(this.prefs.camRes || 720) * 16 / 9) }, frameRate: { ideal: +(this.prefs.camFps || 30) } } });
    } catch (e) { throw new Error('Não foi possível abrir esta câmera: ' + (e.message || e.name)); }
    if (this.cam !== old) { next.getTracks().forEach(t => t.stop()); return; } // desligou ou saiu enquanto abria
    const track = next.getVideoTracks()[0];
    if (this.sfu) await this.sfuProduce('cam', track);
    else for (const p of this.peers.values()) { const s = p.senders.camvideo; if (s) await s.replaceTrack(track).catch(() => { }); }
    this.cam = next; old.getTracks().forEach(t => t.stop());
    this.onUpdate();
  }
  // opts: { res: 720|1080|1440|'source', fps: 15|30|60, audio: bool, hint: 'motion'|'detail' }
  toggleScreen(opts) {
    if (this._scrWait) { this._scrWait.cancel(); return Promise.resolve(); } // esperando o jogo voltar: clicar de novo desiste
    if (!this.screen && this.noVideo) return Promise.reject(new Error('Você não tem permissão de vídeo nesta sala: câmera e transmissão de tela estão bloqueadas pela moderação.'));
    return this.screen ? Promise.resolve(this.stopLocal('screen')) : this.once('_scrBusy', () => this.toggleScreenNow(opts));
  }
  async toggleScreenNow(opts) {
    if (this.screen) return this.stopLocal('screen');
    opts = { res: 1080, fps: 30, audio: true, hint: 'motion', ...opts };
    const video = { frameRate: capFps(opts.fps), cursor: opts.cursor === false ? 'never' : 'always' };
    if (opts.res !== 'source') { video.height = { ideal: +opts.res, max: +opts.res }; video.width = { ideal: Math.round(+opts.res * 16 / 9) }; }
    const gdm = () => navigator.mediaDevices.getDisplayMedia({ video, audio: opts.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true, suppressLocalAudioPlayback: true } : false, systemAudio: 'include', selfBrowserSurface: 'exclude' });
    const cid = this.channelId;
    this._swapWhy = null; this._natWinId = await this.gameWindowViaScreen(opts);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('indisponível (use HTTPS ou o app desktop)');
      try { this.screen = await gdm(); } catch (e0) {
        let e = e0;
        // "Could not start video source" passageiro (a placa de vídeo ou a janela ainda se preparando, troca de modo do
        // jogo): tenta mais 2 vezes antes de desistir. Era o 3º erro mais visto da transmissão
        for (let i = 0; window.lcDesktop && e.name === 'NotReadableError' && i < 2 && !(await this.srcMinimized()); i++) { // no navegador, repetir abriria o seletor de novo
          await new Promise(r => setTimeout(r, 600));
          if (!this.channelId || this.channelId !== cid) return;
          try { this.screen = await gdm(); e = null; break; } catch (e2) { e = e2; }
        }
        if (!e) { /* abriu na nova tentativa */ } else {
        // Jogo em TELA CHEIA (exclusiva): no Alt+Tab para a Resenha o Windows minimiza o jogo, e o Chromium não começa a
        // captura de uma janela minimizada ("Could not start video source"). Espera o jogo voltar à tela e começa.
        if (e.name !== 'NotReadableError' || !(await this.srcMinimized())) throw e;
        if (!(await this.waitSourceShown())) return; // desistiu, saiu da sala ou o jogo fechou
        if (!this.channelId || this.channelId !== cid) return;
        for (let i = 0; ; i++) { // o jogo leva um instante para voltar a desenhar depois de restaurado
          try { this.screen = await gdm(); break; } catch (e2) { if (e2.name !== 'NotReadableError' || i >= 5) throw e2; await new Promise(r => setTimeout(r, 400)); }
        }
        }
      }
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
      // a janela escolhida já não existe (o jogo fechou ou recriou a janela ao mudar de modo): diz isso, não "tente de novo"
      if (e.name === 'NotReadableError' && await this.srcGone()) throw new Error('Não foi possível compartilhar a tela: a janela escolhida foi fechada. Abra o jogo e escolha a janela de novo.');
      throw new Error('Não foi possível compartilhar a tela: ' + (e.message || e.name) + (e.name === 'NotReadableError' ? '. Se for um jogo em tela cheia, deixe-o aberto na tela (ou use "Janela sem bordas") e tente de novo. Se continuar, transmita a tela inteira.' : '') + (this._swapWhy ? ` [${this._swapWhy}]` : ''));
    }
    if (!this.channelId || this.channelId !== cid) { this.screen?.getTracks().forEach(t => t.stop()); this.screen = null; return; } // saiu da sala enquanto abria
    const vt = this.screen.getVideoTracks()[0];
    vt.contentHint = opts.hint; vt.onended = () => this.stopLocal('screen');
    this.screenOpts = opts; this._natRestarts = []; this.natRestartCount = 0; this.natLastError = null; this._fseNative = false; this.noted = null; // avisos de uma vez por transmissão (gateway.js)
    if (this._swapWhy) this.capLog({ t: 'capnote', msg: 'captura do Chromium para jogo: ' + this._swapWhy });
    this.capStats = { since: Date.now(), chromium: { frames: 0, secs: 0 }, native: { frames: 0, sent: 0, secs: 0 } }; // painel de captura (M13)
    // app desktop: troca o áudio do PC inteiro pelo áudio só do jogo (ou "tudo menos a Resenha"); se não der, fica o do sistema
    if (opts.audio && opts.appAudio && window.lcDesktop?.appAudioStart) await this.useAppAudio(opts.appAudio);
    if (!this.screen) return; // parou enquanto preparava o áudio
    const nat = await this.wantNative(opts);
    if (nat) { this.native = { pending: true }; this.previewOnly(vt, true); }
    this.publish('screen', this.screen); playSound('selfStreamStart'); this.watchScreen(); this.meterCapture(); this.meterBlack(); this.watchSource(); this.watchFse(); this.watchOver();
    if (nat) this.startNative().catch(() => { });
  }

  // Jogo: o Chromium (prévia, reserva ou a própria transmissão) captura a TELA do monitor do jogo, não a janela, em dois casos:
  // - Windows 10 com a captura nativa: a captura de janela do Chromium lá é a WGC, que some com o cursor do jogo para quem
  //   joga enquanto está aberta (confirmado: com a tela inteira o cursor aparece e volta ao parar). O nativo recebe a
  //   janela pelo id (recorte da janela no DXGI).
  // - jogo cobrindo o monitor (tela cheia ou janela sem bordas, gameCoversMon), com ou sem o nativo, Windows 10 ou 11: a
  //   captura de janela do Chromium mostrava a janela de baixo do jogo. Sem o nativo é o Chromium que manda o vídeo, então
  //   só troca se o app avisa quando o jogo sai da frente (watchOver): no Alt+Tab o vídeo pausa em vez de mostrar a tela.
  // Com vários monitores, a tela do jogo vem do app (screenId, pelo monitor da janela); app antigo: só com um monitor.
  // Devolve o id da janela ou null.
  async gameWindowViaScreen(o) {
    const si = o.srcInfo, d = window.lcDesktop;
    // por que trocou ou não (vai no relatório da captura e na mensagem de erro: sem isso não dá para saber o que houve no PC)
    const why = (w) => { this._swapWhy = w; return null; };
    if (!si) return why('sem dados da fonte');
    if (si.type !== 'window') return why('fonte é ' + si.type);
    if (!(si.game || si.fullscreen)) return why('janela não é jogo');
    if (!/^window:/.test(si.id || '')) return why('sem id da janela');
    if (!d?.selectSource || !d.getSources) return why('app sem suporte');
    try {
      const cover = gameCoversMon(si);
      const c = await this.nativeCapable(captureMode(this.prefs)).catch(() => ({}));
      const nat = !!c.ok && await this.wantNative(o);
      const win10nat = nat && +c.os > 0 && +c.os < 22000;
      if (!win10nat) {
        if (!cover) return why(!nat ? 'não vai pelo nativo: ' + (this._natWhy || c.code || c.reason || '?') : +c.os > 0 ? 'Windows 11, janela não cobre o monitor' : 'app não informa o Windows');
        // o Chromium vai mandar o monitor: sem o aviso de "jogo fora da tela", o Alt+Tab mostraria a tela para quem assiste
        if (!nat && !this.sfu?.ready) return why('sem SFU (na malha P2P o vídeo não pausa no Alt+Tab)');
        if (!nat && !(await d.watchSourceOver?.(si.id).catch(() => false))) return why('app sem o aviso de jogo fora da tela (atualize o app)');
      }
      const screens = (await d.getSources()).filter(x => x.type === 'screen');
      // a tela do monitor do jogo: o app diz qual é (desde a versão que manda screenId); com um monitor só, é ela
      const scr = screens.find(x => si.screenId && x.id === si.screenId) || (screens.length === 1 ? screens[0] : null);
      if (!scr) return why(screens.length + ' monitores e o app não diz em qual está o jogo (atualize o app)');
      if (!(await d.selectSource(scr.id, scr.name))) return why('selectSource falhou');
      this._swapWhy = nat ? 'ok: Chromium na tela, nativo na janela' : 'ok: jogo cobre o monitor, Chromium na tela do jogo';
      return si.id;
    } catch (e) { return why('erro: ' + (e.message || e)); }
  }
  // antes de mandar o vídeo pelo Chromium: se ele estava na tela só para a prévia (acima), volta para a JANELA do jogo
  // (nunca transmitir a tela inteira no lugar da janela escolhida). Sem conseguir, para a transmissão.
  // Exceção: jogo cobrindo o monitor (tela cheia ou janela sem bordas, gameCoversMon). A captura de janela do Chromium
  // mostra a janela de baixo do jogo (relato com Valorant) e, no Windows 10, é a WGC: borda amarela, o jogo deixa de ser
  // apresentado direto (mouse com atraso, cursor some) e a imagem congela. A tela do monitor do jogo é a mesma imagem e
  // não tem nada disso: fica nela (o Alt+Tab pausa o vídeo, watchOver).
  async chromiumOnWindow() {
    const id = this._natWinId; if (!id || !this.screen) return true;
    const d = window.lcDesktop, old = this.screen.getVideoTracks()[0], o = this.screenOpts || {};
    const si = o.srcInfo || {}; // minimizado = jogo em tela cheia depois do Alt+Tab (ex.: 4:3 esticado, que não mede o monitor todo)
    if ((gameCoversMon(si) || si.game && si.minimized) && old?.readyState === 'live') {
      this.capLog({ t: 'capnote', msg: 'jogo cobrindo o monitor (tela cheia ou janela sem bordas): o modo normal segue na tela do monitor do jogo (a captura de janela mostra a janela de baixo, tem borda amarela no Windows 10 e atrasa o jogo)' });
      return true;
    }
    try {
      await d.selectSource(id, o.srcInfo?.name || '');
      const video = { frameRate: capFps(o.fps), cursor: o.cursor === false ? 'never' : 'always' };
      if (o.res !== 'source') { video.height = { ideal: +o.res, max: +o.res }; video.width = { ideal: Math.round(+o.res * 16 / 9) }; }
      const ns = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      const vt = ns.getVideoTracks()[0];
      if (!this.screen) { vt.stop(); return false; }
      this._natWinId = null; this.applyOver(); // agora é a janela: nada a esconder
      if (old) { old.onended = null; this.screen.removeTrack(old); old.stop(); }
      vt.contentHint = o.hint; vt.onended = () => this.stopLocal('screen');
      this.screen.addTrack(vt);
      return true;
    } catch (e) {
      this.capLog({ t: 'capnote', msg: 'não consegui voltar para a janela do jogo no Chromium: ' + (e.message || e.name) });
      this.error = 'A transmissão parou: a captura nativa falhou e não consegui capturar a janela do jogo pelo modo normal. Tente de novo.';
      this.stopLocal('screen'); this.onNativeFail?.(this.error); this.onUpdate();
      return false;
    }
  }
  // janela escolhida está minimizada agora? (só o app desktop sabe; sem ele, não)
  async srcMinimized() { try { const s = await window.lcDesktop?.sourceState?.(); return s?.kind === 'window' && !!s.minimized; } catch { return false; } }
  // janela escolhida fechada? (só o app desktop sabe; sem ele, não)
  async srcGone() { try { const s = await window.lcDesktop?.sourceState?.(); return s?.kind === 'window' && s.exists === false; } catch { return false; } }
  // espera a janela escolhida sair do minimizado (até 2 min). true = apareceu; false = desistiu/fechou/saiu da sala
  waitSourceShown() {
    const cid = this.channelId;
    this.onAutoAdjust?.('O jogo está minimizado (tela cheia). Volte para o jogo: a transmissão começa quando ele aparecer na tela. Clique em Transmitir de novo para desistir.');
    return new Promise((resolve) => {
      let done = false, timer = null;
      const end = (v) => { if (done) return; done = true; clearTimeout(timer); this._scrWait = null; this.onUpdate(); resolve(v); };
      this._scrWait = { cancel: () => end(false) };
      const t0 = Date.now();
      const tick = async () => {
        if (done) return;
        if (!this.channelId || this.channelId !== cid || Date.now() - t0 > 120000) return end(false);
        let s = null; try { s = await window.lcDesktop.sourceState(); } catch { }
        if (done) return;
        if (s && s.kind === 'window' && !s.exists) { this.onAutoAdjust?.('A janela do jogo fechou: transmissão cancelada.'); return end(false); }
        if (s && !s.minimized) return end(true);
        timer = setTimeout(tick, 500);
      };
      this.onUpdate(); tick();
    });
  }

  // ---------- áudio da transmissão só do jogo (app desktop no Windows 10 2004+) ----------
  // Como o Discord: o Windows entrega o áudio de UM programa (e dos filhos dele), em vez do PC inteiro. O programa nativo manda
  // o som em PCM, um AudioWorklet toca numa trilha comum e ela substitui o áudio do sistema que o Chromium capturou.
  // a: { mode: 'include', pid, name } (só o jogo) | { mode: 'exclude' } (tudo menos a Resenha: sem música da call, sem eco)
  async useAppAudio(a) {
    const d = window.lcDesktop; let node = null;
    try {
      const ctx = this.getCtx();
      this._pcmMod ||= ctx.audioWorklet.addModule('/appaudio-worklet.js').catch((e) => { this._pcmMod = null; throw e; });
      await this._pcmMod;
      const mk = () => { const n = new AudioWorkletNode(ctx, 'lc-pcm', { numberOfInputs: 0, outputChannelCount: [2] }); n.connect(dest); return n; };
      const dest = ctx.createMediaStreamDestination(); node = mk();
      // "só desta tela": um programa por slot, cada um com a sua fila; o destino soma as trilhas
      const extra = []; node.extra = extra;
      d.onAppAudio((b, slot) => { if (!slot) return node.port.postMessage(b); if (slot < 8) (extra[slot] ||= mk()).port.postMessage(b); });
      // vigia do app desktop: o jogo reiniciou com outro processo (religado) ou fechou (esperando voltar)
      d.onAppAudioEvent?.((ev) => { if (!this.appAudio) return; this.appAudio.state = ev.t === 'waiting' ? 'waiting' : 'ok'; this.onAppAudioEvent?.(ev); this.onUpdate(); });
      const r = await d.appAudioStart(a.mode === 'screen' ? { mode: 'screen', source: a.source } : { pid: a.pid, mode: a.mode });
      if (!r?.ok) throw new Error(r?.error || 'falhou');
      if (!this.screen) throw new Error('transmissão encerrada');
      const t = dest.stream.getAudioTracks()[0];
      for (const old of this.screen.getAudioTracks()) { this.screen.removeTrack(old); old.stop(); } // o loopback do PC inteiro sai
      this.screen.addTrack(t);
      this.appAudio = { node, dest, track: t, mode: a.mode, name: a.name || '', state: 'ok' };
      return true;
    } catch (e) {
      d.onAppAudio?.(null); d.appAudioStop?.(); node?.disconnect(); for (const n of node?.extra || []) n?.disconnect();
      if (this.screen) { this.error = `Áudio só ${a.mode === 'exclude' ? 'dos outros programas' : a.mode === 'screen' ? 'desta tela' : 'do jogo'} indisponível (${e.message}). Transmitindo o áudio do PC inteiro.`; this.onUpdate(); }
      return false;
    }
  }
  stopAppAudio() {
    const a = this.appAudio; if (!a) return;
    this.appAudio = null;
    window.lcDesktop?.onAppAudio?.(null); window.lcDesktop?.onAppAudioEvent?.(null); window.lcDesktop?.appAudioStop?.();
    a.node.disconnect(); for (const n of a.node.extra || []) n?.disconnect(); a.track.stop();
  }

  // ---------- 60/120 FPS: vídeo pelo programa nativo do app desktop (captura sem o limite de ~48 fps do Chromium) ----------
  // O Chromium continua capturando a mesma fonte, mas só para o áudio do sistema e a prévia local (leve: 10 fps, 360p).
  // Desde 60 FPS: pedindo 60, o capturador do Chromium entrega ~48 (docs/historico/PASSO0-DIAGNOSTICO-FPS.md); o programa entrega 60
  // e comprime na placa de vídeo. Chamada protegida (VP8 cifrado) e PC sem codificador de hardware seguem pelo Chromium.
  // mode: o método escolhido ('auto' | 'wgc' | 'dxgi'); 'classic'/'chromium' perguntam sem método (caminho clássico)
  async nativeCapable(mode = captureMode(this.prefs)) {
    const d = window.lcDesktop; if (!d?.nativeCapable) return { ok: false, code: 'web', reason: 'Só no app desktop para Windows.' };
    const m = ['auto', 'wgc', 'dxgi'].includes(mode) ? mode : '';
    this._natCap ||= {};
    if (!this._natCap[m]) this._natCap[m] = d.nativeCapable(m || undefined).catch((e) => ({ ok: false, reason: e.message }));
    return this._natCap[m];
  }
  // _natNoUdp: o servidor não recebeu nada do programa (portas UDP da transmissão nativa fechadas): não tenta de novo por
  // _natNoUdpMs (10 min; 2 min se o nativo já funcionou nesta sessão, então foi algo passageiro)
  // _natWhy: por que esta transmissão não saiu pelo programa nativo (telemetria da chamada, public/callqual.js NATIVE_WHY)
  async wantNative(o) {
    const mode = captureMode(this.prefs);
    // jogo (janela de jogo ou em tela cheia): abaixo de 60 FPS ainda vale o nativo NO WINDOWS 10 (decidido abaixo, quando
    // o app diz o build). Lá o Chromium captura a janela pela WGC, que congela num jogo em tela cheia exclusiva (1 quadro
    // e só o cursor andando, visto com Valorant); o nativo vai pelo DXGI, que pega a tela cheia (autoteste: 144 fps).
    // Também quando a tela cheia exclusiva foi confirmada com a transmissão no ar (watchFse).
    const si = o.srcInfo || {}, game = this._fseNative || (si.type === 'window' && (si.game || si.fullscreen));
    const low = +o.fps < NATIVE_MIN_FPS;
    const why = mode === 'chromium' ? 'forced' : this.e2ee ? 'e2ee' : low && !game ? 'lowfps' : !this.sfu?.ready ? 'nosfu' : Date.now() - (this._natNoUdp || 0) <= (this._natNoUdpMs || NATIVE_NOUDP_MS) ? 'udp' : null;
    if (why) { this._natWhy = why; this._natWhyText = null; return false; }
    this._natUdpTries = 0; // transmissão (ou qualidade) nova: a tentativa em outra porta vale de novo
    const c = await this.nativeCapable(mode);
    if (c.ok && low && !this._fseNative && !(+c.os > 0 && +c.os < 22000)) { this._natWhy = 'lowfps'; this._natWhyText = null; return false; } // Windows 11: o Chromium dá conta
    this._natWhy = c.ok ? null : nativeWhy(c); this._natWhyText = c.ok ? null : c.reason || null;
    // app antigo (sem escolha de método): segue no caminho clássico; o painel avisa
    this._capMode = c.ok && ['auto', 'wgc', 'dxgi'].includes(mode) && Array.isArray(c.modes) && c.modes.includes(mode) ? mode : null;
    this._capNote = c.ok ? c.note || null : null;
    return !!c.ok;
  }
  // clipe da própria transmissão pelo programa nativo (app desktop que sabe fazer isso): o vídeo do clipe vem dos quadros
  // que ele já comprimiu, então a prévia continua leve. Vale também enquanto o programa abre/reabre (pending), para o
  // buffer não ficar trocando entre o nativo e o do Chromium a cada reinício
  nativeClips() { return !!(this.native && window.lcDesktop?.nativeClip); }
  // prévia leve (10 fps, 360p). Com os clipes da própria transmissão ligados e app desktop antigo ela também é a fonte do clipe (clips.js grava
  // esta trilha): aí segue o FPS do clipe (Configurações → Clipes: 30, 60 ou o da transmissão) sem passar do da
  // transmissão, até 1080p — antes ficava sempre em 30 e o clipe de quem transmite a 120 saía a 30
  previewSpec() {
    if (this.prefs?.clipsOn !== true || this.nativeClips()) return { fps: 10, h: 360 };
    const o = this.screenOpts || {}, want = [30, 60, 0].includes(this.prefs?.clipFps) ? this.prefs.clipFps : 60, src = +o.fps || 60;
    return { fps: want ? Math.min(want, src) : src, h: Math.min(o.res === 'source' ? 1080 : +o.res || 1080, 1080) };
  }
  previewOnly(vt, on) {
    if (!vt) return;
    const o = this.screenOpts || {}, p = this.previewSpec();
    this._prevSpec = on ? p.fps + 'x' + p.h : null;
    const c = on ? { frameRate: capFps(p.fps), height: { ideal: p.h, max: p.h }, width: { ideal: Math.round(p.h * 16 / 9) } }
      : { frameRate: capFps(o.fps), ...(o.res !== 'source' ? { height: { ideal: +o.res, max: +o.res }, width: { ideal: Math.round(+o.res * 16 / 9) } } : {}) };
    vt.applyConstraints(c).catch(() => { });
  }
  // clipes ligados/desligados durante a transmissão nativa: ajusta a prévia (chamado a cada redesenho; só mexe se mudou)
  syncPreview() {
    if (!this.native) return;
    const vt = this.screen?.getVideoTracks()[0], p = this.previewSpec();
    if (vt && this._prevSpec !== p.fps + 'x' + p.h) this.previewOnly(vt, true);
  }
  async startNative() {
    const d = window.lcDesktop, o = this.screenOpts || {}, sfu = this.sfu;
    if (!d?.nativeStart || !sfu) return this.nativeFallback('app desktop sem suporte');
    const my = this.native = { pending: true };
    if (!this._natEv) { this._natEv = true; d.onNativeEvent?.((ev) => this.onNativeEvent(ev)); }
    try {
      // duas camadas: a cheia e uma leve (540p ou 360p) que o servidor manda a quem não tem banda para a cheia. A leve vai
      // na metade do FPS (60 -> 30, 120 -> 60): as duas dividem o codificador da placa, e com a leve a 60 o da AMD
      // ficava ocupado e descartava quadros da cheia (46 capturados, 40 enviados)
      const topH = o.res === 'source' ? 2160 : +o.res || 1080, lowH = topH >= 1080 ? 540 : 360;
      const top = { height: topH, fps: +o.fps, kbps: Math.round(bitrateFor(o.res || 1080, +o.fps, o.bitrate, isGameShare(o)) / 1000) }, low = { height: lowH, fps: +o.fps >= 60 ? Math.min(60, Math.round(+o.fps / 2)) : +o.fps, kbps: lowH >= 540 ? 2500 : 1200 };
      const r = await this.sfuReq('native_start', { layers: 2 });
      if (this.native !== my) { this.sfuReq('native_stop', { producer_id: r.producer_id }).catch(() => { }); return; } // parou enquanto preparava: fecha só esta sessão
      const ss = r.ssrcs || [r.ssrc], layers = ss.length > 1 ? [{ ...low, ssrc: ss[0] }, { ...top, ssrc: ss[ss.length - 1] }] : [{ ...top, ssrc: ss[0] }];
      // cursor: o programa respeita "mostrar o cursor" a partir do app lançado com esta mudança (programas antigos ignoram e sempre mostram)
      const res = await d.nativeStart({ ...r, host: r.host || location.hostname, ...top, layers, cursor: o.cursor !== false, ...(this._capMode ? { capture: this._capMode } : {}), ...(this._natWinId ? { sourceId: this._natWinId } : {}) });
      if (this.native !== my) { if (!this.native) d.nativeStop(); this.sfuReq('native_stop', { producer_id: r.producer_id }).catch(() => { }); return; }
      if (!res?.ok) throw new Error(res?.error || 'falhou');
      Object.assign(my, { pending: false, encoder: res.encoder, w: res.w, h: res.h, producerId: r.producer_id, layers: res.layers || [], layerError: res.layerError || '', prio: res.prio || null, live: this._natLive.has(r.producer_id), capture: res.capture || null, method: my.method || res.capture?.method || (this._capMode ? null : 'wgc'), overlap: my.overlap ?? !!res.capture?.overlap });
      // o programa manda por UDP (portas RTC_NATIVE_PORTS) e enviar nunca falha do lado de cá: se o servidor não recebe nada
      // (porta fechada no firewall/roteador/Docker), quem assiste veria tela preta até o servidor desistir (60 s). O servidor
      // avisa quando os primeiros pacotes chegam (NATIVE_SCREEN_LIVE). Antes: sem o aviso em 8 s, Chromium e 10 min sem
      // tentar — mas num PC com o processador apertado o programa podia nem ter começado a mandar ainda (relato: caiu para o
      // modo normal codificando no processador, e o jogo perdeu FPS). Agora o "stats" do programa diz se ele já está mandando
      if (!my.live) { const t0 = Date.now(); my.liveTimer = setInterval(() => this.nativeLiveCheck(my, t0), 1000); }
      this.onUpdate();
    } catch (e) { if (this.native === my) this.nativeRestart(e.message); }
  }
  // sem o aviso de chegada ainda: espera, tenta outra porta ou volta ao Chromium (constantes NATIVE_* no topo)
  nativeLiveCheck(my, t0) {
    if (this.native !== my || my.live) return clearInterval(my.liveTimer);
    const now = Date.now(), el = now - t0;
    if (el < NATIVE_LIVE_MS) return;
    // mandando há NATIVE_SENT_MS sem chegar nada; programa antigo (sem "stats"): o critério de antes (8 s)
    const blocked = my.sentAt ? now - my.sentAt >= NATIVE_SENT_MS : !my.stats;
    if (!blocked && el < NATIVE_LIVE_MAX_MS) return; // ainda abrindo a captura/o codificador: espera
    clearInterval(my.liveTimer);
    if (!blocked) return this.nativeRestart(`o programa de transmissão não mandou vídeo em ${Math.round(el / 1000)} s`);
    if ((this._natUdpTries || 0) < NATIVE_UDP_TRIES) { // outra porta do intervalo (o roteador pode ter só parte aberta)
      this._natUdpTries = (this._natUdpTries || 0) + 1;
      return this.nativeRestart('o servidor não recebeu o vídeo do app; tentando outra porta UDP');
    }
    this._natNoUdp = now; this._natNoUdpMs = this._natWorked ? NATIVE_NOUDP_SHORT_MS : NATIVE_NOUDP_MS;
    this.nativeFallback('o servidor não recebeu o vídeo do app: portas UDP da transmissão nativa fechadas no servidor, ou o firewall/antivírus deste PC bloqueou o programa');
  }
  // o servidor recebeu os primeiros pacotes do programa nativo (pode chegar antes de nativeStart responder)
  onNativeLive(d) {
    const id = String(d?.producer_id || ''); if (!id) return;
    this._natLive.add(id); if (this._natLive.size > 20) this._natLive.delete(this._natLive.values().next().value);
    const n = this.native; if (n && n.producerId === id) { n.live = true; clearInterval(n.liveTimer); this._natWorked = true; this._natNoUdp = 0; }
  }
  // histórico das trocas de método e das decisões do seletor (painel de diagnóstico): só desta transmissão, nada vai para o servidor
  capLog(ev) {
    const h = this.capHist ||= [];
    if (ev.t === 'method') h.push({ kind: 'method', at: Date.now(), m: ev.m, from: ev.from || null, why: ev.why || '', ms: ev.ms ?? null, testMs: ev.testMs ?? null, auto: ev.auto !== false, overlap: !!ev.overlap });
    else h.push({ kind: 'note', at: Date.now(), msg: ev.msg || '' });
    if (h.length > CAP_HIST_MAX) h.splice(0, h.length - CAP_HIST_MAX);
  }
  onNativeEvent(ev) {
    if (ev.t === 'method' || ev.t === 'capnote') {
      if (!this.native) return;
      this.capLog(ev);
      if (ev.t === 'method') { this.native.method = ev.m; this.native.overlap = !!ev.overlap; this.onUpdate(); }
      return;
    }
    const n = this.native;
    if (n && ev.t === 'stats' && !n.sentAt && (ev.kbps > 0 || ev.fps > 0)) n.sentAt = Date.now(); // o programa já está mandando vídeo
    if (!n || n.pending && ev.t === 'stats') { if (n && ev.t === 'stats') n.stats = ev; return; }
    if (ev.t === 'stats') {
      n.busy0 ??= ev.busy; n.stats = ev; if (n.prevBusy != null && ev.busy > n.prevBusy) n.busy0 = n.prevBusy; n.prevBusy = ev.busy;
      const c = this.capStats?.native; if (c) { c.frames += ev.cap || 0; c.sent += ev.fps || 0; c.secs++; }
    }
    else if (ev.t === 'resized') { n.w = ev.w; n.h = ev.h; this.onUpdate(); } // janela cresceu (ex.: jogo restaurado depois de minimizado): codificador recriado
    else if ((ev.t === 'error' || ev.t === 'exit') && !n.restarting) this.nativeRestart(ev.error || 'o programa de transmissão fechou');
  }
  // o programa nativo falhou: tenta de novo até NATIVE_RESTARTS vezes em NATIVE_RESTART_WIN ms (Alt+Tab, troca de
  // resolução, placa ocupada por um instante) antes de voltar ao Chromium. Erros que não passam sozinhos (janela fechada,
  // sem codificador) vão direto ao Chromium. Quem assiste perde a imagem por ~1-2 s, em vez de cair para ~48 fps de vez.
  nativeRestart(why) {
    const n = this.native; if (!n || !this.screen) return;
    if (NATIVE_FATAL.test(why)) return this.nativeFallback(why);
    const now = Date.now(); this._natRestarts = (this._natRestarts || []).filter(t => now - t < NATIVE_RESTART_WIN);
    if (this._natRestarts.length >= NATIVE_RESTARTS) return this.nativeFallback(why + '; falhou ' + (NATIVE_RESTARTS + 1) + ' vezes seguidas');
    this._natRestarts.push(now); this.natRestartCount = (this.natRestartCount || 0) + 1; this.natLastError = why;
    this.capLog({ t: 'capnote', msg: `programa nativo reiniciado (${this._natRestarts.length}/${NATIVE_RESTARTS}): ${why}` });
    this.stopNative();
    const wait = this.native = { pending: true, restarting: true }; // segura o lugar: a transmissão não volta ao Chromium no meio
    setTimeout(() => { if (this.native === wait && this.screen) { this.native = null; this.startNative().catch(() => { }); } }, NATIVE_RESTART_DELAY);
    this.onUpdate();
  }
  // o servidor encerrou a sessão nativa (reconexão, programa parou de mandar): tenta de novo uma vez, depois volta ao normal
  onNativeEnded(d) {
    const n = this.native; if (!n || n.producerId !== d.producer_id || d.reason === 'replaced' || d.reason === 'stopped' && !n.stats) return;
    if ((this._natRetry = (this._natRetry || 0) + 1) > 2) return this.nativeFallback('a conexão com o servidor caiu');
    window.lcDesktop?.nativeStop?.(); this.startNative().catch(() => { });
  }
  // o caminho nativo falhou: segue transmitindo pelo Chromium (até ~48 fps), sem derrubar a transmissão
  nativeFallback(why) {
    if (!this.native) return;
    // a janela transmitida fechou (o jogo foi fechado): não há o que transmitir pelo modo normal. Antes tentava a captura
    // do Chromium na janela que não existe mais e terminava em dois avisos vermelhos ("placa de vídeo indisponível" e
    // "a captura nativa falhou e não consegui…"). Agora para a transmissão com um aviso só, sem cara de erro
    if (/janela transmitida foi fechada/i.test(why)) {
      this.capLog({ t: 'capnote', msg: 'janela transmitida fechada: transmissão encerrada' });
      this.stopNative(); this.stopLocal('screen'); this.onScreenNote?.('gone'); this.onUpdate();
      return;
    }
    this._natWhy = /UDP/.test(why) ? 'udp' : /desktop sem suporte/.test(why) ? 'noexe' : 'fail'; this._natWhyText = why;
    this.capLog({ t: 'method', m: 'chromium', from: this.native.method || null, why: 'último recurso: ' + why, auto: true });
    this.stopNative();
    this.chromiumOnWindow().then((okw) => {
      const vt = okw && this.screen?.getVideoTracks()[0];
      if (!vt || this.native) return;
      this.previewOnly(vt, false);
      if (this.sfu) this.sfuProduce('screen', vt).then(() => this.applyOver(), e => console.warn('produce', e));
      this.error = 'Transmissão pela placa de vídeo indisponível (' + why + '). Continuando pelo modo normal (até ~48 FPS).';
      this.onNativeFail?.(this.error); this.onUpdate();
    });
  }
  stopNative() {
    const n = this.native; if (!n) return;
    this.native = null; clearInterval(n.liveTimer);
    window.lcDesktop?.nativeStop?.();
    // ainda preparando: a sessão é fechada quando a resposta chegar (startNative); senão fecha esta
    if (!n.pending) this.sfuReq('native_stop', { producer_id: n.producerId }).catch(() => { });
  }
  // Chromium -> nativo com a transmissão no ar (jogo em tela cheia congelou a captura); se o nativo não der, avisa como antes
  async switchToNative() {
    const vt = this.screen?.getVideoTracks()[0]; if (!vt || this.native) return;
    const nat = await this.wantNative(this.screenOpts || {});
    if (!this.screen || this.native) return;
    if (!nat) { this.onFse?.(this.fse); return; }
    this._natRestarts = []; this._natRetry = 0;
    this.sfuStop('screen'); this.native = { pending: true }; this.previewOnly(vt, true); this.startNative().catch(() => { });
    this.applyOver(); this.onUpdate();
  }
  // método de captura trocado nas configurações com a transmissão no ar: reinicia só o vídeo (1-2 s), voz e sala seguem
  async applyCaptureMode() {
    const vt = this.screen?.getVideoTracks()[0]; if (!vt) return;
    this.capLog({ t: 'capnote', msg: 'método trocado nas configurações: ' + CAPTURE_METHODS[captureMode(this.prefs)] });
    this._natRestarts = []; this._natRetry = 0;
    const nat = await this.wantNative(this.screenOpts || {});
    if (!this.screen) return;
    if (this.native) this.stopNative();
    if (nat) { this.sfuStop('screen'); this.native = { pending: true }; this.previewOnly(vt, true); this.startNative().catch(() => { }); }
    else {
      if (!(await this.chromiumOnWindow())) return;
      const vt = this.screen?.getVideoTracks()[0]; if (!vt) return;
      this.previewOnly(vt, false);
      if (this.sfu && !this.sfu.producers.screen) await this.sfuProduce('screen', vt).catch(e => console.warn('produce', e));
      this.applyOver();
      this.capLog({ t: 'method', m: 'chromium', from: null, why: this._natWhy === 'forced' ? 'forçado nas configurações' : 'nativo indisponível: ' + (this._natWhyText || this._natWhy || '?'), auto: this._natWhy !== 'forced' });
    }
    this.onUpdate();
  }
  // muda resolução/fps/otimização da transmissão em andamento
  async changeScreenQuality(opts) {
    let vt = this.screen?.getVideoTracks()[0]; if (!vt) return;
    const was = this.screenOpts || {}, o = this.screenOpts = { ...this.screenOpts, ...opts };
    // entrar/sair do modo 120 FPS ou mudar a qualidade dele: reinicia o programa nativo (1-2 s)
    const nat = await this.wantNative(o);
    if (nat) {
      if (!this.native) { this.sfuStop('screen'); this.native = { pending: true }; this.previewOnly(vt, true); }
      else if (was.res === o.res && was.fps === o.fps && +was.bitrate === +o.bitrate) { this.onUpdate(); return; }
      else window.lcDesktop?.nativeStop?.();
      this.startNative().catch(() => { }); this.onUpdate(); return;
    }
    if (this.native) {
      this.stopNative();
      if (!(await this.chromiumOnWindow())) return;
      vt = this.screen?.getVideoTracks()[0]; if (!vt) return;
      this.previewOnly(vt, false); if (this.sfu) await this.sfuProduce('screen', vt).catch(e => console.warn('produce', e));
      this.applyOver();
    }
    const c = { frameRate: capFps(o.fps) };
    if (o.res !== 'source') { c.height = { ideal: +o.res, max: +o.res }; c.width = { ideal: Math.round(+o.res * 16 / 9) }; }
    try { await vt.applyConstraints(c); } catch (e) { console.warn('applyConstraints', e); }
    vt.contentHint = o.hint;
    if (this.sfu) this.sfuTuneScreen();
    else for (const p of this.peers.values()) this.tuneSender(p, 'screenvideo', 'screen');
    this.onUpdate();
  }
  publish(kind, stream) {
    if (this.sfu) {
      (kind === 'screen' ? this.sfuPublishScreen() : this.sfuProduce(kind, stream.getVideoTracks()[0])).catch(e => { console.warn('produce', e); this.error = e.message; this.onUpdate(); });
    } else for (const p of this.peers.values()) {
      this.sendMeta(p.uid);
      stream.getTracks().forEach(t => { p.senders[kind + t.kind] = this.p2pAdd(p.pc, t, stream); });
      this.tuneSender(p, kind + 'video', kind);
    }
    this.sendState(); this.onUpdate();
  }
  stopLocal(kind) {
    const s = this[kind]; if (!s) return;
    if (this.sfu) { this.sfuStop(kind); if (kind === 'screen') this.sfuStop('screenaudio'); }
    else for (const p of this.peers.values()) for (const t of s.getTracks()) { const snd = p.senders[kind + t.kind]; if (snd) { try { p.pc.removeTrack(snd); } catch { } delete p.senders[kind + t.kind]; } }
    if (kind === 'screen') { if (this._overOn != null) window.lcDesktop?.watchSourceOver?.(null)?.catch?.(() => { }); this._overOn = null; this._overHid = false; this.stopNative(); this._natWinId = null; this.capHist = null; this.stopAppAudio(); clearInterval(this._gt); this.gov = null; clearInterval(this._fse); this.fse = null; clearInterval(this._sw); clearInterval(this._bk); clearInterval(this._src); this.captureFps = null; this.captureBlack = false; this.screenNote = null; }
    s.getTracks().forEach(t => t.stop()); this[kind] = null;
    playSound(kind === 'cam' ? 'camOff' : 'selfStreamStop');
    this.sendState(); this.onUpdate();
  }
  // amostra de qualidade (a cada 5 s durante a chamada): lê todas as conexões e entrega ao coletor (public/callqual.js)
  async qualitySample() {
    const q = this._cq; if (!q || this._cqBusy) return;
    const pcs = this.sfu ? [this.sfu.send, this.sfu.recv].filter(Boolean) : [...this.peers.values()].map(p => p.pc).filter(Boolean);
    if (!pcs.length) return;
    this._cqBusy = true;
    try { const reps = []; for (const pc of pcs) { try { reps.push(await pc.getStats()); } catch { } } const up = this.sfu ? await this.upStats() : null; if (this._cq === q) q.add(reps, this.sfu ? 'sfu' : 'p2p', up, this.videoKinds(), this.screenSample()); }
    finally { this._cqBusy = false; }
  }
  // sua transmissão nesta amostra (telemetria): caminho, motivo de não ser o nativo, altura pedida e, no nativo, o enviado
  screenSample() {
    const vt = this.screen?.getVideoTracks()[0]; if (!vt || vt.readyState !== 'live') return null;
    const o = this.screenOpts || {}, n = this.native;
    let want = o.res === 'source' ? 0 : +o.res || 0;
    if (!want) { const st = vt.getSettings?.() || {}; want = n ? 0 : st.height || 0; } // "Fonte": a altura que a captura entrega
    if (n && !n.pending) return { path: 'native', want: want || n.h || 0, h: n.stats?.h || n.h || 0, fps: n.stats?.fps ?? null };
    if (n) return null; // nativo ainda começando
    return { path: 'chromium', why: this._natWhy || (window.lcDesktop?.nativeCapable ? 'other' : 'web'), want };
  }
  // de que tipo é cada vídeo (id da faixa -> 'cam' | 'screen'), recebidos e os seus: a qualidade separa câmera de transmissão
  videoKinds() {
    const m = new Map(), put = (st, k) => { for (const t of st?.getVideoTracks?.() || []) m.set(t.id, k); };
    for (const p of this.peers.values()) for (const [k, st] of Object.entries(p.streams || {})) put(st, k === 'screen' ? 'screen' : 'cam');
    put(this.cam, 'cam'); put(this.screen, 'screen');
    return m;
  }
  // perda real da voz que você envia, contada pelo servidor: { count, lost } acumulados, ou null (sem voz saindo / servidor antigo).
  // (o fractionLost que o navegador recebe no SFU é a pior perda entre quem te ouve, não a sua: ver server/sfu.js 'upstats')
  async upStats() {
    if (!this.sfu?.producers?.mic) return null;
    try { const r = await Promise.race([this.sfuReq('upstats'), new Promise((_, no) => setTimeout(() => no(new Error('tempo')), 3000))]); return Number.isFinite(r?.count) ? r : null; } catch { return null; }
  }
  // latência (ms): até o servidor no SFU; pior par na malha; null se ainda não há medida
  async ping() {
    const rtts = [];
    const read = async (src) => { try { for (const r of (await src.getStats()).values()) if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) rtts.push(Math.round(r.currentRoundTripTime * 1000)); } catch { } };
    if (this.sfu) { await read(this.sfu.send); if (!rtts.length && this.sfu.recv) await read(this.sfu.recv); return rtts.length ? Math.min(...rtts) : null; }
    for (const p of this.peers.values()) if (p.pc) await read(p.pc);
    return rtts.length ? Math.max(...rtts) : null;
  }
  // diagnóstico da conexão com o servidor: protocolo (UDP é o ideal; TCP = UDP bloqueado, mais atraso), perda de pacotes
  // nos dois sentidos e oscilação (jitter) da voz que chega. Deltas desde a última leitura.
  async connInfo() {
    const s = this.sfu; if (!s?.send) return null;
    const out = { proto: null, candidate: null, sendLoss: null, recvLoss: null, jitterMs: null };
    let lost = 0, recv = 0, jit = [];
    for (const t of [s.send, s.recv].filter(Boolean)) {
      try {
        const rep = await t.getStats(), byId = new Map([...rep.values()].map(r => [r.id, r]));
        for (const r of rep.values()) {
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && !out.proto) { const lc = byId.get(r.localCandidateId); out.proto = lc?.protocol || null; out.candidate = lc?.candidateType || null; }
          if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost += Math.max(0, r.packetsLost || 0); recv += r.packetsReceived || 0; if (r.jitter != null) jit.push(r.jitter * 1000); }
        }
      } catch { }
    }
    // perda saindo: pelo servidor (o RTCP do SFU traz a pior perda entre quem te ouve, que não é culpa da sua rede)
    const up = await this.upStats(), pu = this._ciUp; this._ciUp = up;
    if (up && pu && up.count >= pu.count && up.lost >= pu.lost) { const dl = up.lost - pu.lost, dr = up.count - pu.count; if (dl + dr > 0) out.sendLoss = dl / (dl + dr); }
    const prev = this._ci; this._ci = { lost, recv };
    if (prev && recv > prev.recv) { const dl = lost - prev.lost, dr = recv - prev.recv; out.recvLoss = Math.max(0, dl) / (Math.max(0, dl) + dr); }
    if (jit.length) out.jitterMs = Math.round(Math.max(...jit));
    return out;
  }
  // estatísticas simples de qualidade (para o painel de conexão)
  async stats() {
    const out = [];
    if (this.sfu) { // uma conexão só (com o servidor); repete a latência para cada participante
      let rtt = null;
      try { for (const r of (await this.sfu.send.getStats()).values()) if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = Math.round(r.currentRoundTripTime * 1000); } catch { }
      const state = this.sfu.recv?.connectionState || 'new';
      for (const p of this.peers.values()) out.push({ uid: p.uid, state: `${state} (via servidor)`, rtt, kbpsIn: 0 });
      return out;
    }
    for (const p of this.peers.values()) {
      let rtt = null, kbpsIn = 0;
      try { for (const r of (await p.pc.getStats()).values()) { if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = Math.round(r.currentRoundTripTime * 1000); } } catch { }
      out.push({ uid: p.uid, state: p.pc.connectionState, rtt, kbpsIn });
    }
    return out;
  }
}

// sons de interface (entrar/sair/chamada) sintetizados — sem arquivos
export function playTone(kind, volume = .15) {
  try {
    const ctx = playTone.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
    const seqs = { join: [[660, 0], [880, .09]], leave: [[880, 0], [520, .09]], mute: [[500, 0]], unmute: [[740, 0]], ring: [[740, 0], [988, .16], [740, .5], [988, .66]], msg: [[880, 0]] };
    for (const [f, t] of seqs[kind] || []) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + t;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(volume, at); g.gain.exponentialRampToValueAtTime(.001, at + .14);
      o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + .15);
    }
    clearTimeout(ctx._nap); ctx._nap = setTimeout(() => { if (ctx.state === 'running') ctx.suspend().catch(() => { }); }, 4000); // dorme sem som tocando
  } catch { }
}
