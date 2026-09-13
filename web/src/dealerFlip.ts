import type { RoundSnapshot, Side } from "./engine/types";
import { isFaceUp } from "./cards";

/** What the squeezer may still ask the dealer for. */
export interface DealerFlipOffer {
  /** The house-held hand the dealer would turn. */
  side: Side;
  /** Face-down initial cards left in that hand (1 or 2). */
  remaining: number;
}

/**
 * The high-limit courtesy: while you are still squeezing your own hand you
 * may ask the dealer to turn one or both of the house hand's first two cards
 * early. This mirrors the engine's gate (Table::request_dealer_flip) so the
 * controls show only when the ask would be accepted:
 *
 * - a coup is being dealt and squeeze rights are known (a table session);
 * - `me` holds exactly one hand and the house holds the other;
 * - my hand is not yet fully up (once it is, the dealer turns his as a
 *   matter of course, and there is nothing to hurry along);
 * - the house hand comes AFTER mine in ritual order — the Player hand is
 *   turned first, so a house-held Player hand is already being turned by the
 *   dealer's pacer before I ever get to squeeze Banker;
 * - the house hand still has an initial card face down.
 *
 * Third cards are never part of the ask; they follow the ritual as usual.
 */
export function dealerFlipOffer(
  snapshot: RoundSnapshot,
  squeezers: { player: number | null; banker: number | null } | null,
  me: number | null,
): DealerFlipOffer | null {
  if (snapshot.phase !== "Dealing" || squeezers === null || me === null) return null;
  const mine = squeezers.player === me && squeezers.banker !== me ? "Player" : null;
  if (mine === null) return null; // Banker-only squeezers wait on the pacer; both/none: no house hand
  if (squeezers.banker !== null) return null; // another seat holds it — ask them, not the dealer
  const player = snapshot.player.cards;
  if (player.length < 2) return null;
  if (isFaceUp(player[0]) && isFaceUp(player[1])) return null; // my hand is up: the dealer is turning
  const house = snapshot.banker.cards.slice(0, 2);
  const remaining = house.filter((c) => !isFaceUp(c)).length;
  if (remaining === 0) return null;
  return { side: "Banker", remaining };
}
