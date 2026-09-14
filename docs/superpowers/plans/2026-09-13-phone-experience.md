# Phone experience + remaining board To Do — implementation plan (2026-09-13)

Branch: `feat/phone-experience` (worktree `.claude/worktrees/phone-experience`).
Side branches merge into it; one PR to `main` at the end, after the owner has
manually tested multiplayer on three phone instances (T9 provides the harness).

Ground rules for every task
- TDD: failing test first, then the change, then the whole suite green.
- Verify on an emulated phone with the probe script pattern in
  `scripts/phone-probe.mjs` (Playwright, `devices["iPhone 14"]`, tap not click),
  and report measured numbers (page width/height, element boxes), not adjectives.
- `web`: `npx vitest run` and `npx tsc --noEmit` clean. Engine changes: `cargo test`
  and `npm run build:wasm` before the web suite.
- Page must stay exactly viewport-wide at 390 and 360 (P6–P9 regressions).
- Don't touch files outside the task's fence. No drive-by refactors.
- Commit with the session trailer; do not push (the main session pushes).

## T1 — P13: the pinned action bar must not eat taps (phone)
Files: `web/src/theme.css` (phone block, ≤700px), `web/src/components/controls.css`.
Problem: on phones `.controls` is `position: fixed` at the bottom; anything scrolled
to the bottom edge sits under it and a tap on e.g. "Bet Player" lands on
"Reveal all"/"Explain".
Do: (a) `scroll-padding-bottom` on the scroller (`html`/`.app`) equal to the bar
height + safe-area so `scrollIntoView` never lands content under the bar;
(b) make the bar's own box `pointer-events: none` with `pointer-events: auto` on
its buttons, so taps between/around buttons fall through to the felt;
(c) keep `.app` bottom padding ≥ bar height + `env(safe-area-inset-bottom)`.
Test: Playwright at iPhone 14 — scroll so the Banker spot's bottom edge is at the
viewport bottom, tap its centre, assert the stake landed on Banker and no control
fired; assert the bar's buttons still tap. Add a vitest for any TSX change; CSS-only
is verified by the probe and its numbers go in the commit message.

## T2 — P12: phone type floor and 44px tap targets (phone, after T1)
Files: `web/src/theme.css`, `web/src/components/hud.css`, `betrail.css`,
`controls.css`, `dealer.css`, `scoreboard.css`, `home.css`.
Rule: in the phone block nothing in the pixel display font renders below 10px
(8→10, 9→11, 11→12); every interactive element has a hit area ≥44×44 via padding or
a `::before` hit-expander, without growing the visible chrome more than needed.
Targets from the audit: Reset bank, Lobby, Mute, Music, volume slider, road "?",
bonus "i", MAIN/BONUS tabs, Full roads, home learn links, Deal/Watch/Clear.
Verify: probe measures every `button, [role=button], input, a` box at 390×844 and
360×780 and prints any under 44px on either axis; page width stays 390/360; report
the new total page height (was 1150 at 390×664 in the Mid Betting state).

## T3 — B1–B5: battery (side branch `phone/battery`)
Files: `web/src/theme.css` (felt-swirl only), `web/src/audio/sfx.ts`,
`web/src/audio/useGameSounds.ts`, `web/src/App.tsx` (one listener), `cards.css`
(`total-glow`), `victory.css` (`victory-glow`), `multiplayer/multiplayer.css`
(`seat-wait`), `web/src/cardgl/CardGLOverlay.tsx`, `web/src/components/SqueezeCard.tsx`.
- B1: stop the body `background-position` animation on phones: gate `felt-swirl`
  to `(pointer: fine)` and `(min-width: 701px)`; on coarse pointers the felt is
  static. Keep the reduced-motion rule.
- B2/B5: one `visibilitychange` handler (a small module `web/src/audio/sleep.ts` or
  inside sfx.ts, exported `installSleepOnHide(): () => void`) that on hidden calls
  `stopAmbience()` and `ctx.suspend()`, and on visible resumes the context and
  restarts ambience if it was on. Mute must suspend the context too, not just zero
  the gain. Add `document.documentElement.classList.toggle("hidden", document.hidden)`
  and a CSS rule `.hidden * { animation-play-state: paused !important; }`.
- B3: convert the three infinite pulses to `opacity`/`transform` only (no
  box-shadow/filter in keyframes). If a glow needs box-shadow, animate the opacity
  of a pseudo-element that carries the static shadow.
- B4: the rAF loop in the WebGL overlay starts on grab/flip and stops on
  release/settle; confirm mount lifetime and document it in a comment.
Tests: vitest for the sleep module (fake document.hidden + dispatch
`visibilitychange`, assert suspend/resume + ambience calls); an rAF test for the
overlay if it has a testable hook, otherwise a unit test on the extracted
start/stop helper.

## T4 — #22: mark naturals on the Big Road (side branch `feat/naturals-road`)
Files: `engine/src/scoreboard.rs` (`RoundRecord` + `BigRoadCell` gain
`pub natural: bool`), wherever `RoundRecord::from_round` reads the round
(a natural is a two-card 8 or 9 on the winning side; on a tie, either side),
`engine-wasm` types if hand-written, `web/src/components/roads.tsx`,
`roadGlyphs.tsx`/`roadTokens.tsx`, `roads.tsx` tests, `RoadsModal.tsx` (optional
NATURAL tally row), `scoreboard.css`.
Contract: `BigRoadCell { …, natural: bool }` serialized as `natural`. The
right-rail Big Road stays byte-identical except for the new gold dot, placed in a
free corner (pairs use two corners; bonuses use tokens — pick the corner that
is free and document it). Gold = existing `--gold` token. Engine tests: natural
on P and B win, natural on a tie, no natural on a three-card 8/9. Web tests: the
dot renders when `natural` is true and not otherwise; snapshot of a non-natural
cell unchanged. Run `npm run build:wasm` and the roads engine test.

