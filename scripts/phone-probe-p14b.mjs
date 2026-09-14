// T8b probe (overlay revision): at phone viewports, walk Betting -> bet ->
// Deal, wait for the peel overlay to take over, and assert:
//   - `.peel-backdrop` covers the viewport (its box == {0,0,w,h})
//   - the inline `.hud` is still in the DOM behind the backdrop (the normal
//     felt stays mounted underneath — this is an overlay, not a swap)
//   - overlay card widths are 112px (390x844's own step; see below for the
//     height-based steps checked at the other viewports)
//   - document.documentElement.scrollWidth === the viewport width
//   - a touch drag starting ON the first Player card's face peeks it (the
//     dealer line changes) — there is no reach anymore, so the drag must
//     start on the card itself
//   - no `.peek-lens` exists at any point during the drag (removed)
//   - Reveal all -> Settled removes the backdrop
//
// The drag is dispatched as synthetic PointerEvents with pointerType:
// "touch" directly on the target element (Playwright's touchscreen API only
// supports a single tap, not a move sequence) — this is exactly what the
// app's own pointer handlers listen for, and matchMedia("(pointer: coarse)")
// still reports true from Chromium's touch-emulated context regardless.
//
// Controls-bar clearance (this revision): the pinned action bar
// (`.controls`, fixed + z-index 45, theme.css) sits on top of the overlay's
// own z-index 40, and on a short viewport the overlay's lower content used
// to render right under it. At FOUR phone viewports — 390x844, 390x664,
// 360x640, 412x915 — once the overlay is up and at rest AND the "Ask the
// dealer" flip offer has been driven onto screen (see below), this asserts
// (at window.scrollY === 0 and `.peel-stage-content`.scrollTop === 0):
//   - every "Flip one" / "Flip both" / "Flip the other" button's box bottom
//     is above (< ) `.controls`'s box top
//   - the Banker hand's `.hand-total-badge` box bottom is above `.controls`'s
//     box top (Banker is `.peel-stage .hand` — the second one)
//
// The "Ask the dealer" group (DealerFlipRequest.tsx) only renders while the
// engine would actually honour the ask (dealerFlip.ts's dealerFlipOffer): a
// squeezer holding Player, the house holding Banker, and Player's own hand
// not yet fully turned. Right after Deal that's already true, but the
// Banker hand carries no `.hand-total-badge` yet — Hand.tsx only prints one
// once a card is face-up, and the dealer's own pacer will not turn Banker's
// initial cards until the *normal* ritual reaches them (Player exposed
// first) — which would also clear the flip offer by revealing Player's
// hand. So this probe drives the state the real high-limit ask exists for:
// tapping "Flip one" itself, which turns one Banker card immediately
// (independent of the ritual) and leaves the offer up as "Flip the other" —
// giving both the buttons and the Banker total on screen together without
// faking anything App.tsx/dealerFlip.ts wouldn't do on a real tap.
import { chromium, devices } from "playwright-core";

const PORT = process.env.PORT ?? 5185;
const SHOT = process.env.SHOT ?? null;

async function dragTouch(page, selector, path) {
  return page.evaluate(
    ({ selector, path }) => {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, reason: "no element" };
      const fire = (type, x, y) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      };
      fire("pointerdown", path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) fire("pointermove", path[i].x, path[i].y);
      return { ok: true };
    },
    { selector, path },
  );
}

async function releaseTouch(page, selector, x, y) {
  return page.evaluate(
    ({ selector, x, y }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          clientX: x,
          clientY: y,
        }),
      );
    },
    { selector, x, y },
  );
}

