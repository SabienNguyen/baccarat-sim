import { resetAnalyticsForTests, track, trackFirstHand, trackVisit } from "./analytics";

type Win = { goatcounter?: { count: ReturnType<typeof vi.fn> } };
const win = window as unknown as Win;

function installBackend() {
  const count = vi.fn();
  win.goatcounter = { count };
  return count;
}

/** jsdom here has no usable localStorage; a Map-backed stand-in is enough. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

beforeEach(() => {
  delete win.goatcounter;
  vi.stubGlobal("localStorage", fakeStorage());
  resetAnalyticsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("every helper is a silent no-op without window.goatcounter", () => {
  expect(() => track("victory")).not.toThrow();
  expect(() => trackVisit()).not.toThrow();
  expect(() => trackFirstHand()).not.toThrow();
  expect(win.goatcounter).toBeUndefined();
});

test("a throwing backend never escapes into the game", () => {
  win.goatcounter = {
    count: vi.fn(() => {
      throw new Error("blocked");
    }),
  };
  expect(() => track("bust")).not.toThrow();
  expect(() => trackFirstHand()).not.toThrow();
});

test("track reports a kebab-case event under event/", () => {
  const count = installBackend();
  track("share-victory");
  expect(count).toHaveBeenCalledWith({ path: "event/share-victory", event: true });
});

test("trackVisit tells a first visit from a returning one", () => {
  const count = installBackend();
  trackVisit();
  expect(count).toHaveBeenLastCalledWith({ path: "event/first-visit", event: true });
  trackVisit();
  expect(count).toHaveBeenLastCalledWith({ path: "event/returning-visit", event: true });
});

test("first-hand fires exactly once per page load", () => {
  const count = installBackend();
  trackFirstHand();
  trackFirstHand();
  trackFirstHand();
  const firstHand = count.mock.calls.filter(([o]) => o.path === "event/first-hand");
  expect(firstHand).toHaveLength(1);
});

test("first-hand stays once-only even if the backend appeared after the first deal", () => {
  // The script is async: a deal before it loads is still the first hand, so a
  // later deal must not be misreported as the first one.
  trackFirstHand();
  const count = installBackend();
  trackFirstHand();
  expect(count).not.toHaveBeenCalled();
});
