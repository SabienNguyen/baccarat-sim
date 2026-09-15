// @vitest-environment node
import { createSession, getGlossary } from "./adapter";
import type { SessionConfig } from "./types";

const config: SessionConfig = {
  starting_bankroll: 100000,
  table_min: 100,
  table_max: 10000,
  ruleset: "Commission",
  seed: 7,
};

test("a fresh session opens in ShoeCut; cutting the shoe opens it to Betting", () => {
  const session = createSession(config);
  expect(session.snapshot().phase).toBe("ShoeCut");
  const cut = session.cutShoe(500);
  expect(cut.ok).toBe(true);
  if (cut.ok) {
    expect(cut.snapshot.phase).toBe("Betting");
    expect(cut.snapshot.shoe.number).toBe(1);
  }
});

test("plays a full round through the adapter", () => {
  const session = createSession(config);
  session.cutShoe(500);
  expect(session.snapshot().phase).toBe("Betting");

  const placed = session.placeBet({ Main: "Player" }, 500);
  expect(placed.ok).toBe(true);

  const dealt = session.deal();
  expect(dealt.ok).toBe(true);

  const settled = session.settle();
  expect(settled.ok).toBe(true);
  if (settled.ok) {
    expect(settled.snapshot.phase).toBe("Settled");
    expect(settled.snapshot.outcome).not.toBeNull();
    expect(settled.snapshot.payouts).not.toBeNull();
  }
});

test("a wrong-phase command returns ok:false with a typed error", () => {
  const session = createSession(config);
  session.cutShoe(500);
  const result = session.settle(); // settle before deal -> WrongPhase
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toHaveProperty("WrongPhase");
  }
});

test("a stray non-integer amount degrades to a refusal, never a throw", () => {
  const session = createSession(config);
  session.cutShoe(500);
  // BigInt(100.5) would throw a RangeError at the wasm boundary; the
  // adapter rounds instead, so the bet simply lands.
  const fractional = session.placeBet({ Main: "Player" }, 100.5);
  expect(fractional.ok).toBe(true);
  // NaN can't be rounded — it becomes 0 and the dealer refuses it politely.
  const nan = session.placeBet({ Main: "Player" }, Number.NaN);
  expect(nan.ok).toBe(false);
  if (!nan.ok) {
    expect(nan.error).toHaveProperty("BetBelowMinimum");
  }
});

test("glossary is non-empty and includes monkey", () => {
  const terms = getGlossary();
  expect(terms.length).toBeGreaterThanOrEqual(20);
  expect(terms.some((t) => t.term === "monkey")).toBe(true);
});
