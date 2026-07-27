# baccarat-engine

A punto banco (baccarat) rules engine for Rust and WebAssembly, whose paytables
are **verified by exhaustive enumeration** rather than by sampling.

```toml
[dependencies]
baccarat-engine = "0.1"
```

## Correctness is the feature

Most casino-game code asks you to trust its paytables. This crate ships the proof
and you can re-run it in about three seconds:

```sh
cargo test -p baccarat-engine --test exact_enumeration -- --nocapture
```

That test walks **all 1,659,001 reachable coups** of a fresh 8-deck shoe, each
weighted by its exact hypergeometric probability — no Monte Carlo, no error bars —
and drives the real engine on every branch, so it validates the shipped rules
rather than a restatement of them.

It is self-checking in two ways that are hard to satisfy by accident:

- leaf probabilities sum to **0.999999999978** (f64 accumulation only), so the walk
  is a genuine partition of the sample space;
- outcome frequencies come out **Player 44.624661% / Banker 45.859742% /
  Tie 9.515597%**, matching the canonical 8-deck figures to six decimals.

Every side-bet house edge lands within **0.0033pp** of published analysis:

| bet | exact edge | bet | exact edge |
|---|---|---|---|
| Dragon Bonus (Player) | 2.6517% | Player / Banker Pair | 10.3614% |
| Dragon 7 | 7.6113% | Small Tiger | 14.3325% |
| Dragon Bonus (Banker) | 9.3731% | Big Tiger | 15.2533% |
| Panda 8 | 10.1876% | Tiger Pair | 16.1217% |
| Tiger Tie | 11.4952% | Tiger | 16.6836% |

Paytables are cross-checked against regulator sources (Nevada GCB Rules of Play,
NJAC 13:69F). That check is what caught a retired 35:1 Tiger Tie paytable still in
circulation and corrected it to 45:1.

## What's in it

- **Full drawing tableau** — player and banker third-card rules including every
  banker edge case, naturals, and mod-10 totals.
- **Two settlement models** — traditional 5% commission, and EZ Baccarat
  (commission-free with the three-card-7 bar).
- **Eleven side bets** — Player/Banker Pair, Dragon 7, Panda 8, Dragon Bonus on
  either side, and the full Tiger family (Tiger, Big, Small, Tie, Pair).
- **All five pit scoreboards** — Bead Plate, Big Road, Big Eye Boy, Small Road,
  Cockroach Pig.
- **Deterministic shoes.** The RNG is pinned to `ChaCha12Rng` *by name*, not via
  `StdRng`, so a seeded shoe stays bit-identical across `rand` releases and any
  hand can be replayed by an auditor.
- **No I/O, no async, no framework.** Pure logic; runs on a server or in a browser
  through the same code path.

149 tests, plus a seeded statistical suite that checks realized frequencies
against theory over millions of dealt coups.

## Quick start

```rust
use baccarat_engine::{round::play_round, shoe::Shoe, sidebets::{settle_side, SideBet}};

let mut shoe = Shoe::new_seeded(42);          // reproducible
let round = play_round(&mut shoe);            // full tableau applied

println!("{:?} — player {} banker {}",
    round.outcome, round.player.total(), round.banker.total());

// side bets settle in integer cents; the return is the net bankroll change
let net = settle_side(SideBet::Panda8, 100, &round);
```

`Table` and `Session` sit above this for multi-seat play, betting phases, squeeze
state and the scoreboards.

## WebAssembly

The `wasm` feature adds `wasm-bindgen` and `tsify-next` derives for the public
types, so the same engine drives a browser client with generated TypeScript types.
See `engine-wasm` in the repository.

## Licence

MIT. You can ship it commercially without asking.

Commercial support — bespoke rule variants, integration, a compliance audit report
written for a certification reader, or a support window — is available:
<https://sabiennguyen.github.io/baccarat-sim/license/>

MIT means you never have to ask. It also means nobody else is going to answer your
auditor's questions.
