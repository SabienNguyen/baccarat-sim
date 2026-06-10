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
  const segs = narrate(snap("Dealing", [{ Win: { result: "Tie", player: 6, banker: 6 } }]));
  expect(text(segs)).toBe("Égalité — tie at 6. Main bets push.");
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
