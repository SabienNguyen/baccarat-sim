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

export function DealerLine({ snapshot, lookup = glossaryEntry }: DealerLineProps) {
  const segments = narrate(snapshot);
  return (
    <section aria-label="Dealer" className="dealer-line">
      <p aria-live="polite">
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
