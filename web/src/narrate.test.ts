import { narrate, narrateError } from "./narrate";
import type { RoundSnapshot, Event } from "./engine/types";

function snap(phase: RoundSnapshot["phase"], events: Event[] = []): RoundSnapshot {
  return {
    phase,
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 1_000_000,
    table_min: 500,
    table_max: 5_000_000,
    outcome: null,
    payouts: null,
    events,
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
  };
}

function text(segs: ReturnType<typeof narrate>): string {
  return segs.map((s) => s.text).join("");
}

test("betting phase invites bets", () => {
  expect(narrate(snap("Betting"))).toEqual([{ text: "Place your bets." }]);
});

test("betting with chips down announces what's riding", () => {
  const s = { ...snap("Betting"), bets: [{ kind: { Main: "Player" } as const, amount: 12500 }] };
  expect(text(narrate(s))).toBe(
    "Bets down — $125.00 riding. Call the deal when you're ready.",
  );
});

test("a felted player is sent to the cage", () => {
  const s = { ...snap("Betting"), bankroll: 100, table_min: 500 };
  expect(text(narrate(s))).toContain("reset the bank");
});

test("dealing with nothing showing calls no more bets", () => {
  expect(text(narrate(snap("Dealing")))).toBe("No more bets. Cards are out — squeeze 'em.");
});

test("dealing mid-squeeze encourages the bend", () => {
  const s = snap("Dealing");
  s.player.cards = [{ FaceUp: { rank: "Nine", suit: "Hearts" } }, "FaceDown"];
  s.banker.cards = ["FaceDown", "FaceDown"];
  expect(text(narrate(s))).toBe("Take your time — bend that corner.");
});

test("a monkey is called out with a glossary term", () => {
  const segs = narrate(snap("Dealing", [{ Monkey: { hand: "Player", index: 0 } }]));
  expect(segs[0]).toEqual({ text: "Monkey", term: "monkey" });
  expect(text(segs)).toBe("Monkey for the Player! Counts for nothing.");
});

test("a natural is announced with its total", () => {
  const segs = narrate(snap("Dealing", [{ Natural: { side: "Banker", total: 9 } }]));
  expect(segs[0]).toEqual({ text: "Natural", term: "natural" });
  expect(text(segs)).toBe("Natural 9 — Banker! Both hands stand.");
});

test("a pair teaches its payout", () => {
  const segs = narrate(snap("Dealing", [{ Pair: { side: "Player" } }]));
  expect(segs[1]).toEqual({ text: "pair", term: "pair" });
  expect(text(segs)).toBe("Player pair! Eleven to one if you had it.");
});

test("a third card narrates the tableau reason", () => {
  const segs = narrate(
    snap("Dealing", [
      { ThirdCard: { side: "Player", reason: "Player 4 -> draws a third card (7)." } },
    ]),
  );
  expect(text(segs)).toBe("Card for the Player — drawing on 4, the tableau calls for it.");
});

test("an unparseable third-card reason still narrates", () => {
  const segs = narrate(
    snap("Dealing", [{ ThirdCard: { side: "Banker", reason: "house ruling" } }]),
  );
  expect(text(segs)).toBe("Card for the Banker.");
});

test("the win line is decisive and beats earlier events", () => {
  const segs = narrate(
    snap("Dealing", [
      { Monkey: { hand: "Player", index: 0 } },
      { Win: { result: "BankerWin", player: 5, banker: 7 } },
    ]),
  );
  expect(segs[0]).toEqual({ text: "Banker", term: "banker" });
  expect(text(segs)).toBe("Banker wins, 7 over 5.");
});

test("a natural win gets the natural call as a prefix", () => {
  const segs = narrate(
    snap("Dealing", [
      { Natural: { side: "Player", total: 9 } },
      { Win: { result: "PlayerWin", player: 9, banker: 4 } },
    ]),
  );
  expect(text(segs)).toBe("Natural 9! Player wins it, 9 over 4!");
});

test("a tie calls égalité", () => {
  const segs = narrate(snap("Dealing", [{ Win: { result: "Tie", player: 5, banker: 5 } }]));
  expect(text(segs)).toBe("Égalité — tie at 5. Main bets push.");
});

