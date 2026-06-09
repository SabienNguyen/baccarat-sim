import { WasmSession, glossary } from "engine-wasm";
import type { SessionConfig, BetKind, RoundSnapshot } from "engine-wasm";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
}

const config: SessionConfig = {
  starting_bankroll: 100000,
  table_min: 100,
  table_max: 10000,
  ruleset: "Commission",
  seed: 7,
};

const session = new WasmSession(config);

const start: RoundSnapshot = session.snapshot();
assert(start.phase === "Betting", `expected Betting, got ${start.phase}`);

const playerBet: BetKind = { Main: "Player" };
session.place_bet(playerBet, 500n); // i64 param -> bigint per generated .d.ts
session.deal_round();
const settled: RoundSnapshot = session.settle();
assert(settled.phase === "Settled", `expected Settled, got ${settled.phase}`);
assert(settled.outcome != null, "settled snapshot should carry an outcome");
assert(settled.payouts != null, "settled snapshot should carry payouts");

const terms = glossary();
assert(Array.isArray(terms), "glossary() should be an array");
assert(terms.length >= 20, `expected >=20 terms, got ${terms.length}`);
assert(
  terms.some((t) => t.term === "monkey"),
  "glossary should contain the 'monkey' term",
);

console.log(
  `SMOKE OK: settled outcome=${settled.outcome}, bankroll=${settled.bankroll}, terms=${terms.length}`,
);
