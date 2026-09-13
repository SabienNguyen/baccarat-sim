// Which portal signals one store transition sends: modelled on the audio
// module's `soundsFor`, pure so the mapping is testable, with the one bit of
// state (is gameplay currently "on"?) passed in and returned.
import type { PortalAdapter } from "./types";

export interface PortalView {
  /** The engine's PhaseTag; only "Dealing" matters here. */
  phase: string;
  busted: boolean;
  goalReached: boolean;
}

export type PortalCall = "gameplayStart" | "gameplayStop" | "happyTime";

export function portalSignals(
  prev: PortalView,
  next: PortalView,
  playing: boolean,
): { calls: PortalCall[]; playing: boolean } {
  const calls: PortalCall[] = [];
  const modalOpened = (next.busted && !prev.busted) || (next.goalReached && !prev.goalReached);
  const modalClosed = (prev.busted && !next.busted) || (prev.goalReached && !next.goalReached);
  if (next.goalReached && !prev.goalReached) calls.push("happyTime");
  if (modalOpened) {
    if (playing) calls.push("gameplayStop");
    return { calls, playing: false };
  }
  const modalUp = next.busted || next.goalReached;
  const dealt = next.phase === "Dealing" && prev.phase !== "Dealing";
  if (!playing && !modalUp && (dealt || modalClosed)) {
    calls.push("gameplayStart");
    return { calls, playing: true };
  }
  return { calls, playing };
}

/** A stateful stepper over store transitions that forwards the calls to a portal. */
export function createPortalTracker(
  portal: PortalAdapter,
): (prev: PortalView, next: PortalView) => void {
  let playing = false;
  return (prev, next) => {
    const result = portalSignals(prev, next, playing);
    playing = result.playing;
    for (const call of result.calls) portal[call]();
  };
}
