# OSRS Loot Simulator — Build Plan

> **This is the original build spec, written before any code existed**, kept
> verbatim as the design record — not a live status page. Where it says
> **DECIDED**, that held; where it says **VERIFY**, it was checked against the
> wiki during implementation. Some particulars have since diverged in the
> normal way a spec does once real code and real wiki data show up (there is
> no `docs/LOOT_MODEL.md` or weekly `ingest.yml` cron, for two examples) — for
> current state, corpus numbers, and the reasoning behind every judgement call
> made along the way, see [`docs/HANDOFF.md`](./docs/HANDOFF.md) and
> [`docs/DECISIONS.md`](./docs/DECISIONS.md) instead.

A wiki-driven loot table database and kill simulator for Old School RuneScape.

This document is the spec. Read it fully before writing code. Where it says **DECIDED**, do not
re-litigate. Where it says **VERIFY**, check reality before building against the assumption.

---

## 0. Instructions for the implementing agent

1. Build in the phase order given in section 16. Do not skip ahead.
2. The loot model (section 4) is the heart of the project. Get it right before anything else.
3. **No per-boss `if` statements in the simulator, ever.** Special cases are expressed as data
   (conditions, formula references, override files), not branches. If you find yourself writing
   `if (boss === 'zulrah')`, the model is missing an expressive feature. Fix the model instead.
4. Every phase ends with tests passing and a commit. Do not batch phases into one commit.
5. When wiki data contradicts this document, trust the wiki and flag the contradiction in
   `docs/DECISIONS.md`.

---

## 1. Goal and scope

### What this is

- A **data pipeline** that turns OSRS Wiki drop tables into a validated, canonical JSON schema.
- A **static website** that lets a user search for a boss, fetch its table, and simulate N kills
  entirely client-side.

### In scope for v1

- Search a boss by fuzzy text match.
- Display its full loot table with correct rates.
- Simulate 1 to 10,000,000 kills and show aggregated results plus a per-kill log for small runs.
- Correct handling of: always drops, pre-rolls, weighted main tables, tertiary drops,
  members/F2P variants, the rare drop table family, and multi-roll bosses.

### Out of scope for v1

- User accounts, saved runs, drop log import.
- RS3 support.
- Any runtime backend. Phase 6 prepares one; v1 does not need it.
- Perfect coverage of every raid. Ship what validates, add the rest incrementally.

### Non-goals

- Not a DPS calculator. Not a wiki mirror. Not a GE price tracker.

---

## 2. Architecture

```
OSRS Wiki (Bucket API)
        │
        ▼
  apps/ingest ──── parses, normalizes, validates ────► data/*.json  (committed to git)
        │                                                    │
        │                                                    ▼
        │                                          apps/web build copies to dist/data/
        │                                                    │
        └──── raw snapshots ──► data/snapshots/ (gitignored)  ▼
                                                    GitHub Pages (static)
                                                             │
                                                             ▼
                                              browser fetches JSON, sims in a Worker
```

**DECIDED: no database and no server in v1.** The full dataset is 1 to 2 MB. Git is the revision
history, the diff tool, and the audit log. When the wiki changes a rate, it shows up as a
reviewable PR diff.

---

## 3. Repository layout

```
osrs-loot-sim/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy.yml
│       └── ingest.yml
├── packages/
│   └── loot-model/                 # zero runtime deps besides zod
│       ├── src/
│       │   ├── schema.ts           # zod schemas + inferred types
│       │   ├── conditions.ts       # condition evaluation
│       │   ├── formulas.ts         # formula registry
│       │   ├── simulate.ts         # the simulator
│       │   ├── expected-value.ts   # analytic EV, used for validation
│       │   ├── rng.ts              # seedable PRNG
│       │   └── index.ts
│       └── test/
├── apps/
│   ├── ingest/
│   │   ├── src/
│   │   │   ├── wiki/               # API client, rate limiting, caching
│   │   │   ├── parse/              # wiki shape -> canonical model
│   │   │   ├── validate/           # invariant checks
│   │   │   ├── report.ts           # writes data/_report.json
│   │   │   └── main.ts
│   │   └── test/
│   └── web/
│       ├── src/
│       ├── public/
│       ├── index.html
│       └── vite.config.ts
├── data/
│   ├── index.json                  # slug, name, aliases, status. Loaded eagerly by the FE.
│   ├── bosses/*.json               # generated
│   ├── tables/*.json               # shared tables (RDT, gem, mega-rare, herb, seed)
│   ├── overrides/*.json            # hand-authored, wins over generated
│   ├── snapshots/                  # GITIGNORED. raw wiki responses.
│   ├── _report.json                # validation results
│   └── LICENSE                     # CC BY-NC-SA 3.0
├── docs/
│   ├── LOOT_MODEL.md               # the schema, explained for contributors
│   ├── OVERRIDES.md                # how to hand-author a boss
│   └── DECISIONS.md                # running log of judgement calls
├── infra.example/                  # committed template, placeholders only
├── infra/                          # GITIGNORED. real IDs, scripts, secrets.
├── CLAUDE.md
├── CONTRIBUTING.md
├── LICENSE                         # MIT, code only
├── PROJECT_PLAN.md                 # this document, repo root
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 4. The loot model

This is the core spec. Implement it in `packages/loot-model/src/schema.ts` as Zod schemas with
types inferred from them. Do not hand-write the TypeScript types separately.

### 4.1 Rates

```ts
type Rate =
  | { kind: 'always' }
  | { kind: 'weight'; weight: number }
  | { kind: 'fixed'; num: number; den: number }
  | { kind: 'formula'; id: FormulaId; params: Record<string, unknown> }
