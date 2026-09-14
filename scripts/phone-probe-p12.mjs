// P12 probe: phone type floor (nothing in the pixel display font under 10px)
// and 44px tap targets, plus the pinned action bar's one-row height and the
// document's total size in each phase.
//
// Two device contexts (both from the task): iPhone 14 (390x844, via
// playwright's device descriptor) and a 360x780 Android-like context (plain
// viewport + touch, no device descriptor exists for this exact size).
// For each, three phases are captured: Betting (with a bet down — "Mid
// Betting"), Dealing (after Deal), and Settled (after Reveal all runs its
// course). A separate, narrower 390x664 check reproduces the task's own
// "document height in Mid Betting" number so it's directly comparable
// before/after.
import { chromium, devices } from "playwright-core";

const PORT = process.env.PORT ?? 5173;
const URL = `http://localhost:${PORT}/?tier=mid`;

// Elements the task calls out as needing a 44x44 hit area.
const INTERACTIVE_SELECTOR =
  'button, [role="button"], a[href], input, [role="tab"]';

async function measure(page) {
  return await page.evaluate((sel) => {
    const isVisuallyHidden = (el) => {
      const cs = getComputedStyle(el);
      // the BtnLabel sr-only technique (1x1px + clip) and any display:none /
      // zero-size subtree — not really on screen, so not a real tap target
      // or a rendered type-floor violation.
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) return true;
      return false;
    };

    const under44 = [];
    document.querySelectorAll(sel).forEach((el) => {
      if (isVisuallyHidden(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.width < 44 || r.height < 44) {
        under44.push({
          tag: el.tagName,
          cls: typeof el.className === "string" ? el.className : String(el.className),
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
          w: Math.round(r.width * 100) / 100,
          h: Math.round(r.height * 100) / 100,
        });
      }
    });

    // Type floor: anything set in the pixel display font family
    // (--font-display: "Silkscreen", ui-monospace, monospace) below 10px.
    const underFloor = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (el.children.length > 0 && el.textContent.trim() === "") return;
      const direct = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
      );
      if (!direct) return;
      if (isVisuallyHidden(el)) return;
      const cs = getComputedStyle(el);
      if (!/silkscreen/i.test(cs.fontFamily)) return;
      const size = parseFloat(cs.fontSize);
      if (size < 10) {
        underFloor.push({
          tag: el.tagName,
          cls: typeof el.className === "string" ? el.className : String(el.className),
          text: el.textContent.trim().slice(0, 30),
          fontSize: size,
        });
      }
    });

    const bar = document.querySelector(".app > .stage > .controls");
    const barRect = bar ? bar.getBoundingClientRect() : null;

    return {
      under44,
      underFloor,
      barHeight: barRect ? Math.round(barRect.height * 100) / 100 : null,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  }, INTERACTIVE_SELECTOR);
}

async function betPlayerOnce(page) {
  const spot = page.getByRole("button", { name: "Bet Player" });
  await spot.scrollIntoViewIfNeeded();
  await spot.tap();
  await page.waitForTimeout(300);
}

async function dealCoup(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const dealBtn = page.getByRole("button", { name: /^Deal$/ });
  await dealBtn.tap({ timeout: 5000 });
  await page.waitForTimeout(600);
}

async function revealAndSettle(page) {
  const revealBtn = page.getByRole("button", { name: "Reveal all" });
  await revealBtn.tap({ timeout: 5000 }).catch(() => {});
  // reveal-all flips cards one at a time "per beat", then auto-settles —
  // give it plenty of room to finish.
  await page.waitForTimeout(2500);
}

async function captureStates(ctx, label) {
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const out = {};

  // The true worst case for the one-row bar rule: Betting with NO bet down
  // yet, where Controls also renders "Watch hand" (5 buttons: Deal, Watch
  // hand, Reveal all, New Shoe, Explain).
  out.bettingNoBets = { ...(await measure(page)), label: `${label} / Betting (no bets, 5 buttons)` };

  await betPlayerOnce(page);
  out.betting = { ...(await measure(page)), label: `${label} / Betting (bet down)` };

  await dealCoup(page);
  out.dealing = { ...(await measure(page)), label: `${label} / Dealing` };

  await revealAndSettle(page);
  out.settled = { ...(await measure(page)), label: `${label} / Settled` };

  await page.close();
  return out;
}

async function captureMidBettingHeight(browser, viewport) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await betPlayerOnce(page);
  const m = await measure(page);
  await ctx.close();
  return { viewport, scrollWidth: m.scrollWidth, scrollHeight: m.scrollHeight, barHeight: m.barHeight };
}

const out = { generatedAt: new Date().toISOString() };
const browser = await chromium.launch();

// --- iPhone 14 (390x844) ---
const iphoneCtx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
out.iphone14_390x844 = await captureStates(iphoneCtx, "iPhone 14 (390x844)");
await iphoneCtx.close();

// --- 360x780 Android-like (no exact device descriptor; touch + DPR by hand) ---
const androidCtx = await browser.newContext({
  viewport: { width: 360, height: 780 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  locale: "en-US",
});
out.android_360x780 = await captureStates(androidCtx, "360x780 Android-like");
await androidCtx.close();

// --- 390x664 Mid Betting document-height regression check ---
out.midBetting_390x664 = await captureMidBettingHeight(browser, { width: 390, height: 664 });

console.log(JSON.stringify(out, null, 2));
await browser.close();
