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

## Suspicious-exclusion follow-up: Sol Heredit and the Inadequacy group

- **Sol Heredit has real loot; the inventory pipeline missed it, and the reason is
  identified.** His page has no `==Drops==` section and no `[[...]]` link to a reward
  container — his loot is referenced from the *parent* "Fortis Colosseum" page via
  `{{Main|Rewards Chest (Fortis Colosseum)}}`, a template call, not a wikilink.
  `Rewards Chest (Fortis Colosseum)` itself has **170 `dropsline` rows** and was never
  fetched, for a specific, traceable reason: `MIN_ENCOUNTER_MEMBERS = 2`
  (`apps/ingest/src/inventory/build.ts`) only tests a category as a candidate encounter
  when at least two tier-E pages share it, and Sol Heredit is Fortis Colosseum's only
  boss page in the 172-page inventory. The category was therefore never tested for
  `infobox_activity`, never confirmed as an encounter, and its wikitext — which does
  link the reward chest — was never fetched. `extractLinks` also only matches `[[...]]`
  wikilinks, so even fetching Fortis Colosseum's wikitext would need a second fix to
  catch the `{{Main|...}}` form. Not fixed this session, since the task asked for
  diagnosis before starting the parser; both fixes are mechanical (drop or parametrise
  the member-count threshold for single-boss activities; extend the link scan to
  `{{Main|...}}` targets) and belong in a follow-up `sources` pass alongside a
  request-cost check, since lowering the threshold will trigger many more
  `infobox_activity` lookups.
- **The Inadequacy / The Untouchable / The Everlasting / The Illusive share one parent:
  the quest `Dream Mentor`.** `Dream Mentor` is not an `infobox_activity` page and has
  zero `dropsline` rows of its own. `The Inadequacy`'s wikitext has no `==Drops==`
  heading and no `DropsLine` template at all — not merely empty, entirely absent. All
  four are quest-only combat encounters (each representing a combat style, per Dream
  Mentor's quest design) and are genuinely lootless. Their `no-loot-data` classification
  is correct as-is; no further discovery work is needed for this group.

## Phase 3 parser

### Scope and what "verified" means this session

- **Nothing reaches `status: 'verified'` in this session, by design.** `ev_matches`
  cannot run — Phase 3's own investigation (below) found the wiki's stated average
  kill value is not reliably derivable from data this pipeline can see. Every parsed
  boss is `needs_review` even when every other check passes; `validation.ok` still
  distinguishes structurally-clean parses from ones with real failures, so the report
  isn't flattened to a single undifferentiated bucket.
- **The parser reads wikitext, not the `dropsline` bucket.** Bucket rows lose three
  things the parser needs: the heading text itself (mode inference, 6.5 heuristic 3),
  quantity qualifiers like "(noted)" (the source of the Phase 2 Brutus bug), and
  unambiguous template parameter names in place of a rendered `drop_json` blob.
  `apps/ingest/src/parse/wikitext-drops.ts` extracts `{{DropsLine}}` /
  `{{DropsLineClue}}` / `{{DropsLineReward}}` calls directly.

### The ev_matches investigation (before any parser code was written)

- **The wiki's `Drop Value` bucket field is the row's High Alch value, not its GE
  price.** Cross-checked against the rendered page's own `Price` / `High Alch`
  columns: e.g. Cow slippers shows `Price=1,852` / `High Alch=600`, and the bucket's
  `Drop Value` is 600. Every earlier session's price computation that used `Drop
  Value` as if it were a market price was reading the wrong column.
- **Four independent, honestly-computed figures for Brutus (members) bracket 268 to
  586 gp/kill; none reproduces 597.57.** Using live GE prices instead of `Drop Value`
  gets close (586, flat sum) to very close (555, correctly modelled with preroll
  suppression) — but excluding genuinely untradeable items (`gemw=no` in the
  wikitext, "Not sold" on the rendered page: the milk bucket, Mooleta, Beef) moves
  *away* from the target (331), not toward it. Template:Average drop value assigns
  untradeable rares some value that is not exposed anywhere in bucket data or the
  rendered Price/Alch columns. Full reasoning lives in
  `packages/loot-model/test/fixtures/brutus.ts`'s header comment.
- **Conclusion: `ev_matches` cannot be made a blocking structural check on data this
  pipeline can see.** It is wired into the checks list but always reports
  `ok: false, "not run"` this session, rather than being silently omitted or forced
  to pass.

### items_known and the item index

- **`itemId` is `number | null`; a new required `itemKey` (page-name slug) is the
  stable identifier.** `0` is never used as a sentinel — it is a valid item id
  (confirmed by a dedicated schema test) and using it as "unresolved" would be
  indistinguishable from a real id 0. `itemKey` is what `items_known`, the multi-id
  allowlist (`data/item-multi-id-allowlist.json`), and the compiled item index
  (`ItemIndex` in `compile.ts`) all key off.
- **`itemKey` is a GLOBAL item slug, not boss-scoped.** The Brutus fixture originally
  used `brutus:bull-bones`-style keys; corrected to `bull-bones`, because the same
  real-world item (Coins, Iron platebody) drops from many bosses and `items_known`
  needs one identity per item across the whole corpus, not one per boss's table.
- **`bucket('item_id')` does not collapse a multi-id page into one row with a
  multi-element `id` array — it emits one ROW PER ID, all sharing `page_name`.**
  "Cow slippers" is four separate rows (ids 33093/33096/33097/33098), not one row
  with `id: [4 values]`. A naive page-name-keyed map silently keeps only the last
  row and is indistinguishable from a clean single-id resolution — this was caught
  by the checks this session built, not by exercising them, and fixed by aggregating
  every row per page before deciding whether it resolves
  (`apps/ingest/src/items/index.ts`). 2,709 of 12,935 item pages are genuinely
  multi-id or unresolvable after the fix (up from a wrongly-optimistic 1,230 before
  it).
- **Item id lookups page past the 5,000-row cap via `.offset()`**, confirmed to work
  on the live API. The full index is 4 requests.

### The Sol Heredit / Inadequacy follow-up (before the parser)

- Findings recorded above under "Suspicious-exclusion follow-up".

### The parser itself

- **Heading text is checked before inferring mode from denominator shape, not
  after.** Brutus' real pre-roll rows (5/150, 4/150, 1/150) all share denominator
  150 — indistinguishable in shape from a weighted table. An earlier draft of the
  parser inferred from denominators first and only used heading text as a
  tie-breaker for ambiguous cases, which silently misclassified this pre-roll as
  `weighted`. Fixed by checking `Pre-roll`/`Tertiary`/`Secondary` heading keywords
  before ever looking at denominators, matching 6.5 heuristic 3's stated order.
- **A "Drops"/"Rewards" section is found by heading SUBJECT, at any heading level,
  and a page can have more than one.** Three real pages broke a naive
  `==Drops==`-only, H2-only, single-section assumption: Gemstone Crab's is
  `===Drops===` (H3, not H2); Barrows' chest page has no "Drops" heading at all, only
  `==Rewards==`; Scurrius splits `==Drops (MVP/Solo)==` from `==Drops (non-MVP)==`.
  Matching had to be tightened to require Drops/Rewards as the heading's actual
  subject (`/^(the\s+)?(drops?|rewards?)\s*(\(.*\))?$/i`) after a looser
  contains-the-word version wrongly also matched Barrows' unrelated "Reward
  mechanics" section (rolls math and citations, no drop rows) and merged its content
  in.
- **Heading nesting deeper than a section's shallowest level collapses into its
  nearest ancestor, rather than becoming its own group.** Barrows nests six
  per-brother `====Ahrim's====`-style H4 groups inside one `===Pre-roll===` H3. Each
  brother's four items sharing one denominator (1/2448) would otherwise become six
  separate misleading "weighted" tables instead of one 24-entry preroll table. Fixed
  by computing the section's minimum heading level and grouping only at that level.
- **A boundary-slicing bug lost the leading newline a nested heading needs to match
  at all**, when a "Drops"/"Rewards" section's first sub-heading immediately follows
  the parent heading with no blank line between them (no prose or templates in
  between). The parent heading's own regex match consumes its trailing `\n`; slicing
  from `contentStart` drops that character, leaving the child heading with nothing
  before it to match against. Fixed by keeping one character of overlap when
  slicing. Caught by a hand-written test with no blank line, not by the real-page
  cases, which all happen to have a blank line.
- **`DropsLineReward`, not `DropsLine`, is the template Barrows' chest page uses** —
  same parameter shape, different name. Recognizing only `DropsLine`/`DropsLineClue`
  silently produced zero table entries for an otherwise well-formed page.
- **`{{DropsLineClue}}`'s `f2p=yes` parameter is not trusted as a membership
  marker.** Brutus' own easy-clue row sets it, yet the rendered page's `Name Notes`
  (and the `dropsline` bucket) mark that exact row members-only. Whatever `f2p=`
  controls is not reliably this drop's actual membership restriction; only the
  rendered `(m)`/`(f)` marker text is trusted.
- **Known, un-fixed gaps, left as `needs_review`/`parse_failed` rather than forced:**
  Chambers of Xeric's "Ancient chest" reward has no `{{DropsLine}}`-shaped content at
  all — it needs the `cox_points` formula and does not fit this parser's model.
  Revenant maledictus and The Mimic also produced no matching template calls and are
  parse-failed rather than guessed at. Duke Sucellus and Zalcano parse structurally
  (their bucket-visible rows do reconcile) but their real access mechanics —
  Duke Sucellus's sequential roll-until-success chain, Zalcano's full points scaling
  — are described only in prose the parser does not read; a clean structural parse
  for these two is not evidence of a correct model and both should be added to the
  mechanics watchlist before Phase 5 rather than trusted.

## Follow-up session: ev_matches retry, status logic, discovery waiver

### ev_matches retried with live GE prices — still does not converge

- **Built `apps/ingest/src/prices/ge-prices.ts`**: snapshot-first fetch of
  `prices.runescape.wiki/api/v1/osrs/latest`, joined strictly by `itemId` from the
  item index (never guessing among a multi-id item's several ids, even when one of
  them has a live price). A missing entry prices at 0 — which naturally, correctly
  handles `gemw=no` items, since genuinely untradeable items (Bull bones, Mooleta,
  Beef) simply have no GE listing at all; confirmed directly against the live data.
- **Result for the real parsed Brutus, members: 313.70 gp/kill vs the wiki's 597.57
  — 47.5% off. Does not converge.** F2P: 247.83 vs 597.57, 58.5% off.
- **The residual gap traces almost exactly to the Bottomless milk bucket's High
  Alch value (~9,000), not zero.** `(597.57 − 313.70) / 0.0258 expected qty ≈
  11,003`, the same order of magnitude as its High Alch of 9,000. This means
  `Template:Average drop value` does NOT treat `gemw=no` as "worth 0" — it falls
  back to something like High Alch for untradeable rares. The instruction's
  hypothesis ("gemw=no at zero") is testably wrong for reproducing the wiki's
  figure, even though it is the mechanically correct GE valuation.
- **Per the accept condition, `ev_matches` stays non-blocking / advisory.** It is
  computed for real now (not "not run") whenever a rendered-page snapshot exists,
  and its result is reported, but it never gates `verified`. The Brutus fixture is
  NOT rebuilt with "real" prices — the specified methodology (GE price, gemw=no at
  zero) does not produce a validated figure to rebuild it against.
- **`extractAverageKillValue` (in `apps/ingest/src/validate/ev-matches.ts`) needs a
  rendered-page snapshot**, which most sources do not have (only `fetch --page` and
  a handful of manually-investigated bosses fetched one this session). `ev_matches`
  correctly reports "no rendered page snapshot available" rather than silently
  passing for everything else.

### Status logic: `verified` now depends only on deterministic checks

- **`verified` requires `weights_sum`, `refs_resolve`, `rates_valid`, `qty_sane`,
  `items_known`, `not_on_watchlist`, AND zero ambiguous-mode guesses — never
  `ev_matches`.** `ev_matches` depends on live GE prices that move day to day and
  was found non-convergent this session, so a pass today would be a moving target,
  not a structural fact about the parse; it is computed and reported but excluded
  from the gate. `validation.ok` still reflects every check including the advisory
  one, so status and `validation.ok` can diverge on purpose — a `verified` boss with
  a failing `ev_matches` still shows that failure in `validation.checks`.
- **`AssembleResult` now separates `ambiguousGroups` from `warnings`.** A group
  whose mode was a guess (heuristic 5's "heterogeneous denominators, no keyword"
  case) is a distinct signal from an item-resolution gap, and it blocks `verified`
  on its own — a guess staying right by luck is not the same thing as a check
  confirming it.
- **Result: 0 of 26 tier-A sources reach `verified`, even under the corrected
  logic.** This is not a bug in the fix — every single source has a real,
  legitimate blocker. The two dominant causes, checked directly against
  `data/_item-index.json`:
  - **Dose-suffixed consumables systematically fail to resolve** — "Prayer potion(3)",
    "Super combat potion(2)", "Blighted super restore(4)" and similar are not in the
    item index under that exact page-name slug. Needs investigation before Phase 5:
    likely a page-name-format mismatch (the wiki's actual page might not carry the
    dose suffix the same way), not a true multi-id case.
  - **The "Unique(s)" heading is the single most common ambiguous-group trigger**
    across wilderness-style bosses. Checked whether it is safe to hardcode as a
    known preroll keyword (parallel to Pre-roll/Tertiary/Secondary) by searching for
    "at most one item" confirming prose across ten bosses carrying the heading:
    **only Vet'ion and Venenatis have it.** Spindel, The Nightmare, Duke Sucellus,
    Vardorvis, The Whisperer, The Leviathan, Artio and Calvar'ion do not. The
    heading is NOT a reliable signal on its own; leaving it as an ambiguous guess
    (current behaviour) was the right call, not a gap to close by widening the
    keyword list. This was a real check, not an assumption — worth knowing before
    anyone is tempted to "fix" the ambiguous-group count by trusting the heading.

### Discovery: {{Main|...}} edge and the MIN_ENCOUNTER_MEMBERS waiver

- **`{{Main|Target}}` is now a discovery edge, same standing as a `[[...]]`
  wikilink**, in `extractLinks`/`extractMainTargets`. This is how Fortis Colosseum
  points at its own reward page — `{{Main|Rewards Chest (Fortis Colosseum)}}` — a
  template call a wikilink-only scan cannot see.
- **`MIN_ENCOUNTER_MEMBERS` is waived for a category that is also something a tier-E
  page links to directly.** Sol Heredit is the only tier-E page in "Fortis
  Colosseum" — never enough to clear the member-count bar alone — but his own page
  links `[[Fortis Colosseum]]` in its infobox and prose. `isActivityCached` still
  has the final say on whether a waived candidate is a real encounter; the waiver
  only decides what gets tested, not what passes.
- **Required reordering the discovery pipeline**: tier-E pages' own wikitext (and
  therefore their outbound links) now has to be read BEFORE deciding which
  categories are worth testing, not after encounter detection as before. The
  fetch itself is unchanged in cost — it was already happening, just later — and is
  now cached and reused for the reward-link scan rather than re-read.
- **Recovered 8 new encounters**: Fortis Colosseum, Barbarian Assault, Dagannoth
  Kings, Inferno, Nightmare Zone, Royal Titans, Treasure Trails, TzHaar Fight Cave.
  **3 of the 8 resolved to a real reward-page source**: Fortis Colosseum → Rewards
  Chest (Fortis Colosseum, 170 rows, recovers Sol Heredit), Tombs of Amascut →
  Chest (Tombs of Amascut, 50 rows), Theatre of Blood → Monumental chest (52 rows,
  recovers Verzik/Sotetseg/Xarpus/etc). **The other 5 (Barbarian Assault, Dagannoth
  Kings, Inferno, Nightmare Zone, Royal Titans) correctly stayed `component`** —
  confirmed as real activities, no reward-table page found linked from them, so
  they were not force-matched to anything. This is the safety behaviour working as
  intended, not a shortfall.
- Treasure Trails and TzHaar Fight Cave surfaced real pages (the six clue reward
  caskets: beginner through master, 77–279 rows each) but resolved no bosses in the
  172-page inventory, since no boss page belongs to either category — the rows are
  now snapshotted for whenever tertiary clue-scroll drops need parsing, but caused
  no reclassification.
- **Net: 172 pages → 142 loot sources (unchanged count, since the newly-recovered
  pages folded into existing or newly-created sources), reward-page classification
  27 → 40 pages, `no-loot-data`/`component` 51 → 40 pages combined.**

### The Mimic: found and partially fixed a second heading-matching gap

- **The Mimic's headings are "Elite drops" and "Master drops" — qualifier BEFORE
  "drops", not after.** `DROPS_SECTION_TITLE` only allowed a trailing parenthetical
  qualifier (`Drops (MVP/Solo)`), not a leading word. Broadened to
  `/^(?:\S+\s+)?(drops?|rewards?)\s*(\(.*\))?$/i` — requires "drops"/"rewards" to be
  the heading's last significant word either way, which is exactly what still
  correctly rejects "Reward mechanics" and Revenant maledictus' "Drop mechanics"
  (prose sections, no table, caught the same way in both cases).
- **This surfaced a genuinely new, unsolved problem: The Mimic still fails to
  parse, now for a specific and different reason.** Its "Elite drops" and "Master
  drops" sections each have their own `===Tertiary===` sub-heading. Sub-heading
  grouping is keyed by title text alone, so both `Tertiary` blocks — one from Elite,
  one from Master — merge into a single group, mixing an `Always`-rate row from one
  table into an `independent`-mode table built for the other's fixed rates, which
  the schema correctly rejects. Not fixed this session: doing so needs sub-headings
  qualified by their parent top-level section, which is a real (if contained)
  restructuring of `groupByHeading`, not a one-line change.

## Follow-up session 2: hybrid pricing, watchlist expansion, item-index rebuild

### ev_matches, final attempt — hybrid GE+High-Alch pricing, still short, now closed

- **Tested the specific hybrid the earlier diagnostic predicted: GE price for
  tradeable items, High Alch (from `dropsline`'s own `Drop Value` field) for
  `gemw=no` items, with pre-roll suppression modeled as usual.** Built
  `apps/ingest/src/prices/hybrid-prices.ts` (`highAlchByItemName` +
  `applyHighAlchOverride`) to compute this against the hand-verified Brutus
  fixture (not the freshly-parsed boss — see below for why).
- **Result: 570.58 vs 597.57 — 4.52% off.** Closer than the strict-zero GE
  test (313.70, 47.5% off) and consistent with the earlier diagnostic
  (the milk bucket's implied value was within the same order of magnitude as
  its ~9,000 High Alch), but still outside the ~2% bar.
- **Per explicit instruction, this closes the investigation: `ev_matches`
  stays non-blocking, permanently, not just for this session.** No further
  pricing theory should be tried without being asked. Three independent
  methodologies (`dropsline`'s `Drop Value` field alone, strict live GE,
  GE+High-Alch hybrid) have now been tried and none reproduces the wiki's
  own stated figure within tolerance.
- **The hybrid test used the fixture, not the freshly-parsed boss, because
  `PriceLookup`'s signature (`itemId: number | null → number`) cannot
  distinguish which unresolved item is being priced.** The Bottomless milk
  bucket is `itemId: null` in the real parsed output (page-name mismatch:
  the wiki page is "Bottomless milk bucket", not "…(empty)"), so a
  itemId-keyed override map can never reach it through the real parse. The
  fixture's hand-verified (if partly guessed) ids made the hybrid hypothesis
  testable at all. This is a real architectural limit worth remembering: any
  future price-dependent check that needs to treat specific unresolved items
  specially cannot do it through `PriceLookup` alone.

### Mechanics watchlist: three more sources added

- **`chest-tombs-of-amascut`, `monumental-chest`, `rewards-chest-fortis-colosseum`
  added**, all point-scaled or invocation/wave-scaled mechanics invisible in
  their `dropsline` rows. `chest-tombs-of-amascut` and `monumental-chest`
  confirmed firing `not_on_watchlist` once their wikitext was fetched.
  `rewards-chest-fortis-colosseum` has never actually exercised the check —
  it fails upstream, at schema assembly, because its page is structured by
  wave number (`Wave 1`…`Wave 12`) and does not fit any of the four
  canonical modes; the watchlist entry is correct and will engage once that
  page can be assembled into a `Boss` doc at all, which needs either a new
  mode or a Phase 5 override, not a parser fix.

### Item resolution: two real bugs found and fixed, item index rebuilt on `infobox_item`

- **`bucket('item_id')`'s `page_name` collapses every dose/charge of an item
  onto one shared page.** "Prayer potion(3)" was never a page-name-format
  mismatch — the wiki's `item_id` bucket only has "Prayer potion" (no dose
  suffix, four ids, one per dose, with no way to tell from `item_id` alone
  which id is which dose). Switched the item index's primary source to
  `bucket('infobox_item')`, which has one row per item VERSION and an
  `item_name` field that matches a `{{DropsLine|name=...}}` value exactly —
  confirmed this resolves "Rune arrow", "Blighted super restore(4)" and the
  four Prayer potion doses correctly. `bucket('item_id')` is kept as a
  fallback for any name `infobox_item` has no row for.
- **This immediately surfaced a second, real regression: `item_name` is not
  globally unique.** Special-game-mode reskins render identical display text
  to the standard item — "Coins" collided 4 ways (base item plus three
  minigame currency reskins: Shilo Village, Mage Training Arena, My Arm's Big
  Adventure), "Prayer potion(3)" collided with its Last Man
  Standing-restricted counterpart. In every collision checked, the standard
  item's `page_name` carries no parenthetical qualifier while every
  special-mode variant's does — `default_version` (which looks like it
  should disambiguate this) is empty/unpopulated for all of these and cannot
  be used. Fixed with a general rule in `items/index.ts`
  (`resolveWithUnqualifiedPagePreference`): when a name collides, resolve to
  the one candidate with an unqualified `page_name`, but only if there is
  exactly one such candidate. Verified against Cow slippers (four real
  colour variants, all with the *same* unqualified page name "Cow slippers")
  that this does not misfire into guessing a genuinely ambiguous item — four
  unqualified candidates correctly stays unresolved.
- **Clue scroll allowlist expanded from one tier (easy) to all six**
  (beginner/easy/medium/hard/elite/master). All six have the identical
  shape under `infobox_item` — 13 to 189 distinct ids each, one per live
  clue instance — and the "easy"-only allowlist was an oversight from when
  the allowlist was first seeded with a single example rather than the full
  set sharing that property.
- **Net effect on the item index**: schema bumped `itemIndexVersion` 1 → 2
  (`pageName` → `itemName`, added `source: 'infobox_item' | 'item_id'`).
  15,508 entries (up from 12,935), 2,997 unresolved after the collision fix
  (down from 3,583 immediately after the naive `infobox_item` switch, which
  had temporarily made things worse before the unqualified-page-name rule
  was added).
- **Net effect on tier A: 0 → 3 verified** (Branda the Fire Queen, Chest
  (Barrows), Eldric the Ice King), all confirmed clean on every deterministic
  check with only the (correctly non-blocking) `ev_matches` advisory note
  attached. 20 sources remain `needs_review` — dominated by the "Uniques"
  heading ambiguity (13 sources, but only 2 with no other co-occurring
  blocker) and an unparsed `{{Brimstone rarity|N}}` template (at least 8
  sources, not investigated this session).

### Housekeeping

- **`data/bosses/the-mimic.json` and a stale `data/bosses/brutus.json` were
  found reflecting pre-item-index-v2 parser state** (written before this
  session's item-resolution fixes) and were regenerated by a fresh
  `ingest parse` run before this session ended, since `ingest parse` never
  deletes a stale file for a source that stops producing one — see
  `plan/HANDOFF.md` landmine #6.
- **`plan/` created at repo root, gitignored, holding a local copy of
  `PROJECT_PLAN.md` and `plan/HANDOFF.md`** — a session-handoff document for
  a fresh Claude session with no prior context. Not a substitute for this
  file; written to point back here for anything already logged.

## Rarity-template registry, and `{{Brimstone rarity|N}}` as its first entry

- **Built `apps/ingest/src/parse/rarity-templates.ts`: a `Map<templateName,
  evaluator>` registry, not a Brimstone special case.** A `rarity=` value that
  is itself a `{{Template|...}}` call (rather than a literal `Always`/`N/M`)
  is looked up by lowercased template name in `build-tables.ts`'s
  `parseRarity`. An unregistered name is reported as `unrecognised rarity
  template '<name>'` through the same `ambiguous`/`unparseable rarity`
  channel a malformed literal already uses, distinguishable in the message —
  never silently dropped, never guessed at. Adding a second template later is
  one registry entry, not a new branch anywhere in the parser.
- **`{{Brimstone rarity|N}}`'s value is a parse-time constant, not a
  `Rate.formula`.** Investigated against the 18 wikitext snapshots that carry
  it (`grep -rl "Brimstone rarity" data/snapshots/wikitext/`): `N` is the
  killed monster's combat level, a fixed number baked into the page's own
  `{{DropsLine}}` call, not a `SimContext` value read at simulate time. Fit
  the wiki's own pre-resolved `dropsline` bucket `Rarity` field (e.g.
  Vardorvis 784 -> 1/50, Artio 320 -> 1/56, Ahrim 98 -> 1/100) and recovered
  the exact formula: `base = max(50, 100 - floor(max(0, combatLevel-100)/5))`,
  with `bonus=yes` (Grotesque Guardians only) applying `floor(base * 0.8)`.
  Matches all 18 known `(combatLevel, resolved rarity)` pairs exactly, zero
  remainder — confirmed as the real game formula, not a curve fit of
  convenience. What IS runtime-dependent is whether the drop can happen at
  all: every single one of the 18 `DropsLine` calls carries a `raritynotes`
  footnote restricting it to a Wilderness-Slayer task from Konar quo Maten.
  That is exactly the existing `{ kind: 'onSlayerTask', value: true }`
  condition (PROJECT_PLAN.md 4.4) — no model or formula-registry change
  needed, just attaching a condition the schema already supports.
- **`parseTemplateCall` (`wikitext-drops.ts`) now assigns positional
  params `"1"`, `"2"`, ... when a part has no `=`**, needed because
  `{{Brimstone rarity|784}}`'s only argument is positional; every existing
  caller (`{{DropsLine|...}}`) uses named params exclusively, so this is
  additive and did not change any existing behaviour. Exported so
  `rarity-templates.ts` can reuse it instead of re-parsing template calls.
- **`ParsedEntry` gained `extraConditions?: Condition[]`**, threaded from
  `parseRarity`'s resolution through every `toEntry(...)` call site in
  `buildTableGroups`, and merged into the entry's final `Condition[]` in
  `assembleBoss`'s `conditionsFor` (previously only `members`/`freeToPlay`).
  This is the general mechanism a rarity template can use to add a condition;
  Brimstone rarity's `onSlayerTask` is the only user of it so far.
- **Re-ran `ingest parse --tier A` after the fix. Verified count is
  unchanged at 3/26** — no tier-A source was blocked by Brimstone rarity
  *alone*; the ones that carry it (Duke Sucellus, The Leviathan, The
  Whisperer, Vardorvis, and four wilderness bosses already needs_review for
  the "Uniques" ambiguity) all have at least one other, independent blocker.
  `needs_review` dropped 20 -> 16 and `parse_failed` rose 3 -> 7 — a real
  count regression, explained below, not a sign the fix is wrong.
- **Follow-up discovered by this fix, not resolved: an "Always" entry sharing
  a `Tertiary` heading with a fixed-rate entry now hits a genuine schema
  wall.** Vardorvis' `Tertiary` section has `Temple key (Desert Treasure II)`
  at `rarity=Always` (quest-variant-only) in the same heading block as
  `Brimstone key`. `Tertiary` forces `mode: 'independent'`
  (`INDEPENDENT_HEADINGS`), but the schema pins `independent` entries to
  `fixed`/`formula` rates only (see the Phase 1 schema-refinements entry
  above) — `always` is not among them. Previously this was invisible: the
  whole block short-circuited earlier as `ambiguous: 'unparseable rarity'`
  with `entries: []`, which `assembleBoss` filters out of `tableInputs`
  before the schema ever sees it, so the boss still assembled (as
  `needs_review`, not `parse_failed`). Now that Brimstone key resolves, the
  block has real entries and the schema rejects the mix outright, turning
  Duke Sucellus, The Leviathan, The Whisperer and Vardorvis from
  `needs_review` into `parse_failed` — a net loss of assembled bosses even
  though no data is being silently dropped anymore (the opposite problem).
  **The Mimic's `parse_failed` is the same error signature but a pre-existing,
  unrelated cause** — landmine #5's Elite/Master `Tertiary` sub-heading merge
  — and is what the next task (`groupByHeading` restructuring) addresses;
  fixing it will not touch the other four. Not fixed this session: it needs a
  decision (allow `always` inside `independent` in the schema, since
  "always" trivially satisfies "rolled separately, can stack"? or split a
  mixed heading block by rate kind before mode inference?) that wasn't asked
  for and belongs with whoever owns the schema refinement call.

## Phase 6 research item: wave-structured mechanics — checked whether Inferno,
   Fight Caves, Barbarian Assault, Nightmare Zone share Fortis Colosseum's shape

No code this session; research only, against local wikitext snapshots
(`data/snapshots/wikitext/{inferno,tzhaar-fight-cave,barbarian-assault,
nightmare-zone}.json`).

- **None of the four share Rewards Chest (Fortis Colosseum)'s wave-indexed
  loot-chest shape.** That page is the outlier: explicit `Wave 1`
  through `Wave 12` headings, each with real `{{DropsLine}}`-style rows,
  loot bankable across partial completion (see landmine #3 in
  `plan/HANDOFF.md`). Checked all four candidates directly rather than from
  memory:
  - **Inferno and TzHaar Fight Cave have zero `{{DropsLine}}` calls each**
    (`grep -c` confirms). Both are single deterministic completion rewards
    (infernal cape / fire cape) plus a currency amount that scales with the
    wave reached (Tokkul, prose-described, not a drop row) plus one
    independent, boss-page-style pet chance (Inferno: 1/100, or 1/75 on a
    slayer task — itself another `onSlayerTask`-gated fixed rate, same
    pattern as Brimstone key above). This is not a wave-scaled loot table at
    all — closer to a single `Boss` doc with two `always`/`fixed` entries
    than to Fortis Colosseum's per-wave chest. If ever modelled, it needs a
    `killCountAtLeast`-style "on completion" condition and a currency-amount
    formula, not wave machinery.
  - **Barbarian Assault's `==Rewards==` has no `{{DropsLine}}` calls** and
    is a points-gamble/armour-upgrade shop (`Level Upgrades`, `Armour`,
    `Gambles` subheadings) — a spend mechanic, not a table indexed by wave.
  - **Nightmare Zone's `==Rewards==` explicitly names itself a shop**
    (`{{main|Dom Onion's Reward Shop}}`, "purchased using the reward points
    obtained inside the minigame") — the same `point_scaled` shape already
    on `data/mechanics-watchlist.json` for the CoX/ToB/ToA chests, not
    wave-indexed at all.
- **Conclusion: Fortis Colosseum's wave structure is currently a population
  of one.** No shared abstraction is justified by this evidence — building
  wave machinery generalized from a single real example risks guessing the
  shape of a second case that doesn't exist yet. Revisit if a future source
  turns up the same `Wave N` heading pattern; until then this stays a
  Phase 5/override case for Fortis Colosseum alone (per landmine #3), not a
  new first-class mode.

## `groupByHeading` fix: sub-headings qualified by parent section (The Mimic)

- **`findDropsSections` (`wikitext-drops.ts`) now returns each top-level
  Drops/Rewards section SEPARATELY, `WikitextDropLine` gained a `section`
  field, and `groupByHeading` (`build-tables.ts`) now keys on `(section,
  heading)` instead of `heading` alone.** This is the fix landmine #5
  described: The Mimic's `==Elite drops==` and `==Master drops==` each carry
  their own `===Tertiary===` sub-heading; grouping by heading text alone
  merged both into one table, mixing an `Always`-rate row from one tier into
  an `independent`-mode table built for the other's fixed rates, which the
  schema correctly rejected. `section` is `''` for the ~140 sources with
  exactly one top-level Drops section (the overwhelming common case) —
  `heading` alone still identifies a sub-table there, byte-identical to the
  old behaviour, confirmed by re-parsing all of tier A. Only a genuinely
  multi-section page pays for the qualification.
- **This surfaced a second, more consequential bug in the same function,
  caught by testing before it shipped: `findDropsSections` matched a
  heading's title against `DROPS_SECTION_TITLE` at ANY nesting level, not
  just top-level.** A first version of this fix (processing each matched
  "section" independently) turned Branda the Fire Queen and Eldric the Ice
  King from `verified` to `needs_review` — regressions caught by re-running
  `ingest parse --tier A` after the change, not assumed safe. Root cause:
  both pages have `===Tertiary drops===` NESTED inside `==Drops==` (level 3
  under level 2), and "Tertiary drops" itself matches `DROPS_SECTION_TITLE`
  (the qualifier-before-"drops" form). The old concatenation-based code ALSO
  independently re-matched it, but silently: the nested section's re-sliced
  content (its `{{DropsLine}}` rows again, with no heading marker of its
  own) landed inside the SAME "Tertiary drops" boundary as the real
  occurrence — `INDEPENDENT_HEADINGS` still matched, so the check that would
  have caught it (`weights_sum`) doesn't apply to `independent` mode, and the
  doubled rows passed unnoticed. Confirmed this is not just Branda/Eldric by
  grepping every wikitext snapshot for a heading matching
  `DROPS_SECTION_TITLE` at a level deeper than its page's shallowest match:
  **12 more sources carry the same pattern** (Chambers of Xeric, Chest
  (ToA), Gemstone Crab, Monumental chest, Tempoross, The Gauntlet, The Mimic
  itself — `Main drops` nested in both Elite/Master — Treasure Trails,
  TzKal-Zuk, TzTok-Jad), several already excluded from the inventory or not
  yet tier A, but the bug class was real and latent across the corpus, not a
  Branda-specific fluke.
  - **Fixed by making section-matching non-overlapping**: once a heading
    claims a section (start..end), any heading whose own `start` falls
    inside that already-claimed range is skipped, even if its title also
    matches `DROPS_SECTION_TITLE`. Re-verified Branda/Eldric back to
    `verified` and confirmed The Mimic ALSO needed this half of the fix —
    its nested `===Main drops===` was hitting the identical spurious-match
    pattern independently of the Elite/Master merge bug, and without the
    non-overlap guard it still showed a `heading ""` ambiguous group after
    the section-qualification change alone.
- **Net result, tier A re-parsed after both fixes: verified 3 -> 5**
  (`Scurrius` and `The Mimic` newly verified; `Branda the Fire Queen` and
  `Eldric the Ice King` unaffected in the end, having only regressed and
  recovered within this same investigation). `needs_review` 20 -> 15,
  `parse_failed` 3 -> 6 (Duke Sucellus, The Leviathan, The Whisperer,
  Vardorvis — the pre-existing `always`-inside-`independent` schema conflict
  documented above under the rarity-template-registry entry, unrelated to
  this fix and still open).

## Phase 3: shared tables — rare_drop_table, gem_drop_table, mega_rare_drop_table

Note on numbering (corrected): the session that did this work was told to
call it "Phase 4" and flagged the mismatch here rather than silently
resolving it either way. `PROJECT_PLAN.md` section 16 is authoritative:
shared tables + `tableRef` resolution + ring-of-wealth conditions are
**Phase 3** (Phase 4 is the frontend, section 9). Retitled this entry to
match; the work itself was already built to the Phase 3 spec (section 5)
regardless of the label it was filed under.

- **Fetched the real pages instead of reconstructing them from memory.**
  `rare_drop_table`/`gem_drop_table`/`mega_rare_drop_table` had no local
  snapshot (they're not `Category:Bosses` pages, so `ingest fetch --all`
  never touched them). Real game-mechanic numbers are exactly the kind of
  thing memory gets subtly wrong, and this repo has been rigorous about
  wiki-verified accuracy everywhere else, so fetched them properly through
  `WikiClient` (same User-Agent, same serial rate-limited queue as every
  other fetch — not a raw/ad-hoc request) rather than guessing. 6 requests,
  snapshotted to `data/snapshots/wikitext/` and `data/snapshots/dropsline/`
  like any other page. `Mega-rare drop table` is a `#REDIRECT` to a section
  of `Rare drop table` — all three tables' real content lives on that one
  page, under `==Rare drop table==` / `==Gem drop table==` /
  `==Mega-rare drop table==`.
- **All three tables' weights sum EXACTLY to their stated 128 denominator**
  (verified programmatically, not by eyeballing): RDT's four cosmetic
  sub-headings (Runes and ammunition / Weapons and armour / Other /
  Sub-tables) collapse into one 19-entry `weighted` table by the same
  shared-denominator heuristic already used for Brutus; no `nothing` slot at
  the RDT's own top level (it always drops something). Gem and mega-rare
  each carry an explicit `Nothing` row with its own stated rarity (63/128 and
  113/128) rather than an implicit shortfall, because the wiki needs
  something to attach the ring-of-wealth footnote to.
- **This is where the model's existing tooling ran out: representing
  "ring of wealth removes the nothing slot" needed a real, general engine
  fix, not just data.** The wiki's own post-RoW fractions (e.g. uncut
  sapphire 32/128 -> 32/65) prove RoW does not merely zero out the Nothing
  entry against the *same* 128 denominator — it shrinks the effective
  denominator to exactly what's left (128 - 63 = 65), so the remaining items
  fill the WHOLE table. The existing `weighted`-mode compiler
  (`compile.ts`) had no notion of a denominator that changes with which
  entries survive condition filtering — `denominator` was one static number
  per `Table`. Modelling RoW as a plain conditional entry against the old
  static denominator would have left a 63-unit *implicit* gap exactly the
  size of the slot RoW was supposed to remove, silently reproducing the
  original nothing-chance instead of eliminating it.
  - **Fixed generally, in `compileTable`'s weighted branch**: an entry whose
    node is `{ kind: 'nothing' }` and whose OWN conditions exclude it from
    `applicable` now subtracts its weight from the effective denominator,
    rather than leaving an unaccounted-for gap of the same size. This is a
    rule about the `nothing` node kind, stated once, not about a particular
    table or boss — satisfies the hard rule against per-boss branching the
    same way `suppressedByPreroll` already does for preroll semantics.
  - **Verified against the live-fetched numbers, not just internally
    consistent:** with RoW on and (for the gem table) Legends' Quest
    complete, `expectedValue`'s summed `expectedDrops` across the whole
    `rare_drop_table -> {gem_drop_table, mega_rare_drop_table}` chain is
    exactly `1.0` (zero nothing-chance anywhere in the chain) — and the
    resulting mega-rare fractions (rune spear/shield left half/dragon spear)
    reproduce the wiki's own stated 8/15, 4/15, 3/15 to full float precision.
    Locked in as a regression test
    (`apps/ingest/test/shared-tables.test.ts`), plus three focused
    `compile.ts`-level tests in `packages/loot-model/test/simulate.test.ts`.
- **Two judgement calls where the schema's existing primitives ran out,
  both left as documented, flagged simplifications rather than schema
  changes not asked for:**
  - **Chaos talisman vs. nature talisman is modelled as an even-weighted
    `oneOf`, not the real mechanic.** The wiki: which one drops depends on
    the killed monster's map coordinates (over-/underground) — a dimension
    `SimContext` has no field for (the six condition kinds in 4.4 don't
    cover player/monster location). Splitting the combined 3/128 slot 50/50
    between the two is the best available approximation without adding a
    new condition kind, which wasn't asked for this session.
  - **The "mega-rare drop table is replaced by a talisman if Legends' Quest
    is incomplete" fallback is NOT modelled** — that 1/128 gem-table slot
    (reached at (20/128)×(1/65) ≈ 0.24% overall probability once RoW is on)
    falls through to the implicit nothing remainder instead. Two blockers:
    the wiki doesn't say WHICH talisman substitutes, and `questComplete`
    has no `value: boolean` field in the schema (unlike `members`/
    `ringOfWealth`/`onSlayerTask`) — `PROJECT_PLAN.md` 4.4 defines it that
    way itself (`{ kind: 'questComplete'; quest: string }`, "complete" only,
    no negation), so expressing "quest NOT complete" isn't available without
    changing the base spec's own condition shape, which weighs well past
    what a 0.24%-probability edge case justifies. Flagged, not silently
    dropped, same spirit as "Uniques stays a flagged guess."
- **Explicitly did NOT touch tier-C wiring** (landmine #1: `wikitext-drops.ts`/
  `build-tables.ts` still don't detect "Rare drop table"/"Gem drop table" rows
  in a boss's own drop table, and `refs_resolve` in `parse-boss.ts` is still
  hardcoded to `true`), per the explicit instruction to get these three
  records right first. The records and the (now-fixed) resolution engine are
  ready for that wiring whenever it's taken on.

## Fixed: `independent` mode rejecting `always`-rate entries

- **The schema constraint was wrong, not the parser's grouping.** Checked
  both before touching anything: Vardorvis, Duke Sucellus, The Leviathan and
  The Whisperer all have a live-wiki `Tertiary` heading that genuinely
  interleaves a quest/encounter-gated guaranteed drop (`rarity=Always` —
  e.g. Vardorvis' "Temple key (Desert Treasure II)", "only dropped by the
  quest variant") with ordinary chance-based tertiary rows, in that order,
  under one heading — the parser's grouping (one `independent`-mode table
  per `Tertiary` heading, heuristic 3) is exactly right and wiki-faithful.
  The rejection was `ALLOWED_ENTRY_RATES.independent = ['fixed', 'formula']`
  (`schema.ts`), a Phase 1 judgement call ("Schema refinements reject
  undefined combinations rather than guessing" — see that entry above) that
  turned out to be narrower than the real data. Mechanically there was never
  a reason to exclude it: `rateToProbability('always')` is `1`, and
  `independent` mode already treats every entry as its own Bernoulli trial
  via `table.probs[i]` in both `simulate.ts` and `expected-value.ts` — an
  `always`-rate entry is just the degenerate `p=1` case of that, identical
  in kind to a `fixed` rate of `1/1`. Fixed by adding `'always'` to
  `independent`'s allowed rate list, with a comment explaining why `preroll`
  still excludes it (a real, different concern: preroll's chain-order
  semantics make an unconditional entry dominate everything after it).
  Covered by a new schema case (`independent/always`) and a new
  `simulate.test.ts` case reproducing the Vardorvis shape end to end.
- **Result: Duke Sucellus, The Leviathan, The Whisperer and Vardorvis all
  go from `parse_failed` back to `needs_review`** (re-ran `ingest parse
  --tier A`) — each still has an unrelated, real blocker (the "Uniques"
  heading ambiguity, mostly), so none newly reach `verified`, which is
  correct: this fix removed a false rejection, not a real one. Tier A is now
  19 needs_review / 2 parse_failed / 5 verified — the 2 remaining
  parse_failed (Ancient chest, Revenant maledictus) are the unrelated "no
  `{{DropsLine}}` calls found" case, untouched.

## Wired `tableRef` into the parser; ran tier C (26 sources) against the shared tables

### The real shape: a completely different template family, not a DropsLine row

- **PROJECT_PLAN.md 6.5 heuristic 4 ("detect Rare drop table / Gem drop table
  rows") undersold the problem.** A tier-C boss's RDT/gem access is never a
  `{{DropsLine|name=Rare drop table|rarity=...}}` row — it's a dedicated
  `{{RareDropTable|...}}` / `{{GemDropTable|...}}` / `{{GWDRDT}}` template
  under its own `Rare drop table` / `Gem drop table` / `Rare and Gem drop
  table` sub-heading (sibling to `Tertiary`/`Pre-roll`, still inside
  `==Drops==`). Read the actual template DEFINITIONS
  (`data/snapshots/wikitext/template-*.json`, fetched this session), the same
  way Brimstone rarity's formula was derived, rather than guessing from call
  sites: both templates invoke a Lua module
  (`{{#invoke:RareDropLines|main}}` / `GemDropLines`) that expands into the
  item rows at RENDER time — the raw wikitext never lists them. That's
  exactly why per-boss item content doesn't need extracting: it's already in
  `data/tables/rare_drop_table.json` etc. from Phase 3. The parser only needs
  the ACCESS rate.
- **New module `apps/ingest/src/parse/rdt-access.ts`** extracts these calls,
  scoped to the page's Drops section(s) (reuses `findDropsSections`, now
  exported). Confirmed parameter semantics against the template bodies, not
  assumed:
  - `{{RareDropTable|R|G?|...}}`: param 1 is the RDT rate; an OPTIONAL param 2
    is a separate, independent DIRECT gem-table access rate — literally
    `{{#if:{{{2|}}}|There is also a ... chance of rolling the gem drop
    table.}}` in the template body, not the RDT's own internal 20/128
    sub-chance. This is what "Rare AND Gem drop table" headings mean (Giant
    Mole, King Black Dragon, the three Dagannoth Kings, Crazy archaeologist):
    two independent rolls, not one roll with two effects.
  - `{{GemDropTable|G|...}}`: gem-table-only access, no RDT at all.
  - `{{GWDRDT}}` takes no parameters and transcludes to prose citing a
    **distinct** "God Wars Dungeon-variant rare/gem drop table" — confirmed
    by fetching `Template:GWDRDT` itself: different composition (rune sword
    replaces runite bar, mega-rare items folded in directly), and explicitly
    "unaffected by the ring of wealth" per two cited dev tweets. Not the same
    table as `data/tables/rare_drop_table.json`/`gem_drop_table.json`, and
    out of scope for the three tables built this session — flagged via
    `ambiguousGroups`, never guessed at.
  - `rolls=N`: modelled as N independent access attempts (`Table.rolls`),
    the same meaning `rolls` already has everywhere else in this codebase
    (Zulrah's main table, PROJECT_PLAN.md 4.6). **Corporeal Beast is a
    confirmed exception, not a guess**: its own `override=` prose reads "a
    12/512 chance of rolling the gem drop table, **whereupon its contents are
    rolled 10 times**" — one access check, ten draws after, the opposite of
    the default reading. Parsed with the (known-wrong-for-this-source)
    default reading and added to `data/mechanics-watchlist.json` rather than
    special-cased in code.
  - `dropversion=X` maps to a `variant` condition (already in the model).
  - `naturetalisman=`/`chaostalisman=` are pure wiki-categorisation flags —
    neither template's rendering logic reads them for anything; confirmed
    from the template body, not assumed. Not modelled.
  - `multiplier=N` (RareDropTable only, Abyssal Sire's `multiplier=2`) scales
    the QUANTITY the RDT yields, which a single shared, unscaled
    `data/tables/rare_drop_table.json` record cannot express — watchlisted.
  - `approx=Yes` marks the stated rate as an approximation; recorded in the
    generated table's `notes`, not gated on (this pipeline already tolerates
    approximate figures everywhere else).
- **`refs_resolve` is now real** (`apps/ingest/src/validate/refs-resolve.ts`):
  reuses `compileBoss` against the loaded `data/tables/*.json` map and
  reports `UnresolvedTableRefError`/`CircularTableRefError` specifically,
  rather than the old hardcoded `ok: true`. Added to `deterministicOk`'s
  gate in `parse-boss.ts`, which the old hardcoded version never needed to be
  in (it was always true).
- **A resolved RDT access line becomes its own small `independent`-mode
  table** — `{ mode: 'independent', rolls: N, entries: [{ node: {kind:
  'tableRef', ref}, rate: {kind:'fixed', num, den}, conditions: [variant?] }]
  }` — appended to the boss's `tables` array in `assembleBoss`. An
  UNRESOLVED line (GWDRDT, or a rate that doesn't parse as `N/M`) is pushed
  into the existing `ambiguousGroups` mechanism instead of a new validation
  check, reusing the same "parser isn't confident" signal `verified` already
  gates on.

### Result: tier C is 5/26 verified, 20 needs_review, 1 parse_failed

Verified: Amoxliatl, Deranged archaeologist, Giant Mole, Giant Sea Snake,
King Black Dragon. The other 21 tier-C sources have real, individually
diagnosed blockers — RDT access itself resolves cleanly for the large
majority of them (visible in each boss's generated `*:rdt-access:*` table);
what blocks `verified` is almost always an unrelated pre-existing gap:

- **Sources where the RDT/gem-table rate genuinely could not be read from
  the row** (this task's specific ask): **Kree'arra, General Graardor** —
  both use `{{GWDRDT}}`, which names a distinct table this session didn't
  build (see above). **Abyssal Sire, Corporeal Beast** parse their rate fine
  but the wiki's own text describes an effect (`multiplier`/non-default
  `rolls` semantics) nothing here can express — watchlisted, not
  unresolved-flagged, since the rate itself IS readable.
- **Black demon: `parse_failed`, unrelated to RDT.** Its Drops-equivalent
  heading is `"Level 172, 178, and 184 drops"` — five words before "drops",
  and `DROPS_SECTION_TITLE` only allows ONE qualifier word
  (`/^(?:\S+\s+)?(drops?|rewards?).../i`), the same shape of gap The Mimic's
  "Elite drops"/"Master drops" fix closed for a ONE-word qualifier. Not
  fixed this session — flagging rather than widening the regex blind, since
  a broader qualifier pattern needs checking against false positives (e.g.
  "Reward mechanics"-style siblings) the same way the one-word version was.
- **A new, distinct heuristic gap surfaced, out of scope for this task:
  literal "Nothing" rows in a boss's own weighted table are not detected**
  (PROJECT_PLAN.md 6.5 heuristic 5 — "detect `Nothing` rows and emit `{kind:
  'nothing'}`" — never implemented). Tier A/B never exercised this (Brutus'
  `nothing` is an implicit shortfall, never spelled out); several tier-C
  bosses (Black Knight Titan, Salarin the twisted) DO write a literal
  `{{DropsLine|name=Nothing|...}}` row, which the parser currently treats as
  an ordinary unresolvable ITEM (`items_known` failure: "item 'Nothing' is
  not in the item index"). Noted, not fixed — this wasn't part of wiring
  `tableRef` and deserves its own pass.
- **Everything else** is the already-known long tail: multi-id items not on
  the allowlist (Troll bone, Dagannoth ribs, several ensouled heads, pets —
  the large majority of the 21), the "Uniques"/heterogeneous-denominator
  ambiguous-preroll guess (Araxxor, General Graardor, Kree'arra), and one
  new parser-breaking discovery: **Shellbane gryphon's Seeds/Herbs rows use
  `{{#expr:...}}`/`{{#var:...}}` parser-function arithmetic instead of a
  literal fraction** (its yield literally depends on the player's Farming
  patch state) — correctly falls through to `unparseable rarity` rather than
  being silently misread, same as any other unparseable rarity.

### Full A+B+C re-report (`ingest parse --tier A,B,C`, 53 sources)

| Tier | Sources | Verified | Needs review | Parse failed |
|---|---:|---:|---:|---:|
| A | 26 | 5 | 19 | 2 |
| B | 1 (Brutus) | 0 | 1 | 0 |
| C | 26 | 5 | 20 | 1 |
| **Total** | **53** | **10 (18.9%)** | **40 (75.5%)** | **3 (5.7%)** |

Verified: Amoxliatl, Branda the Fire Queen, Chest (Barrows), Deranged
archaeologist, Eldric the Ice King, Giant Mole, Giant Sea Snake, King Black
Dragon, Scurrius, The Mimic. Up from 3/26 (tier A only, all `needs_review`/
`parse_failed` on tier C since it had never been run) at the start of this
session's four tasks. `parse_failed` (Ancient chest, Black demon, Revenant
maledictus) and Brutus' own `needs_review` are all pre-existing and untouched
this session — see their entries above for specifics.

## Audit: can every one of the 7 VALIDATION_CHECKS actually fail?

Went through all seven named in `packages/loot-model/src/schema.ts`'s
`VALIDATION_CHECKS`, checked whether each has a real failure mode AND a test
that exercises it (not just a success-path test):

| Check | Can it fail? | Test proving failure |
|---|---|---|
| `weights_sum` | Yes | `weights-sum.test.ts` (already existed) |
| `refs_resolve` | Yes — was hardcoded `true` (last session's landmine #1), now real | `refs-resolve.test.ts` (already existed, added last session) |
| `rates_valid` | **Was hardcoded `true` — the third case, see below** | `rates-valid.test.ts` (new) |
| `qty_sane` | No real runtime case — legitimately, not lazily, always true | `schema.test.ts`'s existing range-rejection test backs the claim |
| `ev_matches` | Yes (advisory, never gates `verified`) | `ev-matches.test.ts` (already existed) |
| `items_known` | Yes | `items-known.test.ts` (already existed) |
| `not_on_watchlist` | Yes, but **had zero test coverage** | `watchlist.test.ts` (new — the function itself was already correct) |

- **`rates_valid` was the third case, and it was a real gap, not a cosmetic
  one.** It hardcoded `{ ok: true, detail: 'enforced by the loot-model
  schema' }` for every boss, unconditionally — exactly the same shape of bug
  `refs_resolve` had. The claim is TRUE for `fixed`/`always`/`weight` rates
  (`RateSchema`'s `superRefine` genuinely rejects `num > den`, requires
  `weight > 0`) but FALSE for `formula` rates: a formula's `params` is an
  opaque `Record<string, unknown>` to zod, and its actual numeric output only
  exists once evaluated against a `SimContext` — something only
  `evaluateFormula` does, and nothing at ingest time was ever calling it.
  `evaluateFormula` itself already throws a `RangeError` on an out-of-[0,1]
  or non-finite result (a Phase 1 decision), so a bad formula was never
  going to silently corrupt a simulation — but it would have surfaced only
  as an uncaught crash deep in `simulate`/`expectedValue` at USE time, not as
  a graceful `rates_valid: false` at INGEST time, and the hardcoded `true`
  would have kept claiming the boss was fine right up until that crash.
- **Fixed generally**: `apps/ingest/src/validate/rates-valid.ts` now walks
  every entry, evaluates any `formula`-kind rate against
  `defaultFormulaRegistry`, and reports the specific table/formula/error on
  failure. Currently inert on all 53 real sources (none use a formula rate
  yet — Brimstone rarity resolved to a plain `fixed` rate, not a formula, by
  the design choice logged earlier), same as `refs_resolve` was inert until
  tier C. Re-ran `ingest parse --tier A,B,C` after wiring it in: **10/40/3,
  unchanged** — confirms this was a latent gap, not a live one, exactly like
  `refs_resolve`.
- **`qty_sane` audited and left hardcoded, deliberately — not a fourth
  case.** `QtySpecSchema` has no formula-equivalent escape hatch: `exact`,
  `range` (with a `superRefine` for `min <= max`), and `choice` are all
  plain, fully-validated-at-parse-time numeric shapes. There is no runtime
  value a `QtySpec` could ever carry that the schema didn't already reject.
  Left the hardcoded `true`, but reworded its `detail` to state the audit's
  conclusion explicitly rather than just assert it, and confirmed
  `packages/loot-model/test/schema.test.ts` already has a test backing the
  claim (`'rejects an inverted range and an empty choice'`).
- **`not_on_watchlist` had no dedicated test at all** — the only check of
  the seven with zero direct coverage. The implementation itself was already
  correct (a plain lookup against `data/mechanics-watchlist.json`); added
  `watchlist.test.ts` covering both the pass and fail path plus the
  schema's duplicate-`lootSourceId` rejection, so the claim "every check has
  a test proving it can fail" is true of all seven now, not six.

### Histogram: needs_review reasons across all 53 A+B+C sources, by frequency

Generated programmatically from `ingest parse --tier A,B,C`'s own output
(parsed and bucketed by a script, not hand-tallied — an earlier hand-drafted
version of this table undercounted `ambiguous_heading_guess` and
overcounted `watchlist_point_scaled`, caught by actually running the
numbers before publishing them rather than after). 43 non-verified sources
(40 `needs_review` + 3 `parse_failed`); a source can carry more than one
category, counted once per category it hits, not once per reason line
(a single multi-id item produces both a `warnings` line and an
`items_known` failure line for the same root cause — collapsed to one hit):

| # sources hit | Reason category |
|---:|---|
| 24 | Ambiguous group: heterogeneous-denominator heading guessed as `preroll` ("Uniques"/"Unique", plus "Supplies"/"Other"/"Resources"/"Herbs"/"Weapons and armour"/etc. on other bosses) |
| 23 | `items_known`: item resolves to >1 real id, not on the multi-id allowlist (ensouled monster heads, pets, looting bag, dose/charge variants) |
| 3 | `not_on_watchlist`: `other`, wiki-confirmed but unmodelled (Duke Sucellus' roll-chain, Corporeal Beast's rolls semantics, Abyssal Sire's quantity multiplier) |
| 3 | `parse_failed`: no `{{DropsLine}}` calls found under a Drops heading (Ancient chest, Revenant maledictus, Black demon's qualifier-heading gap) |
| 2 | `items_known`: item literally absent from the index (not the multi-id case) — both are a literal `Nothing` drop row (Black Knight Titan, Salarin the twisted); heuristic 5 gap, see above |
| 2 | RDT/gem-table access references the distinct, unmodelled GWD-variant table (Kree'arra, General Graardor) |
| 2 | `not_on_watchlist`: `point_scaled` (Monumental chest, Zalcano) |
| 1 | `not_on_watchlist`: `without_replacement` (Lunar Chest) |
| 1 | Unparseable rarity: `{{#expr:...}}`/`{{#var:...}}` parser-function arithmetic, not a literal fraction (Shellbane gryphon) |

**17 of the 43 carry more than one blocker** (e.g. Kree'arra hits all of
ambiguous-heading, GWD-RDT, and multi-id-item at once) — fixing just one
category does not flip all of its sources to `verified`. Filtered to
sources where the listed category is the ONLY blocker (fixing it alone
would flip that source): **10** for ambiguous-heading-guess, **9** for
multi-id-item, **3** for `no_dropsline_calls`, **2** for
`watchlist_other`, **1** each for `item_not_in_index` and
`watchlist_point_scaled`.

The two biggest categories dominate regardless of framing (raw hit-count or
single-blocker count) and are genuinely single fixes each, not per-source
investigations: **ambiguous-heading-guess** was already investigated two
sessions ago (only 2 of 10 "Uniques"-carrying bosses confirm the
mutual-exclusivity prose in text; widening the keyword list was checked and
rejected on purpose) and stays real and un-shrinkable without a different
signal. **multi-id-item** is one shape repeated 23 times — a broader
multi-id allowlist policy or resolution rule, not 23 individual lookups.

## Phase 4: frontend

Built search, boss view, `SimContext` controls, worker-based simulation,
results view, and the admin page against the 10 verified sources, per
PROJECT_PLAN.md section 9. Verified in a real headless browser (Playwright,
installed this session — see below), not just typechecked: home search,
boss view with drop tables and `tableRef` chains rendering, a live
simulation through the Web Worker with observed-vs-theoretical rates, the
kill log, the admin drill-down showing real `validation.checks`, and — most
importantly — the production `vite build` served under the real
`/osrs-loot-simulator/` subpath with a deep link loaded directly (not
navigated to client-side), which is the actual failure mode the base-path
and `404.html` requirements exist to prevent.

- **`data/index.json` didn't exist and section 6.3's three ingest commands
  (`fetch`/`parse`/`report`) don't produce it — a spec gap, not a decision
  already made.** Added a fourth command, `ingest site-index`
  (`apps/ingest/src/site-index.ts`), that scans whatever's currently in
  `data/bosses/*.json` and writes the slug/name/aliases/status summary the
  plan describes. Deliberately a separate command rather than folding into
  `parse` (whose job is one source at a time, not a directory-wide
  summary) or `report` (validation results, a different shape). Inherits
  landmine #6 as-is: it reflects whatever's on disk, including the one
  known stale leftover (`chest-tombs-of-amascut`, tier D) — not filtered
  out, since doing so would mean the index quietly disagreeing with
  `ingest parse`'s own output.
- **`apps/web/public/` is gitignored and regenerated by
  `scripts/sync-data.mjs`, run automatically via `predev`/`prebuild`.**
  Copies only what the frontend needs (`index.json`, `bosses/`, `tables/`,
  `LICENSE`) out of committed `data/`, not the whole directory — `data/
  _item-index.json` (15k+ entries) and `_inventory.json` are pipeline-
  internal and would only bloat the deployed site for no frontend benefit.
  Every fetch path is built from `import.meta.env.BASE_URL`, the same
  variable `vite.config.ts`'s existing `base` setting already resolves —
  one mechanism drives both the page's own asset paths and its runtime data
  fetches, in dev and in the GitHub Pages build alike, with no separate
  hardcoded "/data/" prefix to keep in sync.
- **`dist/404.html` is a byte-for-byte copy of `dist/index.html`**
  (`scripts/copy-404.mjs`, run as `postbuild`) — confirmed with `diff`, not
  assumed. This is what makes a direct link or hard refresh to
  `/boss/vorkath` work on GitHub Pages: Pages serves this file (with a 404
  HTTP status, but the app's own content) for any path it doesn't
  recognise, and `BrowserRouter`'s `basename={import.meta.env.BASE_URL}`
  then reads the real URL and renders the right route client-side.
  Verified the actual mechanism this depends on (a boss page rendering
  correctly when loaded FRESH at a deep URL, not navigated to from "/")
  directly, under the real built `/osrs-loot-simulator/` subpath via
  `vite preview`.
- **Never imports boss JSON into the bundle.** Every fetch in
  `src/lib/api.ts` is a runtime `fetch()` against the synced `public/`
  copy, validated with the SAME zod schemas (`BossSchema`,
  `SharedTableSchema`) the ingest pipeline already defines — re-imported
  from `@osrs-loot-simulator/loot-model`, not duplicated, so a boss doc
  that wouldn't parse server-side can't silently render client-side either.
- **Simulation always runs in the Web Worker, not just above ~100k kills.**
  One code path (`src/workers/simulate.worker.ts`) is simpler than two, and
  `simulate()` is fast enough (section 8: "10M kills in a couple of
  seconds") that routing small runs through it too costs nothing
  perceptible. `expectedValue` (analytic, no sampling) stays on the main
  thread — genuinely instant, no reason to hop a worker boundary for it.
- **GE prices are fetched live, client-side, straight from the browser** —
  not asked for explicitly, but the results view's `gpPerKill`/`gp` columns
  are literally the reason someone runs a loot simulator, and shipping
  them as a permanent "0 gp" would look broken, not like a deferred
  feature. Confirmed the endpoint allows it before building anything
  (`curl` with an `Origin` header: `access-control-allow-origin: *`) rather
  than assuming — same public endpoint `apps/ingest/src/prices/ge-prices.ts`
  already uses server-side. No `User-Agent` header (browsers refuse to let
  script code set one; PROJECT_PLAN.md 6.2's etiquette rules are about the
  ingest pipeline's bulk scrape, not one user-initiated request per page
  load). Found and fixed a real UX bug this surfaced during browser
  testing: clicking "Simulate" before the price fetch resolved ran with an
  empty price map and showed 0 gp for everything, silently and
  permanently — the button now shows "Loading prices…" and stays disabled
  until that fetch settles.
- **Fuzzy search is a small hand-written matcher (`src/lib/fuzzy.ts`), not
  a dependency.** Exact/case-insensitive substring ranks above an in-order
  subsequence match; the whole index is a few hundred entries, so this
  runs on every keystroke with no debouncing or indexing needed. Matches
  PROJECT_PLAN.md 9's "no search API needed" framing literally.
- **Seed, kill count, and every `SimContext` field round-trip through URL
  query params** (`src/lib/url-state.ts`), so a simulated run is a
  shareable link, per PROJECT_PLAN.md 9. Only non-default values are
  written, keeping a plain `/boss/vorkath` link clean. Quest-completion
  controls are generated from whichever `questComplete` conditions the
  boss's OWN tables actually reference, not a free-text field — there is
  no reason to expose "Dragon Slayer II" as a toggle on a boss whose
  conditions never mention it.
- **A `needs_review`/`manual_override` boss still fully renders and
  simulates** — it's a valid, schema-parseable `Boss` document either way,
  just one the deterministic checks haven't all cleared yet. A banner links
  to that source's own row on `/admin` rather than hiding or blocking the
  page, matching section 7's framing of `needs_review` as "a queue you burn
  down," not a wall between the data and the site.
- **Testing**: `apps/web`'s `vitest.config.ts` now runs under `jsdom` with
  `@testing-library/react`; `test/setup.ts` explicitly calls
  `afterEach(cleanup)` rather than relying on `@testing-library/react`'s
  automatic global-`afterEach` registration, which needs vitest's
  `globals: true` — not enabled here, matching every existing test file's
  explicit `import { describe, expect, it } from 'vitest'`. Caught for
  real: the first version of `App.test.tsx` intermittently failed with
  "multiple elements found" from a previous test's un-unmounted render
  still in the DOM.
- **Installed Playwright + a headless Chromium build this session**
  (`~/Library/Caches/ms-playwright`, machine-local, not part of the repo)
  specifically to drive the dev server and the production build in a real
  browser before calling this done — this repo's own instructions require
  it for UI work, and a passing typecheck does not verify a page actually
  renders or that a Worker actually produces a result.
- **`eslint.config.js` gained a `**/*.mjs` block declaring the Node
  `process` global** and a stray `react-hooks/exhaustive-deps`
  disable-comment was removed from `BossView.tsx` — that plugin isn't
  configured in this repo, so referencing its rule in a disable-comment is
  itself a lint error, caught by running `pnpm lint` before calling this
  finished, not assumed clean.
- **Deliberately did NOT add `.github/workflows/deploy.yml`.** PROJECT_PLAN.md
  section 16 lists "Deploy to Pages" under Phase 4's done-criteria, and
  Phase 0 explicitly deferred the workflow to "the phase that gives it
  something to do" — which this now is. Left it out anyway: it wasn't
  named in this session's instructions, and unlike everything else here
  it's a CI file that changes what happens on every future push to `main`
  once Pages is enabled, which reads as exactly the kind of action to
  surface and let the user request rather than add silently.

## `.github/workflows/deploy.yml` added, per explicit instruction

The previous entry's "left it out, surface rather than add silently" was
exactly that surfacing — this session's instruction is the explicit request
it was waiting on. Added `deploy.yml` with PROJECT_PLAN.md section 13's
content unchanged except the `pnpm --filter web build` line, which names a
package literally called `web`; this repo's is `@osrs-loot-simulator/web`
(`apps/web/package.json`), so the filter was adjusted to match — everything
else is the plan's own text. Still needs a manual, one-time step this
session can't do: **Settings → Pages → Source → "GitHub Actions"** (plan
section 13's own callout) — the workflow won't deploy anything until that's
set, by design (GitHub Pages defaults to "Deploy from branch").

## Ambiguous-heading-guess: multi-signal resolution, not a wider keyword list

24 sources were flagged `ambiguous: 'preroll guess'` for a
heterogeneous-denominator heading with no mode-indicating keyword — the
"Uniques" pattern the project has twice already declined to fix by trusting
the heading text (only 2 of 10 carrying bosses confirm mutual exclusivity in
prose; see the two entries above this one). Explicit instruction this
session: don't widen that keyword list — find real signals instead, prose as
one input among several, and leave what can't be determined flagged.

Investigated all 24 by reading their actual wikitext (not guessing from
memory), and built three independent structural/textual signals, tried in
order, each only acting when it narrows unambiguously:

- **`tryHomogenizeDenominators`**: some "heterogeneous" headings are really
  one weighted table where the wiki printed one row against its own
  un-reduced denominator (Kraken's Trident of the seas at `1/512` among five
  `/128` entries — the SAME table, just not commonly denominated on the
  page). Merges via LCM when the result is a clean small multiple
  (`LCM_MERGE_RATIO_CAP = 10`) of the largest original denominator AND the
  rescaled weights don't exceed it — the second check matters: an earlier
  version let Gemstone Crab's seven gems (already summing to exactly 32/32,
  no slack) merge with Uncut dragonstone's `1/500` anyway, silently
  overflowing the denominator to 4008/4000. Caught by `weights_sum` before
  it ever shipped, then fixed at the source so that check never has to catch
  it again.
- **`trySplitDominantAndOutliers`**: when the merge above fails but one
  denominator still accounts for the large majority (≥3 entries) and at
  most 2 outliers don't share it, splits into a `weighted` pool (the
  majority) plus an `independent` group (the outliers) instead of forcing
  one table or leaving the whole heading flagged. Needed for Hespori's
  "Main table" (32 seeds at `/80`, plus Bottomless compost bucket at `1/35`
  and Tangleroot at `1/5375`) and (after the weight-overflow fix above)
  Gemstone Crab. First version wrongly required outliers to have a LARGER
  denominator than the pool ("rarer") and missed Hespori entirely —
  Bottomless compost bucket at `1/35` is actually MORE common than several
  of the `/80` seeds; "outlier" means "doesn't share the pool's
  denominator," not "rarer." Caught by running the real parser, not by the
  unit tests (which had been written to match the same wrong assumption).
- **`findConfirmingSignal`** (last resort, only after both denominator
  signals fail): reads `raritynotes` — newly captured as its own
  `WikitextDropLine` field, previously extracted only transiently for
  members/f2p marker detection and then discarded — for two textual
  signals. Two or more entries citing the SAME named footnote
  (`<ref name="news"/>`, `{{NamedRef|Halberd}}`) resolved Artio/Callisto/
  Calvar'ion/Spindel/Venenatis/Vet'ion's "Unique(s)" (all cite one shared
  "Poll 78" news post). An explicit mutual-exclusivity phrase
  (`/tradeable unique table/i`, `/any\s+\S+\s+piece/i`, etc.) resolved Duke
  Sucellus/The Leviathan/The Whisperer/Vardorvis ("must roll ... on the
  tradeable unique table") and General Graardor/Kree'arra ("1/381 for a
  specific piece, or 1/127 for ANY piece"). Deliberately does NOT match on
  heading text — that was the thing already rejected twice.
  - **General Graardor/Kree'arra note**: LCM-merges before reaching this
    signal at all (127 divides 381/508/762 cleanly), combining what the
    prose actually describes as TWO separate rolls (armour: "any piece"
    1/127; shards: "any piece" 1/254) into one shared weighted pool of 7.
    Checked whether this is a real modelling error: at these probabilities
    (~0.1–0.3% each), the only behavioural difference from two independent
    rolls is the vanishingly small chance of both hitting in the same kill
    (product of two small probabilities) — not worth a special case to
    avoid, and flagged here rather than silently presented as a clean win.
- **Result: 24 ambiguous sources → 4** (Doom of Mokhaiotl's "Uniques",
  Monumental chest's untitled heading, The Nightmare's "Uniques", Zulrah's
  "Mutagens" — each individually checked and confirmed to have no available
  signal: The Nightmare's rates have neither a shared citation nor a clean
  LCM relationship; Zulrah's own raritynotes describe a genuine two-stage
  roll (`10/249 * 10/5264 per roll`) needing real `oneOf` nesting this
  parser doesn't build; Doom of Mokhaiotl is delve-level-gated, watchlisted
  below). Left flagged, per instruction, not forced.
- **`data/mechanics-watchlist.json` gained `doom-of-mokhaiotl`**: its
  "Uniques" heading is gated by delve level reached (Avernic treads only
  past level 4, Eye of ayak past level 3, Mokhaiotl cloth past level 2, all
  three converging to one shared `altrarity` of `1/540`) — the same wave/
  level-scaling shape as Fortis Colosseum, one level deeper. Correctly stays
  an unresolved ambiguous guess rather than being force-classified.
- New tests in `build-tables.test.ts` reproduce each real shape (Kraken,
  Gemstone Crab, Hespori — including the outlier-direction regression —
  Artio's shared-citation case, a synthetic phrase-only case, and The
  Nightmare's stays-flagged case) rather than only asserting the aggregate
  counts.

## Multi-id-item resolution: `default_version`, read for the first time

23 sources were blocked on an item name resolving to more than one real
game id, not on the multi-id allowlist. Explicit instruction: same terrain
as the dose-suffix fix (`bucket('item_id')` → `bucket('infobox_item')`,
logged earlier) — find the systematic pattern, not per-item entries.

Checked `Bucket:Infobox item`'s full field list directly (fetched fresh —
this bucket's schema was never snapshotted) rather than assuming the three
columns already selected (`page_name`, `item_name`, `item_id`) were the
whole story. Found `default_version: BOOLEAN`, `tradeable`, `release_date`,
`removal_date`, `version_anchor` — none previously read. Probed a sample of
the 23 items directly against the live bucket with these added: every
multi-version collision (Troll bone's Unpolished/Polished, Callisto cub's
Normal/Legacy, Cow slippers' four colours, Ensouled troll head's Item/Drop,
...) has EXACTLY ONE candidate marked `default_version=true`.

- **`ItemNameRow` gained `defaultVersion: boolean`**, the bucket query now
  selects `default_version`, and `resolveWithDisambiguation` (renamed from
  `resolveWithUnqualifiedPagePreference`) applies THREE signals in
  sequence, each narrowing the candidate set only when it doesn't narrow to
  zero:
  1. **`default_version`** — collisions WITHIN one page's multi-version
     infobox.
  2. **Unqualified `page_name`** (already existed, for collisions ACROSS
     pages — Coins vs its minigame reskins) — but reimplemented:
     `pageName.includes('(')` is not "has a qualifier," it's "contains a
     paren anywhere," and misfired on "Diamond bolts (e)" — the BASE item's
     own name contains a paren ("(e)" = enchanted), so the naive check
     flagged it as "qualified" too and left it indistinguishable from
     "Diamond bolts (e) (Last Man Standing)" (which is ALSO marked
     `default_version=true` independently — step 1 alone doesn't resolve
     this one). Replaced with `isQualifiedVariantOf`: B is a qualified
     variant of A only when B's page name IS A's page name plus a trailing
     `" (...)"`. Same fix needed nowhere else observed, but it was silently
     wrong for this shape the whole time step 1 wasn't available to mask it.
  3. **Exact `page_name` == the name being resolved** (new) — for
     collisions across pages with UNRELATED names that just render the same
     display text: "Feather" (id 314) and "Wimpy feather" (id 11525, an
     easter-egg item whose OWN `item_name` is plain "Feather") are neither a
     multi-version collision (step 1: both trivially `default_version=true`
     on their own single-version pages) nor a named-qualifier collision
     (step 2: neither page name is the other's-plus-suffix) — only "which
     page's name IS the string being resolved" tells them apart.
  - Applied together because Eclipse moon helm needs both: "Used" (not
    default) is eliminated by step 1, leaving "New" (plain page) and an LMS
    reskin — BOTH marked default on their own pages — which step 2 then
    tells apart.
- **Rebuilt the real item index against the live wiki** (a genuine new
  fetch — expanding a bucket query's own column selection, the same kind of
  change that took the index from `item_id` to `infobox_item` in the first
  place, not "re-hitting the wiki to fix a parser bug"). Unresolved entries:
  2,997 → 2,395 (`default_version` alone) → 2,361 (after the qualified-
  variant and exact-match fixes).
- **Two shapes don't fit either signal and went on the multi-id allowlist
  instead, matching the existing clue-scroll precedent**: `key-medium`
  (all 11 Treasure Trails casket-key ids live on ONE `infobox_item` row —
  trivially its own single `default_version` candidate, so nothing narrows
  an 11-element id list to one; the ids are interchangeable, same shape as
  the six already-allowlisted clue tiers) and `gull-pet` (Shellbane
  gryphon's `{{DropsLine|name=Gull (pet)}}` matches NEITHER of
  `infobox_item`'s two rows for that page — `item_name` "Gull" and "Gulliver"
  — a drop-table-label-vs-infobox-name mismatch, not a version collision;
  recorded for this one known case rather than taught to the general
  resolver).
- **Cow slippers is now resolved** (to its `default_version` candidate,
  33093) — a deliberate, documented update to the Phase 3 conclusion "four
  unqualified candidates correctly stays unresolved," which was correct
  given the data available at the time (no `default_version` had been
  fetched yet) and is superseded now that it has been.

## Constant-returning validation checks: named preconditions, with trip wires

Audited every check for a return that's a hardcoded/skipped constant rather
than a live computation, per instruction — a comment alone doesn't stop the
precondition from silently going stale, so each got a test that fails the
moment it does:

- **`qty_sane`** (`parse-boss.ts`, hardcoded `ok: true`): the claim
  "`QtySpec` is fully schema-enforced, no runtime-only case" is only true
  because `exact`/`range`/`choice` is the WHOLE set. New
  `apps/ingest/test/qty-sane-constant.test.ts` asserts
  `QtySpecSchema`'s discriminated-union kinds equal exactly those three
  (reached via zod's own `._def.schema.optionsMap`, since the public schema
  is a `.superRefine()`-wrapped `ZodEffects`) — a fourth kind breaks this
  test, which is the intended trigger to re-audit the hardcoding, the same
  way `rates_valid`'s equivalent hardcoding was audited and found wanting
  this session.
- **`rates_valid`**'s `checkRatesValid` (no longer itself a hardcoded
  constant — see the earlier entry — but still SKIPS `fixed`/`always`/
  `weight` rates outright, trusting them as schema-complete): same
  treatment, a new test in `rates-valid.test.ts` asserts `Rate`'s kinds
  equal exactly `always`/`fixed`/`formula`/`weight`.

## Final re-report: A+B+C, all four fixes applied

`ingest parse --tier A,B,C`, 53 sources, after the ambiguous-heading fix,
the item-index rebuild, and the two new allowlist entries:

| Tier | Verified | Needs review | Parse failed |
|---|---:|---:|---:|
| A | 18 | 6 | 2 |
| B (Brutus) | 1 | 0 | 0 |
| C | 17 | 8 | 1 |
| **Total** | **36 (67.9%)** | **14** | **3** |

Up from 10/53 (18.9%) at the start of the PREVIOUS session's four tasks —
verified more than tripled this session alone (10 → 36). Fresh histogram
across the 17 remaining non-verified sources (computed programmatically,
same script as the earlier histogram — not re-eyeballed):

| # sources | Category |
|---:|---|
| 4 | `not_on_watchlist: other` (Duke Sucellus, Corporeal Beast, Abyssal Sire, doom-of-mokhaiotl — wiki-confirmed, unmodelled mechanics) |
| 4 | Ambiguous-heading guess (Doom of Mokhaiotl, Monumental chest, The Nightmare, Zulrah — see above) |
| 3 | `parse_failed`: no `{{DropsLine}}` calls (Ancient chest, Revenant maledictus, Black demon) |
| 2 | `items_known`: item literally absent from the index (`Nothing` as a literal drop row — heuristic 5 gap, unfixed, unrelated to this session) |
| 2 | RDT/gem-table access references the unmodelled GWD-variant table (Kree'arra, General Graardor) |
| 2 | `not_on_watchlist: point_scaled` (Monumental chest, Zalcano) |
| 1 | `not_on_watchlist: without_replacement` (Lunar Chest) |
| 1 | Unparseable rarity: `{{#expr:...}}` parser-function arithmetic (Shellbane gryphon) |

The `multi_id_item` category from the previous histogram (23 sources) is
gone entirely — every one of those either resolved outright or moved onto
the multi-id allowlist. Only 2 of the 17 remaining sources carry more than
one blocker (Doom of Mokhaiotl, Monumental chest), down from 17 of 43 last
time — most of what's left now needs exactly one fix to reach `verified`,
not a combination.

## Step (c): CoX cross-table suppression and Corporeal Beast's access-once-draw-K

Both shipped as narrow, additive schema fields per
`docs/mechanics-model-proposal.md`'s verdict on framing claim #4 — deliberately
NOT as general mechanisms. Prior research confirmed each is a single source
(`docs/bosses/ancient-chest.md` gap #2, `docs/bosses/corporeal-beast.md` gap
#1) and that neither shape recurs elsewhere in the corpus.

### `Table.suppressesFollowing` (CoX)

- **A flag on `independent` tables, not a new `TableMode`.** CoX's unique table
  needs "every entry rolls separately (multiple can hit), but a hit anywhere
  ends the main chain." `preroll` would discard unique rolls 2–6 (CoX awards up
  to six); plain `independent` suppresses nothing. The flag supplies exactly
  the missing half and reuses the existing `suppressedByPreroll(mode)`
  predicate for *which* later tables get suppressed — one definition of the
  chain, now reached by two triggers, rather than a second parallel rule.
- **Schema-pinned to `independent`.** On `always`/`weighted` a hit happens
  every kill, so the flag would unconditionally suppress the rest of the
  document — a shape with no meaning worth guessing at; `preroll` already
  suppresses. Rejected at the boundary, matching Phase 1's "reject undefined
  combinations rather than guessing."
- **A hit suppresses later tables, NOT this table's own remaining `rolls`.**
  `simulate.ts` therefore tracks two separate flags (`prerollHit`,
  `suppressHit`): the first breaks out of the rolls loop, the second only
  changes the return value. Collapsing them into one would silently cap a
  multi-roll suppressing table at one hit. Covered by a dedicated test.
- **Nested chains stay local**, inheriting Phase 1's rule for preroll —
  `emit` discards `runTable`'s return value, so a `suppressesFollowing` table
  reached through a `tableRef` suppresses nothing in the referencing document.
  Tested, because a shared table carrying the flag would otherwise gut every
  boss that references it.
- **`expected-value.ts` gained `independentHitChance`**, the analytic
  counterpart of `simulate.ts`'s `suppressHit`: `1 - prod(1 - p_i)`, raised to
  the roll count (or scaled by a chance-`rolls`), skipping ownership-gated
  entries that don't currently apply. No source combines suppression with
  ownership gates today; handling it correctly cost nothing and avoids a
  silent wrong answer if one ever does.

### `TableRefNode.drawsPerHit` (Corporeal Beast)

- **Scoped to the `tableRef` node, never to `Table.rolls`.** `rolls: N` means
  "N independent access attempts" everywhere else and that reading is correct
  in general (see the tier-C wiring entry above, which already warned against
  "fixing" it globally over this one source). Corporeal Beast's own template
  call is the cited exception: "a 12/512 chance of rolling the gem drop table,
  whereupon its contents are rolled 10 times."
- **The two readings have IDENTICAL per-kill expectation** — expectation is
  linear, so one access gating 10 draws and 10 accesses gating one draw both
  come to `10p x E[draw]`. This is worth stating explicitly because it means
  **no mean-based check could ever have caught the wrong reading**, `ev_matches`
  included. What differs is the distribution: P(a kill yields any gem loot) is
  `12/512 = 2.3%` under the correct reading versus `1-(1-12/512)^10 = 21.1%`
  under the default one, and a yielding kill draws exactly 10 times rather than
  ~1.1. `draws-per-hit.test.ts` asserts the distribution, and asserts the mean
  equality on purpose, so a future reader doesn't "fix" the latter.
- `expected-value.ts` multiplies `reach` (how many times the node is hit), not
  `qtyMultiplier` (how big each yield is) — conflating them would corrupt
  `drops[]` against `quantity`. The two compose and are tested together.

### Both fields are `.optional()`, not `.default()`

A `.default(false)`/`.default(1)` would be materialised by `BossSchema.parse`
into **every table / every `tableRef` node of all 53 generated boss docs** on
the next re-parse (this is observably how `withoutReplacement: false` already
appears in files that never use it), producing a corpus-wide data diff for a
feature two sources will ever use. Optional keeps the generated output
byte-identical — confirmed by diffing all 51 files before and after, not
assumed. Asserted directly in both new test files.

### Verification

- `pnpm -r typecheck && pnpm -r test && pnpm lint`: clean. **332 tests** (139
  `packages/loot-model` — 119 pre-existing + 20 new across
  `suppresses-following.test.ts` and `draws-per-hit.test.ts`; 172
  `apps/ingest`; 21 `apps/web`), 0 lint errors.
- **Brutus ran first after each of the three engine files changed**
  (`compile.ts`, then `simulate.ts`, then `expected-value.ts`), never batched
  to the end, per landmine #7. Green at every step.
- `ingest parse --tier A,B,C` (53 sources): **36 verified / 14 needs_review /
  3 parse_failed — unchanged**, and the regenerated `data/bosses/*.json` diff
  against the pre-change state is **empty across all 51 files**.

### Benchmark: the cost is ~1%, but the 2s bar is now at parity — pre-existing

Measured as a controlled A/B on one machine minutes apart (the hot-path lines
reverted in place, benchmarked, then restored), rather than against the
figures recorded in a previous session on a differently-loaded machine:

| Stage (this machine, this session) | 1M kills | 10M kills |
|---|---:|---:|
| Step (c) hot-path lines reverted (baseline) | ~198ms | ~1,981ms |
| Step (c), first version (flag hoisted per table-roll) | ~205ms | ~2,038ms |
| Step (c), current (flag read on a hit instead) | ~201ms | ~1,999ms |

- **The first version's ~3% regression was real and was fixed, not accepted.**
  Hoisting `const suppresses = table.suppressesFollowing` once per table-roll
  cost more than reading it inside the already-rare hit branch, since an
  independent entry hitting is uncommon (Brutus's tertiary rates are 1/15 and
  rarer) while table-rolls are not. Same trade as Extension A's
  `qtyMultiplier === 1` fast path, in the opposite direction.
- **Step (c)'s residual cost is ~+1.5%/+0.9%, essentially noise.**
  `gpPerKill` is byte-identical (597.2676 / 598.4495) across every variant
  above, confirming all of this is behavior-preserving.
- **The headroom problem is real but is NOT step (c)'s.** The baseline with
  step (c)'s lines removed already measures ~1,981ms on this machine — the 10M
  figure sits at the ~2.0s reading of PROJECT_PLAN.md 8's "couple of seconds"
  *without* this change. That is Extension B's ~25% cost (documented in the
  proposal), now visible at full size, plus a machine slower than the one the
  proposal's ~1.87–1.94s figures came from.
- **Deliberately did NOT pull the duplicated-`emit`/`runTable` lever** the
  handoff nominated for exactly this trigger. It would mean maintaining two
  copies of the simulator's core recursive walk indefinitely, and this
  session's own measurement says it would buy back ~18ms of step (c)'s ~1%,
  not the ~400ms of Extension B's overhead it was actually designed to target.
  Building it to recover 1% would be chasing the wrong number. Flagging with
  the measurement rather than acting on it: the lever is still available, and
  it is now better characterised (it targets Extension B, not step (c)).

## Phase 7, sources 1–3: Abyssal Sire, Corporeal Beast, Doom of Mokhaiotl (assessed)

Worked cheapest-first through the 14 researched sources in `docs/bosses/`.
The two cheapest both turned out to be consumers of engine work already done
(Extension A's `qtyMultiplier`, step (c)'s `drawsPerHit`) and needed no new
model capability at all — only parser wiring.

### Abyssal Sire and Corporeal Beast — shipped, both now `verified`

- **Both are one parser module** (`apps/ingest/src/parse/rdt-access.ts`),
  which is why they were done together: each is a parameter on the same
  `{{RareDropTable}}`/`{{GemDropTable}}` access-line family.
  `unmodelledMultiplier` became a real `qtyMultiplier`, and `rolls=10` +
  prose became `drawsPerHit`.
- **`drawsPerHit` is detected from the wiki's own `override=` prose
  (`/whereupon (?:its|their) contents are rolled (\d+) times/i`), never from
  the boss's slug.** This matters: `rolls=10` is structurally identical to
  the five `rolls=2` access lines elsewhere in the corpus that genuinely mean
  repeated access attempts, so the prose is the *only* distinguishing signal.
  Reading it is the same class of textual signal `build-tables.ts`'s
  `findConfirmingSignal` already uses on `raritynotes`; keying off the slug
  would be exactly the per-boss branch CLAUDE.md forbids. Verified by scanning
  every wikitext snapshot: the phrase occurs on exactly one page, and the only
  other "whereupon" in the corpus (Inferno) is unrelated combat prose outside
  any access template.
- **Prose and `rolls=` must agree or the line is flagged unresolved.** If a
  page ever states one count in words and another in the parameter, that is a
  real ambiguity about the wiki's intent — pushed through the existing
  `unresolved` channel rather than picking one.
- **`multiplier=` was re-checked across the whole corpus, not taken from the
  one known case.** An earlier note called Abyssal Sire "the one source that
  has it"; a page-wide grep also hits `phantom-muspah`, but its access call is
  `{{RareDropTable|5/235|rolls=2|naturetalisman=yes}}` — the match is
  elsewhere on the page, outside any access template. Abyssal Sire is
  genuinely the only user; the original claim holds, now on evidence.
- **Watchlist entries removed only after the policy's own gate was met.**
  `data/mechanics-watchlist.json` requires "the mechanic is modelled AND the
  simulation has been checked against the wiki's own figures."
  `apps/ingest/test/rdt-access-mechanics.test.ts` is that check, run against
  the REAL generated boss docs and REAL `data/tables/` records (not synthetic
  fixtures), so it fails if a future re-parse stops emitting either field. It
  asserts: Abyssal Sire's quantities exactly double while its drop *rates* are
  untouched (conflating the two would silently double every rate the UI
  reports); the shared `rare_drop_table` record is not mutated by that x2 (a
  Giant Mole canary run against an already-used tables map); and Corporeal
  Beast yields on 12/512 of kills drawing ten times each, rather than the
  21.1% of kills the default reading gives.
- **Result: `ingest parse --tier A,B,C` 36 -> 38 verified**, 14 -> 12
  `needs_review`, `parse_failed` unchanged at 3. Diffed all 51 generated docs:
  exactly two files changed, both intended.

### On whether the research docs are accurate enough to implement from

Mixed, and worth knowing before trusting the remaining eleven:

- **Abyssal Sire and Corporeal Beast: fully accurate.** Both docs quoted the
  exact template call, named the exact missing field, and their proposed
  mappings were implementable verbatim. `corporeal-beast.md` even predicted
  the right scope ("a `drawsPerHit` on the `tableRef` node... not a new
  `TableMode`").
- **`corporeal-beast.md` overstates one claim, harmlessly.** It says the
  default reading "understates how much loot a successful proc yields by an
  order of magnitude, and overstates how often any gem-table loot happens."
  The second half is right (2.3% of kills vs 21.1%); the first half is
  right per-proc but **the two readings have identical per-kill
  expectation** — expectation is linear. No mean-based check could ever have
  caught this, which is a sharper statement of why the fix mattered, not a
  reason it didn't.
- **`doom-of-mokhaiotl.md` is materially out of date and contradicts the
  proposal — the proposal is right.** The boss doc concludes the mapping
  "cannot be meaningfully proposed without wave/level machinery existing
  first" and treats the source as evidence that wave structure is now a
  recurring gap needing a shared abstraction.
  `docs/mechanics-model-proposal.md`, written later and after reading all 14
  docs, corrected this: gating each level's table on `levelAtLeast(delveLevel,
  n)` makes every level up to the one reached fire its own roll, which IS
  per-level bankable loot — confirmed against `conditions.ts`, where
  `levelAtLeast` is a plain `ctx[field] >= n`. **No wave machinery is
  needed**; it is N tables in the existing array. The boss docs were written
  before Extensions A/B existed and their "what doesn't exist" sections have
  not been revised since — read them for the *mechanic and its numbers*
  (which have been reliable), not for their capability verdicts.

### Doom of Mokhaiotl — assessed, not shipped: one real blocker needing a decision

Implementable in shape (9 `levelAtLeast`-gated tables, each with its own
`qtyMultiplier` and per-level unique rates, plus a per-level guaranteed
demon-tear grant), but blocked on a genuine semantics mismatch that should not
be guessed at:

- **The wiki's quantity rule is `Qn = Q3 + trunc(Q3 * Mn)`** (`Mn` from -0.5
  at level 1 to +0.2 at level 9+). Expressed as `qtyMultiplier = 1 + Mn` this
  is always positive, so `MultiplierSchema`'s positive constraint is fine.
- **But the rounding differs.** `simulate.ts`'s `emit` computes
  `Math.round(rolled * qtyMultiplier)`; the wiki truncates the *scaled part*
  toward zero and adds it to the baseline. These disagree on real values —
  `Q3 = 5, M = -0.35`: wiki gives `5 + trunc(-1.75) = 4`, the engine gives
  `round(5 * 0.65) = 3`. Not a rounding nicety at these quantities.
- Three options, none obviously right and all with corpus-wide reach: change
  `emit`'s rounding globally (touches every source using `qtyMultiplier`,
  i.e. Abyssal Sire, just verified against the wiki); add a rounding-mode
  field to the multiplier; or accept a documented off-by-one for this source.
  **Left for whoever owns the schema call** rather than picked silently —
  this is the same shape of decision as the `always`-inside-`independent`
  schema question that was correctly escalated rather than guessed.

## `qtyRounding`, the docs/bosses sweep, and the override mechanism

### `qtyRounding` — a field on the multiplier, not a change to `emit`

Per instruction: option 2, `.optional()`, defaulting to current behaviour, and
`emit`'s global rounding left alone. The instruction also asked whether trunc
and round diverge generally or only for negative multipliers, since that
narrows what the field must express. **Measured first, and the answer changed
the design twice:**

- **Divergence is not negative-only — it is worse for POSITIVE multipliers.**
  Over `Q3` 1..200 at Doom of Mokhaiotl's own per-level multipliers, `round`
  and the wiki's rule disagree on 80–100 of 200 values at every positive level
  (`M` = 0.05..0.2), and 91 of 200 at `M = -0.35`. `M = -0.5` and `M = 0` are
  the only rows where every mode agrees — so a spot-check on level 1 alone
  would have concluded, wrongly, that there was no problem.
- **A mode naming a rounding function applied to the PRODUCT cannot express
  the rule.** `Q + trunc(Q*M)` equals `trunc(Q*m)` for `m > 1` but not for
  `m < 1` (191 of 200 disagree at `m = 0.65`), because `trunc` rounds toward
  zero and the delta is then negative. **The mode has to say what the rounding
  applies to**, hence `truncDelta`/`ceilDelta` rather than `trunc`/`floor`.
- **A third mode was needed, from a second source.** `docs/bosses/zalcano.md`
  specifies the MVP bonus as "+10% (**rounded up**)" — `ceilDelta`. So this is
  three separately-cited wiki rules across two sources, not one source's quirk.
  (`truncDelta` and `ceilDelta` provably coincide for `m < 1`, where the delta
  is negative; they can only differ above 1.)

**Two float-safety corrections, both caught by tests asserting wiki-stated
values, both load-bearing.** Measured over the real multipliers in use for
quantities 1..2000: the natural `qty*(m-1)` form is wrong in **1,072** cases
(`1.2 - 1` is `0.19999999999999996`, so `5 * that` truncates to 0 instead of
1), and reformulating to `qty*m - qty` still leaves **324** wrong (`50 * 1.1 -
50` is `5.000000000000007`, so Zalcano's MVP would receive 56 items instead of
55). `scaledDelta` does both: reformulate, then snap to an integer within
1e-9. Truncation amplifies a 1e-15 representation error into a whole extra
item, which is exactly the off-by-one class this field exists to fix, so
approximating here would have defeated its purpose.

**`expectedValue` is now exact rather than approximate for scaled quantities.**
It previously computed `qtyMultiplier * meanQty(qty)`, which is only right when
no rounding occurs (true for Abyssal Sire's integer x2, false in general, since
`E[round(X*m)] != E[X]*m`). `meanScaledQty` enumerates the quantity's own
distribution once per compiled node at EV time — never per kill — so the
analytic and sampled paths agree exactly, which is the whole reason
`compile.ts` exists. Both call `applyQtyMultiplier`, one definition.

Nesting: most-specific-wins (an access declaring its own mode overrides the
enclosing path's). No source nests two multipliers today, so this is a rule
stated once rather than one under load. Benchmark: 1M ~204ms, 10M ~1,984ms —
indistinguishable from the pre-field figures, since `qtyMultiplier === 1`
short-circuits before the mode is ever consulted. `gpPerKill` byte-identical.

### `docs/bosses/*.md` swept — all 14 annotated in-file

Every capability verdict re-read against the current model. **All 14 files got
a banner directly under their H1**, not just a DECISIONS.md note, since the
docs are what a future session reads first. The banner states plainly that
each doc's *mechanics and cited numbers remain accurate and are what to
implement from*, while its "what doesn't exist" section predates Extensions
A/B and is corrected inline, gap by gap.

Headline corrections:

- **`doom-of-mokhaiotl.md`'s central verdict is wrong.** It says the mapping
  "cannot be meaningfully proposed without wave/level machinery existing
  first." Gating each level on `levelAtLeast('delveLevel', n)` fires every
  level up to the one reached — which IS per-level bankable loot — so it is N
  tables in the existing array. Confirmed against `conditions.ts`. This also
  retires the "population of one" question it reopened: neither this source
  nor Fortis Colosseum needs a wave engine.
- **`zalcano.md`'s claim that the MVP bonus needs a mechanism distinct from
  Duke Sucellus's perfect-kill +50% is wrong** — both are "scale this table's
  realized quantity by a scalar gated on a per-run boolean." Its "(rounded
  up)" detail, however, was load-bearing and correct.
- **`ancient-chest.md` gap 3 is resolved as UNNECESSARY** — do not build
  cross-table outcome visibility; conditioned marginals are exact.
- **Lunar Chest and TzHaar Fight Cave are fully unblocked at the model level**;
  what remains for them is boss-document and formula work.
- Genuinely still-open model gaps across all 14, after the sweep: Reward
  Cart's repeated-preroll (needs the anticipated `z.lazy` local-table node),
  Reward pool's `fishingLevel` gating (`levelAtLeast`'s field enum needs
  widening — this is the third real user, the threshold its own comment set),
  ToA's per-raid achievement conditions, Fortis Colosseum's run-scoped dedup
  (deliberately deferred), and party/team context (CoX, Zalcano — out of scope).

### `data/overrides/` built — Phase 7's step 1

The sweep established the ordering constraint for the rest of Phase 7: every
remaining watchlisted source needs hand-authored structure the parser cannot
produce from `{{DropsLine}}` rows, so the override mechanism gates essentially
all of them. Built it rather than continuing source-by-source.

- **`apps/ingest/src/parse/overrides.ts`** — `BossOverrideSchema` (`.strict()`,
  so a typo like `tabels` fails loudly instead of being silently ignored),
  `loadOverride`, `applyOverride`, `overrideSummary`. `docs/OVERRIDES.md` is
  the contract.
- **`tables` replaces wholesale, never per-table-id.** These sources need a
  different *shape*, not a patched row, and a per-table merge would quietly
  leave a stale generated table behind whenever a hand-authored one renamed
  it. All-or-nothing is auditable; partial is not.
- **`source` finally means something**: `'merged'` when generated data
  survives underneath, `'override'` when the parser could not reach the page
  at all. Both enum members were defined in PROJECT_PLAN.md 4.5 and unused
  until now.
- **An override carrying `tables` rescues all three `parse_failed` exits** (no
  wikitext snapshot, no `{{DropsLine}}` calls, assembly returned null), which
  is what makes CoX's Ancient chest reachable.
- **Validation runs on the MERGED document, never the generated one.** A
  hand-authored table whose weights do not sum fails exactly as a bad parse
  would. An override is not a rubber stamp.
- **`manual_override` is a distinct terminal status from `verified`**, not a
  synonym: `verified` asserts the pipeline derived the document from the wiki
  unaided, which would be false for a hand-authored one. Both satisfy Phase
  5's done-when. A failing override still lands in `needs_review`.
- **An override supplying `tables` clears the parser's ambiguous-group
  guesses** (they describe a structure it just replaced) and **nothing else** —
  in particular it does NOT clear the mechanics watchlist. That stays a
  separate human gate with its own verification requirement, per the
  watchlist's own removal policy; `docs/OVERRIDES.md` spells out the
  four-step sequence.
- **A real wiring bug was caught by writing the tests**: with no generated
  document there is nothing to inherit `parserVersion`/`status`/`validation`
  from, so `BossSchema.parse` would have thrown on the very
  `parse_failed`-rescue path the mechanism exists for. `applyOverride` now
  takes `parserVersion` and supplies placeholders that `parseBoss` overwrites
  once the merged document has actually been checked.
- **Verified inert**: `data/overrides/` is empty, and `ingest parse --tier
  A,B,C` reproduces 38/12/3 with a byte-identical diff across all 51 generated
  documents.

`data/overrides/` is deliberately still empty. Abyssal Sire and Corporeal
Beast were fixed in the parser instead, which is the preferred outcome —
reach for an override only after establishing the parser genuinely cannot get
there.

## Player-stat gating: assessed, and the answer is "neither, not yet"

Asked whether `fishingLevel` should widen `levelAtLeast`'s field enum (its
third user, the threshold the enum's own comment set) or whether player-stat
gating wants to be one mechanism instead of N `SimContext` fields. Four
findings, in the order they changed the answer:

1. **`levelAtLeast` is ALREADY the one mechanism.** It is
   `{ field, n }` over an enum, not a per-field condition kind. The question
   was never "one mechanism vs N fields" — it is only "how wide is the enum",
   which is a much smaller question than the framing suggested.
2. **ToA would not be a fourth user.** `docs/bosses/chest-tombs-of-amascut.md`
   says its challenge-reward conditions ("all Akkha invocations and level 4
   Akkha, zero deaths raid-wide") are "structurally a raid-composition/skill
   fact, not a scalar", that "no schema change is even a good fit here", and
   recommends marking those 8 entries out of v1 scope. They are not numeric
   threshold gating at all. The population is 3, not 4.
3. **Only 4 of the 9 numeric `SimContext` fields are ever entry-gated.**
   `delveLevel`, `wavesReached`, `fishingLevel`, `killCount`. The other five
   (`points`, `raidLevel`, `deaths`, `hitpointsDamage`, `shieldDamage`) are
   formula *inputs* in every one of the 14 researched sources — never
   thresholds. An enum that refuses them is doing real work, so "open it to
   any numeric field" is the wrong generalisation.
4. **Decisive: widening the enum would not actually unblock Reward pool.**
   Its gating is **7 mutually-exclusive Fishing-level brackets**, and
   `levelAtLeast` is one-sided — a level-99 player matches all 7 gated entries
   simultaneously. Its own doc says "gated on Fishing level bracket via a new
   lookup". So the change it needs is a *two-sided range*, which is a
   different change from adding a name to an enum.

**Recommendation, and what was done: neither.** No enum widening (it doesn't
unblock its only requester), and no unified player-stat mechanism (the
population is 3, and the two remaining requesters need a different *shape*
than the two existing ones). When Reward pool is actually built, the right
change is an optional upper bound on the existing `levelAtLeast` — which
degrades to today's behaviour for `delveLevel`/`wavesReached` (no upper bound)
and expresses brackets for `fishingLevel`. Folding `killCount` in and retiring
`killCountAtLeast` is a reasonable tidy-up at that same moment: the two have
byte-identical evaluators and **both have zero users in real data** (measured
across every `data/bosses/*.json` and `data/tables/*.json`; the only condition
kinds actually in use are `onSlayerTask` 31, `members` 10, `variant` 2,
`ringOfWealth` 2, `questComplete` 1), so there is no migration cost — but also
no reason to do it before something needs it.

**A fourth shape turned up while implementing Lunar Chest, which strengthens
the "don't unify yet" conclusion**: set membership (`ctx.moonsKilled`). See
below. Numeric threshold, numeric bracket, and set membership are three
genuinely different condition shapes; a single `contextAtLeast` would have
covered only the first.

## Phase 7: Doom of Mokhaiotl shipped as the first real override

`data/overrides/doom-of-mokhaiotl.json`, 42 tables, generated
programmatically from the parsed document rather than hand-transcribed (216
common-table entries across 9 delve levels — transcribing those by hand would
have been a source of silent errors, and the generated doc already holds
wiki-correct items, weights and delve-3 quantities).

- **Verified the load-bearing claim against the wikitext snapshot before
  building, not against the research doc.** The page states "Each delve level
  rolls once on the regular loot table", confirming per-level bankable loot
  and the `levelAtLeast`-gated-tables model rather than the wave machinery
  `docs/bosses/doom-of-mokhaiotl.md` claimed was needed.
- **The page defines `trunc` verbatim as "removes anything after a decimal
  point, rounding up for negative numbers and down for positive ones"** —
  which is exactly `qtyRounding: 'truncDelta'`, independently confirming that
  field's design after the fact.
- **The page supplies its own worked example, and it is now the test**: "a
  player is equally likely to receive 2, 3, or 4 dragon platelegs at delve
  level 3. Delve level 2 has a -0.35x quantity multiplier, which gives
  possible quantities of 2, 2, and 3, respectively, meaning there is a 2/3
  chance to receive two sets and a 1/3 chance to receive three sets." That is
  a *distributional* claim, so `apps/ingest/test/doom-of-mokhaiotl.test.ts`
  asserts it distributionally (only 2 and 3 reachable, ~2/3 twos), not on a
  mean. The default `round` mode would produce a quantity of 1 here; the test
  asserts 1 never appears, which is the signature of the wrong mode.
- **One new formula, `doom_of_mokhaiotl_deep_rolls`** = `max(0, delveLevel-8)`.
  My earlier "constants, no formula needed" was right for delves 1-9 and wrong
  beyond: the level table's deepest row is ">8" while descent continues
  indefinitely, so a delve-12 run rolls that row four times. A constant cannot
  express that. Justified per PROJECT_PLAN.md 4.6 by the page's own text.
- **The `formulas.test.ts` trip wire fired**, exactly as designed — it
  asserted *every* `FORMULA_ID` throws, which stopped being true the moment a
  real implementation landed. Updated to assert "every id that is NOT
  implemented still throws" (the actual guard: a stub must never become a
  silent zero) plus a second half pinning the implemented set, so the wire
  re-fires next time. `IMPLEMENTED_FORMULA_IDS` is exported for it.
- **Watchlist entry removed only after the wiki-figure check existed**, per
  policy. 7 tests: the worked example at delves 2 and 3, strictly-increasing
  loot with depth, per-unique minimum delve levels and accumulating per-level
  rates (a delve-4 run rolled cloth at levels 2, 3 AND 4's rates), cumulative
  demon tears, and the deep-delve repeat.
- **Result: `manual_override`** — the first document to use that status, and
  the first exercise of `data/overrides/` end to end. Tier A+B+C is now
  **38 verified + 1 manual_override / 11 needs_review / 3 parse_failed**.

## Lunar Chest: blocked, and my own sweep banner was wrong about it

Started Lunar Chest second and found it is **not** implementable, correcting
the banner this session had just written on `docs/bosses/lunar-chest.md`
("fully unblocked at the model level"). That claim was derived from the
`SimContext` field list; checking `conditions.ts` while actually building it
showed the gap:

- **`ctx.moonsKilled` exists, but no `Condition` kind can read it.** The seven
  kinds are `members`/`ringOfWealth`/`onSlayerTask`/`questComplete`/
  `killCountAtLeast`/`variant`/`levelAtLeast`; none does set membership.
  **Having a `SimContext` field is not the same as being able to gate an entry
  on it** — that is the mistake the banner made, and it is worth stating
  plainly because the same reasoning error would recur for any future
  non-scalar context field.
- `variant` cannot substitute: it is single-valued, and up to three Moons
  apply to one chest opening simultaneously.
- What IS fine: the 1x/3x/6x standard-loot roll count (a `formula`-kind
  `Table.rolls` can read `moonsKilled.length`), the per-set duplicate
  protection (`ownershipGate` + `effectiveWeightedPool`), and "any unique
  suppresses the standard table" (`suppressesFollowing`).

So Lunar Chest needs exactly one new capability — a set-membership condition —
which is squarely the condition-kind-proliferation question this session was
asked to think hard about before adding to. **Not added unilaterally**; the
banner is corrected and this is flagged for a decision.

## `Condition.includes` — set membership, as a general mechanism

Added `{ kind: 'includes', field, values }` over set-valued `SimContext`
fields, per instruction and deliberately not `moonsKilled`-specific.

- **`values` means ANY of them (disjunction), and that choice is the point.**
  `conditionsHold` already ANDs the whole `conditions` array, so conjunction
  ("blood AND blue") is two `includes` conditions and costs nothing.
  Disjunction has no other expression anywhere in the model. Spending the
  field on the meaning that isn't otherwise available is the only reading that
  adds capability rather than duplicating it.
- **`field` admits `questsComplete` as well as `moonsKilled`**, so this is a
  real mechanism over set-valued fields rather than a special case wearing a
  general name. The pre-existing `questComplete` kind stays: it is named in
  PROJECT_PLAN.md 4.4 and is in live use in `data/`, so retiring it would be a
  data migration for no behavioural gain.
- **Three distinct gating shapes now exist and none subsumes the others**:
  numeric threshold (`levelAtLeast`), numeric bracket (Reward pool's seven
  mutually-exclusive Fishing tiers — still unbuilt, and provably not
  expressible by widening `levelAtLeast`), and set membership (`includes`).
  This is the concrete evidence behind the earlier "don't unify player-stat
  gating yet" recommendation.
- **`apps/web`'s exhaustive `conditionLabel` switch caught the gap** and was
  updated to render the new kind ("Killed blood or blue"). That switch is a
  real trip wire, not boilerplate — a new `Condition` kind fails the web
  typecheck until the UI can display it.

## Phase 7: Lunar Chest shipped (`manual_override`)

`data/overrides/lunar-chest.json` plus three new
`data/tables/lunar_chest_{blood,blue,eclipse}_set.json` records.

- **Two levels are structurally necessary, which is why the sets are
  `tableRef` targets.** The mechanic is "1/56 trigger, then uniform over that
  set's not-yet-obtained pieces". Flattening it into one weighted table cannot
  work: `effectiveWeightedPool` subtracts an excluded entry's weight from the
  denominator, so a 224-denominator flat table with one piece owned would give
  3/223 overall instead of the correct 1/56. With the sub-table, the trigger
  stays 1/56 and only the *within-set* split changes (4 unowned → 1/4 each;
  2 unowned → 1/2 each), which is what the page describes. `oneOf` could not
  substitute — `LeafEntry` carries no `ownershipGate`.
- **`data/tables/` now means "referenced by id", not "shared by many".** The
  three Moon sets have exactly one referencing source each. Documented at the
  loader.
- **`loadSharedTables` is now directory-driven** rather than a hardcoded id
  list, with a filename/`id` consistency check. The list version failed in the
  worst direction: a new record was silently ignored until someone remembered
  to register it, surfacing as an unresolvable `tableRef` whose real cause
  (file present, unregistered) was invisible.
- **The 1/224 figure in the drop rows is deliberately unused.** The page says
  it is the naive first-piece-only rate that does *not* account for duplicate
  protection. It appears in this model only as a derived consequence
  (`1/56 × 1/4`) for a player owning none of a set, never as an input.
- **A modelling assumption is flagged in the override's own `note` rather than
  hidden**: a 1/56 trigger for an already-completed set still counts as a hit
  for suppression purposes, since the engine decides suppression at the access
  roll. The page says such a roll does "nothing useful" but does not say
  whether it still blocks standard loot. Affects only players holding a full
  set.
- **One test was wrong in an instructive way and was rewritten.** It measured
  "fraction of openings yielding a unique" over 400k openings and got ~1/1730
  instead of ~1/19. That is the mechanic working: ownership is
  **lifetime-scoped**, so one long run collects all 12 pieces early and every
  later opening correctly yields nothing. A first-opening rate cannot be
  measured as a long-run average. Replaced with three sharper checks: the
  analytic per-set rate on a fresh account (exactly 1/56 per set, 3/56 total
  by linearity), P(any unique in a *fresh* opening) measured across 20,000
  independent single-opening runs (~1/19, distinguishing it from 3/56), and
  the sharpest statement of the whole mechanic — **over 100k openings every
  one of the 12 uniques drops exactly once, ever.**
- 9 tests. Watchlist entry removed only after they existed.

## Zalcano: NOT shipped — blocked on three capabilities, one unfixable by widening

Assessed and stopped rather than inventing condition kinds at the end of a
session that had just been asked to think hard before adding any. Zalcano
needs, per `docs/bosses/zalcano.md` (revid 15287396):

1. **A condition reading a boolean `SimContext` field (`isMVP`)** — infernal
   ashes are MVP-only, "always/never based on a role, not a rate". The three
   existing boolean conditions (`members`/`ringOfWealth`/`onSlayerTask`) each
   hardcode their own field; none is general.
2. **Numeric thresholds on `shieldDamage`** (≥5 for any drop eligibility) —
   `levelAtLeast`'s field enum does not admit it. This is the enum-widening
   question again, for a fourth set of fields.
3. **A COMBINED threshold: `hitpointsDamage + shieldDamage >= 31`** for
   unique/pet eligibility. **No field-based condition can express this at any
   enum width** — it is a function of two fields. It needs either a derived
   context field or a formula-valued condition, which is a genuinely new
   condition *shape* (a fourth, after threshold / bracket / set membership).

Also needs two real formulas (`zalcano_points`'s `P_M`/`P_T`, and the Zalcano
shard's `1/750`–`1/1500` contribution interpolation), plus the crystal-shard
quantity as a role-keyed tier. Those are ordinary Phase 7 work; (3) is the
design decision.

Worth carrying forward: `docs/bosses/zalcano.md` itself flags **an unresolved
in-page contradiction** — a Mod Lenny tweet implying a points-scaled pet rate
versus a 21 May 2020 news post stating a "static 1/2,250". The doc recommends
treating the newer post as authoritative but explicitly declines to resolve
it. Do not silently pick one.

## The reward-pool/Wintertodt re-flag: stale, and the check that should have settled it had two holes

Asked to determine whether the flagged "Reward pool is Tempoross's, not
Wintertodt's" misattribution was a regression, a gap in
`checkWatchlistConsistency`, or a stale re-flag. **It is a stale re-flag, and
the check had two real gaps** — the gaps being the part that mattered.

### The data is correct and has been for a while

`data/mechanics-watchlist.json` maps `reward-cart` -> Wintertodt /
`wintertodt_points` and `reward-pool` -> Tempoross / `tempoross_points`, which
agrees with `data/_inventory.json`. `checkWatchlistConsistency` reports zero
issues against both real committed files, and `watchlist.test.ts`'s real-data
case passes. Nothing regressed.

**Why it kept coming back, which is the actually useful finding:**
`docs/bosses/reward-pool.md` and `docs/bosses/reward-cart.md` each carried a
section saying the watchlist "**currently reads**" the swapped values. Those
were written while the bug was live and were never updated when it was fixed,
so every session that read the research docs re-derived a bug that no longer
existed — `plan/HANDOFF.md`'s own "suggested next steps" item 6 is a
transcription of that stale sentence, sitting in the same file as landmine #9.3
which records the fix. Both banners are now rewritten to state the resolution
first and describe the bug in the past tense. A doc that describes current
state in the present tense becomes a lie the moment the state changes; these
two now say what they are.

### Gap 1: `entry.title` was unvalidated AND load-bearing inside the check

The old exclusion rule was
`.filter((title) => title !== entry.title)` — a hand-authored string deciding
which bosses the check expects in `blockedBy`. So an entry whose `title` was
set to its own boss page, with `blockedBy` emptied, **passed vacuously**:
verified by mutation against the real data (`reward-pool` retitled to
"Tempoross" with `blockedBy: []` -> zero issues). The check could be disarmed
by the one field nothing checked.

Fixed by deriving "this source's own boss page" from generated data instead:
the boss whose `title` **is the loot source's `dropsPage`**. Confirmed to
reproduce the current expected set for all 7 real entries before switching.
`title` is now validated rather than believed — it must equal the inventory's
`title` or its `dropsPage`. Both spellings occur legitimately (`reward-cart`
uses the title; `rewards-chest-fortis-colosseum` uses the drops page, since the
inventory's title for it is the activity "Fortis Colosseum"), which is why the
rule admits either rather than picking one and "fixing" three entries.

### Gap 2: the swap had two halves and only one was ever guarded

The original bug was not just `blockedBy`. Each entry **also** described the
other's activity in prose and named the other's formula. The check only ever
looked at `blockedBy`, so re-swapping the two `detail` bodies passes clean —
confirmed by mutation. And the prose is the half that matters most for what
comes next: `plan/HANDOFF.md`'s own instruction was "fix before wiring either
formula," and the formula id lives only in the prose.

Two new rules, both derived from `data/_inventory.json` with no new
hand-maintained mapping:

- **`detail` must not name a boss page belonging to another loot source**
  (whole-word matched — substring matching would fire on a boss named "Moon"
  inside the word "Moons").
- **A formula id named in `detail` whose subject resolves to a boss slug must
  resolve to one of this source's bosses.** `wintertodt_points` -> `wintertodt`
  -> `reward-cart`. This catches the sharpest case: `blockedBy`, `title` and
  prose all correct, only the formula swapped.

Rule 4b **stays silent when a formula's subject resolves to no boss slug**
(`toa_invocation`, `tob_points`, `cox_points`), rather than guessing — the same
"act only when the signal narrows unambiguously" discipline `build-tables.ts`'s
three-signal pipeline already uses.

All four rules were validated against the real corpus before being written:
**zero false positives across all 7 entries**, and each fires on its own
failure mode. Five new tests in `watchlist.test.ts` cover the newly-guarded
halves.

**`lootSourceEntry`'s test helper now defaults `dropsPage` to `title`**,
matching the real inventory (they differ only for a reward page whose drops
live off the activity's own page). Two existing fixtures had left it as
`'Placeholder'`, which was harmless while nothing read it and wrong the moment
something did.

## Zalcano: shipped, via a derived context field rather than a fourth condition shape

The blocker was `hitpointsDamage + shieldDamage >= 31` — a threshold over two
fields, which no field-based condition expresses at any enum width. The
previous session recorded this as needing "a derived context field or a
formula-valued condition, ... a genuinely new condition *shape*".

**It is the derived field, and this is not a close call.** A formula-valued
condition would make conditions arbitrary code and break the resolved-once
invariant that `compile.ts`'s header states and `expectedValue` structurally
depends on — the same invariant that was deliberately protected twice already
(Extension B's `ownershipGate` refusing to become a `Condition` kind, and the
"don't unify player-stat gating" assessment). A derived field changes no
contract: `totalDamage` is resolved once at run setup, at the same moment as
every other field, and `levelAtLeast` reads it as a plain `ctx[field] >= n`.

- **`withDerivedContext` is called from `compileBoss`, not only
  `resolveSimContext`.** `compileBoss` is the single point both `simulate` and
  `expectedValue` funnel through, so a hand-built context passed straight to
  either — which `plan/HANDOFF.md` documents as a real usage — gets the same
  treatment. Whatever a caller supplies for a derived field is **overwritten,
  never merged**, so it cannot drift from its inputs; a test passes a context
  claiming `totalDamage: 999` on inputs summing to 15 and asserts the gate
  still refuses.
- **`levelAtLeast`'s enum gained `shieldDamage` and `totalDamage`.** This is
  not a reversal of the "Player-stat gating" entry: that assessment declined
  widening **for `fishingLevel`**, on the specific ground that it would not
  unblock its only requester (Reward pool needs two-sided brackets). Here
  widening does unblock the requester, and `fishingLevel` is still absent.
- **No boolean-field condition kind was added.** Zalcano's `isMVP` needs are
  met without one: infernal ashes is a `formula`-kind `Rate` returning 1 or 0
  (an `independent` entry with `p` of exactly 1 or 0 is the degenerate
  Bernoulli case that mode already handles — the same reasoning that admitted
  `always` rates into `independent`), and the MVP's +10% is a `formula`-kind
  `qtyMultiplier`. Three new formula ids, each pinned to a quoted sentence.

### What shipped, and what deliberately did not

`data/overrides/zalcano.json` (generated programmatically from the parsed
document, so items/ids/weights are not retyped) models: both eligibility gates,
the role-keyed crystal shard tier (1/2/3), MVP-only infernal ashes, the MVP's
+10% with `qtyRounding: 'ceilDelta'`, and the tertiary table's stated splits.
`apps/ingest/test/zalcano.test.ts` is the wiki-figure check, 12 tests against
the real generated document.

- **A test caught a real modelling error before it shipped.** The first version
  gated the tertiary table on the combined threshold alone, which let a player
  who dealt 1,000 hitpoint damage and 4 shield damage collect uniques. The
  page's sentence is a chain, not an either/or, and the 23 May 2024 Changes
  entry says so outright: "All players must now deal some 'armour' damage to
  Zalcano to be eligible for drops." Uniques now require **both** gates.
- **The Smolcano contradiction the research doc flagged is resolved by the
  page, not by me picking a side.** `docs/bosses/zalcano.md` says a Mod Lenny
  tweet implying a points-scaled pet rate contradicts a 21 May 2020 news post
  stating a static 1/2,250, and declines to resolve it. Reading the actual
  wikitext turns up a third statement the doc never quoted: the `===Tertiary===`
  prose says outright "The chance of rolling Smolcano is unaffected by
  performance." That agrees with the news post and dates the tweet's 1/2,175
  example to before the change. Flat 1/2,250, on the page's own authority.
- **Zalcano STAYS on the mechanics watchlist, so it is `needs_review`, not
  `manual_override`.** Two curves the page states exist and never states:
  (1) main- and tertiary-table drops "scale with the player's points", with
  `P_M`/`P_T` defined exactly but no function turning points into loot; (2) the
  Zalcano shard's "Between 1/750 and 1/1500 depending on contribution", with no
  interpolation given. Removing the watchlist entry would be exactly the failure
  the watchlist exists to prevent — marking something verified on the strength
  of a signal that cannot see the problem. Same treatment as Duke Sucellus's
  frozen-tablet curve. The entry's `detail` is narrowed to name precisely those
  two curves and to record what IS now modelled and verified.
- **`zalcano_points` stays a stub on purpose.** `P_M = H + 2S` and
  `P_T = min(H,400) + 2*min(S,300)` are exact and quotable, but nothing can
  consume them until the scaling curve is known. Implementing them would put an
  entry in `IMPLEMENTED_FORMULA_IDS` with no consumer and create the impression
  that point-scaling is modelled.
- The `formulas.test.ts` implemented-set trip wire **fired for the third time**,
  as designed. Pin updated, guard kept.

Corpus after: `ingest parse --tier A,B,C` is **38 verified / 2 manual_override /
10 needs_review / 3 parse_failed — unchanged**, which is the correct outcome:
Zalcano was `needs_review` before for a bad reason (unmodelled mechanics) and is
`needs_review` now for a good one (two wiki-unknown curves, everything else
modelled and tested).

## `SimContext` wired into the UI, by deriving each boss's control set

Doom of Mokhaiotl was shipped and simulate-able with no `delveLevel` control,
Lunar Chest with no `moonsKilled`. Fixed, but the interesting part is how the
control set is decided.

- **Controls are derived from the boss document, not a fixed list.** Rendering
  all sixteen fields on every boss buries the two that matter; rendering none is
  how this bug happened. `apps/web/src/lib/context-fields.ts`'s
  `contextSurfaceOf` walks the document the same way the existing quest toggles
  are built from the boss's own `questComplete` conditions.
- **A condition-only scan is not enough, and Zalcano proves it.** `isMVP`
  appears in no condition anywhere in Zalcano's document — it is read only
  inside `zalcano_mvp_share`/`zalcano_mvp_only`. A document walk can never see
  that, so `FORMULA_CONTEXT_FIELDS` (in `formulas.ts`, next to the
  implementations that own the knowledge) declares which `SimContext` fields
  each formula reads, and the walk unions them in from every place a formula can
  be referenced — rates, quantities, roll counts, and both `qtyMultiplier`
  sites. A test asserts this: Zalcano's document mentions `isMVP` in zero
  conditions, and the control appears anyway.
- **That declaration is verified behaviourally, not trusted.** A hand-maintained
  "what this function reads" list rots silently, so `formulas.test.ts` varies
  every *undeclared* field against every implemented formula and asserts the
  output does not move, plus the converse (an implemented formula declaring
  nothing is a bug). A declaration cannot drift from the code without failing.
- **Derived fields expand to their inputs.** A `totalDamage` control would do
  nothing, since `withDerivedContext` overwrites it. `DERIVED_CONTEXT_FIELDS`
  states the relationship once, in the model, and both the UI and the URL
  encoder read it — Zalcano shows "Damage to hitpoints" and "Damage to shield",
  and no `totaldmg` param is ever written.
- **The walk follows `tableRef` into shared tables, cycle-guarded.** Lunar
  Chest's per-set duplicate protection lives entirely in the three
  `lunar_chest_*_set` records, so a boss-document-only walk finds no ownership
  controls for the one source that most needs them. `BossView` already loads
  those tables; they are now passed through.
- **Every newly-exposed field round-trips through the URL**, including
  `moonsKilled` and `ownedCounts` (as `key:count` pairs), so a delve-8 run or an
  MVP kill is as shareable as a ring-of-wealth run always was
  (PROJECT_PLAN.md 9). Only non-default values are written, so a plain
  `/boss/vorkath` link is unchanged — asserted by a test.
- **`DropTableView`'s `conditionLabel` had a silent bug the trip wire missed.**
  Its `levelAtLeast` case was a ternary (`field === 'delveLevel' ? 'Delve level'
  : 'Wave'`), so widening the enum would have rendered "Wave ≥ 31" for a damage
  threshold rather than failing the typecheck. That switch is documented as a
  trip wire; a ternary inside it is a hole in the wire. Replaced with an
  exhaustive `Record`, which a new field now genuinely fails.

Verification: 4 render tests (`SimContextControls.test.tsx`) drive the real
component against the real generated documents through the configured
jsdom/testing-library path, asserting each boss gets its controls and that
Brutus gets none of them. **Not verified in a live browser this session** —
Playwright is not a dependency of this repo (only the browser binaries from a
previous session's global install remain on this machine), and adding one was
not in scope. A jsdom render is weaker than the real-browser check this repo
used for Phase 4 and is reported as such rather than as equivalent.

## Benchmark: A/B'd in the same sitting; the 10M figure is over 2s and it is not this change

Per `plan/HANDOFF.md`'s warning against attributing a move without a controlled
A/B, the `withDerivedContext` call in `compileBoss` was reverted in place,
benchmarked, and restored, all within minutes on one machine:

| Variant | 1M kills | 10M kills |
|---|---:|---:|
| A — with the derivation | ~227ms | ~2,234ms |
| B — derivation reverted in place | ~220ms | ~2,108ms |
| A' — restored, re-measured | ~225ms | ~2,202ms |

- **The A-vs-B delta is inside this machine's documented same-code noise band.**
  `plan/HANDOFF.md` records the *same* code measuring 1,973 / 1,981 / 1,852 /
  1,926ms at 10M — a 129ms spread. The A-vs-B delta is 126ms, and A' lands
  between A and B rather than tracking either. `gpPerKill` is byte-identical
  (597.2676 / 598.4495) across all three, matching every previously recorded
  variant.
- **The mechanism agrees with reading it as noise.** `withDerivedContext` runs
  once per `compileBoss` call — three times per benchmark line, not 10M times —
  and for Brutus it returns the *same object* (both damage inputs are 0, so the
  derived value already agrees), so it does not even allocate.
- **The real signal is that variant B — the baseline WITHOUT this change — is
  already ~2,108ms, over the ~2.0s reading of PROJECT_PLAN.md 8's "couple of
  seconds."** This is the pre-existing condition the previous session flagged
  (it measured ~1,981ms for a baseline with step (c)'s lines removed), now on a
  slower-running machine. **Flagged with the measurement, not acted on**: the
  duplicated-`emit`/`runTable` lever `plan/HANDOFF.md` nominates targets
  Extension B's ~25% overhead, and the previous session's own measurement said
  it buys back far less than the gap. Building it should follow a fresh
  benchmark justifying it, not this observation.

## Playwright: the real-browser suite, and the two production bugs it found immediately

`apps/web` gained `@playwright/test`, `playwright.config.ts`, `e2e/` (17 tests)
and a `test:e2e` script. Deliberately **not** part of `pnpm -r test` — it needs
a browser binary and a production build — so `ci.yml` runs it as a separate
`e2e` job.

- **It runs against the PRODUCTION build served under the GitHub Pages subpath,
  through a hand-written GitHub Pages mimic (`e2e/gh-pages-server.mjs`), not
  `vite preview`.** This is the load-bearing choice. `vite preview` has an SPA
  history fallback, so every unknown path silently resolves to `index.html` and
  a deep link "works" in preview even when `dist/404.html` is missing or the
  router's `basename` is wrong — the test would agree with a broken deploy.
  GitHub Pages instead serves `404.html` at an HTTP **404** status, and the app
  only recovers because `scripts/copy-404.mjs` made that file a copy of
  `index.html`. The suite asserts the 404 status *and* that the app rendered,
  which is what distinguishes the mechanism working from a server papering over
  it. The mimic also answers anything outside the base prefix with a plain 404
  and no app, because on the real host that path belongs to a different site.
- **`import.meta.env.BASE_URL` is `/osrs-loot-simulator/` only in a build with
  `GITHUB_ACTIONS` set**, so every asset and data URL the app derives from it is
  a different string in production than in any test that had ever run here. The
  `webServer` command builds with that variable rather than reusing a `dist/`,
  so the suite cannot pass against a stale build from a different config.

### Bug 1: the browser's shared-table list was hardcoded and had gone stale

`apps/web/src/lib/api.ts` carried
`const SHARED_TABLE_IDS = ['rare_drop_table', 'gem_drop_table',
'mega_rare_drop_table']`. `data/tables/` has held **six** records since Lunar
Chest shipped. The three `lunar_chest_*_set` tables were never fetched.

**This is the exact bug `loadSharedTables` was already fixed for** (see
`apps/ingest/src/tables/shared-tables.ts`: "The list version silently ignored
any new record until someone remembered to add it"). The frontend kept the
version ingest had abandoned.

Consequences in production, measured rather than inferred:

- With no Moon selected, Lunar Chest simulates fine — its three `tableRef`s sit
  behind an `includes` condition on `moonsKilled`, so `compileTable` filters
  those entries out and never resolves them. **This is why it shipped:** the
  only configuration anybody would test casually is the one that hides it.
- With any Moon selected — the only configuration in which Lunar Chest's
  mechanic exists at all — `simulate` throws `UnresolvedTableRefError`, which
  the worker reports as "Simulation failed."
- The ownership controls never rendered at all, because `contextSurfaceOf` had
  no table to follow the `tableRef` into.

**jsdom could not have caught this, and the reason is worth keeping.**
`test/SimContextControls.test.tsx` builds its `sharedTables` map by
`readdirSync`-ing `data/tables/`. That is a correct map. It is also a map the
browser has no way to construct — it fetches over the network from whatever
list the app decides to ask for. The jsdom test was passing on a code path
production does not take.

**Fix: make the browser's list directory-driven too, the same way ingest's is.**
`readdir` is not available in a browser, so the directory listing is handed to
it: `SiteIndexSchema` gained `tables: string[]`, generated by `buildSiteIndex`
from the same scan `loadSharedTables` does, and `useSharedTables` chains off
`useSiteIndex` to fetch by that manifest. The id/filename equality
`loadSharedTables` already enforces is what makes deriving ids from file names
safe rather than a second source of truth.

Guarded by a new real-data test in `apps/ingest/test/site-index.test.ts`: every
`tableRef` reachable from any boss document **or from any shared table**
(transitively — `rare_drop_table` reaches the gem table, which reaches
mega-rare) must appear in `index.tables`. It asserts *coverage*, not equality:
`data/tables/` may legitimately hold a record nothing references yet, and only
the other direction breaks production. It also asserts the referenced set is
non-empty, so a corpus with no refs cannot pass it vacuously.

### Bug 2: two in-app links escaped the base path

`BossView.tsx` linked the admin page as `<a href={`/admin?slug=...`}>` and
`AdminPage.tsx` linked back as `<a href={`/boss/${slug}`}>`. Both are
root-absolute, so on GitHub Pages they point at paths belonging to a different
site entirely. Replaced with react-router `<Link>`, which applies the router's
`basename` (set from `import.meta.env.BASE_URL` in `main.tsx`) — one mechanism
covering dev and prod. `SearchBox` was already correct: it uses `navigate()`.

The guarding test is deliberately a sweep, not two assertions: it collects every
`a[href^="/"]` on a rendered page and asserts none of them leaves the base
prefix, so a third one added later fails without anyone remembering to add a case.

### `data/index.json` was stale

It recorded Doom of Mokhaiotl and Lunar Chest as `needs_review` while their own
documents said `manual_override` — `ingest site-index` had not been re-run since
those shipped. Regenerated. Nothing reads status for correctness, but the admin
page and the search list both display it, so it was visibly wrong in the UI.

## Validation checks whose scope is decided by a field: an audit, and one live hole

Prompted by `checkWatchlistConsistency`'s `entry.title` gap (a hand-authored
string that decided which bosses the check expected, and could disarm the check
when mutated). The question asked was whether any other check has scope decided
by a field, and whether its tests move that field rather than only the data.

### `refs_resolve` — LIVE, and it was vacuous on the real corpus

The whole check was `compileBoss(boss, resolveSimContext(boss, {}), { tables })`,
on the good reasoning that reusing the simulator's own resolution path means
only one place decides whether a ref resolves. The scope that produced was
decided by a field nothing validated: **`SimContext`**. `compileTable` filters
condition-excluded entries *before* resolving anything they point at.

Measured, not argued: `checkRefsResolve(lunarChest, new Map())` returned
**`ok: true, "resolved against 0 shared table(s)"`** — a clean pass with
literally nothing resolved, because all three of Lunar Chest's refs are gated on
`includes` over `moonsKilled`, which is empty by default. Cerberus, whose RDT
ref is unconditional, correctly failed the same call. This is the ingest-side
twin of the frontend bug above: both said Lunar Chest's `tableRef`s were fine
while nothing had ever resolved one.

**Fixed by making resolution structural**, which is what PROJECT_PLAN.md 7
actually specifies ("Every `tableRef` resolves and the graph is acyclic" is a
property of the document, not of a run). A walk that ignores conditions entirely
now decides resolution; `compileBoss` is kept behind it as a cross-check that
the real path agrees on the subgraph it can see. The walk closes two narrower
gaps at the same time:

- It descends into `oneOf` nodes. `LeafNodeSchema` admits `tableRef`, so a
  nested ref was legal and completely invisible to the old
  `boss.tables.some(t => t.entries.some(...))` short-circuit, which answered
  "no tableRef nodes" for a document that had one. No source does this today.
- It follows refs transitively through `data/tables/`, with proper
  visiting/done DFS colouring so a diamond is not misreported as a cycle.

**The tests are the actual deliverable here.** Every pre-existing
`refs-resolve.test.ts` case used an *unconditional* `tableRef` — they mutate the
data (add a ref, remove a table, build a cycle) and never the field that decides
what the check looks at, which is exactly why the hole survived them. Added a
scope-mutation suite that holds the data fixed and moves the condition instead:
six conditions, each false under the default context (`includes`, `members`,
`questComplete`, `killCount`, `levelAtLeast`, `variant`), each of which used to
make the check pass vacuously. Plus the real-data pair: Lunar Chest must fail
against an empty table map and must report a non-zero resolved count against the
real directory — the count being the observable difference between "resolved"
and "nothing was reachable, so nothing failed".

### `qty_sane` — LATENT, same node-kind blind spot, closed

It looped `entry.node.kind` flatly, so a `formula`-kind quantity on an item node
inside a `oneOf` was unchecked. Legal per `LeafNodeSchema`, zero live instances.
Made recursive; mutation test added.

`rates_valid` needs no equivalent: `NodeSchema`'s refinement pins `oneOf`
entries to `weight` rates, so a formula rate cannot hide there.

### Single-context evaluation in `rates_valid`/`qty_sane` — LATENT, measured, not acted on

Both evaluate formulas at exactly one context (`resolveSimContext(boss, {})`), so
a formula in range at the default and out of range elsewhere would pass. Swept
all 51 sources against 11 context mutations (delve 0/1/50, all Moons, MVP, zero
and huge damage, waves 200, points 1e6, fishing 99, kc 1e6): **zero flips.** The
hole is real in principle and empty in practice, so it is recorded rather than
answered with multi-context evaluation machinery nothing currently needs.

### `weights_sum` — checked, no permissive hole

Its scope comes from `table.mode`, `entry.rate.kind` and the `members`
condition. Mutating any of them makes it stricter or leaves it unchanged, never
disarmed: adding a `members` marker splits a flat table into two variants that
must each match exactly, and non-`members` conditions leave entries summed into
every variant (which can only overshoot the denominator, i.e. fail loudly).
Worth noting an asymmetry for whoever touches it next: the flat branch tolerates
a shortfall (legal per 4.3's implicit `nothing`) while the members/f2p branches
demand exact equality. Not changed — flagged.

## Extension B's real cost: it is not the tracker, it is the branches

`plan/HANDOFF.md` nominated a "duplicated `emit`/`runTable`/
`runWeightedWithoutReplacement` pair" as the lever for Extension B's overhead.
The instruction this session was to leave that lever alone and first check
whether the ownership tracker could be skipped entirely for bosses with no
gates. Measured properly, **the framing was wrong in a useful way: the tracker
is nearly free, and the cost is branchiness inside the innermost loops.**

Method, since `plan/HANDOFF.md` correctly warns this machine drifts ±130ms at
10M: variants were **interleaved across processes** (A, B, A, B… copying a
whole `simulate.ts` in between and running the same benchmark), not measured all
of A then all of B. `gpPerKill` was byte-identical (597.2676 / 598.4495) in
every run of every variant, which is the check that actually matters.

Single-factor ablation against current `A`, three interleaved rounds, Brutus,
median of per-round medians:

| Variant (one thing removed from A) | 10M | Δ vs A |
|---|---:|---:|
| A — current | 2,194ms | — |
| C1 — the per-emission `trackedItemKeys` check in `emit` | 2,163ms | −1.4% |
| C2 — the weighted-table ownership branch | 2,063ms | −6.0% |
| C3 — the three `gated &&` per-entry guards | 2,002ms | −8.8% |
| B — ALL ownership code, including the `owned` parameter | 1,862ms | −15.1% |

C1+C2+C3 ≈ B, so the residual attributable to threading the `owned` parameter
and allocating the tracker is **≈ 0**. "Skip the tracker for bosses with no
gates" would therefore have bought almost nothing; the object was never the
problem.

What *is* the problem, and both findings were surprising enough to be worth
recording:

1. **`if (gated && ...) continue` with `gated` a hoisted `false` boolean cost
   8.8%** on a boss that has no gates anywhere and never took the guarded path
   once. Hoisting the *value* out of the loop is not the same as hoisting the
   *test*.
2. **`let weights/cum/denominator` assigned in an if/else cost 6.0%** versus
   `const` ternaries, on a boss where the else-arm never executes. A binding
   written in two places is not the same thing to the JIT as one written once.

**Shipped**: split the `always` loop on `gates === null`, inline the gate check
in `independent`/`preroll` rather than calling a helper, and replace the
weighted `let`s with `const` ternaries. No duplicated `emit`/`runTable`.

An intermediate version that kept a `gateAllows(...)` helper in the loops
recovered only about a third of what inlining did — an uninlinable call in the
innermost loop costs even on runs where it never executes. That is the reason
the shipped code has the gate condition written out three times instead of once,
and the reason not to "tidy" it back into a helper.

Final interleaved A/B, four rounds:

| Variant | 1M | Δ | 10M | Δ |
|---|---:|---:|---:|---:|
| A — before | 223.7ms | — | 2,204ms | — |
| **Shipped** | **208.2ms** | **−6.9%** | **2,089ms** | **−5.2%** |
| B — no ownership at all (the ceiling) | 196.9ms | −12.0% | 1,893ms | −14.1% |

**Reported honestly: this does not clear the 2.0s reading of the bar.** An
earlier three-round measurement of the same shape put it at −9.4%; the
four-round run put it at −5.2%. The true figure is somewhere in that band and
10M still lands around 2.0–2.1s. The remaining ~9% to the ceiling is the
parameter threading, which is what the duplicated-`emit` lever would buy — still
not pulled.

## Is 10M the right benchmark bar? No — 1M is, and the reason is measurable

PROJECT_PLAN.md 8 says "10M kills should complete in a couple of seconds," and
every session since has treated 10M as the number to defend. Three observations
from this session's data argue it should be an occasional check, not the gate:

1. **Nobody runs it.** `DEFAULT_KILLS` in `apps/web/src/lib/url-state.ts` is
   **10,000** — three orders of magnitude below the bar, and ~2ms of work. 10M
   is the maximum the input allows, not a typical run. The simulation already
   runs in a Web Worker with the main thread free, so even the maximum is a
   background task with a progress indicator, not a freeze.
2. **10M carries no information 1M doesn't.** Scaling is dead linear across
   every variant measured: 2204/223.7 = 9.85, 2089/208.2 = 10.03,
   1893/196.9 = 9.61. No GC cliff, no allocation growth, no cache effect appears
   between the two.
3. **10M is not the more precise measurement, which is the surprise.** Relative
   round-to-round spread on this machine was comparable at both sizes (A: 1.6%
   at 1M and 1.6% at 10M; shipped: 3.2% and 7.2%). 10M costs 10× the wall-clock
   and does not buy tighter numbers — the noise is proportional, because it is
   machine drift rather than per-run variance.

**Recommendation: make 1M the routine regression bar and run 10M occasionally as
a linearity check.** A regression that matters will show at 1M at the same
percentage, in a tenth of the time, which means it can be run more often. This
does not lower the standard — the ~2s-at-10M budget is still the stated
requirement and is still being met to within a few percent — it changes which
measurement is used to defend it day to day. Flagged as a recommendation, not
applied: PROJECT_PLAN.md 8 is spec text and changing it is the user's call.

`test/bench.tmp.ts` now takes `--label`/`--reps`/`--kills` so an external script
can interleave two builds and tag each line, which is what made the ablation
above possible.

## `Condition.levelAtLeast` gains an optional upper bound; `killCountAtLeast` retired

Both halves of what docs/DECISIONS.md's "Player-stat gating" entry predicted:
"the right change is an optional upper bound on the existing `levelAtLeast`",
and it declined to add `fishingLevel` to the enum until that bound existed, on
the ground that widening alone would not unblock its only requester.

- **`atMost`, inclusive, optional.** Absent means the original one-sided
  threshold, which is what all 554 existing uses in `data/` are — which is also
  why the kind keeps the name `levelAtLeast` rather than becoming
  `levelInRange`, a corpus-wide migration for no behavioural gain.
- **Enum gains `fishingLevel` and `killCount`.**
- **An inverted bracket (`atMost < n`) is rejected by the schema**, because
  `compileTable` would otherwise drop the entry silently — an impossible gate
  deletes an entry rather than gating it, and nothing downstream complains. The
  refinement is attached to the finished union, not to the `levelAtLeast`
  member: zod's `discriminatedUnion` requires plain `ZodObject` options and a
  `.superRefine` on one turns it into a `ZodEffects` the union rejects.
- **`killCountAtLeast` is retired into `levelAtLeast`'s `killCount` field.** It
  is named separately in PROJECT_PLAN.md 4.4 — a deliberate deviation, logged
  here. Its evaluator was byte-identical to `levelAtLeast`'s, and it had **zero
  uses** across every `data/bosses/*.json`, `data/tables/*.json` and
  `data/overrides/*.json`, measured at the moment of removal (the only kinds
  actually in use are `levelAtLeast` 554, `onSlayerTask` 31, `members` 10,
  `includes` 6, `variant` 2, `ringOfWealth` 2, `questComplete` 1). Two kinds
  doing one thing is the proliferation the `includes`/`levelAtLeast` split was
  careful to avoid, and there was no migration to pay for.
- **`DropTableView`'s `conditionLabel` trip wire fired again**, as designed —
  a new enum member fails the web typecheck until the UI can render it. It now
  renders a bracket as a range ("Fishing level 40–45"), matching how the wiki
  prints it.

### The evidence for the brackets, and why it needed a fetch

Neither `Reward pool` nor `Reward Cart` had a wikitext snapshot — only
`dropsline`. Snapshotted both via the project's own etiquette-compliant
`fetch-wikitext-for` (serial, 1000ms apart, real User-Agent). This is not the
"never re-hit the wiki to fix a parser bug" rule: no parser is being debugged,
and the page had simply never been fetched. `data/snapshots/` is gitignored, so
this leaves nothing in the repo but makes the source re-parseable offline.

The brackets are stated twice on the page and agree:

- `|dropversion = Levels 35-39,Levels 40-45,Levels 46-49,Levels 50-75,Levels
  76-78,Levels 79-80,Levels 81+`
- the seven `====Levels …====` sub-headings under `===Fish===`.

And they line up exactly with the seven five-fish groups in the `dropsline`
snapshot (weights 900/810/720/630/540 within each). A property test asserts the
point of the whole feature: **exactly one bracket matches any Fishing level from
35 to 99, and none below 35.** A one-sided `>=` matches all seven at level 99,
which is the failure this was built to prevent.

## Reward pool and Reward Cart: NOT built, and precisely why

The `levelAtLeast` capability above is done and tested. The two documents are
not, and the blockers are different for each.

**Reward pool — very close, and the remaining blocker has a way around it.**
Its main table reconciles *exactly*: fish 3,600 + spirit flakes 1,600 + casket
320 + other 880 = **6,400**, and the page's own "about a 45/80 chance to roll
the fish sub-table" is 3,600/6,400 confirming it independently. All seven
brackets are now stated and modellable. The one unknown is `tempoross_points`:
the page says permits start at 1 above 2,000 points and add 1 per 700 "with a
chance at rounding up", and **never states the rounding rule** — so `Table.rolls`
cannot be derived from `ctx.points`.

**The way around it is worth acting on next session: model Reward pool
per-permit, not per-encounter.** The drop table *is* per permit — permits are
banked and redeemed one at a time, at the Fishing level held at redemption, and
the page treats redemption as the unit throughout. A document with `rolls: 1`
simulating N permits is exact and needs no formula at all; only the
points→permits conversion needs `tempoross_points`, and that is a separate
question a user can answer by typing a permit count. What stops it being a
30-minute job is that `data/bosses/` has **no** `reward-pool.json` — the parser
never assembled this source — so there is no generated base to override, and
established practice (Doom, Lunar Chest, Zalcano) is to generate overrides
programmatically from a parsed document rather than hand-transcribe 52 entries
and their item ids.

**Reward Cart — genuinely blocked, on unstated numbers.** Two hard stops, both
read directly from the fetched wikitext:

1. **The Logs sub-table's rates do not exist on the page.** Every row is
   `rarity=Varies`, with the prose saying only "The exact drop rates on this
   subtable are based on the player's Woodcutting level; players with higher
   levels are more likely to receive higher tier logs." Same class as Zalcano's
   two curves and Duke Sucellus's frozen tablet: stated to exist, never stated.
   Do not guess it. (If the numbers ever surface, the shape is now expressible —
   it needs a `woodcuttingLevel` context field plus the `atMost` brackets built
   this session.)
2. **The pyromancer outfit rule is a fourth gating shape.** "There is a 1/150
   chance to receive a piece of the pyromancer's outfit players have the least
   of. At zero and any other tie, they are given in this order: Garb, hood,
   robe, boots." That is a *relative* comparison across four item counts with a
   fixed tie-break order — not a threshold on one count, which is all
   `ownershipGate` expresses. Do not widen `ownershipGate` for it without
   deciding that question properly.

What IS expressible today: the warm gloves / bruma torch substitutions ("if the
player already has three ... a magic seed is given") are ordinary
`ownershipGate` threshold cases, and the remaining uniques are plain independent
fixed rates. Neither source's watchlist entry should be removed.

## The benchmark bar is 1M, and the duplicated-`emit` lever is closed

Adopted on the evidence in the previous entry: `test/bench.tmp.ts` now defaults
to `--kills 1000000`, and 10M is a linearity spot-check you ask for explicitly.
PROJECT_PLAN.md section 8 is being updated separately by the user; this entry
records the engineering side.

**The duplicated-`emit`/`runTable` lever is now closed, not deferred.** Previous
sessions kept it "the next thing to try if 10M approaches 2s". At the 1M bar the
current figure is ~203ms against a budget nothing approaches — the frontend's
own default run is 10,000 kills, roughly 2ms — so the lever's remaining ~9%
would buy a fraction of a number that does not matter, in exchange for two
permanent copies of the simulator's core recursive walk. Do not re-nominate it
on performance grounds; if it ever returns it needs a new justification, not
this one.

## Scope-invariance as the default shape for testing a check

Four guards had been found permissive in the same way (`entry.title`,
`refs_resolve`, `qty_sane`, and — found by this work — `items_known`). Each was
noticed by a human reading code, never by a test, because every test that
existed shared one shape: **they mutate the data and never the field that
decides the check's scope.**

`apps/ingest/test/helpers/scope-invariant.ts` makes the other shape reusable.

- **The invariant**: a document that genuinely FAILS a check must keep failing
  under any mutation that does not repair the defect. A scope hole is exactly
  the case where the check stops looking, so a real failure silently becomes a
  pass. That framing is what makes it generic — the harness needs to know
  nothing about the check beyond "does it pass?".
- **The mutations are verdict-preserving by construction**: six conditions that
  are false under the default context, wrapping every node one level down
  inside a `oneOf`, prepending an unrelated clean table, and renaming
  slug/name/wikiPage (the `entry.title` lesson generalised — identity fields
  must not decide what a check inspects). None of them touches the defect.
- **A mutation that cannot legally apply is skipped, not forced.** `oneOf`
  needs weight rates, so it is inapplicable to an `always`-mode document; the
  harness re-parses the mutated document and skips when the schema rejects it,
  so the coverage a check actually has stays visible in the test output rather
  than being silently assumed.
- **A control test asserts the unmutated document fails**, so a suite cannot
  pass vacuously against a document that never failed.

`apps/ingest/test/scope-invariants.test.ts` applies it to all five checks with a
scope: `refs_resolve`, `qty_sane`, `items_known`, `rates_valid`, `weights_sum`.
48 assertions, 2 documented skips (`rates_valid`'s `oneOf` case is closed by the
schema rather than the check — `NodeSchema` pins `oneOf` entries to weight
rates; `weights_sum`'s is not verdict-preserving, since wrapping changes the
weight arithmetic the check is about).

**When a fifth hole turns up, the mutation that finds it goes in
`SCOPE_MUTATIONS` once and every check gains the coverage at the same moment.**
That is the actual deliverable here — not the four fixes.

### The fourth hole, found and fixed: `items_known`

`parseBoss` built its item list with a flat
`for (const entry of table.entries) if (entry.node.kind === 'item')`. An item one
level down inside a `oneOf` was never collected, so `items_known` reported a
clean pass for a document containing an item that resolves to nothing.

Extracted to `apps/ingest/src/parse/collect-items.ts` and made recursive.
Verified by direct A/B rather than by assertion: under the `oneOf` mutation the
**old** walk turns a failing document into a passing one, and the new one keeps
it failing. That check is what makes the harness credible rather than
self-confirming.

`collectItemInputs` states one scope decision explicitly instead of leaving it
implicit in the shape of a loop: **it does not follow `tableRef`.** A shared
table's items are that record's own business — following the ref would
re-validate `rare_drop_table` once per referencing boss, attribute the failure
to whichever boss happened to be parsed, and make one bad shared record fail
seventeen sources with seventeen identical messages.

## "This source has no generated base": the general fix

Reward pool had no `data/bosses/reward-pool.json` and the previous session read
that as "the parser never assembled this source". That was half right and the
useful half was missing.

**The machinery for a from-scratch document already existed and had never been
reached.** `applyOverride` accepts `generated === null`, checks the fields it
then has to be given (`name`, `wikiPage`, `wikiRevId`, `tables`) and emits
`source: 'override'`; `parseBoss`'s `overrideCarriesTables` rescues all three of
its `parse_failed` exits. Nothing was missing in either.

**What was missing is that the source was never offered to them.** Reward pool
is tier **D**, and every documented parse invocation is `--tier A,B,C`. A
source could therefore have a complete, correct, tested override sitting in
`data/overrides/` and never be built, with nothing anywhere reporting it —
`loadOverride` looks files up BY slug, so an override for a slug nobody
enumerates is simply never opened.

Two changes in `parseCommand`, both general rather than Reward-pool-shaped:

- **An authored override always forces its source to be parsed, whatever the
  tier filter says.** The tier filter is a triage convenience for deciding what
  to *attempt*; it was never meant to overrule an explicit human decision to
  build something. The run log names the sources pulled in this way rather than
  including them silently.
- **Override slugs that match no loot source are reported as orphans.** A
  typo'd filename was previously invisible for the same reason: nothing ever
  looks up a slug that does not exist.

This is why the answer was "neither the parser nor the override format" — the
gap was in enumeration, which is also why it would have recurred for the next
tier-D source with an override (Rewards Chest (Fortis Colosseum) is next).

## Phase 7: Reward pool shipped, modelled per permit

`data/overrides/reward-pool.json` + `data/tables/reward_pool_fish.json`,
generated programmatically from the `dropsline` snapshot and the item index
(the established practice — 52 rows and their ids are not retyped). 12
wiki-figure tests in `apps/ingest/test/reward-pool.test.ts` against the real
generated document.

- **Per permit, not per encounter, and that is the unlock.** The page's own unit
  is the permit: they accumulate in the pool (cap 8,000) and are redeemed one at
  a time, and "the rewards are determined by the player's Fishing level at the
  time of collection from the reward pool, not at the time of adding permits".
  Modelling per permit makes the whole table exact and needs no formula at all —
  the only thing `tempoross_points` was needed for was points -> permits, which
  a user supplies by typing a permit count. The rounding rule the page never
  states ("with a chance at rounding up") therefore blocks nothing that is
  modelled.
- **The main table reconciles exactly to 6,400**: fish 3,600 + spirit flakes
  1,600 (1/4) + casket 320 (1/20) + the six "other" rows 880. The page confirms
  the fish share independently as "about a 45/80 chance to roll the fish
  sub-table" — 45/80 is 3,600/6,400. An exact reconciliation is what made this
  source modellable at all; a shortfall would have implied an unstated `nothing`
  remainder.
- **Seven mutually exclusive brackets, expressed without a weighted table.**
  A weighted table cannot hold them: all seven would sum to 25,200 against a
  3,600 denominator and `weights_sum` would fail, correctly. `reward_pool_fish`
  is instead an `independent` table whose seven entries are certainty rates
  (`1/1`) gated on their bracket, each carrying a `oneOf` of that bracket's five
  fish. Exactly one bracket condition holds for any Fishing level, so exactly
  one entry survives compile-time filtering and fires; its `oneOf` normalises
  900/810/720/630/540 over that bracket's own 3,600. This is worth knowing
  generally: **`independent` + certainty rates is how mutually exclusive
  condition-gated alternatives are modelled**, because `weights_sum` is a
  members-variant check and does not understand any other condition kind.
- **A modelling assumption is flagged in the override's `note` rather than
  hidden**: the nine rare-unique rows carry denominators of 400/1,600/8,000 that
  cannot be integer weights out of 6,400 (1/8,000 is 0.8/6,400), and the 6,400
  table already reconciles exactly without them, so they are modelled as an
  independent table rolled alongside the main one. The page does not say which
  it is.
- **The sharpest test is the page's own worked statement**: "it is not possible
  to catch manta rays if the player's base Fishing level is below 81." Asserted
  at 80 and 81. The companion test is the failure `atMost` exists to prevent —
  at Fishing 99 a one-sided `>=` matches all seven brackets, so herring (which
  appears only in 35–39) must be unreachable at 99, and is.
- **Below Fishing 35 no bracket applies**, which is correct rather than a gap:
  the page states no bracket there and Tempoross cannot be entered below it. The
  fish mass goes to the weighted table's implicit `nothing`. Asserted, with the
  companion assertion that the rest of the table is unaffected.
- **Stays on the mechanics watchlist, so `needs_review`, not
  `manual_override`** — the points -> permits mechanic is genuinely unmodelled.
  Same treatment as Zalcano's two curves. A test asserts both halves: the
  watchlist check fails, and every other deterministic check passes, so
  `needs_review` here means "one known-unknown", not "shaky parse".

Corpus after: **54 parsed — 38 verified, 2 manual_override, 11 needs_review,
3 parse_failed** (was 53 / 38 / 2 / 10 / 3). The one new source is the one new
`needs_review`, which is the intended outcome.

## Reward Cart stays blocked

Unchanged from the previous session's assessment and not re-litigated: the Logs
sub-table's rows are all `rarity=Varies` with the Woodcutting-level rates never
stated (same class as Zalcano's two curves — do not guess), and the pyromancer
outfit rule ("the piece players have the least of", fixed tie-break order) is a
*relative* comparison across four item counts, which is a fourth gating shape
`ownershipGate` does not express. Its watchlist entry stays.

## The UI rework's two measurements, and what they changed

Both were run before any layout code, both came back negative, and both changed
the design rather than being worked around.

### Item icon URLs are not derivable from the item name

The plan was to build icon URLs from the item name and accept a placeholder for
the misses. Every one of the **693 distinct items across the 54 parsed sources**
was HEAD-requested at its derived `/images/{Name}.png`:

| derivation | misses | rate |
|---|---|---|
| `/images/{Name}.png` | 94 / 693 | **13.6%** |
| the same 94 retried via `Special:FilePath` | 17 / 693 | **2.5%** |

13.6% would be tolerable if it were scattered. It is not — it is one structural
class: **every stackable item's icon file carries a stack-size suffix the item
name never mentions.** `Acorn` is `Acorn_5.png`, `Coins` is `Coins_100.png`,
`Ancient essence` is `Ancient_essence_500.png`, `Brimstone key` is
`Brimstone_key_1.png`, `Cow slippers` is `Cow_slippers_(1).png`. The suffix
varies, so no rule over the item name produces it. It catches every seed, every
arrow and bolt type, Coins, Zulrah's scales, Sunfire splinters and Crystal
shard — the highest-count items in any results grid, so the share of *visible*
cards affected is worse than 13.6%.

`Special:FilePath` dissolves that whole class because MediaWiki resolves file
redirects there (`File:Acorn.png` redirects to `File:Acorn 5.png`). It is wired
as an **error fallback only**: it is a special page rather than a CDN path, and
the audit was rate-limited (HTTP 429) requesting 94 of them at five-way
concurrency. Sparse, for the ~14% that 404, it stays well inside that limit; as
the `src` for every icon in a 24-card grid it would not.

The residual 17 (2.5%) are all case-only mismatches on proper nouns — `Baby
mole` is filed as `Baby Mole.png`, `Wine of zamorak` as `Wine of Zamorak.png`,
`Vet'ion jr.` as `Vet'ion Jr..png` — and 14 of the 17 are pets. Which words a
proper noun capitalises is not a function of the item name, so these render the
placeholder.

**Recommendation, not applied (out of scope, pipeline work): ingest should
resolve icon URLs via the wiki's `imageinfo` API and store them.** 693 items is
14 batched requests and it takes all three classes to zero at once. No
hand-maintained alias map was added — it would cover today's corpus and rot on
the next source.

### No rarity threshold separates uniques from ordinary rares

Checked with `expectedValue` against the real committed documents before any
number was hardcoded, as the rework asked. **Raw rarity fails on five of six
bosses**, and in both directions:

| boss | rarest non-unique | commonest unique | separable? |
|---|---|---|---|
| Vorkath | Sapphire bolt tips 1/546 | Dragonbone necklace 1/1,000 | yes |
| Zulrah | Rune javelin 1/10,199 | Serpentine visage 1/1,024 | no |
| Corporeal Beast | Rune javelin 1/546 | Spirit shield 1/64 | no |
| General Graardor | Curved bone 1/5,013 | Bandos boots 1/381 | no |
| Sarachnis | Rune javelin 1/12,800 | Sarachnis cudgel 1/386 | no |
| Kraken | Rune javelin 1/8,192 | Kraken tentacle 1/400 | no |

The cause is one thing: **the shared rare/mega-rare/gem drop tables.** Every
source with RDT access carries the same junk — rune javelin, key halves, chaos
and nature talismans, uncut gems — at 1/4,000–1/13,000, rarer than almost every
genuine unique in the game. Corporeal Beast fails the opposite way: its spirit
shield is 1/64 and holy elixir 1/171, commoner than dozens of ordinary drops on
the same boss.

Two things followed.

1. **Exclude items only reachable through a `tableRef`** (`ownItemKeys` in
   `apps/web/src/lib/rarity.ts`). This is derivable at render time from the boss
   document, needs no schema change, and removes the entire junk class. With it,
   the best single cut is 1/300.
2. **Rename the concept.** 1/300 is still not clean — it admits `Long bone`
   (1/400) and `Curved bone` (1/5,013) on Graardor and `Uncut onyx` on Zulrah,
   and it misses Corp's spirit shield entirely. Called "**rarest drops**" rather
   than "uniques", those stop being errors: curved bone genuinely is one of
   Graardor's rarest drops, and a spirit shield genuinely is not rare on Corp.
   The spirit shield still leads Corp's grid, because the grid sorts by value.

The threshold is used only for the strip and the card highlight, never for
ordering — value sorting surfaces most uniques incidentally, which is why
getting the threshold imperfect is survivable. `apps/web/test/rarity.test.ts`
pins the measurement against the real corpus, including the two cases that look
like bugs and are not: **Barrows returns 27 rarest items and The Mimic 23**, and
both are correct (24 Barrows set pieces at ~1/2,460, 23 3rd age pieces at
~1/2,860). An earlier "the set stays small" assertion would have called those a
defect; the test asserts the invariant instead — nothing commoner than the
threshold ever gets in.

### "Rarest drops" superseded by curated `unique`/`pet` flags

The rarity-threshold approach above was a deliberate, evidence-based
compromise: no threshold cleanly separates uniques from ordinary rares, so
the UI was honestly labelled "rarest drops" rather than "uniques" to avoid
overclaiming. That evidence (the six-boss table above) is still correct and
still the reason a *rarity threshold* can never back a literal "uniques"
label.

What changed is that the underlying question turned out to be answerable a
different way: "is this item one of the boss's actual uniques" and "is this
item the boss's pet" are curatable facts, not derivable signals — the same
category as `data/item-multi-id-allowlist.json`'s multi-id exceptions. Two
booleans (`unique`, `pet`) were added to `ItemNodeSchema`, populated at
ingest time from a hand-curated `data/item-flags.json`
(`apps/ingest/src/items/item-flags.ts`) keyed by `(bossSlug, itemKey)`, never
from wiki structure.

The wiki's own "Uniques" heading was considered and rejected as the curation
source — `docs/HANDOFF.md`'s "What NOT to redo" already closed that question
("most re-litigated question in the project's history," no available signal
on the remaining ambiguous sources) — so `data/item-flags.json` is authored
directly from OSRS domain knowledge, cross-checked against each boss's own
committed item list so nothing not already present in the corpus is ever
flagged.

`apps/web/src/lib/rarity.ts`/`rarestItemKeys` and the "Rarest drops" strip
are retired in favour of `apps/web/src/lib/uniques.ts`'s `uniqueItemKeys`,
which is a plain `Boss` read (`node.unique || node.pet`) with no rarity
computation and no `ExpectedValueResult` dependency. The rarity-threshold
mechanism itself is not deleted from the historical record — it remains
correct for what it measured — only superseded as the strip's data source.

### Boss images: the only pipeline change

Not derivable from the page title (`Kraken` illustrates its page with
`Whirlpool.png`, Zulrah with `Zulrah (serpentine).png`), so
`SiteIndexEntrySchema` gained an optional `image`, extracted from the **local
wikitext snapshots** — never a live fetch, per CLAUDE.md's hard rule. 52/52
sources resolve, and all 52 URLs were verified to return 200 at both full size
and the 300px thumbnail the frontend actually requests.

The field stores the **file name, not a URL**, so the frontend picks the
thumbnail width without an ingest run. `buildSiteIndex` **merges rather than
overwrites**: `data/snapshots/` is gitignored, so a regeneration on a machine
without it would otherwise silently strip every portrait out of the committed
index — a data loss no check would catch, since the field is legitimately
optional. Two tests in `apps/ingest/test/site-index.test.ts` pin that merge.

## Seed 0 means "roll one", and the double-run it exposed

`DEFAULT_SEED` was a literal `1`, so every visitor's first simulation of a boss
produced byte-identical drops — the same three visages, for everyone, forever.
That reads as a fixed answer rather than a sample. `0` is now the default and a
sentinel meaning "roll a fresh seed for this run".

The shape that keeps both properties true at once: **the rolled seed goes to the
worker and into the URL, but never into component state.** The control keeps
showing `0`, so the next click rolls again rather than repeating the last run;
the link carries a real seed, so it still replays exactly. `rollSeed()` never
returns `0` — a run stamped with the sentinel would re-roll on reload instead of
reproducing, which would quietly break every shared link.

**This exposed a pre-existing double-run.** `handleSimulate` sets `run: true` on
the params, and the auto-run effect (section 9's shared-link replay) watches
exactly that field — so a click dispatched a run and the effect immediately
dispatched a second one. It was invisible while both runs used the seed sitting
in the input: two identical simulations, the later one winning, costing only
wasted work. Rolling per run made it visible immediately, because the URL
carried the click's seed and the results carried the effect's. Fixed by claiming
the `autoRan` latch inside `handleSimulate`: the latch means "the auto-run is
resolved for this mount", not "the effect has fired".

## Transcluded drop sub-tables are silently dropped, and no check can see it

Corporeal Beast's sigils are **genuinely absent from the parsed document** —
not hidden behind a `tableRef` the UI filtered out. `data/bosses/corporeal-
beast.json` has three tables (the 512-denominator table, Tertiary, and gem-table
access) and none of them mentions a sigil.

The cause is visible in one line of wikitext:

```
===Sigils===
{{Uniques/Corporeal Beast}}
```

`extractDropLines` reads `{{DropsLine}}` / `{{DropsLineClue}}` calls out of the
raw page wikitext, for good reasons documented in `wikitext-drops.ts` (heading
text, `(noted)` qualifiers, unambiguous parameter names). A section whose body
is a **transclusion** contains no `DropsLine` calls, so it yields zero rows and
disappears. There is no error: an empty section and an absent section are the
same thing to every downstream step.

### It is not just Corp

Sweeping all 52 sources for drop sub-sections containing a template but no
`DropsLine` row, then excluding the RDT access templates (handled by
`rdt-access.ts`) and prose sections, leaves **26 transcluded drop sub-tables
across 21 sources. All 26 are missing from the parsed documents. 18 of those
sources are `verified`.** Cross-checking the `dropsline` snapshot bucket — a
different view of the same page, already on disk for every source — against the
parsed documents puts the loss at **427 item rows across 28 sources**, in four
groups:

| group | template | sources | example loss |
|---|---|---|---|
| seed / herb / talisman sub-tables | `TreeHerbSeedDropLines`, `HerbDropLines`, `TalismanDropLines`, `UncommonSeedDropLines`, `GeneralSeedDropLines`, `RareSeedDropLines` | 17 | every seed on Vorkath, Araxxor, the Dagannoths |
| Wilderness Slayer tertiary | `WildernessSlayerDropTable` | 8 | Larran's key, Slayer's enchantment |
| unique sub-table | `Uniques/Corporeal Beast` | 1 | all three sigils |
| GWD rare drop table | `GWDRDT` | 2 | **already flagged** — HANDOFF landmine #3, deliberately unmapped |

(`chest-tombs-of-amascut`'s 50/50 is the stale tier-D file of landmine #1, also
already known.)

### What the checks failed to catch, and why none of them could

Every check is **closed-world over the extracted document**. Not one of them
compares the extraction against the page it came from, so a section that
produced zero rows is indistinguishable from a section that never existed:

- `weights_sum` — Corp's 512 table sums flush *without* the sigils, because the
  sigils are a separate 1/585 roll. Removing a whole sibling table cannot make
  this fail.
- `items_known`, `qty_sane`, `rates_valid` — validate the items/quantities/rates
  that ARE present. Nothing extracted, nothing to check.
- `refs_resolve` — the sigils are not a `tableRef`.
- `not_on_watchlist` — Corp is not watchlisted; nothing knew to watchlist it.
- `ev_matches` — the only check that could in principle have noticed, since
  Corp's page states an average kill value that explicitly includes the sigils
  (`1/585 * (3/7 Spectral + 3/7 Arcane + 1/7 Elysian)`). It is advisory and
  permanently closed on pricing grounds, and on Corp it does not even run
  ("no rendered page snapshot available").

This is the **same class as the four scope-permissive guards, one level up.**
Those were permissive about which parts of the document they looked at; this is
the document being permissive about which parts of the page it came from. The
`scope-invariant.ts` harness cannot reach it, because its invariant is about a
document that already fails continuing to fail — it has no notion of a document
that should have been larger.

### The check that would catch it — recommended, not built

`data/snapshots/dropsline/{slug}.json` already exists for every source and
already lists the sigils. **A `drops_covered` check comparing the bucket's item
names against the parsed document's own items** (excluding `tableRef` contents,
which belong to the shared record) reproduces the table above exactly. It is
cheap, it is offline, and it needs no new fetch.

It is **not** added here, because it is not a code decision: turning it on fails
21 currently-`verified` sources at once, and whether that is a status change to
absorb, a per-source waiver list, or a signal to fix the parser's transclusion
handling first is a call about what `verified` is allowed to mean.

## Item icon URLs are resolved by ingest, not derived in the browser

The frontend derived icon URLs from item names and fell back to
`Special:FilePath` on error. Measured miss rate for the derivation: **13.6% (94
of 693 items)**, in one structural class — stackable items whose icon file
carries a stack-size suffix the item name never mentions, with the suffix
varying per item (`Acorn 5.png`, `Coins 100.png`, `Ancient essence 500.png`,
`Brimstone key 1.png`, `Cow slippers (1).png`). Now resolved once, by
`ingest item-icons`, into `data/item-icons.json`.

**Two stages, because one API does not cover it.**

1. `prop=imageinfo` over `File:{Name}.png`, 50 titles per request — MediaWiki
   resolves file redirects here, which is exactly what turns `File:Acorn.png`
   into `Acorn 5.png`. **676 of 694.**
2. `list=search&srnamespace=6` for whatever stage 1 reports missing. These are
   case-only mismatches on proper nouns (`Baby mole` is filed as
   `Baby Mole.png`, `Vet'ion jr.` as `Vet'ion Jr..png`), and which words a
   proper noun capitalises is not a function of the item name. **Only a
   case-insensitive EXACT title match is accepted** — searching `Baby mole`
   also returns `Baby Mole (NPC).png` and `Baby Mole detail.png`, and taking the
   top hit would silently ship the wrong picture. **16 of the remaining 18.**

**Final coverage: 692/694.** The two residuals are recorded in `unresolved`
rather than guessed: `Muphin` (the wiki has only `(shielded)`/`(melee)`/
`(ranged)` variants, no plain file) and `Nothing` (not an item — a drop row
literally named that, `itemId: null`, on Black Knight Titan and Salarin).

Decisions worth carrying:

- **File names, not URLs**, matching the boss-image decision. The `imageinfo`
  URL carries a `?hash` cache-buster that changes on every re-upload and would
  make the committed file churn for no semantic change; and sizing/encoding stay
  presentation decisions.
- **Snapshot-first, so re-running is free.** Every response lands in
  `data/snapshots/item-icon/`. The command was in fact re-run twice during
  development after a schema bug, both times with **0 wiki requests** — which is
  CLAUDE.md's "never re-hit the wiki to fix a parser bug" working as designed.
  Rate limiting is `WikiClient`'s: serialised, one request at a time, maxlag and
  retry included.
- **`Special:FilePath` is deleted, not kept as a safety net.** It was a second
  request per miss against a MediaWiki special page that rate-limits — the
  original audit got HTTP 429 at five-way concurrency — and there is nothing
  left for it to catch. `ItemIcon`'s `onError` placeholder stays, for a
  re-upload between ingest runs.
- **`collectCorpusItemNames` follows shared tables, unlike `collectItemInputs`,
  which deliberately does not.** The reasoning there is about blame (one bad
  shared record should not fail seventeen bosses). Here there is no blame to
  misattribute: the grid renders a rare-drop-table item in exactly the same card
  as a boss's own, so an unresolved icon is equally visible.

Two e2e assertions had to change shape, both for the same reason — icons made
`innerText` unstable, because `ItemIcon` renders the item's first letter until
the icon map resolves. The seed-reproduction comparisons now use a
`resultProjection` helper (summary + name/count per card) rather than raw text.
An icon test that named `Zulrah's scales` also had to be generalised: under the
rarity sort a price-less run uses, the commonest drop lands past the 24-card
collapse and never renders, so the assertion is now "every requested icon path
is a value the committed map contains" plus "at least one carries a stack
suffix".

## `drops_covered` is on, and 20 sources left `verified`

Turning the check on moved the corpus from **38 verified / 2 manual_override /
11 needs_review** to **18 / 2 / 32**. That is the intended outcome, not a
regression: `verified` has meant "the pipeline derived this from the wiki
unaided" since Phase 1, and a document missing drops the wiki lists has not met
that claim whatever else it got right. Shipping a badge that is no longer true
is worse than shipping an honest one.

26 sources fail the check. The groups are unchanged from the earlier analysis —
seed/herb/talisman transclusions (17), `WildernessSlayerDropTable` (8),
Corporeal Beast's sigils, and the already-flagged GWDRDT hole on Kree'arra and
General Graardor. Fixing the transclusions is separate work; the check makes
the gap visible rather than fixing it.

Design points worth keeping:

- **Coverage in ONE direction only.** Every bucket item must be reachable in the
  document; the reverse is not required and must not be. Override-authored
  sources (Lunar Chest, Reward pool) build tables from prose the bucket never
  saw, and a set-equality check would fail them for being more complete than
  the oracle.
- **`tableRef` contents count as covered.** A boss reaching the rare drop table
  really does drop everything in it, and the shared record is validated as
  itself — the same reasoning `collectItemInputs` documents for the opposite
  decision, applied to a check with no blame to misattribute.
- **The verdict is split from the snapshot read** (`checkDropsCoveredAgainst`),
  which is what lets the scope-invariant harness cover it like the other five.
  Worth stating plainly: **the harness could never have found this hole.** Its
  invariant is that a failing document keeps failing under mutation; it has no
  notion of a document that should have been larger. Being scope-invariant was
  always necessary and never sufficient.
- **One normalisation, narrowly scoped.** The bucket names a versioned item by
  page anchor (`Pendant of ates#Inert`) where the document uses the
  parenthesised form. Exactly one row in the corpus takes that path; it is
  translated, not fuzzy-matched, and an unrelated anchor still fails.
- **A missing oracle passes, and says so.** With no dropsline snapshot there is
  no claim to make — but the detail string announces it, because `refs_resolve`
  once reported "resolved against 0 shared table(s)" as a clean pass and nobody
  noticed for months.

Side effect: `chest-tombs-of-amascut` was re-parsed with `--tier A,B,C,D`, so
**HANDOFF landmine #1's live instance is gone** — no committed document now
predates the current check set.

## CI: a gitignored read at module scope, and a deploy that could outrun its gate

Two workflow problems, both of which would have surfaced as a red first run.

**`brutus-snapshot.test.ts` read a gitignored snapshot at module scope.**
`describe.skipIf(...)` marks a suite skipped but still INVOKES its callback to
collect the tests inside it, so the `readFileSync` threw during collection on
every clean checkout — which is every CI run, since `data/snapshots/` is
gitignored. Moved into `beforeAll`, whose hooks a skipped suite never runs.
Verified by parking `data/snapshots/` and running the suite: 7 skipped, green.

**That same parking run then caught three of my own new tests doing it** —
`drops-covered.test.ts`'s real-corpus suites compare committed documents against
the bucket snapshot, and with no bucket the check correctly returns a vacuous
pass, so "agrees with the committed document" failed for the 26 sources recorded
as failing. Same guard applied. The lesson generalises past this one file:
**a snapshot-dependent assertion that does not declare its dependency is a red
CI run waiting to happen**, and the way to find them is to park the directory
and run everything, not to reason about it.

**`deploy.yml` ran only `pnpm -r test`.** Both workflows trigger on push to
main, so they run in parallel and a red `ci` does not block a deploy — the only
thing between a broken commit and production was the one check that cannot see
a type error, a lint failure, or any production-only bug. `deploy` now runs the
same gate as `ci`, e2e included, before it builds.

Actions were well behind (`checkout@v4`, `setup-node@v4`,
`upload-pages-artifact@v3`, `pnpm/action-setup@v4`), which is what produces the
runtime deprecation warnings; all bumped to current majors, and `node-version`
to 24.

## The admin page does not ship, and the first attempt did not stop it

Gated behind `import.meta.env.DEV`: the route, the header link, and the
non-verified boss's "see the admin page" link.

**The first attempt failed, and the interesting part is why.** Putting
`lazy(async () => import('./pages/AdminPage'))` at module scope and guarding
only the `<Route>` kills the route but not the `lazy()` call — the dynamic
import stays reachable, so Rollup emits the chunk and the entire admin page
ships. The condition has to wrap the `lazy()` call itself
(`import.meta.env.DEV ? lazy(...) : null`), so the `import()` sits inside the
dead arm.

It was caught because the e2e assertion greps the built assets **off disk**
rather than through the page. A lazily-imported chunk that survived elimination
is referenced by no `<script>` tag, so checking what the browser loaded would
have reported a clean pass for exactly this failure. Confirmed: `dist/assets/`
contains three files and no `AdminPage-*.js`.

## A shared link used to always report 0 gp

The auto-run fired before the GE price fetch settled, so every shared result
rendered "0 gp total" with the grid sorted by rarity. The label was honest, but
it was the wrong answer for the feature whose entire purpose is showing someone
else your result.

The auto-run now waits for the price query to settle; a click still does not.
The asymmetry is the point: a click is user-initiated and must feel instant,
while an auto-run has nobody waiting on it and no reason to race. `isLoading`
rather than `data !== undefined`, so a failed fetch settles and falls back to
rarity instead of hanging forever. Both halves are pinned in
`e2e/shareable-result.spec.ts` against a deliberately slow price stub.

## Transclusions are expanded locally during parse, not through the wiki's API

The 427-row gap landmine #11c recorded is closed. `drops_covered` failures went
**26 -> 5**, the corpus went **18 verified -> 28**, and the five that remain are
not transclusion-inlining cases (below).

### `action=expandtemplates` is the obvious tool and is the wrong one

Checked before writing anything, as instructed. It expands **recursively, all
the way down**, so `{{DropsLine|name=Air talisman|rarity=1/700}}` comes back as
the rendered wikitable row it produces — throwing away the three things Phase 3
chose wikitext for in the first place (unambiguous parameter names, `(noted)`
qualifiers, heading structure) to solve a problem that needs exactly ONE level
of expansion. It would also cost a request per source, forever.

Expanding locally keeps the `{{DropsLine}}` calls intact and costs **nothing
per source**. What it costs is one fetch per TEMPLATE — 9 requests total,
snapshotted to `data/snapshots/wikitext/template-*.json` and re-read offline
after. That is the same thing the Phase 3 session did to confirm
`{{RareDropTable}}`'s parameter semantics, and it is not "re-hitting the wiki to
fix a parser bug" (CLAUDE.md's hard rule): the page snapshots were never
re-fetched, and a template definition is a new source document, not a re-read of
an old one.

**Verified offline first**, and this is what made the decision:

- The `dropsline` bucket cannot be the data source, only the oracle. Its
  rarities are ROUNDED EFFECTIVE rates (Vorkath's Ranarr seed is `1/416.7`,
  already folding in the 3/150 access), so the sub-table's own weights are not
  recoverable from it.
- No definition for any of the 13 row-bearing templates was on disk, so no
  offline expansion was possible without fetching something.
- The one comparable definition that WAS on disk (`Template:RareDropTable`)
  delegates to Lua (`{{#invoke:RareDropLines|main}}`), so whether a local
  expander could work at all was genuinely unknown until the definitions were
  read. Eight of the nine turned out to be plain wikitext.

### The set of definitions on disk IS the scope

`expand-transclusions.ts` expands only templates it has a snapshot for and
leaves everything else exactly as found. **Teaching the parser a new drop-table
template is one fetch and no code.** That is the whole reason this is not a
registry of per-template handlers, and it is not theoretical: `WildernessSlayer-
DropTable` and `Uniques/Corporeal Beast` were fetched only to ASSESS whether the
approach generalised, and both groups fixed themselves on the next parse with no
code written for either.

Two carve-outs, both structural rather than name lists:

- **`TERMINAL_TEMPLATES`** (the `DropsLine` family) keep their CALL and have
  only their arguments expanded. That is what lets the extractor read parameter
  names off an expanded page exactly as off a hand-written one.
- **`TABLEREF_TEMPLATES`** (`RareDropTable`, `GemDropTable`, `GWDRDT`) are never
  inlined, because `rdt-access.ts` already models them as a `tableRef` into a
  shared `data/tables/*.json` record. Their definitions are on disk, so without
  this they would be inlined on sight — undoing Phase 3 and breaking the access
  extractor, which reads the same wikitext and looks for these calls by name.

### The sharpest lesson: a failed expansion can produce a WRONG number, not a missing one

This shipped, briefly, and is the thing to carry forward.

`WildernessSlayerDropTable` selects its key denominator with
`{{#switch: 1 | {{#expr: {{{combat}}} < 81 }} = ... | 1 = 50 }}`. The first
evaluator did not implement comparison operators or `^`, so the `#expr` threw,
the construct was left as raw text, the `#switch` matched none of its computed
cases — and **fell through to its literal `| 1 = 50` case**. Five sources went
`verified` publishing Larran's key at a flat 1/50 whose real, published rates
are 1/55, 1/58, 1/65, 1/72 and 1/76. Three others (Callisto, Vet'ion, Venenatis)
are legitimately 1/50, which is exactly what made it look healthy.

**`drops_covered` cannot see this**: coverage is by item NAME, so a recovered
row with a wrong rate is indistinguishable from a correct one, and all five
passed. A wrong number is worse than a missing row. Three responses, all kept:

1. `evaluateExpr` implements ParserFunctions' real precedence ladder —
   `or < and < comparison < round < +- < */ < ^ < unary`.
2. **`expansion.unexpandable` is part of the `verified` gate.** A document
   whose rows came from an expansion that failed has not been "derived from the
   wiki unaided."
3. `transclusion-coverage.test.ts` compares every recovered row against the
   `dropsline` bucket's own published RARITY, not just its presence. Coverage
   was never going to be enough. One of its assertions is deliberately about the
   whole set rather than any row — the wilderness bosses must NOT all land on
   the same denominator — because a `#switch` falling through to a default looks
   completely healthy row by row.

### An unevaluable `#expr` is only reported when it can affect a row

Two suppressions, both narrow and both load-bearing, because the gate above
turns any false positive into a blocked source:

- **Page level (`depth === 0`)**: almost always the page's own average-kill-value
  arithmetic over live GE prices (`{{#expr:26 * {{GEP|Abyssal whip}} + ...}}`),
  which this pipeline neither needs nor can evaluate, and which `ev_matches`
  owns.
- **An expression referencing an argument the page never supplied**
  (tracked by `Context.missingArgs`): a template branch this call does not use.
  `WildernessSlayerDropTable` computes a `combatmax` bound for pages stating a
  combat-level RANGE; for the eight that do not, **MediaWiki itself renders an
  expression error there** and never reads the result. Without this, the new
  gate blocks eight sources on the wiki's own dead code. The corpus test is what
  keeps the judgement honest — a branch that DID matter would surface as a wrong
  number there.

### What remains, and why none of it is this mechanism

`drops_covered` still fails on five sources, none of them a template that could
be inlined:

| source | cause | is it new work? |
|---|---|---|
| `black-knight-titan` | `GeneralSeedDropLines` is `{{#invoke:}}` — a Lua module, not wikitext | genuine residual, reported by name |
| `kree-arra`, `general-graardor` | `GWDRDT` | **already flagged** — HANDOFF landmine #3, needs a `data/tables/gwd_rare_drop_table.json` record, not expansion |
| `chest-tombs-of-amascut`, `monumental-chest` | point-scaled chests | pre-existing, unrelated to transclusions |

Black demon also transcludes `{{HerbDropLines}}` and is not among the recovered:
its sections are `==Level 172, 178, and 184 drops==` and `==Wilderness Slayer
Cave drops==`, which `DROPS_SECTION_TITLE` does not match (it allows one
qualifying word before "drops", not five). That is a pre-existing
heading-matching gap, pinned as such in the test file so its absence is not read
as an oversight later.

### `findRowlessTemplateBlocks` — the silent-vanish signature itself

A drop sub-section whose body is a template yet yields no rows. Run against
EXPANDED wikitext it reports only what expansion could not reach, which is how
`{{GeneralSeedDropLines}}` names itself on Black Knight Titan.

Surfaced only when there is a shortfall to explain (`drops_covered` failed or a
transclusion did not expand), and only for NAMED sub-headings — the section
preamble is by construction where page furniture lives (`{{DropLogProject}}`,
`{{Average drop value}}`), and it appears on nearly every page. A first version
reported unconditionally and produced two or three lines of noise per source,
which is how a report gets ignored. This is an explanation, never a gate:
`drops_covered` decides completeness, against the wiki's own rows rather than
against the shape of the wikitext.

### Consequences elsewhere

- **Two tests that pinned the bug now pin the fix**, inverted rather than
  deleted, each keeping its history. `drops-covered.test.ts`'s Corporeal Beast
  case asserted all three sigils missing and now asserts they are reachable;
  `rdt-access-mechanics.test.ts`'s assertion has now been through a full cycle
  (verified -> "coverage the only thing outstanding" -> every deterministic
  check passing) and the comment records all three states.
- **`data/item-icons.json` regenerated** — the corpus gained 42 distinct items
  (694 -> 736). 733 resolve; `Belladonna seed` is a new third unresolved case
  and was diagnosed rather than pinned blind: its icon is `File:Belladonna seed
  5.png`, a stack-size suffix the item name never mentions. Stage 1 normally
  rescues that class through MediaWiki's file redirects, and this item has none;
  stage 2 found the file and correctly REFUSED it, since it accepts only a
  case-insensitive exact title match and loosening that is what would ship
  `Baby Mole (NPC).png` for `Baby mole`. **Accepting a strictly numeric stack
  suffix would be a narrow, well-defined widening of stage 2** — not done here,
  since this change is about transclusions.
- `extractLinesFromSection`'s block-splitting was extracted as `splitIntoBlocks`
  so the detector groups a section exactly as the extractor does, rather than
  re-deriving boundaries and drifting from it.

### The open question this does NOT answer: what MODE a recovered sub-table is

Several sources now pass every check and stay `needs_review` on the
ambiguous-mode guess alone, which is heuristic 6 working as designed, not a
leftover bug. An expanded seed or talisman block has heterogeneous denominators
(`1/416.7`, `1/112.3`, ...) under a heading with no mode keyword, so
`buildTableGroups` assumes `preroll` and flags it.

It is worth knowing why this was NOT resolved by treating "these rows came from
one transclusion" as a confirming signal, which was the obvious move and is
wrong:

- For seed/herb/talisman it would be right — every rarity derives from one
  `{{#vardefine:base|access/N}}`, so the rows are one roll picking one item, and
  their weights sum to the sub-table's own denominator.
- For `WildernessSlayerDropTable` it would be **wrong**: Larran's key (1/50) and
  Slayer's enchantment (1/30) are two INDEPENDENT tertiary rolls with no shared
  access rate at all.

So transclusion provenance proves "the wiki packages these as one unit", not
"these are mutually exclusive". The distinguishing signal is real and structural
— whether every row's rate derives from one shared base variable, readable from
the template definition at expansion time — but it is a separate change with its
own correctness argument, and `preroll`'s suppression semantics interact with
the pre-existing approximation that a page's several same-denominator headings
are already modelled as separate tables. Left flagged, deliberately, rather than
guessed into `verified`.

Corporeal Beast is the case that needed none of this and shows what "right"
looks like: its three sigils (`1/1365`, `1/1365`, `1/4095`) homogenise onto one
denominator of 4095 = 585 x 7, recovering the page's stated "1/585 onto the
sigil table, then 3/7, 3/7, 1/7" exactly, through machinery that already existed.

## Transcluded sub-tables are `independent`, and how the mode was decided

The transclusion work shipped these blocks as `preroll`, which was measurably
wrong, and the way that was found is more important than the fix.

### The signal that was proposed, and why it does not hold

The candidate was **"every rate in this transclusion derives from one
`{{#vardefine:}}` base"**. Tested against the two shapes known to differ:

- Seed / herb / talisman templates: one base (`{{#vardefine:thsdtbase|
  {{#expr:{{{1}}}/250}}}}`), every row derived from it. ✓
- `WildernessSlayerDropTable`: Larran's key derives from `keyDenom` (the
  monster's combat level), Slayer's enchantment from a separate `hitpoints`
  expression. Two independent derivations, no shared base, and the template
  declares no access rate at all. ✓

So it does separate those two — but it **fails on `Uniques/Corporeal Beast`**,
which has no `#vardefine` anywhere and is provably mutually exclusive (the page
states 1/585 onto the sigil table, then 3/7, 3/7, 1/7). A false negative, and
harmless in practice since Corp homogenises onto one denominator anyway, but it
shows provenance is not the mechanism.

### What replaced it: an arithmetic identity

**Do the expanded rows' rates sum to the access rate the transclusion
declared?** If the rows are mutually exclusive alternatives reached by one
access roll, total probability says they must. Measured across the corpus:

| block | declared access | Σ rates ÷ access | verdict |
|---|---|---|---|
| seed / herb / talisman, 17 blocks | `5/139`, `1/128`, `2/100`, … | **1.0000** (±0.3%) | partition |
| Vorkath's seeds | `3/150` | **1.6665** | refused — correctly |
| `WildernessSlayerDropTable`, 8 blocks | none declared | — | abstains |

Vorkath is the one worth understanding: it overrides two rarities with
**effective** chances that fold in its main table's own seed slots ("This item
is rolled on both the main loot table as well as the tree-herb seed drop
table"), so its rows are not a partition of the seed roll alone. The identity
catches that without being told, which is the argument for it over any
provenance rule.

`transclusionPartition` implements it; `checkTransclusionPartitions` runs it on
**every** transcluded block whatever mode that block lands in, and `parse-boss`
reports any block that is not a partition. Standing, not a one-off measurement.

### The identity is not what decides the mode, and that distinction matters

It establishes only that the rows are *within-block* mutually exclusive. It
says nothing about what `preroll` ADDITIONALLY asserts — that a hit suppresses
every later `weighted`/`preroll` table — and measured against the wiki's own
published rates, that assertion is simply false:

| source | item | as `preroll` | as `independent` |
|---|---|---|---|
| Arrg | Coal (1/42.7) | **−23.45%** | **0.00%** |
| Giant sea snake | Adamant dart tip | **−13.83%** | **0.00%** |
| Sarachnis | Grimy kwuarm | −5.64% | −0.78% |
| Dagannoth Rex | Grimy ranarr weed | −0.78% | 0.00% |

So the mode switch is driven by the block coming entirely from ONE
transclusion — which is what makes the suppression claim unsupportable — and
the identity is the evidence recorded alongside it.

**The cost of `independent` is real and accepted**: two rows of one sub-table
can co-occur in a single simulated kill, which the access roll forbids. About
0.06% of kills on Abyssal Sire. That is the same quantified, documented
kill-log artifact the CoX decision already accepts, and it is confined to the
block instead of distorting its neighbours.

**These blocks stay flagged.** The identity proves the rows are one roll;
modelling them as independent rolls is a deliberate approximation of that, and
the document does not express the single-access-roll shape at all. Clearing the
flag would claim the pipeline derived the structure unaided. Corpus: **27
verified / 2 manual_override / 23 needs_review**, one fewer verified than
before the mode change and correct at that number.

A sub-table whose rows DO homogenise onto a common denominator never reaches
any of this — it becomes a `weighted` table, which is exact and suppresses
nothing. Corporeal Beast's sigils take that path (4095 = 585 × 7).

### `marginal-rates.test.ts`, and why nothing else could have caught this

Every other check is closed-world over the document's structure: `weights_sum`
reconciles a table against its denominator, `drops_covered` asks whether an
item is reachable, `rates_valid` whether a rate is well-formed. **Not one of
them composes the document and asks whether the resulting per-kill probability
is the number the wiki states**, so a table whose own rows are individually
perfect can still be wrong because of what a NEIGHBOURING table does to it.
`drops_covered` in particular cannot see it — coverage is by item name, so a
row at the wrong rate looks exactly like a row at the right one.

The new test composes each document through `expectedValue` and compares
per-item probabilities against the `dropsline` bucket. Roughly **1,270 item
rows across 52 sources** are directly comparable. Three exclusions, each
because the COMPARISON would be invalid rather than because the number was
inconvenient:

1. **Items appearing more than once**, or also reachable through a `tableRef`.
   The per-item expectation sums every entry that yields them; Coins appears in
   four tables and in the rare drop table.
2. **Tables downstream of a real pre-roll.** A pre-roll hit short-circuits the
   chain, so later tables are reached only when it misses, and the wiki
   publishes a flat figure that does not account for it — Brutus' 10/150
   pre-roll puts all thirteen of its main-table rows exactly 6.54% low.
3. **`preroll` tables' own entries**, which are a first-hit-wins chain, so
   every entry after the first is reduced by the ones before it (Callisto's
   Tyrannical ring, 1.56% under its flat 1/512).

(2) and (3) are the same open question in two forms — what the wiki's flat
figures MEAN next to chain semantics — and it is the long-running "Uniques
heading" question those very sources are already `needs_review` over. This test
does not get to settle it by asserting one reading.

A third assertion counts how many rows survive those exclusions and fails below
300. That earned its place immediately: the first run of the suite passed
vacuously because `Boss` has no `title` field (it is `wikiPage`), so every
oracle lookup threw into a `catch` and returned null. Without the coverage
guard, a green suite would have meant nothing.

## The icon stack-suffix rule

`Belladonna seed` arrived with the transcluded herb/seed tables and resolved to
nothing: its icon is `File:Belladonna seed 5.png`, a stack-size suffix the item
name never mentions. Stage 1 resolves that whole class through MediaWiki's file
redirects; this item has none, and stage 2 refused it because it accepts only a
case-insensitive exact title match.

Stage 2 now also accepts a **strictly numeric** suffix (`stackSuffixPattern`).
The exact-match rule exists to stop `Baby mole` resolving to
`Baby Mole (NPC).png`, and digits-only keeps that intact — `(NPC)`, `detail`,
`(shielded)` and `Cow slippers (1)` are all still refused, pinned by name in
the tests. The item name is regex-escaped, so `Vet'ion jr.`'s `.` stays a
literal.

**736 items, 734 resolved, 0 wiki requests** — the fix came entirely from the
existing snapshots, which is CLAUDE.md's "never re-hit the wiki to fix a parser
bug" working as designed. The two remaining are genuine: `Muphin` (only
`(shielded)`/`(melee)`/`(ranged)` variants exist) and `Nothing` (not an item).

## Phase 7: Tombs of Amascut

`data/overrides/chest-tombs-of-amascut.json`, pinned by
`apps/ingest/test/toa.test.ts` (28 assertions). ToA remains `needs_review` and
stays on the mechanics watchlist — that is the correct outcome, not a shortfall,
and the reason is narrower than the one the watchlist entry was written for.

### The interpolation "UNKNOWN" was a missing source, not a missing fact

`docs/bosses/chest-tombs-of-amascut.md` recorded the unique-weight rule between
the page's five published breakpoints as UNKNOWN and guessed at where it might
live ("the wiki's own rewards calculator presumably encodes it in Lua module
code, which was not fetched"). That guess was right and the page was never
re-read for it. **`Module:Tombs of Amascut loot` (revid 15216862) states the
rule outright**, and `Module:Chart data/toa unique weights` exists too.

Both were fetched through `WikiClient` on the ordinary etiquette queue, two
requests, snapshotted like any other page. This is **not** a violation of
CLAUDE.md's "never re-hit the wiki to fix a parser bug": nothing here is a
parser bug, and the rule is that re-parsing comes from `data/snapshots/`, not
that new pages may never be fetched — the same standing that fetched the RDT
pages and the nine transclusion template definitions.

The recovered rule (`p.reweight`) is `floor` expressions over raid level on
integer weights — shadow 10, each masori piece 20, ward 30, fang and
lightbearer 70, summing to 240. It reproduces **all five published rows
exactly**, which is what licenses using it at the raid levels between them.

**Do not "simplify" this to interpolation between the five rows.** Before the
module was found, the deviations were checked directly and the published table
is **non-monotone**: the fang's rate falls 0.2917 → 0.2727 → 0.2105 across raid
levels 300/350/400 and then *rises* to 0.2222 at 450, because that band pins its
weight at 40 while the denominator keeps shrinking. Any interpolation would have
been wrong rather than merely unstated — the exact failure the "invented curve"
refusals (Zalcano's shard, Duke's frozen tablet) exist to avoid.

Where the module and the page's prose disagree the difference is always
flooring, and the module wins, with two consequences the prose does not state:
the common-quantity bonus is stepped (`floor((RL-300)/5)`, which is what
reproduces the page's own "305 is 16%, 400 is 35%, 450 is 45%" examples, unlike
the continuous form), and there is a `raidLevel < 150` case scaling normal loot
by 0.75. **One exception, deliberate:** the module computes the elite clue as a
bare `points / 200000` with no cap, while the page's prose and its cited Mod Ash
tweet both state a 25% maximum. The cited primary source wins there; the module
is a calculator display whose other simplification (dividing everything by team
size) is likewise not part of the mechanic.

### Formula-driven weights — Extension A's missing fourth member

Extension A gave `Table.rolls`, `QtySpec` and both `qtyMultiplier` sites a
formula variant on one principle: a per-run `SimContext` scalar may decide a
table's shape, and since the context is fixed for the run, resolving it costs
nothing per kill. **`weight` was the one member left out**, for the ordinary
reason that nothing had asked. ToA asks: the fang alone takes a distinct integer
weight at roughly forty raid levels, so this is a rule, not a table.

`WeightRateSchema.weight` is now `number | FormulaRef`, resolved in
`compile.ts`'s new `compileWeight` at the same moment as every other formula
position. Measured cost: none. 1M-kill Brutus landed at 199.8/200.7/194.6ms
against the documented ~203–208ms, with `gpPerKill` byte-identical at 597.2676.

The alternative was considered and rejected: ~85 condition-bracketed static
entries enumerating each distinct weight, which expresses one three-line rule as
hand-computed data and does not compose (CoX and ToB scale the same way).

### `levelAtLeast` gained `points`, `raidLevel`, `deaths` — the lunar-chest lesson, again

All three fields have existed since Extension A. None was reachable from a
condition, because `levelAtLeast`'s enum did not list them. The research doc
filed two of these as needing *new condition shapes*; the whole fix was three
enum entries. `docs/bosses/lunar-chest.md`'s corrected banner says it exactly:
**having a `SimContext` field is not the same as being able to gate an entry on
it.** `deaths` is expressed as `n: 0, atMost: 0` — exactly zero — which is what
`atMost` made sayable.

### `ownershipGate` on `LeafEntry`, and why the jewels need it

`compile.ts` previously stated that ownership inside a `oneOf` was "out of scope
rather than added speculatively" because none of Extension B's four sources
needed it. ToA is the source that does, which is the bar that comment set.

The keris jewels: a successful "any jewel" roll is *guaranteed* to give one the
player does not own, which the page quantifies as unowned-jewel rates of 1/37.5,
1/25 and 1/12.5 at one, two and three owned. That is a `oneOf` whose pool is the
unowned jewels. Two alternatives were rejected on measurable grounds, not taste:

- **Four independent gated entries** would let two jewels arrive in one raid,
  which the mechanic forbids.
- **A formula rate reading `ctx.ownedCounts`** cannot work at all: formula rates
  resolve once at compile time, so the rate would freeze at the entering counts
  and never move as jewels are acquired during a batch. `ownershipGate` is the
  only thing re-evaluated per kill.

`compileOneOf` now populates `ownershipGates`, and because a `oneOf` already
compiles to a weighted `CompiledTable`, `effectiveWeightedPool` renormalises it
with no change to `simulate.ts` or `expected-value.ts` at all.

### Three of the eight challenge rewards ARE modellable

The research doc recommended marking all eight out of scope. The page's own
table disagrees: Masori crafting kit (350+), Menaphite ornament kit (425+) and
Cursed phalanx (500+) list `{{NA}}` other requirements — raid level plus the
party-wide zero-death rule that applies to all of them. Those three are built,
including the "roll is canceled if the item is already in your inventory,
equipment or bank" rule as an `ownershipGate`.

The five remnants need every invocation of one encounter set at level 4, which
is a per-raid invocation-composition fact no scalar stands in for. They are the
only rows `drops_covered` still reports missing (5 of 50, down from 15), so the
gap is self-documenting rather than hidden.

### Why the unique roll is a preroll + `oneOf`, and not seven independent rows

The module computes a per-item rate and sums it. A `preroll` entry whose node is
a `oneOf` computes `P(item i) = R · v_i / Σv_j`; setting `v_i = w_i·f_i` (the
out-of-range 1/50 folded into the weight) and `R = base · Σw_j f_j / W` makes
the two identical term by term. That identity is why the out-of-range rule needs
no machinery beyond a formula weight.

Modelling the seven as `independent` entries instead was quantified rather than
hand-waved: at the 55% cap it would award **two uniques in roughly 12% of the
raids that award any**, which the page forbids outright ("Only one player per
raid can receive a unique"). That is far outside the CoX-class artifact this
project has accepted elsewhere, so it is not an approximation worth taking.

### `marginal-rates.test.ts` had the `oneOf` blind spot too — the fifth instance

ToA's seven uniques deviated by exactly the unique chance on the first run. The
cause was not the model: `deviations`' `downstream` collector used a flat
`entry.node.kind === 'item'` loop, so items inside a `oneOf` were never marked
as suppressed by the preroll above them, and a correct model failed an incorrect
comparison. **This is the same shape landmine #11 records finding permissive
four separate times** (`entry.title`, `refs_resolve`, `qty_sane`, `items_known`
— the last for this exact reason). Fixed by descending into `oneOf`, not by
adding ToA to the exclusion list, which is what an `AUTHORED` entry would have
done and would have hidden a real gap affecting every future `oneOf` source.

### `rates_valid` no longer claims weights are schema-enforced

Its doc comment said `fixed`/`always`/`weight` are "fully enforced by the schema
… a hardcoded pass for those three kinds is correct, not lazy". That became
false the moment a weight could be a formula. It now evaluates formula weights
alongside formula rates **and descends into `oneOf`**, which matters because
ToA's formula weights live *only* there — a top-level walk would have counted
zero and reported a confident pass over nothing, the vacuous green of landmine
#11f. Its detail string changed accordingly, and a test covers the new path in
both directions.

### Points are net of the 5,000, and the unit is one player

`ctx.points` for ToA is the reward-point total **as used for loot** — already
net of the 5,000 starting points the page says are subtracted at the end. This
is not an interpretation: the module's `estimate_points` never adds them in the
first place, so its `points` parameter is the same quantity.

Team size is out of scope, stated rather than approximated. The module divides
points and chances by team size, and the page says a group's unique roll pools
everyone's points with per-player probability proportional to contribution. One
chest for one player is this simulator's unit.

## The members toggle is retired; F2P sources get an inverted one

**Presentation only.** The `members` condition, `SimContext.members`, its `true`
default and the `members` URL param are all untouched — `weights_sum` is a
members-variant check and depends on the first, and shared links depend on the
last. The only change is which control `apps/web` renders.

Every user is assumed to be a member, which `DEFAULT_SIM_CONTEXT.members`
already said. Sources with a genuine free-to-play outcome render a
**"Free-to-play"** toggle instead: unchecked is members (the default), checked
sets `members: false`.

### What the corpus actually contains

Worth recording because a prior count of "10" was of *conditions*, not sources.
There are **10 members conditions across exactly 2 sources**, and only one of
them is an F2P boss:

| source | m:true | m:false | wiki infobox | toggle? |
|---|---|---|---|---|
| `brutus` | 6 | 3 | `members = No` | **yes** |
| `black-knight-titan` | 1 | 0 | `members = Yes` | no |

`chest-tombs-of-amascut` has `contextDefaults.members: true` and no members
condition, so it is not a third case.

**Obor and Bryophyta are genuinely F2P bosses and are not in the corpus at
all** — both tier D, `include: true`, never parsed, no snapshot, no document.
They are invisible to the site today. If they are ever built, re-check the rule
below against them.

### The rule, and the case it cannot see

The toggle renders when the document (shared tables followed) contains at least
one **`members: false`** gate — i.e. the wiki described an F2P-specific outcome.
Not "has any members condition", because the two sources above are different
animals: Brutus has a real split whose variants both sum to its denominator of
81, while Black Knight Titan is a Holy Grail quest boss whose lone `{{(m)}}`
marker sits on `Key (medium)`. Free players cannot reach that encounter, so
`members: false` is an unreachable game state there and offering it would
present a fiction as a choice.

**The limitation, stated rather than hidden:** an F2P boss whose members-only
rows have no F2P replacement would carry only `members: true` gates and would be
missed. That shape is not in the corpus, and it is **not distinguishable from
Black Knight Titan's from the document alone** — the deciding fact is the wiki
infobox's `members` field, which the `Boss` schema does not carry and which this
change was explicitly not allowed to add. Both halves are pinned by name in
`apps/web/test/SimContextControls.test.tsx`.

### URL compatibility came for free, and is pinned

`paramsFromSearch`/`searchFromParams` were already control-agnostic: they read
and write `members` off the context, not off any widget. So `?members=0`
reproduces on every source, **including the ones that now render no control for
it** — `url-round-trip.spec.ts` pins exactly that against Black Knight Titan in
a real browser, plus the inverted-checkbox case on Brutus.

## The tier D sweep, and the coverage denominator was wrong

### 52 was never the denominator

Coverage had been read as "27 of 52". **52 was the number of sources that had
ever been PARSED, not the number the project owns.** The inventory's own gate is
`include: true`, and that is **102**. Before this sweep, 52 of 102 had a
document; after it, **66 of 102 (65%)**, and `verified` is **28/102 = 27%** —
the same numeral as the old "27 of 52", which is exactly how a wrong denominator
hides.

| tier | with document / include:true | what is missing |
|---|---|---|
| A | 24/26 | `ancient-chest` (CoX), `revenant-maledictus` |
| B | 1/1 | — |
| C | 25/26 | `black-demon` (known heading gap) |
| D | 16/20 | 4 `parse_failed`, below |
| E | **0/29** | never attempted |

**Tier E is the largest remaining block and it is untouched**: 29 sources with
`include: true`, 1–7 dropsline rows each. These are the `trivial` sources — "a
handful of `Always` rows, which is a valid `always` table" — that the Phase 2
notes said are *complete, not deficient*. They are cheap and have simply never
been run.

### Tier D: the classification really was stale, and partly still true

20 sources at tier D with `include: true`; 18 had no document. Fetched the 15
missing wikitext snapshots and ran the parser over all of them.

Result over the 18: **1 verified** (Skotizo), **13 needs_review**, **4
parse_failed**. Tier D overall now 15 `needs_review` / 4 `parse_failed` / 1
`verified`.

So the tier was stale in the sense that 14 of 18 now assemble into a document
where none had before — but the original complaint is mostly *real*: **8 of them
genuinely do not compile**, their main table overflowing its denominator
(`chaos-fanatic`, `commander-zilyana`, `grotesque-guardians`, `k-ril-tsutsaroth`,
`mad-angel`, `maggot-king`, `phosani-s-nightmare`, `yama`). That is the exact
defect triage named, and `weights_sum` reports it on each.

### Why the four God Wars bosses split C/D — measured, not guessed

All four reach the rare drop table. `classify` checks the denominator overflow
**before** the RDT branch, so the overflow decides:

| boss | main table | tier |
|---|---|---|
| Kree'arra | 126.95/127 | C |
| General Graardor | 118.95/127 | C |
| Commander Zilyana | **133.2**/127 | D |
| K'ril Tsutsaroth | **135.7**/127 | D |

Kree'arra fits with 0.05 to spare. Nothing about the four is conceptually
different — two of them have rows summing past 127 and two do not, and every
documented parse invocation being `--tier A,B,C` is what kept the other two out
of the corpus for the whole project. Both now parse to `needs_review`, both
still blocked on GWDRDT (landmine #3) as their tier-C siblings are.

### Obor and Bryophyta fail on a HEADING, not on their tier

Both have plenty of rows (58 and 57 `{{DropsLine}}` calls). They
`parse_failed` with "no DropsLine calls found under a Drops heading" because
their top-level headings are **`==Members' worlds drops==`** and
**`==Free-to-play worlds drops==`**. `DROPS_SECTION_TITLE` allows at most one
word before "drops" (`/^(?:\S+\s+)?(drops?|rewards?)…/`), and these have two.

This is the same gap as Black demon's `==Level 172, 178, and 184 drops==`, now
with three more instances (`Reward Chest (The Gauntlet)` is a fourth variation:
`==Regular loot table<span id="Regular"/>==`, with an HTML anchor in the
heading). **Not fixed here** — that regex was deliberately tightened to reject
"Reward mechanics" and "Drop mechanics", so widening it is a corpus-wide change
that needs its own pass, not a drive-by.

Worth connecting to the previous session: Obor and Bryophyta are the two F2P
bosses, and their page structure is a **section-level members/F2P split**. If
that heading gap is closed they become genuine free-to-play sources and are
exactly the case `BossContextSurface.freeToPlayVariant` flags as needing a
re-check.

### Two robustness bugs, both found by one bad source

`chaos-fanatic`'s overflowing table threw `WeightsExceedDenominatorError` out of
`compileBoss` **inside `checkRefsResolve`**, which aborted the entire 23-source
parse run. One source's data defect took 22 others down with it.

Fixed in `refs-resolve.ts`: a compile failure that is not a ref failure is not
this check's business. It reports `ok: true` — the structural walk did resolve
every ref, which is what the check is for — with a detail naming why the
`compileBoss` cross-check could not run and pointing at `weights_sum`, rather
than claiming a clean pass it did not earn.

`marginal-rates.test.ts` had the same crash for the same reason. It now records
non-compiling sources and **asserts the list exactly**, so a source cannot
quietly join it — the exclusion-list-grows-until-vacuous shape from landmine
#11f.

### A 2.6 MB boss portrait, caught by an extension check

Mad Angel's `|image =` is `Mad Angel.webp`, a 5.4 MB **animated** webp. Measured
against the live CDN: its "300px" thumbnail is still **2.6 MB**, against 36 KB
for a comparable png portrait. The same page carries
`|bucketimage = [[File:Mad Angel.png]]`, whose 300px thumb is **88 KB**.

`extractInfoboxImage` now prefers `bucketimage`, which is the wiki's own
designation of the image to use in a data context. Blast radius was checked
first: across 209 wikitext snapshots **one page carries `bucketimage` and one
page has a `.webp` image, and they are the same page**.

`Ikkle Hydra` joined the unresolved-icon list for a legitimate reason (only
colour variants exist). Its drop row supplies `image=Ikkle Hydra (serpentine).png`
explicitly — **the parser does not read `DropsLine`'s `image=` parameter, and
doing so would resolve this whole class.** Recorded, not built.

## DROPS_SECTION_TITLE widening, and what it actually recovers

Two independent fixes, both in `apps/ingest/src/parse/wikitext-drops.ts`, plus
one previously-latent parsing bug the wider reach exposed.

### Two-tier heading match: tight (trusted unconditionally) + loose (content-gated)

`DROPS_SECTION_TITLE`'s one-word-prefix cap missed real corpus shapes: Obor/
Bryophyta's `==Members' worlds drops==`/`==Free-to-play worlds drops==` (2
words), Black demon's `==Level 172, 178, and 184 drops==` (5 words) and
`==Wilderness Slayer Cave drops==` (3 words).

**Word count alone cannot fix this — `Salarin the Twisted`'s
`===Training and Rewards===`** (a Magic-training guide subsection, zero
`{{DropsLine}}` calls) has the identical 2-word-prefix shape as `Members'
worlds drops` and would false-positive under any wider cap. A new
`LOOSE_DROPS_SECTION_TITLE` (unlimited prefix, plus `table` as an alternate
terminal keyword — see below) is therefore never trusted alone: `findDropsSections`
only keeps a loose match once the section's own computed content is confirmed
to carry a real row template. The tight rule stays UNCONDITIONAL, deliberately
— `findRowlessTemplateBlocks` depends on it accepting a section that
legitimately has zero rows right now (an unexpandable transclusion), and
content-gating it would make that diagnostic blind exactly where it matters.

Checked, not assumed: `royal-titans.json` has `==Branda the Fire Queen
drops==`/`==Eldric the Ice King drops==` (3-word prefixes) but `royal-titans`
is `include: false` in `_inventory.json` (its two real bosses have their own,
separate pages), so this never reaches the parser regardless.

### `table` as an alternate terminal keyword, plus a second, unrelated bug it needed

Reward Chest (The Gauntlet) has NO heading ending in "drops"/"rewards" at all
— `Junk table`, `Incomplete loot table`, `Regular loot table`, `Corrupted loot
table`. All four needed `table` added as a `LOOSE_DROPS_SECTION_TITLE`
terminal. Checked against the whole corpus for false-positive risk: every
other `...table`-ending heading is either a nested RDT/gem-table subheading
(already inside a claimed section, so the non-overlap guard makes it a no-op)
or lives on `rare-drop-table`/`gem-drop-table`/`the-gauntlet`, none of which
are loot sources.

**This alone was not enough.** Every one of the four headings also carries a
trailing `<span id="Failure"/>`-style anchor, and `HEADING_PATTERN`
(`/\n(={2,6})([^=\n]+)\1[ \t]*\n/g`) could not see the heading AT ALL — not a
`DROPS_SECTION_TITLE` problem, a heading-detection one. `[^=\n]+` cannot span
the `=` inside `id="Failure"`, so it always stops short of the closer.
`HEADING_PATTERN`'s title group is now lazy (`.+?` in place of `[^=\n]+`),
which crawls forward to the true closing `={2,6}` regardless of an embedded
`=`. Verified as a pure recovery: run against all 209 wikitext snapshots, the
new pattern produces byte-identical heading lists everywhere except
`reward-chest-the-gauntlet`, which is the only page with a `<` in any heading
at all — recovering exactly its four previously-invisible sections.
`stripInlineTags` removes the tag from the stored title too, so table-id slugs
and any future display never carry raw wiki markup.

**Net result: Reward Chest (The Gauntlet) parses to `verified`, all 60 wiki
rows reachable.** No watchlist concern — its junk/incomplete/regular/corrupted
tiers really are per-row rarities, not a points-scaled shop like ToA/CoX.

### `Ancient chest` (CoX) — the widening's biggest and most dangerous find

`ancient-chest` had **never had a document at all**, and
`docs/HANDOFF.md` stated flatly that its page "has no `{{DropsLine}}`-shaped
content whatsoever" — true only in the sense that nobody had ever reached its
`==Loot table==` section, since the old regex couldn't match it and the page
was `parse_failed` before anyone looked further. **That claim is now
falsified.** The section exists, has real `{{DropsLineReward}}` rows, and
the widened rule reaches it — producing a document that reconciles cleanly
(`weights_sum`, `drops_covered`: all 51 rows reachable) and would have shipped
`verified`.

**It must not.** The page states outright: "For every 8,676 total points
obtained, a 1% chance to obtain a unique loot is given... capped at 65.7%...
If one of these items is received, no common rewards are given... Up to six
unique rewards can be obtained per raid." None of that reached the parser. The
generated document is two INDEPENDENT weighted tables (12 uniques /69, 33
commons /33) with no gating between them — meaning the naive parse has EVERY
simulated kill roll BOTH tables unconditionally, guaranteeing a unique on
every single kill. Not an imprecise approximation; a ~100%-unique-rate
document, considerably worse than an honestly-unmodelled curve.

**Added to `data/mechanics-watchlist.json` before this could ship**, `blockedBy`
naming all 7 bosses `_inventory.json` maps to `ancient-chest` (Great Olm plus
the six other CoX bosses whose loot funnels into the same chest) — caught by
`checkWatchlistConsistency` when the first draft named only Great Olm, exactly
the trip wire doing its job. The entry restates, rather than reopens, the
already-resolved elite-clue/Olmlet cross-table question (`docs/HANDOFF.md`'s
"What NOT to redo": a conditioned-marginal formula rate is exact; the naive
unconditioned subrates overstate Olmlet by 33x). CoX needs `cox_points` plus a
preroll/suppression override, following the exact pattern ToA's already
established — a real Phase 7 candidate now that the document exists to build
against, not a from-scratch investigation.

### `splitTopLevelPipes`: a second, independent bug the wider reach exposed

Bryophyta's page reaches the parser for the first time and immediately
produced a fabricated item: `"keyrate}}"`, unresolvable, failing
`items_known`. Root cause has nothing to do with heading matching — it's a
pre-existing bug in `wikitext-drops.ts`'s param splitter, latent for the
project's whole life because nothing had ever reached a page shaped this way
before.

`splitTopLevelPipes`'s depth counter scanned one character at a time without
skipping a matched 2-character token (`{{`/`}}`/`[[`/`]]`), so a run of 3+
identical bracket characters produced overlapping matches instead of the true
pair count: `}}}}` (two templates closing back-to-back — Bryophyta's
`{{DropsLine|...|raritynotes={{Refn|...{{CiteDiscord|...}}}}{{CiteNews|...
|name=keyrate}}}}`, where Refn's nested citation and a sibling CiteNews both
close at once) reads as THREE decrements instead of two, permanently
desyncing depth by one level. Everything after that point is read one level
shallower than it truly is — so `|name=keyrate`, a citation's OWN name param
two templates deep, gets read as depth 0 and silently overwrites the real
`name=Mossy key`.

`findTemplateCalls` never had this bug — its own depth loop already does the
equivalent extra skip, which is exactly why it correctly found the true
968-character extent of that same call while `splitTopLevelPipes` mis-split
its params. Fixed the same way: `i++` on top of the loop's own increment when
a 2-character token matches. Verified corpus-wide: every `{{DropsLine}}`-family
call's parsed params, across all 209 snapshots post-transclusion-expansion,
are unchanged except on Bryophyta (which shares the cited news post verbatim
with Obor, though Obor's own page happens not to trigger the exact `}}}}` seam).

**Net effect: Bryophyta goes from a fabricated item and a failing
`items_known` to every deterministic check green** (`needs_review` only for
the same accepted transcluded-mode-guess reason ~9 other sources already
carry). Zero item names containing `{`/`}` anywhere in the corpus after the
fix, checked directly rather than assumed.

### Corpus-wide verification, and what did NOT change

Full re-parse across tiers A–D. Diffed every `data/bosses/*.json` against the
committed version: **51 pre-existing documents changed by exactly the
cosmetic `rates_valid` wording carried over from the ToA session (never
regenerated until now) plus the intentional ToA watchlist-detail rewrite —
byte-identical otherwise.** `monumental-chest.json` (ToB, already on the
watchlist, also reachable via `==Loot table==`) is untouched — its rows were
already being captured through the same nested-subheading-independently-matches
byproduct ToA's own pre-override parse relied on. `revenant-maledictus` stays
`parse_failed` for its own, different, still-open reason.

**Not fixed here, flagged for the next session:** re-checking `freeToPlayVariant`
against Obor/Bryophyta found it is still `false` for both, and the reason is
precise, not a leftover bug in the regex work. `assembleBoss`'s `conditionsFor`
attaches a `members`/`freeToPlay` `Condition` only from a PER-ROW `{{(m)}}`/
`{{(f)}}` namenotes marker (`entry.members`/`entry.freeToPlay`, set in
`wikitext-drops.ts` from the row's own markup) — it has no notion of a
SECTION-LEVEL split at all. Obor and Bryophyta's rows carry no such markers
(the whole `==Members' worlds drops==`/`==Free-to-play worlds drops==` section
already implies it structurally), so their documents currently have ZERO
`members` conditions anywhere: every simulated kill, regardless of
`ctx.members`, rolls BOTH sections' tables unconditionally. Both sources
parse cleanly and are `needs_review` only for the pre-existing transcluded-
mode-guess reason, but this is a real, separate mechanical gap sitting
underneath that — attaching a `members: true`/`members: false` condition to
every entry sourced from a section whose title matches "Members"/
"Free-to-play" is the natural fix, and is new parser logic, not something the
heading fix triggers for free. Left as a scoped decision for the next session
rather than built silently.

## Follow-up: section-level membership conditions, and the check gap it uncovered

Built on request, same session: `conditionsFor` (`assemble-boss.ts`) now falls
back to a `members`/`freeToPlay` condition derived from the entry's own
top-level section title when no per-row `{{(m)}}`/`{{(f)}}` marker is present,
matched exactly against the two confirmed corpus phrases (`Members' worlds
drops`, `Free-to-play worlds drops`) — not a broad "contains 'member'"
heuristic, per this project's standing refusal to generalise past confirmed
cases. A per-row marker still wins when present. `ParsedTableGroup`/
`HeadingBlock` both gained a `section: string` field to carry this through
from `wikitext-drops.ts`'s extraction to `assembleBoss`.

**Closed a latent merge risk found while doing this, not a separate task:**
`buildTableGroups`'s adjacent-weighted-header merge previously kept blocks
together whenever they shared a denominator, with no check that they also
shared a section. Two blocks from different sections merging would have left
no single section to attribute the new fallback condition to. Not observed in
the real corpus (no two adjacent cross-section blocks currently share a
denominator) — closed anyway, since it's the same section data already being
threaded through, not new scope.

**This immediately broke `weights_sum`, and the break was informative, not a
bug in the new logic.** The check's "has markers -> both members and F2P
variants must independently reconcile to the denominator" rule assumed
Brutus' shape: one table, condition-excluded rows on both sides. Obor/
Bryophyta's shape is structurally different — TWO SEPARATE tables, each
belonging to exactly one variant in its entirety, with the other variant's
rows living in a different table object with its own denominator. Tagging
every entry in such a table with the same condition made `hasMarkers` true
while one side's sum was always zero, failing every affected table.

Fixed by checking the number of DISTINCT `members` values actually present in
one table, not just whether any exist: fewer than two distinct values (no
markers, or a uniform section-derived one) gets the same lenient flat check an
unmarked table already had (shortfall is a legitimate implicit `nothing`, only
overflow is a defect); two distinct values in one table is Brutus' shape and
keeps the existing per-variant reconciliation. Verified this doesn't silently
paper over a real defect: a uniform-members table that genuinely overflows its
own denominator still fails, pinned by test.

**Net result, verified functionally not just structurally**: Obor and
Bryophyta both went from zero `members` conditions anywhere in their documents
to 69/71 and 93/95 entries correctly gated (the untagged handful are rows with
no section-derived signal — none observed, so nothing left ungated by
omission). `freeToPlayVariant` is `true` for both, confirmed via
`contextSurfaceOf`. A simulated members run and a simulated F2P run now
produce genuinely different item sets (37 vs 22 distinct items for Obor, 64 vs
21 for Bryophyta) — checked by actually running `simulate`, not inferred from
the condition count alone. `weights_sum` passes cleanly for both; both stay
`needs_review` only for the pre-existing, unrelated transcluded-mode-guess
reason nine other sources already carry.

## Tier E run, and whether tier should gate parsing at all

### Tier E: the `trivial` classification held up

Ran `ingest parse --tier E` over the 29 `include: true` tier-E sources (plus 5
pulled in as always by an authored override: `chest-tombs-of-amascut`,
`doom-of-mokhaiotl`, `lunar-chest`, `reward-pool`, `zalcano` — already-shipped
work, not new tier-E coverage). Result over the 29: **26 verified, 1
needs_review, 2 parse_failed.**

**Structurally, "trivial" is confirmed, not stale.** Zero of the 29 produced a
`weighted`-mode table — every document is `always` and/or `independent` only,
several rows at most. Phase 2's own description ("a handful of `Always` rows,
which is a valid `always` table and needs no weighted machinery") is exactly
what came back. This is a different shape of "stale" than tier D's: the tier D
sweep found sources that were mis-triaged as *unbuildable* when they were
merely *unattempted* (14 of 18 assembled cleanly on the first real try). Tier
E's 29 were correctly triaged as *simple*; they were simply never run.

The three non-`verified` outcomes, checked individually rather than assumed:

- **`chronozon`** — `needs_review`, structure is fine (2 tables, 3 entries, no
  weighted mode), blocked only by `items_known`: `Crest part (Johnathon)` is
  not in the item index. An item-resolution gap, not a table-shape one.
- **`sigmund`** — `parse_failed`, and correctly so. Its only `{{DropsLine}}`-
  family call is a `{{DropsLineSkill}}` under `==Pickpocketing==` (a quest-only
  Thieving pickpocket reward, `Key (The Lost Tribe)`, restricted to [[The Lost
  Tribe]]), not combat loot. There is no `==Drops==`/`==Rewards==` heading on
  the page at all. This is a genuinely lootless boss page, same shape as the
  `Dream Mentor` quartet documented above — not a hidden real table.
- **`burnt-chest`** — `parse_failed`, but for a different, real reason: it had
  **no wikitext snapshot on disk at all** (fetched now via the existing
  `fetch-wikitext-for.ts` one-off script — the same tool already used for this
  exact situation, not a new mechanism, and not a re-fetch to fix a parser bug,
  since it had never been fetched once). Once fetched: one row, `{{DropsLineReward|name=Warm
  key|quantity=1|rarity=Always}}`, under `==Loot==`. Genuinely trivial (an
  `Infobox Scenery` quest chest, not even a monster) — but `DROPS_SECTION_TITLE`
  doesn't recognise "Loot" as a drops-heading synonym, so it still
  `parse_failed`s on the heading-matching gap, same class as Black demon's and
  Obor/Bryophyta's (see "DROPS_SECTION_TITLE widening" above). Checked across
  all 209 wikitext snapshots: `burnt-chest` is the only one with a `==Loot==`
  heading, so this is not corpus-wide the way the multi-word-prefix gap was.
  Not fixed here — flagged, matching how Black demon's gap was left flagged
  rather than drive-by patched.

### Should tier gate parsing at all? No — and it already half-didn't

The prompt for this question: **Commander Zilyana and K'ril Tsutsaroth were
absent from the corpus for the project's entire life because their main tables
sum to 133.2/127 and 135.7/127, while Kree'arra's 126.95/127 fit** ("Why the
four God Wars bosses split C/D — measured, not guessed", above). All four are
mechanically the same shape (GWDRDT-gated, still blocked on landmine #3
either way) — the only thing the 127-vs-133.2 split decided was whether
`--tier A,B,C` would ever look at the page. Two of four Wars bosses were
invisible to every report, every coverage count, every session, for a
reason with nothing to do with whether they were worth building.

**This is the same shape as landmine #12's reward-pool bug**, just wider: a
tier filter deciding a source doesn't get attempted, silently, indefinitely,
for a reason orthogonal to whether it should be built. Landmine #12 fixed the
narrow case (an authored override always forces its source through, whatever
`--tier` says) and reasoned it as "the tier filter is a triage convenience for
deciding what to *attempt*; it was never meant to overrule an explicit human
decision." That reasoning applies to every source, not just the ones lucky
enough to have an override already written — a source's `include: true` *is*
the explicit human decision that it belongs in the corpus. Tier answers "how
much parser sophistication does this page look like it needs," which is
useful for choosing what to work on next and worthless as a reason to never
look at something. The tier-D sweep and this tier-E run both demonstrate the
same thing empirically: most of what a tier gate hides turns out to compile
cleanly the first time anyone actually runs it (14/18 for D, 26/29 for E).

**Changed**: `apps/ingest/src/main.ts`'s `parse` command now defaults `--tier`
to every tier (`TIERS.join(',')`) instead of `'A'`. `include: true` is now the
only real attempt-gate; `--tier`/`--source` remain as narrowing filters for a
targeted or iterative run (e.g. re-running just tier E after a fix). Verified
as a pure widening, not a behaviour change for what was already being
attempted: a full `ingest parse` (no `--tier`) re-parses all 102 sources and
produces a byte-identical `data/bosses/*.json` for every previously-existing
document — `git diff --stat data/bosses/` is empty against the tier-A–D
documents already committed; the only files touched are the 27 new tier-E
documents (26 `verified`, 1 `needs_review`), which appear as untracked
additions, not diffs.
`docs/OVERRIDES.md`'s "tier filter does not apply to an override" note is now
a special case of a more general fact (tier does not gate anything by
default) rather than the whole story — left as-is rather than rewritten, since
it is still true and still the right thing to know when authoring an
override.

`reportDistribution`'s `gateEligible` count (the `sources`/`triage` command,
unrelated to `parse`) is untouched — it is a pre-parse *expectation* signal
("this tier usually compiles cleanly"), not a gate, and stays useful as
exactly that.

### Coverage, corrected

Regenerated `data/index.json` (`ingest site-index`) and `data/item-icons.json`
(`ingest item-icons`, 963 corpus items now vs. fewer before tier E, 960
resolved/3 unresolved: `Ikkle Hydra`, `Muphin`, `Nothing` — all pre-existing,
none new) after the tier-E documents landed; both are derived from
`data/bosses/*.json` and go stale exactly the way `data/index.json` has
before (landmine #10's cousin). Full `pnpm -r test` green afterwards: 447/449
ingest (2 pre-existing skips), 176/176 loot-model (Brutus gate included), 74/74
web.

| | count | of include:true (102) |
|---|---|---|
| documents (any status) | 98 | 96.1% |
| `verified` | 55 | 53.9% |
| `manual_override` | 2 | 2.0% |
| `needs_review` | 41 | 40.2% |
| no document | 4 | 3.9% |

`verified` against documents rather than the full gate: **55/98 = 56.1%**.

By tier (`with document` / `include: true`): A 25/26, B 1/1, C 26/26, D 19/20,
E 27/29. The 4 sources with no document at all: `revenant-maledictus` (A, own
open parse_failed reason, unrelated), `rewards-chest-fortis-colosseum` (D,
wave-shaped, needs an override per section 3 of `docs/HANDOFF.md`),
`burnt-chest` and `sigmund` (E, both above).

This replaces the "66 of 102 (65%), verified 28/102 (27%)" figures recorded
under "The tier D sweep, and the coverage denominator was wrong" — those were
correct as of that sweep and are now superseded by this run, not wrong when
written.

## `repeatable`: distinguishing "has a wiki page" from "can be farmed"

Tier E's 29 sources include ~26 quest bosses fought exactly once per account
— Culinaromancer, Agrith-Naar, Damis, Chronozon, Bouncer, Dad and similar.
`me.json` is the sharpest case: as a slug, typing "me" into search surfaced
it. A loot simulator has nothing to say about a source a player can only
sample once, and this content was crowding out the bosses people actually
farm. `repeatable: boolean` is a new field distinguishing the two, added to
`Boss` (`packages/loot-model`), `BossEntry`/`LootSource`
(`apps/ingest/src/inventory/schema.ts`), and `SiteIndexEntry`
(`apps/ingest/src/site-index.ts` / `apps/web/src/lib/types.ts`).

### The signal: `Category:Quest monsters` / `Category:Quest NPCs`, live

`buildInventory` already calls `client.categoriesFor(titles)` for every one
of the 172 inventory pages (real `action=query&prop=categories` data, not a
wikitext regex — template-inherited categorisation is seen too) to detect
encounters. `deriveRepeatable` (`apps/ingest/src/inventory/repeatable.ts`)
reuses that same already-fetched map at zero extra request cost: a page
tagged `Quest monsters`/`Quest NPCs` defaults to `repeatable: false`, plus a
tiny hand-verified override file for the one case the category over-fires.

**Precision/recall, measured against the corpus rather than assumed:**

- **30 of 102 `include: true` sources carry one of the two categories.**
  Checked EVERY one of the 30 individually against its own page's prose (not
  memory) — 29 are genuinely one-time (several state it outright: Giant Sea
  Snake — "it can only be fought once"; Arrg — "can only be fought during the
  quest, and afterwards he can be fought in the Nightmare Zone", which does
  NOT count, below). **One false positive: Vorkath.** Tagged (first fought
  during Dragon Slayer II) but the page states "After completing Dragon
  Slayer II, players may fight Vorkath again, with increased stats and
  rewards" and carries a `Post-quest` infobox version — a quest that GATES
  access to an ordinary, persistent, heavily-farmed boss, not one that
  consumes the encounter. Corrected via `data/repeatable-overrides.json`, a
  one-entry hand-authored file in the shape of `data/mechanics-
  watchlist.json` (cited reason, `.strict()` schema, a
  `checkRepeatableOverridesConsistency` guard wired into `ingest sources`
  exactly like the watchlist's orphan check, plus a real-corpus regression
  test in `apps/ingest/test/repeatable.test.ts`).
- **Zero false negatives found.** Every `include: true` document WITHOUT
  either category was checked for a small/trivial shape (a proxy for "looks
  like a one-off reward") and exactly two matched: Sir Mordred and Demonic
  Brutus. Both are genuinely repeatable per their own prose — Sir Mordred has
  a non-instanced overworld location distinct from his quest encounter and
  "will respawn shortly"; Demonic Brutus is a hard-mode variant of the
  ordinary, repeatable `brutus` source, gated by carrying an item rather than
  by a one-time script. Neither needed an override; the default (`true`) was
  already right for both.
- **Two phrase-matching false-positive shapes were found and deliberately
  NOT built into a second automatic signal**, because both were noisier than
  useful when checked against the corpus: (1) "fought again... in the
  Nightmare Zone" (Dad, Kamil) — an NMZ dream-fight doesn't drop the source's
  own loot table, so this is not repeatable for simulation purposes despite
  reading like it; (2) a within-encounter HP-reset — "must be fought again
  from full hitpoints" (Evil Spirit), "regenerates... and you must kill him
  again" (Black Knight Titan) — not a return visit at all. A naive
  "`fought again`" regex fires on both and is wrong both times; neither
  needed an override, since the category default (`false`) was already
  correct. Recorded in `repeatable.ts`'s header rather than shipped as code,
  matching how the "Uniques heading" question stays a documented dead end
  rather than a widened keyword list (`docs/HANDOFF.md`, "What NOT to redo").

### Aggregation, threading, and what does NOT carry it

`LootSource.repeatable` is `bosses.some(...)` over its constituent boss
pages' own flags — an aggregated encounter (Barrows, a raid) is repeatable
the moment one member page is, which every real many-boss source in the
corpus already is; no case needed the "one page is a one-off, the others
aren't" branch this exists to handle correctly if it ever comes up.

`repeatable` reaches `data/bosses/*.json` by being threaded through
`parseBoss` -> `assembleBoss`/`applyOverride`, NOT re-derived at parse time
and NOT something an override file can declare (`BossOverrideSchema` stays
`.strict()` without it) — it is corpus scope metadata from `_inventory.json`,
supplied externally and always wins, the same way `status`/`validation` are
supplied externally rather than trusted from an override. `Boss.repeatable`
defaults to `true` in the zod schema so the ~150 existing hand-built test
fixtures across the repo didn't need touching; every REAL parse always sets
it explicitly. `SiteIndexEntry.repeatable` also defaults to `true`, for a
narrower reason: `buildSiteIndex`'s `committedImages` reads a possibly-older
`data/index.json` and already degrades gracefully (empty map, not a crash)
when it can't parse one — a required field with no default would have turned
"can't parse the previous index" into "silently drop every carried-forward
portrait," the exact bug class landmine #10 already named once.

**Not filtered: `ingest parse`.** Kept parsing everything regardless of
`repeatable` — the coverage number stays honest and the pipeline stays the
single source of truth, per the request. Only two things read the flag:
`apps/web/src/components/SearchBox.tsx` (filters it out of the DEFAULT
result list) and nothing else — `/admin` (`AdminPage.tsx`) deliberately does
not filter, and now renders a "Not repeatable" badge next to affected
entries, so a bad classification stays visible rather than just
technically-not-deleted. That was the explicit condition on shipping this at
all: the same shape of mistake hid Zilyana and K'ril for the project's whole
life, and hiding a flag's own effect would be the identical bug one layer up.

### Coverage, split by repeatable — the 55 was inflated

| | total | documents | verified | needs_review | manual_override |
|---|---|---|---|---|---|
| **all include:true** | 102 | 98 (96.1%) | 55 (53.9%) | 41 | 2 |
| **repeatable: true** | 72 | 70 (97.2%) | 31 (43.1%) | 37 | 2 |
| **repeatable: false** | 30 | 28 (93.3%) | 24 (80.0%) | 4 | 0 |

**24 of the 55 `verified` sources (43.6%) are one-time quest encounters** —
almost entirely tier E's trivial `always`-only documents, which is exactly
why they clear every deterministic check so easily. The number that actually
answers "how much of what people would simulate is verified" is **31/72 =
43.1%** (44.3% of the 70 repeatable documents), noticeably lower than the
headline 53.9%. Neither number is wrong — they answer different questions —
but the headline without this split hides which one a reader is getting.

### Why this is the same shape as the tier-gate finding, and what's different

Both are "a threshold silently decided what existed in / was visible from the
corpus, without the threshold itself being about correctness or value." The
tier gate hid REAL, buildable content (Zilyana, K'ril, all of tier E) behind
an attempt-gate nobody meant as a permanence decision. `repeatable` is the
mirror case: nothing was HIDDEN — every one of these 29 sources parsed,
validated, and shipped a real, checked document — the problem was that
`verified`/the search index made no distinction between "the pipeline is
confident about this" and "this is worth a user's attention," and a strict
count conflated them. The fix is also the mirror image: the tier gate was
removed as a gate and kept as an ordering hint; `repeatable` was added as a
new, first-class, NON-gating field precisely so the same failure mode
(quietly excluding real data from an unqualified count) can't recur here —
the flag is visible everywhere the data is, correctable in one small file,
and never removes a document.

## The corpus-reproducibility guard, and Monumental chest's real fix

### `monumental-chest` was the only one — confirmed, not assumed

Built `apps/ingest/test/corpus-reproducibility.test.ts`: re-runs `parseBoss`
for real, with the real committed inputs (item index, allowlist, watchlist,
cached GE prices, shared tables, templates), against every file in
`data/bosses/`, and deep-compares the fresh output to the committed one.
Writes to a scratch directory (`parseBoss` gained an `outputDir` option,
defaulting to the real `data/bosses/`) — this check must never be the thing
that silently rewrites committed data; a human re-runs `ingest parse` and
reviews the diff, same as always.

**Run before touching the parser: `monumental-chest` was the only mismatch in
all 98 committed documents.** Everything else — including the four other
sources sharing the `preroll` mode class this bug lives in (`abyssal-sire`,
`alchemical-hydra`, `branda-the-fire-queen`, `brutus`, and 17 more that
mention "pre-roll" somewhere in their wikitext) — reproduces exactly. "Doesn't
reproduce" is a class, per the request that prompted this, but it turned out
to have exactly one member.

**This is now a permanent regression guard, not a one-off diagnostic.** It
runs in `pnpm -r test` going forward (~22s of the suite's total — the cost of
re-running every check on ~100 sources for real, not a flake; parallelised
with `Promise.all`, which didn't meaningfully cut the wall time since the
work is CPU-bound, not I/O-bound). It is the check landmine #1 ("`data/
bosses/*.json` is not automatically kept in sync") always needed and never
had: every previous defence against that landmine was a human habit ("always
re-run `ingest parse` before trusting `data/bosses/`"), which is exactly the
kind of thing that stops working the moment nobody remembers — which is
precisely what let `monumental-chest` sit stale, invisible to every other
check, until the tier-gate fix made a full parse attempt tier D for the first
time in a long while.

### Root cause: not the transclusion mode switch — the heading widening

The hypothesis going in was landmine #11d (transcluded blocks switched from
`preroll` to `independent`). **Checked directly and it is not that.**
Monumental chest's `===Pre-roll===` section has no transclusion in it at all
— every row is an inline `{{DropsLineReward|...}}` call. The real cause,
confirmed by diffing the STALE committed document's table shapes
(`weighted`/29 entries + `preroll`/5 entries, no `always` anywhere) against
what the current parser structurally sees (`Pre-roll`: 18 lines, `Common
rewards`: 29, `Tertiary rewards`: 5): the stale document never contained the
`Pre-roll` section's rows AT ALL. Its page uses `==Loot table==` as the
top-level heading, which `DROPS_SECTION_TITLE` could not match before the
`DROPS_SECTION_TITLE` widening (needed "drops"/"rewards"; "table" was only
added as a `LOOSE_DROPS_SECTION_TITLE` terminal keyword in that later
session — see "DROPS_SECTION_TITLE widening, and what it actually recovers",
above). Pre-widening, only `Common rewards`/`Tertiary rewards` (containing
"rewards") were independently reachable; `Pre-roll` (no drops/rewards
keyword, nested under a non-matching parent) was invisible. The user's
instinct was right in shape — a fix that landed while ToB sat outside every
documented parse invocation (tier D, `--tier A,B,C`) is what exposed a
pre-existing gap nobody had hit yet — just a different specific fix than the
transclusion one.

The gap itself: `buildTableGroups`'s `PREROLL_HEADINGS` branch
(`apps/ingest/src/parse/build-tables.ts`) built every row under a
`Pre-roll`-matching heading into one `preroll`-mode table without checking
rate kind, unlike the `allAlways`/`INDEPENDENT_HEADINGS` branches next to it.
Monumental chest's `Pre-roll` section interleaves two `rarity=Always`
consolation rows (Cabbage, Message — "only obtained if a player ends the raid
with 0 individual contribution points") with the real unique-selection rows,
so once the section was finally reachable, `BossSchema` correctly rejected it
(`'preroll' entries must use fixed or formula rates, got 'always'`).

### The fix: two general rules, not a special case — and why the obvious one was wrong

The tempting fix was the one already used for the identical-looking Vardorvis/
Leviathan/Whisperer/Duke Sucellus case (landmine #4): widen
`ALLOWED_ENTRY_RATES` to let the mode accept `always` inline, the way
`independent` already does. **This is unsafe for `preroll` specifically, and
was checked, not assumed.** `independent` entries are evaluated separately —
an inline `always` is inert, always contributes, no ordering concern.
`preroll` is "checked IN ORDER, first hit short-circuits the whole chain" —
an `always` entry anywhere in that order would deterministically win on
every single kill, making everything checked after it (including the real
unique pool) permanently unreachable. Verified this is not hypothetical:
Cabbage/Message sort before the unique rows in document order, so a naive
"just widen the allowed kinds" fix would have shipped a document where the
Theatre of Blood uniques have a silent 0% simulated chance.

Two general rules instead, both in the `PREROLL_HEADINGS` branch of
`buildTableGroups`, neither boss-specific:

1. **Split `always`-kind rows out into their own `always`-mode table**,
   evaluated unconditionally rather than as a competing step in the ordered
   chain. Safe by construction — an `always` table never suppresses or
   short-circuits anything.
2. **What remains is not necessarily a real preroll.** A genuine one (Brutus:
   5/150, 4/150, 1/150) does NOT sum to its shared denominator — the
   shortfall (140/150) IS the "chance nothing hits, keep going" that makes
   ordered-first-hit-wins the correct semantic. Monumental chest's unique
   rows (8+2+2+2+2+2+1 = 19) sum EXACTLY to their shared denominator — a
   normalised weighted split the wiki happens to label by WHEN it resolves
   ("pre-roll" in the raid's timeline) rather than by HOW it behaves.
   Treating that as `preroll` wouldn't just be schema-illegal, it would be
   numerically wrong: `preroll`'s sequential-Bernoulli semantics produce a
   materially different distribution than a `weighted` table's normalised
   split for the same stated fractions (checked by hand: Avernic defender
   hilt as a standalone Bernoulli(8/19) trial checked first is ~42.1%, its
   correct weighted share; a lower row checked only on an earlier miss is NOT
   its stated N/19 at all). So: rows that reconcile flush to one shared
   denominator become `weighted` (reusing the exact `toEntry`/`denominator`
   convention the heuristic-1 merge path already uses — zero new `Rate`
   construction code); rows that don't stay `preroll`, unchanged from before.

Locked in with two new unit tests in `apps/ingest/test/build-tables.test.ts`
(the always-split, and the reconciles-flush-to-weighted reclassification)
plus the existing Brutus-shaped test (5/150, 4/150, 1/150, still correctly
`preroll`) as the negative case proving the new logic doesn't overfire.

### What this does NOT fix, left as a known limitation

Monumental chest's `===Pre-roll===` has `====Normal mode====`/`====Hard
mode====` H4 sub-headings carrying `{{DropsTableHead|dropversion=...}}` —
the SAME field `rdt-access.ts` already reads as a `variant` condition for RDT
access lines, but regular `{{DropsLineReward}}` rows have no equivalent path
today. Per the Phase 1 "heading nesting collapses to the section's shallowest
level" rule, Normal/Hard mode's rows flatten into ONE 14-row group with no
variant tag, so the resulting `weighted` table blends both modes' shares
(Avernic defender hilt appears twice, at weight 8 and weight 7, rather than
as two separate `variant`-conditioned tables). This is a real, separate,
well-scoped gap — teaching `{{DropsTableHead|dropversion=}}` to propagate a
`variant` condition onto its rows, the same way RDT access already does — not
built here, since it wasn't what broke and Monumental chest is permanently
`needs_review` regardless (watchlisted `point_scaled`, per below).

### Result

`monumental-chest` parses again: `needs_review` (correctly — still
watchlisted for the point-scaled unique-chance mechanic, unrelated to this
fix), every structural check green (`weights_sum`, `refs_resolve`,
`rates_valid`, `qty_sane`, `items_known`, `drops_covered` all `true`; only
the permanently-advisory `ev_matches` and the permanently-watchlisted
`not_on_watchlist` fail, both expected). `data/item-icons.json` regenerated
(8 newly-reachable ToB uniques — Avernic defender hilt, Ghrazi rapier, the
Justiciar pieces, Scythe of vitur, the Message item — now resolved) and
`data/index.json` regenerated to match. Full suite green: `corpus-
reproducibility.test.ts` now passes with zero mismatches, `build-tables.test.
ts` 31/31, full `pnpm -r test` (176 loot-model + 459 ingest + 75 web),
Brutus gate included.

## Phase 7: Theatre of Blood shipped, and the two UNKNOWNs were a missing module

`data/overrides/monumental-chest.json`, 22 wiki-figure tests in
`apps/ingest/test/monumental-chest.test.ts`. Same shape of miss as ToA's
interpolation gap and CoX's common-quantity divisors: `docs/bosses/
monumental-chest.md` recorded the death-penalty magnitude and the common-table
quantity scaling as UNKNOWN, twice, without checking for a calculator page.
**`Module:Theatre of Blood calculator`** (behind `Calculator:Theatre of Blood
loot`, fetched fresh this session, not previously in `data/snapshots/`) states
both outright. Full reasoning is in the doc's corrected banner; this entry
records the judgement calls the doc doesn't cover.

**`tobPoints` is a derived `SimContext` field, not an input**, exactly
`totalDamage`'s shape: `withDerivedContext` computes it from two inputs (the
existing `deaths` and the new `roomsSkipped`, capped at 6 — ToB has exactly 6
rooms) as `max(0, (6-skip)*3 + 14 - deaths*4)`, out of a solo maximum of 32.
The `+14` is the module's whole "MVP bonus pool" (`imvp` for a team, always the
full 14 for a solo player, since nobody else exists to share it with) — this
is what makes the module's team-shaped formula collapse cleanly onto a
single-player context, the same collapse CoX's own points formula already
needed for team play.

**Two new formula ids, not one, even though `PROJECT_PLAN.md` 4.6 only names
`tob_points`.** `tob_points` (probability, the unique preroll) and
`tob_common_qty` (multiplier, the common table's quantity scaling) both read
`ctx.tobPoints`, but a single id cannot fulfil two contracts — the same
reasoning that split Zalcano's three ids, applied here for the first time to a
raid chest's own pre-declared name. `schema.ts`'s comment on the new id states
the justification inline rather than leaving it implicit.

**`tob_points` takes `params.urate` explicitly rather than reading
`ctx.variant`.** Hard Mode and "Hard Mode with the time bonus" share an
identical unique rate (7.7) and item-weight table — only the common table's
quantity multiplier differs between them (1.15 vs a flat 1.30, not 1.15
squared, per the module — the prose's own compounding reading was checked and
rejected). Rather than have the formula re-derive "is this some kind of hard
mode" from two different variant spellings, the override's `tob:unique-preroll`
table supplies the rate per entry, duplicating the 7-item pool across a
`hard` and a `hard-fast` entry. `tob_common_qty`, which genuinely needs to
branch three ways (including a flat, non-ratio-scaled Entry Mode case), reads
`ctx.variant` directly instead — there is exactly one `tob:common` table, not
one per variant, so params can't carry the distinction the way they do for the
duplicated preroll entries.

**`hard-fast` is a new value of the existing `variant` field, not a new
`SimContext` field.** `variant` was already an unconstrained string, so this
cost nothing and stays inside the corpus's existing single-string-field
pattern for raid modes. The alternative — a boolean `timeBonusAchieved` field
— was rejected because it would have needed threading through exactly the
same places `variant` already reaches (UI, URL state, override conditions)
for a distinction the wiki treats as a mode, not an on/off toggle.

**The zero-points edge case (8+ deaths, or 4+ deaths with all 6 rooms
skipped) needed a real table, not just a formula returning 0.**
`compile.ts`'s `qtyMultiplier` is resolved once per table, unconditionally,
regardless of which entries survive condition filtering — so a `tob_common_qty`
that returned exactly 0 at `tobPoints = 0` would throw via `evaluateMultiplier`'s
positive-only contract even though `tob:common`'s own entries are all gated out
in that state and the value is never applied to anything. Fixed two ways,
not one: `tob_common_qty` floors its ratio at `1/32` (a placeholder that never
reaches a real quantity, since nothing survives to multiply), and a new
`tob:zero-points-consolation` table (gated `tobPoints` at exactly 0) supplies
the Cabbage/Message pair the page's own citation names ("Only obtained if a
player ends the raid with 0 individual contribution points") — a real, cited
mechanic the naive generated document gets wrong today (it awards Cabbage and
Message on every single kill, unconditionally, since the parser attaches no
condition to those rows at all).

**Vial of blood: the module's 50, not the page's stated 45.** Checked, not
assumed — the page was re-fetched fresh mid-session (revid climbed
15293917 -> 15299363 on an unrelated capitalization fix, confirmed by diff)
and the value did not move, ruling out simple staleness. Every other
spot-checked item (Death rune, Runite ore, Grimy torstol, and two
collapsed-range cases, Yew seed and Rune battleaxe) matches the module's
`floor(min x mult x ratio)` formula exactly at full points, which is what
makes Vial of blood's 45 read as the one outlier rather than the module being
wrong. Recorded in the override's own `note` and pinned by a dedicated test
so a future session doesn't have to re-derive this.

**Entry Mode's common-table `tobPoints >= 1` gate is a defensive
extrapolation, applied uniformly rather than carved out.** The calculator has
no Entry Mode option at all, so nothing confirms whether Entry's stated flat
`-80%` composes with a zero-points state the way Normal/Hard's ratio-scaling
does. Gating Entry's common-table entries on `tobPoints` the same as every
other variant (rather than writing a variant-specific exemption, which
`Condition`'s AND-only semantics can't express without duplicating all 29
entries a second time) means an extreme-deaths Entry Mode run also falls back
to Cabbage/Message — unconfirmed either way for Entry specifically, but a
smaller and more defensible guess than letting the table roll near-zero
quantities at the same edge case Normal/Hard hit.

**`not_on_watchlist` was deliberately left failing.** Every capability gap the
research doc ever named is now resolved and the mechanic is modelled end to
end, closer to Doom of Mokhaiotl/Lunar Chest's shape (which did reach
`manual_override`) than to ToA/Zalcano's (which stay `needs_review` on a named
residual gap). Whether ToB's residuals — team allocation, the unquantified
tertiary "individual performance" scaling, Entry Mode's unconfirmed
composition — are the same *kind* of acceptable residual Doom/Lunar shipped
with, or closer to ToA's, is a real judgement call this session declined to
make unilaterally, since flipping a status from `needs_review` to
`manual_override` is a claim about completeness the next reader will trust.
Flagged for the user rather than decided.

**The `{{DropsTableHead|dropversion=}}` Normal/Hard blend gap (the
corpus-reproducibility session's own "What this does NOT fix") is untouched.**
The override authors `tob:unique-preroll` from scratch, so it does not depend
on the generated table's shape and did not need the parser fix to ship. Left
as a separate, still-open piece of work — fixing it would let a future
`ingest parse` reproduce this table generically, but nothing in this override
requires it.

## Phase 7: Chambers of Xeric shipped, after a stale snapshot and two structural corrections

`data/overrides/ancient-chest.json`, 24 wiki-figure tests in
`apps/ingest/test/ancient-chest.test.ts`. This source has now produced two
structurally-clean, badly-wrong documents in its history — the pre-override
generated document rolls its unique and common tables on every kill
unconditionally (a ~100%-unique-rate document, found when the
`DROPS_SECTION_TITLE` widening first reached it), and this session's own first
attempt at an override (following `docs/bosses/ancient-chest.md`'s existing
"Proposed mapping" verbatim) would have been a THIRD. Recorded here because
the mistake was caught by cross-checking the fresh page against
`Module:Chambers of Xeric calculator` line by line, not by any structural
check — both `weights_sum` and `drops_covered` would have passed the wrong
version too.

**The committed snapshot was stale, and this was found before it could cause a
fourth bad document.** `data/snapshots/wikitext/ancient-chest.json` and its
`dropsline` counterpart still carried the pre-2026-08-12-patch unique weights
(20/69) despite `docs/bosses/ancient-chest.md` itself citing the post-patch
14/60, dated the same day as the patch. Both numbers were checked against a
fresh fetch before writing a single line of the override: the fresh page's
revid (15295333) matched what the doc already cited, meaning the doc's
research was correct and only the snapshot on disk had silently never been
updated to match it — a "fresh fetch was described but never persisted"
gap, not a parser bug (CLAUDE.md's rule is about not re-fetching to fix
parsing; this is a source with real available data landing wrong).

**Mistake 1: the common table is 33 slots (denominator 33), not the doc's
proposed flat 43-item/denominator-99 table.** The page's own rows are
`rarity=1/33` each, uniform. `Module:Chambers of Xeric calculator`'s
`trashItems` table — the ONLY source for the per-item divisors, since the
page states none — happens to represent each of the 10 herbs as two virtual
rows (weight 2 herb, weight 1 seed) for its own EV-display convenience, which
this session's first pass mistook for the real table shape. The two are
mathematically equivalent in AGGREGATE (every real 33-weight slot totals
exactly 3 module-weight-units, so `23×3 + 10×3 = 99` and `99/33 = 3`
uniformly) but NOT equivalent structurally: `Table.withoutReplacement`
excludes by row index, so a flat 43-row table would let a herb and its own
seed both drop in one raid — impossible under "the two rolls cannot end on
the same drop." Fixed by nesting each herb slot as `oneOf(herb weight 2, seed
weight 1)` inside one weighted `Entry`, confirmed against
`simulate.ts`'s `runWeightedWithoutReplacement` (`removed[i]` is tracked by
the OUTER entry index, so a slot consumed by roll 1 — regardless of which of
its nested items it resolved to — is unconditionally excluded from roll 2).
Verified structurally with a dedicated test (30,000-kill sample, zero
co-occurrences of any of three spot-checked herb/seed pairs) rather than
trusted from the reasoning alone.

**Mistake 2: item quantities are `QtySpec.formula`, not literal ranges.** The
page's own `quantity=1-138`-shaped rows read as a real RNG span, matching
Theatre of Blood's own common table exactly — and would have been modelled
that way had the module not also stated `quantity =
math.floor(personalPoints / divisor)`, a fully deterministic function of
points with NO randomness at all. Resolved by checking, not assuming: the
UPPER BOUND of every one of 29 spot-checked items' published range equals
`floor(131071 / divisor)` — exactly for 26, off by 1 for three (Grimy
avantoe/kwuarm/lantadyme, a display-rounding gap too small to matter) — which
is what confirmed the range is the formula's own output SPAN across
realistic points totals, not a per-roll random draw. `131071` itself is the
page's own cited "common-loot scaling caps at 131,071 points" — a cap the
module's `trashItems` loop does not enforce at all, the same asymmetry as
ToA's elite-clue cap (`docs/DECISIONS.md`'s ToA entry): the cited primary
source wins over the calculator's own simplified arithmetic. Torn prayer
scroll and Dark relic are the module's own hardcoded exception (quantity
always exactly 1) and are expressed as `QtySpec.exact(1)` directly rather
than via a divisor large enough to floor to zero.

**The unique roll is `cox_points`, dispatched by `params.kind` across three
positions, one probability contract.** Unlike ToB (which needed two ids
because it crosses a probability/multiplier contract boundary), CoX's three
uses — per-roll chance (`{kind:'roll', rollIndex}`), the elite-clue marginal,
the Olmlet marginal — are all `[0,1]` probabilities, so one id parameterized
by `params.kind` covers all three, matching `toa_bad_luck_mitigation`'s
one-contract/many-params precedent rather than Zalcano/ToB's
one-id-per-contract split. `cox_common_qty` is a second, genuinely necessary
id (a quantity contract, `evaluateQuantity`) — that split IS justified the
Zalcano/ToB way.

**Up to 6 independent rolls means P(any unique) and the expected unique
COUNT are different quantities, and this session's own test suite got it
wrong on the first pass.** Each roll is an independent Bernoulli funded by a
fixed 570,000-point chunk of the raid's total, evaluated regardless of
whether earlier rolls hit — so summing `expectedValue`'s per-item
`expectedDrops` across the 12 uniques gives the expected NUMBER of uniques
(which legitimately exceeds 1 above 570,000 points — "up to six unique
rewards can be obtained per raid"), not the probability of getting at least
one. A first draft of `ancient-chest.test.ts` asserted `uniqueChance <= 1` at
high points and failed against its own correct implementation; fixed by
adding a separate `anyUniqueProbability` helper (`1 - Π(1-P(roll_n))`,
computed the same way `cox_points`'s own `eliteClueMarginal`/`olmletMarginal`
do internally) for the "at least one" claims, keeping the summed-count
measure only where it is the right quantity. Worth internalising: the two
measures coincide exactly below 570,000 points (only one roll is ever
nonzero there), which is why the elite-clue test at the page's own
26,025-point example passed on the first try and masked the bug until a
higher-points test exposed it.

**Ancient tablet's "replaces one of the loot rolls" is NOT modelled
precisely — flagged, not built around.** No run-scoped mechanism exists for
one table's hit to reduce another table's roll count (the same shape of gap
Fortis Colosseum's wave-scoped armour dedup is watchlisted for). Modelled as
an ADDITIONAL independent 1/10 roll instead, gated by ownership so it can
only ever fire once per account — a small, one-time, precisely-scoped
overstatement of total loot for an account that hasn't received it yet, not
a guess. Dark journal is the same ownership-gate shape and fixes a real bug:
the currently-generated document has no gate on it at all and awards it on
every single kill.

**`not_on_watchlist` was left failing, the same judgement call as ToB's own
entry, for the same reason: flipping status is a completeness claim this
session declined to make unilaterally.** Team/party point allocation,
Ancient tablet's imprecise modelling, and Metamorphic dust's unstated
time-completion threshold are the residuals — whether they are Doom/Lunar-
shaped (ship it) or ToA-shaped (keep watchlisted) is for the user to decide.

## Phase 7: Fortis Colosseum shipped, with the approximation quantified before shipping rather than assumed small

`data/overrides/rewards-chest-fortis-colosseum.json` — no generated document
existed at all (tier D, never parsed before), so this is `source: 'override'`
like Reward Pool, not `'merged'`. 14 wiki-figure tests in
`apps/ingest/test/rewards-chest-fortis-colosseum.test.ts`.

**Every wave is its own complete, self-contained weighted table, not additive
layers.** Confirmed rather than assumed: each of the 12 waves' rows sum
exactly to that wave's own denominator (7, 70, 43400, 19250, 16800, 45920,
114240, 21600, 16000, 2080, 4800), checked programmatically before writing
the override, not eyeballed. `ctx.wavesReached` selects exactly one via
`levelAtLeast(n = atMost = W)` — no wave engine, no new capability, matching
what the doc's own 2026-08-13 banner already established and what a second,
stale "Proposed mapping" section (fixed the same session as this build,
see the doc's own history) had failed to catch up to.

**Token (Varlamore) (wave 3 only, `rarity=Varies`) is excluded, not
guessed.** No fixed rate is stated anywhere on the page; the row sits beside
a already-reconciling weighted-70 pool (confirmed: the other 14 rows already
sum to exactly 70 without it), so it is a separate, unquantified mechanic
layered on top rather than a missing weight. `drops_covered` correctly still
fails on exactly this one row.

**A slug/itemKey bug, caught before it shipped: apostrophes must become a
hyphen, not be deleted.** A hand-written Python `slugify` for this override's
generator script stripped `'` entirely (`Dizana's quiver` -> `dizanas-quiver`),
diverging from `apps/ingest/src/snapshots/store.ts`'s real `slugify` (any run
of non-alphanumeric characters -> ONE hyphen, so apostrophe-plus-space
collapses to a single `-`, giving `dizana-s-quiver` — the same pattern
already visible in this corpus as `dinh-s-bulwark`, `osmumten-s-fang`).
Caught immediately by `items_known` failing on the first parse attempt, not
by inspection — worth naming because the two previous overrides this session
(ToB, CoX) never hit this, since both copied their itemKeys directly from an
already-generated document rather than re-deriving them from scratch, which
is what a tier-D, never-parsed source with no generated base forces.

### The with-replacement approximation, quantified before shipping

The task that requested this build was explicit: quantify the cost of
skipping the armour-piece duplicate-avoidance before shipping it, not after,
and don't assume it's small — CoX's own conditioned-marginal gap this same
session turned out to be exactly computable, and a different session's Corp
`drawsPerHit` investigation once found two readings with identical means and
a 10x different distribution. Computed, not assumed:

- **E[a specific armour piece] is IDENTICAL under both models, by symmetry**
  — the mean the simulator's headline numbers report is exactly correct
  either way. This is the reassuring half of the result and is worth stating
  plainly: the approximation does not distort the number most users will
  actually look at.
- **The divergence is entirely in joint/same-run statistics**: across a full
  12-wave clear (mean armour-hit count ≈0.125, from summing the wiki's own
  per-wave rates), P(≥1 duplicate piece this run) is ≈0.20% under
  with-replacement vs ≈0.00025% under true dedup (an ≈800x relative
  overstatement of that specific joint event, both absolute-tiny), and P(all
  3 pieces in one clear) is understated ≈4.4x (0.0035% vs 0.0157%).
- **Practical read**: a user simulating a large batch and reading the
  capped 1,000-kill log closely enough to notice two identical armour pieces
  in one logged clear would be seeing something the real game (if the
  protection is truly run-scoped) would essentially never produce — the same
  *class* of residual as CoX's elite-clue/Olmlet co-occurrence artifact,
  smaller in frequency here (CoX's is ~4.6% across a 1,000-kill log; this is
  two orders of magnitude rarer per clear).

### The duplicate-protection's SCOPE could not be confirmed this session — flagged, not guessed either way

The earlier research pass that first investigated this source asserted the
protection is *run-scoped* ("resets each attempt"), which is what made an
approximation necessary at all (an `ownershipGate` read against
`ctx.ownedCounts` is lifetime-scoped by construction, per `schema.ts`'s own
comment on that field, and cannot express "resets each attempt"). This
session tried to re-confirm that claim before building against it and could
not: the page's own citation ("Players are guaranteed to receive a full set
prior to receiving duplicate Sunfire Fanatic pieces") does not say "this
run" or "resets" anywhere, checked directly. Three further checks — the
Sunfire fanatic armour page (WebFetch, explicitly asked whether it states
per-run vs account-wide: it does not), two web searches (one search result
summary contradicted its own heading, itself a sign of a low-confidence
secondary source, not the wiki), and an attempt to fetch Jagex's original
"Fortis Colosseum – First Look & Rewards" post directly (HTTP 403, blocked)
— all failed to settle it either way.

**Shipped anyway, per explicit instruction, with the uncertainty surfaced
rather than resolved by picking a side.** The override's `note` and this
entry both state plainly: if the protection turns out to be lifetime-scoped,
an EXACT model (`ownershipGate`, identical in shape to ToA's keris jewel
pool) is directly available and is a strictly better fix than refining the
approximation — this is not a case where more precision requires new engine
capability, only confirmation of a fact. Whoever revisits this should
resolve the scope question first, not assume the shipped shape is settled.

### Second pass at the scope question, specifically requested — still unresolved

Explicitly re-checked against update/news posts and the armour pieces'
individual pages, not just the three sources the first pass tried. Fetched
and searched for "duplicat"/"reset"/"attempt"/"account": the OSRS Wiki's own
mirror of Jagex's original "First Look & Rewards" post (`Update:Fortis
Colosseum - First Look & Rewards`, since the direct Jagex URL 403s — design
philosophy and stats only, zero relevant occurrences); two further Jagex
devblog mirrors from the same release cycle (`Update:Poll Blog: Fortis
Colosseum x Perilous Moons`, `Update:Varlamore: Part One - Reward Changes` —
same, zero occurrences); the individual `Sunfire fanatic helm` page (drop
rates and stats only); both the Rewards Chest and Fortis Colosseum pages'
complete patch-history `==Changes==` sections back to 2024 launch (no entry
ever touches this mechanic); `Fortis Colosseum/Strategies`.

**One data point worth recording precisely because it is weak, not because
it settles anything**: the SAME `==Changes==` changelog that never mentions
the armour protection's scope DOES explicitly call out per-wave-vs-per-run
scope for other Colosseum mechanics when it is true ("Doom stacks are now
removed at the end of a wave, rather than being permanent for a run", 10
April 2024) — this wiki's own patch-note style does not shy away from
stating that distinction when it applies. Its total absence here is mild
evidence against the armour protection being run-scoped, not proof either
way, and not strong enough to build against.

**Stopped per explicit instruction: kept the with-replacement approximation,
did not spend further sessions on this.** Both the override's `note` and
`docs/bosses/rewards-chest-fortis-colosseum.md`'s banner now list every
source checked across both passes, so a future session does not have to
repeat any of them — it should look for an authoritative in-game or
community-verified source instead (a datapoint no OSRS Wiki page currently
states plainly appears to require primary observation, not another text
search).

## The dropversion= parser fix, and the wider gap it turned out to be part of

Two changes, not one, because the narrow fix alone would have shipped a
control nobody could reach — the exact "capability exists, nothing reaches
it" lesson `docs/HANDOFF.md` already recorded for `SimContext` fields,
recurring here for `Condition.variant`.

**1. `wikitext-drops.ts` now propagates `{{DropsTableHead|dropversion=X}}`
to regular drop rows.** `rdt-access.ts` already read this parameter for
`{{RareDropTable}}`/`{{GemDropTable}}` access lines; ordinary
`{{DropsLine}}`/`{{DropsLineReward}}` rows never had an equivalent path, so a
page whose variants sit under nested sub-headings inside one already-grouped
block (Monumental chest's `====Normal mode====`/`====Hard mode====` inside
`===Pre-roll===` — `splitIntoBlocks`' "nesting deeper than the section's
shallowest level collapses into its parent" rule, by design, for Barrows'
per-brother sub-groups) lost the distinction entirely. `scanBlockCalls` walks
a block's `DropsTableHead` and row-template calls together, in document
order (merging two independently-tested single-family extractions rather
than writing a third parallel depth-tracking scanner), and the row extractor
tracks "most recently seen dropversion value" the same way `rdt-access.ts`
already treats the same parameter — carried forward until the next
`{{DropsTableHead}}`, not reset by `{{DropsTableBottom}}`, since nothing in
the corpus needs a same-block gap and reasoning about one was not worth the
complexity.

**2. Tagging alone was not enough — `buildTableGroups`'s preroll
reconciliation had to become per-variant-aware too, or the tag would make
things WORSE.** The existing "rows reconcile flush to one shared denominator
-> `weighted`, not `preroll`" check (the corpus-reproducibility session's own
fix) looks at ALL fixed-rate rows in a block AT ONCE. Monumental chest's
Normal Mode subset reconciles to 19, Hard Mode's to 18 — two DIFFERENT
denominators, so the whole-block check's `fixedDenominators.size === 1` test
was never going to pass either way. Without a second fix, tagging entries
with a `variant` condition alone would have left the table `mode: 'preroll'`
with 14 conditionally-filtered entries — and at compile time,
condition-filtering strips whichever variant doesn't match `ctx.variant`
BEFORE the table ever runs, collapsing it to a 7-entry chain with genuine
first-hit-wins Bernoulli semantics. That is exactly the wrong distribution
the ORIGINAL corpus-reproducibility fix existed to prevent for the
single-mode case, reintroduced per-variant if only the tagging shipped.
`tryReconcilePerVariant` is the general form of the existing check: groups
fixed rows by `line.variant`, requires EVERY row to carry one (a mix of
tagged and untagged is not a confirmed split — falls through to the
whole-block behaviour rather than guessing), requires at least two distinct
variants, and requires EVERY variant's own subset to reconcile exactly
before applying the split at all. One variant failing to reconcile abandons
the whole attempt, matching `tryHomogenizeDenominators`'s own "never a
guess" discipline. Verified directly, not just by test: the generated
(non-override) Monumental chest document — checked by temporarily moving its
override aside and re-parsing — now emits `pre-roll-normal-mode`
(denominator 19) and `pre-roll-hard-mode` (denominator 18) as two separate
`weighted` tables, each entry correctly `variant`-conditioned.

**3. `Boss.variants` was hardcoded to `['normal']` for every GENERATED
document, which turned out to be a real, pre-existing, broader bug the
narrow fix would have walked straight into.** Confirmed before assuming it:
`black-demon.json`, `vorkath.json`, `amoxliatl.json` already carried real
`variant` conditions (`"Regular"`/`"Wilderness Slayer Cave"`, `"Post-quest"`
twice) from mechanisms that predate this session, and every one of them
still had `variants: ['normal']` — meaning the UI's variant dropdown
(`SimContextControls.tsx`, populated from `boss.variants`) never offered
anything but "normal" for any of them, so their conditioned entries were
reachable in the schema but not from the app. Fixed generally in
`assemble-boss.ts`: `variants` is now the set of every `variant`-kind
condition name actually used (from both regular entries' `extraConditions`
and RDT-access lines), in first-encountered document order, falling back to
`['normal']` only when none exist. A second, necessary half: `variants` for
a source like Vorkath never includes the literal string `'normal'` at all
(`"Post-quest"` is the only value), and `DEFAULT_SIM_CONTEXT.variant` is
always `'normal'` — so without also fixing `contextDefaults`, the DEFAULT
simulation for such a source would filter out every variant-gated entry and
show an empty table until a user manually picked a variant from the
dropdown. `contextDefaults.variant` is now set to the first-seen variant
value whenever `'normal'` is not among the ones actually used.

**Caught one test regression from each fix, both fixed, neither a
compromise on the fix itself:**

- `apps/web/test/rarity.test.ts`'s `rarestFor` helper called
  `expectedValue(boss, DEFAULT_SIM_CONTEXT, ...)` directly, bypassing
  `resolveSimContext` and therefore `boss.contextDefaults` entirely. Vorkath's
  draconic/skeletal visage and dragonbone necklace are genuinely
  quest-gated (`dropversion=Post-quest`) and, once regular rows could carry
  that tag at all, correctly stopped appearing under the literal `'normal'`
  context the helper hardcoded — the SAME correctness improvement as the
  main fix, just surfaced through a test that had never needed
  `contextDefaults` before because nothing it exercised carried a
  meaningful one. Fixed by switching the helper to
  `resolveSimContext(boss)`, which is what every other "give me this boss's
  sensible default" call site in the project already does.
- `apps/ingest/test/marginal-rates.test.ts`'s pinned `DOES_NOT_COMPILE` list
  lost `'yama'`. Root cause fully traced, not just observed: yama's own
  `===Contract===` block mixes 18 `Always`-rate rows with one `Yami` pet row
  at `1/100`; `tryHomogenizeDenominators` treats an `Always` rate's `1/1` as
  a normal fixed rate and rescales it onto the lone fixed row's denominator
  (100), giving every `Always` row a weight of 100 and summing to
  `18*100 + 1 = 1801` against a stated denominator of 100 — a pre-existing
  bug with nothing to do with variants. Before this session yama hit
  `WeightsExceedDenominatorError` somewhere else first (a hard compile
  throw); this session's fix changed which block gets reached, not whether
  yama's document is correct — it remains broken, now reported by
  `weights_sum` instead of a thrown error. Out of scope to fix (tier D,
  already flagged as "the overflow is real data, not a classification
  artifact" before this session); the pinned list was updated to match
  reality with the reasoning recorded inline, per that test's own rule that
  a shrinking exclusion list must be explained, not just accepted.

**Corpus-wide effect, checked, not assumed:** full unscoped `ingest parse`
before and after landed on identical totals (55 verified, 42 needs_review,
2 manual_override, 3 parse_failed) — this reshapes documents that already
had a `variant` condition or a nested dropversion, it does not flip any
source's overall status. `corpus-reproducibility.test.ts` passed clean after
regenerating every committed document from the fresh parse.

## `apps/web` never actually consumed `Boss.contextDefaults` — the other half of the variant fix above

The entry above ("`Boss.variants` was hardcoded...") fixed the DATA side and
the loot-model callers (`resolveSimContext(boss)`) but missed the app's own
URL-state layer. `apps/web/src/lib/url-state.ts`'s `paramsFromSearch` built
`SimContext` straight off the package-wide `DEFAULT_SIM_CONTEXT`, never
`boss.contextDefaults` — so in the browser, a plain `/boss/vorkath` link (or
any link that doesn't explicitly set `?variant=`) still simulated with
`variant: 'normal'`, which matches none of Vorkath's `"Post-quest"`-gated
rows. Confirmed directly, not assumed: calling `simulate()` with
`DEFAULT_SIM_CONTEXT` against the real, committed `vorkath.json` returns
`result.drops.length === 0`, and the same check against every boss in
`data/bosses/` found 9 more with the identical shape (`the-mimic`,
`scurrius`, `obor`, `black-demon`, `bryophyta`, `amoxliatl`, `zalcano`,
`reward-chest-the-gauntlet`, `lunar-chest`) — 27 boss documents in total set
some `contextDefaults`, all silently ignored by the app. This is what was
actually behind five `apps/web` e2e failures in CI (`layout.spec.ts`'s
1,000,000-kill Mimic table, three `results.spec.ts` cases, and
`shareable-result.spec.ts`'s price-race test) that looked unrelated to each
other and to variants — every one of them happened to run against Vorkath or
the Mimic and asserted on the resulting drop grid, which was empty.

**Fix, general rather than per-boss:** `paramsFromSearch`/`searchFromParams`
now take an optional `contextDefaults: PartialSimContext` and resolve against
`{...DEFAULT_SIM_CONTEXT, ...contextDefaults}` instead of the raw package
default, for every field — not just `variant` (also `points`, `raidLevel`,
`delveLevel`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`, `isMVP`,
`members`), matching `resolveSimContext`'s own layering.
`BossView.tsx` cannot pass `boss.contextDefaults` into the mount-time parse
(the boss hasn't loaded yet), so it resolves an `effectiveCtx` via
`useMemo(() => paramsFromSearch(searchParams, bossQuery.data?.contextDefaults).ctx, ...)`
and uses that — not `params.ctx` — for both `expectedValue` and the worker
dispatch. This runs synchronously at render time rather than via a
corrective effect deliberately: an effect's fix lands a render late, and on
the render where `bossQuery.data` first arrives the auto-run effect (shared
`?run=1` links) would already have fired and latched onto the stale,
unresolved ctx before any corrective effect ran. `searchParams` has no such
lag — it's already correct on the first render the boss exists, because
`updateParams`/`handleSimulate` always write `params` and `searchParams`
together from the same object. A separate one-shot effect (guarded by a ref,
so it fires exactly once) still re-parses `params` itself once the boss
loads, purely so the on-screen controls (delve level, variant dropdown, ...)
display the value actually used rather than the pre-boss-load default —
`effectiveCtx` alone already makes the simulation correct without it.

Verified against the real corpus and the full e2e suite, not just the one
failing assertion: re-ran `simulate()`/`expectedValue()` for all 99 bosses
under their now-correctly-resolved defaults (the 10 previously-empty ones
all produce drops; the remaining `WeightsExceedDenominatorError` throws on
~7 sources are pre-existing corpus issues unrelated to this fix, not
introduced by it). `apps/web`'s full 49-test e2e suite and 75-test unit
suite pass clean.

## The needs_review recount — GWDRDT was undercounted, and a new cause class exists

`docs/HANDOFF.md` section 3's per-cause table was self-flagged stale (it predates
ToB/CoX/Fortis Colosseum shipping) and asked to be re-run rather than trusted.
Recounted against the live `data/bosses/*.json` corpus (42 `needs_review`, 2
`manual_override`, unchanged totals) by cross-referencing each source's
`validation.checks` failures and table `notes`/`ambiguous` text, not by
re-guessing from memory. Two real corrections came out of it:

- **GWDRDT was undercounted: 4 sources, not 2.** `kree-arra` and
  `general-graardor` were the only two ever named (landmine #3). `drops_covered`
  detail strings show `commander-zilyana` and `k-ril-tsutsaroth` missing the
  *identical* item set (Dragon med helm, Dragon spear, Dragonstone, Loop half of
  key, Chaos talisman, Adamant javelin, Law/Death rune) — the same
  `{{GWDRDT}}`-not-`rare_drop_table.json` hole, just never counted because
  nobody had diffed their `drops_covered` reasons against the other two.
- **A new, previously undocumented cause class: `weights_sum` genuinely
  fails on 6 sources** (`chaos-fanatic`, `grotesque-guardians`, `mad-angel`,
  `maggot-king`, `phosani-s-nightmare`, `yama`), plus the two GWDRDT sources
  above double up on it (`commander-zilyana`, `k-ril-tsutsaroth`) — 8 sources
  total where a `weighted` table's own declared weights sum to MORE than its
  denominator, not less (shortfall is legitimate implicit `nothing`; overflow
  is not, per `weights-sum.ts`'s own documented rule). This is not the
  transcluded-mode approximation (that ships correct numbers with an unexpressed
  structure) — this ships genuinely wrong per-item odds for the affected table,
  and in at least 6-8 cases `compileTable` actually THROWS
  `WeightsExceedDenominatorError` rather than merely mis-computing (see the
  entry above this one — the ~7-source throw count noted there is this same
  set). Investigated below.

Full corrected breakdown (42 needs_review, reconciles exactly):

| cause | count | sources |
|---|---|---|
| Transcluded-mode question | 9 | abyssal-sire, araxxor, arrg, bryophyta, dagannoth-{prime,rex,supreme}, deranged-archaeologist, giant-sea-snake |
| "Uniques"/"Mutagens" heading question | 5 | phantom-muspah, sarachnis, shellbane-gryphon, the-nightmare, zulrah |
| Genuinely unknowable curves | 3 | duke-sucellus, zalcano, reward-pool |
| Blocked, deliberately | 1 | reward-cart |
| GWDRDT (was 2, corrected to 4) | 4 | kree-arra, general-graardor, commander-zilyana, k-ril-tsutsaroth |
| Other (Lua invoke / items_known) | 2 | black-knight-titan, salarin-the-twisted |
| Raids (shipped, watchlisted) | 4 | chest-tombs-of-amascut, monumental-chest, ancient-chest, rewards-chest-fortis-colosseum |
| Weight-overflow (new class, non-GWD) | 6 | chaos-fanatic, grotesque-guardians, mad-angel, maggot-king, phosani-s-nightmare, yama |
| Coverage gaps (`drops_covered`, unrelated to transclusion/GWD) | 6 | alchemical-hydra, black-demon, chaos-elemental, kalphite-queen, nex, obor |
| items_known only | 1 | chronozon |
| Vorkath's refused seed partition | 1 | vorkath — ratio 1.6665, correctly refused (see landmine #11d's own entry), its own bespoke residual |

Reconciles to 42: the table's own rows sum to 38 (9+5+3+1+4+2+6+6+1+1, no
double-counting — `commander-zilyana`/`k-ril-tsutsaroth` sit only in the
GWDRDT row, the weight-overflow row's "6" is already non-GWD-only), plus the
4 watchlisted raids (`chest-tombs-of-amascut`, `monumental-chest`,
`ancient-chest`, `rewards-chest-fortis-colosseum`) that the table
deliberately excludes as a different kind of `needs_review` (see the top of
`docs/HANDOFF.md` section 1) but that still count toward the 42 headline.

## Weight-overflow investigated: three distinct defects, not one, and it already reached `verified`

The entry above's original hypothesis — "the equal-denominators-mean-one-table
heuristic mis-firing on rows whose individual rarity denominator happens to be
100" — was tested against the real wikitext snapshots and does **not**
generalise. It explains the shape of one case (Yama) but not the mechanism, and
explains none of the other seven. Investigation only, nothing fixed.

**Three separate, confirmed defects, found by reading each overflowing
table's raw `data/snapshots/wikitext/` body rather than the compiled JSON:**

1. **`always`+`fixed` mixed headings fall through the all-or-nothing `allAlways`
   check into the default merge path, which never strips `always` rows before
   homogenising.** Confirmed exact root cause of Yama's dramatic 1801/100
   overflow (18x). Yama's `Contract` heading is 18 `rarity=Always` rows plus one
   `rarity=1/100` row (`Yami`). `buildTableGroups`'s `allAlways` branch requires
   *every* row to be `always`-kind, so this block fails it and falls through;
   it isn't `Tertiary`/`Pre-roll` either, so it lands in the final
   heterogeneous-denominator path, which computes `denominators` from `fixed`
   rows only (Yami's `/100`), homogenises everything onto 100, and calls
   `toEntry` on the 18 `always` rows too — `toEntry`'s weight formula
   (`rate.num * denominator / rate.den`) gives each of them `weight: 100`
   because an `always` `ParsedRate` carries `num: 1, den: 1`. The
   `PREROLL_HEADINGS` branch already splits `always` rows into their own
   `always` table before doing anything else (the Monumental chest fix, this
   file's "dropversion= parser fix" entry) — this is the same defect, just
   never closed in the *other* branch that reaches the homogenise/merge step.
   **Mechanical, narrowly scoped, no schema change**: hoist the same
   `alwaysRows` split up before the final heterogeneous-denominator block, not
   just inside `PREROLL_HEADINGS`.

2. **"These items are always dropped together" bundles are parsed as N
   independently-competing weighted rows instead of one bundled outcome.**
   Confirmed to the unit on Grotesque Guardians: its `Supplies` heading's
   Magic/Ranging/Super combat potion trio (`raritynotes` cites one shared
   `pots` footnote reading "These three potions are always dropped together")
   is one 6/142 outcome that grants all three, not three competing 6/142
   alternatives — parsed as the latter, it contributes 18 to the merged
   table's weight sum instead of 6, and 154 (measured) − 142 (denominator) =
   **12**, exactly the double-counted excess (2 × 6). Reproduced, less
   exactly but for the same reason, on Mad Angel: its `Supply batch` heading
   has no `raritynotes` citation at all, only PROSE above the table ("Either
   sharks or yellowfins drop, bundled with a prayer potion(2) and a super
   combat potion(1)") — a 16/150 access roll, half-split between two exclusive
   fish, that ALSO unconditionally grants both potions. Parsed as four
   independent 8/150–16/150 rows, it contributes ~48 to the pool instead of
   16, and the measured overflow (30) is within the range that excess
   predicts. **This is not a heuristic bug fixable by a parser tweak — the
   schema has no node for "these N items arrive together as one outcome."**
   `Node` is `item | tableRef | nothing | oneOf`; none of them expresses
   "always" as a bundle *within* a `weighted` entry. Needs either a schema
   extension or an override per source, not a `build-tables.ts` patch.

3. **A composite, multi-table aggregate rarity figure inserted as if it were
   this table's own share.** K'ril's `Other` heading's `Coins` row is
   `rarity=36.7/127` with `raritynotes`: "Coins come from rolls on all loot
   tables, including the unique table, GDT and RDT" — the wiki's own figure
   explicitly disclaims being scoped to just this table, and the parser
   includes the whole 36.7 anyway. K'ril's `Potions` heading also has two of
   defect #2's pairs (Super attack/strength, Super restore/Zamorak brew, each
   "always dropped together"). The measured overflow (6.7) doesn't cleanly
   decompose into either defect alone — both are present and compounding, and
   untangling the exact split needs more than a read of the wikitext.

**This already reached `verified`, silently, which is the more important
finding.** Grepping every `data/snapshots/wikitext/*.json` for co-drop
phrasing ("dropped together" / "dropped alongside" / "bundled with" / "always
accompan-") and cross-referencing against corpus status finds **13 sources**
carrying it, not 8: the same 8 from the recount above, plus `duke-sucellus`,
`kree-arra`, `nex`, `phantom-muspah` (all already `needs_review` for other
reasons), **and `the-leviathan`, `the-whisperer`, `vardorvis` — three of the
four Desert Treasure II "awakened" bosses, all currently `status: 'verified'`,
all passing `weights_sum` clean.** Their shared `Supplies` heading ("These
supplies are all dropped together") is the identical defect #2 shape (3 items,
each `1/5.5`, parsed as 3 competing alternatives instead of one bundle) — it
just never overflows, because the table's denominator (5.5) has enough slack
to absorb the double-counted excess (sum 3 vs denominator 5.5) without
tripping `weights_sum`'s overflow-only check. The check cannot see this shape
by construction (shortfall is legitimate, so a shortfall caused by the wrong
reason looks identical to a shortfall caused by the right one) — this is
exactly the "a table that merges wrongly but still reconciles is silently
wrong" case, now with three real instances, not a hypothetical.

**Not fixed.** Defect #1 is a scoped, mechanical parser fix. Defects #2/#3
are a real modelling gap (no way to express a co-drop bundle at all) that
touches three already-`verified` sources' correctness, not just the eight
`needs_review` ones counted above — reported for a decision on how deep to
take the fix (schema extension vs. per-source override) and whether
`the-leviathan`/`the-whisperer`/`vardorvis` should be downgraded off
`verified` until it lands, before any of it is touched.

## Transcluded sub-tables: modelled properly as a `oneOf` at the access rate

The mode question (this file's "The mode question on transcluded blocks" and
"Transcluded sub-tables are `independent`" entries) is closed. Section 3's
own two options were: accept the `independent` approximation and clear the
flag on a confirmed partition, or model it properly with a `oneOf` node at
the access rate. Took the second — exact beats an accepted approximation,
and CoX's own herb/seed slots (`data/overrides/ancient-chest.json`) already
prove the pattern works and is buildable, so this isn't new territory.

**What changed.** `build-tables.ts`'s heterogeneous-denominator fallback now
branches on `partition.verdict`, not just `partition !== null`:

- `verdict === 'partition'` (the identity confirmed the rows sum to the
  declared access rate): the group carries a new `oneOfAccess: {num, den}`
  field (the access rate's own numerator/denominator — `parseFraction` was
  widened to keep both instead of collapsing to one ratio, since the `oneOf`
  wrapper's `Rate.fixed` needs the exact pair) and `ambiguous` clears to
  `null`. `assembleBoss` reads `oneOfAccess` and, instead of mapping
  `group.entries` to N independently-rolled table entries, builds ONE entry:
  `{ rate: fixed(accessNum, accessDen), node: { kind: 'oneOf', entries: [...] } }`.
  Each inner `oneOf` entry keeps its item's own published rate as a `weight`
  (`num/den` directly — `oneOf` entries are schema-required to carry a
  `weight` rate, and since the partition identity already proved these rows
  sum to the access rate, the raw per-item probabilities ARE their correct
  relative share of the pool; no rescaling needed).
- `verdict === 'not-a-partition'` (Vorkath) or `'no-access-rate'`
  (`WildernessSlayerDropTable`-shaped blocks, abstained on, never reaching
  this far anyway since their heading is literally `Tertiary`) are
  unchanged: flat `independent` entries, still flagged. The identity didn't
  confirm a single-access-roll shape for either, so the `oneOf` treatment
  isn't licensed.

**A small, accepted precision trade-off, worth stating explicitly.** The
`oneOf`'s internal weights are each item's own published rate; their sum is
only ever *within `PARTITION_TOLERANCE`* (1%, measured spread under 0.3%) of
the declared access rate the outer entry uses, because the wiki rounds
denominators to one decimal place. So a `oneOf` item's true marginal
probability now shifts by that same sub-0.3% from its own individually-cited
rate, in exchange for the co-occurrence being genuinely impossible (exact,
matching the real single-access-roll mechanic) rather than a ~0.06%-of-kills
artifact. `marginal-rates.test.ts`'s 0.5% tolerance already accommodates
this — checked, not assumed: it passed clean against the regenerated corpus.

**Corpus effect, measured via a full unscoped `ingest parse` (no
`--tier`/`--source` filter) plus `ingest site-index`:** exactly the 9
sources that were `needs_review` on the mode question alone —
`abyssal-sire`, `araxxor`, `arrg`, `bryophyta`, `dagannoth-{prime,rex,supreme}`,
`deranged-archaeologist`, `giant-sea-snake` — flipped to `verified`. 55 -> 64
verified, 42 -> 33 needs_review, `manual_override`/`parse_failed` unchanged.
`corpus-reproducibility.test.ts` passes against the regenerated
`data/bosses/*.json` (it failed first, correctly, against the stale
committed documents before the re-parse — that's the guard working, not a
regression). Full `pnpm -r test`/`pnpm -r typecheck` green, including
`packages/loot-model/test/brutus.test.ts` (untouched by this change, run as
the regression gate anyway since `assemble-boss.ts` is engine-adjacent).

**One test updated, not just re-run**: `build-tables.test.ts`'s "stays
flagged, because the single-access-roll shape is still not modelled" case
is inverted (kept, not deleted) into "models a confirmed partition as a
oneOf at the access rate, and clears the flag", plus a new case pinning that
a refused or access-rate-less block still gets the old flagged treatment —
the same "invert rather than delete" discipline the transclusion-fix and
dropversion-fix entries above already used.

## `parserVersion` retired as a staleness mechanism, not the field itself

CLAUDE.md's hard rule read "bump `parserVersion` instead" of re-hitting the
wiki to fix a parser bug — but nothing ever bumped it (`apps/ingest/src/
main.ts` writes the literal `1` on every parse invocation, unconditionally)
and nothing ever read it back to decide whether a document needed
re-parsing. A rule nothing enforces is the same shape as a guard that's
hardcoded `{ ok: true }` — this project's own recurring "constant-returning
validation checks" / landmine #11f lesson, just in prose instead of code.

**Two ways to close it: wire a real `CURRENT_PARSER_VERSION` constant and a
staleness check, or drop the rule.** Took the second. `apps/ingest/test/
corpus-reproducibility.test.ts` already IS the staleness guard, and a better
one than a version-number comparison would be: it re-parses every committed
document from its actual snapshot and diffs the real output, so it catches
EVERY behaviour change, not just the ones a human remembered to bump a
constant for. A version-number check would only ever say "this document is
behind," never "and here is what changed" — the diff already says both, has
already caught real staleness twice (`monumental-chest`, landmine #1; this
session's `data/bosses/*.json` before the transclusion re-parse, two entries
above), and runs in `pnpm -r test`/CI already. Building a second, weaker
mechanism next to a stronger one already running would be exactly the kind
of manual-discipline dependency (remember to bump the constant on every
parser change) this project has repeatedly found does not hold up — the
whole reason `scope-invariant.ts`'s mutation harness and the "assert a check
did non-trivial work" rule (landmine #11f) exist at all.

**What changed:** CLAUDE.md's rule no longer prescribes bumping
`parserVersion`; it names `corpus-reproducibility.test.ts` as the actual
mechanism instead. `Boss.parserVersion`'s schema comment
(`packages/loot-model/src/schema.ts`) states plainly that it is provenance
metadata only, not a staleness input, so the next person who considers
wiring a comparison against it finds this reasoning first rather than
re-discovering it. **The field itself is not removed** — `parserVersion:
number` is named in `PROJECT_PLAN.md` section 4.5's `Boss` type, unlike
`killCountAtLeast` (retired for real, zero uses anywhere) this one is a
committed spec field with real (if inert) provenance value, the same
standing `wikiRevId` already has. Removing it would be a schema change
nobody asked for; softening the rule that falsely implied it was load-bearing
is the actual fix.

## Three verified sources downgraded on the bundle defect, before any fix existed

`the-leviathan`, `the-whisperer`, `vardorvis` were `verified` and shipping
wrong odds — the "Weight-overflow investigated" entry above found their
`Supplies` heading is "these supplies are all dropped together" (one access
roll, all three items), modelled as a `weighted` pick-one-of-three because
the schema has no bundle representation. Downgraded to `needs_review` via
`data/mechanics-watchlist.json` (`mechanic: 'other'`, matching Duke Sucellus
and Zalcano's precedent for "parses cleanly, real mechanic invisible to the
rows"), deliberately BEFORE any fix — a `needs_review` badge on data that is
actually wrong is honest; a `verified` badge on it is not, and closing that
gap does not need the fix to exist first.

**`blockedBy: []` for all three, not the boss's own title** — got this wrong
on the first attempt and `checkWatchlistConsistency` caught it immediately
(exactly what it's for): `blockedBy` lists OTHER pages a mechanic depends on
(`reward-cart` -> `["Wintertodt"]`), never a source's own boss page — that
boss carries the mechanic directly rather than being blocked by it, per
`duke-sucellus`'s and `zalcano`'s own `blockedBy: []`. Also had to stop
naming the other two bosses by their exact page titles inside each entry's
`detail` (rule 4a flags a detail that names a *different* source's boss page
by title) — reworded to "the other two Desert Treasure II 'awakened'
bosses' own watchlist entries" instead, which says the same thing without
tripping the check.

Corpus effect: 64 -> 61 verified, 33 -> 36 needs_review. `data/bosses/*.json`
and `data/index.json` regenerated via a full unscoped `ingest parse` +
`ingest site-index`; `watchlist.test.ts` and the full `pnpm -r test` pass.

## Yama's `always`+`fixed` fallthrough — fixed, mechanically, no design attached

Confirmed and fixed the specific root cause the weight-overflow entry named
for Yama: `buildTableGroups`'s `allAlways` check requires EVERY row in a
block to be `always`-kind, so a block mixing `always` and `fixed` rows (18
`Always` "Contract" rewards plus one `1/100` chance row, `Yami`) fails it and
falls through. The block then reaches the homogeneous-denominator merge path
(`denominators` is built from `fixed`-kind rates only, so it saw one
denominator — 100, from `Yami` alone — and merged EVERY row onto it,
`always` ones included). `toEntry`'s weight formula
(`rate.num * denominator / rate.den`) gives an `always` row (`num: 1, den:
1`) a weight equal to the WHOLE denominator, so all 18 shipped at `weight:
100` against `denominator: 100` — the measured 1801/100, 18x overflow.

**Fix: hoist the always-row split to run for every block, before any
mode-inference branch, not just inside the `Pre-roll` heading branch that
already had it** (Monumental chest's Cabbage/Message rows, this file's
"dropversion= parser fix" entry). `resolved` (now `let`, was `const`) is
reassigned to the non-`always` remainder whenever a block has BOTH kinds
mixed (`mixedAlwaysRows.length > 0 && mixedAlwaysRows.length < resolved.length`
— pure-`always` and pure-`fixed` blocks are untouched, so `allAlways`/
`ALWAYS_HEADINGS` still see what they always saw). The `Pre-roll` branch's
own copy of this split is left in place rather than deleted or restructured
— it is now a guaranteed no-op (by the time it runs, `resolved` has already
had every `always` row split out), but `preroll`'s own rejection of inline
`always` entries is a schema-level rule (landmine #4) independent of where
the general split happens to live, so removing it would be tidying a
correct, tested branch for a marginal-risk gain. Its comment now says so.

**Why this is a real, general defect and not just Yama's own bug**: the same
`resolved.map(...)` (no `always`-kind filter) pattern that mis-built Yama's
`Contract` table exists identically in the homogeneous-merge path, the
dominant/outlier split, AND the final heterogeneous fallback — all three
build weighted-shaped entries straight off `resolved` without excluding
`always` rows first. Only `independent`/`preroll` modes were ever safe
(`assembleBoss` reads `entry.rarity.kind`, not the computed `weight`, for
those). Hoisting the split before ALL of them, rather than patching whichever
one Yama happened to hit, is what makes this "the model," not "the call
site" (CLAUDE.md's own framing).

**A real, traced, harmless side effect surfaced by the fix, not introduced by
it**: `rewards-chest-fortis-colosseum`'s `source` flipped from `'override'`
to `'merged'` and its `contextDefaults` gained an inert `variant: 'Wave 1'`.
Root cause: Wave 12's own raw heading has Dizana's quiver (`Always`) sitting
beside Smol Heredit (`1/200`) and a 792/4800 weighted pool — the identical
shape to Yama's `Contract`, on the page this override happens to fully
supersede. Before this fix, that heading's overflow (or some downstream
consequence of it) kept the WHOLE generated base document from assembling at
all (`result.boss: null`), so the override always won by default with no
generated base underneath at all (`source: 'override'`). Now a real (if
entirely superseded) generated base exists, so `source` correctly reads
`'merged'`. **The override's own 13 tables are byte-identical** — confirmed
by diff, not assumed — so nothing simulation-relevant changed. The leaked
`contextDefaults.variant: 'Wave 1'` is genuinely inert: `boss.variants` stays
`['normal']` (so the UI never offers "Wave 1" as an option) and none of the
13 override tables carry a `variant` condition (so nothing ever reads this
default even if a URL set it by hand). `rewards-chest-fortis-colosseum.test.ts`'s
`source` assertion updated (inverted, not deleted) to expect `'merged'` and
explain why. **Not fixed, and out of scope for this entry**: `applyOverride`
letting `contextDefaults`/`variants` leak through from a discarded generated
base even when `tables` is fully replaced is a real, narrow gap in its own
right — flagged here for whoever next touches `applyOverride`'s merge
semantics, not chased down now.

Corpus effect: verified/needs_review counts unchanged (Yama was already
`needs_review` for unrelated reasons — an unparseable-rarity gap and a
`drops_covered` shortfall, neither touched by this fix — so removing its
`weights_sum` failure doesn't flip its status). `data/bosses/yama.json`'s
`Contract` table now correctly reads `sum: 1, denominator: 100` (just
`Yami`), not `1801/100`. Full `pnpm -r test`/`typecheck` green, including
`packages/loot-model/test/brutus.test.ts` as the regression gate.

## maggot-king, chaos-fanatic, phosani-s-nightmare root-caused — not the same defect

Investigated as asked, before assuming the remaining three weight-overflow
sources share Yama's cause or each other's. They don't, and splitting them
correctly matters for what happens next:

- **`maggot-king` is the SAME bundle defect as Grotesque Guardians/Mad
  Angel**, and its overflow is fully and exactly explained by it. Its
  `Supplies` heading is "These supplies are dropped together" (page prose,
  no per-row footnote) over Stymphike tartare and Dull ancient medal, each
  independently cited at `41/159`. Parsed as two competing rows, they
  contribute 82 to the pool instead of the true single-outcome 41; the
  measured overflow is exactly **41** (200 vs denominator 159), and 200 − 41
  = 159. No other component is present — this one is clean.
- **`chaos-fanatic` DOES carry the bundle defect (twice — Zamorak monk
  top/bottom "always dropped together", Uncut emerald/sapphire "dropped
  alongside", both per-row footnotes), but neither explains its weight
  overflow.** Summed the raw per-row weights the wiki itself publishes for
  the merged table by hand: 5+5+5+4+4+1 (weapons) + 4+4+4+4 (runes) +
  8+8+8+4 (consumables) + 18+8+7+6+6+5+5+4+2 (other) = **129**, against a
  denominator the SAME rows all individually cite as `/128`. That is the
  wiki's own published numbers, taken completely at face value, already one
  over their own stated total — before any bundle-pair double-counting is
  even considered. Naively "fixing" the overflow by deduping the two bundle
  pairs would swing it to 120 (an 8-unit SHORTFALL), the wrong direction —
  proof the bundle pairs are not the cause of the specific overflow, even
  though the joint-co-occurrence problem they represent (get the top, do you
  also get the bottom?) is still real and still wrong, same as the three
  downgraded sources above.
- **`phosani-s-nightmare` carries NO bundle citation anywhere in its
  overflowing table at all** (checked the full, untruncated wikitext for
  its `Runes and ammunition`/`Resources`/`Consumables`/`Coins` headings —
  no `raritynotes`, no shared footnote, no preamble prose). Summed by hand
  the same way: 27 + 40 + 32 + 2 = **101** against a denominator every row
  cites as `/100`. Same shape as chaos-fanatic — the wiki's own published
  integer weights simply don't sum to their own stated total — but with no
  bundle defect riding along this time.

**So there are (at least) three distinct cause classes behind "weights sum
to more than the denominator," not one**: Yama's always+fixed fallthrough
(fixed, above), the bundle defect (maggot-king, cleanly; Grotesque
Guardians/Mad Angel/K'ril/Zilyana from the earlier entry; also present,
incidentally, in chaos-fanatic), and a third, previously undistinguished
class — **the wiki's own published per-row weights not reconciling to
their own stated denominator by a small margin** (chaos-fanatic +1/128,
phosani-s-nightmare +1/100 — both roughly 0.8-1%, both round numbers,
plausibly ordinary community-editing drift rather than anything a parser
fix or a model extension could correct). Nothing here is fixed. This third
class in particular has no obvious remedy at all short of re-deriving the
correct weights from drop-log data, which is out of scope for a parser.

## The bundle shape, assessed: `tableRef` to an `always`-mode table, no new node kind

Asked to assess before building. Two questions, answered separately.

**Does "a weighted entry pointing at a nested table with `mode: 'always'`"
work, or does it need a new `Node` kind?** It works, with zero schema
change, and CoX's own `oneOf(herb, seed)` nesting already proves the general
shape (an entry whose `node` resolves to a sub-structure rather than a bare
item) is sound. Traced the exact mechanism to confirm rather than assume:

- `Node.kind: 'tableRef'` resolves against `data/tables/*.json` — checked
  that this does NOT require the target to be reused across multiple
  sources. `data/tables/lunar_chest_{blood,blue,eclipse}_set.json` are
  already single-boss-specific `data/tables/` records (Lunar Chest's own
  per-set duplicate-protection pools), so a `grotesque-guardians-potions.json`
  -shaped file for one boss's one bundle is exactly precedented, not new
  territory.
- `compile.ts`'s `compileNode` handles `tableRef` by calling
  `compileTable(target, path)` and wrapping the result — mode-agnostic. An
  `always`-mode target compiles exactly the way a top-level `always` table
  does (Brutus' `100%` heading); nothing about being REACHED via a
  `tableRef` changes that.
- `simulate.ts`'s `runTable` `case 'always'` unconditionally emits every
  node in `table.nodes` — again mode-agnostic to how the table was reached.
  So: an `independent`-mode entry at the bundle's own access rate
  (`{kind:'fixed', num, den}`), whose `node` is `{kind:'tableRef', ref:
  '<bundle-id>'}` pointing at a new `data/tables/<bundle-id>.json` with
  `mode: 'always'` and one entry per bundled item, is exactly "this roll
  either gives nothing, or gives ALL of these" — the inclusive counterpart
  to `oneOf`'s "this roll gives exactly one of these," built entirely from
  primitives already in production and already covered by
  `refs_resolve`/`items_known`/`qty_sane`/`drops_covered`/`marginal-rates`
  (all of which already walk `tableRef`, unconditionally on target mode).
- `refs_resolve.ts` was checked directly for a mode constraint — there is
  none; it resolves and cycle-checks `tableRef` targets without ever
  inspecting their `mode`.

**Can the bundle shape be detected independent of whether it overflows?**
Yes, and it should be — a standing check, not a fix contingent on the
arithmetic happening to break, is exactly what would have caught
`the-leviathan`/`the-whisperer`/`vardorvis` before they ever shipped
`verified`. Two textual signals recur across every real instance found this
session, and neither is new machinery to detect, just new machinery to USE:

1. **A per-row `raritynotes` citation shared by 2+ rows** — Grotesque
   Guardians' potion trio, K'ril's two potion pairs, chaos-fanatic's robe
   pair and gem pair. `findConfirmingSignal`'s `citedRefNames` ALREADY
   extracts this exact shape (shared footnote names across rows) — it is
   used today for a different question (confirming `preroll` mutual
   exclusivity), and currently only checks that a citation is SHARED, never
   reads what the citation's own text says. Classifying the DEFINING
   occurrence's text (not just its presence) against a co-drop phrase list —
   "dropped together", "dropped alongside", "always accompan-" — the same
   `MUTUAL_EXCLUSIVITY_PHRASES`-style regex list this file already uses for
   the sibling question, is the missing half.
2. **Block-level prose sitting between a heading and its
   `{{DropsTableHead}}`, with no per-row footnote at all** — every one of
   the three downgraded sources, `maggot-king`, and `mad-angel`'s more
   complex "either sharks or yellowfins, bundled with a prayer potion(2) and
   a super combat potion(1)" all use THIS form, not a footnote. This is
   NOT currently captured anywhere: `HeadingBlock`/`WikitextDropLine` carry
   `heading`/`section`/`lines` only, no preamble text — a genuinely new
   extraction point in `wikitext-drops.ts`, not a reuse of existing state
   the way signal 1 is.

Recommended shape for when this gets built (not built now): a
`findBundleSignal`-style heuristic mirroring `findConfirmingSignal`,
producing a per-block `bundleMembers: string[] | null` fact from either
signal; `build-tables.ts` emits it as new group metadata (`alwaysBundle`,
alongside `oneOfAccess` from the transclusion work) when it fires;
`assembleBoss` builds the `tableRef` + `data/tables/<bundle-id>.json`
structure described above; and a standing, corpus-wide check — same shape as
`checkTransclusionPartitions`, run on every block regardless of whether it
currently reconciles — reports any block whose bundle signal fires that
ISN'T yet modelled as a bundle, which is what closes the "silently wrong
`verified`" hole for good rather than just for these three. Mad Angel's
"either...or...bundled with..." shape (a choice nested inside a bundle) is
the one case this wouldn't fully close on the first pass — flagged, not
solved, since it is a compound of `oneOf` AND the new bundle shape in one
heading and deserves its own look once the simple case is real.

**Not built.** This is a genuine, moderate-sized capability (a new
extraction point, a new heuristic, new group metadata, a new standing
check, plus the `data/tables/` bundle files themselves) — assessed and
scoped, not attempted, pending a decision on priority against the rest of
Phase 7.

## The bundle shape, built: `tableRef` + `always`-mode tables, a standing check, both signals

Built exactly as assessed above — no design changes, one clarification the
assessment didn't fully anticipate (below). Detection was built FIRST and
runs as a standing check on every heading block corpus-wide, not gated
behind `weights_sum` already failing, per the explicit instruction: a fix
contingent on the arithmetic breaking is the exact mechanism that let
`the-leviathan`/`the-whisperer`/`vardorvis` ship `verified` wrong.

**The one thing the assessment underspecified: a bundle is usually a SUBSET
of a block's rows, not the whole block.** Grotesque Guardians' `Supplies`
heading has 6 rows; only 3 (the potion trio) are bundled, the other 3
(Mushroom potato, Saradomin brew, Prayer potion) are ordinary competing
alternatives in the SAME weighted table. K'ril and Zilyana each carry TWO
independent bundle pairs under one `Potions` heading, plus (Zilyana) an
unbundled Prayer potion row in the same table. The fix therefore collapses
each detected group's N member rows into ONE synthetic row — at the
group's own shared rate, unchanged — and splices it back into the same
row set every other mode-inference heuristic in `buildTableGroups` already
runs on, rather than special-casing "the whole block is a bundle." Only the
three DT2 "awakened" bosses, Maggot King, and Duke Sucellus happen to have
their bundle occupy 100% of the heading's rows.

**Two signals, both implemented, matching the assessment's split exactly**:

1. **A shared footnote whose DEFINING text reads as a co-drop phrase.**
   `findConfirmingSignal`'s `citedRefNames` shape is reused (`build-tables.
   ts`'s new `definingRefText`) but answers a different question: not "is
   this ref shared" (that alone proved nothing — Zilyana's Prayer potion
   shares a DIFFERENT ref, `potions rate`, with its Saradomin brew/Super
   restore bundle pair, but that ref's own defining text is a rate
   citation, not a co-drop phrase, and correctly never fires) but "does the
   ONE line carrying the ref's real text — not a bare `<ref name="X"/>`
   repeat or a `{{NamedRef|X}}` shorthand — say the members arrive
   together." `CO_DROP_PHRASES` (`dropped together`, `dropped alongside`,
   `always accompan-`, `bundled with`) is the inverse list of
   `MUTUAL_EXCLUSIVITY_PHRASES`.
2. **Block-level prose with no footnote at all**, checked only when the
   footnote signal found nothing for the block. `wikitext-drops.ts` gained
   `WikitextDropLine.blockPreamble` (text between the heading and the
   block's first template call) to make this readable at all — genuinely
   new extraction, exactly as scoped. Confirmed only when EVERY row in the
   block shares one identical rate; this is what correctly REFUSES Mad
   Angel (see below) instead of guessing.

**Grepped the whole corpus for the four phrases before trusting the
detector on real data, not just the three previously-cited downgraded
sources**: 13 sources carry one, matching the earlier session's own count
exactly — the 9 in the task's affected list, plus `duke-sucellus`,
`kree-arra`, `nex`, `phantom-muspah`. Checked each of the extra four by
hand before assuming the standing check's universal reach was safe:

- `duke-sucellus` has the IDENTICAL whole-block-prose shape as the three DT2
  bosses (its own `Supplies` heading, same wording) and is now correctly
  modelled too — a bonus, harmless since it stays `needs_review` for its
  own, unrelated, already-watchlisted chain-order/perfect-kill-bonus reason.
- `kree-arra` carries the GWDRDT group's footnote shape (a full, repeated
  `<ref name="potiondrop">...</ref>` on BOTH citing lines, not a
  define-once-then-self-close pair — a citation style `definingRefText`
  handles by construction, since it just takes whichever line's text it
  finds first) and is now correctly modelled too — bonus, stays
  `needs_review` on the pre-existing GWDRDT missing-item gap.
- `nex`'s two bundle pairs sit on `rarity=Common` rows, which
  `parseRarity` cannot resolve to a `ParsedRate` at all — the block bails
  out at the existing "unparseable rarity" check before bundle detection
  ever runs, so nothing new happens here. Pre-existing gap, untouched.
- `phantom-muspah`'s one "dropped alongside" occurrence is inside an
  ANONYMOUS `<ref group=d>` (no `name=` attribute) on the Venator shard row
  alone — describing the OPPOSITE of a bundle ("no regular loot will be
  dropped alongside it", i.e. this item replaces other loot) — and is
  invisible to `citedRefNames`, which requires a `name=` attribute to
  register anything at all. Never reaches the phrase check. Confirmed by
  reading the raw wikitext, not assumed safe from the shape alone.
  **STALE as of a later session — see this doc's "A fourth bug, found
  asking 'what's actually blocking these two now'" entry, near the end:**
  the wiki page was edited since this snapshot, Venator shard's row gained
  an adjacent `<ref name=uniques />`, and THAT exposed a real, distinct
  `definingRefText` defect (reads across a self-closing tag into the next
  one) this assessment had no way to anticipate. Fixed there, not here.

**The `tableRef` target is GENERATED, not hand-authored, and gets written
during `parseBoss` itself — the one real mechanical wrinkle the assessment
didn't spell out.** `assembleBoss` returns `bundleTables: Table[]`
alongside the boss document; `parseBoss` writes each to
`data/tables/<id>.json` (id = `<slug>-<heading-slug>-bundle`, with a
numeric suffix for a second bundle under one heading — K'ril/Zilyana's two
pairs) and folds them into a LOCAL copy of the shared-tables map before
running `refs_resolve`/`drops_covered` against THIS document — the
session-wide `sharedTables` passed into `parseBoss` was loaded once, before
this source's own bundles were known to exist, so the check would
otherwise report an unresolved ref on the same run that created it.
`ParseOptions` gained `tablesDir` (mirroring `outputDir`) so
`corpus-reproducibility.test.ts` writes generated bundle files to scratch,
never the real `data/tables/`, the same discipline `outputDir` already
enforces for boss documents.

**Mad Angel is the confirmed, deliberate non-closure.** Its `Supply batch`
heading compounds a `oneOf` fish choice (Shark/Yellowfin, 8/150 each) with
a flat two-item bundle (Prayer potion(2)/Super combat potion(1), 16/150
each) behind one "bundled with" prose sentence — two different rates in
the same signal-confirmed block, which the uniform-rate requirement
correctly refuses rather than guessing which subset is "the" bundle.
`checkBundleSignals` reports it `confirmed: false`; `parseBoss` surfaces it
in `reasons` and folds it into the `deterministicOk` gate the same way an
ambiguous-mode guess already does, so it cannot silently ship `verified`
even on a future pass where its own `weights_sum` happens to stop
overflowing. Left exactly as flagged in the assessment — "deserves its own
look once the simple case is real" — not attempted here.

**K'ril's Coins composite defect (a THIRD, unrelated cause — see "Weight-
overflow investigated" above) was deliberately NOT touched.** Its
`raritynotes` explicitly disclaims single-table scope ("Coins come from
rolls on all loot tables, including the unique table, GDT and RDT") and the
parser still includes the whole composite figure. Per explicit instruction,
out of scope for this entry — K'ril's own `weights_sum` happens to still
pass after the bundle fix alone (the composite figure inflates the total
without pushing it over 127), so this is invisible in the corpus counts,
but the number itself is still wrong and unaddressed.

**`chaos-fanatic`/`phosani-s-nightmare`'s own weight-overflow was NOT
chased, per explicit instruction.** `chaos-fanatic` carries two bundle
pairs (now correctly modelled) that were never the cause of its own
overflow — removing their double-count moves its hand-summed total from
129 to 120, UNDER its `/128` denominator, so `weights_sum` now passes by
coincidence (shortfall is legitimate slack, not a defect) without the
underlying "wiki's own published weights don't reconcile to their own
stated total" question ever being resolved. `phosani-s-nightmare` carries
no bundle citation at all and is completely untouched by this session.
Neither is on `data/mechanics-watchlist.json` and neither needs to be —
see the "root-caused" entry above for why.

**Corpus effect**: 61 → 65 verified, 36 → 32 needs_review (102 total,
unchanged). Four sources newly `verified`: `grotesque-guardians` (the
bundle was its only defect), and `the-leviathan`/`the-whisperer`/
`vardorvis` (downgraded off `verified` deliberately in an earlier session
pending exactly this fix — their `data/mechanics-watchlist.json` entries
are removed here, now that the mechanic they name is modelled). `maggot-king`,
`k-ril-tsutsaroth`, `commander-zilyana`, `chaos-fanatic` stay
`needs_review` — each has its own separate, pre-existing, unfixed reason
(a `drops_covered` gap for the first three, GWDRDT's missing-item gap for
the GWD pair) that the bundle fix was never going to close. `mad-angel`
stays `needs_review`, correctly, now for a MORE PRECISE reason than
before (`checkBundleSignals`'s explicit `confirmed: false`, not just an
uninterpreted `weights_sum` overflow). `duke-sucellus`/`kree-arra` are
unaffected in status (each already `needs_review` for its own separate,
untouched reason) but now carry the correct bundle structure underneath.
13 new `data/tables/*.json` files, all generated, none hand-authored.
Full `pnpm -r test`/`typecheck`/`lint` green, including
`packages/loot-model/test/brutus.test.ts` as the regression gate; new
coverage in `apps/ingest/test/build-tables.test.ts` (`findBundleGroups`/
`checkBundleSignals`, both signals, the uniform-rate refusal) and
`apps/ingest/test/assemble-boss.test.ts` (the `tableRef` node, the
generated shared table's shape, the collision-suffix id scheme).
`marginal-rates.test.ts`'s `DOES_NOT_COMPILE` trip wire fired as expected
and was updated (7 sources → 2: `mad-angel`, `phosani-s-nightmare`) rather
than deleted, matching the project's standing convention for this class of
guard.

## GWDRDT built: landmine #3 closed, plus K'ril's separate Coins composite defect

Two unrelated fixes, done in the requested order — GWDRDT first, K'ril's Coins
second — because the second is only cleanly checkable once the first stops
inflating the same table's own weight sum.

### `{{GWDRDT}}` resolves now: two new `data/tables/` records, not one

Landmine #3 (`docs/HANDOFF.md`) said "a new `data/tables/gwd_rare_drop_
table.json`-shaped record, not a code fix. One record fixes all four" —
written before anyone had actually read `Template:GWDRDT`'s own wikitext.
Both halves of that were wrong once the real page was fetched: it needs a
small, generic code change (`rdt-access.ts`'s `{{GWDRDT}}` branch always
pushed to `unresolved` unconditionally; it now emits two access lines,
matching a template call that carries no boss-specific parameters at all),
and it needs TWO new records, not one, because the table has the same
rare -> gem -> mega-rare nesting as the regular RDT/gem/mega-rare chain —
confirmed, not assumed, by fetching and decoding the actual formula.

**What was fetched, and why fetching was legitimate here.** No wikitext
snapshot existed for `Template:GWDRDT`'s own body (only a prior session's
`data/snapshots/wikitext/template-gwdrdt.json`, which has the ITEM ROWS but
not the rarity FORMULA behind them) or for `Template:CalculateRDTNaked` (the
rarity template every row's own `rarity=` calls). This is new research, not
re-parsing an existing source — the same category as fetching a `Module:`/
`Calculator:` page for ToA/CoX/ToB, which CLAUDE.md's "never re-hit the wiki"
rule was never meant to forbid (that rule is about not re-fetching to patch a
parser bug against data already snapshotted). Fetched via `client.wikitext()`
+ `writeSnapshot('wikitext', slugify(title), record)`, the same mechanism
`verify-schema` already uses for `SCHEMA_PAGES`, from a throwaway script
(not added to `main.ts` — this is a one-time lookup, not a repeatable
pipeline step). `Template:CalculateRDTNaked`'s wikitext:

```
{{#vardefine:G|{{#expr:{{{R_chance|0}}}*20/128+{{{G_chance|0}}}}}}}
{{#vardefine:M|{{#expr:{{{R_chance|0}}}*15/128+{{#var:G}}/128}}}}
1/{{#expr:1/({{{R_chance|0}}}*{{{R_rate|0}}}/128+{{#var:G}}*{{{G_rate|0}}}/128+{{#var:M}}*{{{M_rate|0}}}/128) round 2}}
```

Decoded: `G` (the overall chance of landing in the gem sub-pool) is
`R_chance * 20/128 + G_chance` — R's own internal 20/128 routing weight into
gems (the EXACT weight `data/tables/rare_drop_table.json`'s own `tableRef`
into `gem_drop_table` already carries) plus a direct gem-access chance. `M`
nests the same way one level deeper (`R_chance*15/128 + G/128`, matching
`rare_drop_table.json`'s own 15-weight `tableRef` into `mega_rare_drop_
table` and `gem_drop_table.json`'s own 1-weight `tableRef` into it). Final
rate: `R_chance*R_rate/128 + G*G_rate/128 + M*M_rate/128`, displayed as
`1/round(1/P, 2)`. Every `{{DropsLine}}` row on `Template:GWDRDT` calls this
with `R_chance=8/127|G_chance=2/127` (constants, identical on all 24 rows and
across all four boss pages — `{{GWDRDT}}` itself takes no parameters) plus
one of `R_rate=`/`G_rate=`/`M_rate=`.

**Cross-checked against real rendered data, not just decoded from the
template.** `data/snapshots/dropsline/kree-arra.json` carries GWDRDT's own
`{{DropsLine}}` rows post-transclusion, with the wiki's OWN computed final
rarity — every one of the 24 rows' formula output matches its bucket figure
exactly (Loop half of key 1/94.93, Tooth half of key 1/99.58, Rune spear
1/2,110.31, Dragon spear 1/5,627.5, ...), confirming both the formula and
every row's own `R_rate`/`G_rate`/`M_rate` reading are right, not just
internally consistent.

**Built `data/tables/gwd_rare_drop_table.json`** (`mode: weighted`,
`denominator: 128`, 16 R-pool items at their own `R_rate` weight, plus a
`tableRef` into `gwd_gem_drop_table` at weight 20 — mirroring
`rare_drop_table.json`'s own structure exactly) **and `data/tables/
gwd_gem_drop_table.json`** (8 G-pool items at their own `G_rate` weight,
plus a `tableRef` into the EXISTING `mega_rare_drop_table.json` at weight 1
— reused directly, not duplicated, since GWD's own M-pool items and weights
(Rune spear 8, Shield left half 4, Dragon spear 3) are numerically and
item-for-item IDENTICAL to the regular table's; the page's own prose never
claims mega-rare differs, only the rune-sword/coins substitutions and some
quantities). Coins is deliberately NOT a row in either new file — the page's
own prose states GWDRDT's own empty rolls are redirected to a coins reward
on the boss's own main table, which is exactly the composite Coins
`raritynotes` each of the four boss pages already carries (see below).
Generated via a one-off script through the same item-resolution path
`assembleBoss` uses (`readItemIndex`/`indexByItemKey`), not hand-typed —
all 24 items resolved to a single id cleanly, none needed the multi-id
allowlist. Static, hand-authored-equivalent files, like the other three —
not regenerated by `ingest parse` the way a bundle table is, since GWDRDT's
own content is a fixed constant, not something that varies per boss.

`rdt-access.ts`'s `{{GWDRDT}}` branch now calls the same `accessLineFor`
helper `{{RareDropTable}}`/`{{GemDropTable}}` already use, twice, with the
rate strings `'8/127'`/`'2/127'` supplied directly (not read from `params`,
since no real call carries them) — so a hypothetical future `dropversion=`/
`rolls=`/`approx=` on a `{{GWDRDT}}` call would still be read generically
rather than silently ignored, the same discipline the rest of this file
already applies elsewhere. `RdtAccessLine.ref` widened to include the two
new ids; `assemble-boss.ts`'s access-line note builder (which used to assume
exactly two possible refs) now looks up the source template name from a
small `ACCESS_TEMPLATE_NAME` map instead of a binary ternary.

**Corpus effect**: `kree-arra` and `general-graardor` reach `verified` for
the first time (GWDRDT was their only remaining gap). `commander-zilyana`
and `k-ril-tsutsaroth` drop from 27/25-of-50 `drops_covered` misses to 2/3
— the residual is unrelated (Frozen key piece, the two pets, Staff of the
dead on K'ril specifically — a capitalisation mismatch against the bucket's
own "Staff of the dead" vs. the wiki's own `name=Staff of the Dead`, and two
items genuinely absent from the raw wikitext, neither touched by this
entry). **65 → 67 verified** (kree-arra, general-graardor), **32 → 30
needs_review**. Full
`pnpm -r test`/`typecheck`/`lint` green including `brutus.test.ts`;
`rdt-access.test.ts`'s own GWDRDT test inverted (was: asserts unresolved:
now: asserts both resolved rates and their refs).

### K'ril's Coins composite rate: split out, not blended in

The third, distinct defect from "Weight-overflow investigated": K'ril's and
Zilyana's own `Coins` row (`raritynotes`: "Coins come from rolls on all loot
tables, including the unique table, GDT and RDT") is a rate the wiki itself
computed by AGGREGATING several independent roll mechanisms elsewhere on the
page, inserted into the `Other` heading's own weighted pool as if it were
that pool's own share. (Kree'arra's and General Graardor's Coins rows carry
the same disclaimer in a close wording — "multiple loot tables" instead of
"all loot tables" — harmlessly: their tables already reconcile with slack.)

**Fix**: a new early split in `buildTableGroups`, `COMPOSITE_RATE_PHRASES`
(`/rolls? on (?:all|multiple|several) loot tables/i`) matched against
`raritynotes`, mirroring the bundle split's shape but with an opposite
consequence for `pendingWeighted`. The bundle split and the mixed-Always
split both call `flushWeighted()` before pushing their own new group,
correctly, because their own remaining rows in the SAME block genuinely
start a fresh accumulation (Yama's `Contract` test documents exactly this).
The composite-rate split must NOT flush: K'ril's `Coins` row sits under
`Other`, which merges with the PRECEDING `Weapons and armour`/`Potions`
headings into one real, unified `/127` draw — flushing here would sever
that merge into two independently-rolled tables, letting both hit in the
same kill, which the wiki's own single shared denominator explicitly rules
out. Checked directly against the real committed table structure before
writing the fix, not assumed: `k-ril-tsutsaroth:2:weapons-and-armour-
potions-other` was already one merged table (12 entries, sum 117.7 before
the fix) spanning all three headings; after the fix, `k-ril-tsutsaroth:3:
weapons-and-armour-potions-other` still spans the same three headings (11
entries, sum 81 — the true remainder, comfortably under 127), and
`k-ril-tsutsaroth:2:other` is a NEW standalone `independent` entry, one row,
at Coins' own stated `36.7/127`.

**Not an approximation — the split IS the exact fix, not a partial one.**
Modelling Coins as its own `independent` entry at the wiki's own aggregate
rate is correct precisely BECAUSE that rate is already the full per-kill
probability of a coins reward, summed across mechanisms that don't compete
with `Other`'s own items for the same draw. Checked for double-counting
before trusting this: neither `data/tables/gwd_rare_drop_table.json` nor
`gwd_gem_drop_table.json` (K'ril's own unique table, `k-ril-tsutsaroth:1:
uniques`) carries a `Coins` entry of its own, so nothing elsewhere in the
document contributes the same reward a second time.

**Corpus effect**: none on `verified`/`needs_review` counts (K'ril and
Zilyana were already blocked on the GWDRDT-era `drops_covered` gap;
Kree'arra/General Graardor were already `verified` before AND after, since
their tables had slack either way) — a pure correctness fix, the same shape
as chaos-fanatic's own bundle-adjacent weight reduction. New coverage in
`apps/ingest/test/build-tables.test.ts` (the split itself, and — the
regression this fix has to not cause — that a composite row's SIBLINGS
under an earlier-merged heading keep merging). Full `pnpm -r test` green.

## Mad Angel's compound shape: a confirmed proposal, not built

Reported on request, before building anything — `docs/DECISIONS.md`'s "The
bundle shape, built" entry already named this as the one case the uniform-
rate requirement correctly refuses rather than guesses. This entry is that
promised follow-up: what the shape actually is, and a schema-confirmed
proposal for modelling it, left unbuilt pending a priority decision.

**The shape, restated precisely.** Mad Angel's `Supply batch` heading is one
16/150 access roll (stated in its own preamble prose) that, every time it
hits, grants BOTH Prayer potion(2) AND Super combat potion(1)
unconditionally, AND ALSO grants exactly one of {Shark, Yellowfin} (each
published at 8/150 — exactly half of the block's own 16/150 access rate,
the same partition identity `transclusionPartition` already uses elsewhere
to confirm a clean mutually-exclusive split). It is the co-drop bundle shape
and the `oneOf` shape at once, in one heading, which is exactly why the
uniform-rate check (every member must share ONE rate to auto-confirm a
whole-block bundle) correctly refuses it: two different rates,
16/150 and 8/150, both real, both part of the same access roll.

**Proposed shape — confirmed valid and behaviourally correct, zero schema
change, built nowhere in the pipeline**: `data/tables/mad-angel-supply-
batch-bundle.json`, `mode: 'always'`, THREE entries — two unconditional item
grants (`rate: {kind:'always'}`) for the potions, plus a THIRD entry whose
`node` is itself `{kind:'oneOf', entries:[Shark@weight 1, Yellowfin@weight
1]}`, ALSO at `rate: {kind:'always'}`. This composes two capabilities the
codebase already has independently and had simply never combined: an
`always`-mode table's entries use the general `EntrySchema` (`node:
NodeSchema`, which includes `oneOf`), not the narrower `LeafEntrySchema`
that `oneOf`'s OWN entries are restricted to (item/tableRef/nothing only —
no nesting a `oneOf` inside a `oneOf`). Nothing stops a `oneOf` from being
one of a `weighted`/`always`/`independent` TABLE's own top-level entries,
though — that is a different nesting depth, one `EntrySchema` already
allows. The access side is unchanged from the
existing bundle shape: `independent`-mode, `rate: {kind:'fixed', num:16,
den:150}`, `node: {kind:'tableRef', ref:'mad-angel-supply-batch-bundle'}`.

**Confirmed three ways, not just reasoned about:**

1. `SharedTableSchema.parse(...)` accepts the three-entry table literal
   exactly as described — no zod error.
2. `compileBoss`/`compileNode` handle it with no special-casing:
   `compileNode`'s `case 'oneOf'` fires exactly like it does anywhere else a
   `oneOf` node appears (CoX's herb/seed nesting, the transclusion-partition
   `oneOf` wrapper); nothing in `compile.ts` reads or restricts NODE kind by
   the ENCLOSING table's own mode, matching the same mode-agnosticism the
   bundle shape's own design already leaned on.
3. **A real 500,000-kill `simulate()` run** (throwaway script, not
   committed) against this exact table, wired behind a `16/150` access
   entry: Prayer potion(2) and Super combat potion(1) counts were IDENTICAL
   and co-occurred in every logged hit (110/110/110 on a 1,000-row sampled
   log); Shark and Yellowfin counts summed to exactly that same hit count
   and never once co-occurred together in the same kill. Exactly the
   claimed joint structure, not just the claimed marginal one.

**Not built — deliberately, on request.** Two ways this could ship, neither
attempted here:

- **A hand-authored `data/overrides/mad-angel.json`** using the confirmed
  shape directly, matching the precedent every other schema-shape-shaped
  special case (Duke Sucellus, Zalcano, Lunar Chest, all four raids) already
  uses. Proportionate for `n=1` — Mad Angel is the ONLY known instance of
  this compound shape in the whole corpus (checked as part of the earlier
  bundle-shape corpus grep; none of the other 12 co-drop-phrase sources have
  a second, different rate mixed into the same signal-confirmed block).
- **Generalising `findBundleGroups`'s detection** to recognise this shape
  automatically: within a preamble-confirmed block whose rows do NOT share
  one uniform rate, check whether they partition into exactly two groups —
  rows at the block's own dominant/access rate (unconditional members) and a
  SEPARATE subset whose own rates are mutually equal and sum EXACTLY to that
  access rate (a nested `oneOf`), with nothing left over. This is the SAME
  ratio-sums-to-one-hundred-percent identity `transclusionPartition` already
  runs, one level more nested. Risk: generalising a detector from a single
  confirmed instance is speculative by construction — the override path is
  recommended first; revisit generalising only once a second real instance
  of the compound shape turns up.

Whichever path is taken, it does not touch `chaos-fanatic`/`phosani-s-
nightmare`'s own separate wiki-weight-drift overflow (still permanently
flagged, per explicit standing instruction) or K'ril's Coins defect (fixed
separately, above, not folded into the bundle mechanism).

## Mad Angel's compound shape: built, per the confirmed proposal — plus a new, separate residual it uncovered

Built as recommended above: a hand-authored `data/overrides/mad-angel.json`,
not a detector generalisation (`n=1` in the whole corpus, per the prior
entry's own reasoning). `data/tables/mad-angel-supply-batch-bundle.json` is
`mode: 'always'`, three entries — Prayer potion(2) and Super combat
potion(1) both unconditional (`rate: {kind:'always'}`), plus a third entry
whose `node` is `{kind:'oneOf', entries:[Shark@weight 1, Yellowfin@weight
1]}`, also `rate: {kind:'always'}` — exactly the shape confirmed three ways
in the prior entry.

**One deliberate deviation from the prior entry's literal wording, resolved
in favour of precedent over the draft text.** The proposal described "the
access side" as `independent`-mode with a `fixed` rate. The actual `tableRef`
+ `always`-mode bundle mechanism, once built (`docs/DECISIONS.md`'s "The
bundle shape, built" entry), does it differently everywhere it already
ships: the synthetic `tableRef` row is spliced BACK INTO the same
`weighted`-mode table the original rows lived in, as one more `weight`-kind
entry at the group's own shared rate — confirmed by reading
`duke-sucellus:2:supplies` (whole-block bundle, weight 1 against a
denominator of 5.4), `maggot-king:2:...` (weight 41 in place of the removed
rows), and `k-ril-tsutsaroth:3:...` (two `tableRef` rows, weight 8 each, on
its two potion pairs) directly, not assumed from the prose description. This
override follows THAT precedent, not the proposal entry's literal words:
the four affected rows in `mad-angel:2:weapons-and-armour-runes-and-
ammunition-supply-batch-other` (Shark@8, Yellowfin@8, Prayer potion(2)@16,
Super combat potion(1)@16 — weight 48 total) are replaced by one `tableRef`
row at **weight 16**, matching the compound event's own shared 16/150 rate,
not a separate `independent`-mode table alongside it. This keeps the fix
inside the SAME weighted pool every other bundle instance uses, rather than
introducing a structurally different shape for the one source that happens
to also need a nested `oneOf`.

**The arithmetic confirms the choice, not just the precedent-matching.**
Before the fix, the pool's applicable weights summed to 180 against its own
stated denominator of 150 (`weights_sum`'s exact failure message, read off
the pre-override document) — a 30-over overflow that "closely matches" (per
`docs/HANDOFF.md`'s own phrasing) the 32-weight double-count the compound
bundle produces (48 across four rows, collapsing to one at 16). After the
fix: 180 − 48 + 16 = **148**, two under the stated 150 — `weights_sum` now
passes with a small, legitimate two-point slack, not an exact reconciliation
the way Grotesque Guardians'/Maggot King's own EXACT-match bundles do (their
own overflow was explained to the point, Mad Angel's own wasn't quite,
which is exactly why HANDOFF hedged with "closely" rather than "exactly").

**Confirmed against the real pipeline, not just the schema.** `ingest parse
--source mad-angel` now reports `weights_sum`, `refs_resolve`, `rates_valid`,
`qty_sane`, `items_known`, and `not_on_watchlist` all passing (mad-angel was
never on `data/mechanics-watchlist.json` to begin with — its `needs_review`
status came from `checkBundleSignals`'s `confirmed: false` folding into
`deterministicOk`, not a watchlist entry). `marginal-rates.test.ts`'s
`DOES_NOT_COMPILE` trip wire fired as expected and was updated (removing
`mad-angel`, leaving `phosani-s-nightmare` alone) rather than deleted, and
the source's own composed per-item rates for all four affected items now
match the wiki's stated rarities exactly — the same check that would have
caught a wrong weight choice.

**Mad Angel stays `needs_review` anyway — for a NEW, separate,
previously-invisible reason the bundle fix exposed, not because the bundle
fix is incomplete.** `drops_covered` now fails with "1 of 49 wiki drop
row(s) missing from the document: Clue scroll (hard)". Investigated by
reading the already-snapshotted `data/snapshots/wikitext/mad-angel.json`
directly (no live re-fetch, per CLAUDE.md's hard rule) against the already-
snapshotted `data/snapshots/dropsline/mad-angel.json`:

- The current wikitext's `===Tertiary===` block reads
  `{{DropsLineClue|type=medium|rarity=1/25}}` — **medium**, not hard. The
  page's own `==Changes==` log dates this exactly: a `12 August 2026`
  entry ("Summer Sweep Up") states outright, "The Mad Angel now drops
  [[Clue scroll (medium)|medium clue scrolls]] instead of hard clues."
  Six days before this session (today is 2026-08-18).
- The `dropsline` bucket snapshot — a separate, independently-cached wiki
  data source `checkDropsCovered` compares against — still carries a
  `Clue scroll (hard)` row at `Rarity: 1/25`, unchanged since before that
  patch. The bucket has not caught up to the page's own wikitext.
- The parsed document is CORRECT relative to the current page (it already
  carries `Clue scroll (medium)` at `1/25` in `mad-angel:3:tertiary`, which
  is right); the bucket `drops_covered` diffs against is what's stale. This
  is not a parser bug — nothing in the pipeline could resolve a
  disagreement between two snapshots of the wiki's own data by picking a
  side, and the two ARE inputs at rest, not a live re-fetch.

**A third instance of the "wiki's own data doesn't reconcile with itself"
class**, alongside chaos-fanatic's/phosani-s-nightmare's published-weights-
don't-sum-to-their-own-denominator defect — same flavour (no model or
parser change closes it, re-derivation from a live source is the only path,
out of scope), different mechanism (a cache-lag disagreement between two
data sources describing the same page, not an arithmetic slip within one).
**Not added to `data/mechanics-watchlist.json`** — same reasoning as
chaos-fanatic/phosani-s-nightmare: `drops_covered` already fails directly
and correctly, nothing additional is needed to keep the source
`needs_review`. Left here so a future session doesn't spend time trying to
locate a "Clue scroll (hard)" row that no longer exists on the page.

**Corpus effect: none on the aggregate count** (still 67 verified, 30
needs_review, 2 manual_override — mad-angel was already needs_review and
stays needs_review), but its OWN reason changed category: from the
weight-overflow/bundle-refusal row to a coverage-gap row, and — per
`docs/OVERRIDES.md`'s status table — the moment `drops_covered` is ever
resolved (only possible once the wiki's own bucket catches up to its own
wikitext, not by anything this session can do), it becomes `manual_override`
on the next parse with zero further engine work, since every deterministic
check but that one already passes. `pnpm -r test`/`typecheck`/`lint` green
except a pre-existing, unrelated flake — see the landmine entry below.

## `corpus-reproducibility.test.ts` embeds live GE prices in its own comparison, so it drifts on its own — found while validating the Mad Angel build, not caused by it

**Not a regression from this session's changes.** Running the full suite
while validating the Mad Angel override surfaced 39–42 unrelated sources
(`cerberus`, `king-black-dragon`, `kraken`, ... — never `mad-angel` itself)
failing `corpus-reproducibility.test.ts`'s "fresh parse matches committed
document" check, with the EXACT SET of offending sources differing between
consecutive runs minutes apart (42, then 39) but IDENTICAL across two runs
seconds apart (41, then 41, zero diff). Confirmed the cause, not just the
symptom: `parseBoss` (`apps/ingest/src/parse/parse-boss.ts`) folds
`gePriceLookup(options.gePrices)` — real, LIVE GE prices, fetched fresh on
every test run via `fetchGePrices` — into `checkEvMatches`, and
`evMatches.detail` (a string carrying the actual computed comparison
numbers whenever a rendered-page snapshot exists) is embedded verbatim in
the committed document's own `validation.checks` array. Any source with a
rendered snapshot therefore has a `detail` string that is a function of
*whatever the GE price was at the moment its document was last regenerated*
— compared, by `deepStrictEqual`, against *whatever the GE price is right
now*. `mad-angel` never appears in any run's mismatch list because its own
`ev_matches.detail` is the constant "no rendered page snapshot available"
string, immune to price drift — which is also how this was isolated to
prices rather than anything this session touched: `cerberus`, re-parsed
alone via the CLI (which writes to the real `data/bosses/` directory, not
scratch), reproduced its committed file byte-for-byte, but the SAME source
failed under the test's own scratch-dir comparison — the CLI run and the
test run simply landed on different live price snapshots.

**Not fixed here — out of scope for this session, flagged for a decision.**
Two shapes a fix could take, neither attempted: exclude `ev_matches.detail`
from the comparison (weakens the guard's own stated purpose — the "REAL
committed inputs" framing in the test's own doc comment — for the one field
that's deliberately non-deterministic), or freeze `checkEvMatches` in this
test behind a fixed/snapshotted price table instead of `fetchGePrices`
(closer to `data/snapshots/`'s own snapshot-first discipline, but this test
deliberately does NOT use `data/snapshots/` at all for prices — a
first-time gap, not a regression in an existing mechanism). This is a
pre-existing landmine that will keep firing on any future session that
happens to run the full suite far enough from `data/bosses/*.json`'s last
regeneration for GE prices to have moved — not specific to today's date or
today's session's changes.

## `drops_covered` compares item names case-sensitively — a real bug, found while auditing `needs_review`, that already fully explains several sources' "own separate reason"

Found while producing an honest breakdown of the 30 `needs_review` sources
(requested directly, not incidental). Several sources' `drops_covered`
failures — believed, per prior sessions' own framing, to be small but real
*content* gaps ("their own separate reason") — turn out to be a single,
different kind of bug: the reported items are **already correctly modeled**
in the document, at the right rate, and `checkDropsCoveredAgainst`
(`apps/ingest/src/validate/drops-covered.ts`) simply fails to recognize them
because its match is a bare `Set.has` — case-sensitive, no normalization —
comparing the document's own item `name` (taken verbatim from the wikitext's
`{{DropsLine|name=...}}` parameter, which commonly Title Cases pet/qualifier
names) against the `dropsline` bucket's `item_name` field (the wiki's own
canonical item-page title, commonly sentence-cased after the first word).

**Verified directly against the real committed documents, not inferred from
the missing-item strings alone** — for every source below, the "missing"
item was located inside the document's own `tables`, matching by
case-insensitive name:

| source | reported missing | actually present as |
|---|---|---|
| `chaos-elemental` | `Pet chaos elemental` | `Pet Chaos Elemental`, 1/300, `chaos-elemental:1:major-drops` |
| `chaos-fanatic` | `Pet chaos elemental`, `Wine of zamorak` | `Pet Chaos Elemental` (1/1000), `Wine of Zamorak` (weight 6) |
| `commander-zilyana` | `Frozen key piece (saradomin)`, `Pet zilyana` | `Frozen key piece (Saradomin)` (always), `Pet Zilyana` (1/5000) |
| `k-ril-tsutsaroth` | `Frozen key piece (zamorak)`, `Pet k'ril tsutsaroth`, `Staff of the dead` | `Frozen key piece (Zamorak)` (always), `Pet K'ril Tsutsaroth` (1/5000), `Staff of the Dead` (weight 3) — this is the SAME "capitalisation mismatch" landmine #3's GWDRDT entry already named for this one item; it was never generalised to see it was the whole gap |
| `alchemical-hydra` | `Ikkle hydra` | `Ikkle Hydra`, 1/3000 |
| `phosani-s-nightmare` | `Little nightmare` | `Little Nightmare`, 1/1400 |

**This changes the honest status of two sources materially, and two not at
all.** `commander-zilyana` and `k-ril-tsutsaroth` were believed to carry a
small, real, unrelated-to-GWDRDT residual (`docs/HANDOFF.md`'s "GWDRDT own
residual" row) — their ENTIRE remaining `drops_covered` failure is this bug;
nothing else blocks either source. `alchemical-hydra` and `chaos-elemental`
were listed as "coverage gaps, unexamined per-source" — for both, this bug
is the WHOLE gap. Fixing the comparison (normalize case — and confirmed
nothing here needs more than that; every mismatch above is pure casing,
not whitespace, punctuation, or a `(qualifier)` naming-convention question
`coverageCandidates` already handles) would move all four straight to
`verified` with no other work. `chaos-fanatic` and `phosani-s-nightmare` do
NOT change status — both carry their own separate, already-permanently-
flagged wiki-weights-don't-reconcile defect (`chaos-fanatic`: 129 vs a
`/128` every row cites; `phosani-s-nightmare`: 101 vs `/100`), so `weights_sum`
keeps them `needs_review` regardless of this fix — but their OWN
`drops_covered` line, previously read as "a real, separate, coincidental
second issue" (`chaos-fanatic`) is now shown to be this bug too, not a
second real gap.

**Not fixed here — flagged, not attempted, because task scope for this
session was an honest audit, not a change to shared validation code that
would touch `not_on_watchlist`/`verified` status for four sources at once.**
The fix itself looks small (lowercase both sides before the `Set`
comparison in `checkDropsCoveredAgainst`, matching `coverageCandidates`'s
existing narrow-translation discipline rather than fuzzy-matching), but
"small" changes to a check that gates `verified` across the whole corpus
still deserve their own session: a test asserting the case-insensitive
match, a re-run of `ingest parse` (no `--tier` filter) to confirm the
corpus-wide effect, and a check for whether any OTHER source's
`drops_covered` failure is partially explained by this too (a scan across
all 30 `needs_review` sources for this session found no additional casing-
only matches beyond the six above, but that scan did not use the exact
match-and-flag mechanism a real fix would, only manual spot checks).

**Distinguish from `mad-angel`'s and (partly) `black-demon`'s residuals —
those are a DIFFERENT class**, where the bucket and the current wikitext
disagree about whether an item is dropped at all (a real content question,
not a string-matching one) — see the "Mad Angel's compound shape: built"
entry above. This bug is purely comparison logic; that one is the two data
sources genuinely disagreeing about game state.

## `checkDropsCoveredAgainst` case fix, built — plus five more sources, plus a general parser fix the case fix exposed

Picks up exactly where the audit above left off: implemented the case-insensitive
comparison it deferred, then followed each residual it exposed to a real cause
rather than stopping at the first green number. **Net effect on the corpus: 67 ->
72 verified, 30 -> 22 needs_review, 2 -> 5 manual_override**, via a full unscoped
`ingest parse` + `ingest item-icons` + `ingest site-index`, `pnpm -r test`/
`typecheck`/`lint` all clean.

### The case fix itself

`checkDropsCoveredAgainst` (`drops-covered.ts`) now lower-cases both sides of the
`reachable`/`bucketNames` comparison — exactly the change the prior audit
described and declined to make in-session. **Safety guard, not assumed**: a new
corpus-wide test (`drops-covered.test.ts`'s "case-insensitive matching does not
collide distinct items") walks every item node in `data/bosses/*.json` plus every
`data/tables/*.json` shared record and asserts no two DIFFERENT `itemId`s share a
case-folded name — zero found. The only same-name collisions in the whole corpus
are two items citing themselves with inconsistent capitalisation across sources
(`Wine of zamorak`/`Wine of Zamorak`, `Little Nightmare`/`Little nightmare` — same
`itemId` both times), which is the bug this fix targets, not a counterexample to
it. If that guard ever finds a real collision, the fix must stop being blanket
case-insensitive for the colliding pair specifically — the test's own failure
message says so.

**Moved straight to `verified`, no other work needed**, exactly as the prior
audit predicted: `commander-zilyana`, `k-ril-tsutsaroth`, `chaos-fanatic`,
`alchemical-hydra`. (`chaos-elemental` did NOT move — its own `drops_covered`
failure turned out to be a real, uninvestigated gap under a `heading` ambiguity
note, not casing; the prior audit's four-source prediction included it based on
an incomplete cross-check. `phosani-s-nightmare` also stays `needs_review`,
correctly, on its own permanently-flagged weight-drift.)

### Yama: the Contract fix already landed; the real residual was a param-casing bug

`docs/HANDOFF.md` already recorded Yama's `always`+`fixed` `Contract`-heading
overflow (1801/100) as fixed in an earlier session, and `weights_sum` confirms
it — that fix is real and does not need revisiting. The 18 `drops_covered`
misses left after the case fix (`Blood rune`, `Pineapple pizza`, ...) are a
**different, previously-undiagnosed bug**: Yama's `Supplies`/`Runes`/`Other`
headings mix `Rarity=`/`Quantity=` (capitalised) with `rarity=`/`quantity=`
(lowercase) DropsLine params in the same block — `parseTemplateCall`
(`wikitext-drops.ts`) read param keys case-sensitively, so every capitalised row
silently got `rarity: ''` and, worse, took its whole heading block down with it
(see the general parser fix below). Fixed generally: named param keys are now
lower-cased in `parseTemplateCall`, not just for Yama — every consumer already
reads a lowercase literal (`params.get('rarity')` etc.), so this is a pure
recovery. Confirmed correct, not assumed: the wiki's own rendered dropsline
bucket still lists all 18 affected items, so whatever resolves `{{DropsLine}}`
server-side already treats the casing as equivalent.

Fixing the casing bug exposed a THIRD, real, previously-invisible defect: once
`Supplies`'s six rows parse, they merge into the wiki's own single `/95.11`
weighted table (`Weapons and armour`/`Runes`/`Other`, matching the wikitext's own
`<!-- main table has 78 slots -->` comment) at 108 against denominator 95.11 —
overflow. The `Supplies` heading is a Mad-Angel-shaped compound bundle: one
15/95.11 access roll grants THREE independent binary choices at once ("Either
3-4 pineapple pizzas or wild pies", "Either 2 prayer potion(3) or 2 super restore
mix(2)", "Either 1 super combat potion(1) or 1 Zamorak mix(2)"), parsed as six
independently-competing rows (weight 7.5 each, summing to 45 instead of 15). The
corpus-wide bundle detector (`checkBundleSignals`/`findBundleGroups`) cannot
auto-confirm this: its `CO_DROP_PHRASES` list matches `dropped together`/
`bundled with`-style footnotes, not this block's "...chance of getting a supply
drop. It will include: * Either A or B..." prose, and even if it matched,
`findBundleGroups`'s `BundleGroup` model only expresses ONE flat set of
always-co-occurring items — not three independent nested pairs. Same
expressivity gap Mad Angel's compound shape hit. **Hand-authored
`data/overrides/yama.json`, following Mad Angel's shipped precedent exactly**:
`data/tables/yama-supplies-bundle.json`, an `always`-mode table with three
`oneOf` entries (one per pair), spliced into the merged weighted pool as a
single `tableRef` row at weight 15. New pool total 16+14+33+15=78 against
denominator 95.11 — matches the wikitext's own "78 slots" comment exactly.
Behaviourally verified via a 500k-kill `simulate()` run (ad hoc, not committed,
matching Mad Angel's own verification precedent): all three pairs' drop counts
are IDENTICAL (65,455 each) confirming they always co-occur, and no kill ever
logs both variants of one pair. Yama reaches `manual_override`.

### `Module:GeneralSeedDropLines` reimplemented — the corpus's one genuine Lua-only gap

`black-knight-titan`'s and `obor`'s `===Seeds===` headings are
`{{GeneralSeedDropLines|<accessRate>|<combat level>}}`. Unlike its wikitext-based
siblings (`TreeHerbSeedDropLines` etc., which use `#vardefine`/`#expr` —
evaluable by `expand-transclusions.ts`), `Template:GeneralSeedDropLines`'s own
snapshot is a bare `<includeonly>{{#invoke:GeneralSeedDropLines|main}}</includeonly>`
— pure Lua, genuinely unexpandable, confirming the prior recount's "genuine
residual, reported by name" verdict exactly. Corpus-wide grep confirms these are
the ONLY two sources using this template.

**Fetched and reimplemented the module's actual logic** (one legitimate one-off
research fetch, same category as the GWDRDT/ToA/CoX/ToB `Module:`/`Calculator:`
fetches CLAUDE.md's rule already permits): a `data` table keyed by six
combat-level brackets (485/728/850/947/995/99999, i.e. combat level x10), and
`groupSeeds()` walks every bracket up to and including the one straddling the
monster's own combat level, multiplying the access rate by that bracket's own
share of the combat-level range and by the seed's own within-bracket weight.
**Verified two independent ways before shipping, not assumed correct from
reading the source alone**: (1) the reconstructed formula produces exactly the
44 seed names the wiki's own dropsline bucket lists for BOTH sources, and
several spot-checked items' own `floor()`'d display rarities
(`Potato seed` 1/48, `Wildblood seed` 1/1210, `Torstol seed` 1/88888` on Black
Knight Titan) match the bucket exactly; (2) algebraically, the per-bracket
relative weights sum to that bracket's own denominator and the per-bracket
combat-range shares sum to 1 across every contributing bracket, so the 44 RAW
(pre-`floor()`) per-seed probabilities sum EXACTLY to the declared access rate —
a true partition. Pinned by `apps/ingest/test/general-seed-drop-lines.test.ts`.

**Modelled with RAW, not `floor()`'d, per-seed weights — a real precision
decision, not a style choice.** The wiki's own displayed `1/N` figure rounds
each seed's denominator DOWN independently, so sum of the 44 displayed figures
overshoots the true access rate (measured: 0.29% on Black Knight Titan, 0.74% on
Obor — worse there because its combat level lands the roundings differently),
enough to fail `marginal-rates.test.ts`'s 0.5% tolerance on Obor specifically,
and by up to ~2% on individual large-share seeds (`Potato seed`: true rarity
1/44.90 displays as 1/44). The raw values reproduce the access rate to float
precision — the true in-game mechanic almost certainly rolls on the continuous
probability; `floor()` is the wiki's OWN display convention, not the mechanic.
Both sources added to `marginal-rates.test.ts`'s `AUTHORED` exclusion list,
each with its own reason and pointing at `general-seed-drop-lines.test.ts`
matching the file's own "each carries its own wiki-figure test" discipline.
Both reach `manual_override`.

### `items_known`'s literal-`Nothing` gap, closed generally

`docs/HANDOFF.md`'s "heuristic 5 gap" already named this: Black Knight Titan and
Salarin the twisted both write a literal wiki `Nothing` drop row (`itemId:
null`, `itemKey: 'nothing'`), which `items_known` correctly refused to resolve
against the item index (it isn't a real item) but had no exception for either —
so it failed as if it were a genuine unresolved item. `drops-covered.ts`'s
`NOT_ITEM_NODES` already carves out the identical sentinel by name for the
coverage check; `checkItemsKnown` (`items-known.ts`) now does the same, by
`itemKey`, narrowly (`itemKey === 'nothing' && itemId === null` — a node keyed
`'nothing'` with a real id is NOT exempted). General, not per-boss: also closes
the identical gap on `obor` (2 `Nothing` rows) discovered while investigating,
which the recount never separately counted. `salarin-the-twisted` reaches
`verified`.

### Three item-index gaps, recorded on the multi-id allowlist, not guessed

- **`chronozon`**: its DropsLine names the drop `Crest part (Johnathon)`, but
  `infobox_item` only knows the underlying page as `Crest part` (id 780, one
  row per Family Crest quest-boss's own fragment). Same shape as the existing
  `gull-pet` entry (a name-matching gap between the drop-table label and the
  item's own infobox name, not a genuine multi-id collision) — verified
  directly against the wiki that `Crest part (Johnathon)` resolves to id 780,
  which is also `infobox_item`'s own `default_version` candidate for `Crest
  part`. Reaches `verified`.
- **`maggot-king`'s six `Maggot egg (...)` variants**: a genuine multi-id
  collision, unlike the two cases above — all 6 raw ids share the IDENTICAL
  `item_name`/`page_name` (`Maggot egg`) in `infobox_item`, with no signal
  (default_version, a qualified page name, or otherwise) distinguishing which
  raw id is `base` vs `sickly` vs `warm` etc. Recorded on the allowlist rather
  than guessed — assigning the wrong id to the wrong variant would be a real
  error (wrong icon/GE price), worse than the `itemId: null` it replaces.

### `buildTableGroups` no longer discards a whole heading block for one bad row — closes most of nex/kalphite-queen/maggot-king

Investigated per instruction before touching anything (`nex`/`kalphite-queen`/
`maggot-king` were the three `drops_covered` gaps HANDOFF's own recount left
unexamined). **All three turned out to share one root cause**, confirmed by a
corpus-wide grep for `rarity=(Common|Uncommon|Rare|Once|...)` finding exactly
these three sources and no others: the wiki sometimes states a row's rarity as
a qualitative word instead of a fraction, which `parseRarity` correctly refuses
to guess at — but `buildTableGroups` discarded the ENTIRE heading block the
moment ANY one row failed to parse, taking every well-formed sibling row down
as collateral damage.

- **`kalphite-queen`** (the one flagged for special attention — "rows exist in
  wikitext but don't reach the document and you haven't diagnosed why"):
  **diagnosed, not a mystery.** Its `Tertiary` heading has 10 rows; one
  (`Kq head (tattered)`, `rarity=Once` — a genuine one-time drop, guaranteed on
  the 256th kill, with no per-kill rate at all) is unparseable, and it took the
  other 9 clean fractions (`Dragon 2h sword` 1/256, `Jar of sand` 1/2000,
  `Kalphite Princess` 1/3000, ...) down with it.
- **`maggot-king`**: its `Drops (take-eggs)` heading mixes six clean
  `Maggot egg` fractions with three `Common`/`Uncommon` rows (`Nothing`,
  `Stymphike tartare`, `Dull ancient medal`) — same collateral pattern.
- **`nex`**: worse in kind — 3 of its 4 affected headings
  (`Runes and ammunition`/`Resources`/`Consumables`) are ENTIRELY
  `Common`/`Uncommon`, checked directly against the page and confirmed no
  Calculator/Module page exists anywhere with real numbers backing them. Only
  `Other` mixes word- and fraction-rarity rows.

**Reported before fixing, per instruction** (a general fix to shared parsing
logic, not a per-boss patch, deserved sign-off given its corpus-wide blast
radius) — approved, then implemented: when a block has SOME unparseable rows,
`buildTableGroups` still emits the exact same zero-entry `ambiguous`-flagged
marker group as before (the loss is still reported, and still blocks
`verified` — this is real missing information, not cosmetic), but now ALSO
continues processing the PARSEABLE rows through the ordinary pipeline
(bundle detection, heading-text mode inference, homogenise/merge) exactly as if
the bad rows never existed. When EVERY row in a block is unparseable (Nex's
fully-word-rarity headings), behaviour is byte-identical to before — nothing to
salvage. Pinned by two new `build-tables.test.ts` cases (the salvage path and
the unchanged all-unparseable path) plus `corpus-reproducibility.test.ts`.

**Result**: `kalphite-queen` drops from 10 missing to 1 (`Kq head (tattered)` —
genuinely unrepresentable as a per-kill rate, no fix recovers it; stays
`needs_review`, correctly, same class as Duke Sucellus' own named remnant).
`maggot-king` drops from 6 missing to 0 (its remaining `ambiguous` note is the
`Common`/`Uncommon` supply-drop rows, still correctly flagged, still blocking
`verified`; recovering the 6 `Maggot egg` variants surfaced a NEW `items_known`
gap, closed via the multi-id allowlist above). `nex` drops from 24 missing to
21 (`Blood essence`/`Rune sword`/`Nihil shard` recovered from its `Other`
heading; the other 21 stay flagged — genuinely no number exists to recover them,
same class as Zalcano's own unstated curves). None of the three reach
`verified` — each has a real, named, correctly-flagged residual now, not a
diagnosed-but-silent one.

### `corpus-reproducibility.test.ts`'s GE-price flake, fixed

`ev_matches`'s `detail`/`gpPerKill`/`wikiValue` are computed from LIVE GE prices
(`fetchGePrices`, never snapshotted, by design — see `ev-matches.ts`'s own
header) and are explicitly advisory, never part of the `verified` gate. But
`corpus-reproducibility.test.ts`'s `deepStrictEqual(fresh, committed)` compared
these fields byte-for-byte anyway, so any GE price movement between commit time
and test time would fail the whole suite for a reason that is not a parser or
data regression — Brutus is the one committed document with a rendered-HTML
snapshot behind it, so it is the one source whose `ev_matches` embeds a
live-computed figure (`"338.58 gp/kill vs wiki's 597.57, 43.3% off"`) that can
drift. Fixed by blanking `ev_matches`'s volatile sub-fields (not the whole
check — `check` itself still catches the check disappearing outright) on both
`fresh` and `committed` before comparing, so the guard stays meaningful for
everything ev_matches is NOT: every other field, on every other source, is
still compared byte-for-byte. Did not reproduce live today (GE prices happened
not to move during this session), so this is a preventive fix confirmed not to
break anything, not a fix proven against a live failure.

## `GeneralSeedDropLines`: the first case where the model is MORE precise than the wiki's own displayed rates — a real risk for `drops_covered`/`marginal-rates`, worth naming before it recurs

Black Knight Titan's and Obor's `Seeds` heading (`docs/DECISIONS.md`'s
"`Module:GeneralSeedDropLines` reimplemented" entry, above) is modelled with
RAW, un-`floor()`'d per-seed weights, not the wiki's own displayed `1/N`
figures — a deliberate precision decision, not a style choice. The wiki's
displayed rarity independently floors each of the 44 seeds' denominators, so
the 44 displayed figures overshoot the true access rate by a measured 0.29%
on Black Knight Titan and 0.74% on Obor (worse there because its combat level
lands the roundings differently), and by up to ~2% on individual large-share
seeds (`Potato seed`: true rarity 1/44.90 displays as 1/44). The raw model
reproduces the declared access rate to float precision; the wiki's own
display convention does not.

**This is the first source in the corpus where the MODEL is more precise than
the wiki's own rendered numbers — every other source in the project has had
the opposite shape** (the model approximating, simplifying, or falling short
of what the wiki states). Worth naming as its own case, not folding into the
GWDRDT-style "fixed a defect" entries, because the failure mode it risks is
the inverse of every other one this project has guarded against:

- **`drops_covered`** (`apps/ingest/src/validate/drops-covered.ts`) compares
  the document against the wiki's own `dropsline` bucket by ITEM NAME, not
  rate — both Black Knight Titan and Obor pass it cleanly today because the
  44 seed names match exactly, and `drops_covered` has no opinion on the rate
  attached to a name it already recognizes.
- **`marginal-rates.test.ts`** is the one check that DOES compare a computed
  per-item rate against the wiki's own figure — and both sources are
  deliberately on its `AUTHORED` exclusion list for exactly this reason (see
  the "reimplemented" entry), each pointing at
  `general-seed-drop-lines.test.ts`'s own wiki-figure pinning instead. That
  test's real oracle is the RECONSTRUCTED MODULE LOGIC (verified two
  independent ways: name-for-name match against the dropsline bucket, and the
  44 raw probabilities summing to the declared access rate to float
  precision), not the wiki's displayed `1/N` column — so this pair does not
  currently trip `marginal-rates`' tolerance, but only because they are
  excluded from that check's oracle rather than because the check would
  agree with the model if asked.

**The risk for a future session**: `marginal-rates.test.ts`'s tolerance
(0.5%, see its own header) is built assuming the wiki's displayed figure IS
the ground truth being approximated — the only shape the project had seen
until this pair. If a THIRD source turns up where the correct model is
provably more precise than the wiki's own rounding (another `{{#invoke:}}`
Lua template reimplemented from source, most likely), the reflex "the model
disagrees with the wiki, so the model is wrong" would be backwards here — the
wiki's displayed column is itself the approximation in this shape, not the
oracle. Before adding a third source to `AUTHORED` on this basis, re-derive
independently (as this pair did: reproduce the source logic, verify the
reconstructed rates sum to the declared access rate algebraically) rather
than assuming the exclusion list is itself precedent enough to extend by
inspection alone.

## Suggested bosses on the empty search state: alias-count weighting tried, measured, and reverted

`apps/web/src/lib/suggestions.ts`'s `pickSuggestedBosses` first shipped
weighted by `1 + aliases.length` — a boss with more recorded
nicknames/variant spellings (the Godwars generals, Vorkath) was assumed to be
one people actually look up, against `Melzar the Mad`-shaped obscure content
with none. Checked against the real corpus before trusting it, not left as an
assumption: `data/index.json`'s entire 99-source corpus has exactly ONE entry
with any alias at all (`reward-pool`'s `['Tempoross reward pool',
'Tempoross']`) — and that source is `needs_review`, never reachable through
the suggestion pool's `repeatable && verified` filter anyway. Every one of
the 45 pool candidates therefore carried `aliases.length === 0`, making the
Efraimidis-Spirakis weighted sampler mathematically identical to uniform
random while presenting as if it favoured anything.

**Measured, not just reasoned about**: a 20-page-load sample (80 picks at 4
per load) surfaced 38 of the 45 pool sources, with `Salarin the twisted` and
`Eldric the Ice King` appearing exactly as often as `Cerberus` and
`Corporeal Beast` — flat noise, not a prominence signal. No other
derivable-from-data prominence proxy exists in the corpus either (drop-table
size, popularity, anything) — checked, not assumed absent, per
`apps/web/src/lib/suggestions.ts`'s own header comment.

**Reverted to plain (partial Fisher-Yates) random over the same
`repeatable && verified` pool.** A proxy that does not correlate with the
thing it claims to weight toward is worse than no proxy at all: it implies a
curation this project never actually did, which is a stronger, more
misleading claim than "these four are arbitrary." This is not a placeholder
pending a better signal — it is the honest answer given what the corpus
currently contains, and should only be revisited if a real per-boss
prominence field (drop-table size, view counts, anything) is added to
`data/` itself, not by reaching for `aliases.length` again on the same
data.

## CoX's `not_on_watchlist` detail was stale (pre-override text on a post-override source); rewritten, not resolved — Metamorphic dust's time threshold checked against `Module:Chambers of Xeric calculator` and confirmed genuinely absent

`data/mechanics-watchlist.json`'s `ancient-chest` entry still carried the
`detail` text written before `data/overrides/ancient-chest.json` existed — it
described the pre-override generated document's ~100%-unique-rate bug (two
ungated independent tables rolling on every kill) as if that were still the
reason for `needs_review`/tier `approximate`, which was simply false: the
override has modelled `cox_points`, the nested herb/seed `oneOf` structure,
and the ownership gates for over a session's worth of history now (see this
file's own "Phase 7: Chambers of Xeric shipped" entry). `not_on_watchlist`'s
`detail` is what `apps/web`'s tier-3 "Approximate" badge shows a user as the
reason — a stale reason is actively misleading, not merely untidy, since it
tells a user the wrong thing is wrong.

**Checked whether any of CoX's three named residuals is actually resolvable
before rewriting the text, per instruction** — specifically re-read
`Module:Chambers of Xeric calculator`'s full wikitext
(`data/snapshots/wikitext/module-chambers-of-xeric-calculator.json`) end to
end, since ToA's, ToB's, and CoX's own prior "UNKNOWN" constants have all
previously turned out to be stated in a `Module:`/`Calculator:` page the
prose alone didn't have (this file's ToA and "Phase 7: Chambers of Xeric"
entries). Result differs by residual:

1. **Per-player, not per-party** (`ctx.points` stands in for the whole
   raid's points, `personalRatio = 1`, matching a solo run) is not a missing
   fact — the module's own `personalRatio`/`args.split`/`args.teamSize`
   logic proves the real per-player split is fully specified on the wiki.
   It's unmodelled because this simulator's unit is one player, not a raid
   group (the same scope line as Theatre of Blood's team allocation and
   ToA's team size) — a scope decision, not a research gap, and not
   resolvable by finding a formula.
2. **Ancient tablet's "replaces one of the loot rolls"** remains an
   engine-capability gap, not a data gap: no run-scoped mechanism exists for
   one table's hit to reduce another table's roll count. Already modelled as
   a small, bounded, quantified overstatement (an additional independent
   1/10 roll) rather than left as a guess.
3. **Metamorphic dust's "if the raid was completed within a certain time"
   qualifier — checked specifically, confirmed NOT stated anywhere
   reachable.** `Module:Chambers of Xeric calculator`'s full source (~140
   lines, read in full) never touches tertiary rewards at all: Dark journal,
   Ancient tablet, Metamorphic dust, and Twisted ancestral colour kit appear
   nowhere in it — its scope is strictly the unique-roll and common/trash EV
   tables (`p.main`'s only outputs). The `Ancient chest` page's own
   `raritynotes` citation for this line is a `{{CiteVideo}}` reference to a
   21 June 2018 developer Q&A YouTube video at a specific timestamp, not a
   written number — the wiki's own editors evidently never had one to write
   down either. Also checked and empty: the main `Chambers of Xeric` page's
   full wikitext for `time limit`/`speedrun`/`personal best`/`completion
   time` (the one `completion time` hit is an unrelated 2019 patch-note line
   about the adventure log displaying fastest-completion times, nothing to
   do with a loot gate). **This is the genuinely-unknowable case, not a
   repeat of ToA/ToB's "it was in the module all along."**

**Action taken: `detail` rewritten to name all three residuals precisely and
explain why each is unmodelled (scope decision / engine gap / genuinely
unstated), replacing the stale pre-override text. `tier` stays
`approximate`; `mechanic` stays `point_scaled`; `blockedBy` unchanged
(already correct). Status stays `needs_review` — none of the three residuals
resolved, so CoX does NOT move to `manual_override`.** Re-ran `ingest parse
--source ancient-chest` to regenerate `data/bosses/ancient-chest.json`'s
`statusReason` from the new `detail`; full `pnpm -r test`/`typecheck`/`lint`
clean afterward, including `corpus-reproducibility.test.ts`,
`watchlist.test.ts`, and `brutus-snapshot.test.ts` as the regression gate.
Do not re-open Metamorphic dust's threshold expecting a number to exist
without a new primary source (e.g. someone transcribing the cited video) —
it is not sitting unread in a page or module this project has snapshotted.

## Raid loot is modelled per player, solo, everywhere — one scope decision, not three separate per-source approximations

Chambers of Xeric's, Theatre of Blood's, and Tombs of Amascut's reward
chests each treat `ctx.points` as the WHOLE raid's points rather than one
player's share of a group total — every override's own `note` already says
this identically: CoX's "Modelled per player, solo — `ctx.points` is this
player's own points, matching Chambers of Xeric's own module which sets
`personalRatio=1`... for a solo run"; ToB's team/party allocation is
"a multi-player mechanic this project's single-player `SimContext` is not
built for"; ToA's "One chest for one player is this simulator's unit, so
team size is out of scope rather than approximated." Three overrides,
written in different sessions, converged on the identical sentence because
it is the same fact every time: this project's `SimContext` models one
player, not a raid party, full stop — nothing group-shaped is in scope
anywhere in the codebase, not just on these three sources. It is a global
architecture decision, not a per-boss modelling gap, and it is not
resolvable by researching any one source harder — a party-points formula
being fully known (as ToB's and CoX's now are, via their own
`Module:`/`Calculator:` pages) does not change that this simulator only
ever computes one account's own chest.

**Documented once here rather than restated in full in each of the three
watchlist entries**, which is a direct lesson from the CoX staleness fix
above: three independently hand-maintained copies of the same paragraph is
exactly the shape that drifts out of sync when only one of the three gets
touched. Each of `chest-tombs-of-amascut`'s, `ancient-chest`'s, and
`monumental-chest`'s `data/mechanics-watchlist.json` entries now carries a
short one-clause pointer to this entry instead of re-deriving the reasoning;
the full reasoning behind why "solo" is treated as an approximation worth
naming (rather than just quietly true) lives in each override's own `note`,
unchanged. Not a claim that this will ever be resolved — a genuinely
different, multi-player `SimContext` is out of this project's stated scope,
not a missing formula.

## Watchlist audit: `not_on_watchlist` detail checked source-by-source against what's actually built, not assumed current

Prompted directly by the CoX staleness bug above: if one entry's user-facing
`detail` can silently describe a fixed bug instead of the real remaining
gap, any of the other seven could too, and nobody had checked. Went
through all eight entries in `data/mechanics-watchlist.json`, cross-reading
each against `data/overrides/` (does an override exist at all?), the
relevant `apps/ingest/test/*.test.ts` file (does a wiki-figure test exist?),
and that override's own `note` (what does IT say is actually modelled and
what's deliberately left out?) rather than trusting the watchlist's own
prose. Two more were stale in the identical CoX shape (describing a
pre-override state on a now-shipped source); one was accurate but
incomplete; four were already current and needed no change:

- **`reward-pool` — STALE, same shape as CoX.** The entry read "Rolls scale
  with reward permits... Needs the tempoross_points formula", as if nothing
  had been built. In fact `data/overrides/reward-pool.json` has shipped for
  multiple sessions (12 wiki-figure tests, `apps/ingest/test/reward-pool.
  test.ts`), modelled exactly at the permit unit the page itself uses. The
  real remaining gap is narrower and different: only the points-to-permit
  conversion is unstated (the rounding rule for "1 per 700 points, with a
  chance at rounding up" is never given), which is why `tempoross_points`
  stays a stub — everything else about the redemption table itself is
  exact. Rewritten to say so. **`tier` stays `unknown_scaling`** — the
  residual is still a genuinely unstated function, not a bounded
  simplification, so it does not qualify for `approximate` under that tier's
  own definition (`apps/ingest/src/validate/watchlist.ts`'s
  `WATCHLIST_TIERS` comment) even though the shipped part is exact.
- **`monumental-chest` — STALE, same shape as CoX, more severely.** The
  entry read "needs the tob_points formula" verbatim, but `tob_points` has
  been a real, tested implementation (not a stub) since the same session
  that shipped all four raids — `IMPLEMENTED_FORMULA_IDS` has included it
  the whole time. `data/overrides/monumental-chest.json` (22 wiki-figure
  tests) models the points-scaled unique roll, the Normal/Hard Mode weight
  split, Hard Mode's stated 1.30x time bonus, and the Cabbage/Message
  zero-points gate. The real remaining residuals — team/party allocation
  (now just a pointer to the entry above), the tertiary "individual
  performance" rates' unstated magnitude (a genuine unknown, not
  approximated), and Entry Mode's unconfirmed points/death interaction with
  its flat -80% — are completely different from what the old text named.
  Rewritten in full. **`tier` unchanged (`approximate`)** — matches the
  other three raids' precedent of one entry covering both a bounded,
  quantified residual and a genuinely-unstated one.
- **`rewards-chest-fortis-colosseum` — STALE, and the old text described a
  problem that turned out not to exist.** It claimed "No formula for this
  is in PROJECT_PLAN.md's section 4.6 registry yet — it needs a new one",
  but the shipped override (`data/overrides/rewards-chest-fortis-colosseum.
  json`, 14 wiki-figure tests) needed no new formula at all: each of the 12
  waves is its own complete, self-contained weighted table exactly as
  published, and `ctx.wavesReached` is selected by an ordinary
  `levelAtLeast` condition. The real, current, and much narrower residual is
  the wave-scoped Sunfire fanatic armour duplicate-protection rule, shipped
  as a quantified with-replacement approximation because whether the
  protection resets per attempt or is a permanent account-wide guarantee is
  not stated anywhere checked (checked across two separate sessions — see
  this file's own Fortis Colosseum entries). Rewritten in full, including
  the quantified cost (~0.20% vs ~0.00025% true chance of a same-run
  duplicate — ~800x relative, both absolute-tiny; a 3-piece set in one run
  understated ~4.4x). **`tier` unchanged (`approximate`)**.
- **`reward-cart` — NOT stale (nothing has been built; `data/bosses/
  reward-cart.json` is still `source: generated`), but INCOMPLETE.** The old
  one-line "Needs the wintertodt_points formula" underclaimed the blocker:
  even with that formula built, two separate hard stops (both already
  diagnosed in this file's own "Reward pool and Reward Cart: NOT built, and
  precisely why" entry, just never carried over into the watchlist's own
  text) would still block it — the Logs sub-table's Woodcutting-scaled rates
  are never given a number at all, and the pyromancer outfit roll is a
  relative comparison across four item counts, a shape `ownershipGate`
  cannot express. Rewritten to name both. **`tier` unchanged
  (`unknown_scaling`)** — still correctly blocked, just for reasons the text
  now actually states.
- **`duke-sucellus`, `zalcano` — checked, already current, no change.** Both
  entries already describe the live state precisely (`duke-sucellus`: no
  override exists, matching `data/bosses/duke-sucellus.json`'s
  `source: generated`; `zalcano`: the override's own scope — what's modelled
  vs. the two genuinely-unstated curves — matches `data/overrides/
  zalcano.json`'s `note` and `IMPLEMENTED_FORMULA_IDS`'s stub status for
  `zalcano_points` exactly).
- **`chest-tombs-of-amascut` — checked, already current; only the team-size
  clause was trimmed** to a one-line pointer at the new shared-scope entry
  above, for the same reason `ancient-chest`'s and `monumental-chest`'s
  full paragraphs were trimmed to pointers rather than each restating the
  "one player, not a party" reasoning in full.

**Cross-reference discipline, worth naming since it is easy to violate by
accident**: entries must not name another watchlist source's own boss-page
title as a whole word (`checkWatchlistConsistency`'s rule 4a) or a formula
id whose subject belongs to a different source (rule 4b) —
`watchlist.test.ts`'s real-corpus assertion enforces this. Where these
rewrites needed to reference another source's shape (Reward Cart's "same as
elsewhere on this watchlist" instead of naming Zalcano or Duke Sucellus by
title), they were phrased generically rather than by title, matching the
existing entries' own established discipline rather than introducing a new
violation while fixing an old one.

**Net result: two entries moved from describing a fixed bug to describing
the real residual (`reward-pool`, `monumental-chest`), one moved from a
phantom problem to the real one (`rewards-chest-fortis-colosseum`), one
gained the two hard stops it was missing (`reward-cart`), one had a
duplicated paragraph trimmed to a pointer (`chest-tombs-of-amascut`), and
`ancient-chest` (this session's earlier fix) also had its own team-size
paragraph trimmed to the same pointer. No `tier` moved on any of the eight
— every rewrite was a text-accuracy fix, not a re-classification. Two
sources (`duke-sucellus`, `zalcano`) needed no change at all.**

## A trip wire for the two staleness shapes that actually occurred, not a general prose validator

The audit above fixed the six stale entries by hand; nothing stopped a
seventh from drifting the same way tomorrow. Added two new rules to
`checkWatchlistConsistency` (`apps/ingest/src/validate/watchlist.ts`) —
rules 5 and 6, alongside the existing four — that check `detail` against the
codebase instead of only against `data/_inventory.json`. Deliberately narrow,
matching the instruction: these catch the two SPECIFIC shapes that produced
this session's bugs, not prose drift in general (which cannot be checked
mechanically without a real false-positive risk).

**Rule 5 — a formula claimed still-needed that is already implemented.**
`formulaIdsClaimedNeeded` extracts identifiers from the phrasing this
project's own entries have used for the claim every time so far — "needs the
X formula" / "needing ... X formula", tolerant of "the"/"still-stub"/"a
new" and need/needs/needing/needed — via `NEEDS_FORMULA_PATTERN`, filters to
real `FormulaId`s (so it can't fire on ordinary prose that happens to end in
"formula"), and flags any that `IMPLEMENTED_FORMULA_IDS` already has. This
is exactly `ancient-chest`'s and `monumental-chest`'s old bug reproduced
mechanically: both literally said "needs the cox_points/tob_points formula"
after those formulas had shipped. Deliberately does NOT fire on a formula
mentioned any other way — "models ... (cox_points: ...)", stating what it
does rather than claiming it's needed — matching the "narrow the signal, act
only when unambiguous" discipline rule 4b and `build-tables.ts`'s own
detectors already use. Verified it does NOT catch `reward-cart`'s/`reward-
pool`'s real, still-accurate "needs the wintertodt_points/tempoross_points
formula" claims (both genuinely still stubs) — the rule's whole job is to
distinguish these two cases, not to flag every such sentence.

**Rule 6 — an override exists but `detail` never mentions it.** The
complementary half: `reward-pool`'s old text was not caught by rule 5 (its
one formula claim, `tempoross_points`, is still genuinely a stub — the
override shipped everything else) but was still describing a document that
no longer existed. Every entry that accurately describes a shipped override
already cites its own `data/overrides/<slug>.json` path as a matter of house
style (checked directly across all eight current entries before relying on
it as a signal); an entry that doesn't, for a source where that file exists,
is the same "written before the override existed, never revisited" shape.
Takes `overrideSlugs: ReadonlySet<string>` as a new third parameter,
**defaulted to an empty set** — `checkWatchlistConsistency` stays pure (no
filesystem access inside it), and every existing call site/test that
doesn't care about override-existence needed zero changes. The two real
callers (`main.ts`'s `parseCommand`, `watchlist.test.ts`'s real-corpus
assertion) pass the actual set via the already-existing `listOverrideSlugs()`
— `main.ts` only needed its existing `overrideSlugs` computation hoisted
earlier, not new logic.

**Both verified against the real corpus, not just synthetic fixtures**:
`watchlist.test.ts`'s real-data test now passes `realOverrideSlugs` and
still asserts zero issues — proving the six rewrites this session actually
satisfy both new rules, not just that the rules compile. One pre-existing
synthetic test (`draws no conclusion from a formula with no boss page of its
own`) had its fixture text changed from "Needs the toa_invocation formula"
to "computed via the toa_invocation formula" — the old phrasing, written to
test rule 4b in isolation, incidentally also matched rule 5 now that
`toa_invocation` is a real implementation, which would have made that test
assert something no longer true rather than testing what it was written to
test. Six new dedicated tests cover both rules' fire/stay-quiet cases,
including the two straight from this session's real bugs
(`implementedId`/`stubId` picked dynamically from the real `FORMULA_IDS`/
`IMPLEMENTED_FORMULA_IDS`, not hand-picked ids that could go stale
themselves). Full `pnpm -r test`/`typecheck`/`lint` clean, 566 tests
(`apps/ingest`) including `corpus-reproducibility.test.ts` and
`brutus-snapshot.test.ts` as the regression gate.

## `docs/bosses/*.md`'s formula-status claims: the fourth stale-verdict bug, fixed by pointing instead of restating, plus a mechanical check

The eight-entry watchlist audit above found the pattern once. Checking
whether it recurred elsewhere in the repo found it immediately, in the
exact place `docs/HANDOFF.md` already flags as prone to this
(`doom-of-mokhaiotl.md`'s false "needs wave machinery" verdict,
`lunar-chest.md`'s own banner written wrong once already) — the 14
`docs/bosses/*.md` research docs' own "STALE, re-audited 2026-08-13/16"
correction banners. **13 of the 14 files (all but `chest-tombs-of-
amascut.md`, which never had a banner) ended their "Model capabilities now
available" paragraph with the identical copy-pasted sentence**: "...and real
implementations for every `FORMULA_IDS` entry (all still stubs)." True when
first written. False now — `IMPLEMENTED_FORMULA_IDS` has grown to 15 of 26.
**Two files carried a second, independent instance of the same bug, naming
one specific formula**: `ancient-chest.md` said `cox_points` "remains an
unimplemented `FORMULA_IDS` stub" (it shipped this session); `monumental-
chest.md` said the same of `tob_points`, twice, once inside its banner and
once in an already-corrected numbered list further down the file (someone
had already `~~strikethrough~~`-marked that list item's UNKNOWN-magnitude
claim as RESOLVED once, without revisiting the stub claim sitting right next
to it — the "written once, corrected once, drifted again" cycle in
miniature). Checked and confirmed still accurate, left untouched:
`duke-sucellus.md` (`duke_sucellus_ice_quartz`), `tzhaar-fight-cave.md`
(`tzhaar_fight_cave_tokkul`), `zalcano.md` (`zalcano_points`) — all three are
genuinely still stubs.

**Fixed per the preferred approach: point at the source of truth instead of
restating a fact that can drift from it.** The 13 generic sentences and the
3 specific claims were all rewritten to name `IMPLEMENTED_FORMULA_IDS`
(`packages/loot-model/src/formulas.ts`) as where to check, rather than
asserting a snapshot of which formulas are implemented. A fact stated in one
place — the actual `IMPLEMENTED_FORMULA_IDS` `Set` — cannot drift from
itself; a fact restated in fourteen markdown files can, and evidently does,
repeatedly.

**A mechanical check now backs this, `apps/ingest/test/docs-bosses-formula-
status.test.ts`, two rules:**

1. No `docs/bosses/*.md` file may claim every `FORMULA_IDS` entry is
   unimplemented ("all still stubs"), once `IMPLEMENTED_FORMULA_IDS` is
   non-empty — permanently true from here on, since nothing un-implements a
   formula.
2. No file may claim a SPECIFIC formula is still a stub/unimplemented when
   `IMPLEMENTED_FORMULA_IDS` actually has it — a proximity check (`stub` or
   `unimplemented` within 80 characters of a real `FormulaId` mention, either
   direction), not a hand-listed set of exact phrases, so it catches the next
   differently-worded claim too, not just this session's three. Deliberately
   does NOT fire on a formula that genuinely IS still a stub (the three left
   untouched above stay quiet).

**Both rules verified against the actual pre-fix files, pulled from git
history (`git show HEAD:docs/bosses/<file>.md`), not just the post-fix
state** — proving the check would really have caught this bug, not just that
it compiles. This surfaced one real gap while building it: the first draft
of rule 1 used a plain `\s+` between "still" and "stubs", which does not
span a markdown blockquote's `> ` line-continuation marker — and
`monumental-chest.md`'s original wrapped the phrase across exactly such a
line break (`(all still\n> stubs).`), so the naive regex silently missed the
one file it most needed to catch. Fixed generally (`stripBlockquoteMarkers`
strips every line's leading `> ` before either rule runs, not a special case
for that one file) and reverified against all 14 originals: 13 flagged,
`chest-tombs-of-amascut.md` correctly quiet (no banner, no claims), matching
expectations exactly before trusting the check going forward.

**Scope note, deliberately not chased further this session**: several of
these same banners also list which sources have a shipped override by name
("`data/overrides/` exists and is in use (ToA, Doom of Mokhaiotl, Lunar
Chest, Zalcano, Reward pool)") — a list that is now ALSO stale, missing
`ancient-chest`/`monumental-chest`/`rewards-chest-fortis-colosseum`, all
three shipped this session. Same decaying-negative-claim shape as the
formula-status bug, structurally the research-doc cousin of the watchlist's
own rule 6. Left alone: the task asked specifically for formula-
implementation claims, and widening scope mid-fix risks the same kind of
half-finished sweep that produced this bug in the first place. Named here so
it isn't mistaken for unknown, and named again in the instruction-update
entry immediately below.

## Was "read the docs/bosses/*.md banners as ground truth" ever the right instruction? No — replaced

`docs/HANDOFF.md` (not `CLAUDE.md`, which never mentions `docs/bosses/*.md`
at all — checked directly rather than assumed from how the question was
phrased) told every future session, in section 1: **"Read this before
`docs/bosses/*.md`: all 14 carry an in-file banner correcting their stale
capability verdicts,"** followed by "their mechanics and cited numbers are
accurate and are what to implement from" as the reason to trust them. That
framing was written after the SECOND staleness incident (`doom-of-
mokhaiotl.md`'s false "needs wave machinery" verdict) as a fix for it — and
between then and this session, the identical failure shape happened twice
more (`lunar-chest.md`'s own banner, written wrong once and self-corrected
in the same session per its own account; now these 13 formula-status
claims). Four incidents, same root cause each time: a hand-written claim
about current CODE STATE, asserted once, never mechanically re-checked.

**The instruction wasn't wrong about everything — it was wrong about not
distinguishing two different kinds of claim a banner makes:**

- **Facts about the wiki/mechanics** (drop rates, formulas, page citations)
  and **structural corrections** ("Gap 2 is RESOLVED via `Table.
  qtyMultiplier`" — a capability existing, once true, stays true) do not
  decay. Nothing in four incidents has ever found one of these wrong after
  the fact.
- **Negative/snapshot claims about current code state** ("X is still a
  stub", "X is still absent", "the generated document does Y" for a source
  that later shipped an override) decay by construction, because the whole
  point of a banner is to describe a moment before more work landed on top
  of it. Every one of the four incidents was this second kind.

**`docs/HANDOFF.md`'s instruction is rewritten accordingly** (see its own
section 1, this session's entry) to keep the first half — the mechanics and
structural corrections are still what to implement from — and retract the
second: a banner's claim that something is NOT YET implemented, built, or
present is no longer to be trusted at face value, only as a hint of where to
check the actual source (`IMPLEMENTED_FORMULA_IDS`, `data/overrides/`,
`data/bosses/<slug>.json`'s own `status`) before relying on it. Two of the
three sources that check now has a mechanical guard behind it
(`docs-bosses-formula-status.test.ts` for formula status;
`checkWatchlistConsistency`'s rules 5-6 for the watchlist's own claims,
though those don't reach `docs/bosses/*.md` itself). The override-listing
staleness named in the scope note above is the visible proof the new
instruction is necessary, not hypothetical: it is a currently-true instance
of exactly the claim type the old instruction said to trust, sitting in
files this session touched for an unrelated reason.

## `onSlayerTask` renamed to `onKonarTask`, and the Inferno/TzHaar breadcrumb

The "On slayer task" UI toggle is retired in favour of "Konar task", per
request. Checked the real data before touching anything: **in the current
corpus, `onSlayerTask` has exactly one generator and exactly one meaning.**
`apps/ingest/src/parse/rarity-templates.ts`'s `brimstoneRarity()` evaluator is
the sole emission site (a registry entry, not a per-boss branch — fires
whenever a boss's wiki page carries `{{Brimstone rarity|N}}` on a
`{{DropsLine}}` row), and it is the only place this condition is attached
anywhere in `data/`. 41 sources use it, all identically — a `Brimstone key`
tertiary gated `{ kind: 'onSlayerTask', value: true }` — zero uses in
`data/overrides/*.json`. So this was a straight rename, not a new mechanic:
`Condition`'s `onSlayerTask` member and `SimContext.onSlayerTask` both became
`onKonarTask` (`packages/loot-model/src/schema.ts`, `conditions.ts`), the
generator's emission updated to match
(`apps/ingest/src/parse/rarity-templates.ts`), and `data/bosses/*.json`
regenerated from committed snapshots (`ingest parse` + `ingest site-index`,
no wiki hit) — the diff touched exactly the 41 sources, one paired
`"onSlayerTask"` → `"onKonarTask"` swap each, confirmed by a line-level diff
before trusting it, nothing else moved.

**This also corrects an actual mislabel, not just a name.** The original
`brimstoneRarity()` comment (and an earlier entry in this file, above) glossed
the drop's real-game gate as "a Wilderness-Slayer task from Konar quo Maten."
Checked directly against the live wiki's own "Brimstone key" page before
finalizing the rename: the requirement is a task assigned **specifically by
Konar quo Maten**, from **any location** — not Wilderness-restricted. The
comment and this entry now say that precisely.

**Corrected count**: earlier entries in this file cite "31" `onSlayerTask`
uses (a snapshot from an earlier corpus state, left as written). The current
count, measured fresh for this change, is **41**.

**Deliberate scope boundary, logged so a future session doesn't collapse it
back**: `docs/bosses/inferno.md` and `docs/bosses/tzhaar-fight-cave.md` both
sketch a *different* mechanic — Fight Caves'/Inferno's pet rate (Jal-Nib-Rek /
Tzrek-Jad) improving on **any** Slayer master's task, not Konar-specifically.
Neither source is built as data yet (both pages have zero real
`{{DropsLine}}` rows — prose/completion-reward only), so there is no current
conflict. But `onKonarTask` must **not** be reused for that mechanic when
either source is eventually built — it needs its own, separately-named,
generic condition (e.g. a reintroduced `onSlayerTask` with its original
general meaning). Left as a pointer, not built now: population of one (well,
two unbuilt sources) is not a reason to add a second condition kind today.

**UI behaviour actually changed, not just the label.** The old toggle was
hardcoded and rendered unconditionally on every boss page
(`SimContextControls.tsx`), unlike every other conditionally-relevant field
(`perfectKill`, `isMVP`), which render only when `contextSurfaceOf` finds the
boss's own document actually uses them. No test or comment defended the
old toggle's universality (unlike "Ring of wealth," which stays universal on
purpose — it reaches the shared RDT/gem tables most sources touch), so this
reads as an oversight rather than a deliberate choice. Fixed as part of this
change: `onKonarTask` moved into `BOOLEAN_FIELDS` and now renders only on the
~41 Konar-eligible bosses, exactly matching "toggle where applicable." This
also caught a live bug: `apps/web/e2e/url-round-trip.spec.ts` asserted the
toggle against Zalcano, which is not Konar-eligible — it only ever passed
because the control was unconditional. Split into its own test against
Scorpia (which is eligible), with an explicit negative assertion that the
control does not render on Zalcano at all.

**URL query key renamed too**: `?slayer=1` → `?konar=1`, moved from a
hand-rolled parse/serialize pair into the existing `BOOLEAN_PARAMS` map
(matching `perfectKill`/`isMVP`'s convention, since the field moved from the
always-shown bucket to the conditionally-shown one). A stale shared link
carrying `slayer=1` now silently reverts to the new default
(`onKonarTask: false`) rather than erroring — accepted, not shimmed for
backwards compatibility, the same precedented cost as every other
`data`-neutral field rename in this project's history.

Verification: `pnpm -r typecheck && pnpm -r test && pnpm lint` clean,
including `corpus-reproducibility.test.ts` against the regenerated corpus and
new `SimContextControls.test.tsx`/e2e cases for the positive (Scorpia) and
negative (Brutus/Zalcano) surface-discovery behaviour.

## Two sources added outside `Category:Bosses`: Tormented Demon, Demonic gorilla

Requested by name. Neither is a member of the wiki's `Category:Bosses` —
verified live (`action=query&list=categorymembers&cmtitle=Category:Bosses`,
341 members, neither title present). Both are tagged `Category:Slayer
monsters` / `Category:Demons` instead. This runs straight into the standing
rule a few sections up: **"The boss inventory is exactly what `Category:Bosses`
returns, unfiltered... Filtering them would mean substituting judgement for
the wiki as the source of the inventory."** That rule is about not
*excluding* category members by hand; it says nothing about sources outside
the category a human specifically wants included, which is a different
question the spec doesn't cover. Asked the user rather than deciding
silently; they chose to add both by hand through the same pipeline machinery
(`WikiClient`, snapshot store, `classify`, `deriveRepeatable`) rather than
skip them or fake a category membership. Logged here as the exception, the
same shape as `rare_drop_table`/`gem_drop_table`/`mega_rare_drop_table`
already being fetched despite not being `Category:Bosses` pages either (see
"Fetched the real pages instead of reconstructing them from memory" above) —
this project already has precedent for `fetch --page` reaching outside the
category when a human names the target.

**Both fetched through the normal rate-limited `WikiClient`** (same
User-Agent, same serial queue, 10 requests total: wikitext + dropsline +
page-HTML + revisions + categories, ×2), snapshotted under the normal
`data/snapshots/*` kinds, then hand-inserted into `data/_inventory.json`'s
`bosses`/`lootSources` arrays (alphabetically, re-validated against
`InventorySchema` before writing) since `buildInventory` only ever derives
from a `fetch --all` manifest and re-running that would re-fetch all 172
existing pages to chase two new ones.

- **Tormented Demon**: tier A (35/51, shortfall is implicit nothing),
  `repeatable: true` (no quest-category tag), classification `own-table`.
  Parses to `needs_review` — hits the same pre-existing gap as two other
  corpus sources (README's "a Lua-transclusion the parser can't run"):
  `CombatHerbDropTableInfo`/`UsefulHerbDropTableInfo` transclusions produce no
  rows, so `drops_covered` correctly flags 8 grimy-herb rows as missing.
- **Demonic gorilla**: tier C (reaches the rare drop table, 451/500), tagged
  `Category:Quest monsters` (two are fought mid-`Monkey Madness II`) — the
  default signal says `repeatable: false`, which is wrong the same way
  Vorkath's was: the page states "After the quest is completed, more demonic
  gorillas can be found in the caverns," plus a per-account kill-count
  tracker (Nieve's gravestone), and they're heavily farmed post-quest for
  ballista pieces and zenyte shards. Added as a second hand-verified
  correction in `data/repeatable-overrides.json`, same shape as Vorkath's
  entry. Parses to `needs_review` on one heading-shape guess ("Herbs" mixes
  denominators); `ev_matches` passes within 2%.

**Found and fixed a real bug along the way, not routed around:**
`checkEvMatches` (`apps/ingest/src/validate/ev-matches.ts`) called
`expectedValue(boss, ctx, { prices })` without ever passing `tables`, so any
boss whose document contains a `tableRef` (44 of the 101 committed sources
do, for `rare_drop_table` and friends) throws `UnresolvedTableRefError`
uncaught the moment `expectedValue` actually runs. It never ran in practice:
`ev_matches` short-circuits on `renderedHtml === null`, and bulk `fetch
--all`/`sources` runs never populate the page-HTML snapshot that requires —
only `fetch --page` does, which until this session had only ever been used
for shared-table pages that carry no `tableRef` of their own. Parsing
Demonic gorilla (tier C, page HTML fetched, has a `tableRef`) was the first
real exercise of that combination and crashed the whole `parse` command
uncaught rather than reporting `ev_matches` as failed. Fixed by threading the
already-computed `sharedTables` map through `parseBoss` → `checkEvMatches` →
`expectedValue`'s `options.tables` (the one place a `Table` map already
existed at the call site); `sharedTables` param defaults to an empty map so
the three no-tableRef tests didn't need touching. Added a trip-wire test
(`ev-matches.test.ts`, "resolves a tableRef against the shared tables passed
in, instead of throwing") so this can't silently regress back to dead code.

Verification: `pnpm -r typecheck && pnpm -r test && pnpm lint` clean, including
`corpus-reproducibility.test.ts` (101 sources now) and the new `ev-matches`
regression test. `item-icons` and `site-index` regenerated afterward for both
new sources' items/portraits. Not committed — left for the user to review.

## A fifth boolean `Condition`: DT2's Awakened-only ornament kit

Requested by name: Duke Sucellus, The Leviathan, The Whisperer and Vardorvis
all modelled their unique Ancient blood ornament kit (item 28336) as an
unconditional `always` drop, when in reality it only drops from the Awakened
encounter, and only on the last of the four killed that way — every one of
the four pages states the exact same `raritynotes` ref verbatim: "Only when
defeated in the awakened encounter as the last of the four." A single-boss
simulator has no notion of "the other three bosses' order," so the fix
collapses that compound real-world fact to the one thing it means for THIS
boss's kill: was it the qualifying Awakened kill. Mirrors `onKonarTask`
exactly rather than inventing a new mechanism — the fourth precedent for "a
boolean gate that only renders where a boss's own document uses it," after
`ringOfWealth`/`onKonarTask`/`members`:

- New `Condition` kind `awakened` (`packages/loot-model/src/schema.ts`'s
  `ConditionSchema`), a new `SimContext` field (default `false`), evaluated in
  `conditions.ts` the same one-line way as `onKonarTask`.
- `contextSurfaceOf` (`apps/web/src/lib/context-fields.ts`) and
  `DropTableView`'s `conditionLabel` both needed their own `case 'awakened'`
  — the latter is a `switch` over every `Condition` kind with no default arm,
  specifically so a new kind fails the typecheck instead of rendering
  nothing; it caught this one immediately (`typecheck` failed until the case
  was added).
- UI label "Awakened (last of the four)" in `SimContextControls.tsx`'s
  `BOOLEAN_FIELDS`, URL param `awakened` in `url-state.ts`'s `BOOLEAN_PARAMS`
  — both one-line additions to an existing generic map, the same shape the
  Konar-toggle rename (`b6ab5e9`) made routine.

**Chose an override over a parser change.** Unlike `onKonarTask` (parser-
derived from the machine-readable `{{Brimstone rarity|N}}` template, firing
on ~41 bosses uniformly), the DT2 condition lives only in prose inside a
`raritynotes` `<ref>` with no dedicated template — the same "wiki never
encoded the mechanic in `{{DropsLine}}` rows" shape `docs/OVERRIDES.md`
reserves overrides for. Four new overrides
(`data/overrides/{duke-sucellus,the-leviathan,the-whisperer,vardorvis}.json`),
each carrying the boss's own generated `tables` verbatim (all-or-nothing
replacement per `applyOverride`) with `conditions: [{kind:'awakened',
value:true}]` added to just the one ornament-kit entry — nothing else in any
of the four tables changed.

**Status changes, and why Duke Sucellus alone stays `needs_review`.**
The-leviathan/the-whisperer/vardorvis were `verified`, no watchlist entry, and
this was the first anyone had modelled the gap at all — rather than
watchlisting them and un-watchlisting them in the same session for no
auditability gain, went straight to override + a wiki-figure-checking test
(`docs/OVERRIDES.md` step 3), landing all three on `manual_override` in one
move. Duke Sucellus already carries a watchlist entry for an unrelated,
larger, still-unbuilt gap (its roll-until-success chain order and perfect-
kill bonus) — `not_on_watchlist` keeps it `needs_review` regardless of this
fix, which is correct: the ornament kit piece is now fixed, the roll-chain
piece is not. Its `detail` was extended (not replaced) to cite
`data/overrides/duke-sucellus.json` literally, per `checkWatchlistConsistency`
rule 6 — omitting that citation was flagged immediately by `ingest parse`'s
own consistency check the first time the override existed on disk.
`data/index.json` regenerated afterward (69 verified/8 manual_override, was
72/5).

**Verification, per `docs/OVERRIDES.md` step 3** (not just deterministic
checks passing, but checked against the wiki's own stated figure):
`apps/ingest/test/dt2-awakened-ornament-kit.test.ts`, run against the real
committed documents, asserts 0% with the toggle off and exactly 100% (one
guaranteed drop) with it on, for all four, with every other expected drop in
the document unchanged, plus a negative control (Vorkath) carrying no
`awakened` condition anywhere. Mirrored at the UI layer: `SimContextControls.
test.tsx` (positive on all four DT2 bosses, negative on Brutus, alongside the
existing Konar pair) and `url-state.test.ts` (`awakened=1` round-trips).
Mirrored again at the browser layer: `e2e/url-round-trip.spec.ts` gained the
same positive/negative pair `konar=1` already had (Vardorvis vs. Zalcano), and
a manual Playwright pass against a live dev server confirmed the actual
simulated output: "Ancient blood ornament kit" absent from a 2,000-kill
Vardorvis run with the toggle off, present with it checked, zero console
errors either way.

Verification: `pnpm -r typecheck && pnpm -r test && pnpm lint` clean
(`typecheck` caught the missing `DropTableView` case before any test did),
`playwright test` (all 51 specs, including the two new ones) clean. Not
committed — left for the user to review.

## `findConfirmingSignal` gains a block-preamble read and a second phrase — fixes 2 sources, 1 for free

User pointed at wiki screenshots of Tormented Demon's and Demonic gorilla's
Herbs/Seeds sections proving the wiki DOES state exact access rates for the
mechanic that had them `needs_review` — not a case for an override (a
per-source, per-mechanic hand-authored escape hatch), but two real, narrow
gaps in shared parser code, exactly the kind CLAUDE.md's hard rule wants
found and fixed at the model rather than routed around per boss.

**Gap 1 — Tormented Demon's "Herbs" heading produced zero rows.** Its
`{{CombatHerbDropLines}}`/`{{UsefulHerbDropLines}}`/`{{CombatHerbDropTableInfo}}`/
`{{UsefulHerbDropTableInfo}}` template calls had no local snapshot, so
`expandTransclusions` correctly left them untouched (per its own contract:
"a template with no snapshot is left exactly as it was found") and
`findRowlessTemplateBlocks` correctly flagged the empty result — this was
never a parser bug, just an unfetched page, the same shape as Phase 3's
`rare_drop_table`/`gem_drop_table` fetch. Confirmed all four templates are
plain `#vardefine`/`#expr`/`{{DropsLine}}` wikitext (no `{{#invoke:}}` Lua,
unlike `GeneralSeedDropLines`) before fetching — same idiom as the sibling
`HerbDropLines`/`TreeHerbSeedDropLines` templates already on disk and already
working for 8 other bosses. Fetched via `WikiClient` (4 requests, same
rate-limited queue, snapshotted to `data/snapshots/wikitext/template-*.json`
like any other page) — not a re-fetch to fix a parser bug, a first fetch of
pages nothing had ever requested. Result: `drops_covered` now sees all 47
wiki rows (was 39/47, 8 grimy herbs entirely missing).

**Gap 2 — a heterogeneous-denominator heading confirms `preroll` from a
row's own `raritynotes` only, never the block's shared preamble, and only
against a narrow phrase list.** `findConfirmingSignal` (`build-tables.ts`)
already had this exact mechanism for per-row footnotes; Demonic gorilla's
"There is an equal chance of dropping 7 to 13 herbs of **the same type**" is
the same claim, just stated once for the whole group instead of repeated per
row. Added a third signal: scan `block.preamble` (already captured by
`groupByHeading`, just never read here) against the same phrase list, plus
one new phrase (`/\bof the same type\b/i`) — grepped the whole corpus first
(`grep -rl "of the same type" data/snapshots/wikitext/`) to confirm it
appears nowhere else with a different meaning.

**Fetching Gap 1's templates surfaced a THIRD, structurally distinct case**
in the same family: "chance of rolling the [[X drop table]]" — the wiki's
own idiom for "one roll into a named, canonically single, mutually-exclusive
shared table" (confirmed: 13 occurrences across 9 different named tables
corpus-wide — rare/gem/combat herb/useful herb/tree-herb seed/allotment
seed/shark/herb drop tables — never used any other way). Unlike a clean
`{{RareDropTable}}`-style transclusion (which resolves via the existing,
more precise `transclusionPartition` → `oneOf` mechanism, no guess involved
at all), Phantom Muspah's and Shellbane gryphon's Seeds/Herbs sections mix
hand-typed `{{DropsLine}}` rows with a partial template call — the same
"something on the page overrides the plain transclusion" shape Vorkath's
Seeds heading already fails partition on — so they fall through to the
phrase-confirmation path instead. Added as a second new phrase
(`/\bchance of rolling the\b[^.]*\bdrop table\b/i`); required fetching one
more template (`Template:TreeHerbSeedDropTableInfo`, the same plain-wikitext
shape) since the confirming prose only exists once that template's own
literal call is expanded into rendered text.

**Net effect, one full corpus re-parse (104 sources)**: only 4 documents
changed — nothing else moved, confirmed via `git diff --stat data/bosses/`
after the fact, and the 3 pre-existing `parse_failed` sources (revenant-
maledictus/burnt-chest/sigmund — the README's own "no document" trio) were
untouched.

| source | before | after |
|---|---|---|
| `demonic-gorilla` | `needs_review` (Herbs guess) | `verified` |
| `shellbane-gryphon` | `needs_review` (2 headings guessed) | `verified` — not the target of either fix, caught for free by the new "chance of rolling" phrase |
| `phantom-muspah` | `needs_review` (Seeds guess + a "Uniques" bundle false-positive) | `verified` — see the `definingRefText` fix below; Seeds and the bundle false-positive are both resolved |
| `tormented-demon` | `needs_review` (Herbs empty, 8/47 rows missing) | still `needs_review` (Herbs + Consumables headings still flagged) — but `drops_covered` now 47/47 |

**Deliberately did NOT force Tormented Demon's "Herbs"/"Consumables"
headings to confirm.** Its wikitext interleaves TWO separate templates
(`CombatHerbDropLines` + `UsefulHerbDropLines`) under one heading, each its
own independently-accessed pool (4/51 into combat herb drop table, 2/51 into
useful herb drop table) — genuinely two disjoint mutually-exclusive draws,
not one shared 8-way draw the way Demonic gorilla's/Shellbane gryphon's rows
actually are (confirmed by reading each candidate's own wikitext before
trusting any classification: Shellbane gryphon's overlapping items literally
sum both pools' contributions into one combined per-row rate — `herb*5 +
combatherb*5` — collapsing to a genuine single distribution; Tormented
Demon's combat/useful herbs never overlap or combine at all). Forcing
`preroll` across all 8 rows would silently understate the real outcome (both
pools CAN hit in the same kill) to make a badge turn green. "Consumables"
has no preamble or footnote at all — nothing to confirm, correctly still
flagged. Per this project's own stated discipline: a source with a real but
unconfirmed mechanic stays `needs_review` rather than being guessed into
`verified`.

Verification: new `build-tables.test.ts` cases isolate all three signal
paths (block-preamble "of the same type", "chance of rolling the ... drop
table", and a negative control proving an unrelated preamble sentence still
doesn't confirm). Full corpus re-parse, `item-icons`/`site-index`
regenerated, `pnpm -r typecheck && pnpm -r test && pnpm lint` clean
(593 ingest tests, including `corpus-reproducibility.test.ts` against the
regenerated corpus), manual Playwright pass against a live dev server
against all 4 touched sources confirming render + simulate + zero console
errors.

### A fourth bug, found asking "what's actually blocking these two now": `definingRefText` reads across a self-closing tag into an unrelated one

User asked what information they'd need to supply to get Tormented Demon and
Phantom Muspah to `verified`. Answering that honestly meant re-checking each
remaining flag against the CURRENT wikitext rather than repeating the
existing `statusReason` — and Phantom Muspah's turned out to already be
wrong, not just unconfirmed.

**The earlier finding at this doc's "Grepped the whole corpus for the four
phrases" entry (the `CO_DROP_PHRASES` corpus-wide check, several sessions
ago) is now stale, not incorrect for what it checked at the time**: it found
Phantom Muspah's one "dropped alongside" occurrence sat in an ANONYMOUS
`<ref group=d>` (no `name=` attribute) on the Venator shard row alone, and
concluded it was invisible to `citedRefNames` (which requires `name=`) and
therefore safe. True for that snapshot. The wiki page has since been edited
(re-fetched this session via `fetch --page`): Venator shard's `raritynotes`
now ALSO carries `<ref name=uniques />` immediately before that same
`<ref group=d>` note — `<ref name=uniques /><ref group=d>When a Venator
shard is received, no regular loot will be dropped alongside it.</ref>` —
citing the same `uniques` footnote Frozen cache and Ancient icon do (their
shared `{{CiteNews|...|name=uniques}}` citation about the January 2023
Secrets of the North drop-rate change).

That NEW adjacency exposed a genuine, distinct defect in `definingRefText`
(`build-tables.ts`): its regex, `<ref...name=X...>(.*?)<\/ref>`, doesn't
understand tag boundaries. Matched against `<ref name=uniques /><ref
group=d>...dropped alongside...</ref>` as one string, it happily opens on
the FIRST (self-closing) tag and then captures everything up to the NEXT
`</ref>` it finds — which is the SECOND, unrelated tag's closing — reading
the group=d note's actual text ("no regular loot dropped alongside it", a
plain clarification that a unique replaces the standard table, not a bundle
claim about two items) as if it were `uniques`'s own defining text. The
function's own doc comment already stated the intent ("deliberately
requires the full open/close form, not a self-closing tag") — the
implementation just didn't enforce it. Fixed with a negative lookahead,
`<ref\b(?![^>]*\/>)[^>]*...`, rejecting a self-closing opening tag outright.
Full corpus re-parse after the fix: only the 4 sources already listed above
changed — nothing else, confirmed via `git diff --stat`.

**Net answer to "what do you need from me":**
- **Phantom Muspah needed nothing — it's `verified` now.** Both its
  remaining flags (the Seeds heading and the Uniques bundle false-positive)
  were parser gaps, not missing wiki information.
- **Tormented Demon still needs something, but it's not "information" in
  the sense of a fact to supply — see the two remaining headings' own
  reasoning above.** "Consumables" has zero prose/footnote anywhere on the
  page to confirm or deny mutual exclusivity — the wiki genuinely does not
  state it, so this can only move if someone can point to a primary source
  (a wiki talk page, dev Q&A, patch note) stating one or the other; a guess
  is not an option per this project's own standing discipline. "Herbs" is
  different again: not missing information at all, but a real modelling
  gap — its 8 rows are two independently-accessed pools (4/51 combat herb,
  2/51 useful herb) glued under one heading, and correctly splitting a
  block by which of two known templates each row expanded from (rather than
  forcing one guessed `preroll` across both) is a buildable parser feature,
  not something the user needs to supply.

Verification for this fourth fix specifically: new `build-tables.test.ts`
case reproducing the exact Frozen cache/Ancient icon/Venator shard shape,
asserting no bundle signal fires. `pnpm -r typecheck && pnpm -r test && pnpm
lint` clean (594 ingest tests). Not committed — left for the user to
review.

## Fortis Colosseum accumulation fix: Phase 7's "exact-match wave selection" was wrong, corrected to cumulative

User-reported bug: simulating "12 waves completed" returned only wave 12's
own loot table, not the total loot from all 12 waves cleared — contradicting
how the actual encounter works.

**Root cause**: `data/overrides/rewards-chest-fortis-colosseum.json` gated
every wave's ~170 entries with an *exact-match* condition,
`levelAtLeast(field: 'wavesReached', n: W, atMost: W)`. Since
`ctx.wavesReached` is one scalar, only the single table where `n === atMost
=== wavesReached` could ever pass, so reaching wave 12 fired *only* wave
12's table — waves 1–11's contributions were silently dropped.

**Why this was a bug, not a re-litigation of a settled design call**: the
Phase 7 entry above ("Fortis Colosseum shipped...") asserted "every wave is
its own complete, self-contained weighted table, **not additive layers**,"
citing as evidence that each wave's rows sum exactly to that wave's own
denominator. That evidence only shows each wave's own pool is
well-formed (sums to 100% at that stage) — it says nothing about whether
waves stack across a run, and doesn't reconcile with the same override's own
quoted wiki prose: "the player has the option to continue... or end their
run and walk away with the rewards they've accumulated so far." The
structurally identical Doom of Mokhaiotl (`docs/bosses/doom-of-mokhaiotl.md`)
already shipped the *correct* pattern for this exact shape — plain
`levelAtLeast('delveLevel', n)` with no `atMost`, "every level up to the one
reached fires its own roll" — but Fortis was never checked against it.

**Fix**: stripped `atMost` from all 169 `wavesReached` conditions in the
override (mechanical, `field === 'wavesReached'` only — no other condition
kind touched), then re-ran `ingest parse --source
rewards-chest-fortis-colosseum` to regenerate `data/bosses/`. No engine or
schema change needed — `conditions.ts`'s `levelAtLeast` already treats a
missing `atMost` as "at least," and `expected-value.ts`/`simulate.ts`
already sum every table in `boss.tables` whose conditions pass. Same
conclusion Doom of Mokhaiotl's banner already reached for this table shape.

**Corroboration, not just internal consistency**: summing the wiki's own
published per-wave "effective rates" table
(`docs/bosses/rewards-chest-fortis-colosseum.md`) across waves 4–12 gives an
overall unique chance of ≈22% for a full wave-12 clear — matching
widely-reported community figures (~20–25%) for a full clear. The prior
exact-match model implied only ≈8.3% (wave 12's own row alone). Separately,
the fixed model's cumulative expected sunfire splinters for a full wave-12
clear computes to ≈2014.6, matching the wiki's own cited "on average...
2014.6 Sunfire splinters per full completion" almost exactly — strong
evidence the accumulation model, not the exact-match one, is what the page
is actually describing.

**Also updated**: the override's own `note` field (replaced the "not
additive layers" claim with the corrected reasoning) and
`apps/ingest/test/rewards-chest-fortis-colosseum.test.ts` (renamed its
"selects exactly one wave's table" describe block, replaced the now-wrong
"wave 4 must not carry wave 1's item" assertion with one asserting
accumulation, and updated the wave-12 unique-rate assertions from wave 12's
own row to the cumulative sums above, with the splinters/unique-chance
cross-checks pinned as their own tests). 17/17 tests pass.

**Not touched**: the wave-scoped armour-piece duplicate-avoidance
approximation (a separate, already-flagged gap) and the Token (Varlamore)
exclusion — both unrelated to this bug.

