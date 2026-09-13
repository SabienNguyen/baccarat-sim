import { portalSignals, createPortalTracker, type PortalView } from "./signals";

const idle: PortalView = { phase: "Betting", busted: false, goalReached: false };
const dealing: PortalView = { ...idle, phase: "Dealing" };
const settled: PortalView = { ...idle, phase: "Settled" };

test("the first deal of a session starts gameplay, later deals don't repeat it", () => {
  const first = portalSignals(idle, dealing, false);
  expect(first).toEqual({ calls: ["gameplayStart"], playing: true });
  expect(portalSignals(dealing, settled, true).calls).toEqual([]);
  expect(portalSignals(settled, idle, true).calls).toEqual([]);
  expect(portalSignals(idle, dealing, true).calls).toEqual([]);
});

test("a bust stops gameplay; the rebuy resumes it", () => {
  const bust = portalSignals(settled, { ...settled, busted: true }, true);
  expect(bust).toEqual({ calls: ["gameplayStop"], playing: false });
  const back = portalSignals({ ...settled, busted: true }, idle, false);
  expect(back).toEqual({ calls: ["gameplayStart"], playing: true });
});

test("victory is a happy time and pauses gameplay; keep playing resumes", () => {
  const won = portalSignals(settled, { ...settled, goalReached: true }, true);
  expect(won).toEqual({ calls: ["happyTime", "gameplayStop"], playing: false });
  const again = portalSignals({ ...settled, goalReached: true }, settled, false);
  expect(again).toEqual({ calls: ["gameplayStart"], playing: true });
});

test("stopping something that never started is skipped; closing still resumes", () => {
  expect(portalSignals(idle, { ...idle, busted: true }, false).calls).toEqual([]);
  expect(portalSignals({ ...idle, busted: true }, idle, false).calls).toEqual(["gameplayStart"]);
});

test("the tracker carries the playing flag between transitions", () => {
  const calls: string[] = [];
  const adapter = {
    name: "fake",
    init: async () => {},
    gameplayStart: () => calls.push("start"),
    gameplayStop: () => calls.push("stop"),
    happyTime: () => calls.push("happy"),
    requestMidgameAd: async () => {},
    requestRewardedAd: async () => false,
    canShowRewardedAd: () => false,
  };
  const step = createPortalTracker(adapter);
  step(idle, dealing);
  step(dealing, settled);
  step(settled, idle);
  step(idle, dealing);
  step(dealing, { ...settled, goalReached: true });
  step({ ...settled, goalReached: true }, settled);
  expect(calls).toEqual(["start", "happy", "stop", "start"]);
});
