# Explain feature — continuous-improvement log

**North star:** a first-time player can always tell *why* the hand played out the
way it did — above all, why one side ends on three cards and the other on two.
The third-card tableau is the one rule set a novice can't infer at the table, so
the Explain feature has to teach it in the moment.

This file is the running memory of the Explain-clarity loop. Each iteration:
picks **one** concrete clarity gap, fixes it **test-first**, keeps every suite
green, and records the result below so the next iteration builds on it instead
of repeating it.

## Where the Explain feature lives

| Layer | File | Role |
|-------|------|------|
| Engine trace (source of truth) | `engine/src/round.rs`, `engine/src/rules.rs` (`banker_reason`) | The per-decision narrative; feeds both single-player and multiplayer via `snapshot.explain` |
| Dealer narration (spoken line) | `web/src/narrate.ts` | Terse, in-the-moment call as each card turns |
| Explain panel (full trace + edges) | `web/src/components/ExplainPanel.tsx` | Lists the trace, house edges, and the tableau chart |
| Third-card reference chart | `web/src/components/ThirdCardChart.tsx` | Static tableau, faithful to `banker_draws` |
| Glossary | `engine/src/glossary.rs`, `web/src/components/GlossaryTerm.tsx` | Tap-to-define terms |

Default: Explain opens automatically at the Low "Learn the ropes" table (the
`coach` flag in `web/src/tables.ts`).

## Clarity scenarios — is each one self-explanatory today?

- [x] Player draws, Banker stands (asymmetric counts) — trace names the tableau condition + the player's actual third card (N9)
- [x] Player stands, Banker draws — trace states the player-stood 0–5/6–7 split
- [x] Natural 8/9 ends the hand — trace says why there are no draws
- [x] **Trace survives at settle** — the "why this round" narrative now stays on the settled felt (it was blanked the instant a coup resolved, the exact moment the learner studies it). Both clients — the fix is in the shared `view_for`.
- [x] Both draw — the banker line names the Player's actual third card ("…when the Player's third card is 2–7 (it was 6)"), so the causality/order reads through
- [x] Banker 3 vs a Player 8 (the "stand" exception) — the stand line reads "…draws unless the Player's third card is an 8 (it was 8)"
- [x] Commission on a Banker win — the settled panel now shows the per-hand vig ("your $100 wins $95… 5% commission ($5)"), derived from the payouts
- [x] Pairs / side-bet outcomes — the settled panel now names each winning side bet and what triggered it ("Player Pair — the Player's first two cards matched, paid 11:1")
- [x] Tie / push — the settled panel explains that a tie makes Player/Banker bets push (stake returned, nothing won or lost)

## Iteration log

- **2026-07-21 — N9 (seed / iteration 1):** The trace stated decisions but not
  reasons. Added `banker_reason(banker_total, player_third)` (`rules.rs`) naming
  the tableau condition and the Player's actual third card; rewrote the
  `round.rs` trace so every draw/stand line explains itself; enriched the natural
  and player lines. Updated `narrate.ts` `drawnOn` to parse the new "has N"
  phrasing. Tests: `rules::banker_reason_explains_each_branch`,
  `round::trace_explains_why_the_counts_differ`, plus updated narrate fixtures.
  Engine 145 ✓, web 293 ✓, tsc ✓.

