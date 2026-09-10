import type { Side } from "./engine/types";

/**
 * Whether the local player may squeeze (peek/reveal) a given hand.
 *
 * A hand belongs to the seat that holds its squeeze — the biggest bettor on
 * that side — and to nobody else. A `null` squeezer is the house dealer's
 * hand: his pacer turns it, so it must NOT be grabbable, or the player races
 * the pacer on cards that aren't theirs. Anyone else's hand gets a plain,
 * non-interactive face-down card; the server would refuse the touch anyway,
 * but offering a gesture that can only be scolded is worse than none.
 *
 * `me` is this client's seat id: 0 at a single-player table, the id the
 * server issued at a shared one (the same lens dealerFlipOffer uses). A plain
 * session carries no squeeze info at all and stays interactive.
 */
export function canSqueeze(
  side: Side,
  squeezers: { player: number | null; banker: number | null } | null,
  me: number,
): boolean {
  if (squeezers === null) return true; // a plain session has no house dealer
  return side === "Player" ? squeezers.player === me : squeezers.banker === me;
}
