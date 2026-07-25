// One place that turns a `BetKind` into a stable key and a human label.
//
// Three call sites used to each carry their own copy of the key logic (the HUD
// payout ledger, the dealer narration, the settle explanations), and each
// collapsed the two-sided Dragon Bonus to a single "DragonBonus" — fine while
// only the Player side was on the felt, wrong the moment both are, because the
// ledger then shows two identical rows for two different bets.

import type { BetKind } from "./engine/types";

/**
 * A stable string key for a side bet: "PlayerPair", "Dragon7", … and
 * "DragonBonusPlayer" / "DragonBonusBanker" for the two-sided one. Returns null
 * for main bets.
 */
export function sideKey(kind: BetKind): string | null {
  if (typeof kind === "object" && "Side" in kind) {
    return typeof kind.Side === "string" ? kind.Side : `DragonBonus${kind.Side.DragonBonus}`;
  }
  return null;
}

/** Human labels for every side bet the engine settles, keyed by `sideKey`. */
const SIDE_LABELS: Record<string, string> = {
  PlayerPair: "Player Pair",
  BankerPair: "Banker Pair",
  Dragon7: "Dragon 7",
  Panda8: "Panda 8",
  DragonBonusPlayer: "Player Dragon Bonus",
  DragonBonusBanker: "Banker Dragon Bonus",
  Tiger: "Tiger",
  BigTiger: "Big Tiger",
  SmallTiger: "Small Tiger",
  TigerTie: "Tiger Tie",
  TigerPair: "Tiger Pair",
};

/**
 * A short label fit to show a player, for any bet. Main bets are already
 * readable ("Player"); side bets get spaced-out names instead of the wire
 * format's "PlayerPair"/"Panda8". Unknown keys fall back to the key itself
 * rather than throwing — a new engine side bet shows up ugly, not broken.
 */
export function betLabel(kind: BetKind): string {
  if (typeof kind === "object" && "Main" in kind) return kind.Main;
  const key = sideKey(kind);
  if (key === null) return String(kind);
  return SIDE_LABELS[key] ?? key;
}
