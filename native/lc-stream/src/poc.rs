//! Prova de conceito: WGC x DXGI Desktop Duplication alimentando o MESMO codificador da transmissão (win.rs).
//! Só existe com `cargo build --features poc`; o lc-stream normal não inclui nada daqui.
//!   lc-stream --poc-captura [--monitor x,y] [--fps 120] [--height 1080] [--secs 6]   testes automáticos
//!   lc-stream --poc-captura --manual 90                                              registro por segundo (testes à mão)
//! Escreve poc-captura-resultado.json (ou poc-captura-manual.json) na pasta atual e um resumo no console (ASCII).
use crate::win::{e, fit, make_layer, tune, WinLayer, R, NV12_RING};
use crate::{arg, flag, pct, Layer};
use std::mem::ManuallyDrop;
use std::time::{Duration, Instant};

use windows::core::{factory, w, Interface, HSTRING, PCWSTR};
use windows::Foundation::Metadata::ApiInformation;
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Shell::SHQueryUserNotificationState;
use windows::Win32::UI::WindowsAndMessaging::*;
use serde_json::{json, Value};

type J = Value;
fn r2(x: f64) -> f64 { (x * 100.0).round() / 100.0 }
fn stats(v: &[f64]) -> J { if v.is_empty() { return json!(null); } json!({ "n": v.len(), "p50": r2(pct(v, 0.5)), "p95": r2(pct(v, 0.95)), "max": r2(v.iter().cloned().fold(0.0, f64::max)) }) }
fn mean_u(v: &[u32]) -> f64 { if v.is_empty() { 0.0 } else { v.iter().map(|&x| x as f64).sum::<f64>() / v.len() as f64 } }
fn say(s: &str) { eprintln!("{s}"); }

// ---------------------------------------------------------------------------------------------------------------- GPU
pub struct Gpu { pub device: ID3D11Device, pub ctx: ID3D11DeviceContext, pub vdev: ID3D11VideoDevice, pub vctx: ID3D11VideoContext, pub d3d: IDirect3DDevice, pub luid: u64, pub name: String, pub adapter: IDXGIAdapter }
/// igual ao run() do win.rs: o device do codificador (BGRA + VIDEO_SUPPORT, multithread)
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
    let _ = tune(&dxgi);
    Ok(Gpu { vdev: e(device.cast(), "ID3D11VideoDevice")?, vctx: e(ctx.cast(), "ID3D11VideoContext")?, device, ctx, d3d, luid, name, adapter })
}

/// Cronômetro da GPU (consultas de timestamp), sem travar: N pares em rodízio, lidos quando prontos.
pub struct GpuClock { slots: Vec<(ID3D11Query, ID3D11Query, ID3D11Query, Option<u8>)>, next: usize, pub out: Vec<(u8, f64)> }
fn get_data(ctx: &ID3D11DeviceContext, q: &ID3D11Query, p: *mut core::ffi::c_void, n: u32) -> bool {
    // S_FALSE (ainda não pronto) também é "sucesso" para o windows-rs: chama a vtable para ver o HRESULT de verdade
    unsafe { (Interface::vtable(ctx).GetData)(Interface::as_raw(ctx), Interface::as_raw(q), p, n, D3D11_ASYNC_GETDATA_DONOTFLUSH.0 as u32) == S_OK }
}
impl GpuClock {
    fn new(dev: &ID3D11Device) -> R<Self> {
        let mut slots = Vec::new();
        for _ in 0..24 {
            let mk = |q: D3D11_QUERY| -> R<ID3D11Query> { let mut x = None; e(unsafe { dev.CreateQuery(&D3D11_QUERY_DESC { Query: q, MiscFlags: 0 }, Some(&mut x)) }, "CreateQuery")?; Ok(x.unwrap()) };
            slots.push((mk(D3D11_QUERY_TIMESTAMP_DISJOINT)?, mk(D3D11_QUERY_TIMESTAMP)?, mk(D3D11_QUERY_TIMESTAMP)?, None));
        }
        Ok(Self { slots, next: 0, out: vec![] })
    }
    /// começa a medir (tag = o que está sendo medido); None se todos ocupados
    fn begin(&mut self, ctx: &ID3D11DeviceContext, tag: u8) -> Option<usize> {
        self.poll(ctx);
        let n = self.slots.len();
        for k in 0..n { let i = (self.next + k) % n; if self.slots[i].3.is_none() { self.next = i + 1; let s = &mut self.slots[i]; s.3 = Some(tag); unsafe { ctx.Begin(&s.0); ctx.End(&s.1); } return Some(i); } }
        None
    }
    fn end(&mut self, ctx: &ID3D11DeviceContext, i: Option<usize>) { if let Some(i) = i { let s = &self.slots[i]; unsafe { ctx.End(&s.2); ctx.End(&s.0); } } }
    fn poll(&mut self, ctx: &ID3D11DeviceContext) {
        for s in self.slots.iter_mut() {
            let Some(tag) = s.3 else { continue };
            let mut dj = D3D11_QUERY_DATA_TIMESTAMP_DISJOINT::default();
            if !get_data(ctx, &s.0, &mut dj as *mut _ as _, std::mem::size_of_val(&dj) as u32) { continue; }
            let (mut a, mut b) = (0u64, 0u64);
            if !get_data(ctx, &s.1, &mut a as *mut _ as _, 8) || !get_data(ctx, &s.2, &mut b as *mut _ as _, 8) { continue; }
            s.3 = None;
            if !dj.Disjoint.as_bool() && dj.Frequency > 0 && b >= a { self.out.push((tag, (b - a) as f64 * 1000.0 / dj.Frequency as f64)); }
        }
    }
    fn take(&mut self, tag: u8) -> Vec<f64> { let (a, b): (Vec<_>, Vec<_>) = self.out.drain(..).partition(|x| x.0 == tag); self.out = b; a.into_iter().map(|x| x.1).collect() }
}
const T_BLT: u8 = 1; const T_COPY: u8 = 2; const T_COPY_THEIRS: u8 = 3;

// ---------------------------------------------------------------------------------------------------------------- ambiente
#[derive(Clone)]
pub struct Mon { hmon: HMONITOR, rect: RECT, rot: i32, dev: String, adapter: String, adapter_luid: u64, hz: u32, dpi: u32, hdr: bool, bits: u32 }
fn reg_str(key: PCWSTR, name: PCWSTR) -> String {
    let mut buf = [0u16; 256]; let mut n = (buf.len() * 2) as u32;
    if unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key, name, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as _), Some(&mut n)) }.is_ok() { String::from_utf16_lossy(&buf[..(n as usize / 2).saturating_sub(1)]) } else { String::new() }
}
fn reg_dword(key: PCWSTR, name: PCWSTR) -> u32 { let mut v = 0u32; let mut n = 4u32; let _ = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key, name, RRF_RT_REG_DWORD, None, Some(&mut v as *mut _ as _), Some(&mut n)) }; v }
fn os() -> J {
    let k = w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let build: u32 = reg_str(k, w!("CurrentBuild")).parse().unwrap_or(0);
    json!({ "windows": if build >= 22000 { 11 } else { 10 }, "build": build, "ubr": reg_dword(k, w!("UBR")), "displayVersion": reg_str(k, w!("DisplayVersion")), "edition": reg_str(k, w!("EditionID")) })
}
fn monitors() -> (Vec<Mon>, J) {
    let mut out = Vec::new(); let mut adapters = Vec::new();
    let Ok(f) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else { return (out, json!([])) };
    let mut i = 0;
    while let Ok(a) = unsafe { f.EnumAdapters1(i) } {
        i += 1;
        let Ok(d) = (unsafe { a.GetDesc1() }) else { continue };
        let name = String::from_utf16_lossy(&d.Description).trim_end_matches('\0').to_string();
        let luid = (((d.AdapterLuid.HighPart as u32) as u64) << 32) | d.AdapterLuid.LowPart as u64;
        let mut outs = 0;
        let mut j = 0;
        while let Ok(o) = unsafe { a.EnumOutputs(j) } {
            j += 1; outs += 1;
            let Ok(od) = (unsafe { o.GetDesc() }) else { continue };
            let dev = String::from_utf16_lossy(&od.DeviceName).trim_end_matches('\0').to_string();
            let (hdr, bits) = o.cast::<IDXGIOutput6>().ok().and_then(|o6| unsafe { o6.GetDesc1() }.ok()).map(|d1| (d1.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020, d1.BitsPerColor)).unwrap_or((false, 8));
            let mut dm = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
            let devw: Vec<u16> = dev.encode_utf16().chain([0]).collect();
            let hz = if unsafe { EnumDisplaySettingsW(PCWSTR(devw.as_ptr()), ENUM_CURRENT_SETTINGS, &mut dm) }.as_bool() { dm.dmDisplayFrequency } else { 0 };
            let (mut dx, mut dy) = (0u32, 0u32); let _ = unsafe { GetDpiForMonitor(od.Monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) };
            out.push(Mon { hmon: od.Monitor, rect: od.DesktopCoordinates, rot: od.Rotation.0, dev, adapter: name.clone(), adapter_luid: luid, hz, dpi: dx, hdr, bits });
        }
        adapters.push(json!({ "name": name, "vramMB": d.DedicatedVideoMemory / (1 << 20), "software": d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0, "outputs": outs }));
    }
    (out, json!(adapters))
}
fn mon_json(m: &Mon, gpu_luid: u64) -> J {
    let r = m.rect;
    json!({ "dev": m.dev, "rect": [r.left, r.top, r.right, r.bottom], "size": format!("{}x{}", r.right - r.left, r.bottom - r.top), "hz": m.hz, "scale": format!("{}%", m.dpi * 100 / 96),
        "rotation": m.rot, "hdr": m.hdr, "bitsPerColor": m.bits, "adapter": m.adapter, "sameAdapterAsEncoder": m.adapter_luid == gpu_luid })
}

