// Wire types for the table service — mirrors server/src/protocol.rs.

import type { BetKind, RoundSnapshot, Side } from "../engine/types";
import type { TableTier } from "../tables";

/** One seat's public face, shown to the whole table. */
export interface SeatView {
  id: number;
  name: string;
  bankroll: number;
  staked: number;
}

/** The player's snapshot plus everyone's seat summaries. */
export type TableViewMsg = RoundSnapshot & { seats: SeatView[] };

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
  | { type: "leave" }
  | { type: "bet"; kind: BetKind; amount: number }
  | { type: "clear_bets" }
  | { type: "deal" }
  | { type: "peek"; hand: Side; index: number }
  | { type: "reveal"; hand: Side; index: number }
  | { type: "settle" }
  | { type: "new_shoe" };

export type ServerMsg =
  | { type: "rooms"; rooms: RoomInfo[] }
  | { type: "joined"; room: string; player: number; tier: TableTier; view: TableViewMsg }
  | { type: "state"; view: TableViewMsg }
  | { type: "left" }
  | { type: "error"; message: string };

/** Same-origin socket URL (vite dev proxies /ws to the server). */
export function socketUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
