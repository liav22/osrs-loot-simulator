# Zalcano

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - Gap 1 (`SimContext` points) — **RESOLVED**, and in the two-value shape this
>   doc argued for: `ctx.hitpointsDamage` + `ctx.shieldDamage` kept raw, with
>   `zalcano_points` (registered, still a stub) doing the derivation.
> - Gap 3 (MVP's self-referential +10%) — **RESOLVED**: `Table.qtyMultiplier`
>   of 1.1 with `qtyRounding: 'ceilDelta'`. This doc's framing that the MVP
>   bonus needs a mechanism *distinct* from Duke Sucellus's perfect-kill +50%
>   is **wrong** — both are "scale this table's realized quantity by a scalar,
>   gated on a per-run boolean," one mechanism. But this doc's "(rounded up)"
>   detail was load-bearing and correct: it is why `ceilDelta` exists.
> - Gap 2 (crystal shard as a discrete role-keyed tier) — **PARTIALLY
>   RESOLVED**: `QtySpec.formula` can return a stepped value, so the tiering is
>   expressible, but the *role* input has no `SimContext` field. Needs either a
>   role field or modelling as a `variant` condition.
> - Gap 4 (team point-allocation) — out of scope, same as CoX.
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


`lootSourceId: zalcano`. Watchlisted (`point_scaled`). No blocked sources.

Source: **Zalcano** — https://oldschool.runescape.wiki/w/Zalcano — pageid `221996`, revid
`15287396`. Local snapshot (`data/snapshots/wikitext/zalcano.json`, fetched 2026-08-11T13:23:10Z)
postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check

**Correct.** The detail text's summary ("both the main table and the tertiary table scale with
points... MVP gets an extra 10%") matches the page exactly, including the detail that main-table
and tertiary-table points are computed with *different* formulas (only the tertiary one is capped).

## The reward mechanic, in prose

1. **Eligibility gates**, both damage-based, not points-based: ≥5 damage to Zalcano's shield for
   *any* drop eligibility; ≥31 combined damage for unique/pet eligibility. Below the first
   threshold: nothing.
2. **Points** (per player, per kill): `H` = damage to hitpoints, `S` = damage to shield.
   Main-table points are *uncapped*; tertiary-table points cap the two inputs separately before
   summing (max 1,000 total). This asymmetry is explicit in the prose, not an inference.
3. **Crystal shards** (100% table): quantity 1–3, but not from a `QtySpec` range roll — it's a
   discrete tier keyed by eligibility level: 1 if merely drop-eligible, 2 if
   unique/pet-eligible, 3 if MVP. `Infernal ashes` similarly is MVP-only, not a probability at
   all — always/never based on a role, not a rate.
4. **MVP bonus**: +10% (rounded up) of the MVP's own non-unique loot, on top of the normal roll —
   a *self-referential* multiplier ("10% more of what you already got"), not an independent extra
   roll.
5. **Tertiary table**: flat `1/200` chance (same for everyone eligible; not points-scaled itself)
   to trigger the crystal-tool-seed sub-table; **who among eligible players receives it** is
   points-weighted (higher points → higher chance of being the recipient — a team-allocation
   detail, same out-of-scope shape flagged for CoX/ToA/ToB). Once triggered: `1/40` uncut onyx,
   else a crystal tool seed. Zalcano shard's own rarity is stated as a *range* depending on
   contribution (`1/750` to `1/1500`, `altrarity`/`altraritydash` — i.e. the page itself encodes
   it as a two-endpoint interpolation, not a single fixed fraction) — this is a second, real
   points-driven `fixed`-rate-turned-`formula` case, separate from the shard-vs-onyx split.
   Smolcano pet is a flat `1/2,250` once eligible (explicitly "a static 1/2,250 chance," per a
   cited news post correcting an earlier points-scaled design) — not points-scaled despite being
   in the same tertiary group.
6. **XP-vs-items toggle** (via Rhiannon NPC): switches whether points convert to Mining XP or
   material rewards; does not affect unique/pet rolls either way. Out of scope for a loot
   simulator (no XP tracking anywhere in the model) — noted, not treated as a gap.

## Formulas

### `zalcano_points` (no existing formula id matches; PROJECT_PLAN.md 4.6's registry has no
Zalcano-shaped entry, as HANDOFF.md already flagged — "closest is a new points formula, or reuse
`tob_points`'s shape," but ToB turned out (see `docs/bosses/monumental-chest.md`) to *not* actually
be points-driven, so there is nothing to reuse; this needs its own id.)

