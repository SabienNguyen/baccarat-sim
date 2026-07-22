import { commissionNote, sideBetNotes } from "./settleExplain";
import type { BetPayout } from "./engine/types";

const pay = (kind: BetPayout["bet"]["kind"], amount: number, net: number): BetPayout => ({
  bet: { kind, amount },
  net,
});

test("explains the 5% vig on a Banker win — why $100 pays $95", () => {
  // $100 staked, net profit 9500 cents ($95), so commission is $5.
  const note = commissionNote([pay({ Main: "Banker" }, 10_000, 9_500)]);
  expect(note).not.toBeNull();
  expect(note).toContain("$100.00");
  expect(note).toContain("$95.00");
  expect(note).toContain("$5.00");
  expect(note).toMatch(/5%|commission/i);
});

test("no commission note for a Player win (Player pays even money)", () => {
  expect(commissionNote([pay({ Main: "Player" }, 10_000, 10_000)])).toBeNull();
});

test("no commission note when the Banker bet lost", () => {
  expect(commissionNote([pay({ Main: "Banker" }, 10_000, -10_000)])).toBeNull();
});

test("aggregates multiple winning Banker stakes", () => {
  const note = commissionNote([
    pay({ Main: "Banker" }, 10_000, 9_500),
    pay({ Main: "Banker" }, 2_000, 1_900),
  ]);
  // combined stake $120 → paid $114, vig $6
  expect(note).toContain("$120.00");
  expect(note).toContain("$114.00");
  expect(note).toContain("$6.00");
});

test("no note without payouts", () => {
  expect(commissionNote(null)).toBeNull();
  expect(commissionNote([])).toBeNull();
});

test("connects a winning Player Pair to what happened on the felt", () => {
  const notes = sideBetNotes([pay({ Side: "PlayerPair" }, 100, 1_100)]);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(/Player Pair/i);
  expect(notes[0]).toMatch(/matched|pair/i);
  expect(notes[0]).toContain("11:1");
});

test("explains Dragon 7 and Panda 8 wins", () => {
  expect(sideBetNotes([pay({ Side: "Dragon7" }, 100, 4_000)])[0]).toMatch(
    /Dragon 7.*three-card 7.*40:1/i,
  );
  expect(sideBetNotes([pay({ Side: "Panda8" }, 100, 2_500)])[0]).toMatch(
    /Panda 8.*three-card 8.*25:1/i,
  );
});

test("handles the Dragon Bonus variable payout by its actual multiplier", () => {
  const notes = sideBetNotes([pay({ Side: { DragonBonus: "Player" } }, 100, 900)]);
  expect(notes[0]).toMatch(/Dragon Bonus/i);
  expect(notes[0]).toContain("9:1");
});

test("skips losing and pushed side bets, and main bets", () => {
  expect(
    sideBetNotes([
      pay({ Side: "BankerPair" }, 100, -100), // lost
      pay({ Side: "Panda8" }, 100, 0), // push
      pay({ Main: "Banker" }, 10_000, 9_500), // main bet, not a side note
    ]),
  ).toEqual([]);
});
