// P14c probe: "the user can still see the cards being dealt on the board
// before we go into the peel overlay; instead just have the dealing happen
// in this peel overlay". App.tsx used to wait DEAL_SETTLE_MS (700ms) after
// the phase flipped to Dealing before mounting the peel overlay, so the
// inline felt's own deal-in fly played first, in full view, and only then
// got hidden by `.card-stage--peeling`. The fix mounts the overlay (and
// hides the inline hands) the instant the phase becomes Dealing, so the
// fly-in plays inside the overlay's own Hands instead.
//
// This probe taps Deal and, starting immediately, polls every 16ms for
// 1500ms, recording:
//   (a) the first poll at which `.peel-backdrop` exists (ms since the tap)
//   (b) whether the inline hand container's cards (`.card-stage .card`) are
//       ever actually visible (offsetParent !== null, not just present in
//       the DOM — App.tsx keeps them mounted, only hidden via `visibility`)
//       at any point while the phase reads "Dealing"
//   (c) the `.peel-stage .card` count at each poll, to show the cards
//       arriving inside the overlay over time
//
// Assertions: the backdrop must exist within 100ms of the tap, and the
// inline cards must never be visible once Dealing has started.
import { chromium, devices } from "playwright-core";

const PORT = process.env.PORT ?? 5185;

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

  const dealBtn = page.getByRole("button", { name: /^Deal$/ });
  const tapStart = Date.now();
  await dealBtn.tap();

  const samples = [];
  let backdropFirstSeenAt = null;
  let inlineCardEverVisible = false;
  let inlineVisibleWhileDealing = null;

  const deadline = tapStart + 1500;
  while (Date.now() < deadline) {
    const t = Date.now() - tapStart;
    const sample = await page.evaluate(() => {
      const phaseEl = document.querySelector(".hud-box-value--phase");
      const phase = phaseEl ? phaseEl.textContent?.trim() : null;
      const backdrop = document.querySelector(".peel-backdrop") !== null;
      const inlineCards = Array.from(document.querySelectorAll(".card-stage .card"));
      const inlineVisible = inlineCards.some((el) => {
        if (el.offsetParent === null) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
      });
      const overlayCardCount = document.querySelectorAll(".peel-stage .card").length;
      return { phase, backdrop, inlineVisible, overlayCardCount };
    });
    samples.push({ t, ...sample });
    if (sample.backdrop && backdropFirstSeenAt === null) backdropFirstSeenAt = t;
    if (sample.phase === "Dealing" && sample.inlineVisible) {
      inlineCardEverVisible = true;
      if (inlineVisibleWhileDealing === null) inlineVisibleWhileDealing = t;
    }
    await page.waitForTimeout(16);
  }

  out.backdropFirstSeenAtMs = backdropFirstSeenAt;
  out.inlineCardEverVisibleWhileDealing = inlineCardEverVisible;
  out.inlineVisibleFirstAtMs = inlineVisibleWhileDealing;
  out.overlayCardCountOverTime = samples
    .filter((s, i) => i === 0 || samples[i - 1].overlayCardCount !== s.overlayCardCount)
    .map((s) => ({ t: s.t, count: s.overlayCardCount }));
  out.sampleCount = samples.length;

  await browser.close();
  return out;
}

const results = [];
results.push(await runProbe(390, 844));
results.push(await runProbe(390, 664));

console.log(JSON.stringify({ results }, null, 2));

const failures = [];
for (const r of results) {
  if (r.backdropFirstSeenAtMs === null) {
    failures.push(`${r.viewport}: .peel-backdrop never appeared within 1500ms of the Deal tap`);
  } else if (r.backdropFirstSeenAtMs > 100) {
    failures.push(
      `${r.viewport}: .peel-backdrop first appeared at ${r.backdropFirstSeenAtMs}ms, later than the 100ms budget`,
    );
  }
  if (r.inlineCardEverVisibleWhileDealing) {
    failures.push(
      `${r.viewport}: an inline .card-stage .card was visible while Dealing (first at ${r.inlineVisibleFirstAtMs}ms) — dealing was visible on the felt behind the overlay`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} PROBE ASSERTION(S) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.error(`\nAll probe assertions passed across ${results.length} viewports.`);
