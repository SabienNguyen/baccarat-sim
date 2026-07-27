// Wire types for the table service — mirrors server/src/protocol.rs.

import type { BetKind, RoundSnapshot, Side } from "../engine/types";
import type { TableTier } from "../tables";

/** One seat's public face, shown to the whole table. */
export interface SeatView {
  id: number;
  name: string;
  bankroll: number;
  staked: number;
  sitting_out: boolean;
  /** Bet down or sitting out — the deal waits for everyone to decide. */
  decided: boolean;
  /** Bankroll can't cover the table minimum, so this seat can't bet at all. */
  broke?: boolean;
}

/** The player's snapshot plus everyone's seat summaries and squeeze rights. */
export type TableViewMsg = RoundSnapshot & {
  seats: SeatView[];
  player_squeezer: number | null;
  banker_squeezer: number | null;
};

export interface RoomInfo {
  id: string;
  tier: TableTier;
  seats: number;
  max_seats: number;
}

export type ClientMsg =
  | { type: "list_rooms" }
  | { type: "create_room"; name: string; tier: TableTier; private: boolean }
  | { type: "join_room"; room: string; name: string }
  | { type: "rejoin"; room: string; token: string }
  | { type: "leave" }
  | { type: "bet"; kind: BetKind; amount: number }
  | { type: "sit_out" }
  | { type: "clear_bets" }
  | { type: "deal" }
  | { type: "peek"; hand: Side; index: number }
  | { type: "reveal"; hand: Side; index: number }
  | { type: "settle" }
  | { type: "new_shoe" };

export type ServerMsg =
  | { type: "rooms"; rooms: RoomInfo[] }
  | { type: "announce"; message: string }
  | {
      type: "joined";
      room: string;
      player: number;
      tier: TableTier;
      view: TableViewMsg;
      proto?: number;
      /** Credential for reclaiming this seat, bankroll intact, after a drop. */
      token?: string;
    }
  | { type: "state"; view: TableViewMsg }
  | { type: "left" }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };

/**
 * Fallback address of the table service; static hosts (GitHub Pages) have no
 * /ws of their own.
 *
 * Prefer the `VITE_WS_URL` build variable over editing this: the deploy workflow
 * passes the repository variable of that name straight through, so multiplayer
 * can move hosts without a source change. This constant is only what a build
 * with nothing configured falls back to.
 */
const PROD_WS_URL = "wss://baccarat-sim.fly.dev/ws";

/**
 * Socket URL for the table service. Priority: VITE_WS_URL (build-time
 * override), same-origin /ws in dev (vite proxies it to the local server),
 * else the deployed service.
 */
export function socketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  if (import.meta.env.DEV) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }
  return PROD_WS_URL;
}

/**
 * The reconnect credential for a room, kept in sessionStorage: it should
 * survive a reload or a dropped socket, but not outlive the browser tab — a
 * stale token on a shared machine is a seat with someone's money on it.
 */
const SEAT_KEY = "baccarat.seat";

export function saveSeatToken(room: string, token: string): void {
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify({ room, token }));
  } catch {
    // private mode, or storage full — reconnect degrades to a fresh buy-in
  }
}

/** The stored token for `room`, if the last seat taken was at that table. */
export function loadSeatToken(room: string): string | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { room?: unknown; token?: unknown };
    if (parsed.room !== room) return null;
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

/** Any stored seat, for reconnecting without knowing the room up front. */
export function loadSeat(): { room: string; token: string } | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { room?: unknown; token?: unknown };
    return typeof p.room === "string" && typeof p.token === "string"
      ? { room: p.room, token: p.token }
      : null;
  } catch {
    return null;
  }
}

export function clearSeatToken(): void {
  try {
    sessionStorage.removeItem(SEAT_KEY);
  } catch {
    /* nothing to do */
  }
}