```

- `weight` is a share of the parent table's `denominator`. Used inside `weighted` tables.
- `fixed` is an independent probability, `num/den`. Used for tertiary drops and table access.
- `formula` defers to the formula registry. Used for point-scaled and KC-scaled rates.

### 4.2 Nodes

```ts
type Node =
  | { kind: 'item'; itemId: number; name: string; qty: QtySpec; noted?: boolean }
  | { kind: 'tableRef'; ref: string }        // resolves against data/tables/
  | { kind: 'nothing' }
  | { kind: 'oneOf'; entries: Entry[] }      // inline sub-table, no shared id

type QtySpec =
  | { kind: 'exact'; n: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'choice'; values: number[] }     // equally likely, e.g. clue caskets
```

`nothing` must be explicit. Never represent an empty slot as an absent entry.

### 4.3 Tables

```ts
type Table = {
  id: string
  mode: 'always' | 'preroll' | 'weighted' | 'independent'
  rolls: number | Rate                       // default 1
  denominator?: number                       // required when mode is 'weighted'
  entries: Entry[]
  notes?: string
}

type Entry = {
  node: Node
  rate: Rate
  conditions?: Condition[]                   // ALL must hold (AND)
}
```

Mode semantics, which the simulator implements exactly once:

| mode | behaviour |
|---|---|
| `always` | every entry drops, unconditionally |
| `preroll` | entries checked in order; **first hit short-circuits the whole table chain** |
| `weighted` | one entry selected, weights summing to `denominator`; remainder is implicit `nothing` |
| `independent` | every entry rolled separately; multiple can hit in one kill |

### 4.4 Conditions

```ts
type Condition =
  | { kind: 'members'; value: boolean }
  | { kind: 'ringOfWealth'; value: boolean }
  | { kind: 'onSlayerTask'; value: boolean }
  | { kind: 'questComplete'; quest: string }
  | { kind: 'killCountAtLeast'; n: number }
  | { kind: 'variant'; name: string }        // 'normal' | 'demonic' | 'hard' etc.
