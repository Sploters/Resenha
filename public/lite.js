// Modo leve: um botão que desliga o que pesa na CPU/GPU (bom para jogar com o app aberto) e lembra os valores anteriores para desfazer.
import { h, icon, whenGone } from './util.js';
import { S, savePrefs, applyTheme, toast, desktop } from './state.js';
import { toggle, row, section } from './ui.js';
import { refreshFreeze } from './freeze.js';
import { stopAllBuffers } from './clips.js';
import { leave } from './motion.js';

const HEAVY_NOISE = ['rnnoise', 'gtcrn'];
const scr = () => ({ res: 1080, fps: 30, hint: 'motion', audio: true, ...S.prefs.screen });
// cada item: valor leve a partir do valor atual (undefined = já está leve) e descrição para a lista
const ITEMS = [
  { key: 'animations', lite: (v) => (v !== false ? false : undefined), title: 'Animações da interface', desc: 'Sem transições ao trocar de canal, abrir janelas e receber mensagens.' },
  { key: 'animMode', lite: (v) => ((v || 'always') !== 'never' ? 'never' : undefined), title: 'Avatares e banners animados', desc: 'GIFs ficam parados (decodificar animações gasta CPU o tempo todo).' },
  { key: 'noiseMode', lite: (v) => (HEAVY_NOISE.includes(v) ? 'standard' : undefined), title: 'Redução de ruído leve', desc: 'Troca a redução por IA (RNNoise/GTCRN) pela do navegador, bem mais leve. Cancelamento de eco e ganho automático continuam: custam quase nada e evitam eco na chamada.' },
  { key: 'clipsOn', lite: (v) => (v !== false ? false : undefined), title: 'Gravação de clipes em segundo plano', desc: 'Para de gravar os últimos 60 s das transmissões que você assiste.' },
  { key: 'screen', lite: (v) => { const o = { res: 1080, fps: 30, ...v }; return o.res === 'source' || o.res > 720 || o.fps > 30 ? { ...scr(), res: 720, fps: 30 } : undefined; }, title: 'Transmissão em 720p • 30 fps', desc: 'Valor inicial ao transmitir a tela (dá para mudar na hora). Codificar menos pixels deixa mais folga para o jogo.' },
];
if (desktop) ITEMS.push({ key: null, title: 'Economia em segundo plano', desc: 'Com o app minimizado, na bandeja ou atrás de um jogo em tela cheia, o Windows pode desacelerar a Resenha — também em chamada (menos quando você está transmitindo).' });

export const liteOn = () => !!S.prefs.lightMode;
let skipGame = null, misses = 0, lastGame = null, lastGameTitle = null; // automático com o jogo aberto (gameChanged, abaixo)

// app desktop: deixa o Chromium desacelerar a página escondida (minimizada, na bandeja ou coberta pelo jogo: timers de JS
// no máximo 1x/s, sem desenhar). Vale também em chamada: a voz não depende de timers da página (microfone, efeitos e cifra
// rodam na thread de áudio e no worker; a voz dos outros e o soundboard tocam pelo áudio; o atalho do PTT só existe com a
// janela em foco). Medido (scripts/call-throttle-test.mjs): com o microfone capturando o Chromium nem desacelera os timers,
// então em chamada o ganho é pequeno — a página escondida já gasta ~2–3 ms/s por pausar vídeo, "falando" e desenho sozinha.
// Fica de fora quem está transmitindo: os medidores da transmissão (fps real, imagem preta, janela minimizada, qualidade
// automática) rodam a cada 1–3 s.
let throttled = null;
export const throttleWanted = (voice) => liteOn() && !(voice?.active && (voice.screen || voice.native));
export function syncThrottle(voice) {
  const on = throttleWanted(voice);
  if (on === throttled || !desktop?.setThrottle) return;
  throttled = on; desktop.setThrottle(on);
}

