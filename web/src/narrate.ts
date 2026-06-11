import type {
  RoundSnapshot,
  Event,
  Outcome,
  CommandError,
  HandView,
  Rank,
  BetPayout,
  BetKind,
} from "./engine/types";
import { formatCents } from "./format";
import type { Flip } from "./cards";

const MONKEY_RANKS = ["Ten", "Jack", "Queen", "King"];

/** The face-up rank of a hand's third card, if it has one showing. */
function thirdRank(hand: HandView): Rank | null {
  const c = hand.cards[2];
  return c !== undefined && typeof c === "object" && "FaceUp" in c ? c.FaceUp.rank : null;
}

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
    // the tableau's tightest spot: banker 6 only moves against a 6 or 7
    if (e.ThirdCard.side === "Banker" && on === "6") {
      return [{ text: "Card for the Banker on six — only a six or seven makes him move." }];
    }
    const why = on !== null ? ` — drawing on ${on}, the tableau calls for it.` : ".";
    return [{ text: `Card for the ${e.ThirdCard.side}${why}` }];
  }
  return [];
}

/** The endings worth a second breath: dragons, pandas, frozen bankers. */
function winSpecials(
  snapshot: RoundSnapshot,
  win: { result: Outcome; player: number; banker: number },
): NarrationSegment[] {
  const out: NarrationSegment[] = [];
  const p = snapshot.player;
  const b = snapshot.banker;
  if (win.result === "BankerWin" && b.cards.length === 3 && win.banker === 7) {
    out.push({ text: " " }, { text: "Dragon seven", term: "dragon-7" }, { text: "!" });
  }
  if (win.result === "PlayerWin" && p.cards.length === 3 && win.player === 8) {
    out.push({ text: " " }, { text: "Panda eight", term: "panda-8" }, { text: "!" });
  }
  if (b.cards.length === 2 && win.banker === 3 && thirdRank(p) === "Eight") {
    out.push({ text: " The snowman froze the Banker on three." });
  }
  if (win.result === "Tie" && win.player === 6) {
    out.push({ text: " Six–six — " }, { text: "Tiger", term: "tiger" }, { text: " tie!" });
  }
  const naturals =
    p.cards.length === 2 &&
    b.cards.length === 2 &&
    Math.min(win.player, win.banker) === 8 &&
    Math.max(win.player, win.banker) === 9;
  if (naturals) {
    out.push({ text: " Le grand over le petit — nine beats eight." });
  }
  return out;
}

/** How the dealer announces each winning side bet at the settle. */
const SIDE_CALLS: Record<string, { label: string; odds: string; term: string }> = {
  PlayerPair: { label: "Player pair", odds: "eleven to one", term: "pair" },
  BankerPair: { label: "Banker pair", odds: "eleven to one", term: "pair" },
  Dragon7: { label: "Dragon Seven", odds: "forty to one", term: "dragon-7" },
  Panda8: { label: "Panda Eight", odds: "twenty-five to one", term: "panda-8" },
  DragonBonus: { label: "Dragon Bonus", odds: "paid on the margin", term: "dragon-bonus" },
  Tiger: { label: "Tiger", odds: "the six bites", term: "tiger" },
  BigTiger: { label: "Big Tiger", odds: "fifty to one", term: "big-tiger" },
  SmallTiger: { label: "Small Tiger", odds: "twenty-two to one", term: "small-tiger" },
  TigerTie: { label: "Tiger Tie", odds: "thirty-five to one", term: "tiger-tie" },
  TigerPair: { label: "Tiger Pair", odds: "paid", term: "tiger-pair" },
};

function sideKey(kind: BetKind): string | null {
  if (typeof kind === "object" && "Side" in kind) {
    return typeof kind.Side === "string" ? kind.Side : "DragonBonus";
  }
  return null;
}

/** The dealer points at every bonus that hit. */
function bonusCalls(payouts: BetPayout[] | null): NarrationSegment[] {
  if (!payouts) return [];
  const out: NarrationSegment[] = [];
  for (const p of payouts) {
    if (p.net <= 0) continue;
    const key = sideKey(p.bet.kind);
    const call = key !== null ? SIDE_CALLS[key] : undefined;
    if (!call) continue;
    out.push({ text: " " }, { text: call.label, term: call.term }, { text: ` — ${call.odds}!` });
  }
  return out;
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
export function narrateError(error: CommandError | { Message: string }): NarrationSegment[] {
  if (typeof error === "object" && "Message" in error) {
    return [{ text: error.Message }];
  }
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

/** The dealer calls a card as it turns. */
function flipLine(flip: Flip, snapshot: RoundSnapshot): NarrationSegment[] {
  const name = `${flip.card.rank} of ${flip.card.suit}`;
  const hand = flip.side === "Player" ? snapshot.player : snapshot.banker;
  const third = hand.cards[2];
  const isThird =
    third !== undefined &&
    typeof third === "object" &&
    "FaceUp" in third &&
    third.FaceUp.rank === flip.card.rank &&
    third.FaceUp.suit === flip.card.suit;
  if (isThird && flip.card.rank === "Eight") {
    return [{ text: `${name} to the ${flip.side} — snowman!` }];
  }
  if (MONKEY_RANKS.includes(flip.card.rank)) {
    return [
      { text: `${name} to the ${flip.side} — ` },
      { text: "monkey", term: "monkey" },
      { text: "!" },
    ];
  }
  if (flip.card.rank === "Ace") {
    return [{ text: `${name} to the ${flip.side} — counts one.` }];
  }
  return [{ text: `${name} to the ${flip.side}.` }];
}

/** Turn the current snapshot into an ordered dealer line. Pure. */
export function narrate(snapshot: RoundSnapshot, lastFlip: Flip | null = null): NarrationSegment[] {
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
    return [
      ...winLine(win.Win, natural, ""),
      ...winSpecials(snapshot, win.Win),
      ...bonusCalls(snapshot.payouts),
      ...(paidFlavor ? [{ text: paidFlavor }] : []),
    ];
  }

  // a natural ends the announcements; otherwise call the freshest card
  const naturalNow = snapshot.events.find((e) => "Natural" in e);
  if (lastFlip && snapshot.phase === "Dealing" && !naturalNow) {
    return flipLine(lastFlip, snapshot);
  }

  const salient = pickSalient(snapshot.events);
  if (salient) return eventLine(salient);

  if (snapshot.phase === "Settled") {
    return [{ text: "Hand's settled — chips down for the next one." }];
  }
  if (anyCardShowing(snapshot)) {
    return [{ text: "Take your time — bend that corner." }];
  }
  return [{ text: "No more bets. Cards are out — squeeze 'em." }];
}
