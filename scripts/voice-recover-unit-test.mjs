// Recuperação da voz (public/voice.js) sem navegador: retomada da sessão depois de a conexão com o servidor cair
// (só a última vale; caiu de novo durante a espera não tira da sala), refazer a mídia esperando a conexão voltar, um
// reinício de ICE por transporte de cada vez e o 'online' da rede sem reiniciar o transporte que nunca conectou.
// Uso: node scripts/voice-recover-unit-test.mjs
import fs from 'node:fs';
// voice.js importa módulos do navegador: carrega o arquivo com os imports trocados por versões vazias
const stubs = `const playSound = () => { }, createFx = () => null, loadFx = async () => { }, FX_IDS = [], track = () => { }, stopTimer = () => { }, cancelTimer = () => { }, timing = () => { };
class CallQuality { drop() { } summary() { return null; } } const SAMPLE_MS = 5000, recordCallQuality = () => { }, attachTap = () => null;`;
const src = stubs + fs.readFileSync(new URL('../public/voice.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
const handlers = {};
globalThis.document = { addEventListener() { }, dispatchEvent() { }, hidden: false };
globalThis.window = { addEventListener: (t, f) => { (handlers[t] ||= []).push(f); } };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
const { Voice } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
console.warn = () => { }; // avisos esperados (pedidos cancelados ao sair)
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Voice "na sala" sem mídia de verdade: guarda o que mandaria ao servidor; up=false simula a conexão caída
function mk() {
  const sent = [], v = new Voice({ send: (t, d) => { if (!v.up) return false; sent.push({ t, d }); }, myId: 'me', onUpdate() { }, prefs: {} });
  v.up = true; v.sent = sent; v.channelId = 'c1'; v.updateMonitor = () => { }; v.sendStateNow = () => { }; v.capLog = () => { };
  v.rejoins = 0; v.rejoin = () => { v.rejoins++; };
  return v;
}
const count = (v, t, op) => v.sent.filter(m => m.t === t && (!op || m.d.op === op)).length;

{ // 1) duas retomadas seguidas (a conexão caiu de novo logo depois de voltar): a 1ª fica sem resposta, a 2ª dá certo
  const v = mk(); v._gotJoined = true;
  v.linkDown(); const p1 = v.resume(); v.linkDown(); const p2 = v.resume();
  v._resumeWait({ ok: true, channel_id: 'c1' }); await p2;
  await Promise.race([p1, sleep(4300)]);
  ok(v.rejoins === 0, 'retomada antiga sem resposta não entra de novo na sala', v.rejoins);
  ok(!v._linkDown, 'retomada OK libera os pedidos ao SFU');
}
{ // 2) a conexão caiu de novo durante a espera da resposta: nada de entrar de novo (o próximo READY retoma)
  const v = mk(); v._gotJoined = true; v.linkDown();
  const p = v.resume(); v.linkDown(); await p;
  ok(v.rejoins === 0, 'caiu durante a retomada: não entra de novo', v.rejoins);
  ok(v._linkDown, 'continua esperando a conexão');
}
{ // 3) a resposta da entrada (VOICE_JOINED) se perdeu na queda: sem mídia nenhuma, entra de novo
  const v = mk(); v.linkDown(); const p = v.resume(); v._resumeWait({ ok: true, channel_id: 'c1' }); await p;
  ok(v.rejoins === 1, 'sem VOICE_JOINED: entra de novo', v.rejoins);
}
{ // 4) refazer a mídia com a conexão caída espera a retomada; depois dela vai na hora
  const v = mk(); v._gotJoined = v._sfuMode = true; v.linkDown(); v.up = false;
  v.mediaReconnect('ice'); await sleep(1700);
  ok(v._mrDeferred && !v._mrTimer, 'sem conexão: SFU_REJOIN fica para a retomada');
  v.up = true; const p = v.resume(); v._resumeWait({ ok: true, channel_id: 'c1' }); await p; await sleep(1700);
  ok(count(v, 'SFU_REJOIN') === 1, 'retomada refaz a mídia uma vez', count(v, 'SFU_REJOIN'));
  v.leave({ silent: true });
  ok(!v._mrTimer && !v._mrWait && !v.recovering, 'sair limpa a recuperação');
}
{ // 5) um reinício de ICE por transporte de cada vez; o transporte que nunca conectou ('new') fica quieto no 'online'
  const v = mk(); v._gotJoined = v._sfuMode = true;
  const tr = (id, st) => ({ id, connectionState: st, closed: false, restartIce: async () => { }, close() { } });
  const s = { cid: 'c1', ready: true, consumers: new Map(), seen: new Set(), send: tr('s', 'new'), recv: tr('r', 'failed'), timers: new Map() };
  v.sfu = s;
  v.iceRestart(s.recv, s); v.iceRestart(s.recv, s); for (const f of handlers.online) f();
  ok(count(v, 'SFU', 'restart_ice') === 1, 'reinícios simultâneos viram um', count(v, 'SFU', 'restart_ice'));
  ok(!v.sent.some(m => m.d?.transport_id === 's'), "transporte 'new' não é reiniciado");
  ok(s.iceTries === 1, 'gastou uma tentativa só', s.iceTries);
  v.leave({ silent: true });
  ok(s.timers.size === 0, 'sair limpa os reinícios agendados', s.timers.size);
}
{ // 6) pedido ao SFU sem conexão falha na hora (antes, 15 s esperando)
  const v = mk(); v.up = false; const t0 = Date.now();
  const e = await v.sfuReq('producers').then(() => null, (x) => x);
  ok(e && Date.now() - t0 < 100, 'sem conexão: pedido falha na hora', e?.message);
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
