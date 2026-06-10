import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { GameState } from "../store/gameStore";
import { playSfx, type SfxName } from "./sfx";

function stagedCount(s: GameState): number {
  return s.stagedChips.reduce((n, chips) => n + chips.length, 0);
}

/** The sounds one store transition makes. Pure, so the mapping is testable. */
export function soundsFor(prev: GameState, next: GameState): SfxName[] {
  const out: SfxName[] = [];
  if (next.hand.length > prev.hand.length) out.push("chipPick");
  if (stagedCount(next) > stagedCount(prev)) out.push("chipPlace");
  if (prev.snapshot.phase === "Betting" && next.snapshot.phase === "Dealing") out.push("deal");
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
  return out;
}

/** Subscribe a table store to the speaker. Works for local and remote play. */
export function useGameSounds(
  store: StoreApi<GameState>,
  play: (name: SfxName) => void = playSfx,
): void {
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        for (const name of soundsFor(prev, state)) play(name);
      }),
    [store, play],
  );
}
