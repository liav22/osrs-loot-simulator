# Duke Sucellus

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - Gap 1 (perfect-kill +50% quantity scaling) — **RESOLVED**:
>   `Table.qtyMultiplier` gated on `ctx.perfectKill`.
> - Gap 2 (per-item "already received" state) — **RESOLVED**:
>   `Entry.ownershipGate`, which this doc's shape (ice quartz reversion) was
>   one of the four sources designed against.
> - **Still blocking**: `duke_sucellus_ice_quartz` is an unimplemented stub,
>   and the frozen-tablet curve remains **UNKNOWN per the wiki itself** — not
>   implementable at any schema level, so do not guess it.
>
> Model capabilities now available: per-run `SimContext` scalars (`points`,
> `raidLevel`, `deaths`, `perfectKill`, `isMVP`, `delveLevel`, `wavesReached`,
> `moonsKilled`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`,
> `ownedCounts`); `QtySpec.formula`; formula-driven `Table.rolls`;
> `Table`/`TableRefNode` `qtyMultiplier` + `qtyRounding`;
> `Condition.levelAtLeast`; `Entry.ownershipGate`; `Table.suppressesFollowing`;
> `TableRefNode.drawsPerHit`. Still absent: run-scoped (within-kill) dynamic
> state, deeper inline table nesting, `data/overrides/`, party/team context,
> and real implementations for every `FORMULA_IDS` entry (all still stubs).
> See `docs/DECISIONS.md`.


`lootSourceId: duke-sucellus`. Watchlisted (`other`). No blocked sources (single-boss encounter).

Source: **Duke Sucellus** — https://oldschool.runescape.wiki/w/Duke_Sucellus — pageid `372984`,
revid `15275314`. Local snapshot (`data/snapshots/wikitext/duke-sucellus.json`, fetched
2026-08-11T13:22:51Z) postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check

**Correct as written**, and the detail text's description of the chain and the perfect-kill bonus
both check out verbatim against the page. One thing the watchlist detail doesn't mention, found
while reading the full `===Secondary uniques===` section: **two of the three "secondary unique"
items have their own independent kill-count bad-luck-mitigation curves**, on top of the
roll-until-success chain the watchlist entry already describes. Worth folding into whatever
override eventually gets written for this source.

## The reward mechanic, in prose

1. **Roll-until-success chain**, checked in order, each step only reached if every prior step
   missed:
   `1/90` tradeable unique table (`1/30` in the awakened fight) → if miss, `1/48` awakener's orb →
   if miss, `1/25` frozen tablet → if miss, `1/200` ice quartz → if miss, `1/5` supply drop table →
   if all miss, the standard drop table.
2. **After** the whole chain resolves (regardless of which step hit): a *separate* `1/2,500` roll
   for the Baron pet and a *separate* `1/40` roll for a clue scroll — both independent of, and not
   part of, the ordered chain above.
3. **Tradeable unique table**, if reached: itself a nested weighted split — `1/8` chance of a
   Virtus piece (further `1/3` sub-roll for which piece), `3/8` chance of "a vestige roll" (a
   3-hit pity counter: first two hits each drop a consolation gold ring and silently increment a
   hidden counter, the third guarantees the vestige and resets the counter — the page gives the
   pre-resolved marginal rate, `1/720`, directly, so this doesn't need to be reproduced exactly to
   get the right average), `3/8` chromium ingot, `1/8` Eye of the duke.
4. **Frozen tablet** (secondary-unique step): "will become more common at an **unknown** rate as
   kill count increases until the first drop is received. Afterwards, the item will no longer be
   dropped." Both the curve shape *and* the fact that it stops entirely after one lifetime drop
   are stated; only the curve's shape is unsourced.
5. **Ice quartz** (secondary-unique step): drop rate scales `1/200 → 1/50` **linearly** over the
   player's first 300 kills (cited Mod Ash tweet, confirms linear), reverting to a flat `1/200`
   permanently once the player has ever received one.
6. **Perfect kill**: +50% more loot from the *standard* drop table only (not the unique/secondary
   tables), gated on a detailed no-avoidable-damage checklist across both the normal and awakened
   fight (chip damage from icicles explicitly exempted; 0-damage magic hits under prayer still
   count against it).

## Formulas

No formula id in the registry names this shape, and none should — every rate here is either a
literal `fixed` fraction from the page or a small, source-specific curve (ice quartz/frozen
tablet) that doesn't generalize the way `toa_invocation`/`cox_points` do across many bosses. If a
formula id is wanted at implementation time it would be `duke_sucellus`-specific, not a shared one.

### Ice quartz kill-count curve (only fully-specified curve on this page)

```
P(ice quartz | not yet owned) = 1/200 + (1/50 − 1/200) · min(1, killCount/300)   [linear, caps at kc=300]
P(ice quartz | already owned) = 1/200   [flat, reverts permanently]
```
Source: `===Secondary uniques===`, revid `15275314`, citing a Mod Ash tweet confirming the shape
("over your first 300 kills, the chance shifts from 1/200 to 1/50, where it stays thereafter").

### Frozen tablet kill-count curve

**UNKNOWN — needs manual research.** The page states the *existence* of a scaling curve and its
termination condition (stops after first drop) but explicitly calls the rate itself unknown — not
a gap in this session's research, a gap in what's publicly documented at all as of revid
`15275314`.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'duke:chain', mode: 'preroll', rolls: 1, entries: [
      { node: oneOf(virtus/vestige/ingot/eye, nested weights), rate: fixed(1/90), conditions:[variant:normal] },
      { node: oneOf(...), rate: fixed(1/30), conditions:[variant:awakened] },
      { node: awakeners-orb, rate: fixed(1/48) },
      { node: frozen-tablet, rate: formula('duke_sucellus', {tier:'frozen-tablet'}), conditions:[not-yet-owned(frozen-tablet)] },
      { node: ice-quartz, rate: formula('duke_sucellus', {tier:'ice-quartz'}) },   // formula itself branches on ownership
      { node: tableRef('duke-supply-table'), rate: fixed(1/5) },
  ] },
  { id: 'duke:standard', mode: 'weighted', denominator: <sum>, entries: [ ...qty scaled +50% on perfect kill... ] },
  { id: 'duke:baron-clue', mode: 'independent', entries: [
      { node: baron, rate: fixed(1/2500) },
      { node: clue, rate: fixed(1/40) },
  ] },
]
```

**The chain itself needs no new model feature at all** — this is the cleanest confirmation yet
that `preroll` mode's existing "checked in order, first hit short-circuits, suppresses the later
weighted table" semantics is exactly this mechanic, matching the same conclusion reached for
Wintertodt's Reward Cart chain. `duke:baron-clue` correctly sits *outside* the suppression chain
(as its own `independent` table after it) since both roll regardless of chain outcome.

## What the mapping needs that doesn't exist

1. **Perfect-kill +50% is an instance of the quantity/yield-scaling family** already tracked in
   `docs/bosses/chest-tombs-of-amascut.md` (gap 4) and `docs/bosses/monumental-chest.md` (gap 3) —
   flavor: conditional multiplier on an existing table's yield, gated on a new boolean fact
   (`perfectKill`) that also needs a home, most naturally as a `SimContext` field (same shape as
   `onSlayerTask` — a per-run boolean the UI would expose as a toggle) rather than a formula
   input, since it's a yes/no fact about the run, not a scalar.
2. **A new, recurring gap not yet named in this batch's earlier docs: per-item "already received
   at least once" state.** Ice quartz's reversion to a flat rate, and frozen tablet's permanent
   cutoff, both depend on **whether the player has ever received that specific item before** —
   not this run's kill count (`killCount` already exists and is fine for the *curve*), a
   *lifetime ownership fact* about a specific item. No `Condition` kind reads anything like this,
   and `SimContext` has nowhere to put it. **On reflection, this same fact was needed and glossed
   over in three earlier docs in this batch**: `chest-tombs-of-amascut.md` (thread of
   Elidinis/jewels reverting to flat rates once received), `lunar-chest.md` (duplicate protection
   needs "pieces not yet obtained," which is really the multi-item generalization of this exact
   fact), and `reward-cart.md` (gloves/torch substituting after 3 owned). Five sources now, across
   three different loot sources' write-ups — this is a real, recurring family, not a one-off, and
   should have been named explicitly earlier rather than folded silently into each source's prose.
   Naming it now: **"owned/received-before state"**, distinct from gap 1 (per-run scalars) and
   from the quantity-scaling family.

Net for Duke Sucellus: **the quantity-scaling family (as a new boolean-gated flavor) plus the
newly-named "owned/received-before state" family** — no change to the preroll-chain conclusion,
which needs nothing new.
