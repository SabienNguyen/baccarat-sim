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
- [ ] Commission on a Banker win — is the 5% vig shown in the money math (why a $100 Banker win pays $95)? **← top remaining gap**
- [ ] Pairs / side-bet outcomes — does Explain connect the payout to what happened on the felt?

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

## Guardrails for the loop

- Test-first, always. Never commit a red build (`cargo test`, `vitest`, `tsc`).
- Engine trace is the single source of truth — prefer fixing it there over
  papering over in the web layer; both clients then benefit.
- One focused improvement per iteration. If no high-value gap remains, say so
  and hold — don't churn for its own sake.
- Rebuild wasm (`npm run build:wasm`) whenever the engine changes.
- Keep the dealer's spoken line terse; put the depth in the panel.
