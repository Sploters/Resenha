//! Transmissão nativa: captura a tela/janela sem o limite de 48 fps, comprime em H.264 na placa de vídeo e envia
//! por SRTP para o servidor da Resenha (PlainTransport do mediasoup).
//! Modos:
//!   --code "LC120 <host> <porta> <ssrc> <pt> [<chave> <chave do servidor>]" [--secs 60] [--fps 120] [--height 1080] [--kbps 16000]
//!       teste do pacote: imprime um resumo JSON no fim
//!   --stdin   usado pelo app desktop: lê a configuração (JSON, 1 linha) da entrada padrão; "stop" ou fim da entrada encerra.
//!             Escreve eventos JSON por linha na saída: started, stats (1/s), error, ended
//!   --probe   diz se há codificador H.264 de hardware (JSON)
//! Fora do Windows (testes): a "captura" é um ffmpeg (testsrc) gerando H.264.
mod rtp;
mod srtp;
pub mod replay;
pub mod select;
#[cfg(not(windows))]
mod sim;
#[cfg(windows)]
mod win;
#[cfg(windows)]
mod capture;
#[cfg(all(windows, feature = "poc"))]
mod poc;

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub fn arg(name: &str, default: &str) -> String {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1)).cloned().unwrap_or_else(|| default.to_string())
}
fn flag(name: &str) -> bool { std::env::args().any(|x| x == name) }

#[derive(Clone, Debug)]
pub enum Source { Primary, Monitor(i32, i32), Window(isize) }

/// Uma camada do simulcast: a cheia (ex.: 1080p120) e a leve (ex.: 540p60) para quem tem internet fraca.
#[derive(Clone, Debug)]
pub struct Layer { pub ssrc: u32, pub height: u32, pub fps: u32, pub kbps: u32 }

#[derive(Clone)]
/// cursor: desenhar o ponteiro do mouse na captura (opção "mostrar o cursor" da transmissão)
pub struct Opts { pub host: String, pub port: u16, pub pt: u8, pub key: Option<(String, String)>, pub secs: u64, pub layers: Vec<Layer>, pub source: Source, pub app: bool, pub cursor: bool, pub stop: Arc<AtomicBool>,
    /// método de captura pedido pelo app (auto | wgc | dxgi). None = caminho clássico (win::run, o da versão anterior)
    pub capture: Option<String>, pub os_build: u32,
    /// buffer dos clipes da própria transmissão (só no modo app; comandos clip/clipKeep pela entrada padrão)
    pub replay: Option<Arc<Mutex<replay::Replay>>> }
impl Opts { pub fn top(&self) -> &Layer { self.layers.last().unwrap() } }

pub fn emit(v: serde_json::Value) { let mut o = std::io::stdout().lock(); let _ = writeln!(o, "{v}"); let _ = o.flush(); }

/// Contadores por segundo; no modo app manda "stats" a cada segundo, no teste guarda a série e imprime um resumo.
pub struct Meter { start: Instant, sec: u64, cap: u32, sent: u32, bytes: u64, lsent: Vec<u32>, pub last_layers: Vec<u32>, pub hist_cap: Vec<u32>, pub hist_sent: Vec<u32>, pub hist_bytes: Vec<u64>, pub enc_ms: Vec<f64>, pub skipped_busy: u64, pub repeats: u64, secs: u64, app: bool, pub stop: Arc<AtomicBool>, pub size: (u32, u32),
    /// campos a mais no evento "stats" (captura com escolha de método); Null no caminho clássico
    pub extra: serde_json::Value }
