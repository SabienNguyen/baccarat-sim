import type { PhaseTag } from "../engine/types";
import "./dealer-figure.css";

/**
 * A hand-drawn SVG croupier seated across the table. Purely decorative (his
 * "voice" is the DealerLine), so it's aria-hidden. He breathes when idle and
 * swings his hands / flicks the cards while a hand is being dealt. Fills are
 * themed via CSS classes; respects prefers-reduced-motion.
 */
export function Dealer({ phase }: { phase: PhaseTag }) {
  const dealing = phase === "Dealing";
  return (
    <div
      className={`dealer-figure ${dealing ? "is-dealing" : ""}`}
      data-phase={phase}
      aria-hidden="true"
    >
      <svg viewBox="0 0 220 180" className="dealer-svg" role="presentation">
        <defs>
          <linearGradient id="d-suit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#34344a" />
            <stop offset="1" stopColor="#191923" />
          </linearGradient>
          <radialGradient id="d-face" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#ecc198" />
            <stop offset="1" stopColor="#cf9a6a" />
          </radialGradient>
          <linearGradient id="d-arm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c2c3e" />
            <stop offset="1" stopColor="#202029" />
          </linearGradient>
        </defs>

        <ellipse className="d-shadow" cx="110" cy="173" rx="86" ry="9" />

        <g className="d-body">
          {/* neck (behind the jacket) */}
          <rect x="101" y="64" width="18" height="22" rx="6" className="d-skin" />

          {/* jacket / shoulders */}
          <path
            className="d-suit"
            d="M50,172 C46,116 60,88 110,88 C160,88 174,116 170,172 Z"
          />
          {/* shirt V */}
          <path className="d-shirt" d="M110,90 L98,98 L110,140 L122,98 Z" />
          {/* collar lapels */}
          <path className="d-lapel" d="M98,98 L110,90 L106,112 Z" />
          <path className="d-lapel" d="M122,98 L110,90 L114,112 Z" />
          {/* bow tie */}
          <path className="d-bowtie" d="M110,101 L98,95 L98,107 Z" />
          <path className="d-bowtie" d="M110,101 L122,95 L122,107 Z" />
          <circle className="d-bowtie" cx="110" cy="101" r="3.4" />

          {/* head */}
          <g className="d-head">
            <ellipse className="d-ear" cx="86" cy="48" rx="4.5" ry="6.5" />
            <ellipse className="d-ear" cx="134" cy="48" rx="4.5" ry="6.5" />
            <ellipse className="d-faceshape" cx="110" cy="46" rx="24" ry="27" />
            <path
              className="d-hair"
              d="M85,48 C85,18 135,18 135,48 C129,35 122,29 110,29 C98,29 91,35 85,48 Z"
            />
            <circle className="d-eye" cx="101" cy="47" r="2.7" />
            <circle className="d-eye" cx="119" cy="47" r="2.7" />
            <path className="d-brow" d="M96,40 Q101,37 106,40" />
            <path className="d-brow" d="M114,40 Q119,37 124,40" />
            <path className="d-stache" d="M99,59 Q110,66 121,59 Q110,61 99,59 Z" />
            <path className="d-smile" d="M104,62 Q110,67 116,62" />
          </g>

          {/* arms + hands (in front of the jacket) */}
          <g className="d-arm d-arm--left">
            <path className="d-sleeve" d="M74,104 Q56,134 100,144" />
            <circle className="d-skin d-hand" cx="100" cy="144" r="10" />
          </g>
          <g className="d-arm d-arm--right">
            <path className="d-sleeve" d="M146,104 Q164,134 120,144" />
            <circle className="d-skin d-hand" cx="120" cy="144" r="10" />
          </g>

          {/* cards being dealt */}
          <g className="d-cards">
            <rect className="d-card" x="100" y="130" width="17" height="25" rx="2"
              transform="rotate(-10 108 142)" />
            <rect className="d-card" x="106" y="128" width="17" height="25" rx="2"
              transform="rotate(8 114 140)" />
          </g>
        </g>
      </svg>
    </div>
  );
}
