import type { RoundSnapshot } from "../engine/types";
import { mainBetEdge, type EdgeInfo } from "../houseEdge";
import { GlossaryTerm } from "./GlossaryTerm";
import { glossaryEntry } from "../glossaryData";
import "./explain.css";

/** Render an edge's basis, linking the word "commission" to the glossary so a
 *  learner can tap the term that explains why Banker pays less than even. */
function Basis({ text }: { text: string }) {
  const word = "commission";
  const at = text.indexOf(word);
  if (at === -1) return <span className="basis">({text})</span>;
  return (
    <span className="basis">
      ({text.slice(0, at)}
      <GlossaryTerm term={word} label={word} entry={glossaryEntry(word)} />
      {text.slice(at + word.length)})
    </span>
  );
}

function uniqueEdges(snapshot: RoundSnapshot): EdgeInfo[] {
  const byLabel = new Map<string, EdgeInfo>();
  for (const bet of snapshot.bets) {
    const edge = mainBetEdge(bet.kind);
    if (edge && !byLabel.has(edge.label)) byLabel.set(edge.label, edge);
  }
  return [...byLabel.values()];
}

export function ExplainPanel({ snapshot }: { snapshot: RoundSnapshot }) {
  const edges = uniqueEdges(snapshot);
  return (
    <section aria-label="Explain" className="explain-panel panel">
      <h4>Why this round</h4>
      {snapshot.explain.length > 0 ? (
        <ul className="explain-trace">
          {snapshot.explain.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="explain-hint">Place a bet and deal to see the rules in action.</p>
      )}

      {edges.length > 0 && (
        <>
          <h4>House edge</h4>
          <ul className="explain-edges">
            {edges.map((e) => (
              <li key={e.label}>
                {e.label}: {e.edge} <Basis text={e.basis} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
