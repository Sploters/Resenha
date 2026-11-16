//! Fora do Windows (testes): o seletor de verdade (select.rs) com fontes WGC/DXGI simuladas, para testar o app de ponta a
//! ponta (eventos "method"/"capnote", painel, volta ao Chromium) sem placa de vídeo. O vídeo continua vindo do ffmpeg.
//! LC_SIM="wgc=black@2,dxgi=ok": por método, `ok`, `black@S` (preto a partir de S s), `frozen@S` (parado com jogo em tela
//! cheia), `fail@S` (erro definitivo em S s), `nostart` (não abre), `unavailable` (indisponível).
use crate::select::{Action, Health, Method, Mode, Selector};
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Debug)]
enum Beh { Ok, Black(f64), Frozen(f64), Fail(f64), NoStart, Unavailable }
fn parse(s: &str) -> Beh {
    let (k, t) = s.split_once('@').map(|(a, b)| (a, b.parse().unwrap_or(0.0))).unwrap_or((s, 0.0));
    match k { "black" => Beh::Black(t), "frozen" => Beh::Frozen(t), "fail" => Beh::Fail(t), "nostart" => Beh::NoStart, "unavailable" => Beh::Unavailable, _ => Beh::Ok }
}

pub struct Sim { pub sel: Selector, beh: [Beh; 2], active_since: f64, cand: Option<(Method, f64)>, next: f64, pub events: Vec<Value>, history: Vec<Value> }
fn bi(m: Method) -> usize { if m == Method::Wgc { 0 } else { 1 } }

