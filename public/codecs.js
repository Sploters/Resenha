// Codecs de vídeo (Configurações > Transmissão): o que este aparelho toca, assiste e transmite em cada codec, e se é
// pela placa de vídeo ou pelo processador. Responde à pergunta "por que o vídeo X não abre / a transmissão pesa aqui?".
//
// Diferente do Discord (motor de mídia próprio, que usa os codecs do Windows e por isso pede as extensões da Microsoft
// Store), o Resenha usa os codecs que vêm dentro do Chromium/Electron e fala com a placa de vídeo direto. Do Windows,
// só depende da Media Foundation (mfplat.dll) para chegar ao codificador H.264 da placa (NVENC/AMF/QuickSync), tanto no
// Chromium quanto no programa nativo de 120 FPS. As edições "N"/"KN" vêm sem ela: o app desktop detecta (codecEnv).
import { h, icon } from './util.js';

const CODECS = [
  // [nome, arquivo (anexo), WebRTC (chamada) ou null quando o Resenha não usa nas chamadas]
  ['H.264 (AVC)', 'video/mp4; codecs="avc1.640028"', 'video/H264;profile-level-id=640032;packetization-mode=1'],
  ['H.265 (HEVC)', 'video/mp4; codecs="hvc1.1.6.L120.90"', null],
  ['VP8', 'video/webm; codecs="vp8"', 'video/VP8'],
  ['VP9', 'video/webm; codecs="vp09.00.40.08"', 'video/VP9'],
  ['AV1', 'video/mp4; codecs="av01.0.08M.08"', 'video/AV1'],
];
const SIZE = { width: 1920, height: 1080, bitrate: 6e6, framerate: 30 };

// null = não dá para saber (navegador sem mediaCapabilities); { ok, hw }
async function probe(kind, type, contentType) {
  const mc = navigator.mediaCapabilities; if (!mc || !contentType) return null;
  try {
    const r = await mc[kind === 'enc' ? 'encodingInfo' : 'decodingInfo']({ type, video: { contentType, ...SIZE } });
    return { ok: !!r.supported, hw: !!(r.supported && r.powerEfficient) };
  } catch { return kind === 'enc' && type === 'webrtc' ? null : { ok: false, hw: false }; }
}

export async function codecReport() {
  const rows = await Promise.all(CODECS.map(async ([name, file, rtc]) => ({
    name,
    file: await probe('dec', 'file', file),
    watch: rtc ? await probe('dec', 'webrtc', rtc) : undefined,
    send: rtc ? await probe('enc', 'webrtc', rtc) : undefined,
  })));
  const env = await window.lcDesktop?.codecEnv?.().catch(() => null) || null;
  return { rows, env };
}

const cell = (x) => x === undefined ? h('td.cx-na', { title: 'O Resenha não usa este codec nas chamadas' }, '—')
  : x === null ? h('td.cx-na', '?')
    : !x.ok ? h('td.cx-no', 'Não')
      : h('td' + (x.hw ? '.cx-hw' : '.cx-sw'), x.hw ? 'Placa de vídeo' : 'Processador');

export function codecPanel() {
  const box = h('div.codecs', h('p.cx-wait', 'Testando os codecs deste aparelho…'));
  codecReport().then(({ rows, env }) => {
    const h264 = rows[0], out = [];
    if (env && env.platform === 'win32' && env.mediaFoundation === false) {
      out.push(h('div.qinfo.warn.cx-warn', icon('warn', 16), h('div',
        h('b', 'Este Windows está sem os recursos de mídia (edição "N").'),
        ' Sem eles a transmissão não usa a placa de vídeo: sai em VP8 pelo processador (pesa mais em jogos), fica limitada a ~48 FPS e a de 120 FPS não funciona. ',
        'Para resolver: Configurações do Windows > Aplicativos > Recursos opcionais > Adicionar um recurso > "Pacote de Recursos de Mídia". Depois reinicie o PC.',
        window.lcDesktop?.openOptionalFeatures ? h('div', h('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => window.lcDesktop.openOptionalFeatures() }, 'Abrir Recursos opcionais')) : null)));
    }
    const sendTxt = h264.send?.hw ? 'H.264 pela placa de vídeo (leve para o processador).'
      : 'VP8 pelo processador: este aparelho não tem codificador H.264 na placa de vídeo' + (env?.mediaFoundation === false ? ' (faltam os recursos de mídia do Windows).' : ' (ou o driver não o oferece; atualizar o driver da placa costuma resolver).');
    out.push(h('div.cx-sum', h('b', 'Sua transmissão sai em: '), sendTxt, h('small', ' Chamadas protegidas sempre usam VP8.')));
    out.push(h('table.cx-tab',
      h('thead', h('tr', h('th', 'Codec'), h('th', 'Vídeos no chat'), h('th', 'Assistir transmissão'), h('th', 'Transmitir'))),
      h('tbody', rows.map(r => h('tr', h('th', r.name), cell(r.file), cell(r.watch), cell(r.send))))));
    const hevc = rows[1].file;
    if (hevc && !hevc.ok) out.push(h('div.hintline', 'Vídeos em H.265/HEVC (o padrão de muitos celulares, como o iPhone) não tocam aqui. Quem enviou pode gravar em "Mais compatível" ou mandar o vídeo convertido.'));
    out.push(h('div.hintline', 'O Resenha já vem com os codecs embutidos e usa a placa de vídeo direto, então as extensões de vídeo da Microsoft Store (AV1, codificador AVC) que o Discord pede não mudam nada aqui. O que faz diferença é o driver da placa de vídeo atualizado' + (env?.platform === 'win32' ? ' e, nas edições "N" do Windows, o Pacote de Recursos de Mídia.' : '.')));
    box.replaceChildren(...out);
  }, () => box.replaceChildren(h('p.cx-wait', 'Não consegui testar os codecs.')));
  return box;
}
