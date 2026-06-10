/** Each table tier keeps its own persisted bankroll. */
function keyFor(tier: string): string {
  return `baccarat.bankroll.${tier}`;
}

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
    storage.setItem(keyFor(tier), String(Math.floor(cents)));
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
