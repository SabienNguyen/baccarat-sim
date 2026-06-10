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

test("round-trips a saved bankroll", () => {
  const s = fakeStorage();
  expect(loadBankroll(s)).toBeNull();
  saveBankroll(99500, s);
  expect(loadBankroll(s)).toBe(99500);
});

test("clear removes the saved value", () => {
  const s = fakeStorage();
  saveBankroll(5000, s);
  clearBankroll(s);
  expect(loadBankroll(s)).toBeNull();
});

test("rejects non-numeric or negative stored values", () => {
  const s = fakeStorage();
  s.setItem("baccarat.bankroll", "not-a-number");
  expect(loadBankroll(s)).toBeNull();
  s.setItem("baccarat.bankroll", "-100");
  expect(loadBankroll(s)).toBeNull();
});

test("floors fractional cents on save", () => {
  const s = fakeStorage();
  saveBankroll(1234.9, s);
  expect(loadBankroll(s)).toBe(1234);
});
