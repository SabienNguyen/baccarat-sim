import type { PhaseTag } from "../engine/types";
import "./dealer-figure.css";

/**
 * A hand-drawn SVG croupier seated across the table — flat fills, fat ink
 * outlines, theme colors (suit = panel purple, cards = cream, chips =
 * red/blue/gold) so he sits in the Balatro-retro skin. Purely decorative
 * (his "voice" is the DealerLine), so it's aria-hidden. He breathes when
 * idle and works the card fan while a hand is being dealt.
 */
export function Dealer({ phase }: { phase: PhaseTag }) {
  const dealing = phase === "Dealing";
  return (
    <div
      className={`dealer-figure ${dealing ? "is-dealing" : ""}`}
      data-phase={phase}
      aria-hidden="true"
    >
      <svg viewBox="0 0 240 190" className="dealer-svg" role="presentation">
        {/* ground shadow */}
        <ellipse className="d-ground" cx="120" cy="182" rx="96" ry="8" />

        <g className="d-body">
          {/* neck */}
          <rect x="110" y="66" width="20" height="20" rx="6" className="d-skin" />

          {/* jacket / shoulders */}
          <path className="d-suit" d="M56,182 C52,124 70,94 120,94 C170,94 188,124 184,182 Z" />
          {/* hard bottom shade band on jacket */}
          <path
            className="d-suit-lo"
            d="M58,182 C57,168 58,158 61,148 C66,166 174,166 179,148 C182,158 183,168 182,182 Z"
          />
          {/* shoulder highlight */}
          <path
            className="d-suit-hi"
            d="M74,104 C86,96 100,94 120,94 C112,98 102,104 96,112 C88,108 80,106 74,104 Z"
          />

          {/* shirt V */}
          <path className="d-shirt" d="M120,96 L102,106 L120,152 L138,106 Z" />
          {/* vest buttons */}
          <circle className="d-button" cx="120" cy="126" r="2.6" />
          <circle className="d-button" cx="120" cy="137" r="2.6" />
          <circle className="d-button" cx="120" cy="148" r="2.6" />

          {/* bow tie */}
          <path className="d-bowtie" d="M120,106 L100,97 L100,115 Z" />
          <path className="d-bowtie" d="M120,106 L140,97 L140,115 Z" />
          <rect className="d-bowtie" x="114.5" y="100.5" width="11" height="11" rx="3" />

          {/* head */}
          <g className="d-head">
            <ellipse className="d-skin" cx="93" cy="48" rx="5" ry="7" />
            <ellipse className="d-skin" cx="147" cy="48" rx="5" ry="7" />
            <ellipse className="d-hair" cx="120" cy="42" rx="27" ry="26" />
            <ellipse className="d-skin" cx="120" cy="50" rx="22" ry="23" />
            <circle className="d-blush" cx="104" cy="56" r="3.4" />
            <circle className="d-blush" cx="136" cy="56" r="3.4" />
            {/* croupier visor */}
            <path className="d-visor" d="M88,40 Q120,14 152,40 Q120,31 88,40 Z" />
            <path className="d-visor-hi" d="M96,36 Q120,20 144,36 Q120,28 96,36 Z" />
            {/* eyes + brows */}
            <circle className="d-eye" cx="111" cy="49" r="2.8" />
            <circle className="d-eye" cx="129" cy="49" r="2.8" />
            <path className="d-brow" d="M106,43 Q111,40 116,43" />
            <path className="d-brow" d="M124,43 Q129,40 134,43" />
            {/* moustache + smile */}
            <path
              className="d-stache"
              d="M120,59 Q113,55 107,59 Q111,64 120,61 Q129,64 133,59 Q127,55 120,59 Z"
            />
            <path className="d-brow" d="M112,65 Q120,71 128,65" />
          </g>

          {/* left arm: hand resting by the chip stack */}
          <g className="d-arm d-arm--left">
            <path className="d-sleeve-ink" d="M82,112 Q62,142 96,158" />
            <path className="d-sleeve" d="M82,112 Q62,142 96,158" />
            <rect className="d-cuff" x="86" y="146" width="16" height="11" rx="4" transform="rotate(28 94 152)" />
            <circle className="d-skin" cx="100" cy="161" r="9.5" />
          </g>

          {/* right arm: hand fanning cards */}
          <g className="d-arm d-arm--right">
            <path className="d-sleeve-ink" d="M158,112 Q178,142 144,158" />
            <path className="d-sleeve" d="M158,112 Q178,142 144,158" />
            <rect className="d-cuff" x="138" y="146" width="16" height="11" rx="4" transform="rotate(-28 146 152)" />
            <g className="d-cards">
              <rect className="d-card" x="132" y="132" width="18" height="26" rx="2.5" transform="rotate(-18 141 150)" />
              <rect className="d-card" x="138" y="130" width="18" height="26" rx="2.5" />
              <rect className="d-card" x="144" y="132" width="18" height="26" rx="2.5" transform="rotate(18 153 150)" />
              <path className="d-pip" d="M153,138 l3.4,4.4 -3.4,4.4 -3.4,-4.4 Z" transform="rotate(18 153 142)" />
            </g>
            <circle className="d-skin" cx="140" cy="161" r="9.5" />
          </g>

          {/* chip stack on the table by the left hand */}
          <g className="d-chips">
            <ellipse className="d-chip-b" cx="68" cy="175" rx="11" ry="4.5" />
            <ellipse className="d-chip-r" cx="68" cy="169" rx="11" ry="4.5" />
            <ellipse className="d-chip-g" cx="68" cy="163" rx="11" ry="4.5" />
          </g>
        </g>
      </svg>
    </div>
  );
}
