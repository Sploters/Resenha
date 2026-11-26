// Limitador do soundboard (por pessoa, vale em qualquer sala): rajada livre, castigo que cresce para quem insiste.
// - Até BURST sons em WINDOW_MS, sem intervalo nenhum entre eles (antes era 1 som a cada 1,2 s).
// - Passou disso: espera de PENALTIES[0] (10 s). Os sons na espera são ignorados (não aumentam a espera).
// - Estourou de novo até STRIKE_MEMORY_MS depois de liberado: a próxima espera é a seguinte da lista (20 s, 40 s, 60 s).
// - Ficou STRIKE_MEMORY_MS sem estourar: volta tudo ao começo.
export const BURST = 6, WINDOW_MS = 10e3, PENALTIES = [10e3, 20e3, 40e3, 60e3], STRIKE_MEMORY_MS = 120e3;

export function createSbLimiter({ now = () => Date.now() } = {}) {
  const users = new Map(); // uid -> { times: [], until, strikes, freedAt }
  // devolve { ok: true } ou { ok: false, until, secs, strikes, fresh } (fresh: castigo começou agora → avisar a pessoa)
  function hit(uid) {
    const t = now();
    let u = users.get(uid);
    if (!u) users.set(uid, u = { times: [], until: 0, strikes: 0, freedAt: 0 });
    if (t < u.until) return { ok: false, until: u.until, secs: Math.ceil((u.until - t) / 1000), strikes: u.strikes, fresh: false };
    if (u.strikes && u.until && t - u.until > STRIKE_MEMORY_MS) u.strikes = 0; // esfriou
    u.times = u.times.filter(x => t - x < WINDOW_MS);
    if (u.times.length >= BURST) {
      const ms = PENALTIES[Math.min(u.strikes, PENALTIES.length - 1)];
      u.strikes++; u.until = t + ms; u.times = [];
      return { ok: false, until: u.until, secs: Math.round(ms / 1000), strikes: u.strikes, fresh: true };
    }
    u.times.push(t);
    return { ok: true, left: BURST - u.times.length };
  }
  // limpeza de quem não usa há tempo (chamada de vez em quando)
  function prune() { const t = now(); for (const [k, u] of users) if (t - Math.max(u.until, u.times.at(-1) || 0) > STRIKE_MEMORY_MS + 60e3) users.delete(k); }
  return { hit, prune, users };
}
