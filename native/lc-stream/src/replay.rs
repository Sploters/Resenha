//! Buffer de replay (clipes da própria transmissão): guarda os últimos N segundos de quadros H.264 que o codificador da
//! placa JÁ produziu para a transmissão (camada cheia). Antes o Chromium capturava a tela de novo e o MediaRecorder
//! recomprimia tudo só para o clipe; agora o clipe sai destes quadros, sem captura nem compressão a mais.
//!
//! - Os quadros ficam em AVC (cada NAL com 4 bytes de tamanho na frente), sem SPS/PPS/AUD: esses vão no avcC do arquivo.
//! - O buffer sempre começa num quadro-chave (o codificador manda um a cada 2 s e quando o servidor pede).
//! - SPS novo (o codificador foi recriado: janela cresceu) apaga o que havia: um clipe tem um tamanho de imagem só.
//! - Tempo de cada quadro em ms do relógio do sistema (o mesmo `Date.now()` da página), para juntar com o áudio, que
//!   continua gravado pelo Chromium.
//!
//! Arquivo do dump (lido por public/clipbuf.js parseNativeClip), números em little-endian:
//!   "LCRB" | versão u8 (1) | largura u32 | altura u32 | tamanho do avcC u32 | avcC | quadros u32 |
//!   por quadro: hora f64 (ms) | chave u8 (1/0) | tamanho u32 | dados
use std::collections::VecDeque;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// teto de memória do buffer (bytes): a 4K a 64 Mb/s, 65 s seriam ~520 MB; passando disso guarda menos tempo
pub const MAX_BYTES: usize = 400 << 20;

/// hora (ms do relógio do sistema) do tempo 0 dos quadros (`Meter::new`): o carimbo RTP de 90 kHz conta a partir dali
static CLOCK0: AtomicU64 = AtomicU64::new(0);
pub fn set_clock_origin() { CLOCK0.store(now_ms().to_bits(), Ordering::Relaxed); }
pub fn now_ms() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0) }
fn clock0() -> f64 { f64::from_bits(CLOCK0.load(Ordering::Relaxed)) }

#[derive(Clone)]
pub struct Frame { pub at: f64, pub key: bool, pub data: Arc<Vec<u8>> }

pub struct Replay {
    keep_ms: u64,
    frames: VecDeque<Frame>,
    bytes: usize,
    sps: Option<Vec<u8>>, pps: Option<Vec<u8>>,
    /// carimbo RTP (90 kHz, u32) desembrulhado: dá a volta a cada ~13 h
    last_ts: Option<u32>, wraps: u64,
    max_bytes: usize,
}

impl Replay {
    pub fn new(keep_ms: u64) -> Self { Self { keep_ms, frames: VecDeque::new(), bytes: 0, sps: None, pps: None, last_ts: None, wraps: 0, max_bytes: MAX_BYTES } }
    pub fn keep_ms(&self) -> u64 { self.keep_ms }
    /// liga (ms > 0), muda a duração ou desliga (0: solta a memória na hora)
    pub fn set_keep(&mut self, ms: u64) { self.keep_ms = ms; if ms == 0 { self.frames.clear(); self.bytes = 0; } else { self.trim(); } }
    pub fn len(&self) -> usize { self.frames.len() }

    fn at_of(&mut self, ts: u32) -> f64 {
        if let Some(l) = self.last_ts { if ts < l && l - ts > 0x8000_0000 { self.wraps += 1; } }
        self.last_ts = Some(ts);
        clock0() + (self.wraps as f64 * 4_294_967_296.0 + ts as f64) / 90.0
    }

    /// Um quadro como o RTP envia: as NALs (sem start code), com SPS/PPS na frente nos quadros-chave. ts em 90 kHz.
    pub fn push(&mut self, nals: &[Vec<u8>], key: bool, ts: u32) {
        let at = self.at_of(ts);
        if self.keep_ms == 0 { return; }
        let mut data = Vec::with_capacity(nals.iter().map(|n| n.len() + 4).sum());
        for n in nals {
            if n.is_empty() { continue; }
            match n[0] & 0x1F {
                7 => { if self.sps.as_deref() != Some(n.as_slice()) { if self.sps.is_some() { self.frames.clear(); self.bytes = 0; } self.sps = Some(n.clone()); } }
                8 => { if self.pps.as_deref() != Some(n.as_slice()) { if self.pps.is_some() { self.frames.clear(); self.bytes = 0; } self.pps = Some(n.clone()); } }
                9 => {}
                _ => { data.extend_from_slice(&(n.len() as u32).to_be_bytes()); data.extend_from_slice(n); }
            }
        }
        if data.is_empty() { return; }
        // o buffer começa sempre num quadro-chave, com os parâmetros já conhecidos
        if self.frames.is_empty() && (!key || self.sps.is_none() || self.pps.is_none()) { return; }
        self.bytes += data.len();
        self.frames.push_back(Frame { at, key, data: Arc::new(data) });
        self.trim();
    }

