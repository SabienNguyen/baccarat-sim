import { buildFaceOps, buildBackOps, buildStockOps, paintTexture, RED, BLACK, REF_W, REF_H } from "./facePainter";

type TextOp = Extract<ReturnType<typeof buildFaceOps>[number], { op: "text" }>;
const textOps = (ops: ReturnType<typeof buildFaceOps>) => ops.filter((o) => o.op === "text") as TextOp[];

test("the ace of spades is one big centered pip", () => {
  const ops = buildFaceOps("Ace", "Spades");
  const pips = textOps(ops).filter((o) => o.text === "♠" && o.px === 50);
  expect(pips).toHaveLength(1);
  expect(pips[0].x).toBeCloseTo(50);
  expect(pips[0].color).toBe(BLACK);
});

test("the five of hearts lays five red pips, lower ones flipped", () => {
  const ops = buildFaceOps("Five", "Hearts");
  const pips = textOps(ops).filter((o) => o.text === "♥" && o.px === 17);
  expect(pips).toHaveLength(5);
  expect(pips.every((o) => o.color === RED)).toBe(true);
  expect(pips.filter((o) => o.flip).length).toBe(2); // the y>50% pair
});

test("covering the indices removes exactly the four corner glyphs", () => {
  const full = textOps(buildFaceOps("Nine", "Clubs")).length;
  const covered = textOps(buildFaceOps("Nine", "Clubs", { coverIndices: true })).length;
  expect(full - covered).toBe(4);
});

test("thumbs are two skin ellipses over the index corners", () => {
  const ops = buildFaceOps("Nine", "Clubs", { coverIndices: true, thumbs: true });
  const thumbs = ops.filter((o) => o.op === "ellipse");
  expect(thumbs).toHaveLength(2);
});

test("court cards draw the figure double-ended", () => {
  const ops = buildFaceOps("King", "Diamonds");
  const courts = textOps(ops).filter((o) => o.text === "♚");
  expect(courts).toHaveLength(2);
  expect(courts.filter((o) => o.flip)).toHaveLength(1);
});

test("the back is stripes and bevel on the card blank", () => {
  const kinds = buildBackOps().map((o) => o.op);
  expect(kinds).toContain("stripes");
  expect(kinds).toContain("bevel");
  expect(buildStockOps().map((o) => o.op)).toEqual(["roundRect"]);
});

test("paintTexture degrades to null without 2D canvas (jsdom)", () => {
  expect(paintTexture(buildStockOps(), REF_W, REF_H, 2)).toBeNull();
});
