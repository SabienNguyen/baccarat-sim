import { createGameStore, type GameState } from "./gameStore";
import { createSession } from "../engine/adapter";
import type { SessionConfig } from "../engine/types";
import type { StoreApi } from "zustand/vanilla";
import { loadBankroll, saveBankroll } from "../bankrollStorage";

/** 52 bits of OS entropy for the shoe — Math.random is not a casino shuffle. */
function strongSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return buf[0] * 0x100000 + (buf[1] >>> 12); // 32 + 20 bits, < 2^53
  }
  return Math.floor(Math.random() * 0xffffffff);
}

const DEFAULT_CONFIG: SessionConfig = {
  // $10,000 starting bank, $5 min / $50,000 max — so every chip ($25–$1,000)
  // is bettable and the table has realistic room.
  starting_bankroll: 1_000_000,
  table_min: 500,
  table_max: 5_000_000,
  ruleset: "Commission",
  seed: strongSeed(),
};

let store: StoreApi<GameState> | null = null;

/** The app-wide, real wasm-backed store, created on first use (not at import). */
export function defaultStore(): StoreApi<GameState> {
  if (store === null) {
    // Resume the saved bankroll across reloads, falling back to the default.
    const saved = loadBankroll();
    const config: SessionConfig =
      saved !== null ? { ...DEFAULT_CONFIG, starting_bankroll: saved } : DEFAULT_CONFIG;
    store = createGameStore(createSession(config));

    let lastSaved = store.getState().snapshot.bankroll;
    saveBankroll(lastSaved);
    store.subscribe((state) => {
      const current = state.snapshot.bankroll;
      if (current !== lastSaved) {
        lastSaved = current;
        saveBankroll(current);
      }
    });
  }
  return store;
}
