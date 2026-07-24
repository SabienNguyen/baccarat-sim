// "Share your run" — renders a result card on a canvas (no dependencies) and
// hands it to the Web Share API, falling back to clipboard + image download.
// The image lives in the sharer's post, so this needs no server (GitHub Pages
// can't render per-result link previews — see docs/GROWTH.md G8/G12).

import { formatCents } from "./format";

export interface RunShare {
  /** "TABLE BEATEN!" or "BUSTED". */
  headline: string;
  /** Final bankroll, in cents. */
  bankroll: number;
  /** One-line subtitle for the card. */
  subtitle: string;
  /** Table tier, for the ?tier= deep link back into the game. */
  tier?: string;
}

function siteUrl(tier?: string): string {
  if (typeof location === "undefined") return "https://sabiennguyen.github.io/baccarat-sim/";
  const base = `${location.origin}${location.pathname}`;
  return tier ? `${base}?tier=${tier}` : base;
}

function shareText(s: RunShare): string {
  const headline = s.headline.replace(/!+$/, "");
  return `${headline} — I ran it to ${formatCents(s.bankroll)} on Baccarat Simulator. Beat the table: ${siteUrl(s.tier)}`;
}

function draw(ctx: CanvasRenderingContext2D, s: RunShare): void {
  const W = 1200,
    H = 630;
  const g = ctx.createRadialGradient(W / 2, H * 0.38, 60, W / 2, H * 0.38, 760);
  g.addColorStop(0, "#145c43");
  g.addColorStop(1, "#0b3d2e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(240,213,138,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  ctx.textAlign = "center";
  ctx.fillStyle = "#f0d58a";
  ctx.font = "700 76px Silkscreen, monospace";
  ctx.fillText(s.headline, W / 2, 200);

  ctx.fillStyle = "#ffffff";
  ctx.font = "400 132px VT323, monospace";
  ctx.fillText(formatCents(s.bankroll), W / 2, 360);

  ctx.fillStyle = "#d8c39a";
  ctx.font = "400 40px VT323, monospace";
  ctx.fillText(s.subtitle, W / 2, 440);

  ctx.font = "400 34px VT323, monospace";
  ctx.fillStyle = "#c9b98f";
  ctx.fillText("baccarat simulator — learn & play free", W / 2, 560);

  // chip accents
  const chips = ["#c0202a", "#1f6feb", "#f0d58a"];
  chips.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(W / 2 - 52 + i * 38, 590, 26, 26);
  });
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/**
 * Share a finished run. Tries native file share, then text share, then
 * clipboard, and always offers the image as a download as a last resort.
 * Never throws — a share failure must not disturb the game.
 */
export async function shareRun(s: RunShare): Promise<void> {
  const text = shareText(s);
  let blob: Blob | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      draw(ctx, s);
      blob = await toBlob(canvas);
    }
  } catch {
    /* canvas unavailable (e.g. jsdom) — fall through to text/clipboard */
  }

  const nav = typeof navigator !== "undefined" ? navigator : undefined;

  if (blob && nav?.canShare && nav.share) {
    const file = new File([blob], "baccarat-run.png", { type: "image/png" });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], text, title: "Baccarat Simulator" });
        return;
      } catch {
        /* user cancelled or share failed — try the next fallback */
      }
    }
  }

  if (nav?.share) {
    try {
      await nav.share({ text, url: siteUrl(s.tier), title: "Baccarat Simulator" });
      return;
    } catch {
      /* fall through */
    }
  }

  try {
    await nav?.clipboard?.writeText(text);
  } catch {
    /* clipboard blocked — the download below is the final fallback */
  }

  if (blob && typeof URL !== "undefined" && URL.createObjectURL) {
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "baccarat-run.png";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* nothing more we can do */
    }
  }
}