impl Meter {
    pub fn new(o: &Opts) -> Self { replay::set_clock_origin(); Self { start: Instant::now(), sec: 0, cap: 0, sent: 0, bytes: 0, lsent: vec![0; o.layers.len()], last_layers: vec![0; o.layers.len()], hist_cap: vec![], hist_sent: vec![], hist_bytes: vec![], enc_ms: vec![], skipped_busy: 0, repeats: 0, secs: o.secs, app: o.app, stop: o.stop.clone(), size: (0, 0), extra: serde_json::Value::Null } }
    pub fn elapsed(&self) -> f64 { self.start.elapsed().as_secs_f64() }
    pub fn start(&self) -> Instant { self.start }
    pub fn captured(&mut self) { self.cap += 1; }
    /// quadro enviado na camada `layer` (a última é a cheia: é ela que conta como "fps enviados")
    pub fn sent(&mut self, layer: usize, bytes: usize) { if layer + 1 == self.lsent.len() { self.sent += 1; } if let Some(x) = self.lsent.get_mut(layer) { *x += 1; } self.bytes += bytes as u64; }
    pub fn tick(&mut self, s: &rtp::Stats) {
        let now = self.elapsed() as u64;
        while self.sec < now {
            self.sec += 1;
            let (c, t, b) = (self.cap, self.sent, self.bytes); self.cap = 0; self.sent = 0; self.bytes = 0;
            self.last_layers = std::mem::replace(&mut self.lsent, vec![0; self.last_layers.len()]);
            self.hist_cap.push(c); self.hist_sent.push(t); self.hist_bytes.push(b);
            if self.app {
                let em = if self.enc_ms.is_empty() { 0.0 } else { pct(&self.enc_ms[self.enc_ms.len().saturating_sub(c.max(1) as usize)..], 0.5) };
                let mut v = serde_json::json!({ "t": "stats", "fps": t, "cap": c, "kbps": b * 8 / 1000, "w": self.size.0, "h": self.size.1, "encMs": (em * 100.0).round() / 100.0, "busy": self.skipped_busy, "nacks": s.nacks, "keyReq": s.plis, "repeats": self.repeats, "layers": self.last_layers });
                if !self.extra.is_null() { merge(&mut v, self.extra.clone()); }
                emit(v);
                if self.enc_ms.len() > 4000 { self.enc_ms.drain(..2000); }
            } else {
                eprintln!("  {:>3}s  capturados {:>3}  enviados {:>3} fps  {:>5.1} Mbps  (quadros-chave {}, pedidos de reenvio {})", self.sec, c, t, b as f64 * 8.0 / 1e6, s.keyframes, s.nacks);
            }
        }
    }
    pub fn done(&self) -> bool { self.stop.load(Ordering::Relaxed) || (self.secs > 0 && self.elapsed() >= self.secs as f64 + 1.0) }
}
pub fn pct(v: &[f64], p: f64) -> f64 { if v.is_empty() { return 0.0; } let mut s = v.to_vec(); s.sort_by(|a, b| a.partial_cmp(b).unwrap()); s[((s.len() as f64 * p) as usize).min(s.len() - 1)] }

pub fn summary(m: &Meter, s: &rtp::Stats, extra: serde_json::Value) {
    if m.app { let mut v = serde_json::json!({ "t": "ended", "frames": s.frames, "keyframes": s.keyframes, "nacks": s.nacks }); merge(&mut v, extra); emit(v); return; }
    // ignora o 1º segundo (aquecimento)
    let win = |v: &Vec<u32>| -> Vec<f64> { v.iter().skip(1).map(|&x| x as f64).collect() };
    let (cap, sent) = (win(&m.hist_cap), win(&m.hist_sent));
    let mbps: Vec<f64> = m.hist_bytes.iter().skip(1).map(|&b| b as f64 * 8.0 / 1e6).collect();
    let mean = |v: &Vec<f64>| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let mut v = serde_json::json!({ "capturedFps": r1(mean(&cap)), "sentFps": r1(mean(&sent)), "sentMin": sent.iter().cloned().fold(f64::MAX, f64::min).min(9999.0), "sentP5": pct(&sent, 0.05), "sentMedian": pct(&sent, 0.5), "mbps": r1(mean(&mbps)),
        "encodeMsMedian": (pct(&m.enc_ms, 0.5) * 100.0).round() / 100.0, "encodeMsP95": (pct(&m.enc_ms, 0.95) * 100.0).round() / 100.0, "skippedEncoderBusy": m.skipped_busy, "keyframes": s.keyframes, "nacks": s.nacks, "resent": s.resent, "keyRequests": s.plis, "packets": s.packets, "rtcpBad": 0, "seriesSent": m.hist_sent.iter().skip(1).collect::<Vec<_>>() });
    merge(&mut v, extra);
    println!("{v}");
}
fn merge(v: &mut serde_json::Value, extra: serde_json::Value) { if let (Some(a), serde_json::Value::Object(b)) = (v.as_object_mut(), extra) { for (k, x) in b { a.insert(k, x); } } }

