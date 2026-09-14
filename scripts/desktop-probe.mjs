// Drive the dev server at plain desktop viewports (no device emulation), bet
// Player, Deal, and report the DEALT-state document/viewport geometry: does
// the page fit without scroll, and does clicking auto-scroll it.
import { chromium } from "playwright-core";

const VIEWPORTS = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900 (control)", width: 1440, height: 900 },
];

const PORT = process.env.PORT ?? 5181;

function box(r) {
  if (!r) return null;
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

function inside(r, vw, vh) {
  if (!r) return null;
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= vw && r.y + r.h <= vh;
}

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?tier=mid`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Bet Player" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Deal$/ }).click();
  await page.waitForTimeout(1500);

  const dealerBox = box(await page.locator(".dealer-line").first().boundingBox().catch(() => null));
  const roadsHeaderBox = box(await page.locator(".board h4").first().boundingBox().catch(() => null));
  const chipsBox = box(await page.locator(".chips").first().boundingBox().catch(() => null));
  const thirdCardBox = box(await page.locator(".third-card").first().boundingBox().catch(() => null));

  const sizes = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  // click "Reveal all" if present, then check the page didn't auto-scroll
  const revealBtn = page.getByRole("button", { name: /Reveal all|Reveal/ }).first();
  let scrollYAfterClick = null;
  if (await revealBtn.count()) {
    await revealBtn.click().catch(() => {});
    await page.waitForTimeout(300);
    scrollYAfterClick = await page.evaluate(() => window.scrollY);
  } else {
    scrollYAfterClick = await page.evaluate(() => window.scrollY);
  }

  console.log(
    JSON.stringify({
      viewport: vp.name,
      ...sizes,
      fits: sizes.scrollHeight <= sizes.innerHeight,
      dealerLine: { box: dealerBox, insideViewport: inside(dealerBox, vp.width, vp.height) },
      roadsHeader: { box: roadsHeaderBox, insideViewport: inside(roadsHeaderBox, vp.width, vp.height) },
      chips: { box: chipsBox, insideViewport: inside(chipsBox, vp.width, vp.height) },
      thirdCardTable: thirdCardBox
        ? { box: thirdCardBox, insideViewport: inside(thirdCardBox, vp.width, vp.height) }
        : "(not present)",
      scrollYAfterClick,
    }),
  );

  await ctx.close();
}
await browser.close();
