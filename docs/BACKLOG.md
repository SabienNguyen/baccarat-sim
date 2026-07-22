# Improvement Backlog

Running list of improvements and authenticity gaps, maintained by recurring
deep audits of the engine and UI against real punto banco. Newest audit notes
at the bottom. Effort: S (< half day), M (a day or two), L (multi-day).

## Security / correctness (live public server)

| # | Item | Effort | Status |
|---|------|--------|--------|
| S1 | **Bet-amount integer-overflow bypass** — client i64 `amount` near max wrapped `on_spot+amount` past the max/bankroll guards; no release overflow-checks | S | ✅ fixed 2026-07-20 (reject single bet > max in both engines + `[profile.release] overflow-checks=true`; tests added) |
| S2 | **`create_room` orphans rooms → floor-exhaustion DoS** — room inserted before `sit()`, which refuses when already seated, leaking rooms to MAX_ROOMS (also double-click leak) | S | ✅ fixed 2026-07-20 (guard `seat.is_some()` before allocating) |
| S3 | Any seated player can `Settle` mid-Dealing, cutting off everyone else's squeeze (money stays correct — fairness/griefing only). Tension: it's also the only escape from a squeezer who won't reveal | M | open — gate settle on all-revealed, or restrict who settles + add a squeeze timeout |
| S4 | Server WebSocket ping/pong for half-open TCP drops (instant ghost-seat detection) | M | partially addressed 2026-07-20: a 5-min idle timeout now evicts silent connections with a clear "away too long" message (`IDLE_LIMIT` in `main.rs`), which unblocks a table an idle seat was stalling and reaps ghost seats; a true ping/pong would detect a dead socket faster than 5 min |
| S7 | `sweep`/`list_public` hold the global registry lock across every per-room `await` — one slow/held room lock stalls all creates/joins/lobby-refreshes floor-wide (O(rooms) serial locking each disconnect) | S/M | `rooms.rs:124` (snapshot the Arcs, release the map lock, then inspect) |
| S5 | **Multiplayer settle popup/sound re-fired with a bogus $0 "push"** — `settleSeq` was keyed off `prev.phase !== "Settled"`, but the local `newHand()` sweeps phase to Betting while the server view stays Settled, so any other seat's action re-broadcast re-triggered it | S | ✅ fixed 2026-07-20 (fire only on genuine `Dealing→Settled` edge; regression test added) |
| S6 | **`sweep()` orphaned a room during the create→seat handoff** — a freshly created room is empty until its creator seats, and any other client's disconnect-sweep in that gap dropped it from the registry while the creator seated into a now-unreachable room (under load, stranded 63/64) | S | ✅ fixed 2026-07-20 (`seated_once` flag + `SEAT_GRACE`; spare young un-seated rooms; 2 regression tests) |

