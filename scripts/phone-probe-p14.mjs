// P14 probe: walk Betting -> bet -> Deal -> Reveal all -> Settled ->
// auto-advance at the iPhone 14 viewport (390x664, Mid table, solo) and print
// per-frame geometry: scrollY, document height, the Player hand's top, the
// win/loss popup's box, the pinned bar's box, and whether the popup
// intersects either hand's box.
//
// Requirements this probe checks (see docs/superpowers/plans/2026-09-13-
// phone-experience.md, T8a):
//   - Player-hand top varies <=4px across every frame (no HUD growth at settle)
//   - the popup box never intersects a hand box
//   - document height never exceeds its Betting value by more than 40px
//   - document.documentElement.scrollWidth stays 390 throughout
//   - after Settled, the bar's Deal/Next-hand button is visible and tappable
import { chromium, devices } from "playwright-core";

const PORT = process.env.PORT ?? 5180;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
const page = await ctx.newPage();

function intersects(a, b) {
  if (!a || !b) return false;
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

async function frame(label) {
  const data = await page.evaluate(() => {
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return {
      scrollY: window.scrollY,
      docH: document.documentElement.scrollHeight,
      docW: document.documentElement.scrollWidth,
      playerHand: rectOf('[aria-label="Player hand"]'),
      bankerHand: rectOf('[aria-label="Banker hand"]'),
      popup: rectOf(".win-popup"),
      bar: rectOf(".app > .stage > .controls"),
      phase: document.querySelector(".hud-box-value--phase")?.textContent ?? null,
    };
  });
  const playerHandTop = data.playerHand ? Math.round(data.playerHand.top + data.scrollY) : null;
  const popupIntersectsPlayer = intersects(data.popup, data.playerHand);
  const popupIntersectsBanker = intersects(data.popup, data.bankerHand);
  const out = {
    label,
    phase: data.phase,
    scrollY: data.scrollY,
    docH: data.docH,
    docW: data.docW,
    playerHandTop,
    popupBox: data.popup,
    barBox: data.bar,
    popupIntersectsHand: popupIntersectsPlayer || popupIntersectsBanker,
  };
  frames.push(out);
  return out;
}

const frames = [];

await page.goto(`http://localhost:${PORT}/?tier=mid`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await frame("Betting");

await page.getByRole("button", { name: "Bet Player" }).tap();
await page.waitForTimeout(300);
await frame("Bet placed");

await page.getByRole("button", { name: /^Deal$/ }).tap();
await page.waitForTimeout(300);
await frame("Dealing (just dealt)");

await page.getByRole("button", { name: "Reveal all" }).tap().catch(() => {});
await page.waitForTimeout(1000);
await frame("Dealing (revealing)");
await page.waitForTimeout(1200);
await frame("Dealing (revealing, later)");
await page.waitForTimeout(1200);
await frame("Dealing (revealing, later still)");

// Poll for Settled (revealAll's interval + AUTO_SETTLE_MS) instead of a fixed
// sleep -- how many cards land (and so how long reveal takes) varies by hand.
let settled = false;
for (let i = 0; i < 20; i++) {
  const phase = await page.locator(".hud-box-value--phase").first().textContent().catch(() => null);
  if (phase === "Settled") {
    settled = true;
    break;
  }
  await page.waitForTimeout(400);
}
await frame(settled ? "Settled (just after)" : "Settled (timed out waiting)");

// Bet rail reachability in Settled: the pinned bar's Deal/Next-hand button
// should be visible and tappable even though the bet rail itself may be
// below the fold (item 5 -- no auto-scroll). Checked without actually
// tapping (a real tap would advance the hand early and pre-empt the
// auto-advance measurement below) -- a hit-test at the button's own centre,
// same technique as scripts/phone-probe-p13.mjs, tells us whether the tap
// would land on it.
const dealBtn = page.getByRole("button", { name: /^(Deal|Next hand)$/ }).first();
const dealBox = await dealBtn.boundingBox().catch(() => null);
const dealVisible = await dealBtn.isVisible().catch(() => false);
let elementAtDealCentre = null;
if (dealBox) {
  const cx = dealBox.x + dealBox.width / 2;
  const cy = dealBox.y + dealBox.height / 2;
  elementAtDealCentre = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? { tag: el.tagName, cls: el.className, text: el.textContent?.trim().slice(0, 40) } : null;
    },
    [cx, cy],
  );
}
const dealTappable =
  dealVisible && dealBox !== null && dealBox.width >= 44 && dealBox.height >= 44 && elementAtDealCentre !== null;

// Auto-advance: on a coarse pointer this is 5000ms (autoAdvanceMs); wait past
// it and capture the felt clearing back to Betting, without having tapped
// anything ourselves.
await page.waitForTimeout(6200);
await frame("After auto-advance");

const playerTops = frames.map((f) => f.playerHandTop).filter((t) => t !== null);
const playerTopSpread = Math.max(...playerTops) - Math.min(...playerTops);
const bettingDocH = frames.find((f) => f.label === "Betting")?.docH ?? null;
const maxDocH = Math.max(...frames.map((f) => f.docH));
const maxDocW = Math.max(...frames.map((f) => f.docW));
const anyPopupIntersectsHand = frames.some((f) => f.popupIntersectsHand);

console.log(JSON.stringify({
  frames,
  summary: {
    playerHandTopSpread: playerTopSpread,
    playerHandTopSpreadOk: playerTopSpread <= 4,
    bettingDocH,
    maxDocH,
    maxDocHOverBettingBy: bettingDocH !== null ? maxDocH - bettingDocH : null,
    maxDocHOk: bettingDocH !== null ? maxDocH - bettingDocH <= 40 : null,
    maxDocW,
    maxDocWOk: maxDocW === 390,
    anyPopupIntersectsHand,
    popupNeverIntersectsHandOk: !anyPopupIntersectsHand,
    dealVisibleInSettled: dealVisible,
    dealBoxInSettled: dealBox,
    elementAtDealCentreInSettled: elementAtDealCentre,
    dealTappableInSettled: dealTappable,
  },
}, null, 2));

await browser.close();
