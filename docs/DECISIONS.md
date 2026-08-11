# Decisions

Running log of judgement calls the spec (`PROJECT_PLAN.md`) did not explicitly cover.

## Phase 0

- **`PROJECT_PLAN.md` lives at the repo root, not `docs/`.** The section 3 tree omitted
  it entirely; the root is where a repo's top-level spec is conventionally found and
  where the user asked for it to live.
- **`deploy.yml` and `ingest.yml` are not added in Phase 0**, even though section 13
  gives their full contents and section 3's tree lists them alongside `ci.yml`.
  Reason: `deploy.yml` runs on every push to `main` and would publish a placeholder
  site to GitHub Pages; `ingest.yml` invokes `ingest fetch`, which does nothing until
  Phase 2 builds the wiki client. Committing them now would mean CI green but a
  workflow that silently no-ops or a real deploy of an empty site — worse than adding
  each workflow in the phase that gives it something to do. Instruction 1 in section 0
  ("build in phase order, do not skip ahead") backs this reading. `ci.yml` ships now
  since Phase 0's done-criteria depends on it.
- **`ci.yml`'s "full validation suite over `data/`" step is deferred.** `ingest
  report` doesn't exist until Phase 2. `ci.yml` currently runs typecheck, lint, and
  test only; the validation step will be added alongside `ingest report`.
- **`apps/web`'s `App.tsx`/`main.tsx` are a placeholder shell**, not the search/boss
  view UI. Phase 0's job is a working Vite+React+TS scaffold that typechecks and has
  a passing (trivial) test; the actual UI is Phase 4 scope.
- **`packages/loot-model/src/index.ts` is an empty module** (`export {}` plus a
  comment). No schema, condition, formula, simulate, EV, or RNG code — that is
  Phase 1's explicit deliverable, and the task instructions for this phase said not
  to write any of it, even as stubs.
- **License copyright line uses the git author's name** (from `git config`) and the
  current year. No other identity information was available to attribute the MIT
  license to.

## Phase 1

### Model

- **`Table.withoutReplacement?: boolean`, defaulting to `false`.** Section 4.3 defines
  `rolls: number | Rate` without saying what a second roll draws from. Default is with
  replacement (independent draws, duplicates possible), which is what Zulrah's `rolls: 2`
  actually does and which keeps section 8's precomputed-cumulative-array binary search on
  the fast path. Barrows is the counterexample — a chest cannot hand you the same piece
  twice — and it lands in Phase 5, so the flag exists now while `data/` is still empty and
  adding a schema field costs nothing. Modelling it as a table-level flag rather than a
  general named-`pool` concept keeps the machinery to what section 4.6's "do not add more
  without justification" allows, and keeps "Barrows can't repeat" out of the simulator as a
  branch. Decision confirmed by the user before implementation.
- **"Without replacement" means renormalise over the remaining entries.** Equivalently:
  reroll on a collision. The implicit `nothing` remainder is not an entry, so it keeps its
  mass and can be hit repeatedly — only drawn entries leave the pool. The alternative
  reading (a collision yields `nothing`) is a different mechanic and is not implemented.
- **Schema refinements reject undefined combinations rather than guessing.**
  `withoutReplacement` requires `mode: 'weighted'` with a numeric `rolls > 1`; `preroll`
  tables are pinned to `rolls: 1` because "checked in order, first hit short-circuits" has
  no defined meaning when repeated; each mode is pinned to the rate kinds it can express
  (`always`↔`always`, `weighted`↔`weight`, `preroll`/`independent`↔`fixed`/`formula`);
  `rolls` may not be a `weight` rate. All objects are `.strict()`.
- **A `Rate` used as `rolls` means "roll this table once with probability p".** Section 4.3
  allows it without defining it. A Bernoulli roll count is the only reading that keeps
  `rolls` dimensionally a count.
- **A preroll hit suppresses only `preroll` and `weighted` tables later in the document.**
  Section 4.3 says a hit "short-circuits the whole table chain", but the same table also
  defines `always` as dropping "unconditionally" and `independent` as "rolled separately",
  and section 6.4 says Brutus' tertiary "can stack with the main drop". Those two modes are
  therefore not part of the main-drop chain. This is stated once, as a rule about modes
  (`suppressedByPreroll` in `compile.ts`) — never about a boss.
- **A nested table's chain is local.** A `preroll` hit inside a `tableRef` or `oneOf`
  sub-table does not suppress anything in the parent document.
- **`oneOf` nests exactly one level: its entries carry leaf nodes only.** zod 3 cannot infer
  a recursive schema without a hand-written type annotation, and the conventions require
  every type to be inferred. Section 5 already designates `tableRef` as the mechanism for
  nested tables, so deeper structure has a first-class home. If Phase 3 needs deeper inline
  nesting, swap in a `z.lazy` schema and accept the one annotation.
- **`oneOf` selects exactly one entry, normalised over the weights that survive condition
  filtering.** It has no `denominator` field, so the applicable weights are its denominator;
  there is no implicit `nothing` remainder inside a `oneOf`.
- **`ValidationResult` is `{ ok, checks: [{ check, ok, detail? }] }`** with `check` an enum of
  the six names in section 7. The spec references the type in 4.5 but never defines it.
- **`SimContext` is `{ members, ringOfWealth, onSlayerTask, questsComplete: string[],
  killCount, variant }`.** Inferred from the six condition kinds in 4.4. `questsComplete` is
  an array rather than a Set so the shape survives JSON round-tripping.
- **`killCount` is a static context value, not a counter that increments during a run.**
  Section 9 surfaces it as a UI control, which makes it a property of the run. Keeping it
  fixed is what allows conditions to be resolved once at compile time.
- **Items are indexed by `itemId` alone**, so noted and unnoted stacks of the same item share
  a tally slot. They are the same tradeable item and the gp arithmetic agrees.

### Implementation

- **`src/compile.ts` is a seventh module the section 3 tree does not list.** `simulate` and
  `expectedValue` walk the same compiled form, which is what stops the sampled and analytic
  models from drifting apart on what a table means. It belongs to neither file, so it is its
  own.
- **Formula stubs throw instead of returning 0.** Section 16 says "stubs are fine" for
  Phase 1. A stub returning 0 would sail through `ev_matches` and ship a boss that drops
  nothing; `FormulaNotImplementedError` fails loudly. Callers inject real implementations
  through `createFormulaRegistry`.
- **Weights exceeding the denominator throw at compile time**
  (`WeightsExceedDenominatorError`) rather than silently renormalising. `weights_sum` in
  section 7 is a per-condition-variant check, so the schema cannot catch it — Brutus'
  entries naively sum to 106 against a denominator of 81 and that is correct data.
- **`tableRef` resolves against an optional `options.tables` map with a cycle guard**, and
  throws `UnresolvedTableRefError` when the map has no entry. Phase 3 owns `data/tables/` and
  the `refs_resolve` validation check; the guard exists now only so the simulator is total
  and cannot hang.
- **Analytic EV for `withoutReplacement` enumerates draw orders, capped at 4 rolls.** Cost is
  O((entries + 1) ^ rolls); beyond the cap it throws `UnsupportedExpectedValueError` rather
  than hanging. Nothing in scope uses more than 2.
- **Prices are passed in, never stored in the model.** Section 6.1 lists the prices API as a
  separate source and they change daily; `data/bosses/*.json` would churn constantly. Both
  `simulate` and `expectedValue` take an optional `PriceLookup` and report 0 gp without one.
- **Tallies are `Int32Array` for drop counts and `Float64Array` for quantities.** 10M kills
  cannot overflow an int32 count, but 10M kills of a 1,000-unit stack exceeds 2^31.

### Brutus fixture

- **Section 6.4's F2P line does not add up as written, and the fixture uses the only
  reconstruction that satisfies all three stated totals.** The plan gives "armour 6 + runes
  30 + coins 25 (replacing seeds 15 and noted steaks 10) = 81", which is 61. Splitting the
  members "resources 30" into 10 members-only noted steaks and 20 shared resources yields
  members 6+30+15+10+20 = 81, F2P 6+30+20+25 = 81, and a naive merge of 106 — matching every
  number the plan states. Phase 2 must confirm this against the wiki.
- **Item ids, quantities and prices in the fixture are invented.** Section 6.4 gives table
  structure and weights only, and this session was not permitted to hit the wiki. Prices are
  tuned so the members variant lands on the wiki's stated 588.65 gp/kill (analytic 588.56,
  −0.016%). Phase 2's gate — "the generated Brutus matches the Phase 1 hand-written fixture"
  — therefore applies to structure, weights, modes and conditions, not to ids or prices,
  which the real fetch will overwrite.

## Phase 2 (snapshots and triage)

### Scope

- **Phase 2 was run as snapshots + triage only, with no parser.** Section 16 also
  lists "parser for standard bosses, validation suite, report writer" and a done-when
  of 15 verified bosses. Those were explicitly deferred by the task instructions for
  this session, so there is no `ingest parse`, no `data/bosses/`, and no
  `data/_report.json`. `apps/ingest` ships `verify-schema`, `fetch` and `triage`.

### VERIFY outcomes against the live wiki (2026-08-11)

- **There is no `drops` bucket.** Section 6.1's example query returns
  `{"error":"Bucket drops does not exist."}`. The real bucket is **`dropsline`**.
- **`dropsline` does not expose `item`, `quantity` or `rarity` as columns.** Its
  entire declared schema is `item_name` (PAGE), `drop_json` (TEXT, unindexed) and
  `rare_drop_table` (BOOLEAN), plus the implicit `page_name`. Quantity and rarity
  live inside the `drop_json` string as `Quantity Low` / `Quantity High` / `Rarity`.
  Section 6.1's premise — "Bucket gives you (item, quantity, rarity)" — is right in
  substance but wrong in shape: it is one JSON blob per row, not three columns.
- **`rare_drop_table` is a first-class boolean on every row**, which makes heuristic
  4 in section 6.5 (detecting RDT rows) far cheaper than the plan assumed.
- **Bucket schemas are discoverable** by enumerating namespace 9592 (`Bucket:`) and
  reading each page's JSON body. `ingest verify-schema` does this and diffs against
  `fields.ts`, so drift is a command away rather than a mystery.
- **The wiki's average kill value is not in any bucket.** It is rendered into the
  page by `Template:Average drop value` and must be parsed out of `action=parse`
  HTML. This resolves open question 5 in section 17: parsing, not Bucket.
- **`Rolls` is present per row** in `drop_json`, so multi-roll tables are declared
  by the wiki rather than needing inference.

### Judgement calls

- **Triage tiers A–E classify by how much machinery a page needs, not by
  correctness.** A is a clean single table, B needs `(m)`/`(f)` conditions, C reaches
  the rare drop table, D has a main table that overflows its denominator or
  unparseable rarities, E has no main table on the page at all.
- **A main table that sums *under* its denominator is not a failure.** Section 4.3
  says the remainder of a weighted table is an implicit `nothing`, so a shortfall is
  expected and legal. 53 of 172 pages look like this. Only *overflowing* the
  denominator is evidence of a defect — that is the Brutus case, and it is what the
  membership split resolves. An earlier stricter rule demanding an exact sum put 58%
  of the inventory in "needs review" and was wrong.
- **A denominator group needs at least 3 rows to count as the main weighted table**
  (`MIN_MAIN_TABLE_ROWS`). Otherwise a lone `1/100` tertiary drop reads as a table
  that fails to reconcile. Groups below the threshold are pre-roll or tertiary
  candidates and carry no obligation to sum.
- **The boss inventory is exactly what `Category:Bosses` returns, unfiltered.** That
  includes non-boss pages the category carries, such as `Boss` and `Boss kill count`.
  They fall into tier E on their own merits. Filtering them would mean substituting
  judgement for the wiki as the source of the inventory.
- **Wiki-derived rows never leave `data/`.** Unit fixtures under `apps/ingest/test/`
  are synthetic and mimic only the response shape; the assertions about real Brutus
  weights read `data/snapshots/`, which is gitignored, and skip when it is absent.
  Copying live drop rows into `apps/` would put CC BY-NC-SA content under MIT.
- **Unknown `drop_json` keys are recorded as drift, not thrown.** Envelopes are
  strict Zod and fail loudly; a new cosmetic key inside the blob should not abort a
  172-page fetch. Drift is surfaced in `docs/TRIAGE.md`.
- **Etiquette:** one serial request queue for the whole process, 1000ms apart,
  `maxlag=5`, retry with backoff on 429/5xx and on MediaWiki lag errors. The full
  run was 182 requests with zero errors.

### Contradiction to resolve before Phase 5

- **The wiki now states Brutus' average members kill is worth 597.57 gp, not the
  588.65 in sections 6.4 and 7.** The figure is GE-price driven and moves. The
  `ev_matches` check must read this number from the snapshot at validation time
  rather than hard-coding it.

## Loot-source reclassification (6.1)

- **The unit of work is a loot source, not a boss page.** `data/_inventory.json` maps
  boss pages to loot sources many-to-one: nine Barrows pages resolve to one
  `Chest (Barrows)`, seven Chambers of Xeric pages to one `Ancient chest`. Counting
  pages overstated the work and hid the fact that two of the largest tier-E clusters
  are single clean tables.
- **An encounter is detected by `infobox_activity`, never from memory.** A category
  shared by two or more tier-E pages counts as an encounter only when the page of the
  same name carries an `infobox_activity` row. That is what separates Chambers of Xeric
  from "Content released in 2007", "Wights" or a quest name — all of which are also
  shared by several boss pages, but whose members own their loot outright. Six
  encounters were confirmed this way.
- **Reward pages are discovered per page, not per encounter.** The first version
  searched only the encounter page's links and missed the Moons of Peril entirely:
  Blood, Blue and Eclipse Moon are categorised under `Neypotzli`, which is not an
  activity, while their own pages link `Lunar Chest` (24 rows). Searching every
  tier-E page's own wikitext for a `chest|reward|loot|casket` link, then testing each
  distinct candidate for drop rows, recovered `Lunar Chest`, `Reward Cart` (75 rows)
  and `Reward pool` (52 rows) as well.
- **Canonical page names come from the data, not the link text.** MediaWiki link
  targets are case-insensitive on the first letter, so `[[reward pool]]` is a valid
  link to "Reward pool". Taking the title from the first row's `page_name` avoids
  loot sources named in lower case.
- **Candidate lookups are snapshot-first.** `ingest sources` re-reads
  `data/snapshots/dropsline/` when a candidate is already cached, so re-running after
  a bug fix costs no requests. This is section 6.3 applied to the command that
  discovers pages rather than the one that fetches them.
- **Tier E splits four ways, not three.** `component` (part of an encounter with no
  drop rows anywhere — point-based rewards) and `no-loot-data` (no rows, no encounter,
  no reward page — hub and meta pages like `Boss kill count` or `Dagannoth Kings`) are
  both excluded, but conflating them would file `Boss kill count` as a raid component.
  `reward-page` and `trivial` are kept.
- **A `trivial` source is complete, not deficient.** Its whole drop table is a handful
  of `Always` rows, which is a valid `always` table and needs no weighted machinery.
  These triage as tier E because they have no main table, and they still count toward
  the gate.

### Note on the plan

At the time of this work `PROJECT_PLAN.md` on disk was unchanged from its original
version: section 6.1 still described a `drops` bucket with `item`/`quantity`/`rarity`
columns, section 7 still hard-coded 588.65, and section 16's Phase 2 gate still read
"at least 15 bosses at `status: 'verified'`" — pages, not loot sources. The
reclassification above was carried out against direct instructions rather than against
plan text, and the gate is reported as a measured number rather than as pass/fail.

## Mechanics watchlist and the Brutus fixture rebuild

- **`data/mechanics-watchlist.json` + the `not_on_watchlist` check.** Some loot sources
  have a mechanic that is simply not present in their drop rows. Parsing them cleanly
  proves nothing, because the rows never encoded the thing that matters. The check fails
  for any listed source, forcing `needs_review` however well everything else validates.
  Seeded with `lunar-chest` (uniques drawn without replacement), `reward-cart` and
  `reward-pool` (rolls scale with activity points). `not_on_watchlist` was added to
  `VALIDATION_CHECKS` in the loot model.
- **Exclusion audit: 37 of the 42 `no-loot-data` pages carry a real combat level.** Only
  five are genuinely not monsters — `Boss`, `Boss kill count`, `Dagannoth Kings`,
  `Royal Titans`, `Wrathmaw` and `Arzinian Being of Bordanzan`. The rest are mostly quest
  bosses that really do drop nothing. Suspicious cases are listed in the session report;
  `Sol Heredit` and `Penance Queen` are the strongest candidates for having loot the
  pipeline has not found.
- **Encounter membership can also come from a reciprocal link to an activity.** Blood,
  Blue and Eclipse Moon are categorised under `Neypotzli`, which is not an activity, so
  neither the category rule nor the reward-link scan reached them, and all three were
  wrongly excluded as `no-loot-data`. They each link `Moons of Peril`, which is an
  activity and already resolved to `Lunar Chest`. Three constraints are all required to
  avoid false positives: the link must resolve to a reward-page source, it must be
  reciprocal (Tarn mentions Barrows one-way), and the target must itself be an activity
  (Xamphur and Vasa Nistirio cross-reference each other as Kourend characters). With all
  three, exactly the three Moons are re-homed.
- **The Brutus fixture now matches the snapshot.** Pre-roll is 10/150 across three
  entries, two members-only, not a single 1/150; the members' steak slot is three
  unnoted steaks, not ten noted; tertiary is beginner clue 1/15, easy clue 1/40 (m) and
  beef 1/1,000 (m). Item ids come from `bucket('item_id')`.
- **`bucket('item_id')` does not resolve every dropped item.** It caps at 5,000 rows per
  query and needs offset paging, and clue scrolls return the literal string `"N/A"`
  because one page covers many ids. The fixture records easy clues as id 0 to mark them
  unresolved rather than inventing one. `items_known` needs a rule for this before it can
  be meaningful.
- **The wiki's 597.57 cannot be recomputed from bucket data.** Summing rarity times the
  snapshot's own `Drop Value` field over Brutus' rows gives roughly 268 gp/kill, not
  597.57. Whatever `Template:Average drop value` does, `ev_matches` cannot reproduce it
  from `dropsline`; it has to read the rendered figure and compare, and the fixture's
  prices remain invented and tuned to match it.
- **The Brutus convergence test uses a relative tolerance.** The bottomless milk bucket
  is 9,000 gp at 4/150 and dominates the variance — one standard error across a million
  kills is about 1.5 gp, so the previous absolute `toBeCloseTo(…, 0)` (±0.5) would fail
  on sampling noise rather than on a defect. It now asserts agreement within 1%.
