# Reward pool — Tempoross

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - Gap 1 (`SimContext` points) — **RESOLVED**: `ctx.points`.
> - Gap 2 (`Table.rolls` cannot consume an integer from context) —
>   **RESOLVED**: a `formula`-kind `Rate` used as `rolls`.
> - Gap 3 (Fishing-level-bracket gating) — **PARTIALLY RESOLVED, and the
>   remaining half is narrow**: `ctx.fishingLevel` exists, but no condition can
>   read it — `Condition.levelAtLeast` is pinned to an enum of
>   `'delveLevel' | 'wavesReached'`. Widening that enum to include
>   `fishingLevel` is a one-line change, and this source is the third real
>   user, which is the threshold the enum's own comment set for widening it.
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


`lootSourceId: reward-pool`. Watchlisted (`point_scaled`).

## ✅ RESOLVED — the watchlist misattribution described below is fixed

**Do not re-flag this.** It has now been re-flagged twice after the fact, because this section
was written while the bug was live and said "currently reads" — which stayed on the page after
the data was corrected. `data/mechanics-watchlist.json`'s `reward-pool` entry reads
`"blockedBy": ["Tempoross"]` and names `tempoross_points`, matching `data/_inventory.json`.
Verified by `checkWatchlistConsistency` running against both real committed files in
`apps/ingest/test/watchlist.test.ts`.

**What the bug was:** the entry read `"blockedBy": ["Wintertodt"]` and
`"detail": "...Needs the wintertodt_points formula."` The wiki page titled "Reward pool"
(https://oldschool.runescape.wiki/w/Reward_pool, pageid `306271`) is unambiguously **Tempoross's**
reward mechanism — a literal fishing pool in the Ruins of Unkah, reached by subduing Tempoross,
paid out in "reward permits." `data/_inventory.json` always had this right
(`{ "title": "Tempoross", ..., "lootSourceId": "reward-pool" }`); only the hand-authored watchlist
had the two activities swapped, with `docs/bosses/reward-cart.md` carrying the inverse error.

Source: **Reward pool** — https://oldschool.runescape.wiki/w/Reward_pool — pageid `306271`, revid
`15208420`. No local wikitext snapshot existed for this page before this session (only a
`dropsline` snapshot did); fetched fresh. Also: **Tempoross** (points-earning context) —
https://oldschool.runescape.wiki/w/Tempoross — pageid `291284`, revid `15292689` — local snapshot
(`data/snapshots/wikitext/tempoross.json`, fetched 2026-08-11T10:19:21Z) postdates this revid,
current, no re-fetch needed.

## The reward mechanic, in prose

1. **Points**, earned during the Tempoross fight itself: fishing harpoonfish (5/fish), cooking
   harpoonfish (10/fish), depositing harpoonfish (20/raw, 20/crystallised, 65/cooked), repairing
   totems/masts (40), dousing fires (40), surviving a wave (10), fishing the spirit pool
   (55/scatter). Capped at 32,000/round (only reachable in Leagues/Deadman modes in practice).
2. **Permits.** A minimum of 2,000 points is required to receive any permits at all. Above that:
   1 permit, +1 more per 700 points, **"with a chance at rounding up"** — the exact rounding rule
   for the fractional remainder is not stated on this page.
3. **Redemption is decoupled from the encounter.** Permits accumulate in the pool (cap 8,000) and
   are redeemed later, one at a time, by fishing the pool (net required; a free net is offered if
   missing) — **each redemption uses the player's Fishing level *at the time of redemption*, not
   at the time the permit was earned**, an explicit, deliberate design choice cited on the page (a
   player can bank permits and level up before cashing them in for better fish).
4. **Per-permit roll.** ~45/80 chance of a fish-subtable roll (fish tier gated by Fishing level,
   7 level brackets, unaffected by temporary boosts — base level only); the remainder splits
   between a flat "Unique" table (`Template:Reward pool/Rewards unique`, revid `15173596`: spirit
   flakes 1/4, casket 1/20, soaked page 149/8000, fish barrel 1/400, tackle box 1/400, big
   harpoonfish 1/1600, tome of water 1/1600, dragon harpoon 1/8000, tiny tempor pet 1/8000) and an
   "Other" table (junk items, not read this session). **This is a flat weighted roll per permit —
   no ordered/chained uniques the way Wintertodt's Reward Cart has** (confirmed by reading the
   Unique subpage directly: every entry has its own independent `rarity`, not a sequential
   roll-until-success list).

## Formulas

### `tempoross_points` — permits earned per encounter

```
permits(points) = 0                                    if points < 2,000
permits(points) = 1 + floor((points − 2,000) / 700)     if points ≥ 2,000, plus a probabilistic
                                                          rounding-up chance on the remainder
```
**UNKNOWN — needs manual research**: the exact probabilistic-rounding rule for the remainder
(e.g. is it `(points − 2000) mod 700 / 700` chance of +1 permit, mirroring the Reward Cart's
"1% per 5 points" remainder rule? Not stated on this page, and not assumed here — the phrase
"with a chance at rounding up" is quoted verbatim, not a rate).
Source: Reward pool, main prose (no dedicated `===` subsection — it's in the lead), revid
`15208420`. Points-earning table itself is sourced from Tempoross, `===Reward points===`, revid
`15292689`.

### Per-permit roll — no formula needed

The fish/unique/other split and each item's rarity are plain `fixed`/`weight` rates, already
fully expressible — this part of the mechanic needs no formula at all, only the permit-count
input.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'reward-pool:main', mode: 'weighted', denominator: 80, rolls: <permits(ctx.points)>, entries: [
      fish-subtable (tableRef, gated on Fishing level bracket via a new lookup, ~45/80),
      unique-table entries (weight, ~subset of remaining 35/80),
      other-table entries (weight, remainder),
  ] },
]
```

Structurally the simplest of the point-scaled sources reviewed: one flat weighted table, no
preroll chain, no cross-table suppression. The only real difficulty is `rolls` needing to be a
per-run integer derived from `ctx.points` via `tempoross_points`.

## What the mapping needs that doesn't exist

1. **Gap 1** (`SimContext` needs a per-run `points` field) — same as ToA/CoX/ToB, not a new count.
2. **Beyond gap 1, same as Lunar Chest**: `Table.rolls` cannot consume an arbitrary
   context-derived integer, only a static number or a Bernoulli `Rate`. `permits(points)` is an
   integer count, not a probability — the same extension flagged in `docs/bosses/lunar-chest.md`.
   This is now the **second** source needing it (third counting Wintertodt's Reward Cart, covered
   in its own doc), which starts to look like a real recurring requirement rather than a one-off.
3. **Fishing-level-bracket gating** ("uses Fishing level at time of redemption") needs a
   `fishingLevel`-shaped `SimContext` field to pick the right sub-bracket — a further instance of
   gap 1's general shape (SimContext needs more per-run/per-player fields), not a new mechanism.

Net for Reward pool: **gap 1, plus the same rolls-reads-integer-context extension already flagged
for Lunar Chest** — no source-specific new mechanism beyond those two.
