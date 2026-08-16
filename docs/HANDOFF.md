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
prior sessions. Not re-verified line-by-line recently, but nothing since has
touched their done-when criteria. **"This session" appears throughout this file
and means different sessions in different sections — the dated change lists at
the end of section 1 are the reliable chronology.**

**"Phase 5"/Phase 7 (PROJECT_PLAN.md section 16: overrides + hard bosses) is
substantively underway, not done** — its own done-when is "zero
`needs_review`," and **25 non-verified sources remain** (23 `needs_review` + 2
`manual_override`), plus 3 `parse_failed`. Section 3 breaks that number down by
cause — it is no longer dominated by any single one. What IS done within its
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
- **Extensions A and B, implemented** (an earlier session, in
  `packages/loot-model/src/{schema,formulas,conditions,compile,simulate,
  expected-value}.ts`) — see sections 2–4 below for what they are and how
  they were verified. Neither builds an actual boss doc for any of the 14
  researched sources; they make the 14 *buildable*.
- **`data/overrides/` EXISTS and is in use** — loader, merge semantics,
  `docs/OVERRIDES.md`, and two live overrides. See section 3.
- **Eleven formulas are really implemented** (`doom_of_mokhaiotl_deep_rolls`,
  `lunar_chest_standard_rolls`, Zalcano's `zalcano_crystal_shards` /
  `zalcano_mvp_share` / `zalcano_mvp_only`, and ToA's `toa_invocation` /
  `toa_unique_weight` / `toa_common_qty` / `toa_elite_clue` / `toa_pet` /
  `toa_bad_luck_mitigation`); every other `FORMULA_IDS` entry is still
  `stubFormula(...)` — registered, not implemented.
  `IMPLEMENTED_FORMULA_IDS` is exported from `formulas.ts` and is what
  `formulas.test.ts`'s trip wire pins. **That wire has now fired three times** —
  expect it to fire again and update the pinned list rather than deleting the
  guard. `FORMULA_CONTEXT_FIELDS` (same file) must also gain an entry for any
  new id: it declares which `SimContext` fields a formula reads, is what lets
  the UI discover a control the boss document cannot reveal, and is verified
  behaviourally by `formulas.test.ts`.

```
98 documents, of 102 loot sources with include: true (96.1%):
  55 verified, 2 manual_override, 41 needs_review
```

**READ THE DENOMINATOR CAREFULLY. It is 102, not 52.** Coverage was long read as
"27 of 52"; 52 was the number of sources ever PARSED, not the number the project
owns. `include: true` in `data/_inventory.json` is the gate, and it is 102.
`verified` is **55/102 = 53.9%** (56.1% of the 98 documents that exist). Per
tier (with document / include:true): A 25/26, B 1/1, C 26/26, D 19/20,
E 27/29. The 4 sources with no document at all: `revenant-maledictus` (A, own
open parse_failed reason), `rewards-chest-fortis-colosseum` (D, wave-shaped,
needs an override, section 3), `burnt-chest` and `sigmund` (E — both trivial;
`burnt-chest` blocked on a `==Loot==` heading-matching gap, `sigmund` has no
real combat loot at all, only a quest-only Thieving pickpocket reward). See
`docs/DECISIONS.md`'s "Tier E run, and whether tier should gate parsing at all"
for the full breakdown — that session also found `ingest parse`'s default
(`--tier` omitted) was silently gating on tier A alone and changed it to
default to every tier, since `include: true` is the only gate that was ever
supposed to decide what gets attempted.

**Tier E is done, not the largest untouched block anymore.** All 29 sources
were run: 26 verified, 1 needs_review (`chronozon`, an item-index gap, not a
table-shape one), 2 parse_failed (above). The `trivial` classification held up
structurally — none of the 29 produced a `weighted`-mode table, confirming
Phase 2's read that these are genuinely simple, not merely unattempted.

