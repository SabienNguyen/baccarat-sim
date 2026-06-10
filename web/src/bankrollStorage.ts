const KEY = "baccarat.bankroll";

/**
 * Persist the player's bankroll (in cents) across reloads. All access is guarded
 * so a disabled/unavailable Storage (private mode, SSR) degrades to "no persistence"
 * instead of throwing. Storage is injectable for tests.
 */
export function loadBankroll(storage: Storage | undefined = safeStorage()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function saveBankroll(cents: number, storage: Storage | undefined = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, String(Math.floor(cents)));
  } catch {
    /* ignore: persistence is best-effort */
  }
}

export function clearBankroll(storage: Storage | undefined = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
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
