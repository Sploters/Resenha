//! Captura com escolha de método (WGC ou DXGI Desktop Duplication) e troca sem derrubar a transmissão.
//! Usado quando o app manda "capture" (auto | wgc | dxgi) na configuração. Sem esse campo o lc-stream usa o caminho
//! clássico (win::run), intocado, que é o mesmo da versão anterior.
//!
//! Pipeline: fonte (WGC ou DXGI, as duas no MESMO ID3D11Device do codificador) -> ID3D11VideoProcessor (recorte, escala,
//! NV12) -> codificador H.264 de hardware (Media Foundation) -> RTP/SRTP. Trocar de fonte não recria codificador, RTP nem a
//! sessão no SFU: só muda o retângulo de origem e pede um quadro-chave (medido na PoC: IDR em 1-2 quadros).
//!
//! Decisões: select.rs (ordem por Windows, validação cruzada, limites). Aqui: abrir/fechar fontes, medir saúde (quadros
//! novos, sonda assíncrona de tela preta e de imagem parada), recriar a duplicação do DXGI e reconstruir tudo se a placa
//! de vídeo for perdida (TDR/driver), mantendo o RTP.
//! Nada é injetado no jogo: WGC e DXGI são APIs do Windows para capturar a tela.
use crate::select::{Action, Health, Method, Mode, Selector};
use crate::win::{e, make_layer, tune, WinLayer, R, NV12_RING};
use crate::{emit, sender, summary, Meter, Opts, Source};
use serde_json::{json, Value};
use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use windows::core::{factory, w, Interface, PCWSTR};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND, POINT, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Shell::SHQueryUserNotificationState;
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, IsIconic, IsWindow, GA_ROOT};

// ------------------------------------------------------------------------------------------------------------ limites
/// DXGI: tempo máximo tentando recriar a duplicação (Ctrl+Alt+Del, UAC, troca de resolução) antes de desistir do método
const DXGI_LOST_GIVEUP: f64 = 8.0;
/// DXGI: recriações em 60 s acima disso = algo errado (o método é dado como falho)
const DXGI_MAX_RECREATES_MIN: usize = 30;
/// placa de vídeo perdida (TDR, driver reiniciado): reconstruções em 120 s
const DEVICE_REBUILDS: usize = 3;
const DEVICE_WINDOW: f64 = 120.0;
/// sonda de tela preta/imagem parada: uma leitura a cada 250 ms, lida 2+ quadros depois (sem travar a GPU)
const PROBE_EVERY: f64 = 0.25;
const PW: u32 = 64;
const PH: u32 = 36;
/// observação de saúde para o seletor
const HEALTH_EVERY: f64 = 0.5;

// ------------------------------------------------------------------------------------------------------------ GPU
pub struct Gpu { pub device: ID3D11Device, pub ctx: ID3D11DeviceContext, pub vdev: ID3D11VideoDevice, pub vctx: ID3D11VideoContext, pub d3d: IDirect3DDevice, pub luid: u64, pub name: String, pub adapter: IDXGIAdapter, pub prio: Value }
/// igual ao win::run: o device do codificador (BGRA + VIDEO_SUPPORT, multithread), na placa padrão
fn gpu() -> R<Gpu> {
    let mut device: Option<ID3D11Device> = None; let mut ctx: Option<ID3D11DeviceContext> = None;
    unsafe { e(D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut ctx)), "D3D11CreateDevice")?; }
    let (device, ctx) = (device.ok_or("sem D3D11")?, ctx.ok_or("sem contexto")?);
    if let Ok(mt) = device.cast::<ID3D11Multithread>() { unsafe { let _ = mt.SetMultithreadProtected(true); } }
    let dxgi: IDXGIDevice = e(device.cast(), "IDXGIDevice")?;
    let adapter = e(unsafe { dxgi.GetAdapter() }, "GetAdapter")?;
    let d = e(unsafe { adapter.GetDesc() }, "GetDesc")?;
    let luid = (((d.AdapterLuid.HighPart as u32) as u64) << 32) | d.AdapterLuid.LowPart as u64;
    let name = String::from_utf16_lossy(&d.Description).trim_end_matches('\0').to_string();
    let d3d: IDirect3DDevice = e(unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.and_then(|x| x.cast()), "IDirect3DDevice")?;
    let prio = tune(&dxgi);
    Ok(Gpu { vdev: e(device.cast(), "ID3D11VideoDevice")?, vctx: e(ctx.cast(), "ID3D11VideoContext")?, device, ctx, d3d, luid, name, adapter, prio })
}
impl Gpu {
    /// a placa foi perdida? (TDR, driver atualizado/reiniciado, placa removida)
    fn lost(&self) -> Option<String> {
        let r = unsafe { self.device.GetDeviceRemovedReason() };
        r.err().map(|x| format!("placa de video perdida: {} (0x{:08X})", x.message(), x.code().0 as u32))
    }
}

pub fn os_build() -> u32 {
    let mut buf = [0u16; 64]; let mut n = (buf.len() * 2) as u32;
    let k = w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    if unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, k, w!("CurrentBuild"), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as _), Some(&mut n)) }.is_ok() {
        String::from_utf16_lossy(&buf[..(n as usize / 2).saturating_sub(1)]).trim().parse().unwrap_or(0)
    } else { 0 }
}

// ------------------------------------------------------------------------------------------------------------ alvo
#[derive(Clone, Copy)]
enum Target { Monitor(HMONITOR), Window(HWND) }
fn target_of(s: &Source) -> Target {
    match *s {
        Source::Window(h) => Target::Window(HWND(h as *mut core::ffi::c_void)),
        Source::Monitor(x, y) => Target::Monitor(unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTOPRIMARY) }),
        Source::Primary => Target::Monitor(unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) }),
    }
}
fn window_rect(h: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    unsafe { DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as _, std::mem::size_of::<RECT>() as u32) }.ok()?;
    Some(r)
}
const CLOSED: &str = "a janela transmitida foi fechada";

// ------------------------------------------------------------------------------------------------------------ fontes
pub struct Frame { tex: ID3D11Texture2D, src: RECT }
trait Src {
    fn method(&self) -> Method;
    /// quadro novo (None = nada novo). Err = o método falhou e não se recuperou sozinho.
    fn next(&mut self, g: &Gpu, now: f64) -> Result<Option<Frame>, String>;
    /// o quadro já foi entregue à GPU: pode soltar
    fn release(&mut self) {}
    /// quadros novos desde a última consulta
    fn take_frames(&mut self) -> u32;
    /// tamanho atual da imagem (do recorte, no caso de janela por DXGI)
    fn size(&self) -> (u32, u32);
    fn info(&self) -> Value;
    /// o recorte mostra o que estiver por cima da janela (DXGI capturando janela)
    fn overlap(&self) -> bool { false }
}

