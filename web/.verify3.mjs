import { chromium } from "playwright-core";
import fs from "node:fs";
fs.mkdirSync("/tmp/squeeze-shots", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && logs.push(m.text()));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.locator(".mode-card").first().click();
await page.waitForTimeout(300);
const table = page.locator(".home-tables button").first();
if (await table.count()) await table.click();
await page.waitForTimeout(500);
const chip = page.locator('[aria-label="Chips"] button').first();
if (await chip.count()) await chip.click();
await page.getByLabel("Bet Player", { exact: true }).click();
await page.getByRole("button", { name: "Deal", exact: true }).click();
await page.waitForTimeout(400);
const cut = page.locator('[aria-label="Shoe"]');
if (await cut.count()) {
  const bb = await cut.boundingBox();
  if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(400);
}
const sq = page.locator('div[role="button"]:has(.card-back)').first();
await sq.waitFor({ timeout: 5000 });
const box = await sq.boundingBox();

// --- BLINK PROBE: immediately after pointer-down, the DOM card must
// still be visible (opacity 1) until the overlay has painted ---
await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
const opacityRightAfterDown = await page.evaluate(() => {
  return new Promise((resolve) => {
    const el = document.querySelector('div[role="button"]');
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, clientX: 0, clientY: 0 }));
    // measure synchronously, before any paint
    const span = el.querySelector("span");
    resolve(getComputedStyle(span).opacity);
  });
});
console.log("opacity right after pointerdown (want 1):", opacityRightAfterDown);
await page.waitForTimeout(100);
const opacityAfterReady = await page.evaluate(() => {
  const span = document.querySelector('div[role="button"] span');
  return getComputedStyle(span).opacity;
});
const canvasNow = await sq.locator("canvas").count();
console.log("after 100ms — opacity (want 0):", opacityAfterReady, "canvas:", canvasNow);
await page.evaluate(() => {
  const el = document.querySelector('div[role="button"]');
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, clientX: 0, clientY: 0 }));
});
await page.waitForTimeout(400);

// --- FLIP: deep edge pull, release, capture the sweep + slide ---
const clip = { x: box.x - 170, y: box.y - 170, width: box.width + 340, height: box.height + 340 };
const cx = box.x + box.width / 2;
const bot = box.y + box.height - 6;
await page.mouse.move(cx, bot);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(cx, bot - i * 7, { steps: 1 });
  await page.waitForTimeout(16);
}
await page.mouse.up();
for (const [name, wait] of [["f1", 80], ["f2", 120], ["f3", 120], ["f4", 120], ["f5", 300]]) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/squeeze-shots/flip-${name}.png`, clip });
}
console.log("face-up after flip:", await page.locator(".card-face").count());
console.log("LOGS:", logs.length ? logs.join(" | ") : "none");
await browser.close();
