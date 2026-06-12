// Throwaway visual probe for the GL squeeze — not part of the app.
// Renders the engine at 2.5× with known grips so the GLSL geometry can be
// eyeballed against the TS reference (dumped to the console per cell).
import { gripFrom } from "./squeeze";
import { curlFromGrip, poseFrom, deform } from "./cardgl/curlMath";
import { CardGLEngine } from "./cardgl/engine";
import { buildFaceOps, buildBackOps, buildStockOps, paintTexture } from "./cardgl/facePainter";

const W = 100;
const H = 143;
const SCALE = 2.5;
const RECT = { left: 0, top: 0, width: W, height: H };

// [label, gx, gy, fx, fy]
const pulls: Array<[string, number, number, number, number]> = [
  ["edge light", 50, 138, 50, 105],
  ["edge half", 50, 138, 50, 70],
  ["edge deep", 50, 138, 50, 15],
  ["corner pinch", 85, 130, 40, 75],
  ["side pull", 5, 70, 60, 70],
];

const root = document.getElementById("root")!;
const row = document.createElement("div");
row.className = "row";
root.appendChild(row);

for (const [label, gx, gy, fx, fy] of pulls) {
  const grip = gripFrom(gx, gy, fx, fy, RECT);
  const cell = document.createElement("div");
  cell.className = "cell";
  const cap = document.createElement("div");
  cap.textContent = label + (grip ? ` (${grip.edge ? "edge" : "pinch"} p=${grip.progress.toFixed(2)})` : " (null)");
  const holder = document.createElement("div");
  holder.style.position = "relative";
  holder.style.width = `${(W + 120) * SCALE}px`;
  holder.style.height = `${(H + 120) * SCALE}px`;
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  holder.appendChild(canvas);
  cell.appendChild(cap);
  cell.appendChild(holder);
  row.appendChild(cell);
  if (!grip) continue;

  const engine = new CardGLEngine(canvas, W, H, 60, SCALE);
  engine.setTopTexture(paintTexture(buildBackOps(), W, H, 3)!);
  engine.setBotTexture(
    paintTexture(buildFaceOps("Seven", "Hearts", { coverIndices: true, thumbs: grip.edge }), W, H, 3) ??
      paintTexture(buildStockOps(), W, H, 3)!,
  );
  const curl = curlFromGrip(grip, W, H);
  engine.render(curl, poseFrom(grip, W, H));

  // reference dump: where key card points should land
  const pts: Array<[string, number, number]> = [
    ["grab", gx, gy],
    ["center", W / 2, H / 2],
    ["tl", 2, 2],
    ["br", W - 2, H - 2],
  ];
  console.log(
    `[${label}]`,
    pts.map(([n, x, y]) => {
      const d = deform(curl, x, y);
      return `${n}:(${x},${y})→(${d.x.toFixed(0)},${d.y.toFixed(0)},z${d.z.toFixed(0)})`;
    }).join("  "),
  );
}
