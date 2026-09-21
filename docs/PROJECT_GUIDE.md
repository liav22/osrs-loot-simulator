# Project guide

Current engineering context for OSRS Loot Simulator. Read [AGENTS.md](../AGENTS.md)
for working rules and commands, then the relevant section here. This replaces
the old decision and handoff journals; it is maintained in place.

## Where truth lives

| Question | Source |
|---|---|
| What does the model support? | [schema.ts](../packages/loot-model/src/schema.ts), [formulas.ts](../packages/loot-model/src/formulas.ts), and their tests |
| Which sources are included? | [data/_inventory.json](../data/_inventory.json): `lootSources`, `include`, `repeatable` |
| What does the site serve? | [data/index.json](../data/index.json), generated boss documents and shared tables |
| Why is a source flagged? | Its `validation.checks`, `statusTier` and `statusReason`; [mechanics watchlist](../data/mechanics-watchlist.json) |
| Why does an override exist? | Its `note`, [override contract](OVERRIDES.md), source research and corresponding ingest test |
| Where is the original evidence? | [Boss research](bosses/), snapshot revision metadata, and Git history |

The [original plan](../PROJECT_PLAN.md) and [mechanics proposal](mechanics-model-proposal.md)
are historical design documents. Their phase instructions, capability verdicts,
and performance figures are not current requirements. [TRIAGE.md](TRIAGE.md)
is a generated snapshot report, not a backlog; regenerate it instead of editing it.

