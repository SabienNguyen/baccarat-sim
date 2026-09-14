import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { type GameState } from "./store/gameStore";
import { storeFor, resetStore } from "./store/useGameStore";
import { HomeScreen } from "./components/HomeScreen";
import { Multiplayer } from "./multiplayer/Multiplayer";
import { SeatsStrip } from "./multiplayer/SeatsStrip";
import { MAX_SEATS } from "./multiplayer/protocol";
import type { TableTier } from "./tables";
import { urlParam } from "./urlParams";
import { isFaceUp } from "./cards";
import { visibleCardCount } from "./squeezeOrder";
import { canSqueeze } from "./squeezeRights";
import { dealerFlipOffer } from "./dealerFlip";
import { DealerFlipRequest } from "./components/DealerFlipRequest";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { PeelStage } from "./components/PeelStage";
import { isPhoneLike } from "./phoneLike";
import { BetRail, type BetView } from "./components/BetRail";
import { BonusNudge } from "./components/BonusNudge";
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
import { installSleepOnHide } from "./audio/sleep";
import { autoAdvanceMs, isRecentlyTouched } from "./autoAdvance";
import { getPortal } from "./portal";
import { createPortalTracker, type PortalView } from "./portal/signals";
import { adBreak } from "./portal/adBreak";

/** Beat after the final card flips before the round resolves itself. */
const AUTO_SETTLE_MS = 600;
/** How long the settled cards + win/loss popup linger before the next hand.
 *  Three seconds: enough to read both hands and the result without the table
 *  feeling like it's waiting on you. The win popup's float (2400 ms) finishes
 *  before the sweep starts. */
export const AUTO_ADVANCE_MS = 3000;
/** The dealer's sweep: the cards muck away over this window at the end of the
 *  linger, so the felt clears with a gesture instead of the cards blinking out. */
export const SWEEP_MS = 400;
/** T8b: the peel stage waits this long after the phase flips to Dealing
 *  before it mounts — the deal-in fly (cards.css) is still landing. The
 *  last of the initial four cards (Banker's second) starts its 340ms
 *  deal-in animation at a 420ms `--deal-delay` (Hand.tsx), finishing at
 *  760ms; a fixed 700ms lands just before that without a visible stall — the
 *  stage doesn't need to wait for the LAST pixel of the animation, only for
 *  the cards to have visibly arrived. */
export const DEAL_SETTLE_MS = 700;

interface AppProps {
  store?: StoreApi<GameState>;
}

/** Shell: home screen first; a chosen table mounts the game. An injected
 *  store (tests) goes straight to the table. */
export function App({ store }: AppProps = {}) {
  // Deep links: ?room=CODE lands straight in multiplayer (Multiplayer reads the
  // code and auto-joins), ?watch=CODE the same but at the rail; ?tier=low|mid|high
  // opens that solo table directly — the landing half of the "share your run /
  // beat the table" links.
  const [tier, setTier] = useState<TableTier | null>(() => {
    if (store) return "mid";
    if (urlParam("room") || urlParam("watch")) return null;
    const t = urlParam("tier");
    return t === "low" || t === "mid" || t === "high" ? t : null;
  });
  const [multi, setMulti] = useState(
    () => !store && (!!urlParam("room") || !!urlParam("watch")),
  );
  const [resetSeq, setResetSeq] = useState(0);
  // One document-level listener for the whole app's lifetime (lobby,
  // multiplayer, table) — installed here since App is the outermost
  // component every screen mounts under. Backgrounding the tab / locking
  // the phone sleeps the audio graph and freezes CSS animations (B2/B5).
  useEffect(() => installSleepOnHide(), []);
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
      tier={tier}
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
  /** Single-player table tier, for the victory share link's deep link back. */
  tier?: TableTier;
  /** From the rail: sit down at the table being watched (multiplayer). */
  onTakeSeat?: () => void;
}