// opts.auto: ligado/desligado pelo jogo aberto (só o que não mexe na qualidade da call nem da transmissão; aviso próprio)
export function setLite(on, voice, opts = {}) {
  const P = S.prefs, prevNoise = P.noiseMode;
  if (on === liteOn()) return;
  if (!opts.auto) { delete P.liteAutoGame; if (!on) skipGame = lastGame; } // à mão: o automático não desfaz o que a pessoa escolheu (desligou com o jogo aberto: não religa até ele fechar)
  if (on) {
    const prev = {}, applied = {};
    for (const it of ITEMS) { if (!it.key || (opts.auto && AUTO_SKIP.includes(it.key))) continue; const v = it.lite(P[it.key]); if (v === undefined) continue; prev[it.key] = P[it.key] ?? null; P[it.key] = applied[it.key] = v; }
    P.lightPrev = { prev, applied };
  } else {
    // só desfaz o que continua como o modo leve deixou (se você mudou algo depois, fica como você mudou)
    const { prev = {}, applied = {} } = P.lightPrev || {};
    for (const k of Object.keys(prev)) if (JSON.stringify(P[k]) === JSON.stringify(applied[k])) { if (prev[k] === null) delete P[k]; else P[k] = prev[k]; }
    delete P.lightPrev;
  }
  P.lightMode = on; savePrefs(); applyTheme(); refreshFreeze();
  if (P.clipsOn === false) stopAllBuffers();
  if (voice?.active && P.noiseMode !== prevNoise) voice.rebuildMic();
  syncThrottle(voice);
  document.dispatchEvent(new Event('lite-changed')); // avisos discretos (Configurações, cartão do usuário) se atualizam
  toast(opts.auto ? (on ? `${opts.game || 'Jogo'} aberto: modo leve ligado até você fechar o jogo` : 'Jogo fechado: modo leve desligado') : on ? 'Modo leve ativado' : 'Modo leve desativado: configurações anteriores de volta');
}

// ---------- automático com o jogo aberto (app desktop) ----------
// A detecção do "Jogando X" (a cada 20 s) chama gameChanged. Jogo abriu e o modo leve está desligado: liga só a parte que
// não afeta a call nem a transmissão (animações, GIFs parados, clipes em segundo plano, economia com a janela escondida;
// a redução de ruído e a qualidade da transmissão ficam como estão). Jogo fechou (duas leituras seguidas sem jogo):
// desliga, se foi o automático que ligou. Desligar à mão durante o jogo vale até aquele jogo fechar.
const AUTO_SKIP = ['noiseMode', 'screen'];
export const liteAutoOn = () => !!desktop?.detectGame && S.prefs.liteAuto !== false;
export function gameChanged(game, voice) {
  lastGame = game?.id || null; lastGameTitle = game?.title || game?.name || null;
  if (!liteAutoOn()) return;
  const P = S.prefs;
  if (game) {
    misses = 0;
    if (skipGame === game.id) return;
    if (!liteOn()) { setLite(true, voice, { auto: true, game: game.title }); P.liteAutoGame = game.id; savePrefs(); }
    else if (P.liteAutoGame && P.liteAutoGame !== game.id) { P.liteAutoGame = game.id; savePrefs(); }
    return;
  }
  if (++misses < 2) return;
  skipGame = null;
  if (P.liteAutoGame && liteOn()) setLite(false, voice, { auto: true });
  if (P.liteAutoGame) { delete P.liteAutoGame; savePrefs(); }
}

