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
