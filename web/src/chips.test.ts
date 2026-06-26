import { CHIP_DENOMINATIONS, toChips } from "./chips";

test("six real casino denominations, ascending", () => {
  expect(CHIP_DENOMINATIONS).toEqual([100, 500, 2500, 10000, 50000, 100000]);
});

test("toChips pays largest-first and conserves the amount", () => {
  const { chips, remainder } = toChips(163000); // $1,630
  expect(chips).toEqual([100000, 50000, 10000, 2500, 500]);
  expect(remainder).toBe(0);
});

test("toChips leaves sub-$1 cents as remainder (commission change)", () => {
  const { chips, remainder } = toChips(2375); // $23.75
  expect(chips.reduce((a, b) => a + b, 0)).toBe(2300);
  expect(remainder).toBe(75);
});
