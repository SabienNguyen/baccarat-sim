// Card faces as GL textures. The artwork is built as a list of paint ops
// (pure data — testable without a canvas) and rasterized by a thin
// executor. Geometry lives in 100×143 reference units, the DOM card's
// desktop size; the executor scales to any card size (the aspect ratio is
// constant across the responsive breakpoints).
import type { Rank, Suit } from "../engine/types";
import { PIP_LAYOUT, RANK_SHORT, SUIT_GLYPH, COURT_GLYPH, suitColor } from "../cardArt";

export const REF_W = 100;
export const REF_H = 143;

// colors mirrored from theme.css / cards.css — a canvas can't read CSS vars
export const INK = "#15110f";
export const FACE_BG = "#ffffff";
export const STOCK_BG = "#ffffff";
export const BACK_A = "#3a2a55";
export const BACK_B = "#4a3a6a";
export const BEVEL_HI = "#4a4060";
export const BEVEL_LO = "#140f1f";
export const RED = "#c0202a";
export const BLACK = "#1a1a1a";
export const THUMB_SKIN = "#d9a679";
const FONT_TEXT = '"VT323", ui-monospace, monospace';
const FONT_DISPLAY = '"Press Start 2P", ui-monospace, monospace';

export type PaintOp =
  | { op: "roundRect"; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string; lineWidth?: number }
  | { op: "stripes"; period: number; colorA: string; colorB: string }
  | { op: "bevel"; inset: number; hi: string; lo: string }
  | { op: "text"; text: string; x: number; y: number; px: number; font: string; color: string; flip?: boolean }
  | { op: "ellipse"; x: number; y: number; rx: number; ry: number; fill: string; stroke?: string; lineWidth?: number }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number };

/** The card blank: rounded stock with the 3px ink border, alpha outside. */
const blank = (fill: string): PaintOp => ({
  op: "roundRect",
  x: 1.5,
  y: 1.5,
  w: 97,
  h: 140,
  r: 9,
  fill,
  stroke: INK,
  lineWidth: 3,
});

export function buildFaceOps(
  rank: Rank,
  suit: Suit,
  opts: { coverIndices?: boolean; thumbs?: boolean } = {},
): PaintOp[] {
  const color = suitColor(suit) === "red" ? RED : BLACK;
  const ops: PaintOp[] = [blank(FACE_BG)];
  if (!opts.coverIndices) {
    ops.push(
      { op: "text", text: RANK_SHORT[rank], x: 12, y: 13, px: 14, font: FONT_DISPLAY, color },
      { op: "text", text: SUIT_GLYPH[suit], x: 12, y: 27, px: 13, font: FONT_TEXT, color },
      { op: "text", text: RANK_SHORT[rank], x: 88, y: 130, px: 14, font: FONT_DISPLAY, color, flip: true },
      { op: "text", text: SUIT_GLYPH[suit], x: 88, y: 116, px: 13, font: FONT_TEXT, color, flip: true },
    );
  }
  const pips = PIP_LAYOUT[rank];
  if (pips) {
    // pip area: the DOM's `inset 12px 20px` → x 20..80, y 12..131
    for (const [px, py] of pips) {
      ops.push({
        op: "text",
        text: SUIT_GLYPH[suit],
        x: 20 + (px / 100) * 60,
        y: 12 + (py / 100) * 119,
        px: rank === "Ace" ? 50 : 17,
        font: FONT_TEXT,
        color,
        flip: py > 50,
      });
    }
  }
  const court = COURT_GLYPH[rank];
  if (court) {
    // court frame: the DOM's `inset 19px 22px`, double-ended figure
    ops.push(
      { op: "roundRect", x: 22, y: 19, w: 56, h: 105, r: 3, stroke: color, lineWidth: 2 },
      { op: "line", x1: 25, y1: 71.5, x2: 75, y2: 71.5, color, width: 1.5 },
      { op: "text", text: court, x: 50, y: 45, px: 30, font: FONT_TEXT, color },
      { op: "text", text: court, x: 50, y: 97, px: 30, font: FONT_TEXT, color, flip: true },
    );
  }
  if (opts.thumbs) {
    // the squeezer's thumbs over the index corners (edge grips): baked
    // into the texture, they ride every bend exactly like real fingers
    ops.push(
      { op: "ellipse", x: 13, y: 17, rx: 13, ry: 12, fill: THUMB_SKIN, stroke: INK, lineWidth: 2 },
      { op: "ellipse", x: 87, y: 126, rx: 13, ry: 12, fill: THUMB_SKIN, stroke: INK, lineWidth: 2 },
    );
  }
  return ops;
}

