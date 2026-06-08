# Game Session — Engine Design (Plan 4 of the WASM-boundary split)

**Date:** 2026-06-08
**Status:** Approved
**Parent spec:** `2026-06-07-baccarat-simulator-design.md` (§2 Engine ↔ front-end boundary)

## 1. Purpose

The engine today is a set of pure, stateless functions (rules, settlement, side bets,
scoreboard). The front-ends need a **command/snapshot** interface: they send commands
(`place_bet`, `deal_round`, `peek`, `reveal`, `settle`, `new_shoe`) and render a
serializable snapshot. That requires a **stateful game session** that owns the shoe,
bankroll, staged bets, the in-flight round, and per-card reveal state.

This spec covers the session as **pure Rust** (Plan 4), fully unit-testable with native
`cargo test`. The wasm-bindgen binding, serde serialization, packaging, and the glossary
data are deferred to **Plan 5** so the heavy logic is isolated from toolchain setup.

## 2. Scope

In scope (Plan 4):
- A `Session` struct with an explicit phase state machine.
- Commands: `place_bet`, `clear_bets`, `deal_round`, `peek`, `reveal`, `settle`, `new_shoe`.
- A serializable `RoundSnapshot` (plain Rust structs; serde derives added in Plan 5).
- Per-card reveal state (FaceDown → Peeked → FaceUp) with identity hiding.
- Structured, language-neutral `Event` tags (narration/teaching source).
- Typed `CommandError`; no panics on any command path.
- Bankroll + table-limit validation.
- Embedded `ScoreboardSnapshot` driven by accumulated round history.

Out of scope (Plan 5 and later): wasm-bindgen exports, serde/JSON serialization,
`wasm-pack` build, the glossary term data, dealer narration prose, simulated other
players, and "live house edge" computation.

## 3. Architecture

New module `engine/src/session.rs`, declared `pub mod session;` in `lib.rs`. Builds on
the existing pure modules without changing them:
`shoe::Shoe`, `round::{play_round, RoundResult, Outcome}`, `settle::{Bet, BetSpot, Ruleset, settle_with}`,
`sidebets::{SideBet, BetSide, settle_side}`, `scoreboard::{RoundRecord, ScoreboardSnapshot, derive_scoreboard, Side}`,
`card::Card`, `hand::Hand`.

**Approach: explicit phase state machine.** The session persists across rounds; an
in-flight round lives in the `phase`. Commands are legal only in specific phases and
validate fully before mutating, so an `Err` leaves state unchanged.

```rust
pub struct Session {
    shoe: Shoe,
    bankroll: i64,               // cents
    config: SessionConfig,
    history: Vec<RoundRecord>,   // feeds derive_scoreboard
    phase: Phase,
}

pub struct SessionConfig {
    pub starting_bankroll: i64,  // cents
    pub table_min: i64,
    pub table_max: i64,
    pub ruleset: Ruleset,        // Commission | EzBaccarat
    pub seed: u64,               // for the initial + reshuffled shoes (deterministic)
}

enum Phase {
    Betting { bets: Vec<PlacedBet> },
    Dealing { round: RoundResult, reveal: RevealState, bets: Vec<PlacedBet> },
}
```

`Session::new(config)` starts in `Betting { bets: [] }` with `bankroll = starting_bankroll`
and a `Shoe::new_seeded(config.seed)`.

### Lifecycle

```
Betting --deal_round--> Dealing --settle--> Betting
   ^  place_bet / clear_bets        peek / reveal
```

- **place_bet(bet):** legal in `Betting`. Validates table min/max and that the sum of
  staged stakes does not exceed `bankroll`. Stages a `PlacedBet`.
- **clear_bets():** legal in `Betting`. Empties staged bets.
- **deal_round():** legal in `Betting`, requires ≥1 bet. Draws the full round via
  `play_round(&mut shoe)` (atomic resolution — third cards already decided), sets every
  card FaceDown, → `Dealing`.
- **peek(hand, index) / reveal(hand, index):** legal in `Dealing`. Advance one card's
  status (peek: FaceDown→Peeked; reveal: any→FaceUp). Out-of-range index → error.
- **settle():** legal in `Dealing`. Auto-reveals remaining cards, computes payouts
  (`settle_with` for the main bet, `settle_side` for side bets), updates `bankroll`,
  appends `RoundRecord::from_round(&round)` to `history`, → `Betting`.
- **new_shoe():** legal in `Betting`. Replaces the shoe with a fresh seeded shoe;
  bankroll and history persist. Also auto-invoked inside `deal_round` when the shoe lacks
  enough cards for a worst-case 6-card round.

## 4. Snapshot (state out)

`RoundSnapshot` is the single serializable view; unrevealed cards hide identity.

