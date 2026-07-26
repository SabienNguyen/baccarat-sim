# Selling the engine

`MONETIZATION.md` ranks **B2B engine licensing** as the highest-leverage path and
calls the engine "the genuine moat." This document is how that gets sold: what the
product actually is, who buys it, what to charge, and which parts are already open
for business versus which need a decision first.

**Live now, no decision required:** services around the engine — rule variants,
integration, a compliance audit report, a support window — advertised at
`/license/` on the site. See the next section for why MIT does not stand in the
way of that.

## Correction to an earlier framing in this file

An earlier draft called MIT "the blocker" and treated relicensing as a
precondition for any revenue. That was wrong, and it mattered: it turned a live
opportunity into something waiting on a legal decision.

**MIT does not stop you selling.** It stops you selling *exclusivity* in the code.
Everything a buyer actually needs beyond the source is unaffected and sellable
today, with no licence change and nobody's permission:

- bespoke rule variants and integration work (your labour, priced per scope);
- a compliance audit report written for a certification reader (a new document you
  author — it isn't in the repo, so the repo's licence has no bearing on it);
- a support window with a named contact and prioritised fixes;
- custom builds: extra side bets, other games to the same standard of proof, a
  branded reskin.

MIT means a buyer never has to ask. It also means nobody else will answer their
auditor's questions. That gap is the product, and it is open for business now —
which is what `/license/` on the site sells.

Relicensing is therefore **optional upside**, not a gate. Read the next section as
"here is what MIT costs you if you later want to sell the code itself", not "you
cannot earn until you fix this".

## The optional upside: MIT gives away code exclusivity

`LICENSE` is **MIT**. In plain terms, MIT grants anyone — including a funded
competitor or a social-casino operator — the right to:

- use the engine commercially, for free, forever;
- modify it and keep the changes closed;
- **sublicense and sell it**, with no payment and no obligation beyond keeping a
  copyright notice in a file nobody reads.

So if the intent is ever to sell the *code* as exclusive IP, that option erodes
with each MIT release. Selling services around the code does not depend on it.

### What can and cannot be undone

- **Cannot:** revoke MIT for commits already published. Anyone who has this
  repository keeps a perpetual MIT licence to that snapshot. That is how MIT
  works and no relicensing changes it.
- **Can:** licence *future* versions differently. The copyright is Sabien
  Nguyen's, and MIT does not require derivative or later works to stay MIT.

The practical consequence is a timing one. Every commit published under MIT
widens the free snapshot a competitor can start from, and the engine has been
improving fast — the exact-enumeration proof, the corrected Tiger Tie paytable
and the Banker Dragon Bonus all landed in the last few days. Relicensing today
means the free snapshot lacks them. Relicensing in six months means it doesn't.

**This is a legal decision and it is not mine to make.** What follows is the
recommendation and the drafted terms; changing `LICENSE` needs the owner's
explicit go-ahead, and ideally ten minutes of a lawyer's time.

## Recommended structure: dual licence

Split the repository by what is being sold:

| Part | Licence | Why |
|---|---|---|
| `engine/`, `engine-wasm/` | **Commercial**, plus free for non-commercial and evaluation use | This is the product. It is what a buyer cannot cheaply reproduce. |
| `web/`, `server/` | Source-available (e.g. **AGPL-3.0**) or stay MIT | The app is the demo and the marketing. Giving it away drives inbound; AGPL additionally stops a competitor shipping a closed reskin of the whole game. |

Why not simply "all rights reserved": the free app and public source are the top
of the funnel. A buyer evaluating a baccarat engine wants to *play* it and read
it first. Dual licensing keeps that, and charges only at the point of commercial
use.

The standard alternative if the owner would rather not maintain two licences is
**AGPL-3.0 for everything, plus a paid exception**. Same commercial effect: a
social-casino operator cannot AGPL their platform, so they buy the exception.

## What is actually being sold

The pitch is not "a baccarat game" — those are commodities, and MarketJS will
sell a reskinnable HTML5 one cheaply. The pitch is **a baccarat engine whose
correctness is proven rather than asserted**, which is exactly what a regulated
or quasi-regulated operator has to demonstrate to somebody:

- **Exhaustive proof, not sampling.** `engine/tests/exact_enumeration.rs` walks
  **all 1,659,001 reachable coups** of a fresh 8-deck shoe with exact
  hypergeometric weights. Leaf probabilities sum to 0.999999999978, and the
  outcome frequencies come out Player 44.624661% / Banker 45.859742% /
  Tie 9.515597% — matching the canonical 8-deck figures to six decimals.
- **Every paytable matches published analysis to within 0.0033pp**, across all
  eleven side bets.
- **Paytables cross-checked against regulator sources** — Nevada GCB Rules of
  Play and NJAC 13:69F — which is how the retired 35:1 Tiger Tie was caught and
  corrected to 45:1.
- **149 engine tests**, a seeded statistics suite, and a deterministic shoe
  (`ChaCha12Rng` pinned by name so seeded streams are bit-identical across
  `rand` releases — an auditor can reproduce any hand).
- **Rust core, WASM boundary, no runtime dependencies in the rules path.** Drops
  into a browser or a server; the same engine runs both here.
- **Not just rules:** five pit-accurate roads, the squeeze ritual, a teaching
  dealer with rule-level explanations.

That evidence is the differentiator, and it is unusually hard for a competitor to
match — they would have to build the proof, not just the game.

## Who buys it

1. **Social-casino and sweepstakes operators** — need correct games, carry their
   own payments/KYC/compliance. Best fit: they take on the regulatory load, which
   `MONETIZATION.md` identifies as the thing to offload.
2. **Casino-affiliate and casino-marketing sites** — want a real playable game to
   hold attention; buy a branded module.
3. **Game studios and white-label platforms** (the MarketJS-style market) — buy
   engines as components.
4. **Training and education** — dealer schools, "learn baccarat" products. Small
   deals, short sales cycles, useful for early proof.
5. **Regulated operators** — highest value, longest cycle, needs certification
   work (GLI/BMM) that is out of scope until there is capital.

## Packaging and price anchors

Three tiers, deliberately simple. These are anchors to negotiate from, not a
published rate card:

| Tier | What they get | Anchor |
|---|---|---|
| **Evaluation** | Full source, non-production, time-boxed | Free |
| **Indie / single title** | One product, one brand, no redistribution, engine only | low four figures, one-off |
| **Commercial** | Production use, one platform, support window, updates for a year | mid four to low five figures |
| **White-label / OEM** | Whole game reskinned, multi-brand, or redistribution rights | five figures plus, or per-seat/revenue share |

Two things worth charging separately, because they are the parts buyers cannot do
themselves and will ask for:

- **The audit artifact.** A signed report of the exact-enumeration results and
  the regulator cross-check, written for a compliance reader. This is largely
  already produced — it is the audit log in `BACKLOG.md` plus the test output.
- **Rule variants.** The engine already implements the `EZ` ruleset and the full
  Tiger family; Super 6 (A4) and the commission/no-commission toggle (A3) are
  small. Variants are the most common licensee request and the cheapest upsell.

## What has to be true before invoicing anyone

Ranked by what actually blocks a signature:

1. **Relicense** (owner decision — this is the blocker).
2. **A contact route.** There is currently no way for an interested party to make
   contact: no email, no licensing page, no `CONTACT`. Inbound is impossible.
   The public page added alongside this document fixes that.
3. **A one-page technical brief** for the buyer's engineer — the proof points
   above, condensed, with the reproduction command.
4. Payment rails — an invoice and a bank account is enough at this stage. This
   does *not* need the accounts/payments/server-balance layer that the
   consumer-facing paths (IAP, supporter tier) require, which is precisely why
   B2B is the cheaper first revenue.

## Honest expectations

B2B licensing pays in units of thousands per deal, not cents per impression, but
it is **outbound sales with a slow cycle** — weeks to months, and it needs the
owner to actually approach operators. It is the highest-value path per unit of
engineering, and the engineering is largely done. What it is not is passive.

For comparison, the paths that *are* passive need traffic this site does not yet
have. Ads on a free game realistically need five figures of monthly sessions
before the cheque covers a coffee, and gambling-adjacent content is a common
AdSense rejection category. Growth work (`GROWTH.md`) is the prerequisite for
those, and it is a longer road than one licensing conversation.
