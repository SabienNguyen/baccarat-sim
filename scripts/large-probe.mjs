// Drive the dev server at plain desktop viewports, place a bet and deal, and
// report per-viewport numbers for the large-screen scaling work (#20):
// .app width vs innerWidth (ratio), a card's box, the smallest computed
// font-size among HUD labels/values and spot payouts, and scroll dimensions.
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? 5182;
const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "3440x1440", width: 3440, height: 1440 },
];

const browser = await chromium.launch();

for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?tier=mid`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const spot = page.getByRole("button", { name: "Bet Player" });
  await spot.scrollIntoViewIfNeeded();
  await spot.click();
  await page.waitForTimeout(200);

  const dealBtn = page.getByRole("button", { name: "Deal" });
  await dealBtn.click({ trial: false }).catch(() => {});
  await page.waitForTimeout(600);

  const result = await page.evaluate(() => {
    const appEl = document.querySelector(".app");
    const cardEl = document.querySelector(".card");
    const appRect = appEl ? appEl.getBoundingClientRect() : null;
    const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;

    const labelSelectors = [
      ".hud-box-label",
      ".hud-box-value",
      ".hud-box-value--small",
      ".hud-payouts li",
      ".spot-payout",
      ".spot-name",
      ".hud-action",
      ".hud-seat",
      ".hud-goal-pct",
      ".dealer-tag",
      ".chip-face",
      ".controls .btn",
      ".seg-badge",
      ".clear-bets",
    ];
    let minFont = Infinity;
    let minFontSel = null;
    for (const sel of labelSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < minFont) {
          minFont = fs;
          minFontSel = sel;
        }
      });
    }

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      appWidth: appRect ? appRect.width : null,
      appWidthRatio: appRect ? appRect.width / window.innerWidth : null,
      card: cardRect ? { width: cardRect.width, height: cardRect.height } : null,
      minFont,
      minFontSel,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  console.log(JSON.stringify({ viewport: vp.name, ...result }));
  await ctx.close();
}

await browser.close();
