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

    // T2b's glyph-button fix (road "?", bonus "i", volume mute/music) is a
    // real, out-of-flow `::before` hit-expander: `position: relative` on the
    // button, an absolutely-positioned `::before` with a negative `inset`
    // that pads the *actual* tappable area out to 44px without the visible
    // chip growing or the surrounding layout (a road heading, a HUD row)
    // taking any extra space. A tap landing in that pseudo-element's box is
    // a tap on the host button (generated content participates in hit
    // testing the same as any other descendant box), so it's a legitimate
    // enlargement of the real hit area — but `el.getBoundingClientRect()`
    // only reports the host's own box, not its pseudo-elements', so a plain
    // rect check would still flag these as under-44 after the fix. Compute
    // the effective hit rect the same way the browser would: the host's own
    // box, extended by however far a `position: absolute` `::before` (with
    // no explicit width/height, so pure inset-driven sizing against the
    // host's own padding box as the containing block) pushes past each edge.
    const effectiveHitRect = (el, hostRect) => {
      const cs = getComputedStyle(el, "::before");
      if (!cs || cs.content === "none") return hostRect;
      if (cs.position !== "absolute" && cs.position !== "fixed") return hostRect;
      const num = (v) => (v === "auto" || v == null ? null : parseFloat(v));
      const top = num(cs.top);
      const right = num(cs.right);
      const bottom = num(cs.bottom);
      const left = num(cs.left);
      if (top == null || right == null || bottom == null || left == null) {
        // width/height set some other way (not pure inset) — not the pattern
        // used here, and not safe to infer a size from, so don't credit it.
        return hostRect;
      }
      const extraW = Math.max(0, -left) + Math.max(0, -right);
      const extraH = Math.max(0, -top) + Math.max(0, -bottom);
      return { width: hostRect.width + extraW, height: hostRect.height + extraH };
    };

    // WCAG 2.5.5/2.5.8 Target Size's own "inline" exception: a link/button
    // that appears as a run of words inside a sentence or block of prose
    // (e.g. the dealer's dialogue line, `.term` in glossary.css) is exempt —
    // the surrounding text is the click/tap context, not a cramped icon.
    // Detected structurally rather than by class name: an inline(-block)
    // element with real sibling text directly in the same parent.
    const isInlineTextLink = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display !== "inline" && cs.display !== "inline-block") return false;
      // `.term` (glossary.css) is wrapped in its own thin `<span
      // class="glossary-term">` (for the popover), which is itself inline —
      // the real sentence text is a level up (`.dealer-text`'s other
      // segment spans). Climb through purely-inline wrapper ancestors
      // looking for that prose, but stop at the first block-level (or
      // flex/grid) parent: past that boundary a "sibling" is a layout
      // neighbour, not running text (e.g. the "Flip one"/"Flip both" pair,
      // each other's only sibling in a `display: flex` row, must NOT exempt
      // either button).
      let node = el;
      for (let depth = 0; depth < 4; depth++) {
        const parent = node.parentElement;
        if (!parent) return false;
        let proseText = "";
        parent.childNodes.forEach((n) => {
          if (n === node) return;
          if (n.nodeType === 3) {
            proseText += n.textContent;
          } else if (n.nodeType === 1 && !(n.matches && n.matches(sel))) {
            proseText += n.textContent || "";
          }
        });
        if (proseText.trim().length > 0) return true;
        const pd = getComputedStyle(parent).display;
        if (pd !== "inline" && pd !== "inline-block") return false;
        node = parent;
      }
      return false;
    };

    const under44 = [];
    document.querySelectorAll(sel).forEach((el) => {
      if (isVisuallyHidden(el)) return;
      if (isInlineTextLink(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const hit = effectiveHitRect(el, r);
      if (hit.width < 44 || hit.height < 44) {
        under44.push({
          tag: el.tagName,
          cls: typeof el.className === "string" ? el.className : String(el.className),
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
          w: Math.round(r.width * 100) / 100,
          h: Math.round(r.height * 100) / 100,
          hitW: Math.round(hit.width * 100) / 100,
          hitH: Math.round(hit.height * 100) / 100,
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

    // Deal must read as the primary action: its computed background-color
    // should be the resolved `--gold` token, not the same red as every other
    // `.controls .btn`. Resolve the token the same way the browser does (as
    // an rgb() string) via a throwaway element, rather than string-comparing
    // a hex literal against a computed rgb() — they'd never match.
    let dealBackground = null;
    let goldTokenBackground = null;
    const dealBtn = document.querySelector(".controls .btn--primary");
    if (dealBtn) {
      dealBackground = getComputedStyle(dealBtn).backgroundColor;
      const swatch = document.createElement("div");
      swatch.style.background = getComputedStyle(document.documentElement).getPropertyValue("--gold");
      document.body.appendChild(swatch);
      goldTokenBackground = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
    }

    return {
      under44,
      underFloor,
      barHeight: barRect ? Math.round(barRect.height * 100) / 100 : null,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dealBackground,
      goldTokenBackground,
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

// Assertion: Deal must read as gold (`.btn--primary`), not the same red as
// every other `.controls .btn`, specifically in the Betting-with-a-bet state
// (the task's named check) on both device contexts.
const assertionFailures = [];
for (const [device, states] of [
  ["iphone14_390x844", out.iphone14_390x844],
  ["android_360x780", out.android_360x780],
]) {
  const m = states.betting;
  if (!m.dealBackground || !m.goldTokenBackground) {
    assertionFailures.push(`${device}: Deal button or --gold token not found`);
  } else if (m.dealBackground !== m.goldTokenBackground) {
    assertionFailures.push(
      `${device}: Deal background is ${m.dealBackground}, expected the gold token's ${m.goldTokenBackground}`,
    );
  }
}
out.dealGoldAssertion = assertionFailures.length === 0 ? "PASS" : assertionFailures;

console.log(JSON.stringify(out, null, 2));
if (assertionFailures.length > 0) {
  console.error("FAIL: Deal is not gold in Betting (bet down):", assertionFailures);
  process.exitCode = 1;
}
await browser.close();
