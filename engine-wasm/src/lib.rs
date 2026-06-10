//! TypeScript-facing wasm boundary over the pure `baccarat-engine` Session.
//!
//! Money note: a direct `i64` method param (e.g. `place_bet(amount)`) crosses to
//! JS as a `bigint`. An `i64` *field* inside a returned snapshot (e.g.
//! `RoundSnapshot.bankroll`) crosses as a JS `number` (serde-wasm-bindgen default;
//! lossless below 2^53, which covers all realistic cent amounts).

use baccarat_engine::glossary::{glossary as engine_glossary, GlossaryEntry};
use baccarat_engine::scoreboard::Side;
use baccarat_engine::session::{
    BetKind, CommandError, RoundSnapshot, Session, SessionConfig,
};
use serde::Serialize;
use tsify_next::Tsify;
use wasm_bindgen::prelude::*;

/// Newtype so `glossary()` returns a single tsify ABI type (a `GlossaryEntry[]`)
/// rather than a bare `Vec`, which wasm-bindgen marshals less reliably.
#[derive(Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Glossary(pub Vec<GlossaryEntry>);

/// Map an engine `CommandError` into a thrown JS value (a typed object the
/// front-end `catch`es).
fn to_js_err(err: CommandError) -> JsValue {
    serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub struct WasmSession {
    inner: Session,
}

#[wasm_bindgen]
impl WasmSession {
    #[wasm_bindgen(constructor)]
    pub fn new(config: SessionConfig) -> WasmSession {
        console_error_panic_hook::set_once();
        WasmSession {
            inner: Session::new(config),
        }
    }

    pub fn snapshot(&self) -> RoundSnapshot {
        self.inner.snapshot()
    }

    pub fn place_bet(&mut self, kind: BetKind, amount: i64) -> Result<RoundSnapshot, JsValue> {
        self.inner.place_bet(kind, amount).map_err(to_js_err)
    }

    pub fn clear_bets(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.clear_bets().map_err(to_js_err)
    }

    pub fn deal_round(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.deal_round().map_err(to_js_err)
    }

    pub fn peek(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, JsValue> {
        self.inner.peek(hand, index).map_err(to_js_err)
    }

    pub fn reveal(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, JsValue> {
        self.inner.reveal(hand, index).map_err(to_js_err)
    }

    pub fn settle(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.settle().map_err(to_js_err)
    }

    pub fn new_shoe(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.new_shoe().map_err(to_js_err)
    }
}

#[wasm_bindgen]
pub fn glossary() -> Glossary {
    Glossary(engine_glossary())
}

#[cfg(test)]
mod tests {
    use super::*;
    use baccarat_engine::session::PhaseTag;
    use baccarat_engine::settle::{BetSpot, Ruleset};
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test]
    fn new_session_starts_in_betting() {
        let session = WasmSession::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: Ruleset::Commission,
            seed: 7,
        });
        let snap = session.snapshot();
        assert_eq!(snap.phase, PhaseTag::Betting);
        assert_eq!(snap.bankroll, 100_000);
    }

    #[wasm_bindgen_test]
    fn full_round_reaches_settled() {
        let mut session = WasmSession::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: Ruleset::Commission,
            seed: 7,
        });
        session
            .place_bet(BetKind::Main(BetSpot::Player), 500)
            .expect("bet accepted");
        session.deal_round().expect("deal");
        let snap = session.settle().expect("settle");
        assert_eq!(snap.phase, PhaseTag::Settled);
        assert!(snap.outcome.is_some());
        assert!(snap.payouts.is_some());
    }

    #[wasm_bindgen_test]
    fn wrong_phase_command_throws() {
        let mut session = WasmSession::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: Ruleset::Commission,
            seed: 7,
        });
        // settle() before any deal is the wrong phase -> Err -> thrown JsValue.
        let result = session.settle();
        assert!(result.is_err(), "expected a thrown error for wrong-phase settle");
    }

    #[wasm_bindgen_test]
    fn glossary_export_is_nonempty_and_has_monkey() {
        let Glossary(entries) = glossary();
        assert!(entries.len() >= 20);
        assert!(entries.iter().any(|e| e.term == "monkey"));
    }
}

// ---------------------------------------------------------------------------
// Single-player table: the SAME multiplayer rules engine with one seat. You
// squeeze the sides you bet; the unbet hands are the house dealer's, exposed
// via dealer_flip_one so the front-end can pace him.
// ---------------------------------------------------------------------------

use baccarat_engine::table::{Table, TableConfig, TableError, TableView};

fn table_err(err: TableError) -> JsValue {
    serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub struct WasmTable {
    inner: Table,
    me: baccarat_engine::table::PlayerId,
}

#[wasm_bindgen]
impl WasmTable {
    /// A one-seat table: `buy_in` cents are the sole player's bankroll.
    #[wasm_bindgen(constructor)]
    pub fn new(config: TableConfig, seed: u64, buy_in: i64) -> WasmTable {
        console_error_panic_hook::set_once();
        let mut inner = Table::new(config, seed);
        let me = inner.join("You", buy_in).expect("fresh table has a seat");
        WasmTable { inner, me }
    }

    pub fn view(&self) -> Result<TableView, JsValue> {
        self.inner.view_for(self.me).map_err(table_err)
    }

    pub fn place_bet(&mut self, kind: BetKind, amount: i64) -> Result<TableView, JsValue> {
        self.inner.place_bet(self.me, kind, amount).map_err(table_err)?;
        self.view()
    }

    pub fn clear_bets(&mut self) -> Result<TableView, JsValue> {
        self.inner.clear_bets(self.me).map_err(table_err)?;
        self.view()
    }

    pub fn deal(&mut self) -> Result<TableView, JsValue> {
        self.inner.deal().map_err(table_err)?;
        self.view()
    }

    pub fn peek(&mut self, hand: Side, index: usize) -> Result<TableView, JsValue> {
        self.inner.peek(self.me, hand, index).map_err(table_err)?;
        self.view()
    }

    pub fn reveal(&mut self, hand: Side, index: usize) -> Result<TableView, JsValue> {
        self.inner.reveal(self.me, hand, index).map_err(table_err)?;
        self.view()
    }

    pub fn settle(&mut self) -> Result<TableView, JsValue> {
        self.inner.settle().map_err(table_err)?;
        self.view()
    }

    pub fn new_shoe(&mut self) -> Result<TableView, JsValue> {
        self.inner.new_shoe().map_err(table_err)?;
        self.view()
    }

    pub fn dealer_flip_pending(&self) -> bool {
        self.inner.dealer_flip_pending()
    }

    /// Which hand the dealer would turn next ("Player"/"Banker"), if any.
    pub fn dealer_next_side(&self) -> Option<Side> {
        self.inner.dealer_next_side()
    }

    /// The dealer turns one card; the caller paces the beat.
    pub fn dealer_flip_one(&mut self) -> Result<TableView, JsValue> {
        self.inner.dealer_flip_one();
        self.view()
    }
}
