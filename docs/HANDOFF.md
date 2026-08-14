# Handoff — osrs-loot-simulator

Written for a fresh Claude session with zero prior context. Read `PROJECT_PLAN.md`
first — **but see landmine #0 below: it is not at the repo root right now.**
`docs/DECISIONS.md` is the append-only log of every judgement call made against
that spec; `docs/mechanics-model-proposal.md` is the design proposal for the
model/simulator work described below (read it before touching `packages/
loot-model` — it has the reasoning this file only summarizes); this file is the
map of where things stand, not a replacement for any of the three. All three are
long; skim headings before assuming something hasn't been tried.

The user handles all git operations. Don't run git commands that mutate state
(commits, pushes) without being asked; read-only commands (`git status`, `git
diff`, `git log`) are fine and encouraged before trusting this file's claims.

---

## 1. Current state

**Phases 0–4 are done and stable** (schema, conditions, formulas, RNG,
simulator, analytic EV; the ingest pipeline; the frontend) — unchanged from
prior sessions, not re-verified line-by-line this session but nothing in this
session's work touched their done-when criteria.

**"Phase 5"/Phase 7 (PROJECT_PLAN.md section 16: overrides + hard bosses) is
substantively underway, not done** — its own done-when is "zero
`needs_review`," and 13 non-verified sources remain. What IS done within its
scope:

- **Phase 6 research, complete**: 14 non-verified/unmodelled sources each got
  a deep-dive research doc — `docs/bosses/{abyssal-sire,ancient-chest,chest-
  tombs-of-amascut,corporeal-beast,doom-of-mokhaiotl,duke-sucellus,inferno,
  lunar-chest,monumental-chest,reward-cart,reward-pool,rewards-chest-fortis-
  colosseum,tzhaar-fight-cave,zalcano}.md`. Each documents the real mechanic
  in prose, the formula(s) it needs (fully cited where the wiki states them,
  flagged UNKNOWN where it doesn't), a proposed mapping onto the loot model,
  and precisely what schema/engine capability is missing. This was done
  *before* the current session and is the input the rest of this section
  responds to.
- **Extensions A and B, implemented** (this session, in
  `packages/loot-model/src/{schema,formulas,conditions,compile,simulate,
  expected-value}.ts`) — see sections 2–4 below for what they are and how
  they were verified. Neither builds an actual boss doc for any of the 14
  researched sources; they make the 14 *buildable*.
- **`data/overrides/` EXISTS and is in use** — loader, merge semantics,
  `docs/OVERRIDES.md`, and two live overrides. See section 3.
- **Five formulas are really implemented** (`doom_of_mokhaiotl_deep_rolls`,
  `lunar_chest_standard_rolls`, and Zalcano's `zalcano_crystal_shards` /
  `zalcano_mvp_share` / `zalcano_mvp_only`); every other `FORMULA_IDS` entry is still
  `stubFormula(...)` — registered, not implemented.
  `IMPLEMENTED_FORMULA_IDS` is exported from `formulas.ts` and is what
  `formulas.test.ts`'s trip wire pins. **That wire has now fired three times** —
  expect it to fire again and update the pinned list rather than deleting the
  guard. `FORMULA_CONTEXT_FIELDS` (same file) must also gain an entry for any
  new id: it declares which `SimContext` fields a formula reads, is what lets
  the UI discover a control the boss document cannot reveal, and is verified
  behaviourally by `formulas.test.ts`.

```
53 parsed at tier A+B+C: 38 verified, 2 manual_override, 10 needs_review, 3 parse_failed
  (was 36/14/3 before Phase 7 started. Abyssal Sire + Corporeal Beast reached
   `verified` via parser fixes; Doom of Mokhaiotl + Lunar Chest reached
   `manual_override` via data/overrides/.)
```

**Read this before `docs/bosses/*.md`: all 14 carry an in-file banner
correcting their stale capability verdicts.** Their *mechanics and cited
numbers are accurate and are what to implement from*; their "what doesn't
exist" sections predate Extensions A/B and are wrong in places (most sharply
`doom-of-mokhaiotl.md`, whose central "needs wave machinery" verdict is
false). One banner — `lunar-chest.md`'s — was itself written wrong this
session and then corrected; the lesson is recorded there and worth absorbing:
**having a `SimContext` field is not the same as being able to gate an entry
on it.**

**Step (c) is DONE** (`Table.suppressesFollowing`, `TableRefNode.drawsPerHit`),
plus `qtyRounding`, `Condition.includes`, `data/overrides/`, and
`SimContext.totalDamage` (derived). **Phase 7 has shipped 5 of the 14
researched sources**: Abyssal Sire and Corporeal Beast (parser fixes,
`verified`), Doom of Mokhaiotl and Lunar Chest (overrides, `manual_override`),
and Zalcano (override, still `needs_review` — two curves the wiki never states
keep it watchlisted; see section 3). See section 3 for what is next.

`ev_matches` is **closed, permanently** — see "What NOT to redo," section 5.

**Changed this session (Playwright + checks audit + benchmark + `levelAtLeast`):**

