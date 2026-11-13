//! Aviso de "clipe capturado" numa janela nativa (pedido "toast" do --serve). Antes era uma BrowserWindow transparente
//! criada a cada F8 (um processo de página do Chromium aberto e fechado no meio do jogo). Aqui é uma janela em camadas
//! (UpdateLayeredWindow) desenhada pelo próprio programa, que já está aberto:
//!   - não rouba o foco (WS_EX_NOACTIVATE, mostrada sem ativar) — roubar o foco minimizaria um jogo em tela cheia;
//!   - não recebe cliques (WS_EX_TRANSPARENT);
//!   - fica fora da captura (WDA_EXCLUDEFROMCAPTURE, Windows 10 2004+): não aparece na transmissão nem no clipe. Se o
//!     Windows não aceitar, responde erro e o app usa o aviso antigo;
//!   - por cima de jogos em janela sem borda (WS_EX_TOPMOST), no canto de cima à direita do monitor onde está o mouse;
//!   - mesma pílula, cores e animação do aviso antigo (entra em 0,22 s, sai a partir de 1,75 s, some em 2,2 s).
//! Os ícones são desenhados à mão (não dependem de fonte de ícones instalada); o texto usa a Segoe UI.
//! Fora do Windows (testes): se LC_TOAST_TEST aponta para um arquivo, anota o pedido lá e responde como se tivesse mostrado.

use serde_json::{json, Value};

#[cfg(not(windows))]
pub fn available() -> bool { std::env::var_os("LC_TOAST_TEST").is_some() }
#[cfg(not(windows))]
pub fn show(req: &Value) -> Result<Value, String> {
    use std::io::Write;
    let Some(p) = std::env::var_os("LC_TOAST_TEST") else { return Err("só no Windows".into()) };
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).map_err(|e| e.to_string())?;
    let _ = writeln!(f, "{}", json!({ "ok": req["ok"], "kind": req["kind"], "title": req["title"], "sub": req["sub"] }));
    Ok(json!({ "ms": 0 }))
}

#[cfg(windows)]
pub fn available() -> bool { true }
#[cfg(windows)]
pub use win::show;

