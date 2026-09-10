# Repository guidance for Codex

Working instructions for Codex. Claude Code users have a separate `CLAUDE.md`;
keep the shared project rules consistent between these two guides. Read
[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) for engineering context and current
limitations. Keep this file focused on durable instructions, not session logs
or corpus counts.

## Project and code map

OSRS Loot Simulator turns Old School RuneScape Wiki drop data into validated
JSON and simulates loot in the browser. It is a pnpm TypeScript monorepo with
a static GitHub Pages site, no application server, and no database.

- `packages/loot-model/src/`: pure model and computation. `schema.ts` defines
  Zod contracts; `conditions.ts` and `formulas.ts` interpret mechanics;
  `compile.ts` prepares tables for `simulate.ts` and `expected-value.ts`.
  `rng.ts` provides seeded randomness; `cumulative-probability.ts` supplies
  analytic probability calculations.
- `apps/ingest/src/`: Node-only CLI (`main.ts`), wiki client and snapshots,
  inventory, item resolution, wikitext parsing, overrides, validation, and
  site-index generation. Item-name ambiguity is handled in `items/index.ts`
  and `items/allowlist.ts`; icon resolution and curated flags live alongside.
- `apps/web/src/`: React + Vite UI, React Query data fetching, URL state,
  context controls, and simulation in `workers/simulate.worker.ts`.
- `data/`: committed inventory, boss documents, shared tables, overrides,
  watchlist, item metadata, and site index. `data/snapshots/` is the ignored
  raw wiki cache used to reproduce parsing.
- `apps/web/scripts/`: copies publishable data into ignored `apps/web/public/`
  and creates the production SPA fallback. Never hand-edit those build copies.
- `.github/workflows/`: CI and Pages deployment; `infra.example/` contains
  placeholder infrastructure templates.

## Read the right source

- Read `README.md` for the product and contributor overview, and
  `docs/PROJECT_GUIDE.md` for current architecture, decisions and remaining work.
- Before structural changes, consult the relevant sections of `PROJECT_PLAN.md`
  and `docs/mechanics-model-proposal.md`. Both are historical design records;
  check the current guide, implementation and tests before acting on old phase
  instructions or capability claims.
- Before authoring an override, read `docs/OVERRIDES.md` and the relevant
  `docs/bosses/<slug>.md` research. Confirm revision-bound evidence against the
  available source and implementation; do not treat old verdicts as current.
- Check `data/_inventory.json`, `data/index.json`, boss validation reports and
  the watchlist for current coverage. `docs/TRIAGE.md` is generated, not a backlog.
- Update `docs/PROJECT_GUIDE.md` in place for significant new decisions or changed
  limitations, linking evidence and tests. Keep historical investigation details
  in Git history rather than restoring session journals.
- Do not repeat a closed investigation without new evidence. Distinguish an
  unbuilt mechanic from a rate the source genuinely does not quantify.

## Architectural and data rules

- **No per-boss branches in the simulator.** Express mechanics through data,
  conditions, formula references, shared tables, and overrides. Extend the
  general model when it lacks a needed capability.
- `packages/loot-model` must not import from `apps/*`. Its only runtime
  dependency is `zod`; network access, wiki knowledge, UI, and price fetching
  belong outside it.
- Preserve strict TypeScript and `noUncheckedIndexedAccess`. Validate external
  boundaries with Zod: wiki responses, JSON input/output, and worker messages.
  Follow existing named-export conventions; React components may use defaults.
- Keep simulation and analytic consumers consistent when changing table
  semantics. Preserve seeded reproducibility and compile fixed context and
  formulas once where possible; ownership state may change during a run.
- Never invent missing rates or resolve ambiguous item IDs by choosing an
  arbitrary candidate. Preserve unknowns and the validation evidence.
- Fix general parser defects in the parser. Use overrides for mechanics the
  parser cannot derive, following `docs/OVERRIDES.md`. Override `tables`
  replace the generated tables wholesale; validation runs on the merged result.
- `verified` means pipeline-derived and passing deterministic checks;
  `manual_override` means override-authored and passing those checks.
  Failures remain `needs_review`. `ev_matches` is advisory and does not gate
  these success states. Never weaken a check just to improve coverage numbers.
