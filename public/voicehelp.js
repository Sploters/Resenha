// "Verificar problemas de voz": o roteiro do guia de solução de problemas de voz e vídeo do Discord, só que feito
// sozinho. Em vez de mandar a pessoa conferir item por item, o app olha cada um e diz o que achou, com o conserto num
// clique quando dá:
//   1. Na Resenha: mutado/ensurdecido por você, pela moderação ou sem a permissão Falar/Vídeo da sala; modo de entrada
//      em push-to-talk sem querer; volume do microfone ou geral lá embaixo; pessoas com volume individual zerado ou
//      silenciadas por você.
//   2. Aparelhos: conexão segura (HTTPS), permissão do navegador/sistema para microfone e câmera, microfone e saída
//      escolhidos que não estão mais ligados, e um teste de 3 s do sinal CRU do microfone (sem filtros): zero absoluto =
//      mutado no próprio fone/sistema ou dispositivo errado.
//   3. Conexão (na chamada): estado da conexão de mídia, atraso, perda e picote medidos pelo WebRTC; economia de dados.
//   4. Dicas que o app não consegue medir (driver, outro app usando o microfone, aceleração de hardware, modo economia).
// No fim: "Redefinir voz e vídeo" (só essas configurações, não o tema nem os atalhos) e "Enviar relatório" (diag.js).
import { h, icon } from './util.js';
import { S, modal, toast, confirmBox, savePrefs, setDevice, desktop } from './state.js';
import { applyOutput } from './quick.js';
import { openReport } from './diag.js';

// configurações que "Redefinir voz e vídeo" devolve ao padrão (a mesma lista do botão do Discord: entrada, saída,
// volumes, modo de entrada, filtros, câmera). Dispositivos voltam ao "Padrão" do sistema.
export const VOICE_RESET = { inputId: '', outputId: '', videoId: '', inputLabel: undefined, outputLabel: undefined, videoLabel: undefined,
  volume: 100, inputVolume: 100, inputMode: 'vad', echo: true, agc: false, noiseMode: 'rnnoise', gate: false, gateDb: -45, vadGate: true, vadSens: 50, fanFilter: true, fanStrength: 50,
  voiceBitrate: 'auto', camRes: 720, camFps: 30, micTestLoop: undefined };

const STATE = { ok: ['check', 'OK'], info: ['info', 'Dica'], warn: ['warn', 'Atenção'], bad: ['warn', 'Problema'] };
const keyName = (k) => String(k || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Mouse(\d)$/, 'Botão $1 do mouse') || 'nenhuma';
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const browserName = () => { const u = navigator.userAgent; return desktop ? 'app' : /Firefox\//.test(u) ? 'Firefox' : /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'navegador'; };

// onde liberar o microfone/câmera, em palavras (o guia do Discord manda para a ajuda de cada navegador/sistema)
function permHelp(what) {
  const b = browserName();
  if (b === 'app') return navigator.platform.startsWith('Mac') ? `No Mac: Ajustes do Sistema → Privacidade e Segurança → ${what === 'mic' ? 'Microfone' : 'Câmera'} → ligue a Resenha.`
    : `No Windows: Configurações → Privacidade e segurança → ${what === 'mic' ? 'Microfone' : 'Câmera'} → ligue "Permitir que aplicativos da área de trabalho acessem".`;
  if (/iPhone|iPad/.test(navigator.userAgent)) return `No iPhone: Ajustes → Safari → ${what === 'mic' ? 'Microfone' : 'Câmera'} → Permitir (ou o "aA" na barra de endereço → Ajustes do site).`;
  if (/Android/.test(navigator.userAgent)) return `No Android: toque no cadeado ao lado do endereço → Permissões → ${what === 'mic' ? 'Microfone' : 'Câmera'} → Permitir. Confira também Configurações → Apps → ${b} → Permissões.`;
  if (b === 'Firefox') return 'No Firefox: clique no ícone de microfone/câmera riscado à esquerda do endereço e tire o bloqueio; depois recarregue a página.';
  if (b === 'Safari') return 'No Safari: Safari → Ajustes → Sites → ' + (what === 'mic' ? 'Microfone' : 'Câmera') + ' → escolha "Permitir" para este site.';
  return `No ${b}: clique no cadeado (ou no ícone de ajustes) à esquerda do endereço → ${what === 'mic' ? 'Microfone' : 'Câmera'} → Permitir; depois recarregue a página.`;
}

async function permState(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return null; } // Firefox/Safari antigos não sabem perguntar
}

