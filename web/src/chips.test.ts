import {
  CHIP_DENOMINATIONS,
  acquire,
  buyIn,
  toChips,
  rackTotal,
  addChips,
  removeChips,
  breakChip,
  colorUp,
  mintChange,
  emptyRack,
} from "./chips";

test("six real casino denominations, ascending", () => {
  expect(CHIP_DENOMINATIONS).toEqual([100, 500, 2500, 10000, 50000, 100000]);
});

test("toChips pays largest-first and conserves the amount", () => {
  const { chips, remainder } = toChips(163000); // $1,630
  expect(chips).toEqual([100000, 50000, 10000, 2500, 500]);
  expect(chips.reduce((a, b) => a + b, 0) + remainder).toBe(163000);
  expect(remainder).toBe(0);
});

test("toChips leaves sub-$1 cents as remainder (commission change)", () => {
  const { chips, remainder } = toChips(2375); // $23.75 banker win on $25
  expect(chips.reduce((a, b) => a + b, 0)).toBe(2300);
  expect(remainder).toBe(75);
});

test("buyIn conserves the bankroll exactly", () => {
  for (const bankroll of [1_000_000, 123_456, 99, 2500, 0]) {
    const { rack, change } = buyIn(bankroll);
    expect(rackTotal(rack) + change).toBe(bankroll);
  }
});

test("buyIn of the default bankroll yields a playable spread of every chip", () => {
  const { rack } = buyIn(1_000_000); // $10,000
  for (const d of CHIP_DENOMINATIONS) {
    expect(rack[d]).toBeGreaterThan(0);
  }
});

test("buyIn racks like a real cage: big chips carry the roll, small stacks stay sane", () => {
  const { rack } = buyIn(1_000_000); // $10,000
  expect(rack[100]).toBeLessThanOrEqual(20); // a sleeve of singles, not a bucket
  expect(rack[500]).toBeLessThanOrEqual(36);
  expect(rack[2500]).toBeLessThanOrEqual(40);
  // at least 85% of the roll's value sits in $100+ chips
  const big = rack[100000] * 100000 + rack[50000] * 50000 + rack[10000] * 10000;
  expect(big).toBeGreaterThanOrEqual(850_000);
});

test("add/remove chips round-trip; removing a chip you lack fails", () => {
  const start = buyIn(1_000_000).rack;
  const added = addChips(start, [2500, 2500]);
  expect(added[2500]).toBe(start[2500] + 2);
  const removed = removeChips(added, [2500, 2500]);
  expect(removed).toEqual(start);
  expect(removeChips(emptyRack(), [100])).toBeNull();
});

test("breakChip splits one chip into smaller chips, conserving value", () => {
  const rack = addChips(emptyRack(), [10000]); // one $100
  const broken = breakChip(rack, 10000);
  expect(broken).not.toBeNull();
  expect(broken![10000]).toBe(0);
  expect(broken![2500]).toBe(4); // $100 -> 4x$25
  expect(rackTotal(broken!)).toBe(10000);
});

test("breakChip refuses the smallest chip and chips you lack", () => {
  expect(breakChip(addChips(emptyRack(), [100]), 100)).toBeNull();
  expect(breakChip(emptyRack(), 10000)).toBeNull();
});

test("colorUp combines smaller chips into one larger, conserving value", () => {
  const rack = addChips(emptyRack(), [2500, 2500, 2500, 2500]); // 4x$25
  const up = colorUp(rack, 10000);
  expect(up).not.toBeNull();
  expect(up![10000]).toBe(1);
  expect(up![2500]).toBe(0);
  expect(rackTotal(up!)).toBe(10000);
});

test("colorUp fails when the smaller chips can't make the amount", () => {
  expect(colorUp(addChips(emptyRack(), [2500, 2500, 2500]), 10000)).toBeNull();
});

test("mintChange folds loose cents into $1 chips at the dollar", () => {
  expect(mintChange(150)).toEqual({ chips: [100], change: 50 });
  expect(mintChange(75)).toEqual({ chips: [], change: 75 });
});

test("acquire: any chip is available if the rack covers it", () => {
  // color-up style: exact payment from smaller chips
  const smalls = addChips(emptyRack(), [2500, 2500, 2500, 2500]);
  const up = acquire(smalls, 10000);
  expect(up).not.toBeNull();
  expect(up!.rack[10000]).toBe(1);
  expect(rackTotal(up!.rack) + up!.loose).toBe(10000);

  // break-down style: overshoot a big chip and take change in chips
  const HIGH = [10000, 50000, 100000, 500000, 2500000, 10000000];
  const plates = addChips(emptyRack(HIGH), [10000000]); // one $100k
  const got = acquire(plates, 2500000, HIGH); // want a $25k
  expect(got).not.toBeNull();
  expect(got!.rack[2500000]).toBe(1 + 3); // the bought one + 3 in change
  expect(got!.rack[10000000]).toBe(0);
  expect(rackTotal(got!.rack) + got!.loose).toBe(10000000);
});

test("acquire refuses when the rack can't cover the chip", () => {
  const rack = addChips(emptyRack(), [2500]);
  expect(acquire(rack, 10000)).toBeNull();
});
