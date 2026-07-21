import type { RoundSnapshot, GlossaryEntry, CommandError } from "../engine/types";

type DealerError = CommandError | { Message: string };
import { narrate, narrateError } from "../narrate";
import type { Flip } from "../cards";
import { glossaryEntry } from "../glossaryData";
import { GlossaryTerm } from "./GlossaryTerm";
import "./dealer.css";

interface DealerLineProps {
  snapshot: RoundSnapshot;
  /** A refused command; the dealer explains it instead of narrating. */
  lastError?: DealerError | null;
  /** The card that just turned, for the call-out. */
  lastFlip?: Flip | null;
  /** The dealer's between-flips voice. */
  announcement?: string | null;
  /** Term→entry lookup; defaults to the real (wasm-backed) glossary. Injectable for tests. */
  lookup?: (term: string) => GlossaryEntry | undefined;
}

/** The dealer's dialogue box: he narrates the table as the round unfolds. */
export function DealerLine({
  snapshot,
  lastError = null,
  lastFlip = null,
  announcement = null,
  lookup = glossaryEntry,
}: DealerLineProps) {
  const segments = lastError
    ? narrateError(lastError)
    : announcement
      ? [{ text: announcement }]
      : narrate(snapshot, lastFlip);
  const lineKey = segments.map((s) => s.text).join("");
  return (
    <section aria-label="Dealer" className="dealer-line">
      <span className="dealer-tag">DEALER</span>
      {/* The live region node stays mounted; only its text changes, so screen
          readers actually announce each new line. Keying the region itself
          would remount it and go unspoken (the aria-live anti-pattern). */}
      <p aria-live="polite">
        {/* keyed by the line so the pop-in replays whenever he says something
            new — the visual replay rides the inner run, not the live region */}
        <span className="dealer-text" key={lineKey}>
          {segments.map((seg, i) =>
            seg.term ? (
              <GlossaryTerm key={i} term={seg.term} label={seg.text} entry={lookup(seg.term)} />
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </span>
      </p>
    </section>
  );
}