struct Wgc { item: GraphicsCaptureItem, pool: Direct3D11CaptureFramePool, session: GraphicsCaptureSession, size: SizeInt32, last: Option<Direct3D11CaptureFrame>, closed: Arc<AtomicBool>, frames: u32, recreates: u32, border: String, interval: String, window: bool }
impl Wgc {
    fn open(g: &Gpu, t: Target, cursor: bool, signal: &Arc<(Mutex<bool>, Condvar)>) -> R<Self> {
        if !GraphicsCaptureSession::IsSupported().unwrap_or(false) { return Err("indisponivel: este Windows nao tem o Windows Graphics Capture".into()); }
        let interop = e(factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>(), "interop")?;
        let item: GraphicsCaptureItem = match t {
            Target::Window(h) => { if !unsafe { IsWindow(Some(h)) }.as_bool() { return Err(CLOSED.into()); } e(unsafe { interop.CreateForWindow(h) }, "CreateForWindow (a janela nao pode ser capturada pelo WGC)")? }
            Target::Monitor(m) => e(unsafe { interop.CreateForMonitor(m) }, "CreateForMonitor")?,
        };
        let closed = Arc::new(AtomicBool::new(false));
        { let c = closed.clone(); let _ = item.Closed(&TypedEventHandler::new(move |_, _| { c.store(true, Ordering::Relaxed); Ok(()) })); }
        let size = e(item.Size(), "Size")?;
        let pool = e(Direct3D11CaptureFramePool::CreateFreeThreaded(&g.d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size), "FramePool")?;
        let session = e(pool.CreateCaptureSession(&item), "CaptureSession")?;
        let _ = session.SetIsCursorCaptureEnabled(cursor);
        let border = match session.SetIsBorderRequired(false) { Ok(_) => "sem borda".to_string(), Err(_) => "borda amarela obrigatoria (Windows 10)".to_string() };
        let interval = match session.SetMinUpdateInterval(TimeSpan { Duration: 0 }) { Ok(_) => "0 ms".to_string(), Err(_) => "padrao do Windows (sem ajuste)".to_string() };
        let s2 = signal.clone();
        e(pool.FrameArrived(&TypedEventHandler::new(move |_, _| { let (m, c) = &*s2; *m.lock().unwrap() = true; c.notify_one(); Ok(()) })), "FrameArrived")?;
        e(session.StartCapture(), "StartCapture")?;
        Ok(Self { item, pool, session, size, last: None, closed, frames: 0, recreates: 0, border, interval, window: matches!(t, Target::Window(_)) })
    }
}
impl Drop for Wgc { fn drop(&mut self) { self.last = None; let _ = self.session.Close(); let _ = self.pool.Close(); } }
impl Src for Wgc {
    fn method(&self) -> Method { Method::Wgc }
    fn next(&mut self, g: &Gpu, _now: f64) -> Result<Option<Frame>, String> {
        if self.closed.load(Ordering::Relaxed) { return Err(if self.window { CLOSED.into() } else { "o WGC encerrou a captura do monitor".into() }); }
        self.last = None;
        let mut latest = None;
        while let Ok(f) = self.pool.TryGetNextFrame() { self.frames += 1; latest = Some(f); }
        let Some(f) = latest else { return Ok(None) };
        if let Ok(cs) = f.ContentSize() {
            if (cs.Width != self.size.Width || cs.Height != self.size.Height) && cs.Width > 0 && cs.Height > 0 {
                self.size = cs; self.recreates += 1;
                drop(f);
                e(self.pool.Recreate(&g.d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, cs), "Recreate do pool WGC")?;
                return Ok(None);
            }
        }
        let tex = e(f.Surface().and_then(|s| s.cast::<IDirect3DDxgiInterfaceAccess>()).and_then(|a| unsafe { a.GetInterface::<ID3D11Texture2D>() }), "superficie WGC")?;
        let (w, h) = (self.size.Width.max(2), self.size.Height.max(2));
        self.last = Some(f);
        let _ = &self.item;
        Ok(Some(Frame { tex, src: RECT { left: 0, top: 0, right: w, bottom: h } }))
    }
    fn release(&mut self) { self.last = None; }
    fn take_frames(&mut self) -> u32 { std::mem::take(&mut self.frames) }
    fn size(&self) -> (u32, u32) { (self.size.Width.max(2) as u32, self.size.Height.max(2) as u32) }
    fn info(&self) -> Value { json!({ "border": self.border, "minUpdateInterval": self.interval, "poolRecreates": self.recreates, "window": self.window }) }
}

/// DXGI Desktop Duplication no device do codificador (sem cópia; na PoC a textura entrou direto no VideoProcessor em AMD
/// e Intel). Janela = recorte do monitor onde ela está: mostra o que estiver por cima (limitação do DXGI).
struct Dxgi { target: Target, hmon: HMONITOR, output: IDXGIOutput1, origin: (i32, i32), mw: u32, mh: u32, dup: Option<IDXGIOutputDuplication>, held: bool,
    lost_since: Option<f64>, retry_at: f64, tries: u32, recreates: Vec<f64>, lost_total: u32, invalid_call: u32, last_err: String, api: &'static str,
    copy: Option<ID3D11Texture2D>, direct: Option<bool>, frames: u32, ptr_only: u64, sysmem: bool, crop: Option<RECT>, hidden: bool,
    /// quadros da tela que o Windows juntou (AccumulatedFrames) x os que pegamos: ~1 = a tela mudou só isso (jogo/DWM);
    /// bem acima de 1 = a tela mudou mais e o laço daqui demorou a buscar (perda nossa)
    accumulated: u64, presents: u64 }