// ---------------------------------------------------------------------------------------------------------------- janelas de teste
// Janelas sem moldura (WS_POPUP) de cor sólida: o alvo (verde) e a que encobre (magenta). A cor fica em GWLP_USERDATA.
extern "system" fn wndproc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        if msg == WM_ERASEBKGND {
            let c = GetWindowLongPtrW(h, GWLP_USERDATA) as u32;
            let mut r = RECT::default(); let _ = GetClientRect(h, &mut r);
            let b = CreateSolidBrush(COLORREF(c)); FillRect(HDC(wp.0 as _), &r, b); let _ = DeleteObject(b.into());
            return LRESULT(1);
        }
        if msg == WM_PAINT { let mut ps = PAINTSTRUCT::default(); BeginPaint(h, &mut ps); let _ = EndPaint(h, &ps); return LRESULT(0); }
        DefWindowProcW(h, msg, wp, lp)
    }
}
fn rgb(r: u8, g: u8, b: u8) -> u32 { r as u32 | (g as u32) << 8 | (b as u32) << 16 }
const GREEN: u32 = 0x0000C800; const MAGENTA: u32 = 0x00FF00FF; const BLACK: u32 = 0;
struct TestWin(HWND);
impl TestWin {
    fn new(x: i32, y: i32, w: i32, h: i32, color: u32, top: bool) -> R<Self> { Self::new_ex(x, y, w, h, color, top, true) }
    /// tool = WS_EX_TOOLWINDOW (fora da barra de tarefas). O WGC do Windows 10 RECUSA capturar janela assim
    /// (CreateForWindow: E_INVALIDARG, visto na rodada 1); por isso a janela alvo e o "jogo" são janelas comuns.
    fn new_ex(x: i32, y: i32, w: i32, h: i32, color: u32, top: bool, tool: bool) -> R<Self> {
        unsafe {
            let inst = e(GetModuleHandleW(None), "GetModuleHandle")?;
            let cls = w!("LcPocWin");
            let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: inst.into(), lpszClassName: cls, hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(), ..Default::default() };
            RegisterClassW(&wc); // a 2ª vez falha (já registrada): tudo bem
            let ex = if tool { WS_EX_TOOLWINDOW } else { WINDOW_EX_STYLE(0) } | if top { WS_EX_TOPMOST } else { WINDOW_EX_STYLE(0) };
            let hw = e(CreateWindowExW(ex, cls, w!("Resenha PoC captura"), WS_POPUP, x, y, w, h, None, None, Some(inst.into()), None), "CreateWindowEx")?;
            SetWindowLongPtrW(hw, GWLP_USERDATA, color as isize);
            let _ = ShowWindow(hw, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(hw, Some(if top { HWND_TOPMOST } else { HWND_TOP }), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            let _ = UpdateWindow(hw);
            Ok(Self(hw))
        }
    }
    fn color(&self, c: u32) { unsafe { SetWindowLongPtrW(self.0, GWLP_USERDATA, c as isize); let _ = InvalidateRect(Some(self.0), None, true); let _ = UpdateWindow(self.0); } }
    fn place(&self, x: i32, y: i32, w: i32, h: i32) { unsafe { let _ = SetWindowPos(self.0, None, x, y, w, h, SWP_NOACTIVATE | SWP_NOZORDER); let _ = UpdateWindow(self.0); } }
    fn show(&self, cmd: SHOW_WINDOW_CMD) { unsafe { let _ = ShowWindow(self.0, cmd); } }
    /// retângulo visível de verdade em pixels físicos (o processo é "per-monitor v2")
    fn rect(&self) -> RECT { let mut r = RECT::default(); unsafe { let _ = DwmGetWindowAttribute(self.0, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as _, std::mem::size_of::<RECT>() as u32); } r }
}
impl Drop for TestWin { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
fn pump() { unsafe { let mut m = MSG::default(); while PeekMessageW(&mut m, None, 0, 0, PM_REMOVE).as_bool() { let _ = TranslateMessage(&m); DispatchMessageW(&m); } } }
fn wait_ms(ms: u64) { let t = Instant::now(); while t.elapsed() < Duration::from_millis(ms) { pump(); std::thread::sleep(Duration::from_millis(2)); } }
/// Uma janelinha que troca de cor a cada chamada: sem mudança na tela o DXGI não entrega quadro (e o WGC também não),
/// então para medir o ritmo máximo algo precisa se mexer — como num jogo.
struct Animator { w: TestWin, k: u32 }
impl Animator { fn tick(&mut self) { self.k = self.k.wrapping_add(1); let v = (self.k * 37 % 200) as u8 + 40; self.w.color(rgb(v, 40, 255 - v)); pump(); } }

// ---------------------------------------------------------------------------------------------------------------- fontes
/// Um quadro: textura no device do codificador + tamanho útil + onde fica o canto (0,0) dela na área de trabalho
pub struct Frame { pub tex: ID3D11Texture2D, pub w: u32, pub h: u32, pub origin: (i32, i32) }
pub enum SrcErr { Lost(String), Fatal(String) }
pub trait Source {
    fn name(&self) -> &'static str;
    /// quadro novo (None = nada mudou). O quadro anterior deixa de valer aqui.
    fn next(&mut self, g: &Gpu, clk: &mut GpuClock) -> Result<Option<Frame>, SrcErr>;
    fn recreate(&mut self, _g: &Gpu) -> R<()> { Err("sem recriacao".into()) }
    fn extra(&self) -> J { json!({}) }
}

/// WGC (monitor ou janela) no device do codificador: o mesmo que o win.rs faz
pub struct Wgc { item: GraphicsCaptureItem, pool: Direct3D11CaptureFramePool, session: GraphicsCaptureSession, size: SizeInt32, last: Option<Direct3D11CaptureFrame>, origin: Option<(i32, i32)>, window: bool, recreates: u32, border: String }
impl Wgc {
    fn open(g: &Gpu, item: GraphicsCaptureItem, origin: Option<(i32, i32)>, window: bool) -> R<Self> {
        let size = e(item.Size(), "Size")?;
        let pool = e(Direct3D11CaptureFramePool::CreateFreeThreaded(&g.d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size), "FramePool")?;
        let session = e(pool.CreateCaptureSession(&item), "CaptureSession")?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        let border = match session.SetIsBorderRequired(false) { Ok(_) => "sem borda".into(), Err(x) => format!("borda obrigatoria ({})", x.message()) };
        let _ = session.SetMinUpdateInterval(windows::Foundation::TimeSpan { Duration: 0 });
        e(session.StartCapture(), "StartCapture")?;
        Ok(Self { item, pool, session, size, last: None, origin, window, recreates: 0, border })
    }
    pub fn monitor(g: &Gpu, m: &Mon) -> R<Self> {
        let interop = e(factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>(), "interop")?;
        let item = e(unsafe { interop.CreateForMonitor(m.hmon) }, "CreateForMonitor")?;
        Self::open(g, item, Some((m.rect.left, m.rect.top)), false)
    }
    pub fn window(g: &Gpu, h: HWND) -> R<Self> {
        let interop = e(factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>(), "interop")?;
        let item = e(unsafe { interop.CreateForWindow(h) }, "CreateForWindow")?;
        Self::open(g, item, None, true)
    }
}
impl Drop for Wgc { fn drop(&mut self) { self.last = None; let _ = self.session.Close(); let _ = self.pool.Close(); } }
impl Source for Wgc {
    fn name(&self) -> &'static str { if self.window { "wgc_janela" } else { "wgc_monitor" } }
    fn next(&mut self, g: &Gpu, _: &mut GpuClock) -> Result<Option<Frame>, SrcErr> {
        let mut latest = None;
        while let Ok(f) = self.pool.TryGetNextFrame() { latest = Some(f); }
        let Some(f) = latest else { return Ok(None) };
        if let Ok(cs) = f.ContentSize() {
            if (cs.Width != self.size.Width || cs.Height != self.size.Height) && cs.Width > 0 && cs.Height > 0 {
                self.size = cs; self.recreates += 1;
                let _ = self.pool.Recreate(&g.d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, cs);
                return Ok(None);
            }
        }
        let tex = f.Surface().and_then(|s| s.cast::<IDirect3DDxgiInterfaceAccess>()).and_then(|a| unsafe { a.GetInterface::<ID3D11Texture2D>() }).map_err(|x| SrcErr::Fatal(format!("superficie WGC: {}", x.message())))?;
        self.last = Some(f);
        let _ = &self.item;
        Ok(Some(Frame { tex, w: self.size.Width as u32, h: self.size.Height as u32, origin: self.origin.unwrap_or((0, 0)) }))
    }
    fn extra(&self) -> J { json!({ "border": self.border, "poolRecreates": self.recreates }) }
}

/// DXGI Desktop Duplication direto no device do codificador (sem cópia entre devices)
pub struct DxgiOwn { invalid_call: u32, force_copy: bool, bind: u32, misc: u32, output: IDXGIOutput1, dup: Option<IDXGIOutputDuplication>, held: bool, origin: (i32, i32), api: &'static str, pub lost: u32, pub ptr_only: u64, pub accumulated: u64, copy: Option<ID3D11Texture2D>, direct_ok: Option<bool>, rot: i32, desc: String }
fn find_output(adapter: &IDXGIAdapter, hmon: HMONITOR) -> Option<IDXGIOutput1> {
    let mut j = 0;
    while let Ok(o) = unsafe { adapter.EnumOutputs(j) } { j += 1; if unsafe { o.GetDesc() }.map(|d| d.Monitor == hmon).unwrap_or(false) { return o.cast().ok(); } }
    None
}
impl DxgiOwn {
    pub fn open(g: &Gpu, m: &Mon, force_copy: bool) -> R<Self> {
        let output = find_output(&g.adapter, m.hmon).ok_or("o monitor nao esta ligado na placa do codificador (notebook hibrido?): DXGI precisaria de copia entre placas")?;
        let mut s = Self { invalid_call: 0, force_copy, bind: 0, misc: 0, output, dup: None, held: false, origin: (m.rect.left, m.rect.top), api: "", lost: 0, ptr_only: 0, accumulated: 0, copy: None, direct_ok: None, rot: m.rot, desc: String::new() };
        s.dup(g)?; Ok(s)
    }
    fn dup(&mut self, g: &Gpu) -> R<()> {
        self.dup = None; self.held = false;
        // DuplicateOutput1 (Windows 10 1703+) aceita escolher o formato; sem ele, DuplicateOutput (sempre BGRA 8 bits)
        let d = match self.output.cast::<IDXGIOutput5>() {
            Ok(o5) => { self.api = "DuplicateOutput1"; unsafe { o5.DuplicateOutput1(&g.device, 0, &[DXGI_FORMAT_B8G8R8A8_UNORM]) } }
            Err(_) => { self.api = "DuplicateOutput"; unsafe { self.output.DuplicateOutput(&g.device) } }
        };
        let d = e(d, self.api)?;
        let dd = unsafe { d.GetDesc() };
        self.desc = format!("{}x{} fmt {} rot {} imagem na {}", dd.ModeDesc.Width, dd.ModeDesc.Height, dd.ModeDesc.Format.0, dd.Rotation.0, if dd.DesktopImageInSystemMemory.as_bool() { "memoria do sistema (lento)" } else { "GPU" });
        self.dup = Some(d); Ok(())
    }
}
impl Drop for DxgiOwn { fn drop(&mut self) { if self.held { if let Some(d) = &self.dup { unsafe { let _ = d.ReleaseFrame(); } } } } }
impl Source for DxgiOwn {
    fn name(&self) -> &'static str { if self.force_copy { "dxgi_proprio_copia" } else { "dxgi_proprio" } }
    fn next(&mut self, g: &Gpu, clk: &mut GpuClock) -> Result<Option<Frame>, SrcErr> {
        let Some(d) = self.dup.clone() else { return Err(SrcErr::Lost("sem duplicacao".into())) };
        // o quadro anterior fica preso até aqui (a GPU já recebeu o pedido de conversão dele): solta antes de pegar o próximo
        if self.held { unsafe { let _ = d.ReleaseFrame(); } self.held = false; }
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default(); let mut res: Option<IDXGIResource> = None;
        match unsafe { d.AcquireNextFrame(0, &mut info, &mut res) } {
            Ok(()) => {}
            Err(x) if x.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
            Err(x) if x.code() == DXGI_ERROR_ACCESS_LOST => { self.lost += 1; self.dup = None; return Err(SrcErr::Lost("DXGI_ERROR_ACCESS_LOST".into())); }
            // Windows 10, rodada 2: ao SAIR da tela cheia exclusiva veio DXGI_ERROR_INVALID_CALL em vez de ACCESS_LOST e a
            // PoC desistiu da fonte. A duplicação ficou inválida do mesmo jeito: recria.
            Err(x) if x.code() == DXGI_ERROR_INVALID_CALL => { self.lost += 1; self.invalid_call += 1; self.dup = None; return Err(SrcErr::Lost("DXGI_ERROR_INVALID_CALL".into())); }
            Err(x) => return Err(SrcErr::Fatal(format!("AcquireNextFrame: {} (0x{:08X})", x.message(), x.code().0 as u32))),
        }
        self.held = true;
        self.accumulated += info.AccumulatedFrames as u64;
        if info.LastPresentTime == 0 { self.ptr_only += 1; return Ok(None); } // só o ponteiro do mouse mexeu
        let tex: ID3D11Texture2D = res.ok_or(SrcErr::Fatal("quadro vazio".into()))?.cast().map_err(|x| SrcErr::Fatal(x.message()))?;
        let mut td = D3D11_TEXTURE2D_DESC::default(); unsafe { tex.GetDesc(&mut td) };
        // a textura do DXGI serve direto de entrada para o VideoProcessor? (descobre na 1ª vez; se não, copia no mesmo device)
        if self.direct_ok.is_none() {
            self.bind = td.BindFlags; self.misc = td.MiscFlags;
            let ok = td.BindFlags & (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32 != 0;
            self.direct_ok = Some(ok && !self.force_copy);
        }
        if self.direct_ok == Some(false) {
            if self.copy.as_ref().map(|c| { let mut cd = D3D11_TEXTURE2D_DESC::default(); unsafe { c.GetDesc(&mut cd) }; cd.Width != td.Width || cd.Height != td.Height }).unwrap_or(true) {
                let cd = D3D11_TEXTURE2D_DESC { Width: td.Width, Height: td.Height, MipLevels: 1, ArraySize: 1, Format: td.Format, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT, BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32, CPUAccessFlags: 0, MiscFlags: 0 };
                let mut t = None; unsafe { g.device.CreateTexture2D(&cd, None, Some(&mut t)) }.map_err(|x| SrcErr::Fatal(x.message()))?; self.copy = t;
            }
            let c = self.copy.clone().unwrap();
            let k = clk.begin(&g.ctx, T_COPY); unsafe { g.ctx.CopyResource(&c, &tex) }; clk.end(&g.ctx, k);
            return Ok(Some(Frame { tex: c, w: td.Width, h: td.Height, origin: self.origin }));
        }
        Ok(Some(Frame { tex, w: td.Width, h: td.Height, origin: self.origin }))
    }
    fn recreate(&mut self, g: &Gpu) -> R<()> { self.dup(g) }
    fn extra(&self) -> J { json!({ "invalidCall": self.invalid_call, "api": self.api, "desc": self.desc, "directInput": self.direct_ok, "bindFlags": format!("0x{:X}", self.bind), "miscFlags": format!("0x{:X}", self.misc), "accessLost": self.lost, "pointerOnlyFrames": self.ptr_only, "accumulatedFrames": self.accumulated, "rotation": self.rot }) }
}

/// DXGI pela windows-capture: ela cria o PRÓPRIO device; o quadro passa para o nosso por uma textura compartilhada
/// (NT handle + keyed mutex). Mede o custo dessa cópia.
pub struct DxgiWcap {
    api: Option<windows_capture::dxgi_duplication_api::DxgiDuplicationApi>, origin: (i32, i32), mon: windows_capture::monitor::Monitor,
    theirs: Option<(ID3D11Texture2D, IDXGIKeyedMutex)>, ours: Option<(ID3D11Texture2D, IDXGIKeyedMutex)>, our_holds: bool, size: (u32, u32),
    their_clk: Option<GpuClock>, pub handoff_ms: Vec<f64>, pub their_copy_ms: Vec<f64>, lost: u32, device_video: J,
}
impl DxgiWcap {
    pub fn open(m: &Mon) -> R<Self> {
        use windows_capture::dxgi_duplication_api::{DxgiDuplicationApi, DxgiDuplicationFormat};
        let mon = windows_capture::monitor::Monitor::from_raw_hmonitor(m.hmon.0);
        let api = DxgiDuplicationApi::new_options(mon, &[DxgiDuplicationFormat::Bgra8]).map_err(|x| format!("windows-capture: {x}"))?;
        // o device dela serve para o VideoProcessor/codificador? (criado sem D3D11_CREATE_DEVICE_VIDEO_SUPPORT)
        let device_video = match api.device().cast::<ID3D11VideoDevice>() {
            Err(x) => json!({ "videoDevice": false, "error": x.message() }),
            Ok(vd) => {
                let cd = D3D11_VIDEO_PROCESSOR_CONTENT_DESC { InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, InputFrameRate: DXGI_RATIONAL { Numerator: 60, Denominator: 1 }, InputWidth: 1920, InputHeight: 1080, OutputFrameRate: DXGI_RATIONAL { Numerator: 60, Denominator: 1 }, OutputWidth: 1920, OutputHeight: 1080, Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED };
                match unsafe { vd.CreateVideoProcessorEnumerator(&cd) } { Ok(_) => json!({ "videoDevice": true, "videoProcessor": true }), Err(x) => json!({ "videoDevice": true, "videoProcessor": false, "error": x.message() }) }
            }
        };
        let their_clk = GpuClock::new(api.device()).ok();
        Ok(Self { api: Some(api), origin: (m.rect.left, m.rect.top), mon, theirs: None, ours: None, our_holds: false, size: (0, 0), their_clk, handoff_ms: vec![], their_copy_ms: vec![], lost: 0, device_video })
    }
    fn share(&mut self, g: &Gpu, td: &D3D11_TEXTURE2D_DESC) -> Result<(), SrcErr> {
        let api = self.api.as_ref().unwrap();
        let f = |x: windows::core::Error| SrcErr::Fatal(format!("compartilhar: {} (0x{:08X})", x.message(), x.code().0 as u32));
        let sd = D3D11_TEXTURE2D_DESC { Width: td.Width, Height: td.Height, MipLevels: 1, ArraySize: 1, Format: td.Format, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32, CPUAccessFlags: 0, MiscFlags: (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX.0) as u32 };
        let mut t = None; unsafe { api.device().CreateTexture2D(&sd, None, Some(&mut t)) }.map_err(f)?; let t = t.unwrap();
        let h = unsafe { t.cast::<IDXGIResource1>().map_err(f)?.CreateSharedHandle(None, (DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE).0, PCWSTR::null()) }.map_err(f)?;
        let o: ID3D11Texture2D = unsafe { g.device.cast::<ID3D11Device1>().map_err(f)?.OpenSharedResource1(h) }.map_err(f)?;
        unsafe { let _ = CloseHandle(h); }
        self.theirs = Some((t.clone(), t.cast().map_err(f)?)); self.ours = Some((o.clone(), o.cast().map_err(f)?)); self.our_holds = false; self.size = (td.Width, td.Height);
        Ok(())
    }
}
impl Drop for DxgiWcap { fn drop(&mut self) { if self.our_holds { if let Some((_, k)) = &self.ours { unsafe { let _ = k.ReleaseSync(0); } } } } }
impl Source for DxgiWcap {
    fn name(&self) -> &'static str { "dxgi_windows_capture" }
    fn next(&mut self, g: &Gpu, _clk: &mut GpuClock) -> Result<Option<Frame>, SrcErr> {
        use windows_capture::dxgi_duplication_api::Error as WE;
        // devolve a textura compartilhada para o lado de lá (chave 0) antes de pegar o próximo quadro
        if self.our_holds { if let Some((_, k)) = &self.ours { unsafe { let _ = k.ReleaseSync(0); } } self.our_holds = false; }
        let Some(api) = self.api.as_mut() else { return Err(SrcErr::Lost("sem duplicacao".into())) };
        let (tex, td, info) = match api.acquire_next_frame(0) {
            Ok(fr) => (fr.texture().clone(), *fr.texture_desc(), *fr.frame_info()),
            Err(WE::Timeout) => return Ok(None),
            Err(WE::AccessLost) => { self.lost += 1; return Err(SrcErr::Lost("AccessLost".into())); }
            Err(x) => return Err(SrcErr::Fatal(format!("windows-capture: {x}"))),
        };
        if info.LastPresentTime == 0 { return Ok(None); }
        if self.size != (td.Width, td.Height) || self.theirs.is_none() { self.share(g, &td)?; }
        let t0 = Instant::now();
        let api = self.api.as_ref().unwrap(); let tctx = api.device_context().clone();
        let (tt, tk) = self.theirs.clone().unwrap(); let (ot, ok) = self.ours.clone().unwrap();
        unsafe {
            tk.AcquireSync(0, 100).map_err(|x| SrcErr::Fatal(format!("AcquireSync deles: {}", x.message())))?;
            let k = self.their_clk.as_mut().and_then(|c| c.begin(&tctx, T_COPY_THEIRS));
            tctx.CopyResource(&tt, &tex);
            if let Some(c) = self.their_clk.as_mut() { c.end(&tctx, k); }
            tk.ReleaseSync(1).map_err(|x| SrcErr::Fatal(format!("ReleaseSync deles: {}", x.message())))?;
            ok.AcquireSync(1, 100).map_err(|x| SrcErr::Fatal(format!("AcquireSync nosso: {}", x.message())))?;
        }
        self.our_holds = true;
        self.handoff_ms.push(t0.elapsed().as_secs_f64() * 1000.0);
        if let Some(c) = self.their_clk.as_mut() { c.poll(&tctx); self.their_copy_ms.extend(c.take(T_COPY_THEIRS)); }
        let _ = &self.mon;
        Ok(Some(Frame { tex: ot, w: td.Width, h: td.Height, origin: self.origin }))
    }
    fn recreate(&mut self, _g: &Gpu) -> R<()> {
        if self.our_holds { if let Some((_, k)) = &self.ours { unsafe { let _ = k.ReleaseSync(0); } } self.our_holds = false; }
        let a = self.api.take().ok_or("sem api")?;
        self.api = Some(a.recreate().map_err(|x| format!("windows-capture recreate: {x}"))?);
        Ok(())
    }
    fn extra(&self) -> J { json!({ "libDevice": self.device_video, "handoffCpuMs": stats(&self.handoff_ms), "copyGpuMsLibDevice": stats(&self.their_copy_ms), "accessLost": self.lost }) }
}

// ---------------------------------------------------------------------------------------------------------------- sonda (cor / tela preta)
/// Reduz o recorte para 64x36 BGRA na GPU e lê na CPU: diz a cor dominante (testes de recorte) e se está preto.
struct Probe { venum: ID3D11VideoProcessorEnumerator, vproc: ID3D11VideoProcessor, rt: ID3D11Texture2D, ov: ID3D11VideoProcessorOutputView, st: ID3D11Texture2D }
const PW: u32 = 64; const PH: u32 = 36;
#[derive(Default, Debug, Clone, Copy)]
struct Colors { green: f64, magenta: f64, black: f64, other: f64, luma: f64 }
impl Colors { fn j(&self) -> J { json!({ "verde": r2(self.green * 100.0), "magenta": r2(self.magenta * 100.0), "preto": r2(self.black * 100.0), "outro": r2(self.other * 100.0), "luma": r2(self.luma) }) } }
impl Probe {
    fn new(g: &Gpu, mw: u32, mh: u32) -> R<Self> {
        let rate = DXGI_RATIONAL { Numerator: 60, Denominator: 1 };
        let cd = D3D11_VIDEO_PROCESSOR_CONTENT_DESC { InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, InputFrameRate: rate, InputWidth: mw.max(3840), InputHeight: mh.max(2160), OutputFrameRate: rate, OutputWidth: PW, OutputHeight: PH, Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED };
        let venum = e(unsafe { g.vdev.CreateVideoProcessorEnumerator(&cd) }, "sonda enum")?;
        let vproc = e(unsafe { g.vdev.CreateVideoProcessor(&venum, 0) }, "sonda vproc")?;
        let td = D3D11_TEXTURE2D_DESC { Width: PW, Height: PH, MipLevels: 1, ArraySize: 1, Format: DXGI_FORMAT_B8G8R8A8_UNORM, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT, BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32, CPUAccessFlags: 0, MiscFlags: 0 };
        let mut rt = None; e(unsafe { g.device.CreateTexture2D(&td, None, Some(&mut rt)) }, "sonda rt")?; let rt = rt.unwrap();
        let sd = D3D11_TEXTURE2D_DESC { Usage: D3D11_USAGE_STAGING, BindFlags: 0, CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32, ..td };
        let mut st = None; e(unsafe { g.device.CreateTexture2D(&sd, None, Some(&mut st)) }, "sonda staging")?;
        let od = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC { ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } } };
        let mut ov = None; e(unsafe { g.vdev.CreateVideoProcessorOutputView(&rt, &venum, &od, Some(&mut ov)) }, "sonda ov")?;
        unsafe {
            g.vctx.VideoProcessorSetStreamColorSpace(&vproc, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
            g.vctx.VideoProcessorSetOutputColorSpace(&vproc, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
            g.vctx.VideoProcessorSetStreamFrameFormat(&vproc, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
            g.vctx.VideoProcessorSetOutputTargetRect(&vproc, true, Some(&RECT { left: 0, top: 0, right: PW as i32, bottom: PH as i32 }));
            g.vctx.VideoProcessorSetStreamDestRect(&vproc, 0, true, Some(&RECT { left: 0, top: 0, right: PW as i32, bottom: PH as i32 }));
            g.vctx.VideoProcessorSetStreamAutoProcessingMode(&vproc, 0, false);
        }
        Ok(Self { venum, vproc, rt, ov: ov.unwrap(), st: st.unwrap() })
    }
    /// bloqueia até a GPU terminar (só nos testes; na transmissão seria em rodízio, lido 2 quadros depois)
    fn read(&self, g: &Gpu, tex: &ID3D11Texture2D, crop: RECT) -> R<Colors> {
        let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC { FourCC: 0, ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } } };
        let mut iv = None; e(unsafe { g.vdev.CreateVideoProcessorInputView(tex, &self.venum, &ivd, Some(&mut iv)) }, "sonda iv")?;
        unsafe { g.vctx.VideoProcessorSetStreamSourceRect(&self.vproc, 0, true, Some(&crop)); }
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(iv), ..Default::default() };
        let r = unsafe { g.vctx.VideoProcessorBlt(&self.vproc, &self.ov, 0, std::slice::from_ref(&stream)) };
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface); }
        e(r, "sonda Blt")?;
        unsafe { g.ctx.CopyResource(&self.st, &self.rt); }
        let mut m = D3D11_MAPPED_SUBRESOURCE::default();
        e(unsafe { g.ctx.Map(&self.st, 0, D3D11_MAP_READ, 0, Some(&mut m)) }, "sonda Map")?;
        let mut c = Colors::default(); let n = (PW * PH) as f64;
        for y in 0..PH { let row = unsafe { std::slice::from_raw_parts((m.pData as *const u8).add((y * m.RowPitch) as usize), (PW * 4) as usize) };
            for x in 0..PW as usize { let (b, gg, r) = (row[x * 4] as f64, row[x * 4 + 1] as f64, row[x * 4 + 2] as f64);
                c.luma += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
                if gg > 140.0 && r < 90.0 && b < 90.0 { c.green += 1.0 } else if r > 170.0 && b > 170.0 && gg < 90.0 { c.magenta += 1.0 } else if r < 16.0 && gg < 16.0 && b < 16.0 { c.black += 1.0 } else { c.other += 1.0 } } }
        unsafe { g.ctx.Unmap(&self.st, 0); }
        c.green /= n; c.magenta /= n; c.black /= n; c.other /= n; c.luma /= n;
        Ok(c)
    }
}

