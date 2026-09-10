// Pixel glyphs for the reskinned roads: the Chinatown bead plate's Chinese
// characters, the food marks on the three derived roads, and the lantern that
// flanks the Chinatown title. Drawn the same way as roadTokens.tsx — a small
// string grid of chunky rects — so they sit with the game's pixel look. The
// app fonts are Latin-only, which is why 庄/闲/和 are drawn rather than typed.

import type { Mark } from "../engine/types";

/** Shared palette keys. Per-glyph maps below use a subset. */
const INK = "#15110f";
const GOLD = "#f0d58a";
const CHIP_RED = "#c0202a";
const CHIP_BLUE = "#1f6feb";

type Pixels = string[];

function rectsOf(rows: Pixels, colors: Record<string, string>) {
  const rects: React.ReactElement[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = colors[ch];
      if (!fill) return; // '.' is transparent
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    });
  });
  return rects;
}

// ---------------------------------------------------------------------------
// Chinese characters for the bead plate: 庄 (Banker), 闲 (Player), 和 (Tie).
// 12x12 with a one-pixel margin, so at 24px every stroke is a crisp 2px line.
// Single-pixel strokes only — a doubled stroke turns to mud at this size.
// ---------------------------------------------------------------------------

export type BeadKind = "banker" | "player" | "tie";

const HAN: Record<BeadKind, Pixels> = {
  // 庄: 广 (dot, roof, falling left stroke) over 土
  banker: [
    "............",
    ".....##.....",
    "..########..",
    "..#.........",
    "..#...#.....",
    "..#.#####...",
    "..#...#.....",
    "..#...#.....",
    ".#....#.....",
    ".#..######..",
    "#...........",
    "............",
  ],
  // 闲: 门 frame (dot, lintel, hooked right post) around 木
  player: [
    "............",
    ".#..........",
    "..#########.",
    "..#.......#.",
    "..#...#...#.",
    "..#.#####.#.",
    "..#...#...#.",
    "..#..###..#.",
    "..#.#.#.#.#.",
    "..#...#...#.",
    "..#......##.",
    "............",
  ],
  // 和: 禾 on the left, 口 on the right
  tie: [
    "............",
    "...##.......",
    "...#........",
    "#######.....",
    "...#....####",
    "..###...#..#",
    ".#.#.#..#..#",
    "#..#..#.#..#",
    "...#....####",
    "...#........",
    "...#........",
    "............",
  ],
};

const HAN_LABEL: Record<BeadKind, string> = {
  banker: "Banker",
  player: "Player",
  tie: "Tie",
};

interface HanGlyphProps {
  kind: BeadKind;
  /** Rendered edge length in px; multiples of 12 stay crisp. */
  size?: number;
}

/** One bead-plate character in Chinatown gold, sized to sit on a lacquer bead. */
export function HanGlyph({ kind, size = 24 }: HanGlyphProps) {
  return (
    <svg
      className={`han-glyph han-glyph--${kind}`}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role="img"
      aria-label={HAN_LABEL[kind]}
    >
      <title>{HAN_LABEL[kind]}</title>
      {rectsOf(HAN[kind], { "#": GOLD })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Food marks for the derived roads. 8x8; 'm' is the mark colour (chip red or
// chip blue) so Red vs Blue keeps its meaning, everything else is garnish.
// ---------------------------------------------------------------------------

export type FoodGlyph = "donut" | "burger" | "fries";

const FOOD: Record<FoodGlyph, Pixels> = {
  // glazed ring with a hole: dough shows at the bottom edge, three sprinkles
  donut: [
    "..mmmm..",
    ".msmmmm.",
    "mmmmmmsm",
    "mmm..mmm",
    "tmm..mmt",
    "tmsmmmmt",
    ".ttmmtt.",
    "..tttt..",
  ],
  // seeded bun, cheese band, patty, lettuce, then a wrapper in the mark colour
  burger: [
    "..tttt..",
    ".tsttst.",
    "tttttttt",
    "mmmmmmmm",
    "bbbbbbbb",
    "gggggggg",
    "mmttttmm",
    ".mmmmmm.",
  ],
  // three fries fanned out of a carton
  fries: [
    "y...y..y",
    ".y..y.y.",
    ".y..y.y.",
    "..y.y.y.",
    "mmmmmmmm",
    "mmmmmmmm",
    ".mmmmmm.",
    ".mmmmmm.",
  ],
};

const FOOD_COLORS: Record<string, string> = {
  t: "#d9a25f", // bun / dough tan
  s: "#fff6dc", // sprinkles, sesame
  b: "#6b3a1e", // patty brown
  g: "#5cb85c", // lettuce green
  y: "#e9ac1c", // fry yellow, deep enough to hold against the cream paper
  k: INK,
};

const MARK_COLOR: Record<Mark, string> = { Red: CHIP_RED, Blue: CHIP_BLUE };
const MARK_LABEL: Record<Mark, string> = { Red: "Banker", Blue: "Player" };

interface FoodMarkProps {
  glyph: FoodGlyph;
  mark: Mark;
  /** Rendered edge length in px; multiples of 8 stay crisp. */
  size?: number;
}

/** One derived-road mark drawn as food, coloured red or blue like the mark it replaces. */
export function FoodMark({ glyph, mark, size = 24 }: FoodMarkProps) {
  return (
    <svg
      className={`food-mark food-mark--${glyph}`}
      data-glyph={glyph}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      role="img"
      aria-label={MARK_LABEL[mark]}
    >
      <title>{MARK_LABEL[mark]}</title>
      {rectsOf(FOOD[glyph], { ...FOOD_COLORS, m: MARK_COLOR[mark] })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Chinatown chrome: a paper lantern for either end of the title.
// ---------------------------------------------------------------------------

const LANTERN: Pixels = [
  "...ee...",
  ".eeeeee.",
  "rrrrrrrr",
  "rhrrrrhr",
  "rrrrrrrr",
  ".rrrrrr.",
  "..eeee..",
  "...ee...",
];

const LANTERN_COLORS: Record<string, string> = {
  e: GOLD, // caps and tassel
  r: "#d8232f", // lantern red, lifted a touch off the chip red so it glows on oxblood
  h: "#f06a5e", // paper highlight
};

/** A decorative pixel lantern; purely ornamental, hidden from assistive tech. */
export function Lantern({ size = 16 }: { size?: number }) {
  return (
    <svg className="lantern" width={size} height={size} viewBox="0 0 8 8" aria-hidden="true">
      {rectsOf(LANTERN, LANTERN_COLORS)}
    </svg>
  );
}
