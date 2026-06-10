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
  },
  {
    tier: "mid",
    label: "Mid Roller",
    blurb: "The main floor",
    starting_bankroll: 1_000_000, // $10,000
    table_min: 2_500, // $25
    table_max: 500_000, // $5,000
    denoms: [500, 2500, 10000, 50000, 100000, 500000], // $5 ... $5,000
  },
  {
    tier: "high",
    label: "High Roller",
    blurb: "The private salon",
    starting_bankroll: 25_000_000, // $250,000
    table_min: 50_000, // $500
    table_max: 10_000_000, // $100,000
    denoms: [10000, 50000, 100000, 500000, 2500000], // $100 ... $25,000
  },
];

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
