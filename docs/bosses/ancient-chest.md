# Ancient chest — Chambers of Xeric (CoX)

> ### ✅ BUILT — `data/overrides/ancient-chest.json`, 2026-08-16
>
> **This source is now implemented**, and it needed two real corrections to
> this doc's own "Proposed mapping" below, found only by cross-checking the
> fresh page against the module line by line rather than trusting either:
>
> 1. **The common table is 33 weighted slots (denominator 33), not the flat
>    43-item/denominator-99 table this doc proposed.** The page's own rows
>    are `rarity=1/33` each, uniform — the module's finer-grained 43-entry
>    internal representation is a mathematically equivalent but structurally
>    different way to compute the SAME distribution, where each of the 33
>    slots totals weight 3 and the 10 herb slots subdivide that 3 into a 2:1
>    herb:seed split. The override models this as 23 plain entries plus 10
>    `oneOf(herb, seed)`-nested entries, which is what keeps "the two rolls
>    cannot end on the same drop" correct — a flat 43-entry table would have
>    let a herb and its own seed both drop in one raid, since "without
>    replacement" excludes by row, and the two would have been different
>    rows.
> 2. **Common-table quantities are `QtySpec.formula` (`floor(min(points,
>    131071)/divisor)`), not literal ranges.** The page's `quantity=1-138`
>    style rows are the DISPLAY BOUNDS of a deterministic points-driven
>    formula (26 of 29 checked items' stated upper bound is exactly
>    `floor(131071/divisor)`), not a real per-roll RNG span the way Theatre
>    of Blood's own common-table ranges are.
>
> Both would have shipped a structurally-clean, plausible-looking, **wrong**
> document — exactly the failure mode this source has already produced
> twice (see the corrected banner below and `data/mechanics-watchlist.json`'s
> entry). `apps/ingest/test/ancient-chest.test.ts` is designed against that
> specifically, not just against individual numbers matching.
>
> **Also found while building, not previously known:** the committed
> wikitext/dropsline snapshots were STALE (still the pre-2026-08-12-patch
> weights, 20/69) despite an earlier research pass's own citation of the
> post-patch 14/60 — the fresh fetch's revid matched what that pass cited, so
> the doc's numbers were right, only the snapshot on disk had never been
> updated to match. Refreshed before building, per CLAUDE.md's "never re-hit
> the wiki to fix a parser bug" (this is a genuine new-page fetch, not a
> re-parse).
>
> `not_on_watchlist` still fails deliberately, left for the user — see
> `docs/DECISIONS.md`'s "Phase 7: Chambers of Xeric" entry for the same
> shipped-vs-watchlisted judgement call ToB's own entry names.
>
> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-16
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its older "What the mapping needs that doesn't
> exist" section is **not** — it was written before Extensions A and B, step
> (c) (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and had
> never been revised until this pass. Corrections for this source:
>
> - Gap 1 (`SimContext` points) — **RESOLVED**: `ctx.points`.
> - Gap 2 (a hit in an `independent` table suppressing later tables) —
>   **RESOLVED**: `Table.suppressesFollowing`, built generically as this doc
>   argued it should be, and `schema.ts`'s own doc comment on that field now
>   names Ancient chest by name as the confirmed source.
> - Gap 3 (cross-table outcome visibility for elite clue / Olmlet) —
>   **RESOLVED AS UNNECESSARY, do not build.** Because `ctx.points` is static
>   per run, the conditioned marginals (`P(no unique) x 1/12`,
>   `P(unique) x 1/53`) are *exact* on every aggregate the simulator reports —
>   a plain formula `Rate`, no new condition kind. Using the raw subrates
>   instead overstates Olmlet by 33x; that is the failure mode to avoid.
>   Residual: elite clue and Olmlet can co-occur in the kill log (~4.6% chance
>   across a 1,000-kill log), which needs an FE note, not an engine feature.
> - Gap 4 (do common-table quantity ranges scale with points?) — **RESOLVED
>   this session, not by a new model capability but by finding the source**:
>   `Module:Chambers of Xeric calculator` states it outright as
>   `floor(personalPoints / divisor)`, one divisor per item. See "The
>   `Calculator:Chambers of Xeric loot` module" below — same shape of miss as
>   ToA's own "missing source, not missing fact" interpolation gap
>   (`docs/DECISIONS.md`).
> - **No longer `parse_failed`.** The `DROPS_SECTION_TITLE`/`HEADING_PATTERN`
>   widening (2026-08-16, `docs/DECISIONS.md`'s "DROPS_SECTION_TITLE
>   widening" entry) now reaches `==Loot table==`. **A real document exists —
>   `data/bosses/ancient-chest.json`, `status: needs_review`, every
>   structural check green (`weights_sum`, `refs_resolve`, `rates_valid`,
>   `qty_sane`, `items_known`, `drops_covered` all `true`) — blocked solely by
>   `not_on_watchlist`**, correctly: the naive parse produces two independent,
>   ungated weighted tables, so every simulated kill currently rolls BOTH a
>   unique and a common reward — a ~100%-unique-rate document, not an
>   imprecise approximation. See `data/mechanics-watchlist.json`'s
>   `ancient-chest` entry. This is now a real Phase 7 override candidate,
>   following the exact `cox_points` + preroll/suppression pattern ToA already
>   established — not a from-scratch investigation. `cox_points` itself
>   remains an unimplemented `FORMULA_IDS` stub. Per-player allocation within
>   a team stays out of scope (below).
>
> Model capabilities now available: per-run `SimContext` scalars (`points`,
> `raidLevel`, `deaths`, `perfectKill`, `isMVP`, `delveLevel`, `wavesReached`,
> `moonsKilled`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`,
> `ownedCounts`); `QtySpec.formula`; formula-driven `Table.rolls`;
> `Table`/`TableRefNode` `qtyMultiplier` + `qtyRounding`;
> `Condition.levelAtLeast`; `Entry.ownershipGate`; `Table.suppressesFollowing`;
> `TableRefNode.drawsPerHit`. Still absent: run-scoped (within-kill) dynamic
> state, deeper inline table nesting, party/team context, and real
> implementations for every `FORMULA_IDS` entry (all still stubs).
> `data/overrides/` exists and is in use (ToA, Doom of Mokhaiotl, Lunar Chest,
> Zalcano, Reward pool). See `docs/DECISIONS.md`.


`lootSourceId: ancient-chest` (tier A, `include: true`, `repeatable: true`). Watchlisted
(`point_scaled`), blocking all 7 bosses `_inventory.json` maps to this source (Great Olm, Ice
demon, Muttadile, Tekton, Vanguard, Vasa Nistirio, Vespula). `status: needs_review`, `source:
generated` — see the corrected banner above for why it is a real, structurally-clean document that
still must not ship `verified`.

Sources:
- **Ancient chest** — https://oldschool.runescape.wiki/w/Ancient_chest — pageid `320054`, revid
  `15295333`. Re-fetched fresh in an earlier research session (2026-08-13) — the then-local
  snapshot (fetched 2026-08-11) was stale: a real balance patch, *Summer Sweep Up - Agility &
  Chambers of Xeric Changes*, landed 2026-08-12 and changed the unique-item weight table (see
  below). All numbers in this doc are from that fresh fetch, not the earlier stale snapshot.
- **Chambers of Xeric** (points-earning context) —
  https://oldschool.runescape.wiki/w/Chambers_of_Xeric — pageid `82089`, revid `15293485`.
- **`Calculator:Chambers of Xeric loot`** — https://oldschool.runescape.wiki/w/Calculator:Chambers_of_Xeric_loot
  — a `{{JSCalc}}` form transcluding `Calculator:Chambers of Xeric/Template`, which itself is
  `{{#invoke:Chambers of Xeric calculator|main}}`. **`Module:Chambers of Xeric calculator`** —
  https://oldschool.runescape.wiki/w/Module:Chambers_of_Xeric_calculator — is the Lua source with
  the actual formulas, fetched fresh this session (not previously in `data/snapshots/`) via
  `apps/ingest/src/fetch-wikitext-for.ts`, the same tool and etiquette queue ToA's Module fetches
  used. Not a parser-bug re-fetch (CLAUDE.md's rule is about re-parsing from `data/snapshots/`, not
  about fetching pages never fetched before — `docs/DECISIONS.md`'s ToA entry states this
  distinction explicitly).

## The reward mechanic, in prose

Solo or up to 100 players raid the Chambers. On defeating the Great Olm, each player's own chest
is decided by a points roll:

1. **Points.** Earned from combat damage, storage-unit tiers, agility/strength shortcuts,
   Muttadile tree-cutting, Guardian pushes (uncapped formula "not currently known"), cooking food
   for teammates, potion-making, crab-room crystal changes, Ice Demon kindling, and a Thieving
   grub-filling minigame with its own documented cap formula
   (`MaxPoints = max(4500, ⌊totalThievingLevel/6⌋·150)`, `MaxGrubs = ⌈MaxPoints/115⌉`). Dying costs
   40% of the dying player's points (or 5% off the *team* total if the player had under 5% of the
   team total). Common-loot scaling caps at 131,071 points; the unique roll is **uncapped by
   points** (excess still rolls for further uniques, see below).
2. **Unique roll.** 1% chance per 8,676 total (team) points, capped at **65.7%** (570,000
   points). Points beyond the cap roll again for a **second** unique at the same 1%-per-8,676
   rate (so 855,000 points → 65.7% first roll, then 32.85% second roll on the 285,000-point
   remainder). **Up to 6 uniques can be awarded in one raid**, each an independent roll against
   its own points remainder. Getting a unique replaces that player's *entire* chest — no common
   rolls for them.
3. **Item weighting** (patched 2026-08-12, this fetch): Normal Mode denominator 60 (was 69),
   Challenge Mode denominator 56 (new — previously Normal/Challenge shared one table at
   denominator 69). Both prayer scrolls dropped from 20→14 (Normal) / →12 (Challenge); ancestral
   pieces rose 3→4 in both modes.
4. **Common table.** 2 rolls, **without replacement** — "the two rolls cannot end on the same
   drop" — across Runes/ammo, Herbs (33% chance of a seed substituting for the herb, ratio varies
   per herb), Ores/gems, and an Other group (torn prayer scroll, dark relic, etc.). An `ancient
   tablet` tertiary-style item ("replaces one of the loot rolls" if not already owned) sits inside
   the Other group at `1/10`, `gemw=No`.
5. **Tertiary**, always rolled regardless of unique/common outcome: `dark journal` (always, unless
   banked), elite clue `1/12` **only when no broadcasted unique was received this raid**, `Olmlet`
   pet `1/53` **only when a unique WAS received** (page notes this makes the effective rate
   "~1/1,765" at the average 26,025 points/raid — i.e. `1/53` of `P(unique)`, not unconditional),
   `twisted ancestral colour kit` `1/75`, `metamorphic dust` `1/400` (Challenge Mode only, within
   a time limit).

## Formulas

### `cox_points` — unique roll, per player, per raid, up to 6 rolls

```
rawChance(points) = points / 867,600          [1% per 8,676 points]
P(roll_n) = min(0.657, rawChance(remainingPoints_n))
remainingPoints_1 = TotalPoints
remainingPoints_{n+1} = remainingPoints_n − 570,000   (only reached if roll_n hit; 0 if negative)
n ranges 1..6
```
Source: Ancient chest, `===Unique drop table===`, revid `15295333`. The 65.7% figure itself cites
a 2019 Mod Ash tweet (previously 80% before a nerf).

**Per-player allocation within a team is unmodeled and out of scope**: "the player's points will
also determine who is more likely to obtain the unique drop if rolled on" — this is a
multi-player weighted lottery over the *team's* points distribution, not a single-player
probability. `SimContext` models one player's perspective; this needs a `PartySimContext`-shaped
extension PROJECT_PLAN.md never specifies, and no session should invent one without being asked.
Treat "total points" in the formula above as *this player's own* points when simulating solo, and
flag team play as unmodeled.

### Item weight table (post-2026-08-12 patch)

| Item | Normal (÷60) | Challenge (÷56) |
|---|---|---|
| Dexterous prayer scroll | 14 | 12 |
| Arcane prayer scroll | 14 | 12 |
| Twisted buckler | 4 | 4 |
| Dragon hunter crossbow | 4 | 4 |
| Dinh's bulwark | 3 | 3 |
| Ancestral hat | 4 | 4 |
| Ancestral robe top | 4 | 4 |
| Ancestral robe bottom | 4 | 4 |
| Dragon claws | 3 | 3 |
| Elder maul | 2 | 2 |
| Kodai insignia | 2 | 2 |
| Twisted bow | 2 | 2 |

Source: `===Unique drop table===`, `====Normal mode====`/`====Challenge mode====`, revid
`15295333`, citing the 12 August 2026 news post "Summer Sweep Up - Agility & Chambers of Xeric
Changes."

### Common-table quantity scaling — RESOLVED: `floor(personalPoints / divisor)`, one divisor per item

**No longer UNKNOWN.** The page's own prose never states a scaling rule for this table (confirmed:
no occurrence of "divisor", "scale", or "floor" anywhere in the Ancient chest wikitext), exactly
the shape of gap ToA hit for its unique-weight interpolation — a missing SOURCE, not a missing
fact. `Module:Chambers of Xeric calculator`'s `trashItems` table states it outright:

```lua
local quantity = math.floor(args.personalPoints / trash.divisor)
```

with one `divisor` (and one relative `weight`) per item, 43 items total, in three weight tiers
summing to a denominator of **99** (verified by direct sum, not read off a comment):

| Weight tier | Count | Items | Per-item weight |
|---|---|---|---|
| 3 | 23 | Death/Blood/Soul rune, Rune/Dragon arrow, all 10 ores/uncut gems (Silver, Coal, Gold, Mithril, Adamantite, Runite, sapphire, emerald, ruby, diamond), Lizardman fang, Pure essence, Saltpetre, Teak/Mahogany plank, Dynamite, Torn prayer scroll, Dark relic | 3 |
| 2 | 10 | Each of the 10 grimy herbs (ranarr, toadflax, irit, avantoe, kwuarm, snapdragon, cadantine, lantadyme, dwarf weed, torstol) | 2 |
| 1 | 10 | Each corresponding seed (ranarr, toadflax, irit, avantoe, kwuarm, snapdragon, cadantine, lantadyme, dwarf weed, torstol) | 1 |

`23×3 + 10×2 + 10×1 = 99`. Divisors (the `Points / divisor` denominator, `floor`ed) — runes: Death
36, Blood 32, Soul 20, Rune arrow 14, Dragon arrow 202; ores/gems: Silver ore 20, Coal 20, Gold ore
44, Mithril ore 32, Adamantite ore 166, Runite ore 2000, sapphire 188, emerald 142, ruby 242,
diamond 508; herbs: ranarr 946, toadflax 624, irit 194, avantoe 389, kwuarm 454, snapdragon 1560,
cadantine 396, lantadyme 297, dwarf weed 240, torstol 972 (and each corresponding seed at roughly
7x its herb's divisor: ranarr seed 6622, toadflax seed 4992, irit seed 1552, avantoe seed 3112,
kwuarm seed 3632, snapdragon seed 10920, cadantine seed 3168, lantadyme seed 2376, dwarf weed seed
1920, torstol seed 6804); other: Lizardman fang 28, Pure essence 2, Saltpetre 28, Teak plank 96,
Mahogany plank 238, Dynamite 54; Torn prayer scroll and Dark relic are always quantity 1 (divisor
1, hardcoded as a `quantity = 1` special case in the module rather than a real divide).

**Clarifies, rather than contradicts, the page's "33% chance of a seed substituting for the herb"
prose**: there is no conditional substitution mechanic. Each herb and its seed are simply two
ordinary rows in the same weighted table, at weight 2 and weight 1 respectively — the seed is drawn
2/(2+1) = 33.3% of the time *relative to that herb pair* purely because that is its share of the
combined weight, the same mechanism as every other weighted table in this project. "Ratio varies
per herb" in the prose most likely refers to the *divisor* (how much of each you get), not the
33%/67% split chance, which the module shows as uniform across all ten herb/seed pairs.

**One numeric discrepancy worth flagging, not silently resolved**: the module's per-roll unique
constant is `8675` (`relevantPoints/8675` as a percentage, i.e. `points/867,500` as a fraction),
while the page's own prose states "1% chance per **8,676** points" (`cox_points`'s existing
`867,600` divisor above). Both round to the same published "65.7%" cap at 4 significant figures
(`570,000/8675 = 65.6926%`, `570,000/8676 = 65.6754%`), so no cited figure on the page
distinguishes them. Flagged for whichever session builds `cox_points`: prefer the module's `8675`
if forced to pick one (it is what the live calculator actually computes and is unlikely to have
been hand-transcribed with a typo the way a wiki editor writing prose could), but the difference is
inside rounding noise for every currently-published number.

**Per-player allocation within a team is now precisely characterized by the module, not just
"presumably a lottery," and remains out of scope for the same reason.** `personalRatio =
personalPoints / groupPoints` (or `1 / teamSize` if the raid's leader ticks "split uniques
evenly"), and that ratio is applied directly as this player's own share of both the unique
expectation and (implicitly) the recipient probability. For solo play `personalPoints ==
groupPoints`, so `personalRatio = 1` and the whole mechanic collapses cleanly onto a single-player
`SimContext` — exactly what this doc already recommended before the module was read. Team/party
`SimContext` stays unbuilt and unrequested, per `docs/HANDOFF.md`'s Extension B section.

## Why this now generates a document but must not ship `verified`

**No longer `parse_failed` — see the corrected banner at the top of this file.** This section is
kept for the history: HANDOFF.md's landmine notes called this "zero `{{DropsLine}}`-shaped content
on its page at all," true literally (the template used is `{{DropsLineReward}}`, confirmed present
and well-formed throughout this page) but overstating the cause. The real reason `findDropsSections`
found nothing before 2026-08-16: this page's heading is `==Loot table==`, and the *original*
`DROPS_SECTION_TITLE` regex required the heading's own last significant word to be
"drops"/"rewards" — "Loot table" matched neither. The `DROPS_SECTION_TITLE`/`HEADING_PATTERN`
widening session (`docs/DECISIONS.md`) fixed exactly this class of gap, generically, not as an
Ancient-chest special case, and it now reaches `==Loot table==` and produces a real, structurally
clean document. **What blocks `verified` today is `not_on_watchlist` alone** — the parser has no
notion of the points-scaled preroll/suppression mechanic, so its naive read of the two tables it
now finds (`ancient-chest:0`/unique, `ancient-chest:1`/common) is unconditioned and wrong in the
specific, dangerous way described in the corrected banner and in
`data/mechanics-watchlist.json`'s `ancient-chest` entry.

## Proposed mapping onto the loot model

**Updated this session — the previous version of this diagram was itself stale against its own
2026-08-13 banner** (it still showed the unique-roll/common-table suppression and the elite-clue/
Olmlet gating as open problems needing a "new hybrid" mode and a new condition kind; both were
already resolved by `Table.suppressesFollowing` and a conditioned-marginal formula rate
respectively — the exact "banner corrected, body never updated" gap this session's task named ToB
for, found here too while re-auditing):

```
tables: [
  { id: 'cox:tertiary-journal', mode: 'always', entries: [ dark journal ] },
  { id: 'cox:unique-rolls', mode: 'independent', suppressesFollowing: true, entries: [
      { node: oneOf(12 items, weights per mode), rate: formula('cox_points', {rollIndex:1}) },
      { node: oneOf(...), rate: formula('cox_points', {rollIndex:2}) },
      ... up to rollIndex:6
      // suppressesFollowing:true is the resolved form of gap 2 below — a hit on ANY of these
      // 6 independent rolls suppresses cox:common, without discarding rolls 2-6 the way preroll
      // would. schema.ts's own comment on this field names Ancient chest as the source that
      // proved the need for it.
  ] },
  { id: 'cox:common', mode: 'weighted', denominator: 99, rolls: 2, withoutReplacement: true, entries: [
      // 43 entries, one per item in the "Common-table quantity scaling" table above;
      // each entry's qty is QtySpec.formula('cox_common_qty', {divisor: N}) or similar,
      // reusing the toa_common_qty shape (floor(points/divisor)) rather than a new formula id
  ] },
  { id: 'cox:tertiary', mode: 'independent', entries: [
      // The resolved form of gap 3 below: NOT conditioned on cox:unique-rolls' outcome (no
      // condition kind reads another table's result) but on the conditioned MARGINAL formula
      // rate directly, exact on every aggregate the simulator reports:
      { node: elite-clue, rate: formula('cox_points', {kind: 'eliteClueMarginal'}) },   // = P(no unique) x 1/12
      { node: olmlet, rate: formula('cox_points', {kind: 'olmletMarginal'}) },          // = P(unique) x 1/53
      { node: twisted-kit, rate: fixed(1/75) },
      { node: metamorphic-dust, rate: fixed(1/400), conditions: [variant: challenge-mode, within-time] },
  ] },
]
```

`cox:common`'s `rolls: 2, withoutReplacement: true` is a **direct, already-supported use** of the
schema field PROJECT_PLAN.md's Phase 1 decision log added for exactly this shape (see
`docs/DECISIONS.md`, "Table.withoutReplacement?: boolean") — no new model feature needed for the
"cannot roll the same drop twice" behaviour.

