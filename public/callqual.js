// Qualidade técnica da chamada, medida pelo próprio WebRTC (getStats), em toda chamada e sem perguntar nada: a cada 5 s
// voice.js lê os relatórios das conexões e este coletor guarda atraso (ida e volta), perda de pacotes nos dois sentidos,
// oscilação (jitter), quanto da voz que chegou teve de ser "inventada" pelo decodificador (picote), travadas do vídeo
// recebido e quedas da conexão. No fim da chamada vira um resumo em FAIXAS, contado na telemetria (public/ux.js):
//   call_quality good|fair|poor · call_net métrica:faixa (e proto/route/mode/slim) · call_qcause o que mais pesou
// Vídeo: travadas da CÂMERA e da TRANSMISSÃO são contadas à parte e por minuto ASSISTIDO (antes era uma soma de todos os
// vídeos da chamada inteira, e 3 travadas já davam nota "média"). Só a câmera pesa na nota da REDE: a transmissão de
// tela trava por motivos de quem transmite (captura do jogo, codificador, CPU), que a rede não explica. Ela vai para o
// painel à parte, com os quadros por segundo recebidos e, do lado de quem transmite, os quadros capturados/enviados e o
// que limitou o envio (CPU, banda ou nada). (No Chromium, tela parada por 20 s não gerou travada falsa:
// scripts/callqual-video-test.mjs.)
//   call_rating_q resposta:nota (cruza "Teve algum problema?" com o que a rede mediu: problema com rede boa = aparelho/app)
// Nada de quem, com quem ou em que sala: só as faixas. Chamada sem voz chegando de ninguém (sozinho na sala) não conta.
import { track } from './ux.js';

