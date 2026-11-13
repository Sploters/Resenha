//! --serve: o programa fica aberto enquanto o app roda, em vez de abrir um processo novo a cada pergunta (antes: um
//! `--windows` a cada 20 s para o "Jogando…" e mais um a cada 3 s com uma janela transmitida, ~1.400 processos por hora).
//!
//! Entrada padrão: um pedido JSON por linha, {"id":n,"op":"...",...}. Saída padrão: uma linha JSON por resposta,
//! {"id":n,"r":...} ou {"id":n,"error":"..."}, e avisos sem id, {"ev":"...",...}. Encerra quando a entrada fecha.
//!
//! Pedidos:
//!   hello                  {"v":1,"events":bool,"toast":bool}  (o que este programa sabe fazer)
//!   probe                  o mesmo que --probe
//!   windows                o mesmo que --windows (lista atual, na ordem do Windows: a da frente primeiro)
//!   icon {exe}             o mesmo que --icon
//!   front {hwnd}           passa a vigiar se a janela `hwnd` está coberta (0 para parar); avisa {"ev":"front","covered",...}
//!   watch {on}             liga/desliga o aviso {"ev":"windows","list":[...]} quando a lista de janelas muda
//!   toast {ok,kind,title,sub}  aviso de clipe por cima do jogo, numa janela nativa (ver toast.rs); responde {"ms"} quando aparece
//!
//! Os avisos vêm de eventos do Windows (SetWinEventHook, ver events.rs): janela criada/fechada/minimizada, troca da janela
//! da frente. Uma conferência periódica lenta cobre o que não gera evento (troca de título, jogo que muda de tamanho).

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;

pub static FRONT_HWND: AtomicIsize = AtomicIsize::new(0);
pub static WATCH_WINDOWS: AtomicBool = AtomicBool::new(false);
static LAST_FRONT: Mutex<String> = Mutex::new(String::new());
static LAST_WINDOWS: Mutex<String> = Mutex::new(String::new());

/// uma linha na saída; a leitura do app fechou = o app fechou
pub fn send(v: &Value) {
    let mut o = std::io::stdout().lock();
    if writeln!(o, "{v}").and_then(|_| o.flush()).is_err() { std::process::exit(0); }
}
fn reply(id: &Value, r: Result<Value, String>) {
    match r { Ok(r) => send(&json!({ "id": id, "r": r })), Err(e) => send(&json!({ "id": id, "error": e })) }
}

/// confere a janela da frente e avisa se mudou (chamado pelo vigia de eventos)
pub fn check_front() {
    let h = FRONT_HWND.load(Ordering::SeqCst);
    if h == 0 { return; }
    let mut v = crate::sys::front(h);
    let s = v.to_string();
    let mut last = LAST_FRONT.lock().unwrap();
    if *last == s { return; }
    *last = s;
    v["ev"] = json!("front");
    send(&v);
}
/// lista as janelas e avisa se mudou; devolve os hwnd (para o vigia saber quais janelas fechadas importam)
pub fn check_windows() -> Option<Vec<isize>> {
    if !WATCH_WINDOWS.load(Ordering::SeqCst) { return None; }
    let v = crate::sys::windows();
    let hwnds = v.as_array().map(|a| a.iter().filter_map(|w| w["hwnd"].as_i64().map(|h| h as isize)).collect()).unwrap_or_default();
    let s = v.to_string();
    let mut last = LAST_WINDOWS.lock().unwrap();
    if *last != s { *last = s; send(&json!({ "ev": "windows", "list": v })); }
    Some(hwnds)
}

fn hwnd_of(v: &Value) -> isize {
    v.as_i64().map(|n| n as isize).or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()).map(|n| n as isize)).unwrap_or(0)
}

pub fn run() {
    crate::sys::dpi_aware(); // lista e cobertura nas mesmas coordenadas (pixels reais) nos pedidos e nos avisos
    crate::events::start();
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim(); if line.is_empty() { continue; }
        let Ok(req) = serde_json::from_str::<Value>(line) else { continue };
        let id = req["id"].clone();
        match req["op"].as_str().unwrap_or("") {
            "hello" => reply(&id, Ok(json!({ "v": 1, "events": crate::events::NATIVE, "toast": crate::toast::available() }))),
            "probe" => reply(&id, Ok(crate::sys::probe())),
            "windows" => reply(&id, Ok(crate::sys::windows())),
            "icon" => {
                // pode demorar (shell do Windows): em outra thread, para não segurar os outros pedidos
                let exe = req["exe"].as_str().unwrap_or("").to_string();
                std::thread::spawn(move || {
                    let r = crate::sys::icon_rgba(&exe).map(|(w, h, px)| json!({ "png": crate::png_b64(w, h, &px), "w": w, "h": h }));
                    reply(&id, r);
                });
            }
            "front" => {
                FRONT_HWND.store(hwnd_of(&req["hwnd"]), Ordering::SeqCst);
                LAST_FRONT.lock().unwrap().clear(); // reavisa o estado atual
                crate::events::poke_front();
                reply(&id, Ok(json!(true)));
            }
            "watch" => {
                WATCH_WINDOWS.store(req["on"].as_bool().unwrap_or(true), Ordering::SeqCst);
                LAST_WINDOWS.lock().unwrap().clear();
                crate::events::poke_windows();
                reply(&id, Ok(json!(true)));
            }
            "toast" => { std::thread::spawn(move || reply(&id, crate::toast::show(&req))); }
            op => reply(&id, Err(format!("pedido desconhecido: {op}"))),
        }
    }
    std::process::exit(0);
}