    fn trim(&mut self) {
        let Some(last) = self.frames.back().map(|f| f.at) else { return };
        let cut = last - self.keep_ms as f64;
        let mut dropped = false;
        while let Some(f) = self.frames.front() {
            if f.at < cut || self.bytes > self.max_bytes || (dropped && !f.key) { self.bytes -= f.data.len(); self.frames.pop_front(); dropped = true; } else { break; }
        }
    }

    /// Os últimos `secs` segundos: do quadro-chave mais recente que ainda cobre o pedido até o fim (buffer menor que o
    /// pedido: tudo). Copia só as referências (Arc): o quadro seguinte da transmissão não espera a escrita do arquivo.
    pub fn snapshot(&self, secs: f64) -> Option<Snap> {
        let last = self.frames.back()?.at;
        let want = last - secs * 1000.0;
        let mut from = None;
        for (i, f) in self.frames.iter().enumerate() { if f.key && (from.is_none() || f.at <= want) { from = Some(i); } if f.at > want && from.is_some() { break; } }
        let from = from?;
        Some(Snap { sps: self.sps.clone()?, pps: self.pps.clone()?, frames: self.frames.iter().skip(from).cloned().collect() })
    }
}

pub struct Snap { pub sps: Vec<u8>, pub pps: Vec<u8>, pub frames: Vec<Frame> }

impl Snap {
    pub fn duration_ms(&self) -> f64 { match (self.frames.first(), self.frames.last()) { (Some(a), Some(b)) => b.at - a.at, _ => 0.0 } }
    /// grava no formato descrito no topo. Devolve o tamanho em bytes.
    pub fn write_to(&self, path: &str) -> Result<u64, String> {
        let info = parse_sps(&self.sps).ok_or("SPS ilegivel")?;
        let avcc = avcc(&self.sps, &self.pps, &info);
        let f = std::fs::File::create(path).map_err(|e| format!("arquivo do clipe: {e}"))?;
        let mut w = std::io::BufWriter::with_capacity(1 << 20, f);
        let mut n: u64 = 0;
        let mut put = |b: &[u8]| -> Result<(), String> { n += b.len() as u64; w.write_all(b).map_err(|e| format!("gravar o clipe: {e}")) };
        put(b"LCRB")?; put(&[1])?; put(&info.width.to_le_bytes())?; put(&info.height.to_le_bytes())?;
        put(&(avcc.len() as u32).to_le_bytes())?; put(&avcc)?; put(&(self.frames.len() as u32).to_le_bytes())?;
        for f in &self.frames { put(&f.at.to_le_bytes())?; put(&[f.key as u8])?; put(&(f.data.len() as u32).to_le_bytes())?; put(&f.data)?; }
        drop(put);
        w.flush().map_err(|e| format!("gravar o clipe: {e}"))?;
        Ok(n)
    }
}

// ---------- SPS: tamanho da imagem e o que o avcC precisa ----------
#[derive(Debug, PartialEq)]
pub struct SpsInfo { pub width: u32, pub height: u32, pub profile: u8, pub chroma: u32, pub depth_luma: u32, pub depth_chroma: u32 }

struct Bits<'a> { b: &'a [u8], p: usize }
impl Bits<'_> {
    fn bit(&mut self) -> Option<u32> { let v = (*self.b.get(self.p / 8)? >> (7 - self.p % 8)) & 1; self.p += 1; Some(v as u32) }
    fn bits(&mut self, n: u32) -> Option<u32> { let mut v = 0; for _ in 0..n { v = (v << 1) | self.bit()?; } Some(v) }
    fn ue(&mut self) -> Option<u32> { let mut z = 0; while self.bit()? == 0 { z += 1; if z > 31 { return None; } } Some(((1u64 << z) - 1 + self.bits(z)? as u64) as u32) }
    fn se(&mut self) -> Option<i32> { let k = self.ue()? as i64; Some(if k % 2 == 1 { ((k + 1) / 2) as i32 } else { -(k / 2) as i32 }) }
}

