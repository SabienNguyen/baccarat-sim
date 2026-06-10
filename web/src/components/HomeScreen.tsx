import { useState } from "react";
import { TABLES, type TableTier } from "../tables";
import { formatCents } from "../format";
import "./home.css";

interface HomeScreenProps {
  onPlay: (tier: TableTier) => void;
}

type Mode = "menu" | "single" | "multi";

/** Title screen: pick a mode, pick a table, sit down. */
export function HomeScreen({ onPlay }: HomeScreenProps) {
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
          <button type="button" className="mode-card" onClick={() => setMode("multi")}>
            <span className="mode-name">Multiplayer</span>
            <span className="mode-blurb">Live tables with friends</span>
            <span className="mode-ribbon">Coming soon</span>
          </button>
        </div>
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
