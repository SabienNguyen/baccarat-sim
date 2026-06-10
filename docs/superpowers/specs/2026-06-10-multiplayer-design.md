# Multiplayer — Design Spec (Phase 2)

**Date:** 2026-06-10
**Status:** Approved for implementation (autonomous design per the build mandate)

## 1. Shape of the thing

Live baccarat tables: several players bet on the **same coup** from the **same
shoe**, watch the same squeeze, and settle independently against their own
bankrolls. Public tables are listed in the lobby; private tables are joined by
invite code. Table stakes reuse the existing tier system (Low/Mid/High).

The server is the casino: an axum WebSocket service embedding the engine
natively. The shoe exists only in server memory; clients receive only what a
seated player could see (face-down cards cross the wire as `FaceDown`).

## 2. Layered build (each layer lands tested before the next)

**Layer A — engine `Table` (multi-player rules core).** The existing `Session`
is one-player by design (one bankroll, one bet set). Multiplayer needs the
same round flow with N bettors, so the engine gains `table.rs`:

```rust
Table::new(config, seed)            // config: min/max, ruleset, max seats
table.join(name, buy_in) -> PlayerId
table.leave(pid)
table.place_bet(pid, kind, amount)  // validates phase, limits, player bankroll
table.clear_bets(pid)
table.deal()                        // >=1 bet staged; cut-card reshuffle like Session
table.peek/reveal(hand, index)      // shared reveal state (squeeze is communal)
table.settle()                      // pays EVERY player from their own bets
table.view_for(pid) -> TableView    // that player's snapshot + seat summaries
```

`TableView` = the player's own `RoundSnapshot`-shaped data (their bets,
bankroll, payouts) plus `seats: Vec<SeatView { name, staked, bankroll }>` so
the felt can show everyone's action. Reuses the engine's reveal state, event
derivation, scoreboard history, and settle functions; the third-card tableau,
cut card, and burn are identical to single player. Fully unit-tested in Rust
(multi-player settle conservation, per-player limit validation, view privacy:
a face-down card never appears in any view).

**Layer B — `server/` crate (axum).** Rooms + transport:

- `POST`-less: one WebSocket endpoint `/ws`; JSON messages (serde on the
  engine's existing serializable types).
- Client→server: `create_room { tier, private }`, `join_room { room, name }`,
  `list_rooms`, then table commands (`bet`, `clear`, `deal`, `peek`,
  `reveal`, `settle`, `new_shoe`).
- Server→client: `rooms`, `joined { seat, view }`, `state { view }` broadcast
  after every accepted command, `error { message }` (the dealer-speech codes),
  `seat_update`.
- Room registry: `DashMap<RoomId, RoomHandle>`; each room is a tokio task
  owning its `Table` (message-passing, no shared locks on game state).
  Private rooms get a 6-char invite code; public rooms appear in `list_rooms`.
- Seeds from OS entropy per table. Bankrolls are per-connection-session in v1
  (buy-in on join, gone on disconnect); accounts/persistence are Phase 3.
- Serves the built SPA statically too, so one container deploys everything.

**Layer C — web client.** A `RemoteTable` store implementing the same
`GameState` shape the components already render, fed by `state` pushes instead
of a local wasm session (commands fire over the socket; `lastError` set from
`error` messages — the dealer already speaks those). The Multiplayer home
card loses its ribbon: lobby list, create/join (tier picker reused), invite
code entry. The chip rack stays a client-side view over the player's own
bankroll, exactly as today.

**Layer D — deploy.** Dockerfile (multi-stage: wasm+vite build, cargo build,
tiny runtime), Fly.io/Railway; the web client picks `wss://` host from config.
GitHub Pages remains the single-player mirror until the server hosts both.

## 3. Round flow at a shared table (v1 rules)

- Betting is open until any seated player presses **Deal** (v1 keeps the
  single-player rhythm; betting-window timers come with Phase 3 polish).
- The squeeze is communal: any seated player may peek/reveal (formal squeeze
  rights — biggest bet gets the cards — are Phase 3).
- **Settle** pays every player independently; pushes/losses per their own
  bets. The scoreboard history is the table's, shared by all.
- A player going below the table minimum can sit and watch or leave.

## 4. Out of scope for Phase 2

Accounts/persistent bankrolls, chat, reconnection tokens, betting timers,
squeeze rights, spectator mode, rate limiting (basic message-size caps only).
All Phase 3/4 per the roadmap.
