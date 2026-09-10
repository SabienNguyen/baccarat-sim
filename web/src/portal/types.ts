/**
 * The seam between the game and a web game portal's SDK (CrazyGames, Armor
 * Games, Newgrounds, itch.io, ...). The game only ever talks to this surface;
 * a portal-specific adapter maps it onto that portal's SDK, and the null
 * adapter (the default) makes every call a no-op so the plain site never
 * loads or contacts anything.
 */
export interface PortalAdapter {
  /** "none" for the null adapter, otherwise the portal's id (e.g. "crazygames"). */
  readonly name: string;
  /** Load and initialise the portal SDK. Never rejects: a broken SDK degrades to no-ops. */
  init(): Promise<void>;
  /** The player is actively at the table (first deal, or play resumed after a modal). */
  gameplayStart(): void;
  /** Play is interrupted (a modal is up). */
  gameplayStop(): void;
  /** A moment worth celebrating (the table was beaten). */
  happyTime(): void;
  /** A natural break in play (a fresh shoe). Resolves when the ad is over or was skipped. */
  requestMidgameAd(): Promise<void>;
  /** Show a rewarded ad; resolves `true` only if the player watched it through. */
  requestRewardedAd(): Promise<boolean>;
  /** Whether a rewarded ad can be offered right now. */
  canShowRewardedAd(): boolean;
}