```

Conditions are evaluated against a `SimContext` supplied by the UI. This single mechanism solves:

- **Brutus members/F2P interleaving.** The wiki renders both variants in one table with `(m)` and
  `(f)` superscripts. Naive summing gives 106/81. Split by condition and each variant sums to
  exactly 81.
- **Ring of wealth on the gem table.** RoW removes the `nothing` slots, which changes effective
  rates rather than just the item pool.
- **Legends' Quest gating** on mega-rare access via the gem table (but not via the RDT).

### 4.5 Boss document

```ts
type Boss = {
  slug: string
  name: string
  aliases: string[]
  wikiPage: string
  wikiRevId: number
  variants: string[]                         // default ['normal']
  tables: Table[]                            // evaluated in array order
  contextDefaults: Partial<SimContext>
  status: 'verified' | 'needs_review' | 'manual_override'
  validation: ValidationResult
  source: 'generated' | 'override' | 'merged'
  parserVersion: number
}
```

### 4.6 Formula registry

`Map<FormulaId, (params: unknown, ctx: SimContext) => number>` returning a probability in [0,1].

Expected members. Do not add more without justification:

- `toa_invocation` — Tombs of Amascut raid level scaling
- `cox_points` — Chambers of Xeric unique chance from points
- `tob_points` — Theatre of Blood
- `barrows_kc` — Barrows reward roll formula
- `wintertodt_points`, `tempoross_points`
- `wilderness_slayer` — task-boosted wilderness boss rates

Everything else must be expressible without a formula. Zulrah becomes `rolls: 2` on a normal
weighted table. Vorkath is `always` plus `weighted`. Neither needs code.

---

## 5. Shared tables

**DECIDED: shared tables are their own records in `data/tables/`, referenced by `tableRef`. Never
inline them into a boss.** When the wiki corrects an RDT rate, one re-parse fixes 200 bosses.

Required at minimum:

- `rare_drop_table` — has the gem table as a sub-table and a chance at the mega-rare table
- `gem_drop_table` — also reaches mega-rare, gated on Legends' Quest via this path
- `mega_rare_drop_table` — mostly `nothing`, plus rune spear, dragon spear, shield left half
- `herb_drop_table`, `seed_drop_table`, `talisman_drop_table`

The RDT family is recursive, not flat. Model it as nested `tableRef` nodes. The simulator resolves
refs lazily with a cycle guard.

---

## 6. Ingest pipeline

### 6.1 Source

The OSRS Wiki replaced Semantic MediaWiki with **Bucket**, Weird Gloop's structured-data extension.
Query it through the MediaWiki API:

```
GET https://oldschool.runescape.wiki/api.php
  ?action=bucket
  &format=json
  &query=bucket('drops').select('page_name','item','quantity','rarity').where('page_name','Brutus').run()
```

Response shape is `{ bucketQuery, bucket: [...], error? }`.

**VERIFY before building:** the exact field names on the `drops` bucket. Check
`https://oldschool.runescape.wiki/w/Help:Editing/Bucket` for the live schema list. Weird Gloop
documents Bucket's API and schema as **unstable and subject to change**, so:

- Put all field-name knowledge in one module, `apps/ingest/src/wiki/fields.ts`.
- Validate every API response with Zod at the boundary. Fail loudly on shape drift, never silently.

Other endpoints you need:

| Purpose | Endpoint |
|---|---|
| Boss list | `action=query&list=categorymembers&cmtitle=Category:Bosses` |
| Fuzzy search | `action=opensearch` |
| Change detection | `action=query&list=recentchanges` |
| Page HTML fallback | `action=parse` |
| Item prices | `https://prices.runescape.wiki/api/v1/osrs/latest` |

### 6.2 Etiquette (non-negotiable)

- **User-Agent:** `osrs-loot-sim/<version> (+https://github.com/<user>/osrs-loot-sim)`.
  Descriptive, with contact info. Weird Gloop is friendly to tools but wants to know who is calling.
- Serial requests with a delay between them. No parallel bursts.
- Cache every response to `data/snapshots/` and re-parse from disk during development.
- `api.php` is robots-disallowed for generic crawlers. This is a documented API used deliberately,
  not a crawl, so it is fine — but the User-Agent is what makes that distinction visible.

### 6.3 Snapshot-first design

**DECIDED:** persist the raw response alongside the parsed output plus a `parserVersion` integer.
When the parser improves, re-parse from disk. Never re-hit the wiki to fix your own bug.

`apps/ingest` gets three commands:

```
pnpm ingest fetch   [--boss <slug>] [--all] [--changed]   # network -> data/snapshots/
pnpm ingest parse   [--boss <slug>] [--all]               # snapshots -> data/bosses/
pnpm ingest report                                        # -> data/_report.json
```

`--changed` uses `list=recentchanges` against the stored `wikiRevId` per boss. Poll what moved,
not everything. Cheap, respectful, correct.

### 6.4 The parsing problem

**Bucket gives you `(item, quantity, rarity)`. It does not give you roll semantics.** Those live in
section headings and prose footnotes written for humans. The parser's real job is inferring
structure. Worked example, Brutus:

Headings on the page: `100%`, `Pre-roll`, `Armour`, `Runes and ammunition`, `Seeds`, `Resources`,
`Other`, `Tertiary`. That looks like seven tables. It is actually four:

| Canonical table | Source | Notes |
|---|---|---|
| `always` | `100%` | bull bones, raw t-bone steak |
| `preroll` | `Pre-roll` | `/150`, hits short-circuit the main table |
| `weighted` | Armour + Runes + Seeds + Resources + Other | one table, `denominator: 81` |
| `independent` | `Tertiary` | clue scrolls, beef; can stack with the main drop |