// ---------- processador no limite: sugerir uma redução de ruído mais leve ----------
// Custo medido (scripts/noise-cpu.mjs, % de um núcleo além de "Nenhuma"): Padrão ~0,2, RNNoise ~3, GTCRN ~7,6. Com a pressão
// de CPU do sistema (PressureObserver: jogo, transmissão, PC fraco) em "serious"/"critical" por 15 s seguidos, em chamada
// e com uma das IAs ligada, oferece trocar por uma mais leve (GTCRN → RNNoise → Padrão). Uma vez por filtro por sessão; com
// a janela escondida espera ela voltar (a sugestão tem botão). O modo leve automático (jogo) não mexe no ruído sozinho:
// esta é a forma de a pessoa decidir. Sem PressureObserver (navegador antigo): não sugere.
export const LIGHTER_NOISE = { gtcrn: 'rnnoise', rnnoise: 'standard' };
const NOISE_NAME = { gtcrn: 'Máxima (GTCRN)', rnnoise: 'Forte (RNNoise)', standard: 'Leve (navegador)' };
const PR = { hotMs: 15000, obs: null, state: 'nominal', since: 0, t: 0, offered: new Set(), pending: false, getVoice: null, shown: null };
const isHot = (st) => st === 'serious' || st === 'critical';
export function startPressureWatch(getVoice) {
  PR.getVoice = getVoice;
  if (PR.obs || typeof window.PressureObserver !== 'function') return;
  try {
    PR.obs = new PressureObserver((recs) => pressureChanged(recs[recs.length - 1]?.state));
    PR.obs.observe('cpu', { sampleInterval: 2000 }).catch(() => { PR.obs = null; });
  } catch { PR.obs = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && PR.pending) checkPressure(); });
}
export function pressureChanged(st) {
  if (!st) return;
  const was = isHot(PR.state); PR.state = st;
  if (isHot(st) && !was) { PR.since = Date.now(); clearTimeout(PR.t); PR.t = setTimeout(checkPressure, PR.hotMs); }
  else if (!isHot(st)) { clearTimeout(PR.t); PR.pending = false; }
}
function checkPressure() {
  PR.pending = false;
  const v = PR.getVoice?.(), mode = S.prefs.noiseMode || 'standard', next = LIGHTER_NOISE[mode];
  if (!isHot(PR.state) || Date.now() - PR.since < PR.hotMs - 50 || !v?.active || !next || PR.offered.has(mode)) return;
  if (document.hidden) { PR.pending = true; return; } // jogando com a janela atrás: mostra quando ela voltar
  PR.offered.add(mode); suggestNoise(mode, next, v);
}
function suggestNoise(mode, next, voice) {
  document.getElementById('toast')?.remove();
  let t = 0;
  const close = () => { clearTimeout(t); if (el.isConnected) leave(el, 160); };
  const el = h('div#toast.lite-sug', { role: 'status' },
    h('div', h('b', 'Seu processador está no limite.'), ` A redução de ruído ${NOISE_NAME[mode]} usa ${mode === 'gtcrn' ? '~2,5x a CPU da Forte' : 'IA o tempo todo'}; a ${NOISE_NAME[next]} pesa bem menos.`),
    h('div.lite-sug-b',
      h('button.btn.sm', { type: 'button', onclick: () => { close(); S.prefs.noiseMode = next; savePrefs(); if (voice?.active) voice.rebuildMic(); document.dispatchEvent(new Event('lite-changed')); toast(`Redução de ruído: ${NOISE_NAME[next]}`); } }, 'Trocar para ' + NOISE_NAME[next].split(' ')[0]),
      h('button.btn.link.sm', { type: 'button', onclick: close }, 'Agora não')));
  document.body.append(el); PR.shown = el;
  t = setTimeout(close, 15000);
}
export const _pressure = PR; // testes

