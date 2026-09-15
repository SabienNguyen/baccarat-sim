# Shoe lifecycle: cut ceremony, cut-card end, New Shoe vote (design, 2026-09-14)

Owner direction (2026-09-14): "someone leaving the shoe should not reset it. The
only time the shoe resets is when we ask for a new one, which should be voted
on, or when the shoe ends. A new shoe should be a whole thing: someone needs
to cut, with a realistic flow and a real animation. When a table is created
it is a new shoe, so the cut happens then too, and the creator of the table
does it." Decisions taken with the owner: **majority vote**, **the table
creator (host) holds the cut for every shoe**, **solo play gets the full
ceremony too**.

## 1. Today

- Engine `Shoe`: 8 decks, seeded ChaCha shuffle, burn ritual (turn the first
  card, burn that many; tens/faces burn ten), `CUT_CARD = 14` cards from the
  end. Both `Session` (solo) and `Table` (multiplayer) reshuffle *silently at
  deal time* when `remaining <= CUT_CARD`, and on `new_shoe()` (Betting only).
- History/roads persist across shoes. Nothing tells the player a shoe ended.
- `CutDeckModal.tsx` is a cosmetic desktop-only ritual (24 slots, HTML5 drag;
  touch cannot use it) shown from the solo New Shoe button; the cut position
  is ignored by the engine. It is deleted by this work.
- Any seat can press New Shoe at a multiplayer table with no announcement.

## 2. Rules (engine, shared by Session and Table)

### 2.1 Phase `ShoeCut`
A new phase before `Betting`. `PhaseTag::ShoeCut` is added (client-visible).
No bet, deal, ready, sit-out, peek, reveal, flip or settle is accepted in it
(`WrongPhase { expected: Betting, found: ShoeCut }`). Rename, rebuy, leave,
join and the vote/cut commands are.

```rust
pub enum ShoeCutReason { NewTable, CutCardOut, Vote }   // Session: NewTable | Requested | CutCardOut
```
- `Table::new` and `Session::new` start in `ShoeCut { reason: NewTable }`.
- Table: `cutter: Option<PlayerId>` is always the **host** (see 2.4). With no
  seats the table sits in `ShoeCut` with `cutter: None`; the first join sets it.

### 2.2 Cutting
`Table::cut_shoe(pid, position: u16)` / `Session::cut_shoe(position: u16)`,
`position` in `0..=1000` (fraction of the shoe, clamped by the engine to
`50..=950` — a real pit refuses a cut within a deck of either end).
1. `Shoe::new_cut(seed, position)`: build + shuffle as today, then **cut**:
   the packet above the cut (`idx = position * 416 / 1000` cards from the
   top) goes to the bottom. Then the burn ritual. The shoe records
   `CutReveal { position, turned: Card, burned: u8 }`.
2. `shoe_number += 1` (first cut → shoe 1). `history.clear()` (roads, bead
   plate, tally reset). `cut_card_out = false`, `last_outcome/last_round =
   None`, every seat's bets cleared, `ready = false`, `sitting_out = false`,
   `payouts = None`. Phase → `Betting`.
3. Views carry `shoe: ShoeView` (2.6) so every client can replay the same
   cut + burn animation from `last_cut`.
Only the cutter may cut (`TableError::NotYourCut`). Seed for shoe *n* is
`seed.wrapping_add(n)` as today, so the sequence stays reproducible.

### 2.3 Shoe end (cut card out)
Realistic: the cut card comes out during a coup, that coup finishes, **one
more hand** is dealt, then the shoe ends.
- After `settle()`: `if cut_card_out { end_shoe() } else if
  shoe.remaining() <= CUT_CARD { cut_card_out = true }`.
- `end_shoe()`: phase → `ShoeCut { reason: CutCardOut }`, cutter = host.
  Roads stay on screen until the cut (players can study the finished shoe),
  and clear at the cut (2.2).
- Feasibility: the cut card flips on at `remaining <= 14`; the hand that set
  it started with ≥ 15 cards and used ≤ 6, so ≥ 9 remain for the last hand,
  which needs ≤ 6. The compile-time assert becomes `CUT_CARD >= 12`. The
  deal-time reshuffle fallback is removed — the shoe never runs out and
  never reshuffles silently.
- `ShoeView.cut_card_out` drives the "LAST HAND" HUD chip and dealer line.

### 2.4 Host (creator)
`Table.host: Option<PlayerId>`: the first player to join. When the host
leaves, the next seat by join order becomes host; if the table is in
`ShoeCut`, the new host becomes the cutter. Leaving **never** touches the
shoe, the history or the phase otherwise. Solo has no host: the player cuts.

### 2.5 New Shoe vote (multiplayer)
- `Table::propose_new_shoe(pid)`: Betting only, no vote active, at least one
  seat. Creates `Vote { proposer, yes: {proposer}, no: {} }`.
- `Table::vote_new_shoe(pid, yes: bool)`: seated players only (sitting-out
  seats vote too), one vote each, changeable until resolved.
- Resolution after every vote and on `vote_expire()` (server 30 s timer):
  **passes** when `yes.len() * 2 > seats.len()` (strict majority);
  **fails** when `no.len() * 2 >= seats.len()` (majority can no longer be
  reached) or on expiry. Pass: every seat's bets cleared and refunded, phase
  → `ShoeCut { reason: Vote }`, cutter = host. Fail: nothing changes.