// 3 s de microfone cru (sem eco/ruído/ganho): mede o pico. Um microfone de verdade sempre tem algum chiado.
async function probeMic() {
  let st, ctx;
  try {
    st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.prefs.inputId ? { ideal: S.prefs.inputId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    const an = ctx.createAnalyser(); an.fftSize = 2048; ctx.createMediaStreamSource(st).connect(an);
    const buf = new Float32Array(an.fftSize); let peak = 0;
    const end = performance.now() + 3000;
    while (performance.now() < end) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); await new Promise(r => setTimeout(r, 50)); }
    const track = st.getAudioTracks()[0];
    return { peak, label: track?.label || '', muted: !!track?.muted };
  } catch (e) { return { error: e }; } finally { st?.getTracks().forEach(t => t.stop()); ctx?.close().catch(() => { }); }
}

// som curto (dois bipes) pelo dispositivo de saída escolhido: "estou ouvindo algo?"
async function playTestTone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { if (S.prefs.outputId && ctx.setSinkId) await ctx.setSinkId(S.prefs.outputId); } catch { }
  await ctx.resume();
  const g = ctx.createGain(); g.gain.value = 0.15 * Math.max(0.2, (S.prefs.volume ?? 100) / 100); g.connect(ctx.destination);
  for (const [f, t] of [[660, 0], [880, 0.28]]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22); }
  setTimeout(() => ctx.close().catch(() => { }), 900);
}

