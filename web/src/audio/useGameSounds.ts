import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { GameState } from "../store/gameStore";
import { playSfx, startAmbience, stopAmbience, type SfxName } from "./sfx";

function stagedCount(s: GameState): number {
  return s.stagedChips.reduce((n, chips) => n + chips.length, 0);
}

function peekedCount(s: GameState): number {
  const cards = [...s.snapshot.player.cards, ...s.snapshot.banker.cards];
  return cards.filter((c) => typeof c === "object" && "Peeked" in c).length;
}

/** The sounds one store transition makes. Pure, so the mapping is testable. */
export function soundsFor(prev: GameState, next: GameState): SfxName[] {
  const out: SfxName[] = [];
  if (next.hand.length > prev.hand.length) out.push("chipPick");
  if (stagedCount(next) > stagedCount(prev)) out.push("chipPlace");
  // chips sliding home: hand returned to the rack, or bets cleared off the
  // felt — but the dealer's settle sweep is not a return (settleSeq guard)
  const handReturned =
    next.hand.length < prev.hand.length && stagedCount(next) <= stagedCount(prev);
  const feltCleared = stagedCount(next) < stagedCount(prev);
  if ((handReturned || feltCleared) && next.settleSeq === prev.settleSeq)
    out.push("chipReturn");
  if (prev.snapshot.phase === "Betting" && next.snapshot.phase === "Dealing") out.push("deal");
  if (peekedCount(next) > peekedCount(prev)) out.push("squeeze");
  if (next.lastFlip !== null && next.lastFlip !== prev.lastFlip) out.push("flip");
  if (next.settleSeq > prev.settleSeq) {
    // the big moments own the settle: no win-jingle under the bust dirge
    if (next.busted && !prev.busted) out.push("bust");
    else if (next.goalReached && !prev.goalReached) out.push("victory");
    else {
      const delta = next.lastDelta ?? 0;
      out.push(delta > 0 ? "win" : delta < 0 ? "lose" : "push");
    }
  }
  if (next.lastError !== null && next.lastError !== prev.lastError) out.push("error");
  return out;
}

/** Subscribe a table store to the speaker, and run the casino-floor bed
 *  (murmur + lounge loop) for as long as the table is mounted. */
export function useGameSounds(
  store: StoreApi<GameState>,
  play: (name: SfxName) => void = playSfx,
): void {
  useEffect(() => {
    startAmbience();
    const unsubscribe = store.subscribe((state, prev) => {
      for (const name of soundsFor(prev, state)) play(name);
    });
    return () => {
      unsubscribe();
      stopAmbience();
    };
  }, [store, play]);
}
