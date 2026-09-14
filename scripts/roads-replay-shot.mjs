// Open `?roads=<sequence>` at a plain 1440x900 desktop viewport, wait for
// the full roads board, screenshot it, and print each road's rendered
// column count plus the tally the board shows — for comparing against a
// real pit display's numbers.
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? 5185;
const SHOT = process.env.SHOT ?? "roads-replay.png";
const SEQ =
  process.env.SEQ ??
  "BPBBPBBBBPBPBBPPPBBBPPBPPPBBPPBPBBBPPPBBPPBPBBBPBBPBBBPBBBBPBPBPPPBP";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`http://localhost:${PORT}/?roads=${SEQ}`, { waitUntil: "networkidle" });
await page.getByRole("dialog", { name: "All roads" }).waitFor({ state: "visible" });
await page.waitForTimeout(300);

await page.screenshot({ path: SHOT, fullPage: false });

const report = await page.evaluate(() => {
  const cols = (label) =>
    document.querySelector(`[aria-label="${label}"] .road-grid`)?.querySelectorAll(":scope > ul").length ?? null;
  const row = (label) => {
    const tr = document.querySelector(`table[aria-label="Tally"] tr[aria-label="${label}"] .board-value`);
    return tr ? tr.textContent.trim() : null;
  };
  return {
    columns: {
      "Big Road": cols("Big Road"),
      "Big Eye Boy": cols("Big Eye Boy"),
      "Small Road": cols("Small Road"),
      "Cockroach Pig": cols("Cockroach Pig"),
    },
    tally: {
      Banker: row("Banker"),
      Player: row("Player"),
      Tie: row("Tie"),
      "Game number": row("Game number"),
    },
  };
});

console.log(JSON.stringify({ screenshot: SHOT, ...report }, null, 2));

await browser.close();
