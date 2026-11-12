// Tempo de CPU por thread de todos os processos do Chromium (Linux, /proc em ticks de 1/100 s), para medir o custo de algo
// ligado x desligado. threads(rootPid) tira uma foto; diff(a, b) soma por "tipo de processo / nome da thread".
import fs from 'node:fs';
export const TICK = 100;
export function threads(root) {
  const all = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)), kids = new Set([root]); let grew = true;
  const ppid = new Map(); for (const p of all) { try { ppid.set(+p, +fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1]); } catch { } }
  while (grew) { grew = false; for (const [p, pp] of ppid) if (kids.has(pp) && !kids.has(p)) { kids.add(p); grew = true; } }
  const out = {};
  for (const pid of kids) {
    let type = 'browser'; try { const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); type = (cl.match(/--type=([\w-]+)/)?.[1] || 'browser') + (/--utility-sub-type=[\w.]*audio/i.test(cl) ? ':audio' : ''); } catch { }
    let tids = []; try { tids = fs.readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tids) { try { const s = fs.readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8'); const name = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')); const f = s.slice(s.lastIndexOf(')') + 2).split(' '); out[pid + ':' + tid] = { name, type, t: +f[11] + +f[12] }; } catch { } }
  }
  return out;
}
export function diff(a, b) { const d = {}; for (const [k, v] of Object.entries(b)) { const dt = v.t - (a[k]?.t || 0); if (dt > 0) { const key = v.type + ' / ' + v.name; d[key] = (d[key] || 0) + dt; } } return d; }
// % de um núcleo: total e das threads cujo "tipo / nome" casa com cada expressão
export function pct(d, secs, groups = {}) {
  const p = (x) => +(x / TICK / secs * 100).toFixed(2), out = { total: p(Object.values(d).reduce((s, x) => s + x, 0)) };
  for (const [k, re] of Object.entries(groups)) out[k] = p(Object.entries(d).filter(([n]) => re.test(n)).reduce((s, [, x]) => s + x, 0));
  out.top = Object.entries(d).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, x]) => [k, p(x)]);
  return out;
}
