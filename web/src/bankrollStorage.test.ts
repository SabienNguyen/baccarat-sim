import { loadBankroll, saveBankroll, clearBankroll } from "./bankrollStorage";

// Storage that throws on every touch: blocked or partitioned inside a
// cross-origin iframe (game portals), or private mode on some browsers.
function throwingStorage(): Storage {
  const boom = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    get length(): number {
      return boom();
    },
  } as unknown as Storage;
}

test("load/save/clear survive a Storage whose methods throw", () => {
  const s = throwingStorage();
  expect(() => saveBankroll("mid", 5000, s)).not.toThrow();
  expect(loadBankroll("mid", s)).toBeNull();
  expect(() => clearBankroll("mid", s)).not.toThrow();
});

test("load/save/clear survive a window.localStorage getter that throws", () => {
  const desc = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("Access is denied for this document.", "SecurityError");
    },
  });
  try {
    expect(() => saveBankroll("mid", 5000)).not.toThrow();
    expect(loadBankroll("mid")).toBeNull();
    expect(() => clearBankroll("mid")).not.toThrow();
  } finally {
    if (desc) Object.defineProperty(window, "localStorage", desc);
  }
});

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

test("round-trips a saved bankroll per tier", () => {
  const s = fakeStorage();
  expect(loadBankroll("mid", s)).toBeNull();
  saveBankroll("mid", 99500, s);
  expect(loadBankroll("mid", s)).toBe(99500);
  // other tiers keep their own roll
  expect(loadBankroll("high", s)).toBeNull();
  saveBankroll("high", 25_000_000, s);
  expect(loadBankroll("mid", s)).toBe(99500);
  expect(loadBankroll("high", s)).toBe(25_000_000);
});

test("clear removes only that tier's saved value", () => {
  const s = fakeStorage();
  saveBankroll("low", 5000, s);
  saveBankroll("mid", 7000, s);
  clearBankroll("low", s);
  expect(loadBankroll("low", s)).toBeNull();
  expect(loadBankroll("mid", s)).toBe(7000);
});

test("rejects non-numeric or negative stored values", () => {
  const s = fakeStorage();
  s.setItem("baccarat.bankroll.mid", "not-a-number");
  expect(loadBankroll("mid", s)).toBeNull();
  s.setItem("baccarat.bankroll.mid", "-100");
  expect(loadBankroll("mid", s)).toBeNull();
});

test("floors fractional cents on save", () => {
  const s = fakeStorage();
  saveBankroll("mid", 1234.9, s);
  expect(loadBankroll("mid", s)).toBe(1234);
});

test("still reads a pre-versioning bare-number save", () => {
  const s = fakeStorage();
  s.setItem("baccarat.bankroll.mid", "88800"); // legacy format
  expect(loadBankroll("mid", s)).toBe(88800);
});

test("saves carry the schema version and unknown versions are discarded", () => {
  const s = fakeStorage();
  saveBankroll("mid", 5000, s);
  expect(JSON.parse(s.getItem("baccarat.bankroll.mid")!)).toEqual({ v: 1, cents: 5000 });
  // a save from a future format is not misread as cents
  s.setItem("baccarat.bankroll.mid", JSON.stringify({ v: 2, roll: { cents: 1 } }));
  expect(loadBankroll("mid", s)).toBeNull();
});
