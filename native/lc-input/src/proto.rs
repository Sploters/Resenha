//! Protocolo com o app desktop: uma linha JSON por comando na entrada padrão.
//!   {"t":"arm","rect":[x,y,w,h]}   liga a injeção para o monitor transmitido (pixels físicos)
//!   {"t":"arm","hwnd":123456}      liga a injeção para a JANELA transmitida (o retângulo é lido a cada evento)
//!   {"t":"disarm"}                 desliga e solta tudo
//!   {"t":"ev","ev":[...]}          eventos já validados pelo servidor; validados de novo aqui
//!   {"t":"ptt","code":"KeyV"}      push-to-talk global: avisa só quando ESTA tecla (ou botão do mouse) desce/sobe
//!   {"t":"ptt","code":null}        desliga o push-to-talk global
//!   {"t":"padoff","p":1}           desliga o controle virtual da vaga p (0..3; o jogador saiu)
//!   {"t":"padcheck"}               confere de novo se o driver do controle virtual responde (depois de instalar)
//! Evento de controle {"k":"g",...,"p":n}: n = vaga do controle virtual (0..3; sem p = 0, o controle remoto normal).
//! Nada aqui toca o Windows: só transforma texto em ações (testável em qualquer sistema).
use crate::keymap::scan_for;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect { pub x: i32, pub y: i32, pub w: i32, pub h: i32 }

#[derive(Debug, PartialEq)]
pub enum Action {
    MoveTo { x: i32, y: i32 },        // pixel físico absoluto na área de trabalho virtual
    Button { b: u8, down: bool },     // 0 esquerdo, 1 meio, 2 direito (como MouseEvent.button)
    Wheel { dx: i32, dy: i32 },       // unidades do Windows (120 = um "dente"); dy > 0 = para baixo
    Key { scan: u16, ext: bool, down: bool },
    Pad(Pad),                         // estado inteiro do controle de videogame (Xbox 360 virtual)
}

/// Controle no formato do XInput: botões (XINPUT_GAMEPAD_*), gatilhos 0..255 e analógicos -32768..32767 (Y para cima > 0).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Pad { pub slot: u8, pub buttons: u16, pub lt: u8, pub rt: u8, pub lx: i16, pub ly: i16, pub rx: i16, pub ry: i16 }
/// vagas de controle virtual ao mesmo tempo (controle remoto + jogadores 2, 3 e 4)
pub const PAD_SLOTS: u8 = 4;

/// Botões no "standard mapping" do navegador (Gamepad API, índice = bit) -> bits do XInput.
/// 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, (6 e 7 são os gatilhos, que vão como eixo), 8 Back, 9 Start, 10 L3, 11 R3,
/// 12 cima, 13 baixo, 14 esquerda, 15 direita, 16 Guia.
const PAD_MAP: [(u8, u16); 15] = [(0, 0x1000), (1, 0x2000), (2, 0x4000), (3, 0x8000), (4, 0x0100), (5, 0x0200), (8, 0x0020), (9, 0x0010),
    (10, 0x0040), (11, 0x0080), (12, 0x0001), (13, 0x0002), (14, 0x0004), (15, 0x0008), (16, 0x0400)];
pub fn pad_buttons(std_bits: u32) -> u16 { PAD_MAP.iter().filter(|(i, _)| std_bits & (1 << i) != 0).fold(0, |a, (_, x)| a | x) }
fn axis(v: f64) -> i16 { (v.clamp(-1.0, 1.0) * 32767.0).round() as i16 }
fn trig(v: f64) -> u8 { (v.clamp(0.0, 1.0) * 255.0).round() as u8 }

/// Onde a injeção vale: um monitor (retângulo fixo) ou uma janela (retângulo lido na hora; ela pode mexer)
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target { Screen(Rect), Window(u64) }

#[derive(Debug, PartialEq)]
pub enum Cmd { Arm(Target), Disarm, Events(Vec<Raw>), Ptt(Option<PttKey>), PadOff(u8), PadCheck, Bad }

/// Tecla do push-to-talk: scancode do teclado (como em `scan_for`) ou botão do mouse
/// (3 = meio, 4 = lateral de trás / XBUTTON1, 5 = lateral da frente / XBUTTON2). Esquerdo e direito não valem.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PttKey { Key { scan: u16, ext: bool }, Mouse(u8) }

pub fn ptt_key(code: &str) -> Option<PttKey> {
    match code {
        "Mouse3" => Some(PttKey::Mouse(3)), "Mouse4" => Some(PttKey::Mouse(4)), "Mouse5" => Some(PttKey::Mouse(5)),
        _ => scan_for(code).map(|(scan, ext)| PttKey::Key { scan, ext }),
    }
}

#[derive(Deserialize)]
struct Line { t: String, rect: Option<[i64; 4]>, hwnd: Option<u64>, ev: Option<Vec<serde_json::Value>>, code: Option<String>, p: Option<u8> }

const MAX_EVENTS: usize = 64;