The four middle headings are **cosmetic groupings, not separate tables**. Infer membership from
the shared denominator, not the heading text.

And the weights only reconcile once you split by membership:

- Members: armour 6 + runes 30 + seeds 15 + resources 30 = **81** ✓
- F2P: armour 6 + runes 30 + coins 25 (replacing seeds 15 and noted steaks 10) = **81** ✓
- Naive sum of everything rendered: **106/81** ✗

### 6.5 Parser heuristics

1. Group entries by rarity denominator. Equal denominators usually mean one table.
2. Detect `(m)` and `(f)` markers and emit `members` conditions.
3. Map heading text to mode via a lookup table: `100%`/`Always` → `always`,
   `Pre-roll` → `preroll`, `Tertiary`/`Secondary` → `independent`, else `weighted`.
4. Detect `Rare drop table` / `Gem drop table` rows and emit a `tableRef` node with the row's
   rarity as the access `Rate`.
5. Detect `Nothing` rows and emit `{ kind: 'nothing' }`.
6. If weights do not reconcile after all of the above, **do not guess**. Emit
   `status: 'needs_review'` with the specific failure recorded.

---

## 7. Validation

**DECIDED: validation status is a first-class field, not a console warning.** This is what lets you
ship 80% of bosses in week two instead of chasing perfection.

Checks, all run in CI:

| Check | Rule |
|---|---|
| `weights_sum` | For each `weighted` table, per condition-variant, weights sum to `denominator` |
| `refs_resolve` | Every `tableRef` resolves and the graph is acyclic |
| `rates_valid` | Every probability lands in [0,1]; no NaN |
| `qty_sane` | Ranges have `min <= max`; no negative quantities |
| `ev_matches` | Simulated 1M-kill gp/kill is within 2% of the wiki's stated average kill value |
| `items_known` | Every `itemId` resolves against the item index |

`ev_matches` is the strongest signal you have and it is free. The wiki prints its own expected value
per kill (Brutus: 588.65). If your simulation matches, your weights are almost certainly right.

Failures set `status: 'needs_review'` and land in `data/_report.json`. Build a minimal admin page
at `/admin` in the FE that lists failures with the reason. Two hours of work, and it turns
correctness into a queue you burn down instead of a wall you hit.

**A parser regression must fail CI, not silently ship a boss that drops 40% too much gold.**

---

## 8. Simulator

Lives in `packages/loot-model`, not the FE. That way CI runs EV checks on every commit.

```ts
function simulate(boss: Boss, n: number, ctx: SimContext, seed: number): SimResult
```

Requirements:

- **Seedable PRNG.** `mulberry32` is fine. Same seed plus same input equals same output, always.
  Never use `Math.random()`.
- **Precompute cumulative weight arrays** per table on load. Each roll is a binary search, not a
  linear scan.
- **Typed arrays for tallies.** `Int32Array` indexed by a dense item index.
- Return aggregate counts, gp totals, and a per-kill log capped at the first 1,000 kills.
- 10M kills should complete in a couple of seconds.

Also implement `expectedValue(boss, ctx)` analytically (no sampling) for the validation check and
for displaying theoretical rates next to observed ones.

---

## 9. Frontend

Vite + React + TypeScript + Tailwind + TanStack Query.

### Data loading

- Load `data/index.json` eagerly. It is small: slug, name, aliases, status.
- Fuzzy-search that index client-side. No search API needed.
- Lazy-fetch `data/bosses/{slug}.json` on selection, cached by TanStack Query.
- **Never `import` the boss JSON into the bundle.** 250 bosses would bloat it. Fetch at runtime.

### Simulation

- Run in a **Web Worker** for anything over ~100k kills. The main thread must stay responsive.
- Show a progress indicator for long runs.
- Expose the seed in the UI and put it in the URL so results are shareable and reproducible.

### Context controls

Surface `SimContext` as UI toggles: members, ring of wealth, on slayer task, variant selector,
quest completion, kill count. These directly drive condition evaluation.

### Pages

- `/` — search + boss view + simulator
- `/boss/:slug` — deep-linkable, context and seed encoded in query params
- `/admin` — validation report

### GitHub Pages gotchas

Two things will bite you. Handle both up front.

1. **Base path.** Project sites are served from a subpath.

   ```ts
   export default defineConfig({
     base: process.env.GITHUB_ACTIONS ? '/osrs-loot-sim/' : '/',
   })
   ```

   Get this wrong and you deploy a white page with 404s on every asset. It is the single most
   common Pages failure.

