import { useState } from "react";
import type { GlossaryEntry } from "../engine/types";
import "./glossary.css";

interface GlossaryTermProps {
  term: string;
  label: string;
  entry: GlossaryEntry | undefined;
}

export function GlossaryTerm({ term, label, entry }: GlossaryTermProps) {
  const [open, setOpen] = useState(false);
  if (!entry) return <em className="term-plain">{label}</em>;
  const id = `gloss-${term}`;
  return (
    <span className="glossary-term">
      <button
        type="button"
        className="term"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {label}
      </button>
      {open && (
        <span role="tooltip" id={id} className="term-popover">
          <strong>{entry.label}</strong> {entry.short}
        </span>
      )}
    </span>
  );
}
