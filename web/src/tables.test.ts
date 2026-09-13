import { TABLES, tableSpec, configFor, defaultChip } from "./tables";

test("three tiers, each coherent: min < max, buy-in covers many minimum bets", () => {
  expect(TABLES).toHaveLength(3);
  for (const t of TABLES) {
    expect(t.table_min).toBeLessThan(t.table_max);
    expect(t.starting_bankroll).toBeGreaterThanOrEqual(t.table_min * 100);
    // a posted limit can outsize the buy-in (the salon does), never the goal
    expect(t.table_max).toBeLessThanOrEqual(t.goal);
  }
});

test("stakes climb across tiers", () => {
  const [low, mid, high] = TABLES;
  expect(low.table_min).toBeLessThan(mid.table_min);
  expect(mid.table_min).toBeLessThan(high.table_min);
  expect(low.starting_bankroll).toBeLessThan(mid.starting_bankroll);
  expect(mid.starting_bankroll).toBeLessThan(high.starting_bankroll);
});

test("configFor uses the tier's limits and resumes a saved bankroll", () => {
  const fresh = configFor("low", null);
  expect(fresh.starting_bankroll).toBe(tableSpec("low").starting_bankroll);
  expect(fresh.table_min).toBe(100);
  const resumed = configFor("low", 12345);
  expect(resumed.starting_bankroll).toBe(12345);
});

test("each tier seeds its own shoe", () => {
  // seeds come from entropy; two configs almost surely differ
  const a = configFor("mid", null).seed;
  const b = configFor("mid", null).seed;
  expect(a).not.toBe(b);
});

test("each table stocks chips that fit its stakes", () => {
  for (const t of TABLES) {
    const sorted = [...t.denoms].sort((a, b) => a - b);
    // you can always bet exactly the table minimum
    expect(sorted[0]).toBeLessThanOrEqual(t.table_min);
    // the biggest chip isn't bigger than the biggest allowed bet
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(t.table_max);
  }
});

test("every table's goal is 10x the buy-in", () => {
  for (const t of TABLES) {
    expect(t.goal).toBe(t.starting_bankroll * 10);
  }
});

test("only the low 'learn the ropes' table is a coaching table", () => {
  expect(tableSpec("low").coach).toBe(true);
  expect(tableSpec("mid").coach).toBeFalsy();
  expect(tableSpec("high").coach).toBeFalsy();
});

test("defaultChip arms the smallest chip that clears each table's minimum", () => {
  // the rack stocks a top-up chip below the min; that one must not be armed first
  expect(defaultChip(tableSpec("low").denoms, tableSpec("low").table_min)).toBe(100); // $1
  expect(defaultChip(tableSpec("mid").denoms, tableSpec("mid").table_min)).toBe(2500); // $25
  expect(defaultChip(tableSpec("high").denoms, tableSpec("high").table_min)).toBe(50000); // $500
  for (const t of TABLES) {
    expect(defaultChip(t.denoms, t.table_min)).toBeGreaterThanOrEqual(t.table_min);
    expect(t.denoms).toContain(defaultChip(t.denoms, t.table_min));
  }
});

test("defaultChip falls back to the smallest chip when nothing clears the minimum", () => {
  expect(defaultChip([500, 100, 2500], 10000)).toBe(100);
});

test("defaultChip ignores denoms ordering", () => {
  expect(defaultChip([500000, 2500, 500, 10000], 2500)).toBe(2500);
});