## Authenticity (gameplay matches a real pit)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| A1 | Cut-card behavior: let the cut card emerge mid-shoe, finish the hand plus one "last hand", show a cut-card marker — instead of today's preemptive reshuffle at ≤14 cards | M | `session.rs:268`, `table.rs:286`; no statistical bias today, purely procedure |
| A2 | Big Road dragon tail: cap columns at 6 rows and bend right; switch roads from letters to traditional colored circles with tie-slash + pair dots | M | `roads.tsx:99-117`; derived-road *math* is already correct |
| A3 | Ruleset toggle: Commission vs EZ Baccarat (no-commission, Dragon-7 bar) — engine fully implements `EzBaccarat`, UI hard-wires `Commission` | S | `tables.ts:76`, `rooms.rs:48`, `adapter.ts` |
| A4 | Super 6 / Tie 9:1 rule variants | M | engine change + table config |
| A5 | "Ask/prediction" cells on derived roads (what Big Eye/Small/Cockroach would show if next is P vs B) — standard on electronic displays | M | `scoreboard.rs` + `roads.tsx` |
| A6 | Jack rendered as a chess knight ♞ (a horse) — a Jack/Knave isn't a knight; use a J-appropriate glyph or the index treatment | S | `cardArt.ts:107` (cosmetic, deliberate retro styling) |
| N1 | Shoe progress readout — cards remaining / shoe %, cut-card marker, shoe number; every real table shows this and it teaches shoe pacing. Needs `shoe.remaining()` exposed across the wasm boundary + a HUD chip | M | engine field + `Hud.tsx` |
| N5 | Per-spot bet-limit signage incl. a side-bet max (distinct from F8's min enforcement) — real tables post per-position limits | S | `BetRail.tsx` |
| N7 | Commission-owed running tally for the shoe — authenticity + teaches the drag of the vig (per-hand deduction stays; add a display) | S | `Hud.tsx` |
| N8 | Multiplayer betting-window countdown / "no more bets" clock (ties S3 squeeze-timeout) | M | server timer + client ring |

## Accessibility

| # | Item | Effort | Status |
|---|------|--------|--------|
| Y1 | Dealer announcements never reached screen readers — the `aria-live` `<p>` was keyed by its own text, remounting the region on every line (the documented anti-pattern) | S | ✅ fixed 2026-07-20 (stable live node; pop-in moved to keyed inner span) |
| Y2 | Manual cut/reshuffle was pointer-only — slots were `<div onClick>`, so keyboard users could never enable "Cut & shuffle"; also no Escape | S | ✅ fixed 2026-07-20 (slots are real buttons w/ aria-pressed + focus ring; Escape added; keyboard test) |
| Y3 | `win-float` (every settle) and `felt-swirl` (infinite) ignored `prefers-reduced-motion` | S | ✅ fixed 2026-07-20 (motion-free fade for the popup; felt frozen) |
| Y4 | Full modal a11y pass: `aria-modal`, focus-in-on-open, focus-restore-on-close, Tab trap across all 5 dialogs; add Escape to BustModal/VictoryModal | M | open (CutDeckModal got aria-modal + Escape as part of Y2) |
| Y5 | Full keyboard-play audit of bet spots/chips + visible focus styling throughout | M | open |

## Teaching / onboarding

The app is billed as a learning tool; these close the gaps between "plays correctly" and "teaches a novice."

| # | Item | Effort | Status |
|---|------|--------|--------|
| N3 | Dealer slang defined + orphan glossary entries reachable — "snowman"/"le grand"/"squeeze" were spoken with no definition; "commission"/"squeeze" entries existed but were never linked | S | ✅ done 2026-07-21 (added `snowman` entry; linked snowman ×2, le grand→natural, squeeze in the dealer line, commission in the ExplainPanel) |
| N4 | Default Explain ON at the Low "Learn the ropes" table (it's the only feature that teaches the drawing rules, hidden behind a toggle by default) + a static third-card tableau reference | S | ✅ done 2026-07-21 (coach flag on the low table opens Explain; `ThirdCardChart` renders the tableau, faithful to `banker_draws`) |
| N6 | House-edge caption on the bet spots ("Banker best, Tie worst") | S | ❌ dropped 2026-07-21 — user didn't want raw percentages on the felt; edges stay in the Explain panel only |
| N9 | **Explain says _why_ the card counts differ.** The trace stated the decision ("Banker stands on 6") but never the tableau reason. Now every draw/stand line names the rule and the actual player third card. Focus of the continuous Explain-clarity loop — see `docs/EXPLAIN.md` | — | ✅ started 2026-07-21 (engine `banker_reason`; richer player/natural lines) |
| N2 | First-run "How to play" / coach overlay — a true novice is dropped straight onto the felt with no primer | M | open |
| N3b | Wire remaining orphan glossary entries `shoe` and `ez-baccarat` (ez only relevant once A3 ruleset toggle lands) | S | open |

## Features

| # | Item | Effort | Notes |
|---|------|--------|-------|
| F1 | Banker-side Dragon Bonus spot (engine supports both sides; UI only offers Player) | S | `BetRail.tsx:47` |
| F2 | Expose remaining Tiger family bets (Big/Small Tiger 50:1/22:1, Tiger Tie 35:1, Tiger Pair) — implemented + tested in engine, absent from `SIDE_SPOTS` | S | `sidebets.rs`, `BetRail.tsx` |
| F3 | Session statistics panel: P/B/T counts, pair frequency, longest streak | S | derive from `history`/scoreboard |
| F4 | Multiplayer chat or emotes at the table | M | server protocol addition |
| F5 | Shareable table links (`?room=CODE` deep link joins directly) | S | `Multiplayer.tsx` |
| F6 | Multiplayer bust handling: detect `bankroll < table_min`, show a rebuy/leave prompt, auto-sit-out so a broke player can't block deals (`busted` hardcoded false in remoteStore; MP `GameTable` has no `onReset`) | M | `remoteStore.ts:52`, `Multiplayer.tsx:168`, `App.tsx:307` — partially mitigated by S4/AFK (an idle broke player is now evicted after 5 min) |
| F7 | Reconnect token: rejoin resumes the same seat + bankroll instead of a fresh buy-in (today a disconnect forfeits winnings; a busted player rejoins for a free full rebuy) | L | `table.rs:194`, protocol addition |
| F8 | Separate side-bet minimum from `table_min` — today a $5 side bet needs $25 at a $25-min table; real tables enforce the min on main bets only | M | both `place_bet`s + table config |
| F9 | Optional warning when a player stakes both Player and Banker on one coup (allowed, but pure commission bleed) | S | `BetRail.tsx` |

## Hardening

| # | Item | Effort | Notes |
|---|------|--------|-------|
| H1 | Explicit commission rounding policy in `settle.rs:33` — integer floor is exact today only because all denoms are ×100¢; a sub-dollar denom would silently under-charge | S | add a rounding rule + test with odd amounts |
| H2 | Replace unreachable "card source exhausted" panics with graceful reshuffle fallback | S | `round.rs:38-41`; currently provably unreachable (CUT_CARD=14 ≥ max 6-card coup) but panic paths age badly |
| H3 | Self-host display fonts (Silkscreen, VT323) — first paint currently blocks on Google Fonts | S | `theme.css:1` |
| H4 | `og:image` screenshot for link previews | S | `index.html` |
| M1 | First-time multiplayer squeeze hint (no "Reveal all" in MP by design; new players may not know to tap cards) | S | one-time tooltip |
| H5 | Cross-tab bankroll sync via `storage` events / BroadcastChannel — two tabs at one tier clobber each other's persisted roll (last-writer-wins). Also add an upper cap so a hand-edited localStorage value isn't trusted | S | `useGameStore.ts:24`, `bankrollStorage.ts` |
| H6 | `pointercancel` / `lostpointercapture` cleanup in `SqueezeCard` — an interrupted touch leaves the fold stuck mid-squeeze | S | `SqueezeCard.tsx` |
| H7 | Restrict manual reveal of unbet (house) hands — `check_rights` returns Ok when holder is None, so a raw client can flip the dealer's cards ahead of the paced loop (no money impact, lock-serialized) | S | `table.rs:400` |
| H8 | Replace unreachable "card source exhausted" panics with graceful reshuffle fallback | S | `round.rs:38-41` (provably unreachable today) |
| H9 | `narrateError` crashed on a `null` error (`"Message" in null` throws) | S | ✅ fixed 2026-07-20 (null/undefined guard) |
| H10 | Guard the adapter money boundary: `Number.isInteger` before `BigInt(amountCents)` so a stray fractional value degrades gracefully instead of throwing | S | `adapter.ts:50,107` |
| H11 | A real wasm panic surfaces as the generic "Can't do that, friend." dealer line (RuntimeError has `message`, not `Message`) — detect and log it distinctly instead of masking as a benign refusal | S | `adapter.ts:36-43` |
| H12 | WS cold-start UX: `min_machines_running=0` means the first idle connect cold-starts Fly while the user waits on "Finding the casino…" until the browser's long WS timeout; add a connect timeout + "waking the table service…" message + retry | M | `Multiplayer.tsx:66` |
| H13 | Derive prod WS URL from `location.host` when no `VITE_WS_URL` instead of hardcoding the canonical fly host — a self-host/preview deploy currently points multiplayer at the canonical app | S | `protocol.ts:54` |
| H14 | Server sets no security headers on the SPA (`ServeDir`): add CSP, `X-Content-Type-Options`, etc. | S | `server/src/main.rs` |
| H15 | Storage has no schema version tag — `loadBankroll` / `loadAudioSettings` parse a raw value, so a future shape change silently resets the saved roll/audio prefs with no migration | S | `bankrollStorage.ts:19`, `audio/settings.ts:24` |
| H16 | `goalReached` isn't persisted: reloading after crossing the goal (roll already ≥ goal) never re-shows TABLE BEATEN because `before < goal` is now false — the victory moment is lost across a refresh | S | `gameStore.ts:176` (design call: persist-once vs re-celebrate) |
| H17 | Confirm/mute MP ambience sounds for *other* players' bet/peek actions — `soundsFor` fires `chipPlace`/`squeeze` on aggregate-view deltas; may be intended table ambience or may be noise | S | `remoteStore.ts:60` |
| H18 | Latent autoplay risk: `AudioContext` is created in a mount effect, fine today (table only mounts post-click) but would start suspended/silent if the app ever auto-loads into a table | S | `audio/sfx.ts:47` |

## Test-coverage gaps (ranked by risk)

| # | Untested behavior | Effort | Notes |
|---|-------------------|--------|-------|
| T1 | Single-player auto-settle-once effect (`App.tsx:171`) — the `settledThisCoup` ref guards against double-settle / stuck-in-Dealing; no test | S | highest value; a regression here hangs or double-pays a coup |
| T2 | Dealer-pacer sound count over a full paced coup (exactly one `deal` + N `flip`, no double `win`) | S | the double-play surface audits keep probing |
| T3 | `DerivedRoadView` mark rendering — a `"Red"` cell renders filled `●`/red and `"Blue"` hollow `○`/blue in the right cell (data→pixel faithfulness) | S | `roads.test.tsx` only covers BigRoad follow-latest |
| T1b | ~~Side-bet paytables had no statistical assertion~~ | S | ✅ done 2026-07-20 (`statistics.rs` now asserts realized edge for all 10 side bets vs published) |
| T4 | Goal crossing on a side-bet-only win (`gameStore.ts:176`) — covered only via a main-bet payout | S | |

(Note: bust exactly at `table_min` IS covered — `gameStore.test.ts:221`, roll==min → not busted.)

## Audit log

- **2026-07-20 (Opus 4.8, full engine + web sweep):** No rules bugs found.
  Verified correct against real punto banco: full drawing tableau incl. all
  banker edge cases, card values/mod-10 totals, naturals ending the coup,
  Player/Banker/Tie payouts with 5% commission, all side-bet paytables (Pair
  11:1, Dragon 7 40:1, Panda 8 25:1, Dragon Bonus ladder, Tiger family),
  Big Road + all three derived roads hand-checked against the canonical
  worked example, house-edge figures (1.06/1.24/14.36), RNG soundness
  (ChaCha via StdRng, crypto-seeded, no sequential-seed bias), money
  conservation. Items above logged from this audit.
- **2026-07-20 (Opus 4.8, server + web state-machine sweep):** Found 4 real
  defects, all outside the rules engine. Fixed same day: the bet-amount
  overflow bypass (S1) and the create_room orphan DoS (S2). Logged for
  follow-up: settle-skips-squeeze (S3), no heartbeat/ghost seats (S4),
  multiplayer bust deadlock (F6), disconnect forfeits/free-rebuy (F7),
  side-bet-min = table-min (F8), plus cross-tab bankroll, squeeze gesture
  cleanup, and unbet-hand reveal (H5–H8). Engine money math in the lifecycle
  paths (settle-on-leave, per-seat independent settlement, squeeze ownership)
  otherwise verified correct.
- **2026-07-20 (Opus 4.8, WASM boundary + web-derived logic + a11y +
  build/deploy):** No rules discrepancies — dealer narration, `runningTotal`/
  `lastFlipBetween`, third-card gating, the "you would've won" nudge, chip
  breakdown, and the WASM/TS type boundary (nested-enum serialization, i64→JS
  precision, session finalization) all verified correct. Findings were all
  accessibility + hardening. Fixed same day: SR live region (Y1), keyboard cut
  ritual (Y2), reduced-motion gaps (Y3), `narrateError` null crash (H9).
  Logged: full modal focus management (Y4), keyboard-play audit (Y5), adapter
  integer/panic guards (H10–H11), WS cold-start UX (H12), WS-URL derivation
  (H13), server security headers (H14).
- **2026-07-20 (Opus 4.8, audio + roads rendering + persistence + test
  gaps):** One confirmed bug, fixed same day: multiplayer settle popup/sound
  re-firing with a $0 "push" (S5). No rules discrepancies. Audio memory
  hygiene, volume/mute persistence, and `devAlmostWin` prod-stripping all
  verified clean; roads rendering is a faithful 1:1 of the verified data (the
  only gap is the A2 dragon-tail / overflow, already logged). New hardening
  logged: storage schema versioning (H15), goal-reached persistence (H16), MP
  ambience sounds (H17), autoplay latent (H18). Ranked the top untested
  behaviors T1–T4 (auto-settle-once the highest value).
- **2026-07-20 (Opus 4.8, EMPIRICAL — 5M-coup Monte Carlo + card art +
  glossary):** No bugs. Ran 5,000,000 real coups: every outcome frequency
  (Banker 45.83%, Player 44.65%, Tie 9.53%, pairs 7.47%) and every realized
  house edge (Player 1.18%, Banker 1.11%, Tie 14.27%, and all 10 side bets)
  landed within ~1.5 SE of published 8-deck figures — the engine's output
  distribution is statistically indistinguishable from real punto banco. Card
  pip layouts, suit colors, and font-safety all correct; glossary/house-edge
  copy factually correct. Acted on same day: added per-side-bet edge
  assertions to `statistics.rs` (T1b), completed the Dragon Bonus glossary
  definition (was silent on small non-natural wins losing). Logged the Jack
  glyph nit (A6). Reference note: the exotic hit-rates in some odds tables
  ("Panda 8 ~1.83%") are wrong; the engine's ~3.47% is correct.
- **2026-07-20 (Opus 4.8, CONCURRENCY + property-based invariants):** One
  confirmed race, fixed same day: `sweep()` orphaned a room during the
  create→seat handoff (S6; a load harness stranded 63/64 seated rooms). All
  other concurrency paths proven safe under a multi-threaded harness — no
  double-deal, no double-pay, pacer-vs-settle safe, consistent lock ordering,
  no room-id collision, broadcast-to-dropped-conn can't panic. Property-fuzzed
  every engine invariant (money conservation, exhaustive tableau truth table,
  paytable ceilings, scoreboard structure on pathological sequences, the
  peek/reveal state machine) — zero failures. Logged S7. Recommended
  build-next: A3 ruleset toggle, F1/F2 Tiger + banker Dragon Bonus, F3 stats.
- **2026-07-20 (user request — AFK room closure):** Added a 5-minute idle
  timeout: a silent connection forfeits its seat with a clear "away too long"
  message (new `ServerMsg::Closed { reason }`), which also unblocks a table an
  idle seat was stalling. Verified end-to-end (client receives the reason
  before the socket closes). Partially addresses S4 and F6.
- **2026-07-21 (Opus 4.8, real-table fidelity + onboarding — the audit lens
  pivoted from code to experience):** No logic bugs. Found teaching gaps: the
  app narrates slang ("snowman", "le grand") and shows terms ("commission",
  "squeeze") a novice can't look up. **Started building** from here — shipped
  N3 (glossary wiring + snowman definition). Logged onboarding items (N2/N4/N6,
  N3b) and real-table gaps (N1 shoe readout, N5 limit signage, N7 vig tally,
  N8 MP countdown). Build-next ranking: N4 (Explain-on-by-default) and N6
  (edge captions on spots) next, both S. This is the pivot point — the loop is
  now building down the backlog rather than hunting increasingly rare defects.
- **2026-07-21 (user redirect — Explain-clarity loop):** User pointed out the
  real gap: hands end with one side on three cards and the other on two and the
  Explain feature never said *why*. Shipped N4 (Explain opens by default at the
  learner's table + a static third-card tableau chart). Dropped N6 (no raw
  percentages on the felt). Started N9: the engine trace now explains every
  third-card decision — `banker_reason()` names the tableau condition and the
  Player's actual third card, so "Banker stands on 6" becomes "…on 6 the Banker
  draws only when the Player's third card is 6–7 (it was 3)." A dedicated loop
  now continuously improves the Explain feature; its running log is
  `docs/EXPLAIN.md`. Also a standing direction: de-Balatro the theme to a
  generic pixel look (parked as the next dedicated task).