## What the mapping needs that doesn't exist

1. ~~Same `SimContext` points/raidLevel gap as ToA~~ **RESOLVED**: `ctx.points`.
2. ~~A hit anywhere in `cox:unique-rolls` (`independent` mode) needs to suppress `cox:common`
   later in the document, but only `preroll` hits suppress anything today... a new hybrid~~
   **RESOLVED**: `Table.suppressesFollowing`, `independent`-mode-only, built generically for
   exactly this shape ("every entry rolls independently so multiple can hit, but a hit anywhere
   ends the main chain") — `schema.ts`'s own doc comment cites Ancient chest by name as the
   confirmed source that justified it.
3. ~~The `elite-clue`/`Olmlet` tertiary entries are conditioned on "a unique was/wasn't awarded
   this raid" — a fact only knowable as another table's outcome, which no `Condition` kind can
   read~~ **RESOLVED AS UNNECESSARY, do not build a cross-table-visibility mechanism.** Because
   `ctx.points` is static for the whole run, the conditioned MARGINAL rate
   (`P(no unique this raid) × 1/12`, `P(unique this raid) × 1/53`, both derivable from the same
   `cox_points` formula the unique table already needs) is exact on every aggregate statistic the
   simulator reports — an ordinary `formula`-kind `Rate`, no new condition kind, no table-to-table
   channel. Using the raw, unconditioned `1/12`/`1/53` instead (without computing the split) would
   overstate Olmlet by **33x** — the failure mode to avoid, not evidence the mechanism needs new
   architecture. **Residual, accepted, not fixable by any engine change**: elite clue and Olmlet
   can appear together in the same logged kill (~4.6% chance across a 1,000-kill log at average
   points), impossible in-game since they're mutually exclusive outcomes of the same raid — needs
   an FE note on the eventual boss page, not an engine feature. (This residual is the reason gaps 2
   and 3 turned out NOT to need the same fix, despite looking related when first drafted: gap 2 is
   a real structural suppression between tables and needed a schema field; gap 3 dissolves
   entirely into ordinary math once `points` is recognized as run-static.)

4. ~~If the common-table quantity ranges do turn out to scale with points~~ **RESOLVED**: they do,
   via `floor(personalPoints / divisor)` per item (see above) — the same quantity/yield-scaling
   family as `docs/bosses/chest-tombs-of-amascut.md` gap 4 and `docs/bosses/monumental-chest.md`,
   already expressible via `QtySpec.formula`, no new model capability needed. A `cox_common_qty`
   (or shared-with-ToA) formula id is a build-time task, not a research gap.

Net for CoX, current: the `SimContext.points` gap is shared with ToA (not a new count, and already
resolved); gaps #2 and #3 above (both genuinely CoX-specific, needing `suppressesFollowing` and a
conditioned-marginal formula respectively) are **both resolved by existing model capability**, not
open; gap #4 is now a fully-sourced, cited rule. **What remains for CoX is implementation, not
research**: `cox_points` (and a common-quantity formula) as real `FORMULA_IDS` entries, an override
following ToA's exact `data/overrides/` pattern, and a wiki-figure verification test
(`apps/ingest/test/toa.test.ts`-shaped) before it can leave the watchlist — the same four-step
sequence `docs/OVERRIDES.md` already documents. Per-player/team allocation stays the one genuinely
out-of-scope piece, unchanged.
