# Monumental chest — Theatre of Blood (ToB)

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - Gap 1 (`SimContext` deaths field) — **RESOLVED**: `ctx.deaths`.
> - Gap 3 (conditional multiplier for mode/death quantity scaling) —
>   **RESOLVED**: `Table.qtyMultiplier` (+ `qtyRounding` if the wiki states a
>   rounding rule).
> - Gap 2 (the magnitude of both scaling effects) — still **UNKNOWN**;
>   research, not a model gap, and `tob_points` remains a stub. This source
>   also still carries the separate ambiguous-heading blocker.
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


`lootSourceId: monumental-chest`. Watchlisted (`point_scaled`). Blocks: Nylocas Vasilias,
Pestilent Bloat, Sotetseg, The Maiden of Sugadinti, Verzik Vitur, Xarpus. Also carries an
independent `ambiguous: heading guess` blocker (untitled heading) per `docs/HANDOFF.md` section 2
— this doc covers the mechanic/formula side only, not that second blocker.

Sources:
- **Monumental chest** — https://oldschool.runescape.wiki/w/Monumental_chest — pageid `250011`,
  revid `15293917`. Re-fetched fresh this session; one cosmetic diff against the 2026-08-11 local
  snapshot ("Wine of zamorak" → "Wine of Zamorak" capitalization), no mechanic/number changes.
- **Theatre of Blood** (raid overview) — https://oldschool.runescape.wiki/w/Theatre_of_Blood —
  pageid `112226`, revid `15293433`.

## The reward mechanic, in prose

**ToB's unique gate is structurally simpler than ToA/CoX: it is a near-fixed preroll probability,
not a continuous function of points.** The mechanics watchlist entry's framing ("unique chance
scales with Theatre of Blood points... not a fixed per-kill rarity") turned out to be **not quite
right** once the actual page prose was read — worth flagging since it shaped the initial
categorization:

1. **Unique pre-roll.** "Without any deaths, there is a **1/9.1** (~11%) chance of a unique reward
   across the team; dying will decrease this chance." Hard Mode: **1/7.7** (~13%), with the
   avernic defender hilt's weight reduced to boost the other uniques' relative share. **Entry Mode
   grants no unique pre-roll at all** — deterministically common-only. The rate is stated as **the
   same regardless of team size** (1–4/5 players), unlike CoX/ToA where points scale with team
   size via the MVP/room-point mechanics.
2. **Recipient + item selection.** If the pre-roll hits, the item is drawn from a small fixed
   weighted table (denominator 19 normal / 18 hard); which *player* receives it is "based on
   deaths and damage dealt to each boss," MVP most likely — a team-allocation detail, same
   out-of-scope shape as CoX's.
3. **Common rewards** (only if no unique): 3 rolls, denominator 30, standard weighted table
   (quantities given as fixed ranges per item, not points-derived). Quantity scaling is described
   only qualitatively: Entry Mode −80%, Hard Mode +15% (another +15% if completed within the
   target time), and "deaths will reduce the quantity of common rewards for all players" with no
   stated magnitude.