fn parse_code(code: &str) -> Option<(String, u16, u32, u8, Option<(String, String)>)> {
    let p: Vec<&str> = code.split_whitespace().collect();
    if !(p.len() == 5 || p.len() == 7) || p[0] != "LC120" { return None; }
    let key = if p.len() == 7 { Some((p[5].to_string(), p[6].to_string())) } else { None };
    Some((p[1].to_string(), p[2].parse().ok()?, p[3].parse().ok()?, p[4].parse().ok()?, key))
}

fn main() {
    if flag("--probe") { return probe(); }
    #[cfg(all(windows, feature = "poc"))]
    if flag("--poc-captura") { return poc::main_poc(); }
    // autoteste da transmissão: o .exe renomeado para Teste-Transmissao-Resenha.exe roda sozinho com dois cliques
    #[cfg(all(windows, feature = "poc"))]
    if flag("--autoteste") || std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).is_some_and(|n| n.contains("teste-transmiss")) { return poc::autoteste(); }
    let stop = Arc::new(AtomicBool::new(false));
    let o = if flag("--stdin") {
        let mut line = String::new();
        if std::io::stdin().read_line(&mut line).is_err() { std::process::exit(2); }
        let v: serde_json::Value = match serde_json::from_str(&line) { Ok(v) => v, Err(e) => { emit(serde_json::json!({ "t": "error", "error": format!("configuracao invalida: {e}") })); std::process::exit(2); } };
        let src = if let Some(w) = v["window"].as_i64() { Source::Window(w as isize) } else if let (Some(x), Some(y)) = (v["monitor"][0].as_i64(), v["monitor"][1].as_i64()) { Source::Monitor(x as i32, y as i32) } else { Source::Primary };
        let st = stop.clone();
        let rp = Arc::new(Mutex::new(replay::Replay::new(v["clipKeepMs"].as_u64().unwrap_or(0).min(10 * 60_000))));
        let rp2 = rp.clone();
        std::thread::spawn(move || { let mut l = String::new(); loop { l.clear(); match std::io::stdin().read_line(&mut l) { Ok(0) | Err(_) => break, Ok(_) if l.trim() == "stop" => break, Ok(_) => command(&rp2, l.trim()) } } st.store(true, Ordering::Relaxed); });
        let fps = v["fps"].as_u64().unwrap_or(120) as u32; let height = v["height"].as_u64().unwrap_or(1080) as u32; let kbps = v["kbps"].as_u64().unwrap_or(16000) as u32;
        let mut layers: Vec<Layer> = v["layers"].as_array().map(|a| a.iter().map(|l| Layer { ssrc: l["ssrc"].as_u64().unwrap_or(0) as u32, height: l["height"].as_u64().unwrap_or(540) as u32, fps: l["fps"].as_u64().unwrap_or(60) as u32, kbps: l["kbps"].as_u64().unwrap_or(2500) as u32 }).collect()).unwrap_or_default();
        if layers.is_empty() { layers.push(Layer { ssrc: v["ssrc"].as_u64().unwrap_or(0) as u32, height, fps, kbps }); }
        Opts { host: v["host"].as_str().unwrap_or("").into(), port: v["port"].as_u64().unwrap_or(0) as u16, pt: v["pt"].as_u64().unwrap_or(102) as u8,
            key: match (v["key"].as_str(), v["serverKey"].as_str()) { (Some(a), Some(b)) => Some((a.into(), b.into())), _ => None },
            secs: v["secs"].as_u64().unwrap_or(0), layers, source: src, app: true, cursor: v["cursor"].as_bool().unwrap_or(true), stop,
            capture: v["capture"].as_str().map(String::from), os_build: v["osBuild"].as_u64().unwrap_or(0) as u32, replay: Some(rp) }
    } else {
        let Some((host, port, ssrc, pt, key)) = parse_code(&arg("--code", "")) else {
            eprintln!("Codigo invalido. Gere o codigo na Resenha (Configuracoes > Transmissao > Teste 120 FPS) e cole aqui.");
            std::process::exit(2);
        };
        let top = Layer { ssrc, height: arg("--height", "1080").parse().unwrap_or(1080), fps: arg("--fps", "120").parse().unwrap_or(120), kbps: arg("--kbps", "16000").parse().unwrap_or(16000) };
        Opts { host, port, pt, key, secs: arg("--secs", "60").parse().unwrap_or(60), layers: vec![top], source: Source::Primary, app: false, cursor: true, stop,
            capture: if std::env::args().any(|a| a == "--metodo") { Some(arg("--metodo", "auto")) } else { None }, os_build: arg("--os-build", "0").parse().unwrap_or(0), replay: None }
    };
    if !o.app { let t = o.top(); eprintln!("  enviando para {}:{} (ssrc {}), {} fps, {} p, {} kbps, {} s{}", o.host, o.port, t.ssrc, t.fps, t.height, t.kbps, o.secs, if o.key.is_some() { ", criptografado (SRTP)" } else { "" }); }
    if let Err(e) = run(&o) {
        if o.app { emit(serde_json::json!({ "t": "error", "error": e })); } else { println!("{}", serde_json::json!({ "error": e })); eprintln!("  ERRO: {e}"); }
        std::process::exit(1);
    }
}

