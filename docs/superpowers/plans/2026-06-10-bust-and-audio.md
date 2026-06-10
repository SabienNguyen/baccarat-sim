# Bust + Retro Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single player gets a losing state (bust when the roll can't post the table minimum) and the whole table gets synthesized retro sound effects with a persisted, user-adjustable volume control.

**Architecture:** The bust flag mirrors the existing `goalReached` flag in the zustand store's settle path; a `BustModal` mirrors `VictoryModal` and reuses the existing `onReset` remount for re-buy. Audio is a Web Audio synth module (no assets) driven by a store-subscription hook in `GameTable`, so single player and multiplayer both get sounds; volume/mute persist to localStorage like `bankrollStorage`.

**Tech Stack:** React + TypeScript, zustand vanilla stores, Web Audio API, vitest + testing-library. Spec: `docs/superpowers/specs/2026-06-10-bust-and-audio-design.md`.

**Conventions:** Run all commands from the repo root `/home/sabien/Dev/personal/baccarat-simulator`. Run a single test file with `npm --workspace web run test -- --run src/<path>`. Money is integer cents. Theme vars live in `web/src/theme.css` (`--gold`, `--chip-red`, `--ink`, `--panel-bevel-hi`, `--font-display`, `--font-text`).

---

### Task 1: `busted` flag in the game store

**Files:**
- Modify: `web/src/store/gameStore.ts` (interface ~line 60, initial state ~line 160, `settle` ~line 284)
- Modify: `web/src/multiplayer/remoteStore.ts` (initial state object, ~line 68)
- Test: `web/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/store/gameStore.test.ts` (the file already defines `snapshotWith` and `fakeSession` at the top):

```ts
test("a settle that leaves the roll under the table minimum busts the run", () => {
  // table_min is 500 in snapshotWith(); a settle down to 300 can't post it.
  const broke = snapshotWith({ phase: "Settled", bankroll: 300, payouts: [] });
  const store = createGameStore(fakeSession({ ok: true, snapshot: broke }));
  expect(store.getState().busted).toBe(false);
  store.getState().settle();
  expect(store.getState().busted).toBe(true);
});

test("a settle that keeps the roll at or above the minimum does not bust", () => {
  const alive = snapshotWith({ phase: "Settled", bankroll: 500, payouts: [] });
  const store = createGameStore(fakeSession({ ok: true, snapshot: alive }));
  store.getState().settle();
  expect(store.getState().busted).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace web run test -- --run src/store/gameStore.test.ts`
Expected: FAIL — `busted` is `undefined`, not `false`/`true`.

- [ ] **Step 3: Implement**

In `web/src/store/gameStore.ts`:

(a) Add to the `GameState` interface, right after the `dismissGoal` line:

```ts
  /** True when a settle left the roll below the table minimum — the run is lost. */
  busted: boolean;
```

(b) Add to the initial state object, right after `goalReached: false,` / `dismissGoal: ...`:

```ts
      busted: false,
```

(c) In `settle()`, inside the `set({...})` call, right after the `goalReached:` entry:

```ts
            // the run dies when the roll can no longer post the minimum
            busted: result.snapshot.bankroll < result.snapshot.table_min,
```

In `web/src/multiplayer/remoteStore.ts`, in the initial state object after `dismissGoal: () => set({ goalReached: false }),`:

```ts
    // the server has no re-buy concept; remote play never busts locally
    busted: false,
```

- [ ] **Step 4: Run tests to verify they pass (and nothing else broke)**

Run: `npm --workspace web run test -- --run src/store src/multiplayer`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add web/src/store/gameStore.ts web/src/multiplayer/remoteStore.ts web/src/store/gameStore.test.ts
git commit -m "feat(web): settle below the table minimum busts the run"
```

---

### Task 2: `BustModal` component

**Files:**
- Create: `web/src/components/BustModal.tsx`
- Create: `web/src/components/bust.css`
- Test: `web/src/components/BustModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/BustModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BustModal } from "./BustModal";