## T5 — #19: phone landscape and tablets (phone, after T2)
Files: `web/src/theme.css`, `scoreboard.css`, `betrail.css`, `hud.css`.
Add `@media (orientation: landscape) and (max-height: 500px)`: two columns —
felt+controls left (60%), HUD-compact above the bet rail right; roads below,
scrollable; action bar NOT fixed in landscape (inline under the felt). Tablets
(768–1024 wide): use the 2-column "stage / hud board" layout and remove the
dead void beside Big Road by letting the board fill its column.
Verify with the probe at 844×390, 768×1024, 1024×768: every core-loop element
(bankroll, dealer line, both hands, Player/Banker spots, Deal) visible without
scrolling in landscape; no horizontal overflow.

## T6 — #18: short desktop viewports 1280×720 / 1366×768 (after T5)
Files: `web/src/theme.css`, `scoreboard.css`, `cards.css`, `hud.css`.
Extend the `(min-width:701px) and (max-height:880px)` block with a
`(max-height: 800px)` step: smaller card step, tighter HUD, roads dock capped to
the viewport with internal scroll, so the dealer bubble, both hands, the chip row
and the third-card table all fit. Verify: at both sizes in the Dealt state the
document height ≤ viewport height and no click auto-scrolls.

## T7 — #20: large screens (after T6)
Files: `web/src/theme.css`, `cards.css`.
Replace the 1560px cap with integer scale steps: at ≥1920 wide and ≥1000 tall use a
`--ui-scale: 1.25`-style step applied to the card size variables and the pixel
type (rounded to whole pixels so the pixel art stays crisp); ≥2560: 1.5. Verify
at 2560×1440 and 3440×1440 that the table fills ≥50% of the width and no label
is under 12px.

## T8 — P14: deal-flow capture and fix (main session captures, then dispatches)
Main session runs the probe through Betting → Deal → squeeze → Settled at 390×844,
saves frames, lists concrete defects; each defect becomes its own dispatched task.

## T9 — three-phone multiplayer harness (side branch `tooling/phones`)
Files: `scripts/phones.mjs` (new, repo root), `package.json` script `phones`,
`docs/TESTING.md` (new).
`npm run phones` starts the Rust server (`cargo run -p baccarat-server`, port
8788) if not already listening, the Vite dev server if not already on 5173, then
launches HEADED Chromium via playwright-core with three separate browser
contexts using `devices["iPhone 14"]`, each in its own window, positioned side
by side, all at `http://localhost:5173/?room=` (lobby). Ctrl-C tears everything
down. Flags: `--tier=mid`, `--n=3`, `--device="Pixel 7"`. Document the manual
script: phone 1 creates a table, phones 2–3 join by code, bet, deal, squeeze,
settle, one leaves, one watches from the rail.

## T8b — Peel stage on phones + a reachable peel (owner direction 2026-09-13)
Owner: "once the bets are in only the view of the cards matters … bring the
cards up to the front of the player's view where they can see only the Player
and Banker cards … since we are peeling with the finger the card is under the
finger, so make the radius in which the card is peelable larger than the face."
Files: new `web/src/components/PeelStage.tsx` + `peelstage.css` + test,
`App.tsx` (mount on phones in Dealing), `SqueezeCard.tsx` (hit reach + lens),
`cards.css`, `squeeze.ts` if the geometry needs a clamp, docs/BACKLOG.md.
1. On coarse-pointer / ≤700px viewports, when the phase is Dealing (after the
   deal fly-in), mount a fixed full-viewport stage above the page: compact dealer
   line at the top, Player and Banker hands centred and LARGE (two cards ≥ 96px
   wide each; a third card lands at the same size, three per side must still fit
   390 with 8px gaps), the "Ask the dealer" flip buttons under the hands, and the
   pinned bar (Reveal / Explain) still reachable. Body scroll locked while up.
   Unmounts when the phase leaves Dealing (Settled shows the normal felt with the
   outcome). Solo and multiplayer (seats and rail) alike; the squeeze rights are
   unchanged — non-holders see the cards, cannot peel.
2. Peel reach: the pointer target of a face-down card extends `--peel-reach`
   (28px) beyond its face on every side (transparent hit-expander; keyboard/aria
   untouched). A gesture that starts in the reach maps to the nearest corner and
   drives the same grip/fold maths as one that starts on the face.
3. Peek lens: on coarse pointers, while a peek is in progress, render a 2× lens
   of the card's peeked corner ABOVE the finger (offset −72px in y, clamped to the
   viewport) so the sliver is visible even though the finger covers the card.
   Hidden on fine pointers. Removed on release.
Tests: PeelStage mounts/unmounts on phase + media (mock matchMedia); SqueezeCard
starts a drag from inside the reach; lens renders only during a peek on coarse
pointer. Probe at 390×844 and 360×780: stage covers the viewport, hands' card
widths, no page overflow, a drag starting 20px outside the card face peeks it.