/// SPS (NAL inteira, com o byte de cabeçalho 0x67) -> largura/altura já descontado o recorte
pub fn parse_sps(nal: &[u8]) -> Option<SpsInfo> {
    // tira os bytes de prevenção (00 00 03 -> 00 00)
    let mut rbsp = Vec::with_capacity(nal.len()); let mut zeros = 0;
    for &x in nal.get(1..)? { if zeros >= 2 && x == 3 { zeros = 0; continue; } zeros = if x == 0 { zeros + 1 } else { 0 }; rbsp.push(x); }
    let mut r = Bits { b: &rbsp, p: 0 };
    let profile = r.bits(8)? as u8; r.bits(16)?; r.ue()?;
    let (mut chroma, mut dl, mut dc) = (1, 0, 0);
    if [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].contains(&profile) {
        chroma = r.ue()?; if chroma == 3 { r.bit()?; }
        dl = r.ue()?; dc = r.ue()?; r.bit()?;
        if r.bit()? == 1 { for i in 0..if chroma != 3 { 8 } else { 12 } { if r.bit()? == 1 { let n = if i < 6 { 16 } else { 64 }; let (mut last, mut next) = (8i32, 8i32); for _ in 0..n { if next != 0 { next = (last + r.se()? + 256) % 256; } if next != 0 { last = next; } } } } }
    }
    r.ue()?; // log2_max_frame_num
    match r.ue()? { 0 => { r.ue()?; } 1 => { r.bit()?; r.se()?; r.se()?; for _ in 0..r.ue()? { r.se()?; } } _ => {} }
    r.ue()?; r.bit()?;
    let wm = r.ue()? + 1; let hm = r.ue()? + 1; let fmo = r.bit()?;
    if fmo == 0 { r.bit()?; }
    r.bit()?;
    let (mut cl, mut cr, mut ct, mut cb) = (0, 0, 0, 0);
    if r.bit()? == 1 { cl = r.ue()?; cr = r.ue()?; ct = r.ue()?; cb = r.ue()?; }
    let (sw, sh) = match chroma { 0 => (1, 1), 1 => (2, 2), 2 => (2, 1), _ => (1, 1) };
    let (ux, uy) = if chroma == 0 { (1, 2 - fmo) } else { (sw, sh * (2 - fmo)) };
    let width = (wm * 16).checked_sub((cl + cr) * ux)?; let height = ((2 - fmo) * hm * 16).checked_sub((ct + cb) * uy)?;
    Some(SpsInfo { width, height, profile, chroma, depth_luma: dl, depth_chroma: dc })
}

