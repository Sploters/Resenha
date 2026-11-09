// Modo leve: um botão que desliga o que pesa na CPU/GPU (bom para jogar com o app aberto) e lembra os valores anteriores para desfazer.
import { h, icon, whenGone } from './util.js';
import { S, savePrefs, applyTheme, toast, desktop } from './state.js';
import { toggle, row, section } from './ui.js';
import { refreshFreeze } from './freeze.js';
import { stopAllBuffers } from './clips.js';

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
if (desktop) ITEMS.push({ key: null, title: 'Economia em segundo plano', desc: 'Com o app minimizado e fora de chamada, o Windows pode desacelerar a Resenha.' });

export const liteOn = () => !!S.prefs.lightMode;
let skipGame = null, misses = 0, lastGame = null; // automático com o jogo aberto (gameChanged, abaixo)

// app desktop: deixa o Chromium desacelerar a página escondida, mas nunca durante uma chamada (timers da voz)
let throttled = null;
export function syncThrottle(inCall) {
  const on = liteOn() && !inCall;
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
  syncThrottle(!!voice?.active);
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
  lastGame = game?.id || null;
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
function usagePanel(ctx) {
  const box = h('div.card2.usage', h('div.hintline.keep', 'Medindo…'));
  let t = 0;
  const heavy = () => {
    const v = ctx?.voice, P = S.prefs, out = [];
    if (v?.active && HEAVY_NOISE.includes(P.noiseMode)) out.push(['Redução de ruído por IA', 'Processa sua voz o tempo todo. A "Padrão" do navegador é bem mais leve.']);
    if (S.watching?.size) out.push([`Assistindo ${S.watching.size} transmiss${S.watching.size === 1 ? 'ão' : 'ões'}`, 'Cada vídeo decodificado pesa na placa de vídeo. Feche as que não está vendo.']);
    if (S.watching?.size && P.clipsOn !== false) out.push(['Clipes em segundo plano', 'Guarda os últimos 60 s de cada transmissão assistida para o atalho de clipe.']);
    if (v?.screen) out.push(['Você está transmitindo', 'Capturar e comprimir a tela pesa. 720p • 30 fps alivia bastante.']);
    if (v?.cam) out.push(['Câmera ligada', 'Comprimir a câmera usa CPU.']);
    if (P.animations !== false) out.push(['Animações da interface', 'Pouco, mas somam com o jogo.']);
    if ((P.animMode || 'always') !== 'never') out.push(['GIFs animados', 'Avatares e banners animados são decodificados sem parar.']);
    return out;
  };
  const draw = async () => {
    const rows = [];
    if (desktop?.appMetrics) {
      let ms = await desktop.appMetrics().catch(() => []); if (!Array.isArray(ms)) ms = []; const g = new Map(); let cpu = 0, mem = 0;
      for (const m of ms) { const k = GROUP(m), x = g.get(k) || { cpu: 0, mem: 0 }; x.cpu += m.cpu; x.mem += m.mem; g.set(k, x); cpu += m.cpu; mem += m.mem; }
      const cores = navigator.hardwareConcurrency || 1, pc = (c) => (c / cores).toFixed(1).replace('.', ',') + '%'; // percentCPUUsage é por núcleo
      rows.push(h('div.us-total', h('div', h('b', pc(cpu)), h('span', 'do processador')), h('div', h('b', mb(mem)), h('span', 'de memória'))));
      const maxMem = Math.max(1, ...[...g.values()].map(x => x.mem));
      rows.push(h('div.us-rows', [...g].sort((a, b) => b[1].mem - a[1].mem).map(([k, x]) => h('div.us-row', h('span', k), h('div.us-bar', h('i', { style: { width: Math.max(2, x.mem / maxMem * 100) + '%' } })), h('b', mb(x.mem)), h('small', pc(x.cpu))))));
    } else {
      const pm = performance.memory;
      rows.push(h('div.us-total', h('div', h('b', pm ? mb(pm.usedJSHeapSize) : '—'), h('span', 'de memória da página')), h('div.us-note', 'No navegador, o consumo completo fica no gerenciador de tarefas dele (Shift+Esc no Chrome/Edge).')));
    }
    const hv = heavy();
    rows.push(h('div.us-heavy', h('div.rt', hv.length ? 'Ligado agora e pesa' : 'Nada pesado ligado agora'), hv.map(([a, b]) => h('div.us-h', icon('bolt', 14), h('div', h('b', a), h('span', b))))));
    box.replaceChildren(...rows);
  };
  draw(); t = setInterval(draw, 2000);
  queueMicrotask(() => whenGone(box, () => clearInterval(t)));
  return box;
}
