// Versões menores dos avatares padrão (public/avatars/*.png|webp, de 180 a 1024 px) em WebP: public/avatars/s<lado>/<n>.webp.
// O app (util.js imgUrl) usa a menor que cobre o tamanho em que a foto aparece (o dobro em telas de alta densidade).
// Rode de novo ao trocar/adicionar um avatar padrão: node scripts/avatar-sizes.mjs (precisa do ffmpeg)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const DIR = 'public/avatars', SIZES = [64, 128, 256];
const files = fs.readdirSync(DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
for (const sz of SIZES) {
  fs.mkdirSync(path.join(DIR, 's' + sz), { recursive: true });
  for (const f of files) {
    const out = path.join(DIR, 's' + sz, f.replace(/\.[^.]+$/, '.webp'));
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(DIR, f), '-frames:v', '1', '-vf', `scale='min(${sz},iw)':-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', out]);
  }
}
const kb = (d) => Math.round(fs.readdirSync(d).filter(f => !fs.statSync(path.join(d, f)).isDirectory()).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0) / 1024);
console.log(`originais: ${kb(DIR)} KB; ` + SIZES.map(s => `s${s}: ${kb(path.join(DIR, 's' + s))} KB`).join('; '));
