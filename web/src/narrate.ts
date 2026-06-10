import type { RoundSnapshot, Event, Outcome } from "./engine/types";

/** A piece of the dealer line; `term` marks a glossary slug for interactivity. */
export type NarrationSegment = { text: string; term?: string };

const SALIENCE: Record<string, number> = { Natural: 4, Pair: 3, ThirdCard: 2, Monkey: 1 };

function winLine(win: { result: Outcome; player: number; banker: number }): NarrationSegment[] {
  if (win.result === "PlayerWin") {
    return [{ text: "Player", term: "player" }, { text: ` wins, ${win.player} over ${win.banker}.` }];
  }
  if (win.result === "BankerWin") {
    return [{ text: "Banker", term: "banker" }, { text: ` wins, ${win.banker} over ${win.player}.` }];
  }
  return [{ text: "Tie", term: "tie" }, { text: " — bets push." }];
}

function eventLine(e: Event): NarrationSegment[] {
  if ("Natural" in e) {
    return [{ text: "Natural", term: "natural" }, { text: ` ${e.Natural.total} — ${e.Natural.side}!` }];
  }
  if ("Pair" in e) {
    return [{ text: `${e.Pair.side} ` }, { text: "pair", term: "pair" }, { text: "!" }];
  }
  if ("Monkey" in e) {
    return [{ text: "Monkey", term: "monkey" }, { text: ` for the ${e.Monkey.hand}!` }];
  }
  // ThirdCard — no glossary slug exists for it.
  if ("ThirdCard" in e) {
    return [{ text: `Third card for the ${e.ThirdCard.side}.` }];
  }
  return [];
}

/** Most salient non-win event; ties resolve to the newest (later in the list). */
function pickSalient(events: Event[]): Event | undefined {
  let best: Event | undefined;
  let bestRank = 0;
  for (const e of events) {
    const key = Object.keys(e)[0];
    if (key === "Win") continue;
    const rank = SALIENCE[key] ?? 0;
    if (rank >= bestRank) {
      bestRank = rank;
      best = e;
    }
  }
  return best;
}

/** Turn the current snapshot into an ordered dealer line. Pure. */
export function narrate(snapshot: RoundSnapshot): NarrationSegment[] {
  if (snapshot.phase === "Betting") return [{ text: "Place your bets." }];

  const win = snapshot.events.find((e): e is Extract<Event, { Win: unknown }> => "Win" in e);
  if (win) return winLine(win.Win);

  const salient = pickSalient(snapshot.events);
  if (!salient) return [{ text: "Cards out — squeeze 'em." }];
  return eventLine(salient);
}
