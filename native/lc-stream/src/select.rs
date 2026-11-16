//! Seletor do método de captura (WGC x DXGI). Lógica pura, sem Windows: decide a partir do que as capturas entregam de
//! fato (quadros novos, imagem preta, imagem mudando) e devolve ações para o pipeline (capture.rs). Testado com
//! `cargo test` em qualquer sistema. Regras (docs/CAPTURA-WGC-DXGI.md, "Integração"):
//! - Ordem inicial: Windows 11 -> WGC, DXGI; Windows 10 -> DXGI, WGC. Só um ponto de partida: o que vale é o resultado.
//! - Tela preta ou imagem parada (com sinal de que a tela devia estar mudando) não troca na hora: abre o outro método
//!   ao lado ("candidato") e só troca se ele mostrar uma imagem melhor. Se não mostrar, fica onde está e espera cada
//!   vez mais para tentar de novo (10 s, 20 s, 40 s ... 5 min).
//! - Erro que a própria fonte não conseguiu resolver (ela já tenta recriar) -> troca direto para o outro método.
//! - Limites: no máximo MAX_SWITCHES trocas em SWITCH_WINDOW s; método com HARD_FAILS erros em HARD_WINDOW s fica
//!   desligado nesta transmissão; sem nenhum método -> GiveUp (o app volta ao Chromium). Nunca há laço infinito.
//! - Modo forçado: nunca troca de método; erro definitivo -> GiveUp.
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Method { Wgc, Dxgi }
impl Method {
    pub fn id(self) -> &'static str { match self { Method::Wgc => "wgc", Method::Dxgi => "dxgi" } }
    pub fn other(self) -> Method { match self { Method::Wgc => Method::Dxgi, Method::Dxgi => Method::Wgc } }
    fn i(self) -> usize { match self { Method::Wgc => 0, Method::Dxgi => 1 } }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode { Auto, Force(Method) }
impl Mode {
    pub fn parse(s: &str) -> Option<Mode> { match s { "auto" => Some(Mode::Auto), "wgc" => Some(Mode::Force(Method::Wgc)), "dxgi" => Some(Mode::Force(Method::Dxgi)), _ => None } }
    pub fn id(self) -> &'static str { match self { Mode::Auto => "auto", Mode::Force(Method::Wgc) => "wgc", Mode::Force(Method::Dxgi) => "dxgi" } }
}

/// Windows 11 começa no build 22000
pub fn is_win11(build: u32) -> bool { build >= 22000 }

/// O que uma fonte entregou num intervalo (a cada ~0,5 s)
#[derive(Clone, Copy, Debug, Default)]
pub struct Health {
    /// quadros novos no intervalo
    pub frames: u32,
    /// leituras da sonda (miniatura 64x36) no intervalo: quantas pretas, quantas não pretas, quantas diferentes da anterior
    pub black: u32, pub lit: u32, pub changed: u32,
    /// sinal externo de que a tela devia estar mudando: jogo/vídeo em tela cheia na frente, no monitor capturado
    pub expect_motion: bool,
    /// o Windows diz "Direct3D em tela cheia exclusiva" (SHQueryUserNotificationState = 3)
    pub exclusive: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    None,
    /// abrir `m` ao lado da ativa para comparar
    OpenCandidate(Method, String),
    /// o candidato é melhor: vira a fonte ativa (a antiga fecha)
    Promote(String),
    /// o candidato não ajudou: fecha
    DropCandidate(String),
    /// a ativa morreu: abrir `m` no lugar dela
    SwitchCold(Method, String),
    /// nenhum método nativo serve: encerrar (o app continua pelo Chromium)
    GiveUp(String),
}

pub const BLACK_SECS: f64 = 3.0;
pub const STALE_SECS: f64 = 4.0;
/// Windows 10 + WGC + tela cheia exclusiva: a PoC viu o WGC cair para 1 fps congelado; decide mais rápido
pub const STALE_SECS_EXCLUSIVE_W10: f64 = 1.5;
pub const FIRST_FRAME_SECS: f64 = 3.0;
pub const CAND_SECS: f64 = 2.5;
pub const BACKOFF_MIN: f64 = 10.0;
pub const BACKOFF_MAX: f64 = 300.0;
pub const RETURN_MIN: f64 = 60.0;
pub const MAX_SWITCHES: usize = 6;
pub const SWITCH_WINDOW: f64 = 300.0;
pub const HARD_FAILS: usize = 3;
pub const HARD_WINDOW: f64 = 120.0;

#[derive(Default, Clone)]
struct Per { hard: Vec<f64>, disabled: Option<String>, last_err: Option<String> }

struct Cand { m: Method, since: f64, why: String, returning: bool, frames: u32, black: u32, lit: u32, changed: u32, act_changed: u32 }

pub struct Selector {
    pub mode: Mode,
    pub win11: bool,
    pub window_src: bool,
    order: Vec<Method>,
    per: [Per; 2],
    active: Option<Method>,
    active_since: f64,
    got_first: bool,
    black_since: Option<f64>,
    stale_since: Option<f64>,
    cand: Option<Cand>,
    next_check: f64,
    backoff: f64,
    next_return: f64,
    return_backoff: f64,
    switches: Vec<f64>,
    noted_forced: bool,
    noted_budget: bool,
    /// decisões para o app (eventos JSON "capnote"); o pipeline esvazia e emite
    pub notes: Vec<Value>,
    pub plan_why: String,
}

impl Selector {
    pub fn new(mode: Mode, os_build: u32, window_src: bool) -> Self {
        let win11 = is_win11(os_build);
        let (order, plan_why) = match mode {
            Mode::Force(m) => (vec![m], format!("forçado nas configurações: só {}", m.id().to_uppercase())),
            Mode::Auto if win11 => (vec![Method::Wgc, Method::Dxgi], format!("Windows 11 (build {os_build}): WGC primeiro (isola a janela, sem borda); DXGI de reserva")),
            Mode::Auto => (vec![Method::Dxgi, Method::Wgc], format!("Windows 10 (build {os_build}): DXGI primeiro (sem borda amarela e segue funcionando em tela cheia exclusiva); WGC de reserva")),
        };
        Self { mode, win11, window_src, order, per: Default::default(), active: None, active_since: 0.0, got_first: false, black_since: None, stale_since: None, cand: None,
            next_check: 0.0, backoff: BACKOFF_MIN, next_return: 0.0, return_backoff: RETURN_MIN, switches: vec![], noted_forced: false, noted_budget: false, notes: vec![], plan_why }
    }
    pub fn order(&self) -> Vec<Method> { self.order.clone() }
    pub fn active(&self) -> Option<Method> { self.active }
    pub fn candidate(&self) -> Option<Method> { self.cand.as_ref().map(|c| c.m) }
    pub fn forced(&self) -> bool { matches!(self.mode, Mode::Force(_)) }
    pub fn usable(&self, m: Method) -> bool { self.order.contains(&m) && self.per[m.i()].disabled.is_none() }
    pub fn disabled_why(&self, m: Method) -> Option<String> { self.per[m.i()].disabled.clone() }
    fn note(&mut self, now: f64, msg: String) { self.notes.push(json!({ "t": "capnote", "at": r1(now), "msg": msg })); }
    fn budget_ok(&mut self, now: f64) -> bool { self.switches.retain(|&t| now - t < SWITCH_WINDOW); self.switches.len() < MAX_SWITCHES }

