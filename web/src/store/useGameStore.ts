import { createGameStore, type GameState } from "./gameStore";
import { createSession } from "../engine/adapter";
import type { SessionConfig } from "../engine/types";
import type { StoreApi } from "zustand/vanilla";

const DEFAULT_CONFIG: SessionConfig = {
  starting_bankroll: 100000,
  table_min: 100,
  table_max: 10000,
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
