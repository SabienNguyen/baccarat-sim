// Wire types for the table service — mirrors server/src/protocol.rs.

import type { BetKind, FlipRequest, PlacedBet, RoundSnapshot, Side } from "../engine/types";
import type { TableTier } from "../tables";

/** Chairs at a table — mirrors the server's MAX_SEATS. */
export const MAX_SEATS = 7;

/** One seat's public face, shown to the whole table. */
export interface SeatView {
  id: number;
  name: string;
  bankroll: number;
  staked: number;
  /** This seat's staged bets — the same money `staked` totals. */
  bets: PlacedBet[];
  sitting_out: boolean;
  /** Declared ready to deal (requires a bet). Reset every coup. */
  ready: boolean;
  /** Sitting out, ready, or broke — the deal waits for everyone to decide. */
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
  /** Spectators at the rail (absent from a server that predates them). */
  watchers?: number;
}

export type ClientMsg =
  | { type: "list_rooms" }
  | { type: "create_room"; name: string; tier: TableTier; private: boolean }
  | { type: "join_room"; room: string; name: string }
  | { type: "rejoin"; room: string; token: string }
  /** Stand behind the seats: every push, no chair. Works on a full table. */
  | { type: "watch"; room: string }
  /** Keepalive while watching — a spectator otherwise never speaks. */
  | { type: "ping" }
  | { type: "leave" }
  | { type: "rename"; name: string }
  | { type: "bet"; kind: BetKind; amount: number }
  | { type: "sit_out" }
  | { type: "clear_bets" }
  /** Declare ready to deal (requires a bet); once everyone is, the coup deals. */
  | { type: "ready" }
  /** Take back a ready declaration. */
  | { type: "unready" }
  | { type: "deal" }
  | { type: "peek"; hand: Side; index: number }
  | { type: "reveal"; hand: Side; index: number }
  /** Ask the dealer to turn one/both house cards early (the squeezer only). */
  | { type: "dealer_flip"; count: FlipRequest }
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
  | {
      type: "watching";
      room: string;
      tier: TableTier;
      view: TableViewMsg;
      proto?: number;
      watchers?: number;
    }
  | { type: "state"; view: TableViewMsg; watchers?: number }
  /** Stood up. `reason` when the server did it (the table closed under us). */
  | { type: "left"; reason?: string }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };

/**
 * Where the table service lives, if it is not the host serving this page.
 *
 * Set `VITE_WS_URL` at build time when the site and the table service are on
 * different hosts — a static site on GitHub Pages plus a server elsewhere. When
 * one host serves both (a VPS, or the server's own SPA_DIR), leave it unset and
 * the client uses `/ws` on its own origin, which needs no configuration and
 * cannot drift out of date.
 */
export function socketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  // Same origin as the page. `wss:` follows `https:` so a secure page never
  // opens an insecure socket, which browsers block as mixed content anyway.
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
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

/**
 * The table this tab is watching, so a dropped socket (or a reload) puts the
 * spectator back at the same rail. No credential is needed — watching is
 * open to anyone with the code — so this is just the code. Same lifetime as
 * the seat token: the tab, not the browser.
 */
const WATCH_KEY = "baccarat.watch";

export function saveWatchRoom(room: string): void {
  try {
    sessionStorage.setItem(WATCH_KEY, room);
  } catch {
    /* private mode, or storage full — a reconnect lands in the lobby */
  }
}

export function loadWatchRoom(): string | null {
  try {
    const room = sessionStorage.getItem(WATCH_KEY);
    return room && room.length > 0 ? room : null;
  } catch {
    return null;
  }
}

export function clearWatchRoom(): void {
  try {
    sessionStorage.removeItem(WATCH_KEY);
  } catch {
    /* nothing to do */
  }
}