    /// primeiro método ainda não testado/desligado, na ordem; None = nenhum
    pub fn next_to_open(&self) -> Option<Method> { self.order.iter().copied().find(|&m| self.usable(m) && Some(m) != self.active) }

    /// a fonte `m` abriu e passou a ser a ativa
    pub fn opened(&mut self, now: f64, m: Method) {
        self.active = Some(m); self.active_since = now; self.got_first = false; self.black_since = None; self.stale_since = None; self.cand = None;
    }
    /// não abriu: conta como erro do método e diz o que fazer
    pub fn open_failed(&mut self, now: f64, m: Method, why: &str) -> Action {
        self.hard(now, m, why);
        if self.cand.as_ref().map(|c| c.m) == Some(m) { self.cand = None; self.bump_backoff(now); return Action::None; }
        // troca a frio: a ativa já morreu e a substituta não abriu -> não há com o que continuar
        if self.active.is_some() { return self.give_up(); }
        match self.next_to_open() {
            Some(n) if !self.forced() => Action::SwitchCold(n, format!("{} não abriu: {why}", m.id().to_uppercase())),
            _ => self.give_up(),
        }
    }
    fn hard(&mut self, now: f64, m: Method, why: &str) {
        let p = &mut self.per[m.i()];
        p.hard.retain(|&t| now - t < HARD_WINDOW); p.hard.push(now); p.last_err = Some(why.to_string());
        if p.hard.len() >= HARD_FAILS || why.starts_with("indisponivel:") {
            let w = why.trim_start_matches("indisponivel:").trim().to_string();
            if p.disabled.is_none() { p.disabled = Some(w.clone()); self.note(now, format!("{} desligado nesta transmissão: {w}", m.id().to_uppercase())); }
        }
    }
    fn give_up(&mut self) -> Action {
        let parts: Vec<String> = [Method::Wgc, Method::Dxgi].iter().filter(|m| self.order.contains(m)).map(|m| format!("{}: {}", m.id().to_uppercase(), self.per[m.i()].disabled.clone().or(self.per[m.i()].last_err.clone()).unwrap_or_else(|| "sem erro registrado".into()))).collect();
        Action::GiveUp(format!("nenhum metodo de captura nativa funcionou ({})", parts.join("; ")))
    }
    fn bump_backoff(&mut self, now: f64) { self.next_check = now + self.backoff; self.backoff = (self.backoff * 2.0).min(BACKOFF_MAX); }

