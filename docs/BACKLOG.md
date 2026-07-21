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
| S4 | Server has no WebSocket ping/pong; a half-open TCP drop leaves a ghost undecided seat that blocks `deal()` until OS timeout | M | open |

## Authenticity (gameplay matches a real pit)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| A1 | Cut-card behavior: let the cut card emerge mid-shoe, finish the hand plus one "last hand", show a cut-card marker — instead of today's preemptive reshuffle at ≤14 cards | M | `session.rs:268`, `table.rs:286`; no statistical bias today, purely procedure |
| A2 | Big Road dragon tail: cap columns at 6 rows and bend right; switch roads from letters to traditional colored circles with tie-slash + pair dots | M | `roads.tsx:99-117`; derived-road *math* is already correct |
| A3 | Ruleset toggle: Commission vs EZ Baccarat (no-commission, Dragon-7 bar) — engine fully implements `EzBaccarat`, UI hard-wires `Commission` | S | `tables.ts:76`, `rooms.rs:48`, `adapter.ts` |
| A4 | Super 6 / Tie 9:1 rule variants | M | engine change + table config |
| A5 | "Ask/prediction" cells on derived roads (what Big Eye/Small/Cockroach would show if next is P vs B) — standard on electronic displays | M | `scoreboard.rs` + `roads.tsx` |

## Accessibility

| # | Item | Effort | Status |
|---|------|--------|--------|
| Y1 | Dealer announcements never reached screen readers — the `aria-live` `<p>` was keyed by its own text, remounting the region on every line (the documented anti-pattern) | S | ✅ fixed 2026-07-20 (stable live node; pop-in moved to keyed inner span) |
| Y2 | Manual cut/reshuffle was pointer-only — slots were `<div onClick>`, so keyboard users could never enable "Cut & shuffle"; also no Escape | S | ✅ fixed 2026-07-20 (slots are real buttons w/ aria-pressed + focus ring; Escape added; keyboard test) |
| Y3 | `win-float` (every settle) and `felt-swirl` (infinite) ignored `prefers-reduced-motion` | S | ✅ fixed 2026-07-20 (motion-free fade for the popup; felt frozen) |
| Y4 | Full modal a11y pass: `aria-modal`, focus-in-on-open, focus-restore-on-close, Tab trap across all 5 dialogs; add Escape to BustModal/VictoryModal | M | open (CutDeckModal got aria-modal + Escape as part of Y2) |
| Y5 | Full keyboard-play audit of bet spots/chips + visible focus styling throughout | M | open |

## Features

| # | Item | Effort | Notes |
|---|------|--------|-------|
| F1 | Banker-side Dragon Bonus spot (engine supports both sides; UI only offers Player) | S | `BetRail.tsx:47` |
| F2 | Expose remaining Tiger family bets (Big/Small Tiger 50:1/22:1, Tiger Tie 35:1, Tiger Pair) — implemented + tested in engine, absent from `SIDE_SPOTS` | S | `sidebets.rs`, `BetRail.tsx` |
| F3 | Session statistics panel: P/B/T counts, pair frequency, longest streak | S | derive from `history`/scoreboard |
| F4 | Multiplayer chat or emotes at the table | M | server protocol addition |
| F5 | Shareable table links (`?room=CODE` deep link joins directly) | S | `Multiplayer.tsx` |
| F6 | Multiplayer bust handling: detect `bankroll < table_min`, show a rebuy/leave prompt, auto-sit-out so a broke AFK player can't block deals (`busted` hardcoded false in remoteStore; MP `GameTable` has no `onReset`) | M | `remoteStore.ts:52`, `Multiplayer.tsx:168`, `App.tsx:307` |
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
