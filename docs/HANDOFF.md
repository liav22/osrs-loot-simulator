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

## 0. Snapshot for a fresh session — read this before section 1's journal

Section 1 below is a chronological log, oldest at the bottom, and it is long.
This section is the current state distilled, so a fresh session doesn't have
to reconstruct it by reading the whole journal. Verify against `data/index.json`
before trusting a number here — this section is written by hand and can drift.

**Corpus: 67 verified, 30 needs_review, 2 manual_override, 3 parse_failed (of
102 loot sources with `include: true`, 99 documents).** Landmine #3 (GWDRDT)
is CLOSED — `{{GWDRDT}}` resolves via two new `data/tables/gwd_*.json`
records, do not re-open it as a gap. Full detail: `docs/DECISIONS.md`'s
"GWDRDT built" entry, section 1's top entry, and landmine #3 in section 6.

**Mad Angel's compound shape is now BUILT — do not re-derive it from
scratch, and do not re-open it as unbuilt.** Its `Supply batch` heading
compounded an unconditional two-item bundle (Prayer potion(2), Super combat
potion(1)) with a mutually-exclusive Shark/Yellowfin choice, all behind one
16/150 access roll. Shipped as a hand-authored `data/overrides/mad-angel.json`
(not a detector generalization, per the confirmed proposal): an `always`-mode
`data/tables/mad-angel-supply-batch-bundle.json` whose entries are the two
unconditional item grants PLUS one entry whose `node` is a `oneOf` (Shark,
Yellowfin) — itself also `rate: {kind:'always'}`. The override splices a
single `tableRef` row (weight 16, matching the compound event's own shared
rate) into the SAME `mad-angel:2:...` weighted pool the four original rows
lived in, matching every other bundle instance's own precedent
(`duke-sucellus`/`maggot-king`/`k-ril-tsutsaroth`), not the separate
`independent`-mode shape an earlier draft of the proposal described. Zero
schema change: `always`-mode entries use the general `EntrySchema`
(`node: NodeSchema`, which allows `oneOf`), not the narrower `LeafEntrySchema`
a `oneOf`'s OWN entries are restricted to. `weights_sum` now passes (148
against the stated 150, matching the "closely" — not exactly — matched
overflow HANDOFF already flagged). **Still `needs_review`, but for a NEW,
separate, previously-invisible reason the fix exposed**: `drops_covered`
now fails on `Clue scroll (hard)`, a row the wiki's `dropsline` bucket still
carries from BEFORE a 12 August 2026 patch that swapped it for
`Clue scroll (medium)` — confirmed by reading the already-snapshotted
wikitext's own `==Changes==` log, not a parser bug and not fixable without
the wiki's own bucket catching up to its own page. A third instance of the
"wiki's own data doesn't reconcile with itself" class, alongside chaos-
fanatic's/phosani-s-nightmare's weight-drift. Full design and the residual:
`docs/DECISIONS.md`'s "Mad Angel's compound shape" entry and its "built" follow-up.

**Permanently flagged — do not spend time on these, they are not bugs
waiting to be found:**

| source(s) | why it cannot close |
|---|---|
| `zalcano` | The points→loot scaling function is never stated (`P_M`/`P_T` are defined exactly; what consumes them is not on the page), and the Zalcano shard's "between 1/750 and 1/1500 depending on contribution" has no stated interpolation. Everything else about Zalcano IS modelled — see `data/overrides/zalcano.json`. |
| `duke-sucellus` | The frozen-tablet curve is never stated. (Its `data/mechanics-watchlist.json` entry also names a real, currently-unbuilt sequential roll-chain mechanic and a perfect-kill bonus — those are NOT permanently unknowable, just not built; don't conflate the two when deciding whether this source is "done forever" or "has real remaining work.") |
| `reward-pool` | Shipped and correct PER REWARD PERMIT, the page's own unit — but the per-encounter rule (how permits map to encounters) is never stated. |
| `reward-cart` | Blocked, deliberately. Its Logs rows are all `rarity=Varies` with the Woodcutting-level rates never stated, and the pyromancer outfit rule ("the piece players have the least of") is a RELATIVE comparison across four counts `ownershipGate` cannot express. |
| `chaos-fanatic`, `phosani-s-nightmare` | The wiki's own published per-row weights don't sum to their own stated denominator (129 vs a `/128` every row cites; 101 vs `/100`) — checked by hand against the raw wikitext, not a parser bug, not explained by the bundle defect. Plausible ordinary wiki-editing drift; would need re-derivation from drop-log data to ever close. **`chaos-fanatic` also has a SEPARATE, real, unaddressed `drops_covered` gap (2 items: Pet chaos elemental, Wine of zamorak) — that part is NOT permanently flagged, don't lump it in.** |
| `revenant-maledictus` (`parse_failed`, not `needs_review`) | No `{{DropsLine}}` calls anywhere on the page. Its whole mechanic lives under a prose-only `===Drop mechanics===` heading (the same shape that structurally excludes Barrows'/Salarin's own prose headings from the drops-section matcher) describing "two rolls on the revenant dragon's own drop table" plus a top-damage bonus and blighted supplies for everyone else — there is no `{{Template}}` call on the page this project's pipeline could expand, unlike GWDRDT, which turned out to have one. |

Full reasoning for the first five: section 3's "The genuinely unknowable"
subsection, just below. **Also functionally stuck,
though not literally on the watchlist**: the "Uniques"/"Mutagens" heading
question (`phantom-muspah`, `sarachnis`, `shellbane-gryphon`, `the-nightmare`,
`zulrah` — 5 sources) has been re-litigated more than any other question in
the project and the answer has been "no available signal" every time,
including via a three-signal resolution pipeline. Don't re-open it without a
genuinely new signal — see section 5, "What NOT to redo."

**So a fresh session doesn't read "30 needs_review" as "30 units of work":**
of the 30, **5 will never move** (`duke-sucellus`, `zalcano`, `reward-pool`,
`reward-cart`, `phosani-s-nightmare` — the permanently-flagged table above,
minus `chaos-fanatic`, which has real work alongside its own permanent part,
see below, and minus `revenant-maledictus`, which is in the separate
`parse_failed` bucket, not this count) **+ 4 are the raids, watchlisted
DELIBERATELY** (each has one named, deliberately-unmodelled remnant — a
decided state, not a bug; see "The four raids" below) **+ 5 are the
Uniques/Mutagens dead end** = **14 of 30 are not really pending work**. The
other **16** are real, examinable gaps: a small `drops_covered` residual on
`commander-zilyana`/`k-ril-tsutsaroth` (unrelated to GWDRDT, already
resolved) and on `chaos-fanatic` (2 items — separate from its own
permanently-flagged weight-drift, which will still never fully reconcile
even once this part is fixed); `mad-angel` (proposal confirmed above, not
yet built); `black-knight-titan`/`salarin-the-twisted` (`items_known`);
`alchemical-hydra`/`black-demon`/`chaos-elemental`/`kalphite-queen`/`nex`/
`obor`/`yama`/`maggot-king` (coverage gaps, unexamined per-source);
`chronozon` (`items_known`, tier-E item-index gap); `vorkath` (a correctly-
refused seed partition, its own bespoke residual). See section 3's full table
for the per-source detail on each.

---

## 1. Current state

**Changed this session (the most recent one — landmine #3 (GWDRDT) closed,
K'ril's Coins defect fixed, Mad Angel's compound shape confirmed but not
built):**

- **GWDRDT resolves now.** Landmine #3, `docs/HANDOFF.md`'s own long-standing
  gap: `{{GWDRDT}}` used to be unconditionally flagged `unresolved` in
  `rdt-access.ts`. Two NEW `data/tables/` records (`gwd_rare_drop_table.json`,
  `gwd_gem_drop_table.json` — the existing `mega_rare_drop_table.json` is
  reused directly for the third tier, not duplicated), built by fetching and
  decoding `Template:CalculateRDTNaked`'s own formula (a legitimate one-off
  research fetch, same category as the ToA/CoX/ToB `Module:` page fetches —
  not a re-parse of anything already snapshotted) and cross-checked against
  Kree'arra's own rendered dropsline bucket: all 24 items match the wiki's
  own computed figures exactly. `kree-arra`/`general-graardor` reach
  `verified` for the first time; `commander-zilyana`/`k-ril-tsutsaroth` drop
  from 27/25-of-50 `drops_covered` misses to 2/3 (an unrelated small
  residual, untouched). **65 -> 67 verified, 32 -> 30 needs_review.** See
  `docs/DECISIONS.md`'s "GWDRDT built" entry for the full formula and the
  code change (`rdt-access.ts` now emits two access lines instead of one
  `unresolved` entry).
