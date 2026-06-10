import type { GlossaryEntry } from "./engine/types";
import { getGlossary } from "./engine/adapter";

/** Pure: index glossary entries by their term slug. */
export function buildGlossaryMap(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  return new Map(entries.map((e) => [e.term, e]));
}

let cache: Map<string, GlossaryEntry> | null = null;

/** Look up a glossary entry by slug, loading the glossary from wasm once. */
export function glossaryEntry(term: string): GlossaryEntry | undefined {
  if (!cache) cache = buildGlossaryMap(getGlossary());
  return cache.get(term);
}