The former [decision journal](https://github.com/liav22/osrs-loot-simulator/blob/ff8bcffe22e97a40d06aff20ef12b71050968d00/docs/DECISIONS.md) and
[session handoff](https://github.com/liav22/osrs-loot-simulator/blob/ff8bcffe22e97a40d06aff20ef12b71050968d00/docs/HANDOFF.md) are preserved in Git history only.
Older code comments and data provenance notes that name those files refer to
these historical versions. Read them for specific evidence, not onboarding;
validate their conclusions against current implementation before acting.


## Architecture and model decisions

The pipeline is wiki → raw snapshots → parser and overrides → validation →
committed JSON → static React site. Git provides data revision history. Wiki
fetching and price retrieval stay outside the pure `loot-model` package.

Mechanics are expressed as data, never per-boss simulator branches. The schema,
compiler, simulator, expected-value walker, and probability calculations must
agree on semantics. Important distinctions to retain:

- `always` grants entries; `weighted` selects from a denominator, whose unused
  mass is implicit nothing; `independent` rolls entries separately; `preroll`
  checks in order and stops on a hit.
- A preroll hit suppresses later preroll/weighted tables in its chain, not
  always/independent rewards. Nested chains are local. `suppressesFollowing`
  provides explicit suppression for an independent table where needed.
- `oneOf` represents a weighted choice normalized over eligible alternatives.
  Use shared `tableRef` records for deeper structure and reusable tables.
- A confirmed co-drop bundle is one access roll into an `always` table. Keeping
  its members as competing weighted entries loses their joint occurrence.
- `drawsPerHit` means multiple draws after one successful access roll;
  `qtyMultiplier` scales yielded stacks. They are not interchangeable.
- Preserve explicit `qtyRounding` behavior, including `ceilDelta`; moving
  rounding to a different level can change quantities.
- Fixed simulation context and formulas are resolved at compilation where
  possible. Ownership gates have evolving run state. Do not turn a static
  condition into a per-kill counter accidentally.
- `ownershipGate.resetPerSet` subtracts completed sets (the minimum tracked
  count across the specified item keys) before checking its threshold. This
  supports repeating component protection while retaining cumulative loot
  counts. Simulation and single-attempt expected value share this rule;
  ownership-dependent milestones remain unsupported. See the
  [repeating-set tests](../packages/loot-model/test/repeating-set.test.ts).
  [Araxxor's halberd pieces](bosses/araxxor.md) use this protection behind
  one combined 1/200 access roll, keeping empty-start component counts within
  one of each other across repeated sets.
  [Alchemical Hydra's ring pieces](bosses/alchemical-hydra.md) follow fixed
  eye, fang, heart order behind one ring access roll at the end of its unique
  preroll chain, with the same protection restarting after each set.
- `ownershipGate.allOf` adds conjunctive ownership requirements while tracking
  all referenced items during a run. It supports ordered pouch acquisition and
  replacement-item exclusion. `questComplete.value: false` expresses the
  complementary quest outcome without changing existing positive gates.
- Probability calculations distinguish supported exact results from unsupported
  ownership-dependent cases. Preserve that classification rather than labeling
  every distribution exact. Exact here means relative to the modeled data,
  which can itself have documented approximations.

Start with [compile.ts](../packages/loot-model/src/compile.ts),
[simulate.ts](../packages/loot-model/src/simulate.ts), and
[cumulative-probability.ts](../packages/loot-model/src/cumulative-probability.ts).
Use the Brutus, ownership, suppression, draw-count, and rounding tests when
changing these rules. `IMPLEMENTED_FORMULA_IDS` is the implementation inventory;
a registered formula ID alone does not mean the formula is implemented.

## Parsing and item resolution

Reward entities outside Category:Bosses can be registered in
`data/additional-sources.json`. Inventory rebuilding validates and appends
these explicit boss/source pairs, rejecting collisions with discovered sources.
[Unsired](bosses/unsired.md) uses this route: each attempt offers one Unsired,
with pet removal and repeating bludgeon-piece protection. Its displayed GP
excludes the assembled bludgeon's value.
[Mahogany Homes supply crates](bosses/supply-crate-mahogany-homes.md) use the same
registration path, with one noted stack per opening. Their exact quantity
weights parse directly from the row-bearing “Possible loot” section.
[Rewards Guardian](bosses/rewards-guardian.md) uses the same route for GotR
searches, with pouch progression, quest substitutions and separate rare/pet
rolls. It remains approximate for low-level rune quantities and within-rare
co-occurrence.
[Elf (pickpocketing)](bosses/elf-pickpocketing.md) and
[Vyre (pickpocketing)](bosses/vyre-pickpocketing.md) use representative NPC
pages for revision-bound evidence while registering generic loot sources. Their
`Pickpocket/*` templates expand into skill-drop rows: one weighted ordinary
reward plus independent rare rolls. Documented overrides add the Rocky roll
from its separate pet page, using Thieving level and the target-specific base
constant. [Master Farmer](bosses/master-farmer.md) uses an inline pickpocketing
section and a documented override for its prose-defined category roll; Farming
level redistributes four herb-seed weights. A
successful-pickpocket attempt label keeps combat wording out of the UI, and the
shared `rogue_outfit_multiplier` doubles realized loot quantities when the full
outfit control is enabled without changing any drop rate. All three sources
apply that multiplier only to pickpocket loot, not their tertiary pet.
[Brimstone chest](bosses/brimstone-chest.md) and
[Larran's big chest](bosses/larran-s-big-chest.md) use the same registration
path and share the wiki's Fishing-level-dependent Slayer-chest fish formula.
Their fish outcomes fill the missing 3/60 main-table slots. `scaledRange`
preserves Larran's floor-after-50%-scaling quantity distribution instead of
inventing every integer between the displayed endpoints, and `attemptLabel`
is derived from the pages' Drop Log `type=openings` metadata.
Formula-driven weights may resolve to zero when context makes an outcome
unavailable (the level-locked fish); static authored weights remain positive.

Parser fixes reuse `data/snapshots/`; new research and deliberate refreshes are
separate fetch operations. Missing cache files must be reported rather than
silently treated as evidence that the parser is correct. `parserVersion` is
provenance only, not a reason to refetch or a staleness gate.

Transclusions expand locally using cached template definitions. Failed expansion
must remain visible: an unresolved parameter can produce a plausible wrong rate,
not just a missing row. Do not use live `expandtemplates` as the parser fallback.

Table structure needs evidence. Heading names and matching denominators alone
can be misleading. The parser checks access-rate partitions and confirming prose;
confirmed single-access alternatives become `oneOf`, while genuine independent
rolls remain independent. Vorkath's seed override preserves published marginal
rates with its documented approximation; do not normalize them to an assumed
access probability. Fix defects shared by multiple sources in the parser rather
than accumulating per-source patches.

Unparseable siblings do not justify dropping otherwise valid rows. Retain the
parseable rows and surface the remaining ambiguity. Case-insensitive coverage
comparison is guarded against collisions. Validate variant and membership
conditions, not just item names and rates.

Item IDs are resolved using infobox defaults, qualified-page relationships, and
exact page-name matches. Unresolved collisions stay unresolved or use the
reviewed allowlist; never select the first ID. Icon filenames are resolved by
ingest, not inferred from item names. Unique/pet display follows references
into shared tables as well as inline choices and uses curated flags,
not a rarity threshold. `GeneralSeedDropLines` uses raw weights rather than the
wiki's rounded display figures; its dedicated test preserves that distinction.

Entry points: [parse-boss.ts](../apps/ingest/src/parse/parse-boss.ts),
[build-tables.ts](../apps/ingest/src/parse/build-tables.ts),
[items/index.ts](../apps/ingest/src/items/index.ts), and
[OVERRIDES.md](OVERRIDES.md).

## Validation and regression lessons

`verified` is pipeline-derived; `manual_override` is hand-authored. Both require
the deterministic checks to pass. An override replaces tables wholesale when
provided, and validation checks the merged result. An override does not exempt
its source from the watchlist. `needs_review` is an honest outcome, not a target
to eliminate by weakening checks.

The schema lists checks in `VALIDATION_CHECKS`; status is assembled in
`parse-boss.ts` and tiers in [tier.ts](../apps/ingest/src/tier.ts).
`ev_matches` is advisory: price-dependent expected value cannot establish whether
the table model is correct. Do not keep tuning prices to force it to pass.

| Guard | What it protects |
|---|---|
| [corpus-reproducibility.test.ts](../apps/ingest/test/corpus-reproducibility.test.ts) | Fresh parsing matches committed documents; ignores volatile EV details and writes to scratch space. Skips without snapshots. |
| [marginal-rates.test.ts](../apps/ingest/test/marginal-rates.test.ts) | Composed probabilities match independent wiki drop figures, catching plausible but wrong nesting/access rates. |
| [scope-invariants.test.ts](../apps/ingest/test/scope-invariants.test.ts) | Validation cannot hide invalid inputs merely by filtering scope. |
| [watchlist.test.ts](../apps/ingest/test/watchlist.test.ts) | Watchlist/inventory consistency and specific stale implementation claims. |
| [docs-bosses-formula-status.test.ts](../apps/ingest/test/docs-bosses-formula-status.test.ts) | Research notes do not describe implemented formulas as missing. |
| [brutus.test.ts](../packages/loot-model/test/brutus.test.ts) | Model regression fixture; distinct from the real ingested Brutus document. |
| [Playwright suite](../apps/web/e2e/) | Production base path, deep links, data loading and actual Web Worker execution. |

A check must demonstrate that it inspected meaningful input. Include failing
cases across relevant node kinds; neither an empty selection nor an expanding
exclusion list should make a broken corpus look green. For watchlisted mechanics,
check against source figures before removing the entry.

## Current limitations and useful next work

Reviewed against committed data on 2026-09-09, not a fresh wiki audit. Consult the
watchlist, override notes, and validation reports before starting; update this
section when a limitation changes. Source research is revision-bound evidence,
not a promise that an unknown can never become known.

| Source | Remaining work or limitation |
|---|---|
| Duke Sucellus | Build the prose-defined sequential roll chain and perfect-kill bonus. The awakened ornament-kit gate exists. Research also records an unstated frozen-tablet curve; separate implementable rules from that uncertainty. |
| The Nightmare | Two independent unique pools exist; a party-size-dependent second roll is stated but unbuilt. Adding party context is a scope change. |
| Maggot King | Qualitative rarities remain unresolved. Historical research also identifies player-choice/variant and bundle work; investigate these together without inventing the missing probability split. |
| Reward cart | A metadata-only override adds the Wintertodt search alias; many `Varies` rows lack numeric rates. Points scaling and relative ownership selection need work. A source-data gap and missing model capabilities coexist. |
| Rewards Guardian | Full-level rune ranges only; low-level quantity bounds/rounding remain unclear. The rare pool preserves published marginals but assumes mutually exclusive outcomes. |
| Reward pool | Implemented per reward permit. Conversion of encounter points into permits has an unstated rounding rule. |
| Zalcano | Eligibility, MVP and several rewards are modeled; points-to-loot and contribution-to-shard curves remain unstated in the researched sources. |
| Tombs of Amascut | Five remnant rewards need invocation-composition conditions. Other exclusions include the elite combat achievement clue multiplier and duplicate jewels after all are owned. |
| Chambers of Xeric | Ancient tablet is an additional roll rather than replacing a common roll; the Metamorphic dust time threshold remains unstated. |
| Theatre of Blood | Individual-performance tertiary scaling is unstated; Entry Mode common-loot interactions remain unconfirmed. |
| Fortis Colosseum | Waves accumulate through `wavesReached`. Armour duplicate protection uses a documented with-replacement approximation; protection scope remains unresolved. Token (Varlamore) also fails drop coverage. |
| Kalphite Queen | The guaranteed 256th-kill tattered head is not an ordinary per-kill probability. |
| Mad Angel | Remaining hard-clue coverage failure reflects a wiki bucket/wikitext disagreement recorded after a patch; the compound supply bundle is built. |
| Nex | Many rows give qualitative rarity words without numeric rates. Do not infer probabilities from “Common” or “Uncommon.” |

Raid chests are modeled per player with solo assumptions. Team allocation is an
explicit scope exclusion, not evidence that the wiki lacks the formulas.

The row-content-gated loot heading rule also parses Burnt chest's guaranteed
Warm key from its `Loot` section.

Included sources without generated documents: `revenant-maledictus` (prose-only mechanic, no DropsLine calls in the
researched page), and `sigmund` (quest pickpocket reward rather than combat loot).
Reassess the current snapshot before treating these diagnoses as unchanged.

Already solved: GWD rare-drop tables, local transclusion expansion, the
`dropversion` parameter leak, coverage casing, and wholesale loss of heading
blocks with one unparseable row. Do not restart those investigations without
new failing evidence.

## Frontend and performance constraints

JSON is fetched at runtime; the site index supplies the shared-table manifest.
`sync-data` copies the deployable subset into ignored `apps/web/public/` during
`dev`/`build`. Data URLs and navigation must respect the Pages base path.
The admin route is development-only and must stay out of the production bundle.

Results retain the context and price availability used when dispatched. Editing
controls shows a previous-settings notice until rerunning or restoring the
original settings; item probability details continue to describe the displayed
run. Unpriced runs show “Prices unavailable” in place of GP totals. Data caveats
open in a scrollable dialog on both mobile and desktop.

URL state preserves context and the actual RNG seed. UI seed zero requests a
fresh seed for each run. The attempt-count input may stay blank while editing;
Simulate is disabled until a count is entered, and the URL retains the last
numeric count. Context controls derive from conditions, formula input
metadata, and ownership gates; apply `Boss.contextDefaults` before URL overrides.
Non-combat sources can provide `Boss.attemptLabel`; the simulator still counts
one table roll per attempt while controls, summaries, logs and probability
milestones use the source-specific wording.
Quest controls follow nested choices and shared tables. Explicitly cleared
quest and ownership defaults survive URL sharing.
Default search hides non-repeatable sources. When an activity qualifier is also
an alias, search results and the simulation heading show it only in the grey
alias text. Empty-state suggestions are random
from the eligible pool; alias count was investigated and rejected as a popularity
proxy. Preserve visible wiki attribution and the code/data license split.

Use the Brutus [benchmark](../packages/loot-model/test/bench.tmp.ts) at 1M kills
for routine hot-path comparisons; 10M is an occasional scaling check. Warm up
and interleave baseline/candidate runs in one sitting. Historical absolute
millisecond figures drift with the machine and are not acceptance thresholds.
Check output as well as timing: changing loot is not an optimization.

## Maintaining this guide

Update the relevant section in place when behavior or scope changes. For a new
durable decision, record the choice, a short reason, important limitations, and
links to implementation/tests or source evidence. Keep detailed per-source
research in `docs/bosses/` and override notes. Let Git retain replaced prose.
Do not append session transcripts, repeated test totals, or historical corpus
counts. Routine agent instructions belong in `AGENTS.md`; the README serves
users and contributors.
