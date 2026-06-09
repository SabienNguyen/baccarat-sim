import { formatCents } from "./format";

test("formats whole dollars", () => {
  expect(formatCents(100000)).toBe("$1,000.00");
});

test("formats cents", () => {
  expect(formatCents(2550)).toBe("$25.50");
});

test("formats zero", () => {
  expect(formatCents(0)).toBe("$0.00");
});

test("formats negatives (a net loss)", () => {
  expect(formatCents(-500)).toBe("-$5.00");
});
