import type { RoundSnapshot, Event, Outcome, CommandError } from "./engine/types";
import { formatCents } from "./format";

/** A piece of the dealer line; `term` marks a glossary slug for interactivity. */
export type NarrationSegment = { text: string; term?: string };

const SALIENCE: Record<string, number> = { Natural: 4, Pair: 3, ThirdCard: 2, Monkey: 1 };

function winLine(
  win: { result: Outcome; player: number; banker: number },
  natural: { side: string; total: number } | null,
  paidFlavor: string,
): NarrationSegment[] {
  const prefix: NarrationSegment[] = natural ? [{ text: `Natural ${natural.total}! ` }] : [];
  if (win.result === "PlayerWin") {
    return [
      ...prefix,
      { text: "Player", term: "player" },
      { text: ` wins it, ${win.player} over ${win.banker}!${paidFlavor}` },
    ];
  }
  if (win.result === "BankerWin") {
    return [
      ...prefix,
      { text: "Banker", term: "banker" },
      { text: ` wins, ${win.banker} over ${win.player}.${paidFlavor}` },
    ];
  }
  return [
    ...prefix,
    { text: "Égalité — " },
    { text: "tie", term: "tie" },
    { text: ` at ${win.player}. Main bets push.${paidFlavor}` },
  ];
}

/** Pull the pre-draw total out of the engine's trace-style reason, if it parses. */
function drawnOn(reason: string): string | null {
  const m = reason.match(/(?:Player|Banker) (\d+)/);
  return m ? m[1] : null;
}

function eventLine(e: Event): NarrationSegment[] {
  if ("Natural" in e) {
    return [
      { text: "Natural", term: "natural" },
      { text: ` ${e.Natural.total} — ${e.Natural.side}! Both hands stand.` },
    ];
  }
  if ("Pair" in e) {
    return [
      { text: `${e.Pair.side} ` },
      { text: "pair", term: "pair" },
      { text: "! Eleven to one if you had it." },
    ];
  }
  if ("Monkey" in e) {
    return [
      { text: "Monkey", term: "monkey" },
      { text: ` for the ${e.Monkey.hand}! Counts for nothing.` },
    ];
  }
  if ("ThirdCard" in e) {
    const on = drawnOn(e.ThirdCard.reason);
    const why = on !== null ? ` — drawing on ${on}, the tableau calls for it.` : ".";
    return [{ text: `Card for the ${e.ThirdCard.side}${why}` }];
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

function anyCardShowing(snapshot: RoundSnapshot): boolean {
  return [...snapshot.player.cards, ...snapshot.banker.cards].some((c) => c !== "FaceDown");
}

/** What the dealer says when a command is refused — house rules, kindly. */
export function narrateError(error: CommandError): NarrationSegment[] {
  if (error === "NoBetsPlaced") {
    return [{ text: "Chips down first — then we deal." }];
  }
  if ("BetAboveMaximum" in error) {
    return [
      { text: `Too rich for this table — the max is ${formatCents(error.BetAboveMaximum.max)}.` },
    ];
  }
  if ("BetBelowMinimum" in error) {
    return [
      { text: `That's shy of the minimum — ${formatCents(error.BetBelowMinimum.min)} to play.` },
    ];
  }
  if ("InsufficientBankroll" in error) {
    return [{ text: "Your rack can't cover that one." }];
  }
  if ("WrongPhase" in error) {
    return [{ text: "Not just now — let's finish this hand." }];
  }
  return [{ text: "Can't do that, friend." }];
}

/** Turn the current snapshot into an ordered dealer line. Pure. */
export function narrate(snapshot: RoundSnapshot): NarrationSegment[] {
  if (snapshot.phase === "Betting") {
    if (snapshot.bankroll < snapshot.table_min) {
      return [{ text: "The cage thanks you for playing — reset the bank to buy back in." }];
    }
    const staked = snapshot.bets.reduce((sum, b) => sum + b.amount, 0);
    if (staked > 0) {
      return [
        { text: `Bets down — ${formatCents(staked)} riding. Call the deal when you're ready.` },
      ];
    }
    return [{ text: "Place your bets." }];
  }

  const win = snapshot.events.find((e): e is Extract<Event, { Win: unknown }> => "Win" in e);
  if (win) {
    const naturalEvent = snapshot.events.find(
      (e): e is Extract<Event, { Natural: unknown }> => "Natural" in e,
    );
    const natural = naturalEvent
      ? { side: naturalEvent.Natural.side, total: naturalEvent.Natural.total }
      : null;
    let paidFlavor = "";
    if (snapshot.phase === "Settled" && snapshot.payouts) {
      const net = snapshot.payouts.reduce((sum, p) => sum + p.net, 0);
      if (net > 0) paidFlavor = " You're paid.";
      else if (net < 0) paidFlavor = " The house thanks you.";
      else if (snapshot.payouts.length > 0) paidFlavor = " Bets back.";
    }
    return winLine(win.Win, natural, paidFlavor);
  }

  const salient = pickSalient(snapshot.events);
  if (salient) return eventLine(salient);

  if (anyCardShowing(snapshot)) {
    return [{ text: "Take your time — bend that corner." }];
  }
  return [{ text: "No more bets. Cards are out — squeeze 'em." }];
}