const fmt = (n, d = 0) => n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d });
const avg = (arr, k) => { const v = arr.map(s => s[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// todas as verificações; cada uma vira { st, title, detail, fix? } e é desenhada assim que fica pronta
async function runChecks(voice, push, { nameOf }) {
  const P = S.prefs, inCall = !!voice?.active, me = S.voice.get(S.me?.id);
  const fix = (label, fn) => ({ label, fn });

  // ---------- 1. Na Resenha ----------
  push('Na Resenha');
  if (inCall && voice.deafened) push({ st: 'bad', title: 'Você está ensurdecido', detail: 'Com o fone riscado você não ouve ninguém e o seu microfone também fica desligado.', fix: fix('Ativar o áudio', () => voice.toggleDeaf()) });
  else if (inCall && voice.muted) push({ st: 'warn', title: 'Seu microfone está mutado', detail: 'O ícone do microfone está riscado: ninguém ouve você até desmutar.', fix: fix('Desmutar', () => voice.toggleMute()) });
  else push({ st: 'ok', title: 'Microfone e fone ligados', detail: inCall ? 'Você não está mutado nem ensurdecido.' : 'Fora de uma sala: entre numa sala de voz para conferir também a conexão.' });

  if (me?.mod_mute || me?.mod_deaf) push({ st: 'bad', title: me.mod_deaf ? 'Ensurdecido pela moderação' : 'Mutado pela moderação', detail: 'Alguém da moderação deste servidor ' + (me.mod_deaf ? 'ensurdeceu' : 'mutou') + ' você nas salas de voz. Isso vale em todas as salas do servidor até a moderação tirar: fale com um administrador ou com o dono.' });
  if (me?.no_speak) push({ st: 'bad', title: 'Sem permissão para falar nesta sala', detail: 'A permissão "Falar" está desligada para você nesta sala: você entra e ouve, mas ninguém escuta o seu microfone. Tente outra sala ou peça a um administrador.' });
  if (me?.no_video) push({ st: 'warn', title: 'Sem permissão de vídeo nesta sala', detail: 'A permissão "Vídeo" está desligada para você aqui: câmera e transmissão de tela ficam bloqueadas.' });

  if (P.inputMode === 'ptt') push({ st: 'warn', title: 'Modo push-to-talk ligado', detail: `Sua voz só sai enquanto você segura a tecla ${keyName(P.pttKey)}. Se não era a intenção, volte para "Atividade de voz".`, fix: fix('Usar Atividade de voz', () => { P.inputMode = 'vad'; savePrefs(); voice?.applyMute(); }) });
  else push({ st: 'ok', title: 'Modo de entrada: Atividade de voz', detail: 'Sua voz sai sozinha quando você fala.' });

  const inV = P.inputVolume ?? 100, outV = P.volume ?? 100;
  if (inV < 30) push({ st: inV === 0 ? 'bad' : 'warn', title: `Volume do microfone em ${inV}%`, detail: 'Os outros podem não ouvir você ou ouvir muito baixo.', fix: fix('Voltar para 100%', () => { P.inputVolume = 100; savePrefs(); if (voice?.micGraph) voice.micGraph.gain.gain.value = 1; }) });
  if (outV < 30) push({ st: outV === 0 ? 'bad' : 'warn', title: `Volume geral da voz em ${outV}%`, detail: 'Todo mundo na sala vai soar baixo (ou mudo) para você.', fix: fix('Voltar para 100%', () => { P.volume = 100; savePrefs(); voice?.peers.forEach((_, id) => voice.applyVolume(id)); }) });
  if (inV >= 30 && outV >= 30) push({ st: 'ok', title: 'Volumes do microfone e da voz', detail: `Microfone ${inV}% · voz dos outros ${outV}%.` });

  // pessoas silenciadas por você ou com volume individual quase zerado (clique direito na pessoa → volume)
  const roomIds = inCall ? [...voice.peers.keys()] : null;
  const low = Object.entries(P.userVolumes || {}).filter(([id, v]) => v <= 10 && (!roomIds || roomIds.includes(id))).map(([id]) => id);
  const muted = Object.keys(P.mutedUsers || {}).filter(id => !roomIds || roomIds.includes(id));
  const who = [...new Set([...muted, ...low])];
  if (who.length) push({ st: 'warn', title: inCall ? 'Não ouve alguém da sala?' : 'Pessoas com a voz desligada por você', detail: `${who.slice(0, 6).map(id => nameOf(id)).join(', ')}${who.length > 6 ? ` e mais ${who.length - 6}` : ''}: ${muted.length ? 'silenciada(s) por você' : ''}${muted.length && low.length ? ' ou ' : ''}${low.length ? 'com o volume individual quase zerado' : ''}. Só você deixa de ouvir; os outros ouvem normal.`,
    fix: fix('Voltar todos ao normal', () => { for (const id of who) { delete P.mutedUsers?.[id]; delete P.userVolumes?.[id]; } savePrefs(); who.forEach(id => voice?.applyVolume(id)); voice?.onUpdate?.(); }) });

  // ---------- 2. Aparelhos e permissões ----------
  push('Aparelhos e permissões');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { push({ st: 'bad', title: 'Conexão não segura (HTTP)', detail: 'Navegadores só liberam microfone, câmera e tela em HTTPS. Abra pelo endereço https://… ou use o aplicativo para computador.' }); return; }

  const [micP, camP] = await Promise.all([permState('microphone'), permState('camera')]);
  if (micP === 'denied') push({ st: 'bad', title: 'Microfone bloqueado', detail: 'O ' + (desktop ? 'sistema' : 'navegador') + ' não deixa a Resenha usar o microfone. ' + permHelp('mic') });
  else if (micP === 'prompt') push({ st: 'info', title: 'Permissão do microfone ainda não dada', detail: 'O navegador vai perguntar quando você entrar numa sala (ou agora).', fix: fix('Pedir permissão', async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); toast('Permissão do microfone concedida'); } catch (e) { toast('Microfone: ' + (e.name === 'NotAllowedError' ? 'permissão negada. ' + permHelp('mic') : e.message), true); } }) });
  else if (micP === 'granted') push({ st: 'ok', title: 'Permissão do microfone', detail: 'Liberada.' });
  if (camP === 'denied') push({ st: 'warn', title: 'Câmera bloqueada', detail: permHelp('cam') });

  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { }
  const ins = devs.filter(d => d.kind === 'audioinput'), outs = devs.filter(d => d.kind === 'audiooutput');
  if (!ins.length) push({ st: 'bad', title: 'Nenhum microfone encontrado', detail: 'O computador não mostra nenhuma entrada de áudio. Confira se o fone/microfone está bem encaixado (teste outra porta USB) e se aparece nas configurações de som do sistema.' });
  else if (P.inputId && micP !== 'prompt' && !ins.some(d => d.deviceId === P.inputId)) push({ st: 'warn', title: 'O microfone escolhido não está conectado', detail: `${P.inputLabel ? `"${P.inputLabel}"` : 'O dispositivo escolhido'} não aparece agora; a Resenha usa o padrão do sistema no lugar. Reconecte ou escolha o padrão.`, fix: fix('Usar o padrão', () => { setDevice('inputId', '', ''); if (voice?.active) voice.rebuildMic(); }) });
  if (P.outputId && outs.length && !outs.some(d => d.deviceId === P.outputId)) push({ st: 'warn', title: 'A saída de áudio escolhida não está conectada', detail: `${P.outputLabel ? `"${P.outputLabel}"` : 'O dispositivo escolhido'} não aparece agora. Se você não ouve ninguém, é provável que o som esteja indo para o lugar errado.`, fix: fix('Usar o padrão', () => { setDevice('outputId', '', ''); if (voice) applyOutput(voice); }) });
  push({ st: 'info', title: 'Ouve alguma coisa?', detail: `Toca dois bipes ${P.outputId ? `em "${P.outputLabel || 'saída escolhida'}"` : 'na saída padrão do sistema'}. Se não ouvir, a saída de áudio está errada ou o volume do sistema está no mudo.`, fix: { label: 'Tocar som de teste', keep: true, fn: () => playTestTone() } });

  if (ins.length && micP !== 'denied') {
    const row = push({ st: 'info', title: 'Testando o sinal do microfone…', detail: 'Fale algo por 3 segundos.' });
    const r = await probeMic();
    if (r.error) row({ st: 'bad', title: 'Não deu para abrir o microfone', detail: r.error.name === 'NotAllowedError' ? 'Permissão negada. ' + permHelp('mic') : r.error.name === 'NotReadableError' ? 'Outro programa está usando o microfone de forma exclusiva, ou o driver travou. Feche outros apps de chamada, desconecte e reconecte o fone, ou reinicie o computador.' : r.error.name === 'NotFoundError' ? 'O microfone não foi encontrado.' : r.error.message });
    else if (r.peak === 0 || r.muted) row({ st: 'bad', title: 'O microfone não manda som nenhum', detail: `${r.label ? `"${r.label}"` : 'O microfone'} está aberto, mas chega silêncio absoluto. Costuma ser: botão de mudo no próprio fone, microfone desativado nas configurações de som do sistema, ou o dispositivo errado escolhido. No Windows, desligue também os "aprimoramentos" do microfone (Painel de Som → Gravação → Propriedades).` });
    else { const db = 20 * Math.log10(r.peak); row(db < -50 ? { st: 'warn', title: 'Sinal do microfone muito baixo', detail: `Pico de ${fmt(db)} dB em ${r.label ? `"${r.label}"` : 'o microfone'}. Aproxime o microfone, aumente o volume de entrada no sistema ou confira se é o dispositivo certo.` } : { st: 'ok', title: 'O microfone está mandando som', detail: `Pico de ${fmt(db)} dB em ${r.label ? `"${r.label}"` : 'o microfone'}.` }); }
  }

  // ---------- 3. Conexão ----------
  push('Conexão');
  const nc = navigator.connection;
  if (nc?.saveData) push({ st: 'warn', title: 'Economia de dados ligada', detail: 'O aparelho pede para gastar menos internet; voz e vídeo podem ficar com qualidade menor.' });
  if (!navigator.onLine) push({ st: 'bad', title: 'Sem internet', detail: 'O aparelho está offline.' });
  if (!inCall) push({ st: 'info', title: 'Entre numa sala para medir a conexão', detail: 'Atraso, perda de pacotes e picote só são medidos durante a chamada.' });
  else {
    const state = voice.sfu ? (voice.sfu.recv?.connectionState || voice.sfu.send?.connectionState) : [...voice.peers.values()].map(p => p.pc?.connectionState).find(s => s && s !== 'connected') || 'connected';
    if (state && !['connected', 'new'].includes(state)) push({ st: 'bad', title: 'A conexão de voz caiu', detail: `Estado: ${state}. A Resenha tenta reconectar sozinha; se não voltar, saia e entre de novo na sala.`, fix: fix('Reiniciar áudio', () => voice.rebuildMic()) });
    const sm = (voice._cq?.samples || []).slice(-6), rtt = avg(sm, 'rtt'), lin = avg(sm, 'loss_in'), lout = avg(sm, 'loss_out'), conc = avg(sm, 'conceal');
    if (!sm.length) push({ st: 'info', title: 'Medindo a conexão…', detail: 'A primeira medida sai uns 5 segundos depois de entrar na sala. Verifique de novo daqui a pouco.' });
    else {
      const bad = (rtt ?? 0) > 300 || (lin ?? 0) > 5 || (lout ?? 0) > 5 || (conc ?? 0) > 8, warn = (rtt ?? 0) > 150 || (lin ?? 0) > 2 || (lout ?? 0) > 2 || (conc ?? 0) > 3;
      push({ st: bad ? 'bad' : warn ? 'warn' : 'ok', title: bad ? 'Conexão ruim' : warn ? 'Conexão instável' : 'Conexão boa',
        detail: `Atraso ${fmt(rtt)} ms · perda chegando ${fmt(lin, 1)}% · saindo ${fmt(lout, 1)}% · voz picotada ${fmt(conc, 1)}%.` + (bad || warn ? ' Feche downloads e apps pesados, prefira cabo ou fique perto do roteador' + (isMobile() ? ', ou troque entre Wi-Fi e dados móveis' : '') + '.' : '') });
    }
  }

  // ---------- 4. O que o app não consegue medir ----------
  push('Se ainda não resolveu');
  const tips = [];
  if (isMobile()) tips.push('Desligue o modo de economia de bateria: ele pode cortar o microfone com a tela apagada ou com o app em segundo plano.');
  if (isMobile()) tips.push('Teste trocar do Wi-Fi para os dados móveis (ou o contrário).');
  if (desktop) tips.push('Vídeo ou transmissão com cores erradas, tela preta ou travando: desligue a Aceleração de hardware em Configurações → Avançado e reinicie o app.');
  else tips.push('Recarregue a página (Ctrl+R) e, se não resolver, feche o navegador inteiro e abra de novo.');
  tips.push('Atualize o sistema e os drivers de áudio, da câmera e da placa de vídeo. Fones USB: teste outra porta.');
  tips.push('Feche outros programas de chamada (Teams, Zoom, Discord): alguns prendem o microfone só para eles.');
  tips.push('Supressão de ruído "Forte"/"Máxima" cortando a voz? Teste "Leve" ou "Sem filtro" em Voz e vídeo.');
  for (const t of tips) push({ st: 'info', title: t });
}

