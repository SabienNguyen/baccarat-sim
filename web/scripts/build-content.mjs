// Generates the static, crawlable SEO content pages into web/public/ at build
// time (Node-only, so it runs identically in local, GitHub Pages CI, and the
// cargo-less Docker web stage). These pages are the one thing the SPA can never
// surface to a non-JS crawler — real prose for "how to play baccarat",
// "baccarat glossary", "baccarat roads" — each linking into the live game.
//
// The banker third-card tableau below mirrors engine/src/rules.rs
// (`banker_draws`). Those are fixed casino rules, verified against published
// sources in the 2026-07-24 rules-correctness audit; keep the two in step if
// the engine ever gains a rule variant.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = resolve(ROOT, "public");
const SITE = "https://sabiennguyen.github.io/baccarat-sim/";
const OG_IMAGE = `${SITE}og-image.png`;

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0b3d2e; color: #eae3d2;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: 1.65; font-size: 17px;
  }
  .wrap { max-width: 820px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  header { border-bottom: 1px solid rgba(240,213,138,0.3); padding-bottom: 1rem; margin-bottom: 2rem; }
  header a.brand { color: #f0d58a; text-decoration: none; font-weight: 700; font-size: 1.15rem; letter-spacing: 0.04em; }
  nav { margin-top: 0.6rem; display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.95rem; }
  nav a { color: #d8c39a; text-decoration: none; }
  nav a:hover { color: #fff; text-decoration: underline; }
  h1 { color: #f0d58a; font-size: 1.9rem; line-height: 1.25; margin: 0 0 0.6rem; }
  h2 { color: #f0d58a; font-size: 1.3rem; margin: 2.2rem 0 0.6rem; }
  h3 { color: #f4c430; font-size: 1.05rem; margin: 1.6rem 0 0.4rem; }
  a { color: #9ad; }
  code { background: rgba(0,0,0,0.3); padding: 0.05em 0.35em; border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.9rem; overflow-x: auto; display: block; }
  th, td { border: 1px solid rgba(240,213,138,0.25); padding: 0.4rem 0.55rem; text-align: center; }
  th { background: rgba(240,213,138,0.1); color: #f0d58a; }
  td.draw { color: #7fd6a3; } td.stand { color: #e0a0a0; }
  .cta { display: inline-block; margin: 1.5rem 0; background: #f0d58a; color: #15110f;
    padding: 0.7rem 1.4rem; border-radius: 6px; text-decoration: none; font-weight: 700; }
  .cta:hover { background: #f4c430; }
  dl dt { color: #f4c430; font-weight: 700; margin-top: 1rem; }
  dl dd { margin: 0.2rem 0 0; }
  footer { margin-top: 3rem; padding-top: 1.2rem; border-top: 1px solid rgba(240,213,138,0.3); font-size: 0.9rem; color: #b8ad92; }
  .lede { font-size: 1.05rem; color: #d8c39a; }
`;

function page({ slug, title, description, bodyHtml, jsonLd }) {
  const canonical = `${SITE}${slug}/`;
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="theme-color" content="#0b3d2e" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${OG_IMAGE}" />
<style>${CSS}</style>
${ld}
</head>
<body>
<div class="wrap">
<header>
<a class="brand" href="../">♠ Baccarat Simulator</a>
<nav>
  <a href="../how-to-play/">How to play</a>
  <a href="../glossary/">Glossary</a>
  <a href="../baccarat-roads/">Scoreboard roads</a>
  <a href="../">Play free ↗</a>
</nav>
</header>
<main>
${bodyHtml}
</main>
<footer>
A free, browser-based baccarat (punto banco) simulator — learn the game by
playing it, then <a href="../">try a hand free</a>. No sign-up, no real money.
</footer>
</div>
</body>
</html>
`;
  const dir = resolve(PUBLIC, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "index.html"), html);
  return canonical;
}

// ---- exact mirror of engine/src/rules.rs::banker_draws ----
function bankerDraws(bt, pt /* number | null */) {
  if (pt === null) return bt <= 5;
  if (bt <= 2) return true;
  if (bt === 3) return pt !== 8;
  if (bt === 4) return pt >= 2 && pt <= 7;
  if (bt === 5) return pt >= 4 && pt <= 7;
  if (bt === 6) return pt >= 6 && pt <= 7;
  return false; // 7 stands
}

function bankerTableau() {
  const cols = [...Array(10).keys()]; // player third card 0..9
  const head = `<tr><th>Banker total ↓ / Player 3rd →</th>${cols
    .map((c) => `<th>${c}</th>`)
    .join("")}<th>Player stood</th></tr>`;
  const rows = [];
  for (let bt = 0; bt <= 7; bt++) {
    const cells = cols.map((pt) => {
      const d = bankerDraws(bt, pt);
      return `<td class="${d ? "draw" : "stand"}">${d ? "Draw" : "Stand"}</td>`;
    });
    const stood = bankerDraws(bt, null);
    cells.push(`<td class="${stood ? "draw" : "stand"}">${stood ? "Draw" : "Stand"}</td>`);
    rows.push(`<tr><th>${bt}</th>${cells.join("")}</tr>`);
  }
  return `<table><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}

// ---------- 1. How to play ----------
const howToPlay = `
<h1>How to Play Baccarat (Punto Banco)</h1>
<p class="lede">Baccarat is the simplest card game in the casino: you bet on which
of two hands — <strong>Player</strong> or <strong>Banker</strong> — will land
closest to a total of 9. You don't play a hand yourself; you bet on one. Here are
the full rules, including the one part everyone finds confusing: when a third
card is drawn.</p>
<a class="cta" href="../">▶ Play free in your browser</a>

<h2>The goal</h2>
<p>Two hands are dealt — the Player hand and the Banker hand. Each gets two cards
to start. Whichever hand totals closest to <strong>9</strong> wins. You bet,
before the deal, on <strong>Player</strong>, <strong>Banker</strong>, or a
<strong>Tie</strong>.</p>

<h2>Card values</h2>
<p>Only the ones digit of the total matters (everything is counted
<em>modulo 10</em>):</p>
<ul>
  <li>Ace = <strong>1</strong></li>
  <li>2 through 9 = <strong>face value</strong></li>
  <li>10, Jack, Queen, King = <strong>0</strong> (a "monkey")</li>
</ul>
<p>So a 7 and an 8 total 15, which counts as <strong>5</strong>. A King and a 9
total <strong>9</strong> — the best possible two-card hand.</p>

<h2>Naturals</h2>
<p>If either hand totals <strong>8 or 9</strong> on its first two cards, that's a
<strong>natural</strong>: the coup ends immediately and no third cards are drawn.
A natural 9 beats a natural 8.</p>

<h2>The Player third-card rule</h2>
<p>If neither hand has a natural, the Player hand acts first, by a fixed rule (no
choice involved):</p>
<ul>
  <li>Player total <strong>0–5</strong>: draw a third card.</li>
  <li>Player total <strong>6–7</strong>: stand.</li>
</ul>

<h2>The Banker third-card rule (the tableau)</h2>
<p>The Banker's decision is the famously fiddly part. It depends on the Banker's
two-card total <em>and</em> the value of the card the Player drew (or whether the
Player stood). This is the complete tableau — the exact rule this simulator's
engine uses:</p>
${bankerTableau()}
<p>Read a row by the Banker's two-card total, then the column for the Player's
third card. Example: the Banker has <strong>6</strong> and the Player's third
card was a <strong>4</strong> → the Banker <em>stands</em> (it only draws on a 6
when the Player's third card is a 6 or 7).</p>

<h2>Payouts and the commission</h2>
<ul>
  <li><strong>Player</strong> win pays <strong>1 : 1</strong> (even money).</li>
  <li><strong>Banker</strong> win pays <strong>1 : 1</strong> minus a
  <strong>5% commission</strong> — because the Banker hand wins slightly more
  often, the house takes a cut to balance it.</li>
  <li><strong>Tie</strong> pays <strong>8 : 1</strong>; Player and Banker bets
  push (are returned) on a tie.</li>
</ul>
<p>The Banker bet has the lowest house edge (~1.06%), the Player bet is close
(~1.24%), and the Tie is a sucker bet (~14%). "Bet Banker, avoid the Tie" is the
whole of basic baccarat strategy.</p>

<a class="cta" href="../">▶ Try a hand — squeeze the cards yourself</a>

<h2>Next</h2>
<p>Learn the table talk in the <a href="../glossary/">baccarat glossary</a>, or
decode the scoreboard patterns in the <a href="../baccarat-roads/">guide to the
baccarat roads</a>.</p>
`;

// ---------- 2. Glossary ----------
const terms = [
  ["natural", "A two-card total of 8 or 9. It wins immediately — no third card is drawn by either hand."],
  ["punto-banco", "The most common form of baccarat, where the drawing rules are fixed and no one makes playing decisions. \"Punto\" is the Player, \"Banco\" the Banker."],
  ["monkey", "A card worth zero — any 10, Jack, Queen, or King. \"Monkey for the Player, counts for nothing.\""],
  ["snowman", "Table slang for an 8, from its shape."],
  ["le-grand", "\"The big one\" — a natural 9, the best hand in baccarat. A natural 8 is \"le petit.\""],
  ["squeeze", "The ritual of slowly bending up the corner of a face-down card to reveal it a sliver at a time, drawing out the suspense before the value is known. This simulator lets you do it with your mouse or finger."],
  ["commission", "The 5% the house takes from a winning Banker bet. The Banker wins slightly more often than the Player, and the commission is what makes the bet fair for the casino."],
  ["tie", "A bet that the Player and Banker hands finish on the same total. It pays 8:1 but carries a ~14% house edge — the worst bet on the table."],
  ["player-pair", "A side bet that the Player's first two cards are the same rank. Pays 11:1."],
  ["banker-pair", "A side bet that the Banker's first two cards are the same rank. Pays 11:1."],
  ["dragon-7", "In EZ Baccarat, a Banker win with a three-card total of 7. The Banker main bet pushes, and the Dragon 7 side bet pays 40:1."],
  ["panda-8", "In EZ Baccarat, a Player win with a three-card total of 8. The Panda 8 side bet pays 25:1."],
  ["dragon-bonus", "A side bet that your hand wins by a large margin, or with a natural. The bigger the winning margin, the bigger the payout — up to 30:1 for a non-natural win by 9."],
  ["shoe", "The box that holds and dispenses the cards. Baccarat is dealt from an 8-deck shoe (416 cards), reshuffled when a cut card near the back is reached."],
  ["cut-card", "A colored card placed near the back of the shoe. When it appears in play, the current shoe is finishing and a shuffle is coming."],
];
const glossaryBody = `
<h1>Baccarat Glossary — Terms, Slang &amp; Side Bets</h1>
<p class="lede">The dealer's patter and the bet menu are full of jargon. Here's
what the words mean, from "monkey" to "Dragon 7."</p>
<a class="cta" href="../">▶ Play free and hear the dealer call them</a>
<dl>
${terms
  .map(
    ([slug, def]) =>
      `<dt id="${slug}">${slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</dt><dd>${def}</dd>`,
  )
  .join("\n")}
</dl>
<p>New to the game? Start with <a href="../how-to-play/">how to play baccarat</a>,
or learn to read the board in the <a href="../baccarat-roads/">scoreboard roads
guide</a>.</p>
`;
const glossaryLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: terms.map(([slug, def]) => ({
    "@type": "Question",
    name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    acceptedAnswer: { "@type": "Answer", text: def },
  })),
};

// ---------- 3. Roads ----------
const roadsBody = `
<h1>Baccarat Scoreboard Roads Explained</h1>
<p class="lede">The grids of red and blue dots beside a baccarat table are the
"roads" — a running record of results that players use to spot streaks and
patterns. There are five of them. Here's what each one tracks.</p>
<a class="cta" href="../">▶ Watch the roads fill in as you play</a>

<h2>Bead Plate</h2>
<p>The simplest road: one cell per coup, filled left-to-right, top-to-bottom.
Red = Banker win, blue = Player win, green = Tie. It's just a chronological log
of what happened.</p>

<h2>Big Road</h2>
<p>The main display. Each new result starts at the top of a column and stacks
<em>downward</em> as long as the same side keeps winning; when the other side
wins, a new column begins. A vertical run of reds is a Banker streak (a
"dragon"); alternating results zig-zag across columns. Ties are marked with a
small slash on the current cell rather than taking a space of their own.</p>

<h2>The derived roads</h2>
<p>Three smaller roads are <em>derived</em> from the Big Road. Instead of
tracking who won, they track whether the Big Road is <strong>repetitive</strong>
(patterns holding) or <strong>choppy</strong> (patterns breaking) — each looking
a different distance back. A red mark means "the pattern is regular," a blue mark
means "the pattern just broke."</p>
<h3>Big Eye Boy</h3>
<p>Starts from the second column of the Big Road and compares the two most recent
columns. It's the most sensitive of the three — it reacts to the shortest
patterns.</p>
<h3>Small Road</h3>
<p>Looks one column further back than the Big Eye Boy, skipping the column
immediately to the left. It smooths out some of the noise.</p>
<h3>Cockroach Pig</h3>
<p>Looks back further still. The three derived roads together let pattern
players see, at a glance, how "stable" the current shoe's trend is.</p>
<p>Note that the roads are a <em>record</em>, not a predictor — each coup is
independent, and no pattern changes the odds. They're part of the ritual and the
fun, and reading them is a genuine baccarat skill.</p>

<a class="cta" href="../">▶ See all five roads live</a>
<p>Brush up on the rules in <a href="../how-to-play/">how to play baccarat</a>,
or look up a term in the <a href="../glossary/">glossary</a>.</p>
`;
const roadsLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Baccarat Scoreboard Roads Explained",
  description:
    "What the Bead Plate, Big Road, Big Eye Boy, Small Road, and Cockroach Pig track, and how to read them.",
  image: OG_IMAGE,
  mainEntityOfPage: `${SITE}baccarat-roads/`,
};

const written = [
  page({
    slug: "how-to-play",
    title: "How to Play Baccarat — Rules, Third-Card Tableau & Payouts",
    description:
      "Learn baccarat (punto banco): the objective, card values, naturals, the full Player and Banker third-card drawing rules, and how payouts and the 5% commission work.",
    bodyHtml: howToPlay,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "How to Play Baccarat (Punto Banco)",
      description:
        "The complete rules of baccarat, including the Banker third-card tableau and payouts.",
      image: OG_IMAGE,
      mainEntityOfPage: `${SITE}how-to-play/`,
    },
  }),
  page({
    slug: "glossary",
    title: "Baccarat Glossary — Terms, Slang & Side Bets Explained",
    description:
      "A plain-English baccarat glossary: monkey, natural, squeeze, commission, Dragon 7, Panda 8, Dragon Bonus, pairs, the shoe, and more.",
    bodyHtml: glossaryBody,
    jsonLd: glossaryLd,
  }),
  page({
    slug: "baccarat-roads",
    title: "Baccarat Roads Explained — Big Road, Big Eye Boy, Small Road, Cockroach Pig",
    description:
      "How to read the baccarat scoreboard: the Bead Plate, Big Road, and the three derived roads (Big Eye Boy, Small Road, Cockroach Pig) that track whether the shoe is choppy or streaky.",
    bodyHtml: roadsBody,
    jsonLd: roadsLd,
  }),
];

console.log(`content pages written:\n${written.map((u) => "  " + u).join("\n")}`);