// ---------------------------------------------------------------------------------------------------------------- recorte
/// Recorte de uma janela dentro de um quadro de monitor: posição na área de trabalho -> coordenadas da textura.
/// Devolve None se a janela não aparece nesse monitor. Considera monitor com origem negativa e janela parcialmente fora.
pub fn crop_for(win: RECT, f: &Frame) -> Option<RECT> {
    let (ox, oy) = f.origin;
    let l = (win.left - ox).max(0); let t = (win.top - oy).max(0);
    let r = (win.right - ox).min(f.w as i32); let b = (win.bottom - oy).min(f.h as i32);
    if r - l < 2 || b - t < 2 { return None; }
    Some(RECT { left: l, top: t, right: r, bottom: b })
}

// ---------------------------------------------------------------------------------------------------------------- pipeline
/// Contadores de um trecho (por segundo) e do codificador
#[derive(Default)]
struct Run { start: Option<Instant>, cap: Vec<u32>, fed: Vec<u32>, out: Vec<u32>, cur: (u32, u32, u32), sec: u64, blt_ms: Vec<f64>, copy_ms: Vec<f64>, next_ms: Vec<f64>, first_frame_ms: Option<f64>, errors: Vec<String>, lost_recreate_ms: Vec<f64>, last_feed: Option<Instant>, max_gap_ms: f64 }
impl Run {
    fn tick(&mut self) { let t0 = *self.start.get_or_insert_with(Instant::now); let s = t0.elapsed().as_secs(); while self.sec < s { self.sec += 1; self.cap.push(self.cur.0); self.fed.push(self.cur.1); self.out.push(self.cur.2); self.cur = (0, 0, 0); } }
    fn j(&self, src: &dyn Source) -> J {
        let skip = |v: &Vec<u32>| v.iter().skip(1).cloned().collect::<Vec<_>>();
        json!({ "source": src.name(), "capFps": r2(mean_u(&skip(&self.cap))), "fedFps": r2(mean_u(&skip(&self.fed))), "encodedFps": r2(mean_u(&skip(&self.out))), "capSeries": self.cap, "fedSeries": self.fed,
            "bltGpuMs": stats(&self.blt_ms), "copyGpuMs": stats(&self.copy_ms), "nextCpuMs": stats(&self.next_ms), "firstFrameMs": self.first_frame_ms.map(r2), "maxFeedGapMs": r2(self.max_gap_ms),
            "lostRecreateMs": stats(&self.lost_recreate_ms), "errors": self.errors.iter().take(5).collect::<Vec<_>>(), "extra": src.extra() })
    }
}
/// Estado do codificador ao longo de todo o teste (o MESMO entre trocas de fonte)
#[derive(Default)]
struct Enc { outputs: u64, idr: u64, last_ts: i64, non_monotonic: u64, idr_after_key: Vec<u32>, waiting_key: Option<u32>, errors: Vec<String> }
fn is_idr(b: &[u8]) -> bool { let mut i = 0; while i + 4 < b.len() { if b[i] == 0 && b[i + 1] == 0 && (b[i + 2] == 1 || (b[i + 2] == 0 && b[i + 3] == 1)) { let k = if b[i + 2] == 1 { i + 3 } else { i + 4 }; if k < b.len() && b[k] & 0x1F == 5 { return true; } i = k; } else { i += 1; } } false }
fn drain(l: &mut WinLayer, enc: &mut Enc, run: &mut Run) {
    loop {
        let ev = match unsafe { l.enc.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } { Ok(ev) => ev, Err(_) => break };
        let typ = unsafe { ev.GetType() }.unwrap_or(0);
        if typ == METransformNeedInput.0 as u32 { l.need += 1; }
        else if typ == METransformHaveOutput.0 as u32 {
            match l.enc.take_output() {
                Ok(Some((data, t))) => {
                    enc.outputs += 1; run.cur.2 += 1; l.inflight.remove(&t);
                    if t <= enc.last_ts && enc.last_ts != 0 { enc.non_monotonic += 1; } enc.last_ts = t;
                    if let Some(n) = enc.waiting_key.as_mut() { *n += 1; }
                    if is_idr(&data) { enc.idr += 1; if let Some(n) = enc.waiting_key.take() { enc.idr_after_key.push(n); } }
                }
                Ok(None) => {}
                Err(x) => { if enc.errors.len() < 5 { enc.errors.push(x); } }
            }
        } else if typ == MEError.0 as u32 { if enc.errors.len() < 5 { enc.errors.push(format!("MEError 0x{:08X}", unsafe { ev.GetStatus() }.map(|h| h.0 as u32).unwrap_or(0))); } }
    }
}
/// Converte (com recorte) e entrega ao codificador — igual ao laço do win.rs, com a área de origem escolhida
fn feed(g: &Gpu, l: &mut WinLayer, clk: &mut GpuClock, f: &Frame, src_rect: RECT, st: i64) -> R<()> {
    let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC { FourCC: 0, ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } } };
    let cur = l.slot % NV12_RING; l.slot += 1;
    let mut iv = None; e(unsafe { g.vdev.CreateVideoProcessorInputView(&f.tex, &l.venum, &ivd, Some(&mut iv)) }, "InputView")?;
    let (w, h) = ((src_rect.right - src_rect.left) as u32, (src_rect.bottom - src_rect.top) as u32);
    unsafe {
        g.vctx.VideoProcessorSetStreamSourceRect(&l.vproc, 0, true, Some(&src_rect));
        g.vctx.VideoProcessorSetStreamDestRect(&l.vproc, 0, true, Some(&fit(w, h, l.ow, l.oh)));
    }
    let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(iv), ..Default::default() };
    let k = clk.begin(&g.ctx, T_BLT);
    let r = unsafe { g.vctx.VideoProcessorBlt(&l.vproc, &l.ring[cur].1, 0, std::slice::from_ref(&stream)) };
    clk.end(&g.ctx, k);
    unsafe { ManuallyDrop::drop(&mut stream.pInputSurface); }
    e(r, "VideoProcessorBlt")?;
    e(l.feed(cur, st), "ProcessInput")?;
    l.need -= 1; l.last_slot = Some(cur); l.last_st = st;
    Ok(())
}
/// Roda uma fonte por `secs` alimentando o codificador. crop(f) = área do quadro a transmitir (None = quadro inteiro).
/// `t0` é o relógio da transmissão: o mesmo em todas as fontes (timestamps contínuos nas trocas).
fn pump_source(g: &Gpu, l: &mut WinLayer, enc: &mut Enc, clk: &mut GpuClock, src: &mut dyn Source, secs: f64, t0: Instant, anim: &mut Option<&mut Animator>, crop: &dyn Fn(&Frame) -> Option<RECT>, run: &mut Run) {
    let start = Instant::now();
    while start.elapsed().as_secs_f64() < secs {
        if let Some(a) = anim.as_mut() { a.tick(); } else { pump(); }
        drain(l, enc, run);
        run.tick();
        let tn = Instant::now();
        let fr = match src.next(g, clk) {
            Ok(x) => x,
            Err(SrcErr::Lost(why)) => { // DXGI perdeu o acesso (resolução, UAC, Ctrl+Alt+Del, jogo exclusivo): recria
                let tr = Instant::now(); let mut ok = false;
                for _ in 0..50 { pump(); if src.recreate(g).is_ok() { ok = true; break; } std::thread::sleep(Duration::from_millis(20)); }
                if ok { run.lost_recreate_ms.push(tr.elapsed().as_secs_f64() * 1000.0); } else if run.errors.len() < 20 { run.errors.push(format!("perdido ({why}) e nao recriou")); }
                continue;
            }
            Err(SrcErr::Fatal(x)) => { if run.errors.len() < 20 { run.errors.push(x); } std::thread::sleep(Duration::from_millis(5)); continue; }
        };
        clk.poll(&g.ctx); run.blt_ms.extend(clk.take(T_BLT)); run.copy_ms.extend(clk.take(T_COPY));
        let Some(f) = fr else { std::thread::sleep(Duration::from_millis(1)); continue };
        run.next_ms.push(tn.elapsed().as_secs_f64() * 1000.0);
        run.cur.0 += 1;
        if run.first_frame_ms.is_none() { run.first_frame_ms = Some(start.elapsed().as_secs_f64() * 1000.0); }
        let now = t0.elapsed().as_secs_f64();
        let iv = 1.0 / l.fps as f64;
        if now + iv * 0.3 < l.next_due { continue; }
        l.next_due = if l.next_due < now - iv { now + iv } else { l.next_due + iv };
        if l.need == 0 { continue; }
        let Some(rect) = crop(&f) else { continue };
        match feed(g, l, clk, &f, rect, (now * 1e7) as i64) {
            Ok(()) => { run.cur.1 += 1; let t = Instant::now(); if let Some(p) = run.last_feed { run.max_gap_ms = run.max_gap_ms.max((t - p).as_secs_f64() * 1000.0); } run.last_feed = Some(t); }
            Err(x) => if run.errors.len() < 20 { run.errors.push(x) },
        }
    }
    clk.poll(&g.ctx); run.blt_ms.extend(clk.take(T_BLT)); run.copy_ms.extend(clk.take(T_COPY));
}
fn full(f: &Frame) -> Option<RECT> { Some(RECT { left: 0, top: 0, right: f.w as i32, bottom: f.h as i32 }) }

