import type { RoundSnapshot } from "../engine/types";
import "./controls.css";

/**
 * A button's label as two texts: the full one (always the accessible name —
 * `aria-hidden` never applies to it, so `getByRole({ name })` and screen
 * readers keep seeing "Watch hand"/"Reveal all"/etc regardless of viewport)
 * and a short one (`aria-hidden`, so it never becomes the name) that a phone
 * media query swaps to visually so the pinned bar's five-plus buttons fit one
 * row without a label ever losing meaning for anyone but a sighted phone user.
 */
function BtnLabel({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="btn-label-full">{full}</span>
      <span className="btn-label-short" aria-hidden="true">
        {short}
      </span>
    </>
  );
}

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  /** Flip everything (single player; live tables follow squeeze rights). */
  onRevealAll?: () => void;
  onSettle?: () => void;
  onNewHand?: () => void;
  onNewShoe: () => void;
  explainOn?: boolean;
  onToggleExplain?: () => void;
  /** Skip this coup (multiplayer tables). */
  onSitOut?: () => void;
  /** Declare ready to deal (multiplayer tables) — replaces Deal there. */
  onReady?: () => void;
  /** Take back a ready declaration (multiplayer tables). */
  onUnready?: () => void;
  /** This seat's own ready flag (multiplayer tables). */
  myReady?: boolean;
  /** Deal a coup with nothing staked, to watch the shoe (single player). */
  onWatch?: () => void;
  /** At the rail: nothing here moves the game, so only Explain is offered. */
  spectating?: boolean;
}

export function Controls({
  snapshot,
  onDeal,
  onRevealAll,
  onSettle,
  onNewHand,
  onNewShoe,
  explainOn,
  onToggleExplain,
  onSitOut,
  onReady,
  onUnready,
  myReady = false,
  onWatch,
  spectating = false,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const settled = snapshot.phase === "Settled";
  const hasBets = snapshot.bets.length > 0;

  if (spectating) {
    return (
      <section aria-label="Controls" className="controls">
        <button
          type="button"
          className="btn"
          aria-pressed={!!explainOn}
          onClick={onToggleExplain}
        >
          Explain
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Controls" className="controls">
      {onSitOut ? (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!betting || !hasBets}
          onClick={myReady ? onUnready : onReady}
        >
          {myReady ? "Unready" : "Ready"}
        </button>
      ) : (
        <button type="button" className="btn btn--primary" disabled={!betting || !hasBets} onClick={onDeal}>
          Deal
        </button>
      )}
      {onSitOut && (
        <button type="button" className="btn btn--sitout" disabled={!betting} onClick={onSitOut}>
          Sit out
        </button>
      )}
      {/* Stand and watch a coup with nothing down, like you can at a real table.
          Only offered while the felt is empty — once you've bet, Deal is the move. */}
      {onWatch && !hasBets && (
        <button type="button" className="btn btn--sitout" disabled={!betting} onClick={onWatch}>
          <BtnLabel full="Watch hand" short="Watch" />
        </button>
      )}
      {onRevealAll && (
        <button type="button" className="btn" disabled={!dealing} onClick={onRevealAll}>
          <BtnLabel full="Reveal all" short="Reveal" />
        </button>
      )}
      {onSettle && (
        <button type="button" className="btn" disabled={!dealing} onClick={onSettle}>
          Settle
        </button>
      )}
      {onNewHand && (
        <button type="button" className="btn" disabled={!settled} onClick={onNewHand}>
          <BtnLabel full="Next hand" short="Next" />
        </button>
      )}
      <button type="button" className="btn" disabled={dealing} onClick={onNewShoe}>
        <BtnLabel full="New Shoe" short="Shoe" />
      </button>
      <button
        type="button"
        className="btn"
        aria-pressed={!!explainOn}
        onClick={onToggleExplain}
      >
        Explain
      </button>
    </section>
  );
}
