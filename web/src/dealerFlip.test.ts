import { dealerFlipOffer } from "./dealerFlip";
import { bettingSnapshot } from "./test/fixtures";
import type { CardView, RoundSnapshot } from "./engine/types";

const DOWN: CardView = "FaceDown";
const UP: CardView = { FaceUp: { rank: "Seven", suit: "Clubs" } };
const PEEKED: CardView = { Peeked: { sliver: { rank: "Seven", suit: "Clubs" } } };

function dealing(player: CardView[], banker: CardView[]): RoundSnapshot {
  return bettingSnapshot({
    phase: "Dealing",
    player: { cards: player, total: null },
    banker: { cards: banker, total: null },
  });
}

const iHoldPlayer = { player: 0, banker: null };

test("offered while I squeeze Player and the house holds Banker face down", () => {
  expect(dealerFlipOffer(dealing([DOWN, DOWN], [DOWN, DOWN]), iHoldPlayer, 0)).toEqual({
    side: "Banker",
    remaining: 2,
  });
});

test("still offered mid-squeeze: one of mine up, one peeked", () => {
  expect(dealerFlipOffer(dealing([UP, PEEKED], [DOWN, DOWN]), iHoldPlayer, 0)).toEqual({
    side: "Banker",
    remaining: 2,
  });
});

test("after one flip, one card remains to ask for", () => {
  expect(dealerFlipOffer(dealing([DOWN, DOWN], [UP, DOWN]), iHoldPlayer, 0)).toEqual({
    side: "Banker",
    remaining: 1,
  });
});

test("gone once both house cards are up", () => {
  expect(dealerFlipOffer(dealing([DOWN, DOWN], [UP, UP]), iHoldPlayer, 0)).toBeNull();
});

test("gone once my own hand is fully up — the dealer turns his anyway", () => {
  expect(dealerFlipOffer(dealing([UP, UP], [DOWN, DOWN]), iHoldPlayer, 0)).toBeNull();
});

test("a third house card is not part of the ask", () => {
  expect(dealerFlipOffer(dealing([DOWN, DOWN], [UP, UP, DOWN]), iHoldPlayer, 0)).toBeNull();
});

test("not offered before the deal or after settle", () => {
  expect(dealerFlipOffer(bettingSnapshot(), iHoldPlayer, 0)).toBeNull();
  expect(
    dealerFlipOffer(bettingSnapshot({ phase: "Settled" }), iHoldPlayer, 0),
  ).toBeNull();
});

test("not offered to a Banker squeezer: the pacer already turns the Player hand", () => {
  expect(dealerFlipOffer(dealing([DOWN, DOWN], [DOWN, DOWN]), { player: null, banker: 0 }, 0)).toBeNull();
});

test("not offered when I hold both hands, neither, or a plain session has no rights", () => {
  const snap = dealing([DOWN, DOWN], [DOWN, DOWN]);
  expect(dealerFlipOffer(snap, { player: 0, banker: 0 }, 0)).toBeNull();
  expect(dealerFlipOffer(snap, { player: null, banker: null }, 0)).toBeNull();
  expect(dealerFlipOffer(snap, null, 0)).toBeNull();
});

test("not offered when another seat holds the other hand (multiplayer)", () => {
  const snap = dealing([DOWN, DOWN], [DOWN, DOWN]);
  expect(dealerFlipOffer(snap, { player: 3, banker: 5 }, 3)).toBeNull();
  // and only to the seat that actually holds the squeeze
  expect(dealerFlipOffer(snap, { player: 3, banker: null }, 5)).toBeNull();
  expect(dealerFlipOffer(snap, { player: 3, banker: null }, 3)).toEqual({ side: "Banker", remaining: 2 });
});

test("never offered at the rail — a spectator holds no hand to be squeezing", () => {
  expect(dealerFlipOffer(dealing([DOWN, DOWN], [DOWN, DOWN]), iHoldPlayer, null)).toBeNull();
});
