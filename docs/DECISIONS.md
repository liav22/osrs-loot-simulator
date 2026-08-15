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