    /// a fonte ativa deu erro que ela mesma não resolveu (já tentou recriar)
    pub fn active_error(&mut self, now: f64, why: &str) -> Action {
        let Some(a) = self.active else { return Action::None };
        self.hard(now, a, why);
        if let Some(c) = &self.cand { if c.frames > 0 && c.lit > 0 { return Action::Promote(format!("{} falhou: {why}", a.id().to_uppercase())); } }
        self.cand = None;
        if self.forced() { return self.give_up(); }
        let o = a.other();
        if !self.usable(o) || !self.budget_ok(now) { return self.give_up(); }
        Action::SwitchCold(o, format!("{} falhou: {why}", a.id().to_uppercase()))
    }

    /// observação da fonte ativa
    pub fn tick(&mut self, now: f64, h: &Health) -> Action {
        let Some(a) = self.active else { return Action::None };
        if h.frames > 0 { self.got_first = true; }
        if !self.got_first && now - self.active_since >= FIRST_FRAME_SECS {
            self.got_first = true; // um aviso só
            return self.active_error(now, &format!("nenhum quadro em {FIRST_FRAME_SECS} s"));
        }
        if let Some(c) = &mut self.cand { c.act_changed += h.changed; }
        // preto: as leituras da sonda deste intervalo foram todas pretas
        if h.black > 0 && h.lit == 0 { self.black_since.get_or_insert(now); } else if h.lit > 0 { self.black_since = None; }
        // parado: devia mudar e não veio quadro novo (ou veio igual)
        let still = h.frames == 0 || (h.changed == 0 && h.black + h.lit > 0);
        if h.expect_motion && still { self.stale_since.get_or_insert(now); } else { self.stale_since = None; }
        let stale_lim = if !self.win11 && a == Method::Wgc && h.exclusive { STALE_SECS_EXCLUSIVE_W10 } else { STALE_SECS };
        let trig = if self.black_since.map(|t| now - t >= BLACK_SECS).unwrap_or(false) { Some(("black", format!("{} com tela preta há {:.0} s", a.id().to_uppercase(), now - self.black_since.unwrap()))) }
            else if self.stale_since.map(|t| now - t >= stale_lim).unwrap_or(false) { Some(("stale", format!("{} com imagem parada há {:.1} s{}", a.id().to_uppercase(), now - self.stale_since.unwrap(), if h.exclusive { " (jogo em tela cheia exclusiva)" } else { " (tela cheia na frente)" }))) }
            else { None };
        if self.cand.is_some() { return Action::None; }
        if let Some((_, why)) = trig {
            if self.forced() { if !self.noted_forced { self.noted_forced = true; self.note(now, format!("{why}; método forçado nas configurações, sem troca")); } return Action::None; }
            let o = a.other();
            if now < self.next_check || !self.usable(o) { return Action::None; }
            if !self.budget_ok(now) { if !self.noted_budget { self.noted_budget = true; self.note(now, format!("{why}; limite de {MAX_SWITCHES} trocas em {SWITCH_WINDOW:.0} s atingido, mantendo {}", a.id().to_uppercase())); } return Action::None; }
            self.cand = Some(Cand { m: o, since: now, why: why.clone(), returning: false, frames: 0, black: 0, lit: 0, changed: 0, act_changed: 0 });
            return Action::OpenCandidate(o, format!("{why}: testando {} ao lado", o.id().to_uppercase()));
        }
        // de volta ao WGC: só faz diferença para janela (o DXGI recorta e mostra o que estiver por cima; o WGC isola a
        // janela). Só quando o WGC é o preferido (Windows 11) e depois de RETURN_MIN s, dobrando a cada tentativa.
        let pref = self.order[0];
        if !self.forced() && self.window_src && pref == Method::Wgc && a != pref && self.usable(pref) && !h.exclusive && now >= self.next_return && self.budget_ok(now) && self.black_since.is_none() {
            self.next_return = now + self.return_backoff; self.return_backoff = (self.return_backoff * 2.0).min(BACKOFF_MAX);
            self.cand = Some(Cand { m: pref, since: now, why: "voltar ao método preferido".into(), returning: true, frames: 0, black: 0, lit: 0, changed: 0, act_changed: 0 });
            return Action::OpenCandidate(pref, format!("testando a volta para {} (isola a janela)", pref.id().to_uppercase()));
        }
        Action::None
    }

