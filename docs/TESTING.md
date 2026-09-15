# Manual multiplayer testing

`npm run phones` opens several headed, phone-emulated Chromium windows side by
side against your local dev server, for hand-testing multiplayer end to end.

```sh
npm run phones                       # 3 windows, iPhone 14, tier=mid
npm run phones -- --n=2              # only 2 windows
npm run phones -- --device="Pixel 7" # different device emulation
npm run phones -- --tier=low         # tier to pick when creating the table
npm run phones -- --headless         # smoke-test the script itself, no UI
```

It will:

1. Check port `8788` (the table service); if nothing is listening, run
   `cargo run -p baccarat-server` itself (prefixed `[server]` logs) and wait
   for it to come up (cold builds can take a few minutes).
2. Check port `5173` (Vite); if nothing is listening, run
   `npx vite --port 5173 --strictPort` in `web/` itself (`[vite]` logs) and
   wait for it.
3. Launch one Chromium **browser per phone** (not just a tab or context —
   window position/size are launch args, so each phone gets its own process),
   emulating the chosen device (viewport, DPR, touch, UA), windows laid out
   left to right with a 20px gap.
4. Print a banner with the manual script below, then wait for Ctrl-C, which
   closes every window it opened and stops anything it spawned (a table
   service or Vite dev server it started itself is stopped — including the
   server binary `cargo run` forks, by signalling the whole process group,
   not just the `cargo` process — and it polls each port until it's released
   before exiting; one that was already running is left alone).

Flags: `--tier=mid|low|high` (default `mid`), `--n=3`, `--device="Pixel 7"`
(any playwright-core device name), `--headless`, `--vite-port` /
`--server-port` if you need non-default ports (e.g. another worktree's Vite is
already on 5173).

Each window opens on the home screen: there's no URL that lands directly on
the multiplayer lobby (a `?room=` with no code falls back to the home screen,
and the lobby's tier picker isn't URL-addressable), so click **Multiplayer**
on each phone to get to the lobby.

## Manual multiplayer script

1. **Phone 1**: Multiplayer → pick the tier → **Create table**. Copy the code.
2. **Phones 2–3**: Multiplayer → enter the code → **Join**.
3. Everyone places a bet; phone 1 (or whoever's turn) **deals**.
4. **Squeeze** on whichever phone is holding the hand that squeezes.
5. Trigger a **dealer flip request** and confirm it resolves for everyone.
6. **Settle** the hand and confirm balances update on all three phones.
7. One phone **leaves** the table.
8. One phone opens `?watch=CODE` to **watch from the rail** (no seat, no
   chips) and confirms it sees live hands.
9. **Rename a seat** and confirm the new name shows on the other phones.
10. **Reload** one still-seated phone and confirm it reclaims its own seat
    and bankroll instead of joining as a new player.

## Shoe ceremony

Run this against `npm run phones` (three windows) to walk the full shoe
lifecycle by hand — numbered shoes, the cut ceremony, cut-card-out/last hand,
and the New Shoe vote. Spec: `docs/superpowers/specs/2026-09-14-shoe-lifecycle-design.md`.
An automated version of the solo + two-context path runs as
`scripts/shoe-probe.mjs` (see below).

1. **Phone 1**: Multiplayer → pick a tier → **Create table**. Phone 1 lands
   on "Cut the shoe" — it's the host and holds the cut.
2. **Host cuts**: drag the cut card into the stack (or focus it and use the
   arrow keys / Home / End), tap **Cut here**, and watch the burn: the card
   turns, the burned cards count up, then a "SHOE 1" banner. The stage closes
   into Betting on its own.
3. **Phones 2–3** join by code while phone 1 is still on the cut stage and
   confirm they see "Waiting for &lt;phone 1's name&gt; to cut the shoe" —
   they wait, they don't get their own cut screen.
4. Play a few hands normally (bet, deal, reveal, settle) and confirm every
   phone's scoreboard footer reads "Shoe 1".
5. **Play to the cut card**: keep dealing until the dealer line says "Cut
   card's out — one more hand, then a fresh shoe" and a **LAST HAND** chip
   appears in the HUD on every phone.
6. Play that **last hand** — betting, dealing and settling all still work —
   then confirm the table drops straight back into a cut stage (no more
   betting past it) with the host cutting again, and the scoreboard/roads
   clear for the new shoe once cut.
7. **New Shoe vote**: mid-shoe, have a non-host phone tap **New shoe**.
   Every phone's seat strip shows a `New shoe? k of n` row with ✓/✗ buttons;
   vote **yes** from enough seats to reach a majority and confirm the table
   moves to a cut stage with the host cutting, everyone else waiting.
8. **Leaving never changes the shoe**: with a vote open or a cut stage up,
   have a non-host phone leave (**Lobby**). Confirm the remaining phones'
   shoe number, cut stage and vote tally are unaffected. If the host leaves,
   confirm the cut passes to the next seat in join order instead of
   resetting the shoe.

```sh
SHOT_DIR=/tmp/shoe-probe PORT=5173 node scripts/shoe-probe.mjs
```

Needs a Vite dev server on `PORT` (default 5173) and, for the multiplayer
half, the table service reachable through it (e.g. `cargo run -p
baccarat-server` on 8788 behind Vite's proxy). Screenshots land in
`SHOT_DIR`. Prints a PASS/FAIL line per assertion plus a JSON summary, and
exits non-zero if anything failed.

## Roads replay

`http://localhost:5173/?roads=<BPT sequence>` opens the full board (bead
plate, Big Road, Big Eye Boy, Small Road, Cockroach Pig) for that shoe — no
table or session needed — so you can replicate a published casino scoreboard
and compare it against ours. Only letters B/P/T (any case) count; everything
else in the string is ignored. Example, a real 68-hand pit display:
`http://localhost:5173/?roads=BPBBPBBBBPBPBBPPPBBBPPBPPPBBPPBPBBBPPPBBPPBPBBBPBBPBBBPBBBBPBPBPPPBP`
