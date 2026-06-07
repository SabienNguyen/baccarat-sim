# Baccarat Simulator — Design Spec

**Date:** 2026-06-07
**Status:** Approved for planning

## 1. Purpose

An immersive baccarat simulator that recreates the experience of sitting at a real
Las Vegas (Punto Banco) table — including the signature card **squeeze** — while
teaching the player the game's terminology (Monkey, Natural, Tiger…) and bonus bets
through play, not lectures. Ships as both a browser game and a terminal game from a
single shared rules engine.

## 2. Architecture

A single source of truth for all game logic (Rust), surfaced through two TypeScript
front-ends. The engine knows nothing about UI; the front-ends know nothing about rules.

```
engine/   Rust crate — pure game logic, no UI. Compiled to WASM via wasm-bindgen/wasm-pack.
            shuffle & shoe, deal, third-card tableau, naturals, payouts, commission,
            all side bets, scoreboard (road) derivation, bankroll/bet resolution.
            Exposes a serializable public API (state snapshots in, commands out).

web/      TypeScript (Vite) — browser table. Imports engine WASM package.
            Renders felt, cards, drag-to-squeeze, dealer narration, other players,
            chips/bankroll, full scoreboard, contextual glossary, explain mode.

cli/      TypeScript (Ink) — terminal TUI. Imports the SAME engine WASM package
            (WASM runs in Node). Same game, keyboard-driven, hold-key squeeze,
            ASCII/Unicode cards and roads.
```

**Why this split:** Rust gives correctness guarantees for the one genuinely fiddly
part (the banker third-card tableau) and a reusable, fast, strongly-typed engine.
TypeScript gives the richest ecosystem for visuals/animation on web and a quick,
shared UI language across both front-ends. WASM compute cost for a card game is
negligible; the only real tradeoff is maintaining the wasm-bindgen boundary, which
also imposes healthy "clean serializable API" discipline on the engine.

### Engine ↔ front-end boundary

The engine exposes a command/snapshot interface, not live objects:

- Commands in: `place_bet(spot, amount)`, `deal_round()`, `peek(hand, index)`,
  `reveal(hand, index)`, `settle()`, `new_shoe()`, etc.
- State out: a serializable `RoundSnapshot` (hands, card face-up/face-down status,
  totals, whose turn, dealer messages, payouts, updated bankroll) plus a
  `ScoreboardSnapshot` (all roads) and `ExplainTrace` (why each draw happened).

Front-ends render snapshots and send commands. No game logic lives in the front-ends.

## 3. Game scope (full Vegas pit)

### Main bets
| Bet | Pays | Notes |
|-----|------|-------|
| Player | 1:1 | |
| Banker | 1:1 − 5% commission (0.95:1) | commission tracked per win |
| Tie | 8:1 | Player/Banker wagers push on a tie |

### Card values & resolution
- Ace = 1, 2–9 face value, 10/J/Q/K = 0.
- Hand value = sum mod 10 (last digit).
- **Natural**: 8 or 9 on first two cards → both stand.
- **Player rule**: draws on 0–5, stands on 6–7.
- **Banker tableau** (when player drew a third card): standard table keyed on banker
  total and the player's third card (e.g. banker 3 draws unless player's 3rd is 8;
  banker 6 draws only on player 3rd of 6–7; banker 7 stands). When the player stood,
  banker draws on 0–5, stands on 6–7. This table is implemented exactly and unit-tested.

### Side bets / variants (all in scope)
- **Player Pair / Banker Pair** — 11:1.
- **EZ Baccarat** mode — no commission; a Banker win on a 3-card total of 7 is a
  **push** ("Dragon 7 bar"). Side bets: **Dragon 7** (3-card Banker 7) 40:1,
  **Panda 8** (3-card Player 8) 25:1.
- **Dragon Bonus** — pays on a natural win or a win by a large margin (4+),
  with a standard payout ladder.
- **Tiger family** — Tiger / Big Tiger / Small Tiger / Tiger Pair, built around a
  Banker 6.

> Commission vs EZ: standard mode takes 5% on banker wins; EZ mode is selectable and
> applies the no-commission + Dragon-7-bar rules. Both modes share the same tableau.

### Scoreboard roads (engine-derived)
Bead Plate, Big Road, and the three derived roads (Big Eye Boy, Small Road,
Cockroach Pig) computed from the outcome history. Derivation lives in the engine so
both front-ends render identical boards.

## 4. Immersion features

- **Squeeze / peek ritual** — cards start face-down; the player bends the corner to
  reveal a sliver of the pip before the full flip. Web: drag/hold the card corner with
  the mouse (progressive reveal). TUI: hold a key to peek, another to flip. Engine
  exposes `peek`/`reveal` so the UI controls pacing without seeing undrawn cards early.
