import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { type GameState } from "./store/gameStore";
import { defaultStore } from "./store/useGameStore";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { BetRail } from "./components/BetRail";
import { Controls } from "./components/Controls";
import { Scoreboard } from "./components/Scoreboard";

interface AppProps {
  store?: StoreApi<GameState>;
}

export function App({ store }: AppProps = {}) {
  const active = store ?? defaultStore();
  const snapshot = useStore(active, (s) => s.snapshot);
  const selectedChip = useStore(active, (s) => s.selectedChip);
  const lastError = useStore(active, (s) => s.lastError);
  const setSelectedChip = useStore(active, (s) => s.setSelectedChip);
  const placeSelectedBet = useStore(active, (s) => s.placeSelectedBet);
  const clearBets = useStore(active, (s) => s.clearBets);
  const deal = useStore(active, (s) => s.deal);
  const reveal = useStore(active, (s) => s.reveal);
  const settle = useStore(active, (s) => s.settle);
  const newShoe = useStore(active, (s) => s.newShoe);

  return (
    <main>
      <h1>Baccarat Simulator</h1>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <Hud snapshot={snapshot} lastError={lastError} />
        <div>
          <Hand side="Player" hand={snapshot.player} />
          <Hand side="Banker" hand={snapshot.banker} />
          <Controls
            snapshot={snapshot}
            onDeal={deal}
            onReveal={reveal}
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
        </div>
        <Scoreboard scoreboard={snapshot.scoreboard} />
      </div>
    </main>
  );
}
