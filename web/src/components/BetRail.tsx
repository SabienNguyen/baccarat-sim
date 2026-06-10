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
  /** Accessible label; the button's name is `Bet {label}`. */
  label: string;
  /** Felt display text. */
  display: string;
  /** Payout caption shown under the name. */
  payout: string;
  kind: BetKind;
}

const MAIN_SPOTS: Spot[] = [
  { label: "Player", display: "PLAYER", payout: "PAYS 1 TO 1", kind: { Main: "Player" } },
  { label: "Tie", display: "TIE", payout: "PAYS 8 TO 1", kind: { Main: "Tie" } },
  { label: "Banker", display: "BANKER", payout: "PAYS 0.95 TO 1", kind: { Main: "Banker" } },
];

const SIDE_SPOTS: Spot[] = [
  { label: "Player Pair", display: "P PAIR", payout: "11:1", kind: { Side: "PlayerPair" } },
  { label: "Banker Pair", display: "B PAIR", payout: "11:1", kind: { Side: "BankerPair" } },
  { label: "Dragon 7", display: "DRAGON 7", payout: "40:1", kind: { Side: "Dragon7" } },
  { label: "Panda 8", display: "PANDA 8", payout: "25:1", kind: { Side: "Panda8" } },
  { label: "Dragon Bonus", display: "DRAGON", payout: "BONUS", kind: { Side: { DragonBonus: "Player" } } },
  { label: "Tiger", display: "TIGER", payout: "varies", kind: { Side: "Tiger" } },
];

function describeBet(kind: BetKind): string {
  if ("Main" in kind) return kind.Main;
  if (typeof kind.Side === "string") return kind.Side;
  return Object.keys(kind.Side)[0];
}

interface BetSpotProps {
  spot: Spot;
  betting: boolean;
  staked: number;
  shape: string;
  onPlaceBet: (kind: BetKind) => void;
  onPlaceChip: (kind: BetKind, cents: number) => void;
}

function BetSpot({ spot, betting, staked, shape, onPlaceBet, onPlaceChip }: BetSpotProps) {
  return (
    <button
      type="button"
      className={`spot spot--${shape}`}
      aria-label={`Bet ${spot.label}`}
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
      <span className="spot-name">{spot.display}</span>
      <span className="spot-payout">{spot.payout}</span>
      {staked > 0 && <span className="spot-stake">{formatCents(staked)}</span>}
    </button>
  );
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

  // Sum what's already staked on each spot so the felt shows the live wager.
  const stakedOn = (kind: BetKind): number =>
    snapshot.bets
      .filter((b) => JSON.stringify(b.kind) === JSON.stringify(kind))
      .reduce((sum, b) => sum + b.amount, 0);

  return (
    <section aria-label="Bet rail" className="bet-rail panel">
      <div className="felt" aria-label="Spots">
        <div className="side-bets">
          {SIDE_SPOTS.map((spot) => (
            <BetSpot
              key={spot.label}
              spot={spot}
              betting={betting}
              staked={stakedOn(spot.kind)}
              shape="side"
              onPlaceBet={onPlaceBet}
              onPlaceChip={onPlaceChip}
            />
          ))}
        </div>
        <div className="main-bets">
          {MAIN_SPOTS.map((spot) => (
            <BetSpot
              key={spot.label}
              spot={spot}
              betting={betting}
              staked={stakedOn(spot.kind)}
              shape={spot.label.toLowerCase()}
              onPlaceBet={onPlaceBet}
              onPlaceChip={onPlaceChip}
            />
          ))}
        </div>
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
    </section>
  );
}
