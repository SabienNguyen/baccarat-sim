import type { RoundSnapshot, BetKind } from "../engine/types";
import { formatCents } from "../format";
import { CHIP_DENOMINATIONS } from "../store/gameStore";
import { Chip } from "./Chip";
import "./betrail.css";

interface BetRailProps {
  snapshot: RoundSnapshot;
  selectedChip: number;
  onSelectChip: (cents: number) => void;
  onPlaceBet: (kind: BetKind) => void;
  onPlaceChip: (kind: BetKind, cents: number) => void;
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
  onPlaceChip,
  onClear,
}: BetRailProps) {
  const betting = snapshot.phase === "Betting";
  return (
    <section aria-label="Bet rail" className="bet-rail panel">
      <div aria-label="Chips" className="chips">
        {CHIP_DENOMINATIONS.map((cents) => (
          <Chip
            key={cents}
            cents={cents}
            selected={selectedChip === cents}
            onSelect={onSelectChip}
          />
        ))}
      </div>

      <div aria-label="Spots" className="spots">
        {SPOTS.map((spot) => (
          <button
            key={spot.label}
            type="button"
            className="spot"
            disabled={!betting}
            onClick={() => onPlaceBet(spot.kind)}
            onDragOver={(e) => {
              if (betting) e.preventDefault(); // allow the chip to drop here
            }}
            onDrop={(e) => {
              e.preventDefault();
              const cents = Number(e.dataTransfer.getData("text/plain"));
              if (betting && Number.isFinite(cents) && cents > 0) {
                onPlaceChip(spot.kind, cents);
              }
            }}
          >
            Bet {spot.label}
          </button>
        ))}
      </div>

      <ul aria-label="Staged bets" className="staged">
        {snapshot.bets.map((bet, i) => (
          <li key={i}>
            <span>{`${describeBet(bet.kind)} ${formatCents(bet.amount)}`}</span>
          </li>
        ))}
      </ul>

      <button type="button" className="clear-bets" disabled={!betting} onClick={onClear}>
        Clear bets
      </button>
    </section>
  );
}