    /// observação do candidato (mesmo intervalo da ativa)
    pub fn cand_tick(&mut self, now: f64, h: &Health) -> Action {
        let Some(c) = &mut self.cand else { return Action::None };
        c.frames += h.frames; c.black += h.black; c.lit += h.lit; c.changed += h.changed;
        let lit_ok = c.lit > 0 && c.lit >= c.black;
        // quando a ativa está mudando, o candidato também tem que mudar (WGC congelado não serve só por não ser preto)
        let motion_ok = if c.act_changed > 0 || self.stale_since.is_some() { c.changed > 0 } else { true };
        let still_bad = c.returning || self.black_since.is_some() || self.stale_since.is_some();
        if c.frames >= 2 && lit_ok && motion_ok && still_bad && now - c.since >= 0.8 {
            let why = if c.returning { format!("{} voltou a funcionar (imagem nova, não preta)", c.m.id().to_uppercase()) } else { format!("{}; {} mostrou imagem {}", c.why, c.m.id().to_uppercase(), if self.stale_since.is_some() { "mudando" } else { "não preta" }) };
            return Action::Promote(why);
        }
        if now - c.since >= CAND_SECS {
            let why = if !still_bad { "a fonte atual se recuperou sozinha".to_string() }
                else if c.frames == 0 { format!("{} não entregou nenhum quadro", c.m.id().to_uppercase()) }
                else if !lit_ok { format!("{} também está preto (provável conteúdo protegido ou tela realmente preta)", c.m.id().to_uppercase()) }
                else { format!("{} também está parado", c.m.id().to_uppercase()) };
            return Action::DropCandidate(why);
        }
        Action::None
    }
    pub fn cand_dropped(&mut self, now: f64, why: &str) {
        let returning = self.cand.as_ref().map(|c| c.returning).unwrap_or(false);
        self.cand = None;
        if !returning { let wait = self.backoff; self.bump_backoff(now); self.note(now, format!("mantido: {why}; nova tentativa em {wait:.0} s no mínimo")); }
    }
    pub fn cand_error(&mut self, now: f64, why: &str) { if let Some(c) = self.cand.take() { self.hard(now, c.m, why); if !c.returning { self.bump_backoff(now); } } }
    /// o candidato virou o ativo
    pub fn promoted(&mut self, now: f64) {
        let Some(c) = self.cand.take() else { return };
        self.switches.push(now);
        if !c.returning { self.backoff = BACKOFF_MIN; self.next_check = now + BACKOFF_MIN; self.next_return = now + self.return_backoff; }
        self.opened(now, c.m); self.got_first = true;
    }
    /// troca a frio concluída (a ativa morreu e `m` abriu)
    pub fn switched_cold(&mut self, now: f64, m: Method) { if self.active.is_some() { self.switches.push(now); self.next_return = now + self.return_backoff; } self.opened(now, m); }
}

fn r1(x: f64) -> f64 { (x * 10.0).round() / 10.0 }

#[cfg(test)]
mod tests {
    use super::*;
    fn ok(frames: u32) -> Health { Health { frames, lit: 2, changed: 2, ..Default::default() } }
    fn black() -> Health { Health { frames: 30, black: 2, ..Default::default() } }
    fn frozen_fs() -> Health { Health { frames: 1, lit: 2, changed: 0, expect_motion: true, exclusive: true, black: 0 } }

    #[test]
    fn ordem_por_windows() {
        assert_eq!(Selector::new(Mode::Auto, 26200, false).order(), vec![Method::Wgc, Method::Dxgi]);
        assert_eq!(Selector::new(Mode::Auto, 19045, false).order(), vec![Method::Dxgi, Method::Wgc]);
        assert_eq!(Selector::new(Mode::Force(Method::Wgc), 19045, false).order(), vec![Method::Wgc]);
    }

