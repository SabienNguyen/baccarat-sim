// Visual verification for the shoe cut ceremony's pixel-art pass: the
// cutter view plus every step of the cut/turn/burn/banner reveal, at phone
// (390x844) and desktop (1440x900). Solo `?tier=mid` only — one browser,
// closed at the end.
//
//   SHOT_DIR=/path PORT=5173 node scripts/shoe-stage-shots.mjs
//
// Prints a JSON summary of every assertion to stdout.
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.PORT ?? 5173;
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
mkdirSync(SHOT_DIR, { recursive: true });
const BASE = `http://localhost:${PORT}`;
const shot = (name) => join(SHOT_DIR, name);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.error(`[${mark}] ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
}

/** Same synthetic-PointerEvent drag pattern as scripts/shoe-probe.mjs. */
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

async function runViewport(browser, { label, contextOpts }) {
  const ctx = await browser.newContext({ ...contextOpts, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?tier=mid`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // 1. Cutter view.
  await page.screenshot({ path: shot(`stage-cutter-${label}.png`) });

  // 2. Drag the cut card to ~60% of the well.
  const stackBox = await page.locator(".shoe-stack").boundingBox();
  const startX = stackBox.x + stackBox.width * 0.5;
  const midY = stackBox.y + stackBox.height / 2;
  const targetX = stackBox.x + stackBox.width * 0.6;
  await dragTouch(page, ".shoe-stack", [
    { x: startX, y: midY },
    { x: (startX + targetX) / 2, y: midY },
    { x: targetX, y: midY },
  ]);
  await page.waitForTimeout(100);
  await releaseTouch(page, ".shoe-stack", targetX, midY);
  await page.waitForTimeout(100);

  // 3. Press "Cut here" and screenshot at each animation frame.
  const t0 = Date.now();
  const confirm = page.locator("button.shoe-cut-confirm");
  if (contextOpts.hasTouch) {
    await confirm.tap();
  } else {
    await confirm.click();
  }

  const frames = [300, 1000, 1800, 2400];
  const measurements = {};
  for (const ms of frames) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: shot(`stage-anim-${ms}-${label}.png`) });

    if (ms === 1000) {
      const turned = page.locator(".turned-card");
      const count = await turned.count();
      const box = count ? await turned.boundingBox() : null;
      const viewport = page.viewportSize();
      const inViewport =
        box !== null &&
        box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1;
      const wideEnough = box !== null && box.width >= 60;
      measurements.turnedCardAt1000ms = { count, box, inViewport, wideEnough };
      record(`${label}: .turned-card is in the viewport at 1000ms`, inViewport, box);
      record(`${label}: .turned-card is >= 60px wide at 1000ms`, wideEnough, box?.width);
    }
    if (ms === 2400) {
      const banner = page.locator(".shoe-banner");
      const visible = (await banner.count()) > 0 && (await banner.isVisible());
      const text = visible ? (await banner.innerText()).trim() : null;
      measurements.bannerAt2400ms = { visible, text };
      record(`${label}: .shoe-banner is visible at 2400ms`, visible);
      record(`${label}: .shoe-banner reads 'SHOE 1' at 2400ms`, text === "SHOE 1", { text });
    }
  }

  await ctx.close();
  return measurements;
}

const browser = await chromium.launch();
const measurements = {};
try {
  measurements.phone = await runViewport(browser, {
    label: "phone",
    contextOpts: { ...devices["iPhone 14"] },
  });
  measurements.desktop = await runViewport(browser, {
    label: "desktop",
    contextOpts: { viewport: { width: 1440, height: 900 } },
  });
} finally {
  await browser.close();
}

const failures = results.filter((r) => !r.ok);
console.log(JSON.stringify({ results, measurements, screenshotDir: SHOT_DIR }, null, 2));
if (failures.length > 0) {
  console.error(`\n${failures.length}/${results.length} ASSERTION(S) FAILED:`);
  for (const f of failures) console.error(`  - ${f.name}`);
  process.exit(1);
}
console.error(`\nAll ${results.length} assertions passed.`);
