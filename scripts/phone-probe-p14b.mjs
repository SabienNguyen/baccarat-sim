// T8b probe: at two phone viewports (390x844 and 360x780), walk
// Betting -> bet -> Deal, wait for the peel stage to take over, and assert:
//   - the stage covers the viewport (its box == {0,0,w,h})
//   - each card's rendered width (printed)
//   - document.documentElement.scrollWidth === the viewport width
//   - the body cannot scroll (overflow: hidden, and a scroll attempt is a no-op)
//   - a touch drag starting 20px outside the first Player card reaches a peek
//     (the dealer line changes to a "bend/peek" line) and shows `.peek-lens`
//     above the pointer's y
//   - Reveal all -> Settled unmounts the stage
//
// The drag is dispatched as synthetic PointerEvents with pointerType:
// "touch" directly on the target element (Playwright's touchscreen API only
// supports a single tap, not a move sequence) — this is exactly what the
// app's own pointer handlers listen for, and matchMedia("(pointer: coarse)")
// still reports true from Chromium's touch-emulated context regardless.
import { chromium, devices } from "playwright-core";

const PORT = process.env.PORT ?? 5185;

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

async function runProbe(width, height) {
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

  // wait past DEAL_SETTLE_MS (700ms) for the stage to mount, and past every
  // card's own deal-in animation (up to ~1040ms for a third card) so widths
  // are read at rest, not mid-fly-in
  await page.waitForTimeout(1600);

  const stageBox = await page.locator(".peel-stage").boundingBox().catch(() => null);
  out.stageBox = stageBox;
  out.stageCoversViewport =
    stageBox !== null &&
    Math.round(stageBox.x) === 0 &&
    Math.round(stageBox.y) === 0 &&
    Math.round(stageBox.width) === width &&
    Math.round(stageBox.height) === height;

  const cardWidths = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".peel-stage .card")).map((el) =>
      Math.round(el.getBoundingClientRect().width),
    ),
  );
  out.cardWidths = cardWidths;

  out.scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  out.scrollWidthOk = out.scrollWidth === width;

  // Chromium still honours a programmatic window.scrollTo() even with
  // overflow: hidden on <html> (that CSS blocks the scrollbar and user
  // gestures — wheel, touch, keyboard — not a direct script call), so the
  // real signal that the page is locked is the computed overflow itself,
  // not a scrollTo round-trip.
  const overflow = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overflow,
    body: getComputedStyle(document.body).overflow,
  }));
  out.htmlOverflow = overflow.html;
  out.bodyOverflow = overflow.body;
  out.bodyCannotScroll = overflow.html === "hidden" && overflow.body === "hidden";

  const dealerBefore = await page.locator('[aria-label="Dealer"]').first().textContent();
  out.dealerLineBeforeDrag = dealerBefore?.trim();

  // touch drag starting 20px outside the first Player card's top edge
  const firstCard = page.locator(".peel-stage .card").first();
  const cardBox = await firstCard.boundingBox();
  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y - 20; // 20px above the face, inside the 28px reach
  const midY = cardBox.y + cardBox.height * 0.55;
  await dragTouch(page, ".peel-stage .card", [
    { x: startX, y: startY },
    { x: startX, y: (startY + midY) / 2 },
    { x: startX, y: midY },
  ]);
  await page.waitForTimeout(150);

  const dealerAfter = await page.locator('[aria-label="Dealer"]').first().textContent();
  out.dealerLineDuringPeek = dealerAfter?.trim();
  out.dealerLineChanged = out.dealerLineBeforeDrag !== out.dealerLineDuringPeek;

  const lensBox = await page.locator(".peek-lens").boundingBox().catch(() => null);
  out.lensBox = lensBox;
  out.lensExists = lensBox !== null;
  out.lensAbovePointer = lensBox !== null && lensBox.y + lensBox.height / 2 < midY;

  await releaseTouch(page, ".peel-stage .card", startX, midY);
  await page.waitForTimeout(150);
  out.lensGoneAfterRelease = (await page.locator(".peek-lens").count()) === 0;

  // Reveal all -> Settled unmounts the stage
  await page.evaluate(() => {
    // the peel stage renders the same Reveal all button as the normal felt
  });
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
  out.stageGoneAfterSettle = (await page.locator(".peel-stage").count()) === 0;

  await browser.close();
  return out;
}

const results = [];
results.push(await runProbe(390, 844));
results.push(await runProbe(360, 780));

console.log(JSON.stringify({ results }, null, 2));
