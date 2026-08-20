# TzHaar Fight Cave

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - **Fully unblocked at the model level** — both gaps RESOLVED:
> - Gap 1 (formula-driven `QtySpec` for Tokkul) — **RESOLVED**:
>   `QtySpec.formula`; `tzhaar_fight_cave_tokkul` is registered in
>   `FORMULA_IDS` (still a stub implementation).
> - Gap 2 (per-run scalar: waves completed) — **RESOLVED**:
>   `ctx.wavesReached`.
> - **Caveat before picking this up as "the cheapest":** TzHaar Fight Cave
>   resolved no boss in the 172-page inventory, so it is not one of the
>   non-verified tier A-C sources and shipping it moves no counter.
>
> Model capabilities now available: per-run `SimContext` scalars (`points`,
> `raidLevel`, `deaths`, `perfectKill`, `isMVP`, `delveLevel`, `wavesReached`,
> `moonsKilled`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`,
> `ownedCounts`); `QtySpec.formula`; formula-driven `Table.rolls`;
> `Table`/`TableRefNode` `qtyMultiplier` + `qtyRounding`;
> `Condition.levelAtLeast`; `Entry.ownershipGate`; `Table.suppressesFollowing`;
> `TableRefNode.drawsPerHit`. Still absent: run-scoped (within-kill) dynamic
> state, deeper inline table nesting, `data/overrides/`, party/team context,
> and real implementations for every `FORMULA_IDS` entry — current status:
> `IMPLEMENTED_FORMULA_IDS` in `packages/loot-model/src/formulas.ts`, not a
> count restated here (see `docs/DECISIONS.md`'s formula-status entry).
> See `docs/DECISIONS.md`.


Not in `data/mechanics-watchlist.json` (no `lootSourceId` — same standing as Inferno, a recovered
`component` encounter with no reward-table page, correctly not force-matched). Covered per this
session's brief to research the wave-structured sources as a group.

Source: **TzHaar Fight Cave** — https://oldschool.runescape.wiki/w/TzHaar_Fight_Cave — pageid
`12784`, revid `15293979`.

## ⚠️ Snapshot was stale — re-fetched fresh this session

`data/snapshots/wikitext/tzhaar-fight-cave.json` was fetched 2026-08-11T14:17:26Z; this page's
own latest revision is 2026-08-12T18:20:02Z (one day later) — the local snapshot predates it and
was **not** used for this doc. Fetched fresh instead (`action=parse`, same params as the existing
snapshot's). Flagging per this session's instruction to note any snapshot disagreement hit along
the way, not to re-fetch everything proactively — this is the second stale snapshot found this
session (after Ancient chest/CoX), both landing in the last 48 hours, in the same general
"raids/minigames actively being rebalanced" neighborhood of the wiki.

## Sanity check against the earlier "population of one" research

Confirmed, same conclusion as Inferno: **zero `{{DropsLine}}` calls**, a single deterministic
completion reward (fire cape) plus a *fully-formulaic* Tokkul curve (unlike Inferno, which only
gives a maximum) plus an ordinary pet chance. Not wave-structured content in the model sense.

## The reward mechanic, in prose

1. **Fire cape**: guaranteed on defeating TzTok-Jad — completion reward, not a drop roll.
2. **Tokkul**: `+2` per wave completed cumulatively (wave 1 gives 2, wave 2 gives 4 more for 6
   total, ... ), closed-form `N·(N+1)` where `N` = waves completed, **plus a flat +4,000 bonus**
   specifically for killing TzTok-Jad (on top of the formula, not folded into it — confirmed by
   two separate cited tweets, one for the formula and one for the Jad bonus). Elite Karamja Diary
   doubles the total, same as Inferno.
3. **TzRek-jad pet**: `1/200` on defeating TzTok-Jad, `1/100` if on a Slayer task — note the
   *ratio* between task/no-task is different from Inferno's pet (Inferno: 100→75, a ~1.33×
   boost; Fight Cave: 200→100, a 2× boost) — both real, both independently sourced, not a copy-paste
   error to "fix" into consistency.  A separate, later `1/200` reroll is available by exchanging
   a fire cape with TzHaar-Mej-Jal (out-of-encounter NPC transaction, same shape as Inferno's cape
   exchange).

## Formulas

### `tzhaar_fight_cave_tokkul` — fully specified, unlike Inferno's equivalent

```
Tokkul(N) = N·(N + 1)                    [N = waves completed, N ≤ 63]
Tokkul(N | defeated Jad) = N·(N + 1) + 4,000
Tokkul_diary = Tokkul × 2                [if Elite Karamja Diary complete]
```
Source: `==Rewards==`, revid `15293979`, citing two Mod Kieren tweets (29–30 March 2017) — one
giving the summation-formula derivation directly ("Sum of n consecutive numbers"), the other
confirming the +4,000 Jad bonus is additive on top, not included in the per-wave sum. This is a
fully-sourced, closed-form formula — no UNKNOWN pieces, unlike every other formula in this batch's
final tier of sources.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'fight-cave:completion', mode: 'always', entries: [ fire-cape ] },
  { id: 'fight-cave:tokkul', mode: 'always', entries: [ { node: tokkul, qty: formula('tzhaar_fight_cave_tokkul', {}) } ] },
  { id: 'fight-cave:pet', mode: 'independent', entries: [
      { node: tzrek-jad, rate: fixed(1/200), conditions: [onSlayerTask: false] },
      { node: tzrek-jad, rate: fixed(1/100), conditions: [onSlayerTask: true] },
  ] },
]
```

Same conclusion as Inferno: **not wave-structured content**, no wave/level machinery needed.

## What the mapping needs that doesn't exist

1. **The Tokkul quantity needs the formula-driven-`QtySpec` extension**, same family as Inferno
   and ToA — but this is the one source in the entire batch where the formula itself is fully
   known, so once that schema extension exists, this source needs *nothing* else.
2. **Gap 1** (per-run scalar: waves completed) as the formula's input.

Net for TzHaar Fight Cave: **gap 1 plus the quantity-scaling family only** — the cleanest, most
fully-specified source reviewed this session. No UNKNOWNs, no new families, no wave machinery.
