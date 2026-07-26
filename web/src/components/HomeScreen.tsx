import { useState } from "react";
import { TABLES, type TableTier } from "../tables";
import { formatCents } from "../format";
import "./home.css";

/** GitHub Sponsors for the repo owner. Live the moment Sponsors is enabled on
 *  the account; until then GitHub shows its own "not accepting" page, so the
 *  link is never broken and needs no code change to switch on. */
const SPONSOR_URL = "https://github.com/sponsors/SabienNguyen";

interface HomeScreenProps {
  onPlay: (tier: TableTier) => void;
  onMultiplayer?: () => void;
}

type Mode = "menu" | "single" | "multi";

/** Title screen: pick a mode, pick a table, sit down. */
export function HomeScreen({ onPlay, onMultiplayer }: HomeScreenProps) {
  const [mode, setMode] = useState<Mode>("menu");

  return (
    <div className="home">
      <h1 className="home-title">
        Baccarat
        <span className="home-title-sub">Simulator</span>
      </h1>

      {mode === "menu" && (
        <div className="home-modes">
          <button type="button" className="mode-card" onClick={() => setMode("single")}>
            <span className="mode-name">Single Player</span>
            <span className="mode-blurb">You against the shoe</span>
          </button>
          <button
            type="button"
            className="mode-card"
            onClick={() => (onMultiplayer ? onMultiplayer() : setMode("multi"))}
          >
            <span className="mode-name">Multiplayer</span>
            <span className="mode-blurb">Live tables with friends</span>
            {!onMultiplayer && <span className="mode-ribbon">Coming soon</span>}
          </button>
        </div>
      )}

      {mode === "menu" && (
        <nav className="home-learn" aria-label="Learn baccarat">
          <span>New to baccarat?</span>
          <a href="how-to-play/">How to play</a>
          <a href="glossary/">Glossary</a>
          <a href="baccarat-roads/">Scoreboard roads</a>
        </nav>
      )}

      {/* The only ask in the whole app, and it lives on the menu rather than
          anywhere near the felt: nothing interrupts a hand, and nothing is
          gated. The engine link is the commercial route — support is the
          hobbyist one. */}
      {mode === "menu" && (
        <nav className="home-support" aria-label="Support this project">
          <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer">
            ♥ Support the project
          </a>
          <a href="license/">Using the engine commercially?</a>
        </nav>
      )}

      {mode === "single" && (
        <div className="home-tables" aria-label="Choose a table">
          {TABLES.map((t) => (
            <button
              key={t.tier}
              type="button"
              className={`table-card table-card--${t.tier}`}
              onClick={() => onPlay(t.tier)}
            >
              <span className="table-name">{t.label}</span>
              <span className="table-blurb">{t.blurb}</span>
              <span className="table-limits">
                {formatCents(t.table_min)} – {formatCents(t.table_max)}
              </span>
              <span className="table-buyin">Buy-in {formatCents(t.starting_bankroll)}</span>
            </button>
          ))}
          <button type="button" className="home-back" onClick={() => setMode("menu")}>
            Back
          </button>
        </div>
      )}

      {mode === "multi" && (
        <div className="home-multi" aria-label="Multiplayer">
          <p className="multi-pitch">
            Live tables are on the way: join public tables, host private ones for
            friends, and sweat the squeeze together — biggest bet gets the cards.
          </p>
          <div className="home-tables home-tables--preview">
            <div className="table-card table-card--disabled">
              <span className="table-name">Public Tables</span>
              <span className="table-blurb">Browse the floor, take a seat</span>
            </div>
            <div className="table-card table-card--disabled">
              <span className="table-name">Private Table</span>
              <span className="table-blurb">Invite code, your stakes, your rules</span>
            </div>
          </div>
          <button type="button" className="home-back" onClick={() => setMode("menu")}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}