- **Talking dealer/host** — narrates the action in real dealer cadence ("No more bets",
  "Card for the Player… Monkey!", "Banker wins, seven over five"). The dealer line is
  also the delivery vehicle for teaching (see §5).
- **Other players** — simulated bettors in the other seats place their own bets and
  react (cheer streaks, shout "Monkey!"). Their bets/reactions are cosmetic + flavor;
  they do not affect the player's outcome. Driven by simple per-seat betting profiles.
- **Bankroll, chips & limits** — persistent bankroll, chip denominations
  ([25][100][500][1k]), table min/max, commission tracked per banker win, win/loss
  history. Player can bust or grow the roll.

## 5. Teaching features

- **Contextual glossary** — recognized terms (Monkey, Natural, Tiger, Punto, Banco,
  Dragon, Squeeze, Panda, …) are highlighted as they occur in dealer narration and the
  UI; hover (web) / focus (TUI) shows a short definition. Learn by playing, look up on
  demand. A glossary dataset maps term → definition → trigger condition.
- **Explain-the-rule mode** — a toggle that, each hand, shows *why* a third card was
  drawn (the tableau decision trace from the engine's `ExplainTrace`) and the live
  house edge for the active bets. Teaches mechanics, not just vocabulary.

Out of scope for v1 (deliberately): guided/forced tutorials and quizzes. The teaching
is ambient and on-demand only.

## 6. Layout (web)

### Visual style: Balatro-inspired retro (confirmed 2026-06-07)

The web front-end adopts a **Balatro-style retro aesthetic**:

- **Left HUD sidebar** — a vertical beveled panel (like Balatro's blind/score panel) holding
  bankroll, current bet, round info, table min/max, commission tally, and the Run-Info /
  Options style buttons. This replaces the bottom rail's role as the primary stats surface;
  the felt table sits to its right.
- **Chunky pixel-art look** — pixelated card faces with classic pip art, bold pixel/bitmap
  display font, thick dark outlines and drop shadows on cards and panels, beveled "plastic"
  button chips in saturated red/blue/gold.
- **Painterly swirl felt** — a deep saturated green background with a subtle moving swirl,
  not a flat felt.
- **Juicy feedback** — floating value pop-ups on wins (Balatro's "+10" style), squeeze and
  payout animations with a tactile, game-y feel; glossary terms and the dealer line styled
  as retro callouts.
- **Card shoe** — face-down deck shown as a stack in the corner with a remaining count
  (Balatro's "41/52" style), reinforcing the shoe.

Pixel-art card assets and the bitmap font are sourced/created during Plan 4. The squeeze,
scoreboard roads, dealer narration, other players, and explain mode from the layout below all
remain — they are restyled into this retro skin, not removed. The TUI keeps its own
Unicode aesthetic.

### Spatial layout (confirmed merged direction)

- **Center stage:** the squeeze. Large Player and Banker cards; Banker card mid-squeeze
  with drag-to-reveal corner. The dramatic focus of the screen.
- **Top strip:** other players' seats with their current bets.
- **Below stage:** dealer narration line (with highlighted glossary terms).
- **Bet rail (front/bottom):** Player / Tie / Banker main spots plus side-bet spots
  (Pairs, Dragon 7, Panda 8, Dragon Bonus, Tiger); bankroll, chip selector, current bet.
- **Right dock:** full scoreboard — Bead Plate, Big Road, Big Eye / Small / Cockroach —
  with the explain-the-rule readout beneath it.

TUI mirrors the same information with a keyboard-driven Unicode layout (exact TUI
wireframe to be designed during implementation).

## 7. Testing strategy

- **Engine (Rust):** unit tests are the backbone. The third-card tableau gets an
  exhaustive table-driven test (every banker total × every player third card). Payout
  math (including commission, EZ Dragon-7 bar, all side bets) tested against known
  results. Scoreboard road derivation tested against worked examples. Property tests:
  hand value never exceeds 9; totals derive correctly; bankroll conserves across settle.
- **Boundary:** snapshot/command serialization round-trips tested; WASM package builds
  and loads in both Node and browser contexts.
- **Front-ends (TS):** component/interaction tests for bet placement, squeeze pacing,
  glossary highlighting, and explain-mode rendering against mocked engine snapshots.

## 8. Build / tooling notes

- Engine built with `wasm-pack` producing an npm-consumable package with generated
  `.d.ts` types, consumed by both `web/` and `cli/`.
- Monorepo layout (`engine/`, `web/`, `cli/`, shared `glossary/` data).
- Repo is not yet a git repository; initialize before first commit.

## 9. Open items (for the planning phase, not blockers)

- Exact Dragon Bonus and Tiger payout ladders to be pinned to a cited source during
  engine implementation.
- TUI wireframe detail.
- Other-players betting-profile behavior depth (how varied / reactive).
- Persistence mechanism for bankroll (localStorage on web, file on CLI).