- **K'ril's/Zilyana's Coins composite-rate defect is fixed, separately, not
  folded into the bundle mechanism** — a new early split in
  `buildTableGroups` (`COMPOSITE_RATE_PHRASES`) pulls a row whose
  `raritynotes` explicitly disclaims single-table scope ("Coins come from
  rolls on all loot tables...") out of whatever weighted pool its heading
  sits in, into its own standalone `independent` entry at the wiki's own
  stated rate — exact, not an approximation, once isolated from items it was
  never actually competing against. Deliberately does NOT flush the
  in-progress weighted merge the way the bundle/mixed-Always splits do,
  since K'ril's own siblings under the same heading genuinely belong to one
  shared `/127` draw with the headings before it — checked directly against
  the real table structure, not assumed. No status change (both sources
  were already blocked on other things) — a pure correctness fix. See
  `docs/DECISIONS.md`'s "K'ril's Coins composite rate" entry.
- **Mad Angel's compound `oneOf`-and-bundle shape is now a CONFIRMED
  proposal, still not built, per instruction.** Reported before touching
  anything: the fix composes two existing capabilities that had simply
  never been combined (an `always`-mode bundle table whose entries include
  a `oneOf` node, itself unconditionally granted) — confirmed valid via
  `SharedTableSchema.parse`, confirmed mode-agnostic in `compile.ts` by
  reading, and confirmed BEHAVIOURALLY correct via a real 500k-kill
  `simulate()` run (potions always co-occur; the two fish never do).
  Recommends a hand-authored `data/overrides/mad-angel.json` over
  generalising the detector, since this is the only known instance of the
  compound shape in the whole corpus. See `docs/DECISIONS.md`'s "Mad
  Angel's compound shape" entry for the full proposal.

**Changed in the prior session (the bundle shape BUILT, not just
assessed):**

- **The bundle shape (`docs/DECISIONS.md`'s "bundle shape, assessed" entry,
  an earlier session) is built**: a `tableRef` to a generated, per-boss
  `data/tables/<slug>-<heading>-bundle.json` (`mode: 'always'`), detected by
  a standing check (`checkBundleSignals`/`findBundleGroups`, `build-tables.
  ts`) that runs on every heading block corpus-wide, not gated behind
  `weights_sum` already failing — both signals from the assessment: a shared
  footnote whose DEFINING text (not just its sharedness) reads as a co-drop
  phrase, and block-level prose with no footnote at all (new extraction,
  `WikitextDropLine.blockPreamble`). See `docs/DECISIONS.md`'s "The bundle
  shape, built" entry for the full mechanism, including the one thing the
  assessment underspecified (a bundle is usually a SUBSET of a block's rows,
  not the whole block) and how the generated `data/tables/` file gets
  written and validated within the same `parseBoss` call that discovers it.
- **`the-leviathan`, `the-whisperer`, `vardorvis` return to `verified`** —
  downgraded in an earlier session specifically pending this fix; their
  `data/mechanics-watchlist.json` entries are removed now that the mechanic
  they named is actually modelled. **`grotesque-guardians` reaches `verified`
  for the first time** — the bundle was its only defect. **61 -> 65
  verified, 36 -> 32 needs_review.**
- **`maggot-king`, `k-ril-tsutsaroth`, `commander-zilyana`, `chaos-fanatic`,
  `duke-sucellus`, `kree-arra` all get the bundle correctly modelled too**
  (the standing check's whole point — it isn't scoped to the task's named
  list) **but stay `needs_review`**, each for its own separate, pre-existing,
  untouched reason (a `drops_covered` gap for the first four, GWDRDT's own
  missing-item gap for the GWD pair, duke-sucellus' chain-order/perfect-kill
  watchlist entry). **`mad-angel` also stays `needs_review`, deliberately
  NOT auto-modelled** — its `Supply batch` heading compounds a `oneOf` fish
  choice with a flat two-item bundle at a DIFFERENT rate in one prose
  sentence, which the bundle detector's uniform-rate requirement correctly
  refuses rather than guessing; `checkBundleSignals` reports it
  `confirmed: false` and `parseBoss` gates `verified` on that directly, not
  just on whatever `weights_sum` happens to see.
- **K'ril's separate Coins composite defect and chaos-fanatic's/phosani-
  s-nightmare's own wiki-weight-drift overflow were both explicitly left
  untouched**, per instruction — see `docs/DECISIONS.md`'s new entry for
  why K'ril's `weights_sum` happens to pass anyway (the composite figure
  inflates the total without pushing it over 127) despite the Coins number
  itself still being wrong.

**Changed in the prior session (three sources downgraded,
Yama fixed, the other three weight-overflow sources root-caused, the bundle
shape assessed):**

- **`the-leviathan`, `the-whisperer`, `vardorvis` downgraded from `verified`
  to `needs_review`, deliberately, before any fix exists** — they carry the
  bundle defect the prior session's investigation found (their `Supplies`
  heading grants 3 items together on one roll, modelled as pick-one-of-three)
  and were shipping wrong odds under a `verified` badge. Watchlisted via
  `data/mechanics-watchlist.json` (`mechanic: 'other'`, `blockedBy: []` —
  got this wrong on the first attempt, `checkWatchlistConsistency` caught it,
  see `docs/DECISIONS.md`). **64 -> 61 verified, 33 -> 36 needs_review.**
- **Yama's `always`+`fixed` fallthrough is fixed** — the specific mechanism
  that shipped its `Contract` table at 1801/100. Hoisted generally (every
  block, before any mode-inference branch), not patched narrowly for Yama,
  since the same unfiltered-`resolved` pattern existed identically in three
  separate merge paths. Yama stays `needs_review` for two unrelated,
  pre-existing reasons. A real, traced, harmless side effect: this also let
  `rewards-chest-fortis-colosseum`'s own raw page parse further than before
  (an identical Always+fixed heading on Wave 12, which this boss's override
  fully supersedes anyway), flipping its `source` metadata from `'override'`
  to `'merged'` with zero change to its actual 13 tables — see
  `docs/DECISIONS.md`.
- **`maggot-king`, `chaos-fanatic`, `phosani-s-nightmare` root-caused, on
  request, before assuming they shared Yama's or each other's defect. They
  don't.** `maggot-king` is the bundle defect again, cleanly. `chaos-fanatic`
  carries the bundle defect too but it does NOT explain that source's own
  overflow — its wiki-published weights sum to 129 against a stated 128
  **before** any bundle double-counting. `phosani-s-nightmare` carries no
  bundle citation at all and has the identical shape (101 vs 100). **A third
  cause class, previously undistinguished**: the wiki's own published
  integer weights occasionally just don't reconcile to their own stated
  total by a point or two — not a parser bug, likely not fixable at all.
