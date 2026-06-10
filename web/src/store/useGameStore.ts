import { createGameStore, type GameState } from "./gameStore";
import { createSession } from "../engine/adapter";
import type { StoreApi } from "zustand/vanilla";
import { loadBankroll, saveBankroll } from "../bankrollStorage";
import { configFor, tableSpec, type TableTier } from "../tables";

const stores = new Map<TableTier, StoreApi<GameState>>();

/**
 * The real wasm-backed store for a table tier, created on first use. Each
 * tier resumes its own persisted bankroll and saves on every change.
 */
export function storeFor(tier: TableTier): StoreApi<GameState> {
  let store = stores.get(tier);
  if (!store) {
    const saved = loadBankroll(tier);
    store = createGameStore(createSession(configFor(tier, saved)), tableSpec(tier).denoms);

    let lastSaved = store.getState().snapshot.bankroll;
    saveBankroll(tier, lastSaved);
    store.subscribe((state) => {
      const current = state.snapshot.bankroll;
      if (current !== lastSaved) {
        lastSaved = current;
        saveBankroll(tier, current);
      }
    });
    stores.set(tier, store);
  }
  return store;
}

/** Back-compat default: the main-floor table. */
export function defaultStore(): StoreApi<GameState> {
  return storeFor("mid");
}
