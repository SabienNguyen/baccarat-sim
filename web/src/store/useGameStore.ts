import { createGameStore, type GameState } from "./gameStore";
import { createSession } from "../engine/adapter";
import type { SessionConfig } from "../engine/types";
import type { StoreApi } from "zustand/vanilla";

const DEFAULT_CONFIG: SessionConfig = {
  // $10,000 starting bank, $5 min / $50,000 max — so every chip ($25–$1,000)
  // is bettable and the table has realistic room.
  starting_bankroll: 1_000_000,
  table_min: 500,
  table_max: 5_000_000,
  ruleset: "Commission",
  seed: Math.floor(Math.random() * 0xffffffff),
};

let store: StoreApi<GameState> | null = null;

/** The app-wide, real wasm-backed store, created on first use (not at import). */
export function defaultStore(): StoreApi<GameState> {
  if (store === null) {
    store = createGameStore(createSession(DEFAULT_CONFIG));
  }
  return store;
}