fn find_output(adapter: &IDXGIAdapter, hmon: HMONITOR) -> Option<IDXGIOutput1> {
    let mut j = 0;
    while let Ok(o) = unsafe { adapter.EnumOutputs(j) } { j += 1; if unsafe { o.GetDesc() }.map(|d| d.Monitor == hmon).unwrap_or(false) { return o.cast().ok(); } }
    None
}
impl Dxgi {
    fn open(g: &Gpu, t: Target) -> R<Self> {
        let hmon = match t { Target::Monitor(m) => m, Target::Window(h) => { if !unsafe { IsWindow(Some(h)) }.as_bool() { return Err(CLOSED.into()); } unsafe { MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST) } } };
        let (output, origin, mw, mh) = Self::output_for(g, hmon)?;
        let mut s = Self { target: t, hmon, output, origin, mw, mh, dup: None, held: false, lost_since: None, retry_at: 0.0, tries: 0, recreates: vec![], lost_total: 0, invalid_call: 0, last_err: String::new(), api: "",
            copy: None, direct: None, frames: 0, ptr_only: 0, sysmem: false, crop: None, hidden: false, accumulated: 0, presents: 0 };
        s.dup(g).map_err(|x| if x.starts_with("indisponivel") { x } else { format!("DXGI: {x}") })?;
        if let Target::Window(h) = t { s.crop = s.crop_of(h); }
        Ok(s)
    }
    fn output_for(g: &Gpu, hmon: HMONITOR) -> R<(IDXGIOutput1, (i32, i32), u32, u32)> {
        let o = find_output(&g.adapter, hmon).ok_or("indisponivel: o monitor esta ligado em outra placa de video (notebook hibrido?), e o DXGI precisa da mesma placa do codificador")?;
        let d = e(unsafe { o.GetDesc() }, "GetDesc da saida")?;
        // monitor girado: o DXGI entrega a imagem deitada (falta girar no VideoProcessor): fica com o WGC
        if d.Rotation.0 > 1 { return Err("indisponivel: monitor girado (o DXGI entrega a imagem sem girar)".into()); }
        let r = d.DesktopCoordinates;
        Ok((o, (r.left, r.top), (r.right - r.left).max(2) as u32, (r.bottom - r.top).max(2) as u32))
    }
    fn dup(&mut self, g: &Gpu) -> R<()> {
        self.dup = None; self.held = false;
        // DuplicateOutput1 (Windows 10 1703+, exige DPI por monitor, ligado no início) escolhe o formato; senão DuplicateOutput
        let r = match self.output.cast::<IDXGIOutput5>() {
            Ok(o5) => { self.api = "DuplicateOutput1"; unsafe { o5.DuplicateOutput1(&g.device, 0, &[DXGI_FORMAT_B8G8R8A8_UNORM]) } }
            Err(_) => { self.api = "DuplicateOutput"; unsafe { self.output.DuplicateOutput(&g.device) } }
        };
        let d = match r {
            Ok(d) => d,
            Err(x) if x.code() == DXGI_ERROR_UNSUPPORTED => return Err(format!("indisponivel: {} nao suportado nesta placa/driver (0x{:08X})", self.api, x.code().0 as u32)),
            Err(x) => return Err(format!("{}: {} (0x{:08X})", self.api, x.message(), x.code().0 as u32)),
        };
        let dd = unsafe { d.GetDesc() };
        // a posição do monitor na área de trabalho muda quando outro monitor troca de resolução (recorte de janela)
        if let Ok(od) = unsafe { self.output.GetDesc() } { self.origin = (od.DesktopCoordinates.left, od.DesktopCoordinates.top); }
        self.sysmem = dd.DesktopImageInSystemMemory.as_bool();
        if dd.ModeDesc.Width > 0 { self.mw = dd.ModeDesc.Width; self.mh = dd.ModeDesc.Height; }
        self.dup = Some(d); Ok(())
    }
    fn crop_of(&self, h: HWND) -> Option<RECT> {
        let w = window_rect(h)?;
        let (ox, oy) = self.origin;
        let l = (w.left - ox).max(0); let t = (w.top - oy).max(0);
        let r = (w.right - ox).min(self.mw as i32); let b = (w.bottom - oy).min(self.mh as i32);
        if r - l < 16 || b - t < 16 { return None; }
        // janela que cobre quase o monitor inteiro (jogo em tela cheia/sem bordas com alguns pixels de borda, visto
        // 1914x1080 num monitor de 1920): pega o monitor inteiro. Senão a imagem era redimensionada (1914 -> 1900) e
        // ficava borrada; assim sai 1:1. No máximo 32 px de cada lado entram de fora da janela.
        let (mw, mh) = (self.mw as i32, self.mh as i32);
        if l <= 32 && t <= 32 && mw - r <= 32 && mh - b <= 32 { return Some(RECT { left: 0, top: 0, right: mw & !1, bottom: mh & !1 }); }
        Some(RECT { left: l & !1, top: t & !1, right: r & !1, bottom: b & !1 })
    }
    /// perdeu o acesso: tenta de novo com espera crescente; desiste depois de DXGI_LOST_GIVEUP s
    fn lost(&mut self, now: f64, why: String) {
        if let Some(d) = &self.dup { if self.held { unsafe { let _ = d.ReleaseFrame(); } } }
        self.dup = None; self.held = false; self.lost_total += 1; self.last_err = why;
        self.lost_since.get_or_insert(now); self.tries = 0; self.retry_at = now;
        self.recreates.retain(|&t| now - t < 60.0); self.recreates.push(now);
    }
}
impl Drop for Dxgi { fn drop(&mut self) { if self.held { if let Some(d) = &self.dup { unsafe { let _ = d.ReleaseFrame(); } } } } }
impl Src for Dxgi {
    fn method(&self) -> Method { Method::Dxgi }
    fn next(&mut self, g: &Gpu, now: f64) -> Result<Option<Frame>, String> {
        if let Target::Window(h) = self.target {
            if !unsafe { IsWindow(Some(h)) }.as_bool() { return Err(CLOSED.into()); }
            // a janela foi para outro monitor: duplica a saída dele
            let m = unsafe { MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST) };
            if m != self.hmon {
                let (o, origin, mw, mh) = Self::output_for(g, m)?;
                self.hmon = m; self.output = o; self.origin = origin; self.mw = mw; self.mh = mh; self.copy = None;
                if let Some(d) = &self.dup { if self.held { unsafe { let _ = d.ReleaseFrame(); } } }
                self.dup = None; self.held = false; self.retry_at = now;
            }
        }
        if self.recreates.len() >= DXGI_MAX_RECREATES_MIN { return Err(format!("DXGI perdeu o acesso {} vezes em 60 s (ultimo: {})", self.recreates.len(), self.last_err)); }
        if self.dup.is_none() {
            if let Some(t0) = self.lost_since { if now - t0 > DXGI_LOST_GIVEUP { return Err(format!("DXGI sem acesso ha {:.0} s ({})", now - t0, self.last_err)); } }
            if now < self.retry_at { return Ok(None); }
            if let Err(x) = self.dup(g) {
                if x.starts_with("indisponivel") { return Err(x); }
                self.tries += 1; self.last_err = x; self.lost_since.get_or_insert(now);
                self.retry_at = now + (0.05 * 2f64.powi(self.tries.min(5) as i32)).min(1.0); // 0,1 s ... 1 s
                return Ok(None);
            }
            self.lost_since = None;
        }
        let d = self.dup.clone().unwrap();
        if self.held { unsafe { let _ = d.ReleaseFrame(); } self.held = false; }
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default(); let mut res: Option<IDXGIResource> = None;
        match unsafe { d.AcquireNextFrame(0, &mut info, &mut res) } {
            Ok(()) => {}
            Err(x) if x.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
            Err(x) if x.code() == DXGI_ERROR_DEVICE_REMOVED || x.code() == DXGI_ERROR_DEVICE_RESET => return Err(format!("placa de video perdida no DXGI (0x{:08X})", x.code().0 as u32)),
            // ACCESS_LOST (resolução, tela cheia exclusiva, Ctrl+Alt+Del), INVALID_CALL (visto na PoC ao entrar/sair da exclusiva)
            // e qualquer outro: a duplicação ficou inválida -> recria (com limite)
            Err(x) => { if x.code() == DXGI_ERROR_INVALID_CALL { self.invalid_call += 1; } self.lost(now, format!("AcquireNextFrame: {} (0x{:08X})", x.message(), x.code().0 as u32)); return Ok(None); }
        }
        self.held = true;
        if info.LastPresentTime == 0 { self.ptr_only += 1; return Ok(None); } // só o ponteiro do mouse mexeu
        self.presents += 1; self.accumulated += info.AccumulatedFrames as u64;
        let tex: ID3D11Texture2D = match res.map(|r| r.cast::<ID3D11Texture2D>()) { Some(Ok(t)) => t, _ => return Ok(None) };
        let mut td = D3D11_TEXTURE2D_DESC::default(); unsafe { tex.GetDesc(&mut td) };
        self.mw = td.Width; self.mh = td.Height;
        let src = match self.target {
            Target::Window(h) => {
                self.hidden = unsafe { IsIconic(h) }.as_bool();
                if self.hidden { return Ok(None); } // minimizada: repete o último quadro
                match self.crop_of(h) { Some(c) => { self.crop = Some(c); c } None => { self.hidden = true; return Ok(None); } }
            }
            Target::Monitor(_) => RECT { left: 0, top: 0, right: td.Width as i32, bottom: td.Height as i32 },
        };
        self.frames += 1;
        // a textura do DXGI serve direto de entrada para o VideoProcessor? (bind RT ou SRV; senão copia no mesmo device)
        if self.direct.is_none() { self.direct = Some(td.BindFlags & (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32 != 0); }
        if self.direct == Some(false) {
            let fits = self.copy.as_ref().map(|c| { let mut cd = D3D11_TEXTURE2D_DESC::default(); unsafe { c.GetDesc(&mut cd) }; cd.Width == td.Width && cd.Height == td.Height }).unwrap_or(false);
            if !fits {
                let cd = D3D11_TEXTURE2D_DESC { Width: td.Width, Height: td.Height, MipLevels: 1, ArraySize: 1, Format: td.Format, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT, BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32, CPUAccessFlags: 0, MiscFlags: 0 };
                let mut t = None; e(unsafe { g.device.CreateTexture2D(&cd, None, Some(&mut t)) }, "copia DXGI")?; self.copy = t;
            }
            let c = self.copy.clone().unwrap();
            unsafe { g.ctx.CopyResource(&c, &tex) };
            return Ok(Some(Frame { tex: c, src }));
        }
        Ok(Some(Frame { tex, src }))
    }
    fn release(&mut self) { if self.held { if let Some(d) = &self.dup { unsafe { let _ = d.ReleaseFrame(); } } self.held = false; } }
    fn take_frames(&mut self) -> u32 { std::mem::take(&mut self.frames) }
    fn size(&self) -> (u32, u32) {
        match (self.target, self.crop) { (Target::Window(_), Some(c)) => ((c.right - c.left) as u32, (c.bottom - c.top) as u32), _ => (self.mw, self.mh) }
    }
    fn info(&self) -> Value { json!({ "api": self.api, "accessLost": self.lost_total, "invalidCall": self.invalid_call, "lastError": self.last_err, "directInput": self.direct, "pointerOnly": self.ptr_only, "screenUpdatesPerFrame": if self.presents > 0 { (self.accumulated as f64 / self.presents as f64 * 100.0).round() / 100.0 } else { 0.0 }, "sysmem": self.sysmem, "window": matches!(self.target, Target::Window(_)), "hidden": self.hidden, "cursor": false }) }
    fn overlap(&self) -> bool { matches!(self.target, Target::Window(_)) }
}

