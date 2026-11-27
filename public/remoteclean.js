// Validação de cada evento do controle remoto / jogar junto (formato, faixa, tamanho e permissão). A mesma regra roda no
// servidor (REMOTE_INPUT, server/remote.js) e no app de quem transmite, para os comandos que chegam direto pelo canal da
// mídia (DataChannel, public/remote.js), que não passam pela conferência do servidor.
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/; // KeyboardEvent.code (ex.: KeyA, Digit1, ArrowLeft, F5)

// valida e normaliza um evento; null = descartado
export function cleanEvent(e, perms) {
  if (!e || typeof e !== 'object') return null;
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  switch (e.k) {
    // mouse relativo (jogos 3D, mouse travado em quem joga): só se o app de quem transmite aceita (perms.rel, vem da sessão)
    case 'r': { if (!perms.mouse || !perms.rel) return null; const dx = num(e.dx, -2000, 2000), dy = num(e.dy, -2000, 2000); return dx === null || dy === null || (!Math.round(dx) && !Math.round(dy)) ? null : { k: 'r', dx: Math.round(dx), dy: Math.round(dy) }; }
    case 'm': { if (!perms.mouse) return null; const x = num(e.x, 0, 1), y = num(e.y, 0, 1); return x === null || y === null ? null : { k: 'm', x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5 }; }
    case 'd': case 'u': { if (!perms.mouse) return null; const b = num(e.b, 0, 2); return b === null || !Number.isInteger(b) ? null : { k: e.k, b }; }
    case 'w': { if (!perms.mouse) return null; const dx = num(e.dx ?? 0, -2400, 2400), dy = num(e.dy ?? 0, -2400, 2400); return dx === null || dy === null || (!dx && !dy) ? null : { k: 'w', dx: Math.round(dx), dy: Math.round(dy) }; }
    case 'kd': case 'ku': { if (!perms.keyboard) return null; return typeof e.c === 'string' && KEY_RE.test(e.c) ? { k: e.k, c: e.c } : null; }
    // controle de videogame: o estado inteiro (botões no "standard mapping" do navegador, 17 bits; 4 eixos -1..1; gatilhos 0..1)
    case 'g': {
      if (!perms.gamepad) return null;
      const b = num(e.b, 0, 0x1ffff), lt = num(e.lt ?? 0, 0, 1), rt = num(e.rt ?? 0, 0, 1);
      if (b === null || !Number.isInteger(b) || lt === null || rt === null || !Array.isArray(e.ax) || e.ax.length !== 4) return null;
      const ax = e.ax.map(v => num(v, -1, 1)); if (ax.includes(null)) return null;
      const r = (v) => Math.round(v * 1e3) / 1e3;
      return { k: 'g', b, ax: ax.map(r), lt: r(lt), rt: r(rt) };
    }
    default: return null;
  }
}
