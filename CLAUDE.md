# CLAUDE.md

This repo's spec is [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) at the root. Read it in
full before making structural changes. Where it says **DECIDED**, don't
re-litigate; where it says **VERIFY**, check reality before building against the
assumption. Log judgement calls the spec doesn't cover in `docs/DECISIONS.md`.

## Hard rules

- **No per-boss `if` statements in the simulator, ever.** Special cases are data
  (conditions, formula references, override files), not branches. Hitting the urge
  to write `if (boss === 'zulrah')` means the model is missing an expressive
  feature — fix the model, not the call site.
- **Build in the phase order in `PROJECT_PLAN.md` section 16.** Each phase ends
  with tests green and its own commit; don't batch phases into one commit.
- **`packages/loot-model` may not import from `apps/*`.** It has zero runtime deps
  besides `zod`.
- **Never re-hit the wiki to fix a parser bug.** Snapshots in `data/snapshots/`
  (gitignored) are the source of truth for re-parsing; bump `parserVersion` instead.
- **Two licenses.** Code is MIT (`/LICENSE`); everything under `data/` is
  CC BY-NC-SA 3.0 (`data/LICENSE`) because it's derived from the OSRS Wiki. Never
  relicense `data/` as MIT.
- **`infra/` is gitignored and holds real secrets/IDs; `infra.example/` is the
  committed, placeholder-only template.** `.github/workflows/` must stay committed
  and secret-free — real values come from repo secrets or `infra/`.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on.
- Zod at every boundary: wiki responses in, JSON files in and out, worker messages.
- Vitest everywhere; `packages/loot-model` targets high coverage since it's pure.
- Conventional commits: `feat:`, `fix:`, `data:`, `chore:`.
- No default exports except React components.

## Commands

```sh
pnpm install
pnpm -r test
pnpm -r typecheck
pnpm lint
```