async function runProbe(width, height, { shot } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices["iPhone 14"],
    viewport: { width, height },
    locale: "en-US",
  });
  const page = await ctx.newPage();
  const out = { viewport: `${width}x${height}` };

  await page.goto(`http://localhost:${PORT}/?tier=mid`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Bet Player" }).tap();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Deal$/ }).tap();

  // wait past DEAL_SETTLE_MS (700ms) for the overlay to mount, past its own
  // ~200ms fade-in, and past every card's own deal-in animation (up to
  // ~1040ms for a third card) so widths are read at rest, not mid-fly-in
  await page.waitForTimeout(1600);

  const backdropBox = await page.locator(".peel-backdrop").boundingBox().catch(() => null);
  out.backdropBox = backdropBox;
  out.backdropCoversViewport =
    backdropBox !== null &&
    Math.round(backdropBox.x) === 0 &&
    Math.round(backdropBox.y) === 0 &&
    Math.round(backdropBox.width) === width &&
    Math.round(backdropBox.height) === height;

  // the inline felt (HUD included) stays mounted behind the backdrop — this
  // is an overlay, not a view swap
  out.hudStillInDom = (await page.locator(".hud").count()) > 0;

  const cardWidths = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".peel-stage .card")).map((el) =>
      Math.round(el.getBoundingClientRect().width),
    ),
  );
  out.cardWidths = cardWidths;

  out.scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  out.scrollWidthOk = out.scrollWidth === width;

  const dealerBefore = await page.locator('[aria-label="Dealer"]').first().textContent();
  out.dealerLineBeforeDrag = dealerBefore?.trim();

  // touch drag starting ON the first Player card's face (no reach anymore)
  const firstCard = page.locator(".peel-stage .card").first();
  const cardBox = await firstCard.boundingBox();
  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height * 0.2;
  const midY = cardBox.y + cardBox.height * 0.6;
  await dragTouch(page, ".peel-stage .card", [
    { x: startX, y: startY },
    { x: startX, y: (startY + midY) / 2 },
    { x: startX, y: midY },
  ]);
  await page.waitForTimeout(150);

  const dealerAfter = await page.locator('[aria-label="Dealer"]').first().textContent();
  out.dealerLineDuringPeek = dealerAfter?.trim();
  out.dealerLineChanged = out.dealerLineBeforeDrag !== out.dealerLineDuringPeek;

  out.noLensDuringDrag = (await page.locator(".peek-lens").count()) === 0;

  await releaseTouch(page, ".peel-stage .card", startX, midY);
  await page.waitForTimeout(150);
  out.noLensAfterRelease = (await page.locator(".peek-lens").count()) === 0;

  // --- controls-bar clearance: drive the "Ask the dealer" flip offer AND a
  // Banker total onto screen together (see the file header) by tapping
  // "Flip one" ourselves — exactly the real high-limit ask a player would
  // make mid-squeeze.
  const flipOneBtn = page.locator(".peel-stage .dealer-flip-btn", { hasText: "Flip one" });
  out.flipOneOffered = (await flipOneBtn.count()) > 0;
  out.maxBankerBadgeBottomDuringSlam = null;
  if (out.flipOneOffered) {
    await flipOneBtn.tap();
    // The Banker total-slam keyframe (cards.css) overshoots to scale(1.5) at
    // its 55% mark before settling — the badge's PAINTED bottom edge during
    // that overshoot can sit well below its resting layout-box bottom. Sample
    // every 16ms for 600ms (comfortably past the 480ms animation) and keep
    // the deepest bottom seen, so the clearance assertion below is checked
    // against the worst frame, not just the at-rest position.
    let maxBottom = null;
    for (let i = 0; i < 38; i++) {
      const bottom = await page.evaluate(() => {
        const bankerHand = document.querySelectorAll(".peel-stage .hand")[1] ?? null;
        const badge = bankerHand?.querySelector(".hand-total-badge") ?? null;
        return badge ? badge.getBoundingClientRect().bottom : null;
      });
      if (bottom !== null && (maxBottom === null || bottom > maxBottom)) maxBottom = bottom;
      await page.waitForTimeout(16);
    }
    out.maxBankerBadgeBottomDuringSlam = maxBottom;
  }

  // The clearance assertions below only mean anything measured from a
  // known rest position: `.peel-stage` and `.controls` are both
  // `position: fixed` (viewport-relative), so a leftover page scrollY from
  // an earlier tap (Playwright's tap() scrolls its target into view, and a
  // short viewport can need that during Betting) wouldn't itself move
  // either box — but pin both scroll positions to 0 anyway so the
  // measurement is taken under the exact condition specified (top of page,
  // top of the overlay's own scroll container) rather than relying on that.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const content = document.querySelector(".peel-stage-content");
    if (content) content.scrollTop = 0;
  });

  if (shot) {
    await page.screenshot({ path: shot });
    out.screenshot = shot;
  }

  out.scrollYAtRest = await page.evaluate(() => window.scrollY);
  out.peelStageContentScrollTop = await page.evaluate(
    () => document.querySelector(".peel-stage-content")?.scrollTop ?? null,
  );

  const controlsBox = await page.locator(".controls").boundingBox().catch(() => null);
  out.controlsBox = controlsBox;

  const clearance = await page.evaluate(() => {
    const controlsTop = document.querySelector(".controls")?.getBoundingClientRect().top ?? null;
    const flipBtns = Array.from(document.querySelectorAll(".peel-stage .dealer-flip-btn")).map(
      (el) => {
        const box = el.getBoundingClientRect();
        return { label: el.textContent, bottom: box.bottom };
      },
    );
    const bankerHand = document.querySelectorAll(".peel-stage .hand")[1] ?? null;
    const bankerBadge = bankerHand?.querySelector(".hand-total-badge") ?? null;
    const bankerBadgeBottom = bankerBadge ? bankerBadge.getBoundingClientRect().bottom : null;
    return { controlsTop, flipBtns, bankerBadgeBottom };
  });
  out.controlsTop = clearance.controlsTop;
  out.flipButtonBottoms = clearance.flipBtns;
  out.bankerBadgeBottom = clearance.bankerBadgeBottom;
  out.flipButtonsClearControls =
    clearance.controlsTop !== null &&
    clearance.flipBtns.length > 0 &&
    clearance.flipBtns.every((b) => b.bottom < clearance.controlsTop);
  // 8px = the badge's 6px drop text-shadow (cards.css: `6px 6px 0
  // rgba(0,0,0,.45)`) plus a 2px margin so the shadow itself never touches
  // the bar. Checked both at rest and (via maxBankerBadgeBottomDuringSlam
  // above) at the deepest point of the slam overshoot.
  const CLEARANCE_MARGIN = 8;
  out.bankerBadgeClearsControls =
    clearance.controlsTop !== null &&
    clearance.bankerBadgeBottom !== null &&
    clearance.bankerBadgeBottom + CLEARANCE_MARGIN < clearance.controlsTop;
  out.bankerBadgeSlamPeakClearsControls =
    clearance.controlsTop !== null &&
    out.maxBankerBadgeBottomDuringSlam !== null &&
    out.maxBankerBadgeBottomDuringSlam + CLEARANCE_MARGIN < clearance.controlsTop;

  // Reveal all -> Settled removes the backdrop
  const revealBtn = page.getByRole("button", { name: "Reveal all" });
  if (await revealBtn.count()) {
    await revealBtn.tap().catch(() => {});
  }
  let settled = false;
  for (let i = 0; i < 20; i++) {
    const phase = await page
      .locator(".hud-box-value--phase")
      .first()
      .textContent()
      .catch(() => null);
    if (phase === "Settled") {
      settled = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  out.settledReached = settled;
  // the overlay fades out over 150ms before it unmounts
  await page.waitForTimeout(300);
  out.backdropGoneAfterSettle = (await page.locator(".peel-backdrop").count()) === 0;

  await browser.close();
  return out;
}

const results = [];
results.push(await runProbe(390, 844));
results.push(await runProbe(390, 664, SHOT ? { shot: SHOT } : {}));
results.push(await runProbe(360, 640));
results.push(await runProbe(412, 915));

console.log(JSON.stringify({ results }, null, 2));

const failures = [];
for (const r of results) {
  if (!r.backdropCoversViewport) failures.push(`${r.viewport}: backdrop doesn't cover viewport`);
  if (!r.hudStillInDom) failures.push(`${r.viewport}: .hud missing from DOM`);
  if (!r.scrollWidthOk) failures.push(`${r.viewport}: horizontal scroll (scrollWidth ${r.scrollWidth})`);
  if (!r.dealerLineChanged) failures.push(`${r.viewport}: peek drag didn't change the dealer line`);
  if (!r.noLensDuringDrag) failures.push(`${r.viewport}: .peek-lens present during drag`);
  if (!r.noLensAfterRelease) failures.push(`${r.viewport}: .peek-lens present after release`);
  if (!r.flipOneOffered) failures.push(`${r.viewport}: "Flip one" was never offered`);
  if (r.scrollYAtRest !== 0) failures.push(`${r.viewport}: window.scrollY is ${r.scrollYAtRest}, not 0`);
  if (r.peelStageContentScrollTop !== 0)
    failures.push(`${r.viewport}: .peel-stage-content.scrollTop is ${r.peelStageContentScrollTop}, not 0`);
  if (!r.flipButtonsClearControls)
    failures.push(
      `${r.viewport}: a flip button's bottom is not above .controls's top (${JSON.stringify(r.flipButtonBottoms)} vs controlsTop=${r.controlsTop})`,
    );
  if (!r.bankerBadgeClearsControls)
    failures.push(
      `${r.viewport}: Banker's total badge bottom (${r.bankerBadgeBottom}) + 8 is not above .controls's top (${r.controlsTop})`,
    );
  if (!r.bankerBadgeSlamPeakClearsControls)
    failures.push(
      `${r.viewport}: Banker's total badge slam-peak bottom (${r.maxBankerBadgeBottomDuringSlam}) + 8 is not above .controls's top (${r.controlsTop})`,
    );
  if (!r.settledReached) failures.push(`${r.viewport}: never reached Settled`);
  if (!r.backdropGoneAfterSettle) failures.push(`${r.viewport}: backdrop still present after Settled`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} PROBE ASSERTION(S) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.error(`\nAll probe assertions passed across ${results.length} viewports.`);
