import type { Outcome } from "./engine/types";

/**
 * The round's result, in words. The wire format is a Rust enum variant, so
 * rendering it directly put "BankerWin" on the felt — and the display font is
 * all-caps, which made it read as "BANKERWIN".
 */
export function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case "PlayerWin":
      return "Player win";
    case "BankerWin":
      return "Banker win";
    case "Tie":
      return "Tie";
  }
}

/** Format integer cents as a US dollar string, e.g. 100000 -> "$1,000.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  const grouped = dollars.toLocaleString("en-US");
  return `${sign}$${grouped}.${remainder}`;
}
