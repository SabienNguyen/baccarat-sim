import { createGameStore, type GameState } from "./gameStore";
import { createTableSession } from "../engine/adapter";
import type { StoreApi } from "zustand/vanilla";
import { clearBankroll, loadBankroll, saveBankroll } from "../bankrollStorage";
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
    const spec = tableSpec(tier);
    // Single player runs the SAME table rules as multiplayer, one seat: you
    // squeeze the sides you bet, the house dealer turns the rest.
    store = createGameStore(createTableSession(configFor(tier, saved)), spec.denoms, spec.goal);

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

/** Wipe a tier's saved roll and drop its store so the next storeFor() re-buys in. */
export function resetStore(tier: TableTier): void {
  clearBankroll(tier);
  stores.delete(tier);
}

/** Back-compat default: the main-floor table. */
export function defaultStore(): StoreApi<GameState> {
  return storeFor("mid");
}
