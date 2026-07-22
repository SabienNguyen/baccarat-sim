import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { type GameState } from "./store/gameStore";
import { storeFor, resetStore } from "./store/useGameStore";
import { HomeScreen } from "./components/HomeScreen";
import { Multiplayer } from "./multiplayer/Multiplayer";
import { SeatsStrip } from "./multiplayer/SeatsStrip";
import type { TableTier } from "./tables";
import { isFaceUp } from "./cards";
import { visibleCardCount } from "./squeezeOrder";
import { canSqueeze } from "./squeezeRights";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { BetRail, type BetView } from "./components/BetRail";
import { BonusNudge } from "./components/BonusNudge";
import { chipFace } from "./components/Chip";
import { bonusWouldWin } from "./bonusNudge";
import { Controls } from "./components/Controls";
import { Scoreboard } from "./components/Scoreboard";
import { WinPopup } from "./components/WinPopup";
import { DealerLine } from "./components/DealerLine";
import { ExplainPanel } from "./components/ExplainPanel";
import { CutDeckModal } from "./components/CutDeckModal";
import { VictoryModal } from "./components/VictoryModal";
import { BustModal } from "./components/BustModal";
import { useGameSounds } from "./audio/useGameSounds";
import { playSfx } from "./audio/sfx";

/** Beat after the final card flips before the round resolves itself. */
const AUTO_SETTLE_MS = 600;
/** How long the settled cards + win/loss popup linger before the next hand.
 *  Long enough to read both hands and the result — they stay on the felt now. */
const AUTO_ADVANCE_MS = 2600;
/** A longer window when a bonus nudge is showing, so it can be read and tapped. */
const NUDGE_ADVANCE_MS = 3600;

interface AppProps {
  store?: StoreApi<GameState>;
}

/** Shell: home screen first; a chosen table mounts the game. An injected
 *  store (tests) goes straight to the table. */
export function App({ store }: AppProps = {}) {
  const [tier, setTier] = useState<TableTier | null>(store ? "mid" : null);
  const [multi, setMulti] = useState(false);
  const [resetSeq, setResetSeq] = useState(0);
  if (multi) {
    return <Multiplayer onExit={() => setMulti(false)} />;
  }
  if (tier === null) {
    return <HomeScreen onPlay={setTier} onMultiplayer={() => setMulti(true)} />;
  }
  const active = store ?? storeFor(tier);
  return (
    <GameTable
      key={`${tier}-${resetSeq}`}
      store={active}
      onLeave={() => setTier(null)}
      onReset={() => {
        resetStore(tier);
        setResetSeq((n) => n + 1); // remount at the same table with a fresh buy-in
      }}
    />
  );
}

interface GameTableProps {
  store: StoreApi<GameState>;
  onLeave: () => void;
  /** Reset the buy-in (single player only). */
  onReset?: () => void;
}

