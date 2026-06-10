import type { CardView, Side } from "./engine/types";
import { isFaceUp } from "./cards";

/**
 * How many of a hand's cards should currently be shown on the table.
 *
 * A coup deals up to three cards per hand, but a real squeeze brings the third
 * card out only in dealing order: after the four initial cards (Player 1-2,
 * Banker 1-2) are face up, the Player's third appears, then the Banker's third.
 * Rendering every dealt card at once would leak whether a hand drew a third —
 * and therefore whether a natural occurred — before the player has squeezed
 * anything. This returns the prefix length to render so the count never runs
 * ahead of the ritual. (The engine still holds all the cards; this only gates
 * when each one is displayed.)
 */
export function visibleCardCount(
  side: Side,
  player: CardView[],
  banker: CardView[],
): number {
  const cards = side === "Player" ? player : banker;
  // Hands without a third card (naturals / stands) never hide anything.
  if (cards.length <= 2) return cards.length;

  const initialFourUp =
    isFaceUp(player[0]) &&
    isFaceUp(player[1]) &&
    isFaceUp(banker[0]) &&
    isFaceUp(banker[1]);
  if (!initialFourUp) return 2;

  // The Player's third card leads; the Banker's third waits for it.
  if (side === "Player") return 3;

  const playerDrewThird = player.length > 2;
  if (playerDrewThird && !isFaceUp(player[2])) return 2;
  return 3;
}