- **`apps/web` has a real-browser test suite now.** 17 Playwright tests in
  `apps/web/e2e/`, run by `pnpm --filter web test:e2e`, against the
  **production** build served under `/osrs-loot-simulator/` through a GitHub
  Pages mimic. Deliberately not in `pnpm -r test` (needs a browser binary and a
  build); `ci.yml` runs it as a separate `e2e` job. It found two real production
  bugs on its first run — see section 6, landmine #10.
- **`Condition.killCountAtLeast` no longer exists.** Retired into
  `levelAtLeast`'s new `killCount` field; it had zero uses in `data/`.
  `levelAtLeast` gained an optional inclusive `atMost` (two-sided brackets) and
  the fields `fishingLevel` and `killCount`.
- **`refs_resolve` was vacuous for Lunar Chest and is fixed** — section 6,
  landmine #11.
- **`SiteIndexSchema` gained `tables: string[]`**, the manifest the browser
  fetches `data/tables/` by. `data/index.json` regenerated (it was stale).
- **`simulate.ts`'s hot loops were restructured** on measured evidence; see
  section 4, and do not "tidy" the inlined gate checks back into a helper.

**Also changed (second round of the same session):**

- **Reward pool is SHIPPED** (`data/overrides/reward-pool.json` +
  `data/tables/reward_pool_fish.json`, 12 wiki-figure tests), modelled **per
  reward permit** rather than per encounter. Still `needs_review` and still
  watchlisted, correctly — see section 7.
- **An authored override now forces its source to be parsed regardless of the
  tier filter.** This is what had silently prevented Reward pool from ever
  being built; see landmine #12.
- **`items_known` was the fourth scope-permissive guard**, found and fixed, and
  the mutation shape that found it is now a reusable harness — see landmine #11.
- **The benchmark bar is 1M**, adopted; the duplicated-`emit` lever is closed.

Corpus tally: **54 parsed — 38 verified / 2 manual_override / 11 needs_review /
3 parse_failed** (up one source and one `needs_review`, both Reward pool).

---

## 2. Extensions A and B — what they are, why they're shaped this way

Full design reasoning, the four framing claims and where the brief's original
framing was wrong (twice — see the CoX correction in section 5), and the
per-extension blast-radius/benchmark detail all live in
`docs/mechanics-model-proposal.md`. This section is the short version for
someone who needs to *use* what's there, not re-derive it.

### Extension A — per-run scalars, quantity-scaling, `rolls`-as-integer

`SimContext` gained 11 static fields (`points`, `raidLevel`, `deaths`,
`perfectKill`, `isMVP`, `delveLevel`, `wavesReached`, `moonsKilled`,
`fishingLevel`, `hitpointsDamage`, `shieldDamage`) — all resolved once at
compile time, same discipline as the original six. `QtySpec` and
`Table.rolls` gained formula-driven variants (also compile-time-resolved,
zero per-kill cost). `Table` and `TableRefNode` gained `qtyMultiplier`. One
new `Condition` kind, `levelAtLeast` (delve/wave gating; its enum has since
widened to `shieldDamage`/`totalDamage` for Zalcano). **All of this is now
wired into the UI** — `apps/web/src/lib/context-fields.ts` derives each boss's
control set from its own document plus `FORMULA_CONTEXT_FIELDS`, and every
field round-trips through the URL. A hand-built `ctx` passed straight to
`simulate`/`expectedValue` still works and now also gets derived fields
resolved, since `compileBoss` applies `withDerivedContext`.

### Extension B — owned/received-before state

Covers Duke Sucellus (ice quartz/frozen tablet), ToA (thread of Elidinis/
jewels), Lunar Chest (per-set duplicate protection), Reward Cart (3rd+-owned
substitution). All four are confirmed **lifetime-scoped** — counts that only
grow, persist for the whole simulated batch (and beyond), never reset
mid-batch. None are **run-scoped** the way Fortis Colosseum's wave-to-wave
armour dedup would be (state that resets each attempt) — that one stays
unbuilt and out of scope, see section 3.

**Design: `Entry.ownershipGate`, not a `Condition` kind — this is the one
thing worth understanding before touching it again.** Every `Condition`
(`members`, `ringOfWealth`, `levelAtLeast`, `includes`, etc.)
is resolved exactly once, against a `SimContext` fixed for the whole run —
stated explicitly in `compile.ts`'s header comment, and `expectedValue`
*depends* on that being literally true (it computes one kill's expectation
from a static `ctx`, with no notion of "later in the run"). Ownership cannot
honor that contract for `simulate`: whether Reward Cart's 3rd-warm-gloves
substitution is active is itself the outcome of *earlier kills in the same
run*. Folding `ownershipGate` into `Condition` would have meant either lying
about the shared "resolved once" contract the other six kinds rely on, or
making all of them pay for per-kill re-evaluation they don't need. So it's a
separate field, checked by each consumer at the cadence it actually needs:
`compileTable`'s static filter never looks at it (an ownership-gated entry
always survives compile-time filtering, unlike a `conditions`-excluded one),
`expectedValue` checks it once against the entering `ctx.ownedCounts`,
`simulate` checks it per kill against a live `OwnershipTracker` that starts
from `ctx.ownedCounts` and mutates only in response to the same seeded RNG
stream's own decisions — never a second source of randomness.