- **2026-07-21 — iteration 2 (settle-persistence bug):** Analysis found the
  trace *disappeared* the instant a coup settled — `table.rs::view_for`'s Betting
  arm (which produces the Settled display) hard-coded `explain: Vec::new()`,
  while only the transient Dealing arm carried it. So every N9/N3 improvement was
  invisible at the resting state where a learner actually studies the finished
  3-vs-2 hand, and the panel showed a wrong "Place a bet and deal…" hint over a
  resolved coup. Fixed engine-first: the Betting arm now reuses `last_round` +
  `payouts.is_some()` (the same key the face-up cards use) to carry the trace
  through the settled window. Cleared `explain` in both `newHand` sweeps
  (`gameStore.ts`, `remoteStore.ts`) so the fresh felt shows the neutral hint,
  not a stale trace. Tests: `table::settled_view_keeps_the_explain_trace`,
  `gameStore` "starting a new hand clears the prior round's explain trace".
  Engine 146 ✓, web 294 ✓, tsc ✓, wasm rebuilt. NB: the multiplayer **server**
  binary also needs a rebuild+redeploy for remote play to get this (deferred to
  the user's next push — loop commits locally only).

- **2026-07-21 — iteration 3 (commission money-math):** The #1 remaining gap:
  a Banker win pays 0.95:1 and nothing explained why a $100 win paid $95 (the
  win popup showed only the net; the house-edge line stated it abstractly). Added
  `commissionNote(payouts)` (`web/src/settleExplain.ts`) — a pure helper that
  sums the winning Banker main stakes and spells out the 5% vig — rendered in the
  Explain panel under the trace. Web-layer by design: the payout data is already
  shared by both clients, and this lands on the now-persistent settled panel
  (iteration 2). Tests: `settleExplain` (5), ExplainPanel commission (2).
  Web 301 ✓, tsc ✓. No engine change → no wasm rebuild.

- **2026-07-21 — iteration 4 (side-bet payout explanations):** The Explain trace
  is tableau-only, so pairs and side bets never appeared on the persistent panel —
  a Player Pair or Dragon 7 just paid out with no on-surface "why". Added
  `sideBetNotes(payouts)` (`settleExplain.ts`): one note per winning side bet,
  tying the payout to what happened ("Player Pair — the Player's first two cards
  matched, paid 11:1"; Dragon 7 / Panda 8 / Dragon Bonus / Tiger). The multiplier
  is read from the payout (net = mult × stake), so it's correct even for the
  variable-payout bets. Rendered under the commission note. Covers the 6 side bets
  the UI currently offers; a generic "<key> — paid N:1" catches any future ones
  (see backlog F2 Tiger family). Tests: `settleExplain` (9 total), ExplainPanel
  side-bet (1). Web 306 ✓, tsc ✓. No engine change.

- **2026-07-21 — iteration 5 (tie / push):** Completed the settled-panel money
  story. Commission (iter 3) covered Banker wins and side notes (iter 4) covered
  bonus wins, but a *tie* — one of the three outcomes — left Player/Banker bets
  pushing with no on-panel explanation; "push" (stake back, no win/loss) reliably
  confuses beginners. Added `pushNote(payouts)`: fires only when the player holds
  a main bet that netted exactly zero (a Player/Banker bet nets zero only on a
  tie). Rendered beside the commission note. Tests: `settleExplain` (12 total),
  ExplainPanel push (1). Web 310 ✓, tsc ✓. No engine change.
  **The settled-panel clarity checklist is now fully worked through** — expect
  upcoming ticks to *hold* rather than churn. Remaining known work is scope, not
  clarity: surfacing this panel in multiplayer (feature) and a server redeploy
  for the iter-2 engine fix (deploy).

- **2026-07-21 — iteration 6: HELD, no high-value gap.** The clarity checklist
  is complete (8/8). Reviewed the remaining candidates — natural-win winner
  (self-evident from the shown totals), losing hands (obvious from outcome), EZ
  Baccarat push (ruleset inactive) — none clear the bar. Remaining work is scope,
  not clarity: surface the panel in multiplayer (feature) and redeploy the server
  (deploy). **Loop has reached steady state on Explain clarity** — further ticks
  will hold until the surface changes or a new scenario appears. Recommend the
  user pause or repoint the loop rather than accrue empty ticks.

## Guardrails for the loop

- Test-first, always. Never commit a red build (`cargo test`, `vitest`, `tsc`).
- Engine trace is the single source of truth — prefer fixing it there over
  papering over in the web layer; both clients then benefit.
- One focused improvement per iteration. If no high-value gap remains, say so
  and hold — don't churn for its own sake.
- Rebuild wasm (`npm run build:wasm`) whenever the engine changes.
- Keep the dealer's spoken line terse; put the depth in the panel.
