import { WasmSession, glossary as wasmGlossary } from "engine-wasm";
import type {
  RoundSnapshot,
  SessionConfig,
  BetKind,
  CommandError,
  Side,
  GlossaryEntry,
} from "./types";

/** A command either advances the game (new snapshot) or is rejected (typed error). */
export type CommandResult =
  | { ok: true; snapshot: RoundSnapshot }
  | { ok: false; error: CommandError };

/** Plain, throw-free, number-based facade over a wasm `WasmSession`. */
export interface GameSession {
  snapshot(): RoundSnapshot;
  placeBet(kind: BetKind, amountCents: number): CommandResult;
  clearBets(): CommandResult;
  deal(): CommandResult;
  peek(hand: Side, index: number): CommandResult;
  reveal(hand: Side, index: number): CommandResult;
  settle(): CommandResult;
  newShoe(): CommandResult;
}

function run(fn: () => RoundSnapshot): CommandResult {
  try {
    return { ok: true, snapshot: fn() };
  } catch (error) {
    // WasmSession throws the serialized CommandError object on rejection.
    return { ok: false, error: error as CommandError };
  }
}

export function createSession(config: SessionConfig): GameSession {
  const inner = new WasmSession(config);
  return {
    snapshot: () => inner.snapshot(),
    placeBet: (kind, amountCents) =>
      run(() => inner.place_bet(kind, BigInt(amountCents))),
    clearBets: () => run(() => inner.clear_bets()),
    deal: () => run(() => inner.deal_round()),
    peek: (hand, index) => run(() => inner.peek(hand, index)),
    reveal: (hand, index) => run(() => inner.reveal(hand, index)),
    settle: () => run(() => inner.settle()),
    newShoe: () => run(() => inner.new_shoe()),
  };
}

export function getGlossary(): GlossaryEntry[] {
  return wasmGlossary();
}
