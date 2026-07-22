import type { Side } from "./engine/types";

/**
 * Whether the local player may squeeze (peek/reveal) a given hand.
 *
 * The house dealer turns the hands nobody bet — its pacer auto-flips them — so
 * those must NOT be grabbable, or the player races the pacer on cards that
 * aren't theirs. You squeeze only the side(s) you bet.
 *
 * Single-player: the local player is id 0, so a hand is yours when its squeezer
 * is 0; a `null` squeezer means the dealer holds it.
 * Multiplayer: the server enforces squeeze rights (rejecting NotYourSqueeze) and
 * the client doesn't track its own seat id, so leave those cards interactive.
 */
export function canSqueeze(
  side: Side,
  seats: readonly unknown[] | null,
  squeezers: { player: number | null; banker: number | null } | null,
): boolean {
  if (seats !== null) return true; // multiplayer: server-authoritative
  if (squeezers === null) return true; // a plain session has no house dealer
  return side === "Player" ? squeezers.player === 0 : squeezers.banker === 0;
}
