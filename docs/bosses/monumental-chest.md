# Monumental chest — Theatre of Blood (ToB)

> ### ✅ BUILT — `data/overrides/monumental-chest.json`, 2026-08-16
>
> **This source is now implemented.** `tob_points`/`tob_common_qty` are real
> `FORMULA_IDS` entries, `SimContext` gained `roomsSkipped` and the derived
> `tobPoints`, and `apps/ingest/test/monumental-chest.test.ts` checks the
> merged document against every figure this doc and the module cite. Where
> the doc below and the override disagree, the override and that test are
> correct. `not_on_watchlist` still fails deliberately — left for the user to
> decide whether to remove the watchlist entry, since doing so is a status
> change (`needs_review` -> `manual_override`) this session didn't judge on
> its own initiative.
>
> **Left un-modelled, on purpose, matching the override's own note:**
> team/party unique-recipient allocation (out of scope, same shape as CoX);
> the "individual performance" scaling on all five tertiary rates (no
> magnitude stated anywhere — fixed rates used instead, the same UNKNOWN-curve
> treatment as Duke Sucellus/Zalcano); Entry Mode's own points/death
> interaction (unconfirmed either way — its -80% is a flat constant, not
> ratio-scaled).
>
> **The dropversion= Normal/Hard blend gap is now FIXED, separately, as
> planned — 2026-08-16, after this override shipped.** `wikitext-drops.ts`
> now propagates `{{DropsTableHead|dropversion=X}}` to regular
> `{{DropsLine}}`/`{{DropsLineReward}}` rows (previously only RDT/gem-table
> access lines read it), and `build-tables.ts`'s preroll-heading
> reconciliation is now per-variant-aware, so a block whose rows split
> cleanly by variant (each subset reconciling to its OWN denominator, 19 for
> Normal Mode and 18 for Hard Mode here) becomes one `weighted` table per
> variant instead of one undifferentiated 14-row preroll chain. Verified
> directly against the generated (non-override) document: it now emits
> `pre-roll-normal-mode` (denominator 19) and `pre-roll-hard-mode`
> (denominator 18) as separate tables, each entry correctly
> `variant`-conditioned, with `Boss.variants` and `contextDefaults.variant`
> derived from what the document actually uses rather than hardcoded to
> `['normal']` (a pre-existing gap that also affected other sources —
> black-demon, vorkath, amoxliatl — see `docs/DECISIONS.md`). This override
> still REPLACES the generated tables wholesale (its own hand-authored
> `tob_points`-driven structure is more complete than what the parser alone
> can reach — no formula, no `roomsSkipped`), so shipping the parser fix
> changed nothing about what actually gets simulated for ToB; it fixes the
> UNDERLYING generated document for anyone who inspects it directly, and
> fixes the same shape of bug on every other affected source too.
>
> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-16
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its older "What the mapping needs that doesn't
> exist" section is **not** — it was written before Extensions A and B, step
> (c) (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed. This
> is the *second* re-audit of this doc (the first, 2026-08-13, is folded into
> the corrections below); the task that requested this pass named this
> specifically as a doc whose capability verdicts "have been stale twice."
> Corrections, cumulative:
>
> - Gap 1 (`SimContext` deaths field) — **RESOLVED**: `ctx.deaths`.
> - Gap 3 (conditional multiplier for mode/death quantity scaling) —
>   **RESOLVED**: `Table.qtyMultiplier` (+ `qtyRounding` if the wiki states a
>   rounding rule).
> - Gap 2 (the magnitude of both scaling effects) — **RESOLVED this session**,
>   the same way ToA's and CoX's own UNKNOWNs were: not a model gap, a missing
>   SOURCE. `Module:Theatre of Blood calculator` states the exact points
>   formula neither this page's prose nor the earlier research session's page
>   reads ever surfaced — see "The `Calculator:Theatre of Blood loot` module"
>   below. (`tob_points`'s implementation status: see
>   `IMPLEMENTED_FORMULA_IDS`, not a snapshot here.) The rule it needs to
>   implement is now fully cited rather than unknown.
> - **New gap surfaced by the module, not previously flagged**: the points
>   formula needs a per-run "rooms skipped" scalar that `SimContext` does not
>   have today (`deaths` alone is not sufficient — skipping a room costs
>   points the same way a death does, and the module treats them as separate
>   inputs). Same *shape* of gap as `deaths` itself was before Extension A —
>   a plain numeric `SimContext` field, not a new capability class. See below.
> - **The Normal/Hard variant blend is a live, separate, already-diagnosed
>   parser gap — flagged explicitly per this session's task, not new
>   research**: `docs/DECISIONS.md`'s "corpus-reproducibility guard" entry
>   ("What this does NOT fix") found that Monumental chest's `===Pre-roll===`
>   section's `====Normal mode====`/`====Hard mode====` H4 sub-headings carry
>   `{{DropsTableHead|dropversion=...}}` — the same field `rdt-access.ts`
>   already reads as a `variant` condition for RDT access lines — but regular
>   `{{DropsLineReward}}` rows have no equivalent path today. Per the "heading
>   nesting collapses to the section's shallowest level" rule, Normal/Hard
>   mode's 14 unique rows flatten into ONE `weighted` group with no variant
>   tag, so the generated document's unique table blends both modes' shares
>   (Avernic defender hilt appears twice, once at weight 8 and once at weight
>   7, rather than as two separate `variant`-conditioned tables). **This is a
>   parser fix — teaching `{{DropsTableHead|dropversion=}}` to propagate a
>   `variant` condition onto regular drop rows the way it already does for RDT
>   access — not a research gap and not something an override alone can paper
>   over cleanly**, since the generated base document (which any override
>   would be layered onto or replace) currently mis-shapes this specific
>   table. Whoever builds ToB needs to either fix the parser first or have the
>   override author the unique-preroll table from scratch (the "Proposed
>   mapping" below already does the latter, `preroll`+`variant`-gated, so this
>   is buildable via override without waiting on the parser fix — flagging
>   both paths rather than picking one).
>
> Model capabilities now available: per-run `SimContext` scalars (`points`,
> `raidLevel`, `deaths`, `perfectKill`, `isMVP`, `delveLevel`, `wavesReached`,
> `moonsKilled`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`,
> `ownedCounts`); `QtySpec.formula`; formula-driven `Table.rolls`;
> `Table`/`TableRefNode` `qtyMultiplier` + `qtyRounding`;
> `Condition.levelAtLeast`; `Entry.ownershipGate`; `Table.suppressesFollowing`;
> `TableRefNode.drawsPerHit`. Still absent: run-scoped (within-kill) dynamic
> state, deeper inline table nesting, a `roomsSkipped`-shaped `SimContext`
> field (see above — trivial to add, same shape as `deaths`), party/team
> context, and real implementations for every `FORMULA_IDS` entry — current
> status: `IMPLEMENTED_FORMULA_IDS` in `packages/loot-model/src/formulas.ts`,
> not a count restated here (see `docs/DECISIONS.md`'s formula-status entry).
> `data/overrides/` exists and is in use (ToA, Doom of Mokhaiotl,
> Lunar Chest, Zalcano, Reward pool). See `docs/DECISIONS.md`.


`lootSourceId: monumental-chest` (tier A, `include: true`, `repeatable: true`, 52 raw rows).
Watchlisted (`point_scaled`). Blocks: Nylocas Vasilias, Pestilent Bloat, Sotetseg, The Maiden of
Sugadinti, Verzik Vitur, Xarpus. `status: needs_review`, `source: generated` — every structural
check green (`weights_sum`, `refs_resolve`, `rates_valid`, `qty_sane`, `items_known`,
`drops_covered` all `true`, confirmed via `data/bosses/monumental-chest.json` this session), only
`not_on_watchlist` fails, correctly. Also carries the Normal/Hard blend gap described in the banner
above — a real, separate parser-shaped issue, not the watchlist mechanic.

Sources:
- **Monumental chest** — https://oldschool.runescape.wiki/w/Monumental_chest — pageid `250011`,
  revid `15293917`. Re-fetched fresh in an earlier research session (2026-08-13); one cosmetic diff
  against the 2026-08-11 local snapshot ("Wine of zamorak" → "Wine of Zamorak" capitalization), no
  mechanic/number changes. Re-checked this session for any prose mention of "points", "MVP", or
  "skip" (the module's own vocabulary, below) — **none exists**: the page's only related sentence is
  "weighting based on deaths and damage dealt to each boss. The MVP is the most likely to receive
  the item," with no numbers. The points formula below is sourced entirely from the module, not the
  page prose — the same "missing source, not missing fact" shape as ToA's interpolation rule.
- **Theatre of Blood** (raid overview) — https://oldschool.runescape.wiki/w/Theatre_of_Blood —
  pageid `112226`, revid `15293433`.
- **`Calculator:Theatre of Blood loot`** —
  https://oldschool.runescape.wiki/w/Calculator:Theatre_of_Blood_loot — a `{{JSCalc}}` form
  transcluding `Calculator:Theatre of Blood/Template`, which is
  `{{#invoke:Theatre of Blood calculator|main}}`. **`Module:Theatre of Blood calculator`** —
  https://oldschool.runescape.wiki/w/Module:Theatre_of_Blood_calculator — the Lua source with the
  actual points/quantity formulas, fetched fresh this session (not previously in
  `data/snapshots/`) via `apps/ingest/src/fetch-wikitext-for.ts`, same tool/etiquette queue as
  every other page fetch in this project. Found by checking `Category:Calculators` directly for
  Theatre-of-Blood-adjacent entries, per this session's task instruction to check for a
  `Module:`/`Calculator:` page before recording a curve as UNKNOWN — this is the second of two such
  pages found this session (CoX's is the other, `docs/bosses/ancient-chest.md`); Fortis Colosseum
  was checked the same way and has neither (`docs/bosses/rewards-chest-fortis-colosseum.md`).

## The reward mechanic, in prose

**Correction to the previous framing, now that the calculator module has been read**: ToB's unique
gate is *not* a near-fixed preroll probability after all — it scales linearly with a real points
total, the same *shape* of mechanic as CoX/ToA, just with a much smaller effective range (points
only ever reduce the base rate, never increase it above 1/9.1 or 1/7.7). The mechanics watchlist
entry's original framing ("unique chance scales with Theatre of Blood points... not a fixed
per-kill rarity") was **closer to correct than the first research pass's prose-only read
concluded** — the page's own prose genuinely never states a formula (confirmed again this session:
zero occurrences of "point", "MVP", or "skip" in the page wikitext), but the calculator module the
page links to does, and the module wins per the ToA precedent ("where the module and the page's
prose disagree the difference is always flooring, and the module wins," `docs/DECISIONS.md`) —
here there's no disagreement, just a prose silence the module fills:

1. **Unique pre-roll, now with an exact points formula (sourced from the calculator module, not
   this page's prose — see below).** "Without any deaths, there is a **1/9.1** (~11%) chance of a
   unique reward across the team; dying will decrease this chance." Hard Mode: **1/7.7** (~13%),
   with the avernic defender hilt's weight reduced to boost the other uniques' relative share.
   **Entry Mode grants no unique pre-roll at all** — deterministically common-only, and the
   calculator itself has no Entry Mode option, so it is silent on Entry's own mechanics; the
   page's flat "no unique preroll" statement is the only source for Entry Mode and is unaffected
   by anything below. "The same regardless of team size" is true only for a *perfect* clear (every
   room completed, zero deaths) — the module's `maxpoints = 18·teamSize + 14` scales with team size
   exactly enough to keep a perfect run's ratio at 1.0 for any size, but a death's flat −4-point
   penalty is a *smaller fraction* of a larger team's `maxpoints`, so deaths matter proportionally
   less in bigger teams. Points, precisely: 6 rooms worth 3 points each (18 max) plus a shared pool
   of 14 "MVP bonus" points distributed across the team (a solo player receives all 14, since
   nobody else exists to share them with) minus 4 points per death — capped at 0, never negative.
   A solo player's own maximum is therefore **32 points** ("Player score: X/32" is literally what
   the calculator displays), and `P(unique) = points / (32 × 9.1)` for Normal / `/(32 × 7.7)` for
   Hard, at full points reducing to exactly 1/9.1 or 1/7.7 as the page states. **Skipping a room
   costs 3 points, the same as not clearing it — a mechanic this page's prose never mentions at
   all**, sourced entirely from the calculator's own input parameters
   (`Player's Rooms Skipped (0-6)`).
2. **Recipient + item selection.** If the pre-roll hits, the item is drawn from a small fixed
   weighted table (denominator 19 normal / 18 hard); which *player* receives it is "based on
   deaths and damage dealt to each boss," MVP most likely — a team-allocation detail, same
   out-of-scope shape as CoX's. **The calculator quantifies this too**: in its default
   (non-"split") mode, this player's own probability of being the recipient, given a team-wide
   unique hit, is exactly their own share of the team's points (`playerPoints / teamPoints`) — the
   identical "proportional to points contributed" shape CoX's module uses for its own per-player
   allocation. A raid can also opt into "split drops" (uniques valued as if shared evenly among
   the team) as an alternate convention; neither affects the single-player model, which (as with
   CoX) treats a solo player's own points as the whole input and leaves team play unmodeled.
3. **Common rewards** (only if no unique): 3 rolls, denominator 30, standard weighted table.
   **Quantity DOES scale with points, precisely — see "Common-table quantity scaling" below, not
   the flat percentages this doc previously described from prose alone.** Entry Mode −80% and the
   "deaths will reduce the quantity of common rewards for all players" line are both wiki prose,
   both real, but the calculator module reveals they compose through the *same* points ratio that
   drives the unique roll (`ratio = teamPoints / maxPoints`) rather than being a separate,
   unstated curve. **One correction to this doc's own earlier framing**: "Hard Mode +15% (another
   +15% if completed within the target time)" reads as compounding (1.15 × 1.15 = 1.3225); the
   module instead applies a flat **1.30 total multiplier** for the time-bonus case (not
   1.15-squared) — additive, not multiplicative. Entry Mode's −80% is not in the module at all
   (the calculator has no Entry Mode option), so that figure is prose-only and unconfirmed against
   any formula source.
4. **Tertiary**: elite clue at `1/25` (`altrarity` 3/25 Normal-Mode-scaled / 3.5/25 for
   Entry/Hard, "scales down based on individual performance"), `holy`/`sanguine` ornament kits,
   `sanguine dust` (Hard Mode only), `Lil' Zik` pet (`1/650` Normal, `1/500` Hard, "scales down
   based on individual performance" — same unspecified scaling as the clue).

## Formulas

### `tob_points` — points total, feeding BOTH the unique pre-roll and the common-quantity scale

**No longer "not points-derived" — that framing (this doc's own earlier title for this section)
was wrong, corrected this session.** `Module:Theatre of Blood calculator`, fetched fresh this
session (not in `data/snapshots/` before now — see Sources above), states the rule outright. For a
single simulated player (`SimContext` has no team concept, so this collapses the module's
team/solo cases the same way `docs/bosses/ancient-chest.md` collapses CoX's):

```
roomPoints    = (6 - roomsSkipped) × 3              [max 18, at roomsSkipped = 0]
mvpPoints     = 14                                   [a solo player receives the whole shared pool]
deathPenalty  = deaths × 4
points        = max(0, roomPoints + mvpPoints - deathPenalty)   [max 32]
ratio         = points / 32

P(unique | variant=normal) = ratio / 9.1     (= 1/9.1 exactly at ratio = 1, ~10.989% max)
P(unique | variant=hard)   = ratio / 7.7     (= 1/7.7 exactly at ratio = 1, ~12.987% max)
P(unique | variant=entry)  = 0                [the calculator has no Entry Mode option; this
                                                 half of the rule is prose-only, from the page
                                                 itself, and unaffected by the module]
```

Source: `Module:Theatre of Blood calculator` (`p.calc`, the non-`splitdrops` branch), read
directly — `playerpoints = max(0,(6-args.iskip)*3 + args.imvp - args.ideath*4)`,
`maxpoints = 18*args.teammates + 14`, `dropchancesolo = dropchance*playerpoints/teampoints` where
`dropchance = ratio/urate`; substituting `teampoints = playerpoints` (true for `teammates = 1`,
verified algebraically, not assumed) collapses this to `playerpoints / (32 × urate)` exactly as
written above. Cross-checked against the page's own cited figures: at full points (`ratio = 1`)
this reproduces 1/9.1 and 1/7.7 exactly, the only two numbers the prose itself states.

**One numeric discrepancy worth flagging, not silently resolved**: the module has no explicit
"target time" input for Normal Mode's own rate (`urate` is a flat 9.1/7.7 keyed only on
`hard`/not-`hard`), so if a Normal-Mode time bonus exists it is not in the calculator — the doc's
earlier text never claimed one either, consistent.

**Formerly UNKNOWN, now resolved**: the exact death-penalty formula. Each death is a flat **−4
points** against a 32-point solo maximum (12.5 percentage points of `ratio` per death, floor of 0
after 8 deaths). Skipping a room costs the same 3 points as simply not clearing it — a mechanic no
prior version of this doc, and no page prose, ever named.

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

### Common-table quantity scaling — RESOLVED: `floor(item.min × modeMultiplier × ratio)`, ranged

**No longer "qualitative only, no formula given" — the module states one outright**, using the
same `ratio` (`points / 32`) the unique pre-roll reads:

```
modeMultiplier = 1                          [Normal]
modeMultiplier = 1.15                       [Hard, no time bonus]
modeMultiplier = 1.30                       [Hard, time bonus — flat total, NOT 1.15² = 1.3225]

qtyLow  = floor(item.min × modeMultiplier × ratio)
qtyHigh = floor(qtyLow × 1.2)
quantity ~ range(qtyLow, qtyHigh)           [displayed as a range; the module itself only
                                              computes an expected value from it, so whether the
                                              actual roll is uniform over this range or something
                                              narrower is not stated by the module either]
```

with a 29-item, denominator-30 weight table (`item.min`, the base quantity at `ratio = 1`,
`modeMultiplier = 1`; `chance`, the item's weight):

| Item | min | weight | Item | min | weight |
|---|---|---|---|---|---|
| Vial of blood | 50 | 2 | Battlestaff | 15 | 1 |
| Death rune | 500 | 1 | Mahogany seed | 10 | 1 |
| Blood rune | 500 | 1 | Rune battleaxe | 4 | 1 |
| Swamp tar | 500 | 1 | Rune platebody | 4 | 1 |
| Coal | 500 | 1 | Rune chainbody | 4 | 1 |
| Gold ore | 300 | 1 | Palm tree seed | 3 | 1 |
| Molten glass | 200 | 1 | Yew seed | 3 | 1 |
| Adamantite ore | 130 | 1 | Magic seed | 3 | 1 |
| Runite ore | 60 | 1 | Grimy cadantine | 50 | 1 |
| Wine of Zamorak | 50 | 1 | Grimy avantoe | 40 | 1 |
| Potato cactus | 50 | 1 | Grimy toadflax | 37 | 1 |
| Grimy kwuarm | 36 | 1 | Grimy irit leaf | 34 | 1 |
| Grimy ranarr weed | 30 | 1 | Grimy snapdragon | 27 | 1 |
| Grimy lantadyme | 26 | 1 | Grimy dwarf weed | 24 | 1 |
| Grimy torstol | 20 | 1 | | | |

(29 items, weights sum to `2 + 28×1 = 30`, matching `normiestotal = 30` and this doc's
already-correct "denominator 30" figure.)

**Checked directly against the page's own live `{{DropsLineReward}}` rows, item by item — the
formula reproduces every one exactly EXCEPT Vial of blood.** At `ratio = 1`, `modeMultiplier = 1`
(a perfect Normal-Mode clear):

| Item | Module predicts (`min`, `min×1.2`) | Page actually says | Match? |
|---|---|---|---|
| Death rune | 500–600 | `quantity=500-600` | ✓ exact |
| Runite ore | 60–72 | `quantity=60-72 (noted)` | ✓ exact |
| Grimy torstol | 20–24 | `quantity=20-24 (noted)` | ✓ exact |
| Yew seed | 3–3 (range collapses, `floor(3×1.2)=3`) | `quantity=3` (shown as a single value) | ✓ exact |
| Vial of blood | 50–60 | `quantity=45-60 (noted)` | ✗ low end only |

Four of five match to the exact integer, including a collapsed-range edge case (Yew seed), which is
strong direct evidence the formula and the `min` table above are both correct and that Vial of
blood's low end (45 instead of the predicted 50) is an isolated page inconsistency — most likely
stale prose from before a balance change, or a one-off editing error — rather than a sign the
formula or `ratio = 1` reference point is wrong. **Recommendation for whoever builds this: trust the
module's `min = 50` over the page's `45`,** and re-verify against a fresh page fetch at build time
in case the page has since been corrected (do not silently "fix" the page's number without checking
whether it changed).

Source: `Module:Theatre of Blood calculator` (`normies` table + the `quantity` expression in
`p.calc`), cross-referenced against `===Common rewards===` prose, revid `15293917`, for the
Entry-Mode −80% figure the module does not cover (Entry Mode has no calculator option at all) and
the general "deaths reduce quantity" direction the module now quantifies precisely via `ratio`.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'tob:unique-preroll', mode: 'preroll', rolls: 1, entries: [
      { node: oneOf(7 items, weight per mode = normal), rate: formula('tob_points', {variant: 'normal'}),
        conditions: [variant: normal] },
      { node: oneOf(7 items, weight per mode = hard), rate: formula('tob_points', {variant: 'hard'}),
        conditions: [variant: hard] },
      // variant: entry gets no entry here at all — correctly falls through to common
  ] },
  { id: 'tob:common', mode: 'weighted', denominator: 30, rolls: 3,
    qtyMultiplier: formula('tob_points', {kind: 'qtyRatio'}),   // mode-multiplier × points-ratio, per item below
    entries: [ ...29 entries, each qty: range(min, floor(min*1.2)) before qtyMultiplier applies... ] },
  { id: 'tob:tertiary', mode: 'independent', entries: [ elite clue, ornament kits, sanguine dust (hard only), Lil' Zik ] },
]
```

**Still the cleanest of the three raid chests to map** — `preroll` with `variant`-conditioned
entries, exactly as the schema already supports (Vardorvis/Duke Sucellus/Whisperer/Leviathan's
`variant`-conditioned tertiary entries are the established precedent per `docs/DECISIONS.md`).
**Corrected from the earlier draft**: the unique gate's rate is now `formula`-kind, not `fixed` —
the module's discovery that it scales with `points/32` (this doc's earlier "no formula is even
strictly required" claim assumed a raid-mode constant, which turned out to be wrong, see above).
`tob:common`'s `qtyMultiplier` composes the mode multiplier (1 / 1.15 / 1.30) with the points ratio
in one formula call — the same "quantity/yield scaling via conditional multiplier" shape already
shipped for Duke Sucellus and Zalcano, just with a formula-valued multiplier instead of a constant
one (`MultiplierSchema` already allows `number | FormulaRef`, see `schema.ts`).

**One thing this sketch does NOT resolve**: the Normal/Hard blend gap in the banner above means
the *generated* `unique-preroll`-shaped table (if the parser ever produces one at all — it
currently doesn't reach a clean preroll shape here per the corpus-reproducibility session) would
merge both modes' weights. An override authoring this table from scratch, as sketched here, sidesteps
that entirely by hand-writing two separate `variant`-conditioned `oneOf` pools — which is what the
override path already does for every other raid chest, so this is not a new problem, just worth
being explicit that the override is doing real work here, not merely formalizing what the parser
would produce.

## What the mapping needs that doesn't exist

1. ~~A per-run `deathCount` (or `deaths`) field on `SimContext`~~ **RESOLVED**: `ctx.deaths`.
2. **NEW, surfaced by the module — a per-run `roomsSkipped` field.** Not previously flagged by any
   version of this doc, because the room-skip mechanic itself was unknown until the module was
   read. Same shape as `deaths`: a plain non-negative integer `SimContext` field
   (`z.number().int().nonnegative().default(0)` on the `deaths` pattern), read by `tob_points`
   alongside `ctx.deaths`. Trivial to add per Extension A's established shape — not a new
   capability class, just a field nobody had asked for yet (the exact framing
   `docs/HANDOFF.md`'s "lunar-chest lesson" warns about: having the *capability* to add a field
   is not the same as having already added the specific one a source needs).
3. ~~The magnitude of both scaling effects is UNKNOWN~~ **RESOLVED**: both are `points/32`-driven,
   sourced from `Module:Theatre of Blood calculator`, cited in full above. (`tob_points`'s
   implementation status: see `IMPLEMENTED_FORMULA_IDS`, not a snapshot here.) The rule to
   implement is now fully specified rather than unknown.
4. ~~Applying the mode/death quantity scaling needs a conditional multiplier on a table's whole
   yield, which doesn't exist~~ **RESOLVED**: `Table.qtyMultiplier` (shipped for Duke
   Sucellus/Zalcano/general use) already accepts a `FormulaRef`, not just a constant — no new
   schema capability needed, just a `tob_points`-shaped formula returning the composed
   `modeMultiplier × ratio` value.
5. ~~One real open item, not a capability gap: the Vial of blood discrepancy~~ **RESOLVED**:
   checked item-by-item against the page's own rows (Death rune, Runite ore, Grimy torstol, Yew
   seed all match the module exactly); Vial of blood's page-stated 45 is the outlier, not the
   module's predicted 50 — use the module's number, re-verify at build time.

Net for ToB, current: **every capability gap this doc ever named is now resolved** — the two
UNKNOWN constants (the actual blocker every earlier version of this doc named as the reason ToB
couldn't be built) are sourced and cited, not guessed. What's left is implementation work
(`tob_points` as a real formula, a `roomsSkipped` context field, the override itself, a
wiki-figure test verifying reproduced numbers against the calculator's own displayed output) — the
same four-step sequence `docs/OVERRIDES.md` already documents for every other raid chest. No
CoX-style cross-table suppression gap here — ToB's single preroll-mode gate already handles
"unique replaces all common loot" for free.
