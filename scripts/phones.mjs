#!/usr/bin/env node
// Three-phone (or N-phone) multiplayer manual-testing harness.
//
// Starts (or reuses) the Rust table service and the Vite dev server, then
// opens N headed Chromium windows — one browser instance per phone, each
// emulating a real device via playwright-core's `devices` presets — laid out
// left to right so a person can bet/deal/squeeze across several "phones" at
// once. See docs/TESTING.md for the manual multiplayer script to run once
// the windows are up.
//
// Note on landing page: App.tsx only enters multiplayer mode for a *non-empty*
// `?room=` / `?watch=` code (an empty query value is falsy in JS, so `?room=`
// alone lands back on the home screen), and the multiplayer lobby has no URL
// param for its table-tier selector. So there is no URL that lands directly
// on the multiplayer lobby — each phone opens the home screen, and the
// manual script below says to click "Multiplayer" from there.
import { chromium, devices } from "playwright-core";
import { spawn } from "node:child_process";
import net from "node:net";

const args = parseArgs(process.argv.slice(2));
const N = Number(args.n ?? 3);
const DEVICE_NAME = args.device ?? "iPhone 14";
const TIER = args.tier ?? "mid";
const HEADLESS = Boolean(args.headless);
const VITE_PORT = Number(args["vite-port"] ?? 5173);
const SERVER_PORT = Number(args["server-port"] ?? 8788);
const GAP = 20;

if (!["low", "mid", "high"].includes(TIER)) {
  console.error(`--tier must be low|mid|high, got "${TIER}"`);
  process.exit(1);
}
if (!devices[DEVICE_NAME]) {
  console.error(`Unknown device "${DEVICE_NAME}" (see playwright-core's devices list)`);
  process.exit(1);
}

/** Child processes WE spawned (so we never kill something already running). */
const spawned = [];
/** Browser instances we launched (one per phone). */
const browsers = [];
let shuttingDown = false;

async function main() {
  await ensureListening(SERVER_PORT, () =>
    spawnLogged("cargo", ["run", "-p", "baccarat-server"], {
      cwd: repoRoot(),
      env: { ...process.env, PORT: String(SERVER_PORT) },
    }, "server"),
    180_000,
  );

  await ensureListening(VITE_PORT, () =>
    spawnLogged(
      "npx",
      ["vite", "--port", String(VITE_PORT), "--strictPort"],
      { cwd: new URL("../web/", import.meta.url).pathname },
      "vite",
    ),
    60_000,
  );

  const device = devices[DEVICE_NAME];
  const width = device.viewport.width;
  const height = device.viewport.height;
  const windowWidth = width + 16; // rough chrome allowance
  const windowHeight = height + 90;

  for (let i = 0; i < N; i++) {
    const x = i * (windowWidth + GAP);
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: HEADLESS ? [] : [`--window-position=${x},0`, `--window-size=${windowWidth},${windowHeight}`],
    });
    browsers.push(browser);
    const ctx = await browser.newContext({ ...device, locale: "en-US" });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: "networkidle" });
    console.log(`phone ${i + 1}: window at x=${x}, ${windowWidth}x${windowHeight} (${DEVICE_NAME})`);
  }

  printBanner();

  if (HEADLESS) {
    // Smoke-test mode: prove the harness starts cleanly, then tear down.
    await shutdown(0);
    return;
  }

  await new Promise(() => {}); // wait for Ctrl-C
}

function printBanner() {
  console.log("");
  console.log("==================== phones ====================");
  console.log(`${N} phone(s) up, device="${DEVICE_NAME}", tier=${TIER}`);
  console.log(`server: http://localhost:${SERVER_PORT}  web: http://localhost:${VITE_PORT}`);
  console.log("");
  console.log("Manual multiplayer script (docs/TESTING.md has the full version):");
  console.log("  1. Phone 1: click Multiplayer, pick a tier, Create table.");
  console.log("  2. Phones 2-3: click Multiplayer, enter the code, Join.");
  console.log("  3. Everyone bets, phone 1 deals.");
  console.log("  4. Squeeze on whichever phone holds the hand; dealer flip request.");
  console.log("  5. Settle. One phone leaves. One phone watches from the rail (?watch=CODE).");
  console.log("  6. Rename a seat. Reload one phone to confirm its seat is reclaimed.");
  console.log("");
  console.log("Ctrl-C to close every window and stop anything this script started.");
  console.log("=================================================");
}

async function ensureListening(port, spawnFn, timeoutMs) {
  if (await isListening(port)) {
    console.log(`[phones] port ${port} already listening — reusing it`);
    return;
  }
  console.log(`[phones] nothing on ${port} yet — starting it`);
  spawnFn();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isListening(port)) {
      console.log(`[phones] port ${port} is up (${Date.now() - start}ms)`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for port ${port} to accept connections`);
}

function isListening(port) {
  // "localhost" (not a hardcoded 127.0.0.1): Vite's dev server binds only
  // the IPv6 loopback ([::1]) by default, so a literal v4 address here would
  // never see it come up.
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "localhost" });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

function spawnLogged(cmd, cmdArgs, opts, label) {
  const child = spawn(cmd, cmdArgs, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  spawned.push(child);
  const prefix = (data) =>
    data
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => `[${label}] ${line}`)
      .join("\n");
  child.stdout.on("data", (d) => console.log(prefix(d)));
  child.stderr.on("data", (d) => console.error(prefix(d)));
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[${label}] exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });
  return child;
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[phones] shutting down...");
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
  for (const child of spawned) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function repoRoot() {
  return new URL("../", import.meta.url).pathname;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