export function litePage(ctx) {
  const box = h('div');
  const draw = () => {
    const on = liteOn(), applied = S.prefs.lightPrev?.applied || {};
    box.replaceChildren(
      h('div.card2.litehero' + (on ? '.on' : ''),
        h('div', h('div.rt', on ? 'Modo leve ativado' : 'Ativar modo leve'), h('div.rd', on ? 'Desligue para voltar exatamente às configurações que você tinha.' : 'Um clique para a Resenha pesar o mínimo possível no computador. Ideal para jogar com o app aberto.')),
        toggle(on, (v) => { setLite(v, ctx?.voice); draw(); })),
      desktop?.detectGame && h('div.card2', row('Ligar sozinho quando um jogo abrir', 'Com um jogo aberto (a mesma detecção do "Jogando…"), o modo leve liga sozinho e desliga quando o jogo fecha. No automático a redução de ruído e a qualidade da transmissão não mudam, para a call e a live continuarem iguais.',
        toggle(S.prefs.liteAuto !== false, (v) => { S.prefs.liteAuto = v; savePrefs(); }))),
      section('Consumo agora'), usagePanel(ctx),
      section('O que o modo leve faz'),
      h('div.card2', ITEMS.map(it => row(h('span.litet', icon(on && !(it.key && !(it.key in applied)) ? 'check' : 'dot', 16), it.title), it.desc + (on && it.key && !(it.key in applied) ? ' (já estava assim)' : ''), null))),
      section('O que já vem leve na Resenha'),
      h('div.card2',
        row('Sem sobreposição dentro do jogo', 'A Resenha não injeta nada no jogo, então não há overlay para desligar.', null),
        row('Sem coleta de dados', 'Nenhum rastreamento ou telemetria: o servidor é seu.', null),
        row('Prioridade normal', 'O app roda com prioridade normal do Windows; não é preciso mexer no Gerenciador de Tarefas.', null)),
      ...(desktop ? [section('Opcional'), h('div.card2', h('div.hdacc', 'Carregando…'))] : []));
    if (desktop) desktop.getSettings().then(s => box.querySelector('.hdacc')?.replaceWith(
      row('Aceleração de hardware', 'Desligar só ajuda se a placa de vídeo estiver no limite com o jogo: a interface e os vídeos passam para a CPU, o que costuma pesar mais. Reinicia o app.', toggle(s.hardwareAcceleration !== false, v => { desktop.setSettings({ hardwareAcceleration: v }); toast('Reinicie o app para aplicar'); }))));
  };
  draw();
  return h('div', h('h2', 'Modo leve'), box);
}

