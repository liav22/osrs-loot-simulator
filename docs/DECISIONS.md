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