2. **SPA routing.** Pages has no server, so client-side routes 404 on refresh. Add a build step
   copying `dist/index.html` to `dist/404.html`. One line, keeps clean URLs.

### Design direction

Dark, dense, functional. This is a tool for people who read drop tables for fun. Prioritise
information density over whitespace. Show fractions (`1/128`) alongside decimals. Use the wiki's
item icons via their image URLs with attribution.

---

## 10. Licensing

This repo needs **two licences**, and this is not optional.

| Path | Licence | Why |
|---|---|---|
| everything except `data/` | MIT | your code, your choice |
| `data/` | **CC BY-NC-SA 3.0** | derived from OSRS Wiki content |

The wiki is CC BY-NC-SA 3.0. Parsed drop tables are a derivative work, so **share-alike and
non-commercial carry over**. The NC clause means you cannot put MIT on the whole repo.

Deliverables:

- `LICENSE` at root (MIT), scoped explicitly to code in its header.
- `data/LICENSE` (CC BY-NC-SA 3.0).
- A README section explaining the split.
- A **visible attribution line in the site footer** linking to the OSRS Wiki, plus the Jagex
  trademark acknowledgement.

---

## 11. Infra folder

**DECIDED:** `infra/` is gitignored and holds anything with a real identifier or secret.
`infra.example/` is committed with placeholders and is the documentation.

Important constraint: **`.github/workflows/` must be committed** or Actions will not run. Those
files therefore contain zero secrets. Everything sensitive goes in repo secrets or `infra/`.

```
infra.example/                      # COMMITTED
├── README.md                       # setup walkthrough
├── cloudflare/
│   ├── wrangler.toml.example       # account_id = "REPLACE_ME"
│   ├── .dev.vars.example
│   └── d1-schema.sql
├── scripts/
│   ├── deploy-worker.sh.example
│   ├── d1-migrate.sh.example
│   └── seed-d1.sh.example
└── github/
    └── required-secrets.md         # names only, never values

infra/                              # GITIGNORED, mirrors the above with real values
```

`infra.example/github/required-secrets.md` should list, by name only:

| Secret | Needed for | Phase |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Worker/D1 deploy | 6 |
| `CLOUDFLARE_ACCOUNT_ID` | Worker/D1 deploy | 6 |
| `INGEST_PAT` | letting sync PRs trigger CI | 3 |

---

## 12. .gitignore

This repo is public. Be thorough.

```gitignore
# deps & build
node_modules/
dist/
build/
.vite/
*.tsbuildinfo
coverage/
.turbo/

# env & secrets
.env
.env.*
!.env.example
.dev.vars
.dev.vars.*
!.dev.vars.example
secrets.json
*.pem
*.key
*.p12
*.pfx
id_rsa*
.npmrc
.netrc

# infra (real values live here)
infra/
!infra.example/

# cloudflare
.wrangler/
wrangler.toml
!infra.example/cloudflare/wrangler.toml.example

# regenerable wiki cache, large
data/snapshots/

# agent & editor local config
.claude/settings.local.json
CLAUDE.local.md
.cursor/
.idea/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json

# os
.DS_Store
Thumbs.db

# misc
*.log
.pnpm-debug.log*
tmp/
scratch/
```

Two habits worth adopting now: run `git status` before the first commit and actually read it, and
add a `gitleaks` step to CI. Public repo, real API tokens in `infra/`. Cheap insurance.

---

## 13. GitHub Actions

### `deploy.yml`

```yaml
name: deploy
on:
  push: { branches: [main] }
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r test
      - run: pnpm --filter web build
      - uses: actions/upload-pages-artifact@v3
        with: { path: apps/web/dist }
  deploy:
    needs: build
    environment: github-pages
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
```

Set **Settings → Pages → Source to "GitHub Actions"**, not "Deploy from branch".

### `ci.yml`

Runs on PRs: typecheck, lint, test, and the full validation suite over `data/`.

### `ingest.yml`

Weekly cron plus `workflow_dispatch`. Runs `ingest fetch --changed`, then `parse`, then `report`,
then opens a PR rather than pushing to main.

```yaml
- run: pnpm ingest fetch --changed && pnpm ingest parse --all && pnpm ingest report
- uses: peter-evans/create-pull-request@v7
  with:
    token: ${{ secrets.INGEST_PAT }}
    title: "data: wiki sync"
    branch: bot/wiki-sync
    commit-message: "data: sync from OSRS Wiki"
```

