// Nota e causa da qualidade da chamada (public/callqual.js) com relatórios do getStats() montados à mão, sem navegador:
// travadas da câmera e da transmissão separadas e por minuto assistido, a causa certa quando a nota cai pelo vídeo, e o
// lado de quem transmite (o que limitou o envio, quadros enviados) sem contar duas vezes as camadas do simulcast.
// Uso: node scripts/callqual-unit-test.mjs
import fs from 'node:fs';
// callqual.js importa ux.js (que precisa do navegador): carrega o arquivo com o import trocado por um track() vazio
const src = fs.readFileSync(new URL('../public/callqual.js', import.meta.url), 'utf8').replace(/^import \{ track \} from '\.\/ux\.js';$/m, 'const track = () => { };');
const { CallQuality } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

const STEP = 5000;
// uma amostra: rede limpa (voz chegando, 250 pacotes em 5 s) + os vídeos pedidos
function sample(i, { cam, scr, out, rtt = 20, lossIn = 0 } = {}) {
  const ts = i * STEP, r = [];
  r.push({ id: 'cp', type: 'candidate-pair', nominated: true, currentRoundTripTime: rtt / 1000, localCandidateId: 'lc', remoteCandidateId: 'rc', timestamp: ts });
  r.push({ id: 'lc', type: 'local-candidate', protocol: 'udp', candidateType: 'host' }, { id: 'rc', type: 'remote-candidate', candidateType: 'host' });
  const rx = 250 * (i + 1), lost = Math.round(rx * lossIn);
  r.push({ id: 'ain', type: 'inbound-rtp', kind: 'audio', packetsReceived: rx, packetsLost: lost, totalSamplesReceived: 240000 * (i + 1), concealedSamples: lost * 960, silentConcealedSamples: 0, jitter: 0.004, timestamp: ts });
  if (cam) r.push({ id: 'vcam', type: 'inbound-rtp', kind: 'video', trackIdentifier: 'tcam', framesDecoded: 150 * (i + 1), framesPerSecond: 30, freezeCount: cam.f(i), totalFreezesDuration: cam.d(i), timestamp: ts });
  if (scr) r.push({ id: 'vscr', type: 'inbound-rtp', kind: 'video', trackIdentifier: 'tscr', framesDecoded: 20 * (i + 1), framesPerSecond: 4, freezeCount: scr.f(i), totalFreezesDuration: scr.d(i), timestamp: ts });
  if (out) {
    r.push({ id: 'ms', type: 'media-source', kind: 'video', trackIdentifier: 'mine', framesPerSecond: out.cap });
    // três camadas (simulcast) da mesma captura: mesmo tempo de limitação, quadros diferentes
    const t = (i * STEP) / 1000;
    for (const [rid, fps] of [['l', out.fps / 4], ['m', out.fps / 2], ['h', out.fps]])
      r.push({ id: 'o' + rid, type: 'outbound-rtp', kind: 'video', rid, mediaSourceId: 'ms', framesPerSecond: fps, qualityLimitationDurations: { none: t * (1 - out.cpu), cpu: t * out.cpu, bandwidth: 0, other: 0 }, timestamp: ts });
  }
  return new Map(r.map(x => [x.id, x]));
}
const kinds = new Map([['tcam', 'cam'], ['tscr', 'screen'], ['mine', 'screen']]);
function call(n, opts) { const q = new CallQuality(); for (let i = 0; i < n; i++) q.add([sample(i, opts)], 'sfu', { count: 250 * (i + 1), lost: 0 }, kinds); return q.summary(n * STEP); }
const has = (q, d) => q.net.includes(d);

// 1) só a transmissão "travando" (tela parada: 12 travadas em 2 min) e rede limpa: nota boa, mas aparece no painel
{
  const q = call(24, { scr: { f: (i) => Math.floor(i / 2), d: (i) => i * 0.8 } });
  ok(q.grade === 'good' && q.cause === null, 'transmissão de tela com travadas e rede limpa: nota boa (não é mais "média")', { grade: q.grade, cause: q.cause });
  ok(has(q, 'freeze_scr:3') && has(q, 'scr_fps:0'), 'as travadas da transmissão vão para o painel (por minuto) com os quadros por segundo', q.net);
  ok(q.video.screen.freezes === 11 && q.video.screen.watchMs === 23 * STEP, 'tempo assistido e travadas da transmissão contados', q.video.screen);
}
// 2) câmera travando de verdade (10% do tempo, 4 por minuto): nota ruim e a causa é o vídeo, não a rede
{
  const q = call(24, { cam: { f: (i) => Math.floor(i / 3) * 2, d: (i) => i * 0.5 }, lossIn: 0 });
  ok(q.grade === 'poor' && q.cause === 'freeze', 'câmera travando muito: nota ruim e causa "vídeo travando"', { grade: q.grade, cause: q.cause, v: q.video.cam });
  ok(has(q, 'freeze_cam:3'), 'travadas da câmera por minuto na faixa de cima', q.net);
}
// 3) câmera com poucas travadas curtas (3 em 2 min, 0,3% do tempo): continua boa
{
  const q = call(24, { cam: { f: (i) => Math.min(3, Math.floor(i / 8)), d: (i) => Math.min(3, Math.floor(i / 8)) * 0.12 } });
  ok(q.grade === 'good', 'três travadinhas curtas na câmera em 2 min: nota boa (antes: média)', { grade: q.grade, v: q.video.cam });
}
// 4) rede ruim de verdade (perda de 6% o tempo todo): a causa continua sendo a rede
{
  const q = call(12, { lossIn: 0.06 });
  ok(q.grade === 'poor' && q.cause === 'loss_in', 'perda alta chegando: nota ruim e causa "perda chegando"', { grade: q.grade, cause: q.cause });
}
// 5) quem transmite: CPU limitando metade do tempo, simulcast com 3 camadas
{
  const q = call(12, { out: { cap: 60, fps: 24, cpu: 0.3 } });
  ok(has(q, 'slim:none'), 'o que mais limitou o envio vai para a telemetria (aqui: nada, 70% do tempo)', q.net);
  ok(Math.abs(q.video.sent.lim.cpu - 0.3 * 11 * STEP) < 1 && Math.abs(q.video.sent.ms - 11 * STEP) < 1, 'limitação contada uma vez por captura (não três, uma por camada)', q.video.sent.lim);
  ok(q.video.sent.fps === 24 && q.video.sent.captured === 60 && has(q, 'send_fps:2'), 'quadros enviados = camada mais alta; capturados à parte', q.video.sent);
  const q2 = call(12, { out: { cap: 60, fps: 12, cpu: 1 } });
  ok(has(q2, 'slim:cpu') && has(q2, 'send_fps:1'), 'CPU limitando o tempo todo: "slim:cpu" e poucos quadros', q2.net);
}
process.exit(fails ? 1 : 0);
