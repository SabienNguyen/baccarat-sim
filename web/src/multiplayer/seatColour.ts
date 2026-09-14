/**
 * A stable per-seat accent colour, cycling through a 7-entry palette by seat
 * id — the same colour every client renders for a given seat, so a chip on
 * the felt and that seat's chip in the strip read as the same person. The
 * palette itself lives once as CSS custom properties in multiplayer.css;
 * this just picks which one.
 */
const PALETTE_SIZE = 7;

export function seatColour(id: number): string {
  const index = ((id % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return `var(--seat-colour-${index})`;
}
