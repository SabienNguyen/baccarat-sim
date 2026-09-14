// End-to-end check for the ready-up feature: two browser contexts join the
// same Mid table, both bet, and the coup deals only once the last seat
// readies up. Run against a live dev server + table service:
//
//   cargo run -p baccarat-server &            # port 8788
//   (cd web && npx vite --port 5178 --strictPort) &
//   VITE_WS_URL=ws://localhost:8788/ws node scripts/mp-ready-probe.mjs
//
// (the dev server proxies /ws to the table service by default; set
// VITE_WS_URL only if you need to point at a different one.)
import { chromium } from "playwright-core";

const BASE = `http://localhost:${process.env.PORT ?? 5178}`;

async function openPlayer(browser, name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Multiplayer/ }).click();
  await page.getByLabel("Your name").fill(name);
  return page;
}

async function dealerLine(page) {
  return (await page.locator(".dealer-line").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

const browser = await chromium.launch();
try {
  const alice = await openPlayer(browser, "alice");
  const bob = await openPlayer(browser, "bob");

  // Alice opens a Mid table.
  await alice.getByRole("button", { name: /Mid Roller/ }).click();
  await alice.getByRole("button", { name: "Create table" }).click();
  await alice.waitForSelector(".mp-roomtag");
  const room = (await alice.locator(".mp-roomtag strong").innerText()).trim();
  console.log(`room: ${room}`);

  // Bob joins with the code.
  await bob.locator(".mp-code").fill(room);
  await bob.getByRole("button", { name: "Join", exact: true }).click();
  await bob.waitForSelector(".mp-roomtag");

  // Both seats bet the table minimum (the armed chip defaults to it, F18).
  await alice.getByRole("button", { name: "Bet Player" }).click();
  await bob.getByRole("button", { name: "Bet Banker" }).click();
  await alice.waitForTimeout(300);
  await bob.waitForTimeout(300);

  // Alice readies first: the dealer must say she's waiting on bob, not deal.
  await alice.getByRole("button", { name: "Ready" }).click();
  await alice.waitForTimeout(300);
  const afterAlice = { alice: await dealerLine(alice), bob: await dealerLine(bob) };
  console.log("after alice readies:", JSON.stringify(afterAlice));
  const waitingLine = afterAlice.alice.includes("Waiting on") || afterAlice.bob.includes("Waiting on");
  if (!waitingLine) throw new Error("expected a 'Waiting on' announcement before bob readies");
  const alicePhaseEarly = await alice.locator(".dealer-line").first().innerText().catch(() => "");
  if (alicePhaseEarly.toLowerCase().includes("dealing")) {
    throw new Error("table dealt before both seats were ready");
  }

  // Bob readies: the coup must deal for both pages.
  await bob.getByRole("button", { name: "Ready" }).click();
  await alice.waitForTimeout(500);
  await bob.waitForTimeout(500);

  // Betting shows empty card slots (.card-slot); Dealing deals real cards
  // (.card-dealt) — that distinguishes the phases without reading React state.
  const aliceDealt = (await alice.locator(".card-dealt").count()) > 0;
  const bobDealt = (await bob.locator(".card-dealt").count()) > 0;

  console.log(JSON.stringify({ aliceDealt, bobDealt }));
  if (!aliceDealt || !bobDealt) {
    throw new Error("cards were not dealt on both pages after the last seat readied up");
  }

  console.log("PASS: both pages reached Dealing once the last seat readied up");
} finally {
  await browser.close();
}
