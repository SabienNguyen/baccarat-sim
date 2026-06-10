import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { type GameState } from "./store/gameStore";
import { defaultStore } from "./store/useGameStore";
import { hiddenIndices } from "./cards";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { BetRail } from "./components/BetRail";
import { Controls } from "./components/Controls";
import { Scoreboard } from "./components/Scoreboard";
import { WinPopup } from "./components/WinPopup";

interface AppProps {
  store?: StoreApi<GameState>;
}

export function App({ store }: AppProps = {}) {
  const active = store ?? defaultStore();
  const snapshot = useStore(active, (s) => s.snapshot);
  const selectedChip = useStore(active, (s) => s.selectedChip);
  const lastError = useStore(active, (s) => s.lastError);
  const lastDelta = useStore(active, (s) => s.lastDelta);
  const settleSeq = useStore(active, (s) => s.settleSeq);
  const setSelectedChip = useStore(active, (s) => s.setSelectedChip);
  const placeSelectedBet = useStore(active, (s) => s.placeSelectedBet);
  const clearBets = useStore(active, (s) => s.clearBets);
  const deal = useStore(active, (s) => s.deal);
  const peek = useStore(active, (s) => s.peek);
  const reveal = useStore(active, (s) => s.reveal);
  const settle = useStore(active, (s) => s.settle);
  const newShoe = useStore(active, (s) => s.newShoe);

  const revealAll = () => {
    for (const i of hiddenIndices(snapshot.player.cards)) reveal("Player", i);
    for (const i of hiddenIndices(snapshot.banker.cards)) reveal("Banker", i);
  };

  return (
    <div className="app">
      <Hud snapshot={snapshot} lastError={lastError} />
      <main className="stage">
        <div className="card-stage">
          <Hand
            side="Player"
            hand={snapshot.player}
            phase={snapshot.phase}
            onPeek={(i) => peek("Player", i)}
            onReveal={(i) => reveal("Player", i)}
          />
          <Hand
            side="Banker"
            hand={snapshot.banker}
            phase={snapshot.phase}
            onPeek={(i) => peek("Banker", i)}
            onReveal={(i) => reveal("Banker", i)}
          />
        </div>
        <Controls
          snapshot={snapshot}
          onDeal={deal}
          onRevealAll={revealAll}
          onSettle={settle}
          onNewShoe={newShoe}
        />
        <BetRail
          snapshot={snapshot}
          selectedChip={selectedChip}
          onSelectChip={setSelectedChip}
          onPlaceBet={placeSelectedBet}
          onClear={clearBets}
        />
      </main>
      <Scoreboard scoreboard={snapshot.scoreboard} />
      <WinPopup key={settleSeq} amount={lastDelta} />
    </div>
  );
}