- A watchlist entry is removed only after its mechanic is modeled and output
  is tested against the wiki's stated figures. Partial implementations retain
  an accurate description of the remaining gap.

## Ingestion workflow

**Reuse snapshots to fix parser bugs; do not re-fetch the wiki for a re-parse.**
New source research or intentional refreshes are separate operations. Use the
existing serialized, delayed wiki client with its User-Agent, maxlag, and retry
behavior when fetching is needed.

Run these from the repository root:

```sh
pnpm --filter @osrs-loot-simulator/ingest ingest parse --source <slug>
pnpm --filter @osrs-loot-simulator/ingest ingest parse
pnpm --filter @osrs-loot-simulator/ingest ingest site-index
```

Unscoped `parse` attempts every included source; `--tier` narrows a run and is
not a completeness boundary. After a general parser change, regenerate the
affected corpus from snapshots and review the data diff. Regenerate the site
index when boss metadata/status or shared tables change. Use `ingest item-icons`
when newly introduced items need icon resolution; it can require wiki access.
`ingest item-index` fetches item buckets and is not an offline parser command.

`parserVersion` is provenance metadata, **not a staleness mechanism**. Do not
bump it merely to fix a parser bug. The
corpus-reproducibility test is the guard against generated-document drift.

## Commands and verification

Use Node 22+ (CI uses 24) and the root `packageManager` pin, pnpm 9.15.9.

```sh
pnpm install
pnpm --filter @osrs-loot-simulator/web dev
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter @osrs-loot-simulator/web build
pnpm --filter @osrs-loot-simulator/web test:e2e
```

- Unit tests use Vitest. Run focused tests while iterating and the repository
  checks for code/data changes. Documentation-only changes need link/path and
  diff checks, not a full application test run.
- For model changes, retain Brutus regression coverage and check simulation,
  expected value, and probability behavior where affected. For parser or
  validation changes, use corpus and marginal-rate tests; check that a
  validator cannot silently skip a node kind or exclude its own failing inputs.
- Snapshot-dependent tests, including `corpus-reproducibility.test.ts`, can
  skip when the ignored cache is absent. Report skipped coverage explicitly;
  a passing fresh-checkout suite does not prove corpus reproducibility.
- Playwright is separate from `pnpm -r test`. It builds and serves a production
  Pages mimic to exercise the subpath, deep-link fallback, and actual worker.
  Run it for relevant UI, routing, worker, asset, or build changes. Install its
  browser if needed with
  `pnpm --filter @osrs-loot-simulator/web exec playwright install chromium`.

## Browser and publishing constraints

- Fetch boss JSON at runtime; do not bundle the corpus into application code.
  Resolve asset/data URLs through `import.meta.env.BASE_URL` and preserve the
  GitHub Pages `/osrs-loot-simulator/` subpath and SPA fallback.
- Load shared tables from the site index's manifest, not a hardcoded list.
  Keep `/admin` development-only and absent from the production bundle.
- Preserve shareable URL state. In the UI, seed `0` means generate a fresh seed
  for that run; the actual seed is shared for deterministic replay.
- Default search excludes non-repeatable sources. Derive controls from the
  model and respect boss context defaults. Use ingest-resolved icon filenames
  and curated unique/pet flags rather than guessing from names or rarity.
- Code is MIT; **everything under `data/` is CC BY-NC-SA 3.0**. Preserve both
  license files and the site's wiki attribution. Images are hot-linked to the
  wiki, with filenames stored in data.
- `infra/` is ignored and contains real secrets/IDs. Keep `infra.example/`
  placeholder-only and `.github/workflows/` committed and secret-free.

## Working conventions

Inspect the working tree before editing and preserve unrelated user changes.
The user handles Git operations: do not stage, commit, push, or otherwise mutate
Git state unless asked. Read-only Git checks are encouraged. If commits are
requested, use the repository's bracketed prefixes such as `[feat]`, `[fix]`,
`[data]`, `[docs]`, or `[chore]` and keep implementation phases separate.

After implementing any change, finish the final response with a one-line
suggested commit message in the form `[type] concise description`, matching
the Git history. Providing this message does not authorize creating a commit.

Keep changes scoped to the request. Explain what changed, which checks ran,
and any remaining limitations. Update relevant documentation when behavior
changes; avoid copying volatile counts or historical verdicts into this guide.