test("a settled winning round pays the player", () => {
  const s = snap("Settled", [{ Win: { result: "PlayerWin", player: 8, banker: 3 } }]);
  s.payouts = [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: 2500 }];
  expect(text(narrate(s))).toBe("Player wins it, 8 over 3! You're paid.");
});

test("a settled losing round thanks you for the donation", () => {
  const s = snap("Settled", [{ Win: { result: "BankerWin", player: 3, banker: 8 } }]);
  s.payouts = [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: -2500 }];
  expect(text(narrate(s))).toBe("Banker wins, 8 over 3. The house thanks you.");
});

test("natural outranks a co-occurring monkey", () => {
  const segs = narrate(
    snap("Dealing", [
      { Monkey: { hand: "Player", index: 0 } },
      { Natural: { side: "Player", total: 8 } },
    ]),
  );
  expect(segs[0]).toEqual({ text: "Natural", term: "natural" });
});

test("the dealer refuses oversized and undersized bets in plain speech", () => {
  expect(text(narrateError({ BetAboveMaximum: { max: 500_000, got: 600_000 } }))).toBe(
    "Too rich for this table — the max is $5,000.00.",
  );
  expect(text(narrateError({ BetBelowMinimum: { min: 2500, got: 500 } }))).toBe(
    "That's shy of the minimum — $25.00 to play.",
  );
  expect(text(narrateError("NoBetsPlaced"))).toBe(
    "Chips down first — then we deal.",
  );
});

test("the dealer calls each card as it turns", () => {
  const flip = { side: "Player" as const, card: { rank: "Nine" as const, suit: "Hearts" as const } };
  expect(text(narrate(snap("Dealing"), flip))).toBe("Nine of Hearts to the Player.");
});

test("a monkey gets named in the call", () => {
  const flip = { side: "Banker" as const, card: { rank: "King" as const, suit: "Spades" as const } };
  const segs = narrate(snap("Dealing"), flip);
  expect(text(segs)).toBe("King of Spades to the Banker — monkey!");
  expect(segs[1]).toEqual({ text: "monkey", term: "monkey" });
});

test("a natural outranks the card call", () => {
  const flip = { side: "Player" as const, card: { rank: "Nine" as const, suit: "Hearts" as const } };
  const segs = narrate(snap("Dealing", [{ Natural: { side: "Player", total: 9 } }]), flip);
  expect(text(segs)).toBe("Natural 9 — Player! Both hands stand.");
});

test("the win line outranks the card call", () => {
  const flip = { side: "Banker" as const, card: { rank: "Two" as const, suit: "Clubs" as const } };
  const segs = narrate(
    snap("Dealing", [{ Win: { result: "BankerWin", player: 5, banker: 7 } }]),
    flip,
  );
  expect(text(segs)).toBe("Banker wins, 7 over 5.");
});

test("a settled table with no events talks about the next hand, not the squeeze", () => {
  // the multiplayer settled view: empty hands, no events, payouts retained
  const s = { ...snap("Settled"), payouts: [] };
  expect(text(narrate(s))).toBe("Hand's settled — chips down for the next one.");
});

// --- the little moments: snowmen, frozen bankers, dragons, pandas, tigers ---

import type { CardView, Rank } from "./engine/types";

const fu = (rank: Rank, suit = "Clubs" as const): CardView => ({ FaceUp: { rank, suit } });

function handsSnap(
  phase: RoundSnapshot["phase"],
  events: Event[],
  player: CardView[],
  banker: CardView[],
): RoundSnapshot {
  return { ...snap(phase, events), player: { cards: player, total: null }, banker: { cards: banker, total: null } };
}

test("a third-card eight is a snowman", () => {
  const s = handsSnap("Dealing", [], [fu("Five"), fu("Five"), fu("Eight")], []);
  const line = text(narrate(s, { side: "Player", card: { rank: "Eight", suit: "Clubs" } }));
  expect(line).toMatch(/snowman/i);
});

