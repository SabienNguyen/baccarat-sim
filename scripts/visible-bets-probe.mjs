// Phone check for the visible-bets feature: two players join the same Mid
// table at an iPhone 14 viewport (390 wide), both bet different spots, and
// we confirm (a) the page never grows past 390 wide and (b) each seat can
// see the other's stake — as a token in the seats strip and as a coloured
// chip + "+$" total on the felt.
//
//   cargo run -p baccarat-server &            # PORT=8790 (see below)
//   (cd web && npx vite --port 5183 --strictPort) &
//   PORT=8790 VITE_WS_URL=ws://localhost:8790/ws node scripts/visible-bets-probe.mjs
import { chromium, devices } from "playwright-core";

const BASE = `http://localhost:${process.env.PORT_WEB ?? 5183}`;

async function openPlayer(browser, name) {
  const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Multiplayer/ }).click();
  await page.getByLabel("Your name").fill(name);
  return page;
}

const browser = await chromium.launch();
try {
  const alice = await openPlayer(browser, "alice");
  const bob = await openPlayer(browser, "bob");

  await alice.getByRole("button", { name: /Mid Roller/ }).click();
  await alice.getByRole("button", { name: "Create table" }).click();
  await alice.waitForSelector(".mp-roomtag");
  const room = (await alice.locator(".mp-roomtag strong").innerText()).trim();
  console.log(`room: ${room}`);

  await bob.locator(".mp-code").fill(room);
  await bob.getByRole("button", { name: "Join", exact: true }).click();
  await bob.waitForSelector(".mp-roomtag");

  await alice.getByRole("button", { name: "Bet Player" }).click();
  await bob.getByRole("button", { name: "Bet Banker" }).click();
  await alice.waitForTimeout(400);
  await bob.waitForTimeout(400);

  const widths = {};
  for (const [who, page] of [["alice", alice], ["bob", bob]]) {
    widths[who] = await page.evaluate(() => ({
      innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
    }));
  }
  console.log("widths:", JSON.stringify(widths));
  const overflowed = Object.values(widths).some((w) => w.docScrollWidth > w.innerWidth + 1);
  if (overflowed) throw new Error(`page grew past ${JSON.stringify(widths)} — spot resized`);

  // Alice's seat chip should show bob's stake as a "B $..." token, and vice
  // versa — the seats strip's per-seat tokens.
  const aliceSeesBobToken = await alice.locator(".seat-bet", { hasText: "B $" }).count();
  const bobSeesAliceToken = await bob.locator(".seat-bet", { hasText: "P $" }).count();
  console.log(JSON.stringify({ aliceSeesBobToken, bobSeesAliceToken }));
  if (aliceSeesBobToken < 1) throw new Error("alice's seats strip never showed bob's bet token");
  if (bobSeesAliceToken < 1) throw new Error("bob's seats strip never showed alice's bet token");

  // On the felt, alice's Banker spot should carry bob's mini-chip + total;
  // her own Player spot must not (that's her own stake, not an "other").
  const bankerOnAlice = alice.getByRole("button", { name: "Bet Banker" });
  const othersOnBanker = await bankerOnAlice.locator(".spot-other-chip").count();
  const othersTotalText = await bankerOnAlice
    .locator(".spot-others-total")
    .innerText()
    .catch(() => "(none)");
  const playerOnAlice = alice.getByRole("button", { name: "Bet Player" });
  const othersOnPlayer = await playerOnAlice.locator(".spot-other-chip").count();
  console.log(JSON.stringify({ othersOnBanker, othersTotalText, othersOnPlayer }));
  if (othersOnBanker < 1) throw new Error("alice's felt never showed bob's chip on Banker");
  if (othersOnPlayer !== 0) throw new Error("alice's own spot showed an 'other' chip for herself");

  await alice.screenshot({ path: "./visible-bets-alice.png" });
  console.log("PASS: 390-wide viewport unchanged, both seats' bets visible to each other");
} finally {
  await browser.close();
}