/// Comandos do app pela entrada padrão (uma linha JSON cada), fora da captura: o dump do clipe não segura nenhum quadro.
///   {"cmd":"clipKeep","ms":65000}                   liga / muda / desliga (0) o buffer dos clipes
///   {"cmd":"clip","id":1,"secs":30,"path":"..."}   grava os últimos `secs` s no arquivo -> {"t":"clip","id":1,"ok":true,...}
fn command(rp: &Arc<Mutex<replay::Replay>>, line: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return };
    match v["cmd"].as_str() {
        Some("clipKeep") => { if let Ok(mut r) = rp.lock() { r.set_keep(v["ms"].as_u64().unwrap_or(0).min(10 * 60_000)); } }
        Some("clip") => {
            let id = v["id"].clone(); let path = v["path"].as_str().unwrap_or("").to_string();
            let snap = rp.lock().ok().and_then(|r| r.snapshot(v["secs"].as_f64().unwrap_or(30.0).max(1.0)));
            let res = match snap {
                None => Err("ainda nao ha video gravado".to_string()),
                Some(_) if path.is_empty() => Err("sem caminho".to_string()),
                Some(s) => s.write_to(&path).map(|n| (n, s.frames.len(), s.duration_ms())),
            };
            emit(match res { Ok((n, k, ms)) => serde_json::json!({ "t": "clip", "id": id, "ok": true, "path": path, "bytes": n, "frames": k, "ms": ms.round() }),
                Err(e) => serde_json::json!({ "t": "clip", "id": id, "ok": false, "error": e }) });
        }
        _ => {}
    }
}

pub fn sender(o: &Opts) -> Result<rtp::Session, String> {
    let mut tx = rtp::Session::new(&o.host, o.port).map_err(|e| format!("UDP: {e}"))?;
    tx.replay = o.replay.clone();
    for l in &o.layers { tx.add_stream(l.ssrc, o.pt); }
    tx.set_pace_kbps(o.layers.iter().map(|l| l.kbps as u64).sum());
    if let Some((a, b)) = &o.key { tx.set_srtp(a, b)?; }
    Ok(tx)
}

#[cfg(windows)]
fn run(o: &Opts) -> Result<(), String> {
    // com "capture" (auto | wgc | dxgi): captura com escolha de método e troca sem derrubar (capture.rs).
    // Sem ele, ou com um valor desconhecido: o caminho clássico, idêntico ao da versão anterior.
    match o.capture.as_deref().and_then(select::Mode::parse) { Some(mode) => capture::run(o, mode, o.os_build), None => win::run(o) }
}
#[cfg(windows)]
fn probe() { emit(win::probe()); }

#[cfg(not(windows))]
fn probe() { emit(serde_json::json!({ "ok": std::process::Command::new("ffmpeg").arg("-version").output().is_ok(), "encoders": ["ffmpeg libx264 (teste)"], "test": true })); }