function renderModal(over: Partial<Parameters<typeof BustModal>[0]> = {}) {
  const onRebuy = vi.fn();
  const onLeave = vi.fn();
  render(
    <BustModal bankroll={37} tableMin={100} onRebuy={onRebuy} onLeave={onLeave} {...over} />,
  );
  return { onRebuy, onLeave };
}

test("shows the dead roll and the minimum it can no longer post", () => {
  renderModal();
  expect(screen.getByRole("dialog", { name: "Busted" })).toBeInTheDocument();
  expect(screen.getByText("BUSTED")).toBeInTheDocument();
  expect(screen.getByText("$0.37")).toBeInTheDocument();
  expect(screen.getByText(/\$1\.00/)).toBeInTheDocument();
});

test("re-buy and leave fire their callbacks", async () => {
  const user = userEvent.setup();
  const { onRebuy, onLeave } = renderModal();
  await user.click(screen.getByRole("button", { name: "Re-buy" }));
  expect(onRebuy).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Leave table" }));
  expect(onLeave).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace web run test -- --run src/components/BustModal.test.tsx`
Expected: FAIL — module `./BustModal` not found.

- [ ] **Step 3: Implement the component**

Create `web/src/components/BustModal.tsx`:

```tsx
import { formatCents } from "../format";
import "./bust.css";

interface BustModalProps {
  bankroll: number;
  tableMin: number;
  /** Buy back in at this table's starting roll. */
  onRebuy: () => void;
  /** Back to the lobby; the caller clears the dead roll on the way out. */
  onLeave: () => void;
}

/** The run is lost: the roll can no longer post the table minimum. */
export function BustModal({ bankroll, tableMin, onRebuy, onLeave }: BustModalProps) {
  return (
    <div className="bust-backdrop">
      <div role="dialog" aria-label="Busted" className="bust-modal panel">
        <h2 className="bust-title">BUSTED</h2>
        <p className="bust-amount">{formatCents(bankroll)}</p>
        <p className="bust-sub">
          The minimum here is {formatCents(tableMin)}. The pit boss offers his
          condolences — and nothing else.
        </p>
        <div className="bust-actions">
          <button type="button" className="btn" onClick={onLeave}>
            Leave table
          </button>
          <button type="button" className="btn btn--gold" onClick={onRebuy}>
            Re-buy
          </button>
        </div>
      </div>
    </div>
  );
}
```

Create `web/src/components/bust.css` (the 1.1s delay lets the dealer's sweep
land before the bad news drops; `backwards` keeps it invisible until then):

```css
.bust-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(24, 2, 2, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: bust-fade 350ms ease-out 1100ms backwards;
}
.bust-modal {
  max-width: 460px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 36px 44px;
  animation: bust-drop 450ms cubic-bezier(0.3, 1.4, 0.5, 1) 1100ms backwards;
}
.bust-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  color: var(--chip-red);
  text-shadow:
    3px 3px 0 var(--ink),
    6px 6px 0 rgba(0, 0, 0, 0.4);
}
.bust-amount {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  color: #fff;
  text-shadow: 2px 2px 0 var(--ink);
}
.bust-sub {
  margin: 0;
  font-family: var(--font-text);
  font-size: 19px;
  color: #d8b0b0;
  text-align: center;
}
.bust-actions {
  display: flex;
  gap: 14px;
  margin-top: 8px;
}
.bust-modal .btn {
  font-family: var(--font-display);
  font-size: 10px;
  color: #fff;
  background: var(--panel-bevel-hi);
  border: 3px solid var(--ink);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
}
.bust-modal .btn--gold {
  background: var(--gold);
  color: #1a1208;
}

@keyframes bust-fade {
  from {
    opacity: 0;
  }
}
@keyframes bust-drop {
  from {
    transform: translateY(-40px) scale(0.8);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bust-backdrop,
  .bust-modal {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace web run test -- --run src/components/BustModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/BustModal.tsx web/src/components/bust.css web/src/components/BustModal.test.tsx
git commit -m "feat(web): BustModal — the run-over screen"
```

---

### Task 3: Wire the bust flow into `GameTable`

**Files:**
- Modify: `web/src/App.tsx` (imports ~line 22, state selectors ~line 95, modals ~line 232)
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Look at the top of `web/src/App.test.tsx` to see how existing tests build a
store and render (they use `createGameStore` + `fakeSession`-style helpers or
the real session — follow whatever pattern the file already uses for the
victory-modal test if one exists; otherwise add the helper below). Append:

```tsx
test("busting offers a re-buy and a way out", async () => {
  // a store already in the busted state
  const user = userEvent.setup();
  const store = createGameStore(
    fakeSession({ ok: true, snapshot: snapshotWith() }),
  );
  store.setState({ busted: true });
  const onLeave = vi.fn();
  const onReset = vi.fn();
  render(<GameTable store={store} onLeave={onLeave} onReset={onReset} />);
  expect(screen.getByRole("dialog", { name: "Busted" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Re-buy" }));
  expect(onReset).toHaveBeenCalledOnce();

  // leaving clears the dead roll first, so the next visit re-buys fresh
  await user.click(screen.getByRole("button", { name: "Leave table" }));
  expect(onReset).toHaveBeenCalledTimes(2);
  expect(onLeave).toHaveBeenCalledOnce();
});
```

If `App.test.tsx` lacks `fakeSession`/`snapshotWith`, import the snapshot
helper from `../test/fixtures` (`bettingSnapshot`) and build the inline fake:

```tsx
import { bettingSnapshot } from "./test/fixtures";
import { createGameStore } from "./store/gameStore";
import type { GameSession, CommandResult } from "./engine/adapter";

function okSession(): GameSession {
  const snap = bettingSnapshot();
  const ok: CommandResult = { ok: true, snapshot: snap };
  return {
    snapshot: () => snap,
    placeBet: () => ok,
    clearBets: () => ok,
    deal: () => ok,
    peek: () => ok,
    reveal: () => ok,
    settle: () => ok,
    newShoe: () => ok,
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace web run test -- --run src/App.test.tsx`
Expected: FAIL — no dialog named "Busted".

- [ ] **Step 3: Implement**

In `web/src/App.tsx`:

(a) Import: `import { BustModal } from "./components/BustModal";`

(b) Selector, next to the `goalReached` selector in `GameTable`:

```tsx
  const busted = useStore(active, (s) => s.busted);
```

(c) Render, right after the `VictoryModal` block. Gate on `onReset` so the
modal is single-player only (multiplayer passes no `onReset`, and its store
never sets `busted`):

```tsx
      {busted && onReset && (
        <BustModal
          bankroll={snapshot.bankroll}
          tableMin={snapshot.table_min}
          onRebuy={onReset}
          onLeave={() => {
            // clear the dead roll so the next visit re-buys fresh
            onReset();
            onLeave();
          }}
        />
      )}
```

(`onReset` in `App` runs `resetStore(tier)` — which clears the persisted
bankroll and drops the store — then bumps `resetSeq`. Followed by `onLeave`'s
`setTier(null)`, the remount never renders; the storage clear is what matters.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace web run test -- --run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): bust flow — re-buy or leave when the roll dies"
```

---

### Task 4: Audio settings persistence

**Files:**
- Create: `web/src/audio/settings.ts`
- Test: `web/src/audio/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/audio/settings.test.ts`:

```ts
import { loadAudioSettings, saveAudioSettings, DEFAULT_AUDIO } from "./settings";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

test("defaults when nothing is saved", () => {
  expect(loadAudioSettings(memoryStorage())).toEqual({ volume: 0.5, muted: false });
});

test("round-trips volume and mute", () => {
  const storage = memoryStorage();
  saveAudioSettings({ volume: 0.8, muted: true }, storage);
  expect(loadAudioSettings(storage)).toEqual({ volume: 0.8, muted: true });
});

test("clamps out-of-range volume and survives garbage", () => {
  const storage = memoryStorage();
  storage.setItem("baccarat.audio", JSON.stringify({ volume: 7, muted: "yes" }));
  expect(loadAudioSettings(storage)).toEqual({ volume: 1, muted: false });
  storage.setItem("baccarat.audio", "not json");
  expect(loadAudioSettings(storage)).toEqual(DEFAULT_AUDIO);
});

test("degrades to defaults with no storage at all", () => {
  expect(loadAudioSettings(undefined)).toEqual(DEFAULT_AUDIO);
  expect(() => saveAudioSettings({ volume: 0.3, muted: false }, undefined)).not.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace web run test -- --run src/audio/settings.test.ts`
Expected: FAIL — module `./settings` not found.

- [ ] **Step 3: Implement**

Create `web/src/audio/settings.ts`:

```ts
const KEY = "baccarat.audio";

export interface AudioSettings {
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { volume: 0.5, muted: false };

/**
 * Persist the player's sound preferences across reloads. Guarded like
 * bankrollStorage: a disabled Storage degrades to defaults, never throws.
 */
export function loadAudioSettings(
  storage: Storage | undefined = safeStorage(),
): AudioSettings {
  if (!storage) return DEFAULT_AUDIO;
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return DEFAULT_AUDIO;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const volume =
      typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
        ? Math.min(1, Math.max(0, parsed.volume))
        : DEFAULT_AUDIO.volume;
    return { volume, muted: parsed.muted === true };
  } catch {
    return DEFAULT_AUDIO;
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage: Storage | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* best-effort */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace web run test -- --run src/audio/settings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/audio/settings.ts web/src/audio/settings.test.ts
git commit -m "feat(web): persisted audio settings (volume + mute)"
```

---

### Task 5: The synth — `sfx.ts`

**Files:**
- Create: `web/src/audio/sfx.ts`
- Test: `web/src/audio/sfx.test.ts`

The synth schedules oscillator/noise envelopes on a lazily created
`AudioContext` behind a master `GainNode`. jsdom has no `AudioContext`, so the
unit tests only pin the safe-degradation contract; the actual sound design is
verified by ear.

- [ ] **Step 1: Write the failing test**

Create `web/src/audio/sfx.test.ts`:

```ts
import { playSfx, setVolume, setMuted, SFX_NAMES } from "./sfx";

test("every sound is a silent no-op without an AudioContext", () => {
  // jsdom: typeof AudioContext === "undefined"
  for (const name of SFX_NAMES) {
    expect(() => playSfx(name)).not.toThrow();
  }
});

test("volume and mute setters never throw without audio", () => {
  expect(() => setVolume(0.7)).not.toThrow();
  expect(() => setMuted(true)).not.toThrow();
  expect(() => setMuted(false)).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace web run test -- --run src/audio/sfx.test.ts`
Expected: FAIL — module `./sfx` not found.

- [ ] **Step 3: Implement**

Create `web/src/audio/sfx.ts`:

```ts
import { DEFAULT_AUDIO, loadAudioSettings, type AudioSettings } from "./settings";

/** Every one-shot the table can make. */
export const SFX_NAMES = [
  "chipPick",
  "chipPlace",
  "deal",
  "flip",
  "win",
  "lose",
  "push",
  "victory",
  "bust",
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let settings: AudioSettings = { ...DEFAULT_AUDIO };
let loaded = false;

function ensureSettings(): void {
  if (!loaded) {
    settings = loadAudioSettings();
    loaded = true;
  }
}

/** Squared for a perceptual taper: half the slider sounds half as loud. */
function masterLevel(): number {
  return settings.muted ? 0 : settings.volume * settings.volume;
}

function applyLevel(): void {
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.01);
}

/** Lazy context: created on the first sound, which always follows a click. */
function ensureContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (ctx === null) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function setVolume(volume: number): void {
  ensureSettings();
  settings = { ...settings, volume: Math.min(1, Math.max(0, volume)) };
  applyLevel();
}

export function setMuted(muted: boolean): void {
  ensureSettings();
  settings = { ...settings, muted };
  applyLevel();
}

/** One chiptune note: instant attack, exponential decay. */
function tone(
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  peak = 0.3,
): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A decaying noise burst through a bandpass — card swishes and snaps. */
function swish(at: number, dur: number, freq: number, peak = 0.25): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = 0.8;
  const env = ctx.createGain();
  env.gain.value = peak;
  src.connect(band).connect(env).connect(master);
  src.start(t0);
}

const SOUNDS: Record<SfxName, () => void> = {
  chipPick: () => tone(0, 1800, 0.05, "triangle", 0.22),
  chipPlace: () => {
    tone(0, 950, 0.04, "square", 0.25);
    tone(0.045, 700, 0.05, "square", 0.2);
  },
  deal: () => swish(0, 0.18, 1800),
  flip: () => {
    swish(0, 0.06, 3000, 0.18);
    tone(0.01, 1400, 0.05, "triangle", 0.15);
  },
  win: () => {
    // rising C-major arpeggio
    [523, 659, 784, 1047].forEach((f, i) => tone(i * 0.09, f, 0.14, "square", 0.25));
  },
  lose: () => {
    tone(0, 392, 0.16, "square", 0.25);
    tone(0.15, 311, 0.26, "square", 0.25);
  },
  push: () => tone(0, 660, 0.1, "triangle", 0.22),
  victory: () => {
    [392, 523, 659, 784].forEach((f, i) => tone(i * 0.11, f, 0.16, "square", 0.28));
    tone(0.46, 1047, 0.5, "square", 0.3);
  },
  bust: () => {
    // the long walk away from the table
    [330, 277, 233].forEach((f, i) => tone(i * 0.19, f, 0.24, "square", 0.26));
    tone(0.57, 196, 0.6, "square", 0.28);
  },
};

export function playSfx(name: SfxName): void {
  ensureSettings();
  if (masterLevel() === 0) return;
  if (ensureContext() === null) return;
  try {
    SOUNDS[name]();
  } catch {
    /* a sound must never break the game */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace web run test -- --run src/audio/sfx.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/audio/sfx.ts web/src/audio/sfx.test.ts
git commit -m "feat(web): synthesized retro sfx — chips, cards, settles, bust"
```

---

### Task 6: `useGameSounds` — store transitions → sounds

**Files:**
- Create: `web/src/audio/useGameSounds.ts`
- Test: `web/src/audio/useGameSounds.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/audio/useGameSounds.test.ts`. `soundsFor` is a pure
`(prev, next) => SfxName[]`, so tests build two `GameState`-shaped values and
diff them. Use the real store for shape fidelity:

```ts
import { createGameStore, type GameState } from "../store/gameStore";
import { soundsFor } from "./useGameSounds";
import type { GameSession, CommandResult } from "../engine/adapter";
import { bettingSnapshot } from "../test/fixtures";

function okSession(): GameSession {
  const snap = bettingSnapshot();
  const ok: CommandResult = { ok: true, snapshot: snap };
  return {
    snapshot: () => snap,
    placeBet: () => ok,
    clearBets: () => ok,
    deal: () => ok,
    peek: () => ok,
    reveal: () => ok,
    settle: () => ok,
    newShoe: () => ok,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return { ...createGameStore(okSession()).getState(), ...over };
}

test("picking up and placing chips click", () => {
  const before = state();
  expect(soundsFor(before, state({ hand: [100] }))).toEqual(["chipPick"]);
  expect(soundsFor(before, state({ stagedChips: [[100, 100]] }))).toEqual(["chipPlace"]);
});

test("the deal swishes and a flip snaps", () => {
  const betting = state();
  const dealing = state({ snapshot: { ...betting.snapshot, phase: "Dealing" } });
  expect(soundsFor(betting, dealing)).toEqual(["deal"]);
  const flipped = state({
    snapshot: dealing.snapshot,
    lastFlip: { side: "Player", card: { rank: "Nine", suit: "Hearts" } },
  });
  expect(soundsFor(dealing, flipped)).toEqual(["flip"]);
});

test("settles ring by outcome: win, lose, push", () => {
  const before = state();
  expect(soundsFor(before, state({ settleSeq: 1, lastDelta: 500 }))).toEqual(["win"]);
  expect(soundsFor(before, state({ settleSeq: 1, lastDelta: -500 }))).toEqual(["lose"]);
  expect(soundsFor(before, state({ settleSeq: 1, lastDelta: 0 }))).toEqual(["push"]);
});

test("victory and bust replace the plain settle sound", () => {
  const before = state();
  expect(
    soundsFor(before, state({ settleSeq: 1, lastDelta: 9000, goalReached: true })),
  ).toEqual(["victory"]);
  expect(
    soundsFor(before, state({ settleSeq: 1, lastDelta: -9000, busted: true })),
  ).toEqual(["bust"]);
});

test("an unchanged state is silent", () => {
  const s = state();
  expect(soundsFor(s, s)).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace web run test -- --run src/audio/useGameSounds.test.ts`
Expected: FAIL — module `./useGameSounds` not found.

- [ ] **Step 3: Implement**

Create `web/src/audio/useGameSounds.ts`:

```ts
import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { GameState } from "../store/gameStore";
import { playSfx, type SfxName } from "./sfx";

function stagedCount(s: GameState): number {
  return s.stagedChips.reduce((n, chips) => n + chips.length, 0);
}

/** The sounds one store transition makes. Pure, so the mapping is testable. */
export function soundsFor(prev: GameState, next: GameState): SfxName[] {
  const out: SfxName[] = [];
  if (next.hand.length > prev.hand.length) out.push("chipPick");
  if (stagedCount(next) > stagedCount(prev)) out.push("chipPlace");
  if (prev.snapshot.phase === "Betting" && next.snapshot.phase === "Dealing") out.push("deal");
  if (next.lastFlip !== null && next.lastFlip !== prev.lastFlip) out.push("flip");
  if (next.settleSeq > prev.settleSeq) {
    // the big moments own the settle: no win-jingle under the bust dirge
    if (next.busted && !prev.busted) out.push("bust");
    else if (next.goalReached && !prev.goalReached) out.push("victory");
    else {
      const delta = next.lastDelta ?? 0;
      out.push(delta > 0 ? "win" : delta < 0 ? "lose" : "push");
    }
  }
  return out;
}

/** Subscribe a table store to the speaker. Works for local and remote play. */
export function useGameSounds(
  store: StoreApi<GameState>,
  play: (name: SfxName) => void = playSfx,
): void {
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        for (const name of soundsFor(prev, state)) play(name);
      }),
    [store, play],
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace web run test -- --run src/audio/useGameSounds.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/audio/useGameSounds.ts web/src/audio/useGameSounds.test.ts
git commit -m "feat(web): map table-store transitions to sounds"
```

---

### Task 7: `VolumeControl` in the Hud

**Files:**
- Create: `web/src/components/VolumeControl.tsx`
- Create: `web/src/components/volume.css`
- Modify: `web/src/components/Hud.tsx` (render before the `hud-actions` block)
- Test: `web/src/components/VolumeControl.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/VolumeControl.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { VolumeControl } from "./VolumeControl";
import { loadAudioSettings } from "../audio/settings";

beforeEach(() => localStorage.clear());

test("slider reflects and persists the volume", () => {
  render(<VolumeControl />);
  const slider = screen.getByRole("slider", { name: "Volume" });
  expect(slider).toHaveValue("50"); // the 0.5 default
  fireEvent.change(slider, { target: { value: "80" } });
  expect(loadAudioSettings().volume).toBe(0.8);
});

test("the speaker button toggles and persists mute", async () => {
  const user = userEvent.setup();
  render(<VolumeControl />);
  await user.click(screen.getByRole("button", { name: "Mute sounds" }));
  expect(loadAudioSettings().muted).toBe(true);
  await user.click(screen.getByRole("button", { name: "Unmute sounds" }));
  expect(loadAudioSettings().muted).toBe(false);
});

test("dragging the slider while muted unmutes", () => {
  render(<VolumeControl />);
  fireEvent.click(screen.getByRole("button", { name: "Mute sounds" }));
  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
    target: { value: "30" },
  });
  expect(loadAudioSettings()).toEqual({ volume: 0.3, muted: false });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace web run test -- --run src/components/VolumeControl.test.tsx`
Expected: FAIL — module `./VolumeControl` not found.

- [ ] **Step 3: Implement**

Create `web/src/components/VolumeControl.tsx`:

```tsx
import { useState } from "react";
import {
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from "../audio/settings";
import { setMuted, setVolume } from "../audio/sfx";
import "./volume.css";

/** Speaker toggle + slider. Applies immediately, persists across visits. */
export function VolumeControl() {
  const [settings, setSettings] = useState<AudioSettings>(loadAudioSettings);

  const update = (next: AudioSettings) => {
    setSettings(next);
    saveAudioSettings(next);
    setVolume(next.volume);
    setMuted(next.muted);
  };

  const silent = settings.muted || settings.volume === 0;
  return (
    <div className="volume" aria-label="Sound">
      <button
        type="button"
        className="volume-mute"
        aria-label={settings.muted ? "Unmute sounds" : "Mute sounds"}
        aria-pressed={settings.muted}
        onClick={() => update({ ...settings, muted: !settings.muted })}
      >
        {silent ? "🔇" : "🔊"}
      </button>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={100}
        step={5}
        value={Math.round(settings.volume * 100)}
        aria-label="Volume"
        onChange={(e) =>
          update({ ...settings, volume: Number(e.target.value) / 100, muted: false })
        }
      />
    </div>
  );
}
```

Create `web/src/components/volume.css`:

```css
.volume {
  display: flex;
  align-items: center;
  gap: 8px;
}
.volume-mute {
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
  background: var(--panel-bevel-hi);
  border: 2px solid var(--ink);
  border-radius: 6px;
  cursor: pointer;
}
.volume-slider {
  flex: 1;
  min-width: 70px;
  accent-color: var(--gold);
  cursor: pointer;
}
```

Modify `web/src/components/Hud.tsx`: import the component and render it just
above the `hud-actions` block (unconditionally — multiplayer has no
reset/leave-dependent actions but still gets sound control):

```tsx
import { VolumeControl } from "./VolumeControl";
```

```tsx
      <VolumeControl />

      {(onResetBankroll || onLeave) && (
```

- [ ] **Step 4: Run tests to verify they pass (Hud tests too)**

Run: `npm --workspace web run test -- --run src/components/VolumeControl.test.tsx src/components/Hud.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/VolumeControl.tsx web/src/components/volume.css web/src/components/VolumeControl.test.tsx web/src/components/Hud.tsx
git commit -m "feat(web): volume control in the HUD — adjustable, persisted"
```

---

### Task 8: Plug the speaker into `GameTable`

**Files:**
- Modify: `web/src/App.tsx` (`GameTable`, after the store selectors)

- [ ] **Step 1: Implement (two lines — the mapping itself is already tested)**

In `web/src/App.tsx`:

```tsx
import { useGameSounds } from "./audio/useGameSounds";
```

Inside `GameTable`, right after the `useStore` selectors:

```tsx
  // every table noise rides the store: works for local and remote play alike
  useGameSounds(active);
```

- [ ] **Step 2: Run the full web suite**

Run: `npm --workspace web run test -- --run`
Expected: PASS, all files (jsdom plays nothing — `playSfx` no-ops without `AudioContext`).

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): the table makes noise — sfx wired into GameTable"
```

---

### Task 9: Full verification + ship

- [ ] **Step 1: Full test suites**

```bash
npm --workspace web run test -- --run
cargo test
```

Expected: all green (web suite grows by ~14 tests; Rust unchanged at 144).

- [ ] **Step 2: Production build**

```bash
npm --workspace web run build
```

Expected: clean build, no TS errors.

- [ ] **Step 3: README touch-up**

Add to the game-features list in `README.md` (after the scoreboard bullet):

```markdown
- **Sound** — synthesized chiptune table noise (chips, cards, settles, the
  bust dirge), with a persisted volume control in the HUD.
```

And in the single-player sentence of the Status section, mention the bust:
change "single player (three tables, win goals, persistent bankrolls)" to
"single player (three tables, win goals, bust-outs, persistent bankrolls)".

- [ ] **Step 4: Commit + push**

```bash
git add README.md
git commit -m "docs: README — sound and bust-outs"
git push
```

- [ ] **Step 5: Watch CI**

```bash
gh run watch --exit-status $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: success; Pages redeploys.
