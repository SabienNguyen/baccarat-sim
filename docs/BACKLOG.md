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
| S8 | **Invite-code brute force is unthrottled** — a private room's 6-char code (32^6 ≈ 1.07B) is its only privacy control, but `JoinRoom` guesses hit an O(1) lookup with no rate limit, no backoff, no failed-attempt logging, over any number of sockets | M | `rooms.rs:136-138`, `main.rs:153` — per-connection join-attempt budget + tracing on failures |
| S9 | **A panic mid-command permanently wedges the room** — if `handle_command` unwinds (e.g. the H2 engine panics) the post-loop cleanup in `main.rs:107-116` never runs, leaving a ghost `conns` entry whose seat blocks `deal()` forever via `WaitingOnPlayers`; only a process restart recovers, and nothing is logged | M | make seat cleanup panic-safe (drop guard / `catch_unwind` around dispatch); materially worse consequence than H2's panic itself |
| S10 | Per-connection outbound `mpsc::unbounded_channel` has no bound or backpressure — a stalled client accumulates queued `State` broadcasts without limit (every accepted command from any seat pushes another) | S | `main.rs:59` — bounded channel + disconnect-on-full (slow client forfeits, same as idle) |
| S11 | No cap on raw WebSocket connections (total or per-IP) — `MAX_ROOMS`/`MAX_SEATS` bound rooms, but an attacker can hold unlimited idle sockets, each with a reader + writer task | M | `main.rs:56` — global + per-IP connection ceiling |
| S12 | **Fly autoscale-to-zero silently destroys live games** — `min_machines_running=0` + zero persistence means a routine cost-saving stop wipes every room mid-hand; compounded by no graceful shutdown (`axum::serve` has no shutdown hook), so even deploys hard-reset sockets with no `Closed{reason}` | M | `fly.toml:10-12`, `main.rs:44` — decision: keep 1 machine warm vs accept + add signal handler that broadcasts a "casino is closing" notice and drains |

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
| F10 | Client-side reconnect with backoff — today any `onclose` lands on a dead-end "connection dropped" screen with only a Back button; even without F7's seat resumption, auto-retrying the socket (and distinguishing a blip from an outage) salvages the common case | M | `Multiplayer.tsx:113-117` — pairs with F7 and H12 |

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
| H8 | ~~Replace unreachable "card source exhausted" panics~~ | — | duplicate of H2 (merged 2026-07-24) — see also S9 for why the panic's blast radius is a wedged room, not just a dropped connection |
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
| H19 | **WASM load failure = blank page** — the engine is a top-level-await ESM import with no try/catch, loading state, or fallback; an unsupported browser, CSP block, or failed `.wasm` fetch surfaces as an unhandled rejection with no user-facing message | S | `main.tsx:21`, `adapter.ts:1` — error boundary + "couldn't load the table" screen |
| H20 | Malformed server messages are silently swallowed (empty catch on `onmessage` JSON parse) — a wire-format mismatch after a deploy fails invisibly; there's also no client-side stale-connection detection, so a half-open socket freezes the UI on the last known state | S | `Multiplayer.tsx:81-85` — log + surface a "table out of sync" state (pairs with S4 ping/pong) |
| H21 | Dockerfile hardening: runs as root (no `USER`), no `HEALTHCHECK`, floating base tags (`rust:1`, `node:22-slim`, `debian:bookworm-slim`), `wasm-pack` via unpinned `curl \| sh`; fly.toml has no HTTP health check and the server exposes no `/health` route | S | `Dockerfile`, `fly.toml`, `main.rs:29` |
| H22 | No protocol version field in `ClientMsg`/`ServerMsg` — client/server skew after a deploy degrades to a generic "Unrecognized message" instead of a negotiated "please refresh" | S | `protocol.rs:30-67` — version in a hello/`Joined` exchange |
| H23 | Server observability is two `info!` lines — errors sent to clients, disconnects, room create/sweep, and idle evictions are all unlogged; no room/connection gauges, so a wedged room (S9) is invisible until a player complains | M | `main.rs`, `rooms.rs` — structured tracing per event + a room-count/conn-count stat on `/health` (H21) |
| H24 | `CardGLEngine.dispose()` relies solely on `WEBGL_lose_context` — add explicit `deleteTexture/Buffer/Program/VertexArray` so cleanup survives a future refactor that keeps the context alive across gestures | S | `engine.ts:244-252` |
| H25 | No config validation at construction — `table_min > table_max` or negative bankroll/limits silently makes every bet fail instead of erroring at `Session::new`/`Table::new`; `Bet.amount` non-negativity is a doc-comment invariant with no `debug_assert` at the settle boundary | S | `session.rs:167`, `table.rs:136`, `settle.rs:24`, `sidebets.rs:418` |
| H26 | `denoms[0]` is assumed to be the smallest denomination in both stores, but nothing enforces that `tables.ts` lists `denoms` ascending (unlike `toChips`, which sorts) | S | `gameStore.ts:140`, `remoteStore.ts:54`, `tables.ts` — sort or assert |
| H27 | Shuffle RNG is `StdRng`, whose algorithm is not guaranteed stable across `rand` version bumps — any future save/replay/audit feature assuming "same seed ⇒ same shoe" breaks silently on upgrade; statistical validity is unaffected | S | `shoe.rs:33` — pin a named algorithm (`ChaCha8Rng`) or document the non-guarantee (blocks D8's rand 0.9 upgrade until decided) |

## Test-coverage gaps (ranked by risk)

| # | Untested behavior | Effort | Notes |
|---|-------------------|--------|-------|
| T1 | Single-player auto-settle-once effect (`App.tsx:171`) — the `settledThisCoup` ref guards against double-settle / stuck-in-Dealing; no test | S | highest value; a regression here hangs or double-pays a coup |
| T2 | Dealer-pacer sound count over a full paced coup (exactly one `deal` + N `flip`, no double `win`) | S | the double-play surface audits keep probing |
| T3 | `DerivedRoadView` mark rendering — a `"Red"` cell renders filled `●`/red and `"Blue"` hollow `○`/blue in the right cell (data→pixel faithfulness) | S | `roads.test.tsx` only covers BigRoad follow-latest |
| T1b | ~~Side-bet paytables had no statistical assertion~~ | S | ✅ done 2026-07-20 (`statistics.rs` now asserts realized edge for all 10 side bets vs published) |
| T4 | Goal crossing on a side-bet-only win (`gameStore.ts:176`) — covered only via a main-bet payout | S | |
| T5 | Multiplayer raw `onclose` path ("Connection to the casino dropped") — only the explicit server `{type:"closed"}` message is tested | S | `Multiplayer.tsx:113-117`, `Multiplayer.test.tsx` |
| T6 | `GameTable` victory wiring — no test drives `goalReached=true` through the component to confirm `VictoryModal` renders (modal and store are only tested in isolation); `App`-level home→table→multiplayer routing also untested | S | `App.tsx:316-326`, `App.test.tsx` |
| T7 | Components with no dedicated test: `RoadsModal` (Escape/backdrop/road composition), `BonusInfoModal` (Escape/backdrop/lookup), `BonusNudge`, plus `cardArt.ts` (`suitColor`, `PIP_LAYOUT` per rank) | S | only indirect coverage today |
| T8 | Adapter malformed-error path — `error as CommandError`/`as TableError` casts are never exercised with a genuine wasm panic/unknown shape (the H11 masking bug has no failing test) | S | `adapter.ts:41,102` |
| T9 | `Session` post-settle snapshot behavior is asserted nowhere — the divergence from `Table` (E1) is invisible to the suite | S | `session.rs:367-380` |

(Note: bust exactly at `table_min` IS covered — `gameStore.test.ts:221`, roll==min → not busted.)

## Engine architecture / duplication

Structural findings from the 2026-07-24 sweep. None are bugs today — each is a
place where one rule lives in two hand-synced copies, so a future change has
two-plus places to update with nothing to catch drift.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| E1 | **Consolidate `Session` and `Table`, or document why both exist** — the shipped app only uses `Table` (max_seats=1 via `createTableSession`), leaving `Session` (767 lines + its half of the wasm bindings) product-dead yet carrying copy-pasted bet validation (`session.rs:185` vs `table.rs:208`) and payout dispatch (`session.rs:358` vs `table.rs:618`). They have already diverged: after `settle()`, `Session::snapshot()` drops the finished round while `Table::view_for` keeps it as `Settled` — the exact asymmetry `gameStore.ts:188`'s `newHand()` patches client-side | L | retire `Session`/`WasmSession`, or extract shared validation/settlement helpers both delegate to |
| E2 | **Scoreboard recomputed from full history on every wasm call** — `derive_scoreboard` (O(n) over all rounds, all 5 roads) runs on every `place_bet`/`peek`/`reveal`/`settle`, ~8-10× per coup, i.e. O(n²) aggregate over a session, with the whole snapshot copied across the FFI each time | M | `session.rs:253,378`, `table.rs:584,607` — cache per settled round, invalidate on history change |
| E3 | Banker third-card tableau implemented twice — `banker_draws` (boolean, `rules.rs:12-24`) and `banker_reason` (prose, `rules.rs:31-49`) are independent; a rule variant (A4) could update one and leave the explanation wrong while both test suites pass | S | derive both from one const tableau table |
| E4 | The 6-element deal/reveal ritual order exists in **four** hand-synced copies: `table.rs:334` and `table.rs:429` (Rust), `App.tsx:118-125` (`revealAll`) and `cards.ts:62-69` (`lastFlipBetween`) (TS) | S | one shared const per language + a golden test tying TS to the engine |
| E5 | Card-value logic duplicated TS-side — `RANK_VALUE`/`runningTotal` (`cards.ts:18-49`) mirror `card.rs:42`/`hand.rs:9` for mid-squeeze running totals; `bonusNudge.ts:26-47` likewise mirrors side-bet *hit conditions* from `sidebets.rs`. Legit UX reasons, but no shared fixture asserts the copies still match | S | golden-fixture test: engine-generated (cards → value/total, outcome → nudge candidates) verified against the TS implementations |
| E6 | House-edge data is three hardcoded strings for main bets only — ignores `ruleset` (EZ Baccarat would change Banker's edge, blocking A3) and covers none of the 10 side bets | S | `houseEdge.ts:10-20` — table keyed by ruleset + side-bet entries (Explain panel only, per N6 decision) |
| E7 | GLSL vertex shader is a manual port of `curlMath.deform` marked "MUST stay in lockstep" with no automated check — only the manual `glprobe` page compares them | M | `shaders.ts:20-41` — CPU-reference comparison test (headless-gl or a parity harness sampling both at fixed grips) |
| E8 | CSS-fallback spring duplicates `springs.ts` constants and formula by hand (`TAU`/`OMEGA` copied); also `springBack` calls `setFold` per rAF frame, re-rendering the component ~every frame for the settle tail, which the GL path deliberately avoids | S | `SqueezeCard.tsx:79-104` vs `springs.ts:23-26` — export a shared `flutterScale`, and drive the CSS fallback via a ref/style mutation |

## UI consolidation / polish

| # | Item | Effort | Notes |
|---|------|--------|-------|
| C1 | Delete dead `exchange.css` (87 orphaned lines — no `ExchangeModal` exists) and extract the `.btn` base rule duplicated across 7 css files (incl. a double definition inside `controls.css`) into `theme.css` | S | `components/exchange.css`, `bonusinfo.css:31`, `bust.css:52`, `controls.css:9-22`, `cutdeck.css:76`, `scoreboard.css:190`, `victory.css:50` |
| C2 | Shared design tokens for z-index (literals 3/4/50/60/80/85/90/95/95 today — bust and victory collide at 95, safe only while mutually exclusive) and breakpoints (520/700/840/900/1040/1240/1340px scattered across ~8 files) | S | `theme.css` custom properties |
| C3 | Extract a `useEscapeToClose` hook — the same 6-line window-keydown effect is copy-pasted in 3 modals; fold into the Y4 modal a11y pass | S | `BonusInfoModal.tsx:27`, `CutDeckModal.tsx:20`, `RoadsModal.tsx:12` |
| C4 | Render-perf pass when warranted: zero `memo`/`useMemo`/`useCallback` anywhere means any of `GameTable`'s ~20 store slices re-renders the whole tree; `BetRail.stakedOn` does O(spots×bets) `JSON.stringify` per render | M | `App.tsx:84-109`, `BetRail.tsx:56-59` — profile first; fine at today's DOM size |
| C5 | Codify that `probe.html`/`glprobe.html` are dev-only (currently excluded from prod build only by Vite's default single-entry behavior — a future multi-page config would silently ship them) | S | comment in `vite.config.ts` or move under a dev-only convention |

## Tooling / DevEx / CI

Previously untracked area — no lint config, no PR gate, and several hygiene
leftovers. Confirmed 2026-07-24: `cargo clippy --all-targets --all-features`
is already zero-warning, so adopting the gates is cheap.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| D1 | **No linting/formatting anywhere** — no ESLint, Prettier, rustfmt, or clippy config or CI step in the entire repo; `web/README.md` is literally the unmodified Vite boilerplate describing how one *would* add ESLint. TypeScript strictness is the only static gate | M | add eslint (typed) + prettier for `web`, `cargo fmt --check` + `clippy -D warnings` in CI |
| D2 | **CI only runs after merge** — both workflows trigger on push to `main`; no `pull_request` trigger, so tests/typecheck never gate a PR | S | `.github/workflows/deploy.yml:3`, `server-deploy.yml:6` — split a `ci.yml` (test/lint/typecheck on PRs) from deploy |
| D3 | **Server deploys with zero verification** — `server-deploy.yml` runs no tests before `flyctl deploy`; `smoke/` exists but is never executed anywhere (CI, Docker, docs), and it only exercises the wasm engine — no smoke test ever connects a WebSocket to a real server and drives create/join/bet/deal/settle | M | wire `npm run smoke` into CI + add a WS smoke script (spawn `baccarat-server`, run one scripted coup) as a server-deploy gate |
| D4 | Toolchain pinning: CI floats on `stable` Rust (no `rust-toolchain.toml`), `wasm-pack` installs via unpinned `curl \| sh` in CI and Docker, no `engines`/`.nvmrc` for Node | S | pin all three; also fixes reproducibility half of H21 |
| D5 | Repo hygiene: orphaned `engine/Cargo.lock` (inert inside the workspace since commit 1), duplicate `smoke/package-lock.json` (root workspace lock already covers it), committed ad-hoc `web/.verify3.mjs` (depends on undeclared `playwright-core` + machine-specific paths) | S | delete all three |
| D6 | Docs drift: `README.md:61,64` claims 137/190+ tests (actual 146/320+); `web/README.md` is template boilerplate; `docs/superpowers/` design docs are unlinked from any README; no CONTRIBUTING.md | S | fix counts (or drop the numbers), rewrite `web/README.md` with the real wasm-first workflow, index the docs |
| D7 | No one-command bootstrap — a newcomer must run `build:wasm` → `npm install` → dev server in order across two toolchains, with a confusing `npm install` failure if done backwards; multiplayer dev additionally needs a manual `cargo run -p baccarat-server` | S | root `setup`/`dev` scripts (chain wasm build; `concurrently` for server + vite) |
| D8 | Dependency currency: React 18 / Vite 5 / Vitest 2 / zustand 4 (each ≥1 major behind, Vite 5 + Vitest 2 past support window), axum 0.7, rand 0.8 (see H27 before touching), `Cargo.lock` never updated in 50 commits; no Dependabot/Renovate | M | staged upgrades behind the D1/D2 CI gate |
| D9 | tsconfig missing modern strictness: `noUncheckedIndexedAccess` (cheap insurance at the money boundary), `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` | S | `web/tsconfig.json` |

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
- **2026-07-24 (five-track comprehensive sweep — engine+wasm, server+deploy,
  web core, presentation layer, tooling/CI):** Whole-repo exploration by five
  parallel readers, findings reconciled against this backlog. No rules bugs —
  reconfirmed the engine is clippy-clean, panic-free outside the two tracked
  sites, and its statistical tests are deterministic (seed-driven, no flake
  risk within a fixed `rand` version — see new H27 caveat). The sweep's theme:
  the *game* is in great shape; the gaps are operational (server abuse
  resistance, observability, deploy verification) and structural (rules
  duplicated across `Session`/`Table` and across the Rust/TS boundary, zero
  lint/CI gating on PRs). Logged: S8-S12 (invite brute force, panic-wedged
  rooms, unbounded outbound queues, no connection caps, autoscale data loss +
  no graceful shutdown), H19-H27, E1-E8 (new engine-architecture section:
  Session/Table consolidation, O(n²) scoreboard recompute, four copies of the
  ritual order, TS/Rust golden fixtures, shader lockstep), C1-C5 (UI
  consolidation: dead exchange.css, 7× `.btn`, z-index/breakpoint tokens),
  D1-D9 (new tooling section: no lint anywhere, CI only post-merge, server
  deploys untested, smoke never runs, toolchain unpinned, stale docs, dep
  currency), F10, T5-T9. Merged the H2/H8 duplicate. **Build-next ranking:**
  (1) D1+D2 — lint + PR-gated CI first, it cheapens everything after;
  (2) H19 — wasm-load blank page is the worst first-run failure mode;
  (3) S8+S10 — the two cheap server-abuse holes; (4) S9 with H2 — panic-safe
  cleanup + graceful reshuffle together close the wedged-room scenario;
  (5) D3+H21+H23 — smoke-gated server deploys, health endpoint, real logging;
  (6) E1 — decide Session vs Table before any new rule work doubles;
  (7) F10+H12 — multiplayer resilience as one arc; then D5/D6/C1-C3/E3-E5 as
  small-batch cleanups alongside feature work.
