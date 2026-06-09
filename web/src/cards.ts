import type { CardView } from "./engine/types";

/** True only when a card is fully revealed (face-up). */
export function isFaceUp(card: CardView): boolean {
  return card !== "FaceDown" && typeof card === "object" && "FaceUp" in card;
}

/** Indices of cards in a hand that are not yet fully face-up (face-down or peeked). */
export function hiddenIndices(cards: CardView[]): number[] {
  const out: number[] = [];
  cards.forEach((card, i) => {
    if (!isFaceUp(card)) out.push(i);
  });
  return out;
}
