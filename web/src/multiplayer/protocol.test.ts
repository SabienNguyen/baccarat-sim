import { socketUrl } from "./protocol";

describe("socketUrl", () => {
  const real = window.location;
  const set = (href: string) => {
    // jsdom lets us rewrite location for the duration of a test
    Object.defineProperty(window, "location", {
      value: new URL(href),
      writable: true,
      configurable: true,
    });
  };
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: real,
      writable: true,
      configurable: true,
    });
  });

  test("defaults to /ws on the page's own origin", () => {
    // The single-host case — a VPS, or the server serving its own SPA_DIR —
    // needs no build-time configuration and cannot drift out of date.
    set("https://baccaratsimulator.com/?tier=low");
    expect(socketUrl()).toBe("wss://baccaratsimulator.com/ws");
  });

  test("a secure page never opens an insecure socket", () => {
    // Mixed content: browsers block ws:// from an https:// page outright, so
    // the scheme has to follow the page's.
    set("https://example.com/");
    expect(socketUrl()).toMatch(/^wss:/);
    set("http://localhost:5173/");
    expect(socketUrl()).toBe("ws://localhost:5173/ws");
  });
});