// ---------------------------------------------------------------------------------------------------------------- testes
fn pick_monitor(mons: &[Mon]) -> Option<Mon> {
    let want = arg("--monitor", "");
    if let Some((x, y)) = want.split_once(',').and_then(|(a, b)| Some((a.trim().parse::<i32>().ok()?, b.trim().parse::<i32>().ok()?))) {
        if let Some(m) = mons.iter().find(|m| x >= m.rect.left && x < m.rect.right && y >= m.rect.top && y < m.rect.bottom) { return Some(m.clone()); }
    }
    mons.iter().find(|m| m.rect.left == 0 && m.rect.top == 0).or(mons.first()).cloned()
}
fn open_src(kind: &str, g: &Gpu, m: &Mon, win: Option<HWND>) -> R<Box<dyn Source>> {
    Ok(match kind {
        "wgc_monitor" => Box::new(Wgc::monitor(g, m)?),
        "wgc_janela" => Box::new(Wgc::window(g, win.ok_or("sem janela")?)?),
        "dxgi_proprio" => Box::new(DxgiOwn::open(g, m, false)?),
        "dxgi_proprio_copia" => Box::new(DxgiOwn::open(g, m, true)?),
        "dxgi_windows_capture" => Box::new(DxgiWcap::open(m)?),
        _ => return Err("fonte desconhecida".into()),
    })
}

pub fn main_poc() {
    unsafe { let _ = RoInitialize(RO_INIT_MULTITHREADED); let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL); }
    // pixels físicos em tudo (DXGI, DWM, posição das janelas), como o app já manda as coordenadas
    let dpi = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }.is_ok();
    let manual: u64 = arg("--manual", "0").parse().unwrap_or(0);
    if flag("--jogo-teste") { return run_test_game(); }
    let fs = flag("--tela-cheia");
    let res = if fs { run_fullscreen(dpi) } else if manual > 0 { run_manual(manual, dpi) } else { run_auto(dpi) };
    let name = if fs { "poc-captura-tela-cheia.json" } else if manual > 0 { "poc-captura-manual.json" } else if flag("--so-recorte") { "poc-captura-recorte.json" } else { "poc-captura-resultado.json" };
    let (file, v) = match res { Ok(v) => (name, v), Err(x) => ("poc-captura-erro.json", json!({ "error": x })) };
    let text = serde_json::to_string_pretty(&v).unwrap_or_default();
    let _ = std::fs::write(file, &text);
    println!("{text}");
    say(&format!("\n  resultado salvo em {file}"));
}

