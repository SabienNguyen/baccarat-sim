import type { SessionConfig } from "./engine/types";

/** The three house tables. All money in cents. */
export type TableTier = "low" | "mid" | "high";

export interface TableSpec {
  tier: TableTier;
  label: string;
  blurb: string;
  starting_bankroll: number;
  table_min: number;
  table_max: number;
  /** The chips this table stocks (cents), smallest no bigger than the min bet. */
  denoms: number[];
  /** Beat the table by running the buy-in up to this (cents). */
  goal: number;
  /** A learner's table: opens with the Explain panel already teaching. */
  coach?: boolean;
}

export const TABLES: TableSpec[] = [
  {
    tier: "low",
    label: "Low Stakes",
    blurb: "Learn the ropes",
    starting_bankroll: 50_000, // $500
    table_min: 100, // $1
    table_max: 50_000, // $500
    denoms: [100, 500, 2500, 10000, 50000], // $1 ... $500
    goal: 500_000, // $5,000 — 10x the buy-in
    coach: true, // the learner's table: Explain mode opens on
  },
  {
    tier: "mid",
    label: "Mid Roller",
    blurb: "The main floor",
    starting_bankroll: 1_000_000, // $10,000
    table_min: 2_500, // $25
    table_max: 500_000, // $5,000
    denoms: [500, 2500, 10000, 50000, 100000, 500000], // $5 ... $5,000
    goal: 10_000_000, // $100,000
  },
  {
    tier: "high",
    label: "High Roller",
    blurb: "The private salon",
    starting_bankroll: 25_000_000, // $250,000
    table_min: 50_000, // $500
    // the salon posts a limit bigger than the buy-in — earn your way up to it
    table_max: 50_000_000, // $500,000 per spot, per hand
    denoms: [10000, 50000, 100000, 500000, 2500000, 10000000], // $100 ... $100,000
    goal: 250_000_000, // $2,500,000
  },
];

/**
 * The chip to arm when a player first sits down: the smallest denomination
 * that clears the table minimum. Every rack deliberately stocks a top-up chip
 * *below* the minimum (Mid: $5 on a $25 table, High: $100 on a $500 table) so
 * a bet can be nudged up in small steps — but the engine refuses any single
 * bet under `table_min`, so arming that top-up chip by default makes the very
 * first tap on the felt a refusal (F18). Falls back to the smallest chip when
 * nothing in the rack clears the minimum. Independent of `denoms` ordering.
 */
export function defaultChip(denoms: number[], tableMin: number): number {
  const playable = denoms.filter((d) => d >= tableMin);
  return Math.min(...(playable.length ? playable : denoms));
}

export function tableSpec(tier: TableTier): TableSpec {
  const spec = TABLES.find((t) => t.tier === tier);
  if (!spec) throw new Error(`unknown table tier: ${tier}`);
  return spec;
}

/** 52 bits of OS entropy for the shoe — Math.random is not a casino shuffle. */
export function strongSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return buf[0] * 0x100000 + (buf[1] >>> 12); // 32 + 20 bits, < 2^53
  }
  return Math.floor(Math.random() * 0xffffffff);
}

/** Session config for a tier, optionally resuming a saved bankroll. */
export function configFor(tier: TableTier, savedBankroll: number | null): SessionConfig {
  const spec = tableSpec(tier);
  return {
    starting_bankroll: savedBankroll ?? spec.starting_bankroll,
    table_min: spec.table_min,
    table_max: spec.table_max,
    ruleset: "Commission",
    seed: strongSeed(),
  };
}