/// Fora do Windows: um ffmpeg por camada gera H.264 Annex-B com AUD (testsrc2) no lugar da captura + placa; enviado no ritmo de cada camada.
#[cfg(not(windows))]
fn run(o: &Opts) -> Result<(), String> {
    use std::io::Read;
    use std::sync::mpsc;
    let mut kids = Vec::new(); let mut rxs = Vec::new();
    for l in &o.layers {
        let h = l.height; let w = (h * 16 / 9) / 2 * 2;
        let mut ff = std::process::Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", &format!("testsrc2=size={w}x{h}:rate={}", l.fps), "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline",
            "-x264-params", &format!("aud=1:keyint={}", l.fps * 2), "-b:v", &format!("{}k", l.kbps), "-f", "h264", "-"]).stdout(std::process::Stdio::piped()).stdin(std::process::Stdio::null()).spawn().map_err(|e| format!("ffmpeg: {e}"))?;
        let mut out = ff.stdout.take().unwrap(); kids.push(ff);
        let (txc, rxc) = mpsc::sync_channel::<Vec<u8>>(4); rxs.push(rxc);
        std::thread::spawn(move || {
            let aud = |b: &[u8], from: usize| -> Option<usize> { (from..b.len().saturating_sub(4)).find(|&i| b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 0 && b[i + 3] == 1 && i + 4 < b.len() && b[i + 4] & 0x1F == 9) };
            let mut buf: Vec<u8> = Vec::new(); let mut chunk = vec![0u8; 1 << 16];
            loop {
                if let Some(s) = aud(&buf, 0) { if let Some(e) = aud(&buf, s + 5) { let f = buf[s..e].to_vec(); buf.drain(..e); if txc.send(f).is_err() { return; } continue; } }
                match out.read(&mut chunk) { Ok(0) | Err(_) => return, Ok(n) => buf.extend_from_slice(&chunk[..n]) }
            }
        });
    }
    let mut tx = sender(o)?;
    let top = o.top().clone(); let (w, h) = ((top.height * 16 / 9) / 2 * 2, top.height);
    let mut m = Meter::new(o); m.size = (w, h);
    // com "capture": o seletor de verdade sobre fontes simuladas (sim.rs, LC_SIM)
    let mut sim = match o.capture.as_deref().and_then(select::Mode::parse) { Some(mode) => Some(sim::Sim::new(mode, o.os_build, matches!(o.source, Source::Window(_)))?), None => None };
    let mut started = serde_json::json!({ "t": "started", "w": w, "h": h, "encoder": "ffmpeg libx264 (teste)", "source": format!("{:?}", o.source), "layers": o.layers.iter().map(|l| format!("{}p{}", l.height, l.fps)).collect::<Vec<_>>() });
    if let Some((_, cap)) = &sim { started["capture"] = cap.clone(); }
    let mut sim = sim.take().map(|x| x.0);
    let sim_out = |s: &mut sim::Sim| { for ev in s.events.drain(..) { if o.app { emit(ev); } else { eprintln!("  {ev}"); } } };
    if o.app { emit(started); }
    if let Some(s) = &mut sim { sim_out(s); }
    replay::set_clock_origin(); // os carimbos da simulação contam a partir daqui
    let t0 = Instant::now(); tx.clock0 = Some(t0); let mut next: Vec<f64> = vec![0.0; o.layers.len()]; let mut k: Vec<u64> = vec![0; o.layers.len()];
    while !m.done() {
        // próxima camada a vencer
        let (i, due) = next.iter().cloned().enumerate().fold((0, f64::MAX), |a, (i, d)| if d < a.1 { (i, d) } else { a });
        let at = t0 + std::time::Duration::from_secs_f64(due); let now = Instant::now(); if at > now { std::thread::sleep(at - now); }
        let Ok(frame) = rxs[i].recv() else { break };
        if i + 1 == o.layers.len() { m.captured(); }
        tx.poll_rtcp();
        let ts = (due * 90000.0) as u32; // mesmo relógio para todas as camadas
        let before = tx.streams[i].stats.bytes;
        tx.send_frame(i, &frame, ts);
        m.sent(i, (tx.streams[i].stats.bytes - before) as usize);
        if let Some(s) = &mut sim {
            let r = s.tick(m.elapsed()); sim_out(s);
            if let Err(x) = r { for mut f in kids { let _ = f.kill(); } return Err(x); }
            m.extra = s.extra(w, h);
        }
        m.tick(&tx.total());
        k[i] += 1; next[i] = k[i] as f64 / o.layers[i].fps as f64;
    }
    for mut f in kids { let _ = f.kill(); }
    let mut x = serde_json::json!({ "encoder": "ffmpeg libx264 (teste)", "rtcpBad": tx.rtcp_bad, "layers": o.layers.len() });
    if let Some(s) = &sim { x["capture"] = serde_json::json!({ "history": s.history() }); }
    summary(&m, &tx.total(), x);
    Ok(())
}
