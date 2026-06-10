import type { PhaseTag } from "../engine/types";
import "./dealer-figure.css";

/**
 * A stylized croupier seated across the table. Purely decorative (the dealer's
 * "voice" is the DealerLine), so it's aria-hidden. He leans in and works his
 * hands while cards are out, and idles with a slow breath otherwise.
 */
export function Dealer({ phase }: { phase: PhaseTag }) {
  const dealing = phase === "Dealing";
  return (
    <div
      className={`dealer-figure ${dealing ? "is-dealing" : ""}`}
      data-phase={phase}
      aria-hidden="true"
    >
      <div className="dealer-shadow" />
      <div className="dealer-arm dealer-arm--left" />
      <div className="dealer-arm dealer-arm--right" />
      <div className="dealer-torso">
        <div className="dealer-lapel dealer-lapel--left" />
        <div className="dealer-lapel dealer-lapel--right" />
        <div className="dealer-bowtie" />
      </div>
      <div className="dealer-head">
        <div className="dealer-hair" />
        <div className="dealer-face" />
      </div>
    </div>
  );
}
