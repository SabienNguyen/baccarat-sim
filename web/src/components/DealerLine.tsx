import type { RoundSnapshot, GlossaryEntry } from "../engine/types";
import { narrate } from "../narrate";
import { glossaryEntry } from "../glossaryData";
import { GlossaryTerm } from "./GlossaryTerm";
import "./dealer.css";

interface DealerLineProps {
  snapshot: RoundSnapshot;
  /** Term→entry lookup; defaults to the real (wasm-backed) glossary. Injectable for tests. */
  lookup?: (term: string) => GlossaryEntry | undefined;
}

/** The dealer's dialogue box: he narrates the table as the round unfolds. */
export function DealerLine({ snapshot, lookup = glossaryEntry }: DealerLineProps) {
  const segments = narrate(snapshot);
  const lineKey = segments.map((s) => s.text).join("");
  return (
    <section aria-label="Dealer" className="dealer-line">
      <span className="dealer-tag">DEALER</span>
      {/* keyed by the line so the pop-in replays whenever he says something new */}
      <p aria-live="polite" key={lineKey}>
        {segments.map((seg, i) =>
          seg.term ? (
            <GlossaryTerm key={i} term={seg.term} label={seg.text} entry={lookup(seg.term)} />
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>
    </section>
  );
}
