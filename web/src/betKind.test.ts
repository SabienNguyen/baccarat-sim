import { describe, expect, test } from "vitest";
import { betLabel, sideKey } from "./betKind";

test("main bets keep their own readable names", () => {
  expect(betLabel({ Main: "Player" })).toBe("Player");
  expect(betLabel({ Main: "Banker" })).toBe("Banker");
  expect(betLabel({ Main: "Tie" })).toBe("Tie");
  expect(sideKey({ Main: "Player" })).toBeNull();
});

describe("the two Dragon Bonus sides never collapse into one label", () => {
  test("they get distinct keys", () => {
    expect(sideKey({ Side: { DragonBonus: "Player" } })).toBe("DragonBonusPlayer");
    expect(sideKey({ Side: { DragonBonus: "Banker" } })).toBe("DragonBonusBanker");
  });

  test("they get distinct labels", () => {
    const p = betLabel({ Side: { DragonBonus: "Player" } });
    const b = betLabel({ Side: { DragonBonus: "Banker" } });
    expect(p).toBe("Player Dragon Bonus");
    expect(b).toBe("Banker Dragon Bonus");
    // The bug this guards: the payout ledger showed both as a bare
    // "DragonBonus", so a player holding both saw two identical rows.
    expect(p).not.toBe(b);
  });
});

test("no side bet label leaks the wire format", () => {
  const kinds = [
    { Side: "PlayerPair" },
    { Side: "BankerPair" },
    { Side: "Dragon7" },
    { Side: "Panda8" },
    { Side: { DragonBonus: "Player" } },
    { Side: { DragonBonus: "Banker" } },
    { Side: "Tiger" },
    { Side: "BigTiger" },
    { Side: "SmallTiger" },
    { Side: "TigerTie" },
    { Side: "TigerPair" },
  ] as const;
  for (const kind of kinds) {
    const label = betLabel(kind);
    // "PlayerPair" / "Panda8" style keys are camel-case or digit-jammed; a
    // player-facing label is spaced.
    expect(label).not.toMatch(/[a-z][A-Z]/);
    expect(label).not.toMatch(/[a-zA-Z]\d/);
  }
});

test("an unknown side bet degrades to its key rather than throwing", () => {
  // A side bet added to the engine before this map catches up should render
  // ugly, not crash the HUD.
  expect(betLabel({ Side: "SomethingNew" } as never)).toBe("SomethingNew");
});
