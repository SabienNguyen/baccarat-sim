import { useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { type GameState } from "./store/gameStore";
import { defaultStore } from "./store/useGameStore";
import { hiddenIndices } from "./cards";
import { visibleCardCount } from "./squeezeOrder";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { BetRail } from "./components/BetRail";
import { Controls } from "./components/Controls";
import { Scoreboard } from "./components/Scoreboard";
import { WinPopup } from "./components/WinPopup";
import { DealerLine } from "./components/DealerLine";
import { ExplainPanel } from "./components/ExplainPanel";
import { CutDeckModal } from "./components/CutDeckModal";
import { ExchangeModal } from "./components/ExchangeModal";
import { clearBankroll } from "./bankrollStorage";

interface AppProps {
  store?: StoreApi<GameState>;
}

export function App({ store }: AppProps = {}) {
  const active = store ?? defaultStore();
  const [cutting, setCutting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const snapshot = useStore(active, (s) => s.snapshot);
  const lastError = useStore(active, (s) => s.lastError);
  const lastDelta = useStore(active, (s) => s.lastDelta);
  const settleSeq = useStore(active, (s) => s.settleSeq);
  const rack = useStore(active, (s) => s.rack);
  const change = useStore(active, (s) => s.change);
  const hand = useStore(active, (s) => s.hand);
  const stagedChips = useStore(active, (s) => s.stagedChips);
  const pickChip = useStore(active, (s) => s.pickChip);
  const returnHand = useStore(active, (s) => s.returnHand);
  const placeHand = useStore(active, (s) => s.placeHand);
  const placeChip = useStore(active, (s) => s.placeChip);
  const exchangeBreak = useStore(active, (s) => s.exchangeBreak);
  const exchangeColorUp = useStore(active, (s) => s.exchangeColorUp);
  const clearBets = useStore(active, (s) => s.clearBets);
  const deal = useStore(active, (s) => s.deal);
  const peek = useStore(active, (s) => s.peek);
  const reveal = useStore(active, (s) => s.reveal);
  const settle = useStore(active, (s) => s.settle);
  const newHand = useStore(active, (s) => s.newHand);
  const newShoe = useStore(active, (s) => s.newShoe);
  const explainOn = useStore(active, (s) => s.explainOn);
  const toggleExplain = useStore(active, (s) => s.toggleExplain);

  const revealAll = () => {
    for (const i of hiddenIndices(snapshot.player.cards)) reveal("Player", i);
    for (const i of hiddenIndices(snapshot.banker.cards)) reveal("Banker", i);
  };

  // Gate the third card so the 2-vs-3 count can't leak whether a hand drew one.
  const playerVisible = visibleCardCount("Player", snapshot.player.cards, snapshot.banker.cards);
  const bankerVisible = visibleCardCount("Banker", snapshot.player.cards, snapshot.banker.cards);

  return (
    <div className="app">
      <Hud snapshot={snapshot} lastError={lastError} />
      <main className="stage">
        <DealerLine snapshot={snapshot} />
        <div className="card-stage">
          <Hand
            side="Player"
            hand={snapshot.player}
            phase={snapshot.phase}
            visibleCount={playerVisible}
            winner={snapshot.outcome === "PlayerWin"}
            onPeek={(i) => peek("Player", i)}
            onReveal={(i) => reveal("Player", i)}
          />
          <Hand
            side="Banker"
            hand={snapshot.banker}
            phase={snapshot.phase}
            visibleCount={bankerVisible}
            winner={snapshot.outcome === "BankerWin"}
            onPeek={(i) => peek("Banker", i)}
            onReveal={(i) => reveal("Banker", i)}
          />
        </div>
        <Controls
          snapshot={snapshot}
          onDeal={deal}
          onRevealAll={revealAll}
          onSettle={settle}
          onNewHand={newHand}
          onNewShoe={() => setCutting(true)}
          explainOn={explainOn}
          onToggleExplain={toggleExplain}
          onResetBankroll={() => {
            clearBankroll();
            window.location.reload();
          }}
        />
        <BetRail
          snapshot={snapshot}
          rack={rack}
          hand={hand}
          change={change}
          stagedChips={stagedChips}
          onPickChip={pickChip}
          onReturnHand={returnHand}
          onPlaceHand={placeHand}
          onPlaceChip={placeChip}
          onClear={clearBets}
          onOpenExchange={() => setExchanging(true)}
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
            newShoe();
            setCutting(false);
          }}
          onCancel={() => setCutting(false)}
        />
      )}
      {exchanging && (
        <ExchangeModal
          rack={rack}
          change={change}
          onBreak={exchangeBreak}
          onColorUp={exchangeColorUp}
          onClose={() => setExchanging(false)}
        />
      )}
    </div>
  );
}
