import { formatCents } from "../format";

/** CSS modifier class per denomination — real casino colors. */
export const CHIP_COLOR: Record<number, string> = {
  100: "chip--white",
  500: "chip--red",
  2500: "chip--green",
  10000: "chip--black",
  50000: "chip--purple",
  100000: "chip--gold",
  500000: "chip--orange",
  2500000: "chip--teal",
  10000000: "chip--platinum",
};

/** Short face value for the chip art, e.g. 2500 -> "$25", 100000 -> "$1k". */
export function chipFace(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${dollars / 1000}k` : `$${dollars}`;
}

interface ChipProps {
  cents: number;
  /** The armed chip is highlighted. */
  selected: boolean;
  /** Greyed when the balance can't cover it. */
  disabled?: boolean;
  onSelect: (cents: number) => void;
}

/** A casino chip denomination. Click to arm it; drag one onto a spot. */
export function Chip({ cents, selected, disabled, onSelect }: ChipProps) {
  return (
    <button
      type="button"
      className={`chip ${CHIP_COLOR[cents] ?? ""}${selected ? " chip--armed" : ""}`}
      aria-label={`${formatCents(cents)} chip`}
      aria-pressed={selected}
      disabled={disabled}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(cents));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onSelect(cents)}
    >
      <span className="chip-face">{chipFace(cents)}</span>
    </button>
  );
}

/**
 * One chip in a stack on the felt. `index` is its height in the tower, counting
 * from the bottom — CSS reads it as `--i` to offset and layer the chip, so the
 * stack rises off the table instead of spreading sideways.
 */
export function MiniChip({ cents, index = 0 }: { cents: number; index?: number }) {
  return (
    <span
      className={`mini-chip ${CHIP_COLOR[cents] ?? ""}`}
      title={formatCents(cents)}
      style={{ "--i": index } as React.CSSProperties}
    />
  );
}
