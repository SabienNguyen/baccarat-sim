import { formatCents, outcomeLabel } from "./format";

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

test("the round result reads as words, not the wire enum", () => {
  // Rendered raw, the HUD showed "BankerWin" — and since the display font is
  // all-caps that read as "BANKERWIN".
  expect(outcomeLabel("PlayerWin")).toBe("Player win");
  expect(outcomeLabel("BankerWin")).toBe("Banker win");
  expect(outcomeLabel("Tie")).toBe("Tie");
  for (const o of ["PlayerWin", "BankerWin", "Tie"] as const) {
    expect(outcomeLabel(o)).not.toMatch(/[a-z][A-Z]/);
  }
});
