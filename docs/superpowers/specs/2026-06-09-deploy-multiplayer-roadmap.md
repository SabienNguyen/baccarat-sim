# Deployment & Multiplayer Roadmap

**Date:** 2026-06-09
**Status:** Planning map (CLI front-end is abandoned; web is the product)

## Where the codebase stands

- `engine/` — pure Rust punto banco rules, 119 tests including statistical
  validation of the shuffle (outcome frequencies and per-card uniformity).
  Compiles both to wasm (browser) and natively — the same crate can power a
  server unchanged.
- `engine-wasm/` — wasm-bindgen boundary; commands in, `RoundSnapshot` out.
- `web/` — the whole game UI (145 tests), talking to the engine only through
  `web/src/engine/adapter.ts` and the Zustand store. This separation is what
  makes multiplayer feasible: the UI already renders snapshots it didn't
  compute itself.

## Phase 1 — Deploy the single-player game (small, do first)

The app is a fully static SPA: wasm + JS + CSS, no backend.

1. **CI build**: GitHub Actions workflow — `rustup target add
   wasm32-unknown-unknown`, install `wasm-pack`, `npm run build:wasm`,
   `npm --workspace web run build`, run both test suites as gates.
2. **Host**: Cloudflare Pages or GitHub Pages serving `web/dist`.
   - Vite `base` must match the hosting path (`/<repo>/` for GH Pages).
   - Wasm is served as a static asset; both hosts set
     `application/wasm` correctly (needed for streaming compile).
3. **Persistence note**: bankroll already persists via localStorage; nothing
   server-side needed.
4. Nice-to-haves once live: PWA manifest (installable, offline play works
   since everything is local), a favicon, and an OG card.

Effort: one short plan. No code restructuring required.

## Phase 2 — Multiplayer foundation: authoritative server

**Product decision (2026-06-09):** multiplayer is the headline mode once
live — the home screen already structures this. Single player remains the
offline/practice mode. The home screen ships now with mode select and three
single-player stake tiers (Low/Mid/High Roller, per-tier bankrolls); the
multiplayer entry shows the public/private-table lobby as a teaser that
Phase 2-3 activates with real data.

**Architecture decision:** the server is the casino. A native Rust service
(axum + tokio + WebSocket) embeds `baccarat-engine` directly — the same
`Session`/`RoundSnapshot` types, serialized with the serde derives they
already have. Clients stop creating local sessions and instead render
snapshots pushed over the socket. Cheating is impossible by construction:
the shoe lives only in server memory, seeded from OS entropy
(`StdRng::from_entropy`), and clients only ever see the snapshots they'd
see at a real table (peeked cards stay sliver-only in the payload sent to
non-squeezing players).

```
web (thin client)  <--WebSocket-->  table service (axum)
  render snapshots                    baccarat-engine (native)
  send commands                       rooms, timers, seats
```

- **Protocol**: JSON (later MessagePack) messages — `join`, `bet`, `deal`,
  `peek`, `reveal`, `settle` upstream; `snapshot`, `dealer-line events`,
  `seat updates` downstream. Reuse the existing TS types from the generated
  `.d.ts` so the client code barely changes: the `GameSession` interface in
  `adapter.ts` gets a second implementation (`createRemoteSession`) speaking
  WebSocket instead of wasm. The store and every component stay untouched.
- **Round flow goes timed**: a betting window (e.g. 20s countdown), then the
  deal; reveal rights and `settle` are server-driven.

Effort: the biggest single chunk; its own brainstorm/spec/plan cycle.

## Phase 3 — Tables, seats, and the squeeze ritual

- **Lobby**: list of tables (stakes, ruleset, seats taken); create/join.
- **Seats & spectators**: up to N bettors per table; anyone can watch.
- **Squeeze rights, like a real pit**: the largest Player-bettor squeezes the
  Player hand, largest Banker-bettor the Banker hand; their peel progress is
  broadcast so the whole table sweats the reveal together (this is the
  multiplayer payoff of the existing squeeze mechanics).
- **Identity**: anonymous guest names first; accounts (and persistent
  bankrolls in SQLite/Postgres) after.

## Phase 4 — Production polish

- Reconnection (session tokens, snapshot replay on rejoin).
- Table chat + dealer narration broadcast.
- Rate limiting / input validation at the socket edge.
- Deploy: single container (server serves both the static SPA and the
  WebSocket) on Fly.io / Railway; one region to start.

## Explicitly dropped

- **CLI (Ink) front-end** — abandoned per decision on 2026-06-09. The
  engine's wasm boundary still supports it if ever revived, but no further
  work is planned.