Two things that will bite you:

- You must enable **Settings → Actions → "Allow GitHub Actions to create and approve pull
  requests"**, or this fails with a permissions error.
- PRs created with the default `GITHUB_TOKEN` **do not trigger other workflows**, so CI will not run
  on the sync PR. Use a fine-grained PAT (`INGEST_PAT`) or accept manual review.

Cache `data/snapshots/` between runs with `actions/cache` so re-parses do not re-fetch.

---

## 14. Cloudflare (Phase 6, optional)

Only build this if v1 ships and you actually want saved runs, a drop-log importer, or reverse
queries ("which bosses drop a dragon warhammer"). **v1 does not need it.**

- **Workers** — 100k requests/day free, no cold starts.
- **D1** — SQLite, 5 GB free tier.
- Schema and deploy scripts live in `infra.example/cloudflare/`, real values in `infra/`.

Design it so the FE degrades gracefully: if the Worker is unreachable, the site still works fully
against static JSON. The backend is additive, never load-bearing.

---

## 15. Conventions

- **TypeScript strict**, `noUncheckedIndexedAccess` on.
- **Zod at every boundary**: wiki responses in, JSON files in and out, worker messages.
- **Vitest** everywhere. `packages/loot-model` targets high coverage; it is pure and easy to test.
- **ESLint** with an import-boundary rule: `loot-model` may not import from `apps/*`.
- **Conventional commits**: `feat:`, `fix:`, `data:`, `chore:`.
- No default exports except React components.
- Write `docs/DECISIONS.md` entries whenever you make a judgement call the spec did not cover.

---

## 16. Phases

Each phase ends with tests green and a commit.

### Phase 0 — Scaffold
pnpm workspace, three packages, tsconfig base, ESLint, Vitest, both LICENSE files, .gitignore,
`infra.example/`, README, CLAUDE.md. CI runs and passes on an empty test suite.

**Done when:** `pnpm install && pnpm -r test && pnpm -r typecheck` passes clean.

### Phase 1 — Loot model + simulator
Full Zod schema, condition evaluation, formula registry (stubs are fine), seeded RNG, simulator,
analytic EV. Hand-write a Brutus fixture **by hand from section 6.4** and test against it.

**Done when:** simulating the hand-written Brutus fixture 1M times produces gp/kill within 2% of
588.65, and members vs F2P produce different, individually-correct distributions.

### Phase 2 — Ingest, happy path
Wiki client with User-Agent and rate limiting, snapshot store, parser for standard bosses,
validation suite, report writer. Target roughly 20 simple bosses.

**Done when:** `ingest fetch --all && ingest parse --all` produces at least 15 bosses at
`status: 'verified'`, and the generated Brutus matches the Phase 1 hand-written fixture.

### Phase 3 — Shared tables + RDT
`data/tables/` records, `tableRef` resolution with cycle detection, ring-of-wealth conditions,
Legends' Quest gating. Re-run over all bosses with RDT access.

**Done when:** a mid-level RDT monster simulates correct dragon-item rates, and RoW measurably
changes the outcome in the right direction.

### Phase 4 — Frontend
Search, boss view, context controls, worker-based simulator, results view, admin page. Vite base
path and 404.html handled. Deploy to Pages.

**Done when:** the site is live, a stranger can search "vork", simulate 100k kills, and read
sensible output.

### Phase 5 — Overrides + hard bosses
Override file loading and merge semantics, `docs/OVERRIDES.md`, real formula implementations, then
hand-author the raids: CoX, ToB, ToA, Nex, Barrows, Wintertodt, Tempoross.

**Done when:** every boss in `index.json` is `verified` or `manual_override`, with zero
`needs_review`.

### Phase 6 — Optional backend
Only if wanted. See section 14.

---

## 17. Open questions

Record answers in `docs/DECISIONS.md` as they are resolved.

1. Exact `drops` bucket field names. **VERIFY against the live wiki before Phase 2.**
2. Are pre-roll tables reliably distinguishable from the page structure, or does every pre-roll
   boss need an override?
3. Item ID source: does the `drops` bucket carry IDs, or must you join through `infobox_item`?
4. How many bosses have multi-variant tables like Brutus/Demonic Brutus, and should variants be
   separate documents or one document with `variant` conditions? (Spec currently says the latter.)
5. Does the wiki expose its "average kill value" figure through Bucket, or does it need parsing
   out of the rendered page?
