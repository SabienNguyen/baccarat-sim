// Throwaway visual probe for the squeeze fold — not part of the app.
import { createRoot } from "react-dom/client";
import { Card } from "./components/Card";
import { foldFrom } from "./squeeze";
import "./theme.css";

const RECT = { left: 0, top: 0, width: 90, height: 126 };
// bottom-edge pinch pulled up by increasing amounts, plus a corner pull
const pulls: Array<[string, number, number, number, number]> = [
  ["light", 45, 123, 45, 100],
  ["quarter", 45, 123, 45, 80],
  ["half", 45, 123, 45, 55],
  ["deep", 45, 123, 45, 20],
  ["corner", 80, 120, 30, 60],
];

function Probe() {
  return (
    <div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
      {pulls.map(([label, gx, gy, fx, fy]) => {
        const fold = foldFrom(gx, gy, fx, fy, RECT);
        return (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ display: "flex", gap: 24 }}>
              <Card card="FaceDown" fold={fold} />
              <Card
                card={{ Peeked: { sliver: { suit: "Spades", rank: "Nine" } } }}
                fold={fold}
              />
            </div>
            <p style={{ color: "#fff", fontFamily: "monospace", fontSize: 11 }}>{label}</p>
          </div>
        );
      })}
      <div style={{ textAlign: "center" }}>
        <Card card={{ Peeked: { sliver: { suit: "Hearts", rank: "Six" } } }} />
        <p style={{ color: "#fff", fontFamily: "monospace", fontSize: 11 }}>held</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Probe />);
