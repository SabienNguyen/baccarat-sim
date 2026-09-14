# Shoe Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shoe only changes at the cut card (one more hand, then a fresh shoe) or after a majority New Shoe vote, and every new shoe is cut by the table host through a real cut + burn ceremony, in solo and multiplayer.

**Architecture:** The engine owns every rule (new `ShoeCut` phase, host, cut, vote, cut-card-out) in both `Session` and `Table`, exposed through a shared `ShoeView`; the server relays commands, runs the 30 s vote timer and announces; the web mounts one `ShoeCutStage` overlay for the ceremony and replays the cut/burn animation from the view for everyone.

**Tech Stack:** Rust engine (`engine/`), wasm-bindgen + tsify (`engine-wasm/`), axum WebSocket server (`server/`), React/TypeScript + vitest + Playwright (`web/`, `scripts/`).

**Spec:** `docs/superpowers/specs/2026-09-14-shoe-lifecycle-design.md`

## Global Constraints

- Branch `feat/shoe-lifecycle`, worktree `.claude/worktrees/shoe`. `CARGO_TARGET_DIR=/home/sabien/Dev/personal/baccarat-simulator/target`. Never push, never `git stash`, never kill processes you did not start, no `npm install`.
- TDD: failing test → implement → whole suite green. Engine: `cargo test --workspace`. Web: `cd web && npx vitest run && npx tsc --noEmit`. Rebuild wasm (`npm run build:wasm` at the worktree root) after any engine change before running web tests.
- Cut position is `u16` in `0..=1000`, clamped by the engine to `50..=950`. `CUT_CARD` stays 14; its compile-time assert becomes `>= 12`.
- Vote passes on strict majority of seated players (`yes * 2 > seats`), fails when `no * 2 >= seats` or on expiry (30 s, server-side).
- Host = first player to join; on host leave the next seat by join order. The host is always the cutter.
- Phase tag string on the wire and in TS: `"ShoeCut"`.
- Commit messages end with the session trailer (see the dispatch brief).

---

## File map

| Area | File | Responsibility |
|---|---|---|
| Engine | `engine/src/shoe.rs` | `Shoe::new_cut`, `CutReveal`, clamp |
| Engine | `engine/src/session.rs` | `PhaseTag::ShoeCut`, `ShoeCutReason`, `ShoeView`, `CutReveal` re-export, solo lifecycle |
| Engine | `engine/src/table.rs` | table lifecycle: host, cutter, cut, cut-card-out, vote, views |
| wasm | `engine-wasm/src/lib.rs` | `cut_shoe`, `request_new_shoe`, `propose_new_shoe`, `vote_new_shoe`, `vote_expire` |
| Server | `server/src/protocol.rs`, `main.rs`, `rooms.rs` | messages, handlers, announcements, vote timer |
| Web | `web/src/engine/types.ts`, `engine/adapter.ts`, `store/gameStore.ts`, `multiplayer/protocol.ts`, `multiplayer/remoteStore.ts` | types + store actions |
| Web | `web/src/components/ShoeCutStage.tsx` + `shoecut.css` + test | the ceremony (cutter UI, waiting view, animation) |
| Web | `web/src/components/Controls.tsx`, `SeatsStrip.tsx`, `Hud.tsx`, `RoadsModal.tsx`, `narrate.ts`, `App.tsx` | wiring: vote UI, LAST HAND, shoe row, dealer lines |
| Probes | `scripts/shoe-probe.mjs`, `docs/TESTING.md`, `docs/BACKLOG.md` | end-to-end checks + docs |

Dependency order: T1 → (T2 ∥ T4) → T3 → T5 ∥ T6 → T7 → (T8 ∥ T9) → T10.

---

### Task 1: `Shoe::new_cut` and `CutReveal`

