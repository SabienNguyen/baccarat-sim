import type { RoundSnapshot, BetKind } from "../engine/types";
import { formatCents } from "../format";
import { CHIP_DENOMINATIONS } from "../store/gameStore";

interface BetRailProps {
  snapshot: RoundSnapshot;
  selectedChip: number;
  onSelectChip: (cents: number) => void;
  onPlaceBet: (kind: BetKind) => void;
  onClear: () => void;
}

interface Spot {
  label: string;
  kind: BetKind;
}

// A representative set of spots for the foundation (full SideBet family lands later).
const SPOTS: Spot[] = [
  { label: "Player", kind: { Main: "Player" } },
  { label: "Tie", kind: { Main: "Tie" } },
  { label: "Banker", kind: { Main: "Banker" } },
  { label: "Player Pair", kind: { Side: "PlayerPair" } },
  { label: "Banker Pair", kind: { Side: "BankerPair" } },
  { label: "Dragon 7", kind: { Side: "Dragon7" } },
  { label: "Panda 8", kind: { Side: "Panda8" } },
  { label: "Dragon Bonus (P)", kind: { Side: { DragonBonus: "Player" } } },
  { label: "Tiger", kind: { Side: "Tiger" } },
];

function describeBet(kind: BetKind): string {
  if ("Main" in kind) return kind.Main;
  if (typeof kind.Side === "string") return kind.Side;
  return Object.keys(kind.Side)[0];
}

export function BetRail({
  snapshot,
  selectedChip,
  onSelectChip,
  onPlaceBet,
  onClear,
}: BetRailProps) {
  const betting = snapshot.phase === "Betting";
  return (
    <section aria-label="Bet rail">
      <div aria-label="Chips">
        {CHIP_DENOMINATIONS.map((cents) => (
          <button
            key={cents}
            type="button"
            aria-pressed={selectedChip === cents}
            onClick={() => onSelectChip(cents)}
          >
            {formatCents(cents)} chip
          </button>
        ))}
      </div>

      <div aria-label="Spots">
        {SPOTS.map((spot) => (
          <button
            key={spot.label}
            type="button"
            disabled={!betting}
            onClick={() => onPlaceBet(spot.kind)}
          >
            Bet {spot.label}
          </button>
        ))}
      </div>

      <ul aria-label="Staged bets">
        {snapshot.bets.map((bet, i) => (
          <li key={i}>
            <span>{`${describeBet(bet.kind)} ${formatCents(bet.amount)}`}</span>
          </li>
        ))}
      </ul>

      <button type="button" disabled={!betting} onClick={onClear}>
        Clear bets
      </button>
    </section>
  );
}