impl Sim {
    /// abre o primeiro método possível; Err = nenhum
    pub fn new(mode: Mode, build: u32, window: bool) -> Result<(Self, Value), String> {
        let spec = std::env::var("LC_SIM").unwrap_or_default();
        let mut beh = [Beh::Ok, Beh::Ok];
        for p in spec.split(',').filter(|x| !x.is_empty()) { if let Some((m, b)) = p.split_once('=') { let i = if m == "dxgi" { 1 } else { 0 }; beh[i] = parse(b); } }
        let sel = Selector::new(mode, if build > 0 { build } else { 26200 }, window);
        let mut s = Self { sel, beh, active_since: 0.0, cand: None, next: 0.5, events: vec![], history: vec![] };
        let mut open_errors = vec![];
        loop {
            let Some(m) = s.sel.next_to_open() else { return Err("nenhum metodo de captura nativa funcionou".into()) };
            match s.open(m) {
                Ok(()) => { s.sel.opened(0.0, m); break; }
                Err(x) => { open_errors.push(json!({ "m": m.id(), "error": x })); s.events.push(json!({ "t": "capnote", "at": 0, "msg": format!("{} nao abriu: {x}", m.id().to_uppercase()) }));
                    if let Action::GiveUp(g) = s.sel.open_failed(0.0, m, &x) { return Err(g); } }
            }
        }
        let sel = &s.sel;
        let m = sel.active().unwrap();
        let why = if open_errors.is_empty() { format!("primeira opção: {}", sel.plan_why) } else { "a primeira opção não abriu".into() };
        let ev = json!({ "t": "method", "m": m.id(), "from": null, "why": why, "ms": 30, "auto": !sel.forced(), "at": 0, "overlap": window && m == Method::Dxgi });
        let cap = json!({ "mode": mode.id(), "os": build, "win11": sel.win11, "window": window, "order": sel.order().iter().map(|x| x.id()).collect::<Vec<_>>(), "plan": sel.plan_why, "method": m.id(), "openErrors": open_errors, "overlap": window && m == Method::Dxgi, "sim": true });
        s.history.push(json!({ "at": 0, "from": null, "m": m.id(), "why": why, "ms": 30 }));
        s.events.push(ev);
        Ok((s, cap))
    }
    fn open(&self, m: Method) -> Result<(), String> {
        match self.beh[bi(m)] { Beh::NoStart => Err("simulado: nao abriu".into()), Beh::Unavailable => Err("indisponivel: simulado".into()), _ => Ok(()) }
    }
    fn health(&self, m: Method, since: f64, now: f64) -> Result<Health, String> {
        let t = now - since;
        Ok(match self.beh[bi(m)] {
            Beh::Fail(at) if t >= at => return Err("simulado: erro definitivo".into()),
            Beh::Black(at) if t >= at => Health { frames: 30, black: 2, ..Default::default() },
            Beh::Frozen(at) if t >= at => Health { frames: 1, lit: 2, changed: 0, expect_motion: true, exclusive: true, black: 0 },
            _ => Health { frames: 30, lit: 2, changed: 2, expect_motion: false, exclusive: false, black: 0 },
        })
    }
    /// meio segundo de simulação; Err = desistiu (o app volta ao Chromium)
    pub fn tick(&mut self, now: f64) -> Result<(), String> {
        if now < self.next { return Ok(()); }
        self.next = now + 0.5;
        let a = self.sel.active().unwrap();
        let act = match self.health(a, self.active_since, now) {
            Err(x) => { self.events.push(json!({ "t": "capnote", "at": now, "msg": format!("{} falhou: {x}", a.id().to_uppercase()) })); self.sel.active_error(now, &x) }
            Ok(h) => {
                let mut act = self.sel.tick(now, &h);
                if let Some((cm, cs)) = self.cand { if act == Action::None { act = match self.health(cm, cs, now) { Ok(ch) => self.sel.cand_tick(now, &ch), Err(x) => { self.sel.cand_error(now, &x); self.cand = None; Action::None } }; } }
                act
            }
        };
        for n in self.sel.notes.drain(..) { self.events.push(n); }
        match act {
            Action::None => {}
            Action::OpenCandidate(m, why) => { self.events.push(json!({ "t": "capnote", "at": now, "msg": why })); match self.open(m) { Ok(()) => self.cand = Some((m, now)), Err(x) => self.sel.cand_error(now, &x) } }
            Action::DropCandidate(why) => { let m = self.cand.take().map(|c| c.0.id()).unwrap_or("?"); self.events.push(json!({ "t": "capnote", "at": now, "msg": format!("{} descartado: {why}", m.to_uppercase()) })); self.sel.cand_dropped(now, &why); }
            Action::Promote(why) => { let (m, t0) = self.cand.take().unwrap(); self.sel.promoted(now); self.active_since = t0; self.switched(a, m, why, 20.0, ((now - t0) * 1000.0).round(), now); }
            Action::SwitchCold(m, why) => match self.open(m) {
                Ok(()) => { self.cand = None; self.sel.switched_cold(now, m); self.active_since = now; self.switched(a, m, why, 60.0, 0.0, now); }
                Err(x) => if let Action::GiveUp(g) = self.sel.open_failed(now, m, &x) { return Err(g); },
            },
            Action::GiveUp(g) => return Err(g),
        }
        for n in self.sel.notes.drain(..) { self.events.push(n); }
        Ok(())
    }
    fn switched(&mut self, from: Method, to: Method, why: String, ms: f64, test_ms: f64, now: f64) {
        self.events.push(json!({ "t": "method", "m": to.id(), "from": from.id(), "why": why, "ms": ms, "testMs": test_ms, "auto": !self.sel.forced(), "at": now, "overlap": self.sel.window_src && to == Method::Dxgi }));
        self.history.push(json!({ "at": now, "from": from.id(), "m": to.id(), "why": why, "ms": ms, "testMs": test_ms }));
    }
    pub fn extra(&self, w: u32, h: u32) -> Value {
        let a = self.sel.active().unwrap();
        let black = matches!(self.beh[bi(a)], Beh::Black(_));
        json!({ "m": a.id(), "cand": self.cand.map(|c| c.0.id()), "srcW": w, "srcH": h, "fs": 1, "fsOurs": false, "black": black, "overlap": self.sel.window_src && a == Method::Dxgi, "errs": 0, "rebuilds": 0, "sim": true })
    }
    pub fn history(&self) -> Value { json!(self.history) }
}
