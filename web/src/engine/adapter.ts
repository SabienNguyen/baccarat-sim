import { WasmSession, WasmTable, glossary as wasmGlossary } from "engine-wasm";
import type { TableError } from "engine-wasm";
import type {
  RoundSnapshot,
  SessionConfig,
  BetKind,
  CommandError,
  Side,
  GlossaryEntry,
} from "./types";

/** An engine refusal or, from a table, the dealer's plain speech. */
export type SessionError = CommandError | { Message: string };

/** A command either advances the game (new snapshot) or is rejected (typed error). */
export type CommandResult =
  | { ok: true; snapshot: RoundSnapshot }
  | { ok: false; error: SessionError };

/** Plain, throw-free, number-based facade over the wasm engine. */
export interface GameSession {
  snapshot(): RoundSnapshot;
  placeBet(kind: BetKind, amountCents: number): CommandResult;
  clearBets(): CommandResult;
  deal(): CommandResult;
  peek(hand: Side, index: number): CommandResult;
  reveal(hand: Side, index: number): CommandResult;
  settle(): CommandResult;
  newShoe(): CommandResult;
  /** Table sessions only: the house dealer's unbet-hand flips. */
  dealerFlipPending?(): boolean;
  dealerNextSide?(): Side | undefined;
  dealerFlipOne?(): CommandResult;
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

/** Table refusals come back as the dealer would say them. */
function tableErrorToSpeech(error: TableError): SessionError {
  if (typeof error === "object" && error !== null && "Command" in error) {
    return error.Command;
  }
  // At a one-seat table "waiting on players" can only mean you haven't bet,
  // so let the dealer's usual no-bets line play.
  if (error === "WaitingOnPlayers") {
    return "NoBetsPlaced";
  }
  if (error === "TableFull") {
    return { Message: "Table's full, friend — try another." };
  }
  if (error === "NoSuchPlayer") {
    return { Message: "You're not seated at this table." };
  }
  if (typeof error === "object" && error !== null && "NotYourSqueeze" in error) {
    return { Message: `The ${error.NotYourSqueeze.side} hand's cards are in the dealer's hands.` };
  }
  return { Message: "Order, order — Player hand first, then Banker." };
}

/**
 * Single player on the SAME table rules as multiplayer, one seat: you
 * squeeze the sides you bet, and the house dealer flips the unbet hands
 * (paced by the store).
 */
export function createTableSession(config: SessionConfig): GameSession {
  const inner = new WasmTable(
    {
      table_min: config.table_min,
      table_max: config.table_max,
      ruleset: config.ruleset,
      max_seats: 1,
    },
    BigInt(config.seed),
    BigInt(config.starting_bankroll),
  );
  const run = (fn: () => RoundSnapshot): CommandResult => {
    try {
      return { ok: true, snapshot: fn() };
    } catch (error) {
      return { ok: false, error: tableErrorToSpeech(error as TableError) };
    }
  };
  return {
    snapshot: () => inner.view(),
    placeBet: (kind, amountCents) => run(() => inner.place_bet(kind, BigInt(amountCents))),
    clearBets: () => run(() => inner.clear_bets()),
    deal: () => run(() => inner.deal()),
    peek: (hand, index) => run(() => inner.peek(hand, index)),
    reveal: (hand, index) => run(() => inner.reveal(hand, index)),
    settle: () => run(() => inner.settle()),
    newShoe: () => run(() => inner.new_shoe()),
    dealerFlipPending: () => inner.dealer_flip_pending(),
    dealerNextSide: () => inner.dealer_next_side(),
    dealerFlipOne: () => run(() => inner.dealer_flip_one()),
  };
}

export function getGlossary(): GlossaryEntry[] {
  return wasmGlossary();
}