// ---------- consumo agora ----------
// App desktop: CPU e memória de cada processo do Chromium agrupados pelo que fazem (atualiza a cada 2 s enquanto a página
// está aberta). Navegador: só a memória da página (o resto aparece no gerenciador de tarefas do navegador, Shift+Esc).
// Embaixo, o que está ligado agora e costuma pesar, com o atalho para aliviar.
const GROUP = (m) => m.type === 'Browser' ? 'Janela e sistema' : m.type === 'Tab' ? 'Interface (chat, voz, vídeos)' : m.type === 'GPU' ? 'Placa de vídeo (desenho e vídeo)'
  : /audio/i.test(m.service) ? 'Áudio' : /video_capture|capture/i.test(m.service) ? 'Captura de tela/câmera' : /network/i.test(m.service) ? 'Rede' : 'Outros';
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
// ---------- pico de consumo ----------
// Medido desde que o app abriu (não só com esta tela aberta): a cada 10 s, e a cada 2 s com a tela à vista. Guarda o maior
// uso de processador e de memória, a hora e o que estava acontecendo (chamada, transmissão, jogo aberto…), mais os
// últimos 10 min para o gráfico. No navegador só dá para medir a memória da página.
const USE = { since: Date.now(), cpu: null, mem: null, parts: new Map(), hist: [], getVoice: null, t: 0 };
const cores = () => navigator.hardwareConcurrency || 1;
const pcTxt = (c) => (c / cores()).toFixed(1).replace('.', ',') + '%'; // percentCPUUsage é por núcleo
function doing() {
  const v = USE.getVoice?.(), out = [];
  if (v?.screen) out.push('transmitindo'); else if (v?.active) out.push('em chamada');
  if (S.watching?.size) out.push(`assistindo ${S.watching.size}`);
  if (v?.cam) out.push('câmera ligada');
  if (lastGameTitle || lastGame) out.push((lastGameTitle || 'jogo') + ' aberto');
  if (liteOn()) out.push('modo leve');
  return out.join(' · ');
}
async function sample() {
  let cpu = 0, mem = 0; const g = new Map();
  if (desktop?.appMetrics) {
    let ms = await desktop.appMetrics().catch(() => []); if (!Array.isArray(ms)) ms = [];
    for (const m of ms) { const k = GROUP(m), x = g.get(k) || { cpu: 0, mem: 0 }; x.cpu += m.cpu; x.mem += m.mem; g.set(k, x); cpu += m.cpu; mem += m.mem; }
  } else if (performance.memory) mem = performance.memory.usedJSHeapSize;
  else return null;
  const now = Date.now(), what = doing();
  if (desktop?.appMetrics && (!USE.cpu || cpu > USE.cpu.v)) USE.cpu = { v: cpu, at: now, what };
  if (!USE.mem || mem > USE.mem.v) USE.mem = { v: mem, at: now, what };
  for (const [k, x] of g) { const p = USE.parts.get(k) || { cpu: 0, mem: 0 }; p.cpu = Math.max(p.cpu, x.cpu); p.mem = Math.max(p.mem, x.mem); USE.parts.set(k, p); }
  USE.hist.push({ at: now, cpu, mem }); while (USE.hist.length && now - USE.hist[0].at > 600e3) USE.hist.shift();
  return { cpu, mem, g };
}
// chamado na abertura do app (app.js): começa a medir em segundo plano
export function startUsageWatch(getVoice) {
  USE.getVoice = getVoice; if (USE.t) return;
  sample(); USE.t = setInterval(() => { if (!usageOpen) sample(); }, 10e3);
}
export const usagePeak = () => ({ since: USE.since, cpu: USE.cpu, mem: USE.mem, parts: Object.fromEntries(USE.parts) });
let usageOpen = false;
const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// mini gráfico dos últimos 10 min (linha de agora + ponto no pico)
function spark(key, peak) {
  const pts = USE.hist; if (pts.length < 2) return null;
  const W = 220, H = 36, t0 = Math.max(Date.now() - 600e3, Math.min(pts[0].at, Date.now() - 60e3)), span = Date.now() - t0, max = Math.max(1, peak?.v || 0, ...pts.map(p => p[key]));
  const x = (t) => Math.max(0, (t - t0) / span * W), y = (v) => H - 2 - v / max * (H - 4);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p.at).toFixed(1) + ' ' + y(p[key]).toFixed(1)).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'us-spark'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
    (peak && peak.at >= t0 ? `<circle cx="${x(peak.at).toFixed(1)}" cy="${y(peak.v).toFixed(1)}" r="3" class="us-pkdot"/>` : '');
  return svg;
}
function peakBox() {
  const P = usagePeak(), stat = (label, pk, fmt, key) => pk && h('div.us-pk',
    h('div.us-pkt', h('span', label), h('b', fmt(pk.v)), h('small', `às ${hhmm(pk.at)}${pk.what ? ' — ' + pk.what : ''}`)), spark(key, pk));
  return h('div.us-peak',
    h('div.rt', `Pico desde que o app abriu (${hhmm(P.since)})`, h('button.btn.link.sm', { type: 'button', title: 'Começar a contar o pico de novo a partir de agora', onclick: () => { USE.cpu = USE.mem = null; USE.parts.clear(); USE.hist.length = 0; USE.since = Date.now(); sample(); } }, 'Zerar')),
    h('div.us-pks', stat('Processador', P.cpu, pcTxt, 'cpu'), stat(desktop?.appMetrics ? 'Memória' : 'Memória da página', P.mem, mb, 'mem')));
}

