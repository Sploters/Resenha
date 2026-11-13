//! Vigia do --serve (ver serve.rs): em vez de perguntar de tempos em tempos, escuta os eventos do Windows.
//!
//! No Windows, uma thread com laço de mensagens recebe (SetWinEventHook, fora do processo dos outros programas):
//!   - troca da janela da frente, janela minimizada/restaurada, fim de arrastar/redimensionar → confere a cobertura e a lista;
//!   - janela de primeiro nível criada, mostrada, escondida, fechada, escondida/mostrada pelo DWM → confere a lista.
//! Não escuta mudança de posição (LOCATIONCHANGE: chega a cada movimento do mouse) nem de nome (NAMECHANGE: os navegadores
//! mandam uma enxurrada). O que só esses eventos pegariam (troca de título, jogo que muda de tamanho sem trocar a janela da
//! frente) a conferência periódica pega: cobertura a cada 2 s, lista a cada 5 s, ambas dentro do processo (microssegundos),
//! sem abrir programa nenhum.
//! Vários eventos seguidos viram uma conferência só: cobertura 30 ms depois do evento, lista 250 ms depois.
//! Fora do Windows (testes): confere a cada 200 ms (o --front e o --windows de teste leem arquivos).

#[cfg(not(windows))]
pub const NATIVE: bool = false;
#[cfg(not(windows))]
pub fn start() {
    std::thread::spawn(|| loop {
        crate::serve::check_front();
        crate::serve::check_windows();
        std::thread::sleep(std::time::Duration::from_millis(200));
    });
}
#[cfg(not(windows))]
pub fn poke_front() {}
#[cfg(not(windows))]
pub fn poke_windows() {}

#[cfg(windows)]
pub const NATIVE: bool = true;
#[cfg(windows)]
pub use win::{poke_front, poke_windows, start};

#[cfg(windows)]
mod win {
    use std::cell::RefCell;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static TID: AtomicU32 = AtomicU32::new(0);
    static FRONT_DIRTY: AtomicBool = AtomicBool::new(true);
    static WIN_DIRTY: AtomicBool = AtomicBool::new(true);
    thread_local! { static KNOWN: RefCell<HashSet<isize>> = RefCell::new(HashSet::new()); }

    fn wake() { let t = TID.load(Ordering::SeqCst); if t != 0 { unsafe { let _ = PostThreadMessageW(t, WM_APP, WPARAM(0), LPARAM(0)); } } }
    pub fn poke_front() { FRONT_DIRTY.store(true, Ordering::SeqCst); wake(); }
    pub fn poke_windows() { WIN_DIRTY.store(true, Ordering::SeqCst); wake(); }

    unsafe fn top_level(hwnd: HWND) -> bool { GetAncestor(hwnd, GA_ROOT) == hwnd }

    unsafe extern "system" fn on_event(_h: HWINEVENTHOOK, ev: u32, hwnd: HWND, obj: i32, child: i32, _t: u32, _ms: u32) {
        if obj != OBJID_WINDOW.0 || child != CHILDID_SELF as i32 || hwnd.is_invalid() { return; }
        match ev {
            EVENT_SYSTEM_FOREGROUND | EVENT_SYSTEM_MINIMIZESTART | EVENT_SYSTEM_MINIMIZEEND | EVENT_SYSTEM_MOVESIZEEND => {
                FRONT_DIRTY.store(true, Ordering::SeqCst); WIN_DIRTY.store(true, Ordering::SeqCst);
            }
            // a janela já não existe: só importa se estava na última lista
            EVENT_OBJECT_DESTROY => { if KNOWN.with(|k| k.borrow().contains(&(hwnd.0 as isize))) { FRONT_DIRTY.store(true, Ordering::SeqCst); WIN_DIRTY.store(true, Ordering::SeqCst); } }
            EVENT_OBJECT_CREATE | EVENT_OBJECT_SHOW | EVENT_OBJECT_HIDE | EVENT_OBJECT_CLOAKED | EVENT_OBJECT_UNCLOAKED => {
                if top_level(hwnd) { FRONT_DIRTY.store(true, Ordering::SeqCst); WIN_DIRTY.store(true, Ordering::SeqCst); }
            }
            _ => {}
        }
    }

    pub fn start() {
        std::thread::spawn(|| unsafe {
            crate::sys::dpi_aware(); // cobertura em pixels reais (como o --front)
            TID.store(GetCurrentThreadId(), Ordering::SeqCst);
            // garante a fila de mensagens antes de alguém postar nela
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
            for (a, b) in [(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND), (EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND), (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE), (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED)] {
                if SetWinEventHook(a, b, None, Some(on_event), 0, 0, flags).is_invalid() { eprintln!("SetWinEventHook {a:#x} falhou"); }
            }
            let (front_every, win_every) = (Duration::from_secs(2), Duration::from_secs(5));
            let (mut front_due, mut win_due): (Option<Instant>, Option<Instant>) = (None, None);
            let (mut front_next, mut win_next) = (Instant::now(), Instant::now());
            loop {
                let now = Instant::now();
                if FRONT_DIRTY.swap(false, Ordering::SeqCst) && front_due.is_none() { front_due = Some(now + Duration::from_millis(30)); }
                if WIN_DIRTY.swap(false, Ordering::SeqCst) && win_due.is_none() { win_due = Some(now + Duration::from_millis(250)); }
                if front_due.is_some_and(|d| d <= now) || front_next <= now {
                    crate::serve::check_front(); front_due = None; front_next = now + front_every;
                }
                if win_due.is_some_and(|d| d <= now) || win_next <= now {
                    if let Some(h) = crate::serve::check_windows() { KNOWN.with(|k| *k.borrow_mut() = h.into_iter().collect()); }
                    win_due = None; win_next = now + win_every;
                }
                // dorme até o próximo prazo (ou até chegar um evento / pedido)
                let watching_front = crate::serve::FRONT_HWND.load(Ordering::SeqCst) != 0;
                let watching_win = crate::serve::WATCH_WINDOWS.load(Ordering::SeqCst);
                let mut next = now + Duration::from_secs(60);
                if watching_front { next = next.min(front_next); }
                if watching_win { next = next.min(win_next); }
                if let Some(d) = front_due { next = next.min(d); }
                if let Some(d) = win_due { next = next.min(d); }
                let ms = next.saturating_duration_since(Instant::now()).as_millis().min(60_000) as u32;
                let _ = MsgWaitForMultipleObjectsEx(None, ms, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    if msg.message == WM_QUIT { return; }
                    let _ = TranslateMessage(&msg); DispatchMessageW(&msg);
                }
            }
        });
    }
}