fn env_json(g: &Gpu, mons: &[Mon], adapters: J, dpi: bool) -> J {
    let prop = |p: &str| ApiInformation::IsPropertyPresent(&HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureSession"), &HSTRING::from(p)).unwrap_or(false);
    json!({ "os": os(), "dpiAwarePerMonitorV2": dpi, "encoderGpu": g.name, "adapters": adapters, "hybridGpu": mons.iter().any(|m| m.adapter_luid != g.luid),
        "monitors": mons.iter().map(|m| mon_json(m, g.luid)).collect::<Vec<_>>(),
        "wgc": { "supported": GraphicsCaptureSession::IsSupported().unwrap_or(false), "IsBorderRequired": prop("IsBorderRequired"), "MinUpdateInterval": prop("MinUpdateInterval"), "IsCursorCaptureEnabled": prop("IsCursorCaptureEnabled") } })
}

fn run_auto(dpi: bool) -> R<J> {
    let secs: f64 = arg("--secs", "6").parse().unwrap_or(6.0);
    let fps: u32 = arg("--fps", "120").parse().unwrap_or(120);
    let height: u32 = arg("--height", "1080").parse().unwrap_or(1080);
    let g = gpu()?;
    let (mons, adapters) = monitors();
    let m = pick_monitor(&mons).ok_or("nenhum monitor encontrado")?;
    let mut out = json!({ "env": env_json(&g, &mons, adapters, dpi), "monitor": mon_json(&m, g.luid), "config": { "fps": fps, "height": height, "secs": secs } });
    let (mw, mh) = ((m.rect.right - m.rect.left) as u32, (m.rect.bottom - m.rect.top) as u32);
    say(&format!("  placa: {}  monitor: {} {}x{} @{} Hz  Windows build {}", g.name, m.dev, mw, mh, m.hz, out["env"]["os"]["build"]));

    // codificador real (o mesmo make_layer da transmissão), dimensionado pelo monitor
    let mut layer = make_layer(&g.device, &g.vdev, &g.vctx, g.luid, mw, mh, &Layer { ssrc: 1, height, fps, kbps: 12000 }, false)?;
    out["encoder"] = json!({ "name": layer.enc.name, "out": format!("{}x{}@{}", layer.ow, layer.oh, layer.fps) });
    let mut clk = GpuClock::new(&g.device)?;
    let t0 = Instant::now(); // relógio da "transmissão": um só para todos os testes, como o Meter do win.rs
    let mut anim = Animator { w: TestWin::new(m.rect.left + 8, m.rect.bottom - 120, 160, 90, 0, true)?, k: 0 };
    wait_ms(300);

    if !flag("--so-recorte") {
    // 1) cada método sozinho, quadro inteiro do monitor -> codificador
    let mut methods = serde_json::Map::new();
    for kind in ["wgc_monitor", "dxgi_proprio", "dxgi_proprio_copia", "dxgi_windows_capture"] {
        say(&format!("  [1] {kind}: {secs} s"));
        let mut enc = Enc::default(); let mut run = Run::default();
        match open_src(kind, &g, &m, None) {
            Ok(mut s) => { pump_source(&g, &mut layer, &mut enc, &mut clk, s.as_mut(), secs, t0, &mut Some(&mut anim), &full, &mut run);
                let mut j = run.j(s.as_ref()); j["encoderErrors"] = json!(enc.errors); j["encodedTotal"] = json!(enc.outputs); methods.insert(kind.into(), j); }
            Err(x) => { methods.insert(kind.into(), json!({ "openError": x })); }
        }
        wait_ms(300);
    }
    out["methods"] = Value::Object(methods);

    // 2) troca ao vivo com o MESMO codificador e o mesmo relógio: frio (fecha a velha, abre a nova) e quente (abre a nova antes)
    let mut sw = Vec::new();
    for warm in [false, true] {
        let seq = ["wgc_monitor", "dxgi_proprio", "wgc_monitor", "dxgi_proprio", "wgc_monitor"];
        say(&format!("  [2] troca ao vivo ({}): {}", if warm { "quente" } else { "fria" }, seq.join(" -> ")));
        let mut enc = Enc::default();
        let mut cur: Option<Box<dyn Source>> = None; let mut parts = Vec::new(); let mut last_feed: Option<Instant> = None;
        for (i, kind) in seq.iter().enumerate() {
            let ts = Instant::now();
            if !warm { cur = None; } // fria: fecha a velha antes de abrir a nova (o codificador fica sem quadro nesse meio)
            let mut s = match open_src(kind, &g, &m, None) { Ok(s) => s, Err(x) => { parts.push(json!({ "source": kind, "openError": x, "warmBothOpen": warm && cur.is_some() })); continue; } };
            let open_ms = ts.elapsed().as_secs_f64() * 1000.0;
            // quente: a velha segue alimentando o codificador até a nova entregar o 1º quadro (no máximo 1 s).
            // Esse 1º quadro da nova é descartado (só confirma que ela está viva). No Windows 10 a borda do WGC pode piscar aqui.
            let mut bridge_ms = None;
            if let Some(old) = cur.as_mut() {
                let tw = Instant::now(); let mut bridge = Run { last_feed, ..Default::default() };
                loop {
                    pump_source(&g, &mut layer, &mut enc, &mut clk, old.as_mut(), 0.004, t0, &mut Some(&mut anim), &full, &mut bridge);
                    if matches!(s.next(&g, &mut clk), Ok(Some(_))) || tw.elapsed() > Duration::from_secs(1) { break; }
                }
                last_feed = bridge.last_feed; bridge_ms = Some(tw.elapsed().as_secs_f64() * 1000.0);
            }
            drop(cur.take());
            if i > 0 { layer.enc.force_key(); enc.waiting_key = Some(0); }
            let mut run = Run { last_feed, ..Default::default() };
            pump_source(&g, &mut layer, &mut enc, &mut clk, s.as_mut(), 3.0, t0, &mut Some(&mut anim), &full, &mut run);
            last_feed = run.last_feed;
            let switch_ms = run.first_frame_ms.map(|x| x + open_ms);
            let mut j = run.j(s.as_ref()); j["openMs"] = json!(r2(open_ms)); j["switchToFirstFrameMs"] = json!(switch_ms.map(r2)); j["warmBridgeMs"] = json!(bridge_ms.map(r2));
            parts.push(j); cur = Some(s);
        }
        drop(cur);
        sw.push(json!({ "mode": if warm { "quente" } else { "fria" }, "parts": parts, "encoded": enc.outputs, "idr": enc.idr, "framesUntilIdrAfterSwitch": enc.idr_after_key, "nonMonotonicTimestamps": enc.non_monotonic, "encoderErrors": enc.errors, "encoderRecreated": false }));
        wait_ms(300);
    }
    out["liveSwitch"] = json!(sw);

    }
    // 3) recorte de janela e sobreposição: janela alvo (verde) + janela por cima (magenta)
    say("  [3] recorte de janela / sobreposicao / movimento");
    let probe = Probe::new(&g, mw, mh)?;
    let (x0, y0) = (m.rect.left + 200, m.rect.top + 150);
    let target = TestWin::new_ex(x0, y0, 640, 400, GREEN, true, false)?;
    wait_ms(400);
    let mut scen = Vec::new();
    // cada cenário: prepara as janelas e mede cada método
    let scenarios: Vec<(&str, Box<dyn Fn(&TestWin, &mut Option<TestWin>)>)> = vec![
        ("livre", Box::new(|t: &TestWin, o: &mut Option<TestWin>| { *o = None; t.place(x0, y0, 640, 400); })),
        ("metade_encoberta", Box::new(move |t: &TestWin, o: &mut Option<TestWin>| { t.place(x0, y0, 640, 400); *o = TestWin::new(x0 + 320, y0 - 20, 400, 440, MAGENTA, true).ok(); })),
        ("toda_encoberta", Box::new(move |t: &TestWin, o: &mut Option<TestWin>| { t.place(x0, y0, 640, 400); *o = TestWin::new(x0 - 20, y0 - 20, 680, 440, MAGENTA, true).ok(); })),
        ("movida", Box::new(move |t: &TestWin, o: &mut Option<TestWin>| { *o = None; t.place(x0 + 300, y0 + 120, 640, 400); })),
        ("redimensionada", Box::new(move |t: &TestWin, o: &mut Option<TestWin>| { *o = None; t.place(x0, y0, 900, 500); })),
        ("meio_fora_do_monitor", Box::new(move |t: &TestWin, o: &mut Option<TestWin>| { *o = None; t.place(m.rect.right - 320, y0, 640, 400); })),
        ("minimizada", Box::new(move |t: &TestWin, o: &mut Option<TestWin>| { *o = None; t.place(x0, y0, 640, 400); t.show(SW_MINIMIZE); })),
    ];
    let mut occl: Option<TestWin> = None;
    for (name, prep) in &scenarios {
        target.show(SW_SHOWNOACTIVATE); target.color(GREEN);
        prep(&target, &mut occl); wait_ms(400);
        let wr = target.rect();
        let mut row = json!({ "scenario": name, "windowRect": [wr.left, wr.top, wr.right, wr.bottom] });
        for kind in ["wgc_janela", "wgc_monitor", "dxgi_proprio"] {
            let mut s = match open_src(kind, &g, &m, Some(target.0)) { Ok(s) => s, Err(x) => { row[kind] = json!({ "openError": x }); continue; } };
            // a sonda lê o quadro NA HORA: o do DXGI deixa de valer no próximo pedido (1ª rodada da PoC leu depois e deu
            // "Parametro incorreto"). Fica o resultado do último quadro lido.
            let t = Instant::now(); let mut frames = 0u32; let mut r = json!({ "frames": 0, "note": "nenhum quadro em 0,9 s" });
            while t.elapsed() < Duration::from_millis(900) {
                anim.tick();
                match s.next(&g, &mut clk) {
                    Ok(Some(f)) => { frames += 1;
                        let crop = if kind == "wgc_janela" { full(&f) } else { crop_for(target.rect(), &f) };
                        r = match crop { None => json!({ "frames": frames, "note": "janela fora deste monitor" }),
                            Some(c) => match probe.read(&g, &f.tex, c) { Ok(col) => { let mut j = col.j(); j["frames"] = json!(frames); j["crop"] = json!([c.left, c.top, c.right, c.bottom]); j["frame"] = json!(format!("{}x{}", f.w, f.h)); j }, Err(x) => json!({ "frames": frames, "error": x }) } }; }
                    Ok(None) => std::thread::sleep(Duration::from_millis(2)),
                    Err(_) => { let _ = s.recreate(&g); }
                }
            }
            row[kind] = r; drop(s); wait_ms(150);
        }
        say(&format!("     {name}: wgc_janela verde {}%  monitor+recorte verde {}%  dxgi+recorte verde {}%", row["wgc_janela"]["verde"], row["wgc_monitor"]["verde"], row["dxgi_proprio"]["verde"]));
        scen.push(row);
    }
    occl = None; let _ = occl;
    target.show(SW_RESTORE); target.place(x0, y0, 640, 400); wait_ms(300);

    // 4) seguir a janela andando: o recorte é refeito a cada quadro; quanto do recorte é a janela (verde) enquanto ela anda
    let mut follow = serde_json::Map::new();
    for kind in ["wgc_monitor", "dxgi_proprio"] {
        let Ok(mut s) = open_src(kind, &g, &m, None) else { continue };
        let mut greens = Vec::new(); let t = Instant::now(); let mut k = 0;
        while t.elapsed() < Duration::from_secs(2) {
            k += 1; let dx = ((k * 7) % 400) as i32; target.place(x0 + dx, y0, 640, 400); anim.tick();
            if let Ok(Some(f)) = s.next(&g, &mut clk) { if let Some(c) = crop_for(target.rect(), &f) { if let Ok(col) = probe.read(&g, &f.tex, c) { greens.push(col.green * 100.0); } } }
            std::thread::sleep(Duration::from_millis(4));
        }
        follow.insert(kind.into(), json!({ "samples": greens.len(), "greenPct": stats(&greens), "greenP5": r2(pct(&greens, 0.05)) }));
    }
    out["cropFollowMovingWindow"] = Value::Object(follow);
    out["cropScenarios"] = json!(scen);

    // 5) tela preta: a janela fica preta; a sonda reconhece? e quanto custa ler a sonda
    say("  [4] deteccao de tela preta");
    let mut black = serde_json::Map::new();
    for (label, col) in [("janela_preta", BLACK), ("janela_verde", GREEN)] {
        target.color(col); wait_ms(250);
        if let Ok(mut s) = open_src("wgc_janela", &g, &m, Some(target.0)) {
            let t = Instant::now(); let mut last = None; while t.elapsed() < Duration::from_millis(600) { pump(); if let Ok(Some(f)) = s.next(&g, &mut clk) { last = Some(f); } std::thread::sleep(Duration::from_millis(3)); }
            if let Some(f) = last { let mut ms = Vec::new(); let mut c = Colors::default(); for _ in 0..30 { let tt = Instant::now(); if let Ok(x) = probe.read(&g, &f.tex, full(&f).unwrap()) { c = x; } ms.push(tt.elapsed().as_secs_f64() * 1000.0); }
                black.insert(label.into(), json!({ "colors": c.j(), "detectedBlack": c.black > 0.97, "probeCpuMsBlocking": stats(&ms) })); }
        }
    }
    out["blackDetection"] = Value::Object(black);
    for (_, l) in [(0, &layer)] { unsafe { let _ = l.enc.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); } }
    drop(target); drop(anim);
    Ok(out)
}

