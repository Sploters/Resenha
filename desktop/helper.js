// Programa nativo que fica aberto (lc-audio --serve, ver native/lc-audio/src/serve.rs). Antes cada pergunta abria um
// processo novo: a lista de janelas a cada 20 s para o "Jogando…" e a cada 3 s com uma janela transmitida (~1.400
// processos por hora), mais o ícone do jogo e o vigia da janela da frente. Agora um processo só responde a pedidos
// (uma linha JSON por pedido/resposta) e avisa sozinho quando algo muda (eventos do Windows): lista de janelas, janela
// da frente cobrindo a Resenha. Também mostra o aviso do clipe (janela nativa, sem abrir processo do Chromium).
//
// Se o programa não abre, cai logo ao abrir ou é de uma versão sem --serve, quem usa volta ao jeito antigo (um processo
// por pergunta): call() rejeita e cada chamador tem a sua alternativa.
// Reabre sozinho se cair; depois de 3 quedas seguidas logo ao abrir, desiste por 10 minutos.
const { spawn } = require('child_process');

// opts: { exe, spawnFn?, log?, helloMs?, retryMs? }
function createHelper(opts) {
  const sp = opts.spawnFn || spawn, log = opts.log || (() => { }), helloMs = opts.helloMs || 3000, retryMs = opts.retryMs || 1000;
  let proc = null, ready = null, info = null, seq = 0, buf = '', fails = 0, deadUntil = 0, unsupported = false, stopped = false, retry = null;
  const pending = new Map(), listeners = new Map(), sticky = new Map();
  const stats = { spawns: 0, calls: 0, events: 0 };
  const emit = (ev, d) => { for (const f of listeners.get(ev) || []) { try { f(d); } catch (e) { log('ouvinte de ' + ev + ':', e.message); } } };

  function raw(p, op, args, ms) {
    return new Promise((res, rej) => {
      const id = ++seq;
      const t = setTimeout(() => { pending.delete(id); rej(new Error('o programa nativo não respondeu (' + op + ')')); }, ms);
      pending.set(id, { res, rej, t });
      try { p.stdin.write(JSON.stringify({ ...args, id, op }) + '\n'); } catch (e) { clearTimeout(t); pending.delete(id); rej(e); }
    });
  }
  function onLine(line) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j && j.id != null) {
      const w = pending.get(j.id); if (!w) return;
      pending.delete(j.id); clearTimeout(w.t);
      if (j.error != null) w.rej(new Error(String(j.error))); else w.res(j.r);
    } else if (j && j.ev) { stats.events++; emit(j.ev, j); }
  }

  function open() {
    if (ready) return ready;
    if (stopped || unsupported || !opts.exe || Date.now() < deadUntil) return Promise.resolve(null);
    let p;
    try { p = sp(opts.exe, ['--serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); } catch (e) { log('não abriu:', e.message); return Promise.resolve(null); }
    stats.spawns++;
    proc = p; buf = '';
    const t0 = Date.now();
    ready = new Promise((resolve) => {
      let settled = false; const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
      p.stdin.on('error', () => { });
      p.on('error', (e) => log('erro:', e.message));
      p.on('exit', (code) => {
        if (proc !== p) return;
        const wasUp = !!info;
        proc = null; ready = null; info = null;
        for (const [, w] of pending) { clearTimeout(w.t); w.rej(new Error('o programa nativo fechou')); }
        pending.clear(); done(null);
        if (wasUp) emit('down');
        if (stopped) return;
        // versão sem --serve: sai na hora com o "uso" (código 2) sem nunca responder
        if (!wasUp && code === 2) { unsupported = true; log('este programa não tem --serve: um processo por pergunta'); return; }
        if (Date.now() - t0 < 5000) fails++; else fails = 0;
        if (fails >= 3) { fails = 0; deadUntil = Date.now() + 10 * 60 * 1000; log('caiu 3 vezes logo ao abrir (código ' + code + '): um processo por pergunta nos próximos 10 min'); return; }
        log('fechou (código ' + code + ')' + (sticky.size ? ', reabrindo' : ''));
        // quem estava ouvindo (vigia da frente, lista de janelas) continua: reabre e repete os pedidos fixos
        if (sticky.size) retry = setTimeout(() => { retry = null; open(); }, retryMs * fails || retryMs);
      });
      raw(p, 'hello', {}, helloMs).then((r) => {
        if (proc !== p) return done(null);
        info = r || {}; log('aberto em ' + (Date.now() - t0) + ' ms', JSON.stringify(info));
        for (const [op, args] of sticky) raw(p, op, args, 4000).catch(() => { });
        emit('up', info); done(info);
      }).catch(() => { done(null); try { p.kill(); } catch { } });
    });
    return ready;
  }

  return {
    open,
    // pedido único: rejeita se o programa não estiver disponível (o chamador usa o jeito antigo)
    async call(op, args = {}, ms = 4000) {
      const r = await open();
      if (!r || !proc) throw new Error('programa nativo indisponível');
      stats.calls++;
      return raw(proc, op, args, ms);
    },
    // pedido que vale enquanto o programa estiver aberto (repetido quando ele reabre); null = indisponível
    async keep(op, args = {}) {
      sticky.set(op, args);
      const r = await open(); if (!r || !proc) return null;
      return raw(proc, op, args, 4000).catch(() => null);
    },
    drop(op) { sticky.delete(op); },
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev)?.delete(fn); },
    get info() { return info; },
    get up() { return !!info && !!proc; },
    stats: () => ({ ...stats, up: !!info }),
    stop() {
      stopped = true; clearTimeout(retry); sticky.clear();
      const p = proc; proc = null; ready = null; info = null;
      for (const [, w] of pending) { clearTimeout(w.t); w.rej(new Error('parado')); }
      pending.clear();
      if (p) { try { p.stdin.end(); } catch { } setTimeout(() => { try { p.kill(); } catch { } }, 1500).unref?.(); }
    },
  };
}

module.exports = { createHelper };