    #[test]
    fn falha_ao_abrir_tenta_o_outro_e_depois_desiste() {
        let mut s = Selector::new(Mode::Auto, 26200, false);
        assert_eq!(s.next_to_open(), Some(Method::Wgc));
        assert!(matches!(s.open_failed(0.0, Method::Wgc, "indisponivel: sem WGC"), Action::SwitchCold(Method::Dxgi, _)));
        assert!(matches!(s.open_failed(0.1, Method::Dxgi, "indisponivel: monitor em outra placa"), Action::GiveUp(_)));
    }

    #[test]
    fn tela_preta_testa_o_outro_e_troca_se_ele_mostra_imagem() {
        let mut s = Selector::new(Mode::Auto, 26200, false);
        s.opened(0.0, Method::Wgc);
        let mut t = 0.0; let mut a = Action::None;
        while t < 5.0 { a = s.tick(t, &black()); if a != Action::None { break; } t += 0.5; }
        assert!(matches!(a, Action::OpenCandidate(Method::Dxgi, _)), "{a:?}");
        assert!(t >= BLACK_SECS);
        let _ = s.tick(t + 0.5, &black());
        assert!(matches!(s.cand_tick(t + 0.5, &ok(30)), Action::None)); // espera um pouco
        let p = s.cand_tick(t + 1.0, &ok(30));
        assert!(matches!(p, Action::Promote(_)), "{p:?}");
        s.promoted(t + 1.0);
        assert_eq!(s.active(), Some(Method::Dxgi));
    }

    #[test]
    fn os_dois_pretos_nao_troca_e_espera_cada_vez_mais() {
        let mut s = Selector::new(Mode::Auto, 26200, false);
        s.opened(0.0, Method::Wgc);
        let mut t = 0.0; let mut opens = vec![];
        while t < 200.0 {
            match s.tick(t, &black()) {
                Action::OpenCandidate(..) => opens.push(t),
                _ => {}
            }
            if s.candidate().is_some() { if let Action::DropCandidate(w) = s.cand_tick(t, &black()) { s.cand_dropped(t, &w); } }
            t += 0.5;
        }
        assert_eq!(s.active(), Some(Method::Wgc));
        assert!(opens.len() >= 3 && opens.len() <= 6, "{opens:?}");
        let gaps: Vec<f64> = opens.windows(2).map(|w| w[1] - w[0]).collect();
        assert!(gaps.windows(2).all(|g| g[1] > g[0]), "intervalos crescentes: {gaps:?}");
    }

    #[test]
    fn wgc_congelado_na_exclusiva_do_windows10() {
        // auto no Windows 10 começa no DXGI; se o DXGI falhar e cair no WGC, a exclusiva congela o WGC -> volta ao DXGI
        let mut s = Selector::new(Mode::Auto, 19045, false);
        s.opened(0.0, Method::Wgc);
        let mut t = 0.0; let mut a = Action::None;
        while t < 10.0 { a = s.tick(t, &frozen_fs()); if a != Action::None { break; } t += 0.5; }
        assert!(matches!(a, Action::OpenCandidate(Method::Dxgi, _)));
        assert!(t <= 2.5, "decide rápido na exclusiva do Windows 10: {t}");
        // o candidato também parado -> não troca
        let _ = s.tick(t + 0.5, &frozen_fs());
        let mut d = Action::None; let mut u = t + 0.5;
        while u < t + 4.0 { d = s.cand_tick(u, &frozen_fs()); if d != Action::None { break; } u += 0.5; }
        assert!(matches!(d, Action::DropCandidate(_)), "{d:?}");
    }

    #[test]
    fn imagem_parada_sem_tela_cheia_nao_conta() {
        // área de trabalho parada: o WGC não entrega quadros e isso é normal
        let mut s = Selector::new(Mode::Auto, 26200, false);
        s.opened(0.0, Method::Wgc);
        let _ = s.tick(0.5, &ok(1));
        for i in 2..200 { assert_eq!(s.tick(i as f64 * 0.5, &Health::default()), Action::None); }
    }

    #[test]
    fn forcado_nunca_troca() {
        let mut s = Selector::new(Mode::Force(Method::Wgc), 19045, false);
        s.opened(0.0, Method::Wgc);
        for i in 0..100 { assert_eq!(s.tick(i as f64 * 0.5, &black()), Action::None); }
        assert_eq!(s.notes.len(), 1);
        assert!(matches!(s.active_error(60.0, "x"), Action::GiveUp(_)));
    }

