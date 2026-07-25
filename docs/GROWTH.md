# Traffic / Growth Plan

How to get players to this game — a free, browser-based, no-real-money punto
banco *simulator* with a teaching angle, a WebGL card-squeeze, scoreboard roads,
and optional multiplayer. Deployed as a client-only SPA on GitHub Pages
(`https://sabiennguyen.github.io/baccarat-sim/`, base `"./"`) plus a small Rust
multiplayer server on Fly.

Two halves: **where the audience is** (distribution channels) and **the code
changes that support growth** (engineering roadmap). The engineering items are
tracked as G-items in `BACKLOG.md`; this doc is the rationale.

_Not legal advice. The recurring theme below: nearly every platform treats
real-money gambling as hard-banned but tolerates simulated/fictional-currency
card games — so frame everything as an educational **card-game simulator**,
never "casino"/"gambling," and lead with the no-wagering teaching angle._

## Part 1 — Distribution channels, ranked by ROI for a solo dev

### Tier 1 — do first (low cost, high fit, low/no gambling-policy risk)
1. **r/playmygame + r/WebGames** — exact product + audience fit; Reddit has no
   platform-wide gambling ban, only per-sub rules (check each sidebar; lurk +
   participate before dropping a link). A craft-forward simulator with an
   unusual mechanic does well here.
2. **itch.io listing** — trivial (zip upload), zero gambling restriction (itch
   bans real-money, not simulated), works as the canonical devlog/comments home.
3. **The SEO teaching wedge** — "how to play baccarat," "baccarat squeeze,"
   "baccarat roads/big road" content on our own site. The only channel with
   compounding, low-risk, long-tail growth. Direct competitor: Wizard of Odds'
   existing free trainer — our wedge is the squeeze, multiplayer, and genuinely
   *clear* road-reading explainers (a jargon-heavy topic affiliate sites explain
   badly). This is what Part 2's static content pages (G6) exist to feed.
4. **Rust/WASM tech-story channels** — r/rust ("what are you working on"),
   r/rust_gamedev, gamedev.rs, and *This Week in Rust*. No gambling friction at
   all (different audience — they care about the engine). Won't move player
   count much, but free credibility, backlinks, and contributors.
