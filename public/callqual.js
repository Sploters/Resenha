// Qualidade técnica da chamada, medida pelo próprio WebRTC (getStats), em toda chamada e sem perguntar nada: a cada 5 s
// voice.js lê os relatórios das conexões e este coletor guarda atraso (ida e volta), perda de pacotes nos dois sentidos,
// oscilação (jitter), quanto da voz que chegou teve de ser "inventada" pelo decodificador (picote), travadas do vídeo
// recebido e quedas da conexão. No fim da chamada vira um resumo em FAIXAS, contado na telemetria (public/ux.js):
//   call_quality good|fair|poor · call_net métrica:faixa (e proto/route/mode) · call_qcause o que mais pesou
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
  freeze: [0, 2, 5], // travadas do vídeo recebido na chamada toda
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

export class CallQuality {
  constructor(mode) { this.mode = mode; this.samples = []; this.prev = new Map(); this.drops = 0; this.freezes = 0; this.inPk = 0; this.inLost = 0; this.upPk = 0; this.upLost = 0; this.upPrev = null; this.padGaps = 0; this.rxAll = 0; this.proto = null; this.relay = false; }
  // reps: relatórios de getStats() de cada conexão (SFU: envio e recebimento; malha: uma por pessoa)
  // up (só SFU): { count, lost } acumulados da voz que você envia, contados pelo servidor (op 'upstats' em server/sfu.js).
  // No SFU o fractionLost do RTCP NÃO é a sua perda: com a correção de erros do Opus, o mediasoup põe nele a pior perda
  // entre quem te ouve (a internet ruim de um ouvinte virava "perda saindo" sua). Sem `up`, no SFU a perda saindo fica sem medida.
  add(reps, mode = this.mode, up = null) {
    this.mode = mode;
    let rtt = null, sendLoss = null, lost = 0, recv = 0, jit = null, conc = 0, tot = 0;
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
        if (r.type === 'inbound-rtp' && r.kind === 'video' && r.freezeCount != null) {
          const p = this.prev.get(r.id) || {}; this.freezes += Math.max(0, r.freezeCount - (p.f || 0)); this.prev.set(r.id, { f: r.freezeCount });
        }
      }
    }
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
  // queda da conexão (envio e recebimento caem juntos no SFU: uma queda só se vier em menos de 5 s)
  drop(now = Date.now()) { if (this.dropAt == null || now - this.dropAt > 5000) this.drops++; this.dropAt = now; }
  // resumo da chamada inteira (null = pouco dado ou ninguém falando com você)
  summary(ms) {
    const S = this.samples;
    if (S.length < 3 || this.rxAll < 50 || ms < 20e3) return null; // rxAll: chegou voz de alguém (mesmo de quem estava mutado)
    const med = (k) => median(S.map(s => s[k]).filter(v => v != null));
    const levels = S.map(levelOf), n = levels.length, poor = levels.filter(l => l[0] === 2).length, bad = levels.filter(l => l[0] >= 1).length;
    const tally = {}; for (const [lv, k] of levels) if (lv >= (poor / n >= 0.2 ? 2 : 1) && k) tally[k] = (tally[k] || 0) + 1;
    const perMin = this.freezes / (ms / 60e3);
    let grade = poor / n >= 0.2 || this.drops >= 2 || (this.freezes >= 5 && perMin > 2) ? 'poor' : bad / n >= 0.2 || this.drops === 1 || this.freezes >= 3 ? 'fair' : 'good';
    let cause = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (grade !== 'good' && !cause) cause = this.drops ? 'drop' : this.freezes ? 'freeze' : null;
    const m = {
      rtt: med('rtt'), jitter: med('jitter'),
      loss_out: this.mode === 'sfu' ? (this.upPk + this.upLost >= MIN_PK_CALL ? (this.upLost / (this.upPk + this.upLost)) * 100 : null) : med('loss_out'),
      loss_in: this.inPk + this.inLost >= MIN_PK_CALL ? (this.inLost / (this.inPk + this.inLost)) * 100 : null, // da chamada toda
      conceal: med('conceal'), freeze: this.freezes, drop: this.drops,
    };
    const net = Object.entries(m).filter(([, v]) => v != null).map(([k, v]) => k + ':' + bucket(v, QB[k]));
    net.push('mode:' + (this.mode === 'sfu' ? 'sfu' : 'p2p'));
    if (this.proto === 'udp' || this.proto === 'tcp') net.push('proto:' + this.proto);
    net.push('route:' + (this.relay ? 'relay' : 'direct'));
    return { grade, cause: grade === 'good' ? null : cause, net, m, samples: n };
  }
}

// conta o resumo na telemetria (bg: chamada costuma estar com a aba escondida)
export function recordCallQuality(q) {
  if (!q) return;
  track('call_quality', q.grade, { bg: true });
  for (const d of q.net) track('call_net', d, { bg: true });
  if (q.cause) track('call_qcause', q.cause, { bg: true });
}