- **The bundle shape (a `tableRef` to a new single-boss `data/tables/`
  record with `mode: 'always'`) is assessed, not built.** Confirmed it needs
  zero schema change — every primitive it composes (`tableRef` resolution,
  `always`-mode tables, single-boss-specific `data/tables/` records) is
  already in production and mode-agnostic throughout the validator suite.
  Also confirmed the shape is detectable independent of whether it overflows
  (two textual signals — a shared per-row footnote, already half-detected by
  existing machinery; block-level prose, genuinely new to capture), which is
  what would make it a standing check rather than a fix contingent on the
  arithmetic happening to break. Full design in `docs/DECISIONS.md`'s "bundle
  shape, assessed" entry — not implemented.

Full `pnpm -r test`/`typecheck` green after both data changes, including
`packages/loot-model/test/brutus.test.ts` as the regression gate both times.

**Changed in the prior session (recount + transclusion mode closed +
parserVersion decision):**

- **The needs_review recount is done and no longer stale** — see
  `docs/DECISIONS.md`'s "The needs_review recount" entry and section 3's
  table below. Two real corrections: GWDRDT was undercounted (2 sources ->
  4, `commander-zilyana`/`k-ril-tsutsaroth` had the identical missing-item
  signature as `kree-arra`/`general-graardor` and nobody had cross-referenced
  it), and a previously undocumented cause class exists — `weights_sum`
  genuinely fails on 8 sources (6 non-GWD + the 2 GWD ones doubling up), not
  the transcluded-mode approximation's accepted shortfall but real wrong
  odds, and it already reached `verified` silently on three sources
  (`the-leviathan`, `the-whisperer`, `vardorvis`) — investigated (three
  distinct root causes: an `always`+`fixed` mixed-heading parser fallthrough,
  a "dropped together" bundle-of-items defect with no schema representation
  yet, and a composite/multi-table aggregate rate inserted as one table's own
  share), **not fixed** — see `docs/DECISIONS.md`'s "Weight-overflow
  investigated" entry before touching any of it.
- **The transcluded sub-table mode question is CLOSED.** Took section 3's
  "model it properly" option: a confirmed partition (`transclusionPartition`
  ratio ≈ 1.0000) now compiles to a `oneOf` node at the declared access rate
  instead of N independently-rolled rows — exact, not the accepted
  approximation, matching CoX's own herb/seed `oneOf` nesting. Moved exactly
  the 9 sources that were `needs_review` on this alone — `abyssal-sire`,
  `araxxor`, `arrg`, `bryophyta`, `dagannoth-{prime,rex,supreme}`,
  `deranged-archaeologist`, `giant-sea-snake` — to `verified`. **55 -> 64
  verified, 42 -> 33 needs_review.** `data/bosses/*.json` and `data/index.json`
  regenerated via a full unscoped `ingest parse` + `ingest site-index`;
  `corpus-reproducibility.test.ts` and the full `pnpm -r test`/`typecheck`
  pass clean, including `brutus.test.ts` as the regression gate. See
  `docs/DECISIONS.md`'s transclusion entry for the exact mechanism and a
  small, accepted, sub-0.3% precision trade-off in the affected items'
  marginal rates (within `marginal-rates.test.ts`'s tolerance, checked not
  assumed).
- **`parserVersion` is retired as a staleness mechanism, not removed.**
  CLAUDE.md's "bump `parserVersion` instead" clause described a workflow
  nothing ever followed (`main.ts` writes a literal `1` unconditionally) and
  nothing ever read back — `corpus-reproducibility.test.ts`'s full re-parse
  diff already is the real staleness guard and a stronger one. CLAUDE.md's
  rule now points at that instead; `Boss.parserVersion`'s schema comment
  says plainly it's provenance metadata only. The field itself stays (it's a
  `PROJECT_PLAN.md` §4.5 spec field with the same standing `wikiRevId` has),
  only the false "this drives something" implication is gone. See
  `docs/DECISIONS.md`'s "`parserVersion` retired" entry.

**Changed in the prior session (ToB, CoX and Fortis Colosseum all shipped,
plus a corpus-wide parser fix):**

- **All four raids are now built.** ToA was already done; this session shipped
  the other three — `data/overrides/{monumental-chest,ancient-chest,rewards-
  chest-fortis-colosseum}.json`, each with its own wiki-figure test
  (`apps/ingest/test/{monumental-chest,ancient-chest,rewards-chest-fortis-
  colosseum}.test.ts`, 22/24/14 assertions respectively). **Phase 7 has now
  shipped 9 of the 14 originally-researched sources**, up from 6. All three
  stay `needs_review`/watchlisted on purpose — **explicitly decided, not an
  oversight**: each has a real, named, unmodelled remnant (team/party
  allocation on ToB and CoX; the tertiary "individual performance" scaling on
  ToB; Ancient tablet's imprecise "replaces one of the loot rolls" and
  Metamorphic dust's unstated time-threshold on CoX; the with-replacement
  armour-dedup approximation on Fortis Colosseum), and `manual_override` is a
  claim of completeness none of the three should make yet. Do not flip any of
  them without re-deriving whether the remaining residual is Doom/Lunar-shaped
  (ship it) or ToA-shaped (keep watchlisted) — that judgement call was
  deliberately left for a human, twice, across two rounds of this same
  question.
- **Two of the three needed real corrections to their own OWN prior research
  docs, found only by cross-checking a fresh page fetch against a
  calculator's Lua source line by line — not by trusting either alone.**
  CoX's common table is 33 weighted slots (matching the page's own
  `rarity=1/33` rows exactly), NOT the flat 43-item/denominator-99 table an
  earlier research pass proposed — the 10 herb slots are each a nested
  `oneOf(herb, seed)`, which is what keeps "the two rolls cannot end on the
  same drop" correct (a flat structure would let a herb and its own seed both
  drop in one raid). CoX's common-table quantities are `QtySpec.formula`
  (`floor(min(points,131071)/divisor)`), not literal RNG ranges — the page's
  `quantity=1-138`-style rows are the DISPLAY BOUNDS of a deterministic
  points-driven formula, not a real per-roll span the way ToB's own ranges
  are. Both mistakes would have produced a THIRD structurally-clean,
  badly-wrong CoX document (the source has now shipped two already — see
  `docs/DECISIONS.md`'s "Phase 7: Chambers of Xeric" entry for the full
  reasoning and how each was caught). ToB's two remaining UNKNOWNs (the
  death-penalty magnitude, the common-quantity scaling) were resolved the
  same way ToA's interpolation gap was: not a model gap, a missing source —
  `Module:Theatre of Blood calculator` states both outright, plus the exact
  30% (not 32.25%) Hard Mode time-bonus figure and the module's own hardcoded
  Cabbage/Message zero-points branch. **Check for a `Module:`/`Calculator:`
  page before trusting a prior session's "UNKNOWN" — this is now the fourth
  time it has resolved one** (ToA, then CoX and ToB in the same session).
