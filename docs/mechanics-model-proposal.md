# Proposal: model and simulator extensions for the 17 non-verified sources

Written after reading all 14 `docs/bosses/*.md` research docs plus the current
`packages/loot-model/src/{schema,compile,simulate,formulas}.ts`. No code
changes are included here except the watchlist swap fix and the watchlist/
inventory consistency check, both done separately per the accompanying task
(see `data/mechanics-watchlist.json` and
`apps/ingest/src/validate/watchlist.ts`'s `checkWatchlistConsistency`).

This is a proposal, not a decision. Where I disagree with the framing in the
brief, I say so and why, backed by reading the actual code.

## Verdict on the four framing claims

1. **Gap 1 (per-run scalars), quantity-scaling, and rolls-reads-integer are
   the same shape.** Agree, and I'd go further: once you build this, **most
   of wave/level-indexed content collapses into it too** — see below. This
   isn't "treat as one extension" so much as "three of your four families
   turn out to be one."
2. **Owned/received-before state is genuine new architecture.** Agree it's
   new, but it's smaller than it looks: half of it is SimContext-field-shaped
   (same cost as gap 1). The other half — generalizing the RoW
   denominator-shrink rule — is real, and I found a **concrete way the
   obvious version of it breaks Brutus**, one of the 36 verified sources.
   Details below; this is the highest-risk single line item in this whole
   proposal.
3. **Wave/level-indexed with bankable loot is genuine new architecture.**
   **Disagree, mostly.** If "how far the player got" is treated as a fixed
   per-run input (exactly how ToA already treats raid level, not as a
   simulated combat outcome — this project explicitly isn't a DPS
   calculator), Doom of Mokhaiotl needs *nothing* beyond Extension A. Fortis
   Colosseum needs Extension A for ~90% of it, plus one small, isolated,
   flaggable approximation for the wave-scoped armour dedup. There's no
   "wave engine" to build.
4. **CoX cross-table suppression + visibility, and Corporeal Beast's
   access-once-draw-K, are overrides. Don't build general mechanisms.**
   Partially agree, and revised after quantifying #3 (see below — this was
   the biggest correction from actually working the numbers). Corporeal
   Beast: fully agree, it's a two-line schema field. CoX's *suppression*
   (#2): actually cheap and generic, same cost class as the RoW fix — I'd
   build it as a small schema flag, not treat it as CoX-only. CoX's
   *cross-table outcome visibility* (#3, "did table X hit, readable by table
   Y in the same kill") — **I originally called this the one place in this
   batch needing something structurally new. Quantifying it showed that's
   wrong for CoX specifically**: because `ctx.points` is static per run, the
   *aggregate* rate never needs same-kill correlation at all, only a
   correctly-conditioned formula (Extension A territory). What's left is a
   small, bounded, documentable artifact in the kill log, not a missing
   engine capability. The genuinely-new-architecture case is Fortis
   Colosseum's armour dedup, which *does* need same-kill state (its "which
   pieces given out" fact has no static per-run input the way CoX's points
   does) — that one I'd still defer and approximate.

---

## Blast radius on the 36 verified sources, and the hot path

**Behaviorally: none of the 36 verified sources are affected.** Every schema
change proposed below is additive (new optional field, new enum/union arm, or
a new `Condition` kind) and none of the 36 currently-verified boss documents
reference any of it, so their compiled output is byte-identical before and
after. The one exception that needed checking rather than assuming is the
owned-state denominator-shrink rule (Extension B) — see that section; it's
scoped narrowly specifically because the unscoped version changes Brutus's
output.

**Conditions do not move from resolved-once to per-kill.** This is worth
being explicit about since it's the trigger the brief named for
re-benchmarking. `compile.ts`'s existing discipline — `SimContext` is fixed
for the duration of a run, so conditions and formula-rates are evaluated
exactly once, in `compileBoss`, before any kill is simulated — is preserved
by every part of Extension A:

- The new `QtySpec` formula variant and the new `Table.rolls` formula-count
  variant are both resolved **at compile time**, in `compileNode`/
  `compileRolls`, exactly like the existing `Rate` formula variant already
  is. By the time `simulate.ts` runs a single kill, these have already
  collapsed to plain numbers. `rollQty` and the per-kill loop in
  `simulate.ts` need **no changes** for either.
- The new `Condition` kind (`levelAtLeast`) is evaluated by `entryApplies`
  exactly where every other condition is: once, during `compileTable`'s
  `applicable` filter, not per kill.

**What does touch the hot path**, and needs to be measured rather than
assumed safe:

1. **`qtyMultiplier`** (`Table` and `TableRefNode`). The multiplier's
   *value* is still resolved once at compile time and baked into the
   compiled form as a plain number — but *applying* it happens per emitted
   item, inside `simulate.ts`'s `emit`/`runTable`, which are the hottest
   functions in the simulator (called once per roll per kill, up to 10M
   times). This needs a new parameter threaded through the recursive
   `emit`/`runTable` calls and one extra multiply at the `item` leaf,
   **for every source, not just the ones that use a non-default
   multiplier** (default 1 still has to flow through and multiply).
2. **`drawsPerHit`** (`TableRefNode`, Corporeal Beast). Adds a loop-count
   increase at `tableRef` nodes that carry it — gated behind a rarely-hit
   branch (only sources that set it, and only on the roll that already hit),
   so this one is low-risk by construction, but it's still a change to the
   same hot function.

Nothing else in Extension A touches `simulate.ts`'s per-kill loop at all.

**Benchmark, before implementing anything**, using the existing 1M-kill
Brutus fixture (`packages/loot-model/test/fixtures/brutus.ts`), which is
already the project's own reference case for this (PROJECT_PLAN.md 6.4/8):

| Kills | Wall clock (median of 3 runs) | gpPerKill |
|---|---|---|
| 1,000,000 | ~143ms | 599.77 |
| 10,000,000 | ~1,446ms | 599.05 |

**Update, after implementing (a) — this section's prediction held, with one
correction applied.** First pass (naive `Math.round(qty * qtyMultiplier)` on
every item emission, unconditionally): 1M ≈ 195ms, 10M ≈ 1,550ms — a real
~35% regression, from paying for a no-op multiply-and-round on every source
that never sets `qtyMultiplier`. Per this section's own stated trigger
("special-casing the multiplier===1 path to skip the round"), added exactly
that in `simulate.ts`'s `emit`: `qtyMultiplier === 1 ? rolled :
Math.round(rolled * qtyMultiplier)`. Re-measured after:

| Kills | Wall clock (median of 3 runs), after Extension A | Delta vs. baseline |
|---|---|---|
| 1,000,000 | ~148ms | +3.5% |
| 10,000,000 | ~1,496ms | +3.4% |

Still comfortably inside the "couple of seconds" bar (10M in ~1.5s, not the
~2s the naive version would have used up most of the headroom on), and the
residual ~3.5% is the unavoidable cost of one extra function parameter and
one `=== 1` comparison per emission — there's no cheaper way to thread a
value that has to compose across nesting. `gpPerKill` is byte-identical
(599.77 / 599.05) before and after every change in this section, confirming
the optimization is behavior-preserving, not just faster.

**Conditions were confirmed to stay resolved-once, not re-evaluated-per-kill**
— the implementation matched the plan exactly (`compileNode`/`compileRolls`
resolve every formula at compile time; `entryApplies`'s `levelAtLeast` case
is an ordinary static comparison), so the trigger this section named for
re-benchmarking never actually fired in the sense originally worried about.
The measured regression above is entirely attributable to `qtyMultiplier`'s
per-emission threading, which this section flagged as the one real hot-path
change up front — re-benchmarking was still the right call, it just confirmed
a narrower, already-anticipated cost rather than the broader one the trigger
condition described.

## Quantifying the CoX outcome-visibility approximation

The brief asked how far off the affected rates are if CoX's elite-clue/Olmlet
gating is treated as independent, and whether the FE needs to say so. Working
the actual numbers changed my recommendation, not just quantified it.

**The two gated tertiary rates, from `docs/bosses/ancient-chest.md`:** elite
clue fires at `1/12`, but *only if no unique was awarded this raid*; Olmlet
fires at `1/53`, but *only if a unique was awarded*. `cox_points` gives
`P(unique this raid)` as a deterministic function of `ctx.points` (a chain of
up-to-6 Bernoulli rolls against successive point-remainders, per that doc).
At the wiki's own cited average of 26,025 points/raid: `P(unique) ≈ 3.00%`
(`26025 / 867600`, below the single-roll cap, so no second roll is reachable
at this average).

**Two different "treat as independent" readings give very different
answers:**

- **Naive — flat, uncorrected subrates (`1/12`, `1/53`).** This is what
  "just drop the gating condition" would produce if implemented carelessly.
  Elite clue: `1/12 = 8.33%` vs. the true marginal `P(no unique)×1/12 =
  8.08%` — a ~3% relative overstatement, minor. **Olmlet: `1/53 = 1.89%` vs.
  the true marginal `P(unique)×1/53 = 0.057%` (≈1/1,767, matching the wiki's
  own quoted "~1/1,765" almost exactly) — a 33× overstatement.** This
  reading is what "material" looks like, and it's exactly the failure mode
  a careless implementation would ship: the game's rarest pet in this whole
  batch, reported 33 times too common.
- **Correct — flat rates using the conditioned marginals
  (`P(no unique)×1/12`, `P(unique)×1/53`), computed once from `ctx.points`
  via the same `cox_points` formula gap #2 already needs.** Because
  `ctx.points` is a static per-run scalar in this architecture (never
  resampled kill to kill, same as every other points-scaled source), these
  marginals are **exactly** the per-item rate CoX's true, correlated model
  produces — the derivation is: `P(elite clue fires this kill) = P(no
  unique)×1/12 + P(unique)×0`, which is definitionally the same number
  whether or not the two branches are modelled as mutually exclusive.
  **The aggregate per-item drop rate a user reads off a 10M-kill run is
  therefore identical, not approximated, under this reading.**

**What's genuinely still lost under the correct reading**, and the one thing
worth surfacing: the two branches are still simulated as if independent, so
a small fraction of individual simulated kills will show **both** an elite
clue *and* an Olmlet pet in the same kill — impossible in the real game.
`P(both, one kill) = 0.0808 × 0.000566 ≈ 1/21,900`. The kill log shown in the
UI is capped at the first 1,000 kills (PROJECT_PLAN.md 8), so the chance
*any* logged kill shows this is `≈ 1 − (1 − 1/21,900)^1000 ≈ 4.6%` — roughly
1 in 22 times a user opens the log for this source, they could see an
in-game-impossible pair of drops in the same line.

**Revised recommendation, correcting the original proposal:** gap #3 doesn't
need new architecture at all — it needs the *correct* formula (conditioned
marginals, not raw subrates), which is exactly Extension A's existing
formula-`Rate` mechanism, no new condition kind or within-kill state
required. Gap #2 (suppression) is unchanged from the original proposal — a
small `suppressesFollowing` flag, still worth building once, generically.
**The FE-facing requirement**: the CoX boss document/override should carry a
note (`Table.notes` or a boss-level flag) surfacing the kill-log artifact
specifically — "elite clue and Olmlet pet may appear together in the kill
log; this cannot happen in-game and does not affect aggregate drop rates" —
distinct from, and more specific than, the generic `needs_review` badge,
since the badge alone doesn't tell a user *what* to distrust and this
specific thing (aggregate rates) is actually fine. This is a documentation/FE
task for whenever CoX's actual boss doc gets built (step (c) territory or
later), not something step (a) needs to implement.

---

## Extension A: static per-run values + formula-driven fields

Covers: gap 1 (`SimContext` scalars), the quantity-scaling family (both
flavors), `rolls` consuming an integer, and — with the reframing above —
Doom of Mokhaiotl and most of Fortis Colosseum, Inferno, TzHaar Fight Cave,
Zalcano, Abyssal Sire, ToA, ToB (modulo two UNKNOWN constants), and
Wintertodt/Tempoross (modulo one wrinkle, see below).

### Why these are one extension, not three

`Rate` already has a `formula` variant, evaluated once against a static
`SimContext` at compile time (`compile.ts`'s `compileRolls`/`compileTable`
call `rateToProbability` → `evaluateFormula` eagerly, not per-roll — this
matters, see "cost" below). `QtySpec` and `Table.rolls` lack an equivalent.
Adding one to each, sharing the same formula registry and the same "resolve
once at compile time, ctx never changes mid-run" discipline the codebase
already commits to, is genuinely one mechanism used three places — not three
separate features that happen to ship together.

### Concrete schema changes

**`SimContext`** (`schema.ts`) gains fields, all with defaults so
`DEFAULT_SIM_CONTEXT` stays a single source of truth:

```ts
points: z.number().int().nonnegative().default(0),        // ToA/CoX/ToB/Zalcano/Tempoross/Wintertodt
raidLevel: z.number().int().nonnegative().default(0),      // ToA
deaths: z.number().int().nonnegative().default(0),         // ToB (magnitude UNKNOWN, see below)
perfectKill: z.boolean().default(false),                   // Duke Sucellus
isMVP: z.boolean().default(false),                         // Zalcano
delveLevel: z.number().int().nonnegative().default(0),     // Doom of Mokhaiotl
wavesReached: z.number().int().nonnegative().default(0),   // Fortis Colosseum
moonsKilled: z.array(z.enum(['blood', 'blue', 'eclipse'])).default([]), // Lunar Chest
fishingLevel: z.number().int().min(1).max(99).default(1),  // Reward pool
```

Two things worth flagging rather than deciding here:

- Zalcano needs *two* derived point values (`P_M`, `P_T`) from the same `H`/`S`
  damage inputs, per its own doc. Cleanest is probably `hitpointsDamage` +
  `shieldDamage` raw inputs rather than a pre-derived `points`, with
  `zalcano_points` doing the derivation — avoids a `points` field whose
  meaning differs per boss.
- This is a genuinely large, one-shot addition to a `.strict()` schema.
  **Every literal `SimContext`/`DEFAULT_SIM_CONTEXT` construction needs the
  new fields or TypeScript fails to compile**, not just runtime tests. Grep
  count: 15 files construct `SimContext`-shaped literals directly
  (`packages/loot-model/test/{helpers,conditions,brutus,simulate}.test.ts`,
  `test/fixtures/brutus.ts`, `src/schema.ts`, `src/conditions.ts`,
  `src/index.ts`; `apps/web/src/lib/url-state.ts` + its test;
  `apps/ingest/test/{build-tables,classify,ev-matches,assemble-boss}.test.ts`;
  `apps/ingest/src/validate/weights-sum.ts`). `zod`'s `.default()` makes this
  mechanical (every field optional on construction) rather than a
  find-every-callsite hunt, but it's still real, real-in-TypeScript work, not
  a config toggle.

**`QtySpec`** (`schema.ts`) gains:

```ts
{ kind: 'formula', id: FormulaIdSchema, params: z.record(z.unknown()).default({}) }
```

Resolved **at compile time**, not per-roll: `compile.ts`'s `compileNode`'s
`item` case evaluates it once against `ctx` and bakes the result into the
`CompiledNode` as a plain resolved quantity. This means `rollQty`/`simulate.ts`
need **zero changes** — the formula has already collapsed to a number by the
time `simulate.ts` ever sees it. Covers ToA's `Points/ItemDivisor`, Inferno's
and TzHaar Fight Cave's Tokkul, Zalcano's role-keyed crystal-shard tiers
(a formula can return a discrete stepped value as easily as a continuous
one — this doesn't need a fourth QtySpec kind, contrary to what
`docs/bosses/zalcano.md` worried).

**`Table.rolls`** gains a *third*, distinct arm — not a reuse of `Rate`'s
`formula` kind, because that kind means "Bernoulli probability," and `rolls`
needs "integer count":

```ts
rolls: z.union([z.number().int().positive(), RateSchema, RollsFormulaSchema]).default(1)
// RollsFormulaSchema = { kind: 'formula', id: FormulaIdSchema, params: ... }
```

Same compile-time-resolution treatment as above — `compileRolls` evaluates it
once and returns `{ kind: 'count', n: <resolved> }`; `CompiledRolls`'s type
doesn't even need a new variant. Covers Lunar Chest's 1/3/6 and (modulo the
wrinkle below) Wintertodt's roll count.

**`formulas.ts`'s contract needs to fork.** `evaluateFormula` today validates
its result as `[0, 1]` unconditionally — correct for `Rate`, wrong for a
`QtySpec`/`rolls` formula (which must be a non-negative, usually integer,
number with no upper bound). Propose splitting into three thin call-site
validators over the same `FormulaRegistry`/`FormulaFn` shape:
`evaluateRate` (today's behavior, renamed), `evaluateQuantity` (finite,
non-negative), `evaluateMultiplier` (finite, positive, no [0,1] cap). This
means a formula id's contract (which of the three it fulfills) has to live in
its docstring, not in the type system — `FormulaFn` stays `(params, ctx) =>
number` regardless of which validator ends up calling it. Worth a comment at
each new formula's registration site; not worth over-engineering into three
separate `FormulaFn` subtypes for the two dozen formulas this project has.

**`Table` and `TableRefNode`** (`schema.ts`) both gain an optional
`qtyMultiplier`:

```ts
qtyMultiplier: z.union([z.number().finite().positive(), MultiplierFormulaSchema]).optional()
```

`Table.qtyMultiplier` scales every realized quantity rolled from *that
table's own entries* (Duke Sucellus's perfect-kill +50% on its standard
table; ToB's mode/death scaling on its common table). `TableRefNode`'s scales
whatever a *referenced* table yields when accessed through that specific
entry (Abyssal Sire's flat ×2 on `rare_drop_table`, leaving the shared,
unscaled `data/tables/rare_drop_table.json` record untouched for the ~17
other sources that reference it plainly).

I'm folding Zalcano's MVP +10% into this same mechanism, correcting
`docs/bosses/zalcano.md`'s own framing: that doc argues the MVP bonus needs a
"post-sampling, simulate.ts-only" mechanism distinct from Duke Sucellus's
perfect-kill +50%, because it's "10% more of what this player already got."
Mechanically these are identical — both are "multiply this table's realized
per-roll quantity by a scalar, gated by a per-run boolean" (`perfectKill` /
`isMVP`, both new `SimContext` fields above). There's no real difference
between "the standard table's roll, times 1.5, if perfect kill" and "the main
table's roll, times 1.1, if MVP." One mechanism, four sources (Abyssal Sire,
Duke Sucellus, ToB, Zalcano), not two.

**Cost in `simulate.ts`/`expected-value.ts`:** unlike the QtySpec-formula and
rolls-formula cases, this one *does* touch the recursive per-kill walk,
because the multiplier has to apply at the point a quantity is finally
recorded, and needs to compose across nesting (Abyssal Sire's ×2 should
apply to whatever the RDT→gem→mega-rare chain ultimately yields, not just
top-level RDT items). Concretely: `emit`/`runTable` in `simulate.ts` need a
`multiplier: number` parameter (default 1) threaded through the recursive
calls, multiplying at each level a `qtyMultiplier` is present, applied at the
`item` leaf just before `tally.record(...)`. `expected-value.ts`'s analytic
walker (I haven't read it in detail, but by the "both walk the same compiled
form" design in `compile.ts`'s header comment, it almost certainly has the
same recursive shape) needs the identical change. This is the one part of
Extension A that's a genuine simulator-logic change, not just new schema
plus compile-time resolution — small, but real, and it's the part I'd want a
second pair of eyes on before merging.

**New `Condition` kind**, reusing the existing pattern
(`killCountAtLeast` is the closest precedent):

```ts
{ kind: 'levelAtLeast', n: z.number().int().nonnegative() }
```

Read against `ctx.delveLevel` or `ctx.wavesReached` depending on which field
the boss doc's formulas already reference — or, more consistently with
`variant`'s existing free-text-name design, a single
`{ kind: 'contextAtLeast', field: string, n: number }` if more than these two
sources end up needing a leveled gate. I'd start narrow (two boss-specific
conditions or one parametrized one) and widen only if a third source shows
up, matching how this project has handled every other "is this general
enough yet" call so far (see DECISIONS.md's repeated refusal to widen the
"Uniques" heading keyword on exactly this kind of "not yet, only one/two
confirmed cases" reasoning).

### Why Doom of Mokhaiotl needs literally nothing beyond this

Every piece of its mechanic is already expressible with Extension A alone:
per-level unique rates are `Rate.formula` reading `ctx.delveLevel` (already
exists, zero schema change); per-level quantity multipliers and guaranteed
tears are `QtySpec.formula` reading the same field; each level's table is
gated by `levelAtLeast(n)` and simply doesn't suppress anything else (no
preroll involved) — it's `N` more entries in the existing `tables` array,
not a new structural concept. **No wave/level machinery to build.**

### Fortis Colosseum: same, except one piece

The waves themselves, the per-wave unique-access rate table, and wave 12's
bonus table are all the same shape as Doom of Mokhaiotl — `levelAtLeast`-gated
entries in the existing `tables` array. The **one** piece that doesn't fit is
the echo-crystal/armour-piece duplicate avoidance *within a single run*
(prefer whichever piece this run hasn't already given out, across waves 4–12
of the *same* simulated attempt) — this needs state that accumulates
*during* one kill and is read by a later roll in that same kill, which
nothing in this codebase does today (more on this under "deferred," since
it's the same capability CoX's gap #3 needs). **Recommendation: ship
everything else via Extension A, and approximate the dedup** — roll each
wave's armour piece independently (with replacement) rather than tracking
run-scoped ownership, flagged in the boss doc as a known, small overstatement
of duplicate pieces (2 items, ≤9 waves — bounded, not a wild guess). This is
the same category of accepted approximation as the chaos/nature talisman
50/50 split already in the codebase.

### The Reward Cart wrinkle

Wintertodt's 7-tier ordered chain is already a `preroll` table verbatim — no
change needed for the *chain itself*, same as Duke Sucellus's chain. The gap
is running it `rolls(points)` times per kill, and `preroll` is schema-pinned
to `rolls: 1` specifically because a repeated preroll's suppression is
ill-defined at the *document* level (a hit on repeat 2 — does it suppress
sibling tables the same way a hit on repeat 1 would?). Reward Cart's own doc
notes each of the `rolls(points)` searches is fully self-contained (chain-hit
vs. material-table fallback resolves *within* one search). The clean fix
isn't lifting the `rolls: 1` pin — that reopens the ill-defined
repeat-suppression question for every other `preroll` table too. It's
packaging "chain, then fallback" as its own two-table local unit (reusing
the "a nested table's chain is local" rule Phase 1 already established for
`tableRef`/`oneOf`) that gets rolled `rolls(points)` times as a whole,
independently each time. `oneOf`'s current one-level-deep, leaf-only
restriction was deliberately left narrow in Phase 1 pending exactly this kind
of need ("If Phase 3 needs deeper inline nesting, swap in a `z.lazy` schema
and accept the one annotation" — see DECISIONS.md). I'd recommend that here:
a new node kind wrapping a small local `Table[]`, referenced the way
`tableRef` is today, rolled `rolls(points)` times by an outer `independent`
wrapper. This is a slightly bigger schema change than the rest of Extension
A (the anticipated `z.lazy` escape hatch) and is worth flagging as its own
sub-decision rather than assuming it falls out for free.

### Formula registry growth

PROJECT_PLAN.md 4.6 gates the formula list ("do not add more without
justification"). This proposal needs at least: `zalcano_points`,
`doom_of_mokhaiotl_uniques`/`_qty`, `fortis_colosseum_uniques`/`_qty`,
`tzhaar_fight_cave_tokkul` (fully specified, no UNKNOWNs), `duke_sucellus`
(ice quartz curve only — frozen tablet's curve is UNKNOWN per the wiki
itself, not implementable regardless of schema). `inferno_tokkul` and ToB's
death-penalty magnitude are blocked on UNKNOWN wiki data, not on the model —
flagging so they aren't miscounted as schema gaps. Each is a real,
individually wiki-cited curve with no existing id fitting its shape (per
each boss doc's own Formulas section) — I'd treat that as the justification
the plan asks for, but it's explicitly a call for whoever owns that gate, not
decided here.

---

## Extension B: owned/received-before state

Covers: Duke Sucellus (ice quartz reversion, frozen tablet cutoff), ToA
(thread of Elidinis / jewel reversion), Lunar Chest (per-set duplicate
protection), Reward Cart (gloves/torch substitution after 3 owned).

### The cheap half

A new `SimContext` field and a new `Condition` kind, same cost class as
Extension A:

```ts
// SimContext
ownedCounts: z.record(z.string(), z.number().int().nonnegative()).default({})

// Condition
{ kind: 'ownedCountAtLeast', itemKey: z.string().min(1), n: z.number().int().nonnegative() }
```

One condition kind covers both "ever received" (`n: 1`) and Reward Cart's
"3rd+" threshold (`n: 3`) — no need for a separate boolean-ownership kind.
This alone is enough for Duke Sucellus's and ToA's reversions: two mutually
exclusive entries (formula-rate curve, gated `ownedCountAtLeast(key, 0)`... —
more precisely, gated on the *negation*, which needs either a `value:
boolean`-style flag on this condition the way `members`/`ringOfWealth`
already have one, or two entries reading `< n` and `>= n` via
`killCountAtLeast`-style asymmetric conditions. Minor design detail, not a
new capability.

### The part that needs real verification, not just addition

Lunar Chest needs more than a condition gating a *rate* — it needs the
*pool* a `withoutReplacement` weighted roll draws from to exclude
already-owned pieces going in, so a player who owns 2 of 4 Eclipse pieces
gets a uniform 1-of-2 roll over what's left, not a 50%-chance-of-nothing.

The obvious mechanism is generalizing the rule `compile.ts` already has for
Ring of Wealth (a condition-excluded entry subtracts its own weight from the
effective denominator, currently scoped to `entry.node.kind === 'nothing'`
only — see the comment at `compile.ts:194-207`) to *any* excluded entry,
regardless of node kind.

**I checked this against the real data, and the naive version of this
generalization breaks Brutus.** Brutus's own weighted table
(`data/bosses/brutus.json`, table `brutus:2:...`) has 17 entries: 11
unconditioned (weight 56 total), 3 gated `members: true` (weight 25), 3
gated `members: false` (weight 25), against a static `denominator: 81`. Under
either variant, the applicable weights already sum to exactly 81 with **no
shortfall** — that's the whole point of the Phase 2 membership-split fix.
If "any excluded entry shrinks the denominator" applied here, computing the
F2P variant would exclude the three `members: true` entries (weight 25) and
subtract it from 81, leaving `denominator: 56` — but the F2P-applicable
entries *already* sum to 81 on their own, so `81 > 56` throws
`WeightsExceedDenominatorError`. Brutus is currently `verified` (tier B,
1/1). A blind generalization would break it.

**The safe version scopes the new rule to entries excluded specifically by
the new `ownedCountAtLeast` condition**, not to condition-exclusion in
general. Brutus's exclusions are `members`-conditioned and would be
completely untouched; Lunar Chest's per-piece exclusions are
`ownedCountAtLeast`-conditioned and get the shrink. This is a small, targeted
change (one more clause in `compile.ts`'s existing loop, checking the
condition kind alongside the node kind) rather than a scope-widening of the
existing rule — but it's the one place in this whole proposal where getting
the scope wrong silently breaks something already shipped, so I'd want this
specific piece to ship with a regression test asserting Brutus's two variants
still each sum to exactly 81 after the change, not just a new-behavior test
for Lunar Chest.

`expected-value.ts`'s analytic path already enumerates draw orders for
`withoutReplacement` (capped at 4 rolls, per the Phase 1 decision log) — a
static, per-run "which pieces are already owned" input shrinks the
enumeration space rather than growing it, so this shouldn't need the cap
raised.

---

## Deferred: within-kill dynamic state (Fortis Colosseum's dedup only — CoX #3 is resolved above)

**Correction from the original draft of this proposal**: I originally filed
CoX's `elite-clue`/`Olmlet` gating here too, reasoning it needed "did this
table, earlier in this same kill, already hit" — a fact `Condition`s can't
read, since they're pure functions of a `SimContext` fixed for the whole run,
resolved once at compile time (`compile.ts`'s header comment: "Conditions are
resolved once here because `SimContext` is fixed for the duration of a
run"). Quantifying the actual cost (see above) showed that's the wrong frame
for CoX specifically: because `ctx.points` is itself static per run, the
*marginal* per-item rate never needs the same-kill correlation at all — a
plain formula-`Rate` using the conditioned marginal is exact on every
aggregate statistic. So CoX #3 moves out of this section entirely; it's
Extension A work (a formula, not a new condition kind), with only a
documentation-level caveat about the kill log.

**Fortis Colosseum's armour-piece dedup is the one case left that
genuinely needs this.** Unlike CoX's points (fixed per run, no correlation
needed), "which pieces has this run already given out" is a fact that's
*absent* if `ctx.points`-style scalars are the only per-run state — it
literally doesn't exist until wave 4's roll happens, and wave 8's roll needs
to read wave 4's *simulated outcome*, not a static input. That's the real
within-kill dynamic state gap: making a condition readable mid-kill means
either compiling conditions lazily against per-kill mutable state (touches
`simulate.ts`'s hot loop, and the 10M-kills-in-seconds bar means that's not
free) or computing it analytically via total-probability decomposition in
`expected-value.ts` (doable in principle — the state space here is small and
bounded, 2 items × ≤9 relevant waves — but real, new engine work, not a
schema field).

Given this now benefits exactly one source's one sub-mechanic (down from
two), I'd recommend **not building it**, and shipping Fortis Colosseum's
dedup as the flagged with-replacement approximation already proposed above,
with the same kind of documented, bounded-error caveat CoX's kill-log
artifact gets — quantifying its actual size (rather than just asserting
"small") is worth doing at implementation time the same way CoX's was here,
not before.

CoX's suppression gap (#2 — a hit anywhere in its 6-independent-unique-roll
table suppresses the later common table) is unaffected by the correction
above and stays cheap: a `suppressesFollowing: boolean` flag on
`independent`-mode tables, mechanically parallel to the existing
`suppressedByPreroll` rule, generic rather than CoX-specific, low risk. I'd
build that one regardless of whether CoX's boss doc itself ships this round.

Corporeal Beast: agree fully with the brief. `TableRefNode.drawsPerHit?:
number` (default 1) — when the entry's own rate hits, evaluate the
referenced table that many times, no additional gating. Same cost class as
`qtyMultiplier`, arguably simpler since it doesn't need to compose across
nesting. Zero interaction with anything else; genuinely a two-line schema
addition plus a `simulate.ts`/`expected-value.ts` loop-count change scoped
to `tableRef` nodes carrying it.

---

## Blast radius summary

**Zero behavioral change to any of the 36 verified sources**, provided:
- every new `SimContext` field ships with a default matching current
  behavior (no source references the new fields, so they're inert regardless
  of default value, but `DEFAULT_SIM_CONTEXT` needs updating once, centrally);
- the weighted-denominator-shrink generalization is scoped to the new
  `ownedCountAtLeast` condition specifically, **not** widened to "any
  excluded entry" (see the verified Brutus finding above — this is the one
  place a careless implementation regresses something already shipped);
- `qtyMultiplier`/`drawsPerHit`/the new `QtySpec`/`rolls` union arms are all
  optional/additive, and none of the 36 verified sources' `tableRef` usages
  (17 of them reach `rare_drop_table`/`gem_drop_table` via tier C) set them.

**Files touched, by change:**

| Change | Files |
|---|---|
| New `SimContext` fields | `packages/loot-model/src/schema.ts` (schema + `DEFAULT_SIM_CONTEXT`), 15 literal-construction sites across `packages/loot-model/test/*`, `apps/web/src/lib/url-state.ts` (+test), `apps/ingest/test/*`, `apps/ingest/src/validate/weights-sum.ts` |
| New `Condition` kinds | `schema.ts`, `conditions.ts`'s `entryApplies` switch |
| `QtySpec` formula variant | `schema.ts`, `compile.ts`'s `compileNode` (item case) — no `simulate.ts`/`expected-value.ts` change |
| `rolls` formula-count variant | `schema.ts`, `compile.ts`'s `compileRolls` — no `simulate.ts` change |
| `qtyMultiplier` | `schema.ts` (`Table` + `TableRefNode`), `compile.ts` (thread through `CompiledTable`/`CompiledNode`), `simulate.ts`'s `emit`/`runTable` (new parameter, applied at the `item` leaf), `expected-value.ts`'s equivalent walk |
| `drawsPerHit` | `schema.ts` (`TableRefNode`), `simulate.ts`/`expected-value.ts` loop count at `tableRef` nodes |
| Owned-state denominator shrink | `compile.ts`'s `compileTable` weighted branch (scoped, see above), plus a Brutus regression test |
| `suppressesFollowing` flag | `schema.ts` (`Table`), `compile.ts`/`simulate.ts` alongside `suppressedByPreroll` |
| `formulas.ts` contract split | `evaluateFormula` → `evaluateRate`/`evaluateQuantity`/`evaluateMultiplier`, all call sites in `compile.ts` |
| New formula ids | `schema.ts`'s `FORMULA_IDS`, `formulas.ts`'s stub registration, real implementations land wherever `apps/ingest`'s Phase 5 formula work lands |
| UI wiring (once schema work exists) | `apps/web/src/components/SimContextControls.tsx`, `BossView.tsx`, `useSimulationWorker.ts`, `simulate.worker.ts`, `url-state.ts` — new toggles/fields for whichever `SimContext` fields ship |

**Not touched:** `packages/loot-model`'s zero-runtime-deps-besides-zod
constraint, the `apps/*`-can't-be-imported-by-`loot-model` boundary, licensing,
`.gitignore`, CI structure. Nothing here requires re-fetching the wiki —
every number cited in the boss docs already came from a fresh, cited fetch
this batch of research did.

## Sequencing recommendation

Not asked for, but worth stating since it falls out of the analysis: build
Extension A first (it's additive, low-risk, and unblocks the most sources —
Doom of Mokhaiotl needs zero further work once it lands). Extension B second,
with the scoped-not-generalized denominator rule and its Brutus regression
test as a hard requirement, not a nice-to-have. Corporeal Beast's
`drawsPerHit` and the `suppressesFollowing` flag can land alongside either,
they're independent — CoX's actual boss doc/override can then be built using
Extension A's formulas (points, `cox_points`, the corrected marginal rates)
plus the `suppressesFollowing` flag, with no dynamic-state work at all.
Fortis Colosseum's dedup stays a flagged with-replacement approximation until
(if ever) a second source actually needs within-kill dynamic state — building
it for one sub-mechanic of one source risks guessing the shape of a
capability this codebase has zero other evidence for yet, the same trap the
project already avoided once with the wave-machinery "population of one"
question.

## Confirmed to implement, in order

1. ~~**Extension A** — per-run scalars, quantity-scaling, `rolls`-as-integer.
   Re-verify all 36 currently-verified sources before moving on.~~ **Done —
   see "Step 1" above.**
2. ~~**Extension B** — owned/received-before state, scoped narrowly to the
   new ownership mechanism. Brutus's two variants each still summing to
   exactly 81 is the regression gate.~~ **Done — see "Step 2" above.** (Shipped
   as `Entry.ownershipGate`, a field rather than a `Condition` kind — see that
   section for why; Brutus's regression gate held throughout, run first each
   time, not batched to the end.)
3. **CoX suppression + Corporeal Beast**, as narrow overrides/schema fields,
   not general mechanisms. Not started — next.

Stopping after step 1 and reporting before proceeding, per instruction.

## Step 1 (Extension A) — done, results

Implemented in `packages/loot-model/src/{schema,formulas,conditions,compile,
simulate,expected-value}.ts`, plus fallout in `apps/web` (`format.ts`'s
`formatQty`, `DropTableView.tsx`'s `conditionLabel`, `url-state.ts`'s
`SimContext` literal) and a real `apps/ingest/src/validate/qty-sane.ts`
replacing `qty_sane`'s hardcoded `true` — the project's own trip-wire test
(`qty-sane-constant.test.ts`) fired exactly as designed the moment `QtySpec`
gained its `formula` variant, the same way `rates_valid`'s did for `Rate`
previously. Full detail on that audit is in the check's own file; it's the
same shape of gap `rates_valid` already covers, now covering `QtySpec`,
`Table.rolls`'s formula-count case, and both `qtyMultiplier` sites.

- `pnpm -r typecheck && pnpm -r test && pnpm lint`: clean (301 tests: 108
  `packages/loot-model`, 172 `apps/ingest`, 21 `apps/web`; 0 lint errors).
- `ingest parse --tier A,B,C` (53 sources): **36 verified / 14 needs_review /
  3 parse_failed — unchanged.** The only diff across all 53 regenerated
  `data/bosses/*.json` files is `qty_sane`'s advisory detail string (now a
  real, computed message instead of the old hardcoded one); every `status`
  and every other check's `ok`/`detail` is byte-identical. Confirms the
  "zero behavioral change to the 36 verified sources" claim above by direct
  measurement, not just by additive-schema reasoning.
- Benchmark: see the hot-path section above — 1M/10M kills regressed ~35%
  on first pass, found and fixed (the anticipated `qtyMultiplier===1`
  special-case), down to +3.4%/+3.5%, `gpPerKill` unchanged throughout.

Not done, and deliberately out of scope for step (a): actual UI controls for
the new `SimContext` fields (11 fields, no toggles/URL params yet — inert
until a boss doc uses them), and any boss doc/override for the 17
non-verified sources. Extension A makes those buildable; it doesn't build
them. Ready for review before step 2 (Extension B).

## Step 2 (Extension B) — done, results

### Which sources need which kind of ownership state

Asked for explicitly, before implementation: all four Extension B sources
(Duke Sucellus, ToA, Lunar Chest, Reward Cart) need the **same** kind —
**lifetime-scoped**, monotonically-growing counts that start from a value
entering the simulated batch and persist (never reset) for its whole
duration, however long. None of them are **run-scoped** the way Fortis
Colosseum's wave-to-wave armour dedup would be (state that resets at the
start of each new attempt, not just monotonically grows) — that stays
excluded, unbuilt, exactly as scoped in the original proposal. This mattered
architecturally, not just terminologically: it's *why* `expectedValue`
(single-kill, `ctx` fixed) needs nothing beyond a static condition check
against the entering `ownedCounts`, while `simulate` (many kills) needs a
live, mutating tracker — a run-scoped mechanic would have needed the tracker
to *reset* mid-batch too, which none of these four ever do.

### Design change from the original proposal

The proposal sketched `ownedCountAtLeast` as a `Condition` kind. Implemented
it as a **separate field, `Entry.ownershipGate`, deliberately not a
`Condition`.** Every existing `Condition` is resolved exactly once against a
`SimContext` fixed for the whole run (`compile.ts`'s own header comment says
so) — `expectedValue` depends on that being true. `ownershipGate` cannot
honor it for `simulate`: whether an entry currently applies is itself an
outcome of *earlier kills in the same run*. Folding it into `Condition`
would have been a lie about the six existing kinds' shared contract, or
forced all of them to pay for per-kill re-evaluation they don't need. Given
that, `compileTable`'s static `entryApplies` filter never looks at
`ownershipGate` at all — an ownership-gated entry always survives compile-time
filtering, kept in the compiled form and resolved dynamically by whichever
consumer needs it, at the cadence each one needs it (once for `expectedValue`,
per kill for `simulate`).

### The Brutus finding, made concrete

The proposal flagged, without proof, that a *naive* generalization of the
`nothing`-kind denominator-shrink rule would break Brutus. Implementing this
properly kept that rule **completely untouched** — `compileTable`'s existing
`nothing`-exclusion code is unmodified, byte-for-byte. Ownership's
denominator adjustment (`effectiveWeightedPool`, `compile.ts`) is a wholly
separate function, called by `simulate`/`expectedValue` only for tables whose
`ownershipGates !== null`, which is never true for Brutus. Brutus's own test
suite was run **first**, immediately after each of the three source files
changed (`compile.ts`, then `simulate.ts`, then `expected-value.ts`), not
batched to the end — per instruction — and passed at every step.

### Verification

- `pnpm -r typecheck && pnpm -r test && pnpm lint`: clean. 312 tests (119
  `packages/loot-model` — 108 pre-existing + 11 new in `ownership.test.ts`,
  172 `apps/ingest`, 21 `apps/web`); 0 lint errors.
- `ingest parse --tier A,B,C` (53 sources): **36 verified / 14 needs_review /
  3 parse_failed — unchanged**, and this time the regenerated
  `data/bosses/*.json` diff against the post-Extension-A state is **empty**
  (not even the `qty_sane` string changed again) — none of the 36 use
  `ownershipGate`, so nothing about their compiled or reported output moved.
- New tests (`packages/loot-model/test/ownership.test.ts`, 11 cases) cover
  both shapes for both `simulate` (statistical: observed rate matches the
  below/atLeast split within a tight band over 100k kills) and
  `expectedValue` (exact: single-kill expectation reads the entering
  `ownedCounts` with no sampling noise to allow for), plus the all-owned edge
  case (a fully-drained weighted pool contributes exactly 0, not `NaN`) for
  both.
- **Seeded-RNG determinism**, the guardrail asked to be proven rather than
  argued: two dedicated tests. One runs both shapes twice at the same seed
  over 20,000 kills and asserts `drops`/`gpTotal`/`log` are byte-identical,
  then asserts a different seed's *kill log* (not final aggregate — see the
  test's own comment for why the aggregate alone doesn't distinguish seeds
  here) diverges. The other runs a boss with **zero** ownership gates twice
  at the same seed, specifically to catch a tracker wired in a way that
  consumes RNG draws it shouldn't — it doesn't; output is identical. The
  mechanism this rests on: ownership only ever mutates in response to an
  emission the seeded RNG stream already decided, never as an independent
  random source, so the mutation is exactly as deterministic as the stream
  it's derived from.

### Benchmark — the real, measured cost, and where it stopped

Cross-kill state was flagged as the bigger hot-path risk than
`qtyMultiplier`, and it was: threading a live `OwnershipTracker` through
`emit`/`runTable`/`runWeightedWithoutReplacement` cost more than `qtyMultiplier`'s
threading did, even for Brutus, which uses none of it.

| Stage | 1M kills | 10M kills |
|---|---|---|
| Extension A, optimized (prior baseline) | ~148ms | ~1,496ms |
| Extension B, first working version | ~181ms (+22%) | ~1,806ms (+21%) |
| + removed a per-roll allocation (`effectiveWeightedPool`'s closure + wrapper object were being constructed even on the no-gates fast path) | ~173ms (+17%) | ~1,709ms (+14%) |
| + hoisted the per-entry gate check out of `always`/`independent`/`preroll`'s loops (mirrors `qtyMultiplier`'s `=== 1` fast path) | ~165ms (+11%) | ~1,890ms (+26%) |

The third row's 10M figure moving the *wrong* direction relative to its own
1M figure is real in the data but not trusted as a real regression from that
specific change — repeat trials on this machine drift by a similar margin
run-to-run (measurement noise on a shared dev machine, not a controlled
benchmark environment; a clean git-stash A/B was not practical since
Extension A was never committed separately from Extension B). What's solid
across every trial: **10M kills lands at 1.87–1.94s, comfortably under
PROJECT_PLAN.md 8's "couple of seconds," but with much less headroom than
Extension A alone left.** Reading "a couple of seconds" plainly as ~2.0s (the
same reference point used above, where the naive first pass "would have used
up most of the headroom"): Extension A's own optimized baseline (1,496ms)
left **~504ms (~0.5s) of headroom**; the current, post-Extension-B figure
(1,870–1,940ms) leaves **~60–130ms (~0.1s)** — roughly a quarter of what
Extension A alone left, not the same order of magnitude. (An earlier draft
of this section mis-stated the baseline's headroom as "~1.4s," which was the
pre-Extension-A *absolute* 10M time, 1,446ms, miscopied into the wrong
column — corrected here.)

**Stopped here rather than chasing further**, for a specific reason: the
next available lever is a *fully duplicated* `emit`/`runTable`/
`runWeightedWithoutReplacement` pair — one identical to pre-Extension-B code
(zero added parameters, zero tracker references), selected by `simulate()`
once via `compiled.trackedItemKeys.size === 0`, guaranteeing byte-identical
performance for every source that doesn't use Extension B. That would very
likely close the remaining gap, but it means maintaining two copies of the
simulator's core recursive walk — a real, ongoing maintenance cost this
codebase doesn't currently pay anywhere else, for a feature four sources
will ever use. Given the budget is still met, this felt like a call for
someone to make deliberately rather than one to make silently while chasing
a benchmark number — flagging it here rather than building it.

A synthetic ownership-active boss (the rate-swap fixture) simulated at ~71ms/1M,
~700ms/10M — faster than Brutus in absolute terms, but that's a smaller,
simpler boss doc (one table, two entries) racing a larger one (Brutus's
four), not evidence that using the feature is cheaper than not using it; not
a comparable number, included for completeness rather than as a claim.