```rust
pub struct RoundSnapshot {
    pub phase: PhaseTag,                  // Betting | Dealing | Settled
    pub player: HandView,
    pub banker: HandView,
    pub bets: Vec<PlacedBet>,
    pub bankroll: i64,
    pub table_min: i64,
    pub table_max: i64,
    pub outcome: Option<Outcome>,         // Some once the round is fully revealed/settled
    pub payouts: Option<Vec<BetPayout>>,  // per-bet net cents, after settle
    pub events: Vec<Event>,
    pub scoreboard: ScoreboardSnapshot,   // derive_scoreboard(&history)
    pub explain: Vec<String>,             // RoundResult.trace; empty in Betting
}

pub struct HandView {
    pub cards: Vec<CardView>,
    pub total: Option<u8>,                // None until every card is FaceUp
}

pub enum CardView {
    FaceDown,
    Peeked { sliver: Pip },               // a corner-pip hint for the squeeze
    FaceUp(Card),
}

pub struct PlacedBet { pub kind: BetKind, pub amount: i64 }   // amount in cents
pub enum BetKind { Main(BetSpot), Side(SideBet) }
pub struct BetPayout { pub bet: PlacedBet, pub net: i64 }     // net cents (profit/loss/push)

pub enum PhaseTag { Betting, Dealing, Settled }
```

`PhaseTag::Settled` is the snapshot returned by `settle()` (the session itself has already
transitioned back to `Betting` for the next round; `Settled` tells the front-end "show the
result of the round that just finished").

**Reveal/hiding rules:**
- A hand's `total` is `None` while any of its cards is not `FaceUp`. The front-end cannot
  show a total the player has not revealed.
- `Peeked` exposes only a `Pip` sliver, never the full `Card`.
- `outcome` is `None` until both hands are fully revealed (or `settle` forced reveal).

**`Pip`** is a minimal hint type (e.g. the rank's pip shape / a coarse rank class) defined
in `session.rs`. It must not let the front-end reconstruct the exact card before reveal;
the simplest honest sliver is the card's suit-color or a "low/high pip" class. The plan
will pin the exact `Pip` content; default: the card's `Suit` only (color/symbol), which is
what a real corner-squeeze shows first.

## 5. Events (structured tags)

Language-neutral; front-ends render narration and glossary highlights from them. Emitted
progressively — a tag tied to a card only appears once that card is `FaceUp`.

```rust
pub enum Event {
    Natural { side: Side, total: u8 },         // two-card 8 or 9
    Monkey { hand: Side, index: usize },       // a revealed 10/J/Q/K (value 0) — flavor only
    Pair { side: Side },                       // a hand's first two cards match
    ThirdCard { side: Side, reason: String },  // mirrors the draw trace
    Win { winner: Outcome, player: u8, banker: u8 },
}
```

Note on **Monkey**: a "monkey" is any 10/J/Q/K — a zero-value card. It is pure flavor and
never changes a total; the tag simply marks that such a card is now showing.

## 6. Error model

```rust
pub enum CommandError {
    WrongPhase { expected: PhaseTag, found: PhaseTag },
    BetBelowMinimum { min: i64, got: i64 },
    BetAboveMaximum { max: i64, got: i64 },
    InsufficientBankroll { needed: i64, have: i64 },
    NoBetsPlaced,
    BadCardIndex { hand: Side, index: usize },
}
```

Every command returns `Result<RoundSnapshot, CommandError>`. Validation precedes mutation,
so an `Err` leaves the session unchanged. No command path may `panic!`.

## 7. Testing strategy (native `cargo test`)

- **Lifecycle:** happy path bet → deal → reveal all → settle, asserting end-to-end
  bankroll math; correct phase transitions; each illegal command in the wrong phase
  returns the matching `WrongPhase`.
- **Validation:** below-min, above-max, over-bankroll, and no-bets-placed each rejected
  with state unchanged (snapshot bankroll/bets identical before and after the `Err`).
- **Reveal layer:** `total` stays `None` until full reveal; `peek` yields a sliver and
  never a `FaceUp`; unrevealed cards never expose identity; `settle` auto-reveals all.
- **Events:** `Natural`, `Monkey` (on a revealed face/10), and `Pair` fire exactly when
  expected and only after the relevant card is `FaceUp`.
- **Integration / determinism:** a seeded multi-round session is reproducible; the
  embedded `ScoreboardSnapshot` matches `derive_scoreboard(&history)`; multi-round bankroll
  equals hand-computed payouts for a fixed seed.

## 8. Open items

- Exact `Pip` sliver content (default: suit only) — pinned in the implementation plan.
- serde derives / JSON shape, wasm-bindgen exports, glossary data, narration prose →
  Plan 5 and beyond.
