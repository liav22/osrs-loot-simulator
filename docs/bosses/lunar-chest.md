# Lunar Chest — Moons of Peril

`lootSourceId: lunar-chest`. Watchlisted (`without_replacement`). Blocks: Blood Moon, Blue Moon,
Eclipse Moon, Moons of Peril.

Source: **Lunar Chest** — https://oldschool.runescape.wiki/w/Lunar_Chest — pageid `459085`,
revid `15284737`. Local snapshot (`data/snapshots/wikitext/lunar-chest.json`, fetched
2026-08-11T13:22:55Z) postdates this revid's own timestamp (2026-07-31) — **not stale**, no
re-fetch needed.

## Watchlist label sanity check

**The label (`without_replacement`) is correct but incomplete.** It correctly names the
duplicate-protection sub-roll, but the watchlist detail text ("Model as a weighted table with
rolls > 1 and withoutReplacement: true") undersells the structure: there isn't one weighted table
with N rolls, there are **three independent per-Moon triggers**, each gated on whether that
specific Moon was actually killed in the run that opened this chest, and the number of *standard*
loot rolls (1/3/6) depends on how many of the three were killed — a variable this loot source's
own drop rows never encode at all. Getting this wrong in the direction of "just wire up
`withoutReplacement`" would ship a chest that's always eligible for all three sets' uniques
regardless of which Moon was actually fought, which is not what happens in game.

## The reward mechanic, in prose

The chest is opened once, after killing at least one of Blood Moon / Blue Moon / Eclipse Moon (all
three must be killed once, lifetime, to unlock it at all).

1. **Per-Moon unique trigger.** Killing a given Moon (independently, if multiple were killed
   before opening) grants a **1/56** chance at a piece of that Moon's 4-item armour/weapon set.
2. **Duplicate protection.** If the 1/56 hits, which of the (as-yet-unowned) pieces is given is a
   **uniform roll over "number of items in set not obtained yet"** — i.e. real
   without-replacement, exactly the schema's `withoutReplacement` semantics, but scoped **per
   4-item set**, not across all 12 unique items combined. A player who already owns all 4 Eclipse
   pieces but 0 Blood pieces still has the Eclipse 1/56 roll do nothing useful — Jagex's own
   correction (cited news post) explicitly rules out the "1/56 for ANY item across all sets"
   reading a first-draft news post implied.
3. **Multiple Moons in one opening.** Independent, so 3-Moon overall unique chance is
   `1 − (55/56)³ ≈ 1/19`, **not** `3/56` and **not** a bonus fourth roll (both wrong readings
   explicitly disclaimed by a Jagex correction post cited on the page).
4. **If ANY unique hits, the standard loot table is not rolled at all.** Otherwise, standard loot
   rolls **1× (one Moon), 3× (two Moons), or 6× (three Moons)** — the multiplier is *3× per
   additional Moon*, not additive.

## Formulas

No named formula in `packages/loot-model/src/formulas.ts`'s registry covers this shape (it isn't
points-scaled, so none of `toa_invocation`/`cox_points`/`tob_points`/etc. fit). No new formula id
is being proposed here — see gaps below for why a formula wouldn't even solve the actual problem.

### Per-Moon unique trigger + sub-roll

```
P(hit for Moon M) = 1/56   [independent per Moon actually killed this run]
P(specific unowned piece | hit) = 1 / (piecesInSet − piecesOwned)   [uniform, standard withoutReplacement]
piecesInSet = 4 for every one of the 3 sets (Eclipse: atlatl + 3 armour; Blood: dual macuahuitl + 3
              armour; Blue: spear + 3 armour)
```
Source: `==Loot mechanics==`, revid `15284737`. Flat per-item rarity given in the drop table itself
(`1/224` = `1/56 × 1/4`) is explicitly labelled as **not** accounting for duplicate protection —
i.e. it's the naive/first-piece-only figure, not what a repeat player actually experiences; don't
use `1/224` as a `fixed` rate for a `weighted`/`withoutReplacement` table without re-deriving it,
since duplicate protection changes the true marginal rate as pieces are collected.

### Standard-loot roll count

```
rolls(nMoonsKilled) = { 1 if nMoonsKilled=1, 3 if nMoonsKilled=2, 6 if nMoonsKilled=3 }
```
Source: same section, revid `15284737`.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'lunar:blood-unique', mode: 'preroll', rolls: 1, entries: [
      { node: weighted-without-replacement(blood-set, 4 pieces), rate: fixed(1/56), conditions: [killedThisRun('blood-moon')] } ] },
  { id: 'lunar:blue-unique', mode: 'preroll', rolls: 1, entries: [ ... conditions: [killedThisRun('blue-moon')] ] },
  { id: 'lunar:eclipse-unique', mode: 'preroll', rolls: 1, entries: [ ... conditions: [killedThisRun('eclipse-moon')] ] },
  { id: 'lunar:standard', mode: 'weighted', denominator: 30, rolls: <depends on nMoonsKilled>, entries: [ ... ] },
]
```

The three per-Moon tables as separate `preroll` entries, each independently gated, correctly
reproduces "any hit skips standard loot" via the existing `suppressedByPreroll` rule (a hit on any
one of the three preroll tables suppresses `lunar:standard`, which is `weighted`) — this part
needs no new suppression mechanism, unlike CoX. The *within-set* duplicate protection is exactly
what `Table.withoutReplacement` already models, confirming HANDOFF.md's "cheapest real fix
available" framing — **for the per-set sub-roll**, this source needs no model change, only
wiring.

## What the mapping needs that doesn't exist

1. **Gap 1 (per-run context) applies, but in an unusual shape.** This source needs **not a numeric
   scalar** like ToA's points, but a set-valued fact: *which* of the 3 Moons were killed in the run
   that opened this chest. The natural UI control is 3 checkboxes, not a slider — still the same
   underlying gap (SimContext has no field to carry it), but note for whoever designs the
   SimContext extension that it can't be one universal numeric field; at minimum it needs to
   support a small enum-set, not just a number.
2. **Beyond gap 1: `Table.rolls` cannot read an arbitrary integer from context.** `rolls: number |
   Rate`, and a `Rate` used as `rolls` is defined as "roll this table once with probability p" —
   a Bernoulli reading (PROJECT_PLAN.md 4.3's decision log). There's no way to say "roll this table
   `f(ctx)` times" where `f` returns 1, 3, or 6. This is a **distinct extension from gap 1**: gap 1
   is about SimContext *having* the data; this is about `rolls` being unable to *consume* an
   integer derived from that data, only a probability. Whether this generalizes beyond Lunar Chest
   is not yet clear from the other 13 sources reviewed so far — flagging it as its own line item
   rather than folding it into gap 1 silently.

3. **The per-set duplicate-protection roll needs "pieces not yet obtained" state** — the
   multi-item generalization of the "owned/received-before" family named explicitly in
   `docs/bosses/duke-sucellus.md` (ice quartz/frozen tablet are the single-item case). Noted in
   passing above but not originally called out as its own gap; correcting that now for
   consistency across this batch. `Table.withoutReplacement` handles the *mechanics* of drawing
   without repeats within one evaluation; it does not, by itself, give the model a way to know
   which pieces this player already owns going into the roll.

Net for Lunar Chest: **gap 1, plus the rolls-reads-integer-context extension, plus the
owned/received-before-state family.** The `withoutReplacement` half of the watchlist description
needs no new model feature for its within-one-roll mechanics, but does need that third family to
know the starting state correctly.
