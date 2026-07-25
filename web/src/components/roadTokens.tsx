// Animal tokens a real EZ Baccarat / Tiger display stamps on the Big Road.
// Drawn the same way the favicon is — a small grid of chunky rects in the
// game's palette — so they read as pixel art rather than emoji.

/** Palette keys used by the pixel maps below. */
const INK = "#15110f";
const COLORS: Record<string, string> = {
  k: INK, // outline / markings
  g: "#3f9c5a", // dragon green
  e: "#f4c430", // gold eye
  w: "#ffffff", // panda white — outlined below, since the road paper is cream
  o: "#e08a2e", // tiger orange
};

/**
 * 8x8 pixel maps. Kept deliberately blocky: at road-cell size only a bold
 * silhouette plus a signature colour survives, so each token leans on shape
 * (ears, crest) and its own hue rather than fine detail.
 */
const ART: Record<BonusKind, string[]> = {
  // horned head with a gold eye — the horns are what make it read as a dragon
  // rather than a green blob at this size
  dragon: [
    "kk...kk.",
    "kk...kk.",
    ".gggggg.",
    "gggeggg.",
    "gggggggg",
    "gggggggg",
    ".gg..gg.",
    "........",
  ],
  // fully outlined: white-on-cream has no contrast against the road paper
  panda: [
    ".kk..kk.",
    "kkkkkkkk",
    "kwwwwwwk",
    "kwkwwkwk",
    "kwkwwkwk",
    "kwwkkwwk",
    ".kwwwwk.",
    "..kkkk..",
  ],
  tiger: [
    "o......o",
    "oo....oo",
    ".oooooo.",
    "okoookoo",
    "oooooooo",
    "okoookoo",
    ".okooko.",
    "..oooo..",
  ],
};

export type BonusKind = "dragon" | "panda" | "tiger";

const LABEL: Record<BonusKind, string> = {
  dragon: "Dragon 7",
  panda: "Panda 8",
  tiger: "Tiger",
};

interface BonusTokenProps {
  kind: BonusKind;
  /** Rendered edge length in px. */
  size?: number;
}

/** One pixel-art bonus token, sized to sit on a road cell. */
export function BonusToken({ kind, size = 14 }: BonusTokenProps) {
  const rows = ART[kind];
  const rects: React.ReactElement[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = COLORS[ch];
      if (!fill) return; // '.' and ' ' are transparent
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    });
  });
  return (
    <svg
      className={`bonus-token bonus-token--${kind}`}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      role="img"
      aria-label={LABEL[kind]}
    >
      <title>{LABEL[kind]}</title>
      {rects}
    </svg>
  );
}