export function openVoiceHelp(voice, { nameOf = (id) => id, openVoiceSettings } = {}) {
  const list = h('div.vh-list');
  let gen = 0;
  const run = () => {
    const my = ++gen; list.replaceChildren();
    const push = (it) => {
      if (my !== gen) return () => { };
      if (typeof it === 'string') { list.append(h('h4.vh-sec', it)); return () => { }; }
      let el = null;
      const draw = (x) => {
        const [ic, word] = STATE[x.st];
        const btn = x.fix && h('button.btn.grey.sm', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await x.fix.fn(); if (!x.fix.keep) { toast('Pronto'); setTimeout(run, 300); } } catch (err) { toast(err.message, true); } finally { b.disabled = false; } } }, x.fix.label);
        const n = h('div.vh-item.' + x.st, h('span.vh-st', { title: word }, icon(ic, 16)), h('div.vh-txt', h('b', x.title), x.detail && h('span', x.detail)), btn);
        if (el) el.replaceWith(n); else list.append(n);
        el = n;
      };
      draw(it);
      return (x) => { if (my === gen) draw(x); };
    };
    runChecks(voice, push, { nameOf }).catch(e => push({ st: 'bad', title: 'A verificação parou no meio', detail: e.message }));
  };
  run();
  const m = modal('Verificar problemas de voz', 'O app confere sozinho o que costuma dar errado em voz e vídeo e mostra o conserto quando dá.', list, [
    { label: 'Verificar de novo', cls: 'grey', keep: true, fn: () => run() },
    { label: 'Redefinir voz e vídeo', cls: 'grey', keep: true, fn: () => resetVoiceSettings(voice).then(ok => ok && run()) },
    { label: 'Enviar relatório', cls: 'grey', fn: () => openReport('Problema de voz/vídeo: ') },
    openVoiceSettings && { label: 'Abrir Voz e vídeo', cls: 'grey', fn: () => openVoiceSettings() },
    { label: 'Fechar' },
  ].filter(Boolean), { width: '640px' });
  return m;
}

// "Reset Voice and Video Settings" do Discord: só voz e vídeo. Tema, atalhos, sons e volumes por pessoa ficam.
export async function resetVoiceSettings(voice) {
  if (!(await confirmBox('Redefinir voz e vídeo', 'Volta microfone, saída e câmera para o padrão do sistema, os volumes para 100%, o modo de entrada para Atividade de voz e os filtros (supressão de ruído, eco, ganho, porta) para o padrão. Tema, atalhos e volumes por pessoa não mudam.', 'Redefinir'))) return false;
  for (const [k, v] of Object.entries(VOICE_RESET)) { if (v === undefined) delete S.prefs[k]; else S.prefs[k] = v; }
  savePrefs();
  if (voice) { applyOutput(voice); voice.applyMute?.(); voice.peers?.forEach((_, id) => voice.applyVolume(id)); if (voice.active) await voice.rebuildMic?.().catch(() => { }); }
  toast('Configurações de voz e vídeo redefinidas');
  return true;
}