export function buildBackOps(): PaintOp[] {
  return [
    blank(BACK_A),
    { op: "stripes", period: 12, colorA: BACK_A, colorB: BACK_B },
    { op: "bevel", inset: 3, hi: BEVEL_HI, lo: BEVEL_LO },
  ];
}

export function buildStockOps(): PaintOp[] {
  return [blank(STOCK_BG)];
}

function traceRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function applyOps(ctx: CanvasRenderingContext2D, ops: PaintOp[], wPx: number, hPx: number): void {
  ctx.save();
  ctx.scale(wPx / REF_W, hPx / REF_H);
  for (const o of ops) {
    switch (o.op) {
      case "roundRect":
        traceRoundRect(ctx, o.x, o.y, o.w, o.h, o.r);
        if (o.fill) {
          ctx.fillStyle = o.fill;
          ctx.fill();
        }
        if (o.stroke) {
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.lineWidth ?? 1;
          ctx.stroke();
        }
        break;
      case "stripes": {
        // the DOM back's 45° repeating bands, clipped inside the border
        ctx.save();
        traceRoundRect(ctx, 3, 3, 94, 137, 7);
        ctx.clip();
        ctx.translate(REF_W / 2, REF_H / 2);
        ctx.rotate(Math.PI / 4);
        const span = REF_W + REF_H;
        let k = 0;
        for (let i = -span; i < span; i += o.period / 2, k++) {
          ctx.fillStyle = k % 2 === 0 ? o.colorA : o.colorB;
          ctx.fillRect(-span, i, span * 2, o.period / 2);
        }
        ctx.restore();
        break;
      }
      case "bevel":
        ctx.lineWidth = 2;
        ctx.strokeStyle = o.hi;
        ctx.beginPath();
        ctx.moveTo(o.inset, REF_H - o.inset);
        ctx.lineTo(o.inset, o.inset);
        ctx.lineTo(REF_W - o.inset, o.inset);
        ctx.stroke();
        ctx.strokeStyle = o.lo;
        ctx.beginPath();
        ctx.moveTo(REF_W - o.inset, o.inset);
        ctx.lineTo(REF_W - o.inset, REF_H - o.inset);
        ctx.lineTo(o.inset, REF_H - o.inset);
        ctx.stroke();
        break;
      case "text":
        ctx.save();
        ctx.translate(o.x, o.y);
        if (o.flip) ctx.rotate(Math.PI);
        ctx.font = `${o.px}px ${o.font}`;
        ctx.fillStyle = o.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(o.text, 0, 0);
        ctx.restore();
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = o.fill;
        ctx.fill();
        if (o.stroke) {
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.lineWidth ?? 1;
          ctx.stroke();
        }
        break;
      case "line":
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.width;
        ctx.stroke();
        break;
    }
  }
  ctx.restore();
}

/** Rasterize ops at wPx×hPx CSS px × scale. Null where 2D canvas is
 *  unavailable (jsdom) — callers fall back to the CSS peel. */
export function paintTexture(ops: PaintOp[], wPx: number, hPx: number, scale: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = Math.max(Math.round(wPx * scale), 1);
  c.height = Math.max(Math.round(hPx * scale), 1);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  applyOps(ctx, ops, wPx, hPx);
  return c;
}