    #[test]
    fn erros_seguidos_tem_limite() {
        let mut s = Selector::new(Mode::Auto, 26200, false);
        s.opened(0.0, Method::Wgc);
        let mut t = 1.0; let mut n = 0;
        loop {
            match s.active_error(t, "erro") {
                Action::SwitchCold(m, _) => { s.switched_cold(t, m); n += 1; }
                Action::GiveUp(_) => break,
                a => panic!("{a:?}"),
            }
            let _ = s.tick(t + 0.1, &ok(5));
            t += 1.0;
            assert!(n < 20, "laço infinito");
        }
        assert!(n <= MAX_SWITCHES);
    }

    #[test]
    fn troca_a_frio_sem_substituto_desiste_na_hora() {
        let mut s = Selector::new(Mode::Auto, 26200, false);
        s.opened(0.0, Method::Wgc);
        assert!(matches!(s.active_error(1.0, "erro"), Action::SwitchCold(Method::Dxgi, _)));
        assert!(matches!(s.open_failed(1.0, Method::Dxgi, "nao abriu"), Action::GiveUp(_)));
    }

    #[test]
    fn sem_quadro_nenhum_na_partida_e_erro() {
        let mut s = Selector::new(Mode::Auto, 26200, false);
        s.opened(0.0, Method::Wgc);
        assert_eq!(s.tick(1.0, &Health::default()), Action::None);
        assert!(matches!(s.tick(3.0, &Health::default()), Action::SwitchCold(Method::Dxgi, _)));
    }

    #[test]
    fn janela_volta_ao_wgc_quando_ele_funciona() {
        let mut s = Selector::new(Mode::Auto, 26200, true);
        s.opened(0.0, Method::Wgc);
        assert!(matches!(s.active_error(1.0, "erro"), Action::SwitchCold(Method::Dxgi, _)));
        s.switched_cold(1.0, Method::Dxgi);
        let mut t = 1.5; let mut a = Action::None;
        while t < 200.0 { a = s.tick(t, &ok(30)); if a != Action::None { break; } t += 0.5; }
        assert!(matches!(a, Action::OpenCandidate(Method::Wgc, _)), "{a:?}");
        let _ = s.tick(t + 0.5, &ok(30));
        let p = s.cand_tick(t + 1.0, &ok(30));
        assert!(matches!(p, Action::Promote(_)), "{p:?}");
    }

    #[test]
    fn windows10_janela_nao_volta_para_o_dxgi_que_falhou() {
        let mut s = Selector::new(Mode::Auto, 19045, true);
        s.opened(0.0, Method::Dxgi);
        assert!(matches!(s.active_error(2.0, "erro"), Action::SwitchCold(Method::Wgc, _)));
        s.switched_cold(2.0, Method::Wgc);
        for i in 5..2000 { assert_eq!(s.tick(i as f64 * 0.5, &ok(30)), Action::None, "t={}", i as f64 * 0.5); }
    }

    #[test]
    fn volta_ao_wgc_espera_antes() {
        let mut s = Selector::new(Mode::Auto, 26200, true);
        s.opened(0.0, Method::Wgc);
        let _ = s.active_error(1.0, "erro"); s.switched_cold(1.0, Method::Dxgi);
        let mut t = 1.5;
        while t < 400.0 { if let Action::OpenCandidate(Method::Wgc, _) = s.tick(t, &ok(30)) { break; } t += 0.5; }
        assert!(t >= 1.0 + RETURN_MIN, "{t}");
    }

    #[test]
    fn candidato_parado_nao_substitui_ativa_em_movimento() {
        let mut s = Selector::new(Mode::Auto, 26200, true);
        s.opened(0.0, Method::Wgc);
        let _ = s.active_error(1.0, "erro"); s.switched_cold(1.0, Method::Dxgi);
        let mut t = 1.5;
        while t < 200.0 { if s.tick(t, &ok(30)) != Action::None { break; } t += 0.5; }
        let mut d = Action::None; let mut u = t;
        while u < t + 4.0 { let _ = s.tick(u, &ok(30)); d = s.cand_tick(u, &Health { frames: 1, lit: 2, changed: 0, ..Default::default() }); if d != Action::None { break; } u += 0.5; }
        assert!(matches!(d, Action::DropCandidate(_)), "{d:?}");
    }
}