5. **One well-crafted Show HN** — high variance, free, no gambling blocker. Wins
   on the tech framing ("a baccarat engine in Rust→WASM with a physically
   simulated card squeeze and shared-state multiplayer"), not "play my casino
   game." One shot — spend it on a polished build.

### Tier 2 — worth trying (moderate effort / uncertain payoff)
6. **CrazyGames** — demonstrably tolerates casino-style card games (hosts
   Blackjack Master, Las Vegas Poker, a Card category). Requires real work: SDK
   integration + an iframe-safe "portal-embed" build (G-stretch). Doubles as ad
   revenue via their SDK. Payoff is a small slice of a big platform.
7. **Casino/advantage-play forums + Discords** (Wizard of Vegas forum,
   blackjack/card-counting communities) — excellent audience fit; success needs
   genuine participation before promotion, moderation risk is real and per-venue.
8. **Armor Games** — one cold email, a human reviews it, good teaching-angle
   framing; smaller/older audience than CrazyGames.
9. **Long-form YouTube tutorials** ("how to play baccarat") — safer under
   YouTube's 2025-26 gambling policy than clipped gameplay; real production
   effort.

### Tier 3 — skip / deprioritize
- **Poki** — own guidelines list gambling as unacceptable and the live catalog
  (solitaire, no blackjack/poker) backs it up; don't build their SDK for a
  likely rejection.
- **TikTok / YouTube Shorts squeeze clips** — the squeeze is a *proven* viral
  ASMR genre (whole playlists of "unintentional ASMR baccarat squeeze" exist),
  but both platforms are tightening gambling-content policy in 2025-26; expect
  flags/limited reach even when compliant, and a flagged video can suppress the
  whole account. Treat as a lottery ticket, not a channel. If tried: frame as
  education/practice, never "casino/bet/win real."
- **Product Hunt** (wrong audience — SaaS/AI-leaning), **Kongregate** (dead,
  no submissions since 2020), generic web-game directories & GameDiscoverCo
  (irrelevant/Steam-only), **affiliate-site backlinks** (they're real-money
  competitors, won't link a free tool — pursue dealer-training schools instead).

### The two non-obvious opportunities
- **Casino dealer-training schools** — B2B outreach, no platform gatekeeping,
  excellent fit (students need to practice payouts, roads, squeeze etiquette).
  Overlaps with the `MONETIZATION.md` B2B/education path.
- **The squeeze is already a known ASMR genre** — a genuine content hook; the
  differentiator vs. thousands of real-casino clips is "practice free, no casino
  needed."

## Part 2 — Engineering roadmap (the code changes)

Ordering logic: for a client-only GH Pages SPA the single biggest lever is that
**crawlers see an empty `<div id="root">`** (first paint waits on a dynamic
`import("./App")` that pulls the 210 KB wasm). The right fix here is **not SSR**
(no Node runtime on Pages) and **not a prerender plugin** (the app has one route,
and its teaching content only exists inside gameplay state) — it's a small set of
genuinely static, keyword-rich HTML pages generated from the same `glossary.rs`
data the engine already owns, linking into the app. Cheap hygiene first, then
that content wedge, then the viral loops.

| # | Item | Effort | Files | Why here |
|---|------|--------|-------|----------|
| G1 | **Crawlability hygiene bundle**: `robots.txt`, `sitemap.xml` (v1), `canonical`+`og:url`+`og:site_name`+Twitter Card+`robots` meta, JSON-LD `WebApplication`/`SoftwareApplication` (co-typed — bare `VideoGame` doesn't get rich results) | S | `web/public/*`, `web/index.html` | Zero-risk table stakes; Twitter Card alone fixes the imageless link-unfurl on every Reddit/Discord/HN share |
| G2 | **Static `og:image`** (1200×630, felt-green `#0b3d2e` + squeeze art) + `twitter:image` wiring — closes **H4** | S | `web/public/og-image.png`, `web/index.html` | Cheapest social-share legitimacy win |
| G3 | **Self-host fonts** (Silkscreen/VT323 woff2, `font-display: swap`) — closes **H3** | S | `web/public/fonts/`, `web/src/theme.css` | Removes the render-blocking Google Fonts `@import`; the one clear LCP bug |
| G4 | **Analytics** (GoatCounter — lightest fit for a project already running a small server; free for OSS) + events: first-hand-played, returning-visitor (localStorage flag), victory/bust (tier-tagged), room-link vs lobby join | S | `web/index.html`, `gameStore.ts`, `VictoryModal.tsx`, `BustModal.tsx` | Everything else is unverifiable without a baseline — sequence early |
| G5 | **`?room=CODE` deep link** + copy the full URL, not the bare code — closes **F5** | S | `web/src/multiplayer/Multiplayer.tsx` | The mechanic (codes + clipboard) is already built; this turns a 3-step invite into a 1-click link — highest-leverage referral loop |
| G6 | **`?tier=` deep link** (seed `App.tsx` state from `location.search`) | S | `web/src/App.tsx` | The landing half of the share-a-run link (G8) |
| G7 | **Static content pages** — `how-to-play/`, `glossary/`, `baccarat-roads/`, rendered at build time from a native `engine` bin that dumps `glossary()` + the third-card tableau to JSON, templated by a small Node script; each real HTML with its own title/meta/canonical/FAQ-JSON-LD and a CTA into the app; footer links from `HomeScreen`; add to sitemap | M–L | new `engine` bin, `web/scripts/build-content.mjs`, `web/public/{how-to-play,glossary,baccarat-roads}/`, `package.json`, `deploy.yml` | **The single biggest lever** — the only change that gives search + AI crawlers real prose for the target keywords. Reuses `glossary.rs` as the single source (no copy drift), matching the repo's anti-duplication ethos |
| G8 | **Client-side "share your run"** — a `<canvas>` share card on Victory/Bust (bankroll via `formatCents`, tier name), `navigator.share({files})` with `toBlob`/clipboard fallback (mirrors the existing `copyText` in `Multiplayer.tsx`); share text embeds a `?tier=` link | M | new `web/src/shareCard.ts`, `VictoryModal.tsx`, `BustModal.tsx` | The real viral loop ("I ran $500 → $5,412 — beat it"), and it sidesteps the "GH Pages has no compute" constraint by putting the image in the sharer's post, not a link-preview tag |
| G9 | **Service worker** (precache the content-hashed JS/CSS/wasm, cache-first; leave `/ws` untouched); register behind a feature check; pairs with the G1 manifest | M | `web/src/main.tsx`, new SW, `vite.config.ts` | Single-player is already offline-capable (WASM + localStorage) — SW makes every return visit instant; retention lever once traffic exists |
| G10 | **Web app manifest + icons** (192/512 + maskable from `favicon.svg`, `standalone`, theme `#0b3d2e`) | S | `web/public/manifest.webmanifest`, `web/index.html` | Enables install prompts; prerequisite for G9's full PWA story |
| G11 (stretch) | Build-time static render of `HomeScreen` into `#root` (`renderToStaticMarkup`, no wasm dep) as a progressive-enhancement shell | M | `web/index.html`, build script | Gives crawlers real menu text; layered on top of G7, not instead of it |
| G12 (stretch) | Dynamic per-result OG image via a new Fly `GET /share.png` route + server-rendered result HTML | L | `server/src/main.rs`, `fly.toml` | Highest polish, but the link-preview half genuinely needs request-time compute (Pages can't), and `min_machines_running=0` cold-starts can exceed unfurl-bot timeouts (couples to **S12/H12**). Do last, only if G8 proves demand |

### Suggested first two PRs
- **PR A (≈1 day, all S):** G1 + G2 + G3 + G4 + G5 + G6 + G10 — hygiene, share
  image, fonts, analytics, both deep links, manifest. Immediately makes shared
  links look real, makes traffic measurable, and ships the one-click invite loop.
- **PR B (the big lever):** G7 static content pages — the durable organic-search
  engine for the "learn baccarat" intent the SPA can never surface itself.

Then G8 (share-a-run) once analytics from PR A shows where players arrive, and
G9/G11/G12 as retention/polish once there's traffic to retain.

## Sources
- itch.io simulated-gambling rule: https://itch.io/t/2948799/question-about-gambling-rules-simulated-gambling
- CrazyGames HTML5 SDK: https://docs.crazygames.com/sdk/html5-v2/intro/
- CrazyGames Card category (casino card games live): https://www.crazygames.com/c/card
- Poki quality guidelines (gambling listed unacceptable): https://sdk.poki.com/poki-quality-guidelines
- TikTok gambling/simulated-casino policy: https://www.tiktok.com/community-guidelines/en/regulated-commercial-activities
- YouTube gambling-content enforcement (2025-26): https://support.google.com/youtube/answer/6162278
- Wizard of Odds free baccarat trainer (the SEO competitor): https://wizardofodds.com/play/baccarat/
- SPA SEO / JS crawling: https://vercel.com/blog/how-google-handles-javascript-throughout-the-indexing-process
- Schema.org Game / rich-result typing: https://www.incremys.com/en/resources/blog/schema-seo
- Self-hosted analytics comparison: https://openpanel.dev/articles/self-hosted-web-analytics
- This Week in Rust (tech-story channel): https://this-week-in-rust.org/