// ------------------------------------------------------------------------------------------------------------ sonda
/// Miniatura 64x36 do quadro (VideoProcessor -> BGRA), copiada para texturas de leitura em rodízio e lida só quando a GPU
/// terminou (D3D11_MAP_FLAG_DO_NOT_WAIT): não trava a transmissão. Diz se está preto e se mudou desde a leitura anterior.
struct Probe { venum: ID3D11VideoProcessorEnumerator, vproc: ID3D11VideoProcessor, rt: ID3D11Texture2D, ov: ID3D11VideoProcessorOutputView, st: Vec<ID3D11Texture2D>, queue: std::collections::VecDeque<usize>, slot: usize, last_at: f64, last_hash: Option<u64>, black: u32, lit: u32, changed: u32, pub last_luma: f64, pub reads: u64, src: RECT }
impl Probe {
    fn new(g: &Gpu, (mw, mh): (u32, u32)) -> R<Self> {
        let rate = DXGI_RATIONAL { Numerator: 60, Denominator: 1 };
        let cd = D3D11_VIDEO_PROCESSOR_CONTENT_DESC { InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, InputFrameRate: rate, InputWidth: mw.max(3840), InputHeight: mh.max(2160), OutputFrameRate: rate, OutputWidth: PW, OutputHeight: PH, Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED };
        let venum = e(unsafe { g.vdev.CreateVideoProcessorEnumerator(&cd) }, "sonda enum")?;
        let vproc = e(unsafe { g.vdev.CreateVideoProcessor(&venum, 0) }, "sonda vproc")?;
        let td = D3D11_TEXTURE2D_DESC { Width: PW, Height: PH, MipLevels: 1, ArraySize: 1, Format: DXGI_FORMAT_B8G8R8A8_UNORM, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT, BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32, CPUAccessFlags: 0, MiscFlags: 0 };
        let mut rt = None; e(unsafe { g.device.CreateTexture2D(&td, None, Some(&mut rt)) }, "sonda rt")?;
        let sd = D3D11_TEXTURE2D_DESC { Usage: D3D11_USAGE_STAGING, BindFlags: 0, CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32, ..td };
        let mut st = Vec::new();
        for _ in 0..4 { let mut t = None; e(unsafe { g.device.CreateTexture2D(&sd, None, Some(&mut t)) }, "sonda staging")?; st.push(t.unwrap()); }
        let od = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC { ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } } };
        let rt = rt.unwrap();
        let mut ov = None; e(unsafe { g.vdev.CreateVideoProcessorOutputView(&rt, &venum, &od, Some(&mut ov)) }, "sonda ov")?;
        unsafe {
            g.vctx.VideoProcessorSetStreamColorSpace(&vproc, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
            g.vctx.VideoProcessorSetOutputColorSpace(&vproc, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
            g.vctx.VideoProcessorSetStreamFrameFormat(&vproc, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
            g.vctx.VideoProcessorSetOutputTargetRect(&vproc, true, Some(&RECT { left: 0, top: 0, right: PW as i32, bottom: PH as i32 }));
            g.vctx.VideoProcessorSetStreamDestRect(&vproc, 0, true, Some(&RECT { left: 0, top: 0, right: PW as i32, bottom: PH as i32 }));
            g.vctx.VideoProcessorSetStreamAutoProcessingMode(&vproc, 0, false);
        }
        Ok(Self { venum, vproc, rt, ov: ov.unwrap(), st, queue: Default::default(), slot: 0, last_at: -1.0, last_hash: None, black: 0, lit: 0, changed: 0, last_luma: -1.0, reads: 0, src: RECT::default() })
    }
    /// pede uma miniatura deste quadro (no máximo a cada PROBE_EVERY s)
    fn sample(&mut self, g: &Gpu, f: &Frame, now: f64) {
        if now - self.last_at < PROBE_EVERY || self.queue.len() >= self.st.len() - 1 { return; }
        self.last_at = now;
        let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC { FourCC: 0, ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } } };
        let mut iv = None;
        if unsafe { g.vdev.CreateVideoProcessorInputView(&f.tex, &self.venum, &ivd, Some(&mut iv)) }.is_err() { return; }
        if self.src != f.src { self.src = f.src; unsafe { g.vctx.VideoProcessorSetStreamSourceRect(&self.vproc, 0, true, Some(&f.src)); } }
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(iv), ..Default::default() };
        let r = unsafe { g.vctx.VideoProcessorBlt(&self.vproc, &self.ov, 0, std::slice::from_ref(&stream)) };
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface); }
        if r.is_err() { return; }
        let i = self.slot % self.st.len(); self.slot += 1;
        unsafe { g.ctx.CopyResource(&self.st[i], &self.rt); }
        self.queue.push_back(i);
    }
    /// lê as miniaturas que a GPU já terminou
    fn poll(&mut self, g: &Gpu) {
        while let Some(&i) = self.queue.front() {
            let mut m = D3D11_MAPPED_SUBRESOURCE::default();
            if unsafe { g.ctx.Map(&self.st[i], 0, D3D11_MAP_READ, D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32, Some(&mut m)) }.is_err() { break; } // ainda na GPU (ou erro: tenta depois)
            self.queue.pop_front();
            let (mut sum, mut max) = (0f64, 0u32); let mut hash: u64 = 0xcbf29ce484222325;
            for y in 0..PH {
                let row = unsafe { std::slice::from_raw_parts((m.pData as *const u8).add((y * m.RowPitch) as usize), (PW * 4) as usize) };
                for x in 0..PW as usize {
                    let (b, gg, r) = (row[x * 4] as u32, row[x * 4 + 1] as u32, row[x * 4 + 2] as u32);
                    let l = (2126 * r + 7152 * gg + 722 * b) / 10000; sum += l as f64; max = max.max(l);
                    for c in [b >> 3, gg >> 3, r >> 3] { hash ^= c as u64; hash = hash.wrapping_mul(0x100000001b3); }
                }
            }
            unsafe { g.ctx.Unmap(&self.st[i], 0); }
            let mean = sum / (PW * PH) as f64; self.last_luma = mean; self.reads += 1;
            if mean < 4.0 && max < 24 { self.black += 1; } else { self.lit += 1; }
            if self.last_hash.map(|h| h != hash).unwrap_or(false) { self.changed += 1; }
            self.last_hash = Some(hash);
        }
    }
    fn take(&mut self) -> (u32, u32, u32) { (std::mem::take(&mut self.black), std::mem::take(&mut self.lit), std::mem::take(&mut self.changed)) }
}

