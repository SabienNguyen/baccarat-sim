import { useState } from "react";
import type { RoundSnapshot, BetKind, PlacedBet } from "../engine/types";
import { formatCents } from "../format";
import { toChips } from "../chips";
import { Chip, MiniChip } from "./Chip";
import { BonusInfoModal } from "./BonusInfoModal";
import "./betrail.css";

const SIDE_OPEN_KEY = "baccarat.sidebets.open";
function loadSideOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveSideOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDE_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable — fine */
  }
}

interface BetRailProps {
  snapshot: RoundSnapshot;
  denoms: number[];
  /** The armed chip denomination. */
  selectedChip: number;
  /** Cents free to bet (bankroll − staked). */
  available: number;
  onSelectChip: (denom: number) => void;
  onStake: (kind: BetKind, denom?: number) => void;
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

/** Total cents staked on one spot. */
function stakedOn(kind: BetKind, bets: PlacedBet[]): number {
  const key = JSON.stringify(kind);
  return bets.reduce((sum, b) => (JSON.stringify(b.kind) === key ? sum + b.amount : sum), 0);
}

interface BetSpotProps {
  spot: Spot;
  betting: boolean;
  staked: number;
  shape: string;
  denoms: number[];
  onStake: (kind: BetKind, denom?: number) => void;
}

function BetSpot({ spot, betting, staked, shape, denoms, onStake }: BetSpotProps) {
  const chips = toChips(staked, denoms).chips;
  return (
    <button
      type="button"
      className={`spot spot--${shape}`}
      aria-label={`Bet ${spot.label}`}
      disabled={!betting}
      onClick={() => onStake(spot.kind)}
      onDragOver={(e) => {
        if (betting) e.preventDefault(); // allow the chip to drop here
      }}
      onDrop={(e) => {
        e.preventDefault();
        const cents = Number(e.dataTransfer.getData("text/plain"));
        if (betting && Number.isFinite(cents) && cents > 0) onStake(spot.kind, cents);
      }}
    >
      <span className="spot-name">{spot.display}</span>
      <span className="spot-payout">{spot.payout}</span>
      {staked > 0 && (
        <span className="spot-chips">
          {chips.slice(0, 8).map((c, i) => (
            <MiniChip key={i} cents={c} />
          ))}
          <span className="spot-stake">{formatCents(staked)}</span>
        </span>
      )}
    </button>
  );
}

export function BetRail({
  snapshot,
  denoms,
  selectedChip,
  available,
  onSelectChip,
  onStake,
  onClear,
}: BetRailProps) {
  const betting = snapshot.phase === "Betting";
  // After a settle the engine is already back in Betting; touching a spot
  // implicitly opens the next hand, so spots stay live in Settled too.
  const canBet = betting || snapshot.phase === "Settled";
  const [showBonusInfo, setShowBonusInfo] = useState(false);

  const sideStaked = snapshot.bets.some(
    (b) => typeof b.kind === "object" && "Side" in b.kind,
  );
  const [sideOpenPref, setSideOpenPref] = useState(loadSideOpen);
  // a live side bet forces the drawer open; otherwise the saved preference wins
  const sideOpen = sideOpenPref || sideStaked;
  const toggleSide = () => {
    const next = !sideOpen;
    setSideOpenPref(next);
    saveSideOpen(next);
  };

  return (
    <section aria-label="Bet rail" className="bet-rail">
      <div className="felt" aria-label="Spots">
        <div className="main-bets">
          {MAIN_SPOTS.map((spot) => (
            <BetSpot
              key={spot.label}
              spot={spot}
              betting={canBet}
              staked={stakedOn(spot.kind, snapshot.bets)}
              shape={spot.label.toLowerCase()}
              denoms={denoms}
              onStake={onStake}
            />
          ))}
        </div>
        <div className="side-drawer">
          <div className="side-drawer-head">
            <button
              type="button"
              className="side-toggle"
              aria-expanded={sideOpen}
              aria-controls="side-bets"
              onClick={toggleSide}
            >
              {sideOpen ? "- " : "+ "}Side bets
            </button>
            <button
              type="button"
              className="bonus-info-btn"
              aria-label="What are the bonus bets?"
              onClick={() => setShowBonusInfo(true)}
            >
              i
            </button>
          </div>
          <div
            id="side-bets"
            className={`side-bets${sideOpen ? " side-bets--open" : ""}`}
            hidden={!sideOpen}
          >
            {SIDE_SPOTS.map((spot) => (
              <BetSpot
                key={spot.label}
                spot={spot}
                betting={canBet}
                staked={stakedOn(spot.kind, snapshot.bets)}
                shape="side"
                denoms={denoms}
                onStake={onStake}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="rail-row">
        <p className="rail-hint">
          {betting
            ? "Tap a chip, then tap a spot. Or drag a chip onto a spot."
            : snapshot.phase === "Settled"
              ? "Hand over — tap a spot to play the next one."
              : "Bets are locked — squeeze the cards."}
        </p>
        <button
          type="button"
          className="clear-bets"
          disabled={!betting || snapshot.bets.length === 0}
          onClick={onClear}
        >
          Clear bets
        </button>
      </div>

      <div aria-label="Chips" className="chips">
        {denoms.map((cents) => (
          <Chip
            key={cents}
            cents={cents}
            selected={cents === selectedChip}
            disabled={!canBet || cents > available}
            onSelect={onSelectChip}
          />
        ))}
        <span className="change-note">{formatCents(available)} to bet</span>
      </div>

      {showBonusInfo && <BonusInfoModal onClose={() => setShowBonusInfo(false)} />}
    </section>
  );
}
