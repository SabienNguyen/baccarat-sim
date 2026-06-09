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

test("plays a full round through the adapter", () => {
  const session = createSession(config);
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
  const result = session.settle(); // settle before deal -> WrongPhase
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toHaveProperty("WrongPhase");
  }
});

test("glossary is non-empty and includes monkey", () => {
  const terms = getGlossary();
  expect(terms.length).toBeGreaterThanOrEqual(20);
  expect(terms.some((t) => t.term === "monkey")).toBe(true);
});
