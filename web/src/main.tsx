import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary";
import { trackVisit } from "./analytics";
import "./theme.css";

trackVisit(); // no-op until analytics is enabled (see docs/GROWTH.md G4)

const root = createRoot(document.getElementById("root")!);

// The wasm engine loads with the app's module graph. If that fails — no
// WebAssembly support, a blocked or interrupted download — render a plain
// notice instead of leaving a silent blank page.
import("./App")
  .then(({ App }) => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error("failed to load the table:", error);
    root.render(
      <div style={{ maxWidth: "36rem", margin: "20vh auto 0", padding: "0 1.5rem", textAlign: "center" }}>
        <h1>The casino didn&apos;t open</h1>
        <p>
          The game engine failed to load. Your browser may not support
          WebAssembly, or the download was interrupted — a refresh usually
          fixes it.
        </p>
      </div>,
    );
  });

// Dev-only test hook (stripped from production builds): park a tier's saved
// bankroll one minimum bet under its goal, so the next won hand triggers the
// TABLE BEATEN flow. In the browser console:  devAlmostWin("low")
if (import.meta.env.DEV) {
  void Promise.all([import("./bankrollStorage"), import("./tables")]).then(
    ([{ saveBankroll }, { tableSpec }]) => {
      (window as unknown as Record<string, unknown>).devAlmostWin = (tier = "low") => {
        const spec = tableSpec(tier as "low" | "mid" | "high");
        saveBankroll(tier, spec.goal - spec.table_min);
        location.reload();
      };
    },
  );
}
