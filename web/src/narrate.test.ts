import { narrate } from "./narrate";
import type { RoundSnapshot, Event } from "./engine/types";

function snap(phase: RoundSnapshot["phase"], events: Event[] = []): RoundSnapshot {
  return {
    phase,
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 0,
    table_max: 0,
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

test("betting phase invites bets", () => {
  expect(narrate(snap("Betting"))).toEqual([{ text: "Place your bets." }]);
});

test("dealing with no events yet prompts the squeeze", () => {
  expect(narrate(snap("Dealing"))).toEqual([{ text: "Cards out — squeeze 'em." }]);
});

test("a monkey is called out with a glossary term", () => {
  const segs = narrate(snap("Dealing", [{ Monkey: { hand: "Player", index: 0 } }]));
  expect(segs).toEqual([
    { text: "Monkey", term: "monkey" },
    { text: " for the Player!" },
  ]);
});

test("a natural is announced with its total", () => {
  const segs = narrate(snap("Dealing", [{ Natural: { side: "Banker", total: 9 } }]));
  expect(segs).toEqual([
    { text: "Natural", term: "natural" },
    { text: " 9 — Banker!" },
  ]);
});

test("a pair tags the pair term", () => {
  const segs = narrate(snap("Dealing", [{ Pair: { side: "Player" } }]));
  expect(segs).toEqual([
    { text: "Player " },
    { text: "pair", term: "pair" },
    { text: "!" },
  ]);
});

test("the win line is decisive and beats earlier events", () => {
  const segs = narrate(
    snap("Settled", [
      { Monkey: { hand: "Player", index: 0 } },
      { Win: { result: "BankerWin", player: 5, banker: 7 } },
    ]),
  );
  expect(segs).toEqual([
    { text: "Banker", term: "banker" },
    { text: " wins, 7 over 5." },
  ]);
});

test("a tie pushes", () => {
  const segs = narrate(snap("Settled", [{ Win: { result: "Tie", player: 6, banker: 6 } }]));
  expect(segs).toEqual([{ text: "Tie", term: "tie" }, { text: " — bets push." }]);
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