pub fn parse(line: &str) -> Cmd {
    if line.len() > 16 * 1024 { return Cmd::Bad; }
    let Ok(l) = serde_json::from_str::<Line>(line) else { return Cmd::Bad };
    match l.t.as_str() {
        "arm" => match (l.rect, l.hwnd) {
            (Some([x, y, w, h]), None) if w > 0 && h > 0 && w <= 32768 && h <= 32768 && x.abs() <= 65536 && y.abs() <= 65536 =>
                Cmd::Arm(Target::Screen(Rect { x: x as i32, y: y as i32, w: w as i32, h: h as i32 })),
            (None, Some(h)) if h != 0 && h <= u32::MAX as u64 => Cmd::Arm(Target::Window(h)), // HWND cabe em 32 bits
            _ => Cmd::Bad,
        },
        "disarm" => Cmd::Disarm,
        "padoff" => match l.p { Some(p) if p < PAD_SLOTS => Cmd::PadOff(p), _ => Cmd::Bad },
        "padcheck" => Cmd::PadCheck,
        "ptt" => match l.code.as_deref() {
            None => Cmd::Ptt(None),
            Some(c) => ptt_key(c).map_or(Cmd::Bad, |k| Cmd::Ptt(Some(k))),
        },
        "ev" => Cmd::Events(l.ev.unwrap_or_default().iter().take(MAX_EVENTS).filter_map(raw_event).collect()),
        _ => Cmd::Bad,
    }
}

/// Evento cru (coordenadas 0..1) -> ação intermediária; o retângulo só entra em `place`.
#[derive(Debug, PartialEq)]
pub enum Raw { Move(f64, f64), Act(Action) }

fn raw_event(v: &serde_json::Value) -> Option<Raw> {
    let k = v.get("k")?.as_str()?;
    let f = |n: &str| v.get(n).and_then(|x| x.as_f64()).filter(|x| x.is_finite());
    match k {
        "m" => { let (x, y) = (f("x")?, f("y")?); if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y) { Some(Raw::Move(x, y)) } else { None } }
        "d" | "u" => { let b = f("b")?; if b == 0.0 || b == 1.0 || b == 2.0 { Some(Raw::Act(Action::Button { b: b as u8, down: k == "d" })) } else { None } }
        "w" => { let (dx, dy) = (f("dx").unwrap_or(0.0), f("dy").unwrap_or(0.0)); if dx.abs() <= 2400.0 && dy.abs() <= 2400.0 && (dx != 0.0 || dy != 0.0) { Some(Raw::Act(Action::Wheel { dx: dx as i32, dy: dy as i32 })) } else { None } }
        "kd" | "ku" => { let (scan, ext) = scan_for(v.get("c")?.as_str()?)?; Some(Raw::Act(Action::Key { scan, ext, down: k == "kd" })) }
        "g" => {
            let b = f("b")?; if !(0.0..=131071.0).contains(&b) || b.fract() != 0.0 { return None; }
            let ax = v.get("ax")?.as_array()?; if ax.len() != 4 { return None; }
            let a: Vec<f64> = ax.iter().map(|x| x.as_f64().filter(|x| x.is_finite() && (-1.0..=1.0).contains(x))).collect::<Option<_>>()?;
            let (lt, rt) = (f("lt").unwrap_or(0.0), f("rt").unwrap_or(0.0)); if !(0.0..=1.0).contains(&lt) || !(0.0..=1.0).contains(&rt) { return None; }
            let slot = f("p").unwrap_or(0.0); if !(0.0..PAD_SLOTS as f64).contains(&slot) || slot.fract() != 0.0 { return None; }
            // o navegador dá Y para baixo positivo; o XInput, para cima
            Some(Raw::Act(Action::Pad(Pad { slot: slot as u8, buttons: pad_buttons(b as u32), lt: trig(lt), rt: trig(rt), lx: axis(a[0]), ly: axis(-a[1]), rx: axis(a[2]), ry: axis(-a[3]) })))
        }
        _ => None,
    }
}

