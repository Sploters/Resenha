// Largura e altura de uma imagem lendo só o começo do arquivo (PNG, GIF, WebP, JPEG), sem decodificar. Vai junto do
// anexo na mensagem para o chat reservar o espaço da foto antes dela chegar: sem isso cada imagem que carregava empurrava
// o resto do chat (layout de novo e a rolagem pulando ao ler o histórico).
import fs from 'node:fs';

export function imageSize(file) {
  let fd; const buf = Buffer.alloc(64 * 1024);
  try { fd = fs.openSync(file, 'r'); const n = fs.readSync(fd, buf, 0, buf.length, 0); return parse(buf.subarray(0, n)); }
  catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { } }
}

const ok = (w, h) => (w > 0 && h > 0 && w <= 65535 && h <= 65535 ? { width: w, height: h } : null);
export function parse(b) {
  if (b.length < 30) return null;
  if (b.readUInt32BE(0) === 0x89504e47) return ok(b.readUInt32BE(16), b.readUInt32BE(20)); // PNG: IHDR
  if (b.toString('ascii', 0, 3) === 'GIF') return ok(b.readUInt16LE(6), b.readUInt16LE(8));
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8X') return ok(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return ok(1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)); }
    if (t === 'VP8 ') return ok(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: procura o SOF (a orientação do EXIF é ignorada: a foto pode vir deitada)
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
