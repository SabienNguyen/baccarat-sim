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
- [ ] Both draw — is it clear the Banker's move was decided *after* seeing the Player's third card?
- [ ] Banker 3 vs a Player 8 (the one "stand" exception on 3) — is the exception obvious?
- [ ] Pairs / side-bet outcomes — does Explain connect the payout to what happened?
- [ ] Commission on a Banker win — is the 5% vig shown in the money math?
- [ ] Multiplayer parity — does a joiner see the same explanation single-player does?

## Iteration log

- **2026-07-21 — N9 (seed / iteration 1):** The trace stated decisions but not
  reasons. Added `banker_reason(banker_total, player_third)` (`rules.rs`) naming
  the tableau condition and the Player's actual third card; rewrote the
  `round.rs` trace so every draw/stand line explains itself; enriched the natural
  and player lines. Updated `narrate.ts` `drawnOn` to parse the new "has N"
  phrasing. Tests: `rules::banker_reason_explains_each_branch`,
  `round::trace_explains_why_the_counts_differ`, plus updated narrate fixtures.
  Engine 145 ✓, web 293 ✓, tsc ✓.

## Guardrails for the loop

- Test-first, always. Never commit a red build (`cargo test`, `vitest`, `tsc`).
- Engine trace is the single source of truth — prefer fixing it there over
  papering over in the web layer; both clients then benefit.
- One focused improvement per iteration. If no high-value gap remains, say so
  and hold — don't churn for its own sake.
- Rebuild wasm (`npm run build:wasm`) whenever the engine changes.
- Keep the dealer's spoken line terse; put the depth in the panel.