export function GameTable({ store: active, onLeave, onReset, tier, onTakeSeat }: GameTableProps) {
  const [cutting, setCutting] = useState(false);
  // the MAIN/BONUS felt view, lifted so the nudge can fling it to BONUS
  const [betView, setBetView] = useState<BetView>("main");
  // the settle the player closed the bonus notice on, so it stays up otherwise
  const [dismissedNudgeSeq, setDismissedNudgeSeq] = useState(-1);
  // true during the muck: the settled cards animate off before the felt clears
  const [sweeping, setSweeping] = useState(false);
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
  const me = useStore(active, (s) => s.me);
  const rename = useStore(active, (s) => s.rename);
  const squeezers = useStore(active, (s) => s.squeezers);
  const requestDealerFlip = useStore(active, (s) => s.requestDealerFlip);
  const sitOut = useStore(active, (s) => s.sitOut);
  const ready = useStore(active, (s) => s.ready);
  const unready = useStore(active, (s) => s.unready);
  const myReady = useStore(active, (s) => s.myReady);
  const watchHand = useStore(active, (s) => s.watchHand);
  const goal = useStore(active, (s) => s.goal);
  const goalReached = useStore(active, (s) => s.goalReached);
  const dismissGoal = useStore(active, (s) => s.dismissGoal);
  const busted = useStore(active, (s) => s.busted);
  const spectating = useStore(active, (s) => s.spectating);
  const watchers = useStore(active, (s) => s.watchers);

  // every table noise rides the store: works for local and remote play alike
  useGameSounds(active);

  // T8b: peel stage. Whether this device handles like a phone doesn't change
  // mid-session, so it's read once. The stage itself waits out the deal
  // fly-in before it mounts (see DEAL_SETTLE_MS) so the cards don't teleport
  // into it mid-animation.
  const [phoneLike] = useState(() => isPhoneLike());
  const [dealSettled, setDealSettled] = useState(false);
  useEffect(() => {
    if (snapshot.phase !== "Dealing") {
      setDealSettled(false);
      return;
    }
    const t = setTimeout(() => setDealSettled(true), DEAL_SETTLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.phase]);
  const showPeelStage = phoneLike && snapshot.phase === "Dealing" && dealSettled;

  // Game-portal gameplay signals (start on the first deal, stop under a
  // modal, resume when it closes) ride the store the same way. Without a
  // portal every call is a no-op.
  useEffect(() => {
    const step = createPortalTracker(getPortal());
    const view = (s: GameState): PortalView => ({
      phase: s.snapshot.phase,
      busted: s.busted,
      goalReached: s.goalReached,
    });
    return active.subscribe((state, prev) => step(view(prev), view(state)));
  }, [active]);

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

  // The high-limit ask: while you squeeze your hand you may have the dealer
  // turn one or both of HIS cards first. Offered only while it would be
  // honoured (see dealerFlipOffer); the engine/server is the real gate.
  const flipOffer = dealerFlipOffer(snapshot, squeezers, me);
  const flipControls = (side: "Player" | "Banker") =>
    flipOffer?.side === side ? (
      <DealerFlipRequest offer={flipOffer} onRequest={requestDealerFlip} />
    ) : undefined;

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
  // Keep the bonus notice up until the player closes it or bets — don't sweep it.
  const showNudge = hasNudge && dismissedNudgeSeq !== settleSeq;

  // P14: a thumb finishing a squeeze or mid-scroll shouldn't have the felt
  // swept out from under it. One document-level listener for the table's
  // lifetime tracks the last touch pointerdown; the auto-advance effect below
  // polls it before it fires (see isRecentlyTouched).
  const lastTouchAt = useRef<number | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") lastTouchAt.current = Date.now();
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => {
    if (seats !== null) return;
    if (snapshot.phase !== "Settled" || busted || goalReached) return;
    // Every settled hand auto-advances; the bonus notice just rides along on the
    // settled window and clears with it (the player can also close it early).
    // In the last stretch the cards muck away, then the felt clears. On a
    // coarse pointer the whole window is longer (autoAdvanceMs), and each of
    // the two timers below defers itself in short polls while a touch is
    // still active or was within the last second, instead of firing under it.
    const advanceMs = autoAdvanceMs(AUTO_ADVANCE_MS);
    const DEFER_POLL_MS = 250;
    let sweepTimer: ReturnType<typeof setTimeout>;
    let clearTimer: ReturnType<typeof setTimeout>;
    const armSweep = (delay: number) => {
      sweepTimer = setTimeout(() => {
        if (isRecentlyTouched(lastTouchAt.current, Date.now())) {
          armSweep(DEFER_POLL_MS);
          return;
        }
        setSweeping(true);
      }, delay);
    };
    const armClear = (delay: number) => {
      clearTimer = setTimeout(() => {
        if (isRecentlyTouched(lastTouchAt.current, Date.now())) {
          armClear(DEFER_POLL_MS);
          return;
        }
        newHand();
        setSweeping(false);
      }, delay);
    };
    armSweep(Math.max(0, advanceMs - SWEEP_MS));
    armClear(advanceMs);
    return () => {
      clearTimeout(sweepTimer);
      clearTimeout(clearTimer);
      // The sweep belongs to THIS settled hand. If the hand ends early — a
      // chip tapped mid-muck opens the next hand through `stake` — the `clear`
      // timer above never fires, and a stranded `sweeping` would keep mucking
      // every card dealt from then on (muck-out ends at opacity 0, and holds).
      setSweeping(false);
    };
  }, [seats, snapshot.phase, busted, goalReached, newHand]);

  return (
    <div className="app">
      <Hud
        snapshot={snapshot}
        goal={goal}
        onResetBankroll={onReset}
        onLeave={onLeave}
        spectating={spectating}
        onTakeSeat={onTakeSeat}
        seatsFull={(seats?.length ?? 0) >= MAX_SEATS}
      />
      <main className="stage">
        {seats !== null && (
          <SeatsStrip
            seats={seats}
            me={me}
            squeezers={squeezers}
            betting={snapshot.phase !== "Dealing"}
            settled={snapshot.phase === "Settled"}
            onRename={spectating ? undefined : rename}
            watchers={watchers}
          />
        )}
        {/* Wrapping the two together (P14) lets the win/loss popup anchor to
            the dealer line's own box on phones — see winpopup.css — instead
            of a viewport-percentage `top` that landed on the cards. The
            wrapper only matters at that breakpoint; the popup stays
            `position: fixed` (ignoring its DOM position) everywhere else.
            Hidden while the peel stage is up (T8b) — its own compact dealer
            line takes over the narration so it isn't announced twice. */}
        {!showPeelStage && (
          <div className="dealer-slot">
            <DealerLine
              snapshot={snapshot}
              lastError={lastError}
              lastFlip={lastFlip}
              announcement={announcement}
            />
            <WinPopup key={settleSeq} amount={lastDelta} />
          </div>
        )}
        <div className={`card-stage${sweeping ? " sweeping" : ""}`}>
          {!showPeelStage && (
            <>
              <Hand
                side="Player"
                hand={snapshot.player}
                phase={snapshot.phase}
                visibleCount={playerVisible}
                winner={snapshot.outcome === "PlayerWin"}
                squeezable={canSqueeze("Player", squeezers, me)}
                onPeek={(i) => peek("Player", i)}
                onReveal={(i) => reveal("Player", i)}
                actions={flipControls("Player")}
              />
              <Hand
                side="Banker"
                hand={snapshot.banker}
                phase={snapshot.phase}
                visibleCount={bankerVisible}
                winner={snapshot.outcome === "BankerWin"}
                squeezable={canSqueeze("Banker", squeezers, me)}
                onPeek={(i) => {
                  // A shared table holds the peek to the ritual too (the server
                  // refuses it as out of order); hold it silently, like the flip.
                  // Solo keeps its peek-ahead while the dealer turns Player.
                  if (seats === null || !bankerLocked) peek("Banker", i);
                }}
                onReveal={(i) => {
                  if (!bankerLocked) reveal("Banker", i);
                }}
                actions={flipControls("Banker")}
              />
            </>
          )}
        </div>
        {showPeelStage && (
          <PeelStage
            snapshot={snapshot}
            lastError={lastError}
            lastFlip={lastFlip}
            announcement={announcement}
            player={{
              hand: snapshot.player,
              visibleCount: playerVisible,
              winner: snapshot.outcome === "PlayerWin",
              squeezable: canSqueeze("Player", squeezers, me),
              onPeek: (i) => peek("Player", i),
              onReveal: (i) => reveal("Player", i),
              actions: flipControls("Player"),
            }}
            banker={{
              hand: snapshot.banker,
              visibleCount: bankerVisible,
              winner: snapshot.outcome === "BankerWin",
              squeezable: canSqueeze("Banker", squeezers, me),
              onPeek: (i) => {
                if (seats === null || !bankerLocked) peek("Banker", i);
              },
              onReveal: (i) => {
                if (!bankerLocked) reveal("Banker", i);
              },
              actions: flipControls("Banker"),
            }}
          />
        )}
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
          onReady={seats !== null ? ready : undefined}
          onUnready={seats !== null ? unready : undefined}
          myReady={myReady}
          onWatch={seats === null ? watchHand : undefined}
          spectating={spectating}
        />
        {showNudge && nudge !== null && (
          <BonusNudge hit={nudge} onDismiss={() => setDismissedNudgeSeq(settleSeq)} />
        )}
        {/* No chips at the rail: the felt is there to watch, not to bet on. */}
        {!spectating && (
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
        )}
      </main>
      <div className="board-dock">
        <Scoreboard
          scoreboard={snapshot.scoreboard}
          tableMin={snapshot.table_min}
          tableMax={snapshot.table_max}
        />
        {explainOn && <ExplainPanel snapshot={snapshot} />}
      </div>
      {cutting && (
        <CutDeckModal
          onCut={() => {
            // a fresh shoe is invisible in the store diff — riffle it here
            playSfx("shuffle");
            newShoe();
            setCutting(false);
            // between shoes is the natural break for a portal's midgame ad
            void adBreak(getPortal());
          }}
          onCancel={() => setCutting(false)}
        />
      )}
      {goalReached && goal !== null && (
        <VictoryModal
          bankroll={snapshot.bankroll}
          goal={goal}
          tier={tier}
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