/// Registro por segundo, WGC de monitor e DXGI lado a lado (sem codificar), para os testes que dependem de você:
/// mudar a resolução, abrir um jogo em tela cheia / sem bordas, alt+tab, Ctrl+Alt+Del, UAC, desligar/ligar monitor.
fn run_manual(secs: u64, dpi: bool) -> R<J> {
    let mut g = gpu()?;
    let (mons, adapters) = monitors();
    let m = pick_monitor(&mons).ok_or("nenhum monitor")?;
    let env = env_json(&g, &mons, adapters, dpi);
    say(&format!("  MODO MANUAL {secs} s no monitor {} ({}x{}). Faça os testes agora; o registro vai por segundo.", m.dev, m.rect.right - m.rect.left, m.rect.bottom - m.rect.top));
    let (mw, mh) = ((m.rect.right - m.rect.left) as u32, (m.rect.bottom - m.rect.top) as u32);
    let mut clk = GpuClock::new(&g.device)?; let mut probe = Probe::new(&g, mw, mh)?;
    let mut wgc: Option<Box<dyn Source>> = open_src("wgc_monitor", &g, &m, None).ok();
    let mut dx: Option<Box<dyn Source>> = open_src("dxgi_proprio", &g, &m, None).ok();
    let mut log = Vec::new(); let mut events: Vec<J> = Vec::new();
    let t0 = Instant::now(); let mut sec = 0u64;
    let (mut cw, mut cd) = (0u32, 0u32); let (mut bw, mut bd) = (None::<Colors>, None::<Colors>); let (mut sw, mut sd) = (String::new(), String::new());
    let mut device_lost = 0u32;
    while t0.elapsed().as_secs() < secs {
        pump();
        // placa de vídeo caiu (TDR, driver atualizado, dxcap -forcetdr)? recria tudo e mede quanto demora
        let reason = unsafe { g.device.GetDeviceRemovedReason() };
        if reason.is_err() {
            device_lost += 1; let tr = Instant::now();
            wgc = None; dx = None;
            let mut ok = false;
            for _ in 0..100 { if let Ok(ng) = gpu() { g = ng; ok = true; break; } std::thread::sleep(Duration::from_millis(50)); }
            if ok { clk = GpuClock::new(&g.device)?; probe = Probe::new(&g, mw, mh)?; wgc = open_src("wgc_monitor", &g, &m, None).ok(); dx = open_src("dxgi_proprio", &g, &m, None).ok(); }
            events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": "device_removed", "reason": format!("0x{:08X}", reason.as_ref().err().map(|x| x.code().0 as u32).unwrap_or(0)), "recovered": ok, "recoverMs": r2(tr.elapsed().as_secs_f64() * 1000.0) }));
            continue;
        }
        let mut got = false;
        for (src, cnt, last, size, name) in [(&mut wgc, &mut cw, &mut bw, &mut sw, "wgc"), (&mut dx, &mut cd, &mut bd, &mut sd, "dxgi")] {
            let Some(s) = src.as_mut() else { continue };
            match s.next(&g, &mut clk) {
                Ok(Some(f)) => { *cnt += 1; got = true; let fs = format!("{}x{}", f.w, f.h); if *size != fs { if !size.is_empty() { events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": "size", "source": name, "from": size.clone(), "to": fs })); } *size = fs; }
                    if *cnt % 15 == 1 { if let Ok(c) = probe.read(&g, &f.tex, full(&f).unwrap()) { *last = Some(c); } } }
                Ok(None) => {}
                Err(SrcErr::Lost(w)) => { let tr = Instant::now(); let mut ok = false; for _ in 0..100 { pump(); if s.recreate(&g).is_ok() { ok = true; break; } std::thread::sleep(Duration::from_millis(30)); }
                    events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": "access_lost", "source": name, "why": w, "recreated": ok, "recreateMs": r2(tr.elapsed().as_secs_f64() * 1000.0) })); }
                Err(SrcErr::Fatal(x)) => { events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": "error", "source": name, "error": x })); *src = None; }
            }
        }
        if !got { std::thread::sleep(Duration::from_millis(1)); }
        let s = t0.elapsed().as_secs();
        if s > sec {
            sec = s;
            let (state, fg) = fg_state(&m);
            let line = json!({ "s": sec, "wgcFps": cw, "dxgiFps": cd, "wgcBlack": bw.map(|c| c.black > 0.97), "dxgiBlack": bd.map(|c| c.black > 0.97), "wgcLuma": bw.map(|c| r2(c.luma)), "dxgiLuma": bd.map(|c| r2(c.luma)), "fullscreenState": state, "foreground": fg });
            say(&format!("  {:>3}s  WGC {:>3} fps{}  DXGI {:>3} fps{}  {}  {}", sec, cw, if bw.map(|c| c.black > 0.97).unwrap_or(false) { " (PRETO)" } else { "" }, cd, if bd.map(|c| c.black > 0.97).unwrap_or(false) { " (PRETO)" } else { "" }, state, line["foreground"]["title"].as_str().unwrap_or("")));
            log.push(line); cw = 0; cd = 0;
        }
    }
    Ok(json!({ "env": env, "monitor": mon_json(&m, g.luid), "events": events, "deviceLost": device_lost, "perSecond": log, "wgcExtra": wgc.as_ref().map(|s| s.extra()), "dxgiExtra": dx.as_ref().map(|s| s.extra()) }))
}
/// o que o Windows diz da janela da frente (mesmo critério do aviso de tela cheia do app) + se ela cobre o monitor
fn fg_state(m: &Mon) -> (String, J) {
    let st = unsafe { SHQueryUserNotificationState() }.map(|s| match s.0 { 1 => "normal", 2 => "ocupado(tela cheia)", 3 => "D3D tela cheia exclusiva", 4 => "apresentacao", 5 => "normal", 6 => "app tela cheia", 7 => "quiet", _ => "?" }).unwrap_or("?").to_string();
    let h = unsafe { GetForegroundWindow() };
    let mut buf = [0u16; 128]; let n = unsafe { GetWindowTextW(h, &mut buf) } as usize;
    let mut r = RECT::default(); unsafe { let _ = GetWindowRect(h, &mut r); }
    let covers = r.left <= m.rect.left && r.top <= m.rect.top && r.right >= m.rect.right && r.bottom >= m.rect.bottom;
    let style = unsafe { GetWindowLongW(h, GWL_STYLE) } as u32;
    (st, json!({ "title": String::from_utf16_lossy(&buf[..n]), "coversMonitor": covers, "borderless": style & WS_CAPTION.0 == 0 }))
}

// ---------------------------------------------------------------------------------------------------------------- tela cheia sintética
/// Um "jogo" mínimo: janela do tamanho do monitor com Direct3D 11 (device próprio, como um jogo teria) pintando cores
/// fortes que mudam a cada quadro. Três fases com WGC de monitor e DXGI abertos o tempo todo, como numa transmissão:
///   sem_bordas (flip model, o "tela cheia sem bordas" dos jogos) -> tela_cheia_exclusiva (SetFullscreenState) -> volta_janela.
/// Imagem preta na captura enquanto o "jogo" pinta cores fortes = a captura falhou. Não substitui um jogo de verdade
/// (drivers e "otimizações de tela cheia" do Windows tratam jogos conhecidos de outro jeito), mas exercita o mecanismo.
fn run_fullscreen(dpi: bool) -> R<J> {
    let g = gpu()?;
    let (mons, adapters) = monitors();
    let m = pick_monitor(&mons).ok_or("nenhum monitor")?;
    let (mw, mh) = ((m.rect.right - m.rect.left) as u32, (m.rect.bottom - m.rect.top) as u32);
    let env = env_json(&g, &mons, adapters, dpi);
    let mut clk = GpuClock::new(&g.device)?; let probe = Probe::new(&g, mw, mh)?;
    // device do "jogo"
    let mut gd: Option<ID3D11Device> = None; let mut gc: Option<ID3D11DeviceContext> = None;
    unsafe { e(D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut gd), None, Some(&mut gc)), "device do jogo")?; }
    let (gd, gc) = (gd.unwrap(), gc.unwrap());
    let factory: IDXGIFactory2 = e(unsafe { CreateDXGIFactory1::<IDXGIFactory2>() }, "IDXGIFactory2")?;
    let win = TestWin::new_ex(m.rect.left, m.rect.top, mw as i32, mh as i32, BLACK, false, false)?;
    unsafe { let _ = ShowWindow(win.0, SW_SHOW); let _ = SetForegroundWindow(win.0); }
    wait_ms(300);
    let fg_ok = unsafe { GetForegroundWindow() } == win.0;
    say(&format!("  TELA CHEIA SINTETICA no monitor {} ({}x{}). Nao mexa no mouse/teclado (~25 s).", m.dev, mw, mh));

    let mut wgc: Option<Box<dyn Source>> = open_src("wgc_monitor", &g, &m, None).ok();
    let mut dx: Option<Box<dyn Source>> = open_src("dxgi_proprio", &g, &m, None).ok();
    let mut phases = Vec::new(); let mut events: Vec<J> = Vec::new(); let t0 = Instant::now(); let mut k = 0u32;
    for (phase, secs) in [("sem_bordas", 8u64), ("tela_cheia_exclusiva", 8), ("volta_janela", 5)] {
        // cadeia de troca de cada fase
        let mut legacy: Option<IDXGISwapChain> = None; let mut flip: Option<IDXGISwapChain1> = None; let mut fs_err = None::<String>; let mut fs_on = None::<bool>;
        if phase == "tela_cheia_exclusiva" {
            let desc = DXGI_SWAP_CHAIN_DESC { BufferDesc: DXGI_MODE_DESC { Width: mw, Height: mh, Format: DXGI_FORMAT_B8G8R8A8_UNORM, ..Default::default() }, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT, BufferCount: 1, OutputWindow: win.0, Windowed: true.into(), SwapEffect: DXGI_SWAP_EFFECT_DISCARD, Flags: 0 };
            let mut sc = None; let hr = unsafe { factory.CreateSwapChain(&gd, &desc, &mut sc) };
            if hr.is_err() { fs_err = Some(format!("CreateSwapChain 0x{:08X}", hr.0 as u32)); }
            if let Some(sc) = &sc {
                let t = Instant::now();
                match unsafe { sc.SetFullscreenState(true, None) } { Ok(_) => {}, Err(x) => fs_err = Some(format!("SetFullscreenState: {} (0x{:08X})", x.message(), x.code().0 as u32)) }
                events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": "enter_exclusive", "ms": r2(t.elapsed().as_secs_f64() * 1000.0), "error": fs_err }));
                let mut on = windows::core::BOOL(0); let _ = unsafe { sc.GetFullscreenState(Some(&mut on), None) }; fs_on = Some(on.as_bool());
            }
            legacy = sc;
        } else {
            let d1 = DXGI_SWAP_CHAIN_DESC1 { Width: mw, Height: mh, Format: DXGI_FORMAT_B8G8R8A8_UNORM, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT, BufferCount: 2, SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD, ..Default::default() };
            match unsafe { factory.CreateSwapChainForHwnd(&gd, win.0, &d1, None, None) } { Ok(x) => flip = Some(x), Err(x) => fs_err = Some(format!("CreateSwapChainForHwnd: {}", x.message())) }
        }
        let rtv_for = |buf: windows::core::Result<ID3D11Texture2D>| -> Option<ID3D11RenderTargetView> { let b = buf.ok()?; let mut v = None; unsafe { gd.CreateRenderTargetView(&b, None, Some(&mut v)) }.ok()?; v };
        let rtv = if let Some(sc) = &legacy { rtv_for(unsafe { sc.GetBuffer(0) }) } else if let Some(sc) = &flip { rtv_for(unsafe { sc.GetBuffer(0) }) } else { None };
        let mut per = Vec::new(); let tp = Instant::now(); let mut sec = 0u64;
        let (mut presented, mut occluded, mut cw, mut cd) = (0u32, 0u32, 0u32, 0u32);
        let (mut lw, mut ld) = (None::<Colors>, None::<Colors>);
        let frame_iv = Duration::from_secs_f64(1.0 / m.hz.clamp(30, 240) as f64);
        let mut next_render = Instant::now(); let mut acc0 = acc_of(&dx);
        while tp.elapsed().as_secs() < secs {
            pump();
            if Instant::now() >= next_render {
                next_render += frame_iv; if next_render < Instant::now() { next_render = Instant::now() + frame_iv; }
                // "jogo": cor forte diferente a cada quadro (nunca preta)
                k = k.wrapping_add(1); let c = [[0.9f32, 0.2, 0.2, 1.0], [0.2, 0.9, 0.2, 1.0], [0.2, 0.3, 0.95, 1.0], [0.95, 0.9, 0.2, 1.0]][(k / 4 % 4) as usize];
                if let Some(v) = &rtv { unsafe { gc.ClearRenderTargetView(v, &c); } }
                let hr = if let Some(sc) = &legacy { unsafe { sc.Present(0, DXGI_PRESENT(0)) } } else if let Some(sc) = &flip { unsafe { sc.Present(0, DXGI_PRESENT(0)) } } else { S_OK };
                if hr == DXGI_STATUS_OCCLUDED { occluded += 1; } else if hr.is_ok() { presented += 1; }
            } else { std::thread::sleep(Duration::from_millis(1)); }
            for (src, cnt, last, name) in [(&mut wgc, &mut cw, &mut lw, "wgc"), (&mut dx, &mut cd, &mut ld, "dxgi")] {
                let Some(sx) = src.as_mut() else { continue };
                match sx.next(&g, &mut clk) {
                    Ok(Some(f)) => { *cnt += 1; if *cnt % 10 == 1 { if let Ok(cc) = probe.read(&g, &f.tex, full(&f).unwrap()) { *last = Some(cc); } } }
                    Ok(None) => {}
                    Err(SrcErr::Lost(w)) => { let tr = Instant::now(); let mut ok = false; for _ in 0..100 { pump(); if sx.recreate(&g).is_ok() { ok = true; break; } std::thread::sleep(Duration::from_millis(20)); }
                        events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "phase": phase, "event": "access_lost", "source": name, "why": w, "recreated": ok, "recreateMs": r2(tr.elapsed().as_secs_f64() * 1000.0) })); }
                    Err(SrcErr::Fatal(x)) => { events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "phase": phase, "event": "error", "source": name, "error": x })); *src = None; }
                }
            }
            let s2 = tp.elapsed().as_secs();
            if s2 > sec { sec = s2;
                let st = unsafe { SHQueryUserNotificationState() }.map(|x| x.0).unwrap_or(0);
                let acc = acc_of(&dx); let dacc = acc.saturating_sub(acc0); acc0 = acc;
                per.push(json!({ "s": sec, "dxgiAccumulated": dacc, "gamePresented": presented, "gameOccluded": occluded, "wgcFps": cw, "dxgiFps": cd, "wgcBlack": lw.map(|c| c.black > 0.97), "dxgiBlack": ld.map(|c| c.black > 0.97), "wgcLuma": lw.map(|c| r2(c.luma)), "dxgiLuma": ld.map(|c| r2(c.luma)), "notificationState": st }));
                say(&format!("  {:<22} {:>2}s  jogo {:>3} q/s  WGC {:>3} fps{}  DXGI {:>3} fps{}  estado {}", phase, sec, presented, cw, if lw.map(|c| c.black > 0.97).unwrap_or(false) { " PRETO" } else { "" }, cd, if ld.map(|c| c.black > 0.97).unwrap_or(false) { " PRETO" } else { "" }, st));
                presented = 0; occluded = 0; cw = 0; cd = 0; lw = None; ld = None;
            }
        }
        // sai da tela cheia ANTES de soltar a cadeia (obrigatório no DXGI) e mede quanto demora
        if let Some(sc) = &legacy { let t = Instant::now(); let r = unsafe { sc.SetFullscreenState(false, None) }; events.push(json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": "leave_exclusive", "ms": r2(t.elapsed().as_secs_f64() * 1000.0), "ok": r.is_ok() })); }
        drop(rtv); drop(legacy); drop(flip); unsafe { gc.ClearState(); gc.Flush(); }
        phases.push(json!({ "phase": phase, "swapchainError": fs_err, "exclusiveActive": fs_on, "perSecond": per }));
        wait_ms(200);
    }
    drop(wgc); drop(dx); drop(win);
    Ok(json!({ "env": env, "monitor": mon_json(&m, g.luid), "foregroundOk": fg_ok, "events": events, "phases": phases,
        "notificationStateCodes": "1 normal, 2 ocupado/tela cheia, 3 D3D tela cheia exclusiva, 4 apresentacao, 5 normal, 6 app tela cheia, 7 quiet" }))
}