export function GameTable({ store: active, onLeave, onReset }: GameTableProps) {
  const [cutting, setCutting] = useState(false);
  // the MAIN/BONUS felt view, lifted so the nudge can fling it to BONUS
  const [betView, setBetView] = useState<BetView>("main");
  const snapshot = useStore(active, (s) => s.snapshot);
  const lastError = useStore(active, (s) => s.lastError);
  const lastFlip = useStore(active, (s) => s.lastFlip);
  const announcement = useStore(active, (s) => s.announcement);
  const lastDelta = useStore(active, (s) => s.lastDelta);
  const settleSeq = useStore(active, (s) => s.settleSeq);
  const denoms = useStore(active, (s) => s.denoms);
  const selectedChip = useStore(active, (s) => s.selectedChip);
  const selectChip = useStore(active, (s) => s.selectChip);
  const stake = useStore(active, (s) => s.stake);
  const clearBets = useStore(active, (s) => s.clearBets);
  const deal = useStore(active, (s) => s.deal);
  const peek = useStore(active, (s) => s.peek);
  const reveal = useStore(active, (s) => s.reveal);
  const settle = useStore(active, (s) => s.settle);
  const newHand = useStore(active, (s) => s.newHand);
  const newShoe = useStore(active, (s) => s.newShoe);
  const explainOn = useStore(active, (s) => s.explainOn);
  const toggleExplain = useStore(active, (s) => s.toggleExplain);
  const seats = useStore(active, (s) => s.seats);
  const squeezers = useStore(active, (s) => s.squeezers);
  const sitOut = useStore(active, (s) => s.sitOut);
  const goal = useStore(active, (s) => s.goal);
  const goalReached = useStore(active, (s) => s.goalReached);
  const dismissGoal = useStore(active, (s) => s.dismissGoal);
  const busted = useStore(active, (s) => s.busted);

  // every table noise rides the store: works for local and remote play alike
  useGameSounds(active);

  // Turn YOUR cards for you, one per beat, in ritual order. Hands you didn't
  // bet belong to the house dealer — his own pacer turns those, so this just
  // waits its turn whenever an earlier stage is still his to expose.
  const revealAll = () => {
    const order: Array<["Player" | "Banker", number]> = [
      ["Player", 0],
      ["Player", 1],
      ["Banker", 0],
      ["Banker", 1],
      ["Player", 2],
      ["Banker", 2],
    ];
    const stageOf = (side: "Player" | "Banker", idx: number): number =>
      idx < 2 ? (side === "Player" ? 1 : 2) : side === "Player" ? 3 : 4;
    const flipNext = (): boolean => {
      const { snapshot: snap, squeezers } = active.getState();
      if (snap.phase !== "Dealing") return false;
      const holds = (side: "Player" | "Banker"): boolean =>
        squeezers === null ||
        (side === "Player" ? squeezers.player === 0 : squeezers.banker === 0);
      const cardAt = (side: "Player" | "Banker", idx: number) =>
        (side === "Player" ? snap.player.cards : snap.banker.cards)[idx];
      for (const [side, idx] of order) {
        const card = cardAt(side, idx);
        if (card === undefined || isFaceUp(card)) continue;
        if (!holds(side)) continue; // the dealer's card — he turns it himself
        const ready = order.every(
          ([s, i]) =>
            stageOf(s, i) >= stageOf(side, idx) ||
            (() => {
              const c = cardAt(s, i);
              return c === undefined || isFaceUp(c);
            })(),
        );
        if (ready) reveal(side, idx);
        return true; // either flipped, or waiting on the dealer's stage
      }
      return false;
    };
    if (!flipNext()) return;
    const timer = setInterval(() => {
      if (!flipNext()) clearInterval(timer);
    }, 900);
  };

  // Gate the third card so the 2-vs-3 count can't leak whether a hand drew one.
  const playerVisible = visibleCardCount("Player", snapshot.player.cards, snapshot.banker.cards);
  const bankerVisible = visibleCardCount("Banker", snapshot.player.cards, snapshot.banker.cards);

  // The ritual: Banker cards stay down until the Player hand is exposed.
  // Hold the flip silently — peeking is fine, no dealer scolding needed.
  const bankerLocked =
    !isFaceUp(snapshot.player.cards[0] ?? "FaceDown") ||
    !isFaceUp(snapshot.player.cards[1] ?? "FaceDown");

  // free to bet = the roll minus live wagers. In Settled the bets are
  // already resolved (the bankroll reflects them), so the whole roll is free.
  const staked = snapshot.bets.reduce((a, b) => a + b.amount, 0);
  const available = snapshot.phase === "Settled" ? snapshot.bankroll : snapshot.bankroll - staked;

  // Single-player only: the round settles itself once every card is face-up,
  // then clears to the next hand after the win popup. Multiplayer keeps its
  // buttons (the authoritative server paces coups).
  const settledThisCoup = useRef(false);
  useEffect(() => {
    if (seats !== null) return;
    if (snapshot.phase !== "Dealing") {
      if (snapshot.phase === "Betting") settledThisCoup.current = false;
      return;
    }
    const all = [...snapshot.player.cards, ...snapshot.banker.cards];
    const allUp = all.length > 0 && all.every((c) => isFaceUp(c));
    if (!allUp || settledThisCoup.current) return;
    settledThisCoup.current = true;
    const t = setTimeout(settle, AUTO_SETTLE_MS);
    return () => clearTimeout(t);
  }, [seats, snapshot, settle]);

  // The "you would've won" nudge: a bonus that hit this resolved hand but the
  // player didn't place. Single-player only, never under a bust/goal modal.
  const nudge =
    seats === null && snapshot.phase === "Settled" && !busted && !goalReached
      ? bonusWouldWin(snapshot, snapshot.bets.map((b) => b.kind))
      : null;
  const hasNudge = nudge !== null;

  useEffect(() => {
    if (seats !== null) return;
    if (snapshot.phase !== "Settled" || busted || goalReached) return;
    const t = setTimeout(newHand, hasNudge ? NUDGE_ADVANCE_MS : AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [seats, snapshot.phase, busted, goalReached, newHand, hasNudge]);

  /** Tap the nudge: open the next hand and drop the armed chip on that bonus. */
  function betNudge() {
    if (nudge === null) return;
    setBetView("bonus");
    newHand();
    stake(nudge.kind);
  }

  return (
    <div className="app">
      <Hud
        snapshot={snapshot}
        goal={goal}
        onResetBankroll={onReset}
        onLeave={onLeave}
      />
      <main className="stage">
        {seats !== null && (
          <SeatsStrip seats={seats} squeezers={squeezers} betting={snapshot.phase !== "Dealing"} />
        )}
        <DealerLine
          snapshot={snapshot}
          lastError={lastError}
          lastFlip={lastFlip}
          announcement={announcement}
        />
        <div className="card-stage">
          <Hand
            side="Player"
            hand={snapshot.player}
            phase={snapshot.phase}
            visibleCount={playerVisible}
            winner={snapshot.outcome === "PlayerWin"}
            squeezable={canSqueeze("Player", seats, squeezers)}
            onPeek={(i) => peek("Player", i)}
            onReveal={(i) => reveal("Player", i)}
          />
          <Hand
            side="Banker"
            hand={snapshot.banker}
            phase={snapshot.phase}
            visibleCount={bankerVisible}
            winner={snapshot.outcome === "BankerWin"}
            squeezable={canSqueeze("Banker", seats, squeezers)}
            onPeek={(i) => peek("Banker", i)}
            onReveal={(i) => {
              if (!bankerLocked) reveal("Banker", i);
            }}
          />
        </div>
        <Controls
          snapshot={snapshot}
          onDeal={deal}
          onRevealAll={seats === null ? revealAll : undefined}
          onSettle={seats !== null ? settle : undefined}
          onNewHand={seats !== null ? newHand : undefined}
          onNewShoe={() => setCutting(true)}
          explainOn={explainOn}
          onToggleExplain={toggleExplain}
          onSitOut={seats !== null ? sitOut : undefined}
        />
        {nudge !== null && (
          <BonusNudge
            hit={nudge}
            betLabel={`bet ${chipFace(selectedChip)} next hand`}
            onBet={betNudge}
            onDismiss={newHand}
          />
        )}
        <BetRail
          snapshot={snapshot}
          denoms={denoms}
          selectedChip={selectedChip}
          available={available}
          onSelectChip={selectChip}
          onStake={stake}
          onClear={clearBets}
          view={betView}
          onView={setBetView}
        />
      </main>
      <div className="board-dock">
        <Scoreboard scoreboard={snapshot.scoreboard} />
        {explainOn && <ExplainPanel snapshot={snapshot} />}
      </div>
      <WinPopup key={settleSeq} amount={lastDelta} />
      {cutting && (
        <CutDeckModal
          onCut={() => {
            // a fresh shoe is invisible in the store diff — riffle it here
            playSfx("shuffle");
            newShoe();
            setCutting(false);
          }}
          onCancel={() => setCutting(false)}
        />
      )}
      {goalReached && goal !== null && (
        <VictoryModal
          bankroll={snapshot.bankroll}
          goal={goal}
          onKeepPlaying={dismissGoal}
          onLobby={() => {
            dismissGoal();
            onLeave();
          }}
        />
      )}
      {busted && onReset && (
        <BustModal
          bankroll={snapshot.bankroll}
          tableMin={snapshot.table_min}
          onRebuy={onReset}
          onLeave={() => {
            // clear the dead roll so the next visit re-buys fresh
            onReset();
            onLeave();
          }}
        />
      )}
    </div>
  );
}