- **New `SimContext` fields**: `roomsSkipped` (ToB, capped 0–6) and two
  DERIVED fields, `tobPoints` (ToB's points total, from `roomsSkipped` +
  `deaths`) and — unrelated to any of the three raids — nothing else new,
  `totalDamage` is unchanged. New formula ids: `tob_points`,
  `tob_common_qty`, `cox_points`, `cox_common_qty` — all real
  implementations, not stubs; `IMPLEMENTED_FORMULA_IDS`' trip wire fired
  again, now pinning 15 ids. `cox_points` is dispatched by `params.kind`
  across three positions (one probability contract, matching
  `toa_bad_luck_mitigation`'s precedent) rather than needing a third CoX
  formula id.
- **A genuine corpus-wide parser bug, found while building ToB, fixed
  separately from the override that motivated it**: regular
  `{{DropsLine}}`/`{{DropsLineReward}}` rows never read
  `{{DropsTableHead|dropversion=X}}` the way RDT/gem-table access lines
  already did, so a page whose variants sit under nested sub-headings inside
  one already-grouped block (Monumental chest's Normal/Hard Mode) silently
  blended them into one undifferentiated table. Fixed in
  `wikitext-drops.ts`/`build-tables.ts`, generally — see
  `docs/DECISIONS.md`'s "The dropversion= parser fix" entry for the full
  mechanism, including why tagging entries alone would have made things
  WORSE (a naive fix would have left the block `preroll`-moded with
  first-hit-wins semantics, wrong for a normalised weighted split) and needed
  a second, per-variant-aware reconciliation check. **Found a second,
  broader, pre-existing bug in the process**: `Boss.variants` was hardcoded
  to `['normal']` for every generated document regardless of what conditions
  it actually used, so `black-demon`/`vorkath`/`amoxliatl` already had real
  variant conditions the UI could never offer a control for. Also fixed,
  generally, not as a ToB special case — `variants` is now derived from what
  a document actually uses, and `contextDefaults.variant` defaults to the
  first-seen value when `'normal'` isn't among them (otherwise a source like
  Vorkath, whose only variant is `"Post-quest"`, would show an EMPTY default
  simulation). A full unscoped `ingest parse` before/after landed on
  identical totals (55 verified, 42 needs_review, 2 manual_override, 3
  parse_failed) — this reshapes documents, it does not flip any status.
- **Fortis Colosseum's wave-scoped armour duplicate-avoidance ships as a
  quantified, not assumed-small, with-replacement approximation, and its
  SCOPE (per-run vs lifetime) is still unresolved after two rounds of
  checking.** Computed: the per-piece expected rate the simulator's headline
  numbers show is IDENTICAL under both models (by symmetry); the cost is
  entirely in joint/same-run statistics no headline number surfaces (P(a
  duplicate this run) ~0.20% vs ~0.00025% true, ~800x relative, both
  absolute-tiny). Checked, not found: the Sunfire fanatic armour page, the
  individual Sunfire fanatic helm page, two web searches, three Jagex
  devblog mirrors from the release cycle, both relevant pages' full
  patch-history, and Fortis Colosseum/Strategies — none state whether the
  protection resets per attempt. If it turns out to be lifetime-scoped, an
  EXACT model via `ownershipGate` (identical to ToA's jewel pool) is directly
  available and should replace the approximation entirely — see the
  override's own `note` and `docs/DECISIONS.md` before touching this again.
- **Two stale wiki snapshots caught before they could ship a THIRD bad
  document**: the committed `Ancient chest` snapshot still had pre-patch
  unique weights (20/69) despite an earlier research pass already citing the
  post-patch 14/60 — the fresh fetch's revid matched what that pass cited,
  confirming the research was right and only the snapshot on disk had never
  been updated. `Monumental chest` and `Rewards Chest (Fortis Colosseum)`
  were also re-fetched fresh (cosmetic capitalization diffs only, confirmed
  by direct diff, not assumed). All three sources' item-icon/dropsline
  snapshots were refreshed to match.

---

**Phases 0–4 are done and stable** (schema, conditions, formulas, RNG,
simulator, analytic EV; the ingest pipeline; the frontend) — unchanged from
prior sessions. Not re-verified line-by-line recently, but nothing since has
touched their done-when criteria. **"This session" appears throughout this file
and means different sessions in different sections — the dated change lists at
the end of section 1 are the reliable chronology.**

**"Phase 5"/Phase 7 (PROJECT_PLAN.md section 16: overrides + hard bosses) is
substantively underway, not done** — its own done-when is "zero
`needs_review`," and **38 non-verified sources remain** (36 `needs_review` +
2 `manual_override`), plus 3 `parse_failed`. **Recounted, no longer stale,
across two sessions of net change** — see section 3's table and
`docs/DECISIONS.md`'s recount entry for the methodology: 44 -> 35 (the 9
transcluded-mode sources flipping to `verified`), then 35 -> 38 (three more
downgraded back off `verified` on the bundle defect — a real, deliberate
regression, not a miscount). What IS done within its scope:

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
99 documents, of 102 loot sources with include: true (97.1%):
  67 verified, 2 manual_override, 30 needs_review