// ---------- desenho (sem Windows: dá para testar) ----------
/// pixels RGBA pré-multiplicados em f32
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Canvas { pub w: usize, pub h: usize, pub px: Vec<[f32; 4]> }
impl Canvas {
    pub fn new(w: usize, h: usize) -> Self { Canvas { w, h, px: vec![[0.0; 4]; w * h] } }
    /// cobre com a cor (r,g,b 0..1, sem pré-multiplicar) na opacidade `a` (cobertura × alfa)
    #[inline] pub fn over(&mut self, i: usize, c: [f32; 3], a: f32) {
        if a <= 0.0 { return; }
        let a = a.min(1.0); let p = &mut self.px[i];
        for k in 0..3 { p[k] = c[k] * a + p[k] * (1.0 - a); }
        p[3] = a + p[3] * (1.0 - a);
    }
    /// BGRA pré-multiplicado de 8 bits (o que o UpdateLayeredWindow quer)
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn bgra(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.w * self.h * 4);
        let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        for p in &self.px { out.extend_from_slice(&[q(p[2]), q(p[1]), q(p[0]), q(p[3])]); }
        out
    }
}
#[inline] fn cov(d: f32) -> f32 { (0.5 - d).clamp(0.0, 1.0) } // distância (px, negativa dentro) → cobertura com antisserrilhado
/// distância até a cápsula (retângulo com as pontas redondas, raio = metade da altura)
pub fn capsule(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let r = (y1 - y0) / 2.0; let cy = (y0 + y1) / 2.0;
    let cx = x.clamp(x0 + r, (x1 - r).max(x0 + r));
    ((x - cx).powi(2) + (y - cy).powi(2)).sqrt() - r
}
/// distância até o segmento a-b com espessura `t`
fn seg(x: f32, y: f32, a: (f32, f32), b: (f32, f32), t: f32) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let k = (((x - a.0) * dx + (y - a.1) * dy) / (dx * dx + dy * dy).max(1e-6)).clamp(0.0, 1.0);
    ((x - a.0 - k * dx).powi(2) + (y - a.1 - k * dy).powi(2)).sqrt() - t / 2.0
}
/// distância até o retângulo com cantos arredondados (raio r)
fn rrect(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32, r: f32) -> f32 {
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let (hx, hy) = ((x1 - x0) / 2.0 - r, (y1 - y0) / 2.0 - r);
    let (qx, qy) = ((x - cx).abs() - hx, (y - cy).abs() - hy);
    (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - r
}
/// ícone dentro do círculo, numa grade de 16 unidades centrada em (cx,cy); devolve a distância (negativa = branco)
pub fn glyph(kind: &str, ok: bool, x: f32, y: f32, cx: f32, cy: f32, u: f32) -> f32 {
    let (gx, gy) = ((x - cx) / u + 8.0, (y - cy) / u + 8.0); // coordenadas na grade 0..16
    let d = if !ok { // X
        seg(gx, gy, (4.5, 4.5), (11.5, 11.5), 1.9).min(seg(gx, gy, (11.5, 4.5), (4.5, 11.5), 1.9))
    } else if kind == "share" { // monitor: contorno, pé e base
        let outer = rrect(gx, gy, 2.0, 3.0, 14.0, 11.5, 1.3); let inner = rrect(gx, gy, 3.6, 4.6, 12.4, 9.9, 0.3);
        outer.max(-inner).min(seg(gx, gy, (8.0, 11.5), (8.0, 13.2), 1.6)).min(seg(gx, gy, (5.2, 13.6), (10.8, 13.6), 1.6))
    } else { // claquete: corpo e a barra de cima inclinada
        let body = rrect(gx, gy, 2.2, 7.4, 13.8, 14.2, 1.4);
        let top = seg(gx, gy, (2.6, 5.6), (13.0, 3.4), 2.0);
        body.min(top)
    };
    d * u
}

fn rgb(hex: u32) -> [f32; 3] { [((hex >> 16) & 255) as f32 / 255.0, ((hex >> 8) & 255) as f32 / 255.0, (hex & 255) as f32 / 255.0] }

/// a pílula inteira: sombra, fundo com borda, círculo colorido com o ícone e o texto (coberturas já desenhadas pelo GDI)
pub fn paint(w: usize, h: usize, s: f32, ok: bool, kind: &str, (x0, y0, x1, y1): (f32, f32, f32, f32), (icx, cy, ir): (f32, f32, f32), tmask: &[f32], smask: &[f32]) -> Canvas {
    let mut cv = Canvas::new(w, h);
    let circle = if !ok { rgb(0xf23f43) } else if kind == "share" { rgb(0x5865f2) } else { rgb(0x23a55a) };
    let (shadow_dy, sigma) = ((4.0 * s).round(), 7.0 * s); // box-shadow: 0 4px 14px rgba(0,0,0,.35)
    let unit = (if ok { 15.0 } else { 13.0 }) * s / 16.0;
    for j in 0..h { for i in 0..w {
        let (fx, fy) = (i as f32 + 0.5, j as f32 + 0.5); let k = j * w + i;
        let ds = capsule(fx, fy - shadow_dy, x0, y0, x1, y1);
        cv.over(k, [0.0; 3], 0.35 / (1.0 + (ds / (sigma * 0.6)).exp()));
        let d = capsule(fx, fy, x0, y0, x1, y1);
        cv.over(k, rgb(0x111214), 0.86 * cov(d));
        cv.over(k, [1.0; 3], 0.08 * (cov(d) - cov(d + s)).max(0.0)); // borda de 1 px
        let dc = ((fx - icx).powi(2) + (fy - cy).powi(2)).sqrt() - ir;
        if dc < 1.0 {
            cv.over(k, circle, cov(dc));
            cv.over(k, [1.0; 3], cov(glyph(kind, ok, fx, fy, icx, cy, unit)).min(cov(dc)));
        }
        if let Some(&a) = tmask.get(k) { cv.over(k, rgb(0xf2f3f5), a * cov(d)); }
        if let Some(&a) = smask.get(k) { cv.over(k, rgb(0xb5bac1), a * cov(d)); }
    } }
    cv
}

/// prévia para conferir o desenho fora do Windows (sem o texto, que é do GDI): --toast-preview <saída.png> [escala]
/// três avisos empilhados sobre um fundo claro e um escuro: clipe salvo, transmissão, erro
#[cfg(not(windows))]
pub fn preview(out: &str, s: f32) -> Result<(), String> {
    let (w, h) = ((250.0 * s).round() as usize, (56.0 * s).round() as usize);
    let mut img = vec![0u8; w * 2 * h * 3 * 4];
    for (row, (ok, kind)) in [(true, ""), (true, "share"), (false, "")].into_iter().enumerate() {
        let x1 = w as f32 - (6.0 * s).round(); let y0 = (6.0 * s).round(); let x0 = x1 - (150.0 * s).round(); let y1 = y0 + (42.0 * s).round();
        let cv = paint(w, h, s, ok, kind, (x0, y0, x1, y1), (x0 + (22.0 * s).round(), (y0 + y1) / 2.0, (13.0 * s).round()), &[], &[]);
        for col in 0..2 {
            let bg = if col == 0 { [235.0, 236.0, 240.0] } else { [49.0, 51.0, 56.0] };
            for j in 0..h { for i in 0..w {
                let p = cv.px[j * w + i]; let o = ((row * h + j) * w * 2 + col * w + i) * 4;
                for c in 0..3 { img[o + c] = (p[c] * 255.0 + bg[c] * (1.0 - p[3])).round().clamp(0.0, 255.0) as u8; }
                img[o + 3] = 255;
            } }
        }
    }
    let f = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let mut e = png::Encoder::new(std::io::BufWriter::new(f), (w * 2) as u32, (h * 3) as u32);
    e.set_color(png::ColorType::Rgba); e.set_depth(png::BitDepth::Eight);
    e.write_header().and_then(|mut wr| wr.write_image_data(&img)).map_err(|e| e.to_string())
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::*;

    type Job = (Value, Sender<Result<Value, String>>);
    static TX: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();

    pub fn show(req: &Value) -> Result<Value, String> {
        let tx = TX.get_or_init(|| { let (tx, rx) = channel(); std::thread::spawn(move || ui(rx)); Mutex::new(tx) });
        let (rtx, rrx) = channel();
        tx.lock().unwrap().send((req.clone(), rtx)).map_err(|_| "aviso indisponível".to_string())?;
        rrx.recv_timeout(Duration::from_secs(3)).map_err(|_| "o aviso não respondeu".to_string())?
    }

    unsafe extern "system" fn wndproc(h: HWND, m: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if m == WM_NCHITTEST { return LRESULT(HTTRANSPARENT as isize); }
        if m == WM_MOUSEACTIVATE { return LRESULT(MA_NOACTIVATE as isize); }
        DefWindowProcW(h, m, wp, lp)
    }

    struct Toast { hwnd: HWND, dc: HDC, bmp: HBITMAP, old: HGDIOBJ, x: i32, y: i32, w: i32, h: i32, slide: f32, shown: bool }
    impl Drop for Toast {
        fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.hwnd); SelectObject(self.dc, self.old); let _ = DeleteObject(self.bmp.into()); let _ = DeleteDC(self.dc); } }
    }
    impl Toast {
        /// t em segundos desde que apareceu: entra deslizando, fica, sai deslizando
        unsafe fn frame(&mut self, t: f32) {
            let k = if t < 0.22 { let p = t / 0.22; 1.0 - (1.0 - p).powi(2) } else if t < 1.75 { 1.0 } else { let p = ((t - 1.75) / 0.25).min(1.0); 1.0 - p * p };
            let pt = POINT { x: self.x + (self.slide * (1.0 - k)).round() as i32, y: self.y };
            let sz = SIZE { cx: self.w, cy: self.h };
            let src = POINT { x: 0, y: 0 };
            let bf = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: (k * 255.0).round().clamp(0.0, 255.0) as u8, AlphaFormat: AC_SRC_ALPHA as u8 };
            let _ = UpdateLayeredWindow(self.hwnd, None, Some(&pt), Some(&sz), Some(self.dc), Some(&src), COLORREF(0), Some(&bf), ULW_ALPHA);
            if !self.shown {
                self.shown = true;
                let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
    }

    // ---------- texto: a Segoe UI desenhada pelo GDI em branco sobre preto vira a cobertura ----------
    struct Text { dc: HDC, bmp: HBITMAP, old: HGDIOBJ, bits: *mut u8, w: i32, h: i32 }
    impl Text {
        unsafe fn new(w: i32, h: i32) -> Result<Text, String> {
            let dc = CreateCompatibleDC(None);
            let mut bi = BITMAPINFO::default();
            bi.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() };
            let mut bits = std::ptr::null_mut();
            let bmp = CreateDIBSection(Some(dc), &bi, DIB_RGB_COLORS, &mut bits, None, 0).map_err(|e| { let _ = DeleteDC(dc); format!("CreateDIBSection: {e}") })?;
            let old = SelectObject(dc, bmp.into());
            let _ = SetBkMode(dc, TRANSPARENT); SetTextColor(dc, COLORREF(0x00FF_FFFF));
            Ok(Text { dc, bmp, old, bits: bits as *mut u8, w, h })
        }
        unsafe fn font(px: f32, weight: i32) -> HFONT {
            CreateFontW(-(px.round() as i32), 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY, 0, w!("Segoe UI"))
        }
        unsafe fn width(&self, f: HFONT, s: &[u16]) -> i32 {
            let o = SelectObject(self.dc, f.into()); let mut sz = SIZE::default();
            let _ = GetTextExtentPoint32W(self.dc, s, &mut sz); SelectObject(self.dc, o); sz.cx
        }
        /// desenha `s` no retângulo (cortando com reticências) e devolve a cobertura 0..1 de cada pixel
        unsafe fn draw(&self, f: HFONT, s: &[u16], mut r: RECT) -> Vec<f32> {
            let n = (self.w * self.h) as usize;
            std::ptr::write_bytes(self.bits, 0, n * 4);
            let o = SelectObject(self.dc, f.into());
            let mut s = s.to_vec();
            DrawTextW(self.dc, &mut s, &mut r, DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_END_ELLIPSIS | DT_NOPREFIX);
            let _ = GdiFlush(); SelectObject(self.dc, o);
            let px = std::slice::from_raw_parts(self.bits, n * 4);
            (0..n).map(|i| px[i * 4 + 1] as f32 / 255.0).collect()
        }
    }
    impl Drop for Text { fn drop(&mut self) { unsafe { SelectObject(self.dc, self.old); let _ = DeleteObject(self.bmp.into()); let _ = DeleteDC(self.dc); } } }

    const CLASS: PCWSTR = w!("ResenhaAviso");
    unsafe fn class() {
        static ONCE: OnceLock<()> = OnceLock::new();
        ONCE.get_or_init(|| {
            let hinst = GetModuleHandleW(None).unwrap_or_default();
            let wc = WNDCLASSEXW { cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32, lpfnWndProc: Some(wndproc), hInstance: hinst.into(), lpszClassName: CLASS, ..Default::default() };
            RegisterClassExW(&wc);
        });
    }

    unsafe fn create(req: &Value) -> Result<Toast, String> {
        let ok = req["ok"].as_bool().unwrap_or(true);
        let kind = req["kind"].as_str().unwrap_or("");
        let title: Vec<u16> = req["title"].as_str().unwrap_or("").chars().take(80).collect::<String>().encode_utf16().collect();
        let sub: Vec<u16> = req["sub"].as_str().unwrap_or("").chars().take(120).collect::<String>().encode_utf16().collect();
        // monitor onde está o mouse (normalmente o do jogo) e a escala dele
        let mut cur = POINT::default(); let _ = GetCursorPos(&mut cur);
        let mon = MonitorFromPoint(cur, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() { return Err("monitor não encontrado".into()); }
        let (mut dx, mut dy) = (96u32, 96u32); let _ = GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        let s = dx.max(48) as f32 / 96.0;
        let px = |v: f32| (v * s).round();
        let (w, h) = (px(250.0) as i32, px(56.0) as i32);
        let x = mi.rcWork.right - w - px(22.0) as i32; let y = mi.rcWork.top + px(22.0) as i32;

        // ---- medidas (como o CSS do aviso antigo: pílula a 6 px do topo e da direita, 7/14/7/8 de respiro) ----
        let text = Text::new(w, h)?;
        let (ft, fs) = (Text::font(13.0 * s, 600), Text::font(12.0 * s, 400));
        let maxw = px(250.0 - 12.0);
        let fixed = px(1.0 + 8.0 + 26.0 + 9.0 + 14.0 + 1.0);
        let tw = (text.width(ft, &title) as f32).min(maxw - fixed);
        let sw = if sub.is_empty() { 0.0 } else { (text.width(fs, &sub) as f32).min((maxw - fixed - tw - px(9.0)).max(0.0)) };
        let pw = (fixed + tw + if sw > 0.0 { px(9.0) + sw } else { 0.0 }).min(maxw);
        let (x1, y0) = (w as f32 - px(6.0), px(6.0)); let (x0, y1) = (x1 - pw, y0 + px(42.0));
        let cy = (y0 + y1) / 2.0;
        let (icx, ir) = (x0 + px(1.0 + 8.0 + 13.0), px(13.0));
        let tx = x0 + px(1.0 + 8.0 + 26.0 + 9.0);
        let rect = |l: f32, wd: f32| RECT { left: l as i32, top: y0 as i32, right: (l + wd).ceil() as i32, bottom: y1 as i32 };
        let tmask = text.draw(ft, &title, rect(tx, tw));
        let smask = if sw > 0.0 { text.draw(fs, &sub, rect(tx + tw + px(9.0), sw)) } else { Vec::new() };
        let _ = DeleteObject(ft.into()); let _ = DeleteObject(fs.into());
        drop(text);

        let cv = paint(w as usize, h as usize, s, ok, kind, (x0, y0, x1, y1), (icx, cy, ir), &tmask, &smask);

        // ---- janela ----
        class();
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, CLASS, w!("Resenha"), WS_POPUP,
            x, y, w, h, None, None, Some(hinst.into()), None).map_err(|e| format!("CreateWindowExW: {e}"))?;
        // fora da captura; sem isso o aviso apareceria na transmissão e no clipe: desiste e o app usa o aviso antigo
        if let Err(e) = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) { let _ = DestroyWindow(hwnd); return Err(format!("fora da captura: {e}")); }
        let dc = CreateCompatibleDC(None);
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() };
        let mut bits = std::ptr::null_mut();
        let bmp = match CreateDIBSection(Some(dc), &bi, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(b) => b, Err(e) => { let _ = DeleteDC(dc); let _ = DestroyWindow(hwnd); return Err(format!("CreateDIBSection: {e}")); }
        };
        let data = cv.bgra();
        std::ptr::copy_nonoverlapping(data.as_ptr(), bits as *mut u8, data.len());
        let old = SelectObject(dc, bmp.into());
        Ok(Toast { hwnd, dc, bmp, old, x, y, w, h, slide: px(24.0), shown: false })
    }

    fn pump() {
        unsafe { let mut m = MSG::default(); while PeekMessageW(&mut m, None, 0, 0, PM_REMOVE).as_bool() { let _ = TranslateMessage(&m); DispatchMessageW(&m); } }
    }

    /// thread da janela: um aviso por vez; um pedido novo no meio troca o aviso e recomeça a animação
    fn ui(rx: Receiver<Job>) {
        unsafe { let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
        while let Ok(first) = rx.recv() {
            let mut next = Some(first);
            let mut cur: Option<(Toast, Instant)> = None;
            loop {
                if let Some((req, reply)) = next.take() {
                    let t0 = Instant::now();
                    cur = None; // fecha o anterior
                    match unsafe { create(&req) } {
                        Ok(mut t) => { unsafe { t.frame(0.0) }; let _ = reply.send(Ok(json!({ "ms": t0.elapsed().as_secs_f64() * 1000.0 }))); cur = Some((t, Instant::now())); }
                        Err(e) => { let _ = reply.send(Err(e)); }
                    }
                }
                pump();
                let Some((t, since)) = cur.as_mut() else { break };
                let el = since.elapsed().as_secs_f32();
                if el >= 2.2 { break; }
                unsafe { t.frame(el) };
                match rx.recv_timeout(Duration::from_millis(16)) {
                    Ok(j) => next = Some(j),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            drop(cur);
            pump();
        }
    }
}
