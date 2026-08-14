# Rewards Chest (Fortis Colosseum)

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - Gap 1 (wave/level-indexed structure with per-level bankable loot) —
>   **RESOLVED, no wave engine required**: `levelAtLeast('wavesReached', n)`-
>   gated tables in the existing `tables` array, one per wave. The same
>   correction applies to `docs/bosses/doom-of-mokhaiotl.md`; see its banner.
> - Gap 2 (per-run scalar: which wave the run ended at) — **RESOLVED**:
>   `ctx.wavesReached`.
> - Gap 4 (quiver -> splinters/pet exchange) — out of scope, an NPC
>   transaction, not a kill event.
> - Gap 3 (wave-scoped armour-piece dedup) — **STILL OPEN, and deliberately
>   so.** This is *run-scoped* state (it resets each attempt), materially
>   different from `ownershipGate`'s lifetime-scoped counts, and it is the only
>   remaining source needing within-kill dynamic state. Ship the flagged
>   with-replacement approximation; do not build general within-kill state for
>   one sub-mechanic of one source.
> - Note this page still cannot be assembled into a `Boss` at all (its `Wave
>   1`..`Wave 12` headings fit no canonical mode), so it needs `data/overrides/`
>   — which does not exist yet — before any of the above matters.
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


`lootSourceId: rewards-chest-fortis-colosseum`. Watchlisted (`other`). Blocks: Sol Heredit.

Source: **Rewards Chest (Fortis Colosseum)** —
https://oldschool.runescape.wiki/w/Rewards_Chest_(Fortis_Colosseum) — pageid `460258`, revid
`15285141`. Local snapshot (`data/snapshots/wikitext/rewards-chest-fortis-colosseum.json`, fetched
2026-08-11T14:43:12Z) postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check

**Correct**, and this doc's job is mostly to confirm the shape `docs/DECISIONS.md`'s "Phase 6
research item" already inferred without reading this page's wave sections individually. It's
right: each `Wave N` heading is a genuine, independent, well-formed drop table (`Wave 1` is a
trivial `Always: 80 sunfire splinters`; `Wave 12` is a full 16-row weighted table), and loot is
explicitly bankable per-wave ("the player has the option to continue... or end their run and walk
away with the rewards they've accumulated so far"; dying loses everything unclaimed). **See
`docs/bosses/doom-of-mokhaiotl.md` for why "population of one" no longer holds** — that source
turned out to share this exact shape and wasn't checked against it when that conclusion was
written.

## The reward mechanic, in prose

1. **Waves 1–3**: fixed, deterministic per-wave rewards (Wave 1: 80 sunfire splinters, always).
2. **From the end of wave 3 onward**, the chest additionally rolls the unique table, at a rate
   that *increases* per wave reached (not points-scaled — directly wave-indexed, given as a table,
   not a formula with a general curve).
3. **If the unique table hits**, a further split: waves 4–6 use `4/10` echo crystal / `6/10`
   sunfire fanatic armour piece; waves 7–12 use `6/16` / `9/16` / plus `1/16` Tonalztics of Ralos
   (a third item only unlocked from wave 7 on). Both echo crystal and the armour piece have their
   own further sub-mechanics (crystal: 1/10 chance of 2–3 instead of 1; armour: duplicate-avoidance
   preferring an unowned piece — the owned/received-before-state family again, at the *wave*
   level this time rather than the *lifetime* level Duke Sucellus/ToA needed).
4. **Wave 12 specifically**: `Dizana's quiver` guaranteed, `Smol heredit` pet flat `1/200`
   (independent of the unique-table mechanic above), plus its own large weighted table (16 rows,
   denominator 4800) layered *on top of* the wave-scaling unique mechanic — i.e. wave 12's chest
   is not merely "the wave-12 row of the general unique table," it's a materially bigger, richer
   table than waves 4–11 get.
5. **Quiver exchange**: `Dizana's quiver` can later be traded to an NPC for 4,000 sunfire
   splinters or another independent `1/200` Smol heredit roll — a genuinely separate, later,
   NPC-shop transaction outside the chest itself; likely out of scope for a loot-source simulator
   (it's not something that happens "on kill," it's a deferred player choice against banked
   items) — flagging as probably out of v1 scope rather than a gap to fix.

## Formulas

No formula id fits (wave-indexed lookup table, not a continuous scalar curve — same shape
conclusion as Doom of Mokhaiotl). If implemented, needs its own id and is a literal per-wave
lookup, not a closed form.

### Unique-table access rate by wave (full table given)

| Wave | Overall unique chance | Echo crystal | Armour piece | Tonalztics |
|---|---|---|---|---|
| 4 | 1/124 | 1/310 | 1/206.67 | — |
| 5 | 1/110 | 1/275 | 1/183.33 | — |
| 6 | 1/96 | 1/240 | 1/160 | — |
| 7 | 1/82 | 1/218.67 | 1/145.78 | 1/1,312 |
| 8 | 1/68 | 1/181.33 | 1/120.89 | 1/1,088 |
| 9 | 1/54 | 1/144 | 1/96 | 1/864 |
| 10 | 1/40 | 1/106.67 | 1/71.11 | 1/640 |
| 11 | 1/26 | 1/69.33 | 1/46.22 | 1/416 |
| 12 | 1/12 | 1/32 | 1/21.33 | 1/192 |

Source: `==Loot mechanics==`, revid `15285141`. Table explicitly states "Glory plays no role in
rolling the unique drop table" — ruling out a `ringOfWealth`-shaped condition here, worth noting
so nobody adds one speculatively.

## Proposed mapping onto the loot model

**Cannot be meaningfully proposed without wave machinery**, same conclusion as Doom of Mokhaiotl.
A sketch, not a real proposal:

```
waves: [
  { wave: 1, tables: [ { always: 80 sunfire splinters } ] },
  { wave: 2, tables: [ ... ] },
  { wave: 3, tables: [ ... ] },
  { wave: 4, tables: [ { unique-access: fixed(1/124) → oneOf(crystal 4/10, armour 6/10) } ] },
  ...
  { wave: 12, tables: [ { unique-access: fixed(1/12) → oneOf(...) }, { always: quiver }, { pet: fixed(1/200) }, { big-weighted-table, denominator: 4800 } ] },
]
```

## What the mapping needs that doesn't exist

1. **Wave/level-indexed table structure with per-level bankable loot** — the primary gap, shared
   verbatim with Doom of Mokhaiotl (see that doc). This is the second confirmed instance; the
   "population of one" framing this session inherited from `docs/DECISIONS.md` should be revisited
   before deciding not to build it.
2. **Gap 1** (per-run scalar: which wave the run ended at) underneath the wave machinery.
3. **Wave-scoped owned/received-before state** (armour-piece duplicate avoidance) — same family
   named in `docs/bosses/duke-sucellus.md`, just scoped to "this run" rather than "lifetime,"
   which is itself a nuance the eventual fix needs to account for (the family needs both a
   lifetime-scoped and a run-scoped variant, not just one).
4. **The out-of-band quiver→splinters/pet exchange** is a deferred NPC transaction, not a kill
   outcome — flagged as likely out of scope, not a gap.

Net for Fortis Colosseum: **the wave/level-structure gap (now confirmed recurring — see Doom of
Mokhaiotl) plus gap 1 plus a scoping nuance on the owned/received-before-state family** — no new
family introduced by this source alone.
