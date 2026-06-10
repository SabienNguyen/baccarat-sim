import { loadBankroll, saveBankroll, clearBankroll } from "./bankrollStorage";

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
