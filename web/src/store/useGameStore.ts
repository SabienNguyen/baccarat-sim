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
    store = createGameStore(
      createTableSession(configFor(tier, saved)),
      spec.denoms,
      spec.goal,
      !!spec.coach, // the learner's table opens with Explain mode teaching
    );

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

/**
 * Buy back in at this table's starting roll.
 *
 * This tops the seat up *in place* rather than rebuilding the session: handing
 * the dealer more cash doesn't get you a fresh shoe, so the cards already dealt
 * stay dealt and the roads keep running. Only if the store doesn't exist yet
 * (or can't re-buy, e.g. a stubbed session) do we fall back to dropping it so
 * the next `storeFor()` builds a fresh table.
 */
export function resetStore(tier: TableTier): void {
  const store = stores.get(tier);
  const spec = tableSpec(tier);
  if (store) {
    const state = store.getState();
    const topUp = spec.starting_bankroll - state.snapshot.bankroll;
    if (state.rebuy && topUp > 0) {
      state.rebuy(topUp);
      saveBankroll(tier, store.getState().snapshot.bankroll);
      return;
    }
  }
  clearBankroll(tier);
  stores.delete(tier);
}

/** Back-compat default: the main-floor table. */
export function defaultStore(): StoreApi<GameState> {
  return storeFor("mid");
}
