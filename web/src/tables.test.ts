import { TABLES, tableSpec, configFor } from "./tables";
import { buyIn, rackTotal } from "./chips";

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

test("each table stocks chips that fit its stakes", () => {
  for (const t of TABLES) {
    const sorted = [...t.denoms].sort((a, b) => a - b);
    // you can always bet exactly the table minimum
    expect(sorted[0]).toBeLessThanOrEqual(t.table_min);
    // the biggest chip isn't bigger than the biggest allowed bet
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(t.table_max);
    // and the buy-in racks every denomination conservatively
    const { rack, change } = buyIn(t.starting_bankroll, t.denoms);
    expect(rackTotal(rack) + change).toBe(t.starting_bankroll);
  }
});

test("every table's goal is 10x the buy-in", () => {
  for (const t of TABLES) {
    expect(t.goal).toBe(t.starting_bankroll * 10);
  }
});