// ------------------------------------------------------------------------------------------------------------ tela cheia
/// O Windows diz se há algo em tela cheia na frente (2 = ocupado/tela cheia, 3 = Direct3D exclusiva) e se essa janela
/// está no que transmitimos: sinal de que a imagem devia estar mudando (um jogo).
fn fullscreen(t: Target, cur_mon: Option<HMONITOR>) -> (i32, bool) {
    let st = unsafe { SHQueryUserNotificationState() }.map(|s| s.0).unwrap_or(0);
    let fg = unsafe { GetForegroundWindow() };
    let ours = if fg.0.is_null() { false } else {
        match t {
            Target::Window(h) => { let r = unsafe { GetAncestor(fg, GA_ROOT) }; fg == h || r == h }
            Target::Monitor(m) => { let fm = unsafe { MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST) }; fm == cur_mon.unwrap_or(m) }
        }
    };
    (st, ours && (st == 2 || st == 3))
}

// ------------------------------------------------------------------------------------------------------------ pipeline
struct Pipe { g: Gpu, layers: Vec<(usize, WinLayer)>, src_rect: RECT }
fn build_pipe(o: &Opts, w: u32, h: u32) -> R<(Pipe, String)> {
    let g = gpu()?;
    let top_i = o.layers.len() - 1;
    let top = make_layer(&g.device, &g.vdev, &g.vctx, g.luid, w, h, &o.layers[top_i], !o.app)?;
    let mut layers = Vec::new(); let mut layer_err = String::new();
    for (i, l) in o.layers.iter().enumerate().take(top_i) {
        match make_layer(&g.device, &g.vdev, &g.vctx, g.luid, w, h, l, !o.app) { Ok(x) => layers.push((i, x)), Err(x) => layer_err = format!("camada {}p{}: {x}", l.height, l.fps) }
    }
    layers.push((top_i, top));
    let r = RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 };
    for (_, l) in &layers { l.set_src(&g.vctx, r); }
    Ok((Pipe { g, layers, src_rect: r }, layer_err))
}

fn open_src(g: &Gpu, m: Method, t: Target, cursor: bool, signal: &Arc<(Mutex<bool>, Condvar)>) -> R<Box<dyn Src>> {
    Ok(match m { Method::Wgc => Box::new(Wgc::open(g, t, cursor, signal)?), Method::Dxgi => Box::new(Dxgi::open(g, t)?) })
}
/// tamanho inicial da imagem, para dimensionar o codificador (a saída é fixa; depois disso mudanças viram barras pretas)
fn target_size(t: Target) -> (u32, u32) {
    let r = match t {
        Target::Window(h) => window_rect(h),
        Target::Monitor(m) => { let mut mi = windows::Win32::Graphics::Gdi::MONITORINFO { cbSize: std::mem::size_of::<windows::Win32::Graphics::Gdi::MONITORINFO>() as u32, ..Default::default() }; if unsafe { windows::Win32::Graphics::Gdi::GetMonitorInfoW(m, &mut mi) }.as_bool() { Some(mi.rcMonitor) } else { None } }
    };
    r.map(|r| (((r.right - r.left).max(2) as u32) & !1, ((r.bottom - r.top).max(2) as u32) & !1)).unwrap_or((1920, 1080))
}

/// Eventos JSON da transmissão (só no modo app; no modo teste, texto no console)
fn out(o: &Opts, v: Value) { if o.app { emit(v); } else { eprintln!("  {v}"); } }

pub fn run(o: &Opts, mode: Mode, build_hint: u32) -> R<()> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
        e(MFStartup(MF_VERSION, MFSTARTUP_FULL), "MFStartup")?;
        // DuplicateOutput1 exige o processo com DPI por monitor; também deixa as coordenadas de janela em pixels físicos
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        // espera de 1 ms de verdade no laço (o DXGI não acorda o laço como o evento do WGC)
        let _ = windows::Win32::Media::timeBeginPeriod(1);
    }
    let r = run_inner(o, mode, build_hint);
    unsafe { let _ = windows::Win32::Media::timeEndPeriod(1); }
    r
}

