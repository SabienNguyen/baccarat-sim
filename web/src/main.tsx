import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
