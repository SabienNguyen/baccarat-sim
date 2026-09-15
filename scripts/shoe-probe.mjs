// Task 10 end-to-end probe for the shoe lifecycle: solo cut + burn ceremony
// (iPhone 14), then a two-context multiplayer walk of cut -> Betting ->
// New Shoe vote -> cut again -> leave (no shoe change).
//
// ONE browser instance total. The solo part uses one context (closed before
// the multiplayer part opens its own two contexts, sequentially).
//
//   SHOT_DIR=/path PORT=5173 node scripts/shoe-probe.mjs
//
// Screenshots land in SHOT_DIR (default: cwd).
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.PORT ?? 5173;
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
mkdirSync(SHOT_DIR, { recursive: true });
const BASE = `http://localhost:${PORT}`;
const shot = (name) => join(SHOT_DIR, name);

const results = []; // { name, ok, detail }
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.error(`[${mark}] ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
}

/** Dispatch synthetic PointerEvents (pointerType "touch") on `selector`,
 *  same pattern as scripts/phone-probe-p14b.mjs's drag helper. */
async function dragTouch(page, selector, path) {
  return page.evaluate(
    ({ selector, path }) => {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, reason: "no element" };
      const fire = (type, x, y) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      };
      fire("pointerdown", path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) fire("pointermove", path[i].x, path[i].y);
      return { ok: true };
    },
    { selector, path },
  );
}

async function releaseTouch(page, selector, x, y) {
  return page.evaluate(
    ({ selector, x, y }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          clientX: x,
          clientY: y,
        }),
      );
    },
    { selector, x, y },
  );
}

async function waitGone(page, selector, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const n = await page.locator(selector).count();
    if (n === 0) return true;
    await page.waitForTimeout(100);
  }
  return (await page.locator(selector).count()) === 0;
}

async function runSolo(browser) {
  const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?tier=mid`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // 1. Stage up on load with "Cut the shoe".
  const title = await page.locator(".shoe-title").first().innerText().catch(() => "(missing)");
  record("solo: stage shows 'Cut the shoe' on load", title.trim() === "Cut the shoe", { title });

  // 2. Drag the cut card to ~60% of the stack width.
  const stackBox = await page.locator(".shoe-stack").boundingBox();
  const startX = stackBox.x + stackBox.width * 0.5;
  const midY = stackBox.y + stackBox.height / 2;
  const targetX = stackBox.x + stackBox.width * 0.6;
  await dragTouch(page, ".shoe-stack", [
    { x: startX, y: midY },
    { x: (startX + targetX) / 2, y: midY },
    { x: targetX, y: midY },
  ]);
  await page.waitForTimeout(150);
  await releaseTouch(page, ".shoe-stack", targetX, midY);
  await page.waitForTimeout(150);

  const valueNow = await page.locator("button.cut-card").getAttribute("aria-valuenow");
  const n = Number(valueNow);
  const near600 = Number.isFinite(n) && Math.abs(n - 600) <= 20;
  record("solo: drag to ~60% sets aria-valuenow ~= 600", near600, { valueNow });

  // 3. Tap "Cut here".
  const cutHere = page.locator("button.shoe-cut-confirm");
  const disabledBefore = await cutHere.getAttribute("disabled");
  await cutHere.tap();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("shoe-burn-mid.png") });
  record("solo: 'Cut here' enabled once card placed", disabledBefore === null, { disabledBefore });

  await page.waitForTimeout(1400); // total ~1.8s into the animation
  await page.screenshot({ path: shot("shoe-burn-late.png") });

  // 4. Stage gone within 3.5s total.
  const gone = await waitGone(page, ".shoe-stage", 3500 - 1800);
  record("solo: shoe-stage unmounts within 3.5s of the cut", gone);

  // 4b. Page scroll must be unlocked once the cut stage is gone (regression
  // check for the body/html overflow lock staying stuck after ShoeCutStage
  // is left permanently mounted by App).
  const overflows = await page.evaluate(() => ({
    body: getComputedStyle(document.body).overflow,
    html: getComputedStyle(document.documentElement).overflow,
  }));
  record(
    "solo: body overflow is unlocked after the cut stage hides",
    overflows.body !== "hidden",
    overflows,
  );
  record(
    "solo: html overflow is unlocked after the cut stage hides",
    overflows.html !== "hidden",
    overflows,
  );
  const scrollY = await page.evaluate(() => {
    window.scrollTo(0, 400);
    return window.scrollY;
  });
  record("solo: page actually scrolls after the cut stage hides", scrollY > 0, { scrollY });

  // 5. HUD phase reads Betting; tally shows "Shoe 1".
  const phase = await page.locator(".hud-box-value--phase").first().innerText().catch(() => "(missing)");
  record("solo: HUD phase reads Betting after the cut", phase.trim() === "Betting", { phase });

  const tally = await page.locator(".tally--shoe").first().innerText().catch(() => "(missing)");
  record("solo: tally shows 'Shoe 1'", tally.trim() === "Shoe 1", { tally });

  // 6. Bet Player, Deal, Reveal all, wait for Settled.
  await page.getByRole("button", { name: "Bet Player" }).tap();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Deal$/ }).tap();
  await page.waitForTimeout(600);
  const revealBtn = page.getByRole("button", { name: "Reveal all" });
  await revealBtn.tap().catch(() => {});
  let settled = false;
  for (let i = 0; i < 20; i++) {
    const p = await page.locator(".hud-box-value--phase").first().innerText().catch(() => "");
    if (p.trim() === "Settled") {
      settled = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  record("solo: reaches Settled after Deal + Reveal all", settled);

  await ctx.close();
}

async function joinRoom(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Multiplayer/ }).click();
  await page.getByLabel("Your name").fill(name);
  return { ctx, page };
}

