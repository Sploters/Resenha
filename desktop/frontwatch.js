// Jogo em tela cheia por cima da janela: a Resenha continua "visível" para o Windows (não está minimizada), mas ninguém
// a vê. O programa nativo (lc-audio --front, ver native/lc-audio) olha a janela da frente 1x/s e avisa quando ela é de
// outro programa e cobre o monitor inteiro onde a Resenha está; aqui isso vira `covered`, e o main.js soma ao "escondida"
// que a página recebe (win-state). A página já pausa o que não está à vista (vídeo das transmissões e câmeras, "falando",
// presença do servidor na tela) com a janela escondida.
// Sem o programa (fora do Windows, componente velho): nunca coberta, como antes.
const { spawn } = require('child_process');

const log = (...a) => console.log('[frontwatch]', ...a);

// opts: { exe, hwnd (string), onChange(covered, info), spawnFn?, ms?, retryMs? }
function createFrontWatch(opts) {
  const sp = opts.spawnFn || spawn, ms = opts.ms || 1000, retryMs = opts.retryMs || 5000;
  let proc = null, covered = false, info = null, stopped = false, fails = 0, retry = null, buf = '';
  const set = (c, i) => { if (c === covered) return; covered = c; info = c ? i : null; opts.onChange?.(covered, info); };
  const start = () => {
    if (stopped || proc || !opts.exe || !opts.hwnd) return;
    let p;
    try { p = sp(opts.exe, ['--front', String(opts.hwnd), String(ms)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); } catch (e) { log('não abriu', e.message); return; }
    proc = p; buf = '';
    const t0 = Date.now();
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let j = null; try { j = JSON.parse(line); } catch { continue; }
        if (j && typeof j.covered === 'boolean') set(j.covered, { pid: j.pid || 0, exe: j.exe || '' });
      }
    });
    p.on('error', () => { });
    p.on('exit', (code) => {
      if (proc !== p) return; proc = null; set(false, null);
      if (stopped) return;
      // caiu: tenta de novo (programa velho sem --front sai na hora com código 2: desiste depois de 3 vezes)
      if (Date.now() - t0 < 3000) fails++; else fails = 0;
      if (fails >= 3) { log('desisti: o programa sai logo ao abrir (código ' + code + ')'); return; }
      retry = setTimeout(() => { retry = null; start(); }, retryMs);
    });
  };
  return {
    start,
    get covered() { return covered; },
    get info() { return info; },
    // a Resenha ganhou o foco: está na frente agora (não espera a próxima leitura)
    focused() { set(false, null); },
    stop() {
      stopped = true; clearTimeout(retry); retry = null;
      const p = proc; proc = null; set(false, null);
      if (p) { try { p.stdin.end('stop\n'); } catch { } setTimeout(() => { try { p.kill(); } catch { } }, 1500).unref?.(); }
    },
  };
}

module.exports = { createFrontWatch };
