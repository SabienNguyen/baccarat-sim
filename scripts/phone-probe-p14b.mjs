// T8b probe (overlay revision): at two phone viewports (390x844 and
// 360x780), walk Betting -> bet -> Deal, wait for the peel overlay to take
// over, and assert:
//   - `.peel-backdrop` covers the viewport (its box == {0,0,w,h})
//   - the inline `.hud` is still in the DOM behind the backdrop (the normal
//     felt stays mounted underneath — this is an overlay, not a swap)
//   - overlay card widths are 112px
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
results.push(await runProbe(360, 780));

console.log(JSON.stringify({ results }, null, 2));
