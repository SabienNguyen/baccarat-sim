import { useState } from "react";
import { urlParam } from "../urlParams";
import { scoreboardFromOutcomes } from "../engine/adapter";
import { boardTally } from "../roadTally";
import { RoadsModal } from "./RoadsModal";

/**
 * Dev tool: `?roads=<BPT sequence>` opens the full board for a given shoe, no
 * table or session needed — so the owner can replicate a published casino
 * scoreboard and compare it visually against ours. Only letters B/P/T (any
 * case) count; the wasm engine ignores everything else in the string.
 */
export function RoadsReplay() {
  const [seq, setSeq] = useState(() => urlParam("roads"));
  if (!seq) return null;

  const scoreboard = scoreboardFromOutcomes(seq);
  const tally = boardTally(scoreboard);

  const onClose = () => {
    const url = new URL(location.href);
    url.searchParams.delete("roads");
    history.replaceState({}, "", url);
    setSeq(null);
  };

  return <RoadsModal scoreboard={scoreboard} tally={tally} onClose={onClose} />;
}