test("an eight in the first two cards is no snowman", () => {
  const s = handsSnap("Dealing", [], [fu("Eight"), fu("Five")], []);
  const line = text(narrate(s, { side: "Player", card: { rank: "Eight", suit: "Clubs" } }));
  expect(line).not.toMatch(/snowman/i);
});

test("an ace gets its one-counts call", () => {
  const s = handsSnap("Dealing", [], [fu("Ace"), fu("Five")], []);
  const line = text(narrate(s, { side: "Player", card: { rank: "Ace", suit: "Clubs" } }));
  expect(line).toMatch(/counts one/i);
});

test("the banker drawing on six gets the only-six-or-seven call", () => {
  const e: Event = {
    ThirdCard: { side: "Banker", reason: "Banker 6 -> draws a third card (7) per tableau." },
  };
  const line = text(narrate(snap("Dealing", [e])));
  expect(line).toMatch(/six or seven/i);
});

test("the snowman freezing the banker on three gets called", () => {
  const win: Event = { Win: { result: "PlayerWin", player: 8, banker: 3 } };
  const s = handsSnap(
    "Dealing",
    [win],
    [fu("Five"), fu("Five"), fu("Eight")],
    [fu("Ace"), fu("Two")],
  );
  expect(text(narrate(s))).toMatch(/froze|frozen/i);
});

test("a three-card banker seven win is a dragon seven", () => {
  const win: Event = { Win: { result: "BankerWin", player: 5, banker: 7 } };
  const s = handsSnap(
    "Dealing",
    [win],
    [fu("Two"), fu("Three")],
    [fu("Two"), fu("Two"), fu("Three")],
  );
  expect(text(narrate(s))).toMatch(/dragon seven/i);
});

test("a three-card player eight win is a panda eight", () => {
  const win: Event = { Win: { result: "PlayerWin", player: 8, banker: 5 } };
  const s = handsSnap(
    "Dealing",
    [win],
    [fu("Five"), fu("Five"), fu("Eight")],
    [fu("Two"), fu("Three")],
  );
  expect(text(narrate(s))).toMatch(/panda eight/i);
});

test("a six-six tie is a tiger tie", () => {
  const win: Event = { Win: { result: "Tie", player: 6, banker: 6 } };
  const s = handsSnap("Dealing", [win], [fu("Two"), fu("Four")], [fu("Three"), fu("Three")]);
  expect(text(narrate(s))).toMatch(/tiger/i);
});

test("natural nine over natural eight is le grand over le petit", () => {
  const win: Event = { Win: { result: "PlayerWin", player: 9, banker: 8 } };
  const naturals: Event[] = [
    { Natural: { side: "Player", total: 9 } },
    { Natural: { side: "Banker", total: 8 } },
    win,
  ];
  const s = handsSnap("Dealing", naturals, [fu("Four"), fu("Five")], [fu("Three"), fu("Five")]);
  expect(text(narrate(s))).toMatch(/le grand/i);
});

test("winning side bets get called out with their odds at settle", () => {
  const win: Event = { Win: { result: "BankerWin", player: 5, banker: 7 } };
  const s: RoundSnapshot = {
    ...handsSnap("Settled", [win], [fu("Two"), fu("Three")], [fu("Two"), fu("Two"), fu("Three")]),
    payouts: [
      { bet: { kind: { Side: "Dragon7" }, amount: 500 }, net: 20000 },
      { bet: { kind: { Main: "Player" }, amount: 1000 }, net: -1000 },
    ],
  };
  const line = text(narrate(s));
  expect(line).toMatch(/dragon seven/i);
  expect(line).toMatch(/forty to one/i);
});

test("losing side bets stay uncalled", () => {
  const win: Event = { Win: { result: "BankerWin", player: 5, banker: 6 } };
  const s: RoundSnapshot = {
    ...handsSnap("Settled", [win], [fu("Two"), fu("Three")], [fu("Two"), fu("Four")]),
    payouts: [{ bet: { kind: { Side: "PlayerPair" }, amount: 500 }, net: -500 }],
  };
  expect(text(narrate(s))).not.toMatch(/eleven to one/i);
});