**Files:**
- Modify: `engine/src/shoe.rs`
- Test: `engine/src/shoe.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces:
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
  #[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
  #[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
  pub struct CutReveal { pub position: u16, pub turned: Card, pub burned: u8 }
  pub const CUT_MIN: u16 = 50; pub const CUT_MAX: u16 = 950;
  pub fn clamp_cut(position: u16) -> u16;                      // 50..=950
  impl Shoe { pub fn new_cut(seed: u64, position: u16) -> (Shoe, CutReveal); }
  ```
  `new_cut` = shuffle as `new_seeded` does, then `rotate_left(idx)` on the card vector where the TOP of the shoe is the END of the vector (`draw` pops), so the packet above the cut goes to the bottom: `let idx = (clamp_cut(position) as usize * cards.len()) / 1000; cards.rotate_right(idx);` (rotate_right moves the last `idx` cards, i.e. the top packet, to the front/bottom). Then `burn()` returning `(turned, burned)`. `new_seeded` stays (tests use it) and becomes `new_cut(seed, 500).0`-equivalent only if trivial; otherwise leave it alone.
- `const _: () = assert!(CUT_CARD >= 12, ...)`.

- [ ] Write failing tests: `cut_position_is_clamped_to_the_pit_range` (0→50, 1000→950, 500→500); `same_seed_different_cut_differs_after_the_cut` (seeds equal, positions 200 vs 800: the first drawn card differs, and drawing all cards yields the same multiset); `cut_reveal_matches_the_burn` (`burned` == turned card's value, 10 for tens/faces; `remaining() == 416 - 1 - burned`); `cut_is_deterministic` (same seed+position twice → identical draw order).
- [ ] Run `cargo test -p baccarat-engine shoe` → FAIL (missing symbols).
- [ ] Implement; `burn` returns `(Card, u8)`.
- [ ] Run → PASS. `cargo test --workspace` green.
- [ ] Commit `engine: Shoe::new_cut — a real cut position and a recorded burn`.

### Task 2: Table lifecycle — ShoeCut phase, host, cut, cut-card-out

**Files:**
- Modify: `engine/src/session.rs` (shared types only: `PhaseTag::ShoeCut`, `ShoeCutReason`, `ShoeView`, `VoteView`), `engine/src/table.rs`
- Test: `engine/src/table.rs` tests

**Interfaces:**
- Produces (in `session.rs`, all `Serialize, Deserialize, Tsify` like `PhaseTag`):
  ```rust
  pub enum PhaseTag { ShoeCut, Betting, Dealing, Settled }
  pub enum ShoeCutReason { NewTable, CutCardOut, Vote, Requested }
  pub struct VoteView { pub proposer: PlayerId, pub yes: Vec<PlayerId>, pub no: Vec<PlayerId>, pub needed: u8 }
  pub struct ShoeView { pub number: u32, pub cut_card_out: bool, pub cut_reason: Option<ShoeCutReason>,
                        pub cutter: Option<PlayerId>, pub last_cut: Option<CutReveal>, pub vote: Option<VoteView> }
  ```
  (`PlayerId` lives in table.rs today — move the type alias/struct to session.rs or re-export; keep the public path `baccarat_engine::table::PlayerId` working.)
- Produces (table.rs):
  ```rust
  enum Phase { ShoeCut { reason: ShoeCutReason }, Betting, Dealing {..} }
  pub struct Table { .. host: Option<PlayerId>, shoe_number: u32, cut_card_out: bool, last_cut: Option<CutReveal>, .. }
  impl Table {
      pub fn host(&self) -> Option<PlayerId>;
      pub fn cut_shoe(&mut self, pid: PlayerId, position: u16) -> Result<(), TableError>;   // Err(NotYourCut) / WrongPhase
      pub fn shoe_number(&self) -> u32;
  }
  pub enum TableError { .., NotYourCut }
  TableView { .., pub shoe: ShoeView }   SeatView { .., pub host: bool }
  ```
  `new_shoe()` and the deal-time `if remaining <= CUT_CARD { reshuffle }` are REMOVED. `Table::new` starts in `ShoeCut { NewTable }` with an EMPTY shoe placeholder (`Shoe::new_seeded(seed)` is fine as a placeholder; it is replaced by the first cut). `settle()` ends with the 2.3 rule. `join` sets `host` if `None`. `leave` reassigns host to the lowest-join-order remaining seat and never touches shoe/history/phase. Every command other than rename/rebuy/join/leave/cut returns `WrongPhase { expected: Betting, found: ShoeCut }` in ShoeCut (extend `PhaseTag` usage in `WrongPhase.found`).
  `cut_shoe`: `shoe_number += 1; let (shoe, reveal) = Shoe::new_cut(self.seed.wrapping_add(self.shoe_number as u64), position); self.shoe = shoe; self.last_cut = Some(reveal); self.history.clear(); self.cut_card_out = false; self.last_outcome = None; self.last_round = None; self.settled_on_felt = false;` plus per-player `bets.clear(); ready = false; sitting_out = false; payouts = None;` then `phase = Betting`. Scoreboard memo must invalidate on `history.clear()` (it is keyed on length — key it on `(shoe_number, len)`).

- [ ] Failing tests: `a_new_table_starts_in_shoe_cut_with_no_cutter`; `first_join_becomes_host_and_cutter`; `only_the_host_may_cut` (other seat → `NotYourCut`); `cut_moves_to_betting_and_numbers_the_shoe` (number 1, `last_cut.is_some()`, view.phase == ShoeCut before / Betting after); `betting_is_refused_in_shoe_cut`; `host_leaving_hands_the_cut_to_the_next_seat`; `leaving_never_changes_the_shoe` (deal a few coups; leave; `shoe_number` and `history.len()` unchanged); `cut_card_out_allows_exactly_one_more_hand` (drive coups until `view.shoe.cut_card_out`; one more deal+settle succeeds; then phase is `ShoeCut { CutCardOut }` and `deal()` is `WrongPhase`); `cut_after_shoe_end_clears_the_roads` (`scoreboard.big_road.columns.is_empty()` after the cut, `number == 2`); `the_shoe_never_reshuffles_silently` (play 200 coups with cuts only when the phase demands them; assert `shoe_number` increments only across a `cut_shoe` call). Update existing tests that construct a table to call `let p = t.join(..); t.cut_shoe(p, 500).unwrap();` via a shared helper `fn open_table(seed) -> (Table, PlayerId)`.
- [ ] Run → FAIL. Implement. Run `cargo test --workspace` → PASS (server tests will break: fix ONLY compile errors in server tests by adding the cut; behaviour changes are Task 5).
- [ ] Commit `engine: Table shoe lifecycle — ShoeCut phase, host cut, cut-card end`.

### Task 3: Table New Shoe vote

**Files:** `engine/src/table.rs` (+ tests)

**Interfaces:**
- Produces:
  ```rust
  impl Table {
      pub fn propose_new_shoe(&mut self, pid: PlayerId) -> Result<(), TableError>; // Betting only; Err(VoteOpen) if one is open
      pub fn vote_new_shoe(&mut self, pid: PlayerId, yes: bool) -> Result<(), TableError>; // Err(NoVote)
      pub fn vote_expire(&mut self);            // no-op without a vote
      pub fn vote_open(&self) -> bool;
  }
  pub enum TableError { .., VoteOpen, NoVote }
  ```
  Resolution rule from Global Constraints; `needed = seats / 2 + 1`. Pass → clear+refund every seat's bets (bets are only staged, so `bets.clear()` refunds by construction), `ready=false`, phase `ShoeCut { Vote }`, `vote = None`. Fail/expire → `vote = None`. `leave` removes the leaver from yes/no and re-resolves.

- [ ] Failing tests: `proposer_counts_as_yes_and_a_lone_seat_passes_immediately`; `majority_of_three_passes_on_the_second_yes`; `two_nos_of_three_fail`; `expire_fails_an_open_vote`; `a_vote_needs_betting_phase`; `voter_leaving_recounts` (3 seats: proposer yes, one leaves → 2 seats, 1 yes → not yet majority… 1*2 > 2 is false; the remaining seat votes yes → passes); `pass_returns_staged_bets_and_moves_to_shoe_cut` (bankroll unchanged, `bets.is_empty()`, phase ShoeCut{Vote}, cutter == host).
- [ ] Run → FAIL. Implement. Run → PASS. Commit `engine: New Shoe majority vote`.

### Task 4: Session (solo) lifecycle + wasm bindings

**Files:** `engine/src/session.rs`, `engine-wasm/src/lib.rs`, tests in both

**Interfaces:**
- Produces (session.rs):
  ```rust
  enum Phase { ShoeCut { reason: ShoeCutReason }, Betting {..}, Dealing {..} }
  impl Session {
      pub fn cut_shoe(&mut self, position: u16) -> Result<RoundSnapshot, CommandError>;   // WrongPhase unless ShoeCut
      pub fn request_new_shoe(&mut self) -> Result<RoundSnapshot, CommandError>;         // Betting → ShoeCut{Requested}
  }
  RoundSnapshot { .., pub shoe: ShoeView }   // cutter: None, vote: None
  ```
  `new_shoe()` removed. `Session::new` starts in `ShoeCut { NewTable }`. Cut-card-out rule identical to Table (2.3): `settle()` sets `cut_card_out` / ends the shoe. Deal-time silent reshuffle removed. `history` cleared at cut (find how the session keeps history — it feeds `scoreboard` in the snapshot).
- Produces (wasm): `WasmSession::cut_shoe(position: u16)`, `request_new_shoe()`; `WasmTable::cut_shoe(position)`, `propose_new_shoe()`, `vote_new_shoe(yes: bool)`, `vote_expire()`; remove `new_shoe` on both. Existing wasm tests that deal must cut first.

- [ ] Failing tests (session): `a_new_session_starts_in_shoe_cut`; `cut_opens_betting_and_records_the_burn`; `request_new_shoe_goes_to_shoe_cut_from_betting_only`; `cut_card_out_then_one_more_hand_then_shoe_cut`; `cut_clears_history_and_keeps_bankroll`. Update every existing session test through a helper `fn open_session(cfg) -> Session` that cuts at 500.
- [ ] Run → FAIL. Implement. `cargo test --workspace` PASS. `npm run build:wasm` OK; confirm `engine_wasm.d.ts` shows `cut_shoe(position: number)`, `request_new_shoe()`, `propose_new_shoe()`, `vote_new_shoe(yes: boolean)`, `ShoeView`, `CutReveal`, `ShoeCutReason`, and `PhaseTag` includes `"ShoeCut"`.
- [ ] Commit `engine+wasm: solo shoe lifecycle and bindings`.

### Task 5: Server — messages, handlers, announcements, vote timer

**Files:** `server/src/protocol.rs`, `server/src/main.rs`, `server/src/rooms.rs`, tests in main.rs/rooms.rs

**Interfaces:**
- Produces: `ClientMsg::{CutShoe { position: u16 }, ProposeNewShoe, VoteNewShoe { yes: bool }}`; `NewShoe` removed; `PROTOCOL_VERSION = 2`. `rooms::{cut_announcements(&Table, host) -> Vec<String>, vote_announcement(&Table, pid, yes) -> String, propose_announcement(&Table, pid) -> String, host_line(&Table) -> String}` with the exact copy from spec §3. `Room::open_vote_timer(room: Arc<Mutex<Room>>)` spawns `tokio::time::sleep(30s)` then `vote_expire()` + broadcast + announce "New shoe: the table says no" if it was still open (track a `vote_generation: u64` so a later vote isn't expired by an old timer). Host handover on leave and on `expire_held` sweep → announce "{name} now has the cut". Errors mapped: `NotYourCut` → "The cut isn't yours — {host} has it.", `VoteOpen` → "There's already a vote on the table.", `NoVote` → "Nothing to vote on.", `WrongPhase{found: ShoeCut}` → "Shoe's not cut yet — {host} has the cut."
- After a successful `CutShoe`, broadcast then announce `cut_announcements` ("{host} cuts the shoe", "Dealer turns the {card} — {n} cards burned", "Shoe {n}. Place your bets."). Card display: rank + suit symbol (e.g. `7♣`), reuse any existing card formatter in the server or add `fn card_label(Card) -> String`.

- [ ] Failing tests (main.rs `ready_command_tests` style): `join_then_cut_then_bet_ready_deal_settle_happy_path`; `non_host_cut_is_refused_with_the_host_named`; `propose_vote_pass_moves_everyone_to_shoe_cut_and_announces`; `vote_timer_expires_an_open_vote` (use `tokio::time::pause()`/`advance`); `host_leaving_announces_the_new_cutter`. Update every existing server test that deals to cut first (helper).
- [ ] Run → FAIL. Implement. `cargo test --workspace` PASS, `cargo clippy -p baccarat-server` no new warnings. Commit `server: cut, vote, announcements, 30s vote timer (protocol v2)`.

### Task 6: Web types and store actions

**Files:** `web/src/engine/types.ts`, `web/src/engine/adapter.ts`, `web/src/store/gameStore.ts`, `web/src/multiplayer/protocol.ts`, `web/src/multiplayer/remoteStore.ts`, `web/src/test/fixtures.ts`, tests: `gameStore.test.ts`, `remoteStore.test.ts` (extend whatever exists)

**Interfaces:**
- Produces: TS types re-exported from engine-wasm: `ShoeView`, `CutReveal`, `ShoeCutReason`, `VoteView`; `PhaseTag` includes `"ShoeCut"`; `RoundSnapshot.shoe`, `TableView.shoe`, `SeatView.host`.
  Store (both stores expose the same names so `App` is agnostic):
  ```ts
  cutShoe(position: number): void;
  requestNewShoe(): void;      // solo: session.request_new_shoe; multiplayer: send {type:"propose_new_shoe"}
  voteNewShoe(yes: boolean): void;   // solo: no-op
  ```
  `newShoe` removed from both stores and from `GameSession` in adapter.ts (`cutShoe`, `requestNewShoe` added). Client protocol: `{ type: "cut_shoe", position } | { type: "propose_new_shoe" } | { type: "vote_new_shoe", yes }`; `new_shoe` removed. `fixtures.ts` snapshots gain `shoe: { number: 1, cut_card_out: false, cut_reason: null, cutter: null, last_cut: null, vote: null }` and a `shoeCutSnapshot()` helper with `phase: "ShoeCut"`.
- [ ] Failing tests: gameStore `cutShoe forwards the position and the snapshot leaves ShoeCut`; remoteStore `cutShoe/requestNewShoe/voteNewShoe send the right messages`. Run → FAIL. Implement. `npx vitest run && npx tsc --noEmit` clean (tsc will flag every `phase` switch that now needs `"ShoeCut"` — fix minimal branches; UI work is T7–T9).
- [ ] Commit `web: shoe lifecycle types and store actions`.

### Task 7: `ShoeCutStage` — cutter UI, waiting view, mount

**Files:** Create `web/src/components/ShoeCutStage.tsx`, `web/src/components/shoecut.css`, `web/src/components/ShoeCutStage.test.tsx`; Modify `web/src/App.tsx`; Delete `web/src/components/CutDeckModal.tsx`, `cutdeck.css` (and its test if any).

**Interfaces:**
- Produces:
  ```tsx
  export interface ShoeCutStageProps {
    shoe: ShoeView; phase: PhaseTag;
    /** true when this client holds the cut (solo: always) */ canCut: boolean;
    cutterName: string | null;      // for the waiting copy
    onCut: (position: number) => void;
  }
  export function ShoeCutStage(props: ShoeCutStageProps): JSX.Element | null;
  ```
  Mounted by `App` when `snapshot.phase === "ShoeCut"` (solo: `canCut = true`; multiplayer: `canCut = myId === shoe.cutter`). Layout: fixed full-viewport, `.peel-backdrop`-style dim; title "Cut the shoe" / "Waiting for {name} to cut the shoe"; the shoe: a `div.shoe-stack` 416 `span.sliver` (CSS `grid-auto-columns`, width fits 100% − 32px, min 1px each); a `button.cut-card` (yellow, labelled CUT) positioned at `left: pos%` of the stack; pointer events (down/move/up on the stack, `setPointerCapture`) set `pos` 5–95; ArrowLeft/Right ±1, Shift ±5, Home/End; `button.btn--primary "Cut here"` enabled once the card has been placed; `onCut(Math.round(pos * 10))`. Non-cutters get the stack, no cut card, the waiting line and a subtle idle shimmer. Body scroll locked like `PeelStage`.
- [ ] Failing tests: renders nothing unless phase is ShoeCut; cutter sees the cut card and "Cut here" disabled until placed; pointer drag to 60% of the stack width then "Cut here" calls `onCut(600)`; keyboard End then Enter calls `onCut(950)`; non-cutter sees "Waiting for Alice to cut the shoe" and no cut card. Run → FAIL. Implement. `vitest`+`tsc` clean. Remove `CutDeckModal` references (App.tsx line ~542 block, its CSS import).
- [ ] Commit `web: ShoeCutStage — drag the cut card, host cuts, others wait`.

### Task 8: Cut + burn animation, roads wipe, SFX

**Files:** `web/src/components/ShoeCutStage.tsx`, `shoecut.css`, `web/src/components/ShoeCutStage.test.tsx`, `web/src/components/roads.tsx` (wipe class only), `scoreboard.css`, `web/src/audio/sfx.ts` (only if a riffle is missing — `shuffle` exists), `web/src/App.tsx` (keep the stage mounted through the animation)

**Interfaces:**
- Produces: `ShoeCutStage` gains `animating: CutReveal | null` and `onAnimationEnd: () => void`. `App` keeps the stage mounted for `SHOE_CUT_ANIM_MS = 2600` after `shoe.number` increases (same pattern as `peelStageLeaving`), passing `animating = snapshot.shoe.last_cut`. Sequence (CSS keyframes, all `transform/opacity`): 0–800 ms packet above the cut (`.sliver` with index ≥ cut index) lifts 12px and slides to the left end (`translateX`), 800–1400 ms `.turned-card` (a real `<Card>` render of `turned`) flips in above the stack, 1400–2200 ms `burned` slivers slide down-right into `.discard` with a counter "Burned 7", 2200–2600 ms "SHOE {n}" banner scales in. `prefers-reduced-motion: reduce` → all durations 0, banner only. `playSfx("shuffle")` at 0 ms, `playSfx("flip")` at 800 ms, `playSfx("slide")` per burned card (existing name for a card slide; check `SfxName`). Roads: `.roads-board`/`.board` get `data-shoe={shoe.number}`; on change a `road-wipe` class runs a 300 ms opacity dip (CSS only).
- [ ] Failing tests: stage stays mounted during the animation and calls `onAnimationEnd` after 2600 ms (fake timers); banner text shows the new number; burned counter shows `burned`; reduced-motion path fires `onAnimationEnd` immediately. Run → FAIL. Implement. `vitest`+`tsc` clean.
- [ ] Commit `web: cut and burn animation, roads wipe, shuffle sfx`.

### Task 9: Vote UI, New shoe button, LAST HAND chip, shoe tally row, dealer lines

**Files:** `web/src/components/Controls.tsx`, `controls.css`, `web/src/multiplayer/SeatsStrip.tsx`, `multiplayer.css`, `web/src/components/Hud.tsx`, `hud.css`, `web/src/components/RoadsModal.tsx`, `web/src/roadTally.ts`, `web/src/narrate.ts`, tests for each

**Interfaces:**
- Consumes store actions from T6 (`requestNewShoe`, `voteNewShoe`) and `snapshot.shoe`, `seats[].host`.
- Produces: Controls prop `onNewShoe` → `requestNewShoe`, label "New shoe" (short "Shoe"), disabled unless Betting and no open vote. In ShoeCut every betting/deal control is disabled. `SeatsStrip` shows a `.seat-host` crown-dot on the host and, while `shoe.vote` is set, a `.vote-bar` row: "New shoe? k of n" + for me ✓/✗ buttons (`voteNewShoe(true/false)`), and under each seat a ✓/✗ mark; a 30 s CSS countdown bar (`animation: vote-clock 30s linear`) restarted per proposer. `Hud`: `.hud-last-hand` chip "LAST HAND" when `shoe.cut_card_out` (fixed height already reserved on phones — put it inside the existing Outcome box row). `BoardTally` gains `shoe: number`; `RoadsModal` tally row "Shoe" = `shoe.number`, and the Scoreboard footer shows "Shoe {n}". `narrate.ts` (solo): ShoeCut → "Fresh shoe — cut it wherever you like."; after a cut → "You cut the shoe. Dealer turns the {card} and burns {n}. Shoe {number}."; `cut_card_out` in Betting → "Cut card's out — one more hand, then a fresh shoe."
- [ ] Failing tests per file (Controls disabled states; SeatsStrip vote row + marks + my buttons wire to the store; Hud chip; tally row; narrate lines). Run → FAIL. Implement. `vitest`+`tsc` clean.
- [ ] Commit `web: New shoe vote UI, LAST HAND chip, shoe number, dealer lines`.

### Task 10: End-to-end probes and docs

**Files:** Create `scripts/shoe-probe.mjs`; Modify `docs/TESTING.md`, `docs/BACKLOG.md`

- Playwright (playwright-core; `PORT` default 5185; iPhone 14 emulation at 390×844 and a 1440×900 desktop context): solo `?tier=mid`: assert the stage is up on load with "Cut the shoe", drag the cut card to ~60 %, tap "Cut here", wait 2.8 s, assert the stage is gone and the phase box reads Betting and the tally shows Shoe 1; then bet + deal + settle once. Multiplayer (against the owner's server on 8788 via the Vite proxy, or a server you start yourself on another port): two contexts create/join a room; the joiner sees "Waiting for … to cut the shoe"; the creator cuts; both reach Betting; the joiner proposes a new shoe; the creator votes yes → both reach ShoeCut with the creator as cutter. Save screenshots `shoe-cut-phone.png`, `shoe-burn-mid.png` (taken ~1.8 s into the animation) to the scratchpad path given in the dispatch brief.
- `docs/TESTING.md`: a "Shoe ceremony" section with the manual script (create → cut → play to the cut card → last hand → cut again; propose/vote). `docs/BACKLOG.md`: one row summarising the feature with the spec path.
- [ ] Run the probe; all assertions pass; commit `probes+docs: shoe ceremony end to end`.

---

## Self-review

- Spec coverage: §2.1 T2/T4; §2.2 T1/T2/T4; §2.3 T2/T4; §2.4 T2/T5; §2.5 T3/T5/T9; §2.6 T2/T4/T6; §3 T5; §4.1 T7/T8; §4.2 T9; §4.3 T8; §5 every task + T10.
- Names used across tasks: `cut_shoe`, `request_new_shoe`, `propose_new_shoe`, `vote_new_shoe`, `vote_expire`, `ShoeView`, `CutReveal`, `ShoeCutReason`, `VoteView`, `PhaseTag::ShoeCut`, `SeatView.host`, TS `cutShoe`/`requestNewShoe`/`voteNewShoe`, `ShoeCutStage`, `SHOE_CUT_ANIM_MS`.