If you see a request that looks like "gate this entry on some fact," ask
first whether that fact is knowable from `SimContext` alone at the start of
the run (→ ordinary `Condition`) or depends on what's happened earlier in
*this specific simulated run* (→ needs the `ownershipGate`-style treatment,
or is out of scope — see Fortis Colosseum/CoX-suppression in section 3).

---

## 3. What's left

### Step (c) — DONE

`Table.suppressesFollowing` and `TableRefNode.drawsPerHit` both shipped, both
`.optional()` so the generated corpus stayed byte-identical. Details, including
why the flag is read on a hit rather than hoisted, are in `docs/DECISIONS.md`.

### Phase 7 — 4 of 14 shipped, 10 to go

**Shipped**: Abyssal Sire, Corporeal Beast (parser fixes in
`apps/ingest/src/parse/rdt-access.ts` — preferred over overrides, and the
reason `docs/OVERRIDES.md` says to establish the parser genuinely cannot reach
a source first); Doom of Mokhaiotl, Lunar Chest (`data/overrides/`).

Each shipped source has a wiki-figure verification test that runs against the
**real generated documents**, not fixtures — `apps/ingest/test/{rdt-access-
mechanics,doom-of-mokhaiotl,lunar-chest}.test.ts`. That is the mechanics-
watchlist removal policy's step 3, and it is not optional: it is what stops a
plausible-looking-but-wrong model from shipping. Two of them were only
possible because the wiki states a worked example (Doom's dragon platelegs) or
disclaims a wrong reading (Lunar Chest's "not 3/56") — look for those first.

**Zalcano: SHIPPED** (`data/overrides/zalcano.json`, 12 tests in
`apps/ingest/test/zalcano.test.ts`). All three capabilities it was blocked on
were resolved without a new condition shape:

1. `isMVP` needed no boolean-field condition — infernal ashes is a
   `formula`-kind `Rate` returning 1 or 0, and the MVP's +10% is a
   `formula`-kind `qtyMultiplier`.
2. `shieldDamage >= 5` — `levelAtLeast`'s enum widened.
3. The combined `hitpointsDamage + shieldDamage >= 31` threshold — resolved by
   **`SimContext.totalDamage`, a derived field** computed by
   `withDerivedContext` at run setup, so `levelAtLeast` reads it as a plain
   `ctx[field] >= n`. The alternative (a formula-valued condition) would have
   made conditions arbitrary code and broken the resolved-once invariant
   `expectedValue` depends on — the same invariant protected twice before.
   Derived fields are overwritten, never merged, so they cannot drift from
   their inputs; `compileBoss` applies the derivation, so a hand-built `ctx`
   passed straight to `simulate`/`expectedValue` is covered too.

**It is still `needs_review`, and that is correct.** Two curves the page states
exist and never states keep it watchlisted: the points→loot scaling function
(`P_M`/`P_T` are defined exactly; what consumes them is not on the page, so
`zalcano_points` stays a stub), and the Zalcano shard's "Between 1/750 and
1/1500 depending on contribution" with no interpolation given. Same treatment as
Duke Sucellus's frozen-tablet curve. **Do not remove the watchlist entry to move
the counter.**

The Smolcano pet contradiction this file previously said to carry forward is
**resolved by the page itself**, not by picking a side: the `===Tertiary===`
prose says "The chance of rolling Smolcano is unaffected by performance," which
agrees with the 21 May 2020 news post and dates the Mod Lenny tweet's example to
before the change. `docs/bosses/zalcano.md` never quoted that sentence.

**Cheapest remaining**, on current evidence: TzHaar Fight Cave
(fully unblocked at model level, but resolves no boss in the inventory, so it
moves no counter), then Duke Sucellus (needs `duke_sucellus_ice_quartz`; its
frozen-tablet curve is UNKNOWN per the wiki itself and is not implementable at
any schema level — do not guess it), then Reward pool (needs the two-sided
bracket described in the player-stat-gating entry), then Reward Cart (needs
the `z.lazy` local-table node Phase 1 anticipated). CoX's Ancient chest and
Fortis Colosseum both need `data/overrides/` — which now exists — plus real
formulas.

## 4. Benchmark state

Reference case throughout: the hand-authored Brutus fixture
(`packages/loot-model/test/fixtures/brutus.ts`), 1M and 10M simulated kills,
PROJECT_PLAN.md section 8's own bar ("10M kills should complete in a couple
of seconds").

| Stage | 1M kills | 10M kills |
|---|---|---|
| Pre-Extension-A baseline | ~143ms | ~1,446ms |
| Extension A, optimized | ~148ms | ~1,496ms |
| Extension B, current (after two rounds of measured optimization) | ~163–171ms | ~1,870–1,940ms |
| Step (c) + `qtyRounding` + `includes`, measured fresh (see caveat) | ~193ms | ~1,926ms |
| Zalcano session baseline, derivation reverted in place (A/B control) | ~220ms | ~2,108ms |
| Zalcano session, `withDerivedContext` in `compileBoss` | ~225–227ms | ~2,202–2,234ms |
| **Playwright session, before the loop fix (A/B control)** | ~224ms | ~2,204ms |
| **Playwright session, hoisted/inlined gate checks (current)** | **~208ms** | **~2,089ms** |
| *(reference ceiling: ALL ownership code stripped — not shipped)* | *~197ms* | *~1,893ms* |

**The 10M figure is now AT OR OVER the ~2.0s reading of the bar on this
machine, and it is not the derived-context change.** A controlled A/B in the
same sitting (the `withDerivedContext` line reverted in place, benchmarked, then
restored) put the baseline WITHOUT it at ~2,108ms — already over. The A-vs-B
delta of ~126ms sits inside this machine's own documented same-code spread (see
below), A' landed between A and B rather than tracking either, and the mechanism
agrees: `withDerivedContext` runs once per `compileBoss` call, not per kill, and
returns the *same object* for Brutus. This is the trigger the duplicated-`emit`
lever was nominated for — flagged with the measurement, not acted on, since the
previous session measured that lever as buying back far less than the gap.

Earlier state was **comfortably under the "couple of seconds" bar**, but with
much less headroom than Extension A alone left — reading "a couple of
seconds" as ~2.0s, Extension A's optimized baseline left ~500ms of headroom;
the current figure leaves roughly 60–130ms. This was measured, not assumed:
cross-kill ownership tracking cost more than `qtyMultiplier`'s threading did
(as anticipated before building it), the first working version regressed
~21–22%, and two rounds of targeted fixes (removing a per-roll allocation in
`effectiveWeightedPool`'s call site, hoisting the per-entry gate check out of
the `always`/`independent`/`preroll` loops) brought it down to the current
number — see `docs/mechanics-model-proposal.md`'s "Step 2 (Extension B)"
section for the full trial-by-trial numbers and why the middle measurement's
10M figure moved the "wrong" direction relative to its own 1M figure
(measurement noise on a shared dev machine, not a real regression — flagged,
not hidden).

**Read the absolute numbers with care — this machine drifts.** Across one
session the *same* code measured 1,973ms, 1,981ms, 1,852ms and 1,926ms at 10M.
A controlled A/B (hot-path lines reverted in place, benchmarked, restored)
put step (c)'s real cost at ~1%, and `qtyRounding` at nothing measurable
(`qtyMultiplier === 1` short-circuits before the mode is read). `gpPerKill` is
byte-identical (597.2676 / 598.4495) across every variant, which is the check
that actually matters. **Do not attribute a 5% move to your change without an
A/B in the same sitting.**

**THE BAR IS 1M NOW.** `test/bench.tmp.ts` defaults to `--kills 1000000`;
10M is a linearity spot-check you ask for explicitly. Scaling is dead linear
(10M/1M = 9.6–10.0 across every variant ever measured here) and 10M is not the
more precise measurement — relative round-to-round spread is comparable at both
sizes, because the noise is this machine's drift, not per-run variance. Current
figure at the bar: **~203ms**.

**The duplicated-`emit` lever is CLOSED, not deferred — do not re-nominate it on
performance grounds.** At 1M the current figure is ~203ms against a budget
nothing approaches (the frontend's own default run is 10,000 kills, ~2ms), so
its remaining ~9% buys a fraction of a number that does not matter, in exchange
for two permanent copies of the simulator's core recursive walk. The measurement
below is kept because it is what closed the question.

**The reason it was never the right lever anyway —** A controlled single-factor ablation
(interleaved across processes, three rounds) showed the framing behind it was
wrong: the `OwnershipTracker` object and the `owned` parameter threading cost
**≈ 0**. Removing every trace of ownership from the hot path buys ~15%, and
essentially all of it is two things inside the innermost loops — three
`if (gated && ...)` guards (8.8%) and three `let` bindings assigned in an
if/else instead of `const` ternaries (6.0%). Both were fixed **without**
duplicating the walk, recovering ~5–7%. The remaining ~9% to the ceiling is what
duplicating `emit`/`runTable` would buy, for two permanent copies of the
simulator's core recursion. Full table in `docs/DECISIONS.md`'s "Extension B's
real cost" entry.

Two rules that came out of that measurement and are easy to undo by accident:

1. **Hoist the TEST out of the loop, not the value it tests.** A hoisted `false`
   boolean tested inside the loop cost 8.8% on a boss that never took the
   branch.
2. **Do not tidy the inlined gate check back into a `gateAllows(...)` helper.**
   An intermediate version that kept the helper recovered only a third of what
   inlining did — an uninlinable call in the innermost loop costs even on runs
   where it never executes. The condition is written out three times on purpose.

**The 10M bar itself is now questioned, with data — see `docs/DECISIONS.md`'s
"Is 10M the right benchmark bar?" entry.** Short version: `DEFAULT_KILLS` is
10,000, scaling is dead linear (10M/1M = 9.6–10.0 across every variant), and 10M
is *not* the more precise measurement — relative round-to-round spread is
comparable at both sizes, so 10M costs 10× the wall-clock for no extra
precision. Recommendation (flagged, not applied, since PROJECT_PLAN.md 8 is spec
text): make 1M the routine regression bar, run 10M occasionally as a linearity
check.

`test/bench.tmp.ts` now takes `--label`/`--reps`/`--kills`, which is what lets an
external script interleave two builds and tag each line. **Interleave any future
A/B** — this machine's drift is larger than several of the effects above.

---

## 5. What NOT to redo

- **`ev_matches` is closed, permanently.** Three independent pricing
  methodologies were tried across sessions — `dropsline`'s own `Drop Value`
  field (High Alch, not a market price), strict live GE (313.70 vs. wiki's
  597.57 for Brutus members, 47.5% off), a GE+High-Alch hybrid (570.58,
  4.52% off, still outside ~2%). Stays advisory/non-blocking on every boss,
  forever. Do not try a fourth pricing theory without being asked.
- **The "Uniques" heading is not a valid signal for the 4 remaining
  ambiguous-heading sources** (Doom of Mokhaiotl, Monumental chest, The
  Nightmare, Zulrah). Most re-litigated question in the project's history;
  the answer has been "no available signal" every time it's been re-checked,
  including via a three-signal resolution pipeline that already brought this
  down from 24 sources to these 4. Leave flagged.
- **CoX's cross-table outcome visibility (elite clue / Olmlet gating) is
  resolved as Extension A work — do not re-open it as "needs new
  architecture" or "defer and approximate."** This was the proposal's own
  first draft position, corrected after actually quantifying it: because
  `ctx.points` is a static per-run scalar (never resampled kill to kill),
  the *marginal* per-item rate never needs same-kill correlation — a plain
  `formula`-kind `Rate` using the conditioned marginal (`P(no unique)×1/12`,
  `P(unique)×1/53`, both derivable from the same `cox_points` formula CoX's
  suppression gap already needs) is exact on every aggregate statistic the
  simulator reports. Naively using the raw, unconditioned subrates instead
  (dropping the gating condition without computing the conditional split)
  overstates Olmlet by **33×** — that's the failure mode to avoid when this
  actually gets built in Phase 7, not a reason to treat the whole mechanism
  as unbuildable. The one real residual is a small, quantified, documented
  kill-log artifact (elite clue and Olmlet can appear together in the same
  logged kill, ~4.6% chance across a 1,000-kill log at average points,
  impossible in-game, invisible in aggregate rates) — that needs a FE note
  on CoX's eventual boss doc, not an engine feature.
- **Don't re-derive the item-collision resolution mechanism from scratch** —
  `apps/ingest/src/items/index.ts`'s `resolveWithDisambiguation` (three
  signals: `default_version`, `isQualifiedVariantOf`, exact `page_name`
  match). Read it first; a new collision probably needs a fourth signal, not
  a rewrite.
- **`Table.rolls`' "N independent access attempts" meaning is correct in
  general.** Corporeal Beast is a confirmed, cited exception (`drawsPerHit`,
  see section 3), not evidence of a systemic bug — don't "fix" `Table.rolls`
  globally because of it.
- **Never re-hit the wiki to fix a parser bug** (CLAUDE.md hard rule).
  `data/snapshots/` (gitignored, machine-local) is the source of truth for
  re-parsing; bump `parserVersion` instead.
- **Don't generalize the `nothing`-kind denominator-shrink rule in
  `compile.ts`'s `compileTable`.** It's untouched by Extension B on purpose
  — ownership's pool adjustment (`effectiveWeightedPool`) is a wholly
  separate function. A naive generalization (any condition-excluded entry
  shrinks the denominator, not just `nothing`-kind ones) was checked against
  real data and **breaks Brutus** (its members/F2P split relies on
  condition-excluded non-`nothing` entries whose applicable weights already
  sum flush to the denominator in both variants — see
  `docs/mechanics-model-proposal.md`'s Extension B section for the exact
  numbers). If a future mechanic seems to need this, re-derive the risk
  freshly against Brutus before touching that function, don't assume it's
  safe because Extension B's narrower version was.

---

## 6. Landmines — things a fresh session will step on

### 0. Root `PROJECT_PLAN.md` does not exist, and has never been committed

No `PROJECT_PLAN.md` at the repo root; the only copy is `plan/PROJECT_PLAN.md`,
and `plan/` is gitignored. **Surfaced, not fixed** — moving/recreating it is a
structural decision for the user. If asked to read `PROJECT_PLAN.md`, use
`plan/PROJECT_PLAN.md` and flag the discrepancy rather than quietly working
from the gitignored copy forever.

### 1. `data/bosses/*.json` is not automatically kept in sync

`ingest parse` only writes a file when `assembleBoss` succeeds, and never
deletes a stale one for a source that stops producing output. **Still live**:
`chest-tombs-of-amascut` (tier D) still sits in `data/bosses/` from an old
one-off run, so raw file counts show 15 `needs_review` where the real tier
A+B+C tally is 14. Always re-run `ingest parse --tier <X>` fresh before
trusting `data/bosses/` contents — this session did, twice (once after
Extension A, once after Extension B), and both times reproduced the
identical 36/14/3 split with only `qty_sane`'s advisory string differing
from the pre-Extension-A content, confirming zero drift.

### 2. Item resolution: a three-signal disambiguation pipeline, not a simple lookup

See section 5's entry — same content, cross-referenced there since it's now
a "don't redo" item, not just a landmine.

### 3. `refs_resolve` and RDT/gem-table access are real now, but GWDRDT is a hole

`{{GWDRDT}}` is a genuinely different table (rune sword instead of runite
bar, mega-rares folded in, explicitly unaffected by ring of wealth). Flagged
unresolved (Kree'arra, General Graardor), not silently mapped onto
`rare_drop_table.json`. Building it is a new
`data/tables/gwd_rare_drop_table.json`-shaped record, not a code fix.

### 4. `mode: 'independent'` allows `'always'`-rate entries — real schema fix, not a workaround

Several sources' `Tertiary` headings genuinely interleave a guaranteed drop
with chance-based rows under one heading. Fixed in the schema, not the
parser. If you see this kind of rejection again on a new source, it's
unlikely to be the same bug recurring.

### 5. `data/bosses/the-mimic.json` (and formerly `brutus.json`) have been stale before

Both were caught reflecting pre-item-index-v2 state after an index rebuild.
If a source's file looks inconsistent with the current item index or
watchlist, re-parse before debugging further.

### 6. Two different "Brutus" representations exist on purpose

`packages/loot-model/test/fixtures/brutus.ts` is hand-authored (Phase 1/3
validation math, has membership conditions the parser can't extract).
`data/bosses/brutus.json` is the real parser output. Don't reconcile them
into one file.

### 7. Brutus is the regression gate for anything touching `compile.ts`/`simulate.ts`/`expected-value.ts` — run it FIRST

Not just "part of the test suite" — the specific, deliberate check for
whether a change to the compiled-form/simulation engine broke something
already shipped, because it's the one fixture with real condition-excluded
weighted entries at hand (its members/F2P split). This session ran
`vitest run test/brutus.test.ts` immediately after *each* of the three core
files changed (`compile.ts`, then `simulate.ts`, then `expected-value.ts`)
during Extension B, not batched to the end — catch a regression at the
smallest possible diff, not after a large one has piled up. Keep doing this
for step (c) and Phase 7's engine-adjacent work.

### 8. Seeded-RNG determinism tests, and what they actually guard

`packages/loot-model/test/ownership.test.ts`'s "seeded-RNG determinism"
suite has two tests worth understanding, not just re-running:

1. Same seed run twice (for both Extension B shapes) produces byte-identical
   `drops`/`gpTotal`/`log`; a different seed's *kill log* (not final
   aggregate — the weighted-pool shape converges to the same aggregate
   almost regardless of seed at large N, since every piece gets obtained
   exactly once eventually) diverges.
2. A boss with **zero** ownership gates produces identical output across two
   runs at the same seed — a regression guard specifically for the failure
   mode "the tracker is wired in a way that consumes RNG draws it shouldn't
   (it must not — it's derived purely from already-decided emission
   outcomes, never an independent random source)." If a future change to
   `OwnershipTracker` or its call sites ever makes this test fail, that's
   the seeded-RNG guarantee (PROJECT_PLAN.md section 8) breaking, not a
   flaky test — treat it as a hard stop, not something to retry past.

### 9. Three trip-wire checks exist — know what re-fires them and why

`docs/DECISIONS.md`'s "Constant-returning validation checks" entry named the
pattern: a check that's hardcoded `{ ok: true }` because a claim about the
schema being fully self-enforcing is *currently* true, with a test that
fails the moment the claim stops being true — the trigger to re-audit, not a
bug.

1. **`qty_sane`** (`apps/ingest/test/qty-sane-constant.test.ts`) — asserts
   `QtySpec`'s kind list. **Fired this session**: Extension A added the
   `formula` kind. `qty_sane` is no longer hardcoded; a real
   `apps/ingest/src/validate/qty-sane.ts` now evaluates formula-driven
   quantities, `Table.rolls`, and both `qtyMultiplier` sites the same way
   `rates_valid` evaluates formula rates.
2. **`rates_valid`** (`apps/ingest/test/rates-valid.test.ts`) — asserts
   `Rate`'s kind list. Did not fire this session (`Rate`'s four kinds are
   unchanged), but it's the same mechanism and the reason `qty_sane`'s
   version exists at all — read its own file's comment for the original
   audit if `Rate` ever gains a fifth kind.
3. **Watchlist/inventory consistency** (`apps/ingest/src/validate/
   watchlist.ts`'s `checkWatchlistConsistency`, tested against the real,
   committed `data/mechanics-watchlist.json` + `data/_inventory.json` in
   `apps/ingest/test/watchlist.test.ts`) — new this session, a different
   *kind* of trip wire (drift between two hand-authored/generated files,
   not a schema-kind audit), added specifically because it's what would
   have caught the reward-cart/reward-pool swap this session found and
   fixed (each entry's `blockedBy` named the other's boss). Fires if a
   future watchlist edit's `blockedBy` list stops matching
   `_inventory.json`'s real boss→lootSource map.

4. **`formulas.test.ts`'s implemented-set pin** — asserts the exact set of
   `IMPLEMENTED_FORMULA_IDS`. **Fired twice this session**, once per real
   formula added. Its other half ("every id that is NOT implemented still
   throws") is the actual guard, protecting Phase 1's decision that a stub
   must never become a silent zero. When it fires, update the pinned list;
   never delete the guard.
5. **`apps/web`'s `conditionLabel` exhaustive switch** (`DropTableView.tsx`) —
   not a trip wire by design, but it functions as one: a new `Condition` kind
   fails the web typecheck until the UI can render it. `includes` was caught
   this way.

All five are real regression tests, not documentation — they run in
`pnpm -r test`/CI on every change, by design. A sixth now exists: the site
index's `tables` manifest must cover every `tableRef` in the corpus
(`apps/ingest/test/site-index.test.ts`) — see landmine #10.

### 10. A jsdom test can pass on a code path the browser never takes

`apps/web/src/lib/api.ts` hardcoded three shared-table ids and had never learned
about Lunar Chest's three `lunar_chest_*_set` records. In the browser that meant
`UnresolvedTableRefError` out of the worker for **every Lunar Chest run with a
Moon selected** (with no Moon selected it works, because the refs sit behind an
`includes` condition and are filtered out before resolution — which is exactly
why it shipped), and the ownership controls never rendering at all.

`test/SimContextControls.test.tsx` could not catch it: it builds its
`sharedTables` map by `readdirSync`-ing `data/tables/`, which is correct and is
also something a browser cannot do. **When a jsdom test constructs an input the
real app fetches, it is testing a different program.** Fixed by making the
browser's list directory-driven too, via the site index's new `tables` manifest,
with a real-data coverage test. Same bug `loadSharedTables` was fixed for once
already — check the other side of a wire before assuming a fix propagated.

Two in-app links (`BossView`, `AdminPage`) were also root-absolute `<a href>`s
that escape the base path on GitHub Pages; both are `<Link>` now, and the
guarding test sweeps every `a[href^="/"]` rather than naming the two.

### 11. Scope-permissive guards: FOUR found, and there is now a harness for the fifth

`entry.title`, `refs_resolve`, `qty_sane` and `items_known` were all found more
permissive than they looked, all in the same way, none of them by a test. Every
test that existed shared one shape: **it mutates the data and never the field
that decides the check's scope.**

**`apps/ingest/test/helpers/scope-invariant.ts` is the default shape now.** The
invariant it encodes: a document that genuinely FAILS a check must keep failing
under any mutation that does not repair the defect — a scope hole is exactly the
case where the check stops looking, so a real failure becomes a pass.
`scope-invariants.test.ts` applies it to all five checks with a scope
(`refs_resolve`, `qty_sane`, `items_known`, `rates_valid`, `weights_sum`).

**When a fifth hole turns up, add the mutation to `SCOPE_MUTATIONS` once and
every check gains the coverage at that moment.** That is the point of the file;
adding a per-check test instead is the old shape that missed four in a row.

The fourth, for the record, was `items_known`: `parseBoss` collected items with
a flat `entry.node.kind === 'item'` loop, so an item inside a `oneOf` was never
collected. Now `apps/ingest/src/parse/collect-items.ts`, recursive. It
deliberately does NOT follow `tableRef` — a shared table's items are that
record's own business, and following the ref would blame one bad shared record
on all seventeen sources that reference it. That decision is stated in the file
rather than left implicit in the loop, which is the whole lesson.

### 11b. `refs_resolve` used to be scoped by `SimContext`, and passed on nothing

`checkRefsResolve(lunarChest, new Map())` returned `ok: true, "resolved against
0 shared table(s)"`. The check delegated entirely to `compileBoss`, and
`compileTable` filters condition-excluded entries *before* resolving what they
point at — so every one of Lunar Chest's refs was invisible to it under the
default context. It now walks the document structurally (ignoring conditions,
descending into `oneOf`, following refs transitively through `data/tables/`),
with `compileBoss` kept behind it as a cross-check.

**The generalisable lesson, and the thing to actually apply:** every
pre-existing test in `refs-resolve.test.ts` used an *unconditional* `tableRef`.
They mutated the data and never the field that decided the check's scope. A
guard whose scope comes from a field is only as strong as the tests that move
that field — the same lesson `checkWatchlistConsistency`'s `entry.title` gap
taught. `refs-resolve.test.ts` now has a scope-mutation suite that holds the
data fixed and moves the condition instead. `qty_sane` had the narrower
node-kind version of the same blind spot (`oneOf`), now closed. The single-
context evaluation in `rates_valid`/`qty_sane` is the remaining instance: real
in principle, **zero flips** across 51 sources × 11 context mutations, so it is
recorded and not built against.

---

### 12. A tier filter used to be able to silently overrule an authored override

Reward pool is tier D. Every documented parse invocation is `--tier A,B,C`. So a
source could have a complete, correct, tested override sitting in
`data/overrides/` and simply never be built — and nothing reported it, because
`loadOverride` looks files up BY slug, so an override for a slug nobody
enumerates is never opened by anything.

Fixed: **an authored override now forces its source to be parsed whatever the
tier filter says** (the filter decides what to *attempt*; it was never meant to
overrule an explicit human decision), and override slugs matching no loot source
are reported as orphans so a typo'd filename is visible. The run log names any
source pulled in this way.

Worth knowing because the from-scratch machinery itself was never the problem:
`applyOverride` has always accepted a null generated document and emitted
`source: 'override'`, and `parseBoss`'s `overrideCarriesTables` has always
rescued its three `parse_failed` exits. Nothing was missing there. **Rewards
Chest (Fortis Colosseum) is tier D too and is the next source this would have
bitten.**

## 7. Suggested next steps, in order

1. ~~**Zalcano**~~ — **DONE.** Shipped via `data/overrides/zalcano.json` + 12
   wiki-figure tests. The condition-shape decision resolved as a **derived
   `SimContext` field** (`totalDamage`), not a formula-valued condition, so no
   fourth gating shape was added and the resolved-once invariant is intact.
   `levelAtLeast` gained `shieldDamage`/`totalDamage`; `fishingLevel` is still
   deliberately out. **Zalcano stays on the mechanics watchlist and is therefore
   `needs_review`, not `manual_override`** — two curves the page states exist and
   never states (the points→loot scaling function, and the Zalcano shard's
   1/750–1/1500 interpolation). Everything else is modelled and tested. Do not
   remove the watchlist entry to make the counter move.
2. ~~**Wire the new `SimContext` fields into the UI**~~ — **DONE.** Controls are
   *derived per boss* by `apps/web/src/lib/context-fields.ts` rather than being a
   fixed list, including fields only ever read inside formulas (Zalcano's
   `isMVP` appears in no condition anywhere) via `FORMULA_CONTEXT_FIELDS`. All
   fields round-trip through the URL. Verified by jsdom render tests against the
   real generated documents **and, since the Playwright session, in a real
   browser against the production build** — `pnpm --filter web test:e2e`, 18
   tests. That suite is what found the two production bugs in landmine #10.
3. ~~**Reward pool**~~ — **DONE.** Shipped as `data/overrides/reward-pool.json`
   + `data/tables/reward_pool_fish.json`, 12 wiki-figure tests, modelled **per
   reward permit**. Two things worth carrying forward from how it was built:

   - **`independent` mode + certainty rates (`1/1`) is how mutually exclusive
     condition-gated alternatives are modelled.** Reward pool's seven Fishing
     brackets cannot be a weighted table — all seven would sum to 25,200 against
     a 3,600 denominator and `weights_sum` would fail, correctly, because it is
     a members-variant check and understands no other condition kind. Instead
     the seven bracket entries are certainty rates gated on their bracket, each
     carrying a `oneOf` of that bracket's five fish; exactly one survives
     compile-time filtering and its `oneOf` normalises over the bracket's own
     3,600. Reach for this shape the next time brackets appear.
   - **Per-permit/per-redemption modelling can dissolve a missing formula.** The
     points -> permits rounding rule is still unstated, but it only ever
     mattered for `Table.rolls`; making the permit the simulated unit — which is
     the page's own unit — makes the table exact and needs no formula. Ask
     whether a source's real unit is the encounter before assuming it is.

   It **stays watchlisted and `needs_review`**: the per-encounter mechanic is
   genuinely unmodelled. Do not remove the entry to move the counter.

4. ~~**Reward Cart**~~ — **BLOCKED, deliberately, do not attempt.** Its Logs
   sub-table rows are all `rarity=Varies` with the Woodcutting-level rates never
   stated (same class as Zalcano's two curves — do not guess), and the pyromancer
   outfit rule ("the piece players have the least of", fixed tie-break order) is
   a *relative* comparison across four item counts, a fourth gating shape
   `ownershipGate` does not express. Wikitext is snapshotted if you want to
   re-read it. What IS expressible: the warm gloves / bruma torch "already has
   three" substitutions are ordinary `ownershipGate` threshold cases.

5. **The remaining sources.** `rewards-chest-fortis-colosseum` is the natural
   next one — it is tier D like Reward pool was, so landmine #12's fix is what
   makes an override for it reachable at all.

6. **Un-watchlist as mechanics land**, following the four-step sequence in
   `docs/OVERRIDES.md` — the wiki-figure test (step 3) is the part that is
   easy to skip and must not be.
7. Nex (tier D, `include: true`) has still never been investigated — check
   whether it's actually raid-shaped before assuming it needs any of this
   machinery.
8. ~~`reward-pool`/`reward-cart` watchlist misattribution~~ — **RESOLVED, and do
   not re-flag it.** The data was already correct; this item was a stale
   transcription of a sentence in `docs/bosses/reward-{pool,cart}.md` that said
   the watchlist "currently reads" the swapped values and was never updated
   after the fix. Both banners now state the resolution and describe the bug in
   the past tense. `checkWatchlistConsistency` also gained the two rules that
   would have settled it without a human: it now validates `title` (previously
   unchecked *and* load-bearing — an entry retitled to its own boss page with an
   emptied `blockedBy` used to pass vacuously) and scans `detail` for another
   source's boss page or formula id. See `docs/DECISIONS.md`.