fn run_inner(o: &Opts, mode: Mode, build_hint: u32) -> R<()> {
    let build = if build_hint > 0 { build_hint } else { os_build() };
    let t = target_of(&o.source);
    let window_src = matches!(t, Target::Window(_));
    let mut sel = Selector::new(mode, build, window_src);
    let (w0, h0) = target_size(t);
    let (mut p, layer_err) = build_pipe(o, w0, h0)?;
    let signal = Arc::new((Mutex::new(false), Condvar::new()));
    let mut m = Meter::new(o);
    let clock = Instant::now();
    let now_s = |c: &Instant| c.elapsed().as_secs_f64();

    // abre o primeiro método que funcionar, na ordem do seletor
    let mut open_errors: Vec<Value> = vec![];
    let mut active: Box<dyn Src> = loop {
        let Some(mm) = sel.next_to_open() else { return Err(match sel.open_failed(now_s(&clock), Method::Wgc, "sem metodo") { Action::GiveUp(x) => x, _ => "sem metodo".into() }) };
        match open_src(&p.g, mm, t, o.cursor, &signal) {
            Ok(s) => { sel.opened(now_s(&clock), mm); break s; }
            Err(x) => {
                if x == CLOSED { return Err(x); }
                open_errors.push(json!({ "m": mm.id(), "error": x }));
                out(o, json!({ "t": "capnote", "at": 0, "msg": format!("{} nao abriu: {x}", mm.id().to_uppercase()) }));
                if let Action::GiveUp(g) = sel.open_failed(now_s(&clock), mm, &x) { return Err(g); }
            }
        }
    };
    let mut cand: Option<(Box<dyn Src>, Probe, f64)> = None; // (fonte, sonda, quando a decisão foi tomada)
    let mut probe = Probe::new(&p.g, (w0, h0))?;
    let mut tx = sender(o)?;
    let top_i = o.layers.len() - 1;
    for (i, l) in &p.layers { if let Some(hh) = l.enc.seq_header() { tx.set_params(*i, &hh); } }
    let (ow, oh) = (p.layers.last().unwrap().1.ow, p.layers.last().unwrap().1.oh);
    m.size = (ow, oh);
    let enc_name = p.layers.last().unwrap().1.enc.name.clone();
    if !o.app { eprintln!("  placa de video: {}\n  codificador: {enc_name}\n  {}", p.g.name, sel.plan_why); }
    let started_ms = now_s(&clock) * 1000.0;
    if o.app { emit(json!({ "t": "started", "w": ow, "h": oh, "encoder": enc_name, "gpu": p.g.name, "minUpdateInterval": active.info()["minUpdateInterval"],
        "layers": p.layers.iter().map(|(_, l)| format!("{}p{}", l.oh, l.fps)).collect::<Vec<_>>(), "layerError": layer_err, "prio": p.g.prio,
        "capture": { "mode": mode.id(), "os": build, "win11": sel.win11, "window": window_src, "order": sel.order().iter().map(|x| x.id()).collect::<Vec<_>>(), "plan": sel.plan_why, "method": active.method().id(), "openErrors": open_errors, "info": active.info(), "overlap": active.overlap() } })); }
    let mut history: Vec<Value> = vec![json!({ "at": 0, "from": null, "m": active.method().id(), "why": if open_errors.is_empty() { format!("primeira opção: {}", sel.plan_why) } else { "a primeira opção não abriu".into() }, "ms": started_ms.round() })];
    out(o, json!({ "t": "method", "m": active.method().id(), "from": null, "why": history[0]["why"], "ms": started_ms.round(), "auto": !sel.forced(), "at": 0 }));
    // troca pendente: quando a nova fonte entregar o 1º quadro, mede a latência e pede quadro-chave
    let mut pending_switch: Option<(f64, Method, String, Method, f64)> = None; // (início, de, motivo, para, ms comparando lado a lado)

    let (mut blt_err, mut in_err) = (None::<String>, None::<String>);
    let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC { FourCC: 0, ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } } };
    let mut next_health = HEALTH_EVERY;
    let mut rebuilds: Vec<f64> = vec![]; let mut errs: u32 = 0; let mut last_err = String::new();
    let mut src_size = active.size();
    let mut cap_total: (u32, f64) = (0, 0.0);
    let mut cpu_prev = (cpu_secs(), 0.0f64); let mut cpu_pct = 0.0f64;
    say_ok(o, &format!("  metodo: {} ({})", active.method().id(), sel.plan_why));

    while !m.done() {
        let now = now_s(&clock);
        // ---- placa de vídeo perdida: reconstrói tudo (device, codificadores, fontes) mantendo o RTP
        let lost = p.g.lost();
        if let Some(why) = lost {
            rebuilds.retain(|&x| now - x < DEVICE_WINDOW); rebuilds.push(now);
            out(o, json!({ "t": "capnote", "at": r1(now), "msg": format!("{why}; reconstruindo ({}/{DEVICE_REBUILDS})", rebuilds.len()) }));
            if rebuilds.len() > DEVICE_REBUILDS { return Err(format!("{why}; {} vezes em {DEVICE_WINDOW:.0} s", rebuilds.len())); }
            cand = None; drop(active);
            let cur = sel.active().unwrap_or(sel.order()[0]);
            for (_, l) in &p.layers { unsafe { let _ = l.enc.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); } }
            std::thread::sleep(Duration::from_millis(500));
            let mut tries = 0;
            let (np, _) = loop { match build_pipe(o, ow, oh) { Ok(x) => break x, Err(x) => { tries += 1; if tries >= 10 { return Err(format!("{why}; nao consegui reabrir a placa: {x}")); } std::thread::sleep(Duration::from_millis(500)); } } };
            p = np;
            probe = Probe::new(&p.g, (w0, h0))?;
            active = match open_src(&p.g, cur, t, o.cursor, &signal).or_else(|x| if sel.forced() { Err(x) } else { open_src(&p.g, cur.other(), t, o.cursor, &signal) }) { Ok(s) => s, Err(x) => return Err(format!("{why}; captura nao reabriu: {x}")) };
            sel.opened(now, active.method());
            for (i, l) in &p.layers { if let Some(hh) = l.enc.seq_header() { tx.set_params(*i, &hh); } l.enc.force_key(); }
            pending_switch = Some((now, cur, "placa de video reconstruida".into(), active.method(), 0.0));
            continue;
        }
        // ---- eventos dos codificadores
        for (i, l) in p.layers.iter_mut() {
            loop {
                let ev = match unsafe { l.enc.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } { Ok(ev) => ev, Err(_) => break };
                let typ = unsafe { ev.GetType() }.unwrap_or(0);
                if typ == METransformNeedInput.0 as u32 {
                    l.need += 1;
                    // quadro que chegou com o codificador ocupado: entra agora
                    if let Some((ps, pst)) = l.pending.take() { if l.feed(ps, pst).is_ok() { l.need -= 1; l.inputs += 1; l.last_slot = Some(ps); l.last_input = now; l.last_st = pst; } }
                }
                else if typ == METransformHaveOutput.0 as u32 {
                    let out_ = match l.enc.take_output() { Ok(x) => x, Err(x) => { if p.g.lost().is_some() { break; } return Err(x); } };
                    if let Some((data, ts100)) = out_ {
                        if *i == top_i { if let Some(at) = l.inflight.remove(&ts100) { m.enc_ms.push(at.elapsed().as_secs_f64() * 1000.0); } } else { l.inflight.remove(&ts100); }
                        let ts = (ts100.max(0) as u64 * 9 / 1000) as u32;
                        if !tx.has_params(*i) { if let Some(hh) = l.enc.seq_header() { tx.set_params(*i, &hh); } }
                        let before = tx.streams[*i].stats.bytes; tx.send_frame(*i, &data, ts); m.sent(*i, (tx.streams[*i].stats.bytes - before) as usize);
                    }
                } else if typ == MEError.0 as u32 {
                    if p.g.lost().is_some() { break; }
                    return Err(format!("o codificador avisou erro: 0x{:08X}", unsafe { ev.GetStatus() }.map(|h| h.0 as u32).unwrap_or(0)));
                }
            }
        }
        if p.g.lost().is_some() { continue; }
        tx.poll_rtcp();
        for (i, l) in &p.layers { if tx.streams[*i].want_key { tx.streams[*i].want_key = false; l.enc.force_key(); } }
        probe.poll(&p.g);
        if let Some((_, cp, _)) = &mut cand { cp.poll(&p.g); }

        // ---- saúde e decisões (a cada HEALTH_EVERY s)
        if now >= next_health {
            next_health = now + HEALTH_EVERY;
            let fs = fullscreen(t, None);
            let fr = active.take_frames(); cap_total.0 += fr;
            let (b, li, ch) = probe.take();
            // janela minimizada: nenhum método entrega imagem dela, e isso não é defeito do método (repete o último quadro)
            let iconic = matches!(t, Target::Window(hw) if unsafe { IsIconic(hw) }.as_bool());
            let h = Health { frames: if iconic { fr.max(1) } else { fr }, black: b, lit: li, changed: ch, expect_motion: fs.1 && !iconic, exclusive: fs.0 == 3 };
            let mut act = sel.tick(now, &h);
            if let Some((cs, cp, _)) = &mut cand {
                let (cb, cl, cc) = cp.take();
                let chh = Health { frames: cs.take_frames(), black: cb, lit: cl, changed: cc, expect_motion: fs.1, exclusive: fs.0 == 3 };
                if act == Action::None { act = sel.cand_tick(now, &chh); }
            }
            for n in sel.notes.drain(..) { out(o, n); }
            match act {
                Action::None => {}
                Action::OpenCandidate(mm, why) => {
                    out(o, json!({ "t": "capnote", "at": r1(now), "msg": why }));
                    match open_src(&p.g, mm, t, o.cursor, &signal).and_then(|s| Ok((s, Probe::new(&p.g, (w0, h0))?))) {
                        Ok((s, pr)) => cand = Some((s, pr, now)),
                        Err(x) => { if x == CLOSED { return Err(x); } out(o, json!({ "t": "capnote", "at": r1(now), "msg": format!("{} nao abriu: {x}", mm.id().to_uppercase()) })); sel.cand_error(now, &x); for n in sel.notes.drain(..) { out(o, n); } }
                    }
                }
                Action::DropCandidate(why) => {
                    let mm = cand.as_ref().map(|c| c.0.method().id()).unwrap_or("?");
                    out(o, json!({ "t": "capnote", "at": r1(now), "msg": format!("{} descartado: {why}", mm.to_uppercase()) }));
                    cand = None; sel.cand_dropped(now, &why); for n in sel.notes.drain(..) { out(o, n); }
                }
                Action::Promote(why) => {
                    if let Some((s, pr, t0)) = cand.take() {
                        let from = active.method();
                        sel.promoted(now);
                        active = s; probe = pr; src_size = active.size();
                        pending_switch = Some((now, from, why, active.method(), ((now - t0) * 1000.0).round()));
                    }
                }
                Action::SwitchCold(mm, why) => {
                    let from = active.method();
                    cand = None;
                    match open_src(&p.g, mm, t, o.cursor, &signal) {
                        Ok(s) => { sel.switched_cold(now, mm); drop(std::mem::replace(&mut active, s)); probe = Probe::new(&p.g, (w0, h0))?; src_size = active.size(); pending_switch = Some((now, from, why, mm, 0.0)); }
                        Err(x) => {
                            if x == CLOSED { return Err(x); }
                            match sel.open_failed(now, mm, &x) { Action::GiveUp(g) => return Err(g), _ => {} }
                            for n in sel.notes.drain(..) { out(o, n); }
                        }
                    }
                }
                Action::GiveUp(why) => return Err(why),
            }
            let top = &p.layers.last().unwrap().1;
            cap_total.1 = now;
            let c = cpu_secs(); if now > cpu_prev.1 { cpu_pct = (c - cpu_prev.0) / (now - cpu_prev.1) * 100.0; } cpu_prev = (c, now);
            m.extra = json!({ "m": active.method().id(), "cand": cand.as_ref().map(|c| c.0.method().id()), "srcW": src_size.0, "srcH": src_size.1, "fs": fs.0, "fsOurs": fs.1,
                "black": sel_black(&probe), "luma": (probe.last_luma * 10.0).round() / 10.0, "overlap": active.overlap(), "errs": errs, "lastErr": last_err, "rebuilds": rebuilds.len(), "info": active.info(), "need": top.need, "cpu": cpu_pct.round() });
        }

        // ---- candidato: consome os quadros só para a sonda (não vai para o codificador)
        if let Some((cs, cp, _)) = &mut cand {
            match cs.next(&p.g, now) {
                Ok(Some(f)) => { cp.sample(&p.g, &f, now); cs.release(); }
                Ok(None) => {}
                Err(x) => { if x == CLOSED { return Err(x); } out(o, json!({ "t": "capnote", "at": r1(now), "msg": format!("{} (candidato) falhou: {x}", cs.method().id().to_uppercase()) })); cand = None; sel.cand_error(now, &x); for n in sel.notes.drain(..) { out(o, n); } }
            }
        }

        // ---- quadro novo da fonte ativa
        let got = match active.next(&p.g, now) {
            Ok(x) => x,
            Err(x) => {
                if x == CLOSED { return Err(x); }
                if p.g.lost().is_some() { continue; }
                errs += 1; last_err = format!("{}: {x}", active.method().id().to_uppercase());
                out(o, json!({ "t": "capnote", "at": r1(now), "msg": format!("{} falhou: {x}", active.method().id().to_uppercase()) }));
                match sel.active_error(now, &x) {
                    Action::Promote(why) => { if let Some((s, pr, t0)) = cand.take() { let from = active.method(); sel.promoted(now); active = s; probe = pr; src_size = active.size(); pending_switch = Some((now, from, why, active.method(), ((now - t0) * 1000.0).round())); } }
                    Action::SwitchCold(mm, why) => {
                        let from = active.method(); cand = None;
                        match open_src(&p.g, mm, t, o.cursor, &signal) {
                            Ok(s) => { sel.switched_cold(now, mm); active = s; probe = Probe::new(&p.g, (w0, h0))?; src_size = active.size(); pending_switch = Some((now, from, why, mm, 0.0)); }
                            Err(y) => { if y == CLOSED { return Err(y); } if let Action::GiveUp(g) = sel.open_failed(now, mm, &y) { return Err(g); } }
                        }
                    }
                    Action::GiveUp(g) => return Err(g),
                    _ => {}
                }
                for n in sel.notes.drain(..) { out(o, n); }
                continue;
            }
        };
        m.tick(&tx.total());
        let Some(f) = got else {
            // tela parada: repete o último quadro ~10x/s (quem entra depois recebe imagem e o servidor sabe que segue vivo)
            for (_, l) in p.layers.iter_mut() {
                if let Some(ls) = l.last_slot { if now - l.last_input > 0.1 && l.need > 0 {
                    l.last_st += ((now - l.last_input) * 1e7) as i64; l.last_input = now;
                    let st = l.last_st; if l.feed(ls, st).is_ok() { l.need -= 1; m.repeats += 1; }
                } }
            }
            let (mx, cv) = &*signal; let g = mx.lock().unwrap();
            let (mut g, _) = cv.wait_timeout(g, Duration::from_millis(1)).unwrap(); *g = false;
            continue;
        };
        m.captured();
        probe.sample(&p.g, &f, now);
        if f.src != p.src_rect { p.src_rect = f.src; src_size = ((f.src.right - f.src.left) as u32, (f.src.bottom - f.src.top) as u32); for (_, l) in &p.layers { l.set_src(&p.g.vctx, f.src); } }
        // 1º quadro depois de uma troca: quadro-chave em todas as camadas e o evento com a latência
        // ms: da troca até o 1º quadro da nova fonte no codificador (o tempo sem imagem nova); testMs: quanto os dois
        // métodos ficaram lado a lado sendo comparados antes (sem afetar a transmissão)
        if let Some((t0, from, why, to, test_ms)) = pending_switch.take() {
            for (_, l) in &p.layers { l.enc.force_key(); }
            let ms = ((now - t0) * 1000.0).round();
            let ev = json!({ "at": r1(now), "from": from.id(), "m": to.id(), "why": why, "ms": ms, "testMs": test_ms });
            out(o, json!({ "t": "method", "m": to.id(), "from": from.id(), "why": why, "ms": ms, "testMs": test_ms, "auto": !sel.forced(), "at": r1(now), "overlap": active.overlap(), "info": active.info() }));
            history.push(ev);
        }
        // quais camadas querem este quadro (cada uma no seu fps)
        let st = (now * 1e7) as i64;
        let mut want: Vec<usize> = Vec::new();
        for (k, (_i, l)) in p.layers.iter_mut().enumerate() {
            // ritmo da camada: na média no máximo l.fps, mas aceita um quadro que chega colado no anterior (rajada). Antes
            // descartava esse quadro mesmo com a captura abaixo do fps da camada (48 capturados, 44 enviados)
            let iv = 1.0 / l.fps as f64;
            if now + iv * 0.55 < l.next_due { continue; } // 0,55: num monitor de 144 Hz (6,9 ms) não manda dois quadros colados a 60 fps
            l.next_due = l.next_due.max(now - iv * 0.5) + iv;
            want.push(k); // codificador ocupado (need == 0): converte e deixa esperando (pending) em vez de descartar
        }
        for k in want {
            let l = &mut p.layers[k].1;
            let cur = l.slot % NV12_RING; l.slot += 1;
            let mut inview: Option<ID3D11VideoProcessorInputView> = None;
            if let Err(x) = unsafe { p.g.vdev.CreateVideoProcessorInputView(&f.tex, &l.venum, &ivd, Some(&mut inview)) } { blt_err.get_or_insert(format!("InputView: {}", x.message())); continue; }
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(inview), ..Default::default() };
            let r = unsafe { p.g.vctx.VideoProcessorBlt(&l.vproc, &l.ring[cur].1, 0, std::slice::from_ref(&stream)) };
            unsafe { ManuallyDrop::drop(&mut stream.pInputSurface); }
            if let Err(x) = r { blt_err.get_or_insert(format!("VideoProcessorBlt: {}", x.message())); continue; }
            if l.need == 0 {
                // ocupado: guarda este (o mais novo); só conta como perdido se substituiu um que ainda esperava
                if l.pending.replace((cur, st)).is_some() && p.layers[k].0 == top_i { m.skipped_busy += 1; }
                continue;
            }
            l.pending = None;
            match l.feed(cur, st) { Ok(()) => { l.need -= 1; l.inputs += 1; l.last_slot = Some(cur); l.last_input = now; l.last_st = st; } Err(x) => { in_err.get_or_insert(format!("ProcessInput: {} (0x{:08X})", x.message(), x.code().0 as u32)); } }
        }
        drop(f); active.release();
        let tl = &p.layers.last().unwrap().1;
        if tl.inputs > 60 && tx.streams[top_i].stats.frames == 0 && p.g.lost().is_none() { return Err(format!("nenhum quadro saiu do codificador. {} {}", blt_err.unwrap_or_default(), in_err.unwrap_or_default())); }
    }
    drop(cand); drop(active);
    for (_, l) in &p.layers { unsafe { let _ = l.enc.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); } }
    summary(&m, &tx.total(), json!({ "encoder": enc_name, "size": format!("{ow}x{oh}"), "bltError": blt_err.unwrap_or_default(), "inputError": in_err.unwrap_or_default(), "repeats": m.repeats, "rtcpBad": tx.rtcp_bad, "layers": p.layers.len(), "layerError": layer_err,
        "capture": { "mode": mode.id(), "os": build, "history": history, "rebuilds": rebuilds.len(), "errors": errs, "capturedFps": if cap_total.1 > 0.0 { (cap_total.0 as f64 / cap_total.1 * 10.0).round() / 10.0 } else { 0.0 } } }));
    Ok(())
}
/// tempo de CPU do próprio processo (usuário + núcleo), em segundos: o painel mostra o uso em % de um núcleo
fn cpu_secs() -> f64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    let (mut a, mut b, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    if unsafe { GetProcessTimes(GetCurrentProcess(), &mut a, &mut b, &mut k, &mut u) }.is_err() { return 0.0; }
    let f = |t: FILETIME| ((t.dwHighDateTime as u64) << 32 | t.dwLowDateTime as u64) as f64 / 1e7;
    f(k) + f(u)
}
fn say_ok(o: &Opts, s: &str) { if !o.app { eprintln!("{s}"); } }
fn sel_black(p: &Probe) -> bool { p.reads > 0 && p.last_luma >= 0.0 && p.last_luma < 4.0 }
fn r1(x: f64) -> f64 { (x * 10.0).round() / 10.0 }
#[allow(dead_code)]
fn _unused(_: PCWSTR) {}
