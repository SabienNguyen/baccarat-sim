import { TABLES, tableSpec, configFor } from "./tables";

test("three tiers, each coherent: min < max, buy-in covers many minimum bets", () => {
  expect(TABLES).toHaveLength(3);
  for (const t of TABLES) {
    expect(t.table_min).toBeLessThan(t.table_max);
    expect(t.starting_bankroll).toBeGreaterThanOrEqual(t.table_min * 100);
    expect(t.table_max).toBeLessThanOrEqual(t.starting_bankroll);
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
