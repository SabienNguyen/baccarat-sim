import { shareRun } from "./shareCard";

// jsdom has no canvas backend, so shareRun falls through to text sharing /
// clipboard — exactly the fallback chain we want to verify doesn't throw.

test("prefers the Web Share API and includes a deep link back", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });

  await shareRun({ headline: "TABLE BEATEN!", bankroll: 541_200, subtitle: "nice", tier: "low" });

  expect(share).toHaveBeenCalledOnce();
  const arg = share.mock.calls[0][0];
  expect(arg.text).toContain("$5,412.00");
  expect(arg.text).toContain("?tier=low");
});

test("falls back to clipboard when sharing is unavailable, never throws", async () => {
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  await expect(
    shareRun({ headline: "TABLE BEATEN!", bankroll: 100, subtitle: "x" }),
  ).resolves.toBeUndefined();
  expect(writeText).toHaveBeenCalledOnce();
  expect(writeText.mock.calls[0][0]).toContain("Baccarat Simulator");
});