**`repeatable: boolean` now exists on `Boss`/`LootSource`/`SiteIndexEntry`,
and it moves the headline number.** Tier E's "trivial" content is mostly
one-time quest bosses (Bouncer, Dad, `me` — a slug that shadowed common search
terms) that a loot simulator has nothing to say about: an account gets exactly
one roll against them, ever. `repeatable` distinguishes "has a wiki page" from
"can be farmed", derived from live `Category:Quest monsters`/`Category:Quest
NPCs` membership plus one hand-verified exception (`data/repeatable-
overrides.json`; Vorkath is tagged but the quest only gates access, per the
page's own words). **Nothing is deleted or excluded from parsing** — only
`apps/web`'s default search list filters on it; `/admin` shows everything,
now with a visible "Not repeatable" badge. See `docs/DECISIONS.md`'s
`repeatable` entry for the full false-positive/negative audit.

**Read `verified` split by this field before trusting the headline 55/102.**
24 of the 55 `verified` sources (43.6%) are one-time content. The number that
answers "how much of what a user would actually simulate is verified" is
**31/72 = 43.1%** among `repeatable: true` sources (44.3% of their 70
documents) — noticeably below 53.9%. Full table in `docs/DECISIONS.md`.

**Found by lifting the tier gate, then fixed: `monumental-chest` (tier D) was
a STALE committed document the parser could no longer reproduce, and a
permanent guard against this now exists.** `apps/ingest/test/corpus-
reproducibility.test.ts` re-parses every committed document for real (against
a scratch dir, never `data/bosses/` itself) and fails loudly on any mismatch
— it's in `pnpm -r test` now (~22s). Run once: `monumental-chest` was the
**only** mismatch in all 98 documents. Root cause was NOT the transclusion
preroll->independent switch (landmine #11d) — Monumental chest's `Pre-roll`
section has no transclusion in it. It was the `DROPS_SECTION_TITLE` widening
(same session, above): `==Loot table==` only started matching once "table"
became a valid terminal keyword, which for the first time exposed a
`===Pre-roll===` sub-heading mixing two `rarity=Always` consolation rows with
a real unique-selection table — a gap `buildTableGroups`'s `PREROLL_HEADINGS`
branch always had, just never reachable before. Fixed generally, not as a
special case, in `build-tables.ts`: `always`-kind rows now split into their
own `always` table (unsafe to leave inline, unlike `independent` — a
`preroll`'s first-hit-wins ordering would let an `always` row deterministically
win every kill and make the real chain unreachable), and rows that reconcile
FLUSH to their own shared denominator (Monumental chest's 8+2+2+2+2+2+1 = 19)
are now `weighted`, not `preroll` — a genuine preroll (Brutus: 5+4+1 against
/150) never reconciles, since the shortfall is what makes "keep going, maybe
nothing hit" a real semantic. Full reasoning, including the one thing this
does NOT fix (Normal Mode/Hard Mode blend into one table with no `variant`
tag — `{{DropsTableHead|dropversion=}}` isn't read for regular drop rows the
way `rdt-access.ts` already reads it for RDT access lines), in
`docs/DECISIONS.md`. `data/index.json` and `data/item-icons.json` regenerated
to match (8 newly-reachable ToB uniques).

**Read that 27 against the earlier 18 and the earlier-still 38.** The 38 was
inflated: `drops_covered` was turned on deliberately (see docs/DECISIONS.md) and
moved 20 sources out of `verified` because they were genuinely incomplete — a
transcluded drop sub-table produced no `{{DropsLine}}` rows and vanished, so
those documents were smaller than their pages.

**The transclusions are now expanded during parse and that gap is closed** —
`drops_covered` failures went 26 -> 5, and the 427 missing rows are in the
corpus with the wiki's own published rarities (700 of 721 fixed-rate item rows
agree exactly with the `dropsline` bucket; the 21 that differ are all Doom of
Mokhaiotl's delve-scaled override, which its own wiki-figure test pins). See
landmine #11c, now a record of the fix and its residuals.

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
`SimContext.totalDamage` (derived). **Phase 7 has shipped 6 of the 14
researched sources**: Abyssal Sire and Corporeal Beast (parser fixes,
`verified`), Doom of Mokhaiotl and Lunar Chest (overrides, `manual_override`),
Zalcano (override, still `needs_review` — two curves the wiki never states keep
it watchlisted), and **Tombs of Amascut** (override, still `needs_review` — the
five invocation-gated remnants keep it watchlisted; see section 3). See
section 3 for what is next.

**Changed in the ToA session (the most recent one):**

- **Tombs of Amascut is BUILT** — `data/overrides/chest-tombs-of-amascut.json`,
  28 wiki-figure tests in `apps/ingest/test/toa.test.ts`. `drops_covered` 15
  missing -> 5, and those 5 are exactly the remnants the override declines to
  model. Read `docs/DECISIONS.md`'s "Phase 7: Tombs of Amascut" before touching
  any of it.
- **The "UNKNOWN" weight interpolation was a MISSING SOURCE, not a missing
  fact.** `Module:Tombs of Amascut loot` (the Lua behind the page's own
  calculator) states the rule; it reproduces all five published rows exactly.
  Two pages fetched through `WikiClient`, snapshotted. **The published 5-row
  table is non-monotone in the fang's rate**, so interpolating between rows
  would have been wrong, not merely unstated. **Look for a `Module:`/
  `Calculator:` page before recording a curve as UNKNOWN** — CoX and ToB both
  have one.
- **`weight` may now be a formula** (`WeightRateSchema`), resolved at compile
  time by `compile.ts`'s `compileWeight`. Extension A's missing fourth member,
  alongside `rolls`/`QtySpec`/`qtyMultiplier`. Measured cost: none.
- **`levelAtLeast` gained `points`, `raidLevel`, `deaths`.** All three fields
  already existed on `SimContext`; the condition's enum simply did not list
  them. The lunar-chest lesson again.
- **`LeafEntry` gained `ownershipGate`**, so a `oneOf` pool can be the *unowned*
  members of a set (ToA's keris jewels). `compileOneOf` populates
  `ownershipGates`; `effectiveWeightedPool` already handled the rest, so
  `simulate.ts`/`expected-value.ts` are untouched.
- **`marginal-rates.test.ts` had the `oneOf` blind spot too** — the fifth
  instance of the flat `entry.node.kind === 'item'` loop. Fixed by descending,
  NOT by adding ToA to its `AUTHORED` exclusion list. See landmine #11f.
- **`rates_valid` no longer claims weights are schema-enforced**, evaluates
  formula weights, and descends into `oneOf`.

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

**Changed in the transclusion session (the most recent one):**

- **`apps/ingest/src/parse/expand-transclusions.ts` is new** — transcluded drop
  sub-tables are expanded during parse, recovering **427 rows across 28
  sources**. `drops_covered` failures 26 -> 5. **Read landmine #11c before
  touching it**, especially point 3: a failed expansion produced a plausible
  WRONG rate on five sources, not a missing row, and `drops_covered` could not
  see it.
- **`expansion.unexpandable` joined the `verified` gate** for that reason.
- **Transcluded sub-tables are `independent`, never `preroll`** — landmine
  #11d. `preroll` suppresses later weighted tables, which put Arrg's Coal
  23.45% under its published rate in shipped data.
- **A standing partition check** (`transclusionPartition` /
  `checkTransclusionPartitions` in `build-tables.ts`) runs on every transcluded
  block and reports any whose rates do not sum to its declared access rate.
- **`apps/ingest/test/marginal-rates.test.ts` is new** and is the only check in
  the repo that COMPOSES a document and compares per-item probabilities against
  the wiki — landmine #11e. Nothing else could see the mode bug,
  `drops_covered` included, because coverage is by item NAME.
- **`findRowlessTemplateBlocks`** (`wikitext-drops.ts`) reports a drop
  sub-section that still has a template for a body and no rows to show for it,
  surfaced only when there is a shortfall to explain.
- **`data/item-icons.json` regenerated** — 736 items, 734 resolved. Stage 2 of
  the icon resolver now also accepts a strictly numeric stack suffix
  (`stackSuffixPattern`), which is what resolves `Belladonna seed` ->
  `Belladonna seed 5.png`. Digits only, so `Baby Mole (NPC).png` is still
  refused. `data/index.json` rebuilt.
- Two tests that pinned the transclusion bug now pin the fix
  (`drops-covered.test.ts`'s Corporeal Beast sigils,
  `rdt-access-mechanics.test.ts`'s check set), inverted rather than deleted.

**Also changed, in `apps/web` (accessibility pass):**

- **A `--color-muted` token exists now** (`src/index.css`) and every
  de-emphasised text use goes through it. The header and footer shipped
  `text-neutral-600` on the `neutral-950` body at **2.54:1**, and the shared
  muted colour was `text-neutral-500`, which reaches only 4.18:1 — both below
  WCAG AA's 4.5:1, and the second was wrong in 27 places. `neutral-500` cannot
  reach AA against ANY background in this UI, so `neutral-400` is forced.
  Header and footer also sit on a lifted `bg-neutral-900`.
- `manual_override`'s status badge is `sky-300`, not `sky-400`: 4.46:1 over a
  panel, just under. The rarest-item card overrides the muted token to
  `neutral-300` because its amber tint LIFTS its own background.
- **`apps/web/test/contrast.test.ts` computes every ratio** from the palette
  (and first asserts the model reproduces Tailwind's published hexes, so a
  drifting palette is caught too), plus a trip wire that `text-neutral-500/600`
  appear nowhere in `src`. **`apps/web/e2e/contrast.spec.ts` measures what the
  browser actually PAINTS**, because a unit test cannot prove a utility class
  was generated or won the cascade. Note Chromium serialises these as
  `oklch(0.708 0 none)`, not `rgb()`.
- The header carries a GitHub repo link (icon + `aria-label`, `target="_blank"`,
  `rel="noopener noreferrer"`).

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

### Phase 7 — 5 of 14 shipped, 9 to go

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

### Where the non-verified sources actually are

The counter is no longer dominated by one cause. **23 `needs_review`**, and the
only honest way to plan against it:

| group | count | what it needs |
|---|---|---|
| transcluded sub-table mode | 9 | a decision, not code — see below |
| the "Uniques"/"Mutagens" heading question | 5 | `phantom-muspah`, `sarachnis`, `shellbane-gryphon`, `the-nightmare`, `zulrah`. **Most re-litigated question in the project — see section 5 before touching it.** |
| genuinely unknowable curves | 3 | `duke-sucellus`, `zalcano`, `reward-pool`. Watchlisted, correctly. **Before adding a fourth, check for a `Module:`/`Calculator:` page — that is what closed ToA's.** |
| raids that DO have a document | 2 | `chest-tombs-of-amascut` (BUILT; watchlisted only for the 5 invocation-gated remnants), `monumental-chest` — point-scaled, below |
| GWDRDT | 2 | `kree-arra`, `general-graardor` — landmine #3 |
| other | 2 | `black-knight-titan` (a Lua `{{#invoke:}}` sub-table + `items_known`), `salarin-the-twisted` (`items_known`) |

Plus **2 `manual_override`** — `doom-of-mokhaiotl` and `lunar-chest`, both a
terminal success state, not work outstanding.

Plus **3 `parse_failed`, which produce no document and are therefore NOT in the
23 above**: **Ancient chest** (CoX — see the raids section), **Black demon**
(its headings are `==Level 172, 178, and 184 drops==`, which
`DROPS_SECTION_TITLE` does not match — a contained heading-matching gap, pinned
as such in `transclusion-coverage.test.ts`), and **Revenant maledictus**.

**Fortis Colosseum is in none of these counts at all** — it is tier D and has
never produced a document, so it is invisible to every tally. Worth knowing
before reading the corpus numbers as "everything the project owns."

### The four raids — the largest coherent block of work left

None is blocked on engine capability any more; `data/overrides/` exists,
Extensions A and B shipped, and landmine #12's fix means a tier-D source with
an authored override actually gets built. What they need is the *formula* each
one's rewards scale on, and those are stated on the pages in varying detail.

1. **Chambers of Xeric -> `ancient-chest`. `parse_failed`, no document at all.**
   Its page has no `{{DropsLine}}`-shaped content whatsoever. Needs the
   `cox_points` formula plus a from-scratch override. **Read section 5's CoX
   entry first**: the cross-table gating (elite clue / Olmlet) is *resolved* as
   Extension A work and must not be re-opened as "needs new architecture" —
   and the failure mode to avoid is quantified there (naively using the
   unconditioned subrates overstates Olmlet by **33x**).
2. **Tombs of Amascut -> `chest-tombs-of-amascut`. BUILT** — override, 28
   wiki-figure tests, `drops_covered` now 5 of 50 (the five remnants it
   deliberately does not model). Still `needs_review`/watchlisted for exactly
   that reason, which is correct. **Its `Module:`-page lesson generalises to
   CoX and ToB below.**
3. **Theatre of Blood -> `monumental-chest`.** Same shape: document,
   `needs_review`, watchlisted, `drops_covered` fails 9 of 43. Point-scaled.
4. **Fortis Colosseum -> `rewards-chest-fortis-colosseum`. No document.** Tier
   D, and its page is structured by `Wave 1`..`Wave 12`, fitting none of the
   four canonical modes. **Its wave shape is a population of one** — that was
   checked directly against Inferno, TzHaar Fight Cave, Barbarian Assault and
   Nightmare Zone, and none of them shares it (docs/DECISIONS.md). So do NOT
   generalise wave machinery from it; it is an override case. Note its
   run-scoped, resets-per-attempt armour dedup is the one ownership shape
   Extension B deliberately does not express (section 2).

### The mode question on transcluded blocks — open, and it is a DECISION

Nine sources are `needs_review` for this alone and every other check on them is
green. The rows are provably one mutually-exclusive roll (the partition
identity holds at ratio 1.0000 on all of them); they are modelled as
`independent` rolls so the wiki's per-row rates survive, and the document does
not express the single-access-roll shape at all. See landmine #11d.

Two ways to close it, and it is not a coding question:

- **Accept the approximation** — clear the flag on a confirmed partition. One
  condition in `buildTableGroups`. The cost is a ~0.06%-of-kills impossible
  co-occurrence, already accepted in the CoX decision.
- **Model it properly** — a `oneOf` node at the access rate, which is exactly
  what the identity proves the block is, and is exact. Bigger change:
  `build-tables` would need to emit a new group shape and `assemble-boss` to
  build the node.

**Do not just switch the mode back to `preroll` to make the flag go away.**
That is the measured regression #11d records.

### The genuinely unknowable — leave them watchlisted

These are not backlog. The wiki states the mechanic exists and never states the
curve, so there is nothing to implement at any schema level, and guessing would
put an invented number behind a `verified` badge:

- **`duke-sucellus`** — the frozen-tablet curve.
- **`zalcano`** — the points->loot scaling function (`P_M`/`P_T` are defined
  exactly; what consumes them is not on the page) and the shard's "between
  1/750 and 1/1500 depending on contribution" with no interpolation given.
- **`reward-pool`** — the per-encounter mechanic. Shipped and correct *per
  reward permit*, which is the page's own unit; the encounter-level rule is
  unstated.
- **`reward-cart`** — **BLOCKED, deliberately, do not attempt.** Its Logs rows
  are all `rarity=Varies` with the Woodcutting-level rates never stated, and
  the pyromancer outfit rule ("the piece players have the least of") is a
  RELATIVE comparison across four counts that `ownershipGate` cannot express.

**Do not remove a watchlist entry to move the counter.** The check exists
precisely because parsing a page cleanly proves nothing when the rows never
encoded the mechanic that matters.

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
| **Playwright session, hoisted/inlined gate checks** | ~208ms | ~2,089ms |
| **ToA session (formula weights + oneOf ownership gates), current** | **~195–201ms** | *(not re-run)* |
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
deletes a stale one for a source that stops producing output. **The live
instance is resolved**: `chest-tombs-of-amascut` (tier D) sat in `data/bosses/`
from an old one-off run for several sessions, and was re-parsed with
`--tier A,B,C,D --source chest-tombs-of-amascut` when `drops_covered` shipped —
a stale file was the only one in the corpus whose `validation.checks` lacked the
new check, which is how it surfaced. The MECHANISM is unchanged and will bite
again; `drops-covered.test.ts` now asserts every committed document carries the
check, which turns the next occurrence into a test failure rather than a wrong
count. Always re-run `ingest parse --tier <X>` fresh before trusting
`data/bosses/` contents — this session did, twice (once after
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

### 11. Scope-permissive guards: FOUR found this way, and there is a harness for the next

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

**When another hole turns up, add the mutation to `SCOPE_MUTATIONS` once and
every check gains the coverage at that moment.** That is the point of the file;
adding a per-check test instead is the old shape that missed four in a row.

**A fifth has since been found, and NOT by this harness** — see landmine #11f.
Being scope-invariant was always necessary and never sufficient.

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

### 11c. Transclusions: FIXED, and the failure mode to remember

`extractDropLines` reads `{{DropsLine}}` calls out of page wikitext. A section
whose body is a transclusion had none, so it yielded zero rows and vanished —
and an empty section is indistinguishable from an absent one to everything
downstream. That cost **427 item rows across 28 sources**: seed/herb/talisman
sub-tables (every seed on Vorkath, Araxxor, the Dagannoths),
`WildernessSlayerDropTable` (Larran's key, Slayer's enchantment), and Corporeal
Beast's three sigils.

**`apps/ingest/src/parse/expand-transclusions.ts` expands them during parse.**
`drops_covered` failures 26 -> 5, corpus 18 -> 27 `verified` (28 briefly, before
the sub-table mode was corrected — see landmine #11d). Full reasoning in
docs/DECISIONS.md; the three things worth knowing before touching it:

1. **The set of template definitions on disk IS the scope.**
   `data/snapshots/wikitext/template-*.json`, 9 of them, fetched once and
   re-read offline. A template with no snapshot is left exactly as found.
   **Teaching the parser a new drop-table template is one fetch and no code** —
   `WildernessSlayerDropTable` and `Uniques/Corporeal Beast` were fetched only
   to assess whether the approach generalised and both groups fixed themselves
   on the next parse. Do not add per-template handlers.

2. **`action=expandtemplates` is the wrong tool** and was rejected on evidence,
   not taste: it expands recursively all the way down, returning the RENDERED
   wikitable row instead of the `{{DropsLine}}` call, which throws away the
   parameter names Phase 3 chose wikitext for. Do not re-nominate it.

3. **A failed expansion can produce a WRONG number, not a missing row.** This
   is the one that bit. `WildernessSlayerDropTable` picks its key denominator
   with `{{#switch: 1 | {{#expr: {{{combat}}} < 81 }} = ... | 1 = 50 }}`; an
   evaluator missing `<` and `^` threw, the switch matched none of its computed
   cases and **fell through to its literal `| 1 = 50`**, and five sources went
   `verified` publishing 1/50 where the wiki publishes 1/55 to 1/76. Three
   others are legitimately 1/50, which is what made it look healthy.
   **`drops_covered` could not catch it — coverage is by item NAME.** Hence
   `expansion.unexpandable` is now part of the `verified` gate, and
   `apps/ingest/test/transclusion-coverage.test.ts` compares recovered rows
   against the bucket's published RARITY, including one assertion about the
   whole set (the wilderness bosses must not all share a denominator), because
   a `#switch` falling through looks fine row by row.

**Residuals, none of which this mechanism can close:** `black-knight-titan`
(`GeneralSeedDropLines` is a Lua `{{#invoke:}}`, reported by name);
`kree-arra`/`general-graardor` (GWDRDT — landmine #3, needs a shared-table
record, not expansion); `chest-tombs-of-amascut`/`monumental-chest`
(point-scaled, pre-existing). Black demon transcludes `{{HerbDropLines}}` too
but never reaches the expander: its headings are `==Level 172, 178, and 184
drops==`, which `DROPS_SECTION_TITLE` does not match — a pre-existing
heading-matching gap, pinned as such in the test.

**Open, and deliberately not guessed:** several sources now pass every check and
stay `needs_review` on the ambiguous-mode guess alone. An expanded seed or
talisman block has heterogeneous denominators under a heading with no mode
keyword, so heuristic 6 flags it. Treating "these rows came from one
transclusion" as a confirming signal is the obvious fix and is **wrong** —
right for the seed tables (one roll, one item, weights summing to the
sub-table's denominator), wrong for `WildernessSlayerDropTable`, whose two rows
are independent tertiary rolls with no shared access rate. Provenance proves
"one unit", not "mutually exclusive". See docs/DECISIONS.md for the signal that
would actually separate them.

### 11d. A transcluded sub-table is `independent`. Do not "tidy" it to `preroll`

The transclusion fix (#11c) first shipped these blocks as `preroll`, because
that is what the heterogeneous-denominator fallback guesses. It is wrong, and
`drops_covered` cannot see it.

**Both modes get the block's own rows right** — they are disjoint, so
first-hit-wins and independent rolls give identical marginals inside the block.
They differ in what they claim about everything AFTER it: `preroll` suppresses
every later `weighted`/`preroll` table. Measured against the wiki's own
published rates that suppression put **Arrg's Coal 23.45% under its stated
1/42.7**, Giant sea snake's Adamant dart tip 13.83% under, Sarachnis' Grimy
kwuarm 5.64% under. As `independent` they land exactly on the published figure.

The accepted cost: two rows of one sub-table can co-occur in a simulated kill,
which the real access roll forbids — ~0.06% of kills on Abyssal Sire, the same
quantified artifact the CoX decision already accepts.

**A sub-table that homogenises onto one denominator never reaches this** and
becomes `weighted`, which is exact and suppresses nothing (Corporeal Beast's
sigils: 4095 = 585 x 7). Only blocks that fall through to the guess are
affected.

**The standing check:** `transclusionPartition` / `checkTransclusionPartitions`
in `build-tables.ts` ask whether the block's rates sum to the access rate its
transclusion declared. 1.0000 on all 17 seed/herb/talisman blocks; abstains on
`WildernessSlayerDropTable` (declares no access rate — its two rows derive from
combat level and hitpoints separately and really are independent); and
correctly REFUSES Vorkath at 1.6665, because that page overrides two rarities
with effective chances folding in its main table's own seed slots.

Note the identity proves only WITHIN-block exclusivity. It is not what licenses
the mode — coming entirely from one transclusion is. A rejected earlier
candidate, "every rate derives from one `{{#vardefine:}}` base", fails on
`Uniques/Corporeal Beast`, which has none and is provably exclusive.

**These blocks stay `needs_review` on purpose.** The rows are one roll and the
document does not say so.

### 11e. `marginal-rates.test.ts` is the only check that composes the document

Every other check is closed-world over structure — `weights_sum` against a
denominator, `drops_covered` over item names, `rates_valid` over rate shapes.
None of them asks whether the resulting PER-KILL PROBABILITY is the number the
wiki publishes, which is why a table whose own rows are individually perfect
can still be wrong because of a neighbour. That is exactly how #11d shipped
green.

~1,270 item rows across 52 sources are directly comparable. Three exclusions,
all because the comparison would be invalid, and all documented in the file:
items appearing more than once or reachable via `tableRef`; tables downstream
of a real pre-roll (Brutus' 10/150 pre-roll puts all thirteen main-table rows
6.54% low against the wiki's flat figures); and `preroll` tables' own entries,
which are a first-hit-wins chain. The last two are the same open question about
what the wiki's flat figures mean, and this test deliberately does not settle
it.

**Its third assertion — at least 300 comparable rows — is not decoration.** The
suite's first run passed vacuously because `Boss` has no `title` field (it is
`wikiPage`), so every oracle lookup threw into a `catch` and returned null. The
coverage guard is what turned a meaningless green into a failure.

### 11f. FIVE guards have now been found permissive. Assert that a check DID WORK

The running tally, because the pattern is the point and not any one instance:

| # | guard | how it was permissive | found by |
|---|---|---|---|
| 1 | `entry.title` (watchlist) | validated nothing; an entry retitled to its own boss page with an emptied `blockedBy` passed vacuously | a human reading it |
| 2 | `refs_resolve` | scoped by `SimContext`; condition-excluded refs were invisible, so Lunar Chest "passed" against 0 shared tables | a human reading it |
| 3 | `qty_sane` | never descended into `oneOf` | a human reading it |
| 4 | `items_known` | flat `entry.node.kind === 'item'` loop, so an item inside a `oneOf` was never collected | a human reading it |
| 5 | `drops_covered` | closed-world over the document; could not see a section the page had and the document did not | turning the check on |
| 6 | `marginal-rates.test.ts` | **passed vacuously on its very first run** | its own row-count assertion |
| 7 | `marginal-rates.test.ts` (again) | its `downstream` collector used a flat `entry.node.kind === 'item'` loop, so items inside a `oneOf` were never marked suppressed — ToA's uniques "deviated" by exactly the unique chance, a correct model failing an incorrect comparison | building ToA |
| 8 | `rates_valid` | claimed `weight` rates were "fully enforced by the schema"; true until a weight could be a formula, and it also never descended into `oneOf`, which is the only place ToA's formula weights live | widening the schema |

Number 6 is the one to internalise. `Boss` has no `title` field — it is
`wikiPage` — so every oracle lookup threw, landed in a `catch` that returns
`null`, and every comparison was skipped. The suite was green and asserting
nothing at all. What caught it was a third assertion in the same file that
counts how many rows survived its exclusions and fails below 300.

**So: any new check needs an assertion that it did NON-TRIVIAL WORK, not merely
that it passed.** A count of items compared, sources covered, mutations
applied — something that goes to zero when the check silently stops looking.
Every guard in the table above was, at some point, green while blind.

Three shapes that produce a vacuous green, all of them real here:

1. **A `catch` that returns a neutral value.** `null`/`[]`/`ok: true` on a
   missing oracle is right (see `drops_covered`'s "no dropsline snapshot" note)
   and is also indistinguishable from "it worked and found nothing."
2. **An exclusion list that grows** until nothing is left to check.
   `marginal-rates.test.ts` has three principled exclusions and the row count
   is what keeps them honest.
3. **A filter keyed on a field that changed name.** Exactly number 6.

`drops_covered` already follows the rule in its detail string — it announces
"no dropsline snapshot for X; coverage not checked" rather than reporting a
silent pass — because `refs_resolve` once said "resolved against 0 shared
table(s)" and nobody noticed for months. Do that.

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

Section 3 has the reasoning; this is the order. Everything above item 1 in
earlier versions of this file (Zalcano, the `SimContext` UI wiring, Reward
pool, the reward-cart/reward-pool watchlist misattribution) is **DONE** and has
been folded into sections 1 and 3 rather than kept as struck-through history.

1. **Decide the transcluded-block mode question.** Nine sources are
   `needs_review` on it alone with every other check green, so it is the
   single largest counter move available and it costs either one condition or
   one new group shape. It is a judgement call about what `verified` may
   claim, not a coding problem — section 3.
2. **The remaining three raids.** ToA is done and is the worked example to
   copy — read `docs/DECISIONS.md`'s "Phase 7: Tombs of Amascut" first.
   **Start each by checking for a `Module:`/`Calculator:` page**, which is what
   turned ToA's one UNKNOWN into a cited rule; `{{Calculator:Chambers of Xeric
   loot}}`-shaped transclusions are the tell, and both CoX and ToB have a
   calculator on-page. Theatre of Blood (`monumental-chest`) reproduces again
   (section 1's newest entry fixed the stale-document/schema-conflict bug) and
   fails on its stated point-scaling rule as before — that's the actual next
   step, not a parser bug anymore. One known gap if you pick this up: Normal
   Mode and Hard Mode currently blend into one table with no `variant` tag
   (`{{DropsTableHead|dropversion=}}` isn't read for regular drop rows yet) —
   see `docs/DECISIONS.md` before assuming the unique weights are per-mode
   correct. **CoX (`ancient-chest`)
   and Fortis Colosseum both need Phase 6 research first — CoX is
   `parse_failed` with no research doc, and Fortis Colosseum has never
   produced one. Do not start either without it.** Read section 5's CoX entry
   before that one.
3. **`black-knight-titan`** — a coverage failure, though `repeatable: false`
   (a Holy Grail quest boss) means fixing it moves the raw coverage count more
   than the number that matters. Its `{{GeneralSeedDropLines}}` is a Lua
   `{{#invoke:}}` the expander cannot run; the rows would have to come from
   somewhere else (an override, or the module's own output). It also fails
   `items_known`.
4. **GWDRDT** (`kree-arra`, `general-graardor`) — landmine #3. A new
   `data/tables/gwd_rare_drop_table.json`-shaped record, not a code fix. Two
   sources for one record.
5. ~~`black-demon`~~ **DONE** — recovered for free by the `DROPS_SECTION_TITLE`
   widening (section 1); it now has a `needs_review` document.
6. **Un-watchlist as mechanics land**, following the four-step sequence in
   `docs/OVERRIDES.md` — the wiki-figure test (step 3) is the part that is
   easy to skip and must not be.
7. **Nex** (tier D, `include: true`) has still never been investigated — check
   whether it is actually raid-shaped before assuming it needs any of this
   machinery.

**Not next steps, deliberately:** the "Uniques"/"Mutagens" heading question
(section 5 — answered "no available signal" every time it has been re-checked),
`ev_matches` (closed permanently, section 5), the genuinely-unknowable curves
(section 3), and `reward-cart` (blocked, section 3).