/// quadros que o DXGI diz ter juntado (AccumulatedFrames): bem acima dos entregues = o laço de consulta perdeu quadros
fn acc_of(dx: &Option<Box<dyn Source>>) -> u64 { dx.as_ref().and_then(|s| s.extra()["accumulatedFrames"].as_u64()).unwrap_or(0) }

// ---------------------------------------------------------------------------------------------------------------- jogo de teste
/// "Jogo" genérico para testar a transmissão na Resenha sem precisar de um jogo de verdade (nem de anti-cheat):
///   lc-stream --poc-captura --jogo-teste --modo tela-cheia|sem-bordas [--secs 600]
/// Janela "Jogo de Teste (Resenha)" do tamanho do monitor principal, com Direct3D 11 próprio, pintando uma animação calma
/// (fundo que muda devagar + barra que anda + contador de segundos em blocos), SEM piscar.
/// tela-cheia: tela cheia EXCLUSIVA (SetFullscreenState). Como os jogos de verdade: ao perder o foco (Alt+Tab) sai da tela
/// cheia e MINIMIZA; ao voltar (Alt+Tab ou barra de tarefas) entra de novo. É o caso do "Could not start video source".
/// sem-bordas: janela sem bordas cobrindo o monitor (flip model), não minimiza no Alt+Tab.
/// Esc fecha. Escreve jogo-teste-<modo>.json com o que aconteceu (segundos minimizado, entradas em tela cheia, estado do Windows).
fn run_test_game() {
    let modo = arg("--modo", "tela-cheia");
    let exclusive = modo != "sem-bordas";
    let secs: u64 = arg("--secs", "600").parse().unwrap_or(600);
    let file = format!("jogo-teste-{}.json", if exclusive { "tela-cheia" } else { "sem-bordas" });
    let v = match test_game(exclusive, secs, &file) { Ok(v) => v, Err(x) => json!({ "error": x }) };
    let _ = std::fs::write(&file, serde_json::to_string_pretty(&v).unwrap_or_default());
    say(&format!("\n  jogo de teste fechado. Registro em {file}"));
}

extern "system" fn game_wndproc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        if msg == WM_ERASEBKGND { return LRESULT(1); } // quem pinta é o Direct3D
        if msg == WM_PAINT { let mut ps = PAINTSTRUCT::default(); BeginPaint(h, &mut ps); let _ = EndPaint(h, &ps); return LRESULT(0); }
        if msg == WM_SETCURSOR && (lp.0 & 0xFFFF) as u32 == HTCLIENT { SetCursor(None); return LRESULT(1); } // jogo esconde o cursor
        DefWindowProcW(h, msg, wp, lp)
    }
}

fn test_game(exclusive: bool, secs: u64, file: &str) -> R<J> {
    let (mons, _) = monitors();
    let m = pick_monitor(&mons).ok_or("nenhum monitor")?;
    let (mw, mh) = ((m.rect.right - m.rect.left) as u32, (m.rect.bottom - m.rect.top) as u32);
    let hw = unsafe {
        let inst = e(GetModuleHandleW(None), "GetModuleHandle")?;
        let cls = w!("LcJogoTeste");
        let wc = WNDCLASSW { lpfnWndProc: Some(game_wndproc), hInstance: inst.into(), lpszClassName: cls, ..Default::default() };
        RegisterClassW(&wc);
        let hw = e(CreateWindowExW(WINDOW_EX_STYLE(0), cls, w!("Jogo de Teste (Resenha)"), WS_POPUP | WS_VISIBLE, m.rect.left, m.rect.top, mw as i32, mh as i32, None, None, Some(inst.into()), None), "CreateWindowEx")?;
        let _ = ShowWindow(hw, SW_SHOW); let _ = SetForegroundWindow(hw);
        hw
    };
    let mut gd: Option<ID3D11Device> = None; let mut gc: Option<ID3D11DeviceContext> = None;
    unsafe { e(D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut gd), None, Some(&mut gc)), "device do jogo")?; }
    let (gd, gc) = (gd.unwrap(), gc.unwrap());
    let gc1: Option<ID3D11DeviceContext1> = gc.cast().ok();
    let factory: IDXGIFactory2 = e(unsafe { CreateDXGIFactory1::<IDXGIFactory2>() }, "IDXGIFactory2")?;
    let sc: IDXGISwapChain = if exclusive {
        let desc = DXGI_SWAP_CHAIN_DESC { BufferDesc: DXGI_MODE_DESC { Width: mw, Height: mh, Format: DXGI_FORMAT_B8G8R8A8_UNORM, ..Default::default() }, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT, BufferCount: 1, OutputWindow: hw, Windowed: true.into(), SwapEffect: DXGI_SWAP_EFFECT_DISCARD, Flags: DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH.0 as u32 };
        let mut sc = None; e(unsafe { factory.CreateSwapChain(&gd, &desc, &mut sc) }.ok(), "CreateSwapChain")?;
        sc.ok_or("CreateSwapChain sem cadeia")?
    } else {
        let d1 = DXGI_SWAP_CHAIN_DESC1 { Width: mw, Height: mh, Format: DXGI_FORMAT_B8G8R8A8_UNORM, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT, BufferCount: 2, SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD, ..Default::default() };
        e(unsafe { factory.CreateSwapChainForHwnd(&gd, hw, &d1, None, None) }, "CreateSwapChainForHwnd")?.cast().map_err(|x| x.message())?
    };
    let make_rtv = |sc: &IDXGISwapChain| -> Option<ID3D11RenderTargetView> { let b: ID3D11Texture2D = unsafe { sc.GetBuffer(0) }.ok()?; let mut v = None; unsafe { gd.CreateRenderTargetView(&b, None, Some(&mut v)) }.ok()?; v };
    let mut rtv = make_rtv(&sc);
    let is_fs = || { let mut on = windows::core::BOOL(0); let _ = unsafe { sc.GetFullscreenState(Some(&mut on), None) }; on.as_bool() };
    // entra na tela cheia quando a janela está na frente (de começo e depois de cada Alt+Tab de volta). Se o Windows não
    // deixar o jogo vir para a frente ao abrir, ele fica atrás até alguém clicar nele (não minimiza antes de ter entrado)
    let mut want_fs = false;
    let mut events: Vec<J> = Vec::new(); let t0 = Instant::now();
    let ev = |events: &mut Vec<J>, what: &str, extra: J| { let mut j = json!({ "t": r2(t0.elapsed().as_secs_f64()), "event": what }); if let (Some(o), Some(x)) = (j.as_object_mut(), extra.as_object()) { for (k, v) in x { o.insert(k.clone(), v.clone()); } } events.push(j); };
    say(&format!("  JOGO DE TESTE ({}) no monitor {} ({}x{}). Esc fecha. Fecha sozinho em {} min.", if exclusive { "TELA CHEIA" } else { "JANELA SEM BORDAS" }, m.dev, mw, mh, secs / 60));
    let frame_iv = Duration::from_secs_f64(1.0 / m.hz.clamp(30, 240) as f64);
    let mut next = Instant::now();
    let (mut sec, mut presented, mut occluded) = (0u64, 0u32, 0u32);
    let mut per: Vec<J> = Vec::new();
    let (mut s_min, mut s_fs, mut s_front, mut entries) = (0u32, 0u32, 0u32, 0u32);
    let mut states: std::collections::BTreeMap<i32, u32> = Default::default();
    // resumo (também gravado a cada 5 s: o roteiro pode fechar o jogo à força)
    macro_rules! summary { () => { json!({ "modo": if exclusive { "tela-cheia" } else { "sem-bordas" }, "os": os(), "monitor": { "dev": m.dev, "w": mw, "h": mh, "hz": m.hz },
        "segundos": sec, "segundosMinimizado": s_min, "segundosTelaCheia": s_fs, "segundosNaFrente": s_front, "entradasTelaCheia": entries,
        "estadosWindows": states.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<String, J>>(),
        "codigosEstado": "1 normal, 2 ocupado/tela cheia, 3 D3D tela cheia exclusiva, 4 apresentacao, 5 normal, 6 app tela cheia, 7 quiet",
        "eventos": events, "porSegundo": per }) } }
    // --comandos: linhas no stdin ("frente", "minimizar", "sair") — o autoteste simula o Alt+Tab sem ninguém mexer
    let cmds = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    if flag("--comandos") { let c = cmds.clone(); std::thread::spawn(move || { let mut l = String::new(); while std::io::stdin().read_line(&mut l).map(|n| n > 0).unwrap_or(false) { c.lock().unwrap().push(l.trim().to_string()); l.clear(); } c.lock().unwrap().push("sair".into()); }); }
    let mut quit = false;
    while !quit && t0.elapsed().as_secs() < secs {
        for c in std::mem::take(&mut *cmds.lock().unwrap()) {
            match c.as_str() {
                "sair" => quit = true,
                // como o Alt+Tab num jogo em tela cheia: sai da tela cheia e minimiza
                "minimizar" => { if exclusive { want_fs = false; if is_fs() { drop(rtv.take()); let _ = unsafe { sc.SetFullscreenState(false, None) }; } } unsafe { let _ = ShowWindow(hw, SW_MINIMIZE); } },
                "frente" => unsafe { let _ = ShowWindow(hw, SW_RESTORE); SwitchToThisWindow(hw, true); let _ = SetForegroundWindow(hw); },
                _ => {}
            }
            ev(&mut events, "comando", json!({ "c": c }));
        }
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_KEYDOWN && msg.wParam.0 == 0x1B { quit = true; }
                let _ = TranslateMessage(&msg); DispatchMessageW(&msg);
            }
            if !IsWindow(Some(hw)).as_bool() { break; }
        }
        let front = unsafe { GetForegroundWindow() } == hw;
        let minimized = unsafe { IsIconic(hw) }.as_bool();
        if exclusive {
            // perdeu o foco em tela cheia: sai dela e minimiza (o que os jogos fazem; a Resenha recebe a janela MINIMIZADA)
            if !front && want_fs {
                want_fs = false;
                if is_fs() { drop(rtv.take()); let _ = unsafe { sc.SetFullscreenState(false, None) }; }
                unsafe { let _ = ShowWindow(hw, SW_MINIMIZE); }
                ev(&mut events, "saiu_e_minimizou", json!({}));
            } else if front && !minimized && !want_fs {
                want_fs = true;
                drop(rtv.take());
                let r = unsafe { sc.SetFullscreenState(true, None) };
                entries += 1;
                ev(&mut events, "entrou_tela_cheia", json!({ "ok": r.is_ok(), "erro": r.err().map(|x| format!("0x{:08X}", x.code().0 as u32)) }));
            }
            if rtv.is_none() && !minimized {
                let _ = unsafe { sc.ResizeBuffers(0, 0, 0, DXGI_FORMAT_UNKNOWN, DXGI_SWAP_CHAIN_FLAG(0)) };
                rtv = make_rtv(&sc);
            }
        }
        if Instant::now() >= next {
            next += frame_iv; if next < Instant::now() { next = Instant::now() + frame_iv; }
            if let Some(v) = &rtv {
                // fundo que muda devagar (ciclo de ~8 s, nunca escuro a ponto de parecer preto)
                let t = t0.elapsed().as_secs_f32();
                let ph = |o: f32| 0.5 + 0.5 * ((t / 8.0 + o) * std::f32::consts::TAU).sin();
                let bg = [0.12 + 0.18 * ph(0.0), 0.15 + 0.15 * ph(0.33), 0.30 + 0.20 * ph(0.66), 1.0];
                unsafe { gc.ClearRenderTargetView(v, &bg); }
                if let Some(c1) = &gc1 {
                    let (w, h) = (mw as i32, mh as i32);
                    // barra clara que atravessa a tela em 3 s
                    let x = ((t % 3.0) / 3.0 * (w as f32)) as i32; let bw = (w / 40).max(8);
                    unsafe { c1.ClearView(v, &[0.92, 0.92, 0.85, 1.0], Some(&[RECT { left: x, top: h / 5, right: x + bw, bottom: h * 4 / 5 }])); }
                    // segundos em binário (12 blocos): dá para ver na transmissão se a imagem está andando
                    let s = t0.elapsed().as_secs(); let bs = (h / 18).max(12);
                    for i in 0..12 { let on = s >> (11 - i) & 1 == 1; let c = if on { [0.95f32, 0.75, 0.2, 1.0] } else { [0.05, 0.05, 0.08, 1.0] };
                        let lx = w / 2 - 6 * bs + i * bs; unsafe { c1.ClearView(v, &c, Some(&[RECT { left: lx + 2, top: h - 2 * bs, right: lx + bs - 2, bottom: h - bs }])); } }
                }
                let hr = unsafe { sc.Present(1, DXGI_PRESENT(0)) };
                if hr == DXGI_STATUS_OCCLUDED { occluded += 1; } else if hr.is_ok() { presented += 1; }
            }
        } else { std::thread::sleep(Duration::from_millis(1)); }
        let s2 = t0.elapsed().as_secs();
        if s2 > sec {
            sec = s2;
            let st = unsafe { SHQueryUserNotificationState() }.map(|x| x.0).unwrap_or(0);
            *states.entry(st).or_default() += 1;
            let fs = exclusive && is_fs();
            if minimized { s_min += 1; } if fs { s_fs += 1; } if front { s_front += 1; }
            per.push(json!({ "s": sec, "quadros": presented, "ocluido": occluded, "minimizado": minimized, "telaCheia": fs, "naFrente": front, "estadoWindows": st }));
            if sec % 5 == 0 { let _ = std::fs::write(file, serde_json::to_string_pretty(&summary!()).unwrap_or_default()); say(&format!("  {:>4}s  quadros/s {:>3}  {}  {}", sec, presented, if minimized { "MINIMIZADO" } else if fs { "tela cheia" } else if front { "na frente" } else { "atras" }, match st { 3 => "(Windows: tela cheia exclusiva)", 2 => "(Windows: ocupado/tela cheia)", _ => "" })); }
            presented = 0; occluded = 0;
        }
    }
    if exclusive && is_fs() { drop(rtv.take()); let _ = unsafe { sc.SetFullscreenState(false, None) }; }
    drop(rtv); drop(sc);
    unsafe { let _ = DestroyWindow(hw); }
    Ok(summary!())
}

