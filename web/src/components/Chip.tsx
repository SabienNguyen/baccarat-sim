import { formatCents } from "../format";

/** CSS modifier class per denomination, for the chip's colour. */
const CHIP_COLOR: Record<number, string> = {
  2500: "chip--red",
  10000: "chip--green",
  50000: "chip--blue",
  100000: "chip--gold",
};

/** Short face value for the chip art, e.g. 2500 -> "$25", 100000 -> "$1k". */
export function chipFace(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${dollars / 1000}k` : `$${dollars}`;
}

interface ChipProps {
  cents: number;
  selected: boolean;
  onSelect: (cents: number) => void;
}

/** A draggable casino chip. Drag it onto a spot to bet; click to select it. */
export function Chip({ cents, selected, onSelect }: ChipProps) {
  return (
    <button
      type="button"
      className={`chip ${CHIP_COLOR[cents] ?? ""}`}
      aria-label={`${formatCents(cents)} chip`}
      aria-pressed={selected}
      draggable
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