export const SAMPLE_MS = 5000;
// limites das faixas (faixa i = até B[i]; a última é "acima do último limite")
export const QB = {
  rtt: [50, 100, 200, 400], // ms
  jitter: [10, 30, 60, 100], // ms
  loss_in: [0.5, 2, 5, 10], // % de pacotes de voz perdidos chegando
  loss_out: [0.5, 2, 5, 10], // % perdidos saindo (o outro lado/servidor informa)
  conceal: [1, 3, 8, 15], // % da voz recebida que foi preenchida pelo decodificador (picote)
  freeze: [0, 2, 5], // travadas do vídeo recebido na chamada toda (todos os vídeos somados; mantido para comparar com antes)
  freeze_cam: [0, 1, 3], // travadas por minuto assistido: câmera
  freeze_scr: [0, 1, 3], // travadas por minuto assistido: transmissão de tela
  scr_fps: [5, 15, 30, 50], // quadros por segundo da transmissão recebida (mediana)
  send_fps: [5, 15, 30, 50], // quadros por segundo da SUA transmissão saindo (mediana)
  drop: [0, 1], // quedas da conexão (0, 1, 2 ou mais)
};
// mínimo de pacotes de voz para calcular perda: num momento (5 s; voz falando = 50/s) e na chamada toda (~10 s de fala)
const MIN_PK = 100, MIN_PK_CALL = 500, MIN_RX = 100; // MIN_RX: pacotes recebidos de um fluxo numa amostra de 5 s (~20/s = alguém falando)
const bucket = (v, b) => { const i = b.findIndex(x => v <= x); return i < 0 ? b.length : i; };
// um momento (5 s) é "médio" ou "ruim" pelo pior indicador; devolve [nível, causa]
const FAIR = { rtt: 200, loss_in: 2, loss_out: 2, jitter: 30, conceal: 3 }, POOR = { rtt: 400, loss_in: 5, loss_out: 5, jitter: 60, conceal: 8 };
export function levelOf(s) {
  for (const [lim, lv] of [[POOR, 2], [FAIR, 1]]) for (const k of Object.keys(lim)) if (s[k] != null && s[k] > lim[k]) return [lv, k];
  return [0, null];
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const newVid = () => ({ freezes: 0, freezeMs: 0, watchMs: 0, fps: [] });
// travadas por minuto assistido (null = menos de 30 s de vídeo desse tipo: não diz nada)
const rate = (v) => (v.watchMs >= 30e3 ? v.freezes / (v.watchMs / 60e3) : null);

export class CallQuality {
  constructor(mode) { this.mode = mode; this.samples = []; this.prev = new Map(); this.drops = 0; this.freezes = 0;
    this.vid = { cam: newVid(), screen: newVid() }; this.sent = { ms: 0, lim: { none: 0, cpu: 0, bandwidth: 0, other: 0 }, fps: [], cap: [] }; this.inPk = 0; this.inLost = 0; this.upPk = 0; this.upLost = 0; this.upPrev = null; this.padGaps = 0; this.rxAll = 0; this.proto = null; this.relay = false; }
  // reps: relatórios de getStats() de cada conexão (SFU: envio e recebimento; malha: uma por pessoa)
  // up (só SFU): { count, lost } acumulados da voz que você envia, contados pelo servidor (op 'upstats' em server/sfu.js).
  // No SFU o fractionLost do RTCP NÃO é a sua perda: com a correção de erros do Opus, o mediasoup põe nele a pior perda
  // entre quem te ouve (a internet ruim de um ouvinte virava "perda saindo" sua). Sem `up`, no SFU a perda saindo fica sem medida.
  // kinds (opcional): Map trackId -> 'cam' | 'screen' dos vídeos (recebidos e os seus), para separar câmera de transmissão
  add(reps, mode = this.mode, up = null, kinds = null) {
    this.mode = mode;
    let rtt = null, sendLoss = null, lost = 0, recv = 0, jit = null, conc = 0, tot = 0;
    const outSeen = new Map();
    for (const rep of reps) {
      const byId = new Map([...rep.values()].map(r => [r.id, r]));
      for (const r of rep.values()) {
        if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) {
          rtt = Math.max(rtt ?? 0, r.currentRoundTripTime * 1000); // malha: o pior par
          const lc = byId.get(r.localCandidateId), rc = byId.get(r.remoteCandidateId);
          if (lc?.protocol) this.proto = this.proto === 'tcp' ? 'tcp' : lc.protocol; // TCP em algum momento = UDP bloqueado
          if (lc?.candidateType === 'relay' || rc?.candidateType === 'relay') this.relay = true;
        }
        if (mode !== 'sfu' && r.type === 'remote-inbound-rtp' && r.kind === 'audio' && r.fractionLost != null) sendLoss = Math.max(sendLoss ?? 0, r.fractionLost * 100);
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          const p = this.prev.get(r.id) || {}; // stream novo começou nesta chamada: conta desde o zero
          const dl = Math.max(0, (r.packetsLost || 0) - (p.l || 0)), dr = Math.max(0, (r.packetsReceived || 0) - (p.r || 0));
          const c = (r.concealedSamples || 0) - (r.silentConcealedSamples || 0), dc = Math.max(0, c - (p.c || 0)), dt = Math.max(0, (r.totalSamplesReceived || 0) - (p.t || 0));
          this.prev.set(r.id, { l: r.packetsLost || 0, r: r.packetsReceived || 0, c, t: r.totalSamplesReceived || 0 });
          conc += dc; tot += dt; this.rxAll += dr;
          // perda chegando, com dois cuidados (medidos em scripts/call-quality-test.mjs):
          // 1) quem está calado/mutado manda poucos pacotes (DTX): sem ~20/s não dá para tirar porcentagem
          // 2) buracos que não são voz: com perda na subida, o Chrome de quem fala manda "enchimento" (padding) de sondagem de
          //    banda no mesmo fluxo do áudio (~300 kbps, pacotes vazios); o SFU descarta os vazios que chegam, mas os perdidos no
          //    caminho viram buracos na numeração e aparecem aqui como perdidos (12% de perda real virava 35%–75%). Perda de voz de
          //    verdade sempre vira voz preenchida pelo decodificador (a correção do Opus salva só parte: 0,7–1,5 quadro preenchido
          //    por pacote perdido nas medidas); com 2x+ mais perdidos que quadros preenchidos, o excesso é enchimento e fica de fora.
          if (dr >= MIN_RX) {
            const filled = dc / 960; // quadros de 20 ms preenchidos (48 kHz)
            let use = dl;
            if (dl > 2 * filled + 10) { use = Math.round(filled); this.padGaps += dl - use; }
            lost += use; recv += dr;
          }
          if (r.jitter != null && dr > 0) jit = Math.max(jit ?? 0, r.jitter * 1000);
        }
        if (r.type === 'inbound-rtp' && r.kind === 'video') this.addVideoIn(r, kinds);
        if (r.type === 'outbound-rtp' && r.kind === 'video') this.addVideoOut(r, byId, kinds, outSeen);
      }
    }
    for (const o of outSeen.values()) if (!o.first && o.fps != null) this.sent.fps.push(o.fps);
    this.inPk += recv; this.inLost += lost;
    if (mode === 'sfu' && up && Number.isFinite(up.count) && Number.isFinite(up.lost)) {
      const p = this.upPrev; this.upPrev = up;
      // contadores voltaram (voz reenviada, nova produção): recomeça a contar daqui
      if (p && up.count >= p.count && up.lost >= p.lost) {
        const dr = up.count - p.count, dl = up.lost - p.lost;
        this.upPk += dr; this.upLost += dl;
        if (dr + dl >= MIN_PK) sendLoss = (dl / (dr + dl)) * 100;
      }
    }
    // perda chegando só com amostra que diga algo: quem está mutado manda ~4 pacotes/s (DTX), e aí 2 perdidos já viravam "10%"
    const s = { rtt, loss_out: sendLoss, loss_in: recv + lost >= MIN_PK ? (lost / (recv + lost)) * 100 : null, jitter: jit, conceal: tot > 0 ? (conc / tot) * 100 : null };
    if (Object.values(s).some(v => v != null)) this.samples.push(s);
    return s;
  }
  // vídeo recebido: travadas (quantas e quanto tempo), tempo assistido (houve quadro novo desde a última leitura) e fps
  addVideoIn(r, kinds) {
    const p = this.prev.get(r.id), fc = r.freezeCount ?? 0, fd = r.totalFreezesDuration ?? 0, fr = r.framesDecoded ?? 0;
    this.prev.set(r.id, { f: fc, d: fd, fr, ts: r.timestamp });
    // com o mapa de faixas, vídeo que não está nele não é de ninguém (ex.: 'probator', a sondagem de banda do mediasoup)
    const k = kinds ? kinds.get(r.trackIdentifier) : 'cam'; if (!k) return;
    const kind = k === 'screen' ? 'screen' : 'cam', v = this.vid[kind];
    const df = Math.max(0, fc - (p?.f || 0)); this.freezes += df; v.freezes += df;
    v.freezeMs += Math.max(0, fd - (p?.d || 0)) * 1000;
    // tempo assistido: desde que o vídeo mostrou o 1º quadro, mesmo sem quadro novo (tela parada ou travada também é tempo
    // na tela; contar só o tempo com quadros novos inflava a fração travada). A 1ª leitura de cada vídeo só marca o ponto.
    if (p && p.fr > 0 && r.timestamp > p.ts) v.watchMs += Math.min(r.timestamp - p.ts, 15e3);
    if (r.framesPerSecond != null && fr > (p?.fr || 0)) v.fps.push(r.framesPerSecond);
  }
  // seu vídeo saindo (só a transmissão de tela interessa aqui): o que limitou (CPU/banda), quadros enviados e capturados
  // (com simulcast há um outbound-rtp por camada, todas da mesma captura: o tempo de limitação conta uma vez por captura e
  // os quadros enviados são os da camada mais alta)
  addVideoOut(r, byId, kinds, seen) {
    const src = byId.get(r.mediaSourceId), kind = src && kinds?.get(src.trackIdentifier);
    if (kind !== 'screen') return;
    const k = 'o:' + r.mediaSourceId, cur = seen.get(k);
    if (cur) { if (r.framesPerSecond != null) cur.fps = Math.max(cur.fps ?? 0, r.framesPerSecond); return; }
    const p = this.prev.get(k), lim = r.qualityLimitationDurations || {};
    this.prev.set(k, { lim: { ...lim } });
    seen.set(k, { fps: r.framesPerSecond ?? null, first: !p });
    if (!p) return;
    let tot = 0; for (const x of Object.keys(this.sent.lim)) { const d = Math.max(0, (lim[x] || 0) - (p.lim[x] || 0)) * 1000; this.sent.lim[x] += d; tot += d; }
    this.sent.ms += tot;
    if (src.framesPerSecond != null) this.sent.cap.push(src.framesPerSecond);
  }
  // nota do vídeo da câmera: pela fração do tempo assistido que ficou travada e por travadas/minuto (precisa de 1 min assistido)
  camLevel() {
    const v = this.vid.cam; if (v.watchMs < 60e3 || !v.freezes) return 0;
    const share = v.freezeMs / v.watchMs, perMin = v.freezes / (v.watchMs / 60e3);
    return v.freezes >= 5 && (share >= 0.08 || perMin > 3) ? 2 : v.freezes >= 3 && (share >= 0.02 || perMin > 1) ? 1 : 0;
  }
  // queda da conexão (envio e recebimento caem juntos no SFU: uma queda só se vier em menos de 5 s)
  drop(now = Date.now()) { if (this.dropAt == null || now - this.dropAt > 5000) this.drops++; this.dropAt = now; }
  // resumo da chamada inteira (null = pouco dado ou ninguém falando com você)
  summary(ms) {
    const S = this.samples;
    if (S.length < 3 || this.rxAll < 50 || ms < 20e3) return null; // rxAll: chegou voz de alguém (mesmo de quem estava mutado)
    const med = (k) => median(S.map(s => s[k]).filter(v => v != null));
    const levels = S.map(levelOf), n = levels.length, poor = levels.filter(l => l[0] === 2).length, bad = levels.filter(l => l[0] >= 1).length;
    const tally = {}; for (const [lv, k] of levels) if (lv >= (poor / n >= 0.2 ? 2 : 1) && k) tally[k] = (tally[k] || 0) + 1;
    // nota = a pior entre rede (momentos ruins), quedas e câmera travando; a causa é a do que de fato puxou a nota para baixo
    // (antes a causa vinha dos poucos momentos de rede ruim mesmo quando a nota tinha caído pelas travadas)
    const netLv = poor / n >= 0.2 ? 2 : bad / n >= 0.2 ? 1 : 0, dropLv = this.drops >= 2 ? 2 : this.drops === 1 ? 1 : 0, camLv = this.camLevel();
    const lv = Math.max(netLv, dropLv, camLv), grade = ['good', 'fair', 'poor'][lv];
    const cause = !lv ? null : netLv === lv ? Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null : dropLv === lv ? 'drop' : 'freeze';
    const m = {
      rtt: med('rtt'), jitter: med('jitter'),
      loss_out: this.mode === 'sfu' ? (this.upPk + this.upLost >= MIN_PK_CALL ? (this.upLost / (this.upPk + this.upLost)) * 100 : null) : med('loss_out'),
      loss_in: this.inPk + this.inLost >= MIN_PK_CALL ? (this.inLost / (this.inPk + this.inLost)) * 100 : null, // da chamada toda
      conceal: med('conceal'), freeze: this.freezes, drop: this.drops,
      freeze_cam: rate(this.vid.cam), freeze_scr: rate(this.vid.screen), scr_fps: median(this.vid.screen.fps), send_fps: median(this.sent.fps),
    };
    const net = Object.entries(m).filter(([, v]) => v != null).map(([k, v]) => k + ':' + bucket(v, QB[k]));
    net.push('mode:' + (this.mode === 'sfu' ? 'sfu' : 'p2p'));
    if (this.proto === 'udp' || this.proto === 'tcp') net.push('proto:' + this.proto);
    net.push('route:' + (this.relay ? 'relay' : 'direct'));
    // sua transmissão: o que mais limitou o envio (com pelo menos 20 s medidos)
    const L = this.sent.lim; if (this.sent.ms >= 20e3) net.push('slim:' + Object.keys(L).reduce((a, b) => (L[b] > L[a] ? b : a), 'none'));
    const v = (x) => ({ freezes: x.freezes, freezeMs: Math.round(x.freezeMs), watchMs: Math.round(x.watchMs), fps: median(x.fps) });
    const video = { cam: v(this.vid.cam), screen: v(this.vid.screen), sent: { ms: Math.round(this.sent.ms), lim: L, fps: median(this.sent.fps), captured: median(this.sent.cap) } };
    return { grade, cause, net, m, samples: n, video };
  }
}

// conta o resumo na telemetria (bg: chamada costuma estar com a aba escondida)
export function recordCallQuality(q) {
  if (!q) return;
  track('call_quality', q.grade, { bg: true });
  for (const d of q.net) track('call_net', d, { bg: true });
  if (q.cause) track('call_qcause', q.cause, { bg: true });
}
