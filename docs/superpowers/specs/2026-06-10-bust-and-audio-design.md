# Bust (Game Over) + Retro Audio — Design

Two single-session features for the web front-end:

1. **Bust** — single player needs a losing state: when the bankroll can no
   longer post the table minimum, the run is over.
2. **Audio** — retro sound effects for the table, with a user-adjustable,
   persisted volume control.

## 1. Bust / Game Over

### When does a run die?

The engine never lets the bankroll go below zero (bets are validated against
the roll and only settle moves money, `engine/src/session.rs`). The practical
death is **"you cannot post the table minimum"**: `bankroll < table_min`.
Literal $0.00 almost never happens — commission change leaves stray cents.

Because the bankroll only changes at settle, the check lives in the store's
`settle` path — the exact mirror of the existing `goalReached` check:

```ts
// in createGameStore settle(), alongside goalReached:
busted: result.snapshot.bankroll < result.snapshot.table_min
```

`createGameStore` is single-player only (multiplayer uses `remoteStore`), so
this can be unconditional. `remoteStore` gains `busted: false` to satisfy the
widened `GameState` interface — the server has no re-buy concept.

### What the player sees

A **`BustModal`** mirroring `VictoryModal` (same backdrop/panel idiom, red
instead of gold): "BUSTED" title, the final roll, a pit-boss flavor line, and
two actions:

- **Re-buy** — primary. Calls the existing `onReset` path (`resetStore(tier)` +
  remount), which already clears the persisted bankroll and buys back in at
  the tier's starting roll.
- **Leave table** — clears the saved roll (`resetStore(tier)`) **then**
  `onLeave()`. Clearing on exit matters: otherwise the persisted sub-minimum
  roll would re-bust the player instantly on their next visit.

There is no "dismiss and keep playing" — with less than the minimum there is
nothing to keep playing. The modal renders only when `onReset` is provided
(single player); `App` passes the tier-aware handlers.

The modal appears at settle, over the swept felt — same timing as
`VictoryModal`. A short CSS fade-in delay (~1.2s) lets the sweep land first;
store state stays synchronous and testable.

### State shape

`GameState` gains one field:

```ts
/** True after a settle leaves the roll below the table minimum. */
busted: boolean;
```

No dismiss action: leaving or re-buying destroys/remounts the store, which
resets the flag naturally.

## 2. Audio

### Sound source: synthesized, no assets

All effects are generated with the **Web Audio API** (square/triangle
oscillators + noise bursts) in a new `web/src/audio/sfx.ts`. Zero binary
assets, no licensing, and the chiptune character matches the pixel aesthetic.

The module guards `typeof AudioContext === "undefined"` (and construction
failures) by degrading to a silent no-op — jsdom tests and odd browsers never
throw. The `AudioContext` is created lazily on the first play and `resume()`d
if suspended; every sound follows a user click (bets, flips, settle), so the
autoplay policy unlocks naturally.

### The sound set

| Name        | Trigger (store transition)                       | Character |
|-------------|--------------------------------------------------|-----------|
| `chipPick`  | `hand.length` increased                          | light click |
| `chipPlace` | total staged chip count increased                | double clack |
| `deal`      | `phase` left `Betting` for `Dealing`             | card swish (noise) |
| `flip`      | `lastFlip` changed to a new flip                 | short snap |
| `win`       | `settleSeq` incremented and `lastDelta > 0`      | rising arpeggio |
| `lose`      | `settleSeq` incremented and `lastDelta < 0`      | falling two-tone |
| `push`      | `settleSeq` incremented and `lastDelta === 0`    | neutral blip |
| `victory`   | `goalReached` false → true                       | fanfare |
| `bust`      | `busted` false → true                            | descending dirge |

### Hookup: a subscription, not store pollution

A `useGameSounds(store)` hook in `GameTable` subscribes to the zustand store
and compares `(state, prevState)` to fire the table above. The store stays
pure (no side effects in actions), and because **multiplayer reuses
`GameTable`**, remote play gets the same sounds with zero extra wiring.

### Volume: adjustable and persisted

- `web/src/audio/settings.ts` — `loadAudioSettings()` / `saveAudioSettings()`
  persisting `{ volume: 0..1, muted: boolean }` to localStorage
  (`baccarat.audio`), with the same safe-storage guards as
  `bankrollStorage.ts`. Default when nothing is saved: `{ volume: 0.5,
  muted: false }`; out-of-range values clamp to [0, 1].
- The sfx module exposes `setVolume(v)` / `setMuted(m)`; a master `GainNode`
  applies `muted ? 0 : volume` (perceptual curve: `volume²`).
- **`VolumeControl`** component in the Hud actions row: a speaker toggle
  button (mute) plus a chunky retro range slider (0–100). Changes apply
  immediately and persist. Lives in `Hud`, so both modes get it.

### Testing

- `audio/settings.test.ts` — persistence round-trip, clamping, bad-storage
  degradation (injectable Storage, like bankrollStorage tests).
- `audio/sfx` is structured so the trigger map is testable: `useGameSounds`
  takes an injectable `play(name)` and tests drive a real single-player store
  through bet→deal→flip→settle→bust asserting the emitted sound names.
- `BustModal` render test + store test: settle below the min sets `busted`,
  above leaves it false; `gameStore` bust test alongside the goal test.
- Oscillator scheduling itself is not unit-tested (no real audio in jsdom);
  the module's no-op guard is.

## Out of scope

- Multiplayer bust/re-buy semantics (server-side bankrolls; future work).
- Background music, dealer voice. YAGNI.
- Engine/server changes: none required — both features are pure web.
