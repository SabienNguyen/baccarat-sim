/** Each table tier keeps its own persisted bankroll. */
function keyFor(tier: string): string {
  return `baccarat.bankroll.${tier}`;
}

/**
 * Bumped when the stored shape changes, so a loader can migrate (or
 * knowingly discard) old values instead of silently resetting the roll.
 */
const SCHEMA_VERSION = 1;

/**
 * Persist the player's bankroll (in cents) across reloads, per table tier.
 * All access is guarded so a disabled/unavailable Storage (private mode, SSR)
 * degrades to "no persistence" instead of throwing. Storage is injectable for
 * tests.
 */
export function loadBankroll(
  tier: string,
  storage: Storage | undefined = safeStorage(),
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(tier));
    if (raw === null) return null;
    // v1 envelope: {"v":1,"cents":N}. Pre-versioning saves were a bare
    // number string — still read, so an upgrade never wipes a saved roll.
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { v?: number; cents?: number };
      if (parsed.v !== SCHEMA_VERSION) return null;
      const cents = parsed.cents;
      return typeof cents === "number" && Number.isFinite(cents) && cents >= 0
        ? Math.floor(cents)
        : null;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function saveBankroll(
  tier: string,
  cents: number,
  storage: Storage | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(tier), JSON.stringify({ v: SCHEMA_VERSION, cents: Math.floor(cents) }));
  } catch {
    /* ignore: persistence is best-effort */
  }
}

export function clearBankroll(tier: string, storage: Storage | undefined = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(tier));
  } catch {
    /* ignore */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