/// AVCDecoderConfigurationRecord (ISO 14496-15): o CodecPrivate do Matroska e a "description" do VideoDecoder
pub fn avcc(sps: &[u8], pps: &[u8], info: &SpsInfo) -> Vec<u8> {
    let mut v = vec![1, sps[1], sps[2], sps[3], 0xFF, 0xE1];
    v.extend_from_slice(&(sps.len() as u16).to_be_bytes()); v.extend_from_slice(sps);
    v.push(1); v.extend_from_slice(&(pps.len() as u16).to_be_bytes()); v.extend_from_slice(pps);
    if [100, 110, 122, 144].contains(&info.profile) { v.extend_from_slice(&[0xFC | info.chroma as u8 & 3, 0xF8 | info.depth_luma as u8 & 7, 0xF8 | info.depth_chroma as u8 & 7, 0]); }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    // SPS reais do libx264 (ffmpeg testsrc2): 1280x720 baseline, 1920x1080 high (1088 com recorte), 2560x1440 main
    const SPS_720: [u8; 25] = [0x67, 0x42, 0xC0, 0x1F, 0xD9, 0x00, 0x50, 0x05, 0xBB, 0x01, 0x10, 0x00, 0x00, 0x03, 0x00, 0x10, 0x00, 0x00, 0x03, 0x03, 0xC0, 0xF1, 0x83, 0x24, 0x80];
    fn sps1080() -> Vec<u8> { vec![0x67, 0x64, 0x00, 0x28, 0xAC, 0xD9, 0x40, 0x78, 0x02, 0x27, 0xE5, 0xC0, 0x44, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xF0, 0x3C, 0x60, 0xC6, 0x58] }
    const SPS_1440: [u8; 24] = [0x67, 0x4D, 0x40, 0x32, 0xEC, 0xA0, 0x14, 0x00, 0x5A, 0xD8, 0x08, 0x80, 0x00, 0x00, 0x03, 0x00, 0x80, 0x00, 0x00, 0x1E, 0x07, 0x8C, 0x18, 0xCB];
    #[test]
    fn sps_sizes() {
        let a = parse_sps(&SPS_720).unwrap(); assert_eq!((a.width, a.height), (1280, 720));
        let b = parse_sps(&sps1080()).unwrap(); assert_eq!((b.width, b.height, b.profile, b.chroma), (1920, 1080, 100, 1));
        let d = parse_sps(&SPS_1440).unwrap(); assert_eq!((d.width, d.height, d.profile), (2560, 1440, 77));
        let c = avcc(&sps1080(), &[0x68, 0xEB, 0xE3, 0xCB, 0x22, 0xC0], &b);
        assert_eq!(&c[..6], &[1, 0x64, 0x00, 0x28, 0xFF, 0xE1]); assert_eq!(&c[c.len() - 4..], &[0xFD, 0xF8, 0xF8, 0]);
    }
    fn frame(key: bool, n: u8) -> Vec<Vec<u8>> { let mut v = vec![]; if key { v.push(SPS_720.to_vec()); v.push(vec![0x68, 0xCE, 0x38, 0x80]); } v.push(vec![if key { 0x65 } else { 0x41 }, n, n, n]); v }
    #[test]
    fn ring() {
        let mut r = Replay::new(0);
        r.push(&frame(true, 0), true, 0); assert_eq!(r.len(), 0, "desligado não guarda nada");
        r.set_keep(5000);
        r.push(&frame(false, 1), false, 90); assert_eq!(r.len(), 0, "começa só num quadro-chave");
        // 10 s a 10 fps, quadro-chave a cada 2 s
        for i in 0..100u32 { r.push(&frame(i % 20 == 0, i as u8), i % 20 == 0, 9000 * (i + 1)); }
        let first = r.frames.front().unwrap();
        assert!(first.key, "o buffer começa num quadro-chave");
        let span = r.frames.back().unwrap().at - first.at; assert!(span <= 5000.0 && span >= 3000.0, "guarda ~5 s: {span}");
        assert_eq!(&first.data[..4], &[0, 0, 0, 4], "AVC: tamanho na frente, sem SPS/PPS");
        let s = r.snapshot(1.0).unwrap();
        assert!(s.frames[0].key && s.duration_ms() >= 1000.0 && s.duration_ms() < 3000.0, "1 s pedido: do quadro-chave anterior ({})", s.duration_ms());
        let all = r.snapshot(60.0).unwrap(); assert_eq!(all.frames.len(), r.len(), "pedido maior que o buffer: tudo");
        // SPS novo (codificador recriado): recomeça
        let mut sps2 = SPS_720.to_vec(); sps2[3] = 0x20;
        r.push(&vec![sps2, vec![0x68, 0xCE, 0x38, 0x80], vec![0x65, 1]], true, 9000 * 200); assert_eq!(r.len(), 1);
        r.set_keep(0); assert_eq!(r.len(), 0);
    }
    #[test]
    fn wrap() {
        let mut r = Replay::new(60000);
        let a = r.at_of(u32::MAX - 899); let b = r.at_of(100);
        assert!((b - a - 1000.0 / 90.0).abs() < 0.001, "volta do relógio de 90 kHz: {}", b - a);
    }
    #[test]
    fn dump() {
        let mut r = Replay::new(60000);
        for i in 0..30u32 { r.push(&frame(i % 10 == 0, i as u8), i % 10 == 0, 3000 * i); }
        let p = std::env::temp_dir().join(format!("lcrb-{}.bin", std::process::id()));
        let s = r.snapshot(60.0).unwrap(); let n = s.write_to(p.to_str().unwrap()).unwrap();
        let b = std::fs::read(&p).unwrap(); let _ = std::fs::remove_file(&p);
        assert_eq!(b.len() as u64, n); assert_eq!(&b[..5], b"LCRB\x01");
        assert_eq!(u32::from_le_bytes(b[5..9].try_into().unwrap()), 1280); assert_eq!(u32::from_le_bytes(b[9..13].try_into().unwrap()), 720);
        let al = u32::from_le_bytes(b[13..17].try_into().unwrap()) as usize; assert_eq!(b[17], 1);
        assert_eq!(u32::from_le_bytes(b[17 + al..21 + al].try_into().unwrap()), 30);
    }
}