// ---------------------------------------------------------------------------------------------------------------- autoteste
/// Autoteste da transmissão para quem não entende de computador: dois cliques no .exe (Teste-Transmissao-Resenha.exe),
/// ~30 s sem mexer em nada, resultado na Área de Trabalho e a pasta abre sozinha. Sem argumentos, sem perguntas.
/// Abre o Jogo de Teste (este mesmo .exe com --jogo-teste --comandos) em tela cheia exclusiva e sem bordas e mede as
/// capturas que a transmissão usa (WGC da janela, WGC do monitor, DXGI) com o jogo na frente, MINIMIZADO (Alt+Tab
/// simulado: o caso do "Could not start video source") e depois de voltar.
pub fn autoteste() {
    unsafe { let _ = RoInitialize(RO_INIT_MULTITHREADED); let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL); }
    let dpi = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }.is_ok();
    println!();
    println!("  ==========================================================");
    println!("     TESTE DA TRANSMISSAO - RESENHA");
    println!();
    println!("     NAO MEXA NO MOUSE NEM NO TECLADO (uns 30 segundos)");
    println!("     A tela vai ficar azul com uma barra andando: e o teste.");
    println!("  ==========================================================");
    println!();
    let t0 = Instant::now();
    let mut out = match auto_run(dpi) { Ok(v) => v, Err(x) => json!({ "erro": x }) };
    out["kit"] = json!("autoteste-transmissao-v2"); out["duracaoSegundos"] = json!(t0.elapsed().as_secs());
    let pc = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into()).chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>();
    let name = format!("Resenha-teste-{pc}.json");
    let text = serde_json::to_string_pretty(&out).unwrap_or_default();
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(p) = unsafe { windows::Win32::UI::Shell::SHGetKnownFolderPath(&windows::Win32::UI::Shell::FOLDERID_Desktop, windows::Win32::UI::Shell::KNOWN_FOLDER_FLAG(0), None) } {
        if let Ok(s) = unsafe { p.to_string() } { dirs.push(s.into()); }
    }
    if let Ok(u) = std::env::var("USERPROFILE") { dirs.push(std::path::Path::new(&u).join("Desktop")); }
    if let Some(d) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) { dirs.push(d); }
    let saved = dirs.iter().map(|d| d.join(&name)).find(|f| std::fs::write(f, &text).is_ok());
    println!();
    match &saved {
        Some(f) => {
            println!("  PRONTO! Valeu!");
            println!("  Mande o arquivo {name} no chat da Resenha.");
            println!("  Ele esta na Area de Trabalho (a pasta vai abrir).");
            let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", f.display())).spawn();
            let msg = HSTRING::from(format!("Pronto, valeu!\n\nMande o arquivo {name} no chat da Resenha.\nEle esta na sua Area de Trabalho (a pasta ja abriu)."));
            unsafe { MessageBoxW(None, &msg, w!("Teste da transmissao - Resenha"), MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TOPMOST); }
        }
        None => {
            println!("  Nao consegui salvar o arquivo. Tire um print desta janela e mande no chat.");
            println!("{text}");
            let mut l = String::new(); let _ = std::io::stdin().read_line(&mut l);
        }
    }
}

/// mede uma captura por `secs`: abriu? quantos quadros, preta?
fn measure(kind: &str, g: &Gpu, m: &Mon, hw: Option<HWND>, probe: &Probe, clk: &mut GpuClock, secs: f64) -> J {
    let t = Instant::now();
    let mut src = match open_src(kind, g, m, hw) { Ok(s) => s, Err(x) => return json!({ "abriu": false, "erro": x, "ms": r2(t.elapsed().as_secs_f64() * 1000.0) }) };
    let open_ms = r2(t.elapsed().as_secs_f64() * 1000.0);
    let (mut frames, mut first, mut samples, mut black, mut lumas, mut errs) = (0u32, None::<f64>, 0u32, 0u32, Vec::<f64>::new(), Vec::<String>::new());
    let (mut size, mut last_sample) = ((0u32, 0u32), Instant::now() - Duration::from_secs(1));
    let ts = Instant::now();
    while ts.elapsed().as_secs_f64() < secs {
        pump();
        match src.next(g, clk) {
            Ok(Some(f)) => {
                frames += 1; if first.is_none() { first = Some(r2(t.elapsed().as_secs_f64() * 1000.0)); } size = (f.w, f.h);
                if last_sample.elapsed() >= Duration::from_millis(250) { last_sample = Instant::now();
                    if let Ok(c) = probe.read(g, &f.tex, full(&f).unwrap()) { samples += 1; if c.black > 0.97 { black += 1; } lumas.push(r2(c.luma)); } }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(1)),
            Err(SrcErr::Lost(w)) => { errs.push(format!("perdido: {w}")); if errs.len() > 20 { break; } let _ = src.recreate(g); }
            Err(SrcErr::Fatal(x)) => { errs.push(x); break; }
        }
    }
    let el = ts.elapsed().as_secs_f64().max(0.1);
    json!({ "abriu": true, "abrirMs": open_ms, "primeiroQuadroMs": first, "fps": r2(frames as f64 / el), "quadros": frames, "tamanho": format!("{}x{}", size.0, size.1),
        "amostras": samples, "pretas": black, "luma": lumas, "erros": errs })
}

fn auto_run(dpi: bool) -> R<J> {
    let g = gpu()?;
    let (mons, adapters) = monitors();
    let m = pick_monitor(&mons).ok_or("nenhum monitor")?;
    let (mw, mh) = ((m.rect.right - m.rect.left) as u32, (m.rect.bottom - m.rect.top) as u32);
    let mut out = json!({ "env": env_json(&g, &mons, adapters, dpi), "monitor": mon_json(&m, g.luid), "codificador": crate::win::probe(), "rodadas": [] });
    let probe = Probe::new(&g, mw, mh)?; let mut clk = GpuClock::new(&g.device)?;
    let exe = std::env::current_exe().map_err(|x| x.to_string())?;
    let tmp = std::env::temp_dir().join("resenha-autoteste"); let _ = std::fs::create_dir_all(&tmp);
    let mut rounds = Vec::new();
    for (i, modo) in ["tela-cheia", "sem-bordas"].iter().enumerate() {
        println!("  [{}/2] jogo de teste em {} ...", i + 1, if *modo == "tela-cheia" { "TELA CHEIA" } else { "JANELA SEM BORDAS" });
        let jf = tmp.join(format!("jogo-teste-{modo}.json")); let _ = std::fs::remove_file(&jf);
        let mut child = match std::process::Command::new(&exe).args(["--poc-captura", "--jogo-teste", "--modo", modo, "--secs", "60", "--comandos"])
            .current_dir(&tmp).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn() {
            Ok(c) => c, Err(x) => { rounds.push(json!({ "modo": modo, "erro": format!("nao abriu o jogo de teste: {x}") })); continue; } };
        let mut stdin = child.stdin.take();
        let mut cmd = |c: &str| { if let Some(s) = stdin.as_mut() { use std::io::Write; let _ = writeln!(s, "{c}"); let _ = s.flush(); } };
        // espera a janela do jogo
        let tw = Instant::now(); let mut hw = None;
        while tw.elapsed() < Duration::from_secs(10) { if let Ok(h) = unsafe { FindWindowW(w!("LcJogoTeste"), None) } { if !h.is_invalid() { hw = Some(h); break; } } wait_ms(100); }
        let mut r = json!({ "modo": modo });
        if let Some(h) = hw {
            cmd("frente"); wait_ms(if *modo == "tela-cheia" { 2500 } else { 1200 });
            let fs_state = || unsafe { SHQueryUserNotificationState() }.map(|x| x.0).unwrap_or(0);
            let mut t = serde_json::Map::new();
            t.insert("estadoWindows_frente".into(), json!(fs_state()));
            for k in ["wgc_janela", "wgc_monitor", "dxgi_proprio"] { println!("        {k}"); t.insert(format!("frente_{k}"), measure(k, &g, &m, Some(h), &probe, &mut clk, 2.0)); }
            if *modo == "tela-cheia" {
                println!("        Alt+Tab simulado (jogo minimizado)");
                cmd("minimizar"); wait_ms(1200);
                t.insert("minimizado_iconic".into(), json!(unsafe { IsIconic(h) }.as_bool()));
                for k in ["wgc_janela", "dxgi_proprio"] { t.insert(format!("minimizado_{k}"), measure(k, &g, &m, Some(h), &probe, &mut clk, 1.5)); }
                println!("        voltando para o jogo");
                cmd("frente"); wait_ms(2500);
                t.insert("estadoWindows_voltou".into(), json!(fs_state()));
                for k in ["wgc_janela", "dxgi_proprio"] { t.insert(format!("voltou_{k}"), measure(k, &g, &m, Some(h), &probe, &mut clk, 2.0)); }
            }
            r["testes"] = Value::Object(t);
        } else { r["erro"] = json!("a janela do jogo de teste nao apareceu"); }
        cmd("sair"); drop(stdin);
        let tq = Instant::now(); while tq.elapsed() < Duration::from_secs(3) { if let Ok(Some(_)) = child.try_wait() { break; } wait_ms(50); }
        let _ = child.kill(); let _ = child.wait(); wait_ms(300);
        if let Ok(s) = std::fs::read_to_string(&jf) { r["jogo"] = serde_json::from_str(&s).unwrap_or(Value::Null); }
        rounds.push(r);
    }
    out["rodadas"] = json!(rounds);
    Ok(out)
}
