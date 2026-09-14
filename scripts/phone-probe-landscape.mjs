// T5/#19 probe: landscape phones (844x390, 780x360) and tablets (768x1024,
// 1024x768). For each viewport: scrollWidth vs innerWidth (must be equal —
// no horizontal overflow), scrollHeight, and for each core-loop element
// (bankroll value, dealer line, Player hand, Banker hand, Bet Player spot,
// chips row, Deal button) its box and whether it sits fully inside the
// viewport at scrollY 0 (all true is the bar for the two landscape phones).
import { chromium, devices } from "playwright-core";

const PORT = process.env.PORT ?? 5173;
const URL = `http://localhost:${PORT}/?tier=mid`;

const ELEMENTS = [
  { name: "bankroll value", selector: ".hud-box--bankroll .hud-box-value" },
  { name: "dealer line", selector: ".dealer-line" },
  { name: "Player hand", selector: '[aria-label="Player hand"]' },
  { name: "Banker hand", selector: '[aria-label="Banker hand"]' },
  { name: "Bet Player spot", selector: '[aria-label="Bet Player"]' },
  { name: "chips row", selector: '[aria-label="Chips"]' },
  { name: "Deal button", selector: '.controls .btn--primary' },
];

async function measure(page) {
  return await page.evaluate((elements) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const results = {};
    for (const { name, selector } of elements) {
      const el = document.querySelector(selector);
      if (!el) {
        results[name] = { found: false };
        continue;
      }
      const r = el.getBoundingClientRect();
      const box = {
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      };
      const fullyVisible =
        r.width > 0 &&
        r.height > 0 &&
        r.top >= 0 &&
        r.left >= 0 &&
        r.bottom <= vh &&
        r.right <= vw;
      results[name] = { found: true, box, fullyVisible };
    }

    return {
      innerWidth: vw,
      innerHeight: vh,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      elements: results,
    };
  }, ELEMENTS);
}

async function betPlayerOnce(page) {
  const spot = page.getByRole("button", { name: "Bet Player" });
  await spot.scrollIntoViewIfNeeded();
  await spot.tap().catch(() => spot.click());
  await page.waitForTimeout(300);
}

async function run(ctx, label) {
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await betPlayerOnce(page).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  const m = await measure(page);
  await page.close();
  return { label, ...m };
}

const out = { generatedAt: new Date().toISOString() };
const browser = await chromium.launch();

// --- landscape phones ---
out.iphone14_landscape_844x390 = await run(
  await browser.newContext({ ...devices["iPhone 14 landscape"], locale: "en-US" }),
  "iPhone 14 landscape (844x390)",
);

out.android_landscape_780x360 = await run(
  await browser.newContext({
    viewport: { width: 780, height: 360 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    locale: "en-US",
  }),
  "780x360 Android-like landscape",
);

// --- tablets ---
out.tablet_portrait_768x1024 = await run(
  await browser.newContext({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    locale: "en-US",
  }),
  "tablet portrait (768x1024)",
);

out.tablet_landscape_1024x768 = await run(
  await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    locale: "en-US",
  }),
  "tablet landscape (1024x768)",
);

console.log(JSON.stringify(out, null, 2));
await browser.close();
