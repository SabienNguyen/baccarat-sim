import type { BetKind } from "./engine/types";

export interface EdgeInfo {
  label: string;
  edge: string;
  basis: string;
}

/** House edge for the three main bets (standard commission baccarat, 8-deck). */
export function mainBetEdge(kind: BetKind): EdgeInfo | undefined {
  if (!("Main" in kind)) return undefined;
  switch (kind.Main) {
    case "Player":
      return { label: "Player", edge: "1.24%", basis: "pays 1:1" };
    case "Banker":
      return { label: "Banker", edge: "1.06%", basis: "pays 0.95:1 (5% commission)" };
    case "Tie":
      return { label: "Tie", edge: "14.36%", basis: "pays 8:1" };
  }
}