4. **Tertiary**: elite clue at `1/25` (`altrarity` 3/25 Normal-Mode-scaled / 3.5/25 for
   Entry/Hard, "scales down based on individual performance"), `holy`/`sanguine` ornament kits,
   `sanguine dust` (Hard Mode only), `Lil' Zik` pet (`1/650` Normal, `1/500` Hard, "scales down
   based on individual performance" — same unspecified scaling as the clue).

## Formulas

### `tob_points` — unique pre-roll (per raid, not per player, not points-derived)

```
P(unique | variant=normal) = 1/9.1     (~10.989%), 0 if variant=entry
P(unique | variant=hard)   = 1/7.7     (~12.987%)
```
Both figures are reduced by an **unspecified** per-death penalty. Source: Monumental chest,
`===Pre-roll===`, revid `15293917` — two cited tweets (Mod Kieren for the base rates, Mod Arcane
for the Hard Mode rate and the avernic-hilt reweight).

**UNKNOWN — needs manual research**: the exact death-penalty formula. The page states only the
direction ("dying will decrease this chance"), never a multiplier, curve, or per-death constant.
No citation on this page supplies one. Do not guess a plausible per-death decay — record as
unknown per the task's own instruction.

### Item weight tables (fixed, not points-scaled)

| Item | Normal (÷19) | Hard (÷18) |
|---|---|---|
| Avernic defender hilt | 8 | 7 |
| Ghrazi rapier | 2 | 2 |
| Sanguinesti staff (uncharged) | 2 | 2 |
| Justiciar faceguard | 2 | 2 |
| Justiciar chestguard | 2 | 2 |
| Justiciar legguards | 2 | 2 |
| Scythe of vitur (uncharged) | 1 | 1 |

Source: `====Normal mode====`/`====Hard mode====`, revid `15293917`.

### Common-table quantity scaling — qualitative only, no formula given

- Entry Mode: **−80%** relative to Normal.
- Hard Mode: **+15%**, and a further **+15%** ("an additional 15%") if completed within an
  unspecified target time.
- Deaths: reduce quantity, magnitude **UNKNOWN — needs manual research** (no number given).

Source: `===Common rewards===`, revid `15293917`. Unlike ToA/CoX, there is no per-item divisor
table and no points variable named anywhere in this section — the scaling is described entirely
as flat percentage adjustments to mode/deaths, not a function of an accumulated points total.
This is the concrete evidence that "points" is the wrong mental model for ToB's mechanic, even
though the watchlist entry (written before this page was read closely) assumed it was.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'tob:unique-preroll', mode: 'preroll', rolls: 1, entries: [
      { node: oneOf(7 items, weight per mode), rate: fixed(1/9.1), conditions: [variant: normal] },
      { node: oneOf(7 items, weight per mode), rate: fixed(1/7.7), conditions: [variant: hard] },
      // variant: entry gets no entry here at all — correctly falls through to common
  ] },
  { id: 'tob:common', mode: 'weighted', denominator: 30, rolls: 3, entries: [ ... ] },
  { id: 'tob:tertiary', mode: 'independent', entries: [ elite clue, ornament kits, sanguine dust (hard only), Lil' Zik ] },
]
```

This is the **cleanest of the three raid chests to map** — `preroll` with `fixed` rates gated on
`variant`, exactly as the schema already supports (Vardorvis/Duke Sucellus/Whisperer/Leviathan's
`variant`-conditioned tertiary entries are the established precedent per `docs/DECISIONS.md`).
**No formula is even strictly required for the unique gate itself** — `fixed` rates suffice,
since the base chance is a raid-mode constant, not a continuous function of a per-run scalar. A
`tob_points` formula only becomes necessary for the death-penalty adjustment and the common-table
quantity scaling, both of which are presently unquantified (see gaps below).

## What the mapping needs that doesn't exist

1. **A per-run `deathCount` (or `deaths`) field on `SimContext`.** Distinct from the
   points/raidLevel gap flagged for ToA/CoX, but the *same shape* of gap — a per-run numeric value
   the UI would expose as a control, the way `killCount` already is, that a formula reads via
   `ctx`. Once the exact death-penalty curve is sourced, this is what it would read from.
2. **The magnitude of both scaling effects (death penalty on unique chance; death penalty on
   common quantity) is UNKNOWN**, not a schema gap — no amount of model expressiveness fixes a
   number the wiki simply doesn't state on this page. Flagged for manual research (checking the
   Theatre of Blood rewards calculator's Lua source, or an OSRS Wiki talk-page/dev-blog citation
   not surfaced by this session's page reads), not for guessing.
3. **Even once sourced, applying the mode/death quantity scaling needs a conditional multiplier
   on a table's whole yield, which doesn't exist.** `tob:common`'s item ranges (e.g. Vial of blood
   45–60) are given once, for Normal Mode only; Entry (−80%) and Hard (+15%, +another 15% if fast)
   are stated as flat percentage adjustments on top, not as separately-published ranges per mode.
   This is the same family flagged in `docs/bosses/chest-tombs-of-amascut.md` gap 4
   (`QtySpec` has no formula-driven kind) but a different flavor of it: ToA needs a quantity
   *computed from scratch* per item; ToB needs an *existing* qty spec/tableRef yield scaled by a
   conditional factor. Also seen at Abyssal Sire (flat ×2) and Duke Sucellus (perfect-kill +50%,
   both in their own docs) and Zalcano (MVP +10%). Tracking these as one "quantity/yield scaling"
   family with two flavors, not as separate counts per source.

Net for ToB: **gap 1** (a `SimContext` per-run numeric field — same *kind* of gap as ToA/CoX's
points field) **plus the quantity/yield-scaling family** (flavor: conditional multiplier, not
formula-computed-from-scratch) **plus two UNKNOWN constants** that block using either even once
they exist. No CoX-style cross-table suppression gap here — ToB's single preroll-mode gate already
handles "unique replaces all common loot" for free.
