// Open `?roads=<sequence>` at a plain 1440x900 desktop viewport, wait for
// the full roads board, screenshot it, and print each road's rendered
// column count plus the tally the board shows — for comparing against a
// real pit display's numbers.
//
// Also checks the whole-column scroll fix on the Small Road and Cockroach
// Pig grids: no cut column at the left edge, the grid actually starts
// scrolled (there is more shoe than fits), and a plain mouse wheel pans it
// back to the very first column.
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? 5185;
const SHOT = process.env.SHOT ?? "roads-replay.png";
const SHOT2 =
  process.env.SHOT2 ??
  "/tmp/claude-1000/-home-sabien-Dev-personal-baccarat-simulator/a2618aa5-a407-408d-92cd-5b175678efd4/scratchpad/roads-replay-2.png";
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

// --- whole-column scroll checks (no cut column, scrollable, wheel pans it) ---

const edgeCheckFn = (label) => {
  const grid = document.querySelector(`[aria-label="${label}"] .road-grid`);
  if (!grid) return null;
  const gridRect = grid.getBoundingClientRect();
  // overflow-x clips at the padding edge, i.e. just inside the 2px ink
  // border — that's the true "is a column cut" boundary, not the grid's
  // own outer box edge (which sits 2px further out over the border).
  const borderLeft = Number.parseFloat(getComputedStyle(grid).borderLeftWidth) || 0;
  const clipLeft = gridRect.left + borderLeft;
  const lis = [...grid.querySelectorAll("li")];
  // the first `li` whose right edge lands past the clip edge is the
  // leftmost column actually visible; its own left edge must not sit to
  // the left of the clip edge — otherwise it's the "half fry" cut column
  const visibleFirst = lis.find((li) => li.getBoundingClientRect().right > clipLeft);
  const visibleFirstRect = visibleFirst ? visibleFirst.getBoundingClientRect() : null;
  const leftmost = lis[0] ?? null;
  const leftmostRect = leftmost ? leftmost.getBoundingClientRect() : null;
  return {
    gridLeft: gridRect.left,
    gridRight: gridRect.right,
    clipLeft,
    scrollLeft: grid.scrollLeft,
    scrollWidth: grid.scrollWidth,
    clientWidth: grid.clientWidth,
    visibleFirstLeft: visibleFirstRect ? visibleFirstRect.left : null,
    leftmostLeft: leftmostRect ? leftmostRect.left : null,
    leftmostRight: leftmostRect ? leftmostRect.right : null,
  };
};

const checks = {};
for (const label of ["Small Road", "Cockroach Pig"]) {
  const e = await page.evaluate(edgeCheckFn, label);
  checks[label] = {
    noCutColumn: e.visibleFirstLeft >= e.clipLeft - 0.5,
    scrollLeftPositive: e.scrollLeft > 0,
    ...e,
  };
}

// Wheel-pan the Small Road grid back toward its start.
const smallRoadGrid = page.locator('[aria-label="Small Road"] .road-grid');
const box = await smallRoadGrid.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(150);

const after = await page.evaluate(edgeCheckFn, "Small Road");

checks["Small Road"].afterWheel = {
  scrollLeftDecreased: after.scrollLeft < checks["Small Road"].scrollLeft,
  leftmostFullyInside:
    after.leftmostLeft >= after.clipLeft - 0.5 && after.leftmostRight <= after.gridRight + 0.5,
  ...after,
};

await page.screenshot({ path: SHOT2, fullPage: false });

console.log(JSON.stringify({ screenshot: SHOT, screenshot2: SHOT2, ...report, checks }, null, 2));

await browser.close();
