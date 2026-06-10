import { buildGlossaryMap } from "./glossaryData";
import type { GlossaryEntry } from "./engine/types";

const entries: GlossaryEntry[] = [
  { term: "monkey", label: "Monkey", short: "A 10 or face card (value 0).", long: "..." },
  { term: "natural", label: "Natural", short: "An 8 or 9 on the first two cards.", long: "..." },
];

test("builds a lookup keyed by term slug", () => {
  const map = buildGlossaryMap(entries);
  expect(map.get("monkey")?.label).toBe("Monkey");
  expect(map.get("natural")?.short).toContain("8 or 9");
});

test("unknown slugs resolve to undefined", () => {
  const map = buildGlossaryMap(entries);
  expect(map.get("nope")).toBeUndefined();
});
