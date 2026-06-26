import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { GameState } from "../store/gameStore";
import { playSfx, startAmbience, stopAmbience, type SfxName } from "./sfx";

function stakedTotal(s: GameState): number {
  return s.snapshot.bets.reduce((n, b) => n + b.amount, 0);
}

function peekedCount(s: GameState): number {
  const cards = [...s.snapshot.player.cards, ...s.snapshot.banker.cards];
  return cards.filter((c) => typeof c === "object" && "Peeked" in c).length;
}

/** The sounds one store transition makes. Pure, so the mapping is testable. */
export function soundsFor(prev: GameState, next: GameState): SfxName[] {
  const out: SfxName[] = [];
  // arming a different chip clicks; staking it on a spot drops it on the felt
  if (next.selectedChip !== prev.selectedChip) out.push("chipPick");
  if (stakedTotal(next) > stakedTotal(prev)) out.push("chipPlace");
  // bets pulled off the felt clatter back — but only a player clear (still in
  // Betting), never the dealer's settle sweep into a resolved hand
  if (
    stakedTotal(next) < stakedTotal(prev) &&
    next.settleSeq === prev.settleSeq &&
    next.snapshot.phase === "Betting"
  )
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