```
P_M = H + 2·S                                       [main-table points, uncapped]
P_T = min(H, 400) + 2·min(S, 300)                    [tertiary-table points, capped at 1,000]
```
Source: `==Drops==`, revid `15287396`, citing a Mod Lenny tweet with a worked example (550/1000
points → 1/2,175 pet roll — consistent with linear interpolation between the Zalcano-shard-style
endpoints, though the pet itself is stated elsewhere as flat 1/2,250 post-nerf, so this tweet
predates the "static 1/2,250" change also cited on the page — **flagging a real
in-page inconsistency between two citations of different dates, not resolving it by picking one**;
the more recent 21 May 2020 news post citation should be treated as authoritative over the older,
undated-example tweet).

### Zalcano shard interpolation

**UNKNOWN — needs manual research.** The page gives only the two endpoints (`1/750` at some
unstated high-contribution point, `1/1500` at some unstated low-contribution point) via
`rarity=1/750|altrarity=1/1500`, with no formula connecting them to `P_M`/`P_T` or a stated
contribution percentage. Recorded as unknown rather than assuming linear interpolation against an
unstated endpoint definition.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'zalcano:shards', mode: 'always', entries: [
      { node: crystal-shard, qty: formula-tiered-by-eligibility },
      { node: infernal-ashes, conditions: [isMVP] },
  ] },
  { id: 'zalcano:main', mode: 'weighted', denominator: 36, entries: [ runes+materials, qty scaled by P_M, conditions:[eligible] ] },
  { id: 'zalcano:mvp-bonus', mode: 'always', entries: [ +10% of zalcano:main's own roll, conditions:[isMVP] ] },
  { id: 'zalcano:tertiary-access', mode: 'preroll', rolls: 1, entries: [
      { node: oneOf(onyx 1/40, tool-seed 39/40), rate: fixed(1/200), conditions:[eligible-for-uniques] } ] },
  { id: 'zalcano:shard-pet', mode: 'independent', entries: [
      { node: zalcano-shard, rate: formula('zalcano_points', {tier:'shard'}), conditions:[eligible-for-uniques] },
      { node: smolcano, rate: fixed(1/2250), conditions:[eligible-for-uniques] },
  ] },
]
```

## What the mapping needs that doesn't exist

1. **Gap 1** (`SimContext` per-run points field) — same family as ToA/CoX/Tempoross/Wintertodt,
   though Zalcano needs *two* derived point values (`P_M`, `P_T`) from the same underlying `H`/`S`
   inputs, suggesting the SimContext extension should carry the raw per-kill damage inputs (or
   both derived values) rather than one opaque `points` number — a detail worth flagging for
   whoever designs the actual field, not a new family.
2. **Crystal shard's quantity is a discrete tier keyed by an eligibility *role*
   (drop/unique/MVP), not a formula of a continuous scalar.** This doesn't fit the
   quantity-scaling family from `docs/bosses/chest-tombs-of-amascut.md` cleanly (that one is a
   continuous formula of points; this is a 3-way discrete lookup on a role classification) nor a
   flat multiplier (Abyssal Sire/Duke Sucellus/ToB's flavor). It's closer to a `oneOf`-style
   discrete choice keyed by context — likely still solvable by the same formula-driven-QtySpec
   extension (gap already tracked), since a formula can return a discrete stepped value just as
   easily as a continuous one; flagging here only because the *shape* (role-keyed, not
   scalar-keyed) is different enough to be worth a concrete test case once that extension is
   designed, not because it's a fourth family.
3. **MVP's +10% bonus is self-referential** ("10% more of what this player already rolled"), a
   different flavor again from Abyssal Sire's flat ×2 or Duke Sucellus's perfect-kill +50% — those
   scale a *table's* yield by a constant; this scales *one player's own realized roll* by a
   constant, which requires the multiplier to apply after sampling, not as a rate/qty
   transformation on the table definition itself. Still the quantity-scaling family in spirit, but
   worth flagging as the flavor most different from a static per-entry `QtySpec` change — it may
   need to be a post-processing step in `simulate.ts` rather than a schema-level change, which is
   a materially different kind of "doesn't exist yet" than the others in this family.
4. **Team point-allocation** (who among eligible players gets the tertiary drop) is the same
   out-of-scope multi-player shape already flagged for CoX/ToA/ToB — not a new gap, restating for
   completeness.

Net for Zalcano: **gap 1 (with a concrete note that it needs two related values, not one) plus the
quantity-scaling family (two further flavors: discrete role-keyed tiers, and post-sampling
self-multiplication)** — no wholly new family, but the self-referential MVP bonus is the first
case in this batch that looks like it might need a change outside the schema itself (in the
simulator's evaluation order), not just a new schema field.
