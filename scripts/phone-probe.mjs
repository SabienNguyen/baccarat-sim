// Drive the dev server at an iPhone-ish viewport with touch + DPR, tap the
// Player spot on a given tier, and report what the dealer line says.
import { chromium, devices } from "playwright-core";
const tier = process.argv[2] ?? "mid";
const out = process.argv[3] ?? `./phone-${tier}.png`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
const page = await ctx.newPage();
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?tier=${tier}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const spot = page.getByRole("button", { name: "Bet Player" });
await spot.scrollIntoViewIfNeeded();
await spot.tap();
await page.waitForTimeout(600);
const dealer = await page.locator(".dealer-line").first().innerText().catch(() => "(no .dealer-line)");
const stake = await spot.locator(".spot-stake").innerText().catch(() => "(no stake)");
const armed = await page.locator(".chip[aria-pressed='true'], .chip.selected, .chip.is-selected").first().innerText().catch(() => "(armed chip not found)");
const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, dpr: devicePixelRatio, touch: navigator.maxTouchPoints }));
await page.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ tier, dealer: dealer.replace(/\s+/g, " ").trim(), stake, armed, ...size, screenshot: out }));
await browser.close();
