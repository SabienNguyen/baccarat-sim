import { commissionNote } from "./settleExplain";
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
