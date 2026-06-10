import { useState } from "react";
import type { RoundSnapshot, BetKind, PlacedBet } from "../engine/types";
import { formatCents } from "../format";
import { CHIP_DENOMINATIONS, type Rack } from "../chips";
import { Chip, MiniChip } from "./Chip";
import { BonusInfoModal } from "./BonusInfoModal";
import "./betrail.css";

interface BetRailProps {
  snapshot: RoundSnapshot;
  rack: Rack;
  hand: number[];
  change: number;
  stagedChips: number[][];
  onPickChip: (denom: number) => void;
  onReturnHand: () => void;
  onPlaceHand: (kind: BetKind) => void;
  onPlaceChip: (kind: BetKind, denom: number) => void;
  onClear: () => void;
  onOpenExchange: () => void;
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

/** The chips sitting on one spot: flatten staged chips whose bet matches. */
function chipsOn(kind: BetKind, bets: PlacedBet[], stagedChips: number[][]): number[] {
  const key = JSON.stringify(kind);
  const out: number[] = [];
  bets.forEach((bet, i) => {
    if (JSON.stringify(bet.kind) === key) out.push(...(stagedChips[i] ?? []));
  });
  return out;
}

interface BetSpotProps {
  spot: Spot;
  betting: boolean;
  chips: number[];
  shape: string;
  onPlaceHand: (kind: BetKind) => void;
  onPlaceChip: (kind: BetKind, denom: number) => void;
}

function BetSpot({ spot, betting, chips, shape, onPlaceHand, onPlaceChip }: BetSpotProps) {
  const staked = chips.reduce((a, b) => a + b, 0);
  return (
    <button
      type="button"
      className={`spot spot--${shape}`}
      aria-label={`Bet ${spot.label}`}
      disabled={!betting}
      onClick={() => onPlaceHand(spot.kind)}
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
      {chips.length > 0 && (
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
  rack,
  hand,
  change,
  stagedChips,
  onPickChip,
  onReturnHand,
  onPlaceHand,
  onPlaceChip,
  onClear,
  onOpenExchange,
}: BetRailProps) {
  const betting = snapshot.phase === "Betting";
  const handTotal = hand.reduce((a, b) => a + b, 0);
  const [showBonusInfo, setShowBonusInfo] = useState(false);

  return (
    <section aria-label="Bet rail" className="bet-rail">
      <div className="felt" aria-label="Spots">
        <button
          type="button"
          className="bonus-info-btn"
          aria-label="What are the bonus bets?"
          onClick={() => setShowBonusInfo(true)}
        >
          i
        </button>
        <div className="side-bets">
          {SIDE_SPOTS.map((spot) => (
            <BetSpot
              key={spot.label}
              spot={spot}
              betting={betting}
              chips={chipsOn(spot.kind, snapshot.bets, stagedChips)}
              shape="side"
              onPlaceHand={onPlaceHand}
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
              chips={chipsOn(spot.kind, snapshot.bets, stagedChips)}
              shape={spot.label.toLowerCase()}
              onPlaceHand={onPlaceHand}
              onPlaceChip={onPlaceChip}
            />
          ))}
        </div>
      </div>

      <div className="rail-row">
        {hand.length > 0 ? (
          <div className="hand-tray" aria-label="Chips in hand">
            <span className="hand-chips">
              {hand.map((c, i) => (
                <MiniChip key={i} cents={c} />
              ))}
            </span>
            <span className="hand-total">{formatCents(handTotal)} in hand — tap a spot</span>
            <button type="button" className="hand-return" onClick={onReturnHand}>
              Return
            </button>
          </div>
        ) : (
          <p className="rail-hint">Tap chips to pick up a stack, then tap a spot. Or drag a chip.</p>
        )}
        <button type="button" className="clear-bets" disabled={!betting} onClick={onClear}>
          Clear bets
        </button>
        <button type="button" className="exchange-btn" onClick={onOpenExchange}>
          Exchange
        </button>
      </div>

      <div aria-label="Chips" className="chips">
        {CHIP_DENOMINATIONS.map((cents) => (
          <Chip
            key={cents}
            cents={cents}
            count={rack[cents] ?? 0}
            onPick={onPickChip}
            disabled={!betting}
          />
        ))}
        {change > 0 && <span className="change-note">+{formatCents(change)} change</span>}
      </div>

      {showBonusInfo && <BonusInfoModal onClose={() => setShowBonusInfo(false)} />}
    </section>
  );
}