/// Converte as coordenadas normalizadas para pixels do monitor transmitido (sempre dentro dele).
pub fn place(raw: Raw, r: Rect) -> Action {
    match raw {
        Raw::Move(x, y) => Action::MoveTo {
            x: r.x + ((x * (r.w - 1) as f64).round() as i32).clamp(0, r.w - 1),
            y: r.y + ((y * (r.h - 1) as f64).round() as i32).clamp(0, r.h - 1),
        },
        Raw::Act(a) => a,
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arm_e_disarm() {
        assert_eq!(parse(r#"{"t":"arm","rect":[1920,0,2560,1440]}"#), Cmd::Arm(Target::Screen(Rect { x: 1920, y: 0, w: 2560, h: 1440 })));
        assert_eq!(parse(r#"{"t":"arm","hwnd":132456}"#), Cmd::Arm(Target::Window(132456)));
        assert_eq!(parse(r#"{"t":"arm","hwnd":0}"#), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"arm","rect":[0,0,10,10],"hwnd":5}"#), Cmd::Bad); // um ou outro
        assert_eq!(parse(r#"{"t":"arm","rect":[0,0,0,1080]}"#), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"disarm"}"#), Cmd::Disarm);
        assert_eq!(parse("lixo"), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"exec","cmd":"calc"}"#), Cmd::Bad);
    }
    #[test]
    fn coordenadas_dentro_do_monitor() {
        let r = Rect { x: -1920, y: 0, w: 1920, h: 1080 }; // monitor à esquerda do principal
        assert_eq!(place(Raw::Move(0.0, 0.0), r), Action::MoveTo { x: -1920, y: 0 });
        assert_eq!(place(Raw::Move(1.0, 1.0), r), Action::MoveTo { x: -1, y: 1079 });
        assert_eq!(place(Raw::Move(0.5, 0.5), r), Action::MoveTo { x: -960, y: 540 });
    }
    #[test]
    fn eventos_invalidos_sao_descartados() {
        let Cmd::Events(v) = parse(r#"{"t":"ev","ev":[{"k":"m","x":1.5,"y":0},{"k":"d","b":7},{"k":"kd","c":"Inexistente"},{"k":"w","dx":0,"dy":0},{"k":"zz"},{"k":"m","x":0.25,"y":0.75},{"k":"kd","c":"KeyA"},{"k":"u","b":2}]}"#) else { panic!() };
        assert_eq!(v.len(), 3);
        assert_eq!(v[0], Raw::Move(0.25, 0.75));
        assert_eq!(v[1], Raw::Act(Action::Key { scan: 0x1E, ext: false, down: true }));
        assert_eq!(v[2], Raw::Act(Action::Button { b: 2, down: false }));
    }
    #[test]
    fn push_to_talk() {
        assert_eq!(parse(r#"{"t":"ptt","code":"KeyV"}"#), Cmd::Ptt(Some(PttKey::Key { scan: 0x2F, ext: false })));
        assert_eq!(parse(r#"{"t":"ptt","code":"ControlRight"}"#), Cmd::Ptt(Some(PttKey::Key { scan: 0x1D, ext: true })));
        assert_eq!(parse(r#"{"t":"ptt","code":"Mouse4"}"#), Cmd::Ptt(Some(PttKey::Mouse(4))));
        assert_eq!(parse(r#"{"t":"ptt","code":null}"#), Cmd::Ptt(None));
        assert_eq!(parse(r#"{"t":"ptt"}"#), Cmd::Ptt(None));
        assert_eq!(parse(r#"{"t":"ptt","code":"Mouse1"}"#), Cmd::Bad); // botão esquerdo nunca
        assert_eq!(parse(r#"{"t":"ptt","code":"Inexistente"}"#), Cmd::Bad);
    }
    #[test]
    fn controle_de_videogame() {
        // A + LB + cima + Start; analógico esquerdo todo para cima e à direita; gatilho direito pela metade
        let Cmd::Events(v) = parse(r#"{"t":"ev","ev":[{"k":"g","b":4625,"ax":[1,-1,0,0.5],"lt":0,"rt":0.5}]}"#) else { panic!() };
        assert_eq!(v[0], Raw::Act(Action::Pad(Pad { slot: 0, buttons: 0x1000 | 0x0100 | 0x0001 | 0x0010, lt: 0, rt: 128, lx: 32767, ly: 32767, rx: 0, ry: -16384 })));
        assert_eq!(pad_buttons(1 << 6 | 1 << 7), 0); // gatilhos não viram botão
        assert_eq!(pad_buttons(1 << 16), 0x0400);
        // fora da faixa, eixos faltando ou botões demais: descartado
        let Cmd::Events(v) = parse(r#"{"t":"ev","ev":[{"k":"g","b":0,"ax":[2,0,0,0]},{"k":"g","b":0,"ax":[0,0,0]},{"k":"g","b":131072,"ax":[0,0,0,0]},{"k":"g","b":1.5,"ax":[0,0,0,0]},{"k":"g","b":0,"ax":[0,0,0,0],"rt":3}]}"#) else { panic!() };
        assert!(v.is_empty());
    }
    #[test]
    fn jogadores_em_vagas() {
        // jogar junto: cada jogador num controle virtual (vaga 0..3); vaga fora da faixa é descartada
        let Cmd::Events(v) = parse(r#"{"t":"ev","ev":[{"k":"g","b":1,"ax":[0,0,0,0],"p":2},{"k":"g","b":1,"ax":[0,0,0,0],"p":4},{"k":"g","b":1,"ax":[0,0,0,0],"p":1.5}]}"#) else { panic!() };
        assert_eq!(v.len(), 1);
        assert!(matches!(v[0], Raw::Act(Action::Pad(Pad { slot: 2, buttons: 0x1000, .. }))));
        assert_eq!(parse(r#"{"t":"padoff","p":3}"#), Cmd::PadOff(3));
        assert_eq!(parse(r#"{"t":"padoff","p":4}"#), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"padoff"}"#), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"padcheck"}"#), Cmd::PadCheck);
    }
    #[test]
    fn limite_de_eventos_por_linha() {
        let many = (0..200).map(|_| r#"{"k":"kd","c":"KeyA"}"#).collect::<Vec<_>>().join(",");
        let Cmd::Events(v) = parse(&format!(r#"{{"t":"ev","ev":[{many}]}}"#)) else { panic!() };
        assert_eq!(v.len(), MAX_EVENTS);
    }
}
