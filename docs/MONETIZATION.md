# Monetization Notes

Research on how this game could make money, mapped onto what it actually is:
a browser-based, free-chips **punto banco simulator** with a squeeze gimmick, a
teaching angle, a multiplayer Rust server, and a statistically-validated
Rust→WASM engine. MIT-licensed, deployed as a static SPA (GitHub Pages) plus a
Fly-hosted multiplayer server. No accounts, no payments, no server-side
persistence today.

_Not legal or financial advice — get counsel before anything involving real
money or app-store gambling categories._

## The fork that decides everything: real-money vs. free-chips

**Real-money gambling is effectively out of scope for a solo/indie project.**
A Curaçao license runs ~€55,000–80,000+ in year one (application + mandatory
local "substance" office + AML/KYC setup); Malta needs €100k share capital,
~5% gaming tax, and real annual compliance costs north of €600k, on 2–12 month
timelines with FATF-grade KYC/AML. That's a funded-company undertaking. Unless
this becomes a capitalized business, monetization lives entirely in the
**social / free-to-play** world, where the game "simulates gambling only, with
virtual currency that can be purchased but not cashed out." Apple and Google
both require a clear simulated-gambling label (18+); that label is what keeps
you out of the gambling-license regime.

## The prerequisite: today's build can't take money yet

Two facts from the codebase gate almost every paid model:

- **No accounts, no payments, no server-side persistence.** Bankroll lives in
  `localStorage` per tier; the multiplayer server has no auth. Every
  IAP/subscription model needs an identity + payment + durable-balance spine
  that doesn't exist yet.
- **The current design undercuts a chip economy.** Bankrolls reset and a busted
  player gets a free full rebuy (backlog F6/F7). If chips are free and infinite,
  nobody buys chips. A chip-selling model requires deliberately making the free
  economy scarcer — the exact ethically fraught lever the social-casino industry
  is being sued over (Bloomberg's "$11B economy built on players who can never
  cash out"; active Apple/Google/Meta social-casino lawsuits).

So the real question isn't just "which model" — it's "which model is worth
building the account/payment spine for."

## Ranked paths that fit this product

### 1. B2B — license the engine or white-label the game (highest leverage)
> **Blocked by the repository licence.** `LICENSE` is MIT, which already grants
> every prospective buyer the right to use, modify, sublicense and *sell* this
> engine for free. The asset this path intends to sell is currently a giveaway.
> Published commits keep their MIT grant permanently, but future versions can be
> licensed differently — so the cost of waiting is that the free snapshot keeps
> growing. See **`LICENSING.md`** for the recommended dual-licence structure,
> what is being sold, who buys it, and price anchors. Relicensing is the owner's
> legal decision and the first thing to settle on this path.

The differentiator isn't the chips; it's a *provably correct*, 8-deck,
statistically-validated Rust→WASM engine with the squeeze rendering, the roads,
and a teaching dealer. That's a licensable component. Established market:
platforms like MarketJS license/reskin HTML5 casino games and build white-label
portals. Sell the engine as a dependency, or the whole game as a branded module
to social-casino operators, casino-marketing sites, or sweepstakes platforms.
Monetizes the engineering quality directly and offloads payments/compliance/KYC
onto the *licensee*.

### 2. Cosmetic unlocks + supporter tier (lowest risk, cleanest fit)
All art and audio are generated in code — card faces, chips, felt, the
synthesized soundtrack. Cosmetic variants are nearly free to produce and
impossible to frame as pay-to-win: alternate card backs, table-felt themes,
skin toggles, dealer voice packs, chip color sets. Sell as one-time unlocks or a
single "Salon Pass." Pair with a tip jar (Ko-fi / Buy Me a Coffee) and an
itch.io pay-what-you-want listing. Needs only a lightweight entitlement check,
not a full chip economy, and carries none of the social-casino legal baggage.

### 3. Educational / training licensing
The game is deliberately a *teacher*: Explain mode, the third-card tableau
chart, the glossary, "learn the ropes." Package a premium "Learn Baccarat" mode
(drills, full tableau, dealer-school scenarios) and license it to casino dealer
schools, hospitality/gaming programs, or sell it as a one-time pro course.
Niche, high-intent, regulation-light.

### 4. Social-casino IAP chips + rewarded ads (biggest ceiling, biggest cost)
Industry standard: ~**70% of social-casino revenue from IAP** (chip packs,
timers, boosts) and **~30% from ads**, hybridized with a subscription/VIP tier,
in an ~$8.8B (2026) market growing to ~$16.8B by 2035. Real money *if it
scales* — but it means building the account/payment/anti-cheat/persistence
spine, deliberately tightening the free economy, and stepping into the ethical
and legal crossfire the industry is in now. Only pursue as a committed business.

### 5. Affiliate / sponsorship (do not start here)
Social-casino apps often funnel to regulated real-money operators via affiliate
links. It pays, but it's a geo-restricted regulatory landmine, it compromises
the clean teaching-tool positioning, and it drags you into gambling-advertising
rules. Skip until there's legal support.

### 6. Real-money gambling (only as a funded company)
See the licensing costs above. Out of scope for an indie project.

## Recommendation

For a solo/indie project, sequence it:

1. **Cosmetics + supporter tier now** — cheap, on-brand, minimal entitlement
   check, and validates whether anyone will pay at all.
2. **In parallel, package the engine/game for B2B licensing** — the genuine
   moat, and it makes *someone else* carry the compliance load.
3. Treat the full social-casino IAP build as an "only if this becomes my
   company" bet; treat real-money gambling as out of scope until there's capital
   and counsel.

Whatever the pick, the first engineering investment is the same and
unavoidable: an **accounts + payments + server-side balance** layer — which is
also what the backlog's auth/reconnect/persistence gaps (F7, "no auth") already
point at.

## Sources

- [Social Casino Games market size (EconMarketResearch)](https://www.econmarketresearch.com/industry-report/social-casino-games-market)
- [Social casino business models (Smartico)](https://www.smartico.ai/blog-post/social-casino-gaming-business-models-and-marketing-strategies)
- [Social casino mechanics & monetization (Galaxy4Games)](https://galaxy4games.com/en/knowledgebase/blog/social-casino-game-development-how-it-works-and-why-it-s-growing)
- [The social-casino economy (Bloomberg)](https://www.bloomberg.com/features/2026-social-casino-apps-addiction/)
- [Apple/Google casino-app policy impact (CasinoApps.org)](https://www.casinoapps.org/blog/impact-of-apple-and-google-on-casino-apps/)
- [Online gambling license costs 2026 (Wizards)](https://wizards.us/blog/online-gambling-license-cost/)
- [Curaçao gaming license fees (GBO)](https://gbo-licensing.com/curacao-gaming-license-fees/)
- [HTML5 casino game licensing / white-label (MarketJS)](https://www.marketjs.com/whitelabel/)
