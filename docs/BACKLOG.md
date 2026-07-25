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
| S7 | `sweep`/`list_public` hold the global registry lock across every per-room `await` — one slow/held room lock stalls all creates/joins/lobby-refreshes floor-wide (O(rooms) serial locking each disconnect) | S/M | ✅ fixed 2026-07-24 (snapshot Arcs, release map lock, inspect rooms unlocked; sweep re-verifies candidates under the map lock with `try_lock` so a racing join can't lose its room) |
| S5 | **Multiplayer settle popup/sound re-fired with a bogus $0 "push"** — `settleSeq` was keyed off `prev.phase !== "Settled"`, but the local `newHand()` sweeps phase to Betting while the server view stays Settled, so any other seat's action re-broadcast re-triggered it | S | ✅ fixed 2026-07-20 (fire only on genuine `Dealing→Settled` edge; regression test added) |
| S6 | **`sweep()` orphaned a room during the create→seat handoff** — a freshly created room is empty until its creator seats, and any other client's disconnect-sweep in that gap dropped it from the registry while the creator seated into a now-unreachable room (under load, stranded 63/64) | S | ✅ fixed 2026-07-20 (`seated_once` flag + `SEAT_GRACE`; spare young un-seated rooms; 2 regression tests) |
| S8 | **Invite-code brute force is unthrottled** — a private room's 6-char code (32^6 ≈ 1.07B) is its only privacy control, but `JoinRoom` guesses hit an O(1) lookup with no rate limit, no backoff, no failed-attempt logging, over any number of sockets | M | ⚙ tightened 2026-07-24: per-connection strike budget (10 unknown-code joins → close). **Audit follow-up 2026-07-24:** the budget reset fired on *any* lookup hit (incl. an already-known code), so interleaving one valid code every few guesses reset it forever on one socket — now resets only on a **real seating** (`sit` returns whether it seated). Residual per-connection reconnect / leave-rejoin bypass still needs the S11 per-IP counter |
| S9 | **A panic mid-command permanently wedges the room** — if `handle_command` unwinds (e.g. the H2 engine panics) the post-loop cleanup in `main.rs:107-116` never runs, leaving a ghost `conns` entry whose seat blocks `deal()` forever via `WaitingOnPlayers`; only a process restart recovers, and nothing is logged | M | ✅ fixed 2026-07-24 (`catch_unwind` around dispatch: a panic logs an error, tells the client, and falls through to the normal seat cleanup instead of skipping it). **Audit follow-up 2026-07-24:** the sibling `maybe_pace` background task had the SAME wedge (a panic would leave `pacing=true`, soft-locking all future house flips) and no guard — now wrapped in `catch_unwind` that always clears `pacing` and logs |
| S10 | Per-connection outbound `mpsc::unbounded_channel` has no bound or backpressure — a stalled client accumulates queued `State` broadcasts without limit (every accepted command from any seat pushes another) | S | ✅ fixed 2026-07-24 (bounded at `OUT_QUEUE=256`, `try_send` drops overflow — every `State` is a full snapshot so a later one supersedes; a dead client is reaped by the idle timeout) |
| S11 | No cap on raw WebSocket connections (total or per-IP) — `MAX_ROOMS`/`MAX_SEATS` bound rooms, but an attacker can hold unlimited idle sockets, each with a reader + writer task | M | ✅ mostly fixed 2026-07-24 (global `MAX_CONNS=1024` RAII-counted cap, refused upgrades logged; per-IP accounting still open — needs `ConnectInfo` plumbing) |
| S13 | **Peeked cards broadcast their full identity to every seat** — `check_rights` gated who may *peek*, but `view_for` sent the same `Peeked { sliver: Pip { suit, rank } }` to all viewers, so any client at the table read the exact card the squeezer was privately bending up. Defeats the squeeze's information asymmetry at the data level for networked seats | S | ✅ fixed 2026-07-24 (per-viewer redaction in `view_for`: another player's peek renders as `FaceDown` until revealed; solo tables unaffected; regression test) |
| S14 | Squeeze tie-break inverted — `max_by_key` returns the *last* max, so tied stakes gave the squeeze to the later-seated player, contradicting the documented "ties: first seated" | S | ✅ fixed 2026-07-24 (strict-`>` fold in seat order; regression test) |
| S15 | Stale `outcome` in Betting views — cleared only at `deal()`, while `payouts`/cards/explain reset per-player on re-bet, so a re-betting player's "fresh coup" view still carried the previous round's outcome | S | ✅ fixed 2026-07-24 (gated on the viewer's own `payouts`, same as the other settled-display fields; regression test) |
| S12 | **Fly autoscale-to-zero silently destroys live games** — `min_machines_running=0` + zero persistence means a routine cost-saving stop wipes every room mid-hand; compounded by no graceful shutdown (`axum::serve` has no shutdown hook), so even deploys hard-reset sockets with no `Closed{reason}` | M | ⚙ half fixed 2026-07-24: SIGTERM/ctrl-c now broadcasts "the casino is closing" to every table and drains before exit. The keep-warm decision (`min_machines_running=1` vs accepting resets) is still open — it's a cost call |
| S16 | **`view_for` fully buffered oversized WebSocket frames before the 4 KiB check** — the app-level `text.len() > 4096` guard runs only *after* tungstenite reassembles/UTF-8-validates the whole message, and its defaults allow 64 MiB; a client could stream near-64 MiB frames (allocated then discarded) across `MAX_CONNS` sockets for a memory/CPU amplification DoS | S | ✅ fixed 2026-07-24 (`max_message_size`/`max_frame_size = 8 KiB` set on the upgrade, rejecting oversized frames at the transport before buffering; app-level 4 KiB check kept as defense in depth) |
| S17 | **`sweep()` can orphan a live room that a `JoinRoom` is racing** — `get()` clones the room Arc and releases the map lock before `sit()` locks the room, so a disconnect-triggered sweep on a momentarily-empty (`seated_once`) room can reap it between the joiner's `get` and `lock`; the joiner then seats into a room no longer in the registry, invisible to everyone else and burning strikes for a valid code. Pre-existing (the two-phase sweep didn't introduce it — `get`→`lock` was never atomic), timing-dependent, no money/data impact | M | open — needs an in-flight-join marker (atomic on `Room` bumped by `get`, checked by sweep) or fold the final empty-check + removal into one critical section that also excludes pending joins |
| H28 | A dropped one-shot control message (`Joined`, `Closed`, `Left`) can wedge a client — unlike `State`/`Rooms` these aren't supersede-able snapshots, but they ride the same bounded `try_send` that drops on a full queue. A client that fills its own queue then `CreateRoom`s is seated server-side but never learns it, holding a seat until the 5-min idle evict | S | open — reserve queue headroom (or a separate control channel) for one-shot messages, or have the client re-request state on a heartbeat |
| S18 | **A malformed/version-skewed server push could white-screen the whole app** — the client did no runtime validation of `ServerMsg`/`TableView` (TypeScript casts only) and had no React ErrorBoundary, so one unguarded field access in the render tree (`snapshot.bets.reduce`, `seats.map`, …) unmounts the root to a blank page. Not reachable from a hostile peer (the server's serde types guarantee shape) but reachable via a protocol skew after a deploy — which the client only `console.warn`ed on and then rendered anyway | S | ✅ fixed 2026-07-24 (ErrorBoundary around the app → recoverable "table hit a snag" notice; `proto` mismatch is now a hard stop with a refresh prompt instead of building a store from an unknown shape; tests) |
| S19 | **Peer display names weren't sanitized for Unicode control/format chars** — the server trimmed + capped to 24 chars but passed bidi overrides (U+202E), zero-width joiners, and the BOM straight through to every other seat's DOM, letting a peer render their own name reversed, blank, or spoofing another seat. Not XSS (React escapes text), a display-integrity/spoofing gap | S | ✅ fixed 2026-07-24 (`clean_name` strips control + format-category chars at the single `sit` choke point, then trims/caps; client adds `max-width`/ellipsis on the seat name; server unit test) |
| S20 | Settle popup/sound can be skipped under outbound-queue backpressure — the client detects settlement off a strict `Dealing→Settled` phase edge, so if the intervening `Dealing` broadcast is the one dropped by `try_send` (S10), a solo-room player may miss the win/loss popup until their next action elicits a fresh push | S | open — key settle detection off a monotonic round id / "payouts newly non-null for a round we haven't shown," not a strict phase transition (touches server protocol + `remoteStore`) |
| S21 | **`sit()` commits room-side state before the connection's own seat tracker** — `guard.seat()` inserts the player into `Room.conns`/`Table.players`, but `*seat` is set only after the fallible `view_for().expect()` + `broadcast()`; a panic there is caught by the dispatch `catch_unwind`, yet the disconnect cleanup keys off `seat.is_some()` and skips, leaving a ghost seat that wedges the room (the S9 class via a join-in-progress ordering gap). Not live-triggerable under current invariants but a landmine for any future fallible view/scoreboard step | M | ✅ fixed 2026-07-24 (commit `*seat` right after `guard.seat()`, before the fallible work) |
| S22 | **`clean_name` missed the Unicode Tags block (Cf)** — S19 stripped bidi/zero-width chars, but `U+E0000–E007F` (invisible "ASCII smuggling" payloads), plus soft hyphen / arabic letter mark / mongolian vowel separator, passed through into every peer's `SeatView.name` — an invisible covert channel through the field hardened for exactly this | S | ✅ fixed 2026-07-24 (extended `is_format_char`; regression test) |

## Authenticity (gameplay matches a real pit)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| A1 | Cut-card behavior: let the cut card emerge mid-shoe, finish the hand plus one "last hand", show a cut-card marker — instead of today's preemptive reshuffle at ≤14 cards | M | `session.rs:268`, `table.rs:286`; no statistical bias today, purely procedure |
| A2 | Big Road dragon tail: cap columns at 6 rows and bend right | M | ⚙ partly done: colored circles + tie-slash shipped earlier; **pair dots + animal bonus tokens done 2026-07-24** (traditional blue top-left / red bottom-right pair dots, plus pixel-art Dragon 7 / Panda 8 / Tiger tokens hung off the ring — engine now carries `dragon7`/`panda8`/`tiger` flags per cell). Still open: the 6-row column cap and right-bend for a long dragon tail. **Measured 2026-07-25 (UI review loop):** columns do exceed six rows in practice — after 30 hands the Big Road's tallest column hit **8**, Cockroach Pig **14** and Small Road **11**, against a grid sized for six (`min-height: 192px`). So a long streak overflows its own box rather than bending right, and the derived roads have no cap at all |
| A3 | Ruleset toggle: Commission vs EZ Baccarat (no-commission, Dragon-7 bar) — engine fully implements `EzBaccarat`, UI hard-wires `Commission` | S | `tables.ts:76`, `rooms.rs:48`, `adapter.ts` |
| A4 | Super 6 / Tie 9:1 rule variants | M | engine change + table config |
| A5 | "Ask/prediction" cells on derived roads (what Big Eye/Small/Cockroach would show if next is P vs B) — standard on electronic displays | M | `scoreboard.rs` + `roads.tsx` |
| A8 | Our Tiger (banker wins with 6, 12:1 two-card / 20:1 three-card) is the same event as the Venetian's **Lucky 6**, which pays 12:1 / **23:1**. Both paytables are authentic; ours is exactly 16.68% and Lucky 6 is 11.70%, making Tiger the worst bet on our felt. Candidate for a "Vegas felt" preset alongside A3/A4 rather than a silent reprice — the tiger token art on the Big Road is tied to the current name | S | `sidebets.rs:80`, `roadTokens.tsx` |
| A7 | Tiger Tie paid 35:1 — the original Marina Bay Sands odds, since superseded by 45:1 in the vendor's own how-to-play | S | ✅ **done 2026-07-25** — now 45:1, which drops the engine's worst house edge from 30.74% to 11.50% (both exact). Updated `tiger_tie_pays`, both dispatch tests, the `statistics.rs` edge band (0.3074→0.1151), the glossary long-form, and the dealer's spoken odds. No visual change: the bet has no felt spot |
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
| N10 | Show the measured house edge per bet **inside `BonusInfoModal`** — the felt spans 2.65% (Player Dragon Bonus) to 16.68% (Tiger), a 6× spread the player cannot see. Deliberately *not* N6: no percentages on the felt itself, only in the panel you open to learn, same place the Explain edges already live | S | `BonusInfoModal.tsx`, numbers from `side_bet_house_edges` |
| N2 | First-run "How to play" / coach overlay — a true novice is dropped straight onto the felt with no primer | M | open |
| N3b | Wire remaining orphan glossary entries `shoe` and `ez-baccarat` (ez only relevant once A3 ruleset toggle lands) | S | open |

## Features

| # | Item | Effort | Notes |
|---|------|--------|-------|
| F1 | Banker-side Dragon Bonus spot (engine supports both sides; UI only offers Player) | S | ✅ **done 2026-07-25** — `B DRAGON` added next to `P DRAGON`, felt now seven spots. Real layouts carry both circles (NJAC 13:69E-1.12 requires two areas for a two-sided bonus wager) and Vegas spreads both (Westgate). Grid went to 7 columns desktop / 4 on small screens, so phones keep two rows and the page height is unchanged at 1486px. `narrate.ts` + `settleExplain.ts` now key the Dragon Bonus by side so the dealer says *which* one paid |
| F2 | Expose remaining Tiger family bets (Big/Small Tiger 50:1/22:1, Tiger Tie 45:1, Tiger Pair) — implemented + tested in engine, absent from `SIDE_SPOTS` | S | ❌ **decided against 2026-07-25.** Exact edges 11.50–16.12%; Big/Small Tiger are only the unbundled legs of the Tiger already on the felt (zero new outcomes); no Las Vegas placement found for Big Tiger, Small Tiger or Tiger Tie. Tiger Pair is the one exception — it is on Venetian felts at our exact 4/20/100:1 — but at 16.12% and overlapping P/B Pair it lost to `B DRAGON` for the seventh spot. Engine support stays for licensees |
| F11 | Trim `BonusInfoModal`'s `BONUS_TERMS` to the bets actually on the felt | S | ✅ **done 2026-07-25** — nine rows down to five, one per reachable spot with the two-sided bets sharing a row. The four Tiger entries stay in the glossary proper. Test asserts the unplaceable four never appear in the dialog |
| F13 | HUD payout ledger printed wire-format bet keys — "PlayerPair", "Panda8", and **both Dragon Bonus sides as a bare "DragonBonus"**, so a player holding both saw two identical rows. Found by a Playwright DOM sweep for enum-shaped text, not by a test | S | ✅ **done 2026-07-25** — new `betKind.ts` owns `sideKey`/`betLabel`; the HUD, the dealer narration and the settle notes now share it instead of keeping three divergent copies |
| F12 | Either Pair (5:1) as an alternative to the two 11:1 pair circles | S | ❌ **decided against 2026-07-25** — exactly 13.71% vs 10.36% for the two separate circles. Common in Vegas, but strictly worse for the player; keep what we have |
| F3 | Session statistics panel: P/B/T counts, pair frequency, longest streak | S | derive from `history`/scoreboard |
| F4 | Multiplayer chat or emotes at the table | M | server protocol addition |
| F5 | Shareable table links (`?room=CODE` deep link joins directly) | S | ✅ done 2026-07-24 (G5) |
| F6 | Multiplayer bust handling: detect `bankroll < table_min`, show a rebuy/leave prompt, auto-sit-out so a broke player can't block deals (`busted` hardcoded false in remoteStore; MP `GameTable` has no `onReset`) | M | `remoteStore.ts:52`, `Multiplayer.tsx:168`, `App.tsx:307` — partially mitigated by S4/AFK (an idle broke player is now evicted after 5 min) |
| F7 | Reconnect token: rejoin resumes the same seat + bankroll instead of a fresh buy-in (today a disconnect forfeits winnings; a busted player rejoins for a free full rebuy) | L | `table.rs:194`, protocol addition |
| F8 | Separate side-bet minimum from `table_min` — today a $5 side bet needs $25 at a $25-min table; real tables enforce the min on main bets only | M | both `place_bet`s + table config |
| F9 | Optional warning when a player stakes both Player and Banker on one coup (allowed, but pure commission bleed) | S | `BetRail.tsx` |
| F10 | Client-side reconnect with backoff — today any `onclose` lands on a dead-end "connection dropped" screen with only a Back button; even without F7's seat resumption, auto-retrying the socket (and distinguishing a blip from an outage) salvages the common case | M | `Multiplayer.tsx:113-117` — pairs with F7 and H12 |

## Hardening

| # | Item | Effort | Notes |
|---|------|--------|-------|
| H1 | Explicit commission rounding policy in `settle.rs:33` — integer floor is exact today only because all denoms are ×100¢; a sub-dollar denom would silently under-charge | S | ✅ fixed 2026-07-24 (policy documented on `settle`: commission floors, fractional cent goes to the player; odd-cent regression test) |
| H2 | Replace unreachable "card source exhausted" panics with graceful reshuffle fallback | S | ✅ addressed 2026-07-24: the invariant is now compile-time (`const` assert `CUT_CARD >= 6` in `shoe.rs`) so lowering the cut card can't re-arm the panics, and S9 contains the blast radius if one ever fires. The panic sites themselves stay — they're the correct crash-on-impossible behavior |
| H3 | Self-host display fonts (Silkscreen, VT323) — first paint currently blocks on Google Fonts | S | ✅ done 2026-07-24 (G3) |
| H4 | `og:image` screenshot for link previews | S | ✅ done 2026-07-24 (G2) |
| M1 | First-time multiplayer squeeze hint (no "Reveal all" in MP by design; new players may not know to tap cards) | S | one-time tooltip |
| H5 | Cross-tab bankroll sync via `storage` events / BroadcastChannel — two tabs at one tier clobber each other's persisted roll (last-writer-wins). Also add an upper cap so a hand-edited localStorage value isn't trusted | S | `useGameStore.ts:24`, `bankrollStorage.ts` |
| H6 | `pointercancel` / `lostpointercapture` cleanup in `SqueezeCard` — an interrupted touch leaves the fold stuck mid-squeeze | S | ✅ fixed 2026-07-24 (`onPointerCancel` settles the fold — GL settle release or CSS clear — and swallows the trailing click; regression test) |
| H7 | Restrict manual reveal of unbet (house) hands — `check_rights` returns Ok when holder is None, so a raw client can flip the dealer's cards ahead of the paced loop (no money impact, lock-serialized) | S | ✅ fixed 2026-07-24 (shared tables — `max_seats > 1` — reserve house hands for the paced dealer; solo tables keep reveal-all; tested both ways) |
| H8 | ~~Replace unreachable "card source exhausted" panics~~ | — | duplicate of H2 (merged 2026-07-24) — see also S9 for why the panic's blast radius is a wedged room, not just a dropped connection |
| H9 | `narrateError` crashed on a `null` error (`"Message" in null` throws) | S | ✅ fixed 2026-07-20 (null/undefined guard) |
| H10 | Guard the adapter money boundary: `Number.isInteger` before `BigInt(amountCents)` so a stray fractional value degrades gracefully instead of throwing | S | ✅ fixed 2026-07-24 (`safeCents`: fractional rounds with a warning, non-finite becomes 0 and the dealer refuses; tested against the real wasm) |
| H11 | A real wasm panic surfaces as the generic "Can't do that, friend." dealer line (RuntimeError has `message`, not `Message`) — detect and log it distinctly instead of masking as a benign refusal | S | ✅ fixed 2026-07-24 (any thrown `Error` logs `console.error` and returns a distinct "table hit a snag" line in both adapter paths) |
| H12 | WS cold-start UX: `min_machines_running=0` means the first idle connect cold-starts Fly while the user waits on "Finding the casino…" until the browser's long WS timeout; add a connect timeout + "waking the table service…" message + retry | M | `Multiplayer.tsx:66` |
| H13 | Derive prod WS URL from `location.host` when no `VITE_WS_URL` instead of hardcoding the canonical fly host — a self-host/preview deploy currently points multiplayer at the canonical app | S | `protocol.ts:54` |
| H14 | Server sets no security headers on the SPA (`ServeDir`): add CSP, `X-Content-Type-Options`, etc. | S | ✅ fixed 2026-07-24 (CSP tuned for wasm/fonts/ws, nosniff, referrer-policy, frame deny — verified live) |
| H15 | Storage has no schema version tag — `loadBankroll` / `loadAudioSettings` parse a raw value, so a future shape change silently resets the saved roll/audio prefs with no migration | S | ✅ fixed 2026-07-24 (v1 envelopes on both; legacy bare values still read so no saved roll is lost; unknown future versions fall back safely; tests) |
| H16 | `goalReached` isn't persisted: reloading after crossing the goal (roll already ≥ goal) never re-shows TABLE BEATEN because `before < goal` is now false — the victory moment is lost across a refresh | S | `gameStore.ts:176` (design call: persist-once vs re-celebrate) |
| H17 | Confirm/mute MP ambience sounds for *other* players' bet/peek actions — `soundsFor` fires `chipPlace`/`squeeze` on aggregate-view deltas; may be intended table ambience or may be noise | S | `remoteStore.ts:60` |
| H18 | Latent autoplay risk: `AudioContext` is created in a mount effect, fine today (table only mounts post-click) but would start suspended/silent if the app ever auto-loads into a table | S | `audio/sfx.ts:47` |
| H19 | **WASM load failure = blank page** — the engine is a top-level-await ESM import with no try/catch, loading state, or fallback; an unsupported browser, CSP block, or failed `.wasm` fetch surfaces as an unhandled rejection with no user-facing message | S | ✅ fixed 2026-07-24 (app loads via dynamic import; failure logs and renders a plain "the casino didn't open" notice with a refresh hint) |
| H20 | Malformed server messages are silently swallowed (empty catch on `onmessage` JSON parse) — a wire-format mismatch after a deploy fails invisibly; there's also no client-side stale-connection detection, so a half-open socket freezes the UI on the last known state | S | ⚙ half fixed 2026-07-24: parse failures now `console.warn` with the payload, and a protocol-version mismatch warns on join (H22). Stale-connection detection still rides on S4 ping/pong |
| H21 | Dockerfile hardening: runs as root (no `USER`), no `HEALTHCHECK`, floating base tags, `wasm-pack` via unpinned `curl \| sh`; fly.toml has no HTTP health check and the server exposes no `/health` route | S | ⚙ mostly fixed 2026-07-24: runtime runs as non-root `casino`, `/health` route (status + room/conn gauges), fly.toml HTTP check wired. Base-tag/wasm-pack pinning folded into D4 |
| H22 | No protocol version field in `ClientMsg`/`ServerMsg` — client/server skew after a deploy degrades to a generic "Unrecognized message" instead of a negotiated "please refresh" | S | ✅ fixed 2026-07-24 (`PROTOCOL_VERSION` rides on `Joined`; the client warns on mismatch with a refresh hint) |
| H23 | Server observability is two `info!` lines — errors sent to clients, disconnects, room create/sweep, and idle evictions are all unlogged; no room/connection gauges, so a wedged room (S9) is invisible until a player complains | M | ⚙ mostly fixed 2026-07-24: room create/sweep, seat release, idle evictions, refused connections, bad-code joins, and handler panics all trace; `/health` carries room/conn gauges. A metrics exporter stays future work |
| H24 | `CardGLEngine.dispose()` relies solely on `WEBGL_lose_context` — add explicit `deleteTexture/Buffer/Program/VertexArray` so cleanup survives a future refactor that keeps the context alive across gestures | S | ✅ fixed 2026-07-24 (all owned GL objects deleted explicitly before `loseContext()`) |
| H25 | No config validation at construction — `table_min > table_max` or negative bankroll/limits silently makes every bet fail instead of erroring at `Session::new`/`Table::new`; `Bet.amount` non-negativity is a doc-comment invariant with no `debug_assert` at the settle boundary | S | ✅ fixed 2026-07-24 (`debug_assert` config invariants in both constructors + non-negative stake asserts at `settle`/`settle_side`) |
| H26 | `denoms[0]` is assumed to be the smallest denomination in both stores, but nothing enforces that `tables.ts` lists `denoms` ascending (unlike `toChips`, which sorts) | S | ✅ fixed 2026-07-24 (`Math.min(...denoms)` in both stores — ordering no longer matters) |
| H27 | Shuffle RNG is `StdRng`, whose algorithm is not guaranteed stable across `rand` version bumps — any future save/replay/audit feature assuming "same seed ⇒ same shoe" breaks silently on upgrade; statistical validity is unaffected | S | ✅ fixed 2026-07-24 (pinned `rand_chacha::ChaCha12Rng` — bit-identical to rand 0.8's StdRng, so every seeded test/stream is unchanged; unblocks D8's rand upgrade) |

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
| E2 | **Scoreboard recomputed from full history on every wasm call** — `derive_scoreboard` (O(n) over all rounds, all 5 roads) runs on every `place_bet`/`peek`/`reveal`/`settle`, ~8-10× per coup, i.e. O(n²) aggregate over a session, with the whole snapshot copied across the FFI each time. **Server angle:** on the multiplayer server this also runs per seated player per `broadcast()` — i.e. on every accepted command from any seat — and `Table.history` is never capped | M | ⚙ recompute half fixed 2026-07-24 (perf loop): memoized in `Table`/`Session` keyed on `history.len()` (append-only, so equal length ⇒ identical roads); within a coup only the first view recomputes, the rest are cache-hit clones (~1.4× cheaper at 800 rounds, gap widens with history — `#[ignore]` bench `scoreboard_recompute_vs_clone`; freshness test added; statistics suite bit-identical). Residual: the snapshot is still cloned + copied across the FFI each call (unavoidable without an API/`ScoreboardSnapshot`-versioning change, which would break the wire types), and `history` is still uncapped — both left open |
| E3 | Banker third-card tableau implemented twice — `banker_draws` (boolean, `rules.rs:12-24`) and `banker_reason` (prose, `rules.rs:31-49`) are independent; a rule variant (A4) could update one and leave the explanation wrong while both test suites pass | S | derive both from one const tableau table |
| E4 | The 6-element deal/reveal ritual order exists in **four** hand-synced copies: `table.rs:334` and `table.rs:429` (Rust), `App.tsx:118-125` (`revealAll`) and `cards.ts:62-69` (`lastFlipBetween`) (TS) | S | one shared const per language + a golden test tying TS to the engine |
| E5 | Card-value logic duplicated TS-side — `RANK_VALUE`/`runningTotal` (`cards.ts:18-49`) mirror `card.rs:42`/`hand.rs:9` for mid-squeeze running totals; `bonusNudge.ts:26-47` likewise mirrors side-bet *hit conditions* from `sidebets.rs`. Legit UX reasons, but no shared fixture asserts the copies still match | S | golden-fixture test: engine-generated (cards → value/total, outcome → nudge candidates) verified against the TS implementations |
| E6 | House-edge data is three hardcoded strings for main bets only — ignores `ruleset` (EZ Baccarat would change Banker's edge, blocking A3) and covers none of the 10 side bets | S | `houseEdge.ts:10-20` — table keyed by ruleset + side-bet entries (Explain panel only, per N6 decision) |
| E7 | GLSL vertex shader is a manual port of `curlMath.deform` marked "MUST stay in lockstep" with no automated check — only the manual `glprobe` page compares them | M | `shaders.ts:20-41` — CPU-reference comparison test (headless-gl or a parity harness sampling both at fixed grips) |
| E8 | CSS-fallback spring duplicates `springs.ts` constants and formula by hand (`TAU`/`OMEGA` copied); also `springBack` calls `setFold` per rAF frame, re-rendering the component ~every frame for the settle tail, which the GL path deliberately avoids | S | `SqueezeCard.tsx:79-104` vs `springs.ts:23-26` — export a shared `flutterScale`, and drive the CSS fallback via a ref/style mutation |

## UI consolidation / polish

Findings from the recurring Playwright UI-review loop (see the dated audit-log
entries). Items here were seen in a real browser but are judgment calls, so they
are logged rather than changed unilaterally.

| # | Item | Effort | Status |
|---|------|--------|--------|
| U1 | **HUD outcome showed the wire enum** — `snapshot.outcome` rendered raw, so the box read `BankerWin`, and since the display font is all-caps that came out `BANKERWIN` | S | ✅ done 2026-07-25 — `outcomeLabel()` in `format.ts`, with a test asserting no label contains a camel-case seam |
| U5 | Main bet spots kept their odds pill while staked, so a tall chip tower climbed into it. The bonus spots already stepped the payout aside; the felt now behaves the same everywhere | S | ✅ done 2026-07-25 — `.spot.is-staked` hides the payout and top-aligns the name, with extra top padding on the arches. Verified only the staked spot is affected |
| U2 | Desktop leaves ~440px of vertical dead space in the left column: the HUD is 460px tall and vertically centred in a 900px viewport, so there is **220px of bare felt above it and 220px below**, while the right column (roads + explain) fills nearly the full height. Either the HUD should carry more (N1 shoe readout, N7 commission tally both want a home) or the column should top-align | S | open — needs a design call, not just a CSS change |
| U3 | The Full Roads dialog is correctly capped and internally scrollable (`max-height` + `overflow-y: auto`, no viewport overflow at 1440×900, 1280×720 or 390×664), but Small Road and Cockroach Pig sit below the fold with **no scroll affordance**, so they read as clipped rather than scrollable | S | open — a fade or a scrollbar gutter would settle it |
| U4 | `NEW SHOE` renders in the same alarm red as `EXPLAIN`, giving a shoe reset the loudest treatment on the felt. Colour currently encodes enabled/disabled, not consequence | S | open — wants a considered button hierarchy, not a one-off tweak |

| # | Item | Effort | Notes |
|---|------|--------|-------|
| C1 | Delete dead `exchange.css` (87 orphaned lines — no `ExchangeModal` exists) and extract the `.btn` base rule duplicated across 7 css files (incl. a double definition inside `controls.css`) into `theme.css` | S | `components/exchange.css`, `bonusinfo.css:31`, `bust.css:52`, `controls.css:9-22`, `cutdeck.css:76`, `scoreboard.css:190`, `victory.css:50` |
| C2 | Shared design tokens for z-index (literals 3/4/50/60/80/85/90/95/95 today — bust and victory collide at 95, safe only while mutually exclusive) and breakpoints (520/700/840/900/1040/1240/1340px scattered across ~8 files) | S | `theme.css` custom properties |
| C3 | Extract a `useEscapeToClose` hook — the same 6-line window-keydown effect is copy-pasted in 3 modals; fold into the Y4 modal a11y pass | S | `BonusInfoModal.tsx:27`, `CutDeckModal.tsx:20`, `RoadsModal.tsx:12` |
| C4 | Render-perf pass when warranted: zero `memo`/`useMemo`/`useCallback` anywhere means any of `GameTable`'s ~20 store slices re-renders the whole tree; `BetRail.stakedOn` does O(spots×bets) `JSON.stringify` per render | M | `App.tsx:84-109`, `BetRail.tsx:56-59` — profile first; fine at today's DOM size |
| C5 | Codify that `probe.html`/`glprobe.html` are dev-only (currently excluded from prod build only by Vite's default single-entry behavior — a future multi-page config would silently ship them) | S | comment in `vite.config.ts` or move under a dev-only convention |
| C6 | Client hardening hygiene: null `onmessage`/`onopen` alongside `onclose` on `Multiplayer` unmount so a message in flight during `close()` can't fire a stale closure (harmless no-op in React 18 today, tidied for defense-in-depth) | S | ✅ fixed 2026-07-24 |
| C7 | UI hygiene (2026-07-24 audit pass): `shareRun` guards `new File`/`canShare` inside its try and treats an `AbortError` cancel as a stop (no second share sheet / silent clipboard write) — honoring its "never throws" contract; deferred `revokeObjectURL`; `?room=` capped to 6 chars before use/send; invite-copy `setTimeout` cleared on unmount; dev `devAlmostWin` import got a `.catch`; `build-content.mjs` escapes `<`/U+2028/U+2029 in JSON-LD (latent-trap guard) | S | ✅ done 2026-07-24 (shareCard abort test) |

## Mobile / small screens

Phone play was never designed for: at a 390x664 iPhone viewport the table was
**1810px tall (~2.7 screens)**, so the felt, the chips and the Deal button could
never be seen together. Measured per-section and fixed the biggest offenders.

| # | Item | Effort | Status |
|---|------|--------|--------|
| P1 | iOS viewport foundations — `100vh` hid content under Safari's collapsing URL bar; no safe-area handling (notch / home indicator); rubber-band bounce + grey tap-flash | S | ✅ fixed 2026-07-24 (`100dvh` with `vh` fallback, `viewport-fit=cover` + `env(safe-area-inset-*)` padding, `overscroll-behavior` scoped to `pointer: coarse` so desktop keeps native elastic scroll / trackpad swipe-back) |
| P2 | Phone layout: HUD was pinned to `min-height: 460px` to mirror the desktop road dock (~440px of dead space); the primary action sat stranded between the felt and the chip rail; the card zone reserved 168px of empty felt | M | ✅ fixed 2026-07-24 — HUD reordered first + compacted to a 2-col stat grid (437→~190px), action bar pinned to the bottom (44px thumb targets, safe-area aware), card reserve 168→128px (verified no layout shift when cards land). Total **1810→1515px**; bankroll, dealer line, felt and all three bet spots now sit above the fold |
| P10 | **REGRESSION, self-inflicted: no cards rendered on real iOS.** P9's `overflow-x: clip` on `.card-stage` looked safe, but per CSS Overflow 3 `overflow-y: visible` computes to `auto` when the other axis is `clip` — so the stage silently became a 114px scroll box, and the deal animation starts each card at `translate(140px, -90px)`, 90px above its seat. On iOS Safari the hand rendered completely empty during Dealing. Chromium kept `clip visible` and showed nothing wrong, which is why local verification missed it | S | ✅ done 2026-07-25 — clip removed entirely; the fly-in offsets are now variables (`--deal-from-x/y`) and the phone step shortens the throw to 34/-22px, so the animation never leaves the viewport and no clipping context exists. Stage is `visible/visible` and not scrollable; peak page width during a deal still equals the viewport at 428px and 390px |
| P11 | P5's "verify on real iOS Safari" is now overdue, not optional: P10 was a spec-level Safari/Chromium divergence that headless Chromium could not surface. Any future fix that relies on `overflow`, `clip`, `dvh`, or animation fill needs a real-device check before it ships | — | open |
| P8 | **Two more phone overflows, found by the UI-review loop.** (a) Cards step down 100→84→68→58px but stop at 520px, so six 58px cards plus margins needed 396px — a coup where *both* sides drew a third card pushed the document to 418px on a 390px screen. (b) The third-card tableau asked for `width: 100%` while `table-layout` was auto, so the cells' min-content won and it ran 13px past the edge | S | ✅ done 2026-07-25 — added a ≤430px card step (48×69px, ratio held at ~0.7) and made the tableau `table-layout: fixed`. Page is exactly 390px wide again |
| P9 | **Every deal widened the page by 52px.** The deal animation flies each card in from beyond the right edge and `.card-stage` was `overflow: visible`, so the document stretched on *every hand* — a horizontal jiggle and scrollbar once per deal, sampled across 145 animation frames | S | ✅ done 2026-07-25 — `overflow-x: clip` on the stage below 430px, block axis left visible so nothing else is cut. Peak width across a full deal is now 390px, unchanged |
| P6 | **Chips ran the felt off a phone screen.** `.spot-chips` was a horizontal row: eight 16px mini-chips plus the amount pill gave it an 87–103px min-content width, and because a grid item defaults to `min-width: auto`, that forced every bonus column past its `1fr` share. One chip on a bonus spot at 390px blew the document to 475px wide (+85px); six chips reached 539px (+149px), and `aspect-ratio: 1/1` grew the circles 77→117px so the page stretched vertically too | S | ✅ **done 2026-07-25** — chips now stack into a vertical tower, positioned out of flow along with the amount, so a stack of any size is one chip wide and cannot resize its spot. `min-width: 0` added to `.spot` as a standing guard. Verified across 12 viewports × 2 tabs × 2 states |
| P7 | Table-limits string overflowed its HUD box, pushing 2px past a 320px viewport | S | ✅ **done 2026-07-25** — wraps below 340px only; constraining it unconditionally cost a line of height at 375–390px |
| P3 | Chip rack still ~70px below the fold at 390x664 — a pre-armed chip means tapping a spot works without scrolling, but the denominations need a nudge. Needs real compaction (smaller spot arcs / a horizontal chip strip), not more padding trims | M | open — CSS-only trimming hit diminishing returns; next step is a phone-specific bet-rail layout |
| P4 | Landscape: a baccarat table is naturally wide, and phones in landscape have the aspect ratio the desktop layout wants. No landscape-specific handling today | M | open — consider a `(orientation: landscape) and (max-height: 500px)` layout reusing the 2-column grid |
| P5 | Verify on real iOS Safari — all of the above was measured in headless Chromium at an iPhone viewport, where `env(safe-area-inset-*)` resolves to 0 and there is no URL-bar collapse, so the dvh/safe-area wins are reasoned rather than observed | S | open — needs a device/simulator pass |

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

## Growth / traffic (code changes)

Engineering levers to get players to the site. Full rationale + the distribution
channel strategy (portals, Reddit, SEO wedge, Rust/WASM tech story, gambling
policy per channel) live in `docs/GROWTH.md`. Ordered by ROI; the biggest lever
is G7 (the SPA can never surface "learn baccarat" content to a non-JS crawler).

| # | Item | Effort | Notes |
|---|------|--------|-------|
| G1 | Crawlability hygiene: `robots.txt`, `sitemap.xml`, canonical/`og:url`/`og:site_name`/Twitter Card/`robots` meta, JSON-LD `WebApplication` (co-typed, not bare `VideoGame`) | S | ✅ done 2026-07-24 (`web/public/robots.txt`+`sitemap.xml`, full meta/JSON-LD in `index.html`) |
| G2 | Static `og:image` 1200×630 + `twitter:image` | S | ✅ done 2026-07-24 — closes H4 (`web/public/og-image.png`, pixel brand card) |
| G3 | Self-host Silkscreen/VT323 fonts | S | ✅ done 2026-07-24 — closes H3 (`src/fonts/*.woff2` + `@font-face`, Vite-fingerprinted, base-safe) |
| G4 | Privacy-friendly analytics (GoatCounter) + events: first-hand, returning-visitor, victory/bust, room-link vs lobby join | S | ⚙ wired 2026-07-24 (`analytics.ts` `track()`/`trackVisit()` — no-op until a backend is added; visit/victory/bust/share instrumented; enabling = one script tag + CSP allow, documented). first-hand + join-path events still to instrument |
| G5 | `?room=CODE` deep link + copy full URL not bare code | S | ✅ done 2026-07-24 — closes F5 (`Multiplayer.tsx` auto-joins on connect; invite button copies the link) |
| G6 | `?tier=` deep link (seed `App.tsx` from `location.search`) | S | ✅ done 2026-07-24 (`App.tsx` seeds tier/multi from the URL; `urlParams.ts`) |
| G7 | **Static content pages** (`how-to-play/`, `glossary/`, `baccarat-roads/`) — real crawlable HTML with per-page title/meta/canonical/OG + Article/FAQ JSON-LD, linked from the `HomeScreen` "learn" nav + sitemap | M–L | ✅ done 2026-07-24 (`web/scripts/build-content.mjs`, self-contained Node so it runs in the cargo-less Docker web stage too; wired into `web build`; banker tableau mirrors `rules.rs` — audit-verified fixed rules; pages gitignored, generated each build) |
| G8 | Client-side "share your run" canvas card on Victory/Bust + `navigator.share`/clipboard fallback, share text embeds `?tier=` link | M | ✅ done 2026-07-24 (`shareCard.ts` + Victory "Share run"; canvas image → Web Share → clipboard → download chain; tests) |
| G9 | Service worker precaching hashed JS/CSS/wasm (cache-first; leave `/ws`); single-player is already offline-capable | M | `main.tsx`, new SW, `vite.config.ts` — return-visit retention |
| G10 | Web app manifest + 192/512/maskable icons from `favicon.svg` | S | ✅ done 2026-07-24 (`manifest.webmanifest` + 3 PNG icons; install prompt enabled) |
| G11 | (stretch) build-time static-render `HomeScreen` into `#root` as a progressive-enhancement shell | M | layered on G7, not instead |
| G12 | (stretch) dynamic per-result OG image via a Fly `GET /share.png` route + server-rendered result HTML | L | needs request-time compute (Pages can't); couples to S12/H12 cold-start — do last, only if G8 proves demand |

Suggested first PRs: **PR A** = G1+G2+G3+G4+G5+G6+G10 (~1 day, all S — links look
real, traffic measurable, 1-click invite shipped); **PR B** = G7 (the durable
organic-search engine). Then G8, then G9/G11/G12 as retention/polish.

## Audit log

- **2026-07-25 (UI review loop, iteration 1 — Playwright):** Built, served
  locally and drove the real app in Chromium: 30 hands played through the actual
  deal/reveal/auto-settle flow at 1440×900, 1280×720 and 390×664, screenshots at
  each stage, zero page or console errors throughout.

  Found and fixed: **U1**, the HUD outcome box rendering the wire enum.

  Confirmed with measurements: **A2** — columns really do outgrow the six-row
  grid (Big Road 8, Cockroach Pig 14, Small Road 11 after 30 hands).

  Logged for a design call: **U2** (440px of dead felt in the desktop left
  column), **U3** (Full Roads scroll affordance), **U4** (button colour encodes
  state, not consequence).

  Four things looked like bugs in the screenshots and were *not* — worth
  recording so they don't get "fixed" later:
  1. The Big Road appeared to drop marks. It does not: 29 non-tie results, 29
     rendered marks. `useFollowLatest` scrolls the grid to the newest column, so
     earlier columns are simply out of view.
  2. A bonus token looked like it was spilling past the road's left edge. It is
     not: `.road-grid` already carries `padding: 6px`, exactly covering the
     token's `-6px` offset — measured clipping is 0 on both edges.
  3. The Full Roads dialog looked clipped at the bottom. It is capped and
     internally scrollable, and overflows the viewport by 0 at every size tested;
     only the affordance is missing (U3).
  4. The roads looked empty after 26 "hands" in the first pass. That was the
     harness, not the app: single player has no Settle button (`onSettle` is
     multiplayer-only), so the hands never completed. Re-run through Reveal all,
     which auto-settles, and the roads filled correctly.

- **2026-07-25 (EXACT — enumeration replaces sampling):** Added
  `engine/tests/exact_enumeration.rs`, which walks **all 1,659,001 reachable
  coups** of a fresh 8-deck shoe with each branch's exact hypergeometric weight
  instead of sampling. It drives production code on every branch —
  `player_draws`/`banker_draws` decide the draws and `play_round` builds each
  `RoundResult` — so it validates the real rules, not a restatement of them.
  Two self-checks make it hard to fool: leaf probabilities sum to
  0.999999999978 (f64 accumulation only), and the outcome frequencies come out
  **Player 44.624661% / Banker 45.859742% / Tie 9.515597%**, matching the
  canonical 8-deck figures to six decimals. The drawing tableau is now proven,
  not estimated. Runs in 3.1s debug / 0.9s release, so it is a normal test
  rather than `#[ignore]`d.

  Every paytable is confirmed exact, all nine published figures matching to
  within 0.0033pp:

  | bet | exact edge | published |
  |---|---|---|
  | DragonBonus(Player) | 2.6517% | 2.65% |
  | Dragon 7 | 7.6113% | 7.61% |
  | DragonBonus(Banker) | 9.3731% | 9.37% |
  | Panda 8 | 10.1876% | 10.19% |
  | Player / Banker Pair | 10.3614% | 10.36% |
  | Tiger Tie (now 45:1) | 11.4952% | — (30.74% at the old 35:1) |
  | Small Tiger | 14.3325% | 14.33% |
  | Big Tiger | 15.2533% | 15.25% |
  | Tiger Pair | 16.1217% | 16.12% |
  | Tiger | 16.6836% | — |

  Candidates: Lucky 6 **11.6985%**, Either Pair **13.7099%**, Lucky 7
  **18.2961%**.

  **This corrects the Monte-Carlo figures logged below.** The 500k-shoe run sat
  up to 0.15pp high on the banker-6 and banker-7 bets (Tiger 16.81 vs 16.68,
  Big Tiger 15.40 vs 15.25, Dragon 7 7.73 vs 7.61). The bias is real and
  one-directional — it is the cut-card depletion this game actually deals, so
  the MC numbers describe our shoe and the exact ones describe a fresh shoe —
  but every published-comparison claim should cite the exact column. Item texts
  above were updated to the exact values.

  *Research caveat worth recording:* the regulator and operator quotes in the
  entries below came from search-result extracts, not the source documents.
  This session's egress policy blocks every external host — `curl`, WebFetch
  and headless Chromium all fail with a proxy CONNECT refusal, `example.com`
  included — so none of it could be read verbatim. Treat the Vegas/regulation
  claims as well-corroborated but second-hand; the engine numbers above need no
  such caveat, being computed locally and exactly.
- **2026-07-25 (what Las Vegas actually spreads):** Surveyed operator
  how-to-play pages, the Nevada GCB approved-games list and the Vegas
  Advantage table-game survey to check our felt against real Strip layouts.
  Baccarat is Las Vegas's biggest non-blackjack game (~350 tables valley-wide,
  250+ on the Strip). Findings:
  - **Commission is the Strip standard.** The Venetian's own guide: "All
    winning bets on the bank side are assessed a 5% commission."
  - **Vegas commission-free is Super 6, not EZ.** The Venetian's no-commission
    variation pays a winning Banker 6 at 50% of the stake — that is A4, not
    A3's Dragon-7 bar. EZ Baccarat proper is hard to find on the Strip.
  - **Stacking side bets is normal.** Gold Coast spread five on one felt
    (Lucky Max/Tie Max 55:1, Rabbit Play, Dragon, Panda 8, Dragon 7), so our
    six spots are unremarkable and a seventh needs no justification.
  - **Dragon Bonus is live in Vegas, both sides.** Westgate posts it at
    1:1–30:1 on a 4–9 margin with a $100 side-bet max; Caesars publishes 2025
    gaming guides for it. Supports F1.
  - **Tiger Pair is on Venetian felts** at exactly our 4/20/100:1. It is the
    only Tiger-family bet with a Vegas placement found — no evidence for Big
    Tiger, Small Tiger or Tiger Tie in Las Vegas.
  - **Two bets we lack, priced.** Added `candidate_paytables` (same 40M-coup
    harness) to answer whether they belong:

    | candidate | edge | hit rate | verdict |
    |---|---|---|---|
    | Lucky 6 (12:1 / 23:1) | 11.84% | 5.38% | better than our Tiger's 16.81% — logged A8 |
    | Tiger Tie at 45:1 | 11.51% | 1.92% | confirms A7 (vs 30.74% at 35:1) |
    | Either Pair (5:1) | 13.72% | 14.38% | **worse** than our two 11:1 circles (10.35%) — don't switch |
    | Lucky 7 (6:1 / 15:1) | 18.17% | 8.17% | on Venetian felts and worse than anything we offer — don't add |

    Lucky 7 is the useful counterexample: "a Vegas casino spreads it" is not
    an argument that a bet is worth offering.
- **2026-07-25 (side-bet economics, measured not assumed):** Added
  `side_bet_house_edges` (ignored, informational) — 40M coups over 500k real
  shoes, cut card and burn included, settling all 10 side bets per coup.
  Measured house edge / hit rate:

  | bet | edge | hit rate | published |
  |---|---|---|---|
  | DragonBonus(Player) | **2.65%** | 28.99% | 2.65% |
  | Dragon 7 | 7.73% | 2.25% | 7.61% |
  | DragonBonus(Banker) | 9.45% | 28.26% | 9.37% |
  | Panda 8 | 10.15% | 3.46% | 10.19% |
  | Player Pair | 10.35% | 7.47% | 10.36% |
  | Banker Pair | 10.38% | 7.47% | 10.36% |
  | Small Tiger | 14.46% | 3.72% | 14.33% |
  | Big Tiger | 15.40% | 1.66% | 15.25% |
  | Tiger Pair | 16.10% | 14.38% | 16.12% |
  | Tiger | 16.81% | 5.38% | — |
  | Tiger Tie | 30.74% | 1.92% | 30.74% |

  Every figure agrees with published analysis to ~0.1pp, which is an
  independent check on the paytables *and* on the drawing tableau feeding
  them. Small positive deltas on Dragon 7 / Dragon Bonus (Banker) are
  expected: published numbers are combinatorial over a full shoe, ours carry
  real cut-card depletion. Paytables cross-checked against Nevada GCB Rules
  of Play (Tiger Baccarat) and the TCS John Huxley how-to-play: Tiger 12:1
  two-card / 20:1 three-card, Small Tiger 22:1, Big Tiger 50:1, Tiger Pair
  4/20/100:1 — all match. One deviation found: Tiger Tie (A7). Findings fed
  F1/F2/F11.
  Note: the felt's Tiger bet (16.81%) is *worse* than either of its own
  unbundled legs, because 12:1 and 20:1 underprice both conditions.
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
- **2026-07-24 (hardening sweep — applied the backlog's fix-only tier, no
  visual changes):** Shipped 22 items in one pass, every one verified by the
  full suites (engine 148, server 8, web 324 — all green; clippy clean; live
  smoke of `/health`, headers, and SIGTERM notice). Server: S7 lock-scope fix,
  S8 invite-code strike budget, S9 panic-safe seat cleanup, S10 bounded
  outbound queues, S11 global connection cap, S12 graceful-shutdown half
  (keep-warm cost call still open), H14 security headers, H21 non-root
  runtime + `/health` + fly check, H22 protocol version, H23 event logging +
  gauges. Engine: H1 commission-rounding policy documented + tested, H2
  compile-time cut-card assert, H7 house hands reserved for the paced dealer
  on shared tables (solo unchanged), H25 config/stake asserts, H27 RNG pinned
  to ChaCha12 (bit-identical streams). Web: H6 pointercancel settles the
  fold, H10 `safeCents` money-boundary guard, H11 wasm panics logged not
  masked, H15 versioned storage with legacy migration, H19 wasm-load failure
  notice instead of a blank page, H20 wire-mismatch logging, H24 explicit GL
  resource cleanup, H26 order-independent smallest-chip pick. Left open by
  design: H5/H16/H17 (need product decisions), H13 (would break the
  Pages→fly WS default), S3/S4 (M-effort behavior changes), and everything in
  the E/C/D/T sections.
- **2026-07-24 (continuous bug-hunt loop, iteration 1 — table lifecycle):**
  Three confirmed engine bugs found and fixed same day, each reproduced with a
  failing test first: the peeked-card identity broadcast (S13, the significant
  one — every networked seat could read the squeezer's private sliver), the
  inverted squeeze tie-break (S14), and the stale Betting-view outcome (S15).
  Also traced and cleared as CORRECT: mid-deal leave settlement and money
  conservation, squeezer-leaves card-flippability (no stuck coup possible),
  heterogeneous settle/sit-out accounting, new_shoe phase guards, reshuffle
  boundary consistency, and negative-bankroll sequences. Added a
  `debug_assert!(buy_in >= 0)` to `Table::join` for posture consistency.
  Engine 151 / web 324 all green.
- **2026-07-24 (continuous bug-hunt loop, iteration 1 — server hardening
  audit of the just-landed hardening code):** Adversarial re-audit of the
  S7-S12 changes found two real holes IN the hardening plus four more. Fixed
  same day: the invite-code strike budget reset on any lookup hit, not just a
  real seating, so it was bypassable on a single socket (S8 follow-up); the
  4 KiB message cap ran only after tungstenite buffered up to 64 MiB, so it
  wasn't a real limit — now capped at the transport (S16); and the
  `maybe_pace` background task had the exact panic-wedge S9 was written to
  close but no guard (S9 follow-up). Logged for follow-up: a `sweep`/`join`
  race that can orphan a live room (S17, pre-existing), dropped one-shot
  control messages wedging a client (H28), unbounded per-broadcast scoreboard
  recompute + uncapped history as a server-side amplifier (E2 server angle),
  and the unbounded shutdown drain. Confirmed clean: `ConnSlot` balance,
  atomic-counter overflow, and the `catch_unwind` mutex mechanics. Server
  builds clean, 8 tests green, live-smoked `/health` + shutdown. (No WS
  integration harness exists to unit-test S8/S16 end-to-end — that's D3.)
- **2026-07-24 (continuous bug-hunt loop, iteration 2 — client injection
  surface + rules correctness):** Two parallel audits. (a) **Injection
  surface: clean XSS bill of health** — no `dangerouslySetInnerHTML`, no
  unsafe attribute/URL sinks anywhere untrusted names/codes/announce text
  flow; React escaping covers it. Fixed the robustness gaps it did find: a
  malformed/version-skewed push could white-screen the app (S18 — added an
  ErrorBoundary + made `proto` skew a hard stop), peer names weren't stripped
  of bidi/zero-width/control chars (S19 — `clean_name` server-side + seat-name
  ellipsis), and the unmount handler hygiene (C6). Logged S20 (settle popup
  can be skipped under S10 backpressure — needs a round-id, not a phase edge).
  (b) **Rules correctness: clean bill of health** — a full cross-check of the
  engine against authoritative punto banco (Wizard of Odds, NGCB) found NO
  deviations: card values, natural suppression, the Player rule, the complete
  8×10 Banker tableau incl. all four exception totals (3/4/5/6), main payouts +
  5% commission, EZ Baccarat, all seven side-bet paytables (Pair, Dragon Bonus
  ladder, full Tiger family), the three derived-road algorithms (hand-traced
  against the worked example), 8-deck composition + burn ritual, and the
  statistical tests (frequencies match published figures; ±0.005 @ 200k ≈ 4.5σ,
  tight enough to catch a real tableau bug). Single source of truth confirmed —
  no divergent payout/draw logic between `Session` and `Table`. Web 326 /
  server 9 green.
