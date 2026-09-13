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
 * server issued at a shared one (the same lens dealerFlipOffer uses), or
 * null at the rail — a spectator holds nothing. A plain session carries no
 * squeeze info at all and stays interactive.
 */
export function canSqueeze(
  side: Side,
  squeezers: { player: number | null; banker: number | null } | null,
  me: number | null,
): boolean {
  if (squeezers === null) return true; // a plain session has no house dealer
  if (me === null) return false; // watching: the cards are never yours
  return side === "Player" ? squeezers.player === me : squeezers.banker === me;
}
