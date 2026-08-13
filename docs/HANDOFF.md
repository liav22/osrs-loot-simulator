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

**"Phase 5" (PROJECT_PLAN.md section 16: overrides + hard bosses) is
substantively underway, not done** — its own done-when is "zero
`needs_review`," and 17 non-verified sources remain (36 verified / 53 parsed
at tier A+B+C). What IS done within its scope:

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
- **Still missing, and still the prerequisite for actually shipping any of
  the 14**: `data/overrides/` doesn't exist (no directory, no loader, no
  merge semantics), `docs/OVERRIDES.md` doesn't exist, and all 14 of the
  `FORMULA_IDS` this session added (`zalcano_points`,
  `doom_of_mokhaiotl_uniques`/`_qty`, `fortis_colosseum_uniques`/`_qty`,
  `tzhaar_fight_cave_tokkul`, `duke_sucellus_ice_quartz`) plus the original
  seven are still `stubFormula(...)` in `formulas.ts` — registered, not
  implemented. See section 3, "Phase 7."

```
53 parsed at tier A+B+C: 36 verified, 14 needs_review, 3 parse_failed — unchanged since Extension A/B landed
```

`ev_matches` is **closed, permanently** — see "What NOT to redo," section 5.

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
new `Condition` kind, `levelAtLeast` (delve/wave gating). None of this is
wired into a UI control yet — the fields exist and are simulate-able via
direct API calls (`simulate(boss, n, ctx, seed)` with a hand-built `ctx`),
but `apps/web`'s `SimContextControls.tsx` doesn't expose them. That's real,
separate, not-yet-started work.

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
(`members`, `ringOfWealth`, `killCountAtLeast`, the new `levelAtLeast`, etc.)
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

### (c) — next, not yet started

Two narrow, already-designed additions from `docs/mechanics-model-
proposal.md`'s "Deferred"/verdict sections:

- **CoX suppression**: a `suppressesFollowing: boolean` flag on
  `independent`-mode tables (a hit anywhere in the table suppresses later
  `preroll`/`weighted` tables in the document, mechanically parallel to the
  existing `suppressedByPreroll` rule). Generic, cheap, low risk.
- **Corporeal Beast**: `TableRefNode.drawsPerHit?: number` (default 1) — one
  access check gates K guaranteed draws, the confirmed exception to
  `Table.rolls`' usual "N independent access attempts" meaning. Two-line
  schema addition, a loop-count change in `simulate.ts`/`expected-value.ts`
  scoped to `tableRef` nodes carrying it. Zero interaction with anything
  else.

Neither exists in code yet (`grep -rn "drawsPerHit\|suppressesFollowing"
packages/loot-model/src` returns nothing as of this session). Same
guardrails as Extension B apply: Brutus first, re-verify all 36, benchmark
before assuming it's free.

### Phase 7 — actually shipping the 14 researched sources

This is genuinely new work, not started:

1. Build the override mechanism: `data/overrides/` directory, a loader, merge
   semantics against `source: 'override' | 'merged'` (already in the
   `Boss` schema, unused), `docs/OVERRIDES.md`. Prerequisite for any source
   the parser structurally can't reach at all (CoX's Ancient chest has zero
   `{{DropsLine}}`-shaped content; Fortis Colosseum needs wave/level
   machinery no mode expresses).
2. Implement the real formulas, per-source, using each `docs/bosses/*.md`
   doc's own "Formulas" section — most are fully cited; a few have
   explicitly UNKNOWN constants (ToA's raid-level interpolation between
   breakpoints, ToB's death-penalty magnitude, Duke Sucellus's frozen-tablet
   curve, Inferno's Tokkul-per-wave curve) that need either more wiki
   research or an explicit "not implementable yet" status, not a guess.
3. **Wave/level-indexed content (Doom of Mokhaiotl, Fortis Colosseum)
   collapses into Extension A** — this was the proposal's biggest correction
   to the original brief: treating "how far the player got" as a fixed
   per-run input (`ctx.delveLevel`/`ctx.wavesReached`, exactly how `ctx.
   raidLevel` already works for ToA) rather than a simulated combat outcome
   means no new "wave engine" is needed. Doom of Mokhaiotl needs nothing
   beyond what's already built. Fortis Colosseum needs the same, plus a
   flagged with-replacement approximation for its one run-scoped
   sub-mechanic (armour-piece dedup across waves within one attempt — see
   next item).
4. **Fortis Colosseum's armour dedup stays a flagged approximation.** It's
   the one remaining case of genuine within-kill dynamic state in this whole
   batch (a fact — "which piece did this run already give out" — that
   doesn't exist until wave 4's roll happens, read by wave 8's roll in the
   *same* simulated attempt). Building real support for it means breaking
   the "conditions/state resolved at most once per kill" invariant Extension
   B was careful to preserve. Benefits exactly one sub-mechanic of one
   source today — do not build general within-kill dynamic state for it
   without a second real example turning up first (same reasoning that kept
   wave machinery unbuilt for a whole session before Doom of Mokhaiotl
   turned up as a second case).
5. **CoX's tertiary gating (elite clue vs. Olmlet) is Extension A work, not
   deferred** — see section 5, this is a correction worth reading before
   assuming otherwise.

---

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

Current state is **comfortably under the "couple of seconds" bar**, but with
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

**A lever exists and was deliberately not pulled**: a fully duplicated
`emit`/`runTable`/`runWeightedWithoutReplacement` pair — one identical to
pre-Extension-B code (no `owned` parameter at all), selected once per
`simulate()` call via `compiled.trackedItemKeys.size === 0` — would almost
certainly recover Extension A's exact numbers for every source that doesn't
use ownership gates (100% of sources today). Not built because it means
maintaining two copies of the simulator's core recursive walk indefinitely,
for a feature four sources will ever use, and the budget is still met
without it. If step (c) or Phase 7 work pushes the 10M figure close to or
over 2s, this is the next thing to try — build it then, with a fresh
benchmark justifying it, not preemptively.

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

All three are real regression tests, not documentation — they run in
`pnpm -r test`/CI on every change, by design.

---

## 7. Suggested next steps, in order

1. **Step (c)**: `suppressesFollowing` + `drawsPerHit`, per section 3.
   Independent of each other, can land in either order or together. Brutus
   first, re-verify all 36, benchmark.
2. **Build the override mechanism** (`data/overrides/`, loader, merge
   semantics, `docs/OVERRIDES.md`) — prerequisite for CoX and Fortis
   Colosseum specifically (parser structurally can't reach either).
3. **Implement one real formula** with no UNKNOWN constants blocking it —
   `tzhaar_fight_cave_tokkul` is the cleanest (fully specified, no missing
   data) though TzHaar Fight Cave itself was never a watchlisted/tier-A-C
   source (it resolved no bosses in the 172-page inventory per earlier
   research — check `docs/bosses/tzhaar-fight-cave.md` before assuming it
   un-blocks anything counted in the 36/53). `zalcano_points` or
   `doom_of_mokhaiotl_uniques`/`_qty` are the next-cleanest real sources
   that DO count toward the 17 non-verified.
4. **Un-watchlist sources as their mechanics land**, per
   `data/mechanics-watchlist.json`'s own removal policy ("remove an entry
   only when the mechanic is modelled and the simulation has been checked
   against the wiki's own figures") — don't remove an entry just because a
   formula got implemented; verify the simulated output against the wiki
   first.
5. Nex (tier D, `include: true`) has still never been investigated — check
   whether it's actually raid-shaped before assuming it needs any of this
   session's machinery.
