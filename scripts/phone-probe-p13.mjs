// P13 probe: verify the pinned action bar doesn't eat taps meant for content
// sitting at the bottom edge of the viewport.
//
// Geometry note (recorded while building this probe): at the standard iPhone
// 14 viewport (390x664) the felt's bet spots rest with their bottom edge only
// ~1px above the bar's top edge (549 vs 550) -- they can never be scrolled
// *further* down into the bar (scrolling only moves them up/off-screen), so
// they cannot be used to reproduce the bug through scrolling at this exact
// viewport height. The real, cleanly-reproducible case at 390x664 is content
// at the *end* of the document -- the "Full roads" button in the board dock
// -- which sits at whatever the .app bottom padding leaves for it: with the
// old (wrong) 64px assumption, it renders *inside* the real ~114-190px bar
// and a tap on it lands on a bar button instead. That's step 1 below.
//
// Step 1b additionally exercises the Bet Banker spot the task asked for,
// using a shorter viewport (390x600, e.g. Safari with an expanded address
// bar) where the spot's bottom edge does sit under the bar without any
// scrolling. That case is a real button (in the Betting-phase bar's second
// row) overlapping a real button (the spot) -- pointer-events fallthrough
// can't help there since both are genuine interactive elements, so this is
// recorded as a known residual gap, not asserted as fixed by this task.
import { chromium, devices } from "playwright-core";

const out = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
const page = await ctx.newPage();

// --- Step 1: scroll to the very bottom of the document (390x664, standard
// viewport) and tap "Full roads", the board dock's own bottom-most button.
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?tier=mid`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(300);

const fullRoadsBtn = page.locator(".full-roads-btn");
const frBox = await fullRoadsBtn.boundingBox();
const bar1 = await page.locator(".app > .stage > .controls").boundingBox();
const viewport1 = page.viewportSize();
out.step1_setup = {
  viewport: viewport1,
  fullRoadsBox: frBox,
  barBox: bar1,
  fullRoadsBottomFromViewportBottom: frBox ? viewport1.height - (frBox.y + frBox.height) : null,
};

const frcx = frBox.x + frBox.width / 2;
const frcy = frBox.y + frBox.height / 2;
out.elementAtFullRoadsCentreBeforeTap = await page.evaluate(
  ([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tag: el.tagName, cls: el.className, text: el.textContent?.trim().slice(0, 40) } : null;
  },
  [frcx, frcy]
);

let tapError = null;
try {
  // Raw touchscreen tap at the geometric centre: what a real thumb does,
  // and it faithfully reproduces the bug (whatever is topmost at that
  // screen point receives the touch, bar or not) rather than relying on
  // Playwright's own actionability heuristics.
  await page.touchscreen.tap(frcx, frcy);
} catch (err) {
  tapError = String(err).split("\n")[0];
}
await page.waitForTimeout(400);
// "Full roads" opens the RoadsModal -- if the tap actually reached it.
const modalOpened = await page
  .locator('[role="dialog"], .roads-modal')
  .first()
  .isVisible()
  .catch(() => false);
out.step1 = {
  tapError,
  modalOpened,
  reachedFullRoadsButton: out.elementAtFullRoadsCentreBeforeTap?.cls === "full-roads-btn" || modalOpened,
};
// close the modal if it opened, for a clean state going into step 2
if (modalOpened) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

// --- Step 1b: the specific Bet Banker scenario from the task, at a shorter
// viewport where the spot's bottom edge does sit within the bar's footprint
// with no scrolling. Recorded, not treated as fixed by this task (see note
// above) -- both elements involved are real buttons.
const page2 = await ctx.newPage();
await page2.setViewportSize({ width: 390, height: 600 });
await page2.goto(`http://localhost:${process.env.PORT ?? 5173}/?tier=mid`, { waitUntil: "networkidle" });
await page2.waitForTimeout(800);
const bankerSpot = page2.getByRole("button", { name: "Bet Banker" });
const bBox = await bankerSpot.boundingBox();
const bViewport = page2.viewportSize();
const bcx = bBox.x + bBox.width / 2;
const bcy = bBox.y + bBox.height / 2;
const elBefore = await page2.evaluate(
  ([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tag: el.tagName, cls: el.className, text: el.textContent?.trim().slice(0, 40) } : null;
  },
  [bcx, bcy]
);
await page2.touchscreen.tap(bcx, bcy);
await page2.waitForTimeout(400);
const bStake = await bankerSpot.locator(".spot-stake").innerText().catch(() => "(no stake)");
const bDealerLine = await page2.locator(".dealer-line").first().innerText().catch(() => "(no .dealer-line)");
out.step1b_bankerSpotShortViewport = {
  viewport: bViewport,
  bankerBox: bBox,
  bottomFromViewportBottom: bViewport.height - (bBox.y + bBox.height),
  elementAtCentreBeforeTap: elBefore,
  stake: bStake,
  dealerLine: bDealerLine.replace(/\s+/g, " ").trim(),
  stakeLandedOnBanker: bStake === "$25.00",
  note: "known residual gap: Betting-phase bar wraps to 2 rows here, and a real bar button occupies this point -- pointer-events fallthrough only helps for dead bar-box space, not real button-on-button overlap. Not fixed by T1's scoped changes.",
};
await page2.close();

// --- Step 2: tap "Deal" in the bar (standard viewport), assert phase leaves
// Betting.
await page.setViewportSize({ width: 390, height: 664 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Bet Player" }).tap();
await page.waitForTimeout(300);
const dealBtn = page.getByRole("button", { name: /^Deal$/ });
let dealTapError = null;
try {
  await dealBtn.tap({ timeout: 5000 });
} catch (err) {
  dealTapError = String(err).split("\n")[0];
}
await page.waitForTimeout(600);
const dealerLineAfterDeal = await page.locator(".dealer-line").first().innerText().catch(() => "(no .dealer-line)");
out.step2 = {
  dealTapError,
  dealerLineAfterDeal: dealerLineAfterDeal.replace(/\s+/g, " ").trim(),
  leftBetting: !/riding|Call the deal/i.test(dealerLineAfterDeal),
};

// --- Step 3: page metrics + bar height, standard 390x664 viewport.
out.step3 = await page.evaluate(() => {
  const bar = document.querySelector(".app > .stage > .controls");
  const rect = bar ? bar.getBoundingClientRect() : null;
  return {
    scrollWidth: document.documentElement.scrollWidth,
    barHeight: rect ? rect.height : null,
    barRect: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null,
    innerHeight: window.innerHeight,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
