// Redutor de quadros do clipe: recebe os quadros de uma trilha (MediaStreamTrackProcessor) e repassa no máximo `fps` por
// segundo para o gerador que o MediaRecorder grava. Existe porque a trilha que chega por WebRTC (a transmissão de outra
// pessoa) recusa applyConstraints({ frameRate }) — sem isto o clipe gravava a 120 fps mesmo pedindo 30.
// Roda num worker: com a página ocupada (chat, palco), a contagem não atrasa nem perde quadros.
onmessage = async ({ data: { readable, writable, fps } }) => {
  const step = 1e6 / fps, rd = readable.getReader(), wr = writable.getWriter();
  let next = -Infinity;
  for (;;) {
    let r; try { r = await rd.read(); } catch { break; }
    if (r.done) break;
    const f = r.value, ts = f.timestamp;
    // aceita o quadro que chega até 1/4 de intervalo antes da hora (a fonte oscila) e mantém a média exata:
    // 120 → 60 pega um sim, um não; 144 → 60 alterna 2 e 3 quadros sem acumular atraso
    if (ts >= next - step / 4) {
      next = ts - next > step * 2 ? ts + step : next + step; // atrasou demais (pausa, quadro perdido): recomeça daqui
      try { await wr.write(f); } catch { f.close(); break; }
    } else f.close();
  }
  try { await wr.close(); } catch { }
};