function usagePanel(ctx) {
  const box = h('div.card2.usage', h('div.hintline.keep', 'Medindo…'));
  let t = 0;
  const heavy = () => {
    const v = ctx?.voice, P = S.prefs, out = [];
    if (v?.active && HEAVY_NOISE.includes(P.noiseMode)) out.push(['Redução de ruído por IA', `Processa sua voz o tempo todo (${P.noiseMode === 'gtcrn' ? 'a Máxima, ~7%' : 'a Forte, ~3%'} de um núcleo num PC comum). A "Leve" do navegador quase não pesa.`]);
    if (S.watching?.size) out.push([`Assistindo ${S.watching.size} transmiss${S.watching.size === 1 ? 'ão' : 'ões'}`, 'Cada vídeo decodificado pesa na placa de vídeo. Feche as que não está vendo.']);
    if (S.watching?.size && P.clipsOn !== false) out.push(['Clipes em segundo plano', 'Guarda os últimos 60 s de cada transmissão assistida para o atalho de clipe: recomprime o vídeo o tempo todo (sem o codificador da placa de vídeo, ~18% de um núcleo por transmissão em 1080p) e ocupa até ~50 MB de memória cada.']);
    if (v?.screen) out.push(['Você está transmitindo', 'Capturar e comprimir a tela pesa. 720p • 30 fps alivia bastante.']);
    if (v?.cam) out.push(['Câmera ligada', 'Comprimir a câmera usa CPU.']);
    if (P.animations !== false) out.push(['Animações da interface', 'Pouco, mas somam com o jogo.']);
    if ((P.animMode || 'always') !== 'never') out.push(['GIFs animados', 'Avatares e banners animados são decodificados sem parar.']);
    return out;
  };
  const draw = async () => {
    const rows = [], cur = await sample();
    if (desktop?.appMetrics && cur) {
      const { cpu, mem, g } = cur, pc = pcTxt;
      rows.push(h('div.us-total', h('div', h('b', pc(cpu)), h('span', 'do processador')), h('div', h('b', mb(mem)), h('span', 'de memória'))));
      const maxMem = Math.max(1, ...[...g.values()].map(x => x.mem));
      rows.push(h('div.us-rows', h('div.us-row.us-hd', h('span'), h('span'), h('small', 'agora'), h('small', 'CPU'), h('small', 'pico')),
        [...g].sort((a, b) => b[1].mem - a[1].mem).map(([k, x]) => { const p = USE.parts.get(k);
          return h('div.us-row', h('span', k), h('div.us-bar', h('i', { style: { width: Math.max(2, x.mem / maxMem * 100) + '%' } }), p && h('u', { style: { left: Math.min(100, p.mem / maxMem * 100) + '%' }, title: 'Pico de memória: ' + mb(p.mem) })), h('b', mb(x.mem)), h('small', pc(x.cpu)), h('small.us-pkc', { title: `Pico: ${mb(p?.mem || 0)} de memória e ${pc(p?.cpu || 0)} do processador` }, mb(p?.mem || 0))); })));
    } else {
      const pm = performance.memory;
      rows.push(h('div.us-total', h('div', h('b', pm ? mb(pm.usedJSHeapSize) : '—'), h('span', 'de memória da página')), h('div.us-note', 'No navegador, o consumo completo fica no gerenciador de tarefas dele (Shift+Esc no Chrome/Edge).')));
    }
    if (USE.mem || USE.cpu) rows.push(peakBox());
    const hv = heavy();
    rows.push(h('div.us-heavy', h('div.rt', hv.length ? 'Ligado agora e pesa' : 'Nada pesado ligado agora'), hv.map(([a, b]) => h('div.us-h', icon('bolt', 14), h('div', h('b', a), h('span', b))))));
    box.replaceChildren(...rows);
  };
  usageOpen = true; draw(); t = setInterval(draw, 2000);
  queueMicrotask(() => whenGone(box, () => { clearInterval(t); usageOpen = false; }));
  return box;
}
