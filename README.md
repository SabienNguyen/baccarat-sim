# Baccarat Simulator

A Vegas-accurate **Punto Banco** table in the browser, with the part every other
baccarat game skips: **the squeeze**. Bend the corner of the card with your
mouse, watch the pip edges come up — *two sides!* — and let the dealer talk you
through every draw.

A chunky retro pixel look, a real chip economy, the full scoreboard roads, and
a rules engine written in Rust, compiled to WebAssembly, and statistically
validated against published casino probabilities.

## The game

- **Three tables, one ladder** — Low Stakes ($1–$500), Mid Roller ($25–$5k),
  High Roller ($500–$100k). Each has its own buy-in, its own chip set
  (the salon stocks $25k and $100k plates), and a **run goal**: beat the table
  by turning the buy-in into 10×. Each table's bankroll persists between visits.
- **The squeeze** — cards deal face down in real coup order (no third-card
  spoilers). Grab any corner and peel: the genuine printed face shows under the
  fold, so a 9 reads as four legs up the long edge, exactly like paper.
- **A real chip economy** — your bankroll is physical chips in real casino
  colors. Pick up mixed stacks, drop them on the felt, and make change with the
  dealer (break plates down, color up, or just *get* any chip you can cover).
  Banker-commission cents accumulate as loose change and mint back into chips.
- **The talking dealer** — narrates the action ("Monkey for the Player! Counts
  for nothing."), calls third cards with the tableau reason, refuses bad bets
  politely, and teaches the jargon: highlighted terms pop glossary definitions.
- **Scoreboard roads** — Big Road on the table like a pit display, with the
  Bead Plate, Big Eye Boy, Small Road, and Cockroach Pig one click away, each
  with an explainer.
- **Full bet menu** — Player/Banker/Tie plus Pairs, Dragon 7, Panda 8, Dragon
  Bonus, and the Tiger family, all documented in-game.
- **Explain mode** — see *why* each third card was drawn and the house edge of
  every bet you placed.
- **Multiplayer** — public and private tables (6-character invite codes) on an
  authoritative Rust server. Real squeeze rights: the biggest Player bettor
  holds the Player cards, the biggest Banker bettor holds the Banker cards, and
  the house dealer turns any hand nobody bet — one card per beat, announced.
  Every coup is opt-in: bet or sit out, and the deal waits for the table.
  Single player runs the **same table rules** with one seat.

## Fair by construction

The shoe is 8 decks, shuffled with Fisher–Yates over a ChaCha-based CSPRNG and
seeded from OS entropy, with the casino rituals modeled: a burn after every
shuffle and a cut card 14 from the back. The test suite **proves** the odds: a
200,000-coup integration test must reproduce the published punto banco
frequencies (Banker 45.86%, Player 44.62%, Tie 9.52%, pairs 7.47% — within half
a point) and a uniformity test confirms no card is ever favored. A biased
shuffle fails the build.

## Architecture

```
engine/        Rust — the rules, incl. the multiplayer Table. Pure logic, no UI. 137 tests.
engine-wasm/   wasm-bindgen boundary: commands in, snapshots out.
server/        Rust — axum WebSocket table server. Authoritative shoe, rooms, invite codes.
web/           React + TypeScript — the whole table. 190+ tests.
```

The engine knows nothing about rendering; the front-end contains zero game
logic. Everything the UI shows comes from engine snapshots, locally (wasm) or
over a WebSocket (the server) — the components can't tell the difference. The
server owns the shoe and every view it pushes is per-seat: a face-down card
never includes its rank, so nothing about the deck order ever reaches a
client that shouldn't see it.

## Running it

Prereqs: Rust (with the `wasm32-unknown-unknown` target), [`wasm-pack`](https://rustwasm.github.io/wasm-pack/), Node 20+.

```sh
npm run build:wasm        # compile the engine to wasm (regenerates engine-wasm/pkg)
npm install
npm --workspace web run dev    # from the repo root
```

For multiplayer, run the table server alongside the dev server (the Vite dev
server proxies `/ws` to it):

```sh
cargo run -p baccarat-server   # listens on PORT (default 8788)
```

In production the server serves the built site itself (`SPA_DIR`, default
`web/dist`) — a `Dockerfile` and `fly.toml` are included.

Tests:

```sh
cargo test                          # engine + server, incl. the statistical validation
npm --workspace web run test -- --run
```

Every push runs both suites in CI and deploys the site to GitHub Pages.

## Status

Complete and playable: single player (three tables, win goals, persistent
bankrolls) and multiplayer (public/private rooms, authentic squeeze rights, a
paced house dealer). The GitHub Pages deployment is the single-player build;
multiplayer needs the Rust server running.
