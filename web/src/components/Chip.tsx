import { formatCents } from "../format";

/** CSS modifier class per denomination — real casino colors. */
export const CHIP_COLOR: Record<number, string> = {
  100: "chip--white",
  500: "chip--red",
  2500: "chip--green",
  10000: "chip--black",
  50000: "chip--purple",
  100000: "chip--gold",
};

/** Short face value for the chip art, e.g. 2500 -> "$25", 100000 -> "$1k". */
export function chipFace(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${dollars / 1000}k` : `$${dollars}`;
}

interface ChipProps {
  cents: number;
  /** How many of this chip are in the rack. */
  count: number;
  /** Pick one up into the hand. */
  onPick: (cents: number) => void;
  disabled?: boolean;
}

/** A casino chip in your rack. Click to pick one up; drag one onto a spot. */
export function Chip({ cents, count, onPick, disabled }: ChipProps) {
  const empty = count <= 0;
  return (
    <button
      type="button"
      className={`chip ${CHIP_COLOR[cents] ?? ""}`}
      aria-label={`${formatCents(cents)} chip`}
      disabled={disabled || empty}
      draggable={!disabled && !empty}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(cents));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onPick(cents)}
    >
      <span className="chip-face">{chipFace(cents)}</span>
      <span className="chip-count">{count}</span>
    </button>
  );
}

/** A small read-only chip, for stacks on the felt and the hand tray. */
export function MiniChip({ cents }: { cents: number }) {
  return (
    <span className={`mini-chip ${CHIP_COLOR[cents] ?? ""}`} title={formatCents(cents)} />
  );
}