```

**Four sessions of change to this number, net 55 -> 64 -> 61 -> 65 -> 67
verified.** The transcluded-mode fix (section 3, `docs/DECISIONS.md`) moved
`abyssal-sire`, `araxxor`, `arrg`, `bryophyta`, `dagannoth-{prime,rex,supreme}`,
`deranged-archaeologist`, `giant-sea-snake` — exactly the 9 sources that were
`needs_review` on that question alone — straight to `verified` (55 -> 64). An
earlier session then downgraded `the-leviathan`/`the-whisperer`/`vardorvis`
back off `verified` on the bundle defect (64 -> 61) — a real regression in the
count, taken deliberately, because they were shipping wrong odds under the
badge. A later session built the bundle shape (`docs/DECISIONS.md`'s "The
bundle shape, built" entry) and moved 61 -> 65: those same three sources
returned to `verified` now that the mechanic they were downgraded for is
actually modelled (their `data/mechanics-watchlist.json` entries are gone),
plus `grotesque-guardians` newly reached `verified` for the first time (the
bundle was its only defect). **The most recent session closed landmine #3**
(GWDRDT, `docs/DECISIONS.md`'s "GWDRDT built" entry) and moved 65 -> 67:
`kree-arra`/`general-graardor` reach `verified` for the first time (GWDRDT
was their only remaining gap); `commander-zilyana`/`k-ril-tsutsaroth` stay
`needs_review` on a much smaller, unrelated residual (down from 27/25-of-50
`drops_covered` misses to 2/3). The same session also fixed K'ril's separate
Coins composite-rate defect (a pure correctness fix, no status change) and
produced a confirmed, unbuilt proposal for Mad Angel's compound shape — see
`docs/DECISIONS.md`'s two newest entries. Re-run `ingest parse` (no
`--tier`/`--source` filter) landed on all splits exactly, and
`corpus-reproducibility.test.ts` passes against the regenerated
`data/bosses/*.json`.

**READ THE DENOMINATOR CAREFULLY. It is 102, not 52.** Coverage was long read as
"27 of 52"; 52 was the number of sources ever PARSED, not the number the project
owns. `include: true` in `data/_inventory.json` is the gate, and it is 102.
`verified` is **67/102 = 65.7%** (67.7% of the 99 documents that exist). Per
tier (with document / include:true): A 25/26, B 1/1, C 26/26, **D 20/20**
(Fortis Colosseum's override closed the last gap this session), E 27/29. The
**3** sources with no document at all: `revenant-maledictus` (A, own open
parse_failed reason), `burnt-chest` and `sigmund` (E — both trivial;
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

**Read `verified` split by this field before trusting the headline 67/102.**
26 of the 67 `verified` sources (38.8%) are one-time content — the same 26 as
before the bundle/GWDRDT fixes, since every source they moved to `verified`
(`grotesque-guardians`, `the-leviathan`, `the-whisperer`, `vardorvis`,
`kree-arra`, `general-graardor`) is `repeatable: true`: **41/71 = 57.7%**
among documents with `repeatable: true` — up from the prior session's 54.9%,
and now the highest this figure has been. Recomputed against the
regenerated corpus; full table in `docs/DECISIONS.md` predates all four
fixes and should be recomputed too if the exact per-tier split matters
again.

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
`SimContext.totalDamage` (derived). **Phase 7 has shipped 9 of the 14
researched sources**: Abyssal Sire and Corporeal Beast (parser fixes,
`verified`), Doom of Mokhaiotl and Lunar Chest (overrides, `manual_override`),
Zalcano (override, still `needs_review` — two curves the wiki never states keep
it watchlisted), and **all four raids** — Tombs of Amascut, Theatre of Blood,
Chambers of Xeric, Fortis Colosseum (all overrides, all still `needs_review` —
each has a real, named, unmodelled remnant; see section 3 and this session's
own entry at the top of this section). See section 3 for what is next.

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

### Phase 7 — 9 of 14 shipped, 5 to go

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

**Recounted this session against the live corpus — no longer stale.** Full
methodology and the two real corrections found (GWDRDT undercounted, and a
whole new cause class) are in `docs/DECISIONS.md`'s "The needs_review recount
— GWDRDT was undercounted, and a new cause class exists" entry; this table is
the summary. All four raids are excluded (watchlisted `needs_review` for a
real, named, unmodelled remnant — see the top of section 1 — a different
reason than what this table tracks).

**Transcluded sub-table mode — DONE, not a row here anymore.** All 9 sources
(`abyssal-sire`, `araxxor`, `arrg`, `bryophyta`, `dagannoth-{prime,rex,supreme}`,
`deranged-archaeologist`, `giant-sea-snake`) are `verified` now — a confirmed
partition (`transclusionPartition` ratio ≈ 1.0000) is modelled as a `oneOf`
node at the declared access rate instead of N independently-rolled rows,
exact rather than an approximation. See `docs/DECISIONS.md`'s transclusion
entry for what changed in `build-tables.ts`/`assemble-boss.ts` and the
corpus effect (55 -> 64 verified).

**Yama's own weight-overflow is DONE** — the `always`+`fixed` fallthrough
that shipped its `Contract` table at 1801/100 is fixed (`docs/DECISIONS.md`'s
"Yama's always+fixed fallthrough" entry). Yama stays `needs_review` for two
unrelated, pre-existing reasons (an unparseable-rarity gap, a `drops_covered`
shortfall), so it moved OUT of the weight-overflow row below into "coverage
gaps," not off the table entirely.

**Three more sources downgraded from `verified`, on purpose, before any fix
exists** — `the-leviathan`, `the-whisperer`, `vardorvis` carry the identical
bundle defect (`docs/DECISIONS.md`'s "Three verified sources downgraded"
entry): their `Supplies` heading grants 3 items together on one access roll,
modelled as a `weighted` pick-one-of-three instead. `weights_sum` never
caught it (their tables have slack), so it shipped `verified` silently. Now
watchlisted (`mechanic: 'other'`, `data/mechanics-watchlist.json`) — a
`needs_review` badge on wrong odds is honest, a `verified` one isn't, and
that's true independent of whether the underlying fix ever lands.

**`maggot-king`, `chaos-fanatic`, `phosani-s-nightmare` root-caused, NOT the
same defect as each other or as Yama** (`docs/DECISIONS.md`'s "root-caused —
not the same defect" entry, investigated on request rather than assumed):
`maggot-king` is the identical bundle defect, cleanly (its overflow is
EXACTLY explained by one dropped-together pair). `chaos-fanatic` carries the
bundle defect too (two dropped-together pairs) but it does NOT explain that
source's own weight overflow — summing the wiki's own published per-row
weights by hand comes to 129 against every row's own stated `/128`, one over
BEFORE any bundle double-counting is even considered. `phosani-s-nightmare`
carries no bundle citation at all; same shape, 101 against every row's own
`/100`. **A third cause class**: the wiki's own published integer weights
occasionally just don't sum to their own stated denominator by a point or
two — plausible ordinary editing drift, not fixable by any parser or model
change.

**The bundle shape is BUILT**, not just assessed — see the top of section 1
and `docs/DECISIONS.md`'s "The bundle shape, built" entry for the full
mechanism (a `tableRef` to a generated `data/tables/<id>.json` with
`mode: 'always'`, a standing corpus-wide check, both signals from the
original assessment). `grotesque-guardians` reached `verified`;
`the-leviathan`/`the-whisperer`/`vardorvis` returned to it;
`maggot-king`/`chaos-fanatic` still carry OTHER, separate, untouched
`drops_covered` gaps and moved from the weight-overflow row below into the
coverage-gaps one; `mad-angel`'s compound `oneOf`-and-bundle shape is now
ALSO built (hand-authored, per the confirmed proposal — see the top of
section 1) and it moved to the coverage-gaps row too, for a different,
newly-exposed `drops_covered` residual its own bundle fix uncovered, not
the bundle itself. **GWDRDT is also now BUILT** (landmine #3, `docs/DECISIONS.md`'s
"GWDRDT built" entry): `kree-arra`/`general-graardor` reached `verified`;
`commander-zilyana`/`k-ril-tsutsaroth` stay in the GWDRDT row below on a
much smaller, unrelated residual (their own separate `drops_covered` gap,
not GWDRDT itself). **K'ril's separate Coins composite-rate defect is fixed
too** (`docs/DECISIONS.md`'s "K'ril's Coins composite rate" entry) — a pure
correctness fix with no row in this table to update.

| group | count | what it needs |
|---|---|---|
| the "Uniques"/"Mutagens" heading question | 5 | `phantom-muspah`, `sarachnis`, `shellbane-gryphon`, `the-nightmare`, `zulrah`. **Most re-litigated question in the project — see section 5 before touching it.** |
| genuinely unknowable curves | 3 | `duke-sucellus`, `zalcano`, `reward-pool`. Watchlisted, correctly. **Before adding a fourth, check for a `Module:`/`Calculator:` page — that is what closed ToA's, and this session's CoX/ToB (see the top of this section).** |
| blocked, deliberately | 1 | `reward-cart` — see section 3's "genuinely unknowable" list |
| GWDRDT own residual — **built, 4 -> 2 still needs_review, now FULLY explained** | 2 | `commander-zilyana`, `k-ril-tsutsaroth` — GWDRDT itself is resolved for all four (landmine #3, DONE); these two stay on a small, unrelated `drops_covered` gap that turns out to be ENTIRELY a `checkDropsCovered` case-sensitivity bug, not real missing content — every one of Frozen key piece/Pet Zilyana/Pet K'ril Tsutsaroth/Staff of the Dead is already correctly modeled in the document at the right rate, just under different casing than the wiki's own `dropsline` bucket uses. Both sources would go straight to `verified` the moment that comparison is fixed. See `docs/DECISIONS.md`'s "`drops_covered` compares item names case-sensitively" entry — found this session, not fixed (out of scope; the fix touches a check that gates `verified` corpus-wide and deserves its own session). |
| other | 2 | `black-knight-titan` (a Lua `{{#invoke:}}` sub-table + `items_known`), `salarin-the-twisted` (`items_known`) |
| **weight-overflow — bundle shape shipped, mad-angel also built, 5 -> 1** | 1 | `phosani-s-nightmare` (no bundle citation at all; the wiki's own published weights just don't sum to their own stated denominator). See `docs/DECISIONS.md`'s "The bundle shape, built" entry. |
| coverage gaps (`drops_covered`/`items_known`/unparseable-rarity, unrelated to transclusion/GWD) | 10 | `alchemical-hydra`, `chaos-elemental` — **both ENTIRELY the same casing bug as the GWDRDT residual row above**, not unexamined content gaps: `Pet Chaos Elemental`/`Ikkle Hydra` are already correctly modeled, `checkDropsCovered` just can't see them (see `docs/DECISIONS.md`'s new entry). `black-demon` (29 missing, thematically 100% Wilderness-teleport/blighted-supplies items — checked directly against the current wikitext snapshot, which contains no "Blighted" text and no Revenant-caves heading at all; almost certainly the same "wiki bucket vs current wikitext disagreement" class as `mad-angel`'s residual below, not confirmed item-by-item). `kalphite-queen` (11 missing — spot-checked three: `Dragon 2h sword`/`Kq head (tattered)`/`Jar of sand` all exist as ordinary `{{DropsLine}}` rows in the wikitext but don't reach the compiled document, a real and currently undiagnosed parser gap, NOT casing; `Kalphite princess` isn't in the wikitext under that name at all). `nex` (24 of 33 missing — explicitly never investigated, HANDOFF's own "suggested next steps" item 8 names this; too large a fraction of the table to be a small gap). `obor`, `black-knight-titan` (44 missing each, IDENTICAL lists — confirmed both use `{{GeneralSeedDropLines}}`, the same Lua `{{#invoke:}}` the expander cannot run that `black-knight-titan` was already diagnosed for; an override or module-output extraction is a known, named path, not yet built). `yama` (18 missing — `marginal-rates.test.ts`'s own code comment already root-causes this: the `===Contract===` block's homogenisation path sums 18 `Always` rows plus one `Yami` row onto denominator 100, a pre-existing bug, diagnosed but explicitly left unfixed). `maggot-king` (6 `Maggot egg (...)` variants — confirmed genuinely absent from the document, not a casing issue; undiagnosed). `chaos-fanatic` (its OWN `drops_covered` line is ALSO the casing bug — `Pet Chaos Elemental`/`Wine of Zamorak` both already present — but the source stays `needs_review` regardless, gated by its own separate, permanently-flagged wiki-weight-drift). `mad-angel` (compound bundle shape now built — `docs/DECISIONS.md`'s "Mad Angel's compound shape" built entry — but `drops_covered` fails on a NEW residual the fix exposed: `Clue scroll (hard)`, a row the wiki's own `dropsline` bucket hasn't caught up on since a 12 August 2026 patch swapped it for `Clue scroll (medium)`. A third instance of the "wiki's own data disagrees with itself" class, not fixable here.) |
| items_known only | 1 | `chronozon` — tier-E item-index gap |
| Vorkath's refused seed partition | 1 | `vorkath` — ratio 1.6665, correctly refused (landmine #11d), its own bespoke residual, not a clean partition |

Table rows sum to 26 (5+3+1+2+2+1+10+1+1); the 4 watchlisted raids below (a
different kind of `needs_review` — deliberate, not unresolved) bring the real
total to **30**.

Plus **6 `manual_override`/all-four-raids-shipped-but-watchlisted** —
`doom-of-mokhaiotl`, `lunar-chest` (terminal `manual_override`, not work
outstanding), and `chest-tombs-of-amascut`/`monumental-chest`/`ancient-chest`/
`rewards-chest-fortis-colosseum` (all `needs_review`, all deliberately —
see this session's own entry at the top of section 1 for why each one's
watchlist entry was left in place, and don't flip any of them without
re-deriving that call).

Plus **3 `parse_failed`, which produce no document**: **Revenant maledictus**
(own open parse_failed reason), **Burnt chest** and **Sigmund** (both tier E
and trivial — `burnt-chest` blocked on a `==Loot==` heading-matching gap,
`sigmund` has no real combat loot at all). **Corrected here**: an earlier
draft of this entry named "Black demon" as one of the three — stale, copied
forward without re-checking; Black demon was already recovered (a `needs_review`
document, not `parse_failed`) by the `DROPS_SECTION_TITLE` widening in an
EARLIER session, before this one — see landmine #4's entry below and item 5 in
section 7. **Ancient chest also left the parse_failed list this session** —
the SAME widening let it reach `==Loot table==` for the first time, and it now
has a real document (`needs_review`, watchlisted, built — see the top of
section 1).

### The four raids — ALL SHIPPED this session (the last one, Fortis Colosseum, joined ToA/CoX/ToB)

Every raid chest now has a hand-authored override (`data/overrides/`) and a
wiki-figure test verifying it against the wiki's own published figures. None
is blocked on engine capability; landmine #12's fix (an authored override
forces its source through the tier filter) is what let Fortis Colosseum, tier
D, actually get built at all. **Full detail on what each needed and what
each still declines to model is at the top of this section (this session's
own summary) and in `docs/DECISIONS.md`'s four "Phase 7: ..." entries — this
subsection is now historical, kept for the reasoning trail rather than as a
to-do list:**

1. **Chambers of Xeric -> `ancient-chest`. BUILT.** Needed two real
   corrections to an earlier research pass's own proposed mapping (33-slot
   common table with nested herb/seed `oneOf`s, not a flat 99-weight table;
   formula-driven quantities, not literal ranges) — see this session's top
   summary and `docs/DECISIONS.md`.
2. **Tombs of Amascut -> `chest-tombs-of-amascut`. BUILT** (an earlier
   session) — override, 28 wiki-figure tests, `drops_covered` now 5 of 50
   (the five remnants it deliberately does not model). **Its `Module:`-page
   lesson generalised to CoX and ToB, then to Fortis Colosseum's own (negative
   this time) check — see the top of section 1.**
3. **Theatre of Blood -> `monumental-chest`. BUILT.** Two prose UNKNOWNs
   (death-penalty magnitude, common-quantity scaling) resolved via
   `Module:Theatre of Blood calculator`.
4. **Fortis Colosseum -> `rewards-chest-fortis-colosseum`. BUILT.** Every
   wave modelled as its own complete, self-contained weighted table gated on
   `ctx.wavesReached` — no wave engine needed, contrary to what an earlier
   research pass's "population of one" framing worried about. The one real
   gap (wave-scoped armour duplicate-avoidance) ships as a quantified
   with-replacement approximation; its SCOPE (per-run vs lifetime) is still
   unconfirmed after two rounds of checking — see the top of section 1
   before trusting the armour-piece numbers for anything precision-sensitive.

### The mode question on transcluded blocks — DONE

Was: nine sources `needs_review` for this alone, rows provably one
mutually-exclusive roll (partition identity at ratio 1.0000), modelled as
`independent` to preserve the wiki's per-row rates without expressing the
single-access-roll shape. Closed by taking the "model it properly" option: a
confirmed partition now compiles to a `oneOf` node at the declared access
rate. All 9 (`abyssal-sire`, `araxxor`, `arrg`, `bryophyta`,
`dagannoth-{prime,rex,supreme}`, `deranged-archaeologist`,
`giant-sea-snake`) are `verified`. Landmine #11d (below) is the reasoning
trail for why `preroll` was rejected in favour of `independent` in the first
place — still correct, unrelated to this fix. See `docs/DECISIONS.md`'s
transclusion entry for the mechanism.

### The genuinely unknowable — leave them watchlisted, permanently, not backlog

The wiki states the mechanic exists and never states the curve (or, for the
last two, states numbers that don't reconcile with each other at all), so
there is nothing to implement at any schema level and guessing would put an
invented number behind a `verified` badge:

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
- **`chaos-fanatic`, `phosani-s-nightmare`** — added this session, a
  DIFFERENT flavour of unknowable from the four above: not a curve the wiki
  never states, but the wiki's own published per-row weights not summing to
  their own stated denominator (chaos-fanatic: 129 vs a `/128` every row
  cites; phosani-s-nightmare: 101 vs a `/100` every row cites — both ~1%
  over, both checked by hand against the raw wikitext, neither explained by
  the bundle defect below). No parser fix or model extension corrects a
  small, ordinary wiki-editing discrepancy in the source data itself; this
  would need re-derivation from drop-log data to ever close, which is out of
  scope. See `docs/DECISIONS.md`'s "root-caused — not the same defect" entry.
  **Not currently on `data/mechanics-watchlist.json`** — unlike the four
  above, `weights_sum` already fails these two directly (a real overflow, not
  a mechanic invisible to a clean parse), so nothing additional is needed to
  keep them `needs_review`. Filed here for the same reason the watchlist
  entries exist: so nobody spends time trying to "fix" a number that isn't
  wrong because of anything this codebase controls.

**Do not remove a watchlist entry, or this classification, to move the
counter.** The check exists precisely because parsing a page cleanly proves
nothing when the rows never encoded the mechanic that matters — and, now,
because sometimes the rows the page DOES publish simply don't add up.

### The bundle defect — BUILT (kept as the reasoning trail, not a to-do list)

**Built this session** — `docs/DECISIONS.md`'s "The bundle shape, built" entry
has the mechanism and the exact corpus effect; the top of section 1 has the
summary. Everything below predates the build and is kept for the reasoning
trail (why each source's own shape is what it is), not as an outstanding
task — **the per-source `status` column in the table just below is now
STALE** (written before the fix): `grotesque-guardians`/`the-leviathan`/
`the-whisperer`/`vardorvis` are `verified`; `maggot-king`/`chaos-fanatic` are
still `needs_review` but no longer FOR the bundle (their own separate
`drops_covered` gaps); `k-ril-tsutsaroth`/`commander-zilyana` are unaffected
(GWDRDT). `mad-angel`'s compound shape is now ALSO built, in a later session
(hand-authored override, not the detector), and is `needs_review` for a
NEW `drops_covered` residual the fix uncovered, not the bundle itself
anymore — see `docs/DECISIONS.md`'s "Mad Angel's compound shape" built entry.

**The shape**: some drop-table rows are not independent alternatives at all —
the wiki states outright that 2-3 items always arrive TOGETHER on one access
roll ("these supplies are all dropped together", "X and Y are always dropped
together", "bundled with"). The schema has no way to express this, so the
parser has always treated them as N competing `weighted` rows. That's wrong
two ways at once: each item's own marginal rate can happen to still read
correctly by coincidence (weight/denominator matches the bundle's true
per-item rate), which is exactly why this went undetected for so long, but
the JOINT structure is inverted — the model says "at most one of these,
never together"; the wiki says "all of these, together, or none."

**Full affected list, as currently understood — do not assume any of these
are the same defect as each other without checking; the investigation
already found they aren't all the same (below)**:

| source | status | how the bundle defect shows up here |
|---|---|---|
| `yama` | `needs_review` (other reasons) | Was a DIFFERENT defect (`always`+`fixed` fallthrough) — **fixed**, unrelated to the bundle shape. Listed here only to head off the assumption that it's part of this list. |
| `grotesque-guardians` | `needs_review` | Bundle defect, confirmed exact — its own overflow (154 vs 142) is EXACTLY the doubled weight of one 3-item potion trio. |
| `mad-angel` | `needs_review` | Bundle defect (block-level prose, no footnote — "bundled with"), overflow closely matches. |
| `maggot-king` | `needs_review` | Bundle defect (block-level prose, no footnote), overflow EXACTLY explained (200 − 41 = 159). |
| `k-ril-tsutsaroth` | `needs_review` (also GWDRDT) | Bundle defect (two footnote-cited potion pairs) **plus a separate, second defect** — see below — both contribute to its overflow; the split between them isn't fully untangled. |
| `commander-zilyana` | `needs_review` (also GWDRDT) | Same shape as K'ril (shared template between the two GWD generals). |
| `chaos-fanatic` | `needs_review` | Bundle defect present (two footnote-cited pairs) but does NOT explain this source's own overflow — see "genuinely unknowable" above; a real, separate, coincidental second issue on the same source. |
| `the-leviathan` | `needs_review`, **downgraded from `verified` this session** | Bundle defect, SILENT — table has slack, so `weights_sum` never caught it. Shipped wrong odds under a `verified` badge until downgraded. |
| `the-whisperer` | `needs_review`, **downgraded from `verified` this session** | Same, silent. |
| `vardorvis` | `needs_review`, **downgraded from `verified` this session** | Same, silent. |

**K'ril's Coins row is a genuinely separate, third defect, not the bundle
one** — its `rarity=36.7/127` for `Coins` carries a `raritynotes` that reads
"Coins come from rolls on all loot tables, including the unique table, GDT
and RDT": a composite rate the wiki computed by aggregating several DIFFERENT
roll mechanisms, inserted into this one table as if it were this table's own
share. Do not fix this by touching the bundle mechanism — it needs its own
handling (most likely: recognise and exclude/flag a row whose `raritynotes`
explicitly disclaims single-table scope, rather than blending it in).

**The fix, assessed — zero schema change needed**: an `independent`-mode
entry at the bundle's own access rate (`{kind:'fixed', num, den}`), whose
`node` is `{kind:'tableRef', ref: '<bundle-id>'}` pointing at a NEW
`data/tables/<bundle-id>.json` record with `mode: 'always'` and one entry per
bundled item — the inclusive counterpart to CoX's `oneOf` (`oneOf` = exactly
one of these; this = all of these, or none). Confirmed, not assumed:
`compile.ts`'s `tableRef` resolution and `simulate.ts`'s `always`-mode
handling are both fully mode/reachability-agnostic already (RDT/gem-table
access already proves "probabilistic access roll -> `tableRef` -> the
target's own mode takes over" works), and `data/tables/lunar_chest_{blood,
blue,eclipse}_set.json` already precedent a single-boss-specific record living
in `data/tables/` — this does not need to be reused across multiple sources
to belong there. One tiny new file per bundle.

**Detectable independent of whether it overflows — two signals, do not build
around only one**:

1. **A per-row `raritynotes` citation shared by 2+ rows** (Grotesque
   Guardians' potion trio, K'ril's two pairs, chaos-fanatic's two pairs).
   `findConfirmingSignal`'s `citedRefNames` (`build-tables.ts`) ALREADY
   extracts this shape — shared footnote names across rows — for a different
   question (confirming `preroll` mutual exclusivity). It currently only
   checks that a citation is shared, never reads what the citation's own
   text says. The missing half: classify the DEFINING occurrence's text
   against a co-drop phrase list ("dropped together", "dropped alongside",
   "always accompan-"), the same `MUTUAL_EXCLUSIVITY_PHRASES`-style regex
   list this file already uses for the sibling question.
2. **Block-level prose between a heading and its `{{DropsTableHead}}`, with
   NO per-row footnote at all** — used by `maggot-king`, `mad-angel`, and
   all three downgraded sources; i.e. most of the real instances, not a rare
   variant of signal 1. **Not captured anywhere right now**:
   `HeadingBlock`/`WikitextDropLine` carry `heading`/`section`/`lines` only,
   no preamble text. This is a genuinely new extraction point in
   `wikitext-drops.ts`, not a reuse of existing state.

Building this as a STANDING check (mirroring `checkTransclusionPartitions` —
runs on every block regardless of current pass/fail, not gated behind
`weights_sum` already having failed) is the whole point: a fix contingent on
the arithmetic breaking is exactly what let the three downgraded sources ship
`verified` silently. `mad-angel`'s "either sharks or yellowfins drop, bundled
with a prayer potion(2) and a super combat potion(1)" is a compound of
`oneOf` (the fish choice) AND this bundle shape (the potions) in one heading
— flagged as the one case that won't fully close on a first, simple pass.

**BUILT.** Real, moderate-sized capability (new extraction point, new
heuristic, new group metadata, new standing check, plus the `data/tables/`
files themselves) — see `docs/DECISIONS.md`'s "The bundle shape, built"
entry for the mechanism, including how Mad Angel's compound shape is
refused rather than guessed, exactly as flagged below.

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
  architecture" or "defer and approximate." BUILT this way, confirming the
  theory: `cox_points`'s `eliteClueMarginal`/`olmletMarginal` params
  (`data/overrides/ancient-chest.json`), exact as predicted.** This was the
  proposal's own
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

### 3. `refs_resolve` and RDT/gem-table access — GWDRDT is DONE

**Built** — `docs/DECISIONS.md`'s "GWDRDT built" entry. It needed TWO new
records (`gwd_rare_drop_table.json`, `gwd_gem_drop_table.json` — the
existing `mega_rare_drop_table.json` is reused for the third tier, not
duplicated) plus a small, generic code change in `rdt-access.ts` (the
`{{GWDRDT}}` branch used to push to `unresolved` unconditionally; it now
emits two access lines) — "one record, not a code fix" undersold both the
record count and the code needed, written before anyone had read
`Template:GWDRDT`'s own wikitext. `{{GWDRDT}}` is a genuinely different
table (rune sword instead of runite bar, mega-rares folded in, unaffected
by ring of wealth, Coins handled by the boss's own main table instead of a
row here). **Four sources** — Kree'arra and General Graardor were the only
ones ever named, but `commander-zilyana` and `k-ril-tsutsaroth` were also
missing the identical item set per their own `drops_covered` detail strings
(found by an earlier session's needs_review recount, `docs/DECISIONS.md`).
`kree-arra`/`general-graardor` now reach `verified`; the other two drop to a
small, unrelated `drops_covered` residual.

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

### 13. `corpus-reproducibility.test.ts` drifts on its own — a live-price artifact, not a code regression

Found while validating the Mad Angel build (landmine, not caused by it —
`mad-angel` never appears in its own failure list). `parseBoss` folds real,
LIVE GE prices (`fetchGePrices`, fetched fresh on every run, no snapshot
involved) into `checkEvMatches`, and `evMatches.detail` — a string carrying
the actual computed numbers, for any source with a rendered-page snapshot —
is embedded verbatim in the committed document's own `validation.checks`.
The test's `deepStrictEqual` then compares *today's* price-derived string
against whatever price was live when the document was last committed, so it
fails for an ever-growing, ever-changing set of sources as GE prices move —
confirmed non-deterministic across runs (42, then 39, then 41-and-41 stable
across two back-to-back runs) and confirmed to be about prices specifically,
not `data/bosses/` drift: `cerberus`, re-parsed alone via the CLI (which
writes the real `data/bosses/` directory), reproduced its committed file
byte-for-byte, while the SAME source failed the test's own scratch-dir
comparison run around the same time. **`mad-angel` is immune** — its own
`ev_matches.detail` is the constant "no rendered page snapshot available"
string, which is exactly how this was isolated to prices rather than
anything this session's data changes touched.

Not fixed — out of scope, flagged for a decision:
exclude `ev_matches.detail` from the comparison, or freeze `checkEvMatches`
in this test behind a fixed price table instead of a live fetch (this test
is the one place in the pipeline that reads prices without going through
`data/snapshots/`'s otherwise-universal snapshot-first discipline). Expect
`pnpm -r test` to show this failing on some non-empty, non-reproducible set
of sources on any future run far enough from `data/bosses/*.json`'s last
regeneration — it is not evidence of an uncommitted change or a new defect
by itself. Cross-check against `mad-angel`'s own absence from the list (or
any other zero-rendered-snapshot source) before assuming a fresh session's
run of this test means something broke.

## 7. Suggested next steps, in order

Section 3 has the reasoning; this is the order. Everything above item 1 in
earlier versions of this file (Zalcano, the `SimContext` UI wiring, Reward
pool, the reward-cart/reward-pool watchlist misattribution) is **DONE** and has
been folded into sections 1 and 3 rather than kept as struck-through history.

1. ~~Decide the transcluded-block mode question.~~ **DONE.** Modelled
   properly: a confirmed partition (`transclusionPartition` ratio ≈ 1.0000)
   now emits a `oneOf` node at the declared access rate instead of N
   independent rows, matching CoX's own herb/seed `oneOf` nesting. Exact, not
   an approximation — see `docs/DECISIONS.md`'s transclusion entry for what
   changed and the corpus effect.
2. ~~The remaining three raids~~ **DONE** — ToB, CoX and Fortis Colosseum all
   shipped this session, joining ToA. See the top of section 1 for what each
   needed, including the two real corrections to CoX's own earlier proposed
   mapping and the dropversion= parser fix (a real, corpus-wide bug, fixed
   generally) that Normal/Hard Mode blending on `monumental-chest` used to be
   an example of. All four stay `needs_review`/watchlisted deliberately —
   don't remove any watchlist entry without re-deriving whether its remaining
   residual is acceptable-to-ship-anyway or not.
3. **`black-knight-titan`** — a coverage failure, though `repeatable: false`
   (a Holy Grail quest boss) means fixing it moves the raw coverage count more
   than the number that matters. Its `{{GeneralSeedDropLines}}` is a Lua
   `{{#invoke:}}` the expander cannot run; the rows would have to come from
   somewhere else (an override, or the module's own output). It also fails
   `items_known`.
4. ~~GWDRDT~~ **DONE** — landmine #3 closed, `docs/DECISIONS.md`'s "GWDRDT
   built" entry. Two new `data/tables/gwd_*.json` records plus a small
   `rdt-access.ts` code change (the "one record, not a code fix" framing was
   wrong on both counts). `kree-arra`/`general-graardor` now `verified`;
   `commander-zilyana`/`k-ril-tsutsaroth` down to a small, unrelated
   residual.
5. ~~The bundle defect~~ **DONE** — built, `docs/DECISIONS.md`'s "The bundle
   shape, built" entry (see the top of section 1). K'ril's separate,
   third Coins composite-rate defect is ALSO now fixed, separately —
   `docs/DECISIONS.md`'s "K'ril's Coins composite rate" entry.
   ~~Mad Angel's compound `oneOf`-and-bundle shape~~ **DONE** too, in a
   later session — hand-authored `data/overrides/mad-angel.json`, per the
   confirmed proposal, not a detector generalization. Stays `needs_review`
   for a NEW, separate `drops_covered` residual the fix exposed (a stale
   `Clue scroll (hard)` row in the wiki's own `dropsline` bucket, superseded
   on the page itself by a 12 August 2026 patch) — not fixable without the
   wiki's own bucket catching up. `docs/DECISIONS.md`'s "Mad Angel's
   compound shape" entry and its "built" follow-up have the full design and
   the residual.
6. ~~`black-demon`~~ **DONE** — recovered for free by the `DROPS_SECTION_TITLE`
   widening (section 1); it now has a `needs_review` document.
7. **Un-watchlist as mechanics land**, following the four-step sequence in
   `docs/OVERRIDES.md` — the wiki-figure test (step 3) is the part that is
   easy to skip and must not be.
8. **Nex** (tier D, `include: true`) has still never been investigated — check
   whether it is actually raid-shaped before assuming it needs any of this
   machinery.

**Not next steps, deliberately:** the "Uniques"/"Mutagens" heading question
(section 5 — answered "no available signal" every time it has been re-checked),
`ev_matches` (closed permanently, section 5), the genuinely-unknowable curves
including `chaos-fanatic`/`phosani-s-nightmare`'s non-reconciling wiki weights
(section 3 — permanently flagged, not backlog, same as Duke Sucellus/Zalcano),
and `reward-cart` (blocked, section 3).
