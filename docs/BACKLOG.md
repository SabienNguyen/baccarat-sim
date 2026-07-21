# Improvement Backlog

Running list of improvements and authenticity gaps, maintained by recurring
deep audits of the engine and UI against real punto banco. Newest audit notes
at the bottom. Effort: S (< half day), M (a day or two), L (multi-day).

## Authenticity (gameplay matches a real pit)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| A1 | Cut-card behavior: let the cut card emerge mid-shoe, finish the hand plus one "last hand", show a cut-card marker — instead of today's preemptive reshuffle at ≤14 cards | M | `session.rs:268`, `table.rs:286`; no statistical bias today, purely procedure |
| A2 | Big Road dragon tail: cap columns at 6 rows and bend right; switch roads from letters to traditional colored circles with tie-slash + pair dots | M | `roads.tsx:99-117`; derived-road *math* is already correct |
| A3 | Ruleset toggle: Commission vs EZ Baccarat (no-commission, Dragon-7 bar) — engine fully implements `EzBaccarat`, UI hard-wires `Commission` | S | `tables.ts:76`, `rooms.rs:48`, `adapter.ts` |
| A4 | Super 6 / Tie 9:1 rule variants | M | engine change + table config |
| A5 | "Ask/prediction" cells on derived roads (what Big Eye/Small/Cockroach would show if next is P vs B) — standard on electronic displays | M | `scoreboard.rs` + `roads.tsx` |

## Features

| # | Item | Effort | Notes |
|---|------|--------|-------|
| F1 | Banker-side Dragon Bonus spot (engine supports both sides; UI only offers Player) | S | `BetRail.tsx:47` |
| F2 | Expose remaining Tiger family bets (Big/Small Tiger 50:1/22:1, Tiger Tie 35:1, Tiger Pair) — implemented + tested in engine, absent from `SIDE_SPOTS` | S | `sidebets.rs`, `BetRail.tsx` |
| F3 | Session statistics panel: P/B/T counts, pair frequency, longest streak | S | derive from `history`/scoreboard |
| F4 | Multiplayer chat or emotes at the table | M | server protocol addition |
| F5 | Shareable table links (`?room=CODE` deep link joins directly) | S | `Multiplayer.tsx` |

## Hardening

| # | Item | Effort | Notes |
|---|------|--------|-------|
| H1 | Explicit commission rounding policy in `settle.rs:33` — integer floor is exact today only because all denoms are ×100¢; a sub-dollar denom would silently under-charge | S | add a rounding rule + test with odd amounts |
| H2 | Replace unreachable "card source exhausted" panics with graceful reshuffle fallback | S | `round.rs:38-41`; currently provably unreachable (CUT_CARD=14 ≥ max 6-card coup) but panic paths age badly |
| H3 | Self-host display fonts (Silkscreen, VT323) — first paint currently blocks on Google Fonts | S | `theme.css:1` |
| H4 | `og:image` screenshot for link previews | S | `index.html` |
| M1 | First-time multiplayer squeeze hint (no "Reveal all" in MP by design; new players may not know to tap cards) | S | one-time tooltip |

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