async function phaseText(page) {
  return (await page.locator(".hud-box-value--phase").first().innerText().catch(() => "")).trim();
}
async function tallyText(page) {
  return (await page.locator(".tally--shoe").first().innerText().catch(() => "")).trim();
}
async function stageTitle(page) {
  return (await page.locator(".shoe-title").first().innerText().catch(() => "")).trim();
}

async function runMultiplayer(browser) {
  // A: creates a room.
  const a = await joinRoom(browser, "Alice");
  await a.page.getByRole("button", { name: /Mid Roller/ }).click();
  await a.page.getByRole("button", { name: "Create table" }).click();
  await a.page.waitForSelector(".mp-roomtag");
  const room = (await a.page.locator(".mp-roomtag strong").innerText()).trim();
  console.error(`room: ${room}`);

  // B: joins by code.
  const b = await joinRoom(browser, "Bob");
  await b.page.locator(".mp-code").fill(room);
  await b.page.getByRole("button", { name: "Join", exact: true }).click();
  await b.page.waitForSelector(".mp-roomtag");
  await a.page.waitForTimeout(400);
  await b.page.waitForTimeout(400);

  const bWaiting = await stageTitle(b.page);
  record("mp: B sees 'Waiting for Alice to cut the shoe'", bWaiting === "Waiting for Alice to cut the shoe", {
    bWaiting,
  });
  const aCutting = await stageTitle(a.page);
  record("mp: A sees 'Cut the shoe'", aCutting === "Cut the shoe", { aCutting });

  // A cuts via keyboard: focus button.cut-card, End, Enter.
  await a.page.locator("button.cut-card").focus();
  await a.page.keyboard.press("End");
  await a.page.keyboard.press("Enter");

  const aGone = await waitGone(a.page, ".shoe-stage", 3500);
  const bGone = await waitGone(b.page, ".shoe-stage", 3500);
  record("mp: A's stage gone after cut", aGone);
  record("mp: B's stage gone after cut", bGone);

  const aPhase = await phaseText(a.page);
  const bPhase = await phaseText(b.page);
  record("mp: both reach Betting", aPhase === "Betting" && bPhase === "Betting", { aPhase, bPhase });

  const aTally = await tallyText(a.page);
  const bTally = await tallyText(b.page);
  record("mp: both show 'Shoe 1'", aTally === "Shoe 1" && bTally === "Shoe 1", { aTally, bTally });

  // B proposes a new shoe.
  await b.page.getByRole("button", { name: "New shoe" }).click();
  await a.page.waitForTimeout(400);

  const voteRow = await a.page.locator(".vote-bar .vote-text").innerText().catch(() => "(missing)");
  const voteOk = voteRow.trim() === "New shoe? 1 of 2";
  record("mp: A's seat strip shows vote row 'New shoe? 1 of 2'", voteOk, { voteRow });
  await a.page.screenshot({ path: shot("shoe-vote-desktop.png") });

  if (!voteOk) {
    console.error(
      "STOPPING: vote row assertion failed — this looks like a real product wiring bug (see report).",
    );
    await a.ctx.close();
    await b.ctx.close();
    return;
  }

  // A votes yes.
  await a.page.getByRole("button", { name: "Vote yes" }).click();
  await a.page.waitForTimeout(400);
  await b.page.waitForTimeout(400);

  const aCutAgain = await stageTitle(a.page);
  const bWaitingAgain = await stageTitle(b.page);
  record("mp: after the vote passes, A is cutter again ('Cut the shoe')", aCutAgain === "Cut the shoe", {
    aCutAgain,
  });
  record("mp: B waits on Alice again", bWaitingAgain === "Waiting for Alice to cut the shoe", {
    bWaitingAgain,
  });

  // B leaves; A's stage is unchanged. B is still on the ShoeCut "Waiting for
  // Alice…" stage here, whose full-viewport backdrop (.shoe-stage, z-index 40)
  // sits over the HUD in normal document flow, so the HUD's own Lobby button
  // is present in the DOM but not clickable while the stage is up.
  // `ShoeCutStage` now renders its own "Leave table" button inside the stage
  // for exactly this case (see docs/BACKLOG.md's F21 row) — use that instead.
  const aStageBefore = await stageTitle(a.page);
  const leaveBtn = b.page.getByRole("button", { name: "Leave table" });
  let leaveClicked = false;
  let leaveError = null;
  try {
    if (await leaveBtn.count()) {
      await leaveBtn.click({ timeout: 3000 });
      leaveClicked = true;
    } else {
      await b.page.getByRole("button", { name: "Lobby" }).click({ timeout: 3000 });
      leaveClicked = true;
    }
  } catch (err) {
    leaveError = String(err).split("\n")[0];
  }
  record("mp: B can click Leave table to leave while waiting on the shoe cut", leaveClicked, {
    leaveError,
  });
  await a.page.waitForTimeout(400);
  const aStageAfter = await stageTitle(a.page);
  record("mp: A's stage unchanged after B leaves", aStageBefore === aStageAfter && aStageAfter === "Cut the shoe", {
    aStageBefore,
    aStageAfter,
  });

  await a.ctx.close();
  await b.ctx.close();
}

const browser = await chromium.launch();
try {
  await runSolo(browser);
  await runMultiplayer(browser);
} finally {
  await browser.close();
}

const failures = results.filter((r) => !r.ok);
console.log(JSON.stringify({ results, screenshotDir: SHOT_DIR }, null, 2));
if (failures.length > 0) {
  console.error(`\n${failures.length}/${results.length} ASSERTION(S) FAILED:`);
  for (const f of failures) console.error(`  - ${f.name}`);
  process.exit(1);
}
console.error(`\nAll ${results.length} assertions passed.`);