- A voter leaving is removed from the tally and the vote re-evaluated against
  the new seat count; the proposer leaving does not cancel it.
- Solo `Session::new_shoe()` is replaced by `request_new_shoe()`: Betting
  only, phase → `ShoeCut { reason: Requested }` (no vote, one player).

### 2.6 View additions (both `RoundSnapshot` and `TableView`)
```rust
pub struct ShoeView {
    pub number: u32,                  // 0 until the first cut
    pub cut_card_out: bool,
    pub cut_reason: Option<ShoeCutReason>,   // Some(..) only in ShoeCut
    pub cutter: Option<PlayerId>,     // Table only; None in Session
    pub last_cut: Option<CutReveal>,  // for the animation; cleared at the next ShoeCut
    pub vote: Option<VoteView>,       // Table only
}
pub struct CutReveal { pub position: u16, pub turned: Card, pub burned: u8 }
pub struct VoteView { pub proposer: PlayerId, pub yes: Vec<PlayerId>, pub no: Vec<PlayerId>, pub needed: u8 }
```
`SeatView` gains `host: bool`.

## 3. Server
- `ClientMsg`: `CutShoe { position: u16 }`, `ProposeNewShoe`, `VoteNewShoe { yes: bool }`. `NewShoe` is removed (protocol bump).
- Vote timer: on a successful propose, spawn a 30 s task that calls
  `table.vote_expire()` if that vote is still open, then broadcasts.
- Announcements: "{host} has the cut — waiting on the shoe", "{name} calls
  for a new shoe — vote (k of n)", "New shoe: the table says yes/no",
  "Cut card's out — one more hand, then a fresh shoe", "{host} cuts the
  shoe", "Dealer turns the {card} — {n} cards burned", "Shoe {n}. Place your
  bets." Host handover: "{name} now has the cut".
- `try_auto_deal` is untouched; ShoeCut is not Betting so it never fires.
- The lobby `RoomInfo` may show `shoe: number` (optional, cheap).

## 4. Web
### 4.1 `ShoeCutStage` (replaces `CutDeckModal`)
Full-viewport stage in the peel-overlay style (dim + blur backdrop), mounted
whenever `phase === "ShoeCut"`, solo and multiplayer, phone and desktop.
- **Cutter view**: the shoe drawn edge-on as a long stack of card slivers
  (CSS, 416 slivers scaled to width). A yellow cut card is dragged along it
  with pointer events (touch + mouse; keyboard arrows + Enter as a11y). The
  card snaps to a position 5–95 %. Release shows "Cut here" / adjust; tap
  confirms → `cut_shoe(position)`.
- **Everyone else**: the same shoe with "Waiting for {host} to cut the
  shoe"; a spectator sees it too.
- **Animation** (plays for everyone when `shoe.number` increases, from
  `last_cut`, ~2.5 s, reduced-motion → instant): the front packet lifts and
  slides to the back; the top card flips to show `turned`; `burned` slivers
  slide off to a discard pile with a counter; "SHOE {n}" banner; the roads
  panel wipes empty. SFX: riffle on the cut, flip, slide (reuse existing
  card SFX; add a riffle if none).
- Stage unmounts after the animation; Betting resumes.
### 4.2 Controls / HUD / roads
- `ShoeCut`: Deal/Ready/bet spots disabled; the action bar shows only Explain/
  Mute-type controls and, for the cutter, nothing else (the stage owns it).
- New Shoe button → "New shoe": solo → `request_new_shoe`; multiplayer →
  `ProposeNewShoe`, then the seat strip shows the vote: ✓/✗ for me, marks
  under each seat, "k of n", a 30 s bar. Disabled while a vote is open.
- HUD: "LAST HAND" chip when `cut_card_out`; tally row "Shoe {n}".
- Dealer line narrates every step (mirror the server lines in `narrate.ts`
  for solo).
### 4.3 Roads
Roads render from the view's scoreboard as today; the reset is engine-side.
The wipe is a CSS transition keyed on `shoe.number`.

## 5. Tests
- Engine: new table/session start in ShoeCut; cut clamps position and
  rotates the packet deterministically; burn reveal recorded; cut resets
  history/bets/flags and increments number; only the cutter may cut; host
  handover on leave (incl. during ShoeCut); cut-card-out → one more hand →
  ShoeCut; no silent reshuffle ever (a 100-coup run never changes
  `shoe_number` without a cut); vote pass/fail/expire/leave maths; leaving
  never changes shoe or history; solo request → ShoeCut.
- Server: propose → announce → votes → pass → ShoeCut broadcast; expiry;
  host leave handover; CutShoe by non-host refused; the whole join → cut →
  bet → ready → deal → settle happy path.
- Web: stage mounts on ShoeCut; drag sets position and confirm sends it;
  non-cutter sees waiting text; animation runs once per shoe number; vote UI
  in the strip; LAST HAND chip; tally shoe row.
- Probes: phone (390×844) and desktop (1440×900) walk create → cut → deal;
  screenshot of the cutter stage and the burn animation mid-way.
